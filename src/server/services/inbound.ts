import { serviceClient } from '../supabase.js';
import type { NormalizedInboundEvent, ParsedEvent } from '../channels/meta/types.js';
import type { ProviderId } from '../channels/providers/types.js';

/**
 * Inbound message handling, shared by every provider.
 *
 * Order matters here:
 *
 *   1. resolve the channel  — tenancy comes from our own row, never the payload
 *   2. claim the event      — a unique insert, so a retry cannot do the work twice
 *   3. persist              — the message reaches the Inbox even if the AI is off
 *   4. forward              — only when the conversation is still AI-handled
 *
 * Persisting before forwarding is deliberate. The previous Telegram pipeline
 * logged the customer's message only after the agent had replied, which meant a
 * conversation with ai_enabled = false recorded nothing at all. Writing here
 * makes the Inbox the source of truth regardless of who answers.
 */

export interface ResolvedChannel {
  id: string;
  tenantId: string;
  channelType: ProviderId;
  secretToken: string | null;
  status: string;
}

/**
 * accountId → channel → tenant.
 *
 * channels has UNIQUE (channel_type, channel_account_id), so this is exact:
 * one WhatsApp number or Instagram account belongs to one tenant.
 */
export async function resolveChannel(
  provider: ProviderId,
  accountId: string
): Promise<ResolvedChannel | null> {
  const { data, error } = await serviceClient
    .from('channels')
    .select('id, tenant_id, channel_type, secret_token, status')
    .eq('channel_type', provider)
    .eq('channel_account_id', accountId)
    .maybeSingle();

  if (error) {
    console.error('[inbound] channel lookup failed:', { code: error.code, message: error.message });
    return null;
  }
  if (!data) return null;

  return {
    id: data.id,
    tenantId: data.tenant_id,
    channelType: data.channel_type as ProviderId,
    secretToken: data.secret_token,
    status: data.status,
  };
}

/**
 * Claim an event id. Returns false when this delivery has already been handled.
 *
 * The unique constraint decides, not a preceding SELECT: two concurrent
 * retries would both pass a read check, and only one can win the insert.
 */
export async function claimEvent(
  provider: ProviderId,
  eventId: string,
  tenantId: string,
  channelId: string
): Promise<boolean> {
  const { error } = await serviceClient
    .from('webhook_events')
    .insert({ provider, event_id: eventId, tenant_id: tenantId, channel_id: channelId });

  if (!error) return true;

  // 23505 = unique_violation: someone already claimed it.
  if (error.code === '23505') return false;

  console.error('[inbound] could not record the event:', { code: error.code, message: error.message });
  // Fail closed: without a claim we cannot promise idempotency, so drop the
  // event rather than risk replying twice. Meta will retry.
  return false;
}

export interface PersistResult {
  conversationId: string;
  aiEnabled: boolean;
}

/**
 * Write the customer's message into the Inbox, creating or updating the
 * conversation and the lead.
 *
 * Note that the conversation is read before it is written rather than upserted.
 * An upsert would reset ai_enabled to its default of true, silently handing a
 * conversation back to the AI after staff had taken it over.
 */
export async function persistInbound(event: NormalizedInboundEvent): Promise<PersistResult | null> {
  const preview = (event.text ?? mediaPlaceholder(event)).slice(0, 160);

  const { data: existing } = await serviceClient
    .from('conversations')
    .select('id, ai_enabled, unread_count, customer_name, lead_id')
    .eq('tenant_id', event.tenantId)
    .eq('channel_type', event.channelType)
    .eq('customer_id', event.customerId)
    .maybeSingle();

  let conversationId: string;
  let aiEnabled: boolean;

  if (existing) {
    conversationId = existing.id;
    aiEnabled = existing.ai_enabled;

    const { error } = await serviceClient
      .from('conversations')
      .update({
        unread_count: (existing.unread_count ?? 0) + 1,
        last_message_at: event.timestamp,
        last_message_preview: preview,
        status: 'open',
        // Only fill a name in; never overwrite one staff may have corrected.
        ...(existing.customer_name || !event.customerName
          ? {}
          : { customer_name: event.customerName }),
      })
      .eq('id', conversationId)
      .eq('tenant_id', event.tenantId);

    if (error) {
      console.error('[inbound] conversation update failed:', { code: error.code, message: error.message });
      return null;
    }
  } else {
    const { data: created, error } = await serviceClient
      .from('conversations')
      .insert({
        tenant_id: event.tenantId,
        channel_id: event.channelId,
        channel_type: event.channelType,
        customer_id: event.customerId,
        customer_name: event.customerName,
        status: 'open',
        unread_count: 1,
        last_message_at: event.timestamp,
        last_message_preview: preview,
      })
      .select('id, ai_enabled')
      .single();

    if (error || !created) {
      console.error('[inbound] conversation insert failed:', { code: error?.code, message: error?.message });
      return null;
    }
    conversationId = created.id;
    aiEnabled = created.ai_enabled;
  }

  const { error: msgErr } = await serviceClient.from('conversation_messages').insert({
    tenant_id: event.tenantId,
    conversation_id: conversationId,
    sender: 'customer',
    body: event.text,
    extracted: {
      provider_message_id: event.messageId,
      ...(event.media ? { media: event.media } : {}),
    },
  });

  if (msgErr) {
    console.error('[inbound] message insert failed:', { code: msgErr.code, message: msgErr.message });
    return null;
  }

  await upsertLead(event, conversationId);

  return { conversationId, aiEnabled };
}

