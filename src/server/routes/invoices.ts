import { Router } from 'express';
import type { Response } from 'express';
import { serviceClient } from '../supabase.js';
import { requireAuth, requireWrite, requireAdmin, handler } from '../auth.js';
import { logAuditEvent } from '../security/audit.js';
import {
  InvoiceError, cleanItems, createInvoice, displayStatus, invoiceDocData, invoiceSettingsOf, loadBusiness,
  mergeInvoiceSettings, sendInvoice, settleInvoiceForPayment, totalsOf,
} from '../services/invoices.js';
import {
  documentSignatureOk, invoicePdfUrl, receiptDataFrom, renderDocumentPdf,
} from '../services/receiptImage.js';
import { notifyPaymentVerified } from '../services/paymentNotice.js';

/**
 * Invoices: raise one, send it as a PDF, and mark it paid once a person has
 * confirmed the money arrived.
 *
 * Staff raise, send and settle invoices; managers set how invoices are
 * numbered and what terms they carry. Reading is through the caller's own
 * database session; writing is through the server so totals are always
 * computed here and never taken from the browser.
 */
export const invoicesRouter = Router();

function fail(res: Response, e: unknown, fallback: string) {
  if (e instanceof InvoiceError) return res.status(e.status).json({ error: e.message });
  console.error('[invoices]', e instanceof Error ? e.message : e);
  return res.status(500).json({ error: fallback });
}

const withView = (inv: any) => ({ ...inv, display_status: displayStatus(inv), pdf_url: invoicePdfUrl(inv.id) });

invoicesRouter.get(
  '/invoices',
  requireAuth,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const status = String(req.query.status ?? '');
    const search = String(req.query.search ?? '').replace(/[%,()]/g, ' ').trim().slice(0, 60);
    const today = new Date().toISOString().slice(0, 10);

    let q = ctx.db.from('invoices').select('*', { count: 'exact' })
      .eq('tenant_id', ctx.tenantId).order('created_at', { ascending: false }).range(offset, offset + limit - 1);
    if (status === 'overdue') q = q.eq('status', 'sent').lt('due_date', today);
    else if (status === 'sent') q = q.eq('status', 'sent');
    else if (['draft', 'paid', 'void'].includes(status)) q = q.eq('status', status);
    if (search) q = q.or(`invoice_no.ilike.%${search}%,customer_name.ilike.%${search}%`);

    const { data, error, count } = await q;
    if (error) return res.status(400).json({ error: 'The invoices could not be read.' });

    // The figures at the top of the page, across every invoice, not just this page.
    const { data: open } = await ctx.db.from('invoices')
      .select('total, due_date, currency').eq('tenant_id', ctx.tenantId).eq('status', 'sent').limit(1000);
    const monthStart = `${today.slice(0, 7)}-01`;
    const { data: paid } = await ctx.db.from('invoices')
      .select('total').eq('tenant_id', ctx.tenantId).eq('status', 'paid').gte('paid_at', monthStart).limit(1000);
    const sum = (rows: any[] | null) => (rows ?? []).reduce((s, r) => s + Number(r.total || 0), 0);
    const overdue = (open ?? []).filter((r) => r.due_date && r.due_date < today);

    res.json({
      invoices: (data ?? []).map(withView),
      total: count ?? 0,
      summary: {
        outstanding: sum(open ?? []),
        outstanding_count: (open ?? []).length,
        overdue: sum(overdue),
        overdue_count: overdue.length,
        paid_this_month: sum(paid ?? []),
      },
    });
  })
);

/** People an invoice can be raised for, and what can go on it. */
invoicesRouter.get(
  '/invoices/options',
  requireAuth,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const [leads, services, products, business] = await Promise.all([
      ctx.db.from('leads').select('id, customer_name, email, phone, channel_type')
        .eq('tenant_id', ctx.tenantId).order('last_contact', { ascending: false, nullsFirst: false }).limit(200),
      ctx.db.from('services').select('id, name, price_amount').eq('tenant_id', ctx.tenantId).order('name').limit(200),
      ctx.db.from('products').select('id, name, price').eq('tenant_id', ctx.tenantId).order('name').limit(200),
      loadBusiness(ctx.tenantId),
    ]);
    res.json({
      customers: (leads.data ?? []).filter((l: any) => l.customer_name),
      catalogue: [
        ...(services.data ?? []).map((s: any) => ({ name: s.name, price: s.price_amount === null ? null : Number(s.price_amount), kind: 'service' })),
        ...(products.data ?? []).map((p: any) => ({ name: p.name, price: p.price === null ? null : Number(p.price), kind: 'product' })),
      ],
      settings: invoiceSettingsOf(business),
      currency: String(business?.currency || 'KES').toUpperCase(),
    });
  })
);

