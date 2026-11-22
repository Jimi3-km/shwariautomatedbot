import { serviceClient } from '../supabase.js';
import { loadToken } from './meta/tokens.js';
import {
  WhatsAppError, createTextTemplate, getTemplateState, sendWhatsAppMessage, sendWhatsAppTemplateValues,
} from './meta/whatsapp.js';
import { lastInboundAt, windowIsOpen } from '../channels/outbound.js';
import { sendTelegramMessage } from '../channels/telegram.js';
import { publicApiUrl } from '../config/publicUrl.js';

/**
 * Alerts to the owner's own phone.
 *
 * Every notification already appears in the dashboard bell. This sends the
 * same thing to WhatsApp numbers the owner has chosen and, if switched on, to
 * the Telegram chats linked to Shwari, so a payment waiting to be checked is
 * seen even when nobody has the dashboard open.
 *
 * WhatsApp rule that shapes this: a business may only write freely to a number
 * that has messaged it in the last 24 hours. Anything later must be a template
 * WhatsApp has approved. So each business gets one small alert template,
 * requested automatically, and it is used whenever the 24 hours have passed.
 */

export const ALERT_KINDS = [
  'payment_claim', 'new_order', 'needs_human', 'payment_verified',
  'posts_to_approve', 'post_failed', 'post_published',
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export const DEFAULT_ALERT_KINDS: AlertKind[] = ['payment_claim', 'new_order', 'needs_human'];

export const ALERT_TEMPLATE = {
  name: 'shwari_staff_alert',
  language: 'en',
  body: 'Update for your business: {{1}}. {{2}} Open your dashboard to respond.',
  examples: ['Payment to check', 'KES 2,500 from Jane for order ORD-12.'],
};

export interface AlertSettings {
  kinds: AlertKind[];
  telegram: boolean;
}

export interface AlertRecipient {
  id: string;
  channel: 'whatsapp';
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

// --- the WhatsApp alert template ------------------------------------------

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
 * Where the alert template stands with WhatsApp, asking for it if it has
 * never been requested. Safe to call often: the answer is remembered briefly.
 */
export async function alertTemplateStatus(tenantId: string, opts: { create?: boolean; fresh?: boolean } = {}): Promise<TemplateStatus> {
  const hit = templateCache.get(tenantId);
  if (!opts.fresh && hit && Date.now() - hit.at < TEMPLATE_CACHE_MS) return hit.status;

  let status: TemplateStatus = 'unknown';
  try {
    const token = await loadToken(tenantId, 'whatsapp');
    const wabaId = await wabaIdOf(tenantId);
    if (!token || !wabaId) return 'unknown';

    status = toStatus((await getTemplateState(wabaId, token.accessToken, ALERT_TEMPLATE.name)).status);
    if (status === 'missing' && opts.create) {
      const made = await createTextTemplate(wabaId, token.accessToken, ALERT_TEMPLATE);
      status = toStatus(made.status ?? 'PENDING');
      console.log(`[alerts] requested the WhatsApp alert template for business ${tenantId}: ${status}`);
    }
  } catch (e) {
    console.warn('[alerts] could not check the WhatsApp alert template:', e instanceof Error ? e.message : e);
    status = 'unknown';
  }
  // An approval can arrive at any moment, so only a settled answer is kept long.
  if (status === 'approved') templateCache.set(tenantId, { at: Date.now(), status });
  else templateCache.delete(tenantId);
  return status;
}

// --- sending ---------------------------------------------------------------

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

function fullText(m: AlertMessage): string {
  const lines = [`*${flat(m.title)}*`];
  if (m.body && flat(m.body)) lines.push(flat(m.body));
  lines.push(`${publicApiUrl()}${m.link && m.link.startsWith('/') ? m.link : ''}`);
  return lines.join('\n');
}

async function sendToWhatsApp(tenantId: string, recipients: AlertRecipient[], m: AlertMessage): Promise<DeliveryResult[]> {
  const active = recipients.filter((r) => r.channel === 'whatsapp' && r.active);
  if (!active.length) return [];

  const token = await loadToken(tenantId, 'whatsapp');
  if (!token?.phoneNumberId) {
    return active.map((r) => ({ channel: 'whatsapp' as const, to: r.address, ok: false, reason: 'WhatsApp is not connected for this business.' }));
  }
  const phoneNumberId = token.phoneNumberId;

  const results: DeliveryResult[] = [];
  for (const r of active) {
    let result: DeliveryResult = { channel: 'whatsapp', to: r.address, ok: false };
    try {
      const open = windowIsOpen(await lastInboundAt(tenantId, 'whatsapp', r.address));
      if (open) {
        await sendWhatsAppMessage(token.accessToken, phoneNumberId, r.address, fullText(m));
        result.ok = true;
      } else {
        const status = await alertTemplateStatus(tenantId, { create: true });
        if (status === 'approved') {
          await sendWhatsAppTemplateValues(
            token.accessToken, phoneNumberId, r.address,
            { name: ALERT_TEMPLATE.name, language: ALERT_TEMPLATE.language },
            [flat(m.title).replace(/[.!?]+$/, ''), flat(m.body ?? '') || 'See your dashboard for details.']
          );
          result.ok = true;
        } else {
          result.reason = status === 'pending'
            ? 'WhatsApp is still reviewing the alert message. Until it is approved, alerts only reach a number that has messaged your business number in the last 24 hours.'
            : status === 'rejected'
              ? 'WhatsApp did not approve the alert message, so alerts only reach a number that has messaged your business number in the last 24 hours.'
              : 'The alert could not be sent because WhatsApp needs an approved alert message for numbers that have not written in the last 24 hours.';
        }
      }
    } catch (e) {
      const detail = e instanceof WhatsAppError ? `${e.message}` : e instanceof Error ? e.message : String(e);
      console.warn(`[alerts] WhatsApp alert to a recipient of business ${tenantId} failed: ${detail}`);
      result.reason = /not.*whatsapp|recipient|131026|131030/i.test(detail)
        ? 'WhatsApp could not deliver to this number. Check that it is correct and is on WhatsApp.'
        : 'WhatsApp refused the alert. Try the test again in a moment.';
    }
    results.push(result);
    await serviceClient.from('notification_recipients').update(
      result.ok ? { last_sent_at: new Date().toISOString(), last_error: null } : { last_error: result.reason ?? 'Not sent' }
    ).eq('id', r.id);
  }
  return results;
}

/** The Telegram chats linked to Shwari, through the business's own bot. */
async function sendToTelegram(tenantId: string, m: AlertMessage): Promise<DeliveryResult[]> {
  const [{ data: bots }, { data: links }] = await Promise.all([
    serviceClient.from('channels').select('bot_token')
      .eq('tenant_id', tenantId).eq('channel_type', 'telegram').eq('status', 'active').limit(1),
    serviceClient.from('shwari_admins').select('customer_id')
      .eq('tenant_id', tenantId).eq('channel_type', 'telegram'),
  ]);
  const botToken = (bots?.[0] as { bot_token?: string | null } | undefined)?.bot_token;
  if (!botToken || !links?.length) return [];

  const text = fullText(m).replace(/^\*(.*)\*$/m, '$1');
  const results: DeliveryResult[] = [];
  for (const link of links) {
    try {
      await sendTelegramMessage(botToken, link.customer_id, text);
      results.push({ channel: 'telegram', to: 'a linked Telegram chat', ok: true });
    } catch (e) {
      console.warn(`[alerts] Telegram alert for business ${tenantId} failed:`, e instanceof Error ? e.message : e);
      results.push({ channel: 'telegram', to: 'a linked Telegram chat', ok: false, reason: 'Telegram could not deliver the alert.' });
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
      sendToWhatsApp(tenantId, recipients, message),
      settings.telegram ? sendToTelegram(tenantId, message) : Promise.resolve([] as DeliveryResult[]),
    ]);
    return [...wa, ...tg];
  } catch (e) {
    console.warn('[alerts] delivery failed:', e instanceof Error ? e.message : e);
    return [];
  }
}
