import type { TenantContext } from '../auth.js';

/**
 * Validation for ids a client sends that point at other rows.
 *
 * RLS already stops a row being written into another tenant, but it says
 * nothing about a row in *this* tenant pointing at a lead or conversation in
 * another one: the foreign key only checks that the target exists. Each
 * reference is therefore looked up through the caller's own client, scoped to
 * their tenant, before it is stored.
 */

export class RefError extends Error {
  status = 400;
}

/** Channel-side customer identifier (chat id, phone, visitor id). Text, bounded. */
export function customerIdOrNull(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new RefError('customer_id must be text');
  }
  const s = String(value).trim();
  if (!s) return null;
  if (s.length > 128) throw new RefError('customer_id is too long');
  return s;
}

/** Optional short free text. */
export function textOrNull(value: unknown, max: number, field: string): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new RefError(`${field} must be text`);
  return value.slice(0, max);
}

async function ownedRef(
  ctx: TenantContext,
  table: 'leads' | 'conversations',
  value: unknown,
  field: string
): Promise<string | number | null> {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new RefError(`${field} is not valid`);
  }
  if (typeof value === 'string' && !/^[A-Za-z0-9-]{1,64}$/.test(value)) {
    throw new RefError(`${field} is not valid`);
  }
  const { data, error } = await ctx.db
    .from(table)
    .select('id')
    .eq('id', value)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  if (error || !data) throw new RefError(`${field} does not refer to a record in this business`);
  return data.id as string | number;
}

export const leadIdOrNull = (ctx: TenantContext, value: unknown) =>
  ownedRef(ctx, 'leads', value, 'lead_id');

export const conversationIdOrNull = (ctx: TenantContext, value: unknown) =>
  ownedRef(ctx, 'conversations', value, 'conversation_id');

/** Strips everything that has meaning inside a PostgREST `or=()` filter. */
export function searchTerm(value: unknown): string {
  return String(value ?? '')
    .replace(/[%,()"\\*:]/g, '')
    .trim()
    .slice(0, 80);
}
