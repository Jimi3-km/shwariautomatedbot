import { serviceClient } from '../../supabase.js';
import { ToolInputError, likeLiteral, bool, type Tool, type AgentContext } from './types.js';
import { saveService } from './business.js';
import { saveProduct } from './insight.js';

/**
 * Doing many catalogue changes in one step.
 *
 * "Set up a wig shop with ten products and ten services" is twenty writes. One
 * write per model round does not fit in a turn: the agent ran out of steps
 * after four, and the owner was told the job was finished. These tools take
 * the whole list at once and report, item by item, what was saved and what was
 * not - so the reply can only ever claim what the result shows.
 */

interface Outcome {
  saved: string[];
  failed: Array<{ name: string; why: string }>;
}

async function each(
  list: unknown,
  what: string,
  one: Tool,
  ctx: AgentContext
): Promise<Outcome & { total_now?: number }> {
  if (!Array.isArray(list) || !list.length) throw new ToolInputError(`${what} must be a non-empty list.`);
  if (list.length > 30) throw new ToolInputError(`That is too many ${what} for one step. Send at most 30 at a time.`);

  const outcome: Outcome = { saved: [], failed: [] };
  for (const raw of list) {
    const item = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!name) {
      outcome.failed.push({ name: '(no name)', why: 'Every item needs a name.' });
      continue;
    }
    try {
      await one.run(item, ctx);
      outcome.saved.push(name);
    } catch (e) {
      outcome.failed.push({
        name,
        why: e instanceof ToolInputError ? e.message : 'It could not be saved.',
      });
    }
  }
  return outcome;
}

const PRODUCT_ITEM = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    price: { type: 'number', description: 'Price in the business currency. Leave out if the owner gave none.' },
    sku: { type: 'string' },
    in_stock: { type: 'boolean' },
  },
  required: ['name'],
};

export const saveProducts: Tool = {
  name: 'save_products',
  description:
    'Create or update several products in one step. Use this whenever there is more than one product to add or change - a new catalogue, a price list, a restock. The result lists exactly which were saved and which failed; report those numbers, not the number you intended.',
  parameters: {
    type: 'object',
    properties: { products: { type: 'array', items: PRODUCT_ITEM, description: 'Up to 30 products.' } },
    required: ['products'],
    additionalProperties: false,
  },
  mutates: true,

  async run(args, ctx) {
    const outcome = await each(args.products, 'products', saveProduct, ctx);
    const { count } = await serviceClient
      .from('products').select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId).eq('in_stock', true);
    return { ...outcome, saved_count: outcome.saved.length, failed_count: outcome.failed.length, products_on_sale_now: count ?? null };
  },
};

const SERVICE_ITEM = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    price_amount: { type: 'number', description: 'Leave out if the price is not fixed.' },
    price_note: { type: 'string', description: 'Free text such as "from 5,000".' },
    duration_minutes: { type: 'number' },
    booking_mode: { type: 'string', enum: ['direct', 'consultation', 'enquiry'] },
  },
  required: ['name'],
};

export const saveServices: Tool = {
  name: 'save_services',
  description:
    'Create or update several services in one step. Use this whenever there is more than one service to add or change. The result lists exactly which were saved and which failed; report those numbers, not the number you intended.',
  parameters: {
    type: 'object',
    properties: { services: { type: 'array', items: SERVICE_ITEM, description: 'Up to 30 services.' } },
    required: ['services'],
    additionalProperties: false,
  },
  mutates: true,

  async run(args, ctx) {
    const outcome = await each(args.services, 'services', saveService, ctx);
    const { count } = await serviceClient
      .from('services').select('id', { count: 'exact', head: true })
      .eq('tenant_id', ctx.tenantId).eq('active', true);
    return { ...outcome, saved_count: outcome.saved.length, failed_count: outcome.failed.length, services_offered_now: count ?? null };
  },
};

/**
 * Clearing out a catalogue.
 *
 * `remove_product` only ever marked a product out of stock, so "delete the
 * iPhones" left them on the Products page. This removes them for real, by
 * name or all at once, and says what is left.
 */
export const removeProducts: Tool = {
  name: 'remove_products',
  description:
    'Delete products from the catalogue for good, so they no longer appear on the Products page. Pass the names to delete, or everything: true to clear the whole catalogue, optionally keeping some with keep. Past orders are not affected. This cannot be undone, so only use it when the owner has asked for products to be deleted.',
  parameters: {
    type: 'object',
    properties: {
      names: { type: 'array', items: { type: 'string' }, description: 'Exact product names to delete.' },
      everything: { type: 'boolean', description: 'Delete every product (except those in keep).' },
      keep: { type: 'array', items: { type: 'string' }, description: 'With everything: names to leave in place.' },
    },
    additionalProperties: false,
  },
  mutates: true,

  async run(args, ctx) {
    const names = Array.isArray(args.names) ? args.names.map((n) => String(n).trim()).filter(Boolean) : [];
    const everything = bool(args, 'everything', false);
    const keep = new Set(
      (Array.isArray(args.keep) ? args.keep : []).map((n) => String(n).trim().toLowerCase()).filter(Boolean)
    );
    if (!everything && !names.length) throw new ToolInputError('Say which products to delete with names, or pass everything: true.');

    const { data: all, error } = await serviceClient
      .from('products').select('id, name').eq('tenant_id', ctx.tenantId).limit(500);
    if (error) throw new Error(error.message);

    const wanted = new Set(names.map((n) => n.toLowerCase()));
    const targets = (all ?? []).filter((p) => {
      const n = String(p.name).trim().toLowerCase();
      return everything ? !keep.has(n) : wanted.has(n);
    });
    const notFound = everything
      ? []
      : names.filter((n) => !(all ?? []).some((p) => String(p.name).trim().toLowerCase() === n.toLowerCase()));

    let deleted: string[] = [];
    if (targets.length) {
      const { data: gone, error: delErr } = await serviceClient
        .from('products').delete()
        .eq('tenant_id', ctx.tenantId)
        .in('id', targets.map((p) => p.id))
        .select('id, name');
      if (delErr) throw new Error(delErr.message);
      deleted = (gone ?? []).map((p) => p.name);
    }

    return {
      deleted,
      deleted_count: deleted.length,
      not_found: notFound,
      products_left: (all ?? []).length - deleted.length,
      note: notFound.length ? 'Some names matched nothing. List the products to see the exact names.' : undefined,
    };
  },
};

