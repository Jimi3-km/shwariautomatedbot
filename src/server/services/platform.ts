import { serviceClient } from '../supabase.js';

/**
 * Things that belong to the platform rather than to any one business:
 * whether a business is live, and faults that only the platform admin can fix.
 */

export type TenantStatus = 'pending' | 'active' | 'trial' | 'suspended' | 'cancelled';

export interface TenantLiveness {
  /** May the agents answer customers and publish for this business? */
  live: boolean;
  status: TenantStatus | 'unknown';
  agentsPaused: boolean;
}

// Named as the states that are NOT live, so a business whose status cannot be
// read is answered rather than silenced.
const NOT_LIVE = new Set<string>(['pending', 'suspended', 'cancelled']);
const cache = new Map<string, { at: number; value: TenantLiveness }>();
const CACHE_MS = 30_000;

/**
 * Is this business live?
 *
 * A business that is waiting for approval, suspended, or has its agents paused
 * still receives and stores its messages; the agents simply do not answer.
 * If the answer cannot be read, the business is treated as live: a database
 * hiccup must not silence every agent on the platform.
 */
export async function tenantLiveness(tenantId: string): Promise<TenantLiveness> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  let value: TenantLiveness = { live: true, status: 'unknown', agentsPaused: false };
  try {
    const { data, error } = await serviceClient
      .from('tenants').select('status, agents_paused').eq('id', tenantId).maybeSingle();
    if (!error && data) {
      const status = String(data.status) as TenantStatus;
      const agentsPaused = Boolean((data as { agents_paused?: boolean }).agents_paused);
      value = { live: !NOT_LIVE.has(status) && !agentsPaused, status, agentsPaused };
    } else if (error) {
      // agents_paused is missing until migration 0027 is applied.
      const { data: basic } = await serviceClient
        .from('tenants').select('status').eq('id', tenantId).maybeSingle();
      if (basic) {
        const status = String(basic.status) as TenantStatus;
        value = { live: !NOT_LIVE.has(status), status, agentsPaused: false };
      }
    }
  } catch { /* treated as live */ }

  cache.set(tenantId, { at: Date.now(), value });
  return value;
}

export function forgetTenantLiveness(tenantId: string) {
  cache.delete(tenantId);
}

export interface PlatformAlertInput {
  /** A short machine name, e.g. 'meta_config', 'new_business', 'channel_fault'. */
  kind: string;
  tenantId?: string | null;
  /** One line a person can act on. */
  summary: string;
  /** The technical detail. Never a secret. */
  detail?: string | null;
  /** Defaults to kind + business: one open alert per fault per business. */
  dedupeKey?: string;
}

/**
 * Tell the platform admin about something only they can fix.
 *
 * A business user who hits a platform-side fault is told "this is a problem on
 * our side"; this is where the detail goes instead. Repeats of the same fault
 * raise the count on the open alert rather than adding a row.
 */
export async function raisePlatformAlert(input: PlatformAlertInput): Promise<void> {
  const dedupeKey = (input.dedupeKey ?? `${input.kind}:${input.tenantId ?? 'platform'}`).slice(0, 200);
  const summary = input.summary.replace(/\s+/g, ' ').trim().slice(0, 300) || 'Something needs attention';
  const detail = (input.detail ?? '').slice(0, 2000) || null;
  try {
    const { data: open } = await serviceClient
      .from('platform_alerts').select('id, seen_count')
      .eq('dedupe_key', dedupeKey).is('resolved_at', null).maybeSingle();
    if (open) {
      await serviceClient.from('platform_alerts')
        .update({ seen_count: (open.seen_count ?? 1) + 1, last_seen_at: new Date().toISOString(), summary, detail })
        .eq('id', open.id);
      return;
    }
    const { error } = await serviceClient.from('platform_alerts').insert({
      kind: input.kind, tenant_id: input.tenantId ?? null, summary, detail, dedupe_key: dedupeKey,
    });
    if (error && error.code !== '23505') {
      console.warn('[platform] could not record an alert:', error.message);
    }
  } catch (e) {
    console.warn('[platform] alert failed:', e instanceof Error ? e.message : e);
  }
  // Always in the server log too, so a fault is findable even without the table.
  console.warn(`[platform alert] ${input.kind}${input.tenantId ? ` (business ${input.tenantId})` : ''}: ${summary}`);
}

/** What a business user is shown when the fault is ours. */
export const OUR_SIDE_MESSAGE = "This is a problem on our side, not yours. We've been notified and will fix it.";
