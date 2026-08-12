import type { InboundMedia, ParsedEvent, ParsedMessage } from './types.js';

/**
 * Provider payload → ParsedEvent. All the shape-specific knowledge lives here
 * and nowhere else.
 *
 * Every field is treated as untrusted: a webhook body is public input. Nothing
 * is asserted to exist, and anything unexpected yields zero messages rather
 * than an exception, so one malformed delivery cannot stop the endpoint.
 */

type Json = Record<string, unknown>;

const asObject = (v: unknown): Json | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null;

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const asString = (v: unknown): string | null =>
  typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : null;

/** Meta sends unix seconds as a string on WhatsApp and as ms on Instagram. */
function toIso(value: unknown, unit: 'seconds' | 'milliseconds'): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return new Date().toISOString();
  const ms = unit === 'seconds' ? n * 1000 : n;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

// ---------------------------------------------------------------------------
// WhatsApp Cloud API
// ---------------------------------------------------------------------------

const WHATSAPP_MEDIA_KINDS = ['image', 'video', 'audio', 'document', 'sticker'] as const;

function whatsappMedia(message: Json): InboundMedia | null {
  for (const kind of WHATSAPP_MEDIA_KINDS) {
    const node = asObject(message[kind]);
    if (!node) continue;
    return {
      kind,
      mediaId: asString(node.id),
      mimeType: asString(node.mime_type),
      caption: asString(node.caption),
    };
  }
  return null;
}

/**
 * WhatsApp text arrives as text.body. Interactive replies (button/list) carry
 * the user's choice instead, which is what they actually "said", so it is
 * read as the message text rather than discarded.
 */
function whatsappText(message: Json): string | null {
  const text = asObject(message.text);
  if (text) return asString(text.body);

  const interactive = asObject(message.interactive);
  if (interactive) {
    const buttonReply = asObject(interactive.button_reply);
    if (buttonReply) return asString(buttonReply.title) ?? asString(buttonReply.id);
    const listReply = asObject(interactive.list_reply);
    if (listReply) return asString(listReply.title) ?? asString(listReply.id);
  }

  const button = asObject(message.button);
  if (button) return asString(button.text);

  return null;
}

export function parseWhatsApp(body: unknown): ParsedEvent[] {
  const root = asObject(body);
  if (!root || root.object !== 'whatsapp_business_account') return [];

  const events: ParsedEvent[] = [];

  for (const entryRaw of asArray(root.entry)) {
    const entry = asObject(entryRaw);
    if (!entry) continue;

    for (const changeRaw of asArray(entry.changes)) {
      const change = asObject(changeRaw);
      if (!change || change.field !== 'messages') continue;

      const value = asObject(change.value);
      if (!value) continue;

      // The channel is identified by the phone number the customer wrote to,
      // which is what we stored as channel_account_id at connect time.
      const metadata = asObject(value.metadata);
      const accountId = asString(metadata?.phone_number_id);
      if (!accountId) continue;

      // Names live in a separate contacts array, keyed by wa_id.
      const names = new Map<string, string>();
      for (const contactRaw of asArray(value.contacts)) {
        const contact = asObject(contactRaw);
        const waId = asString(contact?.wa_id);
        const name = asString(asObject(contact?.profile)?.name);
        if (waId && name) names.set(waId, name);
      }

      const messages: ParsedMessage[] = [];
      for (const messageRaw of asArray(value.messages)) {
        const message = asObject(messageRaw);
        if (!message) continue;

        const messageId = asString(message.id);
        const customerId = asString(message.from);
        if (!messageId || !customerId) continue;

        const media = whatsappMedia(message);
        const text = whatsappText(message) ?? media?.caption ?? null;

        // A message with neither text nor media carries nothing to act on.
        if (!text && !media) continue;

        messages.push({
          customerId,
          customerName: names.get(customerId) ?? null,
          messageId,
          text,
          media,
          timestamp: toIso(message.timestamp, 'seconds'),
        });
      }

      // `statuses` deliveries (sent/delivered/read receipts) legitimately
      // produce no messages; they are acked and ignored.
      if (messages.length) events.push({ accountId, messages });
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// Instagram messaging
// ---------------------------------------------------------------------------

function instagramMedia(message: Json): InboundMedia | null {
  const attachments = asArray(message.attachments);
  for (const attachmentRaw of attachments) {
    const attachment = asObject(attachmentRaw);
    if (!attachment) continue;
    const type = asString(attachment.type) ?? 'unknown';
    const payload = asObject(attachment.payload);
    const kind = (['image', 'video', 'audio', 'share', 'story_mention'].includes(type)
      ? type === 'image' || type === 'video' || type === 'audio' ? type : 'unknown'
      : 'unknown') as InboundMedia['kind'];
    return {
      kind,
      // Instagram gives a URL rather than a media id for most attachments.
      mediaId: asString(payload?.url) ?? asString(payload?.id),
      mimeType: null,
      caption: null,
    };
  }
  return null;
}

export function parseInstagram(body: unknown): ParsedEvent[] {
  const root = asObject(body);
  if (!root || root.object !== 'instagram') return [];

  const events: ParsedEvent[] = [];

  for (const entryRaw of asArray(root.entry)) {
    const entry = asObject(entryRaw);
    if (!entry) continue;

    // entry.id is the business's Instagram account id — the value stored as
    // channel_account_id when the account was connected.
    const accountId = asString(entry.id);
    if (!accountId) continue;

    const messages: ParsedMessage[] = [];

    for (const eventRaw of asArray(entry.messaging)) {
      const event = asObject(eventRaw);
      if (!event) continue;

      const sender = asObject(event.sender);
      const customerId = asString(sender?.id);
      if (!customerId) continue;

      // Our own outbound messages echo back on this webhook. Dropping them
      // here stops the agent replying to itself.
      if (customerId === accountId) continue;

      const message = asObject(event.message);
      if (!message) continue;

      // Deleted messages and read receipts carry no content.
      if (message.is_deleted === true || message.is_echo === true) continue;

      const messageId = asString(message.mid);
      if (!messageId) continue;

      const media = instagramMedia(message);
      const text = asString(message.text);
      if (!text && !media) continue;

      messages.push({
        customerId,
        // Instagram does not include the username in the message event; it is
        // filled in later from the profile if we need it.
        customerName: null,
        messageId,
        text,
        media,
        timestamp: toIso(event.timestamp, 'milliseconds'),
      });
    }

    if (messages.length) events.push({ accountId, messages });
  }

  return events;
}

/** Dispatch on the payload's own `object` field. */
export function parseMetaWebhook(body: unknown): {
  provider: 'whatsapp' | 'instagram' | null;
  events: ParsedEvent[];
} {
  const object = asObject(body)?.object;
  if (object === 'whatsapp_business_account') return { provider: 'whatsapp', events: parseWhatsApp(body) };
  if (object === 'instagram') return { provider: 'instagram', events: parseInstagram(body) };
  return { provider: null, events: [] };
}
