import { Router } from 'express';
import { serviceClient } from '../supabase.js';
import { requireAuth, requireAdmin, handler } from '../auth.js';
import { runAgentTurn, loadAgent, AgentUnavailableError } from '../ai/agent.js';
import { llmConfigured } from '../ai/llm.js';
import { issuePairingCode } from '../ai/admins.js';
import { attentionNeeded } from '../ai/tools/insight.js';
import { AGENT_BLUEPRINTS } from '../ai/roles.js';

export const shwariRouter = Router();

/**
 * Shwari in the dashboard.
 *
 * The same agent that answers on Telegram, reached over an authenticated
 * request instead of a webhook. Nothing here duplicates the runtime — the
 * difference between the two entry points is only how the caller proved who
 * they are, and this one has a session.
 *
 * Admin-only throughout: this agent changes the business, so it needs the same
 * bar as the settings pages it replaces.
 */

const HISTORY_LIMIT = 30;
/** How much of the thread the agent is reminded of on each turn. */
const CONTEXT_TURNS = 12;

/**
 * The owner's thread with Shwari, oldest first.
 *
 * It lives in shwari_messages rather than in `conversations` because the Inbox
 * is for customers: an owner asking to change their opening hours is not a lead
 * and must not be counted as one.
 */
async function thread(tenantId: string, userId: string, limit: number) {
  const { data } = await serviceClient
    .from('shwari_messages')
    .select('role, body, actions, created_at')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  return (data ?? []).reverse();
}

// ---------------------------------------------------------------------------
// Talk to Shwari
// ---------------------------------------------------------------------------
shwariRouter.post(
  '/shwari/chat',
  requireAuth,
  requireAdmin,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const text = String(req.body?.message ?? '').trim();

    if (!text) return res.status(400).json({ error: 'Type a message first.' });
    if (text.length > 4000) return res.status(400).json({ error: 'That message is too long.' });

    const gate = llmConfigured();
    if (!gate.configured) {
      console.error(`[shwari] unavailable, missing: ${gate.missing.join(', ')}`);
      return res.status(503).json({ error: "Shwari isn't switched on for this server yet." });
    }

    // Read the thread before writing this turn into it, so the agent is not
    // handed the message it is about to answer twice.
    const previous = await thread(ctx.tenantId, ctx.userId, CONTEXT_TURNS);

    await serviceClient.from('shwari_messages').insert({
      tenant_id: ctx.tenantId, user_id: ctx.userId, role: 'owner', body: text,
    });

    let reply: string;
    let actions: string[] = [];
    try {
      const turn = await runAgentTurn({
        tenantId: ctx.tenantId,
        role: 'manager',
        userId: ctx.userId,
        conversationId: null,
        text,
        history: previous.map((m) =>
          m.role === 'owner'
            ? { role: 'user' as const, content: m.body }
            : { role: 'assistant' as const, content: m.body }
        ),
      });
      reply = turn.reply;
      actions = turn.actions;
    } catch (e) {
      if (e instanceof AgentUnavailableError) {
        return res.status(503).json({ error: e.message });
      }
      console.error('[shwari] turn failed:', e instanceof Error ? e.message : e);
      return res.status(502).json({ error: "I couldn't get to that just now. Try me again in a moment." });
    }

    await serviceClient.from('shwari_messages').insert({
      tenant_id: ctx.tenantId, user_id: ctx.userId, role: 'shwari', body: reply, actions,
    });

    // The tool names go to the browser so it can say what happened in the
    // owner's language. They are action identifiers, not internals: nothing
    // here names a table, a column or an environment variable.
    res.json({ reply, changed: actions.length > 0, actions });
  })
);

// ---------------------------------------------------------------------------
// The transcript
// ---------------------------------------------------------------------------
shwariRouter.get(
  '/shwari/history',
  requireAuth,
  requireAdmin,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const messages = await thread(ctx.tenantId, ctx.userId, HISTORY_LIMIT);

    res.json({
      messages: messages.map((m) => ({
        from: m.role === 'owner' ? 'you' : 'shwari',
        text: m.body,
        at: m.created_at,
        actions: Array.isArray(m.actions) ? m.actions : [],
      })),
    });
  })
);

// ---------------------------------------------------------------------------
// Reaching Shwari on Telegram
// ---------------------------------------------------------------------------

/**
 * Mint a pairing code.
 *
 * The code is the only thing that turns a chat identity into an administrator,
 * so it is returned exactly once, here, to a caller who has already proved they
 * are an admin of this tenant. It is never readable afterwards.
 */
