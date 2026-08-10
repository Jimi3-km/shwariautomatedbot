import { Router } from 'express';
import { requireAuth, requireWrite, handler } from '../auth.js';
import { serviceClient } from '../supabase.js';
import { sendTelegramMessage } from '../channels/telegram.js';

export const inboxRouter = Router();

// ---------------------------------------------------------------------------
// Conversations -- channel agnostic. Nothing here is Telegram-specific except
// the outbound send, which dispatches on channel_type.
// ---------------------------------------------------------------------------

inboxRouter.get(
  '/conversations',
  requireAuth,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    let q = ctx.db
      .from('conversations')
      .select(
        'id, channel_type, channel_id, customer_id, customer_name, status, ai_enabled, unread_count, last_message_preview, last_message_at, lead_id, created_at',
        { count: 'exact' }
      )
      .eq('tenant_id', ctx.tenantId)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1);

    if (req.query.status) q = q.eq('status', String(req.query.status));
    if (req.query.channel_type) q = q.eq('channel_type', String(req.query.channel_type));
    if (req.query.unread === 'true') q = q.gt('unread_count', 0);
    // handled_by=ai|human maps onto the takeover flag that n8n reads.
    if (req.query.handled_by === 'ai') q = q.eq('ai_enabled', true);
    if (req.query.handled_by === 'human') q = q.eq('ai_enabled', false);
    if (req.query.search) {
      const s = String(req.query.search).replace(/[%,()]/g, '');
      q = q.or(`customer_name.ilike.%${s}%,customer_id.ilike.%${s}%,last_message_preview.ilike.%${s}%`);
    }

    const { data, error, count } = await q;
    if (error) return res.status(400).json({ error: error.message });

    // Attach lead stage for the list's stage badge.
    const leadIds = (data ?? []).map((c) => c.lead_id).filter(Boolean);
    let stages: Record<string, string | null> = {};
    if (leadIds.length) {
      const { data: leads } = await ctx.db
        .from('leads').select('id, stage').eq('tenant_id', ctx.tenantId).in('id', leadIds);
      stages = Object.fromEntries((leads ?? []).map((l) => [String(l.id), l.stage]));
    }

    res.json({
      conversations: (data ?? []).map((c) => ({
        ...c,
        lead_stage: c.lead_id ? stages[String(c.lead_id)] ?? null : null,
      })),
      total: count ?? 0,
      limit,
      offset,
    });
  })
);

inboxRouter.get(
  '/conversations/:id',
  requireAuth,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const { data: convo, error } = await ctx.db
      .from('conversations').select('*').eq('id', req.params.id).eq('tenant_id', ctx.tenantId).maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!convo) return res.status(404).json({ error: 'Conversation not found' });

    const { data: messages } = await ctx.db
      .from('conversation_messages')
      .select('id, sender, body, extracted, created_at')
      .eq('tenant_id', ctx.tenantId)
      .eq('conversation_id', convo.id)
      .order('created_at', { ascending: true })
      .limit(500);

    const { data: lead } = convo.lead_id
      ? await ctx.db.from('leads').select('*').eq('tenant_id', ctx.tenantId).eq('id', convo.lead_id).maybeSingle()
      : { data: null as any };

    const { data: payments } = await ctx.db
      .from('payments')
      .select('id, transaction_code, amount, currency, payment_method, verification_status, created_at')
      .eq('tenant_id', ctx.tenantId)
      .eq('conversation_id', convo.id)
      .order('created_at', { ascending: false });

    res.json({ conversation: convo, messages: messages ?? [], lead: lead ?? null, payments: payments ?? [] });
  })
);

/** Mark read. */
inboxRouter.post(
  '/conversations/:id/read',
  requireAuth,
  requireWrite,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const { data, error } = await ctx.db
      .from('conversations')
      .update({ unread_count: 0 })
      .eq('id', req.params.id).eq('tenant_id', ctx.tenantId)
      .select('id, unread_count').maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Conversation not found' });
    res.json(data);
  })
);

/**
 * Take over from the AI, or hand back.
 * n8n checks conversations.ai_enabled before generating a reply, so flipping
 * this is what actually silences the agent.
 */
