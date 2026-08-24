import { serviceClient } from '../../supabase.js';
import { ToolInputError, str, num, oneOf, bool, type Tool } from './types.js';

/**
 * Tools for reading the business back to its owner, and for moving customers
 * through it: metrics, leads, products.
 *
 * The metrics tools return counts and rows, never sentences. Turning
 * "conversion fell from 31% to 18%" into an explanation is the model's job;
 * pre-writing that here would be the platform inventing an analysis and
 * putting it in the agent's mouth.
 */

const LEAD_STAGES = [
  'new', 'contacted', 'interested', 'quoted',
  'payment_claimed', 'payment_verified', 'won', 'lost',
] as const;

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export const listProducts: Tool = {
  name: 'list_products',
  description: 'List what the business sells, with prices and stock.',
  parameters: {
    type: 'object',
    properties: {
      search: { type: 'string', description: 'Match part of a product name.' },
    },
    additionalProperties: false,
  },
  mutates: false,

  async run(args, ctx) {
    const search = str(args, 'search', { max: 100 });

    let q = serviceClient
      .from('products')
      .select('id, name, sku, description, price, currency, in_stock')
      .eq('tenant_id', ctx.tenantId)
      .order('name')
      .limit(60);

    if (search) q = q.ilike('name', `%${search.replace(/[%,()]/g, ' ')}%`);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return { products: data ?? [] };
  },
};

export const saveProduct: Tool = {
  name: 'save_product',
  description:
    'Create a product, or update it if one with the same name exists. Leave the price out entirely if the owner has not given you one — never estimate.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
      price: { type: 'number' },
      sku: { type: 'string' },
      in_stock: { type: 'boolean' },
    },
    required: ['name'],
    additionalProperties: false,
  },
  mutates: true,

  async run(args, ctx) {
    const name = str(args, 'name', { required: true, max: 200 });
    const price = num(args, 'price');
    if (price !== null && price < 0) throw new ToolInputError('price cannot be negative.');

    const { data: tenant } = await serviceClient
      .from('tenants').select('currency').eq('id', ctx.tenantId).single();

    const row = {
      tenant_id: ctx.tenantId,
      name,
      description: str(args, 'description', { max: 2000 }) || null,
      price,
      sku: str(args, 'sku', { max: 80 }) || null,
      currency: (tenant?.currency || 'KES').toUpperCase().slice(0, 3),
      in_stock: bool(args, 'in_stock', true),
    };

    const { data: existing } = await serviceClient
      .from('products')
      .select('id')
      .eq('tenant_id', ctx.tenantId)
      .ilike('name', name)
      .maybeSingle();

    const { data, error } = existing
      ? await serviceClient.from('products').update(row)
          .eq('id', existing.id).eq('tenant_id', ctx.tenantId)
          .select('id, name, price, currency, in_stock').single()
      : await serviceClient.from('products').insert(row)
          .select('id, name, price, currency, in_stock').single();

    if (error) throw new Error(error.message);
    return { saved: data, created: !existing };
  },
};

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export const findCustomers: Tool = {
  name: 'find_customers',
  description:
    'Find customers by name, phone or stage. Every other tool that acts on a customer takes the lead_id this returns, so start here.',
  parameters: {
    type: 'object',
    properties: {
      search: { type: 'string', description: 'Part of a name or phone number.' },
      stage: { type: 'string', enum: [...LEAD_STAGES] },
      silent_for_days: {
        type: 'number',
        description: 'Only customers with no contact for at least this many days.',
      },
    },
    additionalProperties: false,
  },
  mutates: false,

  async run(args, ctx) {
    const search = str(args, 'search', { max: 100 });
    const stage = str(args, 'stage', { lower: true });
    const silentDays = num(args, 'silent_for_days');

    let q = serviceClient
      .from('leads')
      .select('id, customer_name, phone, channel_type, stage, intent, last_message, last_contact, notes')
      .eq('tenant_id', ctx.tenantId)
      .order('last_contact', { ascending: false, nullsFirst: false })
      .limit(40);

    if (search) {
      const safe = search.replace(/[%,()]/g, ' ').trim();
      if (safe) q = q.or(`customer_name.ilike.%${safe}%,phone.ilike.%${safe}%`);
    }
    if (stage) {
      if (!(LEAD_STAGES as readonly string[]).includes(stage)) {
        throw new ToolInputError(`stage must be one of: ${LEAD_STAGES.join(', ')}.`);
      }
      q = q.eq('stage', stage);
    }
    if (silentDays !== null) {
      if (silentDays < 0) throw new ToolInputError('silent_for_days cannot be negative.');
      q = q.lt('last_contact', new Date(Date.now() - silentDays * 86_400_000).toISOString());
    }

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return { customers: data ?? [], found: (data ?? []).length };
  },
};

