/**
 * The backend's LLM client.
 *
 * Until now every model call in this product lived in n8n. Shwari is different:
 * it holds tenant context, calls permission-checked tools and writes to the
 * database, none of which belongs in a workflow node. So the reasoning loop
 * runs here, and n8n keeps doing what it is good at — channel plumbing,
 * schedules and the existing sales pipeline.
 *
 * The provider is NVIDIA's hosted open-model API, which speaks the OpenAI chat
 * completions dialect including tool calls. Nothing below is NVIDIA-specific
 * beyond the default base URL, so pointing SHWARI_API_BASE at another
 * OpenAI-compatible endpoint is a configuration change, not a code change.
 */

const DEFAULT_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const DEFAULT_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b';

/**
 * Reasoning models spend the token budget twice.
 *
 * A model like Nemotron thinks before it answers, and those thinking tokens
 * count against max_tokens just as the reply does. Ask for 900 and the thinking
 * can consume all of it, leaving the reply truncated or empty — which surfaces
 * as the agent repeating its own briefing instead of answering, because a
 * half-finished generation is whatever the model had produced so far.
 *
 * So the ceiling is generous, and thinking is off by default. Shwari's turns
 * are short conversational exchanges over tools that already validate
 * themselves; extended reasoning makes them slower and no more correct. Set
 * SHWARI_THINKING=on for a model that genuinely needs it.
 */
const DEFAULT_MAX_TOKENS = parseInt(process.env.SHWARI_MAX_TOKENS || '8192', 10);

function thinkingEnabled(): boolean {
  return /^(1|on|true|yes)$/i.test(process.env.SHWARI_THINKING ?? '');
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON string from the model. Parsed by the caller, which validates it. */
  argumentsJson: string;
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

export interface Completion {
  text: string | null;
  toolCalls: ToolCall[];
}

export class LlmNotConfiguredError extends Error {
  constructor() {
    super('SHWARI_API_KEY is not set');
    this.name = 'LlmNotConfiguredError';
  }
}

export class LlmError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
  }
}

export function llmConfigured(): { configured: boolean; missing: string[] } {
  const missing = process.env.SHWARI_API_KEY?.trim() ? [] : ['SHWARI_API_KEY'];
  return { configured: missing.length === 0, missing };
}

export type ModelProfile = 'primary' | 'fast' | 'fallback';

/**
 * Is the operator allowed to point the agents at a different model?
 *
 * Off by default. Every agent runs on Nemotron: the model variables in the
 * environment had drifted to an id the provider retired, the agents fell back
 * to whatever substitute answered, and the quality of their tool use fell with
 * it. A stale variable can no longer do that. To run another model on purpose,
 * set SHWARI_ALLOW_MODEL_OVERRIDE=on alongside the model variable.
 */
function modelOverrideAllowed(): boolean {
  return /^(1|on|true|yes)$/i.test(process.env.SHWARI_ALLOW_MODEL_OVERRIDE ?? '');
}

export function resolveModel(profile: ModelProfile = 'primary'): string {
  if (!modelOverrideAllowed()) return DEFAULT_MODEL;
  const env = (name: string) => (process.env[name] ?? '').trim();
  if (profile === 'fast') {
    return env('SHWARI_FAST_MODEL') || env('SHWARI_MODEL') || DEFAULT_MODEL;
  }
  if (profile === 'fallback') {
    return env('SHWARI_FALLBACK_MODEL') || env('SHWARI_PRIMARY_MODEL') || env('SHWARI_MODEL') || DEFAULT_MODEL;
  }
  return env('SHWARI_PRIMARY_MODEL') || env('SHWARI_MODEL') || DEFAULT_MODEL;
}

export function llmModel(profile: ModelProfile = 'primary'): string {
  return resolveModel(profile);
}

/**
 * Models a tenant's "AI Agent" settings may select.
 *
 * The setting is free text in the database and reachable by anyone who can
 * edit it, so it is honoured only when the operator listed the model here or
 * it is one the server already runs. Anything else is ignored rather than
 * billed.
 */
export function allowedModel(requested: string | null | undefined): string | null {
  const model = (requested ?? '').trim();
  if (!model) return null;
  const allow = new Set(
    [
      ...(process.env.SHWARI_ALLOWED_MODELS ?? '').split(','),
      resolveModel('primary'), resolveModel('fast'), resolveModel('fallback'),
    ].map((m) => m.trim()).filter(Boolean)
  );
  return allow.has(model) ? model : null;
}

