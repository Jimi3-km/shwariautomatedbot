import { serviceClient } from '../../supabase.js';
import { ToolInputError, str, num, oneOf, type Tool, type AgentContext } from './types.js';

/**
 * Tools that do work rather than describe it: appointments, orders, tickets,
 * follow-ups and escalation.
 *
 * Two rules shape everything here.
 *
 * An agent never acts on a customer it cannot see. Where a tool takes a
 * customer, it takes the channel identity the conversation already carries —
 * never a free-text name the model chose — and every query is scoped to the
 * tenant from the context.
 *
 * An agent never sends an outbound message directly. It writes a follow_ups
 * row, which a person can read, edit or cancel before it goes. That is the
 * difference between an employee who tells you what they are going to do and
 * one who has already emailed your customers.
 */

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * The customer this turn is about.
 *
 * On a customer-facing channel that is whoever is talking, taken from the
 * conversation rather than from an argument. The manager, who talks to the
 * owner, has to name one — so it names a lead, which is an id we can verify,
 * not a name we would have to guess at.
 */
async function resolveCustomer(args: Record<string, unknown>, ctx: AgentContext) {
  const leadId = num(args, 'lead_id');

  if (leadId !== null) {
    const { data } = await serviceClient
      .from('leads')
      .select('id, customer_id, customer_name, channel_type')
      .eq('tenant_id', ctx.tenantId)
      .eq('id', leadId)
      .maybeSingle();
    if (!data) throw new ToolInputError(`There is no customer with id ${leadId}. Search first.`);
    return {
      leadId: data.id,
      customerId: data.customer_id,
      customerName: data.customer_name,
      channelType: data.channel_type,
    };
  }

  if (!ctx.conversationId) {
    throw new ToolInputError('Say which customer this is for by passing lead_id.');
  }

  const { data } = await serviceClient
    .from('conversations')
    .select('id, lead_id, customer_id, customer_name, channel_type')
    .eq('tenant_id', ctx.tenantId)
    .eq('id', ctx.conversationId)
    .maybeSingle();
  if (!data) throw new ToolInputError('This conversation is no longer available.');

  return {
    leadId: data.lead_id,
    customerId: data.customer_id,
    customerName: data.customer_name,
    channelType: data.channel_type,
  };
}

/** An ISO timestamp the model can be trusted to have meant. */
function when(args: Record<string, unknown>, key: string, opts: { required?: boolean } = {}): string | null {
  const raw = str(args, key, { required: opts.required, max: 40 });
  if (!raw) return null;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new ToolInputError(`${key} must be a date and time, e.g. 2026-09-04T14:30:00Z.`);
  }
  // A booking a decade out is a parsing accident, not a booking.
  const years = Math.abs(parsed.getTime() - Date.now()) / (365 * 24 * 3600_000);
  if (years > 2) throw new ToolInputError(`${key} is too far from today to be right. Check the date.`);
  return parsed.toISOString();
}

// ---------------------------------------------------------------------------
// Appointments
// ---------------------------------------------------------------------------

export const listAppointments: Tool = {
  name: 'list_appointments',
  description:
    'List upcoming appointments. Use this before booking, to check what is already in the diary, and to answer "what does my day look like".',
  parameters: {
    type: 'object',
    properties: {
      from: { type: 'string', description: 'ISO date-time. Defaults to now.' },
      to: { type: 'string', description: 'ISO date-time. Defaults to 14 days out.' },
      lead_id: { type: 'number', description: 'Only this customer\'s appointments.' },
    },
    additionalProperties: false,
  },
  mutates: false,

  async run(args, ctx) {
    const from = when(args, 'from') ?? new Date().toISOString();
    const to = when(args, 'to') ?? new Date(Date.now() + 14 * 86_400_000).toISOString();
    const leadId = num(args, 'lead_id');

    let q = serviceClient
      .from('appointments')
      .select('id, customer_name, service_name, starts_at, duration_minutes, status, notes')
      .eq('tenant_id', ctx.tenantId)
      .gte('starts_at', from)
      .lte('starts_at', to)
      .neq('status', 'cancelled')
      .order('starts_at')
      .limit(50);

    if (leadId !== null) q = q.eq('lead_id', leadId);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return { appointments: data ?? [], window: { from, to } };
  },
};

