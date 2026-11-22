import { runInBackground } from './background.js';
import { deliverAlert } from './alerts.js';
import { serviceClient } from '../supabase.js';

/**
 * Things the team should hear about without going looking.
 *
 * A notification is a row the dashboard's bell reads. It is written where the
 * event happens - an agent recording an order, a customer claiming a payment,
 * a person verifying one, a conversation handed to a human - and never throws:
 * failing to announce something must not undo the thing itself.
 */

export type NotificationKind =
  | 'new_order' | 'payment_claim' | 'payment_verified' | 'needs_human'
  // Marketing (migration 0024 widens the check constraint to allow these).
  | 'posts_to_approve' | 'post_published' | 'post_failed';

export interface NotifyInput {
  tenantId: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  /** A dashboard path, e.g. /orders or /inbox/<conversation id>. */
  link?: string | null;
  /** The row it is about. The same kind + ref is only ever announced once. */
  refId?: string | null;
}

/** Set once the table is known to be missing (migration 0021 not applied). */
let available = true;

function missing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === 'PGRST205' || error.code === '42P01' ||
    (/notifications|receipts/.test(error.message ?? '') && /not exist|not find|schema cache/i.test(error.message ?? ''));
}

export async function notify(input: NotifyInput): Promise<boolean> {
  if (!available) return false;
  try {
    const { error } = await serviceClient.from('notifications').insert({
      tenant_id: input.tenantId,
      kind: input.kind,
      title: input.title.replace(/\s+/g, ' ').trim().slice(0, 200) || 'Update',
      body: (input.body ?? '').replace(/[ \t]+/g, ' ').trim().slice(0, 600),
      link: input.link ?? null,
      ref_id: input.refId ?? null,
    });
    if (!error) {
      // The same news goes to the owner's phone. Sent after the response, so
      // a slow WhatsApp call never holds up the thing being announced.
      void runInBackground('alerts', () =>
        deliverAlert(input.tenantId, input.kind, { title: input.title, body: input.body, link: input.link })
      );
      return true;
    }
    if (error.code === '23505') return false; // already announced
    if (missing(error)) { available = false; return false; }
    // 23514: the kind is newer than the table's check constraint (migration
    // 0024 not applied). The event still happened; it is just not announced.
    if (error.code === '23514') return false;
    console.warn('[notify] could not record a notification:', error.message);
    return false;
  } catch (e) {
    console.warn('[notify] failed:', e instanceof Error ? e.message : e);
    return false;
  }
}

export interface ReceiptLogInput {
  tenantId: string;
  paymentId?: string | null;
  orderId?: string | null;
  leadId?: number | null;
  orderRef?: string | null;
  amount?: number | string | null;
  currency?: string | null;
  textBody?: string;
  htmlBody?: string | null;
  sentInChat?: boolean;
  sentByEmail?: boolean;
  recipientEmail?: string | null;
  issuedBy?: string | null;
}

let receiptsAvailable = true;

/** Keep a copy of a receipt exactly as it was issued. */
export async function logReceipt(input: ReceiptLogInput): Promise<boolean> {
  if (!receiptsAvailable) return false;
  try {
    const amount = Number(input.amount);
    const { error } = await serviceClient.from('receipts').insert({
      tenant_id: input.tenantId,
      payment_id: input.paymentId ?? null,
      order_id: input.orderId ?? null,
      lead_id: input.leadId ?? null,
      order_ref: input.orderRef ?? null,
      amount: input.amount === null || input.amount === undefined || !Number.isFinite(amount) ? null : amount,
      currency: input.currency ?? null,
      text_body: (input.textBody ?? '').slice(0, 8000),
      html_body: input.htmlBody ? input.htmlBody.slice(0, 200_000) : null,
      sent_in_chat: Boolean(input.sentInChat),
      sent_by_email: Boolean(input.sentByEmail),
      recipient_email: input.recipientEmail ?? null,
      issued_by: input.issuedBy ?? null,
    });
    if (!error) return true;
    if (missing(error)) { receiptsAvailable = false; return false; }
    console.warn('[receipts] could not log a receipt:', error.message);
    return false;
  } catch (e) {
    console.warn('[receipts] failed:', e instanceof Error ? e.message : e);
    return false;
  }
}
