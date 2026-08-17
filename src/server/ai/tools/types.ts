import { serviceClient } from '../../supabase.js';
import type { ToolDefinition } from '../llm.js';

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
  agentRole: 'manager' | 'sales' | 'support';
  conversationId: string | null;
  /** Tool names this agent is configured to use. */
  allowedTools: string[];
}

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

  try {
    const result = await tool.run(args, ctx);
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
