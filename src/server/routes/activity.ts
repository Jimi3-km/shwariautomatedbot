import { Router } from 'express';
import { requireAuth, handler } from '../auth.js';
import { serviceClient } from '../supabase.js';

/**
 * What is new on each page, for the numbered dots in the menu.
 *
 * Two kinds of number:
 *   - things waiting on a person (unread chats, payments to verify, posts to
 *     approve): the dot stays until they are dealt with;
 *   - things that have arrived since this person last opened the page (orders,
 *     leads, bookings, tickets): the browser sends when it last looked, and
 *     the dot clears when the page is opened.
 *
 * Reads go through the caller's own database session, so a count never
 * includes anything they could not open.
 */
export const activityRouter = Router();

const SINCE_PAGES = {
  orders: { table: 'orders', column: 'created_at' },
  leads: { table: 'leads', column: 'created_at' },
  appointments: { table: 'appointments', column: 'created_at' },
  support: { table: 'support_tickets', column: 'created_at' },
} as const;

type SincePage = keyof typeof SINCE_PAGES;

function validSince(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 40) return null;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return null;
  // Never look back further than a month: a dot is about what is new.
  return new Date(Math.max(t, Date.now() - 30 * 86_400_000)).toISOString();
}

activityRouter.get(
  '/activity',
  requireAuth,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const count = async (build: () => PromiseLike<{ count: number | null; error: unknown }>): Promise<number> => {
      try {
        const { count: n, error } = await build();
        return error ? 0 : n ?? 0;
      } catch {
        return 0;
      }
    };

    const since = Object.fromEntries(
      (Object.keys(SINCE_PAGES) as SincePage[]).map((p) => [p, validSince(req.query[p])])
    ) as Record<SincePage, string | null>;

    const sinceCount = (page: SincePage) => {
      const at = since[page];
      if (!at) return Promise.resolve(0);
      const { table, column } = SINCE_PAGES[page];
      return count(() => ctx.db.from(table).select('id', { count: 'exact', head: true })
        .eq('tenant_id', ctx.tenantId).gt(column, at));
    };

    const [orders, leads, appointments, support, inbox, payments, marketing] = await Promise.all([
      sinceCount('orders'),
      sinceCount('leads'),
      sinceCount('appointments'),
      sinceCount('support'),
      count(() => ctx.db.from('conversations').select('id', { count: 'exact', head: true })
        .eq('tenant_id', ctx.tenantId).gt('unread_count', 0)),
      count(() => ctx.db.from('payments').select('id', { count: 'exact', head: true })
        .eq('tenant_id', ctx.tenantId).eq('verification_status', 'unverified')),
      count(() => ctx.db.from('scheduled_posts').select('id', { count: 'exact', head: true })
        .eq('tenant_id', ctx.tenantId).eq('status', 'proposed')),
    ]);

    // For the people who run the platform: businesses waiting and open faults.
    let platform = 0;
    if (ctx.platformAdmin) {
      const [pending, alerts] = await Promise.all([
        count(() => serviceClient.from('tenants').select('id', { count: 'exact', head: true }).eq('status', 'pending')),
        count(() => serviceClient.from('platform_alerts').select('id', { count: 'exact', head: true })
          .is('resolved_at', null).neq('kind', 'new_business')),
      ]);
      platform = pending + alerts;
    }

    res.json({ orders, leads, appointments, support, inbox, payments, marketing, platform });
  })
);
