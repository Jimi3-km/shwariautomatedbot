import crypto from 'node:crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { serviceClient } from '../supabase.js';
import { handler } from '../auth.js';
import {
  issueVisitorToken, verifyVisitorToken, newVisitorId,
} from '../channels/webchat/session.js';
import { rateLimit } from '../channels/webchat/rateLimit.js';
import { claimEvent, persistInbound } from '../services/inbound.js';
import { dispatchInbound } from '../services/dispatch.js';
import { WIDGET_SOURCE } from '../channels/webchat/widget.js';
import type { NormalizedInboundEvent } from '../channels/meta/types.js';

export const webchatRouter = Router();

/**
 * Public web chat endpoints, called by the widget from the business's own
 * website. No dashboard session exists here — the visitor is a member of the
 * public.
 *
 * The trust model:
 *   site key       public, identifies a channel, authorises nothing
 *   visitor token  signed with the channel secret, scopes every read to one
 *                  conversation
 *   rate limit     bounds what an unauthenticated caller can cost us
 *
 * Tenancy is always read from the channel row the site key resolves to, never
 * from anything the caller sends.
 */

/** A caller identity for rate limiting. Best effort; not a security control. */
function callerKey(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '') || req.ip || 'unknown';
  return ip;
}

interface ResolvedWebchat {
  id: string;
  tenantId: string;
  secretToken: string;
}

/** site key → channel → tenant. Only active channels answer. */
async function resolveBySiteKey(siteKey: string): Promise<ResolvedWebchat | null> {
  if (!siteKey || siteKey.length > 128) return null;

  const { data, error } = await serviceClient
    .from('channels')
    .select('id, tenant_id, secret_token, status')
    .eq('channel_type', 'webchat')
    .eq('channel_account_id', siteKey)
    .maybeSingle();

  if (error) {
    console.error('[webchat] channel lookup failed:', { code: error.code, message: error.message });
    return null;
  }
  if (!data || data.status !== 'active' || !data.secret_token) return null;

  return { id: data.id, tenantId: data.tenant_id, secretToken: data.secret_token };
}

// ---------------------------------------------------------------------------
// The widget script
// ---------------------------------------------------------------------------

/**
 * Served from our own origin and cached. Contains no tenant data: the site key
 * arrives as a data attribute on the caller's script tag.
 */
webchatRouter.get('/webchat/widget.js', (_req: Request, res: Response) => {
  res.type('application/javascript');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.send(WIDGET_SOURCE);
});

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/**
 * Start or resume a visitor session.
 *
 * A returning visitor presents their existing token and keeps their history;
 * anything invalid or expired quietly becomes a new visitor rather than an
 * error, because a stranger on a website should never see a failure screen.
 */
webchatRouter.post(
  '/webchat/:siteKey/session',
  handler(async (req, res) => {
    const limit = rateLimit(`wc:session:${callerKey(req)}`, 20, 60_000);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSeconds));
      return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
    }

    const channel = await resolveBySiteKey(req.params.siteKey);
    if (!channel) return res.status(404).json({ error: 'Chat is unavailable.' });

    const existing = typeof req.body?.token === 'string' ? req.body.token : '';
    const session = existing ? verifyVisitorToken(existing, channel.id, channel.secretToken) : null;

    const visitorId = session?.visitorId ?? newVisitorId();
    const token = issueVisitorToken({ visitorId, channelId: channel.id }, channel.secretToken);

    const { data: tenant } = await serviceClient
      .from('tenants').select('business_name, agent_name').eq('id', channel.tenantId).single();

    res.json({
      token,
      resumed: Boolean(session),
      business_name: tenant?.business_name ?? null,
      agent_name: tenant?.agent_name ?? 'Assistant',
    });
  })
);

// ---------------------------------------------------------------------------
// Inbound
// ---------------------------------------------------------------------------

/**
 * A visitor sends a message.
 *
 * From here on this is the same path as a Meta webhook: claim the event for
 * idempotency, write it to the Inbox, then hand to the pipeline only if the
 * conversation is still AI-handled.
 */
