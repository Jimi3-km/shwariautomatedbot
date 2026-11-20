import { serviceClient } from '../supabase.js';
import { INSTAGRAM_GRAPH_URL } from '../config/meta.js';
import { loadToken } from './meta/tokens.js';

/**
 * What to call a customer before they have told us their name.
 *
 * The raw channel id is useless to a person reading the Inbox: Instagram's is
 * a 16-digit number and web chat's is a random string. Each channel has
 * something recognisable instead:
 *
 *   Instagram   the @username, looked up from Instagram
 *   WhatsApp    the phone number, written as a phone number
 *   Web chat    a short visitor code in front of the business's name
 *
 * This is a label for the conversation, not a name: the agents never greet
 * someone by it (see isIdentityLabel).
 */

/** "+254712345678" from whatever digits WhatsApp gave us. */
export function phoneLabel(customerId: string): string {
  const digits = String(customerId).replace(/[^\d]/g, '');
  return digits ? `+${digits}` : String(customerId);
}

/** "V-7F2A9C · Glamour Crown Wigs": a stable short code from the visitor id. */
export function webchatLabel(customerId: string, siteName: string | null | undefined): string {
  const raw = String(customerId).replace(/^web_/i, '').replace(/[^a-z0-9]/gi, '');
  const code = (raw.slice(-6) || '000000').toUpperCase();
  const site = (siteName ?? '').trim();
  return site ? `V-${code} · ${site}` : `V-${code}`;
}

/** True for a label made here, as opposed to a name a person gave. */
export function isIdentityLabel(name: string | null | undefined): boolean {
  const n = (name ?? '').trim();
  return !n || /^@[\w.]+$/.test(n) || /^\+\d{6,}$/.test(n) || /^V-[A-Z0-9]{4,}\b/.test(n);
}

async function instagramUsername(tenantId: string, igScopedId: string): Promise<string | null> {
  try {
    const token = await loadToken(tenantId, 'instagram');
    if (!token || token.isExpired) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const params = new URLSearchParams({ fields: 'username,name', access_token: token.accessToken });
      const res = await fetch(`${INSTAGRAM_GRAPH_URL}/${encodeURIComponent(igScopedId)}?${params}`, { signal: controller.signal });
      if (!res.ok) return null;
      const json = (await res.json()) as { username?: string };
      return json.username ? `@${json.username}` : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/**
 * The label for a customer on a channel, or null when the channel's own name
 * (Telegram, a WhatsApp profile name) is already good enough.
 */
export async function identityLabel(input: {
  tenantId: string; channelType: string; customerId: string; profileName?: string | null;
}): Promise<string | null> {
  const profile = (input.profileName ?? '').trim();
  switch (input.channelType) {
    case 'instagram':
      return (await instagramUsername(input.tenantId, input.customerId)) ?? (profile || null);
    case 'whatsapp':
      return profile ? `${profile} (${phoneLabel(input.customerId)})` : phoneLabel(input.customerId);
    case 'webchat': {
      if (profile) return profile;
      const { data } = await serviceClient.from('tenants').select('business_name').eq('id', input.tenantId).maybeSingle();
      return webchatLabel(input.customerId, (data as any)?.business_name ?? null);
    }
    default:
      return profile || null;
  }
}
