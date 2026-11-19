import { serviceClient } from '../supabase.js';

/**
 * Helpers every outbound provider shares: splitting long text, retrying a
 * transient failure once, and knowing whether Meta's 24-hour customer-service
 * window is still open.
 */

/** Hard per-message limits imposed by each platform. */
export const TEXT_LIMITS = {
  telegram: 4096,
  whatsapp: 4096,
  instagram: 1000,
} as const;

/**
 * Split text into pieces no longer than `max`, preferring to break at a
 * paragraph, then a line, then a sentence, then a space. A single unbroken run
 * longer than `max` is cut hard as a last resort.
 */
export function chunkText(text: string, max: number): string[] {
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= max) return [clean];

  const chunks: string[] = [];
  let rest = clean;

  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = -1;
    for (const sep of ['\n\n', '\n', '. ', '! ', '? ', ' ']) {
      const at = window.lastIndexOf(sep);
      // Refuse a break so early that the chunk would be mostly empty.
      if (at > max * 0.4) {
        cut = at + (sep.trim() ? sep.trimEnd().length : 0);
        break;
      }
    }
    if (cut <= 0) cut = max;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks.filter(Boolean);
}

/** An error a provider client raises with enough detail to decide on a retry. */
export interface TransientHint {
  httpStatus?: number;
  transient?: boolean;
}

export function isTransient(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const hint = e as TransientHint & { name?: string; cause?: unknown };
  if (hint.transient === true) return true;
  if (hint.transient === false) return false;
  if (typeof hint.httpStatus === 'number') {
    return hint.httpStatus === 429 || hint.httpStatus >= 500;
  }
  // fetch() rejects with a TypeError on DNS/connection failures, and with an
  // AbortError/TimeoutError when a timeout signal fires.
  return hint.name === 'TypeError' || hint.name === 'AbortError' || hint.name === 'TimeoutError';
}

/** Run `fn`; on a transient failure wait briefly and try exactly once more. */
export async function withRetry<T>(fn: () => Promise<T>, delayMs = 800): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!isTransient(e)) throw e;
    await new Promise((r) => setTimeout(r, delayMs));
    return fn();
  }
}

export const CUSTOMER_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * When did this customer last write to us on this channel?
 *
 * Returns undefined when the answer could not be determined (a read failed),
 * which callers treat as "let the platform decide" rather than as a closed
 * window — refusing to send on our own database hiccup would be worse than a
 * rejected API call. Returns null when we positively have no message from them.
 */
export async function lastInboundAt(
  tenantId: string,
  channelType: string,
  customerId: string
): Promise<Date | null | undefined> {
  const { data: convo, error: convoErr } = await serviceClient
    .from('conversations')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('channel_type', channelType)
    .eq('customer_id', customerId)
    .maybeSingle();

  if (convoErr) return undefined;
  if (!convo) return null;

  const { data: rows, error } = await serviceClient
    .from('conversation_messages')
    .select('created_at')
    .eq('tenant_id', tenantId)
    .eq('conversation_id', convo.id)
    .eq('sender', 'customer')
    .order('created_at', { ascending: false })
    .limit(1);

  if (error || !Array.isArray(rows)) return undefined;
  const at = rows[0]?.created_at;
  if (!at) return null;
  const parsed = new Date(at);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** undefined (unknown) counts as open; see lastInboundAt. */
export function windowIsOpen(last: Date | null | undefined, now = Date.now()): boolean {
  if (last === undefined) return true;
  if (last === null) return false;
  return now - last.getTime() < CUSTOMER_WINDOW_MS;
}
