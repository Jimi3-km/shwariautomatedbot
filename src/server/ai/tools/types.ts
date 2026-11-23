import { serviceClient } from '../../supabase.js';
import { logAuditEvent } from '../../security/audit.js';
import type { ToolDefinition } from '../llm.js';
import { servesCustomers, type AgentRole } from '../roles.js';
import { canUserRunTool } from '../../security/permissions.js';
import type { Role } from '../../auth.js';

/**
 * The tool layer.
 *
 * Agents do not touch the database. They call tools, and every tool goes
 * through runTool below, which does four things the model cannot be trusted to
 * do for itself:
 *
 *   1. checks the tool is one this agent is permitted to call
 *   2. validates the arguments before anything is written
 *   3. scopes every query to the tenant from the caller's context, never from
 *      an argument the model produced
 *   4. records the call, its arguments and its outcome
 *
 * A tool therefore receives a tenant id it cannot influence. There is no
 * argument named tenant_id anywhere in this directory, and a model that
 * invents one is simply ignored.
 */

export interface AgentContext {
  tenantId: string;
  /** The dashboard user, when the agent is acting for a signed-in person. */
  userId: string | null;
  agentRole: AgentRole;
  conversationId: string | null;
  /** Tool names this agent is configured to use. */
  allowedTools: string[];
  /**
   * True when this turn answers a customer rather than staff. Left unset it is
   * derived: one of the four customer departments with no signed-in user
   * behind it is serving a customer. See isCustomerTurn.
   */
  customerFacing?: boolean;
  /** The staff member's role in this business, when a person is commanding the agent. */
  userRole?: Role | null;
  /** The business's IANA timezone, used to read times the model gives without an offset. */
  timezone?: string | null;
  /**
   * Per-turn memory of mutating calls, so a model that repeats itself does not
   * create a second order or a second booking.
   */
  turn?: {
    done: Map<string, unknown>;
    /** Set by hand_to_department: the colleague who should answer instead. */
    handoff?: { role: AgentRole; summary: string };
    /** One handover per customer message, so two departments cannot bounce someone. */
    handoffUsed?: boolean;
  };
}

/**
 * Is this turn serving a customer?
 *
 * A customer turn is the dangerous one: the person typing is anonymous and
 * controls the model's input, so every tool must act only on the customer the
 * conversation belongs to — never on an id the model was talked into sending.
 */
export function isCustomerTurn(ctx: AgentContext): boolean {
  // Only the four departments ever serve a customer. The manager and marketing
  // work for the owner, so a turn of theirs is never one, signed in or not.
  return ctx.customerFacing ?? (servesCustomers(ctx.agentRole) && !ctx.userId);
}

export interface CustomerScope {
  leadId: number | null;
  customerId: string | null;
  customerName: string | null;
  channelType: string | null;
}

/**
 * The one customer a customer-facing turn may touch: whoever the conversation
 * belongs to. Throws when there is no conversation, because then there is no
 * customer this turn could legitimately act for.
 */
export async function customerScope(ctx: AgentContext): Promise<CustomerScope> {
  if (!ctx.conversationId) {
    throw new ToolInputError('There is no customer conversation here to act on.');
  }
  const { data } = await serviceClient
    .from('conversations')
    .select('id, lead_id, customer_id, customer_name, channel_type')
    .eq('tenant_id', ctx.tenantId)
    .eq('id', ctx.conversationId)
    .maybeSingle();
  if (!data) throw new ToolInputError('This conversation is no longer available.');
  return {
    leadId: data.lead_id ?? null,
    customerId: data.customer_id ?? null,
    customerName: data.customer_name ?? null,
    channelType: data.channel_type ?? null,
  };
}

/**
 * Does a row belong to the customer in scope? A row matches on its lead, or —
 * for a customer with no lead yet — on the channel identity.
 */
export function ownedBy(
  row: { lead_id?: number | null; customer_id?: string | null } | null | undefined,
  scope: CustomerScope
): boolean {
  if (!row) return false;
  if (scope.leadId !== null && row.lead_id != null) return Number(row.lead_id) === Number(scope.leadId);
  if (scope.customerId && row.customer_id) return String(row.customer_id) === String(scope.customerId);
  return false;
}

/** Escape LIKE wildcards so a name is matched literally by ilike. */
export function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

