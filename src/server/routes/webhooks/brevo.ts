import { Router } from 'express';
import type { Request, Response } from 'express';
import { serviceClient } from '../../supabase.js';
import { claimEvent, persistInbound } from '../../services/inbound.js';
import { runAgentTurn } from '../../ai/agent.js';
import { chooseDepartment } from '../../ai/router.js';
import { llmConfigured } from '../../ai/llm.js';
import { sendAgentEmailReply } from '../../services/brevo.js';
import type { NormalizedInboundEvent } from '../../channels/meta/types.js';

export const brevoWebhookRouter = Router();

/**
 * Brevo Inbound Email Webhook.
 *
 * When an incoming email is delivered to your inbound email address or domain,
 * Brevo parses the headers, sender, and text body, then POSTs to this webhook.
 *
 * We:
 *  1. Parse the sender, subject, and text message.
 *  2. Resolve the matching tenant (by recipient email alias or primary tenant).
 *  3. Persist the inbound conversation message.
 *  4. Route to the appropriate AI department (support, sales, booking).
 *  5. Run the agent turn and dispatch the reply directly back to the customer via Brevo.
 */
brevoWebhookRouter.post('/webhooks/brevo-email', (req: Request, res: Response) => {
  // Acknowledge Brevo immediately so it does not retry while the LLM generates a reply.
  res.sendStatus(200);

  void handleInboundEmail(req.body).catch((err) => {
    console.error('[webhooks/brevo-email] processing failed:', err instanceof Error ? err.message : err);
  });
});

interface BrevoInboundItem {
  Uuid?: string[];
  MessageId?: string;
  Sender?: {
    Name?: string;
    Address?: string;
  };
  Recipients?: Array<{
    Name?: string;
    Address?: string;
  }>;
  Subject?: string;
  RawHtmlBody?: string;
  RawTextBody?: string;
  ExtractedMarkdownMessage?: string;
}

async function handleInboundEmail(body: unknown): Promise<void> {
  const payload = body as { items?: BrevoInboundItem[] } | BrevoInboundItem;
  const items: BrevoInboundItem[] = Array.isArray(payload.items)
    ? payload.items
    : payload && typeof payload === 'object' && 'Sender' in payload
    ? [payload as BrevoInboundItem]
    : [];

  if (!items.length) {
    console.log('[webhooks/brevo-email] received empty or non-item payload');
    return;
  }

  for (const item of items) {
    const senderEmail = item.Sender?.Address?.trim().toLowerCase();
    const senderName = item.Sender?.Name?.trim() || senderEmail?.split('@')[0] || 'Customer';
    const subject = item.Subject?.trim() || 'Inquiry';
    const textContent =
      item.ExtractedMarkdownMessage?.trim() ||
      item.RawTextBody?.trim() ||
      '(empty message)';
    const messageId =
      item.MessageId || (item.Uuid && item.Uuid[0]) || `email_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    if (!senderEmail) {
      console.warn('[webhooks/brevo-email] skipped item without sender email');
      continue;
    }

    // Resolve tenant. First check recipient address for a tenant slug or use the primary tenant.
    const tenant = await resolveTenantForEmail(item.Recipients);
    if (!tenant) {
      console.warn('[webhooks/brevo-email] could not resolve tenant for incoming email');
      continue;
    }

    // Prevent duplicate processing
    const claimed = await claimEvent('email', messageId, tenant.id, 'brevo_inbound');
    if (!claimed) {
      console.log(`[webhooks/brevo-email] duplicate message ${messageId}; skipped`);
      continue;
    }

    const event: NormalizedInboundEvent = {
      tenantId: tenant.id,
      channelId: 'brevo_inbound',
      channelType: 'chat',
      customerId: senderEmail,
      customerName: senderName,
      messageId,
      text: `[Email: ${subject}]\n\n${textContent}`,
      timestamp: new Date().toISOString(),
      raw: item,
    };

    const stored = await persistInbound(event);
    if (!stored) continue;

    if (!stored.aiEnabled) {
      console.log(`[webhooks/brevo-email] conversation ${stored.conversationId} is staff-handled; no AI email reply`);
      continue;
    }

    // Execute AI agent response
    if (llmConfigured().configured) {
      const routed = await chooseDepartment(tenant.id, textContent);
      const role = routed?.role || 'customer_support';

      try {
        const turn = await runAgentTurn({
          tenantId: tenant.id,
          role,
          userId: null,
          conversationId: stored.conversationId,
          text: textContent,
        });

        // Store reply in conversation messages
        await serviceClient.from('conversation_messages').insert({
          tenant_id: tenant.id,
          conversation_id: stored.conversationId,
          sender: 'agent',
          body: turn.reply,
          extracted: { agent: 'shwari', channel: 'email', subject },
        });

        await serviceClient
          .from('conversations')
          .update({
            last_message_at: new Date().toISOString(),
            last_message_preview: turn.reply.slice(0, 160),
          })
          .eq('id', stored.conversationId)
          .eq('tenant_id', tenant.id);

        // Send email back to customer
        await sendAgentEmailReply({
          customerEmail: senderEmail,
          customerName: senderName,
          subject,
          replyText: turn.reply,
          inReplyToMessageId: item.MessageId,
          businessName: tenant.business_name || tenant.name || 'Shwari Services',
        });

        console.log(`[webhooks/brevo-email] sent AI reply to ${senderEmail} for conversation ${stored.conversationId}`);
      } catch (err) {
        console.error('[webhooks/brevo-email] AI turn error:', err instanceof Error ? err.message : err);
      }
    }
  }
}

async function resolveTenantForEmail(recipients?: Array<{ Address?: string }>): Promise<{ id: string; name?: string; business_name?: string } | null> {
  // Check recipient addresses for a match against a tenant slug or contact_info
  if (recipients && recipients.length) {
    for (const r of recipients) {
      const addr = (r.Address || '').toLowerCase();
      const localPart = addr.split('@')[0];
      const { data: tenant } = await serviceClient
        .from('tenants')
        .select('id, name, business_name, slug')
        .or(`slug.eq.${localPart}`)
        .limit(1)
        .maybeSingle();

      if (tenant) return tenant;
    }
  }

  // Fallback: Use the first active tenant in the system
  const { data: defaultTenant } = await serviceClient
    .from('tenants')
    .select('id, name, business_name, slug')
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  return defaultTenant ?? null;
}