export const updateCustomer: Tool = {
  name: 'update_customer',
  description:
    "Move a customer to a different stage, or add a note. Use find_customers first to get the lead_id.",
  parameters: {
    type: 'object',
    properties: {
      lead_id: { type: 'number' },
      stage: { type: 'string', enum: [...LEAD_STAGES] },
      note: { type: 'string', description: 'Appended to the existing notes, never replacing them.' },
    },
    required: ['lead_id'],
    additionalProperties: false,
  },
  mutates: true,

  async run(args, ctx) {
    const leadId = num(args, 'lead_id');
    if (leadId === null) throw new ToolInputError('lead_id is required.');

    const stage = str(args, 'stage', { lower: true });
    const note = str(args, 'note', { max: 2000 });
    if (!stage && !note) throw new ToolInputError('Nothing to change. Send a stage or a note.');

    // The stage rules are policy, so they are settled before the database is
    // touched: whether an agent may set a stage cannot depend on which lead it
    // happened to name.
    if (stage) {
      oneOf(args, 'stage', LEAD_STAGES, null);
      // Payment stages are the outcome of a verified payment, not something an
      // agent decides. The commerce route sets those from the verification.
      if (stage === 'payment_verified' || stage === 'won') {
        throw new ToolInputError(
          'Only a verified payment moves a customer to that stage, and a person verifies every payment.'
        );
      }
    }

    const { data: lead } = await serviceClient
      .from('leads')
      .select('id, customer_name, stage, notes')
      .eq('tenant_id', ctx.tenantId)
      .eq('id', leadId)
      .maybeSingle();
    if (!lead) throw new ToolInputError(`There is no customer with id ${leadId}.`);

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (stage) patch.stage = stage;
    if (note) {
      const stamp = new Date().toISOString().slice(0, 10);
      patch.notes = lead.notes
        ? `${lead.notes}\n\n[${stamp}] ${note}`
        : `[${stamp}] ${note}`;
    }

    const { data, error } = await serviceClient
      .from('leads')
      .update(patch)
      .eq('tenant_id', ctx.tenantId)
      .eq('id', leadId)
      .select('id, customer_name, stage')
      .single();

    if (error) throw new Error(error.message);
    return { updated: data };
  },
};

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export const businessMetrics: Tool = {
  name: 'business_metrics',
  description:
    'Read the numbers: conversations, leads by stage, orders, verified revenue, appointments and open tickets, over a window. Use this to answer "how are we doing", "why are we losing leads" and anything about performance. Compare against the previous window before drawing a conclusion.',
  parameters: {
    type: 'object',
    properties: {
      days: { type: 'number', description: 'Window length in days. Defaults to 30.' },
    },
    additionalProperties: false,
  },
  mutates: false,

  async run(args, ctx) {
    const requested = num(args, 'days');
    const days = Math.min(Math.max(Math.round(requested ?? 30), 1), 365);

    const now = Date.now();
    const from = new Date(now - days * 86_400_000).toISOString();
    const previousFrom = new Date(now - 2 * days * 86_400_000).toISOString();

    const window = (table: string, column: string, start: string, end?: string) => {
      let q = serviceClient.from(table).select('id', { count: 'exact', head: true })
        .eq('tenant_id', ctx.tenantId).gte(column, start);
      if (end) q = q.lt(column, end);
      return q;
    };

    const [
      conversations, previousConversations,
      leads, previousLeads,
      orders, appointments, tickets, payments, stages,
    ] = await Promise.all([
      window('conversations', 'created_at', from),
      window('conversations', 'created_at', previousFrom, from),
      window('leads', 'created_at', from),
      window('leads', 'created_at', previousFrom, from),
      serviceClient.from('orders').select('total, status, created_at')
        .eq('tenant_id', ctx.tenantId).gte('created_at', from).limit(1000),
      window('appointments', 'created_at', from),
      serviceClient.from('support_tickets').select('id', { count: 'exact', head: true })
        .eq('tenant_id', ctx.tenantId).in('status', ['open', 'in_progress', 'waiting']),
      serviceClient.from('payments').select('amount')
        .eq('tenant_id', ctx.tenantId).eq('verification_status', 'verified')
        .gte('created_at', from).limit(1000),
      serviceClient.from('leads').select('stage')
        .eq('tenant_id', ctx.tenantId).gte('created_at', from).limit(2000),
    ]);

    /**
     * A failed count comes back as `{ error }`, not as a throw. Reporting it as
     * zero would have an agent telling the owner their business collapsed
     * because the database was briefly unreachable, so a failed read fails the
     * whole answer instead.
     */
    for (const result of [conversations, previousConversations, leads, previousLeads,
      orders, appointments, tickets, payments, stages]) {
      if (result.error) throw new Error(result.error.message);
    }

    const byStage: Record<string, number> = {};
    for (const row of stages.data ?? []) {
      const key = row.stage ?? 'unknown';
      byStage[key] = (byStage[key] ?? 0) + 1;
    }

    const orderRows = orders.data ?? [];
    const revenue = (payments.data ?? [])
      .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

    const { data: tenant } = await serviceClient
      .from('tenants').select('currency').eq('id', ctx.tenantId).single();

    return {
      window_days: days,
      conversations: { this_period: conversations.count ?? 0, previous_period: previousConversations.count ?? 0 },
      leads: { this_period: leads.count ?? 0, previous_period: previousLeads.count ?? 0 },
      leads_by_stage: byStage,
      orders: {
        created: orderRows.length,
        by_status: orderRows.reduce<Record<string, number>>((acc, o) => {
          acc[o.status] = (acc[o.status] ?? 0) + 1;
          return acc;
        }, {}),
      },
      // Only verified payments count. An unverified claim is not revenue, and
      // an agent must never report one as if it were.
      verified_revenue: { amount: revenue, currency: tenant?.currency ?? null },
      appointments_booked: appointments.count ?? 0,
      open_tickets: tickets.count ?? 0,
    };
  },
};

