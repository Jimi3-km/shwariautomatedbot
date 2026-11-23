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
  /** What the behaviour check did: self_corrected, held_back, ran_out_of_steps, and the issues found. */
  flags?: string[];
}

export type AutoLabel = { label: 'ok' | 'needs_improvement' | 'bug'; tags: string[]; notes: string };

/**
 * The verdict a turn gets before any person has looked at it.
 *
 * Every turn used to arrive on the QA page unlabelled, so the page said
 * nothing until someone read each one. The system already knows the obvious
 * cases - a crash, a reply it had to hold back, a turn that ran out of steps -
 * and marks them. A reviewer's label replaces this one.
 */
export function autoLabel(status: string, flags: string[] = [], error?: string | null): AutoLabel {
  const tags = ['auto', ...new Set(flags)];
  if (status === 'error' || status === 'failure') {
    return { label: 'bug', tags, notes: error ? `The turn failed: ${error}`.slice(0, 500) : 'The turn failed.' };
  }
  if (flags.includes('held_back')) {
    return { label: 'needs_improvement', tags, notes: 'The reply was held back by the behaviour check and an honest holding line was sent instead.' };
  }
  if (status === 'fallback') {
    return { label: 'needs_improvement', tags, notes: 'The agent could not produce an answer and sent its fallback line.' };
  }
  if (flags.includes('ran_out_of_steps')) {
    return { label: 'needs_improvement', tags, notes: 'The agent ran out of steps or time before finishing the request.' };
  }
  if (flags.includes('self_corrected')) {
    return { label: 'ok', tags, notes: 'The first draft failed the behaviour check and the agent corrected it before replying.' };
  }
  return { label: 'ok', tags, notes: '' };
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

    const { data: saved, error } = await serviceClient.from('audit_events').insert({
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
        flags: turn.flags ?? [],
      },
    }).select('id').maybeSingle();

    const turnId = (saved as { id?: number } | null)?.id;
    if (!error && turnId !== undefined && turnId !== null) {
      const verdict = autoLabel(turn.status, turn.flags ?? [], err);
      const { error: labelErr } = await serviceClient.from('agent_turn_labels').insert({
        turn_event_id: turnId,
        tenant_id: turn.tenantId,
        labeled_by: null,
        label: verdict.label,
        tags: verdict.tags,
        notes: verdict.notes,
      });
      // 23505: a reviewer got there first. Their label stands.
      if (labelErr && labelErr.code !== '23505' && !labelErr.message?.includes('unexpected request')) {
        console.warn('[eval] could not auto-label the turn:', labelErr.message);
      }
    }

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
