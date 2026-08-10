import { Router } from 'express';
import { serviceClient } from '../supabase.js';
import { requireAuth, requireAdmin, handler } from '../auth.js';

export const accountRouter = Router();

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'business';
}

/**
 * Bootstrap: turn a freshly signed-up Supabase Auth user into a tenant owner.
 *
 * Signup/login/logout/reset themselves happen client-side against Supabase
 * Auth. This endpoint runs once afterwards to create the tenant and the
 * owner membership. It uses the service client because the user has no
 * tenant yet and therefore cannot pass RLS.
 */
accountRouter.post(
  '/bootstrap',
  requireAuthAllowingNoTenant,
  handler(async (req, res) => {
    const userId = (req as any).bootstrapUserId as string;
    const businessName = String(req.body?.business_name || '').trim();
    if (!businessName) {
      return res.status(400).json({ error: 'business_name is required' });
    }

    const { data: existing } = await serviceClient
      .from('tenant_users')
      .select('tenant_id, role')
      .eq('user_id', userId);

    if (existing && existing.length) {
      return res.json({ tenant_id: existing[0].tenant_id, role: existing[0].role, created: false });
    }

    // Slug must be unique across all tenants.
    let slug = slugify(businessName);
    for (let i = 0; i < 25; i++) {
      const { data: clash } = await serviceClient
        .from('tenants')
        .select('id')
        .eq('slug', slug)
        .maybeSingle();
      if (!clash) break;
      slug = `${slugify(businessName)}-${Math.random().toString(36).slice(2, 7)}`;
    }

    const { data: tenant, error: tErr } = await serviceClient
      .from('tenants')
      .insert({
        slug,
        business_name: businessName,
        agent_name: String(req.body?.agent_name || 'Assistant').trim() || 'Assistant',
        currency: String(req.body?.currency || 'KES').toUpperCase().slice(0, 3),
        timezone: String(req.body?.timezone || 'Africa/Nairobi'),
        order_prefix: slugify(businessName).slice(0, 3).toUpperCase() || 'ORD',
      })
      .select('id, business_name, slug')
      .single();

    if (tErr || !tenant) {
      console.error('[bootstrap] tenant insert failed', tErr);
      return res.status(500).json({ error: 'Could not create business' });
    }

    const { error: mErr } = await serviceClient
      .from('tenant_users')
      .insert({ tenant_id: tenant.id, user_id: userId, role: 'owner' });

    if (mErr) {
      // Roll back so a half-created tenant cannot strand the account.
      await serviceClient.from('tenants').delete().eq('id', tenant.id);
      console.error('[bootstrap] membership insert failed', mErr);
      return res.status(500).json({ error: 'Could not create business' });
    }

    // Every tenant gets an agent_settings row so the agent page is never empty.
    await serviceClient.from('agent_settings').insert({ tenant_id: tenant.id });

    res.status(201).json({ tenant_id: tenant.id, role: 'owner', created: true, slug: tenant.slug });
  })
);

/** Verifies the JWT but tolerates a user with no tenant yet (signup path only). */
async function requireAuthAllowingNoTenant(req: any, res: any, next: any) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const { data, error } = await serviceClient.auth.getUser(h.slice(7).trim());
  if (error || !data?.user) return res.status(401).json({ error: 'Unauthorized' });
  req.bootstrapUserId = data.user.id;
  next();
}

/** Who am I, and which tenants can I act for. */
accountRouter.get(
  '/me',
  requireAuth,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const { data: memberships } = await serviceClient
      .from('tenant_users')
      .select('tenant_id, role, tenants(business_name, slug)')
      .eq('user_id', ctx.userId);

    const { data: tenant } = await ctx.db
      .from('tenants')
      .select('id, business_name, slug, currency, timezone, agent_name, order_prefix, status')
      .eq('id', ctx.tenantId)
      .single();

    res.json({
      user: { id: ctx.userId, email: ctx.email },
      role: ctx.role,
      tenant,
      memberships: memberships ?? [],
    });
  })
);

/** Team management. */
accountRouter.get(
  '/team',
  requireAuth,
  handler(async (req, res) => {
    const { data, error } = await req.ctx!.db
      .from('tenant_users')
      .select('id, user_id, role, created_at')
      .eq('tenant_id', req.ctx!.tenantId);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ members: data ?? [] });
  })
);

accountRouter.patch(
  '/team/:id',
  requireAuth,
  requireAdmin,
  handler(async (req, res) => {
    const role = req.body?.role;
    if (!['owner', 'admin', 'member', 'viewer'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    const { data, error } = await req.ctx!.db
      .from('tenant_users')
      .update({ role })
      .eq('id', req.params.id)
      .eq('tenant_id', req.ctx!.tenantId)
      .select('id, user_id, role')
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Member not found' });
    res.json(data);
  })
);