export const bookAppointment: Tool = {
  name: 'book_appointment',
  description:
    'Book an appointment. Check list_appointments first so you do not double-book, and check the service: anything marked as needing a consultation should be booked as a consultation, not as the treatment itself.',
  parameters: {
    type: 'object',
    properties: {
      service_name: { type: 'string', description: 'The service being booked.' },
      starts_at: { type: 'string', description: 'ISO date-time, e.g. 2026-09-04T14:30:00Z.' },
      duration_minutes: { type: 'number' },
      lead_id: { type: 'number', description: 'Required when you are not in the customer\'s own conversation.' },
      notes: { type: 'string' },
    },
    required: ['service_name', 'starts_at'],
    additionalProperties: false,
  },
  mutates: true,

  async run(args, ctx) {
    const serviceName = str(args, 'service_name', { required: true, max: 120 });
    const startsAt = when(args, 'starts_at', { required: true })!;
    const duration = num(args, 'duration_minutes');
    const customer = await resolveCustomer(args, ctx);

    // Match the service so the appointment carries a real reference where one
    // exists, and so the duration defaults to what the service actually takes.
    const { data: service } = await serviceClient
      .from('services')
      .select('id, name, duration_minutes, booking_mode, active')
      .eq('tenant_id', ctx.tenantId)
      .ilike('name', serviceName)
      .maybeSingle();

    if (service && !service.active) {
      throw new ToolInputError(`"${service.name}" is not being offered at the moment.`);
    }

    const minutes = duration !== null
      ? Math.round(duration)
      : service?.duration_minutes ?? 30;
    if (minutes <= 0 || minutes > 8 * 60) {
      throw new ToolInputError('duration_minutes must be between 1 and 480.');
    }

    // Clash detection is a read-then-write and so is racy under concurrency;
    // it exists to stop the common mistake, not to be a booking lock. Two
    // simultaneous bookings are visible in the diary and correctable there.
    const endsAt = new Date(new Date(startsAt).getTime() + minutes * 60_000).toISOString();
    const { data: clashes } = await serviceClient
      .from('appointments')
      .select('id, customer_name, service_name, starts_at, duration_minutes')
      .eq('tenant_id', ctx.tenantId)
      .eq('status', 'scheduled')
      .gte('starts_at', new Date(new Date(startsAt).getTime() - 8 * 3600_000).toISOString())
      .lte('starts_at', endsAt);

    const overlapping = (clashes ?? []).filter((a) => {
      const aStart = new Date(a.starts_at).getTime();
      const aEnd = aStart + (a.duration_minutes ?? 30) * 60_000;
      return aStart < new Date(endsAt).getTime() && aEnd > new Date(startsAt).getTime();
    });

    if (overlapping.length) {
      return {
        booked: false,
        clashes_with: overlapping.map((a) => ({
          who: a.customer_name, what: a.service_name, at: a.starts_at,
        })),
        note: 'Offer the customer a different time rather than booking over this.',
      };
    }

    const { data, error } = await serviceClient
      .from('appointments')
      .insert({
        tenant_id: ctx.tenantId,
        lead_id: customer.leadId,
        customer_id: customer.customerId,
        customer_name: customer.customerName,
        channel_type: customer.channelType,
        service_id: service?.id ?? null,
        service_name: service?.name ?? serviceName,
        starts_at: startsAt,
        duration_minutes: minutes,
        notes: str(args, 'notes', { max: 1000 }) || null,
        booked_by_agent: ctx.agentRole,
      })
      .select('id, service_name, starts_at, duration_minutes, customer_name')
      .single();

    if (error) throw new Error(error.message);
    return { booked: true, appointment: data };
  },
};

export const rescheduleAppointment: Tool = {
  name: 'reschedule_appointment',
  description: 'Move an existing appointment to a new time. Find it with list_appointments first.',
  parameters: {
    type: 'object',
    properties: {
      appointment_id: { type: 'string' },
      starts_at: { type: 'string', description: 'The new ISO date-time.' },
    },
    required: ['appointment_id', 'starts_at'],
    additionalProperties: false,
  },
  mutates: true,

  async run(args, ctx) {
    const id = str(args, 'appointment_id', { required: true, max: 64 });
    const startsAt = when(args, 'starts_at', { required: true })!;

    const { data, error } = await serviceClient
      .from('appointments')
      .update({ starts_at: startsAt, status: 'scheduled', updated_at: new Date().toISOString() })
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id)
      .select('id, service_name, starts_at, customer_name')
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) throw new ToolInputError('That appointment no longer exists.');
    return { rescheduled: data };
  },
};

