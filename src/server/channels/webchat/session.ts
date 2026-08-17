import crypto from 'node:crypto';

/**
 * Visitor sessions for the web chat widget.
 *
 * The site key embedded in a customer's page is public by necessity — anyone
 * viewing the page can read it. So the site key alone must not be enough to
 * read a conversation. A visitor is issued a signed token on first contact,
 * and every later request must present it; without one you can start a new
 * conversation but never read someone else's.
 *
 * The signing key is the channel's own secret_token, which already exists, is
 * unique per channel and never leaves the server. That deliberately avoids
 * adding another environment variable, and means revoking a channel's secret
 * invalidates its visitor tokens too.
 */

const SEPARATOR = '~';
/** Long enough for a real support conversation, short enough to bound replay. */
const DEFAULT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export interface VisitorSession {
  visitorId: string;
  channelId: string;
}

function sign(body: string, channelSecret: string): string {
  return crypto.createHmac('sha256', channelSecret).update(body).digest('base64url');
}

/** A fresh, unguessable visitor identity. */
export function newVisitorId(): string {
  return `web_${crypto.randomBytes(12).toString('hex')}`;
}

export function issueVisitorToken(
  session: VisitorSession,
  channelSecret: string
): string {
  const body = [session.visitorId, session.channelId, Date.now().toString(36)].join(SEPARATOR);
  return `${Buffer.from(body).toString('base64url')}.${sign(body, channelSecret)}`;
}

/**
 * Returns the session only when the signature is valid, the token is fresh,
 * and it was issued for this exact channel. The channel check is what stops a
 * token from one business being replayed against another.
 */
export function verifyVisitorToken(
  token: string,
  channelId: string,
  channelSecret: string,
  maxAgeMs = DEFAULT_MAX_AGE_MS
): VisitorSession | null {
  if (!token || !channelSecret) return null;

  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;

  const encoded = token.slice(0, dot);
  const mac = token.slice(dot + 1);

  let body: string;
  try {
    body = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return null;
  }

  const expected = sign(body, channelSecret);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const [visitorId, tokenChannelId, issued] = body.split(SEPARATOR);
  if (!visitorId || !tokenChannelId || !issued) return null;
  if (tokenChannelId !== channelId) return null;

  const issuedAt = parseInt(issued, 36);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > maxAgeMs) return null;

  return { visitorId, channelId: tokenChannelId };
}

/**
 * Public site key. Goes in the customer's HTML, so it identifies a channel but
 * authorises nothing on its own.
 */
export function newSiteKey(): string {
  return `wc_${crypto.randomBytes(16).toString('base64url')}`;
}
