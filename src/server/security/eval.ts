import { serviceClient } from '../supabase.js';

export interface AgentTurnEvaluation {
  tenantId: string;
  role: string;
  conversationId?: string | null;
  channelType?: string | null;
  channel?: string | null;
  userId?: string | null;
  modelProfile?: string;
  modelName?: string;
  inputText?: string;
  inputMessage?: string;
  toolsCalled?: string[];
  toolsInvoked?: string[];
  reply?: string | null;
  replyText?: string | null;
  durationMs: number;
  status: 'success' | 'failure' | 'fallback' | 'error';
  error?: string | null;
  errorMessage?: string | null;
}

/**
 * Records structured agent turn execution telemetry for continuous evaluation,
 * regression testing, and quality analytics.
 */
export async function logAgentTurn(turn: AgentTurnEvaluation): Promise<void> {
  try {
    const input = turn.inputText ?? turn.inputMessage ?? '';
    const reply = turn.replyText ?? turn.reply ?? null;
    const tools = turn.toolsCalled ?? turn.toolsInvoked ?? [];
    const err = turn.errorMessage ?? turn.error ?? null;
    const channel = turn.channelType ?? turn.channel ?? null;

    const { error } = await serviceClient.from('audit_events').insert({
      tenant_id: turn.tenantId,
      actor_id: turn.role,
      actor_type: 'agent',
      agent_role: turn.role,
      action: 'agent.turn',
      resource_type: 'llm_turn',
      details: {
        model_profile: turn.modelProfile ?? 'primary',
        model_name: turn.modelName ?? null,
        conversation_id: turn.conversationId ?? null,
        channel_type: channel,
        input_preview: input ? input.slice(0, 300) : '',
        tools_invoked: tools,
        duration_ms: turn.durationMs,
        status: turn.status,
        error: err,
        reply_preview: reply ? reply.slice(0, 300) : null,
      },
    });

    if (error && !error.message?.includes('unexpected request')) {
      console.warn('[eval] could not log agent turn telemetry:', error.message);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('unexpected request')) {
      console.warn('[eval] unexpected error recording turn telemetry:', msg);
    }
  }
}
