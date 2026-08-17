/**
 * Rate limiting for the public web chat endpoints.
 *
 * These are the only routes in the application reachable without a session, and
 * the site key that addresses them is visible in the page source of every site
 * that embeds the widget. Without a limit, one script could open unlimited
 * conversations, each of which costs an AI turn.
 *
 * In-process and memory-only, which is the honest scope: it protects a single
 * server from casual abuse. Behind more than one instance the effective limit
 * multiplies by the instance count, so a shared store (Redis) is the upgrade
 * path when this runs multi-instance. It is a cost guard, not a security
 * boundary — the security boundary is the signed visitor token.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Stops the map growing without bound on a long-lived process. */
function sweep(now: number): void {
  if (buckets.size < 10_000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Exposed so tests can start from a known state. */
export function resetRateLimits(): void {
  buckets.clear();
}
