import { Router } from 'express';
import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import { serviceClient } from '../supabase.js';
import { handler } from '../auth.js';
import { metaConfig } from '../config/meta.js';
import { publicApiUrl } from '../config/publicUrl.js';
import { raisePlatformAlert } from '../services/platform.js';
import { rateLimit } from '../channels/webchat/rateLimit.js';

/**
 * What Meta requires of any app that people sign in to with Instagram or
 * Facebook, and what a person needs in order to ask for their data back.
 *
 *   POST /webhooks/meta/deauthorize     Meta: "this person removed your app"
 *   POST /webhooks/meta/data-deletion   Meta: "this person asked you to delete their data"
 *   GET  /data-deletion/status          the page a deletion code leads to
 *   POST /data-deletion/request         a person asking from the website
 *
 * Meta's two calls carry a `signed_request`: a payload signed with the app
 * secret. Nothing in it is trusted until the signature has been checked, and
 * a request that does not verify is refused without saying why.
 *
 * What "delete" does here: the connection that person authorised is switched
 * off and its stored credential is destroyed, so the app can no longer act
 * for the account or receive its messages. Conversations a business has
 * already had with its own customers are that business's records; removing
 * those is the business's request to make, and is recorded for a person to
 * carry out rather than done silently on a signal from a third party.
 */

export const dataDeletionRouter = Router();

/** Meta's public router is mounted where the body arrives as raw bytes. */
export const metaRemovalRouter = Router();

const b64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/**
 * Check and read a signed_request. Tried against the Meta app secret and the
 * Instagram app secret, because Instagram sign-in signs with its own.
 * Returns the payload, or null when it does not verify.
 */
