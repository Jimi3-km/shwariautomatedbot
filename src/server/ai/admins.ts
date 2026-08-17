import crypto from 'node:crypto';
import { serviceClient } from '../supabase.js';

/**
 * Who is allowed to administer a business by chat.
 *
 * Answering a customer and reconfiguring a business are not the same act, so
 * they do not share an authorisation. A message arriving on Telegram carries no
 * session and no proof of identity beyond a chat id, and a chat id is not a
 * credential — anyone can message a bot.
 *
 * So the owner mints a short-lived code in the dashboard, where they *are*
 * authenticated, and sends it once from the account they want to use. Redeeming
 * it binds that chat identity to that user and tenant. Everything after that is
 * a lookup, not a guess.
 */

const CODE_TTL_MINUTES = 15;
/** No 0/O/1/I: this gets read off a screen and typed into a phone. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function looksLikePairingCode(text: string): boolean {
  return /^[A-Za-z0-9]{8}$/.test(text.trim());
}

function newCode(): string {
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export interface IssuedCode {
  code: string;
  expiresAt: string;
}

/**
 * Mint a pairing code for a signed-in admin.
 *
 * Any code this user still has outstanding is dropped first, so a code read
 * aloud from an old screenshot cannot be used later.
 */
export async function issuePairingCode(tenantId: string, userId: string): Promise<IssuedCode> {
  await serviceClient
    .from('shwari_pairing_codes')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .is('used_at', null);

  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString();

  // The alphabet is small enough that a collision is possible, if unlikely.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    const { error } = await serviceClient
      .from('shwari_pairing_codes')
      .insert({ code, tenant_id: tenantId, user_id: userId, expires_at: expiresAt });

    if (!error) return { code, expiresAt };
    if (error.code !== '23505') throw new Error(error.message);
  }
  throw new Error('could not allocate a pairing code');
}

export interface AdminLink {
  tenantId: string;
  userId: string;
}

/** Is this chat identity an administrator, and of which business? */
export async function findAdmin(
  channelType: string,
  customerId: string
): Promise<AdminLink | null> {
  const { data } = await serviceClient
    .from('shwari_admins')
    .select('tenant_id, user_id')
    .eq('channel_type', channelType)
    .eq('customer_id', customerId)
    .maybeSingle();

  return data ? { tenantId: data.tenant_id, userId: data.user_id } : null;
}

/**
 * One flat shape rather than a discriminated union: this project compiles with
 * `strict` off, so narrowing on `ok` does not actually narrow and the callers
 * fail to see `reason` at all.
 */
export interface RedeemResult {
  ok: boolean;
  link?: AdminLink;
  reason?: 'unknown' | 'expired' | 'used' | 'other_tenant';
}

/**
 * Redeem a code for a chat identity.
 *
 * The code is marked used before the link is written: a code that raced two
 * redemptions must only ever bind one identity.
 */
export async function redeemPairingCode(
  code: string,
  channelType: string,
  customerId: string,
  /** The tenant that owns the channel the code arrived on. */
  arrivingTenantId: string
): Promise<RedeemResult> {
  const { data: row } = await serviceClient
    .from('shwari_pairing_codes')
    .select('code, tenant_id, user_id, expires_at, used_at')
    .eq('code', code.trim().toUpperCase())
    .maybeSingle();

  if (!row) return { ok: false, reason: 'unknown' };
  if (row.used_at) return { ok: false, reason: 'used' };
  if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, reason: 'expired' };

  // A code is only valid on a channel its own business owns. Without this, an
  // owner could paste their code into someone else's bot and hand that bot
  // administrative reach into their business.
  if (row.tenant_id !== arrivingTenantId) return { ok: false, reason: 'other_tenant' };

  const { data: claimed } = await serviceClient
    .from('shwari_pairing_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('code', row.code)
    .is('used_at', null)
    .select('code')
    .maybeSingle();

  if (!claimed) return { ok: false, reason: 'used' };

  const { error } = await serviceClient.from('shwari_admins').upsert(
    {
      tenant_id: row.tenant_id,
      user_id: row.user_id,
      channel_type: channelType,
      customer_id: customerId,
    },
    { onConflict: 'channel_type,customer_id' }
  );
  if (error) throw new Error(error.message);

  return { ok: true, link: { tenantId: row.tenant_id, userId: row.user_id } };
}
