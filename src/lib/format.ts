/**
 * Formatting helpers. Currency is always passed in from the tenant record;
 * there is deliberately no hardcoded default, so a missing currency shows as
 * a bare number rather than silently claiming the wrong one.
 */

export function formatMoney(amount: unknown, currency?: string | null): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '—';
  const value = n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return currency ? `${currency} ${value}` : value;
}

export function formatDate(value: unknown): string {
  if (!value) return '—';
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(value: unknown): string {
  if (!value) return '—';
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function relativeTime(value: unknown): string {
  if (!value) return '—';
  const t = new Date(String(value)).getTime();
  if (Number.isNaN(t)) return '—';
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  if (mins < 10080) return `${Math.floor(mins / 1440)}d`;
  return formatDate(value);
}

/** "payment_claimed" -> "Payment claimed" */
export function humanize(value: string | null | undefined): string {
  if (!value) return '—';
  const s = value.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function initials(name: string | null | undefined, fallback = '?'): string {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return fallback;
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

/** Deterministic avatar tint so the same customer keeps the same colour. */
export function avatarColor(seed: string | null | undefined): string {
  const palette = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6'];
  if (!seed) return palette[0];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

/**
 * What to call a customer on screen.
 *
 * Their name when we have one. Otherwise something a person can read: a phone
 * number for WhatsApp, and for platforms that only give a long internal id
 * (Instagram, Messenger, Telegram, web chat) the platform and the id's last
 * four characters, never the raw id as if it were a name.
 */
export function customerLabel(c: { customer_name?: string | null; customer_id?: string | null; channel_type?: string | null }): string {
  const name = (c.customer_name ?? '').trim();
  const id = (c.customer_id ?? '').trim();
  const looksLikeId = (v: string) => /^[0-9a-f_-]{9,}$/i.test(v) && !/[g-z]/i.test(v.replace(/[_-]/g, ''));
  if (name && !looksLikeId(name)) return name;
  const raw = name || id;
  if (!raw) return 'Customer';
  const tail = raw.slice(-4);
  switch (c.channel_type) {
    case 'whatsapp': return /^\d{8,15}$/.test(raw) ? `+${raw}` : raw;
    case 'instagram': return `Instagram customer ··${tail}`;
    case 'facebook': return `Messenger customer ··${tail}`;
    case 'telegram': return `Telegram customer ··${tail}`;
    case 'webchat': return `Website visitor ··${tail}`;
    default: return looksLikeId(raw) ? `Customer ··${tail}` : raw;
  }
}
