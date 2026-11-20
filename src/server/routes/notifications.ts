import { Router } from 'express';
import { requireAuth, handler } from '../auth.js';
import { serviceClient } from '../supabase.js';

export const notificationsRouter = Router();

/**
 * The bell.
 *
 * Reads go through the caller's own database session, so row level security
 * decides what they may see. Marking as read goes through the service role but
 * is pinned to the tenant the session resolved - never to an id in the body.
 */
notificationsRouter.get(
  '/notifications',
  requireAuth,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);

    const { data, error } = await ctx.db
      .from('notifications')
      .select('id, kind, title, body, link, read_at, created_at')
      .eq('tenant_id', ctx.tenantId)
      .order('created_at', { ascending: false })
      .limit(limit);

    // The table arrives with migration 0021. Until then there is simply
    // nothing to show, which is not an error worth surfacing.
    if (error) return res.json({ notifications: [], unread: 0 });

    const { count } = await ctx.db
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId)
      .is('read_at', null);

    res.json({ notifications: data ?? [], unread: count ?? 0 });
  })
);

notificationsRouter.post(
  '/notifications/read',
  requireAuth,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.filter((id: unknown) => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)).slice(0, 100)
      : null;

    let q = serviceClient
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('tenant_id', ctx.tenantId)
      .is('read_at', null);
    if (ids && ids.length) q = q.in('id', ids);

    const { error } = await q;
    if (error) return res.json({ ok: false });
    res.json({ ok: true });
  })
);

/** Receipts that were issued, newest first. */
notificationsRouter.get(
  '/receipts',
  requireAuth,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const { data, error } = await ctx.db
      .from('receipts')
      .select('id, payment_id, order_id, order_ref, amount, currency, text_body, sent_in_chat, sent_by_email, recipient_email, created_at')
      .eq('tenant_id', ctx.tenantId)
      .order('created_at', { ascending: false })
      .limit(Math.min(Math.max(Number(req.query.limit) || 50, 1), 200));
    if (error) return res.json({ receipts: [] });
    res.json({ receipts: data ?? [] });
  })
);
