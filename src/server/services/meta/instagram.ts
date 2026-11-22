import crypto from 'node:crypto';
import {
  INSTAGRAM_AUTHORIZE_URL,
  INSTAGRAM_GRAPH_URL,
  INSTAGRAM_OAUTH_URL,
  metaConfig,
} from '../../config/meta.js';

/**
 * Instagram OAuth (Instagram Login for Business).
 *
 * Note on what Meta actually permits: an Instagram account must be a
 * Professional (Business/Creator) account for the messaging scopes to be
 * granted, and the app needs App Review for those scopes before non-test
 * users can complete this flow. The code below is the real protocol; it will
 * return Meta's own error verbatim until the app is reviewed.
 */

/** The scope that lets the app publish posts. Needs App Review for non-test users. */
export const INSTAGRAM_PUBLISH_SCOPE = 'instagram_business_content_publish';

/**
 * Scopes for reading the profile, handling DMs and publishing posts.
 *
 * An account connected before the publish scope was added has to be
 * reconnected once to grant it: a token never gains a scope after the fact.
 */
const SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
  INSTAGRAM_PUBLISH_SCOPE,
] as const;

export interface InstagramProfile {
  /** App-scoped id. Stable identity for sign-in. */
  id: string;
  /**
   * The professional account id (`user_id`). This, not `id`, is what Meta
   * puts in a webhook's entry.id and what the messages endpoint is addressed
   * by, so it is what a channel must be keyed on.
   */
  professionalAccountId?: string;
  username: string;
  accountType?: string;
  profilePictureUrl?: string;
}

export interface InstagramToken {
  accessToken: string;
  userId: string;
  expiresAt: Date | null;
  /** What the person actually granted, when Meta says. Null when it did not. */
  permissions?: string[] | null;
}

export class InstagramOAuthError extends Error {
  readonly status: number;
  readonly metaCode?: string;
  /** The HTTP status Meta actually answered with (status is our own mapping). */
  httpStatus?: number;
  metaSubcode?: string;
  constructor(message: string, status = 502, metaCode?: string) {
    super(message);
    this.name = 'InstagramOAuthError';
    this.status = status;
    this.metaCode = metaCode;
  }
}

/**
 * Signed, single-use CSRF state. HMAC over a nonce + issue time keeps the
 * callback from being forged and bounds how long a state stays valid, without
 * needing server-side session storage.
 */
export function createState(returnTo?: string | null): string {
  // The origin rides inside the signed nonce, after a separator that never
  // appears in base64url, so the state keeps its three dot-separated parts.
  const random = crypto.randomBytes(16).toString('base64url');
  const nonce = returnTo ? `${random}~${Buffer.from(returnTo).toString('base64url')}` : random;
  const issued = Date.now().toString(36);
  const payload = `${nonce}.${issued}`;
  const mac = crypto
    .createHmac('sha256', metaConfig.instagram.clientSecret || 'unconfigured')
    .update(payload)
    .digest('base64url');
  return `${payload}.${mac}`;
}

export function verifyState(state: string, maxAgeMs = 10 * 60 * 1000): boolean {
  // With no secret there is nothing to verify against; a known fallback key
  // would let anyone mint a state that passes.
  if (!metaConfig.instagram.clientSecret) return false;
  const parts = state?.split('.') ?? [];
  if (parts.length !== 3) return false;
  const [nonce, issued, mac] = parts;

  const expected = crypto
    .createHmac('sha256', metaConfig.instagram.clientSecret || 'unconfigured')
    .update(`${nonce}.${issued}`)
    .digest('base64url');

  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

  const issuedAt = parseInt(issued, 36);
  return Number.isFinite(issuedAt) && Date.now() - issuedAt <= maxAgeMs;
}

/**
 * `redirectUri` defaults to the sign-in callback. Connecting a channel to an
 * existing workspace uses a different callback, and Meta requires the same URI
 * on both the authorize and the exchange leg, so it is threaded through both.
 */
export function buildAuthorizeUrl(state: string, redirectUri?: string): string {
  const params = new URLSearchParams({
    client_id: metaConfig.instagram.clientId,
    redirect_uri: redirectUri || metaConfig.instagram.redirectUri,
    response_type: 'code',
    scope: SCOPES.join(','),
    state,
    // Always ask which account. A phone's browser is usually already signed in
    // to someone's personal Instagram; without this the wrong account is used
    // without a word, and the connection then fails as "not a business
    // account" or connects the wrong page.
    force_reauth: 'true',
  });
  // The consent window lives on www.instagram.com, not the API host.
  return `${INSTAGRAM_AUTHORIZE_URL}/oauth/authorize?${params}`;
}

async function readMetaError(res: Response, fallback: string): Promise<never> {
  let detail = fallback;
  let code: string | undefined;
  let subcode: string | undefined;
  try {
    const body = (await res.json()) as {
      error_message?: string;
      error?: { message?: string; code?: number; error_subcode?: number };
    };
    detail = body.error_message ?? body.error?.message ?? fallback;
    code = body.error?.code != null ? String(body.error.code) : undefined;
    subcode = body.error?.error_subcode != null ? String(body.error.error_subcode) : undefined;
  } catch {
    /* non-JSON error body */
  }
  // The subcode is what tells one "Unsupported request" from another.
  if (subcode) detail = `${detail} (subcode ${subcode})`;
  const err = new InstagramOAuthError(detail, res.status === 400 ? 400 : 502, code);
  err.httpStatus = res.status;
  err.metaSubcode = subcode;
  throw err;
}

