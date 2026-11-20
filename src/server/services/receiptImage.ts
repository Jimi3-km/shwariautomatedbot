import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { publicApiUrl } from '../config/publicUrl.js';

/**
 * A receipt as a picture.
 *
 * Customers screenshot and forward receipts; a block of text in a chat is not
 * something they can show anyone. The receipt is drawn as an SVG from the same
 * verified figures as the text one and rendered to a PNG, which the chat
 * channels send as a photo.
 *
 * The image is served from a signed address rather than stored: Telegram,
 * Instagram and WhatsApp all fetch a photo from a URL, and the signature means
 * that URL only ever resolves for the payment it was made for.
 */

export interface ReceiptImageData {
  businessName: string;
  businessLine?: string | null;
  orderRef?: string | null;
  customerName?: string | null;
  items: Array<{ name: string; qty: number; price?: number | null }>;
  amount: number | null;
  currency: string;
  method?: string | null;
  transactionCode?: string | null;
  deliveryLocation?: string | null;
  date?: string | null;
  accent?: string | null;
}

const esc = (v: unknown) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const money = (n: number | null | undefined, currency: string) =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? '-'
    : `${currency} ${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

/** Cut text to roughly fit a width; the renderer has no text wrapping. */
function fit(text: string, max: number): string {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function receiptSvg(d: ReceiptImageData): string {
  const W = 720;
  const accent = /^#[0-9a-fA-F]{3,8}$/.test(String(d.accent ?? '')) ? String(d.accent) : '#1a1a2e';
  const rows: Array<[string, string]> = [];
  if (d.customerName) rows.push(['Customer', fit(d.customerName, 40)]);
  if (d.method || d.transactionCode) rows.push(['Paid by', fit([d.method, d.transactionCode].filter(Boolean).join(' · '), 40)]);
  if (d.deliveryLocation) rows.push(['Delivery to', fit(d.deliveryLocation, 40)]);
  if (d.date) rows.push(['Date', fit(d.date, 40)]);

  const items = d.items.slice(0, 8);
  let y = 0;
  const parts: string[] = [];

  // Header
  parts.push(`<rect width="${W}" height="150" fill="${esc(accent)}"/>`);
  parts.push(`<text x="${W / 2}" y="68" text-anchor="middle" font-size="34" font-weight="700" fill="#ffffff">${esc(fit(d.businessName, 34))}</text>`);
  parts.push(`<text x="${W / 2}" y="106" text-anchor="middle" font-size="19" fill="#d9d9e3">Payment receipt</text>`);
  y = 150;

  // Reference band
  parts.push(`<rect x="40" y="${y + 30}" width="${W - 80}" height="96" rx="12" fill="#f0f4ff"/>`);
  parts.push(`<rect x="40" y="${y + 30}" width="6" height="96" fill="${esc(accent)}"/>`);
  parts.push(`<text x="68" y="${y + 66}" font-size="17" fill="#6b7280">Order reference</text>`);
  parts.push(`<text x="68" y="${y + 102}" font-size="27" font-weight="700" fill="#111827">${esc(fit(d.orderRef || 'Payment', 26))}</text>`);
  parts.push(`<rect x="${W - 262}" y="${y + 58}" width="194" height="40" rx="20" fill="#d1fae5"/>`);
  parts.push(`<text x="${W - 165}" y="${y + 85}" text-anchor="middle" font-size="18" font-weight="700" fill="#065f46">Payment verified</text>`);
  y += 156;

  // Items
  if (items.length) {
    parts.push(`<text x="40" y="${y + 30}" font-size="16" font-weight="700" fill="#6b7280">ITEMS</text>`);
    y += 46;
    for (const it of items) {
      const label = `${it.qty > 1 ? `${it.qty} x ` : ''}${it.name}`;
      parts.push(`<text x="40" y="${y + 24}" font-size="21" fill="#111827">${esc(fit(label, 38))}</text>`);
      if (it.price !== null && it.price !== undefined) {
        parts.push(`<text x="${W - 40}" y="${y + 24}" text-anchor="end" font-size="21" fill="#111827">${esc(money(Number(it.price) * (it.qty || 1), d.currency))}</text>`);
      }
      parts.push(`<line x1="40" y1="${y + 42}" x2="${W - 40}" y2="${y + 42}" stroke="#eef0f3" stroke-width="2"/>`);
      y += 52;
    }
  }

  // Details
  for (const [k, v] of rows) {
    parts.push(`<text x="40" y="${y + 30}" font-size="19" fill="#6b7280">${esc(k)}</text>`);
    parts.push(`<text x="${W - 40}" y="${y + 30}" text-anchor="end" font-size="19" fill="#111827">${esc(v)}</text>`);
    y += 42;
  }

  // Total
  y += 14;
  parts.push(`<line x1="40" y1="${y}" x2="${W - 40}" y2="${y}" stroke="#111827" stroke-width="2"/>`);
  parts.push(`<text x="40" y="${y + 48}" font-size="25" font-weight="700" fill="#111827">Total paid</text>`);
  parts.push(`<text x="${W - 40}" y="${y + 48}" text-anchor="end" font-size="29" font-weight="700" fill="#111827">${esc(money(d.amount, d.currency))}</text>`);
  y += 84;

  // Footer
  parts.push(`<rect x="0" y="${y}" width="${W}" height="92" fill="#fafafa"/>`);
  parts.push(`<text x="${W / 2}" y="${y + 40}" text-anchor="middle" font-size="18" fill="#6b7280">Thank you for choosing ${esc(fit(d.businessName, 34))}</text>`);
  if (d.businessLine) {
    parts.push(`<text x="${W / 2}" y="${y + 68}" text-anchor="middle" font-size="15" fill="#9ca3af">${esc(fit(d.businessLine, 70))}</text>`);
  }
  y += 92;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${y}" viewBox="0 0 ${W} ${y}" font-family="DejaVu Sans, sans-serif">` +
    `<rect width="${W}" height="${y}" fill="#ffffff"/>${parts.join('')}</svg>`;
}

