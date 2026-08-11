import { Router } from 'express';
import { requireAuth, requireWrite, requireAdmin, handler } from '../auth.js';

export const catalogRouter = Router();

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------
// The AI quotes exclusively from this table (n8n "Product Tool"), so price is
// stored as a number and never as free text. There is no path by which the
// agent can introduce a product or a price.

catalogRouter.get(
  '/products',
  requireAuth,
  handler(async (req, res) => {
    const { data, error } = await req.ctx!.db
      .from('products')
      .select('*')
      .eq('tenant_id', req.ctx!.tenantId)
      .order('created_at', { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ products: data ?? [] });
  })
);

function productPayload(body: any, tenantId: string, currencyFallback: string) {
  const price = body.price === '' || body.price == null ? null : Number(body.price);
  if (price != null && (!Number.isFinite(price) || price < 0)) {
    throw Object.assign(new Error('price must be a non-negative number'), { status: 400 });
  }
  const name = String(body.name || '').trim();
  if (!name) throw Object.assign(new Error('name is required'), { status: 400 });

  return {
    tenant_id: tenantId,
    name,
    sku: body.sku ? String(body.sku).trim() : null,
    description: body.description ? String(body.description) : null,
    price,
    currency: String(body.currency || currencyFallback).toUpperCase().slice(0, 3),
    variant: body.variant && typeof body.variant === 'object' ? body.variant : {},
    payment_options:
      body.payment_options && typeof body.payment_options === 'object' ? body.payment_options : {},
    in_stock: body.in_stock === undefined ? true : Boolean(body.in_stock),
  };
}

catalogRouter.post(
  '/products',
  requireAuth,
  requireWrite,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const { data: tenant } = await ctx.db
      .from('tenants').select('currency').eq('id', ctx.tenantId).single();

    let payload;
    try {
      payload = productPayload(req.body, ctx.tenantId, tenant?.currency || 'KES');
    } catch (e: any) {
      return res.status(e.status || 400).json({ error: e.message });
    }

    const { data, error } = await ctx.db.from('products').insert(payload).select('*').single();
    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json(data);
  })
);

catalogRouter.put(
  '/products/:id',
  requireAuth,
  requireWrite,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const { data: tenant } = await ctx.db
      .from('tenants').select('currency').eq('id', ctx.tenantId).single();

    let payload;
    try {
      payload = productPayload(req.body, ctx.tenantId, tenant?.currency || 'KES');
    } catch (e: any) {
      return res.status(e.status || 400).json({ error: e.message });
    }
    // tenant_id is never updatable.
    const { tenant_id: _drop, ...updates } = payload;

    const { data, error } = await ctx.db
      .from('products')
      .update(updates)
      .eq('id', req.params.id)
      .eq('tenant_id', ctx.tenantId)
      .select('*')
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Product not found' });
    res.json(data);
  })
);

/** Archive by default (reversible); ?hard=true deletes, admin only. */
catalogRouter.delete(
  '/products/:id',
  requireAuth,
  requireWrite,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    if (req.query.hard === 'true') {
      if (!['owner', 'admin'].includes(ctx.role)) {
        return res.status(403).json({ error: 'Permanent delete requires admin' });
      }
      const { error } = await ctx.db
        .from('products').delete().eq('id', req.params.id).eq('tenant_id', ctx.tenantId);
      if (error) return res.status(400).json({ error: error.message });
      return res.json({ deleted: true });
    }
    const { data, error } = await ctx.db
      .from('products')
      .update({ in_stock: false })
      .eq('id', req.params.id)
      .eq('tenant_id', ctx.tenantId)
      .select('id')
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Product not found' });
    res.json({ archived: true });
  })
);

// ---------------------------------------------------------------------------
// Agent settings
// ---------------------------------------------------------------------------

catalogRouter.get(
  '/agent',
  requireAuth,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const { data, error } = await ctx.db
      .from('agent_settings').select('*').eq('tenant_id', ctx.tenantId).maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ agent: data });
  })
);

catalogRouter.put(
  '/agent',
  requireAuth,
  requireWrite,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const b = req.body ?? {};
    const memoryWindow = b.memory_window == null ? undefined : Number(b.memory_window);
    if (memoryWindow !== undefined && (!Number.isInteger(memoryWindow) || memoryWindow < 1 || memoryWindow > 200)) {
      return res.status(400).json({ error: 'memory_window must be an integer between 1 and 200' });
    }
    const delay = b.followup_delay_hours == null ? undefined : Number(b.followup_delay_hours);
    if (delay !== undefined && (!Number.isInteger(delay) || delay < 1 || delay > 720)) {
      return res.status(400).json({ error: 'followup_delay_hours must be an integer between 1 and 720' });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (b.persona !== undefined) updates.persona = b.persona;
    if (b.custom_instructions !== undefined) updates.custom_instructions = b.custom_instructions;
    if (b.followup_template !== undefined) updates.followup_template = b.followup_template;
    if (b.model !== undefined) updates.model = String(b.model);
    if (memoryWindow !== undefined) updates.memory_window = memoryWindow;
    if (delay !== undefined) updates.followup_delay_hours = delay;
    if (b.sales_script !== undefined) updates.sales_script = b.sales_script;
    if (b.escalation_rules !== undefined) updates.escalation_rules = b.escalation_rules;
    if (b.upsell_catalogue !== undefined) {
      updates.upsell_catalogue = Array.isArray(b.upsell_catalogue) ? b.upsell_catalogue : [];
    }

    // upsert so a tenant without a settings row still works.
    const { data, error } = await ctx.db
      .from('agent_settings')
      .upsert({ tenant_id: ctx.tenantId, ...updates }, { onConflict: 'tenant_id' })
      .select('*')
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  })
);

// ---------------------------------------------------------------------------
// Business settings (the tenants row)
// ---------------------------------------------------------------------------

const TENANT_EDITABLE = [
  'business_name', 'business_description', 'business_category', 'agent_name', 'address', 'timezone',
  'currency', 'business_hours', 'delivery_rules', 'payment_details', 'branding',
  'languages', 'contact_info', 'order_prefix', 'notification_channel', 'notification_target',
] as const;

catalogRouter.get(
  '/business',
  requireAuth,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    // Explicit column list: api_key_hash is never selected or returned.
    const { data, error } = await ctx.db
      .from('tenants')
      .select(`id, slug, status, created_at, ${TENANT_EDITABLE.join(', ')}`)
      .eq('id', ctx.tenantId)
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ business: data });
  })
);

catalogRouter.put(
  '/business',
  requireAuth,
  requireAdmin,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const key of TENANT_EDITABLE) {
      if (req.body?.[key] !== undefined) updates[key] = req.body[key];
    }
    if (typeof updates.currency === 'string') {
      updates.currency = updates.currency.toUpperCase().slice(0, 3);
    }
    if (updates.business_name !== undefined && !String(updates.business_name).trim()) {
      return res.status(400).json({ error: 'business_name cannot be empty' });
    }

    const { data, error } = await ctx.db
      .from('tenants')
      .update(updates)
      .eq('id', ctx.tenantId)
      .select(`id, slug, status, ${TENANT_EDITABLE.join(', ')}`)
      .maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!data) return res.status(403).json({ error: 'Not permitted to update this business' });
    res.json(data);
  })
);