function baseUrl(): string {
  return (process.env.SHWARI_API_BASE || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
}

/** Our message shape → the wire shape. */
function toWire(m: ChatMessage): Record<string, unknown> {
  switch (m.role) {
    case 'assistant':
      return {
        role: 'assistant',
        content: m.content ?? '',
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map((c) => ({
                id: c.id,
                type: 'function',
                function: { name: c.name, arguments: c.argumentsJson },
              })),
            }
          : {}),
      };
    case 'tool':
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    default:
      return { role: m.role, content: m.content };
  }
}

export interface CompleteOptions {
  /**
   * 'required' makes the model return a tool call rather than prose. Used when
   * it has just announced an action instead of taking it.
   */
  toolChoice?: 'auto' | 'required';
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  /** Abandon the call rather than hang a webhook. */
  timeoutMs?: number;
  /** Targeted model profile. Defaults to 'primary'. */
  profile?: ModelProfile;
  /** Force reasoning on or off for this call, whatever SHWARI_THINKING says. */
  thinking?: boolean;
  /** An explicit model id, overriding the profile. Callers must have allowlisted it. */
  model?: string;
  /** Epoch ms after which the whole turn has run out of time; caps this call's timeout. */
  deadlineAt?: number;
}

/**
 * One model turn.
 *
 * Returns whatever the model produced — prose, tool calls, or both. Deciding
 * what to do with a tool call is the runtime's job, not this function's: it
 * never executes anything.
 */
export async function complete(opts: CompleteOptions): Promise<Completion> {
  const profile = opts.profile ?? 'primary';
  const configured = (opts.model?.trim() || resolveModel(profile)).trim();
  const model = retiredModels.get(configured) ?? configured;
  try {
    return await executeCompletion(opts, model);
  } catch (err) {
    // Not every hosted model accepts a forced tool call. One that refuses the
    // request is asked again the ordinary way rather than failing the turn.
    if (opts.toolChoice === 'required' && err instanceof LlmError && (err.status === 400 || err.status === 422)) {
      return complete({ ...opts, toolChoice: undefined });
    }
    // The provider retires hosted models: the id that worked last month starts
    // answering 404 or 410, and every turn fails until someone edits the
    // environment. Rather than go dark, move to a model that is still served
    // and remember the substitution for the life of this process.
    if (err instanceof LlmError && (err.status === 404 || err.status === 410)) {
      const tried = new Set([model]);
      for (const candidate of substituteModels()) {
        if (tried.has(candidate)) continue;
        tried.add(candidate);
        if (opts.deadlineAt && opts.deadlineAt - Date.now() < 3_000) break;
        try {
          const result = await executeCompletion(opts, candidate);
          retiredModels.set(configured, candidate);
          console.error(
            `[llm] model "${configured}" is no longer served (HTTP ${err.status}); using "${candidate}" instead. ` +
              'Update SHWARI_MODEL / SHWARI_PRIMARY_MODEL / SHWARI_FAST_MODEL.'
          );
          return result;
        } catch (e) {
          if (!(e instanceof LlmError && (e.status === 404 || e.status === 410))) throw e;
        }
      }
      throw new LlmError(
        `The configured model "${configured}" is no longer served by the provider, and no substitute answered`,
        err.status
      );
    }

    const retryable = err instanceof LlmError && (err.status >= 500 || err.status === 429);
    if (!retryable || profile === 'fallback') throw err;

    const fallback = resolveModel('fallback');
    const rateLimited = (err as LlmError).status === 429;
    const timedOut = (err as LlmError).status === 504;

    // Retrying the very same model only makes sense when it was rate limited,
    // and then only after a pause. A timeout on the same model would just
    // spend the caller's whole budget twice.
    if (fallback === model && (!rateLimited || timedOut)) throw err;
    if (opts.deadlineAt && opts.deadlineAt - Date.now() < 3_000) throw err;

    if (rateLimited) await sleep(Math.min(RATE_LIMIT_BACKOFF_MS, remaining(opts.deadlineAt) / 2));
    console.warn(`[llm] ${model} failed with HTTP ${(err as LlmError).status}; retrying with ${fallback}`);
    return await executeCompletion(opts, fallback);
  }
}

/** Configured model id → the substitute that answered after it was retired. */
const retiredModels = new Map<string, string>();

/**
 * Models to try, in order, when the configured one has been retired: the
 * operator's own fallback first, then ids the default provider serves.
 */
function substituteModels(): string[] {
  return [
    // Nemotron first: a retired override should land on the model the agents
    // are built and tested against, not on whatever else happens to answer.
    DEFAULT_MODEL,
    modelOverrideAllowed() ? process.env.SHWARI_FALLBACK_MODEL : '',
    'moonshotai/kimi-k3.1-pro',
    'nvidia/nemotron-3.5-lightning-30b-a3b',
  ]
    .map((m) => (m ?? '').trim())
    .filter(Boolean);
}

