import { serviceClient } from '../supabase.js';
import { getProvider } from '../channels/providers/index.js';
import { sendDocumentToCustomer } from '../channels/media.js';
import { sendBrevoEmail, esc, isBrevoConfigured } from './brevo.js';
import { notify } from './notify.js';
import { receiptSettingsOf } from './receiptDesign.js';
import { invoicePdfUrl } from './receiptImage.js';
import type { ReceiptImageData } from './receiptLayout.js';

/**
 * Invoices: a request for payment, sent to a customer as a PDF.
 *
 * An invoice never records that money arrived. Payment stays where it has
 * always been: a row in `payments` that a person verifies. Verifying a payment
 * that belongs to an invoice marks the invoice paid, sends the receipt and
 * tells the team, through the same paths as any other payment.
 */

export interface InvoiceItem { name: string; qty: number; price: number }

export interface InvoiceSettings {
  /** The letters before the number: INV-00001. */
  prefix: string;
  /** Days from issue until payment is due. */
  due_days: number;
  /** Printed under "Terms" on every invoice. */
  terms: string | null;
  tax_label: string | null;
  tax_rate: number;
  /** Raise and send an invoice by itself when a booking is confirmed. */
  auto_on_booking: boolean;
}

const BUSINESS_FIELDS =
  'business_name, address, currency, branding, contact_info, timezone, payment_details';

export function invoiceSettingsOf(business: any): InvoiceSettings {
  const r = (business?.branding?.invoice ?? {}) as Record<string, unknown>;
  const prefix = String(r.prefix ?? 'INV').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'INV';
  const due = Number(r.due_days);
  const rate = Number(r.tax_rate);
  return {
    prefix,
    due_days: Number.isFinite(due) && due >= 0 && due <= 365 ? Math.round(due) : 7,
    terms: String(r.terms ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) || null,
    tax_label: String(r.tax_label ?? '').replace(/\s+/g, ' ').trim().slice(0, 24) || null,
    tax_rate: Number.isFinite(rate) && rate >= 0 && rate <= 100 ? Math.round(rate * 1000) / 1000 : 0,
    auto_on_booking: r.auto_on_booking === true,
  };
}

export function mergeInvoiceSettings(business: any, patch: Record<string, unknown>): InvoiceSettings {
  const current = { ...((business?.branding?.invoice ?? {}) as Record<string, unknown>) };
  for (const k of ['prefix', 'due_days', 'terms', 'tax_label', 'tax_rate', 'auto_on_booking']) {
    if (k in patch) current[k] = patch[k];
  }
  return invoiceSettingsOf({ branding: { invoice: current } });
}

