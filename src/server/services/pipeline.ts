import { serviceClient } from '../supabase.js';
import {
  claimEvent, markEvent, persistInbound, type ResolvedChannel,
} from './inbound.js';
import { dispatchInbound, reply } from './dispatch.js';
import { withDeadline } from './background.js';
import type { NormalizedInboundEvent } from '../channels/meta/types.js';
import type { ProviderId } from '../channels/providers/types.js';

/**
 * The one path every provider's inbound message takes after it has been
 * authenticated and normalized: claim → persist → dispatch, with the event's
 * progress recorded at each step.
 *
 * Recording progress is what makes the pipeline survivable on serverless. The
 * webhook is acknowledged before this runs, so the provider will never retry;
 * if the function is frozen or crashes mid-turn, the event row is left at
 * 'claimed' or 'persisted' and retryInterruptedEvents() finishes the job.
 */

export type InboundOutcome =
  | 'duplicate'
  | 'persist_failed'
  | 'staff_handled'
  | 'dispatched'
  | 'timed_out'
  | 'failed';

/**
 * How long one AI turn may take before we stop waiting and tell the customer.
 * Kept under the function's maxDuration (60s in vercel.json) so the apology is
 * sent by us rather than the turn being cut off by the platform in silence.
 */
function turnBudgetMs(): number {
  const configured = Number(process.env.INBOUND_TURN_BUDGET_MS);
  return Number.isFinite(configured) && configured >= 5_000 ? configured : 50_000;
}

const SLOW_REPLY =
  "Sorry, that is taking longer than it should. Please send your message again in a moment.";

export async function processInbound(
  event: NormalizedInboundEvent,
  channel: ResolvedChannel,
  label: string
): Promise<InboundOutcome> {
  const provider = channel.channelType;

  const claimed = await claimEvent(provider, event.messageId, event.tenantId, event.channelId, event);
  if (!claimed) {
    console.log(`[${label}] duplicate delivery; already handled`);
    return 'duplicate';
  }

  const stored = await persistInbound(event);
  if (!stored) {
    await markEvent(provider, event.messageId, 'failed', { error: 'could not persist the message' });
    return 'persist_failed';
  }
  await markEvent(provider, event.messageId, 'persisted', { conversationId: stored.conversationId });

  // The Inbox has the message either way. The AI only gets a turn when staff
  // have not taken the conversation over.
  if (!stored.aiEnabled) {
    console.log(`[${label}] conversation ${stored.conversationId} is staff-handled; no AI reply`);
    await markEvent(provider, event.messageId, 'processed');
    return 'staff_handled';
  }

  return runTurn(event, channel, stored.conversationId, label);
}

export async function runTurn(
  event: NormalizedInboundEvent,
  channel: ResolvedChannel,
  conversationId: string,
  label: string
): Promise<InboundOutcome> {
  const provider = channel.channelType;
  try {
    await withDeadline(dispatchInbound(event, channel, conversationId), turnBudgetMs(), 'AI turn');
    await markEvent(provider, event.messageId, 'processed');
    return 'dispatched';
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const timedOut = /exceeded \d+s$/.test(message);
    console.error(`[${label}] turn ${timedOut ? 'timed out' : 'failed'}:`, message);

    // Marked first: if the apology itself is cut short the event must not be
    // retried into a second apology.
    await markEvent(provider, event.messageId, 'failed', { error: message });
    try {
      await reply(event, channel, conversationId, SLOW_REPLY, { holding: true });
    } catch {
      /* nothing further to do for this message */
    }
    return timedOut ? 'timed_out' : 'failed';
  }
}

// ---------------------------------------------------------------------------
// Interrupted events
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS = 3;
/** Younger than this and the original invocation may still be working on it. */
const STALE_AFTER_MS = 2 * 60 * 1000;
/** Older than this and a reply would be more confusing than helpful. */
const GIVE_UP_AFTER_MS = 60 * 60 * 1000;

export interface RetrySummary {
  examined: number;
  resumed: number;
  abandoned: number;
  supported: boolean;
}

/**
 * Finish events whose processing was cut off.
 *
 * Only rows that are demonstrably stuck are touched: still 'claimed' or
 * 'persisted' two minutes after arrival. Each is re-claimed by bumping
 * `attempts` under a compare-and-set, so two overlapping runs cannot both
 * resume the same event and answer a customer twice.
 */
