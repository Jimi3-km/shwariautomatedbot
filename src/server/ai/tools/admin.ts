import { serviceClient } from '../../supabase.js';
import { getProvider } from '../../channels/providers/index.js';
import { ToolInputError, str, type Tool, type AgentContext } from './types.js';

/**
 * The manager's reach into the rest of the dashboard.
 *
 * Shwari is the owner's assistant, so it should be able to do what the owner
 * can do from a keyboard: change the business settings, and act in the inbox —
 * message a customer, or take a conversation over from the AI and hand it back.
 *
 * Four things stay off-limits on purpose, and they are the same four the whole
 * platform is built around: an agent never verifies a payment, never changes
 * who has access or their role, never connects a channel (that needs a secret
 * the owner pastes), and never permanently deletes. Everything reversible and
 * operational is fair game; those four are not, and the tools for them simply
 * do not exist here.
 */

// ---------------------------------------------------------------------------
// Business settings
// ---------------------------------------------------------------------------

export const updateBusinessSettings: Tool = {
  name: 'update_business_settings',
  description:
    'Change the business settings the owner sets on the Settings page: the assistant\'s name, address, order-number prefix, contact email and phone, delivery information, languages, and where alerts are sent. Send only the fields the owner actually mentioned; anything you omit is left as it was. For the business name, description, category, timezone or currency use update_business_profile instead.',
  parameters: {
    type: 'object',
    properties: {
      assistant_name: { type: 'string', description: 'What the AI calls itself to customers.' },
      address: { type: 'string' },
      order_prefix: { type: 'string', description: 'Appears at the front of every order number, e.g. ORD.' },
      contact_email: { type: 'string' },
      contact_phone: { type: 'string' },
      delivery_info: { type: 'string', description: 'How delivery works, in plain language.' },
      languages: {
        type: 'array',
        items: { type: 'string' },
        description: 'Languages the business serves, e.g. ["English", "Swahili"].',
      },
      alerts_to: { type: 'string', description: 'Where owner alerts are sent — a phone, chat id or email.' },
    },
    additionalProperties: false,
  },
  mutates: true,

  async run(args, ctx) {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

    const assistant = str(args, 'assistant_name', { max: 80 });
    const address = str(args, 'address', { max: 300 });
    const prefix = str(args, 'order_prefix', { max: 12 });
    const email = str(args, 'contact_email', { max: 200 }).toLowerCase();
    const phone = str(args, 'contact_phone', { max: 40 });
    const delivery = str(args, 'delivery_info', { max: 2000 });
    const alerts = str(args, 'alerts_to', { max: 200 });

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ToolInputError('That contact email does not look valid.');
    }
    if (assistant) patch.agent_name = assistant;
    if (address) patch.address = address;
    if (prefix) patch.order_prefix = prefix.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'ORD';
    if (delivery) patch.delivery_rules = { note: delivery };

    if (Array.isArray(args.languages)) {
      const langs = args.languages
        .map((l) => String(l).trim())
        .filter(Boolean)
        .slice(0, 10);
      if (langs.length) patch.languages = langs;
    }

    // contact_info is a JSON blob, so it is read and merged rather than
    // overwritten — setting a phone must not wipe an existing email.
    if (email || phone) {
      const { data: tenant } = await serviceClient
        .from('tenants').select('contact_info').eq('id', ctx.tenantId).single();
      const current = (tenant?.contact_info && typeof tenant.contact_info === 'object')
        ? tenant.contact_info as Record<string, unknown>
        : {};
      patch.contact_info = {
        ...current,
        ...(email ? { email } : {}),
        ...(phone ? { phone } : {}),
      };
    }

    if (alerts) patch.notification_target = alerts;

    if (Object.keys(patch).length === 1) {
      throw new ToolInputError('Nothing to change. Send at least one setting.');
    }

    const { error } = await serviceClient.from('tenants').update(patch).eq('id', ctx.tenantId);
    if (error) throw new Error(error.message);

    return { updated: Object.keys(patch).filter((k) => k !== 'updated_at') };
  },
};

// ---------------------------------------------------------------------------
// Acting in the inbox
// ---------------------------------------------------------------------------

