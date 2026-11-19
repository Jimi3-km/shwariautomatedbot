import crypto from 'node:crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { serviceClient } from '../../supabase.js';
import { claimEvent, markEvent, persistInbound } from '../../services/inbound.js';
import { runInBackground, withDeadline } from '../../services/background.js';
import { runAgentTurn } from '../../ai/agent.js';
import { chooseDepartment } from '../../ai/router.js';
import { llmConfigured } from '../../ai/llm.js';
import { sendAgentEmailReply, getBrevoSender } from '../../services/brevo.js';
import type { NormalizedInboundEvent } from '../../channels/meta/types.js';

export const brevoWebhookRouter = Router();

/**
 * Brevo inbound email webhook.
 *
 * When an email arrives at the inbound address or domain, Brevo parses it and
 * POSTs it here. We resolve the tenant from the recipient address, record the
 * message in the Inbox, let the matching department answer, and send the reply
 * back through Brevo.
 *
 * This route triggers an AI turn and an outbound email, so it is never open:
 * without BREVO_WEBHOOK_SECRET configured it refuses every call. The secret is
 * accepted only in a header — a query-string secret ends up in access logs.
 * Configure the Brevo webhook to send either
 *
 *     x-brevo-webhook-secret: <secret>      or
 *     Authorization: Bearer <secret>
 */

function presentedSecret(req: Request): string {
  const custom = req.headers['x-brevo-webhook-secret'];
  if (typeof custom === 'string' && custom) return custom.trim();

  const auth = req.headers.authorization;
  if (typeof auth === 'string' && /^bearer\s+/i.test(auth)) {
    return auth.replace(/^bearer\s+/i, '').trim();
  }
  return '';
}

function secretMatches(presented: string, expected: string): boolean {
  // Hash both sides so the comparison is constant-time regardless of length.
  const a = crypto.createHash('sha256').update(presented).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

brevoWebhookRouter.post('/webhooks/brevo-email', (req: Request, res: Response) => {
  const expected = (process.env.BREVO_WEBHOOK_SECRET || '').trim();
  if (!expected) {
    console.error('[webhooks/brevo-email] BREVO_WEBHOOK_SECRET is not set; refusing inbound email');
    return res.sendStatus(503);
  }

  const presented = presentedSecret(req);
  if (!presented || !secretMatches(presented, expected)) {
    console.warn('[webhooks/brevo-email] rejected: missing or incorrect webhook secret');
    return res.sendStatus(401);
  }

  // Acknowledge Brevo immediately so it does not retry while the model works;
  // the work is registered with the platform so it is not frozen mid-turn.
  res.sendStatus(200);

  const body = req.body;
  void runInBackground('webhooks/brevo-email', () => handleInboundEmail(body));
});

interface BrevoInboundItem {
  Uuid?: string[];
  MessageId?: string;
  InReplyTo?: string | null;
  Sender?: { Name?: string; Address?: string };
  From?: { Name?: string; Address?: string };
  Recipients?: Array<{ Name?: string; Address?: string }>;
  To?: Array<{ Name?: string; Address?: string }>;
  Subject?: string;
  Headers?: Record<string, unknown>;
  RawHtmlBody?: string;
  RawTextBody?: string;
  ExtractedMarkdownMessage?: string;
}

const EMAIL_RE = /^[^\s@<>"',;()\\]{1,64}@[a-z0-9](?:[a-z0-9-]{0,62}\.)+[a-z]{2,24}$/i;
const MAX_BODY_CHARS = 8_000;
/** At most this many AI email replies to one address per hour. */
const MAX_REPLIES_PER_HOUR = 5;

function header(item: BrevoInboundItem, name: string): string {
  const headers = item.Headers;
  if (!headers || typeof headers !== 'object') return '';
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) {
      return (Array.isArray(value) ? value.join(', ') : String(value ?? '')).trim();
    }
  }
  return '';
}

/**
 * Is this mail from a machine rather than a person?
 *
 * Answering an auto-reply, a bounce or a mailing list is how two robots end up
 * emailing each other forever — on our Brevo quota and our model bill.
 */
