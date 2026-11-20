import type { Request } from 'express';
import { publicApiUrl } from './publicUrl.js';

/**
 * The addresses this app is served from.
 *
 * The app answers on more than one domain: its public address and the
 * platform's own. Meta only accepts the callback addresses registered with it,
 * so a sign-in or a channel connection always comes back on one fixed domain -
 * and used to leave the person there, signed out, on a different address from
 * the one they started on. The origin they started from now travels in the
 * signed state and they are sent back to it.
 *
 * Only origins listed here are ever redirected to. An origin taken from a
 * request header is attacker-controlled; without this check the callback
 * would hand a one-time sign-in token to any site that asked.
 */
function normalise(origin: string): string | null {
  try {
    const u = new URL(/^https?:\/\//i.test(origin) ? origin : `https://${origin}`);
    return `${u.protocol}//${u.host}`.toLowerCase();
  } catch {
    return null;
  }
}

export function allowedAppOrigins(): string[] {
  const raw = [
    ...(process.env.CORS_ORIGIN || '').split(','),
    publicApiUrl(),
    process.env.VERCEL_PROJECT_PRODUCTION_URL || '',
    process.env.APP_URL || '',
  ];
  const out = new Set<string>();
  for (const r of raw) {
    const n = r.trim() ? normalise(r.trim()) : null;
    if (n) out.add(n);
  }
  return [...out];
}

/** The origin if it is one of ours, otherwise null. */
export function safeReturnOrigin(candidate: string | null | undefined): string | null {
  if (!candidate) return null;
  const n = normalise(candidate);
  return n && allowedAppOrigins().includes(n) ? n : null;
}

/** Where a request came from: the page that made it, or the host it was sent to. */
export function requestOrigin(req: Request): string | null {
  const origin = req.get('origin');
  if (origin) return origin;
  const referer = req.get('referer');
  if (referer) {
    try { return new URL(referer).origin; } catch { /* fall through */ }
  }
  const host = req.get('x-forwarded-host') || req.get('host');
  if (!host) return null;
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  return `${proto}://${host.split(',')[0].trim()}`;
}