export async function loadBusiness(tenantId: string): Promise<any> {
  const { data } = await serviceClient.from('tenants').select(BUSINESS_FIELDS).eq('id', tenantId).maybeSingle();
  return data;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Clean a list of lines from a form or an agent into what is stored. */
export function cleanItems(raw: unknown): InvoiceItem[] {
  if (!Array.isArray(raw)) return [];
  const out: InvoiceItem[] = [];
  for (const r of raw.slice(0, 30)) {
    const name = String((r as any)?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const qty = Number((r as any)?.qty ?? 1);
    const price = Number((r as any)?.price);
    if (!name || !Number.isFinite(price) || price < 0 || price > 1e9) continue;
    out.push({ name, qty: Number.isFinite(qty) && qty > 0 && qty <= 10000 ? Math.round(qty * 100) / 100 : 1, price: round2(price) });
  }
  return out;
}

export function totalsOf(items: InvoiceItem[], discount: number, taxRate: number) {
  const subtotal = round2(items.reduce((sum, i) => sum + i.price * i.qty, 0));
  const disc = round2(Math.min(Math.max(discount || 0, 0), subtotal));
  const taxAmount = round2(((subtotal - disc) * (taxRate || 0)) / 100);
  return { subtotal, discount: disc, tax_amount: taxAmount, total: round2(subtotal - disc + taxAmount) };
}

export class InvoiceError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export interface CreateInvoiceInput {
  leadId?: number | null;
  conversationId?: string | null;
  appointmentId?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  items: unknown;
  discount?: number;
  dueDate?: string | null;
  notes?: string | null;
  createdBy?: string | null;
}

/** Create a draft invoice with the next number for this business. */
export async function createInvoice(tenantId: string, input: CreateInvoiceInput): Promise<any> {
  const business = await loadBusiness(tenantId);
  if (!business) throw new InvoiceError('Business not found', 404);
  const settings = invoiceSettingsOf(business);
  const items = cleanItems(input.items);
  if (!items.length) throw new InvoiceError('Add at least one line with a name and a price.');

  // Fill in who it is for from the lead, when there is one.
  let lead: any = null;
  if (input.leadId !== null && input.leadId !== undefined) {
    const { data } = await serviceClient.from('leads')
      .select('id, customer_name, email, phone').eq('tenant_id', tenantId).eq('id', input.leadId).maybeSingle();
    if (!data) throw new InvoiceError('That customer could not be found.', 404);
    lead = data;
  }
  const customerName = text(input.customerName, 120) ?? lead?.customer_name ?? null;
  if (!customerName) throw new InvoiceError('Say who the invoice is for.');

  const totals = totalsOf(items, Number(input.discount) || 0, settings.tax_rate);
  const due = validDate(input.dueDate) ?? addDays(new Date(), settings.due_days);

  // The next number. Two people creating at once collide on the unique
  // constraint; the loser simply takes the following number.
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: last } = await serviceClient.from('invoices')
      .select('seq').eq('tenant_id', tenantId).order('seq', { ascending: false }).limit(1);
    const seq = (last?.[0]?.seq ?? 0) + 1;
    const { data, error } = await serviceClient.from('invoices').insert({
      tenant_id: tenantId, seq, invoice_no: `${settings.prefix}-${String(seq).padStart(5, '0')}`,
      lead_id: lead?.id ?? null,
      conversation_id: input.conversationId ?? null,
      appointment_id: input.appointmentId ?? null,
      customer_name: customerName,
      customer_email: text(input.customerEmail, 200) ?? lead?.email ?? null,
      customer_phone: text(input.customerPhone, 40) ?? lead?.phone ?? null,
      items, ...totals,
      tax_label: settings.tax_rate > 0 ? settings.tax_label ?? 'Tax' : null,
      tax_rate: settings.tax_rate,
      currency: String(business.currency || 'KES').toUpperCase().slice(0, 3),
      status: 'draft',
      due_date: due,
      notes: text(input.notes, 500) ?? settings.terms,
      created_by: input.createdBy ?? null,
    }).select('*').single();
    if (!error && data) return data;
    if (error?.code !== '23505') {
      console.error('[invoices] create failed:', error?.message);
      throw new InvoiceError('The invoice could not be created.', 500);
    }
  }
  throw new InvoiceError('The invoice could not be numbered. Please try again.', 500);
}