/** Where the bundled font may be, across local runs and the deployed function. */
function fontFiles(): string[] {
  const names = ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf'];
  const dirs: string[] = [path.join(process.cwd(), 'node_modules', 'dejavu-fonts-ttf', 'ttf')];
  try {
    const require = createRequire(import.meta.url);
    dirs.unshift(path.dirname(require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf')));
  } catch { /* fall back to the working directory */ }
  for (const dir of dirs) {
    const found = names.map((n) => path.join(dir, n)).filter((p) => fs.existsSync(p));
    if (found.length) return found;
  }
  return [];
}

/**
 * Render to PNG. Returns null when the renderer or its font is unavailable:
 * a receipt image with no legible text is worse than none, and the text
 * receipt has already been sent.
 */
export async function renderReceiptPng(data: ReceiptImageData): Promise<Buffer | null> {
  try {
    const fonts = fontFiles();
    if (!fonts.length) {
      console.warn('[receipt-image] no font file found; skipping the image');
      return null;
    }
    const { Resvg } = await import('@resvg/resvg-js');
    const resvg = new Resvg(receiptSvg(data), {
      font: { fontFiles: fonts, loadSystemFonts: false, defaultFontFamily: 'DejaVu Sans' },
      fitTo: { mode: 'width', value: 1080 },
      background: '#ffffff',
    });
    return Buffer.from(resvg.render().asPng());
  } catch (e) {
    console.warn('[receipt-image] could not render:', e instanceof Error ? e.message : e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// The signed address
// ---------------------------------------------------------------------------

function signingKey(): string {
  return process.env.INTERNAL_API_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

export function signReceipt(paymentId: string): string {
  return crypto.createHmac('sha256', signingKey()).update(`receipt:${paymentId}`).digest('base64url').slice(0, 32);
}

export function receiptSignatureOk(paymentId: string, sig: unknown): boolean {
  if (!signingKey() || typeof sig !== 'string' || sig.length !== 32) return false;
  const expected = signReceipt(paymentId);
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

/** The public address a channel fetches the receipt photo from, or null. */
export function receiptImageUrl(paymentId: string): string | null {
  const origin = publicApiUrl();
  if (!origin || !signingKey()) return null;
  return `${origin}/api/receipts/image/${encodeURIComponent(paymentId)}.png?sig=${signReceipt(paymentId)}`;
}

/** Everything the image needs, from the rows a person just verified. */
export function receiptDataFrom(business: any, payment: any, order: any, lead: any): ReceiptImageData {
  const contact = business?.contact_info ?? {};
  const line = [business?.address, contact.phone ?? contact.Phone, contact.email ?? contact.Email].filter(Boolean).join(' · ');
  const verified = payment?.verified_at ? new Date(payment.verified_at) : new Date();
  let date: string;
  try {
    date = verified.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: business?.timezone || 'UTC' });
  } catch {
    date = verified.toISOString().slice(0, 10);
  }
  return {
    businessName: business?.business_name || 'Receipt',
    businessLine: line || null,
    orderRef: order?.order_ref ?? null,
    customerName: lead?.customer_name ?? null,
    items: (Array.isArray(order?.items) ? order.items : [])
      .map((i: any) => ({ name: String(i?.name ?? '').trim(), qty: Number(i?.qty) || 1, price: i?.price ?? null }))
      .filter((i: any) => i.name),
    amount: payment?.amount === null || payment?.amount === undefined ? null : Number(payment.amount),
    currency: String(payment?.currency || business?.currency || 'KES').toUpperCase().trim(),
    method: payment?.payment_method ?? null,
    transactionCode: payment?.transaction_code ?? null,
    deliveryLocation: order?.delivery_location ?? null,
    date,
    accent: business?.branding?.accent_color ?? null,
  };
}
