import { Router } from 'express';
import { serviceClient } from '../supabase.js';
import { requireAuth, requireAdmin, requireUser, handler } from '../auth.js';
import { createTenantForUser } from '../services/tenantSetup.js';

export const accountRouter = Router();

/**
 * Bootstrap: turn a freshly signed-up Supabase Auth user into a tenant owner.
 *
 * Kept for compatibility; the onboarding wizard calls
 * POST /onboarding/business instead. Both share createTenantForUser, so the
 * two paths cannot drift.
 */
accountRouter.post(
  '/bootstrap',
  requireUser,
  handler(async (req, res) => {
    const businessName = String(req.body?.business_name || '').trim();
    if (!businessName) {
      return res.status(400).json({ error: 'business_name is required' });
    }

    const result = await createTenantForUser({
      userId: req.authUser!.id,
      businessName,
      agentName: req.body?.agent_name,
      currency: req.body?.currency,
      timezone: req.body?.timezone,
    });

    res
      .status(result.created ? 201 : 200)
      .json({ tenant_id: result.tenantId, role: result.role, created: result.created, slug: result.slug });
  })
);

/** Who am I, and which tenants can I act for. */
accountRouter.get(
  '/me',
  requireAuth,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const { data: memberships } = await serviceClient
      .from('tenant_users')
      .select('tenant_id, role, tenants(business_name, slug)')
      .eq('user_id', ctx.userId)
      .order('created_at', { ascending: true })
      .order('tenant_id', { ascending: true });

    const { data: tenant } = await ctx.db
      .from('tenants')
      .select(
        'id, business_name, slug, currency, timezone, agent_name, order_prefix, status, ' +
          'business_category, onboarding_completed_at'
      )
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

/**
 * Change a member's role.
 *
 * The rules, mirrored by a trigger in 20261119_0018_authz_hardening.sql so that
 * calling PostgREST directly cannot get round them:
 *   - nobody changes their own role
 *   - only an owner may grant or take away the owner role
 *   - a workspace always keeps at least one owner
 */
accountRouter.patch(
  '/team/:id',
  requireAuth,
  requireAdmin,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const role = req.body?.role;
    if (!['owner', 'admin', 'member', 'viewer'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const { data: target, error: readErr } = await ctx.db
      .from('tenant_users')
      .select('id, user_id, role')
      .eq('id', req.params.id)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle();
    if (readErr) return res.status(400).json({ error: readErr.message });
    if (!target) return res.status(404).json({ error: 'Member not found' });

    if (target.user_id === ctx.userId) {
      return res.status(403).json({ error: 'You cannot change your own role' });
    }
    if (target.role === role) return res.json(target);

    if ((role === 'owner' || target.role === 'owner') && ctx.role !== 'owner') {
      return res.status(403).json({ error: 'Only an owner can grant or remove the owner role' });
    }

    if (target.role === 'owner') {
      const { count, error: countErr } = await ctx.db
        .from('tenant_users')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', ctx.tenantId)
        .eq('role', 'owner');
      if (countErr) return res.status(400).json({ error: countErr.message });
      if ((count ?? 0) <= 1) {
        return res.status(409).json({ error: 'A workspace must keep at least one owner' });
      }
    }

    const { data, error } = await ctx.db
      .from('tenant_users')
      .update({ role })
      .eq('id', req.params.id)
      .eq('tenant_id', ctx.tenantId)
      .select('id, user_id, role')
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Member not found' });
    res.json(data);
  })
);