function text(v: unknown, max: number): string | null {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  return s || null;
}
function validDate(v: unknown): string | null {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) ? v : null;
}
function addDays(d: Date, days: number): string {
  return new Date(d.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/** "sent" past its due date reads as overdue everywhere it is shown. */
export function displayStatus(inv: { status: string; due_date?: string | null }): 'draft' | 'sent' | 'overdue' | 'paid' | 'void' {
  if (inv.status === 'sent' && inv.due_date && inv.due_date < new Date().toISOString().slice(0, 10)) return 'overdue';
  return inv.status as 'draft' | 'sent' | 'paid' | 'void';
}

function fmtDate(v: string | null | undefined, tz?: string | null): string | null {
  if (!v) return null;
  try {
    return new Date(`${String(v).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: tz || 'UTC' });
  } catch {
    return String(v).slice(0, 10);
  }
}

/** Everything the document needs, drawn with the same layout as a receipt. */
export function invoiceDocData(business: any, inv: any): ReceiptImageData {
  const settings = receiptSettingsOf(business);
  const details = business?.payment_details && typeof business.payment_details === 'object' ? business.payment_details : {};
  const payLines = Object.entries(details as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim())
    .map(([k, v]) => `${k}: ${String(v).trim()}`)
    .slice(0, 5);
  if (payLines.length) payLines.push(`Use ${inv.invoice_no} as the reference.`);
  const shown = displayStatus(inv);
  return {
    kind: 'invoice',
    status: shown === 'paid' ? 'paid' : shown === 'overdue' ? 'overdue' : shown === 'void' ? 'void' : 'unpaid',
    businessName: business?.business_name || 'Invoice',
    receiptNo: inv.invoice_no,
    customerName: inv.customer_name,
    customerPhone: inv.customer_phone,
    items: (Array.isArray(inv.items) ? inv.items : []).map((i: any) => ({ name: String(i?.name ?? ''), qty: Number(i?.qty) || 1, price: i?.price ?? null })),
    discount: Number(inv.discount) || 0,
    tax: Number(inv.tax_amount) > 0 ? { label: `${inv.tax_label || 'Tax'}${Number(inv.tax_rate) ? ` ${Number(inv.tax_rate)}%` : ''}`, amount: Number(inv.tax_amount) } : null,
    amount: Number(inv.total),
    currency: String(inv.currency || business?.currency || 'KES').toUpperCase(),
    date: fmtDate(inv.issue_date, business?.timezone),
    dueDate: fmtDate(inv.due_date, business?.timezone),
    payLines,
    notes: inv.notes ?? null,
    accent: settings.accent,
    settings,
  };
}

const money = (n: unknown, currency: string) =>
  `${currency} ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The connection to send through for a conversation.
 *
 * A conversation remembers the channel it started on. When that channel has
 * since been disconnected and connected again (a new row), the old one cannot
 * send, and the message failed with "not connected" although the business is
 * connected. So the conversation's own channel is used only while it is still
 * active; otherwise the business's current connection of the same kind.
 */
export async function liveChannelId(tenantId: string, channelType: string, preferred: string | null | undefined): Promise<string | null> {
  const { data } = await serviceClient.from('channels').select('id, created_at')
    .eq('tenant_id', tenantId).eq('channel_type', channelType).eq('status', 'active')
    .order('created_at', { ascending: false });
  const active = data ?? [];
  if (preferred && active.some((c) => c.id === preferred)) return preferred;
  return active[0]?.id ?? null;
}

export interface SendInvoiceResult {
  sent: boolean;
  chat: { sent: boolean; channel?: string; file?: boolean; reason?: string };
  email: { sent: boolean; reason?: string };
}

/**
 * Send an invoice to its customer: in their chat as a PDF, and by email as a
 * PDF attachment when there is an address. It counts as sent if either lands.
 */
export async function sendInvoice(tenantId: string, invoiceId: string): Promise<SendInvoiceResult> {
  const { data: inv } = await serviceClient.from('invoices').select('*').eq('tenant_id', tenantId).eq('id', invoiceId).maybeSingle();
  if (!inv) throw new InvoiceError('Invoice not found', 404);
  if (inv.status === 'void') throw new InvoiceError('A cancelled invoice cannot be sent.', 409);
  if (inv.status === 'paid') throw new InvoiceError('This invoice is already paid.', 409);

  const business = await loadBusiness(tenantId);
  const name = receiptSettingsOf(business).display_name || business?.business_name || 'us';
  const pdf = invoicePdfUrl(inv.id);
  const due = fmtDate(inv.due_date, business?.timezone);
  const filename = `Invoice ${inv.invoice_no}.pdf`;
  const body =
    `Hello${inv.customer_name ? ` ${String(inv.customer_name).split(' ')[0]}` : ''}, here is your invoice ${inv.invoice_no} from ${name}.\n\n` +
    `Amount due: ${money(inv.total, inv.currency)}${due ? `\nDue: ${due}` : ''}\n\n` +
    `Once you have paid, send the payment message or reference here and we will confirm it.`;

  const result: SendInvoiceResult = { sent: false, chat: { sent: false }, email: { sent: false } };

  // --- in the customer's chat ------------------------------------------------
  let conv: any = null;
  if (inv.conversation_id) {
    const { data } = await serviceClient.from('conversations')
      .select('id, channel_type, channel_id, customer_id').eq('tenant_id', tenantId).eq('id', inv.conversation_id).maybeSingle();
    conv = data;
  }
  if (!conv && inv.lead_id !== null && inv.lead_id !== undefined) {
    const { data } = await serviceClient.from('conversations')
      .select('id, channel_type, channel_id, customer_id').eq('tenant_id', tenantId).eq('lead_id', inv.lead_id)
      .order('last_message_at', { ascending: false, nullsFirst: false }).limit(1);
    conv = data?.[0] ?? null;
  }

  if (!conv || conv.channel_type === 'email') {
    result.chat.reason = 'This customer has no chat to send it to.';
  } else {
    const extracted: Record<string, unknown> = {
      agent: 'shwari', department: 'orders', invoice: true, invoice_id: inv.id,
      ...(pdf ? { file_url: pdf, file_name: filename } : {}),
    };
    const chatText = conv.channel_type === 'webchat' && pdf ? `${body}\n\nDownload it: ${pdf}` : body;
    const { data: row } = await serviceClient.from('conversation_messages')
      .insert({ tenant_id: tenantId, conversation_id: conv.id, sender: 'agent', body: chatText, extracted })
      .select('id').maybeSingle();
    await serviceClient.from('conversations')
      .update({ last_message_at: new Date().toISOString(), last_message_preview: `Invoice ${inv.invoice_no}` })
      .eq('id', conv.id).eq('tenant_id', tenantId);

    if (conv.channel_type === 'webchat') {
      // Web chat reads the transcript; the row above is the delivery.
      result.chat = { sent: true, channel: 'webchat', file: Boolean(pdf) };
    } else {
      const provider = getProvider(conv.channel_type);
      const channelId = await liveChannelId(tenantId, conv.channel_type, conv.channel_id);
      if (!provider || !channelId) {
        result.chat.reason = 'That channel is no longer connected.';
      } else {
        try {
          await provider.sendMessage(channelId, conv.customer_id, body, { tenantId, userId: '' });
          let file = false;
          if (pdf) {
            const doc = await sendDocumentToCustomer({
              tenantId, channelType: conv.channel_type, channelId, customerId: conv.customer_id,
              fileUrl: pdf, filename, caption: `Invoice ${inv.invoice_no}`,
            });
            file = doc.sent;
            // The file is the invoice. If the platform refuses it, the link still gets it to them.
            if (!doc.sent) {
              await provider.sendMessage(channelId, conv.customer_id, `Your invoice: ${pdf}`, { tenantId, userId: '' }).catch(() => undefined);
            }
          }
          result.chat = { sent: true, channel: conv.channel_type, file };
        } catch (e) {
          const reason = (e as { userMessage?: string })?.userMessage ?? 'The message could not be sent.';
          result.chat.reason = reason;
          if (row?.id) {
            await serviceClient.from('conversation_messages')
              .update({ extracted: { ...extracted, delivery: { status: 'failed', error: reason, at: new Date().toISOString() } } })
              .eq('id', row.id).eq('tenant_id', tenantId);
          }
        }
      }
    }
  }

  // --- by email ----------------------------------------------------------------
  const email = String(inv.customer_email ?? '').trim();
  if (!email) {
    result.email.reason = 'No email address for this customer.';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    result.email.reason = 'The email address on the invoice is not valid.';
  } else if (!isBrevoConfigured()) {
    result.email.reason = 'Email is not set up.';
  } else {
    const html =
      `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#111827;line-height:1.6;max-width:560px;">` +
      `<p>Hello${inv.customer_name ? ` ${esc(String(inv.customer_name).split(' ')[0])}` : ''},</p>` +
      `<p>Please find attached invoice <strong>${esc(inv.invoice_no)}</strong> from ${esc(name)}.</p>` +
      `<table cellpadding="0" cellspacing="0" style="margin:14px 0;border:1px solid #e5e7eb;border-radius:8px;">` +
      `<tr><td style="padding:10px 16px;color:#6b7280;">Amount due</td><td style="padding:10px 16px;font-weight:700;">${esc(money(inv.total, inv.currency))}</td></tr>` +
      (due ? `<tr><td style="padding:10px 16px;color:#6b7280;border-top:1px solid #e5e7eb;">Due</td><td style="padding:10px 16px;border-top:1px solid #e5e7eb;">${esc(due)}</td></tr>` : '') +
      `</table>` +
      (pdf ? `<p><a href="${esc(pdf)}">Open the invoice</a> if the attachment does not show.</p>` : '') +
      `<p>How to pay is on the invoice. Reply to this email or message us once you have paid.</p>` +
      `<p>Thank you,<br>${esc(name)}</p></div>`;
    const base = {
      to: [{ email, name: inv.customer_name || undefined }],
      subject: `Invoice ${inv.invoice_no} from ${name}`,
      htmlContent: html,
      tags: ['invoice'],
      tenantId,
      senderName: name,
    };
    let sent: any = pdf
      ? await sendBrevoEmail({ ...base, attachments: [{ url: pdf, name: filename }] }).catch(() => ({ success: false }))
      : { success: false };
    if (!sent?.success) sent = await sendBrevoEmail(base).catch(() => ({ success: false }));
    result.email = sent?.success ? { sent: true } : { sent: false, reason: 'The email service refused the message.' };
  }

  result.sent = result.chat.sent || result.email.sent;
  if (result.sent) {
    await serviceClient.from('invoices').update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      sent_via: [result.chat.sent ? result.chat.channel : null, result.email.sent ? 'email' : null].filter(Boolean).join(', '),
      updated_at: new Date().toISOString(),
    }).eq('id', inv.id).eq('tenant_id', tenantId);
  }
  return result;
}

/**
 * Which open invoice a new payment claim is for.
 *
 * The customer's own open invoices only. One for exactly this amount wins;
 * otherwise, if they have a single open invoice, it is that one. Anything less
 * certain is left for a person to link.
 */
export async function findInvoiceForClaim(tenantId: string, leadId: number | null | undefined, amount: number | null): Promise<string | null> {
  if (leadId === null || leadId === undefined) return null;
  const { data } = await serviceClient.from('invoices')
    .select('id, total').eq('tenant_id', tenantId).eq('lead_id', leadId).eq('status', 'sent')
    .order('created_at', { ascending: false }).limit(10);
  const open = data ?? [];
  if (!open.length) return null;
  if (amount !== null) {
    const exact = open.filter((i) => Math.abs(Number(i.total) - amount) < 0.01);
    if (exact.length) return exact[0].id;
  }
  return open.length === 1 ? open[0].id : null;
}

/**
 * A payment has just been verified by a person. If it belongs to an invoice,
 * the invoice is now paid. Returns the invoice, or null when there is none.
 */
export async function settleInvoiceForPayment(tenantId: string, paymentId: string): Promise<any | null> {
  const { data: payment } = await serviceClient.from('payments')
    .select('id, invoice_id, verification_status, amount, currency').eq('tenant_id', tenantId).eq('id', paymentId).maybeSingle();
  const invoiceId = (payment as { invoice_id?: string | null } | null)?.invoice_id;
  if (!payment || !invoiceId || payment.verification_status !== 'verified') return null;

  const { data: inv } = await serviceClient.from('invoices')
    .update({ status: 'paid', paid_at: new Date().toISOString(), payment_id: paymentId, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('id', invoiceId).in('status', ['draft', 'sent'])
    .select('id, invoice_no, customer_name, total, currency').maybeSingle();
  if (!inv) return null;

  await notify({
    tenantId, kind: 'invoice_paid',
    title: `Invoice ${inv.invoice_no} paid`,
    body: `${inv.customer_name || 'A customer'} paid ${money(inv.total, inv.currency)}.`,
    link: '/invoices', refId: inv.id,
  });
  return inv;
}

/**
 * Once a day: tell each business about invoices that have just gone overdue.
 * Each invoice is announced once (reminded_at). Returns how many were.
 */
export async function announceOverdueInvoices(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await serviceClient.from('invoices')
    .select('id, tenant_id, invoice_no, customer_name, total, currency, due_date')
    .eq('status', 'sent').lt('due_date', today).is('reminded_at', null).limit(200);
  let n = 0;
  for (const inv of data ?? []) {
    await serviceClient.from('invoices').update({ reminded_at: new Date().toISOString() }).eq('id', inv.id);
    const told = await notify({
      tenantId: inv.tenant_id, kind: 'invoice_overdue',
      title: `Invoice ${inv.invoice_no} is overdue`,
      body: `${inv.customer_name || 'A customer'} owes ${money(inv.total, inv.currency)}, due ${fmtDate(inv.due_date) ?? inv.due_date}.`,
      link: '/invoices', refId: inv.id,
    });
    if (told) n++;
  }
  return n;
}