const RATE_LIMIT_BACKOFF_MS =parseInt(process.env.SHWARI_RATE_LIMIT_BACKOFF_MS || '1500', 10);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function remaining(deadlineAt: number | undefined): number {
  return deadlineAt ? Math.max(0, deadlineAt - Date.now()) : Number.MAX_SAFE_INTEGER;
}

/**
 * Clean model output to prevent degenerate repetition loops, runaway punctuation,
 * and conversational echo artifacts.
 */
export function sanitizeCompletionText(raw: string | null): string | null {
  if (!raw) return null;
  let text = raw.trim();
  if (!text) return null;

  // 1. Collapse degenerate runaway punctuation (e.g. !!!!!!!!! -> !, ????? -> ?, ..... -> ...)
  text = text.replace(/!{2,}/g, '!');
  text = text.replace(/\?{2,}/g, '?');
  text = text.replace(/\.{4,}/g, '...');

  // 2. Collapse repetitive identical sentences (autoregressive loops), one
  //    line at a time. Line breaks are the reply's structure - bullets, steps,
  //    paragraphs - so they are never joined away; only a sentence that repeats
  //    the one immediately before it on the same line is dropped.
  const lines = text.split(/\r?\n/).map((line) => {
    const sentences = line.trim().split(/(?<=[.?!])[ \t]+/);
    const kept: string[] = [];
    for (const s of sentences) {
      const trimmed = s.trim();
      if (!trimmed) continue;
      if (kept.length > 0 && kept[kept.length - 1].toLowerCase() === trimmed.toLowerCase()) continue;
      kept.push(trimmed);
    }
    return kept.join(' ');
  });

  // 3. Collapse repetitive identical lines, and runs of blank lines to one.
  const dedupedLines: string[] = [];
  for (const line of lines) {
    const previous = dedupedLines[dedupedLines.length - 1];
    if (previous !== undefined) {
      if (!line && !previous) continue;
      if (line && previous.toLowerCase() === line.toLowerCase()) continue;
    }
    dedupedLines.push(line);
  }
  text = dedupedLines.join('\n');

  // 4. Strip dangling incomplete word / exclamation loops at the very end
  text = text.replace(/(?:^|\s)The[!?]+$/i, '').trim();

  return text.trim() || null;
}

export function looksLikeTextToolCall(text: string): boolean {
  return /<\/?tool_call>|<function=[\w-]+>|<\|tool_call\|>|<parameter=[\w-]+>/i.test(text);
}

