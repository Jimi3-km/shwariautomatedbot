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
