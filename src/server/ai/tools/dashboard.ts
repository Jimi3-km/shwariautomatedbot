import { serviceClient } from '../../supabase.js';
import { ToolInputError, str, num, type Tool, type AgentContext } from './types.js';

/**
 * Reading the rest of the dashboard back to its owner.
 *
 * Every page the owner can open, Shwari can look at: the inbox, the payment
 * claims waiting to be checked, the connected channels, the agent settings on
 * the "AI Agent" page. These are the read tools that complete the pair with the
 * writes elsewhere in this directory — without them Shwari could *change* a
 * setting the owner could not ask it to *read back*, which is exactly the kind
 * of half-blind assistant that makes an owner stop trusting the chat box.
 *
 * What still has no tool, on purpose:
 *
 *   - verifying or rejecting a payment (a person, and the database trigger,
 *     decide that; the most this layer can do is list the claims)
 *   - connecting or disconnecting a channel (that needs a secret the owner
 *     pastes by hand, and an OAuth round trip through a browser)
 *   - anything that grants access or changes a role
 *
 * Those are absent because the guarantee depends on their absence, not because
 * they were forgotten.
 */

// ---------------------------------------------------------------------------
// Business settings (the Settings page)
// ---------------------------------------------------------------------------

export const getBusinessSettings: Tool = {
  name: 'get_business_settings',
  description:
    'Read the settings on the Settings page: the assistant\'s name, address, order-number prefix, contact email and phone, delivery details, languages, and where alerts go. Use this before changing a setting, or to answer a question about how the business is set up. For the name, description, category, timezone and currency use get_business_profile instead.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  mutates: false,

  async run(_args, ctx) {
    const { data, error } = await serviceClient
      .from('tenants')
      .select('agent_name, address, order_prefix, contact_info, delivery_rules, languages, notification_channel, notification_target, timezone, currency, business_name')
      .eq('id', ctx.tenantId)
      .single();
    if (error) throw new Error(error.message);

    return {
      assistant_name: data?.agent_name ?? null,
      address: data?.address ?? null,
      order_prefix: data?.order_prefix ?? null,
      contact: data?.contact_info ?? {},
      delivery: data?.delivery_rules ?? {},
      languages: Array.isArray(data?.languages) ? data.languages : [],
      alerts_to: data?.notification_target ?? null,
      timezone: data?.timezone ?? null,
      currency: data?.currency ?? null,
    };
  },
};

// ---------------------------------------------------------------------------
// Connected channels (the Integrations page)
// ---------------------------------------------------------------------------

export const listChannels: Tool = {
  name: 'list_channels',
  description:
    'List the messaging channels this business is connected on — Telegram, WhatsApp, Instagram, web chat — and whether each is live. Use this to answer "where can customers reach us?" or "is WhatsApp connected yet?". You cannot connect or disconnect a channel from chat; that is done on the Integrations page.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  mutates: false,

  async run(_args, ctx) {
    // channels_safe is the same view the Integrations page reads: every secret
    // is reduced to a boolean, so nothing sensitive can leave through here.
    const { data, error } = await serviceClient
      .from('channels_safe')
      .select('channel_type, channel_account_id, display_name, status, created_at')
      .eq('tenant_id', ctx.tenantId)
      .order('created_at');
    if (error) throw new Error(error.message);

    const channels = data ?? [];
    return {
      channels,
      connected: channels.filter((c) => c.status === 'active').length,
      note: channels.length
        ? undefined
        : 'No channel is connected yet. Customers cannot reach the AI until one is.',
    };
  },
};

// ---------------------------------------------------------------------------
// The inbox (the Inbox page)
// ---------------------------------------------------------------------------

const HANDLED_BY = ['ai', 'person'] as const;