/** Arguments a customer-facing model may never use to point at someone else. */
const CUSTOMER_STRIPPED_ARGS = ['lead_id', 'customer_email', 'customer_id'];

export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  /**
   * Tools that change state. Marked so the audit log and the UI can tell a
   * question apart from an action without keeping a second list.
   */
  readonly mutates: boolean;
  run(args: Record<string, unknown>, ctx: AgentContext): Promise<unknown>;
}

/** Thrown by a tool when the failure is the model's fault and it can retry. */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolInputError';
  }
}

export function definitionOf(tool: Tool): ToolDefinition {
  return { name: tool.name, description: tool.description, parameters: tool.parameters };
}

export interface ToolOutcome {
  ok: boolean;
  /** JSON handed straight back to the model as the tool message. */
  payload: unknown;
}

/**
 * Execute one tool call.
 *
 * Never throws: the model has to be told what went wrong so it can correct
 * itself or explain, and an exception escaping here would abandon the turn.
 */
export async function runTool(
  tools: Map<string, Tool>,
  name: string,
  argumentsJson: string,
  ctx: AgentContext
): Promise<ToolOutcome> {
  const tool = tools.get(name);
  if (!tool) {
    return { ok: false, payload: { error: `There is no tool called ${name}.` } };
  }
  if (!ctx.allowedTools.includes(name)) {
    await record(ctx, name, {}, false, null, 'not permitted for this agent');
    return {
      ok: false,
      payload: { error: `You are not permitted to use ${name}. Tell the owner what you would need instead.` },
    };
  }

  let args: Record<string, unknown>;
  try {
    const parsed = argumentsJson.trim() ? JSON.parse(argumentsJson) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    args = parsed as Record<string, unknown>;
  } catch {
    return { ok: false, payload: { error: 'The arguments were not a JSON object. Send them again.' } };
  }

  // A model that supplies tenant_id is trying to steer tenancy, whether it
  // means to or not. Drop it rather than let it near a query.
  if ('tenant_id' in args) delete args.tenant_id;

  args = tidyArguments(args);

  // On a customer turn the model's input is written by an anonymous person. It
  // does not get to name which customer a tool acts on, or where an email
  // goes: those come from the conversation, so the arguments are dropped here
  // before any tool can read them.
  if (isCustomerTurn(ctx)) {
    for (const key of CUSTOMER_STRIPPED_ARGS) if (key in args) delete args[key];
  }

  // A signed-in person commanding the agent gets no more than their own role
  // allows in the dashboard.
  if (ctx.userId && ctx.userRole !== undefined && !canUserRunTool(ctx.userRole ?? 'viewer', name)) {
    await record(ctx, name, args, false, null, 'staff role lacks permission');
    return {
      ok: false,
      payload: { error: 'The person asking does not have permission for that. Tell them an owner or admin needs to do it.' },
    };
  }

  // The same mutating call twice in one turn is the model repeating itself,
  // not the customer ordering twice.
  const dedupeKey = tool.mutates && ctx.turn ? `${name}:${JSON.stringify(args)}` : null;
  if (dedupeKey && ctx.turn!.done.has(dedupeKey)) {
    return {
      ok: true,
      payload: {
        already_done: true,
        result: ctx.turn!.done.get(dedupeKey),
        note: 'You already did exactly this a moment ago and it worked. Do not do it again; tell them the result.',
      },
    };
  }

  try {
    const result = await tool.run(args, ctx);
    if (dedupeKey) ctx.turn!.done.set(dedupeKey, result);
    await record(ctx, name, args, true, result, null);
    return { ok: true, payload: result };
  } catch (e) {
    const message =
      e instanceof ToolInputError
        ? e.message
        : 'That did not work. Do not try the same thing again; tell the owner plainly.';
    if (!(e instanceof ToolInputError)) {
      console.error(`[tools] ${name} failed:`, e instanceof Error ? e.message : e);
    }
    await record(ctx, name, args, false, null, e instanceof Error ? e.message : String(e));
    return { ok: false, payload: { error: message } };
  }
}

/** What a model writes when it means "nothing" but was made to fill the field. */
const EMPTY_WORDS = new Set(['null', 'none', 'undefined', 'n/a', 'na', 'nil', 'unknown', 'not provided', 'not specified']);

