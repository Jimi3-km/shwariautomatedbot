import { randomBytes } from 'node:crypto';
import { serviceClient } from '../supabase.js';
import { loadToken, encryptToken, decryptToken } from './meta/tokens.js';
import {
  WhatsAppError, createTextTemplate, getTemplateState, sendWhatsAppMessage, sendWhatsAppTemplateValues,
} from './meta/whatsapp.js';
import { lastInboundAt, windowIsOpen } from '../channels/outbound.js';
import { getMe, sendTelegramMessage } from '../channels/telegram.js';
import { publicApiUrl } from '../config/publicUrl.js';

/**
 * Alerts to the owner's own phone.
 *
 * Every notification already appears in the dashboard bell. This sends the
 * same thing to WhatsApp numbers the owner has chosen and to Telegram, so a
 * payment waiting to be checked is seen even when nobody has the dashboard
 * open. Each kind of alert is worded for what it is about and says what to do.
 *
 * WhatsApp rule that shapes this: a business may only write freely to a number
 * that has messaged it in the last 24 hours. Anything later must be a template
 * WhatsApp has approved. So each kind of alert has its own small template,
 * requested automatically; until that one is approved the general alert
 * template is used instead.
 *
 * Telegram has two routes: the chats linked to Shwari through the business's
 * customer bot, and a separate notification bot the owner can set up, which
 * anyone on the team can join.
 */

