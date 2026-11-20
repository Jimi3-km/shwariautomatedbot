import { notify, logReceipt } from './notify.js';
import { serviceClient } from '../supabase.js';
import { getProvider, ProviderError } from '../channels/providers/index.js';
import { isBrevoConfigured, sendBrevoEmail } from './brevo.js';
import { renderReceiptHtml } from '../routes/receipts.js';

/**
 * Telling a customer their payment has been confirmed, and giving them the
 * receipt.
 *
 * An agent is never allowed to say a payment arrived: it cannot know. A person
 * checking the money and pressing Verify is the moment it becomes true, and
 * the customer - who was told "a colleague will confirm shortly" - is waiting
 * to hear it. So the confirmation and the receipt go out here, on the back of
 * that human decision: as a message on the channel the customer has been
 * talking on, and as an email when we have their address.
 *
 * The wording is fixed rather than written by a model. Every figure in it
 * comes from the payment and order rows the person just verified, so there is
 * nothing for a model to get wrong.
 */

export interface PaymentNoticeInput {
  tenantId: string;
  paymentId: string;
}

export interface PaymentNoticeResult {
  /** The confirmation and receipt reached the customer's chat. */
  notified: boolean;
  channel?: string;
  /** The receipt was emailed as well. */
  receipt_emailed: boolean;
  /** Why the customer was not reached, when they were not. */
  reason?: string;
}

function money(amount: unknown, currency: unknown): string | null {
  const n = Number(amount);
  if (amount === null || amount === undefined || amount === '' || !Number.isFinite(n)) return null;
  const formatted = n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return `${String(currency || '').toUpperCase().trim() || 'KES'} ${formatted}`;
}

interface OrderItem { name?: unknown; qty?: unknown; price?: unknown }

/** The message itself. Exported so the wording can be tested on its own. */
export function paymentConfirmationText(opts: {
  customerName?: string | null;
  businessName?: string | null;
  amount: number | string | null;
  currency: string | null;
  orderRef?: string | null;
  items?: OrderItem[] | null;
  method?: string | null;
  transactionCode?: string | null;
  deliveryLocation?: string | null;
  verifiedAt?: string | null;
  timezone?: string | null;
}): string {
  const first = (opts.customerName ?? '').trim().split(/\s+/)[0] ?? '';
  const hello = first && /^[\p{L}'-]{2,20}$/u.test(first) ? `Hi ${first}, ` : 'Hi, ';
  const sum = money(opts.amount, opts.currency);
  const what = sum ? `your payment of ${sum}` : 'your payment';
  const forOrder = opts.orderRef ? ` for order ${opts.orderRef}` : '';
  const lines: string[] = [
    `${hello}we have received and confirmed ${what}${forOrder}.${opts.orderRef ? ' Your order is now confirmed and we will update you on the next step.' : ''}`,
  ];

  // The receipt, as text, so it arrives where the conversation is.
  const receipt: string[] = [];
  if (opts.orderRef) receipt.push(`Order: ${opts.orderRef}`);
  const items = (Array.isArray(opts.items) ? opts.items : [])
    .map((i) => {
      const name = typeof i?.name === 'string' ? i.name.trim() : '';
      if (!name) return '';
      const qty = Number(i.qty);
      return `${Number.isFinite(qty) && qty > 1 ? `${qty} x ` : ''}${name}`;
    })
    .filter(Boolean);
  if (items.length) receipt.push(`Items: ${items.join(', ')}`);
  if (sum) receipt.push(`Amount paid: ${sum}`);
  const how = [opts.method, opts.transactionCode ? `ref ${opts.transactionCode}` : ''].filter(Boolean).join(', ');
  if (how) receipt.push(`Paid by: ${how}`);
  if (opts.deliveryLocation) receipt.push(`Delivery to: ${opts.deliveryLocation}`);
  if (opts.verifiedAt) {
    const at = new Date(opts.verifiedAt);
    if (!Number.isNaN(at.getTime())) {
      let date: string;
      try {
        date = at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: opts.timezone || 'UTC' });
      } catch {
        date = at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
      }
      receipt.push(`Date: ${date}`);
    }
  }
  if (receipt.length) lines.push('', 'RECEIPT', ...receipt.map((r) => `- ${r}`));

  lines.push('', opts.businessName ? `Thank you for choosing ${opts.businessName}.` : 'Thank you.');
  return lines.join('\n').trim();
}

/**
 * Send the confirmation and receipt. Never throws: verifying a payment must
 * succeed even when the customer cannot be reached, and the caller reports
 * which happened.
 */