export function readSignedRequest(signed: unknown, secrets: string[] = [metaConfig.appSecret, metaConfig.instagram.clientSecret]): Record<string, unknown> | null {
  if (typeof signed !== 'string' || signed.length > 8000) return null;
  const dot = signed.indexOf('.');
  if (dot <= 0) return null;
  const sigPart = signed.slice(0, dot);
  const payloadPart = signed.slice(dot + 1);

  let given: Buffer;
  try { given = b64url(sigPart); } catch { return null; }

  for (const secret of secrets) {
    if (!secret) continue;
    const expected = crypto.createHmac('sha256', secret).update(payloadPart).digest();
    if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) {
      try {
        const payload = JSON.parse(b64url(payloadPart).toString('utf8')) as Record<string, unknown>;
        const algorithm = String(payload.algorithm ?? '').toUpperCase();
        if (algorithm && algorithm !== 'HMAC-SHA256') return null;
        return payload;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** The signed_request out of a body that may be raw bytes, a form or JSON. */
function signedRequestOf(req: Request): string | null {
  const body: unknown = req.body;
  if (Buffer.isBuffer(body)) {
    const text = body.toString('utf8');
    const fromForm = new URLSearchParams(text).get('signed_request');
    if (fromForm) return fromForm;
    try { return String((JSON.parse(text) as { signed_request?: unknown }).signed_request ?? '') || null; } catch { return null; }
  }
  if (body && typeof body === 'object') {
    const v = (body as { signed_request?: unknown }).signed_request;
    return typeof v === 'string' ? v : null;
  }
  return null;
}

const newCode = () => crypto.randomBytes(9).toString('base64url');

/**
 * Switch off every connection held for a Meta account id and destroy its
 * credential. Returns what was found, in words.
 */
async function removeConnectionsFor(metaUserId: string): Promise<{ removed: number; tenantId: string | null; outcome: string }> {
  // The id Meta sends is the one the account was authorised under. It is
  // looked for wherever an account id is kept.
  const [{ data: tokens }, { data: channels }] = await Promise.all([
    serviceClient.from('meta_tokens').select('id, tenant_id, platform').eq('instagram_user_id', metaUserId),
    serviceClient.from('channels').select('id, tenant_id, channel_type, status')
      .in('channel_type', ['instagram', 'facebook', 'whatsapp']).eq('channel_account_id', metaUserId),
  ]);

  let removed = 0;
  let tenantId: string | null = null;
  for (const t of tokens ?? []) {
    tenantId = tenantId ?? t.tenant_id;
    const { error } = await serviceClient.from('meta_tokens').delete().eq('id', t.id);
    if (!error) removed++;
    // The channel that token served stops working with it.
    await serviceClient.from('channels').update({ status: 'disabled', credentials_ref: null })
      .eq('tenant_id', t.tenant_id).eq('channel_type', t.platform).eq('status', 'active');
  }
  for (const c of channels ?? []) {
    tenantId = tenantId ?? c.tenant_id;
    if (c.status === 'active') {
      await serviceClient.from('channels').update({ status: 'disabled', credentials_ref: null }).eq('id', c.id);
      await serviceClient.from('meta_tokens').delete().eq('tenant_id', c.tenant_id).eq('platform', c.channel_type);
      removed++;
    }
  }
  return {
    removed, tenantId,
    outcome: removed
      ? 'The connection to this account was switched off and its stored credential was deleted.'
      : 'No connection or credential was held for this account.',
  };
}

async function recordAndAct(source: 'meta_callback' | 'meta_deauthorize', payload: Record<string, unknown>) {
  const metaUserId = String(payload.user_id ?? '').slice(0, 64);
  const code = newCode();
  let status: 'completed' | 'no_data' | 'needs_review' = 'no_data';
  let outcome = 'No account id was sent.';
  let tenantId: string | null = null;

  if (metaUserId) {
    try {
      const r = await removeConnectionsFor(metaUserId);
      tenantId = r.tenantId;
      outcome = r.outcome;
      // The id Meta sends for a removal is not always the id an account is
      // stored under. When nothing matched, a person checks rather than the
      // request being closed as "nothing to delete".
      status = r.removed ? 'completed' : 'needs_review';
    } catch (e) {
      status = 'needs_review';
      outcome = 'The removal could not be completed automatically.';
      console.error('[data-deletion] removal failed:', e instanceof Error ? e.message : e);
    }
  }

  await serviceClient.from('data_deletion_requests').insert({
    code, source, platform: 'meta', meta_user_id: metaUserId || null, tenant_id: tenantId,
    status, outcome, completed_at: status === 'completed' ? new Date().toISOString() : null,
  });

  if (status === 'needs_review') {
    void raisePlatformAlert({
      kind: 'data_deletion', tenantId,
      dedupeKey: `data_deletion:${code}`,
      summary: source === 'meta_callback'
        ? 'Meta passed on a request to delete data that could not be matched to a connected account.'
        : 'Someone removed the app at Meta and no connected account matched.',
      detail: `Request code ${code}. Check whether any connection belongs to this person and remove it.`,
    });
  }
  return { code, status };
}

/** Meta: someone removed the app. Switch their connection off. */
metaRemovalRouter.post(
  '/webhooks/meta/deauthorize',
  handler(async (req: Request, res: Response) => {
    const payload = readSignedRequest(signedRequestOf(req));
    if (!payload) return res.status(400).json({ error: 'Invalid request' });
    await recordAndAct('meta_deauthorize', payload);
    res.status(200).json({ ok: true });
  })
);

/**
 * Meta: someone asked for their data to be deleted. Meta expects back the
 * address of a page where the request can be followed, and a code for it.
 */
metaRemovalRouter.post(
  '/webhooks/meta/data-deletion',
  handler(async (req: Request, res: Response) => {
    const payload = readSignedRequest(signedRequestOf(req));
    if (!payload) return res.status(400).json({ error: 'Invalid request' });
    const { code } = await recordAndAct('meta_callback', payload);
    res.status(200).json({
      url: `${publicApiUrl()}/data-deletion?code=${encodeURIComponent(code)}`,
      confirmation_code: code,
    });
  })
);

/** What happened to a request, by its code. Says nothing about who asked. */
dataDeletionRouter.get(
  '/data-deletion/status',
  handler(async (req, res) => {
    const limit = rateLimit(`ddr:status:${req.ip}`, 30, 60_000);
    if (!limit.allowed) return res.status(429).json({ error: 'Too many attempts. Try again in a minute.' });
    const code = String(req.query.code ?? '');
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(code)) return res.status(404).json({ error: 'No request with that code.' });
    const { data } = await serviceClient.from('data_deletion_requests')
      .select('status, outcome, created_at, completed_at').eq('code', code).maybeSingle();
    if (!data) return res.status(404).json({ error: 'No request with that code.' });
    res.json(data);
  })
);

/** A person asking, from the website, for their data to be deleted. */
dataDeletionRouter.post(
  '/data-deletion/request',
  handler(async (req, res) => {
    const limit = rateLimit(`ddr:request:${req.ip}`, 5, 60 * 60_000);
    if (!limit.allowed) return res.status(429).json({ error: 'Too many requests from here. Try again later.' });

    const email = String(req.body?.email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) {
      return res.status(400).json({ error: 'Enter an email address we can reply to.' });
    }
    const details = String(req.body?.details ?? '').replace(/\s+/g, ' ').trim().slice(0, 1000) || null;
    const code = newCode();

    const { error } = await serviceClient.from('data_deletion_requests').insert({
      code, source: 'website', contact_email: email, details, status: 'needs_review',
      outcome: 'Received. A person will confirm who is asking, then delete the data and reply.',
    });
    if (error) {
      console.error('[data-deletion] could not record a request:', error.message);
      return res.status(500).json({ error: 'Your request could not be recorded. Please try again.' });
    }
    void raisePlatformAlert({
      kind: 'data_deletion', dedupeKey: `data_deletion:${code}`,
      summary: 'Someone asked on the website for their data to be deleted.',
      detail: `Request code ${code}. Confirm who is asking, delete what is held, and reply to them.`,
    });
    res.status(201).json({ code });
  })
);