invoicesRouter.post(
  '/invoices',
  requireAuth,
  requireWrite,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    try {
      const leadId = req.body?.lead_id === null || req.body?.lead_id === undefined || req.body?.lead_id === '' ? null : Number(req.body.lead_id);
      const inv = await createInvoice(ctx.tenantId, {
        leadId: Number.isFinite(leadId as number) ? leadId : null,
        customerName: req.body?.customer_name,
        customerEmail: req.body?.customer_email,
        customerPhone: req.body?.customer_phone,
        items: req.body?.items,
        discount: Number(req.body?.discount) || 0,
        dueDate: req.body?.due_date,
        notes: req.body?.notes,
        createdBy: ctx.userId,
      });
      void logAuditEvent({
        tenantId: ctx.tenantId, actorId: ctx.userId, actorType: ctx.supportMode ? 'platform_admin' : 'user', actorLabel: ctx.email,
        action: 'invoice.created', resourceType: 'invoices', resourceId: inv.id,
        details: { summary: `Raised invoice ${inv.invoice_no} for ${inv.customer_name} (${inv.currency} ${inv.total})` },
      });

      let delivery = null;
      if (req.body?.send === true) delivery = await sendInvoice(ctx.tenantId, inv.id);
      const { data: fresh } = await serviceClient.from('invoices').select('*').eq('id', inv.id).single();
      res.status(201).json({ invoice: withView(fresh ?? inv), delivery });
    } catch (e) {
      fail(res, e, 'The invoice could not be created.');
    }
  })
);

/** Change a draft. Once sent, an invoice is a record: cancel it and raise another. */
invoicesRouter.patch(
  '/invoices/:id',
  requireAuth,
  requireWrite,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const { data: inv } = await serviceClient.from('invoices').select('*').eq('tenant_id', ctx.tenantId).eq('id', req.params.id).maybeSingle();
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    if (inv.status !== 'draft') {
      return res.status(409).json({ error: 'Only a draft can be changed. Cancel this invoice and raise a new one.' });
    }
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (req.body?.items !== undefined) {
      const items = cleanItems(req.body.items);
      if (!items.length) return res.status(400).json({ error: 'Add at least one line with a name and a price.' });
      Object.assign(patch, { items }, totalsOf(items, Number(req.body?.discount ?? inv.discount) || 0, Number(inv.tax_rate) || 0));
    }
    if (typeof req.body?.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.due_date)) patch.due_date = req.body.due_date;
    if (typeof req.body?.notes === 'string') patch.notes = req.body.notes.replace(/\s+/g, ' ').trim().slice(0, 500) || null;
    if (typeof req.body?.customer_email === 'string') patch.customer_email = req.body.customer_email.trim().slice(0, 200) || null;

    const { data, error } = await serviceClient.from('invoices').update(patch).eq('id', inv.id).eq('tenant_id', ctx.tenantId).select('*').single();
    if (error) return res.status(500).json({ error: 'The invoice could not be saved.' });
    res.json({ invoice: withView(data) });
  })
);

invoicesRouter.post(
  '/invoices/:id/send',
  requireAuth,
  requireWrite,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    try {
      const delivery = await sendInvoice(ctx.tenantId, req.params.id);
      const { data } = await serviceClient.from('invoices').select('*').eq('tenant_id', ctx.tenantId).eq('id', req.params.id).single();
      if (delivery.sent) {
        void logAuditEvent({
          tenantId: ctx.tenantId, actorId: ctx.userId, actorType: ctx.supportMode ? 'platform_admin' : 'user', actorLabel: ctx.email,
          action: 'invoice.sent', resourceType: 'invoices', resourceId: req.params.id,
          details: { summary: `Sent invoice ${data?.invoice_no ?? ''}` },
        });
      }
      res.json({ invoice: withView(data), delivery });
    } catch (e) {
      fail(res, e, 'The invoice could not be sent.');
    }
  })
);

/**
 * The customer has paid and a person has checked.
 *
 * This records the payment as verified by the person pressing the button,
 * exactly as verifying a claim on the Payments page does, then sends the
 * receipt. `verified_by` comes from the session, never from the request.
 */
