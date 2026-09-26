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

/**
 * Generic email dispatcher via Brevo API v3.
 */
export async function sendBrevoEmail(options: SendEmailOptions): Promise<BrevoSendResult> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.warn('[brevo] BREVO_API_KEY is not configured; skipping email dispatch.');
    return { success: false, error: 'BREVO_API_KEY not configured' };
  }

  const sender = options.sender || getBrevoSender();

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

  try {
    const res = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const body = (await res.json()) as { messageId?: string; message?: string; code?: string };

    if (!res.ok) {
      console.error('[brevo] send error:', res.status, body.message || body.code || 'Unknown error');
      return {
        success: false,
        error: body.message || `HTTP ${res.status}: ${JSON.stringify(body)}`,
      };
    }

    return {
      success: true,
      messageId: body.messageId,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[brevo] network exception:', msg);
    return { success: false, error: msg };
  }
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
      <h1>${bName}</h1>
    </div>
    <div class="body">
      <div class="badge">&#10003; Appointment Scheduled</div>
      <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.5;">Hi <strong>${cName}</strong>,</p>
      <p style="margin: 0 0 20px; font-size: 14px; color: #475569; line-height: 1.5;">Your appointment has been successfully booked with our team. Here are the details:</p>
      
      <div class="details">
        <div class="detail-row">
          <span class="label">Service</span>
          <span class="value">${opts.serviceName}</span>
        </div>
        <div class="detail-row">
          <span class="label">Date & Time</span>
          <span class="value">${formattedDate}</span>
        </div>
        <div class="detail-row">
          <span class="label">Duration</span>
          <span class="value">${opts.durationMinutes} minutes</span>
        </div>
        ${opts.notes ? `
        <div class="detail-row">
          <span class="label">Notes</span>
          <span class="value">${opts.notes}</span>
        </div>` : ''}
      </div>

      <p style="margin: 20px 0 0; font-size: 13px; color: #64748b; line-height: 1.5;">
        Need to make a change or reschedule? Simply reply to this email or reach us through our chat assistant.
      </p>
    </div>
    <div class="footer">
      Powered by ${bName} &bull; Automated Assistant
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
      <td style="padding: 10px 0; font-size: 14px; color: #1e293b;">${it.name} &times; ${it.quantity}</td>
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
      <h1>${bName}</h1>
    </div>
    <div class="body">
      <div class="order-badge">Order ${orderRef}</div>
      <p style="margin: 0 0 16px; font-size: 15px;">Hi <strong>${cName}</strong>,</p>
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
            <td style="text-align: right;">${currency} ${opts.totalAmount.toLocaleString()}</td>
          </tr>
        </tbody>
      </table>

      ${opts.paymentMethod ? `<p style="font-size: 13px; color: #64748b; margin: 12px 0 0;">Payment: <strong>${opts.paymentMethod}</strong></p>` : ''}
      ${opts.notes ? `<p style="font-size: 13px; color: #64748b; margin: 6px 0 0;">Notes: ${opts.notes}</p>` : ''}
    </div>
    <div class="footer">
      Thank you for doing business with ${bName}!
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

  const subject = opts.subject.startsWith('Re:') ? opts.subject : `Re: ${opts.subject}`;

  const headers: Record<string, string> = {};
  if (opts.inReplyToMessageId) {
    headers['In-Reply-To'] = opts.inReplyToMessageId;
    headers['References'] = opts.inReplyToMessageId;
  }

  // Format line breaks for HTML email
  const formattedHtml = opts.replyText
    .split('\n\n')
    .map((p) => `<p style="margin: 0 0 14px 0; line-height: 1.6;">${p.replace(/\n/g, '<br/>')}</p>`)
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
      <strong>${bName}</strong><br/>
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