shwariRouter.post(
  '/shwari/pairing-code',
  requireAuth,
  requireAdmin,
  handler(async (req, res) => {
    const ctx = req.ctx!;

    const { data: channels } = await serviceClient
      .from('channels')
      .select('channel_type, display_name')
      .eq('tenant_id', ctx.tenantId)
      .eq('status', 'active')
      .in('channel_type', ['telegram', 'whatsapp', 'instagram']);

    if (!channels?.length) {
      return res.status(400).json({
        error: 'Connect a channel first, then you can talk to me there as well as here.',
        code: 'NO_CHANNEL',
      });
    }

    const { code, expiresAt } = await issuePairingCode(ctx.tenantId, ctx.userId);

    res.json({
      code,
      expires_at: expiresAt,
      where: channels.map((c) => ({ channel: c.channel_type, name: c.display_name })),
      instructions: 'Send this code as a message to your bot. I will recognise you from then on.',
    });
  })
);

/** Which chat identities can already administer this business. */
shwariRouter.get(
  '/shwari/linked',
  requireAuth,
  requireAdmin,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const { data } = await serviceClient
      .from('shwari_admins')
      .select('id, channel_type, created_at')
      .eq('tenant_id', ctx.tenantId)
      .order('created_at');

    // The customer id is deliberately absent: it identifies a person's account
    // on a third-party service and nothing in the UI needs it.
    res.json({ linked: data ?? [] });
  })
);

shwariRouter.delete(
  '/shwari/linked/:id',
  requireAuth,
  requireAdmin,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const { error } = await serviceClient
      .from('shwari_admins')
      .delete()
      .eq('id', req.params.id)
      .eq('tenant_id', ctx.tenantId);

    if (error) return res.status(500).json({ error: "We couldn't remove that. Please try again." });
    res.json({ removed: true });
  })
);

// ---------------------------------------------------------------------------
// What Shwari has been doing
// ---------------------------------------------------------------------------

/**
 * The audit trail, in the owner's language.
 *
 * Read-only and admin-only. This is how "what did the AI change" is answered
 * without anyone reading a database.
 */
shwariRouter.get(
  '/shwari/activity',
  requireAuth,
  requireAdmin,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const { data } = await serviceClient
      .from('agent_tool_calls')
      .select('agent_role, tool, arguments, ok, error, created_at')
      .eq('tenant_id', ctx.tenantId)
      .order('created_at', { ascending: false })
      .limit(50);

    res.json({ activity: data ?? [] });
  })
);

/** Setup readiness, for the dashboard to draw a checklist from. */
shwariRouter.get(
  '/shwari/status',
  requireAuth,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const gate = llmConfigured();
    const agent = gate.configured ? await loadAgent(ctx.tenantId, 'manager') : null;

    const [{ data: team }, { data: gaps }] = await Promise.all([
      serviceClient.from('agents').select('role, name, status').eq('tenant_id', ctx.tenantId),
      serviceClient.from('knowledge_gaps').select('question, times_seen')
        .eq('tenant_id', ctx.tenantId).in('status', ['open', 'asked'])
        .order('times_seen', { ascending: false }).limit(10),
    ]);

    if (!gate.configured) console.error(`[shwari] unavailable, missing: ${gate.missing.join(', ')}`);

    res.json({
      // No variable names: this is read by a business owner.
      available: gate.configured && Boolean(agent),
      team: (team ?? []).map((a) => ({ role: a.role, name: a.name, status: a.status })),
      open_questions: gaps ?? [],
    });
  })
);

/**
 * What needs attention, without asking the model anything.
 *
 * This runs the same query the agent's own tool runs, so the panel and the
 * conversation can never disagree — and it keeps working when no model key is
 * configured, which is the point: the dashboard should be useful before the AI
 * is switched on, not after.
 */
shwariRouter.get(
  '/shwari/attention',
  requireAuth,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    try {
      const result = await attentionNeeded.run({}, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        agentRole: 'manager',
        conversationId: null,
        // Called directly rather than through runTool: there is no agent here,
        // and a person reading their own dashboard is not a tool call to audit.
        allowedTools: [],
      });
      res.json(result);
    } catch (e) {
      console.error('[shwari] attention failed:', e instanceof Error ? e.message : e);
      res.status(502).json({ error: "We couldn't work that out just now." });
    }
  })
);