export async function notifyPaymentVerified(input: PaymentNoticeInput): Promise<PaymentNoticeResult> {
  const result: PaymentNoticeResult = { notified: false, receipt_emailed: false };
  try {
    const { data: payment } = await serviceClient
      .from('payments').select('*')
      .eq('tenant_id', input.tenantId).eq('id', input.paymentId).maybeSingle();
    if (!payment) return { ...result, reason: 'The payment could not be read back.' };

    const [{ data: business }, { data: order }, { data: lead }] = await Promise.all([
      serviceClient.from('tenants')
        .select('business_name, address, currency, order_prefix, branding, contact_info, timezone')
        .eq('id', input.tenantId).maybeSingle(),
      payment.order_id
        ? serviceClient.from('orders').select('*').eq('tenant_id', input.tenantId).eq('id', payment.order_id).maybeSingle()
        : Promise.resolve({ data: null } as any),
      payment.lead_id !== null && payment.lead_id !== undefined
        ? serviceClient.from('leads').select('*').eq('tenant_id', input.tenantId).eq('id', payment.lead_id).maybeSingle()
        : Promise.resolve({ data: null } as any),
    ]);

    // --- the receipt by email, when there is an address ---------------------
    const email = String(payment.customer_email || (lead as any)?.email || '').trim();
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && isBrevoConfigured() && business && !payment.receipt_sent_at) {
      const sent = await sendBrevoEmail({
        to: [{ email, name: (lead as any)?.customer_name || undefined }],
        subject: `Your receipt from ${(business as any).business_name || 'us'}${(order as any)?.order_ref ? ` - ${(order as any).order_ref}` : ''}`,
        htmlContent: renderReceiptHtml({ business, payment, order: order ?? null, lead: lead ?? null }),
        tags: ['receipt'],
      } as any).catch(() => ({ success: false }));
      result.receipt_emailed = Boolean((sent as any)?.success);
    }

    // --- the confirmation and receipt in the conversation --------------------
    const chat = await sendInChat(input, payment, business, order, lead);
    Object.assign(result, { notified: chat.notified, channel: chat.channel, reason: chat.reason });

    // --- keep the receipt, and tell the team ---------------------------------
    const firstTime = chat.reason !== 'The customer was already told about this payment.';
    if (firstTime) {
      await logReceipt({
        tenantId: input.tenantId,
        paymentId: input.paymentId,
        orderId: payment.order_id ?? null,
        leadId: payment.lead_id ?? null,
        orderRef: (order as any)?.order_ref ?? null,
        amount: payment.amount,
        currency: payment.currency || (business as any)?.currency || null,
        textBody: chat.text ?? '',
        htmlBody: business ? renderReceiptHtml({ business, payment, order: order ?? null, lead: lead ?? null }) : null,
        sentInChat: chat.notified,
        sentByEmail: result.receipt_emailed,
        recipientEmail: result.receipt_emailed ? email : null,
        issuedBy: payment.verified_by ?? null,
      });
      const sum = money(payment.amount, payment.currency || (business as any)?.currency);
      await notify({
        tenantId: input.tenantId,
        kind: 'payment_verified',
        title: `Payment verified${(order as any)?.order_ref ? ` - ${(order as any).order_ref}` : ''}`,
        body: `${sum ?? 'A payment'} from ${(lead as any)?.customer_name || 'a customer'} was verified. ${chat.notified ? 'The receipt was sent in the chat' : 'The customer was not messaged'}${result.receipt_emailed ? ' and by email' : ''}.`,
        link: '/payments',
        refId: input.paymentId,
      });
    }

    if (result.notified || result.receipt_emailed) {
      await serviceClient.from('payments')
        .update({ receipt_sent_at: new Date().toISOString() })
        .eq('tenant_id', input.tenantId).eq('id', input.paymentId);
    }
    return result;
  } catch (e) {
    console.error('[payment-notice] unexpected failure:', e instanceof Error ? e.message : e);
    return { ...result, reason: 'The customer could not be notified.' };
  }
}