export function isAutomatedMail(item: BrevoInboundItem, senderEmail: string): string | null {
  const auto = header(item, 'auto-submitted').toLowerCase();
  if (auto && auto !== 'no') return 'auto-submitted';

  const precedence = header(item, 'precedence').toLowerCase();
  if (['bulk', 'junk', 'list', 'auto_reply'].includes(precedence)) return `precedence ${precedence}`;

  if (header(item, 'x-autoreply') || header(item, 'x-autorespond') || header(item, 'x-auto-response-suppress')) {
    return 'auto-responder header';
  }
  if (header(item, 'list-id') || header(item, 'list-unsubscribe')) return 'mailing list';
  if (header(item, 'x-failed-recipients')) return 'bounce';

  const local = senderEmail.split('@')[0];
  if (/^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounces?|notifications?)([+._-].*)?$/i.test(local)) {
    return 'automated sender';
  }

  // Our own outbound address writing to us is a loop by definition.
  const own = (getBrevoSender().email || '').toLowerCase();
  if (own && senderEmail === own) return 'our own sender address';

  return null;
}

/** A stable id for dedupe: the provider's when it gives one, a content hash otherwise. */
function eventIdFor(item: BrevoInboundItem, senderEmail: string, subject: string, text: string): string {
  const provided = (item.MessageId || item.Uuid?.[0] || '').trim();
  if (provided) return `email:${provided.slice(0, 200)}`;
  const digest = crypto
    .createHash('sha256')
    .update(`${senderEmail}\n${subject}\n${text}`)
    .digest('hex')
    .slice(0, 40);
  return `email:sha256:${digest}`;
}

async function handleInboundEmail(body: unknown): Promise<void> {
  const raw = body as Record<string, unknown> | null;
  const items: BrevoInboundItem[] = Array.isArray(raw?.items)
    ? (raw!.items as BrevoInboundItem[])
    : raw && typeof raw === 'object' && ('Sender' in raw || 'From' in raw)
    ? [raw as unknown as BrevoInboundItem]
    : [];

  if (!items.length) {
    console.log('[webhooks/brevo-email] received empty or non-item payload');
    return;
  }

  // A single delivery is bounded so one POST cannot fan out into many turns.
  for (const item of items.slice(0, 10)) {
    try {
      await handleItem(item);
    } catch (e) {
      console.error('[webhooks/brevo-email] item failed:', e instanceof Error ? e.message : e);
    }
  }
}

