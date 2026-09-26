import crypto from 'node:crypto';
import { serviceClient } from '../supabase.js';

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

/**
 * Runs an action with strict idempotency backed by the PostgreSQL idempotency_keys table.
 */
export async function withIdempotency<T>(
  tenantId: string,
  idempotencyKey: string,
  actionName: string,
  operation: () => Promise<T>
): Promise<T> {
  // Check existing
  const { data: existing } = await serviceClient
    .from('idempotency_keys')
    .select('status, response_body')
    .eq('tenant_id', tenantId)
    .eq('key', idempotencyKey)
    .maybeSingle();

  if (existing) {
    if (existing.status === 'completed') {
      return existing.response_body as T;
    }
    if (existing.status === 'processing') {
      throw new ConflictError('A request with this idempotency key is already actively processing.');
    }
  }

  // Register processing claim
  await serviceClient.from('idempotency_keys').upsert({
    tenant_id: tenantId,
    key: idempotencyKey,
    action: actionName,
    status: 'processing',
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  });

  try {
    const result = await operation();

    // Mark completed
    await serviceClient
      .from('idempotency_keys')
      .update({
        status: 'completed',
        response_body: result as unknown as Record<string, unknown>,
      })
      .eq('tenant_id', tenantId)
      .eq('key', idempotencyKey);

    return result;
  } catch (error) {
    await serviceClient
      .from('idempotency_keys')
      .update({ status: 'failed' })
      .eq('tenant_id', tenantId)
      .eq('key', idempotencyKey);
    throw error;
  }
}

export function hashPayload(data: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(data ?? {})).digest('hex');
}
