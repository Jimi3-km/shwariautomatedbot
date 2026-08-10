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

export function renderReceiptHtml({ business, payment, order, lead }: ReceiptInput): string {
  const currency = payment.currency || business.currency || 'KES';
  const brand = business.branding ?? {};
  const accent = /^#[0-9a-fA-F]{3,8}$/.test(String(brand.accent_color || '')) ? brand.accent_color : '#1a1a2e';
  const contact = business.contact_info ?? {};
  const ref = order?.order_ref ?? `${business.order_prefix || 'ORD'}-${String(payment.id).slice(0, 8).toUpperCase()}`;

  const rows: Array<[string, string]> = [
    ['Customer', esc(lead?.customer_name || payment.customer_id || '-')],
    ['Email', esc(payment.customer_email || lead?.email || '-')],
    ['Delivery location', esc(payment.delivery_location || order?.delivery_location || lead?.delivery_location || '-')],
    ['Product', esc([payment.product_model, payment.product_storage, payment.product_condition].filter(Boolean).join(' ') || '-')],
    ['Payment method', esc(payment.payment_method || '-')],
    ['Transaction code', esc(payment.transaction_code || '-')],
  ];

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Receipt ${esc(ref)}</title></head>
<body style="margin:0;padding:20px;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:580px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;">
    <div style="background:${esc(accent)};color:#fff;padding:28px;text-align:center;">
      <h1 style="margin:0;font-size:22px;">${esc(business.business_name)}</h1>
      <p style="margin:6px 0 0;color:#ddd;font-size:13px;">Official purchase receipt</p>
    </div>
    <div style="padding:28px;">
      <div style="background:#f0f4ff;border-left:4px solid ${esc(accent)};padding:12px 16px;margin-bottom:20px;">
        <div style="font-size:12px;color:#666;">Order reference</div>
        <strong style="font-size:16px;color:#1a1a2e;">${esc(ref)}</strong>
        <div style="display:inline-block;background:#d1fae5;color:#065f46;font-size:12px;padding:3px 10px;border-radius:20px;margin-top:6px;">Payment verified</div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        ${rows.map(([k, v]) => `<tr><td style="padding:8px 0;color:#777;border-bottom:1px solid #f2f2f2;">${esc(k)}</td><td style="padding:8px 0;text-align:right;color:#222;border-bottom:1px solid #f2f2f2;">${v}</td></tr>`).join('')}
        <tr><td style="padding:14px 0;font-weight:bold;font-size:17px;">Total paid</td><td style="padding:14px 0;text-align:right;font-weight:bold;font-size:17px;">${money(payment.amount, currency)}</td></tr>
      </table>
    </div>
    <div style="background:#fafafa;padding:18px 28px;text-align:center;font-size:12px;color:#999;border-top:1px solid #eee;">
      Thank you for choosing ${esc(business.business_name)}.<br>
      ${esc(business.address || '')}${contact.phone ? ` &middot; ${esc(contact.phone)}` : ''}${contact.email ? ` &middot; ${esc(contact.email)}` : ''}
    </div>
  </div>
</body></html>`;
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
      .select('business_name, address, currency, order_prefix, branding, contact_info')
      .eq('id', ctx.tenantId).single();

    const { data: order } = payment.order_id
      ? await ctx.db.from('orders').select('*').eq('id', payment.order_id).eq('tenant_id', ctx.tenantId).maybeSingle()
      : { data: null as any };

    const { data: lead } = payment.lead_id
      ? await ctx.db.from('leads').select('*').eq('id', payment.lead_id).eq('tenant_id', ctx.tenantId).maybeSingle()
      : { data: null as any };

    const html = renderReceiptHtml({ business, payment, order, lead });

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