function looseValue(raw: string): unknown {
  const v = raw.trim();
  if (/^-?\d+(?:\.\d+)?$/.test(v)) return Number(v);
  if (/^(true|false)$/i.test(v)) return v.toLowerCase() === 'true';
  if (/^[\[{]/.test(v)) {
    try { return JSON.parse(v); } catch { /* keep it as text */ }
  }
  return v;
}

/**
 * Pull tool calls out of text, in the two spellings models use:
 *
 *   <tool_call><function=name><parameter=key>value</parameter></function></tool_call>
 *   <tool_call>{"name": "...", "arguments": {...}}</tool_call>
 *
 * Returns the calls and whatever prose was left once the markup is removed.
 */
export function extractTextToolCalls(text: string): { calls: ToolCall[]; rest: string } {
  const calls: ToolCall[] = [];
  let n = 0;

  const fn = /<function=([\w-]+)>([\s\S]*?)(?:<\/function>|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = fn.exec(text))) {
    const args: Record<string, unknown> = {};
    const param = /<parameter=([\w-]+)>([\s\S]*?)(?:<\/parameter>|(?=<parameter=)|$)/gi;
    let p: RegExpExecArray | null;
    while ((p = param.exec(m[2]))) args[p[1]] = looseValue(p[2]);
    calls.push({ id: `text_call_${n++}`, name: m[1], argumentsJson: JSON.stringify(args) });
  }

  if (!calls.length) {
    const block = /<tool_call>\s*(\{[\s\S]*?\})\s*(?:<\/tool_call>|$)/gi;
    while ((m = block.exec(text))) {
      try {
        const parsed = JSON.parse(m[1]);
        const name = parsed?.name ?? parsed?.function?.name;
        const args = parsed?.arguments ?? parsed?.parameters ?? parsed?.function?.arguments ?? {};
        if (typeof name === 'string' && name) {
          calls.push({
            id: `text_call_${n++}`,
            name,
            argumentsJson: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
          });
        }
      } catch { /* not a call we can read */ }
    }
  }

  const rest = text
    .replace(/<tool_call>[\s\S]*?(?:<\/tool_call>|$)/gi, ' ')
    .replace(/<function=[\w-]+>[\s\S]*?(?:<\/function>|$)/gi, ' ')
    .replace(/<\/?(?:tool_call|function|parameter)[^>]*>/gi, ' ')
    .replace(/<\|tool_call\|>/gi, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  return { calls, rest };
}

async function executeCompletion(opts: CompleteOptions, model: string): Promise<Completion> {
  const apiKey = process.env.SHWARI_API_KEY?.trim();
  if (!apiKey) throw new LlmNotConfiguredError();

  // One call never outlives the turn it belongs to. The per-call ceiling is
  // sized to fit inside a serverless function's lifetime with room to reply.
  const perCall = opts.timeoutMs ?? parseInt(process.env.SHWARI_TIMEOUT_MS || '30000', 10);
  const budget = Math.min(perCall, remaining(opts.deadlineAt));
  if (budget < 1_000) throw new LlmError('The model took too long to answer', 504);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budget);

  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: opts.messages.map(toWire),
        temperature: opts.temperature ?? 0.3,
        
        max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
        stream: false,
        /**
         * Ignored by models that do not reason, honoured by the ones that do.
         * Sending it 
         * keeps one code path for both.
         */
        chat_template_kwargs: { enable_thinking: opts.thinking ?? thinkingEnabled() },
        ...(opts.tools?.length
          ? {
              tools: opts.tools.map((t) => ({
                type: 'function',
                function: {
                  name: t.name,
                  description: t.description,
                  parameters: t.parameters,
                },
              })),
              tool_choice: opts.toolChoice ?? 'auto',
            }
          : {}),
      }),
    });
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new LlmError('The model took too long to answer', 504);
    }
    throw new LlmError('Could not reach the model', 502);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // The body can carry the API key back in an echoed request on some
    // gateways, so only the status and a short reason are ever logged.
    const detail = await res.text().catch(() => '');
    console.error(`[llm] HTTP ${res.status}: ${detail.slice(0, 300)}`);
    throw new LlmError(`The model rejected the request (HTTP ${res.status})`, res.status);
  }

  const json: any = await res.json().catch(() => null);
  const message = json?.choices?.[0]?.message;
  if (!message) throw new LlmError('The model returned no message', 502);

  const toolCalls: ToolCall[] = Array.isArray(message.tool_calls)
    ? message.tool_calls
        .filter((c: any) => c?.function?.name)
        .map((c: any, i: number) => ({
          id: String(c.id ?? `call_${i}`),
          name: String(c.function.name),
          argumentsJson: typeof c.function.arguments === 'string'
            ? c.function.arguments
            : JSON.stringify(c.function.arguments ?? {}),
        }))
    : [];

  /**
   * A reasoning model returns its scratchpad separately, in reasoning_content.
   * That is the model thinking out loud, not something the customer or the
   * owner should ever read, so it is dropped here rather than downstream —
   * there is no path by which it can reach a reply.
   */
  let rawText = typeof message.content === 'string' && message.content.trim()
    ? message.content.trim()
    : null;

  /**
   * Some models write a tool call into the reply as text instead of returning
   * it as a call. Left alone, that markup is what the owner reads: a block of
   * <tool_call> tags where an answer should be, and nothing done. It is read
   * here as the call it was meant to be, and never survives as text.
   */
  if (rawText && looksLikeTextToolCall(rawText)) {
    const extracted = extractTextToolCalls(rawText);
    if (!toolCalls.length && opts.tools?.length) {
      const known = new Set(opts.tools.map((t) => t.name));
      toolCalls.push(...extracted.calls.filter((c) => known.has(c.name)));
    }
    rawText = extracted.rest || null;
  }
  const text = sanitizeCompletionText(rawText);

  /**
   * Ran out of budget mid-thought. Whatever is in `content` at that point is a
   * fragment — often the model restating its own briefing — and sending it on
   * would put nonsense in front of a customer. Better to say nothing and let
   * the caller offer its fallback.
   */
  const finish = json?.choices?.[0]?.finish_reason;
  if (finish === 'length' && !toolCalls.length) {
    const reasoned = typeof message.reasoning_content === 'string' && message.reasoning_content.length;
    console.warn(
      `[llm] hit the token ceiling before finishing a reply${reasoned ? ' (the budget went on reasoning)' : ''}`
    );
    return { text: null, toolCalls: [] };
  }

  return { text, toolCalls };
}
