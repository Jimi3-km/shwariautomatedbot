import type { ProviderId } from '../providers/types.js';

/**
 * One inbound message, in the shape the rest of the system uses.
 *
 * Provider payloads differ enough that nothing downstream should ever see
 * them: WhatsApp nests messages under entry[].changes[].value.messages[] and
 * identifies the customer by phone number, Instagram uses entry[].messaging[]
 * and identifies by a scoped account id. Both collapse to this.
 */
export interface NormalizedInboundEvent {
  tenantId: string;
  channelId: string;
  channelType: ProviderId;
  /** The provider's id for the customer, unique within this channel. */
  customerId: string;
  customerName: string | null;
  /** The provider's id for this message. Used for idempotency. */
  messageId: string;
  text: string | null;
  media: InboundMedia | null;
  /** ISO-8601. */
  timestamp: string;
}

export interface InboundMedia {
  kind: 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'unknown';
  /** The provider's media id. Fetching the bytes needs an authenticated call. */
  mediaId: string | null;
  mimeType: string | null;
  caption: string | null;
}

/**
 * What a parser produces: zero or more messages, plus the account the event
 * was addressed to. Tenancy is resolved from that account, never from the
 * payload — a webhook body is attacker-controlled input.
 */
export interface ParsedEvent {
  /** The provider's id for the business account this was sent to. */
  accountId: string;
  messages: ParsedMessage[];
}

export interface ParsedMessage {
  customerId: string;
  customerName: string | null;
  messageId: string;
  text: string | null;
  media: InboundMedia | null;
  timestamp: string;
}
