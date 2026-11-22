import { receiptSignatureOk, renderReceiptPng, receiptDataFrom } from '../services/receiptImage.js';
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

/**
 * The receipt as a picture.
 *
 * Public on purpose: Telegram, Instagram and WhatsApp fetch a photo from its
 * address and cannot sign in. What protects it is the signature in the
 * address, which is only ever issued for one verified payment and cannot be
 * guessed for another.
 */
notificationsRouter.get(
  '/receipts/image/:file',
  handler(async (req, res) => {
    const paymentId = String(req.params.file || '').replace(/\.png$/i, '');
    if (!/^[0-9a-f-]{36}$/i.test(paymentId) || !receiptSignatureOk(paymentId, req.query.sig)) {
      return res.status(404).json({ error: 'Not found' });
    }

    const { data: payment } = await serviceClient
      .from('payments').select('*').eq('id', paymentId).maybeSingle();
    if (!payment || payment.verification_status !== 'verified') {
      return res.status(404).json({ error: 'Not found' });
    }

    const [{ data: business }, { data: order }, { data: lead }] = await Promise.all([
      serviceClient.from('tenants')
        .select('business_name, address, currency, branding, contact_info, timezone')
        .eq('id', payment.tenant_id).maybeSingle(),
      payment.order_id
        ? serviceClient.from('orders').select('order_ref, items, delivery_location').eq('tenant_id', payment.tenant_id).eq('id', payment.order_id).maybeSingle()
        : Promise.resolve({ data: null } as any),
      payment.lead_id !== null && payment.lead_id !== undefined
        ? serviceClient.from('leads').select('customer_name, phone').eq('tenant_id', payment.tenant_id).eq('id', payment.lead_id).maybeSingle()
        : Promise.resolve({ data: null } as any),
    ]);

    // A payment for an invoice is receipted with the invoice's own lines.
    let basis: any = order;
    let who: any = lead;
    if (!basis && (payment as any).invoice_id) {
      const { data: inv } = await serviceClient.from('invoices')
        .select('invoice_no, items, customer_name, customer_phone')
        .eq('tenant_id', payment.tenant_id).eq('id', (payment as any).invoice_id).maybeSingle();
      if (inv) {
        basis = { order_ref: inv.invoice_no, items: inv.items, delivery_location: null };
        who = who ?? { customer_name: inv.customer_name, phone: inv.customer_phone };
      }
    }
    const png = await renderReceiptPng(receiptDataFrom(business, payment, basis, who));
    if (!png) return res.status(503).json({ error: 'The receipt image could not be produced' });

    res.setHeader('content-type', 'image/png');
    res.setHeader('cache-control', 'public, max-age=86400, immutable');
    res.send(png);
  })
);

/** A made-up receipt, for checking that images render on this deployment. */
notificationsRouter.get(
  '/receipts/sample.png',
  handler(async (_req, res) => {
    const png = await renderReceiptPng({
      businessName: 'Sample Business',
      businessLine: '123 Example Road · +254 700 000000',
      orderRef: 'SMP-EXAMPLE1',
      customerName: 'Sample Customer',
      items: [{ name: 'Example item', qty: 2, price: 1500 }, { name: 'Delivery', qty: 1, price: 300 }],
      amount: 3300,
      currency: 'KES',
      method: 'M-Pesa',
      transactionCode: 'ABC123XYZ9',
      deliveryLocation: 'Westlands, Nairobi',
      date: '20 Nov 2026',
    });
    if (!png) return res.status(503).json({ error: 'The receipt image could not be produced' });
    res.setHeader('content-type', 'image/png');
    res.setHeader('cache-control', 'no-store');
    res.send(png);
  })
);
