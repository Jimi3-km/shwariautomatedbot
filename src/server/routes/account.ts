import { Router } from 'express';
import { serviceClient } from '../supabase.js';
import { requireAuth, requireOwner, requireUser, requirePlatformAdmin, handler, ROLE_LABEL, type Role } from '../auth.js';
import { logAuditEvent } from '../security/audit.js';
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

/**
 * Who am I, and which businesses can I act for.
 *
 * A platform admin who belongs to no business still has a session: they get
 * the platform console and no tenant.
 */
accountRouter.get(
  '/me',
  requireAuth,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const { data: memberships } = await serviceClient
      .from('tenant_users')
      .select('tenant_id, role, tenants(business_name, slug, status)')
      .eq('user_id', ctx.userId)
      .order('created_at', { ascending: true })
      .order('tenant_id', { ascending: true });

    const { data: tenant, error: tenantErr } = await ctx.db
      .from('tenants')
      .select(
        'id, business_name, slug, currency, timezone, agent_name, order_prefix, status, ' +
          'business_category, onboarding_completed_at, agents_paused, status_reason'
      )
      .eq('id', ctx.tenantId)
      .single();

    // The caller belongs to this business, so failing to read it is a fault,
    // never "no business yet". Answering with an empty tenant sent every user
    // back into the setup wizard when a column could not be read.
    if (tenantErr || !tenant) {
      console.error('[account] /me could not read the business:', tenantErr?.code, tenantErr?.message);
      return res.status(500).json({ error: 'Your business could not be loaded. Please try again.', code: 'TENANT_READ_FAILED' });
    }

    res.json({
      user: { id: ctx.userId, email: ctx.email },
      role: ctx.role,
      tenant,
      memberships: memberships ?? [],
      platform_admin: ctx.platformAdmin,
      support_mode: ctx.supportMode,
    });
  })
);

/**
 * The session of a platform admin who is not in any business. requireAuth
 * answers PLATFORM_NO_TENANT for them; the app then asks here instead.
 */
accountRouter.get(
  '/platform/me',
  requirePlatformAdmin,
  handler(async (req, res) => {
    res.json({
      user: { id: req.authUser!.id, email: req.authUser!.email },
      role: 'admin',
      tenant: null,
      memberships: [],
      platform_admin: true,
      support_mode: false,
    });
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
  requireOwner,
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
    void logAuditEvent({
      tenantId: ctx.tenantId, actorId: ctx.userId, actorType: 'user', actorLabel: ctx.email,
      action: 'team.role_changed', resourceType: 'team', resourceId: data.id,
      details: {
        summary: `Changed a role from ${ROLE_LABEL[target.role as Role] ?? target.role} to ${ROLE_LABEL[role as Role]}`,
        from: target.role, to: role,
      },
    });
    res.json(data);
  })
);
