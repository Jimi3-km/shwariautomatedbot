import { tenantLiveness } from './platform.js';
import { serviceClient } from '../supabase.js';
import { type ResolvedChannel } from './inbound.js';
import { getProvider, ProviderError } from '../channels/providers/index.js';
import { findAdmin, redeemPairingCode, looksLikePairingCode } from '../ai/admins.js';
import { runAgentTurn, AgentUnavailableError } from '../ai/agent.js';
import { chooseDepartment } from '../ai/router.js';
import { llmConfigured } from '../ai/llm.js';
import type { NormalizedInboundEvent } from '../channels/meta/types.js';

/**
 * Who answers this message.
 *
 * Every inbound message that reaches the AI now passes through here, from any
 * channel. There are exactly four outcomes:
 *
 *   1. it is a pairing code from someone claiming to be the owner — redeem it
 *   2. the sender is a known administrator — Shwari answers, in this process
 *   3. a customer — the department the message belongs to answers
 *   4. nothing above applied — the customer gets a plain acknowledgement so the
 *      message is never met with silence, and staff see it in the Inbox
 *
 * Case 4 catches a server with no model key and a business with every
 * department switched off. There is no external pipeline behind this any more.
 */

export type DispatchOutcome =
  | { handledBy: 'shwari'; actions: string[] }
  | { handledBy: 'department'; role: string; actions: string[] }
  | { handledBy: 'pairing' }
  | { handledBy: 'pipeline'; forwarded: boolean; reason?: string }
  | { handledBy: 'none'; reason: string };

export async function dispatchInbound(
  event: NormalizedInboundEvent,
  channel: ResolvedChannel,
  conversationId: string
): Promise<DispatchOutcome> {
  // Telegram opens every new chat with "/start". It is a greeting, not a
  // message to interpret.
  const text = /^\/start\b/i.test((event.text ?? '').trim()) ? 'Hello' : (event.text ?? '').trim();

  // Email has no provider and is answered by its own webhook route.
  if (event.channelType === 'email') return { handledBy: 'none', reason: 'email_not_dispatched' };

  // --- 1. pairing -----------------------------------------------------------
  if (text && looksLikePairingCode(text)) {
    const result = await redeemPairingCode(text, event.channelType, event.customerId, event.tenantId);
    if (result.ok) {
      await reply(
        event, channel, conversationId,
        "You're connected. I'm Shwari — tell me about your business in your own words and I'll set everything up. What do you do, and where?"
      );
      return { handledBy: 'pairing' };
    }
    // An expired or already-used code is worth saying so about; an unknown one
    // is probably just a customer typing eight characters, so it falls through
    // to the normal path rather than announcing that pairing exists.
    if (result.reason === 'expired' || result.reason === 'used') {
      await reply(event, channel, conversationId, 'That code has expired. Generate a new one in your dashboard and send it here.');
      return { handledBy: 'pairing' };
    }
  }

  // A business waiting for approval, suspended, or with its agents paused by
  // the platform keeps receiving its messages (they are in the Inbox) but no
  // agent answers. The owner can still talk to Shwari while waiting, to set
  // the business up; nobody is answered once it is suspended.
  const liveness = await tenantLiveness(event.tenantId);
  if (liveness.status === 'suspended' || liveness.status === 'cancelled') {
    return { handledBy: 'none', reason: `business_${liveness.status}` };
  }

  // --- 2. Shwari ------------------------------------------------------------
  // Is this sender the owner of THIS business? Someone who administers one
  // business by chat is an ordinary customer when they message another
  // business's bot. Treating the mismatch as suspicious and staying silent
  // meant an owner testing a second business got no reply at all, which read
  // as "the agents only work on one account". They are never given the other
  // business's manager; they simply get its customer-facing team.
  const admin = await findAdmin(event.channelType, event.customerId, event.tenantId);
  if (admin) {

    try {
      const turn = await runAgentTurn({
        tenantId: admin.tenantId,
        role: 'manager',
        userId: admin.userId,
        conversationId,
        text: text || '(the owner sent an attachment)',
      });
      await reply(event, channel, conversationId, turn.reply);
      return { handledBy: 'shwari', actions: turn.actions };
    } catch (e) {
      const message =
        e instanceof AgentUnavailableError
          ? e.message
          : "I couldn't get to that just now. Try me again in a moment.";
      if (!(e instanceof AgentUnavailableError)) {
        console.error('[dispatch] Shwari turn failed:', e instanceof Error ? e.message : e);
      }
      await reply(event, channel, conversationId, message);
      return { handledBy: 'none', reason: 'shwari_failed' };
    }
  }

  if (!liveness.live) {
    return { handledBy: 'none', reason: liveness.agentsPaused ? 'agents_paused' : `business_${liveness.status}` };
  }

  // --- 3. a department ------------------------------------------------------
  // A customer message goes to whichever department it belongs to. If no model
  // is configured, or no department is live, it falls through to the plain
  // acknowledgement below.
  if (llmConfigured().configured) {
    // A photo sent with a message arrives as two events at the same moment.
    // Each used to get its own turn, so the customer got two answers, often
    // from two departments. The one with words is the one to answer.
    if (await coveredByTextMessage(event, conversationId)) {
      return { handledBy: 'none', reason: 'attachment_answered_with_its_text' };
    }

    const routed = await chooseDepartment(event.tenantId, text, conversationId);

    if (routed) {
      try {
        const turn = await runAgentTurn({
          tenantId: event.tenantId,
          role: routed.role,
          userId: null,
          conversationId,
          text: text || '(the customer sent an attachment)',
        });
        const answeredBy = turn.answeredBy ?? routed.role;
        // Stamped so the next message is routed knowing who the customer was
        // talking to, and so the Inbox can show which department replied.
        await reply(event, channel, conversationId, turn.reply, { department: answeredBy });
        return { handledBy: 'department', role: answeredBy, actions: turn.actions };
      } catch (e) {
        // A department that cannot answer must not swallow the customer's message silently
        console.error(
          `[dispatch] ${routed.role} could not answer:`,
          e instanceof Error ? e.message : e
        );
        await reply(
          event, channel, conversationId,
          "Sorry, something went wrong on our side just now. Your message has reached us and someone will get back to you shortly."
        );
        return { handledBy: 'none', reason: 'department_failed' };
      }
    }
  }

  // Nobody can answer. Say so once rather than leaving the customer in silence;
  // the message is already in the Inbox for staff.
  const acknowledged = await acknowledgeWithoutAgent(event, channel, conversationId);
  console.log(
    `[dispatch] no agent available for tenant ${event.tenantId}; ` +
      (acknowledged ? 'sent a holding reply' : 'holding reply already sent recently')
  );
  return { handledBy: 'none', reason: 'no_route' };
}

