import { serviceClient } from '../supabase.js';

/**
 * Creating a workspace and making its creator the owner.
 *
 * Shared by the legacy /bootstrap endpoint and the onboarding wizard so both
 * paths produce identical tenants. Runs with the service client because a user
 * with no membership yet cannot pass RLS on tenants or tenant_users.
 */

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'business'
  );
}

async function uniqueSlug(businessName: string): Promise<string> {
  const base = slugify(businessName);
  let slug = base;
  for (let i = 0; i < 25; i++) {
    const { data: clash } = await serviceClient
      .from('tenants').select('id').eq('slug', slug).maybeSingle();
    if (!clash) return slug;
    slug = `${base}-${Math.random().toString(36).slice(2, 7)}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export interface CreateTenantInput {
  userId: string;
  businessName: string;
  businessCategory?: string | null;
  agentName?: string | null;
  currency?: string | null;
  timezone?: string | null;
}

export interface CreatedTenant {
  tenantId: string;
  slug: string;
  role: 'owner';
  created: boolean;
}

/**
 * Idempotent: a user who already belongs to a tenant gets that tenant back
 * rather than a second one. A retried request or a double-clicked button
 * therefore cannot strand a duplicate workspace.
 */
export async function createTenantForUser(input: CreateTenantInput): Promise<CreatedTenant> {
  const { data: existing } = await serviceClient
    .from('tenant_users')
    .select('tenant_id, role')
    .eq('user_id', input.userId);

  if (existing?.length) {
    const { data: tenant } = await serviceClient
      .from('tenants').select('slug').eq('id', existing[0].tenant_id).maybeSingle();
    return {
      tenantId: existing[0].tenant_id,
      slug: tenant?.slug ?? '',
      role: existing[0].role as 'owner',
      created: false,
    };
  }

  const businessName = input.businessName.trim();
  const slug = await uniqueSlug(businessName);

  const { data: tenant, error: tErr } = await serviceClient
    .from('tenants')
    .insert({
      slug,
      business_name: businessName,
      business_category: input.businessCategory?.trim() || null,
      agent_name: input.agentName?.trim() || 'Assistant',
      currency: (input.currency || 'KES').toUpperCase().slice(0, 3),
      timezone: input.timezone || 'Africa/Nairobi',
      order_prefix: slugify(businessName).slice(0, 3).toUpperCase() || 'ORD',
      // The wizard is not finished yet; /me uses this to route the user.
      onboarding_completed_at: null,
    })
    .select('id, slug')
    .single();

  if (tErr || !tenant) {
    console.error('[tenantSetup] tenant insert failed', tErr);
    throw new Error('Could not create business');
  }

  const { error: mErr } = await serviceClient
    .from('tenant_users')
    .insert({ tenant_id: tenant.id, user_id: input.userId, role: 'owner' });

  if (mErr) {
    // Roll back rather than leave a workspace nobody can reach.
    await serviceClient.from('tenants').delete().eq('id', tenant.id);
    console.error('[tenantSetup] membership insert failed', mErr);
    throw new Error('Could not create business');
  }

  // Every tenant gets an agent_settings row so the agent page is never empty.
  await serviceClient.from('agent_settings').insert({ tenant_id: tenant.id });

  return { tenantId: tenant.id, slug: tenant.slug, role: 'owner', created: true };
}
