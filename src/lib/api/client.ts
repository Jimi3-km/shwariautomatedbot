import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabase: SupabaseClient | null = null;

/**
 * The browser receives only the project URL and the publishable anon key,
 * fetched from the server at boot. The service-role key never leaves the
 * server, and no channel secret or bot token is ever sent to the browser.
 */
export async function initSupabase(): Promise<SupabaseClient> {
  if (supabase) return supabase;
  const r = await fetch('/api/public-config');
  if (!r.ok) throw new Error('Could not load application configuration');
  const cfg = (await r.json()) as { supabase_url?: string; supabase_anon_key?: string };
  if (!cfg.supabase_url || !cfg.supabase_anon_key) {
    throw new Error('The server is not configured yet. Set the Supabase environment variables.');
  }
  supabase = createClient(cfg.supabase_url, cfg.supabase_anon_key);
  return supabase;
}

export function getSupabase(): SupabaseClient {
  if (!supabase) throw new Error('Supabase has not been initialised');
  return supabase;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
  /** True when the session is gone and the user should be sent back to sign-in. */
  get isAuthError() { return this.status === 401; }
  get isForbidden() { return this.status === 403; }
}

/** Raised when the request never reached the server. */
export class NetworkError extends Error {
  constructor() {
    super('Could not reach the server. Check your connection and try again.');
    this.name = 'NetworkError';
  }
}

let onAuthFailure: (() => void) | null = null;
export function setAuthFailureHandler(fn: () => void) { onAuthFailure = fn; }

/** The tenant chosen when a user belongs to more than one business. */
let activeTenantId: string | null = null;
export function setActiveTenant(id: string | null) { activeTenantId = id; }
export function getActiveTenant() { return activeTenantId; }

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * Single entry point for every API call.
 *
 * It attaches the session JWT and, when the user belongs to several
 * businesses, the selected tenant. It never sends a tenant_id in a body or
 * query string: the server derives tenancy from the token and rejects any
 * client-supplied tenant_id outright.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (activeTenantId) headers['x-tenant-id'] = activeTenantId;

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new NetworkError();
  }

  const text = await res.text();
  let json: any = null;
  if (text) { try { json = JSON.parse(text); } catch { /* non-JSON error page */ } }

  if (!res.ok) {
    // Never surface a raw database or stack message to the user.
    const message = typeof json?.error === 'string' && json.error.length < 300
      ? json.error
      : defaultMessage(res.status);
    if (res.status === 401) onAuthFailure?.();
    throw new ApiError(message, res.status, json?.code);
  }
  return json as T;
}

function defaultMessage(status: number): string {
  switch (status) {
    case 400: return 'That request was not valid.';
    case 401: return 'Your session has expired. Please sign in again.';
    case 403: return 'You do not have permission to do that.';
    case 404: return 'That item could not be found.';
    case 409: return 'That action conflicts with the current state.';
    case 501: return 'That feature is not available yet.';
    case 502: return 'An upstream service rejected the request.';
    default: return status >= 500 ? 'Something went wrong on our side.' : 'The request failed.';
  }
}

// Accepts plain objects and interfaces alike: an interface without an index
// signature is not assignable to Record<string, unknown>.
export function qs(params: object): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}
