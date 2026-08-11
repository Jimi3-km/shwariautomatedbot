import crypto from 'node:crypto';
import { metaConfig } from '../../config/meta.js';
import { serviceClient } from '../../supabase.js';

/**
 * AES-256-GCM envelope encryption for Meta access tokens.
 *
 * Tokens are long-lived and grant message-sending rights on a customer's
 * behalf, so they are never stored in plaintext. The key lives only in the
 * server environment: reading the database alone does not yield a usable
 * token. GCM is authenticated, so tampering is detected at decrypt time.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // GCM standard nonce length
const ENVELOPE_VERSION = 1;

interface Envelope {
  v: number;
  iv: string;
  tag: string;
  data: string;
}

/** Accepts a 64-char hex or a base64 key; must decode to exactly 32 bytes. */
function loadKey(): Buffer {
  const raw = metaConfig.tokenEncryptionKey;
  if (!raw) {
    throw new Error(
      'META_TOKEN_ENCRYPTION_KEY is not set. Generate one with: openssl rand -hex 32'
    );
  }
  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64');

  if (key.length !== 32) {
    throw new Error(
      `META_TOKEN_ENCRYPTION_KEY must decode to 32 bytes (got ${key.length}). ` +
        'Generate one with: openssl rand -hex 32'
    );
  }
  return key;
}

export function encryptToken(plaintext: string): string {
  if (!plaintext) throw new Error('Refusing to encrypt an empty token');
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, loadKey(), iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const envelope: Envelope = {
    v: ENVELOPE_VERSION,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
  return JSON.stringify(envelope);
}

export function decryptToken(serialized: string): string {
  let envelope: Envelope;
  try {
    envelope = JSON.parse(serialized) as Envelope;
  } catch {
    throw new Error('Stored token is not a valid encryption envelope');
  }
  if (envelope.v !== ENVELOPE_VERSION) {
    throw new Error(`Unsupported token envelope version ${envelope.v}`);
  }
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    loadKey(),
    Buffer.from(envelope.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

// ---------------------------------------------------------------------------
// Storage — service_role only. meta_tokens has no policy for `authenticated`,
// so a compromised dashboard session cannot reach these rows at all.
// ---------------------------------------------------------------------------

export type MetaPlatform = 'whatsapp' | 'instagram' | 'facebook';

export interface StoreTokenInput {
  tenantId: string;
  platform: MetaPlatform;
  accessToken: string;
  expiresAt?: Date | null;
  phoneNumberId?: string | null;
  whatsappBusinessAccountId?: string | null;
  instagramUserId?: string | null;
  instagramUsername?: string | null;
  scopes?: string[] | null;
}

export async function storeToken(input: StoreTokenInput): Promise<void> {
  const { error } = await serviceClient.from('meta_tokens').upsert(
    {
      tenant_id: input.tenantId,
      platform: input.platform,
      access_token_encrypted: encryptToken(input.accessToken),
      token_expires_at: input.expiresAt ? input.expiresAt.toISOString() : null,
      phone_number_id: input.phoneNumberId ?? null,
      whatsapp_business_account_id: input.whatsappBusinessAccountId ?? null,
      instagram_user_id: input.instagramUserId ?? null,
      instagram_username: input.instagramUsername ?? null,
      scopes: input.scopes ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'tenant_id,platform' }
  );

  if (error) {
    // Never log the token itself.
    console.error(
      `[meta/tokens] failed to store ${input.platform} token for tenant ${input.tenantId}:`,
      { code: error.code, message: error.message }
    );
    throw new Error('Could not store the platform credential');
  }
  console.log(`[meta/tokens] stored ${input.platform} credential for tenant ${input.tenantId}`);
}

export interface LoadedToken {
  accessToken: string;
  expiresAt: Date | null;
  phoneNumberId: string | null;
  instagramUserId: string | null;
  isExpired: boolean;
}

export async function loadToken(
  tenantId: string,
  platform: MetaPlatform
): Promise<LoadedToken | null> {
  const { data, error } = await serviceClient
    .from('meta_tokens')
    .select('access_token_encrypted, token_expires_at, phone_number_id, instagram_user_id')
    .eq('tenant_id', tenantId)
    .eq('platform', platform)
    .maybeSingle();

  if (error) {
    console.error(`[meta/tokens] lookup failed for tenant ${tenantId}/${platform}:`, {
      code: error.code,
      message: error.message,
    });
    return null;
  }
  if (!data) return null;

  const expiresAt = data.token_expires_at ? new Date(data.token_expires_at) : null;
  return {
    accessToken: decryptToken(data.access_token_encrypted),
    expiresAt,
    phoneNumberId: data.phone_number_id,
    instagramUserId: data.instagram_user_id,
    isExpired: expiresAt ? expiresAt.getTime() <= Date.now() : false,
  };
}

export async function deleteToken(tenantId: string, platform: MetaPlatform): Promise<void> {
  const { error } = await serviceClient
    .from('meta_tokens')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('platform', platform);
  if (error) {
    console.error(`[meta/tokens] delete failed for tenant ${tenantId}/${platform}:`, error.message);
    throw new Error('Could not remove the platform credential');
  }
}