export const attentionNeeded: Tool = {
  name: 'attention_needed',
  description:
    'What is going wrong or being neglected right now: customers who went quiet mid-conversation, payment claims nobody has checked, tickets sitting open, appointments today, and questions nobody has answered. Use this to give the owner proactive advice rather than waiting to be asked.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  mutates: false,

  async run(_args, ctx) {
    const now = Date.now();
    const threeDaysAgo = new Date(now - 3 * 86_400_000).toISOString();
    const dayStart = new Date(now).toISOString();
    const dayEnd = new Date(now + 86_400_000).toISOString();

    const [silent, claims, tickets, today, gaps, handedOver] = await Promise.all([
      // Engaged but not closed, and quiet for three days.
      serviceClient.from('leads')
        .select('id, customer_name, stage, last_contact')
        .eq('tenant_id', ctx.tenantId)
        .in('stage', ['contacted', 'interested', 'quoted'])
        .lt('last_contact', threeDaysAgo)
        .order('last_contact')
        .limit(10),

      serviceClient.from('payments')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', ctx.tenantId)
        .eq('verification_status', 'unverified'),

      serviceClient.from('support_tickets')
        .select('id, subject, priority, created_at')
        .eq('tenant_id', ctx.tenantId)
        .in('status', ['open', 'in_progress'])
        .order('created_at')
        .limit(10),

      serviceClient.from('appointments')
        .select('id, customer_name, service_name, starts_at')
        .eq('tenant_id', ctx.tenantId)
        .eq('status', 'scheduled')
        .gte('starts_at', dayStart).lt('starts_at', dayEnd)
        .order('starts_at')
        .limit(20),

      serviceClient.from('knowledge_gaps')
        .select('question, times_seen')
        .eq('tenant_id', ctx.tenantId)
        .in('status', ['open', 'asked'])
        .order('times_seen', { ascending: false })
        .limit(5),

      // Conversations a person was meant to pick up but has not replied to.
      serviceClient.from('conversations')
        .select('id, customer_name, last_message_at')
        .eq('tenant_id', ctx.tenantId)
        .eq('ai_enabled', false)
        .eq('status', 'open')
        .lt('last_message_at', new Date(now - 86_400_000).toISOString())
        .order('last_message_at')
        .limit(10),
    ]);

    return {
      silent_customers: silent.data ?? [],
      unverified_payment_claims: claims.count ?? 0,
      open_tickets: tickets.data ?? [],
      appointments_today: today.data ?? [],
      unanswered_questions: gaps.data ?? [],
      waiting_on_a_person: handedOver.data ?? [],
    };
  },
};