/** The lead, its live conversation, and the channel that reaches it. */
async function resolveInbox(ctx: AgentContext, leadId: number) {
  const { data: lead } = await serviceClient
    .from('leads')
    .select('id, customer_name, channel_type, customer_id')
    .eq('tenant_id', ctx.tenantId)
    .eq('id', leadId)
    .maybeSingle();
  if (!lead) throw new ToolInputError(`There is no customer with id ${leadId}. Search first.`);

  const { data: conv } = await serviceClient
    .from('conversations')
    .select('id, ai_enabled')
    .eq('tenant_id', ctx.tenantId)
    .eq('channel_type', lead.channel_type)
    .eq('customer_id', lead.customer_id)
    .maybeSingle();
  if (!conv) throw new ToolInputError('That customer has no open conversation to act on.');

  return { lead, conversation: conv };
}

export const messageCustomer: Tool = {
  name: 'message_customer',
  description:
    'Send a message to a customer in their conversation — for example to tell them an order is ready or answer a question the owner asked you to pass on. Use find_customers first to get the lead_id. The message is sent on whatever channel the customer uses.',
  parameters: {
    type: 'object',
    properties: {
      lead_id: { type: 'number' },
      text: { type: 'string' },
    },
    required: ['lead_id', 'text'],
    additionalProperties: false,
  },
  mutates: true,

  async run(args, ctx) {
    const leadId = Number(args.lead_id);
    if (!Number.isInteger(leadId)) throw new ToolInputError('lead_id is required.');
    const text = str(args, 'text', { required: true, max: 2000 });

    const { lead, conversation } = await resolveInbox(ctx, leadId);
    const now = new Date().toISOString();

    // Written to the transcript first, so the Inbox shows what was said whether
    // or not the outbound send succeeds — and web chat has no outbound API, so
    // for that channel the transcript IS the delivery.
    await serviceClient.from('conversation_messages').insert({
      tenant_id: ctx.tenantId,
      conversation_id: conversation.id,
      sender: 'agent',
      body: text,
      extracted: { agent: 'shwari', sent_by: 'owner' },
    });
    await serviceClient
      .from('conversations')
      .update({ last_message_at: now, last_message_preview: text.slice(0, 160) })
      .eq('id', conversation.id)
      .eq('tenant_id', ctx.tenantId);

    if (lead.channel_type !== 'webchat') {
      const provider = getProvider(lead.channel_type);
      const { data: channel } = await serviceClient
        .from('channels')
        .select('id')
        .eq('tenant_id', ctx.tenantId)
        .eq('channel_type', lead.channel_type)
        .eq('status', 'active')
        .maybeSingle();

      if (provider && channel) {
        try {
          await provider.sendMessage(channel.id, lead.customer_id, text, { tenantId: ctx.tenantId, userId: '' });
        } catch (e) {
          // The transcript already holds it; report the delivery problem rather
          // than losing the message.
          console.error('[admin] message_customer delivery failed:', e instanceof Error ? e.message : e);
          return { sent: false, saved: true, note: 'Saved to the inbox, but it could not be delivered on the channel just now.' };
        }
      }
    }

    return { sent: true, to: lead.customer_name || `customer ${leadId}` };
  },
};

export const setConversationHandling: Tool = {
  name: 'set_conversation_handling',
  description:
    'Take a conversation over from the AI so a person answers it, or hand it back to the AI. Use find_customers first to get the lead_id. Taking over is what you do when the owner wants to reply themselves.',
  parameters: {
    type: 'object',
    properties: {
      lead_id: { type: 'number' },
      handled_by: {
        type: 'string',
        enum: ['person', 'ai'],
        description: '"person" stops the AI answering; "ai" hands it back.',
      },
    },
    required: ['lead_id', 'handled_by'],
    additionalProperties: false,
  },
  mutates: true,

  async run(args, ctx) {
    const leadId = Number(args.lead_id);
    if (!Number.isInteger(leadId)) throw new ToolInputError('lead_id is required.');
    const who = str(args, 'handled_by', { lower: true });
    if (who !== 'person' && who !== 'ai') {
      throw new ToolInputError('handled_by must be "person" or "ai".');
    }

    const { conversation } = await resolveInbox(ctx, leadId);

    const { error } = await serviceClient
      .from('conversations')
      .update({ ai_enabled: who === 'ai', updated_at: new Date().toISOString() })
      .eq('id', conversation.id)
      .eq('tenant_id', ctx.tenantId);
    if (error) throw new Error(error.message);

    return {
      handled_by: who,
      note: who === 'person'
        ? 'The AI will stop answering this customer until you hand it back.'
        : 'The AI is answering this customer again.',
    };
  },
};
