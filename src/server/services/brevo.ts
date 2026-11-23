import { serviceClient } from '../supabase.js';
/**
 * Brevo (formerly Sendinblue) Email Service.
 *
 * Handles:
 * 1. Transactional emails:
 *    - Appointment confirmations & reminders
 *    - Order receipts & payment claim acknowledgements
 * 2. Inbound customer email replies from AI agents
 *
 * Uses the Brevo v3 REST API (https://api.brevo.com/v3/smtp/email) with zero
 * extra dependencies, making it lightweight and fully compatible with Vercel serverless.
 */

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

/**
 * Everything interpolated into an HTML email body goes through this. Customer
 * names, notes, product names and the model's own reply are all text someone
 * else chose; unescaped, any of them could inject markup or a phishing link
 * into mail sent under the business's name.
 */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Header values must be a single line; a stray CR/LF would inject a header. */
function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim().slice(0, 500);
}

export interface EmailRecipient {
  email: string;
  name?: string;
}

export interface SendEmailOptions {
  to: EmailRecipient[];
  subject: string;
  htmlContent: string;
  textContent?: string;
  sender?: EmailRecipient;
  replyTo?: EmailRecipient;
  headers?: Record<string, string>;
  tags?: string[];
  /** The business this email is for, so the attempt is kept against it. */
  tenantId?: string | null;
  /** The name shown as the sender, usually the business's. The address stays the platform's. */
  senderName?: string;
  /** Files the email service fetches and attaches, by public address. */
  attachments?: Array<{ url: string; name: string }>;
}

export interface BrevoSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export function isBrevoConfigured(): boolean {
  return Boolean(process.env.BREVO_API_KEY);
}

export function getBrevoSender(): EmailRecipient {
  return {
    name: process.env.BREVO_SENDER_NAME || 'shwari agent',
    email: process.env.BREVO_SENDER_EMAIL || process.env.BREVO_SMTP_LOGIN || 'noreply@shwari.ai',
  };
}

/** Mailbox providers that reject mail sent in their name by another service. */
const FREE_MAILBOX = /@(gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|aol|icloud|me|proton|protonmail|gmx|zoho)\./i;

let resolvedSender: { at: number; value: EmailRecipient } | null = null;
const SENDER_CACHE_MS = 10 * 60_000;

/**
 * The address email is actually sent from.
 *
 * Brevo refuses any message whose sender is not one it has confirmed, and it
 * does so after accepting the request, so the failure is silent. The address
 * configured on the server was the SMTP login (something@smtp-brevo.com),
 * which is never a valid sender, and every receipt was dropped.
 *
 * So the configured address is checked against the account's confirmed
 * senders. If it is not one of them, a confirmed sender is used instead,
 * preferring an address at an authenticated domain over a free mailbox.
 */
export async function resolveSender(): Promise<EmailRecipient> {
  if (resolvedSender && Date.now() - resolvedSender.at < SENDER_CACHE_MS) return resolvedSender.value;

  const configured = getBrevoSender();
  let value = configured;
  try {
    const [senders, domains] = await Promise.all([brevoGet('/senders'), brevoGet('/senders/domains')]);
    const list: Array<{ email?: string; name?: string; active?: boolean }> =
      Array.isArray(senders.body?.senders) ? senders.body.senders : [];
    const active = list.filter((s) => s?.active && typeof s.email === 'string');
    if (senders.ok && active.length) {
      const isConfirmed = active.some((s) => s.email!.toLowerCase() === configured.email.toLowerCase());
      if (!isConfirmed) {
        const authed = new Set(
          (Array.isArray(domains.body?.domains) ? domains.body.domains : [])
            .filter((d: any) => d?.authenticated)
            .map((d: any) => String(d.domain_name).toLowerCase())
        );
        const domainOf = (e: string) => e.split('@')[1]?.toLowerCase() ?? '';
        const best =
          active.find((s) => authed.has(domainOf(s.email!))) ??
          active.find((s) => !FREE_MAILBOX.test(s.email!)) ??
          active[0];
        console.warn(
          `[brevo] the configured sender ${configured.email} is not confirmed in Brevo; sending from ${best.email} instead. ` +
            'Set BREVO_SENDER_EMAIL to a confirmed sender to choose it.'
        );
        value = { name: configured.name, email: best.email! };
      }
    }
  } catch { /* keep the configured sender; the send will report the failure */ }

  resolvedSender = { at: Date.now(), value };
  return value;
}

