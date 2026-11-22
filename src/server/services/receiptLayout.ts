import { imageDataUri, receiptSettingsOf, type ReceiptSettings } from './receiptDesign.js';

/**
 * The receipt as a document: a letterhead, who it is for, what was bought,
 * what was paid and how, and the business's details at the foot.
 *
 * Drawn as SVG and rendered to a PNG for the chat channels. The renderer has
 * no text wrapping and no layout engine, so every line is placed by hand and
 * cut or wrapped to a known width.
 */

export interface ReceiptImageData {
  businessName: string;
  /** Kept for callers that still pass one line of contact details. */
  businessLine?: string | null;
  orderRef?: string | null;
  receiptNo?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  items: Array<{ name: string; qty: number; price?: number | null }>;
  amount: number | null;
  currency: string;
  method?: string | null;
  transactionCode?: string | null;
  deliveryLocation?: string | null;
  date?: string | null;
  accent?: string | null;
  settings?: Partial<ReceiptSettings> | null;
  /** Pictures already fetched and encoded; set by prepareReceiptData. */
  logoData?: string | null;
  letterheadData?: string | null;

  // --- an invoice is the same document with a few different parts ----------
  /** Defaults to a receipt. */
  kind?: 'receipt' | 'invoice';
  /** Invoices: when payment is due, and where the invoice stands. */
  dueDate?: string | null;
  status?: 'unpaid' | 'paid' | 'overdue' | 'void' | null;
  /** Invoices: how to pay, one instruction per line. */
  payLines?: string[] | null;
  /** A line under the items, e.g. a discount or tax. Amounts are in the document's currency. */
  discount?: number | null;
  tax?: { label: string; amount: number } | null;
  /** Invoices: terms or a note to the customer. */
  notes?: string | null;
}

const esc = (v: unknown) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const money = (n: number | null | undefined, currency: string) =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? '-'
    : `${currency} ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Cut text to roughly fit a width. */
function fit(text: unknown, max: number): string {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, Math.max(1, max - 1))}…` : t;
}