export const ALERT_KINDS = [
  'payment_claim', 'new_order', 'needs_human', 'payment_verified',
  'posts_to_approve', 'post_failed', 'post_published',
  'invoice_paid', 'invoice_overdue',
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

/** Everything is on until the owner turns something off. */
export const DEFAULT_ALERT_KINDS: AlertKind[] = [...ALERT_KINDS];

interface Reason {
  emoji: string;
  /** What to do about it, as the last line of the message. */
  action: string;
  /** Where in the dashboard, when the notification names no place itself. */
  link: string;
  template: { name: string; body: string; example: string };
}

/** How each kind of alert reads. One variable: what happened, in a sentence. */
const REASONS: Record<AlertKind, Reason> = {
  payment_claim: {
    emoji: '💳', action: 'Check and verify it', link: '/payments',
    template: {
      name: 'shwari_alert_payment',
      body: 'A payment is waiting to be checked at your business: {{1}}. Open your dashboard to verify it.',
      example: 'Jane says she paid KES 2,500 for ORD-12 (ref QWE123)',
    },
  },
  new_order: {
    emoji: '🛒', action: 'See the order', link: '/orders',
    template: {
      name: 'shwari_alert_order',
      body: 'A new order came in at your business: {{1}}. Open your dashboard to see it.',
      example: 'ORD-12, Jane ordered 2 x Body wave wig, KES 9,000, unpaid',
    },
  },
  needs_human: {
    emoji: '🙋', action: 'Reply in the inbox', link: '/inbox',
    template: {
      name: 'shwari_alert_handoff',
      body: 'A customer is waiting for a person at your business: {{1}}. Open your inbox to reply.',
      example: 'Jane asked to speak to someone about a refund',
    },
  },
  payment_verified: {
    emoji: '✅', action: 'See the payment', link: '/payments',
    template: {
      name: 'shwari_alert_verified',
      body: 'A payment was verified at your business: {{1}}. Open your dashboard to see the receipt.',
      example: 'KES 2,500 from Jane for ORD-12, verified by a team member',
    },
  },
  posts_to_approve: {
    emoji: '📝', action: 'Review and approve', link: '/marketing',
    template: {
      name: 'shwari_alert_posts',
      body: 'Posts are waiting for your approval: {{1}}. Open your dashboard to review them.',
      example: '5 posts planned for the week of 24 November',
    },
  },
  post_failed: {
    emoji: '⚠️', action: 'See what went wrong', link: '/marketing',
    template: {
      name: 'shwari_alert_post_failed',
      body: 'A scheduled post did not go out: {{1}}. Open your dashboard to fix it.',
      example: 'Monday 9:00 post, Instagram refused the photo',
    },
  },
  invoice_paid: {
    emoji: '🧾', action: 'See the invoice', link: '/invoices',
    template: {
      name: 'shwari_alert_invoice_paid',
      body: 'An invoice was paid at your business: {{1}}. Open your dashboard to see it.',
      example: 'Invoice INV-00017, Jane paid KES 16,240.00',
    },
  },
  invoice_overdue: {
    emoji: '⏰', action: 'Follow it up', link: '/invoices',
    template: {
      name: 'shwari_alert_invoice_overdue',
      body: 'An invoice is overdue at your business: {{1}}. Open your dashboard to follow it up.',
      example: 'Invoice INV-00017 for Jane, KES 16,240.00, was due 29 Nov',
    },
  },
  post_published: {
    emoji: '📣', action: 'See the post', link: '/marketing',
    template: {
      name: 'shwari_alert_published',
      body: 'A scheduled post was published: {{1}}. Open your dashboard to see it.',
      example: 'Monday 9:00 post went out on Instagram',
    },
  },
};

/** The general template: used for a test, and while a specific one is in review. */
export const GENERAL_TEMPLATE = {
  name: 'shwari_staff_alert',
  body: 'Update for your business: {{1}}. {{2}} Open your dashboard to respond.',
  examples: ['Payment to check', 'KES 2,500 from Jane for order ORD-12.'],
};

/** An invitation to join the team, sent to a WhatsApp number. */
export const INVITE_TEMPLATE = {
  name: 'shwari_team_invite',
  body: 'You have been invited to join {{1}} as {{2}}. Accept the invitation here: {{3}} The link works for 7 days.',
  examples: ['Glamour Wigs', 'Staff', 'https://example.com/?invite=abc123'],
};

const TEMPLATE_LANGUAGE = 'en';

export interface AlertSettings {
  kinds: AlertKind[];
  telegram: boolean;
}

export interface AlertRecipient {
  id: string;
  channel: 'whatsapp' | 'telegram';
  address: string;
  label: string | null;
  active: boolean;
  last_sent_at: string | null;
  last_error: string | null;
}

export async function getAlertSettings(tenantId: string): Promise<AlertSettings> {
  const { data } = await serviceClient
    .from('tenants').select('alert_kinds, alert_telegram').eq('id', tenantId).maybeSingle();
  const row = data as { alert_kinds?: string[] | null; alert_telegram?: boolean | null } | null;
  const kinds = Array.isArray(row?.alert_kinds)
    ? (row!.alert_kinds!.filter((k) => (ALERT_KINDS as readonly string[]).includes(k)) as AlertKind[])
    : DEFAULT_ALERT_KINDS;
  return { kinds, telegram: row?.alert_telegram !== false };
}

export async function listRecipients(tenantId: string): Promise<AlertRecipient[]> {
  const { data } = await serviceClient
    .from('notification_recipients')
    .select('id, channel, address, label, active, last_sent_at, last_error')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true });
  return (data ?? []) as AlertRecipient[];
}

/**
 * A phone number as WhatsApp wants it: digits only, with the country code.
 * Returns null when it cannot be one.
 */