inboxRouter.post(
  '/conversations/:id/takeover',
  requireAuth,
  requireWrite,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const aiEnabled = Boolean(req.body?.ai_enabled);
    const { data, error } = await ctx.db
      .from('conversations')
      .update({ ai_enabled: aiEnabled, assigned_to: aiEnabled ? null : ctx.userId })
      .eq('id', req.params.id).eq('tenant_id', ctx.tenantId)
      .select('id, ai_enabled, assigned_to').maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Conversation not found' });

    await ctx.db.from('conversation_messages').insert({
      tenant_id: ctx.tenantId,
      conversation_id: data.id,
      sender: 'system',
      body: aiEnabled ? 'AI agent resumed by staff.' : 'Conversation taken over by staff.',
    });

    res.json(data);
  })
);

/** Staff sends a manual reply through whichever channel the customer used. */
inboxRouter.post(
  '/conversations/:id/reply',
  requireAuth,
  requireWrite,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const text = String(req.body?.body ?? '').trim();
    if (!text) return res.status(400).json({ error: 'body is required' });
    if (text.length > 4000) return res.status(400).json({ error: 'body exceeds 4000 characters' });

    const { data: convo } = await ctx.db
      .from('conversations')
      .select('id, channel_id, channel_type, customer_id')
      .eq('id', req.params.id).eq('tenant_id', ctx.tenantId).maybeSingle();
    if (!convo) return res.status(404).json({ error: 'Conversation not found' });

    // The bot token lives behind the service client; it is never sent to the
    // browser and never leaves this process.
    const { data: channel } = await serviceClient
      .from('channels')
      .select('id, tenant_id, channel_type, bot_token, status')
      .eq('id', convo.channel_id ?? '')
      .eq('tenant_id', ctx.tenantId)      // re-assert tenancy on the privileged read
      .maybeSingle();

    if (!channel || channel.status !== 'active') {
      return res.status(409).json({ error: 'No active channel is connected for this conversation' });
    }

    try {
      if (channel.channel_type === 'telegram') {
        if (!channel.bot_token) return res.status(409).json({ error: 'Telegram channel has no bot token' });
        await sendTelegramMessage(channel.bot_token, convo.customer_id, text);
      } else {
        return res.status(501).json({
          error: `Outbound sending for ${channel.channel_type} is not implemented yet`,
          code: 'CHANNEL_PENDING',
        });
      }
    } catch (e: any) {
      return res.status(502).json({ error: `Channel rejected the message: ${e.message}` });
    }

    const now = new Date().toISOString();
    const { data: msg, error } = await ctx.db
      .from('conversation_messages')
      .insert({
        tenant_id: ctx.tenantId,
        conversation_id: convo.id,
        sender: 'staff',
        body: text,
        extracted: { staff_user_id: ctx.userId },
      })
      .select('*').single();
    if (error) return res.status(400).json({ error: error.message });

    await ctx.db.from('conversations')
      .update({ last_message_at: now, last_message_preview: text.slice(0, 160) })
      .eq('id', convo.id).eq('tenant_id', ctx.tenantId);

    res.status(201).json(msg);
  })
);

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------
// Identity is tenant_id + channel_type + customer_id. Never phone alone.

inboxRouter.get(
  '/leads',
  requireAuth,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    let q = ctx.db
      .from('leads').select('*').eq('tenant_id', ctx.tenantId)
      .order('last_contact', { ascending: false, nullsFirst: false })
      .limit(Math.min(Number(req.query.limit) || 200, 500));
    if (req.query.stage) q = q.eq('stage', String(req.query.stage));
    if (req.query.channel_type) q = q.eq('channel_type', String(req.query.channel_type));
    if (req.query.search) {
      const s = String(req.query.search).replace(/[%,()]/g, '');
      q = q.or(`customer_name.ilike.%${s}%,phone.ilike.%${s}%,email.ilike.%${s}%,customer_id.ilike.%${s}%`);
    }
    const { data, error } = await q;
    if (error) return res.status(400).json({ error: error.message });
    res.json({ leads: data ?? [] });
  })
);