export const listConversations: Tool = {
  name: 'list_conversations',
  description:
    'List recent customer conversations — who they are, which channel, whether the AI or a person is answering, and whether anything is unread. Use this to answer "what is waiting on me?" or "who has messaged us lately?". To read what was actually said in one, use read_conversation.',
  parameters: {
    type: 'object',
    properties: {
      unread_only: { type: 'boolean', description: 'Only conversations with unread messages.' },
      handled_by: {
        type: 'string',
        enum: [...HANDLED_BY],
        description: 'Filter to conversations the AI is answering, or ones a person has taken over.',
      },
      search: { type: 'string', description: 'Part of a customer name or handle.' },
    },
    additionalProperties: false,
  },
  mutates: false,

  async run(args, ctx) {
    let q = serviceClient
      .from('conversations')
      .select('id, channel_type, customer_name, customer_id, status, ai_enabled, unread_count, last_message_preview, last_message_at, lead_id')
      .eq('tenant_id', ctx.tenantId)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(40);

    if (args.unread_only === true || String(args.unread_only).toLowerCase() === 'true') {
      q = q.gt('unread_count', 0);
    }
    const who = str(args, 'handled_by', { lower: true });
    if (who) {
      if (!(HANDLED_BY as readonly string[]).includes(who)) {
        throw new ToolInputError('handled_by must be "ai" or "person".');
      }
      q = q.eq('ai_enabled', who === 'ai');
    }
    const search = str(args, 'search', { max: 100 });
    if (search) {
      const safe = search.replace(/[%,()]/g, ' ').trim();
      if (safe) q = q.or(`customer_name.ilike.%${safe}%,customer_id.ilike.%${safe}%`);
    }

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    return {
      conversations: (data ?? []).map((c) => ({
        conversation_id: c.id,
        customer: c.customer_name || c.customer_id,
        channel: c.channel_type,
        answered_by: c.ai_enabled ? 'ai' : 'a person',
        unread: c.unread_count ?? 0,
        last_message: c.last_message_preview,
        last_message_at: c.last_message_at,
        lead_id: c.lead_id,
      })),
      count: (data ?? []).length,
    };
  },
};

/** The conversation a lead is having, by the same identity the inbox uses. */
async function conversationForLead(ctx: AgentContext, leadId: number) {
  const { data: lead } = await serviceClient
    .from('leads')
    .select('id, customer_name, channel_type, customer_id')
    .eq('tenant_id', ctx.tenantId)
    .eq('id', leadId)
    .maybeSingle();
  if (!lead) throw new ToolInputError(`There is no customer with id ${leadId}. Search first.`);

  const { data: conv } = await serviceClient
    .from('conversations')
    .select('id, customer_name, channel_type, ai_enabled, lead_id')
    .eq('tenant_id', ctx.tenantId)
    .eq('channel_type', lead.channel_type)
    .eq('customer_id', lead.customer_id)
    .maybeSingle();
  if (!conv) throw new ToolInputError('That customer has no conversation on file.');

  return conv;
}

export const readConversation: Tool = {
  name: 'read_conversation',
  description:
    'Read the recent messages of one customer conversation, so you can summarise it or answer a question about it. Give the lead_id from find_customers, or a conversation_id from list_conversations.',
  parameters: {
    type: 'object',
    properties: {
      lead_id: { type: 'number', description: 'The customer, from find_customers.' },
      conversation_id: { type: 'string', description: 'A conversation id from list_conversations.' },
    },
    additionalProperties: false,
  },
  mutates: false,

  async run(args, ctx) {
    const leadId = num(args, 'lead_id');
    const conversationId = str(args, 'conversation_id', { max: 64 });

    let conversation: { id: string; customer_name: string | null; channel_type: string | null; ai_enabled: boolean } | null = null;

    if (conversationId) {
      const { data } = await serviceClient
        .from('conversations')
        .select('id, customer_name, channel_type, ai_enabled')
        .eq('tenant_id', ctx.tenantId)
        .eq('id', conversationId)
        .maybeSingle();
      conversation = data ?? null;
    } else if (leadId !== null) {
      conversation = await conversationForLead(ctx, leadId);
    } else {
      throw new ToolInputError('Give a lead_id or a conversation_id.');
    }

    if (!conversation) throw new ToolInputError('That conversation no longer exists.');

    const { data: messages, error } = await serviceClient
      .from('conversation_messages')
      .select('sender, body, created_at')
      .eq('tenant_id', ctx.tenantId)
      .eq('conversation_id', conversation.id)
      .in('sender', ['customer', 'agent', 'staff'])
      .order('created_at', { ascending: false })
      .limit(40);
    if (error) throw new Error(error.message);

    return {
      conversation: {
        conversation_id: conversation.id,
        customer: conversation.customer_name,
        channel: conversation.channel_type,
        answered_by: conversation.ai_enabled ? 'ai' : 'a person',
      },
      // Oldest first, the way a person reads a thread.
      messages: (messages ?? []).reverse(),
    };
  },
};