export async function retryInterruptedEvents(limit = 10): Promise<RetrySummary> {
  const summary: RetrySummary = { examined: 0, resumed: 0, abandoned: 0, supported: true };
  const now = Date.now();

  const { data, error } = await serviceClient
    .from('webhook_events')
    .select('id, provider, event_id, tenant_id, channel_id, status, attempts, payload, conversation_id, received_at')
    .in('status', ['claimed', 'persisted'])
    .lt('received_at', new Date(now - STALE_AFTER_MS).toISOString())
    .order('received_at', { ascending: true })
    .limit(limit);

  if (error || !Array.isArray(data)) {
    // Most likely migration 0019 has not been applied yet.
    summary.supported = false;
    return summary;
  }

  for (const row of data) {
    summary.examined++;
    const provider = row.provider as ProviderId;
    const event = row.payload as NormalizedInboundEvent | null;
    const attempts = Number(row.attempts ?? 1);
    const age = now - new Date(row.received_at).getTime();

    if (!event || !event.messageId || attempts >= MAX_ATTEMPTS || age > GIVE_UP_AFTER_MS) {
      await markEvent(provider, row.event_id, 'failed', {
        error: !event ? 'no stored payload' : attempts >= MAX_ATTEMPTS ? 'too many attempts' : 'too old to answer',
      });
      summary.abandoned++;
      continue;
    }

    // Compare-and-set on attempts: only one runner proceeds.
    const { data: won } = await serviceClient
      .from('webhook_events')
      .update({ attempts: attempts + 1 })
      .eq('id', row.id)
      .eq('attempts', attempts)
      .in('status', ['claimed', 'persisted'])
      .select('id')
      .maybeSingle();
    if (!won) continue;

    const channel = await loadChannel(row.channel_id, row.tenant_id);
    if (!channel || channel.status !== 'active') {
      await markEvent(provider, row.event_id, 'failed', { error: 'channel is no longer active' });
      summary.abandoned++;
      continue;
    }

    try {
      await resume(event, channel, row.status === 'persisted' ? row.conversation_id : null);
      summary.resumed++;
    } catch (e) {
      await markEvent(provider, row.event_id, 'failed', {
        error: e instanceof Error ? e.message : 'resume failed',
      });
      summary.abandoned++;
    }
  }

  return summary;
}

async function loadChannel(channelId: string | null, tenantId: string): Promise<ResolvedChannel | null> {
  if (!channelId) return null;
  const { data } = await serviceClient
    .from('channels')
    .select('id, tenant_id, channel_type, secret_token, status')
    .eq('id', channelId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    tenantId: data.tenant_id,
    channelType: data.channel_type as ProviderId,
    secretToken: data.secret_token,
    status: data.status,
  };
}

async function resume(
  event: NormalizedInboundEvent,
  channel: ResolvedChannel,
  knownConversationId: string | null
): Promise<void> {
  const provider = channel.channelType;
  let conversationId = knownConversationId;
  let aiEnabled = true;

  if (!conversationId) {
    // Interrupted before or during the write. The message may or may not have
    // landed, so look before writing it a second time.
    const { data: existing } = await serviceClient
      .from('conversation_messages')
      .select('conversation_id')
      .eq('tenant_id', event.tenantId)
      .eq('extracted->>provider_message_id', event.messageId)
      .limit(1);

    const found = Array.isArray(existing) ? existing[0]?.conversation_id : null;
    if (found) {
      conversationId = found;
    } else {
      const stored = await persistInbound(event);
      if (!stored) throw new Error('could not persist the message');
      conversationId = stored.conversationId;
      aiEnabled = stored.aiEnabled;
    }
    await markEvent(provider, event.messageId, 'persisted', { conversationId: conversationId! });
  }

  const { data: convo } = await serviceClient
    .from('conversations')
    .select('id, ai_enabled')
    .eq('id', conversationId!)
    .eq('tenant_id', event.tenantId)
    .maybeSingle();
  if (convo) aiEnabled = convo.ai_enabled !== false;

  if (!aiEnabled) {
    await markEvent(provider, event.messageId, 'processed');
    return;
  }

  // If anyone has spoken since the customer's message, it has been dealt with
  // (or overtaken by a newer message that got its own turn).
  const { data: latest } = await serviceClient
    .from('conversation_messages')
    .select('sender')
    .eq('tenant_id', event.tenantId)
    .eq('conversation_id', conversationId!)
    .order('id', { ascending: false })
    .limit(1);

  const lastSender = Array.isArray(latest) ? latest[0]?.sender : null;
  if (lastSender && lastSender !== 'customer') {
    await markEvent(provider, event.messageId, 'processed');
    return;
  }

  await runTurn(event, channel, conversationId!, 'inbound/retry');
}