// ---------------------------------------------------------------------------
// Configuring agents by hand
// ---------------------------------------------------------------------------

/**
 * The manual alternative to talking to Shwari.
 *
 * Everything here can also be done by asking Shwari in plain English, and most
 * owners will. But an agent is a row, and a person should be able to see and
 * edit that row directly — to check what an agent was actually told, to fix
 * something without a conversation, or simply because they prefer a form.
 *
 * The guards match the ones in the tool layer exactly, because the tool layer
 * is not the only way in. `tools`, `permissions` and the manager's own row are
 * not editable from here either: what an agent is capable of is the platform's
 * decision, not a per-tenant setting, and the reasons are the same whether the
 * request came from a model or from a browser.
 */

const EDITABLE_ROLES = ['sales', 'support'] as const;
const AGENT_STATES = ['draft', 'active', 'disabled'] as const;

shwariRouter.get(
  '/agents',
  requireAuth,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const { data, error } = await serviceClient
      .from('agents')
      .select('id, role, name, objective, instructions, escalation, status, tools, created_at, updated_at')
      .eq('tenant_id', ctx.tenantId)
      .order('role');

    if (error) return res.status(400).json({ error: error.message });

    res.json({
      agents: (data ?? []).map((a) => ({
        ...a,
        // What it can do, as a count rather than a list of internal names.
        capability_count: Array.isArray(a.tools) ? a.tools.length : 0,
        tools: undefined,
        editable: (EDITABLE_ROLES as readonly string[]).includes(a.role),
      })),
      /** Roles this business could still add, for the "add agent" control. */
      available: EDITABLE_ROLES.filter((r) => !(data ?? []).some((a) => a.role === r)).map((role) => ({
        role,
        name: AGENT_BLUEPRINTS[role].defaultName,
        summary: AGENT_BLUEPRINTS[role].summary,
      })),
    });
  })
);

shwariRouter.post(
  '/agents',
  requireAuth,
  requireAdmin,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const role = String(req.body?.role ?? '');

    if (!(EDITABLE_ROLES as readonly string[]).includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${EDITABLE_ROLES.join(', ')}` });
    }

    const blueprint = AGENT_BLUEPRINTS[role as 'sales' | 'support'];
    const { data, error } = await serviceClient
      .from('agents')
      .insert({
        tenant_id: ctx.tenantId,
        role,
        name: String(req.body?.name ?? '').trim().slice(0, 60) || blueprint.defaultName,
        objective: blueprint.objective,
        instructions: '',
        // Capability comes from the blueprint, never from the request body.
        tools: blueprint.tools,
        permissions: blueprint.permissions,
        escalation: blueprint.escalation,
        status: 'draft',
      })
      .select('id, role, name, objective, instructions, escalation, status')
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: `You already have a ${role} agent.` });
      }
      return res.status(400).json({ error: error.message });
    }
    res.status(201).json(data);
  })
);

shwariRouter.patch(
  '/agents/:role',
  requireAuth,
  requireAdmin,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const role = String(req.params.role);

    if (role === 'manager') {
      return res.status(403).json({
        error: 'Shwari runs your other agents, so its own capabilities are fixed. You can still tell it how to work in conversation.',
      });
    }
    if (!(EDITABLE_ROLES as readonly string[]).includes(role)) {
      return res.status(404).json({ error: 'No such agent.' });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ error: 'Give the agent a name.' });
      updates.name = name.slice(0, 60);
    }
    if (req.body?.objective !== undefined) updates.objective = String(req.body.objective).slice(0, 500);
    if (req.body?.instructions !== undefined) updates.instructions = String(req.body.instructions).slice(0, 4000);
    if (req.body?.escalation !== undefined) updates.escalation = String(req.body.escalation).slice(0, 1000);

    if (req.body?.status !== undefined) {
      if (!(AGENT_STATES as readonly string[]).includes(req.body.status)) {
        return res.status(400).json({ error: `status must be one of: ${AGENT_STATES.join(', ')}` });
      }
      updates.status = req.body.status;
    }

    if (Object.keys(updates).length === 1) {
      return res.status(400).json({ error: 'Nothing to change.' });
    }

    const { data, error } = await serviceClient
      .from('agents')
      .update(updates)
      .eq('tenant_id', ctx.tenantId)
      .eq('role', role)
      .select('id, role, name, objective, instructions, escalation, status')
      .maybeSingle();

    if (error) return res.status(400).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'That agent does not exist yet.' });
    res.json(data);
  })
);