async function sendInChat(
  input: PaymentNoticeInput, payment: any, business: any, order: any, lead: any
): Promise<Pick<PaymentNoticeResult, 'notified' | 'channel' | 'reason'> & { text?: string }> {
  // The conversation the claim was made in, or else the customer's latest.
  let conv: any = null;
  if (payment.conversation_id) {
    const { data } = await serviceClient
      .from('conversations').select('id, channel_id, channel_type, customer_id, customer_name')
      .eq('tenant_id', input.tenantId).eq('id', payment.conversation_id).maybeSingle();
    conv = data;
  }
  if (!conv && payment.lead_id !== null && payment.lead_id !== undefined) {
    const { data } = await serviceClient
      .from('conversations').select('id, channel_id, channel_type, customer_id, customer_name')
      .eq('tenant_id', input.tenantId).eq('lead_id', payment.lead_id)
      .order('last_message_at', { ascending: false }).limit(1);
    conv = Array.isArray(data) ? data[0] : null;
  }
  if (!conv?.customer_id) {
    return { notified: false, reason: 'There is no conversation with this customer to reply in.' };
  }

  // One confirmation per payment, however many times Verify is pressed.
  const { data: already } = await serviceClient
    .from('conversation_messages').select('id, extracted')
    .eq('tenant_id', input.tenantId).eq('conversation_id', conv.id)
    .eq('extracted->>payment_id', input.paymentId).limit(5);
  // An earlier attempt that never reached the customer does not count.
  const delivered = (Array.isArray(already) ? already : [])
    .filter((m: any) => m?.extracted?.delivery?.status !== 'failed');
  if (delivered.length) {
    return { notified: false, reason: 'The customer was already told about this payment.' };
  }

  const text = paymentConfirmationText({
    customerName: lead?.customer_name || conv.customer_name,
    businessName: business?.business_name ?? null,
    amount: payment.amount,
    currency: payment.currency || business?.currency || null,
    orderRef: order?.order_ref ?? null,
    items: Array.isArray(order?.items) ? order.items : null,
    method: payment.payment_method ?? null,
    transactionCode: payment.transaction_code ?? null,
    deliveryLocation: order?.delivery_location ?? null,
    verifiedAt: payment.verified_at ?? new Date().toISOString(),
    timezone: business?.timezone ?? null,
  });

  const extracted = {
    agent: 'shwari', department: 'orders',
    payment_confirmation: true, receipt: true, payment_id: input.paymentId,
  };
  const { data: row, error: insertErr } = await serviceClient
    .from('conversation_messages')
    .insert({ tenant_id: input.tenantId, conversation_id: conv.id, sender: 'agent', body: text, extracted })
    .select('id').maybeSingle();
  if (insertErr) {
    console.error('[payment-notice] could not record the confirmation:', insertErr.message);
    return { notified: false, reason: 'The confirmation could not be saved.' };
  }

  await serviceClient
    .from('conversations')
    .update({ last_message_at: new Date().toISOString(), last_message_preview: text.slice(0, 160) })
    .eq('id', conv.id).eq('tenant_id', input.tenantId);

  // Web chat reads the transcript; the row above is the delivery.
  if (conv.channel_type === 'webchat') return { notified: true, channel: 'webchat', text };

  const provider = getProvider(conv.channel_type);
  const channelId = conv.channel_id ?? (await activeChannel(input.tenantId, conv.channel_type));
  if (!provider || !channelId) {
    await markFailed(input.tenantId, (row as any)?.id, extracted, 'That channel is no longer connected.');
    return { notified: false, reason: 'That channel is no longer connected.', text };
  }

  try {
    await provider.sendMessage(channelId, conv.customer_id, text, { tenantId: input.tenantId, userId: '' });
    return { notified: true, channel: conv.channel_type, text };
  } catch (e) {
    const reason = e instanceof ProviderError ? e.userMessage : 'The message could not be delivered.';
    console.error('[payment-notice] delivery failed:', e instanceof Error ? e.message : e);
    await markFailed(input.tenantId, (row as any)?.id, extracted, reason);
    return { notified: false, reason, text };
  }
}

async function activeChannel(tenantId: string, channelType: string): Promise<string | null> {
  const { data } = await serviceClient
    .from('channels').select('id')
    .eq('tenant_id', tenantId).eq('channel_type', channelType).eq('status', 'active')
    .order('created_at', { ascending: false }).limit(1);
  return Array.isArray(data) && data[0] ? data[0].id : null;
}

/** So the Inbox does not show an undelivered confirmation as sent. */
async function markFailed(tenantId: string, messageId: unknown, extracted: Record<string, unknown>, reason: string) {
  if (messageId === undefined || messageId === null) return;
  await serviceClient
    .from('conversation_messages')
    .update({ extracted: { ...extracted, delivery: { status: 'failed', error: reason, at: new Date().toISOString() } } })
    .eq('id', messageId)
    .eq('tenant_id', tenantId);
}