/** How close together a photo and its message have to be to count as one. */
const SAME_MESSAGE_WINDOW_MS = 10_000;

/**
 * Is this an attachment with no words, sent alongside a text message?
 *
 * The check waits a moment first: the two events race, and the text one may
 * not have been written yet when the attachment arrives.
 */
export async function coveredByTextMessage(
  event: NormalizedInboundEvent,
  conversationId: string,
  waitMs = 1500
): Promise<boolean> {
  if ((event.text ?? '').trim()) return false;
  if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));

  const at = Date.parse(event.timestamp);
  const centre = Number.isFinite(at) ? at : Date.now();
  const { data } = await serviceClient
    .from('conversation_messages')
    .select('body, created_at, extracted')
    .eq('tenant_id', event.tenantId)
    .eq('conversation_id', conversationId)
    .eq('sender', 'customer')
    .gte('created_at', new Date(centre - SAME_MESSAGE_WINDOW_MS).toISOString())
    .lte('created_at', new Date(centre + SAME_MESSAGE_WINDOW_MS).toISOString())
    .limit(10);

  return (Array.isArray(data) ? data : []).some((m: any) => {
    const body = typeof m.body === 'string' ? m.body.trim() : '';
    const own = m.extracted?.provider_message_id && m.extracted.provider_message_id === event.messageId;
    // A real message: has words, and is not this attachment's own placeholder row.
    return !own && body.length > 0 && !/^\((?:the customer sent|image|photo|attachment|video|audio|voice|document|sticker)/i.test(body) && !/^\[[^\]]*\]$/.test(body);
  });
}

