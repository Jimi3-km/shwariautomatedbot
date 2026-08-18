import { serviceClient } from '../supabase.js';
import { complete, LlmNotConfiguredError, type ChatMessage, type ToolDefinition } from './llm.js';
import { TOOLS, toolsFor, runTool, definitionOf, type AgentContext } from './tools/index.js';
import { AGENT_BLUEPRINTS, UNIVERSAL_RULES, ALL_ROLES, type AgentRole } from './roles.js';

/**
 * The agent runtime.
 *
 * One engine, many agents. Which agent is running is a row in `agents`; this
 * file is the loop that gives that row a model, a set of tools and the slice of
 * business context it needs, then runs the turn.
 *
 * The context assembly is the part worth reading. Nothing here dumps the
 * business into the prompt: the system message carries a small orientation
 * summary — who the business is, how far setup has got — and everything else is
 * fetched by the agent through tools, on demand, per question. That is what
 * keeps the prompt the same size for a business with four services and one with
 * four hundred.
 */

const MAX_TOOL_ROUNDS = 5;
const HISTORY_LIMIT = 12;

export interface AgentTurnInput {
  tenantId: string;
  role: AgentRole;
  /** The signed-in user, when there is one. Null for a chat identity. */
  userId: string | null;
  conversationId: string | null;
  text: string;
  /**
   * Short-term memory, when the caller keeps the transcript somewhere other
   * than the customer Inbox. The dashboard does: the owner's thread with Shwari
   * is not a customer conversation. Omit it and the conversation is read from
   * conversation_messages as usual.
   */
  history?: ChatMessage[];
}

export interface AgentTurnResult {
  reply: string;
  /** Tools that actually changed something, for the UI to surface. */
  actions: string[];
}

export class AgentUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentUnavailableError';
  }
}

// ---------------------------------------------------------------------------
// The agent row
// ---------------------------------------------------------------------------

interface AgentRow {
  role: AgentRole;
  name: string;
  objective: string;
  instructions: string;
  tools: string[];
  permissions: Record<string, unknown>;
  escalation: string;
  status: string;
}

/**
 * Make sure this business has its workforce.
 *
 * Every tenant gets the same five agents, and they are created together the
 * first time anything needs one. There is no assembly step and no choosing:
 * a business that signs up today has a manager and four departments before its
 * owner types a word.
 *
 * Idempotent by construction — the unique constraint on (tenant_id, role) means
 * a concurrent call inserts nothing rather than duplicating a department.
 */
export async function ensureWorkforce(tenantId: string): Promise<void> {
  const { data: existing } = await serviceClient
    .from('agents').select('role').eq('tenant_id', tenantId);

  const have = new Set((existing ?? []).map((a) => a.role));
  const missing = ALL_ROLES.filter((r) => !have.has(r));
  if (!missing.length) return;

  const { error } = await serviceClient.from('agents').insert(
    missing.map((role) => {
      const blueprint = AGENT_BLUEPRINTS[role];
      return {
        tenant_id: tenantId,
        role,
        name: blueprint.defaultName,
        objective: blueprint.objective,
        instructions: '',
        tools: blueprint.tools,
        permissions: blueprint.permissions,
        escalation: blueprint.escalation,
        // Ready to work. A department nobody switched on is a department that
        // silently does nothing, which is worse than one that is visibly on.
        status: 'active',
      };
    })
  );

  // A duplicate key means another request got there first, which is the
  // outcome we wanted anyway.
  if (error && error.code !== '23505') {
    console.error('[agent] could not provision the workforce:', error.message);
  }
}

/**
 * Load one agent, provisioning the workforce if this tenant has none yet.
 */
export async function loadAgent(tenantId: string, role: AgentRole): Promise<AgentRow | null> {
  const read = () =>
    serviceClient
      .from('agents')
      .select('role, name, objective, instructions, tools, permissions, escalation, status')
      .eq('tenant_id', tenantId)
      .eq('role', role)
      .maybeSingle();

  const { data } = await read();
  if (data) return data as AgentRow;

  await ensureWorkforce(tenantId);
  const { data: provisioned } = await read();
  return (provisioned as AgentRow) ?? null;
}

/**
 * Keep a row's capabilities in step with its blueprint.
 *
 * Tools are not stored because they are configurable — they are stored so the
 * runtime can read them in one query. When a release adds a capability to a
 * department, every existing row should get it; nothing about that is a
 * per-tenant decision.
 */