export const cancelAppointment: Tool = {
  name: 'cancel_appointment',
  description:
    'Cancel an appointment. It stays in the diary as cancelled rather than disappearing, so the slot and the history are both visible.',
  parameters: {
    type: 'object',
    properties: {
      appointment_id: { type: 'string' },
      reason: { type: 'string' },
    },
    required: ['appointment_id'],
    additionalProperties: false,
  },
  mutates: true,

  async run(args, ctx) {
    const id = str(args, 'appointment_id', { required: true, max: 64 });
    const reason = str(args, 'reason', { max: 500 });

    const { data, error } = await serviceClient
      .from('appointments')
      .update({
        status: 'cancelled',
        notes: reason || null,
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id)
      .select('id, service_name, starts_at, customer_name')
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) throw new ToolInputError('That appointment no longer exists.');
    return { cancelled: data };
  },
};

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export const recordOrder: Tool = {
  name: 'record_order',
  description:
    'Record an order a customer has agreed to. It is created unpaid and pending — you never mark anything as paid, and you never confirm a payment has been received.',
  parameters: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: 'What the customer is buying.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            qty: { type: 'number' },
            price: { type: 'number', description: 'Unit price. Only if you were given one.' },
          },
          required: ['name'],
        },
      },
      total: { type: 'number', description: 'Order total. Omit if it is not settled yet.' },
      delivery_location: { type: 'string' },
      lead_id: { type: 'number', description: 'Required when you are not in the customer\'s own conversation.' },
    },
    required: ['items'],
    additionalProperties: false,
  },
  mutates: true,

  async run(args, ctx) {
    const rawItems = args.items;
    if (!Array.isArray(rawItems) || !rawItems.length) {
      throw new ToolInputError('items must be a non-empty array.');
    }
    if (rawItems.length > 50) throw new ToolInputError('That is too many lines for one order.');

    const items = rawItems.map((raw) => {
      const item = (raw ?? {}) as Record<string, unknown>;
      const qty = num(item, 'qty');
      const price = num(item, 'price');
      if (price !== null && price < 0) throw new ToolInputError('An item price cannot be negative.');
      return {
        name: str(item, 'name', { required: true, max: 200 }),
        qty: qty === null ? 1 : Math.max(1, Math.round(qty)),
        ...(price === null ? {} : { price }),
      };
    });

    const total = num(args, 'total');
    if (total !== null && total < 0) throw new ToolInputError('total cannot be negative.');

    const customer = await resolveCustomer(args, ctx);

    const { data: tenant } = await serviceClient
      .from('tenants').select('order_prefix, currency').eq('id', ctx.tenantId).single();

    const { data, error } = await serviceClient
      .from('orders')
      .insert({
        tenant_id: ctx.tenantId,
        order_ref: `${tenant?.order_prefix || 'ORD'}-${Date.now().toString(36).toUpperCase()}`,
        lead_id: customer.leadId,
        customer_id: customer.customerId,
        channel_type: customer.channelType,
        items,
        total,
        currency: (tenant?.currency || 'KES').toUpperCase().slice(0, 3),
        delivery_location: str(args, 'delivery_location', { max: 300 }) || null,
        // Both deliberately left at their safe defaults. Payment state changes
        // only through the verification path, which requires a human and is
        // enforced by a database trigger regardless of what is written here.
        status: 'pending',
        payment_status: 'unpaid',
      })
      .select('id, order_ref, total, currency, status')
      .single();

    if (error) throw new Error(error.message);
    return { order: data, note: 'Recorded as unpaid. A person verifies every payment.' };
  },
};

// ---------------------------------------------------------------------------
// Support tickets and escalation
// ---------------------------------------------------------------------------

