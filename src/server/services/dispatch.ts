import { serviceClient } from '../supabase.js';
import { forwardToPipeline, type ResolvedChannel } from './inbound.js';
import { getProvider } from '../channels/providers/index.js';
import { findAdmin, redeemPairingCode, looksLikePairingCode } from '../ai/admins.js';
import { runAgentTurn, AgentUnavailableError } from '../ai/agent.js';
import { chooseDepartment } from '../ai/router.js';
import { llmConfigured } from '../ai/llm.js';
import type { NormalizedInboundEvent } from '../channels/meta/types.js';

/**
 * Who answers this message.
 *
 * Every inbound message that reaches the AI now passes through here, from any
 * channel. There are exactly three outcomes:
 *
 *   1. it is a pairing code from someone claiming to be the owner — redeem it
 *   2. the sender is a known administrator — Shwari answers, in this process
 *   3. a customer — the department the message belongs to answers
 *   4. nothing above applied — the existing n8n pipeline answers, as it always
 *      has
 *
 * Case 4 is the floor, not the exception: it catches a server with no model
 * key, a business with every department switched off, and any department that
 * fails mid-turn. A tenant that has not adopted the workforce keeps exactly the
 * behaviour it had before.
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
  const text = (event.text ?? '').trim();

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

  // --- 2. Shwari ------------------------------------------------------------
  const admin = await findAdmin(event.channelType, event.customerId);
  if (admin) {
    // The link is keyed on the chat identity, but the message arrived on a
    // channel belonging to some tenant. If those disagree, something is wrong
    // and the safe move is to do nothing rather than administer the wrong
    // business.
    if (admin.tenantId !== event.tenantId) {
      console.warn(`[dispatch] admin identity on ${event.channelType} belongs to another business; ignoring`);
      return { handledBy: 'none', reason: 'admin_tenant_mismatch' };
    }

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

  // --- 3. a department ------------------------------------------------------
  // A customer message goes to whichever department it belongs to. If no model
  // is configured, or no department is live, this falls through to the n8n
  // pipeline exactly as it did before — so a tenant that has not switched the
  // workforce on keeps the behaviour it already had.
  if (llmConfigured().configured) {
    const routed = await chooseDepartment(event.tenantId, text);

    if (routed) {
      try {
        const turn = await runAgentTurn({
          tenantId: event.tenantId,
          role: routed.role,
          userId: null,
          conversationId,
          text: text || '(the customer sent an attachment)',
        });
        await reply(event, channel, conversationId, turn.reply);
        return { handledBy: 'department', role: routed.role, actions: turn.actions };
      } catch (e) {
        // A department that cannot answer must not swallow the customer's
        // message: the existing pipeline is still there and still works.
        console.error(
          `[dispatch] ${routed.role} could not answer, falling back to the pipeline:`,
          e instanceof Error ? e.message : e
        );
      }
    }
  }

  // --- 4. the existing pipeline --------------------------------------------
  const forwarded = await forwardToPipeline(event, channel.secretToken);
  return { handledBy: 'pipeline', ...forwarded };
}

/**
 * Say something back.
 *
 * The transcript is written first and the channel send second, so the Inbox
 * shows what the agent said even when delivery fails. Web chat needs no send at
 * all — its widget reads the same transcript — so the provider call is skipped
 * rather than faked.
 */
async function reply(
  event: NormalizedInboundEvent,
  channel: ResolvedChannel,
  conversationId: string,
  text: string
): Promise<void> {
  const now = new Date().toISOString();

  await serviceClient.from('conversation_messages').insert({
    tenant_id: event.tenantId,
    conversation_id: conversationId,
    sender: 'agent',
    body: text,
    extracted: { agent: 'shwari' },
  });

  await serviceClient
    .from('conversations')
    .update({ last_message_at: now, last_message_preview: text.slice(0, 160) })
    .eq('id', conversationId)
    .eq('tenant_id', event.tenantId);

  if (event.channelType === 'webchat') return;

  const provider = getProvider(event.channelType);
  if (!provider) return;

  try {
    await provider.sendMessage(channel.id, event.customerId, text, {
      tenantId: event.tenantId,
      userId: '',
    });
  } catch (e) {
    console.error(
      `[dispatch] could not deliver Shwari's reply on ${event.channelType}:`,
      e instanceof Error ? e.message : e
    );
  }
}