/** A stand-in the model invented instead of a value: "customer's ID", "<phone>", "[name]". */
const PLACEHOLDER = /^(?:<[^>]*>|(?:the |this )?(?:customer|client|user|lead)(?:'s|’s|s)? (?:id|name|phone|email|location|address|number|details)|your[_ ]\w+|todo|tbd|xxx+)$/i;

/**
 * Repair the ways a model habitually fills in a field it had nothing for.
 *
 * Seen in production: `"total": "null"`, `"lead_id": "customer's ID"`, and a
 * list sent as a Python-style string. Each made a real order fail. A value
 * that means "nothing" is removed so the tool's own defaults and required
 * checks apply, and a list sent as text is read as the list it was meant to be.
 */
export function tidyArguments(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string') {
      const v = value.trim();
      if (EMPTY_WORDS.has(v.toLowerCase()) || PLACEHOLDER.test(v)) continue;
      if (/^[\[{]/.test(v) && /[\]}]$/.test(v)) {
        const parsed = parseLoose(v);
        if (parsed !== undefined && parsed !== null) { out[key] = parsed; continue; }
      }
    }
    out[key] = value;
  }
  return out;
}

function parseLoose(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch { /* try the Python spelling below */ }
  try {
    return JSON.parse(
      text
        .replace(/'/g, '"')
        .replace(/\bNone\b/g, 'null')
        .replace(/\bTrue\b/g, 'true')
        .replace(/\bFalse\b/g, 'false')
    );
  } catch {
    return undefined;
  }
}

async function record(
  ctx: AgentContext,
  tool: string,
  args: Record<string, unknown>,
  ok: boolean,
  result: unknown,
  error: string | null
): Promise<void> {
  const { error: logErr } = await serviceClient.from('agent_tool_calls').insert({
    tenant_id: ctx.tenantId,
    agent_role: ctx.agentRole,
    conversation_id: ctx.conversationId,
    actor_user_id: ctx.userId,
    tool,
    arguments: args,
    ok,
    // Results can be long; the audit needs the shape, not a transcript.
    result: result === undefined ? null : truncate(result),
    error: error ? error.slice(0, 500) : null,
  });
  // A failed audit write must not swallow the tool's own result, but it is
  // worth shouting about: the log is the only record of what an agent did.
  if (logErr) console.error('[tools] audit write failed:', logErr.message);

  void logAuditEvent({
    tenantId: ctx.tenantId,
    actorId: ctx.userId || ctx.conversationId || 'agent',
    actorType: ctx.userId ? 'user' : (ctx.conversationId ? 'customer' : 'agent'),
    agentRole: ctx.agentRole,
    action: `tool.${tool}`,
    resourceType: 'agent_tool',
    resourceId: tool,
    details: { ok, arguments: args, error: error || null },
  });
}

function truncate(value: unknown): unknown {
  const json = JSON.stringify(value);
  if (json === undefined) return null;
  return json.length > 4000 ? { truncated: true, preview: json.slice(0, 4000) } : value;
}

// ---------------------------------------------------------------------------
// Argument helpers
// ---------------------------------------------------------------------------
// Shared so that "the model sent a number where a string belongs" is one
// behaviour rather than twelve.

export function str(args: Record<string, unknown>, key: string, opts: {
  required?: boolean; max?: number; lower?: boolean;
} = {}): string {
  const raw = args[key];
  if (raw === undefined || raw === null || raw === '') {
    if (opts.required) throw new ToolInputError(`${key} is required.`);
    return '';
  }
  let v = String(raw).trim();
  if (opts.max && v.length > opts.max) v = v.slice(0, opts.max);
  return opts.lower ? v.toLowerCase() : v;
}

export function num(args: Record<string, unknown>, key: string): number | null {
  const raw = args[key];
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new ToolInputError(`${key} must be a number.`);
  return n;
}

export function bool(args: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const raw = args[key];
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === 'boolean') return raw;
  return String(raw).toLowerCase() === 'true';
}

export function oneOf<T extends string>(
  args: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  fallback: T | null
): T {
  const v = str(args, key, { lower: true });
  if (!v) {
    if (fallback === null) throw new ToolInputError(`${key} must be one of: ${allowed.join(', ')}.`);
    return fallback;
  }
  const match = allowed.find((a) => a === v);
  if (!match) throw new ToolInputError(`${key} must be one of: ${allowed.join(', ')}.`);
  return match;
}