export const LEAD_STAGES = [
  'new', 'contacted', 'interested', 'quoted',
  'payment_claimed', 'payment_verified', 'won', 'lost',
] as const;

/** Stage vocabulary is served from the backend so the UI never hardcodes it. */
inboxRouter.get(
  '/leads/stages',
  requireAuth,
  handler(async (_req, res) => {
    res.json({ stages: LEAD_STAGES });
  })
);

/** Full lead detail: conversation, orders, payments and timeline. */
inboxRouter.get(
  '/leads/:id',
  requireAuth,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const { data: lead, error } = await ctx.db
      .from('leads').select('*').eq('id', req.params.id).eq('tenant_id', ctx.tenantId).maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const [{ data: conversation }, { data: orders }, { data: payments }] = await Promise.all([
      ctx.db.from('conversations')
        .select('id, channel_type, customer_id, status, ai_enabled, last_message_at')
        .eq('tenant_id', ctx.tenantId)
        .eq('channel_type', lead.channel_type)
        .eq('customer_id', lead.customer_id)
        .maybeSingle(),
      ctx.db.from('orders').select('*').eq('tenant_id', ctx.tenantId).eq('lead_id', lead.id)
        .order('created_at', { ascending: false }),
      ctx.db.from('payments').select('*').eq('tenant_id', ctx.tenantId).eq('lead_id', lead.id)
        .order('created_at', { ascending: false }),
    ]);

    // Timeline assembled from real records only.
    const timeline: Array<{ at: string; kind: string; label: string }> = [];
    if (lead.created_at) timeline.push({ at: lead.created_at, kind: 'lead', label: 'Lead created' });
    if (lead.last_contact) timeline.push({ at: lead.last_contact, kind: 'message', label: 'Last customer contact' });
    for (const o of orders ?? []) timeline.push({ at: o.created_at, kind: 'order', label: `Order ${o.order_ref} (${o.status})` });
    for (const p of payments ?? []) {
      timeline.push({ at: p.created_at, kind: 'payment', label: `Payment claimed${p.transaction_code ? ` (${p.transaction_code})` : ''}` });
      if (p.verified_at) timeline.push({ at: p.verified_at, kind: 'payment', label: 'Payment verified' });
    }
    timeline.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

    res.json({ lead, conversation: conversation ?? null, orders: orders ?? [], payments: payments ?? [], timeline });
  })
);

inboxRouter.patch(
  '/leads/:id',
  requireAuth,
  requireWrite,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (req.body?.stage !== undefined) {
      if (!(LEAD_STAGES as readonly string[]).includes(req.body.stage)) {
        return res.status(400).json({ error: `stage must be one of: ${LEAD_STAGES.join(', ')}` });
      }
      updates.stage = req.body.stage;
    }
    if (req.body?.assigned_to !== undefined) {
      // Only a member of this tenant may be assigned a lead.
      if (req.body.assigned_to === null) {
        updates.assigned_to = null;
      } else {
        const { data: member } = await ctx.db
          .from('tenant_users').select('user_id')
          .eq('tenant_id', ctx.tenantId).eq('user_id', req.body.assigned_to).maybeSingle();
        if (!member) return res.status(400).json({ error: 'That user is not a member of this business' });
        updates.assigned_to = req.body.assigned_to;
      }
    }
    for (const f of ['customer_name', 'email', 'delivery_location', 'payment_method', 'product_model', 'product_storage', 'product_condition', 'upsell_items', 'notes']) {
      if (req.body?.[f] !== undefined) updates[f] = req.body[f];
    }
    if (req.body?.product_price !== undefined) {
      const p = req.body.product_price === null ? null : Number(req.body.product_price);
      if (p !== null && (!Number.isFinite(p) || p < 0)) {
        return res.status(400).json({ error: 'product_price must be a non-negative number' });
      }
      updates.product_price = p;
    }

    const { data, error } = await ctx.db
      .from('leads').update(updates)
      .eq('id', req.params.id).eq('tenant_id', ctx.tenantId)
      .select('*').maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Lead not found' });
    res.json(data);
  })
);
