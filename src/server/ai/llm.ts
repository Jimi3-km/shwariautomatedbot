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
const DEFAULT_MODEL = 'meta/llama-3.3-70b-instruct';

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
  const missing = process.env.SHWARI_API_KEY ? [] : ['SHWARI_API_KEY'];
  return { configured: missing.length === 0, missing };
}

export function llmModel(): string {
  return process.env.SHWARI_MODEL || DEFAULT_MODEL;
}

function baseUrl(): string {
  return (process.env.SHWARI_API_BASE || DEFAULT_BASE_URL).replace(/\/+$/, '');
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
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  /** Abandon the call rather than hang a webhook. */
  timeoutMs?: number;
}

/**
 * One model turn.
 *
 * Returns whatever the model produced — prose, tool calls, or both. Deciding
 * what to do with a tool call is the runtime's job, not this function's: it
 * never executes anything.
 */
export async function complete(opts: CompleteOptions): Promise<Completion> {
  const apiKey = process.env.SHWARI_API_KEY;
  if (!apiKey) throw new LlmNotConfiguredError();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);

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
        model: llmModel(),
        messages: opts.messages.map(toWire),
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens ?? 1024,
        stream: false,
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
              tool_choice: 'auto',
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

  const text = typeof message.content === 'string' && message.content.trim()
    ? message.content
    : null;

  return { text, toolCalls };
}
