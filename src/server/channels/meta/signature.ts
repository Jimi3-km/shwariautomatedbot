import crypto from 'node:crypto';
import { metaConfig } from '../../config/meta.js';

/**
 * Meta signs every webhook delivery with the app secret.
 *
 * This must run against the exact bytes Meta sent. Verifying a re-serialised
 * JSON.stringify of the parsed body fails on any key-order or whitespace
 * difference, so the raw buffer is captured by the body parser and used here.
 */

/** 'ok' means verified; every other value is a rejection reason. */
export type SignatureResult = 'ok' | 'not_configured' | 'missing' | 'malformed' | 'mismatch';

export function verifyMetaSignature(rawBody: Buffer | undefined, header: unknown): SignatureResult {
  if (!metaConfig.appSecret) return 'not_configured';
  if (!rawBody || rawBody.length === 0) return 'missing';
  if (typeof header !== 'string' || !header) return 'missing';

  // Meta sends "sha256=<hex>". Anything else is not a signature we can check —
  // in particular sha1, which is the older, weaker scheme.
  if (!header.startsWith('sha256=')) return 'malformed';
  const provided = header.slice('sha256='.length);
  if (!/^[0-9a-f]{64}$/i.test(provided)) return 'malformed';

  const expected = crypto
    .createHmac('sha256', metaConfig.appSecret)
    .update(rawBody)
    .digest('hex');

  // Equal lengths are guaranteed by the regex above, so timingSafeEqual cannot
  // throw and the comparison stays constant-time.
  const a = Buffer.from(provided.toLowerCase(), 'hex');
  const b = Buffer.from(expected, 'hex');
  return crypto.timingSafeEqual(a, b) ? 'ok' : 'mismatch';
}

/**
 * The subscription handshake. Meta calls with hub.mode=subscribe and echoes
 * hub.challenge back only if our verify token matches theirs.
 */
export function verifyChallenge(query: Record<string, unknown>): string | null {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];

  if (mode !== 'subscribe') return null;
  if (!metaConfig.verifyToken) return null;
  if (typeof token !== 'string' || typeof challenge !== 'string') return null;

  const a = Buffer.from(token);
  const b = Buffer.from(metaConfig.verifyToken);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  return challenge;
}
