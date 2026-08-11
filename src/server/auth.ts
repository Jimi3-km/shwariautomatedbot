import type { NextFunction, Request, Response } from 'express';
import { serviceClient, userClient } from './supabase.js';
import type { SupabaseClient } from '@supabase/supabase-js';

export type Role = 'owner' | 'admin' | 'member' | 'viewer';

export interface TenantContext {
  userId: string;
  email: string | null;
  tenantId: string;
  role: Role;
  accessToken: string;
  /** RLS-enforcing client scoped to the caller. Use this for all tenant data. */
  db: SupabaseClient;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      ctx?: TenantContext;
    }
  }
}

const ROLE_RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

function bearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  const t = h.slice(7).trim();
  return t.length ? t : null;
}

/**
 * Resolves the caller to exactly one tenant.
 *
 * The tenant is derived server-side from the verified JWT via tenant_users.
 * Any tenant_id present in the request body, query or headers is ignored --
 * see rejectClientTenantId below, which turns an attempt into a 400 rather
 * than silently dropping it.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = bearer(req);
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: missing bearer token' });
  }

  const { data, error } = await serviceClient.auth.getUser(token);
  if (error || !data?.user) {
    return res.status(401).json({ error: 'Unauthorized: invalid or expired token' });
  }
  const user = data.user;

  // Tenant membership is read with the service client because a user who is
  // not yet a member of any tenant cannot see tenant_users under RLS.
  const { data: memberships, error: mErr } = await serviceClient
    .from('tenant_users')
    .select('tenant_id, role')
    .eq('user_id', user.id);

  if (mErr) {
    // This was previously swallowed, which made a 42501 "permission denied for
    // table tenant_users" indistinguishable from any other failure. Log the
    // database error (never the token) so the cause is visible in the server
    // log rather than only as an opaque 500.
    console.error(
      `[auth] tenant membership lookup failed for user ${user.id}:`,
      { code: mErr.code, message: mErr.message, details: mErr.details, hint: mErr.hint }
    );
    return res.status(500).json({
      error: 'Failed to resolve tenant membership',
      code: 'MEMBERSHIP_LOOKUP_FAILED',
    });
  }
  if (!memberships || memberships.length === 0) {
    return res.status(403).json({ error: 'No tenant is associated with this account', code: 'NO_TENANT' });
  }

  // A user may belong to several tenants. Selection is by an explicit header,
  // but only ever among tenants they actually belong to -- the header can
  // never introduce a tenant that is not in this list.
  const requested = req.headers['x-tenant-id'];
  let chosen = memberships[0];
  if (typeof requested === 'string' && requested) {
    const match = memberships.find((m) => m.tenant_id === requested);
    if (!match) {
      return res.status(403).json({ error: 'Not a member of the requested tenant' });
    }
    chosen = match;
  }

  req.ctx = {
    userId: user.id,
    email: user.email ?? null,
    tenantId: chosen.tenant_id,
    role: chosen.role as Role,
    accessToken: token,
    db: userClient(token),
  };
  next();
}

/** Rejects any request that tries to steer tenancy from the client. */
export function rejectClientTenantId(req: Request, res: Response, next: NextFunction) {
  const inBody = req.body && typeof req.body === 'object' && 'tenant_id' in req.body;
  const inQuery = req.query && 'tenant_id' in req.query;
  if (inBody || inQuery) {
    return res.status(400).json({
      error: 'tenant_id may not be supplied by the client; it is derived from your session',
    });
  }
  next();
}

export function requireRole(min: Role) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ctx = req.ctx;
    if (!ctx) return res.status(401).json({ error: 'Unauthorized' });
    if (ROLE_RANK[ctx.role] < ROLE_RANK[min]) {
      return res.status(403).json({ error: `Requires ${min} role or higher; you are ${ctx.role}` });
    }
    next();
  };
}

/** Writes require at least `member`; viewers are read-only. */
export const requireWrite = requireRole('member');
export const requireAdmin = requireRole('admin');

/** Wraps an async handler so a rejected promise becomes a 500, not a hang. */
export function handler(
  fn: (req: Request, res: Response) => Promise<unknown>
) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((err) => {
      console.error(`[api] ${req.method} ${req.path}`, err);
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
    });
  };
}