// ---------------------------------------------------------------------------
// Payment claims (the Payments page)
// ---------------------------------------------------------------------------

const VERIFICATION_STATES = ['unverified', 'verified', 'rejected'] as const;

export const listPaymentClaims: Tool = {
  name: 'list_payment_claims',
  description:
    'List payment claims customers have made, so the owner can see what is waiting to be checked. Use it for "what payments need verifying?" or "has this customer paid?". You can only READ this list — verifying or rejecting a payment is a person\'s decision, made on the Payments page.',
  parameters: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: [...VERIFICATION_STATES],
        description: 'Which claims to show. Leave out to see the most recent of every kind.',
      },
      lead_id: { type: 'number', description: 'Only one customer\'s claims.' },
    },
    additionalProperties: false,
  },
  mutates: false,

  async run(args, ctx) {
    const status = str(args, 'status', { lower: true });
    if (status && !(VERIFICATION_STATES as readonly string[]).includes(status)) {
      throw new ToolInputError(`status must be one of: ${VERIFICATION_STATES.join(', ')}.`);
    }

    let q = serviceClient
      .from('payments')
      .select('id, transaction_code, amount, currency, payment_method, verification_status, customer_id, customer_phone, customer_email, order_id, created_at, verified_at')
      .eq('tenant_id', ctx.tenantId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (status) q = q.eq('verification_status', status);
    const leadId = num(args, 'lead_id');
    if (leadId !== null) q = q.eq('lead_id', leadId);

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const claims = data ?? [];
    return {
      claims,
      count: claims.length,
      awaiting_verification: claims.filter((c) => c.verification_status === 'unverified').length,
      note: 'Recorded claims only. Whether the money arrived is decided by a person on the Payments page.',
    };
  },
};

// ---------------------------------------------------------------------------
// Agent settings (the "AI Agent" page)
// ---------------------------------------------------------------------------

const MEMORY_MIN = 1;
const MEMORY_MAX = 200;
const FOLLOWUP_MIN = 1;
const FOLLOWUP_MAX = 720;

/** Handover rules are stored as a JSON blob; a person edits a simple list. */
function handoverRules(value: unknown): string[] {
  const rules = (value ?? {}) as { handover_if?: unknown };
  return Array.isArray(rules.handover_if)
    ? rules.handover_if.filter((r): r is string => typeof r === 'string')
    : [];
}

export const getAgentSettings: Tool = {
  name: 'get_agent_settings',
  description:
    'Read the settings on the "AI Agent" page: the agent\'s personality, its sales steps, upsells, handover rules, business instructions, follow-up message and delay. Read these before changing any of them, so you preserve what is still true.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  mutates: false,

  async run(_args, ctx) {
    const { data, error } = await serviceClient
      .from('agent_settings')
      .select('persona, custom_instructions, followup_template, model, memory_window, followup_delay_hours, sales_script, escalation_rules, upsell_catalogue')
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle();
    if (error) throw new Error(error.message);

    if (!data) {
      return {
        configured: false,
        note: 'Nothing has been set on the AI Agent page yet. The agents are running on their built-in defaults.',
      };
    }

    return {
      configured: true,
      persona: data.persona ?? null,
      custom_instructions: data.custom_instructions ?? null,
      sales_script: Array.isArray(data.sales_script) ? data.sales_script : [],
      upsells: Array.isArray(data.upsell_catalogue) ? data.upsell_catalogue : [],
      handover_rules: handoverRules(data.escalation_rules),
      followup_template: data.followup_template ?? null,
      followup_delay_hours: data.followup_delay_hours ?? FOLLOWUP_MIN,
      model: data.model ?? null,
      memory_window: data.memory_window ?? MEMORY_MIN,
    };
  },
};