/**
 * Generic email dispatcher via Brevo API v3.
 */
export async function sendBrevoEmail(options: SendEmailOptions): Promise<BrevoSendResult> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.warn('[brevo] BREVO_API_KEY is not configured; skipping email dispatch.');
    return { success: false, error: 'BREVO_API_KEY not configured' };
  }

  const base = options.sender || (await resolveSender());
  // The customer should see who the email is from: the business, not the platform.
  const sender = options.senderName
    ? { ...base, name: options.senderName.replace(/[\r\n<>"]+/g, ' ').trim().slice(0, 70) || base.name }
    : base;

  const payload: Record<string, unknown> = {
    sender,
    to: options.to,
    subject: options.subject,
    htmlContent: options.htmlContent,
  };

  if (options.textContent) payload.textContent = options.textContent;
  if (options.replyTo) payload.replyTo = options.replyTo;
  if (options.headers) payload.headers = options.headers;
  if (options.tags && options.tags.length) payload.tags = options.tags;
  if (options.attachments && options.attachments.length) payload.attachment = options.attachments;

  const kind = options.tags?.[0] ?? 'email';
  const recipient = options.to.map((t) => t.email).join(', ');

  try {
    const res = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });

    const body = (await res.json().catch(() => ({}))) as { messageId?: string; message?: string; code?: string };

    if (!res.ok) {
      const error = body.message || body.code || `HTTP ${res.status}`;
      console.error('[brevo] send error:', res.status, error);
      await logEmail({ tenantId: options.tenantId, kind, recipient, subject: options.subject, ok: false, error });
      return { success: false, error };
    }

    await logEmail({ tenantId: options.tenantId, kind, recipient, subject: options.subject, ok: true, messageId: body.messageId });
    return {
      success: true,
      messageId: body.messageId,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[brevo] network exception:', msg);
    await logEmail({ tenantId: options.tenantId, kind, recipient, subject: options.subject, ok: false, error: msg });
    return { success: false, error: msg };
  }
}

/**
 * Keep a record of the attempt. "Accepted" here means the email service took
 * the message, not that it reached the inbox; the message id lets it be traced
 * in the service's own log. Never throws.
 */
async function logEmail(row: {
  tenantId?: string | null; kind: string; recipient: string; subject?: string;
  ok: boolean; messageId?: string; error?: string;
}): Promise<void> {
  try {
    await serviceClient.from('email_log').insert({
      tenant_id: row.tenantId ?? null,
      kind: row.kind.slice(0, 60),
      recipient: row.recipient.slice(0, 320),
      subject: (row.subject ?? '').slice(0, 200) || null,
      ok: row.ok,
      message_id: row.messageId ?? null,
      error: row.error ? row.error.slice(0, 500) : null,
    });
  } catch { /* the log is a convenience; it must not affect the send */ }
}

// ---------------------------------------------------------------------------
// Diagnosis: why is email not arriving?
// ---------------------------------------------------------------------------

export interface EmailCheck {
  id: string;
  label: string;
  /** true = fine, false = needs fixing, null = could not be checked. */
  ok: boolean | null;
  detail: string;
  fix?: string;
}

const FREE_MAILBOXES = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'ymail.com', 'outlook.com', 'hotmail.com',
  'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'gmx.com', 'zoho.com',
]);