export const openTicket: Tool = {
  name: 'open_ticket',
  description:
    'Open a support ticket for something that needs tracking or a person. Use it for complaints, faults, and anything you cannot resolve in the conversation.',
  parameters: {
    type: 'object',
    properties: {
      subject: { type: 'string', description: 'One line, as the customer would put it.' },
      body: { type: 'string', description: 'What happened, in enough detail for a colleague to pick up.' },
      priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
      lead_id: { type: 'number' },
    },
    required: ['subject'],
    additionalProperties: false,
  },
  mutates: true,

  async run(args, ctx) {
    const subject = str(args, 'subject', { required: true, max: 200 });
    const customer = await resolveCustomer(args, ctx).catch(() => null);

    const { data, error } = await serviceClient
      .from('support_tickets')
      .insert({
        tenant_id: ctx.tenantId,
        lead_id: customer?.leadId ?? null,
        conversation_id: ctx.conversationId,
        customer_id: customer?.customerId ?? null,
        customer_name: customer?.customerName ?? null,
        subject,
        body: str(args, 'body', { max: 4000 }),
        priority: oneOf(args, 'priority', ['low', 'normal', 'high', 'urgent'] as const, 'normal'),
        opened_by_agent: ctx.agentRole,
      })
      .select('id, subject, priority, status')
      .single();

    if (error) throw new Error(error.message);
    return { ticket: data };
  },
};

export const listTickets: Tool = {
  name: 'list_tickets',
  description: 'List support tickets that are still open, most urgent first.',
  parameters: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['open', 'in_progress', 'waiting', 'resolved', 'closed'] },
    },
    additionalProperties: false,
  },
  mutates: false,

  async run(args, ctx) {
    const status = str(args, 'status', { lower: true });

    let q = serviceClient
      .from('support_tickets')
      .select('id, subject, customer_name, priority, status, created_at')
      .eq('tenant_id', ctx.tenantId)
      .order('created_at', { ascending: false })
      .limit(30);

    q = status ? q.eq('status', status) : q.in('status', ['open', 'in_progress', 'waiting']);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return { tickets: data ?? [] };
  },
};

export const updateTicket: Tool = {
  name: 'update_ticket',
  description: 'Change a ticket\'s status or record how it was resolved.',
  parameters: {
    type: 'object',
    properties: {
      ticket_id: { type: 'string' },
      status: { type: 'string', enum: ['open', 'in_progress', 'waiting', 'resolved', 'closed'] },
      resolution: { type: 'string' },
    },
    required: ['ticket_id'],
    additionalProperties: false,
  },
  mutates: true,

  async run(args, ctx) {
    const id = str(args, 'ticket_id', { required: true, max: 64 });
    const status = str(args, 'status', { lower: true });
    const resolution = str(args, 'resolution', { max: 2000 });

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (status) {
      patch.status = oneOf(args, 'status', ['open', 'in_progress', 'waiting', 'resolved', 'closed'] as const, null);
      if (status === 'resolved' || status === 'closed') patch.resolved_at = new Date().toISOString();
    }
    if (resolution) patch.resolution = resolution;
    if (Object.keys(patch).length === 1) throw new ToolInputError('Nothing to change.');

    const { data, error } = await serviceClient
      .from('support_tickets')
      .update(patch)
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id)
      .select('id, subject, status')
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) throw new ToolInputError('That ticket no longer exists.');
    return { updated: data };
  },
};

export const escalateToHuman: Tool = {
  name: 'escalate_to_human',
  description:
    'Hand this conversation to a person. Use it when the customer is upset, when money or a complaint is involved, when you are not confident, or whenever they ask for a human. Say so in the conversation as well — the customer should never be handed over in silence.',
  parameters: {
    type: 'object',
    properties: {
      reason: { type: 'string', description: 'Why a person is needed, in one line.' },
      priority: { type: 'string', enum: ['normal', 'high', 'urgent'] },
    },
    required: ['reason'],
    additionalProperties: false,
  },
  mutates: true,

  async run(args, ctx) {
    if (!ctx.conversationId) {
      throw new ToolInputError('There is no conversation to hand over here.');
    }
    const reason = str(args, 'reason', { required: true, max: 500 });

    const customer = await resolveCustomer({}, ctx).catch(() => null);

    // Switching the AI off is the actual handover: n8n and this dispatcher both
    // read ai_enabled before answering, so this is what stops the agent
    // replying over the top of a colleague.
    const { data: conversation, error } = await serviceClient
      .from('conversations')
      .update({ ai_enabled: false, updated_at: new Date().toISOString() })
      .eq('tenant_id', ctx.tenantId)
      .eq('id', ctx.conversationId)
      .select('id, customer_name')
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!conversation) throw new ToolInputError('This conversation is no longer available.');

    // A note in the transcript, so whoever picks it up sees why.
    await serviceClient.from('conversation_messages').insert({
      tenant_id: ctx.tenantId,
      conversation_id: ctx.conversationId,
      sender: 'system',
      body: `Handed to a person by the ${ctx.agentRole} agent: ${reason}`,
    });

    // And a ticket, so it is on a list rather than only in a thread.
    const { data: ticket } = await serviceClient
      .from('support_tickets')
      .insert({
        tenant_id: ctx.tenantId,
        lead_id: customer?.leadId ?? null,
        conversation_id: ctx.conversationId,
        customer_id: customer?.customerId ?? null,
        customer_name: conversation.customer_name,
        subject: reason.slice(0, 200),
        body: `Escalated from the ${ctx.agentRole} agent.`,
        priority: oneOf(args, 'priority', ['normal', 'high', 'urgent'] as const, 'high'),
        opened_by_agent: ctx.agentRole,
      })
      .select('id')
      .single();

    return {
      handed_over: true,
      ticket_id: ticket?.id ?? null,
      note: 'Tell the customer a colleague will pick this up. Do not keep answering.',
    };
  },
};