async function handleItem(item: BrevoInboundItem): Promise<void> {
  const from = item.Sender ?? item.From;
  const senderEmail = (from?.Address ?? '').trim().toLowerCase();
  if (!senderEmail || !EMAIL_RE.test(senderEmail)) {
    console.warn('[webhooks/brevo-email] skipped item without a valid sender address');
    return;
  }

  const senderName = (from?.Name ?? '').trim().slice(0, 120) || senderEmail.split('@')[0];
  const subject = (item.Subject ?? '').trim().slice(0, 200) || 'Inquiry';
  const textContent = (
    item.ExtractedMarkdownMessage?.trim() ||
    item.RawTextBody?.trim() ||
    '(empty message)'
  ).slice(0, MAX_BODY_CHARS);

  const automated = isAutomatedMail(item, senderEmail);
  if (automated) {
    console.log(`[webhooks/brevo-email] ignoring automated mail (${automated})`);
    return;
  }

  const tenant = await resolveTenantForEmail(item.Recipients ?? item.To);
  if (!tenant) {
    console.warn('[webhooks/brevo-email] could not resolve a tenant for the recipient address');
    return;
  }

  const messageId = eventIdFor(item, senderEmail, subject, textContent);

  const event: NormalizedInboundEvent = {
    tenantId: tenant.id,
    // Email has no channels row. The conversation is keyed on channel_type
    // 'email' and the sender's address.
    channelId: null,
    channelType: 'email',
    customerId: senderEmail,
    customerName: senderName,
    messageId,
    text: `[Email: ${subject}]\n\n${textContent}`,
    media: null,
    timestamp: new Date().toISOString(),
  };

  // webhook_events.provider is constrained to the channel providers, so email
  // dedupe rows are recorded under 'webchat' with an 'email:' id prefix that no
  // web chat id can collide with (those are '<visitor>:<uuid>').
  const claimed = await claimEvent('webchat', messageId, tenant.id, null, event);
  if (!claimed) {
    console.log('[webhooks/brevo-email] duplicate message; skipped');
    return;
  }

  const stored = await persistInbound(event);
  if (!stored) {
    await markEvent('webchat', messageId, 'failed', { error: 'could not persist the email' });
    return;
  }
  await markEvent('webchat', messageId, 'persisted', { conversationId: stored.conversationId });

  if (!stored.aiEnabled) {
    console.log(`[webhooks/brevo-email] conversation ${stored.conversationId} is staff-handled; no AI email reply`);
    await markEvent('webchat', messageId, 'processed');
    return;
  }

  if (!llmConfigured().configured) {
    await markEvent('webchat', messageId, 'processed');
    return;
  }

  if (await tooManyRecentReplies(tenant.id, stored.conversationId)) {
    console.warn(`[webhooks/brevo-email] reply limit reached for conversation ${stored.conversationId}; leaving it for staff`);
    await markEvent('webchat', messageId, 'processed');
    return;
  }

  try {
    const routed = await chooseDepartment(tenant.id, textContent, stored.conversationId);
    const role = routed?.role || 'support';

    const turn = await withDeadline(
      runAgentTurn({
        tenantId: tenant.id,
        role,
        userId: null,
        conversationId: stored.conversationId,
        text: textContent,
      }),
      50_000,
      'AI turn'
    );

    const { data: row, error: insertErr } = await serviceClient
      .from('conversation_messages')
      .insert({
        tenant_id: tenant.id,
        conversation_id: stored.conversationId,
        sender: 'agent',
        body: turn.reply,
        extracted: { agent: 'shwari', channel: 'email', subject },
      })
      .select('id')
      .maybeSingle();
    if (insertErr) {
      console.error('[webhooks/brevo-email] could not record the reply:', insertErr.message);
    }

    await serviceClient
      .from('conversations')
      .update({
        last_message_at: new Date().toISOString(),
        last_message_preview: turn.reply.slice(0, 160),
      })
      .eq('id', stored.conversationId)
      .eq('tenant_id', tenant.id);

    const sent = await sendAgentEmailReply({
      customerEmail: senderEmail,
      customerName: senderName,
      subject,
      replyText: turn.reply,
      inReplyToMessageId: item.MessageId,
      businessName: tenant.business_name || 'Shwari Services',
    });

    if (!sent.success) {
      console.error('[webhooks/brevo-email] reply email was not sent:', sent.error);
      const rowId = (row as { id?: unknown } | null)?.id;
      if (rowId !== undefined && rowId !== null) {
        await serviceClient
          .from('conversation_messages')
          .update({
            extracted: {
              agent: 'shwari', channel: 'email', subject,
              delivery: { status: 'failed', error: 'The email could not be sent.', at: new Date().toISOString() },
            },
          })
          .eq('id', rowId)
          .eq('tenant_id', tenant.id);
      }
      await markEvent('webchat', messageId, 'failed', { error: 'email send failed' });
      return;
    }

    await markEvent('webchat', messageId, 'processed');
    console.log(`[webhooks/brevo-email] replied by email for conversation ${stored.conversationId}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[webhooks/brevo-email] AI turn error:', message);
    await markEvent('webchat', messageId, 'failed', { error: message });
  }
}

async function tooManyRecentReplies(tenantId: string, conversationId: string): Promise<boolean> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data } = await serviceClient
    .from('conversation_messages')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('conversation_id', conversationId)
    .eq('sender', 'agent')
    .gte('created_at', since)
    .limit(MAX_REPLIES_PER_HOUR);
  return Array.isArray(data) && data.length >= MAX_REPLIES_PER_HOUR;
}

interface EmailTenant {
  id: string;
  business_name?: string | null;
}

/**
 * Recipient address → tenant.
 *
 * The recipient is attacker-controlled, so it is never interpolated into a
 * filter expression: the local part must look like a slug, and each lookup is
 * a plain equality the client library encodes as a value. Never falls back to
 * some other tenant.
 */
async function resolveTenantForEmail(
  recipients?: Array<{ Address?: string }>
): Promise<EmailTenant | null> {
  if (!Array.isArray(recipients)) return null;

  for (const r of recipients.slice(0, 10)) {
    const addr = (r?.Address ?? '').toLowerCase().trim();
    if (!addr || !EMAIL_RE.test(addr)) continue;

    // Plus-addressing: shop+anything@inbound.example → shop.
    const localPart = addr.split('@')[0].split('+')[0];

    if (/^[a-z0-9][a-z0-9_-]{0,62}$/.test(localPart)) {
      const { data: bySlug } = await serviceClient
        .from('tenants')
        .select('id, business_name')
        .eq('slug', localPart)
        .eq('status', 'active')
        .limit(1);
      const hit = Array.isArray(bySlug) ? bySlug[0] : null;
      if (hit) return hit;
    }

    const { data: byTarget } = await serviceClient
      .from('tenants')
      .select('id, business_name')
      .eq('notification_target', addr)
      .eq('status', 'active')
      .limit(2);
    // An address shared by two businesses identifies neither.
    if (Array.isArray(byTarget) && byTarget.length === 1) return byTarget[0];
  }

  return null;
}
