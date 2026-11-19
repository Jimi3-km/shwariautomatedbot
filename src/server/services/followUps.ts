import { serviceClient } from '../supabase.js';
import { getProvider, ProviderError } from '../channels/providers/index.js';
import { retryInterruptedEvents } from './pipeline.js';
import { planNurture } from './nurture.js';
import { learnFromStaffReplies } from '../ai/learning.js';

/**
 * Sending the follow-ups that have come due.
 *
 * An agent never messages a customer on a timer itself. It writes a row in
 * follow_ups, which a person can read and cancel, and this is what turns the
 * ones still standing into real messages.
 *
 * A row moves pending → sending → sent | failed. It is only marked 'sent'
 * after the channel has accepted the message, so a crash between claim and
 * send leaves an honest 'sending' row (swept to 'failed' later) instead of a
 * 'sent' row for a message nobody received.
 */

export interface FollowUpSummary {
  due: number;
  sent: number;
  failed: number;
  /** Rows left for the next run because the time budget ran out. */
  deferred: number;
}

interface DueRow {
  id: string;
  tenant_id: string;
  conversation_id: string | null;
  customer_id: string;
  channel_type: string;
  message: string;
}

/**
 * 'sending' needs migration 0019 (it widens the status check constraint).
 * Until then the claim falls back to the old behaviour of marking 'sent' up
 * front and correcting to 'failed' afterwards.
 */
let sendingSupported = true;

const STALE_SENDING_MS = 10 * 60 * 1000;

export async function dispatchDueFollowUps(
  opts: { limit?: number; budgetMs?: number } = {}
): Promise<FollowUpSummary> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 50);
  const deadline = Date.now() + (opts.budgetMs ?? 40_000);
  const summary: FollowUpSummary = { due: 0, sent: 0, failed: 0, deferred: 0 };

  await sweepStale();

  const { data: due, error } = await serviceClient
    .from('follow_ups')
    .select('id, tenant_id, conversation_id, customer_id, channel_type, message')
    .eq('status', 'pending')
    .lte('due_at', new Date().toISOString())
    .order('due_at')
    .limit(limit);

  if (error) {
    console.error('[follow-ups] could not read due follow-ups:', error.message);
    throw new Error('Could not read the queue');
  }

  const rows = (due ?? []) as DueRow[];
  summary.due = rows.length;

  for (let i = 0; i < rows.length; i++) {
    if (Date.now() > deadline) {
      summary.deferred = rows.length - i;
      break;
    }
    const row = rows[i];

    // Claim first. The status filter makes this the point at which one runner
    // wins the row, so an overlapping run finds nothing to do rather than
    // sending the same message again.
    if (!(await claim(row.id))) continue;

    const outcome = await deliver(row);
    if (outcome.ok) {
      await finish(row.id, 'sent');
      summary.sent++;
    } else {
      await finish(row.id, 'failed', outcome.reason);
      summary.failed++;
    }
  }

  return summary;
}

