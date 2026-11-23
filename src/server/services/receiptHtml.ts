import { receiptDataFrom } from './receiptLayout.js';

/**
 * The receipt as an email and a printable page.
 *
 * The same document as the picture sent in chat (receiptLayout.ts): the
 * business's letterhead, who it is for, what was bought, what was paid, and
 * the business's details at the foot. Built with tables and inline styles
 * because that is what email programs render reliably.
 *
 * Every value is escaped; the only addresses used for pictures are ones this
 * platform stored itself (receiptDesign.ownMediaUrl).
 */

const esc = (value: unknown): string =>
  value == null ? '' : String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const num = (n: unknown) =>
  Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function renderReceiptDocument(input: { business: any; payment: any; order: any | null; lead: any | null }): string {
  const { business, payment, order, lead } = input;
  const d = receiptDataFrom(business, payment, order, lead);
  const s = d.settings ?? {};
  const accent = /^#[0-9a-fA-F]{6}$/.test(String(s.accent ?? '')) ? String(s.accent) : '#1f2937';
  const name = s.display_name || d.businessName;
  const currency = d.currency;
  const ref = d.orderRef ?? d.receiptNo ?? 'Payment';
  const email = payment?.customer_email || lead?.email || null;

  const contact = [s.address, s.phone, s.email, s.website].filter(Boolean) as string[];

  const head = s.letterhead_url
    ? `<tr><td style="padding:0;"><img src="${esc(s.letterhead_url)}" alt="${esc(name)}" width="640" style="display:block;width:100%;max-width:640px;height:auto;border:0;"></td></tr>`
    : `<tr><td style="height:8px;background:${accent};font-size:0;line-height:0;">&nbsp;</td></tr>
       <tr><td style="padding:28px 32px 20px;">
         <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
           ${s.logo_url ? `<td width="76" valign="top" style="padding-right:16px;"><img src="${esc(s.logo_url)}" alt="" width="64" height="64" style="display:block;width:64px;height:64px;object-fit:contain;border:0;"></td>` : ''}
           <td valign="top">
             <div style="font-size:22px;font-weight:700;color:#111827;line-height:1.25;">${esc(name)}</div>
             ${s.tagline ? `<div style="font-size:13px;color:#6b7280;margin-top:4px;">${esc(s.tagline)}</div>` : ''}
           </td>
           <td valign="top" align="right" style="font-size:12px;color:#6b7280;line-height:1.6;">
             ${contact.map((c) => esc(c)).join('<br>')}
           </td>
         </tr></table>
       </td></tr>`;

  const items = d.items;
  const itemRows = items.length
    ? items.map((it) => {
        const unit = it.price === null || it.price === undefined ? null : Number(it.price);
        return `<tr>
          <td style="padding:11px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;">${esc(it.name)}</td>
          <td align="right" style="padding:11px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;">${it.qty || 1}</td>
          <td align="right" style="padding:11px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#6b7280;">${unit === null ? '-' : num(unit)}</td>
          <td align="right" style="padding:11px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;">${unit === null ? '-' : num(unit * (it.qty || 1))}</td>
        </tr>`;
      }).join('')
    : `<tr>
        <td colspan="3" style="padding:11px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;">${esc(d.orderRef ? `Payment for ${d.orderRef}` : 'Payment received')}</td>
        <td align="right" style="padding:11px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;">${d.amount === null ? '-' : num(d.amount)}</td>
      </tr>`;

  const meta: Array<[string, string]> = [];
  if (d.receiptNo) meta.push(['Receipt no.', d.receiptNo]);
  if (d.orderRef) meta.push(['Order', d.orderRef]);
  if (d.date) meta.push(['Date', d.date]);

  const th = (label: string, align = 'left') =>
    `<th align="${align}" style="padding:9px 12px;font-size:11px;letter-spacing:1px;color:${accent};background:#f3f4f6;font-weight:700;">${label}</th>`;

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Receipt ${esc(ref)}</title></head>
<body style="margin:0;padding:24px 12px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
  ${head}
  <tr><td style="padding:0 32px;"><div style="border-top:2px solid #e5e7eb;font-size:0;line-height:0;">&nbsp;</div></td></tr>

  <tr><td style="padding:22px 32px 6px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td valign="top" style="font-size:24px;font-weight:700;letter-spacing:3px;color:#111827;">RECEIPT</td>
      <td valign="top" align="right">
        <table role="presentation" cellpadding="0" cellspacing="0">
          ${meta.map(([k, v]) => `<tr><td align="right" style="font-size:12px;color:#6b7280;padding:2px 12px 2px 0;">${esc(k)}</td><td align="right" style="font-size:13px;font-weight:700;color:#111827;padding:2px 0;">${esc(v)}</td></tr>`).join('')}
        </table>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="padding:14px 32px 6px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="50%" valign="top" style="padding-right:8px;">
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;">
          <div style="font-size:11px;letter-spacing:1.5px;font-weight:700;color:#9ca3af;">BILLED TO</div>
          <div style="font-size:16px;font-weight:700;color:#111827;margin-top:6px;">${esc(d.customerName || 'Customer')}</div>
          <div style="font-size:13px;color:#6b7280;margin-top:4px;line-height:1.6;">
            ${[d.customerPhone, email, d.deliveryLocation ? `Deliver to: ${d.deliveryLocation}` : null].filter(Boolean).map((v) => esc(v)).join('<br>')}
          </div>
        </div>
      </td>
      <td width="50%" valign="top" style="padding-left:8px;">
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;">
          <div style="font-size:11px;letter-spacing:1.5px;font-weight:700;color:#9ca3af;">PAYMENT</div>
          <div style="font-size:16px;font-weight:700;color:#111827;margin-top:6px;">${esc(d.method || 'Payment received')}</div>
          <div style="font-size:13px;color:#6b7280;margin-top:4px;line-height:1.6;">
            ${d.transactionCode ? `Reference: ${esc(d.transactionCode)}<br>` : ''}
            <span style="display:inline-block;background:#d1fae5;color:#065f46;font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;margin-top:4px;">VERIFIED</span>
          </div>
        </div>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="padding:18px 32px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <tr>${th('DESCRIPTION')}${th('QTY', 'right')}${th('UNIT PRICE', 'right')}${th('AMOUNT', 'right')}</tr>
      ${itemRows}
    </table>
  </td></tr>

  <tr><td style="padding:18px 32px 6px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td valign="middle">
        ${s.show_stamp !== false ? `<span style="display:inline-block;border:2px solid #059669;color:#059669;font-weight:700;letter-spacing:3px;font-size:16px;padding:6px 16px;border-radius:6px;">PAID</span>` : ''}
      </td>
      <td align="right">
        <table role="presentation" cellpadding="0" cellspacing="0" style="background:${accent};border-radius:8px;"><tr>
          <td style="padding:14px 18px;font-size:13px;font-weight:700;color:#ffffff;letter-spacing:1px;">TOTAL PAID</td>
          <td align="right" style="padding:14px 18px;font-size:19px;font-weight:700;color:#ffffff;white-space:nowrap;">${esc(currency)} ${d.amount === null ? '-' : num(d.amount)}</td>
        </tr></table>
      </td>
    </tr></table>
  </td></tr>

  <tr><td align="center" style="padding:22px 32px 18px;font-size:14px;color:#111827;line-height:1.6;">
    ${esc(s.footer_note || `Thank you for choosing ${name}.`)}
  </td></tr>

  <tr><td style="padding:0 32px;"><div style="border-top:2px solid #e5e7eb;font-size:0;line-height:0;">&nbsp;</div></td></tr>
  <tr><td align="center" style="padding:14px 32px 6px;font-size:12px;color:#6b7280;line-height:1.7;">
    ${[name, s.tax_id ? `${s.tax_label || 'Tax no.'} ${s.tax_id}` : null].filter(Boolean).map((v) => esc(v)).join(' &middot; ')}
    ${s.letterhead_url && contact.length ? `<br>${contact.map((c) => esc(c)).join(' &middot; ')}` : ''}
  </td></tr>
  <tr><td align="center" style="padding:0 32px 18px;font-size:11px;color:#9ca3af;">Issued electronically. Valid without a signature.</td></tr>
  <tr><td style="height:6px;background:${accent};font-size:0;line-height:0;">&nbsp;</td></tr>
</table>
</td></tr></table>
</body></html>`;
}
