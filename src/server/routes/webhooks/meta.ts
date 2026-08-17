import { Router } from 'express';
import type { Request, Response } from 'express';
import { verifyMetaSignature, verifyChallenge } from '../../channels/meta/signature.js';
import { parseMetaWebhook } from '../../channels/meta/parsers.js';
import {
  resolveChannel, claimEvent, persistInbound, forwardToPipeline, normalize,
} from '../../services/inbound.js';

export const metaWebhookRouter = Router();

/**
 * Meta's inbound webhook, for WhatsApp and Instagram.
 *
 * Deliberately unauthenticated in the dashboard sense: Meta has no session and
 * no bearer token. Its credential is the HMAC signature over the raw body,
 * which is checked before the payload is parsed or looked at.
 *
 * Everything here answers 200 to Meta once the signature passes, including
 * events we ignore. A non-200 makes Meta retry the same delivery for hours and
 * eventually disable the subscription, so a message we cannot place is logged
 * and acked rather than rejected.
 */

// ---------------------------------------------------------------------------
// GET — subscription handshake
// ---------------------------------------------------------------------------
metaWebhookRouter.get('/webhooks/meta', (req: Request, res: Response) => {
  const challenge = verifyChallenge(req.query as Record<string, unknown>);
  if (challenge === null) {
    console.warn('[webhooks/meta] verification challenge rejected');
    return res.sendStatus(403);
  }
  console.log('[webhooks/meta] verification challenge accepted');
  // Meta requires the raw challenge as the body, not JSON.
  res.status(200).type('text/plain').send(challenge);
});

// ---------------------------------------------------------------------------
// POST — inbound events
// ---------------------------------------------------------------------------
metaWebhookRouter.post('/webhooks/meta', (req: Request, res: Response) => {
  /**
   * express.raw() leaves the exact bytes on req.body. Falling back to rawBody
   * keeps this working if the route is ever mounted behind the JSON parser
   * instead.
   */
  const raw: Buffer | undefined = Buffer.isBuffer(req.body) ? req.body : req.rawBody;
  const signature = verifyMetaSignature(raw, req.headers['x-hub-signature-256']);

  if (signature !== 'ok') {
    if (signature === 'not_configured') {
      console.error('[webhooks/meta] rejected: the app secret is not configured on this server');
      return res.sendStatus(503);
    }
    console.warn(`[webhooks/meta] rejected: signature ${signature}`);
    return res.sendStatus(401);
  }

  // Only now is the payload worth interpreting: parsing before the signature
  // check would mean acting on bytes anyone could have sent.
  let payload: unknown;
  try {
    payload = Buffer.isBuffer(req.body) ? JSON.parse(raw!.toString('utf8')) : req.body;
  } catch {
    // A verified but unparseable body is Meta's problem, not a retry candidate.
    console.warn('[webhooks/meta] verified delivery was not valid JSON; ignoring');
    return res.sendStatus(200);
  }

  // Ack immediately, then do the work. Meta's timeout is short, and a slow
  // AI turn must not turn into a retried delivery.
  res.sendStatus(200);

  void handleEvents(payload).catch((e) => {
    console.error('[webhooks/meta] processing failed:', e instanceof Error ? e.message : e);
  });
});

async function handleEvents(body: unknown): Promise<void> {
  const { provider, events } = parseMetaWebhook(body);

  if (!provider) {
    console.log('[webhooks/meta] ignoring a delivery for an unrecognised product');
    return;
  }
  if (!events.length) {
    // Status receipts and read notifications land here. Normal, not an error.
    return;
  }

  for (const parsed of events) {
    const channel = await resolveChannel(provider, parsed.accountId);

    if (!channel) {
      // Someone else's account, or one disconnected since the event was sent.
      console.warn(`[webhooks/meta] no ${provider} channel is connected for that account; ignoring`);
      continue;
    }
    if (channel.status !== 'active') {
      console.log(`[webhooks/meta] channel ${channel.id} is disabled; ignoring the message`);
      continue;
    }

    for (const event of normalize(parsed, channel)) {
      const claimed = await claimEvent(provider, event.messageId, event.tenantId, event.channelId);
      if (!claimed) {
        console.log(`[webhooks/meta] duplicate delivery of ${provider} message; already handled`);
        continue;
      }

      const stored = await persistInbound(event);
      if (!stored) continue;

      // The Inbox now has the message either way. The AI only gets a turn when
      // staff have not taken the conversation over.
      if (!stored.aiEnabled) {
        console.log(`[webhooks/meta] conversation ${stored.conversationId} is staff-handled; no AI reply`);
        continue;
      }

      await forwardToPipeline(event, channel.secretToken);
    }
  }
}
