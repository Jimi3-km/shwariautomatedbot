import { Router } from 'express';
import { requireAuth, requireWrite, requireAdmin, handler } from '../auth.js';

export const commerceRouter = Router();

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------
// A payment arrives as an unverified CLAIM. Only a human staff member can
// move it to verified, and the database trigger payments_verification_guard
// enforces that independently of this code.

commerceRouter.get(
  '/payments',
  requireAuth,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    let q = ctx.db
      .from('payments').select('*').eq('tenant_id', ctx.tenantId)
      .order('created_at', { ascending: false })
      .limit(Math.min(Number(req.query.limit) || 200, 500));
    if (req.query.verification_status) {
      q = q.eq('verification_status', String(req.query.verification_status));
    }
    const { data, error } = await q;
    if (error) return res.status(400).json({ error: error.message });
    res.json({ payments: data ?? [] });
  })
);

/**
 * Verify or reject a payment claim.
 * verified_by is taken from the session -- it is never accepted from the body,
 * so a caller cannot attribute a verification to somebody else.
 */
commerceRouter.post(
  '/payments/:id/verify',
  requireAuth,
  requireWrite,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const decision = String(req.body?.decision || '');
    if (!['verified', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: "decision must be 'verified' or 'rejected'" });
    }

    const updates: Record<string, unknown> =
      decision === 'verified'
        ? { verification_status: 'verified', verified_by: ctx.userId, verified_at: new Date().toISOString() }
        : { verification_status: 'rejected', rejected_reason: req.body?.reason ? String(req.body.reason) : null };

    const { data, error } = await ctx.db
      .from('payments').update(updates)
      .eq('id', req.params.id).eq('tenant_id', ctx.tenantId)
      .select('*').maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Payment not found' });

    // Keep the lead stage in step with the verification decision.
    if (data.lead_id) {
      await ctx.db.from('leads')
        .update({ stage: decision === 'verified' ? 'payment_verified' : 'payment_claimed', updated_at: new Date().toISOString() })
        .eq('id', data.lead_id).eq('tenant_id', ctx.tenantId);
    }
    if (decision === 'verified' && data.order_id) {
      await ctx.db.from('orders')
        .update({ payment_status: 'paid', status: 'confirmed', updated_at: new Date().toISOString() })
        .eq('id', data.order_id).eq('tenant_id', ctx.tenantId);
    }

    res.json(data);
  })
);

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

const ORDER_STATES = ['pending', 'confirmed', 'delivered', 'cancelled'];

commerceRouter.get(
  '/orders',
  requireAuth,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    let q = ctx.db
      .from('orders').select('*').eq('tenant_id', ctx.tenantId)
      .order('created_at', { ascending: false })
      .limit(Math.min(Number(req.query.limit) || 200, 500));
    if (req.query.status) q = q.eq('status', String(req.query.status));
    const { data, error } = await q;
    if (error) return res.status(400).json({ error: error.message });
    res.json({ orders: data ?? [] });
  })
);

commerceRouter.post(
  '/orders',
  requireAuth,
  requireWrite,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const { data: tenant } = await ctx.db
      .from('tenants').select('order_prefix, currency').eq('id', ctx.tenantId).single();

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const total = req.body?.total == null ? null : Number(req.body.total);
    if (total != null && (!Number.isFinite(total) || total < 0)) {
      return res.status(400).json({ error: 'total must be a non-negative number' });
    }

    const orderRef = `${tenant?.order_prefix || 'ORD'}-${Date.now().toString(36).toUpperCase()}`;

    const { data, error } = await ctx.db
      .from('orders')
      .insert({
        tenant_id: ctx.tenantId,
        order_ref: orderRef,
        lead_id: req.body?.lead_id ?? null,
        customer_id: req.body?.customer_id ?? null,
        channel_type: req.body?.channel_type ?? null,
        items,
        subtotal: req.body?.subtotal == null ? null : Number(req.body.subtotal),
        total,
        currency: String(req.body?.currency || tenant?.currency || 'KES').toUpperCase().slice(0, 3),
        delivery_location: req.body?.delivery_location ?? null,
        status: 'pending',
      })
      .select('*').single();
    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json(data);
  })
);

commerceRouter.patch(
  '/orders/:id',
  requireAuth,
  requireWrite,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (req.body?.status !== undefined) {
      if (!ORDER_STATES.includes(req.body.status)) {
        return res.status(400).json({ error: `status must be one of: ${ORDER_STATES.join(', ')}` });
      }
      updates.status = req.body.status;
    }
    if (req.body?.delivery_location !== undefined) updates.delivery_location = req.body.delivery_location;
    if (req.body?.items !== undefined) updates.items = req.body.items;

    const { data, error } = await ctx.db
      .from('orders').update(updates)
      .eq('id', req.params.id).eq('tenant_id', ctx.tenantId)
      .select('*').maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Order not found' });
    res.json(data);
  })
);

// ---------------------------------------------------------------------------
// Overview metrics
// ---------------------------------------------------------------------------

commerceRouter.get(
  '/overview',
  requireAuth,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const t = ctx.tenantId;
    const since = new Date(Date.now() - 7 * 864e5).toISOString();

    const count = async (table: string, build: (q: any) => any = (q) => q) => {
      const { count: n } = await build(
        ctx.db.from(table).select('id', { count: 'exact', head: true }).eq('tenant_id', t)
      );
      return n ?? 0;
    };

    const [
      totalLeads, newLeads, activeConversations,
      paymentClaims, verifiedPayments, wonLeads,
    ] = await Promise.all([
      count('leads'),
      count('leads', (q) => q.gte('created_at', since)),
      count('conversations', (q) => q.eq('status', 'open')),
      count('payments', (q) => q.eq('verification_status', 'unverified')),
      count('payments', (q) => q.eq('verification_status', 'verified')),
      count('leads', (q) => q.eq('stage', 'won')),
    ]);

    const { data: salesRows } = await ctx.db
      .from('payments').select('amount').eq('tenant_id', t).eq('verification_status', 'verified');
    const sales = (salesRows ?? []).reduce((sum, r: any) => sum + Number(r.amount || 0), 0);

    const { data: recentConversations } = await ctx.db
      .from('conversations')
      .select('id, customer_name, customer_id, channel_type, last_message_preview, last_message_at, unread_count')
      .eq('tenant_id', t)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(8);

    const { data: recentLeads } = await ctx.db
      .from('leads')
      .select('id, customer_name, customer_id, channel_type, stage, product_model, product_price, last_contact')
      .eq('tenant_id', t)
      .order('created_at', { ascending: false })
      .limit(8);

    res.json({
      stats: {
        total_leads: totalLeads,
        new_leads: newLeads,
        active_conversations: activeConversations,
        payment_claims: paymentClaims,
        verified_payments: verifiedPayments,
        sales,
        conversion_rate: totalLeads ? Number(((wonLeads / totalLeads) * 100).toFixed(1)) : 0,
      },
      recent_conversations: recentConversations ?? [],
      recent_leads: recentLeads ?? [],
    });
  })
);
