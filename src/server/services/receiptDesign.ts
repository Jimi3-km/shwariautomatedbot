import { SUPABASE_URL } from '../supabase.js';

/**
 * How a business's receipts look.
 *
 * The owner sets these under Settings > Receipts: a letterhead or logo, the
 * contact details to print, a tax number, a closing note and a colour. They
 * are kept in tenants.branding.receipt and used by all three forms of the
 * receipt: the picture sent in chat, the email, and the printable page.
 */

export interface ReceiptSettings {
  /** A full-width banner across the top. When set it replaces the logo and name. */
  letterhead_url: string | null;
  /** A square mark shown beside the business name. */
  logo_url: string | null;
  /** The name printed on the receipt, when it differs from the business name. */
  display_name: string | null;
  tagline: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  /** A tax or registration number, printed with its own label. */
  tax_label: string | null;
  tax_id: string | null;
  /** A closing line: returns policy, thanks, opening hours. */
  footer_note: string | null;
  accent: string | null;
  /** Print a PAID mark. */
  show_stamp: boolean;
}

export const RECEIPT_TEXT_LIMITS: Record<string, number> = {
  display_name: 60, tagline: 90, address: 140, phone: 40, email: 120, website: 120,
  tax_label: 24, tax_id: 40, footer_note: 240,
};

const TEXT_KEYS = Object.keys(RECEIPT_TEXT_LIMITS) as Array<keyof ReceiptSettings>;

const clean = (v: unknown, max: number): string | null => {
  const s = String(v ?? '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  return s || null;
};

export const validAccent = (v: unknown): string | null =>
  /^#[0-9a-fA-F]{6}$/.test(String(v ?? '')) ? String(v).toLowerCase() : null;

/** Only pictures this platform stored itself are ever fetched or shown. */
export function ownMediaUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !SUPABASE_URL) return null;
  return url.startsWith(`${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/post-media/receipts/`) ? url : null;
}

/** The settings as stored, with nothing invented. */
export function storedReceiptSettings(business: any): ReceiptSettings {
  const r = (business?.branding?.receipt ?? {}) as Record<string, unknown>;
  const out: any = {
    letterhead_url: ownMediaUrl(r.letterhead_url),
    logo_url: ownMediaUrl(r.logo_url),
    accent: validAccent(r.accent) ?? validAccent(business?.branding?.accent_color),
    show_stamp: r.show_stamp !== false,
  };
  for (const k of TEXT_KEYS) out[k] = clean(r[k], RECEIPT_TEXT_LIMITS[k as string]);
  return out as ReceiptSettings;
}

/**
 * The settings a receipt is drawn with: what the owner set, falling back to
 * what the business already has on record so a receipt is never bare.
 */
export function receiptSettingsOf(business: any): ReceiptSettings {
  const s = storedReceiptSettings(business);
  const contact = (business?.contact_info ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = contact[k] ?? contact[k.toLowerCase()] ?? contact[k[0].toUpperCase() + k.slice(1)];
      if (v) return String(v);
    }
    return null;
  };
  return {
    ...s,
    address: s.address ?? clean(business?.address, 140),
    phone: s.phone ?? clean(pick('phone', 'whatsapp', 'mobile'), 40),
    email: s.email ?? clean(pick('email'), 120),
    website: s.website ?? clean(pick('website', 'site', 'url'), 120),
  };
}

/** Apply an edit from the settings page onto what is stored. Unknown keys are ignored. */
export function mergeReceiptSettings(business: any, patch: Record<string, unknown>): Record<string, unknown> {
  const current = { ...((business?.branding?.receipt ?? {}) as Record<string, unknown>) };
  for (const k of TEXT_KEYS) {
    if (k in patch) current[k as string] = clean(patch[k as string], RECEIPT_TEXT_LIMITS[k as string]);
  }
  if ('accent' in patch) current.accent = validAccent(patch.accent);
  if ('show_stamp' in patch) current.show_stamp = patch.show_stamp !== false;
  // Pictures are set by the upload route only; here they can only be cleared.
  if (patch.logo_url === null) current.logo_url = null;
  if (patch.letterhead_url === null) current.letterhead_url = null;
  return current;
}

/**
 * Fetch a stored picture and return it as a data address the renderer can
 * embed. Null when it is not ours, too large, or cannot be read in time.
 */
export async function imageDataUri(url: string | null): Promise<string | null> {
  const safe = ownMediaUrl(url);
  if (!safe) return null;
  try {
    const res = await fetch(safe, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (type !== 'image/png' && type !== 'image/jpeg') return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 2_500_000) return null;
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}