export const removeServices: Tool = {
  name: 'remove_services',
  description:
    'Stop offering several services in one step, by name, or everything: true to stop offering all of them (optionally keeping some with keep). Use it when the owner asks to clear or replace the services. The result lists exactly what was switched off.',
  parameters: {
    type: 'object',
    properties: {
      names: { type: 'array', items: { type: 'string' } },
      everything: { type: 'boolean' },
      keep: { type: 'array', items: { type: 'string' } },
    },
    additionalProperties: false,
  },
  mutates: true,

  async run(args, ctx) {
    const names = Array.isArray(args.names) ? args.names.map((n) => String(n).trim()).filter(Boolean) : [];
    const everything = bool(args, 'everything', false);
    const keep = new Set(
      (Array.isArray(args.keep) ? args.keep : []).map((n) => String(n).trim().toLowerCase()).filter(Boolean)
    );
    if (!everything && !names.length) throw new ToolInputError('Say which services with names, or pass everything: true.');

    const { data: all, error } = await serviceClient
      .from('services').select('id, name').eq('tenant_id', ctx.tenantId).eq('active', true).limit(500);
    if (error) throw new Error(error.message);

    const wanted = new Set(names.map((n) => n.toLowerCase()));
    const targets = (all ?? []).filter((s) => {
      const n = String(s.name).trim().toLowerCase();
      return everything ? !keep.has(n) : wanted.has(n);
    });

    let removed: string[] = [];
    if (targets.length) {
      const { data: gone, error: updErr } = await serviceClient
        .from('services')
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq('tenant_id', ctx.tenantId)
        .in('id', targets.map((s) => s.id))
        .select('id, name');
      if (updErr) throw new Error(updErr.message);
      removed = (gone ?? []).map((s) => s.name);
    }

    return {
      removed,
      removed_count: removed.length,
      not_found: everything ? [] : names.filter((n) => !(all ?? []).some((s) => String(s.name).trim().toLowerCase() === n.toLowerCase())),
      services_still_offered: (all ?? []).length - removed.length,
    };
  },
};

/**
 * Is this something the business actually sells?
 *
 * Used before an order is recorded for a customer: an agent may only sell what
 * is in the catalogue, at the catalogue's price. Returns the catalogue entry,
 * or null when the name matches nothing on sale.
 */
export async function findInCatalogue(
  tenantId: string,
  name: string
): Promise<{ kind: 'product' | 'service'; name: string; price: number | null } | null> {
  const wanted = name.trim();
  if (!wanted) return null;
  const loose = `%${likeLiteral(wanted)}%`;

  const [exactP, exactS] = await Promise.all([
    serviceClient.from('products').select('name, price, in_stock').eq('tenant_id', tenantId).ilike('name', likeLiteral(wanted)).limit(1),
    serviceClient.from('services').select('name, price_amount, active').eq('tenant_id', tenantId).ilike('name', likeLiteral(wanted)).limit(1),
  ]);
  const p = (exactP.data ?? []).find((r: any) => r.in_stock !== false);
  if (p) return { kind: 'product', name: p.name, price: p.price === null || p.price === undefined ? null : Number(p.price) };
  const s = (exactS.data ?? []).find((r: any) => r.active !== false);
  if (s) return { kind: 'service', name: s.name, price: s.price_amount === null || s.price_amount === undefined ? null : Number(s.price_amount) };

  // A customer rarely types the full catalogue name. A single clear partial
  // match is accepted; an ambiguous one is not.
  const [looseP, looseS] = await Promise.all([
    serviceClient.from('products').select('name, price, in_stock').eq('tenant_id', tenantId).eq('in_stock', true).ilike('name', loose).limit(3),
    serviceClient.from('services').select('name, price_amount, active').eq('tenant_id', tenantId).eq('active', true).ilike('name', loose).limit(3),
  ]);
  const candidates = [
    ...(looseP.data ?? []).map((r: any) => ({ kind: 'product' as const, name: r.name, price: r.price === null || r.price === undefined ? null : Number(r.price) })),
    ...(looseS.data ?? []).map((r: any) => ({ kind: 'service' as const, name: r.name, price: r.price_amount === null || r.price_amount === undefined ? null : Number(r.price_amount) })),
  ];
  return candidates.length === 1 ? candidates[0] : null;
}

