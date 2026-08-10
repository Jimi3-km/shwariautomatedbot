import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabase: SupabaseClient | null = null;

/**
 * The browser is given only the project URL and anon key, fetched from the
 * server at boot. RLS decides what that key can reach, and the tenant is
 * always derived from the session on the server.
 */
export async function initSupabase(): Promise<SupabaseClient> {
  if (supabase) return supabase;
  const r = await fetch('/api/public-config');
  if (!r.ok) throw new Error('Could not load app configuration');
  const cfg = await r.json();
  if (!cfg.supabase_url || !cfg.supabase_anon_key) {
    throw new Error('Supabase is not configured on the server');
  }
  supabase = createClient(cfg.supabase_url, cfg.supabase_anon_key);
  return supabase;
}

export function getSupabase(): SupabaseClient {
  if (!supabase) throw new Error('Supabase not initialised');
  return supabase;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Every call carries the session JWT. No call ever sends a tenant_id. */
export async function api<T = any>(
  path: string,
  options: { method?: string; body?: unknown; tenantId?: string } = {}
): Promise<T> {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  // Only ever selects among tenants the user already belongs to; the server
  // rejects anything else.
  if (options.tenantId) headers['x-tenant-id'] = options.tenantId;

  const res = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await res.text();
  const json = text ? (() => { try { return JSON.parse(text); } catch { return null; } })() : null;

  if (!res.ok) {
    throw new ApiError(json?.error || `Request failed (${res.status})`, res.status, json?.code);
  }
  return json as T;
}

export const fmtMoney = (amount: unknown, currency = 'KES') => {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '—';
  return `${currency} ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};

export const fmtDate = (value: unknown) => {
  if (!value) return '—';
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export const relativeTime = (value: unknown) => {
  if (!value) return '—';
  const d = new Date(String(value)).getTime();
  if (Number.isNaN(d)) return '—';
  const mins = Math.floor((Date.now() - d) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / 1440)}d`;
};
