import { serviceClient } from '../supabase.js';
import { complete, LlmNotConfiguredError, type ChatMessage, type ToolDefinition } from './llm.js';
import { TOOLS, toolsFor, runTool, definitionOf, type AgentContext } from './tools/index.js';
import { AGENT_BLUEPRINTS, UNIVERSAL_RULES, type AgentRole } from './roles.js';

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
 * Load an agent, creating the manager on first use.
 *
 * Every tenant needs a manager the moment its owner first says hello, and
 * making that a migration would leave tenants created afterwards without one.
 * Sales and support are never conjured this way — those the owner asks for.
 */
export async function loadAgent(tenantId: string, role: AgentRole): Promise<AgentRow | null> {
  const { data } = await serviceClient
    .from('agents')
    .select('role, name, objective, instructions, tools, permissions, escalation, status')
    .eq('tenant_id', tenantId)
    .eq('role', role)
    .maybeSingle();

  if (data) return data as AgentRow;
  if (role !== 'manager') return null;

  const blueprint = AGENT_BLUEPRINTS.manager;
  const { data: created, error } = await serviceClient
    .from('agents')
    .insert({
      tenant_id: tenantId,
      role: 'manager',
      name: blueprint.defaultName,
      objective: blueprint.objective,
      instructions: '',
      tools: blueprint.tools,
      permissions: blueprint.permissions,
      escalation: blueprint.escalation,
      status: 'active',
    })
    .select('role, name, objective, instructions, tools, permissions, escalation, status')
    .single();

  if (error) {
    // A concurrent first message can lose the race against the unique
    // constraint; the other insert's row is just as good.
    if (error.code === '23505') return loadAgent(tenantId, role);
    console.error('[agent] could not create the manager agent:', error.message);
    return null;
  }
  return created as AgentRow;
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
    `Setup: ${tenant?.onboarding_completed_at ? 'live' : 'still being set up'}`,
  ];
  if (gaps?.length) {
    lines.push(`Unanswered questions customers have asked: ${gaps.map((g) => g.question).join('; ')}`);
  }
  return lines.join('\n');
}

function systemPrompt(agent: AgentRow, orientationBlock: string): string {
  const blueprint = AGENT_BLUEPRINTS[agent.role];

  const parts = [
    `You are ${agent.name}. ${agent.objective || blueprint.objective}`,
    '',
    'Rules you always follow:',
    ...[...UNIVERSAL_RULES, ...blueprint.rules].map((r) => `- ${r}`),
    '',
    `Escalation: ${agent.escalation || blueprint.escalation}`,
    '',
    'What you currently know about this business:',
    orientationBlock,
    '',
    'Use your tools to look things up and to make changes. Reply in plain language — never mention tools, tables, ids or configuration by name. Keep replies short enough to read on a phone.',
  ];

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

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(agent, await orientation(input.tenantId)) },
    ...(input.history ?? (await history(input.tenantId, input.conversationId))),
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
        temperature: 0.3,
        maxTokens: 900,
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