const HOLDING_REPLY =
  "Thanks for your message. A member of our team will get back to you shortly.";

/** How long before the holding reply may be repeated in the same conversation. */
const HOLDING_REPLY_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * The reply of last resort, sent at most once every few hours per conversation
 * so a customer typing five messages does not get five identical apologies.
 */
async function acknowledgeWithoutAgent(
  event: NormalizedInboundEvent,
  channel: ResolvedChannel,
  conversationId: string
): Promise<boolean> {
  const since = new Date(Date.now() - HOLDING_REPLY_INTERVAL_MS).toISOString();
  const { data: recent } = await serviceClient
    .from('conversation_messages')
    .select('id')
    .eq('tenant_id', event.tenantId)
    .eq('conversation_id', conversationId)
    .eq('sender', 'agent')
    .eq('extracted->>holding', 'true')
    .gte('created_at', since)
    .limit(1);

  if (Array.isArray(recent) && recent.length > 0) return false;

  await reply(event, channel, conversationId, HOLDING_REPLY, { holding: true });
  return true;
}

export interface ReplyResult {
  /** The transcript row was written. */
  recorded: boolean;
  /** The message reached the channel (always true for web chat once recorded). */
  delivered: boolean;
  error?: string;
}

/**
 * Say something back.
 *
 * The transcript is written first and the channel send second, so the Inbox
 * shows what the agent said even when delivery fails — and when it does fail,
 * the row is marked so the Inbox does not present an undelivered reply as
 * sent. Web chat needs no send at all: its widget reads the same transcript.
 */
export async function reply(
  event: NormalizedInboundEvent,
  channel: ResolvedChannel,
  conversationId: string,
  text: string,
  meta: Record<string, unknown> = {}
): Promise<ReplyResult> {
  const now = new Date().toISOString();
  const extracted = { agent: 'shwari', ...meta };

  const { data: row, error: insertErr } = await serviceClient
    .from('conversation_messages')
    .insert({
      tenant_id: event.tenantId,
      conversation_id: conversationId,
      sender: 'agent',
      body: text,
      extracted,
    })
    .select('id')
    .maybeSingle();

  if (insertErr) {
    // For web chat the transcript row *is* the delivery, so this is a lost
    // reply. For the others the send below can still reach the customer.
    console.error('[dispatch] could not record the reply:', {
      code: insertErr.code, message: insertErr.message,
    });
  }

  const { error: convoErr } = await serviceClient
    .from('conversations')
    .update({ last_message_at: now, last_message_preview: text.slice(0, 160) })
    .eq('id', conversationId)
    .eq('tenant_id', event.tenantId);
  if (convoErr) {
    console.warn('[dispatch] could not update the conversation preview:', convoErr.message);
  }

  if (event.channelType === 'webchat') {
    return insertErr
      ? { recorded: false, delivered: false, error: 'The reply could not be saved.' }
      : { recorded: true, delivered: true };
  }

  const provider = getProvider(event.channelType);
  if (!provider) {
    return { recorded: !insertErr, delivered: false, error: 'No provider handles this channel.' };
  }

  try {
    await provider.sendMessage(channel.id, event.customerId, text, {
      tenantId: event.tenantId,
      userId: '',
    });
    return { recorded: !insertErr, delivered: true };
  } catch (e) {
    const reason = e instanceof ProviderError ? e.userMessage : 'The message could not be delivered.';
    console.error(
      `[dispatch] could not deliver the reply on ${event.channelType}:`,
      e instanceof Error ? e.message : e
    );

    // Mark the row so the Inbox can show that the customer never received it.
    const messageId = (row as { id?: unknown } | null)?.id;
    if (messageId !== undefined && messageId !== null) {
      const { error: markErr } = await serviceClient
        .from('conversation_messages')
        .update({
          extracted: {
            ...extracted,
            delivery: { status: 'failed', error: reason, at: new Date().toISOString() },
          },
        })
        .eq('id', messageId)
        .eq('tenant_id', event.tenantId);
      if (markErr) console.warn('[dispatch] could not mark the failed delivery:', markErr.message);
    }

    return { recorded: !insertErr, delivered: false, error: reason };
  }
}
