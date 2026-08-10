import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export function assertSupabaseConfigured() {
  const missing = [
    !SUPABASE_URL && 'SUPABASE_URL',
    !SUPABASE_ANON_KEY && 'SUPABASE_ANON_KEY',
    !SUPABASE_SERVICE_ROLE_KEY && 'SUPABASE_SERVICE_ROLE_KEY',
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(
      `Supabase is not configured. Missing: ${missing.join(', ')}. ` +
        `The API refuses to start unconfigured rather than serving requests without authentication.`
    );
  }
}

/**
 * Privileged client. Bypasses RLS, so it is only for operations that
 * legitimately cross or establish tenancy:
 *   - verifying a JWT
 *   - resolving auth.uid() -> tenant_users
 *   - creating a tenant + owner row at signup
 *   - reading/writing channel secrets
 * Every other read/write must go through userClient() so RLS applies.
 */
let _serviceClient: SupabaseClient | null = null;

function getServiceClient(): SupabaseClient {
  if (!_serviceClient) {
    assertSupabaseConfigured();
    _serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _serviceClient;
}

/**
 * Constructed lazily so that a missing configuration surfaces as the explicit
 * message from assertSupabaseConfigured rather than an opaque error thrown
 * from inside supabase-js at import time.
 */
export const serviceClient: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getServiceClient() as any;
    const value = client[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

/**
 * Per-request client carrying the caller's JWT. PostgREST runs as the
 * `authenticated` role, so the RLS policies added in
 * supabase/migrations/20260810_0001_tenant_rls.sql are enforced by the
 * database. This is the second of the two independent layers of tenant
 * isolation; the first is the explicit .eq('tenant_id', ...) in each route.
 */
export function userClient(accessToken: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export { SUPABASE_URL, SUPABASE_ANON_KEY };
