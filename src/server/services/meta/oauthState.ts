import crypto from 'node:crypto';
import { metaConfig } from '../../config/meta.js';

/**
 * OAuth state for connecting a channel to an already-authenticated tenant.
 *
 * The callback arrives as a plain browser redirect with no Authorization
 * header, so the tenant has to travel with the request. Putting it in the
 * state and signing it means the callback cannot be pointed at someone else's
 * tenant: a forged or edited state fails the HMAC and is rejected before any
 * token exchange happens.
 *
 * Distinct from the sign-in state in services/meta/instagram.ts, which carries
 * no tenant because no session exists yet at that point.
 */

const MAX_AGE_MS = 10 * 60 * 1000; // short-lived by design
const SEPARATOR = '~';

export interface OAuthStatePayload {
  provider: string;
  tenantId: string;
  userId: string;
}

function secret(): string {
  // Falls back to the app secret so state signing works for any Meta provider;
  // if neither is set the provider is unavailable anyway and never mints state.
  return metaConfig.appSecret || metaConfig.instagram.clientSecret || 'unconfigured';
}

function sign(body: string): string {
  return crypto.createHmac('sha256', secret()).update(body).digest('base64url');
}

export function createOAuthState(payload: OAuthStatePayload): string {
  const body = [
    payload.provider,
    payload.tenantId,
    payload.userId,
    crypto.randomBytes(12).toString('base64url'),
    Date.now().toString(36),
  ].join(SEPARATOR);

  return `${Buffer.from(body).toString('base64url')}.${sign(body)}`;
}

/** Returns the payload only when the signature is valid and still fresh. */
export function verifyOAuthState(state: string, maxAgeMs = MAX_AGE_MS): OAuthStatePayload | null {
  const dot = state?.lastIndexOf('.') ?? -1;
  if (dot <= 0) return null;

  const encoded = state.slice(0, dot);
  const mac = state.slice(dot + 1);

  let body: string;
  try {
    body = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return null;
  }

  const expected = sign(body);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const [provider, tenantId, userId, , issued] = body.split(SEPARATOR);
  if (!provider || !tenantId || !userId || !issued) return null;

  const issuedAt = parseInt(issued, 36);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > maxAgeMs) return null;

  return { provider, tenantId, userId };
}