export function normalisePhone(input: string): string | null {
  const trimmed = String(input ?? '').trim();
  // A leading 0 is a national number: the country cannot be guessed safely.
  if (/^0(?!0)/.test(trimmed.replace(/[\s()-]/g, ''))) return null;
  const digits = trimmed.replace(/^00/, '').replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

// --- WhatsApp templates -----------------------------------------------------

export type TemplateStatus = 'approved' | 'pending' | 'rejected' | 'missing' | 'unknown';

const templateCache = new Map<string, { at: number; status: TemplateStatus }>();
const TEMPLATE_CACHE_MS = 5 * 60_000;

async function wabaIdOf(tenantId: string): Promise<string | null> {
  const { data } = await serviceClient
    .from('meta_tokens').select('whatsapp_business_account_id')
    .eq('tenant_id', tenantId).eq('platform', 'whatsapp').maybeSingle();
  return (data as { whatsapp_business_account_id?: string | null } | null)?.whatsapp_business_account_id ?? null;
}

function toStatus(raw: string | null): TemplateStatus {
  if (!raw) return 'missing';
  const s = raw.toUpperCase();
  if (s === 'APPROVED') return 'approved';
  if (s === 'PENDING' || s === 'IN_APPEAL') return 'pending';
  return 'rejected';
}

/**
 * Where one template stands with WhatsApp, asking for it if it has never been
 * requested. Safe to call often: an approval is remembered briefly.
 */
async function templateStatus(
  tenantId: string,
  template: { name: string; body: string; examples: string[] },
  opts: { create?: boolean; fresh?: boolean } = {}
): Promise<TemplateStatus> {
  const key = `${tenantId}:${template.name}`;
  const hit = templateCache.get(key);
  if (!opts.fresh && hit && Date.now() - hit.at < TEMPLATE_CACHE_MS) return hit.status;

  let status: TemplateStatus = 'unknown';
  try {
    const token = await loadToken(tenantId, 'whatsapp');
    const wabaId = await wabaIdOf(tenantId);
    if (!token || !wabaId) return 'unknown';

    status = toStatus((await getTemplateState(wabaId, token.accessToken, template.name)).status);
    if (status === 'missing' && opts.create) {
      const made = await createTextTemplate(wabaId, token.accessToken, { ...template, language: TEMPLATE_LANGUAGE });
      status = toStatus(made.status ?? 'PENDING');
      console.log(`[alerts] requested WhatsApp template ${template.name} for business ${tenantId}: ${status}`);
    }
  } catch (e) {
    console.warn(`[alerts] could not check WhatsApp template ${template.name}:`, e instanceof Error ? e.message : e);
    status = 'unknown';
  }
  if (status === 'approved') templateCache.set(key, { at: Date.now(), status });
  else templateCache.delete(key);
  return status;
}

/** The general alert template: what Settings reports on. */
export function alertTemplateStatus(tenantId: string, opts: { create?: boolean; fresh?: boolean } = {}) {
  return templateStatus(tenantId, GENERAL_TEMPLATE, opts);
}

/**
 * Ask WhatsApp for every template this business will need. Done once the
 * owner adds a number, so they are approved before the first real alert.
 */
export async function requestAllTemplates(tenantId: string): Promise<void> {
  await templateStatus(tenantId, GENERAL_TEMPLATE, { create: true, fresh: true });
  for (const kind of ALERT_KINDS) {
    const t = REASONS[kind].template;
    await templateStatus(tenantId, { name: t.name, body: t.body, examples: [t.example] }, { create: true, fresh: true });
  }
}

// --- wording ----------------------------------------------------------------

export interface AlertMessage {
  title: string;
  body?: string;
  /** A dashboard path, e.g. /payments. */
  link?: string | null;
}

export interface DeliveryResult {
  channel: 'whatsapp' | 'telegram';
  to: string;
  ok: boolean;
  /** What went wrong, in words the owner can act on. */
  reason?: string;
}

const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
const reasonOf = (kind: string): Reason | null =>
  (ALERT_KINDS as readonly string[]).includes(kind) ? REASONS[kind as AlertKind] : null;

function urlFor(kind: string, m: AlertMessage): string {
  const path = m.link && m.link.startsWith('/') ? m.link : reasonOf(kind)?.link ?? '';
  return `${publicApiUrl()}${path}`;
}

/** The whole alert as a chat message, for WhatsApp (inside 24 hours) and Telegram. */
export function alertText(kind: string, m: AlertMessage, opts: { bold?: boolean } = {}): string {
  const r = reasonOf(kind);
  const title = flat(m.title);
  const head = `${r ? `${r.emoji} ` : ''}${opts.bold ? `*${title}*` : title}`;
  const lines = [head];
  if (m.body && flat(m.body)) lines.push(flat(m.body));
  lines.push('', `${r?.action ?? 'Open your dashboard'}: ${urlFor(kind, m)}`);
  return lines.join('\n');
}

/** One sentence saying what happened, for a template's single variable. */
function sentence(m: AlertMessage): string {
  const body = flat(m.body ?? '').replace(/[.!?]+$/, '');
  const title = flat(m.title).replace(/[.!?]+$/, '');
  return body ? `${title} - ${body}` : title;
}

// --- WhatsApp ---------------------------------------------------------------

async function sendWhatsAppAlert(
  tenantId: string,
  to: string,
  kind: string,
  m: AlertMessage,
  creds: { accessToken: string; phoneNumberId: string }
): Promise<{ ok: boolean; reason?: string }> {
  try {
    if (windowIsOpen(await lastInboundAt(tenantId, 'whatsapp', to))) {
      await sendWhatsAppMessage(creds.accessToken, creds.phoneNumberId, to, alertText(kind, m, { bold: true }));
      return { ok: true };
    }

    // Outside 24 hours: the template for this kind of alert, if approved…
    const r = reasonOf(kind);
    if (r) {
      const specific = await templateStatus(
        tenantId, { name: r.template.name, body: r.template.body, examples: [r.template.example] }, { create: true }
      );
      if (specific === 'approved') {
        await sendWhatsAppTemplateValues(
          creds.accessToken, creds.phoneNumberId, to,
          { name: r.template.name, language: TEMPLATE_LANGUAGE }, [sentence(m)]
        );
        return { ok: true };
      }
    }
    // …otherwise the general one.
    const general = await templateStatus(tenantId, GENERAL_TEMPLATE, { create: true });
    if (general === 'approved') {
      await sendWhatsAppTemplateValues(
        creds.accessToken, creds.phoneNumberId, to,
        { name: GENERAL_TEMPLATE.name, language: TEMPLATE_LANGUAGE },
        [flat(m.title).replace(/[.!?]+$/, ''), flat(m.body ?? '') || 'See your dashboard for details.']
      );
      return { ok: true };
    }
    return {
      ok: false,
      reason: general === 'pending'
        ? 'WhatsApp is still reviewing the alert message. Until it is approved, alerts only reach a number that has messaged your business number in the last 24 hours.'
        : general === 'rejected'
          ? 'WhatsApp did not approve the alert message, so alerts only reach a number that has messaged your business number in the last 24 hours.'
          : 'WhatsApp needs an approved alert message to reach a number that has not written in the last 24 hours.',
    };
  } catch (e) {
    const detail = e instanceof WhatsAppError ? e.message : e instanceof Error ? e.message : String(e);
    console.warn(`[alerts] WhatsApp alert for business ${tenantId} failed: ${detail}`);
    return {
      ok: false,
      reason: /not.*whatsapp|recipient|131026|131030/i.test(detail)
        ? 'WhatsApp could not deliver to this number. Check that it is correct and is on WhatsApp.'
        : 'WhatsApp refused the alert. Try again in a moment.',
    };
  }
}

async function whatsappCreds(tenantId: string): Promise<{ accessToken: string; phoneNumberId: string } | null> {
  const token = await loadToken(tenantId, 'whatsapp');
  if (!token?.phoneNumberId) return null;
  return { accessToken: token.accessToken, phoneNumberId: token.phoneNumberId };
}

async function sendToWhatsApp(tenantId: string, recipients: AlertRecipient[], kind: string, m: AlertMessage): Promise<DeliveryResult[]> {
  const active = recipients.filter((r) => r.channel === 'whatsapp' && r.active);
  if (!active.length) return [];

  const creds = await whatsappCreds(tenantId);
  if (!creds) {
    return active.map((r) => ({ channel: 'whatsapp' as const, to: `+${r.address}`, ok: false, reason: 'WhatsApp is not connected for this business.' }));
  }

  const results: DeliveryResult[] = [];
  for (const r of active) {
    const sent = await sendWhatsAppAlert(tenantId, r.address, kind, m, creds);
    results.push({ channel: 'whatsapp', to: `+${r.address}`, ...sent });
    await serviceClient.from('notification_recipients').update(
      sent.ok ? { last_sent_at: new Date().toISOString(), last_error: null } : { last_error: sent.reason ?? 'Not sent' }
    ).eq('id', r.id);
  }
  return results;
}

/**
 * Send a team invitation to a WhatsApp number from the business's own number.
 * Inside 24 hours it is an ordinary message; otherwise the invitation template.
 */
export async function sendInviteByWhatsApp(
  tenantId: string,
  to: string,
  invite: { business: string; role: string; link: string; invitedBy: string }
): Promise<{ ok: boolean; reason?: string }> {
  const creds = await whatsappCreds(tenantId);
  if (!creds) return { ok: false, reason: 'WhatsApp is not connected for this business.' };
  try {
    if (windowIsOpen(await lastInboundAt(tenantId, 'whatsapp', to))) {
      await sendWhatsAppMessage(
        creds.accessToken, creds.phoneNumberId, to,
        `👋 *You're invited to join ${flat(invite.business)}*\n${flat(invite.invitedBy)} has invited you as ${invite.role}.\n\nAccept here: ${invite.link}\n\nThe link works for 7 days.`
      );
      return { ok: true };
    }
    const status = await templateStatus(tenantId, INVITE_TEMPLATE, { create: true });
    if (status !== 'approved') {
      return {
        ok: false,
        reason: status === 'pending'
          ? 'WhatsApp is still reviewing the invitation message, so it could not be sent yet. Send them the link yourself, or try again later.'
          : 'WhatsApp could not send the invitation to a number that has not messaged your business. Send them the link yourself.',
      };
    }
    await sendWhatsAppTemplateValues(
      creds.accessToken, creds.phoneNumberId, to,
      { name: INVITE_TEMPLATE.name, language: TEMPLATE_LANGUAGE },
      [invite.business, invite.role, invite.link]
    );
    return { ok: true };
  } catch (e) {
    console.warn('[alerts] WhatsApp invitation failed:', e instanceof Error ? e.message : e);
    return { ok: false, reason: 'WhatsApp could not deliver the invitation. Check the number, or send them the link yourself.' };
  }
}

// --- Telegram: the owner's notification bot --------------------------------

export interface NotificationBot {
  username: string | null;
  name: string | null;
}

interface BotRow {
  bot_token_encrypted: string;
  bot_username: string | null;
  bot_name: string | null;
  link_code: string | null;
  link_expires_at: string | null;
  last_update_id: number | null;
}

async function botRow(tenantId: string): Promise<BotRow | null> {
  const { data } = await serviceClient
    .from('notification_bots')
    .select('bot_token_encrypted, bot_username, bot_name, link_code, link_expires_at, last_update_id')
    .eq('tenant_id', tenantId).maybeSingle();
  return (data as BotRow | null) ?? null;
}

export async function getNotificationBot(tenantId: string): Promise<NotificationBot | null> {
  const row = await botRow(tenantId);
  return row ? { username: row.bot_username, name: row.bot_name } : null;
}

export class AlertSetupError extends Error {}

/**
 * Set the bot that sends this business's alerts. The token is checked with
 * Telegram, then stored encrypted; it is never returned to anyone.
 */
export async function setNotificationBot(tenantId: string, token: string, userId: string): Promise<NotificationBot> {
  const trimmed = token.trim();
  if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(trimmed)) {
    throw new AlertSetupError('That does not look like a bot token. Copy the whole token BotFather gave you.');
  }
  // The bot customers talk to already has a job, and Telegram will not let us
  // read its messages a second way.
  const { data: customerBots } = await serviceClient
    .from('channels').select('bot_token').eq('tenant_id', tenantId).eq('channel_type', 'telegram');
  if ((customerBots ?? []).some((c) => (c as { bot_token?: string | null }).bot_token === trimmed)) {
    throw new AlertSetupError(
      'That is the bot your customers talk to. Create a separate bot with @BotFather for alerts.'
    );
  }

  let info;
  try {
    info = await getMe(trimmed);
  } catch {
    throw new AlertSetupError('Telegram did not accept that token. Check it and try again.');
  }

  const { error } = await serviceClient.from('notification_bots').upsert({
    tenant_id: tenantId,
    bot_token_encrypted: encryptToken(trimmed),
    bot_username: info.username ?? null,
    bot_name: (info as { first_name?: string }).first_name ?? null,
    link_code: null, link_expires_at: null, last_update_id: null,
    created_by: userId, updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  // Chats joined through a previous bot cannot be reached by the new one.
  await serviceClient.from('notification_recipients').delete().eq('tenant_id', tenantId).eq('channel', 'telegram');
  return { username: info.username ?? null, name: (info as { first_name?: string }).first_name ?? null };
}

export async function removeNotificationBot(tenantId: string): Promise<void> {
  await serviceClient.from('notification_recipients').delete().eq('tenant_id', tenantId).eq('channel', 'telegram');
  await serviceClient.from('notification_bots').delete().eq('tenant_id', tenantId);
}

/** A link that, opened in Telegram, adds that person's chat to the alerts. */
export async function startTelegramLink(tenantId: string): Promise<{ url: string; code: string }> {
  const row = await botRow(tenantId);
  if (!row?.bot_username) throw new AlertSetupError('Set up the notification bot first.');
  const code = randomBytes(6).toString('hex');
  await serviceClient.from('notification_bots').update({
    link_code: code, link_expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  }).eq('tenant_id', tenantId);
  return { url: `https://t.me/${row.bot_username}?start=${code}`, code };
}

/**
 * Look at who has pressed Start on the bot with the current code, and add
 * their chats. Returns how many were added.
 */
export async function confirmTelegramLink(tenantId: string): Promise<{ added: string[] }> {
  const row = await botRow(tenantId);
  if (!row) throw new AlertSetupError('Set up the notification bot first.');
  if (!row.link_code || !row.link_expires_at || new Date(row.link_expires_at).getTime() < Date.now()) {
    throw new AlertSetupError('That link has expired. Create a new one.');
  }
  const token = decryptToken(row.bot_token_encrypted);

  let updates: Array<{ update_id: number; message?: { text?: string; chat?: { id: number; type?: string; first_name?: string; last_name?: string; username?: string; title?: string } } }> = [];
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...(row.last_update_id ? { offset: Number(row.last_update_id) + 1 } : {}),
        allowed_updates: ['message'], timeout: 0, limit: 100,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: typeof updates };
    if (!res.ok || !json.ok) throw new Error(`HTTP ${res.status}`);
    updates = json.result ?? [];
  } catch {
    throw new AlertSetupError("We couldn't reach Telegram just now. Try again in a moment.");
  }

  const added: string[] = [];
  let last = row.last_update_id ? Number(row.last_update_id) : 0;
  for (const u of updates) {
    last = Math.max(last, u.update_id);
    const text = (u.message?.text ?? '').trim();
    const chat = u.message?.chat;
    if (!chat || text !== `/start ${row.link_code}`) continue;
    const label = [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.title || chat.username || 'Telegram chat';
    const { error } = await serviceClient.from('notification_recipients').upsert(
      { tenant_id: tenantId, channel: 'telegram', address: String(chat.id), label: label.slice(0, 60), active: true },
      { onConflict: 'tenant_id,channel,address' }
    );
    if (!error) {
      added.push(label);
      await sendTelegramMessage(token, String(chat.id), "✅ You're set. Alerts from your business will arrive here.").catch(() => {});
    }
  }
  if (last) await serviceClient.from('notification_bots').update({ last_update_id: last }).eq('tenant_id', tenantId);
  return { added };
}

async function sendToTelegram(tenantId: string, recipients: AlertRecipient[], settings: AlertSettings, kind: string, m: AlertMessage): Promise<DeliveryResult[]> {
  const text = alertText(kind, m);
  const results: DeliveryResult[] = [];

  // 1. The owner's notification bot, to everyone who joined it.
  const joined = recipients.filter((r) => r.channel === 'telegram' && r.active);
  if (joined.length) {
    const row = await botRow(tenantId);
    const token = row ? decryptToken(row.bot_token_encrypted) : null;
    for (const r of joined) {
      const to = r.label ? `${r.label} on Telegram` : 'a Telegram chat';
      let ok = false;
      let reason: string | undefined;
      try {
        if (!token) throw new Error('no bot');
        await sendTelegramMessage(token, r.address, text);
        ok = true;
      } catch (e) {
        console.warn(`[alerts] Telegram alert for business ${tenantId} failed:`, e instanceof Error ? e.message : e);
        reason = token
          ? 'Telegram could not deliver. They may have stopped the bot; ask them to join again.'
          : 'The notification bot is no longer set up.';
      }
      results.push({ channel: 'telegram', to, ok, reason });
      await serviceClient.from('notification_recipients').update(
        ok ? { last_sent_at: new Date().toISOString(), last_error: null } : { last_error: reason ?? 'Not sent' }
      ).eq('id', r.id);
    }
  }

  // 2. The chats linked to Shwari, through the bot customers talk to.
  if (settings.telegram) {
    const [{ data: bots }, { data: links }] = await Promise.all([
      serviceClient.from('channels').select('bot_token')
        .eq('tenant_id', tenantId).eq('channel_type', 'telegram').eq('status', 'active').limit(1),
      serviceClient.from('shwari_admins').select('customer_id')
        .eq('tenant_id', tenantId).eq('channel_type', 'telegram'),
    ]);
    const botToken = (bots?.[0] as { bot_token?: string | null } | undefined)?.bot_token;
    // Someone who joined the notification bot as well gets it once, not twice.
    const already = new Set(joined.map((r) => r.address));
    for (const link of botToken ? links ?? [] : []) {
      if (already.has(String(link.customer_id))) continue;
      try {
        await sendTelegramMessage(botToken!, link.customer_id, text);
        results.push({ channel: 'telegram', to: 'a chat linked to Shwari', ok: true });
      } catch (e) {
        console.warn(`[alerts] Telegram alert for business ${tenantId} failed:`, e instanceof Error ? e.message : e);
        results.push({ channel: 'telegram', to: 'a chat linked to Shwari', ok: false, reason: 'Telegram could not deliver the alert.' });
      }
    }
  }
  return results;
}

/**
 * Send one alert to everyone the owner has chosen. Never throws: an alert
 * that cannot be delivered must not undo the thing it was about.
 */
export async function deliverAlert(
  tenantId: string,
  kind: string,
  message: AlertMessage,
  opts: { force?: boolean } = {}
): Promise<DeliveryResult[]> {
  try {
    const settings = await getAlertSettings(tenantId);
    if (!opts.force && !(settings.kinds as string[]).includes(kind)) return [];

    const recipients = await listRecipients(tenantId);
    const [wa, tg] = await Promise.all([
      sendToWhatsApp(tenantId, recipients, kind, message),
      sendToTelegram(tenantId, recipients, settings, kind, message),
    ]);
    return [...wa, ...tg];
  } catch (e) {
    console.warn('[alerts] delivery failed:', e instanceof Error ? e.message : e);
    return [];
  }
}