function mediaPlaceholder(event: NormalizedInboundEvent): string {
  if (!event.media) return '';
  const kind = event.media.kind === 'unknown' ? 'attachment' : event.media.kind;
  return `[${kind}]`;
}

/**
 * Lead identity is tenant + channel + customer id, never a phone number on its
 * own — the same customer on two channels is two leads, and two tenants each
 * see only their own.
 */
async function upsertLead(event: NormalizedInboundEvent, conversationId: string): Promise<void> {
  const { data: lead } = await serviceClient
    .from('leads')
    .select('id, customer_name')
    .eq('tenant_id', event.tenantId)
    .eq('channel_type', event.channelType)
    .eq('customer_id', event.customerId)
    .maybeSingle();

  const lastMessage = (event.text ?? mediaPlaceholder(event)).slice(0, 500);

  if (lead) {
    await serviceClient
      .from('leads')
      .update({
        last_message: lastMessage,
        last_contact: event.timestamp,
        updated_at: new Date().toISOString(),
        ...(lead.customer_name || !event.customerName ? {} : { customer_name: event.customerName }),
      })
      .eq('id', lead.id)
      .eq('tenant_id', event.tenantId);
    return;
  }

  const { data: created, error } = await serviceClient
    .from('leads')
    .insert({
      tenant_id: event.tenantId,
      channel_type: event.channelType,
      customer_id: event.customerId,
      customer_name: event.customerName,
      // WhatsApp customer ids are phone numbers; Instagram ids are not, so the
      // phone column is only filled where it actually means one.
      phone: event.channelType === 'whatsapp' ? event.customerId : null,
      stage: 'new',
      last_message: lastMessage,
      last_contact: event.timestamp,
    })
    .select('id')
    .single();

  if (error) {
    // A missing lead is not worth dropping the message for.
    console.warn('[inbound] lead insert failed:', { code: error.code, message: error.message });
    return;
  }

  if (created) {
    await serviceClient
      .from('conversations')
      .update({ lead_id: created.id })
      .eq('id', conversationId)
      .eq('tenant_id', event.tenantId);
  }
}

/**
 * Hand the message to the existing n8n pipeline for the AI turn.
 *
 * The channel's secret token travels in the header exactly as it does for
 * Telegram, so n8n resolves the channel — and therefore the tenant — from its
 * own database read rather than from anything in this body.
 */
export async function forwardToPipeline(
  event: NormalizedInboundEvent,
  secretToken: string | null
): Promise<{ forwarded: boolean; reason?: string }> {
  const url = process.env.N8N_META_WEBHOOK_URL;
  if (!url) {
    console.warn('[inbound] N8N_META_WEBHOOK_URL is not set; message stored but no AI reply will be generated');
    return { forwarded: false, reason: 'pipeline_not_configured' };
  }
  if (!secretToken) {
    console.warn(`[inbound] channel ${event.channelId} has no secret token; cannot authenticate to the pipeline`);
    return { forwarded: false, reason: 'channel_not_provisioned' };
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-channel-secret': secretToken,
      },
      body: JSON.stringify({
        customer_id: event.customerId,
        customer_name: event.customerName,
        message_id: event.messageId,
        text: event.text,
        media: event.media,
        timestamp: event.timestamp,
      }),
    });

    if (!res.ok) {
      console.error(`[inbound] pipeline returned HTTP ${res.status} for channel ${event.channelId}`);
      return { forwarded: false, reason: 'pipeline_error' };
    }
    return { forwarded: true };
  } catch (e) {
    console.error('[inbound] could not reach the pipeline:', e instanceof Error ? e.message : e);
    return { forwarded: false, reason: 'pipeline_unreachable' };
  }
}

/** Turn a parsed provider event into normalized events for one channel. */
export function normalize(
  parsed: ParsedEvent,
  channel: ResolvedChannel
): NormalizedInboundEvent[] {
  return parsed.messages.map((m) => ({
    tenantId: channel.tenantId,
    channelId: channel.id,
    channelType: channel.channelType,
    customerId: m.customerId,
    customerName: m.customerName,
    messageId: m.messageId,
    text: m.text,
    media: m.media,
    timestamp: m.timestamp,
  }));
}
