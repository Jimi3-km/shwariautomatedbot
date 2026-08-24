import crypto from 'node:crypto';
import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { serviceClient } from '../supabase.js';
import { handler } from '../auth.js';
import { getProvider, ProviderError } from '../channels/providers/index.js';

export const internalRouter = Router();

/**
 * Server-to-server endpoints for the automation pipeline.
 *
 * The point of this router is that n8n does not need to know how any channel
 * works. It says "send this text to this customer on this channel" and the
 * provider registry decides whether that means the Telegram Bot API, the
 * WhatsApp Cloud API or the Instagram Graph API. Credentials stay here; the
 * pipeline never holds a bot token or a Meta access token.
 */

/** Shared secret, compared in constant time. */
function requireInternalSecret(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.INTERNAL_API_SECRET;
  if (!expected) {
    console.error('[internal] INTERNAL_API_SECRET is not set; refusing every internal call');
    return res.status(503).json({ error: 'Internal API is not configured' });
  }

  const provided = req.headers['x-internal-secret'];
  if (typeof provided !== 'string' || provided.length !== expected.length) {
    console.warn('[internal] rejected a call with a missing or malformed secret');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
    console.warn('[internal] rejected a call with an incorrect secret');
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

    try {
      await provider.sendMessage(channel.id, recipient, text, {
        tenantId: channel.tenant_id,
        userId: 'system',
      });
      res.json({ sent: true });
    } catch (e) {
      if (e instanceof ProviderError) {
        console.warn(`[internal] send failed on ${channel.channel_type} (${e.code}): ${e.message}`);
        return res.status(e.status).json({ error: e.userMessage, code: e.code });
      }
      console.error('[internal] send failed:', e);
      res.status(502).json({ error: 'Could not send the message' });
    }
  })
);

/**
 * Send the follow-ups that have come due.
 *
 * An agent never sends a message to a customer. It writes a row in follow_ups,
 * which a person can read and cancel, and this endpoint is what turns the ones
 * still standing into real messages. Calling it is n8n's job — a schedule is
 * exactly the kind of deterministic work the pipeline is good at, and keeping
 * it there means this application needs no timer of its own.
 *
 * Safe to call as often as you like: a row is claimed before it is sent, so two
 * overlapping runs cannot message the same customer twice.
 */
internalRouter.post(
  '/internal/follow-ups/dispatch',
  requireInternalSecret,
  handler(async (_req, res) => {
    const { data: due, error } = await serviceClient
      .from('follow_ups')
      .select('id, tenant_id, conversation_id, customer_id, channel_type, message')
      .eq('status', 'pending')
      .lte('due_at', new Date().toISOString())
      .order('due_at')
      .limit(50);

    if (error) {
      console.error('[internal] could not read due follow-ups:', error.message);
      return res.status(500).json({ error: 'Could not read the queue' });
    }

    let sent = 0;
    let failed = 0;

    for (const row of due ?? []) {
      // Claim first. The status filter makes this the point at which one runner
      // wins the row, so a second run finds nothing to do rather than sending
      // the same message again.
      const { data: claimed } = await serviceClient
        .from('follow_ups')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', row.id)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle();

      if (!claimed) continue;

      const { data: channel } = await serviceClient
        .from('channels')
        .select('id, status')
        .eq('tenant_id', row.tenant_id)
        .eq('channel_type', row.channel_type)
        .eq('status', 'active')
        .maybeSingle();

      const provider = getProvider(row.channel_type);

      if (!channel || !provider) {
        await markFailed(row.id, 'That channel is no longer connected.');
        failed++;
        continue;
      }

      /**
       * Write it into the transcript first, for two reasons. The Inbox should
       * show what was said to a customer whichever way it was sent. And web
       * chat has no outbound API at all — its widget polls this transcript, so
       * for that channel the row *is* the delivery, and provider.sendMessage is
       * correctly a no-op.
       */
      if (row.conversation_id) {
        await serviceClient.from('conversation_messages').insert({
          tenant_id: row.tenant_id,
          conversation_id: row.conversation_id,
          sender: 'agent',
          body: row.message,
          extracted: { follow_up: true },
        });
        await serviceClient
          .from('conversations')
          .update({
            last_message_at: new Date().toISOString(),
            last_message_preview: row.message.slice(0, 160),
          })
          .eq('id', row.conversation_id)
          .eq('tenant_id', row.tenant_id);
      } else if (row.channel_type === 'webchat') {
        // Nothing to write to and nothing to send through.
        await markFailed(row.id, 'That chat session has ended.');
        failed++;
        continue;
      }

      try {
        await provider.sendMessage(channel.id, row.customer_id, row.message, {
          tenantId: row.tenant_id,
          userId: '',
        });
        sent++;
      } catch (e) {
        const reason = e instanceof ProviderError ? e.userMessage : 'The message could not be delivered.';
        console.error('[internal] follow-up delivery failed:', e instanceof Error ? e.message : e);
        await markFailed(row.id, reason);
        failed++;
      }
    }

    res.json({ due: (due ?? []).length, sent, failed });
  })
);

async function markFailed(id: string, reason: string): Promise<void> {
  await serviceClient
    .from('follow_ups')
    .update({ status: 'failed', failure_reason: reason, updated_at: new Date().toISOString() })
    .eq('id', id);
}