webchatRouter.post(
  '/webchat/:siteKey/message',
  handler(async (req, res) => {
    const limit = rateLimit(`wc:msg:${callerKey(req)}`, 30, 60_000);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSeconds));
      return res.status(429).json({ error: 'You are sending messages too quickly.' });
    }

    const channel = await resolveBySiteKey(req.params.siteKey);
    if (!channel) return res.status(404).json({ error: 'Chat is unavailable.' });

    const session = verifyVisitorToken(
      String(req.body?.token ?? ''), channel.id, channel.secretToken
    );
    if (!session) {
      // The widget reacts to this by starting a fresh session.
      return res.status(401).json({ error: 'Your chat session expired.', code: 'SESSION_EXPIRED' });
    }

    const text = String(req.body?.text ?? '').trim();
    if (!text) return res.status(400).json({ error: 'Please type a message.' });
    if (text.length > 2000) return res.status(400).json({ error: 'That message is too long.' });

    // The client may supply an id so a retried submit is not counted twice; it
    // is namespaced by visitor, so one visitor cannot suppress another's
    // messages by guessing ids.
    const clientId = String(req.body?.client_message_id ?? '').slice(0, 64);
    const messageId = `${session.visitorId}:${clientId || crypto.randomUUID()}`;

    const event: NormalizedInboundEvent = {
      tenantId: channel.tenantId,
      channelId: channel.id,
      channelType: 'webchat',
      customerId: session.visitorId,
      customerName: null,
      messageId,
      text,
      media: null,
      timestamp: new Date().toISOString(),
    };

    const claimed = await claimEvent('webchat', messageId, event.tenantId, event.channelId);
    if (!claimed) return res.json({ accepted: true, duplicate: true });

    const stored = await persistInbound(event);
    if (!stored) return res.status(500).json({ error: "We couldn't deliver that message." });

    // Answer the widget now and let the AI turn run behind it. Shwari reasons
    // and calls tools, which takes seconds rather than milliseconds, and the
    // widget is already polling for the reply — holding the POST open would
    // only make the visitor watch a spinner for the same wait.
    if (stored.aiEnabled) {
      const conversationId = stored.conversationId;
      void dispatchInbound(
        event,
        { id: channel.id, tenantId: channel.tenantId, channelType: 'webchat', secretToken: channel.secretToken, status: 'active' },
        conversationId
      ).catch((e) => {
        console.error('[webchat] dispatch failed:', e instanceof Error ? e.message : e);
      });
    } else {
      console.log(`[webchat] conversation ${stored.conversationId} is staff-handled; no AI reply`);
    }

    res.json({ accepted: true, duplicate: false });
  })
);

// ---------------------------------------------------------------------------
// Outbound (polled)
// ---------------------------------------------------------------------------

/**
 * The visitor's own transcript.
 *
 * Scoped three ways: to the channel the site key resolves to, to the tenant on
 * that channel, and to the conversation belonging to the visitor named in the
 * signed token. A different visitor's token returns a different conversation;
 * no token returns nothing.
 *
 * `system` messages are withheld — they are internal staff notes such as
 * "Conversation taken over by staff", which the customer should not see.
 */
webchatRouter.get(
  '/webchat/:siteKey/messages',
  handler(async (req, res) => {
    const limit = rateLimit(`wc:poll:${callerKey(req)}`, 240, 60_000);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSeconds));
      return res.status(429).json({ error: 'Too many requests.' });
    }

    const channel = await resolveBySiteKey(req.params.siteKey);
    if (!channel) return res.status(404).json({ error: 'Chat is unavailable.' });

    const session = verifyVisitorToken(
      String(req.query.token ?? ''), channel.id, channel.secretToken
    );
    if (!session) {
      return res.status(401).json({ error: 'Your chat session expired.', code: 'SESSION_EXPIRED' });
    }

    const { data: convo } = await serviceClient
      .from('conversations')
      .select('id')
      .eq('tenant_id', channel.tenantId)
      .eq('channel_type', 'webchat')
      .eq('customer_id', session.visitorId)
      .maybeSingle();

    if (!convo) return res.json({ messages: [] });

    const since = String(req.query.since ?? '');
    let q = serviceClient
      .from('conversation_messages')
      .select('id, sender, body, created_at')
      .eq('tenant_id', channel.tenantId)
      .eq('conversation_id', convo.id)
      .in('sender', ['customer', 'agent', 'staff'])
      .order('id', { ascending: true })
      .limit(100);

    if (since && /^\d+$/.test(since)) q = q.gt('id', Number(since));

    const { data, error } = await q;
    if (error) {
      console.error('[webchat] transcript read failed:', { code: error.code, message: error.message });
      return res.status(500).json({ error: "We couldn't load the conversation." });
    }

    res.json({
      messages: (data ?? []).map((m) => ({
        id: m.id,
        // Staff and AI both read as "the business" to the visitor.
        from: m.sender === 'customer' ? 'you' : 'agent',
        text: m.body,
        at: m.created_at,
      })),
    });
  })
);