export const updateAgentSettings: Tool = {
  name: 'update_agent_settings',
  description:
    'Change the settings on the "AI Agent" page: the agent\'s personality, its sales steps, upsells, handover rules, business instructions, follow-up message and delay. Send only what the owner asked to change. Read get_agent_settings first and carry the rest through, because lists you send replace the old ones.',
  parameters: {
    type: 'object',
    properties: {
      persona: { type: 'string', description: 'How the agent should come across, in plain language.' },
      custom_instructions: { type: 'string', description: 'Anything the agent must always know or never say.' },
      sales_script: { type: 'array', items: { type: 'string' }, description: 'The steps, in order. Replaces the existing list.' },
      upsells: { type: 'array', items: { type: 'string' }, description: 'Extras to suggest. Replaces the existing list.' },
      handover_rules: { type: 'array', items: { type: 'string' }, description: 'When to fetch a person. Replaces the existing list.' },
      followup_template: { type: 'string', description: 'The message sent to a quiet customer.' },
      followup_delay_hours: { type: 'number', description: `Hours of silence before following up (${FOLLOWUP_MIN}–${FOLLOWUP_MAX}).` },
      memory_window: { type: 'number', description: `How many past messages to keep in mind (${MEMORY_MIN}–${MEMORY_MAX}).` },
      model: { type: 'string', description: 'Which model answers customers.' },
    },
    additionalProperties: false,
  },
  mutates: true,

  async run(args, ctx) {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (args.persona !== undefined) patch.persona = str(args, 'persona', { max: 2000 });
    if (args.custom_instructions !== undefined) patch.custom_instructions = str(args, 'custom_instructions', { max: 4000 });
    if (args.followup_template !== undefined) patch.followup_template = str(args, 'followup_template', { max: 1000 });

    if (args.model !== undefined) {
      const model = str(args, 'model', { max: 80 });
      if (model) patch.model = model;
    }

    if (args.memory_window !== undefined) {
      const window = num(args, 'memory_window');
      if (window === null || !Number.isInteger(window) || window < MEMORY_MIN || window > MEMORY_MAX) {
        throw new ToolInputError(`memory_window must be a whole number between ${MEMORY_MIN} and ${MEMORY_MAX}.`);
      }
      patch.memory_window = window;
    }

    if (args.followup_delay_hours !== undefined) {
      const delay = num(args, 'followup_delay_hours');
      if (delay === null || !Number.isInteger(delay) || delay < FOLLOWUP_MIN || delay > FOLLOWUP_MAX) {
        throw new ToolInputError(`followup_delay_hours must be a whole number between ${FOLLOWUP_MIN} and ${FOLLOWUP_MAX}.`);
      }
      patch.followup_delay_hours = delay;
    }

    if (args.sales_script !== undefined) patch.sales_script = stringList(args.sales_script, 'sales_script');
    if (args.upsells !== undefined) patch.upsell_catalogue = stringList(args.upsells, 'upsells');
    if (args.handover_rules !== undefined) {
      patch.escalation_rules = { handover_if: stringList(args.handover_rules, 'handover_rules') };
    }

    if (Object.keys(patch).length === 1) {
      throw new ToolInputError('Nothing to change. Send at least one setting.');
    }

    // upsert so a tenant that has never opened the page still works.
    const { error } = await serviceClient
      .from('agent_settings')
      .upsert({ tenant_id: ctx.tenantId, ...patch }, { onConflict: 'tenant_id' });
    if (error) throw new Error(error.message);

    return { updated: Object.keys(patch).filter((k) => k !== 'updated_at') };
  },
};

/** A list of short strings, cleaned and bounded. */
function stringList(raw: unknown, field: string): string[] {
  if (!Array.isArray(raw)) throw new ToolInputError(`${field} must be a list of short lines.`);
  const out = raw.map((v) => String(v ?? '').trim()).filter(Boolean).slice(0, 30);
  if (out.some((s) => s.length > 300)) {
    throw new ToolInputError(`Each ${field} line must be 300 characters or fewer.`);
  }
  return out;
}