async function claim(id: string): Promise<boolean> {
  const attempt = (status: 'sending' | 'sent') =>
    serviceClient
      .from('follow_ups')
      .update(
        status === 'sent'
          ? { status, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }
          : { status, updated_at: new Date().toISOString() }
      )
      .eq('id', id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();

  if (sendingSupported) {
    const { data, error } = await attempt('sending');
    if (!error) return Boolean(data);
    // 23514 = check_violation: the constraint does not know 'sending' yet.
    if (error.code !== '23514') {
      console.warn('[follow-ups] claim failed:', error.message);
      return false;
    }
    sendingSupported = false;
    console.warn("[follow-ups] follow_ups.status does not allow 'sending' yet (migration 0019); using the legacy claim");
  }

  const { data } = await attempt('sent');
  return Boolean(data);
}

async function finish(id: string, status: 'sent' | 'failed', reason?: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await serviceClient
    .from('follow_ups')
    .update(
      status === 'sent'
        ? { status, sent_at: now, failure_reason: null, updated_at: now }
        : { status, failure_reason: (reason ?? 'The message could not be delivered.').slice(0, 500), updated_at: now }
    )
    .eq('id', id);
  if (error) console.error(`[follow-ups] could not mark ${id} ${status}:`, error.message);
}

/** A row left in 'sending' was interrupted; say so rather than leave it in limbo. */
async function sweepStale(): Promise<void> {
  if (!sendingSupported) return;
  const { error } = await serviceClient
    .from('follow_ups')
    .update({
      status: 'failed',
      failure_reason: 'Sending was interrupted. The customer may not have received this message.',
      updated_at: new Date().toISOString(),
    })
    .eq('status', 'sending')
    .lt('updated_at', new Date(Date.now() - STALE_SENDING_MS).toISOString());
  if (error && error.code !== '23514') {
    console.warn('[follow-ups] stale sweep failed:', error.message);
  }
}

interface Delivery {
  ok: boolean;
  reason?: string;
}

async function deliver(row: DueRow): Promise<Delivery> {
  const provider = getProvider(row.channel_type);
  if (!provider) return { ok: false, reason: 'That channel is no longer connected.' };

  const channel = await pickChannel(row);
  if (!channel) return { ok: false, reason: 'That channel is no longer connected.' };

  if (row.channel_type === 'webchat') {
    // Web chat has no outbound API: its widget polls the transcript, so the
    // transcript row *is* the delivery.
    if (!row.conversation_id) return { ok: false, reason: 'That chat session has ended.' };
    const recorded = await record(row, {});
    return recorded ? { ok: true } : { ok: false, reason: 'The message could not be saved.' };
  }

  try {
    await provider.sendMessage(channel.id, row.customer_id, row.message, {
      tenantId: row.tenant_id,
      userId: '',
    });
  } catch (e) {
    const reason = e instanceof ProviderError ? e.userMessage : 'The message could not be delivered.';
    console.error('[follow-ups] delivery failed:', e instanceof Error ? e.message : e);
    return { ok: false, reason };
  }

  // Sent. The Inbox should show what was said to the customer; failing to
  // record it does not un-send the message, so it is logged, not failed.
  if (row.conversation_id) await record(row, {});
  return { ok: true };
}

/**
 * The channel to send on: the one the conversation arrived on if it is still
 * active, otherwise the tenant's most recently connected active channel of
 * that type. (A tenant can hold several — two Telegram bots, say — so a
 * single-row lookup by type alone is not safe.)
 */
async function pickChannel(row: DueRow): Promise<{ id: string } | null> {
  if (row.conversation_id) {
    const { data: convo } = await serviceClient
      .from('conversations')
      .select('channel_id')
      .eq('id', row.conversation_id)
      .eq('tenant_id', row.tenant_id)
      .maybeSingle();

    if (convo?.channel_id) {
      const { data: own } = await serviceClient
        .from('channels')
        .select('id, status')
        .eq('id', convo.channel_id)
        .eq('tenant_id', row.tenant_id)
        .maybeSingle();
      if (own && own.status === 'active') return { id: own.id };
    }
  }

  const { data: candidates } = await serviceClient
    .from('channels')
    .select('id')
    .eq('tenant_id', row.tenant_id)
    .eq('channel_type', row.channel_type)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1);

  const first = Array.isArray(candidates) ? candidates[0] : null;
  return first ? { id: first.id } : null;
}

async function record(row: DueRow, extra: Record<string, unknown>): Promise<boolean> {
  const { error } = await serviceClient.from('conversation_messages').insert({
    tenant_id: row.tenant_id,
    conversation_id: row.conversation_id,
    sender: 'agent',
    body: row.message,
    extracted: { follow_up: true, ...extra },
  });
  if (error) {
    console.error('[follow-ups] could not record the message:', error.message);
    return false;
  }
  await serviceClient
    .from('conversations')
    .update({
      last_message_at: new Date().toISOString(),
      last_message_preview: row.message.slice(0, 160),
    })
    .eq('id', row.conversation_id!)
    .eq('tenant_id', row.tenant_id);
  return true;
}

// ---------------------------------------------------------------------------
// Opportunistic housekeeping
// ---------------------------------------------------------------------------

let lastHousekeeping = 0;
const HOUSEKEEPING_INTERVAL_MS = 60_000;

/**
 * A small slice of the scheduled work, run on the back of real traffic.
 *
 * Vercel's Hobby plan runs a cron at most once a day, which is far too coarse
 * for "remind this customer in two hours" or for rescuing a message whose turn
 * was cut off. So whenever a webhook has just been handled, a few due
 * follow-ups and interrupted events are processed too, at most once a minute
 * per instance. The cron remains the backstop for quiet periods.
 */
export async function housekeeping(): Promise<void> {
  if (process.env.SHWARI_HOUSEKEEPING === 'off') return;
  const now = Date.now();
  if (now - lastHousekeeping < HOUSEKEEPING_INTERVAL_MS) return;
  lastHousekeeping = now;

  try {
    await retryInterruptedEvents(3);
  } catch (e) {
    console.warn('[housekeeping] event retry failed:', e instanceof Error ? e.message : e);
  }
  try {
    await planNurture({ limit: 2, budgetMs: 8_000 });
  } catch (e) {
    console.warn('[housekeeping] nurture planning failed:', e instanceof Error ? e.message : e);
  }
  try {
    await dispatchDueFollowUps({ limit: 5, budgetMs: 10_000 });
  } catch (e) {
    console.warn('[housekeeping] follow-up dispatch failed:', e instanceof Error ? e.message : e);
  }
  try {
    await learnFromStaffReplies({ limit: 1, budgetMs: 6_000 });
  } catch (e) {
    console.warn('[housekeeping] learning pass failed:', e instanceof Error ? e.message : e);
  }
}