/** Break text into lines of at most `max` characters, at most `lines` of them. */
export function wrap(text: unknown, max: number, lines: number): string[] {
  const words = String(text ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const out: string[] = [];
  let line = '';
  for (const w of words) {
    if (!line) { line = w; continue; }
    if ((line + ' ' + w).length <= max) { line += ' ' + w; continue; }
    out.push(line);
    line = w;
    if (out.length === lines) break;
  }
  if (out.length < lines && line) out.push(line);
  // Anything left over is marked as cut rather than silently dropped.
  const used = out.join(' ').length;
  const total = words.join(' ').length;
  if (used < total && out.length) out[out.length - 1] = fit(out[out.length - 1] + '…', max);
  return out.map((l) => fit(l, max));
}

/** A darker or lighter tint of the accent, for bands and rules. */
function tint(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

const INK = '#111827';
const MUTED = '#6b7280';
const FAINT = '#9ca3af';
const RULE = '#e5e7eb';

export function receiptSvg(d: ReceiptImageData): string {
  const W = 800;
  const M = 48; // page margin
  const s = d.settings ?? {};
  const accent = /^#[0-9a-fA-F]{6}$/.test(String(s.accent ?? d.accent ?? '')) ? String(s.accent ?? d.accent) : '#1f2937';
  const name = fit(s.display_name || d.businessName || 'Receipt', 34);
  const parts: string[] = [];
  let y = 0;

  // --- letterhead -----------------------------------------------------------
  if (d.letterheadData) {
    // The owner's own banner, shown whole on a white ground.
    parts.push(`<image x="0" y="0" width="${W}" height="190" preserveAspectRatio="xMidYMid meet" href="${d.letterheadData}"/>`);
    y = 190;
  } else {
    parts.push(`<rect x="0" y="0" width="${W}" height="10" fill="${accent}"/>`);
    let x = M;
    if (d.logoData) {
      parts.push(`<image x="${M}" y="40" width="84" height="84" preserveAspectRatio="xMidYMid meet" href="${d.logoData}"/>`);
      x = M + 104;
    }
    parts.push(`<text x="${x}" y="80" font-size="30" font-weight="700" fill="${INK}">${esc(fit(name, d.logoData ? 22 : 26))}</text>`);
    if (s.tagline) {
      parts.push(`<text x="${x}" y="108" font-size="15" fill="${MUTED}">${esc(fit(s.tagline, d.logoData ? 40 : 48))}</text>`);
    }
    // Contact details, right-aligned.
    const contact = [
      ...wrap(s.address, 34, 2),
      s.phone ? fit(s.phone, 34) : '',
      s.email ? fit(s.email, 34) : '',
      s.website ? fit(s.website, 34) : '',
    ].filter(Boolean).slice(0, 5);
    contact.forEach((line, i) => {
      parts.push(`<text x="${W - M}" y="${58 + i * 21}" text-anchor="end" font-size="14" fill="${MUTED}">${esc(line)}</text>`);
    });
    y = Math.max(150, 58 + contact.length * 21 + 14);
  }
  parts.push(`<line x1="${M}" y1="${y}" x2="${W - M}" y2="${y}" stroke="${RULE}" stroke-width="2"/>`);

  // --- title and reference --------------------------------------------------
  y += 54;
  const invoice = d.kind === 'invoice';
  const paid = !invoice || d.status === 'paid';
  parts.push(`<text x="${M}" y="${y}" font-size="30" font-weight="700" fill="${INK}" letter-spacing="3">${invoice ? 'INVOICE' : 'RECEIPT'}</text>`);
  const refs: Array<[string, string]> = [];
  if (d.receiptNo) refs.push([invoice ? 'Invoice no.' : 'Receipt no.', fit(d.receiptNo, 22)]);
  if (d.orderRef) refs.push([invoice ? 'Reference' : 'Order', fit(d.orderRef, 22)]);
  if (d.date) refs.push([invoice ? 'Issued' : 'Date', fit(d.date, 22)]);
  if (invoice && d.dueDate) refs.push(['Due', fit(d.dueDate, 22)]);
  refs.forEach(([k, v], i) => {
    const ly = y - 24 + i * 24;
    parts.push(`<text x="${W - M - 170}" y="${ly}" text-anchor="end" font-size="14" fill="${MUTED}">${esc(k)}</text>`);
    parts.push(`<text x="${W - M}" y="${ly}" text-anchor="end" font-size="15" font-weight="700" fill="${INK}">${esc(v)}</text>`);
  });
  y += Math.max(30, refs.length * 24 - 14);

  // --- who and how ----------------------------------------------------------
  const colW = (W - M * 2 - 24) / 2;
  const boxH = 148;
  parts.push(`<rect x="${M}" y="${y}" width="${colW}" height="${boxH}" rx="10" fill="#f9fafb" stroke="${RULE}"/>`);
  parts.push(`<rect x="${M + colW + 24}" y="${y}" width="${colW}" height="${boxH}" rx="10" fill="#f9fafb" stroke="${RULE}"/>`);

  const left = M + 20;
  parts.push(`<text x="${left}" y="${y + 30}" font-size="12" font-weight="700" fill="${FAINT}" letter-spacing="1.5">BILLED TO</text>`);
  parts.push(`<text x="${left}" y="${y + 58}" font-size="18" font-weight="700" fill="${INK}">${esc(fit(d.customerName || 'Customer', 26))}</text>`);
  const billLines = [
    d.customerPhone ? fit(d.customerPhone, 32) : '',
    ...(d.deliveryLocation ? wrap(`Deliver to: ${d.deliveryLocation}`, 34, 2) : []),
  ].filter(Boolean).slice(0, 3);
  billLines.forEach((line, i) => {
    parts.push(`<text x="${left}" y="${y + 84 + i * 21}" font-size="14" fill="${MUTED}">${esc(line)}</text>`);
  });

  const right = M + colW + 24 + 20;
  if (invoice) {
    // What is owed, by when, and where it stands.
    const state =
      d.status === 'paid' ? { label: 'PAID', bg: '#d1fae5', fg: '#065f46' }
      : d.status === 'overdue' ? { label: 'OVERDUE', bg: '#fee2e2', fg: '#991b1b' }
      : d.status === 'void' ? { label: 'CANCELLED', bg: '#e5e7eb', fg: '#374151' }
      : { label: 'AWAITING PAYMENT', bg: '#fef3c7', fg: '#92400e' };
    parts.push(`<text x="${right}" y="${y + 30}" font-size="12" font-weight="700" fill="${FAINT}" letter-spacing="1.5">${paid ? 'AMOUNT PAID' : 'AMOUNT DUE'}</text>`);
    parts.push(`<text x="${right}" y="${y + 62}" font-size="22" font-weight="700" fill="${INK}">${esc(money(d.amount, d.currency))}</text>`);
    if (d.dueDate && !paid) {
      parts.push(`<text x="${right}" y="${y + 86}" font-size="14" fill="${MUTED}">Due ${esc(fit(d.dueDate, 24))}</text>`);
    }
    const pillW = 22 + state.label.length * 8.4;
    parts.push(`<rect x="${right}" y="${y + 104}" width="${pillW}" height="22" rx="11" fill="${state.bg}"/>`);
    parts.push(`<text x="${right + pillW / 2}" y="${y + 120}" text-anchor="middle" font-size="12" font-weight="700" fill="${state.fg}">${state.label}</text>`);
  } else {
    parts.push(`<text x="${right}" y="${y + 30}" font-size="12" font-weight="700" fill="${FAINT}" letter-spacing="1.5">PAYMENT</text>`);
    parts.push(`<text x="${right}" y="${y + 58}" font-size="18" font-weight="700" fill="${INK}">${esc(fit(d.method || 'Payment received', 26))}</text>`);
    if (d.transactionCode) {
      parts.push(`<text x="${right}" y="${y + 84}" font-size="14" fill="${MUTED}">Reference: ${esc(fit(d.transactionCode, 24))}</text>`);
    }
    parts.push(`<rect x="${right}" y="${y + 104}" width="118" height="22" rx="11" fill="#d1fae5"/>`);
    parts.push(`<text x="${right + 59}" y="${y + 120}" text-anchor="middle" font-size="12" font-weight="700" fill="#065f46">VERIFIED</text>`);
  }
  y += boxH + 30;

  // --- what was bought ------------------------------------------------------
  const items = d.items.slice(0, 10);
  const colQty = 500, colUnit = 630, colAmt = W - M;
  parts.push(`<rect x="${M}" y="${y}" width="${W - M * 2}" height="38" rx="6" fill="${tint(accent, 0.9)}"/>`);
  const th = (x: number, label: string, anchor = 'start') =>
    `<text x="${x}" y="${y + 25}" text-anchor="${anchor}" font-size="12" font-weight="700" fill="${accent}" letter-spacing="1.2">${label}</text>`;
  parts.push(th(M + 14, 'DESCRIPTION'), th(colQty, 'QTY', 'end'), th(colUnit, 'UNIT PRICE', 'end'), th(colAmt - 14, 'AMOUNT', 'end'));
  y += 38;

  let subtotal = 0;
  let priced = 0;
  if (!items.length) {
    parts.push(`<text x="${M + 14}" y="${y + 30}" font-size="16" fill="${INK}">${esc(d.orderRef ? `Payment for ${fit(d.orderRef, 30)}` : 'Payment received')}</text>`);
    parts.push(`<text x="${colAmt - 14}" y="${y + 30}" text-anchor="end" font-size="16" fill="${INK}">${esc(money(d.amount, d.currency))}</text>`);
    parts.push(`<line x1="${M}" y1="${y + 46}" x2="${W - M}" y2="${y + 46}" stroke="${RULE}"/>`);
    y += 46;
  }
  for (const it of items) {
    const qty = it.qty || 1;
    const unit = it.price === null || it.price === undefined ? null : Number(it.price);
    const line = unit === null ? null : unit * qty;
    if (line !== null) { subtotal += line; priced++; }
    parts.push(`<text x="${M + 14}" y="${y + 30}" font-size="16" fill="${INK}">${esc(fit(it.name, 38))}</text>`);
    parts.push(`<text x="${colQty}" y="${y + 30}" text-anchor="end" font-size="16" fill="${INK}">${qty}</text>`);
    parts.push(`<text x="${colUnit}" y="${y + 30}" text-anchor="end" font-size="16" fill="${MUTED}">${unit === null ? '-' : esc(Number(unit).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}</text>`);
    parts.push(`<text x="${colAmt - 14}" y="${y + 30}" text-anchor="end" font-size="16" fill="${INK}">${line === null ? '-' : esc(Number(line).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}</text>`);
    parts.push(`<line x1="${M}" y1="${y + 46}" x2="${W - M}" y2="${y + 46}" stroke="${RULE}"/>`);
    y += 46;
  }
  if (d.items.length > items.length) {
    parts.push(`<text x="${M + 14}" y="${y + 26}" font-size="14" fill="${MUTED}">and ${d.items.length - items.length} more item${d.items.length - items.length === 1 ? '' : 's'}</text>`);
    y += 36;
  }

  // --- totals ---------------------------------------------------------------
  y += 22;
  const tx = W - M - 300;
  const hasAdjust = Boolean((d.discount && d.discount > 0) || (d.tax && d.tax.amount > 0));
  const showSubtotal = priced === items.length && items.length > 0 && d.amount !== null
    && (hasAdjust || Math.abs(subtotal - Number(d.amount)) > 0.005);
  const totalRow = (label: string, value: string) => {
    parts.push(`<text x="${tx}" y="${y + 18}" font-size="15" fill="${MUTED}">${esc(label)}</text>`);
    parts.push(`<text x="${W - M - 14}" y="${y + 18}" text-anchor="end" font-size="15" fill="${INK}">${esc(value)}</text>`);
    y += 30;
  };
  const stampTop = y;
  if (showSubtotal) totalRow(hasAdjust ? 'Subtotal' : 'Items total', money(subtotal, d.currency));
  if (d.discount && d.discount > 0) totalRow('Discount', `- ${money(d.discount, d.currency)}`);
  if (d.tax && d.tax.amount > 0) totalRow(fit(d.tax.label || 'Tax', 22), money(d.tax.amount, d.currency));
  if (y > stampTop) y += 4;
  parts.push(`<rect x="${tx - 16}" y="${y}" width="${316}" height="58" rx="8" fill="${accent}"/>`);
  parts.push(`<text x="${tx}" y="${y + 36}" font-size="16" font-weight="700" fill="#ffffff">${paid ? 'TOTAL PAID' : 'TOTAL DUE'}</text>`);
  parts.push(`<text x="${W - M - 14}" y="${y + 37}" text-anchor="end" font-size="22" font-weight="700" fill="#ffffff">${esc(money(d.amount, d.currency))}</text>`);

  // The mark that it is settled, set at an angle like a stamp. An invoice
  // only carries it once it has been paid.
  if (s.show_stamp !== false && paid) {
    const cx = M + 92, cy = y + 28;
    parts.push(
      `<g transform="rotate(-9 ${cx} ${cy})">` +
        `<rect x="${cx - 78}" y="${cy - 30}" width="156" height="60" rx="8" fill="none" stroke="#059669" stroke-width="3"/>` +
        `<text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="24" font-weight="700" fill="#059669" letter-spacing="4">PAID</text>` +
        `<text x="${cx}" y="${cy + 18}" text-anchor="middle" font-size="11" fill="#059669">${esc(fit(d.date || '', 20))}</text>` +
      `</g>`
    );
  }
  y += 58 + 34;

  // --- how to pay (invoices that are still owed) ---------------------------
  if (invoice && !paid && d.status !== 'void') {
    const pay = (d.payLines ?? []).flatMap((l) => wrap(l, 80, 2)).slice(0, 6);
    const terms = d.notes ? wrap(d.notes, 84, 3) : [];
    if (pay.length || terms.length) {
      const boxH2 = 22 + (pay.length ? 26 + pay.length * 22 : 0) + (terms.length ? 26 + terms.length * 21 : 0);
      parts.push(`<rect x="${M}" y="${y}" width="${W - M * 2}" height="${boxH2}" rx="10" fill="#f9fafb" stroke="${RULE}"/>`);
      let py = y + 30;
      if (pay.length) {
        parts.push(`<text x="${M + 20}" y="${py}" font-size="12" font-weight="700" fill="${FAINT}" letter-spacing="1.5">HOW TO PAY</text>`);
        py += 24;
        for (const line of pay) {
          parts.push(`<text x="${M + 20}" y="${py}" font-size="15" fill="${INK}">${esc(line)}</text>`);
          py += 22;
        }
        py += 4;
      }
      if (terms.length) {
        parts.push(`<text x="${M + 20}" y="${py}" font-size="12" font-weight="700" fill="${FAINT}" letter-spacing="1.5">TERMS</text>`);
        py += 23;
        for (const line of terms) {
          parts.push(`<text x="${M + 20}" y="${py}" font-size="14" fill="${MUTED}">${esc(line)}</text>`);
          py += 21;
        }
      }
      y += boxH2 + 30;
    }
  }

  // --- foot -----------------------------------------------------------------
  const note = wrap(s.footer_note || `Thank you for choosing ${name}.`, 84, 3);
  note.forEach((line, i) => {
    parts.push(`<text x="${W / 2}" y="${y + 20 + i * 22}" text-anchor="middle" font-size="15" fill="${INK}">${esc(line)}</text>`);
  });
  y += 20 + note.length * 22 + 10;

  parts.push(`<line x1="${M}" y1="${y}" x2="${W - M}" y2="${y}" stroke="${RULE}" stroke-width="2"/>`);
  const legal = [
    name,
    s.tax_id ? `${fit(s.tax_label || 'Tax no.', 20)} ${fit(s.tax_id, 30)}` : '',
    // With a banner the contact details were not printed above, so they go here.
    d.letterheadData ? [s.phone, s.email, s.website].filter(Boolean).join('  ·  ') : '',
    !d.letterheadData && !s.phone && !s.email && d.businessLine ? d.businessLine : '',
  ].filter(Boolean);
  wrap(legal.join('  ·  '), 96, 2).forEach((line, i) => {
    parts.push(`<text x="${W / 2}" y="${y + 28 + i * 20}" text-anchor="middle" font-size="13" fill="${MUTED}">${esc(line)}</text>`);
  });
  y += 28 + Math.max(1, wrap(legal.join('  ·  '), 96, 2).length) * 20;
  parts.push(`<text x="${W / 2}" y="${y + 6}" text-anchor="middle" font-size="12" fill="${FAINT}">Issued electronically. Valid without a signature.</text>`);
  y += 34;
  parts.push(`<rect x="0" y="${y}" width="${W}" height="8" fill="${accent}"/>`);
  y += 8;

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${y}" viewBox="0 0 ${W} ${y}" font-family="DejaVu Sans, sans-serif">` +
    `<rect width="${W}" height="${y}" fill="#ffffff"/>${parts.join('')}</svg>`;
}

/** Everything the receipt needs, from the rows a person just verified. */
export function receiptDataFrom(business: any, payment: any, order: any, lead: any): ReceiptImageData {
  const settings = receiptSettingsOf(business);
  const verified = payment?.verified_at ? new Date(payment.verified_at) : new Date();
  let date: string;
  try {
    date = verified.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: business?.timezone || 'UTC' });
  } catch {
    date = verified.toISOString().slice(0, 10);
  }
  return {
    businessName: business?.business_name || 'Receipt',
    businessLine: [settings.address, settings.phone, settings.email].filter(Boolean).join(' · ') || null,
    orderRef: order?.order_ref ?? null,
    receiptNo: payment?.id ? `RCT-${String(payment.id).replace(/-/g, '').slice(0, 8).toUpperCase()}` : null,
    customerName: lead?.customer_name ?? null,
    customerPhone: lead?.phone ?? null,
    items: (Array.isArray(order?.items) ? order.items : [])
      .map((i: any) => ({ name: String(i?.name ?? '').trim(), qty: Number(i?.qty) || 1, price: i?.price ?? null }))
      .filter((i: any) => i.name),
    amount: payment?.amount === null || payment?.amount === undefined ? null : Number(payment.amount),
    currency: String(payment?.currency || business?.currency || 'KES').toUpperCase().trim(),
    method: payment?.payment_method ?? null,
    transactionCode: payment?.transaction_code ?? null,
    deliveryLocation: order?.delivery_location ?? null,
    date,
    accent: settings.accent,
    settings,
  };
}

/** Fetch the business's letterhead or logo so the renderer can embed it. */
export async function prepareReceiptData(data: ReceiptImageData): Promise<ReceiptImageData> {
  const s = data.settings;
  if (!s) return data;
  const letterheadData = await imageDataUri(s.letterhead_url ?? null);
  // The logo is only used when there is no banner.
  const logoData = letterheadData ? null : await imageDataUri(s.logo_url ?? null);
  return { ...data, letterheadData, logoData };
}
