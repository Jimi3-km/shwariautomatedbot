import { renderReceiptDocument } from '../services/receiptHtml.js';
import { logReceipt } from '../services/notify.js';
import { Router } from 'express';
import { requireAuth, requireWrite, handler } from '../auth.js';

export const receiptsRouter = Router();

/**
 * HTML escaping for every dynamic value that reaches the receipt template.
 * The previous implementation interpolated request body fields straight into
 * an HTML document that was then emailed, which was an HTML injection vector
 * in an unauthenticated endpoint.
 */
export function esc(value: unknown): string {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(amount: unknown, currency: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return esc(currency);
  return `${esc(currency)} ${n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface ReceiptInput {
  business: any;
  payment: any;
  order: any | null;
  lead: any | null;
}

export function renderReceiptHtml(input: ReceiptInput): string {
  // One design for every form of the receipt: see services/receiptHtml.ts.
  return renderReceiptDocument(input);
}

/**
 * Build a receipt for a payment.
 *
 * Replaces the old /api/send-receipt, which was an unauthenticated email relay
 * that would email arbitrary HTML to any address in the request body. Now:
 *   - authenticated, and the tenant comes from the session
 *   - the payment must belong to that tenant (RLS + explicit filter)
 *   - the payment must actually be verified
 *   - every dynamic value is HTML escaped
 *   - branding, business details and order prefix come from the tenant row
 *
 * Delivery is deliberately not wired to a mail provider here: no tenant-level
 * sending identity exists yet, and reusing one shared mailbox for every tenant
 * would be the same design mistake as the old global follow-up. The endpoint
 * returns the rendered receipt and records that it was issued.
 */
receiptsRouter.post(
  '/payments/:id/receipt',
  requireAuth,
  requireWrite,
  handler(async (req, res) => {
    const ctx = req.ctx!;

    const { data: payment, error } = await ctx.db
      .from('payments').select('*').eq('id', req.params.id).eq('tenant_id', ctx.tenantId).maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    if (payment.verification_status !== 'verified') {
      return res.status(409).json({
        error: 'A receipt can only be issued for a verified payment',
        verification_status: payment.verification_status,
      });
    }

    const { data: business } = await ctx.db
      .from('tenants')
      .select('business_name, address, currency, order_prefix, branding, contact_info, timezone')
      .eq('id', ctx.tenantId).single();

    const { data: order } = payment.order_id
      ? await ctx.db.from('orders').select('*').eq('id', payment.order_id).eq('tenant_id', ctx.tenantId).maybeSingle()
      : { data: null as any };

    const { data: lead } = payment.lead_id
      ? await ctx.db.from('leads').select('*').eq('id', payment.lead_id).eq('tenant_id', ctx.tenantId).maybeSingle()
      : { data: null as any };

    const html = renderReceiptHtml({ business, payment, order, lead });

    await logReceipt({
      tenantId: ctx.tenantId,
      paymentId: payment.id,
      orderId: payment.order_id ?? null,
      leadId: payment.lead_id ?? null,
      orderRef: order?.order_ref ?? null,
      amount: payment.amount,
      currency: payment.currency || business?.currency || null,
      htmlBody: html,
      issuedBy: ctx.userId,
    });

    await ctx.db.from('payments')
      .update({ receipt_sent_at: new Date().toISOString() })
      .eq('id', payment.id).eq('tenant_id', ctx.tenantId);

    res.json({
      order_ref: order?.order_ref ?? null,
      recipient: payment.customer_email ?? lead?.email ?? null,
      html,
      delivery: {
        sent: false,
        reason: 'No per-tenant sending identity is configured. Configure one before enabling delivery.',
      },
    });
  })
);
