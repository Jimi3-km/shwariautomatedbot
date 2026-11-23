import { pixelsToPdf } from './pdf.js';
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

import { receiptSvg, prepareReceiptData, type ReceiptImageData } from './receiptLayout.js';

// The layout itself lives in receiptLayout.ts; this file renders it and
// signs the address it is served from.
export { receiptSvg, receiptDataFrom, prepareReceiptData } from './receiptLayout.js';
export type { ReceiptImageData } from './receiptLayout.js';

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
    // The letterhead or logo is fetched here, so every caller gets it.
    const ready = data.letterheadData !== undefined || data.logoData !== undefined ? data : await prepareReceiptData(data);
    const resvg = new Resvg(receiptSvg(ready), {
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

/**
 * The same document as a PDF. Rendered a little larger than the chat picture
 * so it prints cleanly. Null on the same conditions as the picture.
 */
export async function renderDocumentPdf(data: ReceiptImageData, title: string): Promise<Buffer | null> {
  try {
    const fonts = fontFiles();
    if (!fonts.length) {
      console.warn('[receipt-image] no font file found; skipping the PDF');
      return null;
    }
    const { Resvg } = await import('@resvg/resvg-js');
    const ready = data.letterheadData !== undefined || data.logoData !== undefined ? data : await prepareReceiptData(data);
    const resvg = new Resvg(receiptSvg(ready), {
      font: { fontFiles: fonts, loadSystemFonts: false, defaultFontFamily: 'DejaVu Sans' },
      fitTo: { mode: 'width', value: 1240 },
      background: '#ffffff',
    });
    const rendered = resvg.render();
    return pixelsToPdf(rendered.pixels, rendered.width, rendered.height, title);
  } catch (e) {
    console.warn('[receipt-image] could not render the PDF:', e instanceof Error ? e.message : e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// The signed address
// ---------------------------------------------------------------------------

function signingKey(): string {
  return process.env.INTERNAL_API_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

/** A signature for any document address: `scope` keeps one kind from opening another. */
export function signDocument(scope: string, id: string): string {
  return crypto.createHmac('sha256', signingKey()).update(`${scope}:${id}`).digest('base64url').slice(0, 32);
}

export function documentSignatureOk(scope: string, id: string, sig: unknown): boolean {
  if (!signingKey() || typeof sig !== 'string' || sig.length !== 32) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(signDocument(scope, id)));
}

/** The public address of a receipt as a PDF, or null. */
export function receiptPdfUrl(paymentId: string): string | null {
  const origin = publicApiUrl();
  if (!origin || !signingKey()) return null;
  return `${origin}/api/receipts/pdf/${encodeURIComponent(paymentId)}.pdf?sig=${signDocument('receipt-pdf', paymentId)}`;
}

/** The public address of an invoice as a PDF, or null. */
export function invoicePdfUrl(invoiceId: string): string | null {
  const origin = publicApiUrl();
  if (!origin || !signingKey()) return null;
  return `${origin}/api/invoices/pdf/${encodeURIComponent(invoiceId)}.pdf?sig=${signDocument('invoice-pdf', invoiceId)}`;
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