invoicesRouter.post(
  '/invoices/:id/mark-paid',
  requireAuth,
  requireWrite,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const { data: inv } = await serviceClient.from('invoices').select('*').eq('tenant_id', ctx.tenantId).eq('id', req.params.id).maybeSingle();
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    if (inv.status === 'paid') return res.status(409).json({ error: 'This invoice is already paid.' });
    if (inv.status === 'void') return res.status(409).json({ error: 'A cancelled invoice cannot be paid.' });

    const method = String(req.body?.method ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Payment';
    const reference = String(req.body?.reference ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || null;

    // If the customer already sent a claim for this invoice, that is the payment to verify.
    const { data: claim } = await serviceClient.from('payments')
      .select('id').eq('tenant_id', ctx.tenantId).eq('invoice_id', inv.id).eq('verification_status', 'unverified')
      .order('created_at', { ascending: false }).limit(1);

    let paymentId: string | null = claim?.[0]?.id ?? null;
    if (paymentId) {
      const { error } = await ctx.db.from('payments')
        .update({ verification_status: 'verified', verified_by: ctx.userId, verified_at: new Date().toISOString() })
        .eq('id', paymentId).eq('tenant_id', ctx.tenantId);
      if (error) return res.status(400).json({ error: 'The payment could not be verified.' });
    } else {
      const { data: made, error } = await ctx.db.from('payments').insert({
        tenant_id: ctx.tenantId,
        lead_id: inv.lead_id,
        invoice_id: inv.id,
        conversation_id: inv.conversation_id,
        customer_email: inv.customer_email,
        transaction_code: reference,
        amount: inv.total,
        currency: inv.currency,
        payment_method: method,
        payment_status: 'paid',
        verification_status: 'verified',
        verified_by: ctx.userId,
        verified_at: new Date().toISOString(),
      }).select('id').single();
      if (error || !made) {
        console.error('[invoices] recording the payment failed:', error?.message);
        return res.status(400).json({
          error: /duplicate|unique/i.test(error?.message ?? '')
            ? 'That payment reference is already recorded for another payment.'
            : 'The payment could not be recorded.',
        });
      }
      paymentId = made.id;
    }

    await settleInvoiceForPayment(ctx.tenantId, paymentId!);
    void logAuditEvent({
      tenantId: ctx.tenantId, actorId: ctx.userId, actorType: ctx.supportMode ? 'platform_admin' : 'user', actorLabel: ctx.email,
      action: 'invoice.paid', resourceType: 'invoices', resourceId: inv.id,
      details: { summary: `Marked invoice ${inv.invoice_no} paid (${inv.currency} ${inv.total}${reference ? `, ref ${reference}` : ''})` },
    });
    // The customer gets their confirmation and receipt, as with any verified payment.
    const notice = await notifyPaymentVerified({ tenantId: ctx.tenantId, paymentId: paymentId!, verifiedBy: ctx.userId } as any)
      .catch(() => null);

    const { data } = await serviceClient.from('invoices').select('*').eq('id', inv.id).single();
    res.json({ invoice: withView(data), payment_id: paymentId, receipt: notice });
  })
);

invoicesRouter.post(
  '/invoices/:id/void',
  requireAuth,
  requireWrite,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const { data, error } = await serviceClient.from('invoices')
      .update({ status: 'void', updated_at: new Date().toISOString() })
      .eq('tenant_id', ctx.tenantId).eq('id', req.params.id).in('status', ['draft', 'sent'])
      .select('*').maybeSingle();
    if (error) return res.status(500).json({ error: 'The invoice could not be cancelled.' });
    if (!data) return res.status(409).json({ error: 'Only an unpaid invoice can be cancelled.' });
    void logAuditEvent({
      tenantId: ctx.tenantId, actorId: ctx.userId, actorType: ctx.supportMode ? 'platform_admin' : 'user', actorLabel: ctx.email,
      action: 'invoice.cancelled', resourceType: 'invoices', resourceId: data.id,
      details: { summary: `Cancelled invoice ${data.invoice_no}` },
    });
    res.json({ invoice: withView(data) });
  })
);

/** Say which invoice a payment claim is for, or that it is for none. */
invoicesRouter.post(
  '/payments/:id/invoice',
  requireAuth,
  requireWrite,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const invoiceId = req.body?.invoice_id ?? null;
    if (invoiceId !== null) {
      const { data: inv } = await serviceClient.from('invoices').select('id, status')
        .eq('tenant_id', ctx.tenantId).eq('id', String(invoiceId)).maybeSingle();
      if (!inv) return res.status(404).json({ error: 'Invoice not found' });
      if (inv.status === 'void') return res.status(409).json({ error: 'That invoice is cancelled.' });
    }
    const { data, error } = await serviceClient.from('payments')
      .update({ invoice_id: invoiceId }).eq('tenant_id', ctx.tenantId).eq('id', req.params.id)
      .select('id, invoice_id, verification_status').maybeSingle();
    if (error) return res.status(500).json({ error: 'That could not be saved.' });
    if (!data) return res.status(404).json({ error: 'Payment not found' });
    if (data.verification_status === 'verified') await settleInvoiceForPayment(ctx.tenantId, data.id);
    res.json(data);
  })
);

