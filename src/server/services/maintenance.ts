import { serviceClient } from '../supabase.js';
import { loadToken, rotateToken } from './meta/tokens.js';
import { refreshLongLivedToken } from './meta/instagram.js';

/**
 * Scheduled upkeep. Each function is safe to call at any frequency.
 */

/** Refresh a token once it is within this many days of expiring. */
const REFRESH_WITHIN_DAYS = 20;

export interface TokenRefreshSummary {
  due: number;
  refreshed: number;
  failed: number;
}

/**
 * Keep Instagram long-lived tokens alive.
 *
 * They last about 60 days and Meta only refreshes one that is still valid and
 * at least a day old. Left alone, every Instagram channel goes quiet two
 * months after it was connected and stays that way until someone reconnects
 * it by hand. A token that has already expired cannot be refreshed and is
 * left for the health check to report.
 */
export async function refreshInstagramTokens(): Promise<TokenRefreshSummary> {
  const summary: TokenRefreshSummary = { due: 0, refreshed: 0, failed: 0 };
  const now = Date.now();
  const horizon = new Date(now + REFRESH_WITHIN_DAYS * 86_400_000).toISOString();

  const { data, error } = await serviceClient
    .from('meta_tokens')
    .select('tenant_id, token_expires_at')
    .eq('platform', 'instagram')
    .gt('token_expires_at', new Date(now).toISOString())
    .lt('token_expires_at', horizon)
    .limit(200);

  if (error || !Array.isArray(data)) {
    console.error('[maintenance] could not list Instagram tokens:', error?.message);
    return summary;
  }

  for (const row of data) {
    summary.due++;
    try {
      const token = await loadToken(row.tenant_id, 'instagram');
      if (!token || token.isExpired) {
        summary.failed++;
        continue;
      }
      const refreshed = await refreshLongLivedToken(token.accessToken);
      await rotateToken(row.tenant_id, 'instagram', refreshed.accessToken, refreshed.expiresAt);
      summary.refreshed++;
    } catch (e) {
      summary.failed++;
      console.warn(
        `[maintenance] Instagram token refresh failed for tenant ${row.tenant_id}:`,
        e instanceof Error ? e.message : e
      );
    }
  }

  return summary;
}

/** Drop idempotency records past their useful life (7 days). */
export async function pruneWebhookEvents(): Promise<{ pruned: boolean }> {
  const { error } = await serviceClient.rpc('prune_webhook_events');
  if (error) {
    console.warn('[maintenance] prune_webhook_events failed:', error.message);
    return { pruned: false };
  }
  return { pruned: true };
}