// ---------------------------------------------------------------------------
// Follow-ups
// ---------------------------------------------------------------------------

export const scheduleFollowUp: Tool = {
  name: 'schedule_follow_up',
  description:
    'Write a message to be sent to a customer later — for someone who went quiet, or who asked you to check back. It is queued, not sent: the owner can read, change or cancel it first.',
  parameters: {
    type: 'object',
    properties: {
      lead_id: { type: 'number', description: 'Required when you are not in the customer\'s own conversation.' },
      due_at: { type: 'string', description: 'ISO date-time to send it.' },
      message: { type: 'string', description: 'Exactly what should be sent, in the business\'s voice.' },
      reason: { type: 'string', description: 'Why, for the owner\'s benefit.' },
    },
    required: ['due_at', 'message'],
    additionalProperties: false,
  },
  mutates: true,

  async run(args, ctx) {
    const dueAt = when(args, 'due_at', { required: true })!;
    if (new Date(dueAt).getTime() < Date.now() - 60_000) {
      throw new ToolInputError('due_at is in the past. Pick a future time.');
    }
    const message = str(args, 'message', { required: true, max: 1000 });
    const customer = await resolveCustomer(args, ctx);

    if (!customer.customerId || !customer.channelType) {
      throw new ToolInputError("We have no way to reach that customer, so a follow-up can't be queued.");
    }

    // One pending follow-up per customer. An agent that reasons twice about the
    // same silent lead should not queue two messages to them.
    const { data: existing } = await serviceClient
      .from('follow_ups')
      .select('id, due_at')
      .eq('tenant_id', ctx.tenantId)
      .eq('customer_id', customer.customerId)
      .eq('status', 'pending')
      .maybeSingle();

    if (existing) {
      return {
        queued: false,
        already_queued_for: existing.due_at,
        note: 'One is already waiting for this customer. Cancel it first if you want to change it.',
      };
    }

    const { data, error } = await serviceClient
      .from('follow_ups')
      .insert({
        tenant_id: ctx.tenantId,
        lead_id: customer.leadId,
        conversation_id: ctx.conversationId,
        customer_id: customer.customerId,
        channel_type: customer.channelType,
        due_at: dueAt,
        message,
        reason: str(args, 'reason', { max: 500 }) || null,
        created_by_agent: ctx.agentRole,
      })
      .select('id, due_at, message')
      .single();

    if (error) throw new Error(error.message);
    return { queued: true, follow_up: data };
  },
};

export const listFollowUps: Tool = {
  name: 'list_follow_ups',
  description: 'List follow-ups waiting to be sent.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  mutates: false,

  async run(_args, ctx) {
    const { data, error } = await serviceClient
      .from('follow_ups')
      .select('id, due_at, message, reason, channel_type')
      .eq('tenant_id', ctx.tenantId)
      .eq('status', 'pending')
      .order('due_at')
      .limit(30);
    if (error) throw new Error(error.message);
    return { follow_ups: data ?? [] };
  },
};

export const cancelFollowUp: Tool = {
  name: 'cancel_follow_up',
  description: 'Cancel a queued follow-up so it is never sent.',
  parameters: {
    type: 'object',
    properties: { follow_up_id: { type: 'string' } },
    required: ['follow_up_id'],
    additionalProperties: false,
  },
  mutates: true,

  async run(args, ctx) {
    const id = str(args, 'follow_up_id', { required: true, max: 64 });
    const { data, error } = await serviceClient
      .from('follow_ups')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) throw new ToolInputError('That follow-up is not waiting to be sent.');
    return { cancelled: true };
  },
};