async function brevoGet(path: string): Promise<{ ok: boolean; status: number; body: any }> {
  try {
    const res = await fetch(`https://api.brevo.com/v3${path}`, {
      headers: { 'api-key': process.env.BREVO_API_KEY ?? '', Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

/**
 * Ask the email service about this account, its sender and what happened to
 * recent messages, and say in plain words what is stopping email arriving.
 * Reports whether things are set and valid; never a key.
 */
export async function runEmailDiagnostics(): Promise<{
  checks: EmailCheck[];
  sender: { name: string; email: string };
  recent: Array<{ at: string; kind: string; recipient: string; ok: boolean; error: string | null }>;
  events: Array<{ at: string; event: string; to: string; reason: string | null; subject: string | null }>;
}> {
  const checks: EmailCheck[] = [];
  const configured = getBrevoSender();
  resolvedSender = null; // always a fresh look when someone is diagnosing
  const sender = process.env.BREVO_API_KEY ? await resolveSender() : configured;
  const senderDomain = sender.email.split('@')[1]?.toLowerCase() ?? '';
  if (sender.email.toLowerCase() !== configured.email.toLowerCase()) {
    checks.push({
      id: 'sender_config', label: 'The sending address set on the server is valid', ok: false,
      detail: `BREVO_SENDER_EMAIL is ${configured.email}, which Brevo has not confirmed as a sender${/smtp-brevo\.com$/i.test(configured.email) ? ' (it is the SMTP login, not an email address you can send from)' : ''}. Until now every email was dropped for this reason. The platform is now sending from ${sender.email}, a sender Brevo has confirmed.`,
      fix: `To choose the address yourself, set BREVO_SENDER_EMAIL on the server to a sender confirmed in Brevo (Senders, Domains & Dedicated IPs > Senders) and redeploy.`,
    });
  }

  // --- the key ---------------------------------------------------------------
  if (!process.env.BREVO_API_KEY) {
    checks.push({
      id: 'key', label: 'The email service key is set', ok: false,
      detail: 'BREVO_API_KEY is not set on the server, so no email is attempted at all.',
      fix: 'In Brevo open SMTP & API > API Keys, create a key, and set it as BREVO_API_KEY on the server. Then redeploy.',
    });
  } else {
    const account = await brevoGet('/account');
    const keyLooksSmtp = (process.env.BREVO_API_KEY ?? '').startsWith('xsmtpsib-');
    checks.push({
      id: 'key', label: 'The email service accepts the key', ok: account.ok,
      detail: account.ok
        ? `Signed in to the Brevo account of ${String(account.body?.companyName || account.body?.email || 'your company')}.`
        : keyLooksSmtp
          ? 'BREVO_API_KEY holds an SMTP key (it starts with "xsmtpsib-"). The platform sends through the Brevo API, which needs an API key (it starts with "xkeysib-").'
          : account.status === 401
            ? 'Brevo rejected the key (401). It was deleted, mistyped, or belongs to another account.'
            : `Brevo did not answer (${account.status || 'no response'}).`,
      ...(account.ok ? {} : { fix: 'In Brevo open SMTP & API > API Keys, create a new API key (not an SMTP key), set it as BREVO_API_KEY on the server and redeploy.' }),
    });

    if (account.ok) {
      const plans: any[] = Array.isArray(account.body?.plan) ? account.body.plan : [];
      const sendPlan = plans.find((p) => /send|free|subscription|payAsYouGo/i.test(String(p?.type)) && p?.creditsType === 'sendLimit') ?? plans[0];
      const credits = typeof sendPlan?.credits === 'number' ? sendPlan.credits : null;
      checks.push({
        id: 'credits', label: 'There are emails left to send', ok: credits === null ? null : credits > 0,
        detail: credits === null ? 'The remaining allowance could not be read.'
          : credits > 0 ? `${credits.toLocaleString('en-US')} emails left on the ${String(sendPlan?.type ?? 'current')} plan.`
          : 'The sending allowance is used up, so Brevo refuses every email until it resets or the plan is upgraded.',
        ...(credits === 0 ? { fix: 'Upgrade the Brevo plan or wait for the daily allowance to reset.' } : {}),
      });

      // --- the sender ----------------------------------------------------------
      const senders = await brevoGet('/senders');
      const list: any[] = Array.isArray(senders.body?.senders) ? senders.body.senders : [];
      const match = list.find((s) => String(s?.email).toLowerCase() === sender.email.toLowerCase());
      checks.push({
        id: 'sender', label: `The sending address (${sender.email}) is registered in Brevo`,
        ok: senders.ok ? Boolean(match?.active) : null,
        detail: !senders.ok ? 'The list of senders could not be read.'
          : !match ? `${sender.email} is not a sender on this Brevo account. Brevo ${list.length ? `knows ${list.map((s) => s.email).slice(0, 4).join(', ')}` : 'has no senders at all'}. Mail from an unknown sender is refused or rewritten.`
          : !match.active ? `${sender.email} is on the account but has not been confirmed, so Brevo will not send from it.`
          : 'Registered and confirmed.',
        ...(senders.ok && !match?.active ? {
          fix: 'In Brevo open Senders, Domains & Dedicated IPs > Senders, add this address and confirm it from the email Brevo sends. Or set BREVO_SENDER_EMAIL to an address that is already confirmed there.',
        } : {}),
      });

      // --- the domain ----------------------------------------------------------
      if (FREE_MAILBOXES.has(senderDomain)) {
        checks.push({
          id: 'domain', label: 'The sending address is at your own domain', ok: false,
          detail: `${sender.email} is a ${senderDomain} mailbox. Gmail, Yahoo and Outlook reject or spam-folder mail that claims to be from ${senderDomain} but was sent by another service, which is exactly what a receipt sent through Brevo is. This is the most common reason emails are "sent" and never arrive.`,
          fix: 'Use an address at a domain you own (for example receipts@yourdomain.com): add the domain in Brevo under Senders, Domains & Dedicated IPs > Domains, add the DNS records Brevo shows, then set BREVO_SENDER_EMAIL to that address and redeploy.',
        });
      } else {
        const domains = await brevoGet('/senders/domains');
        const dlist: any[] = Array.isArray(domains.body?.domains) ? domains.body.domains : [];
        const d = dlist.find((x) => String(x?.domain_name).toLowerCase() === senderDomain);
        const authed = Boolean(d?.authenticated);
        checks.push({
          id: 'domain', label: `The domain ${senderDomain} is authenticated`,
          ok: domains.ok ? authed : null,
          detail: !domains.ok ? 'The list of domains could not be read.'
            : !d ? `${senderDomain} has not been added to Brevo. Without its DKIM and DMARC records, most mailboxes spam-folder or reject the mail.`
            : !authed ? `${senderDomain} is added but its DNS records are not all in place yet${d?.verified ? '' : ', and it is not verified'}.`
            : 'Authenticated: mail is signed for your domain.',
          ...(domains.ok && !authed ? {
            fix: `In Brevo open Senders, Domains & Dedicated IPs > Domains, add ${senderDomain}, then add the DKIM, DMARC and Brevo-code DNS records it shows at your domain's DNS provider and press Authenticate.`,
          } : {}),
        });
      }
    }
  }

  // --- what happened to recent messages ---------------------------------------
  const events: Array<{ at: string; event: string; to: string; reason: string | null; subject: string | null }> = [];
  if (process.env.BREVO_API_KEY) {
    const ev = await brevoGet('/smtp/statistics/events?limit=50&days=14&sort=desc');
    const rows: any[] = Array.isArray(ev.body?.events) ? ev.body.events : [];
    for (const e of rows) {
      events.push({
        at: String(e?.date ?? ''), event: String(e?.event ?? ''), to: String(e?.email ?? ''),
        reason: e?.reason ? String(e.reason).slice(0, 200) : null, subject: e?.subject ? String(e.subject).slice(0, 120) : null,
      });
    }
    if (ev.ok) {
      const bad = events.filter((e) => /bounce|blocked|invalid|spam|error|deferred/i.test(e.event));
      const delivered = events.filter((e) => /^delivered$/i.test(e.event)).length;
      checks.push({
        id: 'delivery', label: 'Recent emails are being delivered',
        ok: events.length === 0 ? null : bad.length === 0 ? true : delivered > 0 ? null : false,
        detail: events.length === 0 ? 'Brevo has no record of any email from this account in the last 14 days.'
          : `In the last 14 days: ${delivered} delivered, ${bad.length} bounced, blocked or deferred.` +
            (bad[0] ? ` Latest problem: ${bad[0].event}${bad[0].reason ? ` - ${bad[0].reason}` : ''}.` : ''),
      });
    }
  }

  let recent: Array<{ at: string; kind: string; recipient: string; ok: boolean; error: string | null }> = [];
  try {
    const { data } = await serviceClient
      .from('email_log').select('created_at, kind, recipient, ok, error')
      .order('created_at', { ascending: false }).limit(20);
    recent = (data ?? []).map((r: any) => ({ at: r.created_at, kind: r.kind, recipient: r.recipient, ok: r.ok, error: r.error }));
  } catch { /* table not there yet */ }

  return { checks, sender: { name: sender.name ?? '', email: sender.email }, recent, events: events.slice(0, 20) };
}

/**
 * Send an appointment booking confirmation to the customer.
 */
export async function sendAppointmentConfirmation(opts: {
  customerEmail: string;
  customerName?: string;
  serviceName: string;
  startsAt: string;
  durationMinutes: number;
  businessName?: string;
  notes?: string;
  tenantId?: string | null;
}): Promise<BrevoSendResult> {
  const bName = opts.businessName || 'Shwari Services';
  const cName = opts.customerName || 'Valued Customer';
  
  let formattedDate = opts.startsAt;
  try {
    const d = new Date(opts.startsAt);
    formattedDate = d.toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  } catch {
    // Keep raw startsAt on format error
  }

  const subject = `Confirmed: ${opts.serviceName} with ${bName}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f9fafb; margin: 0; padding: 24px; color: #111827; }
    .card { max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e5e7eb; overflow: hidden; }
    .header { background: #0f172a; color: #ffffff; padding: 24px 32px; }
    .header h1 { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -0.01em; }
    .body { padding: 32px; }
    .badge { display: inline-block; padding: 4px 10px; background: #ecfdf5; color: #047857; border-radius: 9999px; font-size: 13px; font-weight: 500; margin-bottom: 16px; }
    .details { background: #f8fafc; border-radius: 8px; border: 1px solid #f1f5f9; padding: 18px; margin: 20px 0; }
    .detail-row { display: flex; justify-content: space-between; padding: 8px 0; font-size: 14px; border-bottom: 1px solid #f1f5f9; }
    .detail-row:last-child { border-bottom: none; }
    .label { color: #64748b; font-weight: 500; }
    .value { color: #0f172a; font-weight: 600; text-align: right; }
    .footer { padding: 20px 32px; background: #f8fafc; border-top: 1px solid #e5e7eb; font-size: 12px; color: #94a3b8; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>${esc(bName)}</h1>
    </div>
    <div class="body">
      <div class="badge">&#10003; Appointment Scheduled</div>
      <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.5;">Hi <strong>${esc(cName)}</strong>,</p>
      <p style="margin: 0 0 20px; font-size: 14px; color: #475569; line-height: 1.5;">Your appointment has been successfully booked with our team. Here are the details:</p>
      
      <div class="details">
        <div class="detail-row">
          <span class="label">Service</span>
          <span class="value">${esc(opts.serviceName)}</span>
        </div>
        <div class="detail-row">
          <span class="label">Date & Time</span>
          <span class="value">${esc(formattedDate)}</span>
        </div>
        <div class="detail-row">
          <span class="label">Duration</span>
          <span class="value">${esc(opts.durationMinutes)} minutes</span>
        </div>
        ${opts.notes ? `
        <div class="detail-row">
          <span class="label">Notes</span>
          <span class="value">${esc(opts.notes)}</span>
        </div>` : ''}
      </div>

      <p style="margin: 20px 0 0; font-size: 13px; color: #64748b; line-height: 1.5;">
        Need to make a change or reschedule? Simply reply to this email or reach us through our chat assistant.
      </p>
    </div>
    <div class="footer">
      Powered by ${esc(bName)} &bull; Automated Assistant
    </div>
  </div>
</body>
</html>
  `;

  return sendBrevoEmail({
    to: [{ email: opts.customerEmail, name: cName }],
    subject,
    htmlContent: html,
    textContent: `Hi ${cName},\n\nYour appointment for ${opts.serviceName} is confirmed for ${formattedDate} (${opts.durationMinutes} mins).\n\nRegards,\n${bName}`,
    tags: ['appointment-confirmation'],
    tenantId: opts.tenantId,
    senderName: opts.businessName,
  });
}

/**
 * Send an itemized order receipt to the customer.
 */
export async function sendOrderReceipt(opts: {
  customerEmail: string;
  customerName?: string;
  orderId: string | number;
  items: Array<{ name: string; quantity: number; unitPrice?: number }>;
  totalAmount: number;
  currency?: string;
  businessName?: string;
  paymentMethod?: string;
  notes?: string;
  tenantId?: string | null;
}): Promise<BrevoSendResult> {
  const bName = opts.businessName || 'Shwari Commerce';
  const cName = opts.customerName || 'Valued Customer';
  const currency = opts.currency || 'KES';
  const orderRef = `#ORD-${opts.orderId}`;

  const subject = `Receipt for Order ${orderRef} - ${bName}`;

  const itemsHtml = opts.items
    .map(
      (it) => `
    <tr style="border-bottom: 1px solid #f1f5f9;">
      <td style="padding: 10px 0; font-size: 14px; color: #1e293b;">${esc(it.name)} &times; ${it.quantity}</td>
      <td style="padding: 10px 0; font-size: 14px; color: #0f172a; text-align: right; font-weight: 500;">
        ${it.unitPrice ? `${currency} ${(it.unitPrice * it.quantity).toLocaleString()}` : '—'}
      </td>
    </tr>`
    )
    .join('');

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f9fafb; margin: 0; padding: 24px; color: #111827; }
    .card { max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e5e7eb; overflow: hidden; }
    .header { background: #0f172a; color: #ffffff; padding: 24px 32px; }
    .header h1 { margin: 0; font-size: 20px; font-weight: 600; }
    .body { padding: 32px; }
    .order-badge { display: inline-block; padding: 4px 10px; background: #eff6ff; color: #1d4ed8; border-radius: 9999px; font-size: 13px; font-weight: 500; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; margin: 18px 0; }
    .total-row td { padding: 14px 0 0; font-size: 16px; font-weight: 700; color: #0f172a; border-top: 2px solid #e2e8f0; }
    .footer { padding: 20px 32px; background: #f8fafc; border-top: 1px solid #e5e7eb; font-size: 12px; color: #94a3b8; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>${esc(bName)}</h1>
    </div>
    <div class="body">
      <div class="order-badge">Order ${esc(orderRef)}</div>
      <p style="margin: 0 0 16px; font-size: 15px;">Hi <strong>${esc(cName)}</strong>,</p>
      <p style="margin: 0 0 20px; font-size: 14px; color: #475569;">Thank you for your order! Here is your purchase summary:</p>

      <table>
        <thead>
          <tr style="border-bottom: 2px solid #e2e8f0; text-align: left; font-size: 12px; color: #64748b; text-transform: uppercase;">
            <th style="padding-bottom: 8px;">Item</th>
            <th style="padding-bottom: 8px; text-align: right;">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
          <tr class="total-row">
            <td>Total</td>
            <td style="text-align: right;">${esc(currency)} ${opts.totalAmount.toLocaleString()}</td>
          </tr>
        </tbody>
      </table>

      ${opts.paymentMethod ? `<p style="font-size: 13px; color: #64748b; margin: 12px 0 0;">Payment: <strong>${esc(opts.paymentMethod)}</strong></p>` : ''}
      ${opts.notes ? `<p style="font-size: 13px; color: #64748b; margin: 6px 0 0;">Notes: ${esc(opts.notes)}</p>` : ''}
    </div>
    <div class="footer">
      Thank you for doing business with ${esc(bName)}!
    </div>
  </div>
</body>
</html>
  `;

  return sendBrevoEmail({
    to: [{ email: opts.customerEmail, name: cName }],
    subject,
    htmlContent: html,
    textContent: `Hi ${cName},\n\nThank you for your order (${orderRef}). Total: ${currency} ${opts.totalAmount.toLocaleString()}.\n\nRegards,\n${bName}`,
    tags: ['order-receipt'],
    tenantId: opts.tenantId,
    senderName: opts.businessName,
  });
}

/**
 * Dispatch an AI agent's response back to an inbound customer email.
 */
export async function sendAgentEmailReply(opts: {
  customerEmail: string;
  customerName?: string;
  subject: string;
  replyText: string;
  inReplyToMessageId?: string;
  businessName?: string;
}): Promise<BrevoSendResult> {
  const bName = opts.businessName || 'Shwari AI Assistant';
  const cName = opts.customerName || '';

  const cleanSubject = headerSafe(opts.subject).slice(0, 200) || 'Your message';
  const subject = /^re:/i.test(cleanSubject) ? cleanSubject : `Re: ${cleanSubject}`;

  // Marks this as a machine reply, which is what well-behaved auto-responders
  // check before answering — one half of not ending up in a mail loop.
  const headers: Record<string, string> = { 'Auto-Submitted': 'auto-replied' };
  if (opts.inReplyToMessageId) {
    const ref = headerSafe(opts.inReplyToMessageId);
    headers['In-Reply-To'] = ref;
    headers['References'] = ref;
  }

  // Format line breaks for HTML email
  const formattedHtml = opts.replyText
    .split('\n\n')
    .map((p) => `<p style="margin: 0 0 14px 0; line-height: 1.6;">${esc(p).replace(/\n/g, '<br/>')}</p>`)
    .join('');

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #ffffff; margin: 0; padding: 16px; color: #1e293b; font-size: 15px; }
    .content { max-width: 600px; }
    .signature { margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 13px; color: #64748b; }
  </style>
</head>
<body>
  <div class="content">
    ${formattedHtml}
    <div class="signature">
      <strong>${esc(bName)}</strong><br/>
      Automated AI Assistant
    </div>
  </div>
</body>
</html>
  `;

  return sendBrevoEmail({
    to: [{ email: opts.customerEmail, name: cName }],
    subject,
    htmlContent: html,
    textContent: `${opts.replyText}\n\n--\n${bName}`,
    headers,
    tags: ['agent-reply'],
  });
}