export const removeProduct: Tool = {
  name: 'remove_product',
  description:
    'Take a product out of stock so it is no longer offered. It is kept rather than deleted, so past orders still make sense.',
  parameters: {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
    additionalProperties: false,
  },
  mutates: true,

  async run(args, ctx) {
    const name = str(args, 'name', { required: true, max: 200 });

    const { data, error } = await serviceClient
      .from('products')
      .update({ in_stock: false })
      .eq('tenant_id', ctx.tenantId)
      .ilike('name', name)
      .select('id, name');

    if (error) throw new Error(error.message);
    if (!data?.length) throw new ToolInputError(`There is no product called "${name}". List them first.`);
    return { removed: data.map((d) => d.name) };
  },
};

// ---------------------------------------------------------------------------
// Remembering a customer
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const saveCustomerDetails: Tool = {
  name: 'save_customer_details',
  description:
    "Save the customer's name, email or phone number so we remember them and can complete a booking or an order. Send only the pieces they actually gave you. If you were already told who you are speaking with, do not ask for it again.",
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      email: { type: 'string' },
      phone: { type: 'string' },
      lead_id: {
        type: 'number',
        description: "Only when you are not inside the customer's own conversation.",
      },
    },
    additionalProperties: false,
  },
  mutates: true,

  async run(args, ctx) {
    const name = str(args, 'name', { max: 120 });
    const email = str(args, 'email', { max: 200 }).toLowerCase();
    const phoneRaw = str(args, 'phone', { max: 40 });

    if (!name && !email && !phoneRaw) {
      throw new ToolInputError('Give at least one of name, email or phone.');
    }
    if (email && !EMAIL_RE.test(email)) {
      throw new ToolInputError('That does not look like an email address. Ask the customer to repeat it.');
    }
    // Keep digits and a leading +, so "0712 345 678" and "+254712345678" both
    // land in one shape. Length is a sanity check, not a country rule.
    const phone = phoneRaw ? phoneRaw.replace(/[^\d+]/g, '') : '';
    if (phoneRaw && phone.replace(/\D/g, '').length < 7) {
      throw new ToolInputError('That phone number looks too short. Ask the customer to repeat it.');
    }

    // Resolve which lead this is for: the conversation's own customer, or a
    // named lead_id. A customer-facing agent can only ever reach the person it
    // is actually talking to — it has no way to name someone else.
    const leadId = num(args, 'lead_id');
    let targetId: number | null = null;

    if (leadId !== null) {
      const { data } = await serviceClient
        .from('leads').select('id').eq('tenant_id', ctx.tenantId).eq('id', leadId).maybeSingle();
      targetId = data?.id ?? null;
    } else if (ctx.conversationId) {
      const { data: conv } = await serviceClient
        .from('conversations')
        .select('lead_id, channel_type, customer_id')
        .eq('tenant_id', ctx.tenantId).eq('id', ctx.conversationId).maybeSingle();

      if (conv?.lead_id) {
        targetId = conv.lead_id;
      } else if (conv) {
        // No lead linked yet: find the one this channel identity already owns.
        const { data } = await serviceClient
          .from('leads').select('id')
          .eq('tenant_id', ctx.tenantId)
          .eq('channel_type', conv.channel_type)
          .eq('customer_id', conv.customer_id)
          .maybeSingle();
        targetId = data?.id ?? null;
      }
    }

    if (targetId === null) throw new ToolInputError('Say which customer this is for.');

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (name) patch.customer_name = name;
    if (email) patch.email = email;
    if (phone) patch.phone = phone;

    const { error } = await serviceClient
      .from('leads').update(patch).eq('tenant_id', ctx.tenantId).eq('id', targetId);
    if (error) throw new Error(error.message);

    return {
      saved: Object.keys(patch).filter((k) => k !== 'updated_at'),
      note: 'Kept on file — you will recognise this customer if they come back.',
    };
  },
};