// ---------------------------------------------------------------------------
// Settings: numbering, terms, tax, and raising invoices by themselves
// ---------------------------------------------------------------------------
invoicesRouter.get(
  '/invoice-settings',
  requireAuth,
  handler(async (req, res) => {
    res.json({ settings: invoiceSettingsOf(await loadBusiness(req.ctx!.tenantId)) });
  })
);

invoicesRouter.put(
  '/invoice-settings',
  requireAuth,
  requireAdmin,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const business = await loadBusiness(ctx.tenantId);
    if (!business) return res.status(404).json({ error: 'Business not found' });
    const invoice = mergeInvoiceSettings(business, (req.body ?? {}) as Record<string, unknown>);
    const branding = { ...(business.branding ?? {}), invoice };
    const { error } = await serviceClient.from('tenants')
      .update({ branding, updated_at: new Date().toISOString() }).eq('id', ctx.tenantId);
    if (error) return res.status(500).json({ error: 'The invoice settings could not be saved.' });
    res.json({ settings: invoice });
  })
);

// ---------------------------------------------------------------------------
// The documents themselves, as PDFs
// ---------------------------------------------------------------------------
// Public on purpose: WhatsApp, Telegram and the email service fetch a file
// from its address and cannot sign in. What protects each is the signature in
// the address, issued for one document and useless for any other.

invoicesRouter.get(
  '/invoices/pdf/:file',
  handler(async (req, res) => {
    const id = String(req.params.file || '').replace(/\.pdf$/i, '');
    if (!/^[0-9a-f-]{36}$/i.test(id) || !documentSignatureOk('invoice-pdf', id, req.query.sig)) {
      return res.status(404).json({ error: 'Not found' });
    }
    const { data: inv } = await serviceClient.from('invoices').select('*').eq('id', id).maybeSingle();
    if (!inv) return res.status(404).json({ error: 'Not found' });
    const business = await loadBusiness(inv.tenant_id);
    const pdf = await renderDocumentPdf(invoiceDocData(business, inv), `Invoice ${inv.invoice_no}`);
    if (!pdf) return res.status(503).json({ error: 'The invoice could not be produced' });
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `inline; filename="Invoice-${String(inv.invoice_no).replace(/[^\w-]/g, '')}.pdf"`);
    // An invoice changes when it is paid, so it is not cached for long.
    res.setHeader('cache-control', 'private, max-age=60');
    res.send(pdf);
  })
);

invoicesRouter.get(
  '/receipts/pdf/:file',
  handler(async (req, res) => {
    const paymentId = String(req.params.file || '').replace(/\.pdf$/i, '');
    if (!/^[0-9a-f-]{36}$/i.test(paymentId) || !documentSignatureOk('receipt-pdf', paymentId, req.query.sig)) {
      return res.status(404).json({ error: 'Not found' });
    }
    const { data: payment } = await serviceClient.from('payments').select('*').eq('id', paymentId).maybeSingle();
    if (!payment || payment.verification_status !== 'verified') return res.status(404).json({ error: 'Not found' });

    const [{ data: business }, { data: order }, { data: lead }, { data: inv }] = await Promise.all([
      serviceClient.from('tenants').select('business_name, address, currency, branding, contact_info, timezone').eq('id', payment.tenant_id).maybeSingle(),
      payment.order_id
        ? serviceClient.from('orders').select('order_ref, items, delivery_location').eq('tenant_id', payment.tenant_id).eq('id', payment.order_id).maybeSingle()
        : Promise.resolve({ data: null } as any),
      payment.lead_id !== null && payment.lead_id !== undefined
        ? serviceClient.from('leads').select('customer_name, phone').eq('tenant_id', payment.tenant_id).eq('id', payment.lead_id).maybeSingle()
        : Promise.resolve({ data: null } as any),
      payment.invoice_id
        ? serviceClient.from('invoices').select('invoice_no, items, customer_name, customer_phone').eq('tenant_id', payment.tenant_id).eq('id', payment.invoice_id).maybeSingle()
        : Promise.resolve({ data: null } as any),
    ]);
    // A payment for an invoice is receipted with the invoice's own lines.
    const basis = order ?? (inv ? { order_ref: inv.invoice_no, items: inv.items, delivery_location: null } : null);
    const who = lead ?? (inv ? { customer_name: inv.customer_name, phone: inv.customer_phone } : null);
    const data = receiptDataFrom(business, payment, basis, who);
    const pdf = await renderDocumentPdf(data, `Receipt ${data.receiptNo ?? ''}`.trim());
    if (!pdf) return res.status(503).json({ error: 'The receipt could not be produced' });
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `inline; filename="Receipt-${String(data.receiptNo ?? 'payment').replace(/[^\w-]/g, '')}.pdf"`);
    res.setHeader('cache-control', 'public, max-age=86400, immutable');
    res.send(pdf);
  })
);
