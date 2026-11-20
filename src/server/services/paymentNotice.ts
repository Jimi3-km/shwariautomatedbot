import { serviceClient } from '../supabase.js';
import { getProvider, ProviderError } from '../channels/providers/index.js';

/**
 * Telling a customer their payment has been confirmed.
 *
 * An agent is never allowed to say a payment arrived: it cannot know. A person
 * checking the money and pressing Verify is the moment it becomes true, and
 * the customer - who was told "a colleague will confirm shortly" - is waiting
 * to hear it. So the confirmation goes out here, on the back of that human
 * decision, on the channel the customer has been talking on.
 *
 * The wording is fixed rather than written by a model. Every figure in it
 * comes from the payment and order rows the person just verified, so there is
 * nothing for a model to get wrong.
 */

export interface PaymentNoticeInput {
  tenantId: string;
  paymentId: string;
  amount: number | string | null;
  currency: string | null;
  leadId: number | null;
  orderId: string | null;
}

export type PaymentNoticeResult =
  | { notified: true; channel: string }
  | { notified: false; reason: string };

function money(amount: number | string | null, currency: string | null): string | null {
  const n = Number(amount);
  if (amount === null || amount === '' || !Number.isFinite(n)) return null;
  const formatted = n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return `${(currency || '').toUpperCase().trim() || 'KES'} ${formatted}`;
}

/** The message itself. Exported so the wording can be tested on its own. */
export function paymentConfirmationText(opts: {
  customerName?: string | null;
  businessName?: string | null;
  amount: number | string | null;
  currency: string | null;
  orderRef?: string | null;
}): string {
  const first = (opts.customerName ?? '').trim().split(/\s+/)[0] ?? '';
  const hello = first && /^[\p{L}'-]{2,20}$/u.test(first) ? `Hi ${first}, ` : 'Hi, ';
  const sum = money(opts.amount, opts.currency);
  const what = sum ? `your payment of ${sum}` : 'your payment';
  const forOrder = opts.orderRef ? ` for order ${opts.orderRef}` : '';
  const from = opts.businessName ? ` Thank you for choosing ${opts.businessName}.` : ' Thank you.';
  const next = opts.orderRef ? ' Your order is now confirmed and we will update you on the next step.' : '';
  return `${hello}we have received and confirmed ${what}${forOrder}.${next}${from}`.replace(/\s+/g, ' ').trim();
}

/**
 * Send the confirmation. Never throws: verifying a payment must succeed even
 * when the customer cannot be reached, and the caller reports which happened.
 */
export async function notifyPaymentVerified(input: PaymentNoticeInput): Promise<PaymentNoticeResult> {
  try {
    if (input.leadId === null || input.leadId === undefined) {
      return { notified: false, reason: 'This payment is not linked to a customer conversation.' };
    }

    // The customer's most recent conversation is where they are waiting.
    const { data: convs } = await serviceClient
      .from('conversations')
      .select('id, channel_id, channel_type, customer_id, customer_name')
      .eq('tenant_id', input.tenantId)
      .eq('lead_id', input.leadId)
      .order('last_message_at', { ascending: false })
      .limit(1);
    const conv = Array.isArray(convs) ? convs[0] : null;
    if (!conv?.customer_id) {
      return { notified: false, reason: 'There is no conversation with this customer to reply in.' };
    }

    // One confirmation per payment, however many times Verify is pressed.
    const { data: already } = await serviceClient
      .from('conversation_messages')
      .select('id, extracted')
      .eq('tenant_id', input.tenantId)
      .eq('conversation_id', conv.id)
      .eq('extracted->>payment_id', input.paymentId)
      .limit(5);
    // An earlier attempt that never reached the customer does not count.
    const delivered = (Array.isArray(already) ? already : [])
      .filter((m: any) => m?.extracted?.delivery?.status !== 'failed');
    if (delivered.length) {
      return { notified: false, reason: 'The customer was already told about this payment.' };
    }

    const [{ data: tenant }, { data: order }] = await Promise.all([
      serviceClient.from('tenants').select('business_name').eq('id', input.tenantId).maybeSingle(),
      input.orderId
        ? serviceClient.from('orders').select('order_ref').eq('tenant_id', input.tenantId).eq('id', input.orderId).maybeSingle()
        : Promise.resolve({ data: null } as any),
    ]);

    const text = paymentConfirmationText({
      customerName: conv.customer_name,
      businessName: (tenant as any)?.business_name ?? null,
      amount: input.amount,
      currency: input.currency,
      orderRef: (order as any)?.order_ref ?? null,
    });

    const extracted = { agent: 'shwari', department: 'orders', payment_confirmation: true, payment_id: input.paymentId };
    const { data: row, error: insertErr } = await serviceClient
      .from('conversation_messages')
      .insert({ tenant_id: input.tenantId, conversation_id: conv.id, sender: 'agent', body: text, extracted })
      .select('id')
      .maybeSingle();
    if (insertErr) {
      console.error('[payment-notice] could not record the confirmation:', insertErr.message);
      return { notified: false, reason: 'The confirmation could not be saved.' };
    }

    await serviceClient
      .from('conversations')
      .update({ last_message_at: new Date().toISOString(), last_message_preview: text.slice(0, 160) })
      .eq('id', conv.id)
      .eq('tenant_id', input.tenantId);

    // Web chat reads the transcript; the row above is the delivery.
    if (conv.channel_type === 'webchat') return { notified: true, channel: 'webchat' };

    const provider = getProvider(conv.channel_type);
    const channelId = conv.channel_id ?? (await activeChannel(input.tenantId, conv.channel_type));
    if (!provider || !channelId) {
      await markFailed(input.tenantId, (row as any)?.id, extracted, 'That channel is no longer connected.');
      return { notified: false, reason: 'That channel is no longer connected.' };
    }

    try {
      await provider.sendMessage(channelId, conv.customer_id, text, { tenantId: input.tenantId, userId: '' });
      return { notified: true, channel: conv.channel_type };
    } catch (e) {
      const reason = e instanceof ProviderError ? e.userMessage : 'The message could not be delivered.';
      console.error('[payment-notice] delivery failed:', e instanceof Error ? e.message : e);
      await markFailed(input.tenantId, (row as any)?.id, extracted, reason);
      return { notified: false, reason };
    }
  } catch (e) {
    console.error('[payment-notice] unexpected failure:', e instanceof Error ? e.message : e);
    return { notified: false, reason: 'The customer could not be notified.' };
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