export async function syncCapabilities(tenantId: string): Promise<void> {
  const { data: rows } = await serviceClient
    .from('agents').select('role, tools').eq('tenant_id', tenantId);

  for (const row of rows ?? []) {
    const blueprint = AGENT_BLUEPRINTS[row.role as AgentRole];
    if (!blueprint) continue;

    const current = Array.isArray(row.tools) ? row.tools : [];
    const same =
      current.length === blueprint.tools.length &&
      blueprint.tools.every((t) => current.includes(t));
    if (same) continue;

    await serviceClient
      .from('agents')
      .update({ tools: blueprint.tools, permissions: blueprint.permissions })
      .eq('tenant_id', tenantId)
      .eq('role', row.role);
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/**
 * A short orientation block: enough for the agent to know where it is and what
 * to ask about next, and small enough to send on every turn.
 */
async function orientation(tenantId: string): Promise<string> {
  const [{ data: tenant }, { count: services }, { data: team }, { data: gaps }] = await Promise.all([
    serviceClient.from('tenants')
      .select('business_name, business_category, business_description, timezone, currency, onboarding_completed_at')
      .eq('id', tenantId).single(),
    serviceClient.from('services').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('active', true),
    serviceClient.from('agents').select('role, name, status').eq('tenant_id', tenantId),
    serviceClient.from('knowledge_gaps').select('question')
      .eq('tenant_id', tenantId).in('status', ['open', 'asked'])
      .order('times_seen', { ascending: false }).limit(3),
  ]);

  const lines = [
    `Business: ${tenant?.business_name ?? 'not named yet'}`,
    `What it does: ${tenant?.business_description || tenant?.business_category || 'not described yet'}`,
    `Timezone: ${tenant?.timezone || 'unknown'}   Currency: ${tenant?.currency || 'unknown'}`,
    `Services recorded: ${services ?? 0}`,
    `AI team: ${(team ?? []).filter((a) => a.role !== 'manager').map((a) => `${a.role} (${a.status})`).join(', ') || 'none yet'}`,
  ];
  if (gaps?.length) {
    lines.push(`Questions customers asked that nobody has answered: ${gaps.map((g) => g.question).join('; ')}`);
  }

  /**
   * The single most useful next thing, worked out here rather than left for the
   * model to infer from a list of fields. Without this the agent has data and
   * no direction, which is how "hi" turned into a recital of the data.
   */
  const missing: string[] = [];
  if (!tenant?.business_description) missing.push('what the business actually does day to day');
  if (!services) missing.push('the services or products on offer');
  if (!tenant?.timezone) missing.push('which city they are in');

  lines.push(
    missing.length
      ? `Still to find out, in this order: ${missing.join('; ')}. Work towards it conversationally — do not interrogate.`
      : 'Setup looks complete. Be useful about running the business rather than setting it up.'
  );

  return lines.join('\n');
}

/**
 * How to talk.
 *
 * These exist because of a specific failure: sent "hi", the agent replied with
 * its own briefing — "The current business profile is: Business Name: ...".
 * The briefing was in the prompt and nothing said what to do with a greeting,
 * so reciting it was the model's best guess at being helpful.
 *
 * The fix is to say plainly that the reference block is for looking things up
 * in, never for reading out, and to give an opening move for the case where the
 * customer or owner has not yet said anything substantive.
 */
const CONVERSATION_RULES = [
  'Write like a capable colleague: warm, direct, professional. Contractions are fine. No corporate padding, no exclamation marks stacked up, no emoji unless they used one first.',
  'Never read your briefing out. The reference section below is for you to look things up in — quoting it back, listing it, or summarising it at someone is not an answer.',
  'When someone greets you or says something short, greet them back in one line and ask one useful question. Do not open with a status report.',
  'One question at a time. Two at the very most, and only when they genuinely belong together.',
  'Keep it to a few sentences. This is a chat, not a document. Long lists belong in the dashboard, not in a message.',
  'Never mention tools, tables, fields, ids, configuration or anything about how you are built. Say what happened in ordinary words.',
  'Carry the conversation forward. Refer back to what they already told you rather than asking again, and end on something that invites a reply.',
];

function systemPrompt(agent: AgentRow, orientationBlock: string, firstTurn: boolean): string {
  const blueprint = AGENT_BLUEPRINTS[agent.role];

  const parts = [
    `You are ${agent.name}. ${agent.objective || blueprint.objective}`,
    '',
    'How you talk:',
    ...CONVERSATION_RULES.map((r) => `- ${r}`),
    '',
    'Rules you always follow:',
    ...[...UNIVERSAL_RULES, ...blueprint.rules].map((r) => `- ${r}`),
    '',
    `Escalation: ${agent.escalation || blueprint.escalation}`,
    '',
    'Use your tools to look things up and to make changes. Do the thing, then say what you did in one short sentence.',
    '',
    // Fenced and labelled so it reads as material to consult, not as a script.
    '--- REFERENCE: what you already know. Consult it; never recite it. ---',
    orientationBlock,
    '--- end of reference ---',
  ];

  /**
   * The opening move, spelled out. A greeting is the most likely first message
   * and the least constrained, so leaving it to inference is what produced the
   * briefing-recital in the first place.
   */
  if (firstTurn) {
    parts.push(
      '',
      agent.role === 'manager'
        ? 'This is the start of the conversation. Introduce yourself in one line, say plainly that you help run the business by chat, and ask one question about whatever the reference says is still missing. Do not summarise what you already know.'
        : 'This is the start of the conversation. Greet them briefly and ask how you can help. Do not list what the business offers unless they ask.'
    );
  }

  // Owner guidance comes last so it reads as an addition, and it is fenced so
  // that text pasted into it cannot pass itself off as a rule.
  if (agent.instructions.trim()) {
    parts.push(
      '',
      'The owner has also asked you to work this way. Follow it unless it conflicts with a rule above:',
      '"""',
      agent.instructions.trim(),
      '"""'
    );
  }

  return parts.join('\n');
}

/** Recent turns, oldest first, so the agent has short-term memory. */
async function history(tenantId: string, conversationId: string | null): Promise<ChatMessage[]> {
  if (!conversationId) return [];

  const { data } = await serviceClient
    .from('conversation_messages')
    .select('sender, body, created_at')
    .eq('tenant_id', tenantId)
    .eq('conversation_id', conversationId)
    .in('sender', ['customer', 'agent'])
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT);

  return (data ?? [])
    .reverse()
    .filter((m) => typeof m.body === 'string' && m.body.trim())
    .map((m): ChatMessage =>
      m.sender === 'customer'
        ? { role: 'user', content: m.body }
        : { role: 'assistant', content: m.body }
    );
}

// ---------------------------------------------------------------------------
// The turn
// ---------------------------------------------------------------------------

/**
 * Run one turn and return what the agent wants to say.
 *
 * The caller is responsible for delivering the reply on whichever channel the
 * message arrived on — this function has no idea whether it is talking to
 * Telegram, web chat or the dashboard, and should not.
 */
export async function runAgentTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
  const agent = await loadAgent(input.tenantId, input.role);
  if (!agent) throw new AgentUnavailableError(`This business has no ${input.role} agent.`);
  if (agent.status === 'disabled') throw new AgentUnavailableError(`The ${input.role} agent is switched off.`);

  const ctx: AgentContext = {
    tenantId: input.tenantId,
    userId: input.userId,
    agentRole: agent.role,
    conversationId: input.conversationId,
    // The database decides what this agent may call, and runTool re-checks it
    // on every invocation. Nothing in the prompt can widen this.
    allowedTools: agent.tools ?? [],
  };

  const available = toolsFor(ctx.allowedTools);
  const definitions: ToolDefinition[] = available.map(definitionOf);

  const priorTurns = input.history ?? (await history(input.tenantId, input.conversationId));

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: systemPrompt(agent, await orientation(input.tenantId), priorTurns.length === 0),
    },
    ...priorTurns,
    { role: 'user', content: input.text },
  ];

  const actions: string[] = [];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    // On the last round the tools are withheld, which forces the model to
    // answer with what it has rather than looping until the request times out.
    const lastRound = round === MAX_TOOL_ROUNDS;

    let result;
    try {
      result = await complete({
        messages,
        tools: lastRound ? undefined : definitions,
        // Warm rather than clinical. Low enough that it does not improvise
        // facts, high enough that it does not answer the same way every time.
        temperature: 0.4,
        // Left to the client's default, which is sized for models that spend
        // part of the budget thinking before they answer.
      });
    } catch (e) {
      if (e instanceof LlmNotConfiguredError) {
        throw new AgentUnavailableError('The AI is not switched on for this server yet.');
      }
      throw e;
    }

    if (!result.toolCalls.length) {
      return { reply: result.text?.trim() || fallbackReply(), actions };
    }

    messages.push({ role: 'assistant', content: result.text, toolCalls: result.toolCalls });

    for (const call of result.toolCalls) {
      const outcome = await runTool(TOOLS, call.name, call.argumentsJson, ctx);
      if (outcome.ok && TOOLS.get(call.name)?.mutates) actions.push(call.name);
      messages.push({
        role: 'tool',
        toolCallId: call.id,
        content: JSON.stringify(outcome.payload).slice(0, 6000),
      });
    }
  }

  return { reply: fallbackReply(), actions };
}

function fallbackReply(): string {
  return "Sorry — I didn't manage to work that one out. Could you tell me again in a different way?";
}