/** Step 1: short-lived token (valid ~1 hour). */
export async function exchangeCodeForToken(
  code: string,
  redirectUri?: string
): Promise<InstagramToken> {
  const body = new URLSearchParams({
    client_id: metaConfig.instagram.clientId,
    client_secret: metaConfig.instagram.clientSecret,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri || metaConfig.instagram.redirectUri,
    code,
  });

  const res = await fetch(`${INSTAGRAM_OAUTH_URL}/oauth/access_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) await readMetaError(res, 'Instagram rejected the authorization code');

  /**
   * Instagram Login for Business returns the grant inside a `data` array —
   * { data: [{ access_token, user_id, permissions }] } — not at the top level.
   * The flat shape is the older Basic Display response, so both are accepted:
   * reading only the flat one silently yields an undefined token.
   */
  const json = (await res.json()) as {
    data?: Array<{ access_token?: string; user_id?: number | string; permissions?: string | string[] }>;
    access_token?: string;
    user_id?: number | string;
    permissions?: string | string[];
  };

  const grant = json.data?.[0] ?? json;
  if (!grant?.access_token) {
    throw new InstagramOAuthError('Instagram did not return an access token');
  }
  return {
    accessToken: grant.access_token,
    userId: String(grant.user_id ?? ''),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    permissions: readPermissions(grant.permissions),
  };
}

/** Meta sends the granted permissions as a list or as one comma-separated string. */
function readPermissions(raw: unknown): string[] | null {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : null;
  if (!list) return null;
  const clean = list.map((p) => String(p).trim()).filter(Boolean);
  return clean.length ? clean : null;
}

/** Step 2: upgrade to a ~60-day long-lived token. */
export async function exchangeForLongLivedToken(
  shortLivedToken: string
): Promise<{ accessToken: string; expiresAt: Date }> {
  const params = new URLSearchParams({
    grant_type: 'ig_exchange_token',
    client_secret: metaConfig.instagram.clientSecret,
    access_token: shortLivedToken,
  });

  const res = await fetch(`${INSTAGRAM_GRAPH_URL}/access_token?${params}`);
  if (!res.ok) await readMetaError(res, 'Could not upgrade the Instagram token');

  const json = (await res.json()) as { access_token: string; expires_in: number };
  return {
    accessToken: json.access_token,
    expiresAt: new Date(Date.now() + (json.expires_in ?? 5_184_000) * 1000),
  };
}

/**
 * Refresh a long-lived token. Meta requires the token to be at least 24 hours
 * old and unexpired; refreshing outside that window returns an error rather
 * than a new token, so callers should treat failure as "re-authorize".
 */
export async function refreshLongLivedToken(
  token: string
): Promise<{ accessToken: string; expiresAt: Date }> {
  const params = new URLSearchParams({
    grant_type: 'ig_refresh_token',
    access_token: token,
  });
  const res = await fetch(`${INSTAGRAM_GRAPH_URL}/refresh_access_token?${params}`);
  if (!res.ok) await readMetaError(res, 'Could not refresh the Instagram token');

  const json = (await res.json()) as { access_token: string; expires_in: number };
  return {
    accessToken: json.access_token,
    expiresAt: new Date(Date.now() + (json.expires_in ?? 5_184_000) * 1000),
  };
}

export async function fetchProfile(accessToken: string): Promise<InstagramProfile> {
  const params = new URLSearchParams({
    fields: 'id,user_id,username,account_type,profile_picture_url',
    access_token: accessToken,
  });
  const res = await fetch(`${INSTAGRAM_GRAPH_URL}/me?${params}`);
  if (!res.ok) await readMetaError(res, 'Could not read the Instagram profile');

  const json = (await res.json()) as {
    id: string;
    user_id?: string | number;
    username: string;
    account_type?: string;
    profile_picture_url?: string;
  };
  return {
    id: json.id,
    professionalAccountId: json.user_id != null ? String(json.user_id) : undefined,
    username: json.username,
    accountType: json.account_type,
    profilePictureUrl: json.profile_picture_url,
  };
}

/** Outbound Instagram DM. Used once a tenant has connected their account. */
export async function sendInstagramMessage(
  accessToken: string,
  igUserId: string,
  recipientId: string,
  text: string
): Promise<void> {
  const res = await fetch(`${INSTAGRAM_GRAPH_URL}/${igUserId}/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) await readMetaError(res, 'Instagram rejected the outbound message');
}

/**
 * Subscribe the connected professional account to this app's webhooks.
 *
 * With Instagram Login, authorizing the app is not enough: until the account
 * is subscribed to the `messages` field, Meta delivers no DMs to the webhook
 * and the channel looks connected while staying silent.
 */
export async function subscribeToMessages(accessToken: string): Promise<void> {
  const params = new URLSearchParams({
    subscribed_fields: 'messages',
    access_token: accessToken,
  });
  const res = await fetch(`${INSTAGRAM_GRAPH_URL}/me/subscribed_apps?${params}`, {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) await readMetaError(res, 'Could not subscribe the Instagram account to messages');
}

/** The origin carried in a sign-in state. Only meaningful after verifyState passes. */
export function stateReturnOrigin(state: string): string | null {
  const nonce = (state ?? '').split('.')[0] ?? '';
  const at = nonce.indexOf('~');
  if (at < 0) return null;
  try {
    return Buffer.from(nonce.slice(at + 1), 'base64url').toString('utf8') || null;
  } catch {
    return null;
  }
}
