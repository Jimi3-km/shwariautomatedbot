import type { NextFunction, Request, Response } from 'express';
import { serviceClient, userClient } from './supabase.js';
import type { SupabaseClient } from '@supabase/supabase-js';

export type Role = 'owner' | 'admin' | 'member' | 'viewer';

export interface TenantContext {
  userId: string;
  email: string | null;
  /** True only when Supabase Auth has confirmed the address. */
  emailVerified: boolean;
  tenantId: string;
  role: Role;
  accessToken: string;
  /** RLS-enforcing client scoped to the caller. Use this for all tenant data. */
  db: SupabaseClient;
  /** Runs the platform (a row in platform_admins). Never set from the app. */
  platformAdmin: boolean;
  /**
   * A platform admin working inside a business they are not a member of.
   * They act with a manager's reach, and everything they change is logged in
   * that business's audit trail.
   */
  supportMode: boolean;
}

/** Is this user a platform admin? Read from the database, never from a claim. */
export async function isPlatformAdminUser(userId: string): Promise<boolean> {
  const { data, error } = await serviceClient
    .from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle();
  // A missing table (migration 0027 not applied) means nobody is one.
  if (error) return false;
  return Boolean(data);
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
    .select('tenant_id, role, created_at')
    .eq('user_id', user.id)
    // Deterministic default: the oldest membership, with the id as tie-break.
    .order('created_at', { ascending: true })
    .order('tenant_id', { ascending: true });

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
  const platformAdmin = await isPlatformAdminUser(user.id);

  // A user may belong to several tenants. Selection is by an explicit header,
  // but only ever among tenants they actually belong to -- the header can
  // never introduce a tenant that is not in this list. The one exception is a
  // platform admin, who may open any business and then acts in support mode.
  const requested = req.headers['x-tenant-id'];
  let chosen: { tenant_id: string; role: string } | undefined = memberships?.[0];
  let supportMode = false;
  if (typeof requested === 'string' && requested) {
    const match = (memberships ?? []).find((m) => m.tenant_id === requested);
    if (match) {
      chosen = match;
    } else if (platformAdmin && /^[0-9a-f-]{36}$/i.test(requested)) {
      const { data: target } = await serviceClient
        .from('tenants').select('id').eq('id', requested).maybeSingle();
      if (!target) return res.status(404).json({ error: 'That business does not exist' });
      chosen = { tenant_id: target.id, role: 'admin' };
      supportMode = true;
    } else {
      return res.status(403).json({ error: 'Not a member of the requested tenant' });
    }
  }
  if (!chosen) {
    return res.status(403).json({
      error: 'No tenant is associated with this account',
      code: platformAdmin ? 'PLATFORM_NO_TENANT' : 'NO_TENANT',
    });
  }

  req.ctx = {
    userId: user.id,
    email: user.email ?? null,
    emailVerified: Boolean(user.email_confirmed_at),
    tenantId: chosen.tenant_id,
    role: chosen.role as Role,
    accessToken: token,
    db: userClient(token, supportMode ? chosen.tenant_id : undefined),
    platformAdmin,
    supportMode,
  };
  next();
}

/**
 * Platform routes: the caller must be a platform admin. No business is
 * involved, so there is no tenant context and no row-level client.
 */
export async function requirePlatformAdmin(req: Request, res: Response, next: NextFunction) {
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: 'Unauthorized: missing bearer token' });
  const { data, error } = await serviceClient.auth.getUser(token);
  if (error || !data?.user) {
    return res.status(401).json({ error: 'Unauthorized: invalid or expired token' });
  }
  if (!(await isPlatformAdminUser(data.user.id))) {
    // Deliberately the same answer as an unknown route.
    return res.status(404).json({ error: 'Not found' });
  }
  req.authUser = {
    id: data.user.id,
    email: data.user.email ?? null,
    emailVerified: Boolean(data.user.email_confirmed_at),
    accessToken: token,
  };
  next();
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by requireUser. Present before a tenant exists. */
      authUser?: { id: string; email: string | null; emailVerified: boolean; accessToken: string };
      /** Exact request bytes, kept by the body parser for HMAC verification. */
      rawBody?: Buffer;
    }
  }
}

/**
 * Verifies the JWT but does not require a tenant.
 *
 * Only the first step of onboarding needs this: a user who has just signed up
 * has no tenant_users row yet and so cannot satisfy requireAuth. Every route
 * that touches tenant data must still use requireAuth.
 */
export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: 'Unauthorized: missing bearer token' });

  const { data, error } = await serviceClient.auth.getUser(token);
  if (error || !data?.user) {
    return res.status(401).json({ error: 'Unauthorized: invalid or expired token' });
  }
  req.authUser = {
    id: data.user.id,
    email: data.user.email ?? null,
    emailVerified: Boolean(data.user.email_confirmed_at),
    accessToken: token,
  };
  next();
}

/**
 * Checks if the caller is a global super-admin.
 * Super-admins can view cross-tenant agent turns and audit metrics.
 */
export function isSuperAdmin(req: Request): boolean {
  // One definition of "runs the platform": the platform_admins table. The old
  // list of email addresses in an environment variable is no longer read.
  return Boolean(req.ctx?.platformAdmin);
}

/** Rejects any request that tries to steer tenancy from the client. */
export function rejectClientTenantId(req: Request, res: Response, next: NextFunction) {
  // Admin endpoints under /api/admin manage their own authorization and tenant scoping
  if (req.path.startsWith('/admin')) {
    return next();
  }
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
      const who = min === 'owner' ? 'the owner' : min === 'admin' ? 'a manager or the owner' : 'staff';
      return res.status(403).json({
        error: `Only ${who} can do this. Your role is ${ROLE_LABEL[ctx.role]}.`,
        code: 'ROLE_TOO_LOW',
      });
    }
    next();
  };
}

/** Writes require at least `member`; viewers are read-only. */
export const requireWrite = requireRole('member');
/** Manager and above: settings, agents, channels, catalogue, payment details. */
export const requireAdmin = requireRole('admin');
/** The owner alone: staff, billing, deleting the business. */
export const requireOwner = requireRole('owner');

/** For a route that already ran requireAuth: platform admins only. */
export function platformOnly(req: Request, res: Response, next: NextFunction) {
  // Deliberately the same answer as an unknown route.
  if (!req.ctx?.platformAdmin) return res.status(404).json({ error: 'Not found' });
  next();
}

/** What the product calls each stored role. */
export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner', admin: 'Manager', member: 'Staff', viewer: 'Viewer',
};

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
