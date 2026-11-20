import crypto from 'node:crypto';
import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { serviceClient } from '../supabase.js';
import { handler } from '../auth.js';
import { getProvider, ProviderError } from '../channels/providers/index.js';
import { dispatchDueFollowUps } from '../services/followUps.js';
import { planNurture } from '../services/nurture.js';
import { learnFromStaffReplies, learnFromOwnMistakes } from '../ai/learning.js';
import { retryInterruptedEvents } from '../services/pipeline.js';
import { refreshInstagramTokens, pruneWebhookEvents } from '../services/maintenance.js';

export const internalRouter = Router();

/**
 * Server-to-server endpoints: the scheduler and any automation that needs to
 * send through a channel without holding its credentials.
 *
 * Two callers, two credentials, both compared in constant time:
 *
 *   x-internal-secret: $INTERNAL_API_SECRET    an automation you run
 *   Authorization: Bearer $CRON_SECRET         Vercel Cron, which sends this
 *                                              header on its own when
 *                                              CRON_SECRET is set on the project
 *
 * With neither configured every call is refused.
 */

function equalSecret(presented: string, expected: string): boolean {
  // Hashing first makes the comparison constant-time whatever the lengths.
  const a = crypto.createHash('sha256').update(presented).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function internalSecretOk(req: Request): boolean {
  const expected = (process.env.INTERNAL_API_SECRET || '').trim();
  const provided = req.headers['x-internal-secret'];
  return Boolean(expected) && typeof provided === 'string' && provided.length > 0 && equalSecret(provided, expected);
}

function cronSecretOk(req: Request): boolean {
  const expected = (process.env.CRON_SECRET || '').trim();
  const auth = req.headers.authorization;
  if (!expected || typeof auth !== 'string' || !/^bearer\s+/i.test(auth)) return false;
  return equalSecret(auth.replace(/^bearer\s+/i, '').trim(), expected);
}

/** Automation callers only. */
function requireInternalSecret(req: Request, res: Response, next: NextFunction) {
  if (!(process.env.INTERNAL_API_SECRET || '').trim()) {
    console.error('[internal] INTERNAL_API_SECRET is not set; refusing every internal call');
    return res.status(503).json({ error: 'Internal API is not configured' });
  }
  if (!internalSecretOk(req)) {
    console.warn('[internal] rejected a call with a missing or incorrect secret');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

/** The scheduler, or an automation holding the internal secret. */
function requireScheduler(req: Request, res: Response, next: NextFunction) {
  const anyConfigured =
    Boolean((process.env.CRON_SECRET || '').trim()) ||
    Boolean((process.env.INTERNAL_API_SECRET || '').trim());
  if (!anyConfigured) {
    console.error('[internal] neither CRON_SECRET nor INTERNAL_API_SECRET is set; refusing scheduled work');
    return res.status(503).json({ error: 'Scheduled jobs are not configured' });
  }
  if (!cronSecretOk(req) && !internalSecretOk(req)) {
    console.warn('[internal] rejected a scheduled call with a missing or incorrect secret');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

/**
 * Outbound message on whichever channel the conversation belongs to.
 *
 * The tenant is derived from the channel row, so a caller that guesses a
 * channel id can still only ever reach that channel's own tenant — there is no
 * tenant id in the request to get wrong.
 *
 * The message is written to the conversation's transcript as well as sent. For
 * web chat that row is the delivery itself (the widget polls the transcript and
 * has no outbound API); for every other channel it is what makes the Inbox
 * show what the customer was told.
 */
internalRouter.post(
  '/internal/send',
  requireInternalSecret,
  handler(async (req, res) => {
    const channelId = String(req.body?.channel_id ?? '').trim();
    const recipient = String(req.body?.customer_id ?? '').trim();
    const text = String(req.body?.text ?? '').trim();

    if (!channelId || !recipient || !text) {
      return res.status(400).json({ error: 'channel_id, customer_id and text are required' });
    }
    if (text.length > 4000) {
      return res.status(400).json({ error: 'text exceeds 4000 characters' });
    }

    const { data: channel } = await serviceClient
      .from('channels')
      .select('id, tenant_id, channel_type, status')
      .eq('id', channelId)
      .maybeSingle();

    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    if (channel.status !== 'active') {
      return res.status(409).json({ error: 'Channel is not active' });
    }

    const provider = getProvider(channel.channel_type);
    if (!provider) {
      return res.status(400).json({ error: `No provider handles ${channel.channel_type}` });
    }

    const { data: convo } = await serviceClient
      .from('conversations')
      .select('id')
      .eq('tenant_id', channel.tenant_id)
      .eq('channel_type', channel.channel_type)
      .eq('customer_id', recipient)
      .maybeSingle();

    const record = async (): Promise<boolean> => {
      if (!convo) return false;
      const { error } = await serviceClient.from('conversation_messages').insert({
        tenant_id: channel.tenant_id,
        conversation_id: convo.id,
        sender: 'agent',
        body: text,
        extracted: { source: 'internal_send' },
      });
      if (error) {
        console.error('[internal] could not record the outbound message:', error.message);
        return false;
      }
      await serviceClient
        .from('conversations')
        .update({ last_message_at: new Date().toISOString(), last_message_preview: text.slice(0, 160) })
        .eq('id', convo.id)
        .eq('tenant_id', channel.tenant_id);
      return true;
    };

    if (channel.channel_type === 'webchat') {
      // No conversation means no visitor session to deliver into.
      if (!convo) return res.status(404).json({ error: 'That chat session does not exist' });
      if (!(await record())) return res.status(500).json({ error: 'Could not save the message' });
      return res.json({ sent: true, recorded: true });
    }

    try {
      await provider.sendMessage(channel.id, recipient, text, {
        tenantId: channel.tenant_id,
        userId: 'system',
      });
    } catch (e) {
      if (e instanceof ProviderError) {
        console.warn(`[internal] send failed on ${channel.channel_type} (${e.code}): ${e.message}`);
        return res.status(e.status).json({ error: e.userMessage, code: e.code });
      }
      console.error('[internal] send failed:', e);
      return res.status(502).json({ error: 'Could not send the message' });
    }

    res.json({ sent: true, recorded: await record() });
  })
);

/**
 * Send the follow-ups that have come due.
 *
 * Safe to call as often as you like: a row is claimed before it is sent, so two
 * overlapping runs cannot message the same customer twice. POST is kept for
 * existing automations; the GET under /internal/cron is what Vercel Cron calls.
 */
internalRouter.post(
  '/internal/follow-ups/dispatch',
  requireScheduler,
  handler(async (_req, res) => {
    try {
      res.json(await dispatchDueFollowUps());
    } catch {
      res.status(500).json({ error: 'Could not read the queue' });
    }
  })
);

/**
 * Scheduled: due follow-ups, plus inbound messages whose AI turn was cut off.
 *
 * Vercel Cron issues a GET. On the Hobby plan a cron runs at most daily, so
 * this is the backstop; the same work also runs in small slices after each
 * inbound webhook (see services/followUps.ts → housekeeping).
 */
internalRouter.get(
  '/internal/cron/dispatch',
  requireScheduler,
  handler(async (_req, res) => {
    const events = await retryInterruptedEvents(10).catch((e) => {
      console.error('[internal] event retry failed:', e instanceof Error ? e.message : e);
      return null;
    });
    // Queue check-ins for interested customers who went quiet, before the
    // sender below runs, so they go out in this same pass.
    const nurture = await planNurture({ limit: 10, budgetMs: 12_000 }).catch((e) => {
      console.error('[internal] nurture planning failed:', e instanceof Error ? e.message : e);
      return null;
    });
    const followUps = await dispatchDueFollowUps({ limit: 25, budgetMs: 22_000 }).catch((e) => {
      console.error('[internal] follow-up dispatch failed:', e instanceof Error ? e.message : e);
      return null;
    });
    res.json({ ok: true, events, nurture, follow_ups: followUps });
  })
);

/** Scheduled: keep Instagram tokens alive and trim the idempotency table. */
internalRouter.get(
  '/internal/cron/maintenance',
  requireScheduler,
  handler(async (_req, res) => {
    const instagram = await refreshInstagramTokens().catch((e) => {
      console.error('[internal] token refresh failed:', e instanceof Error ? e.message : e);
      return null;
    });
    const prune = await pruneWebhookEvents().catch(() => ({ pruned: false }));
    // Turn what staff told customers into knowledge the agents can use.
    const learning = await learnFromStaffReplies({ limit: 10, budgetMs: 25_000 }).catch((e) => {
      console.error('[internal] learning pass failed:', e instanceof Error ? e.message : e);
      return null;
    });
    const mistakes = await learnFromOwnMistakes().catch(() => null);
    res.json({ ok: true, instagram_tokens: instagram, webhook_events: prune, learning, mistakes });
  })
);
