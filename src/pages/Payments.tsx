import React, { useState } from 'react';
import { CreditCard, Check, X, Receipt, ShieldCheck } from 'lucide-react';
import { getPayments, verifyPayment, issueReceipt } from '../lib/api';
import type { Payment, VerificationStatus } from '../types';
import { useAsync, useIsMobile, useMutation } from '../hooks';
import { useSession } from '../app/SessionContext';
import {
  Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, FilterChip, InlineError,
  LoadingState, Modal, PageHeader, Pill, TableWrap, Textarea, useToast,
} from '../components/ui';
import { formatDateTime, formatMoney, humanize } from '../lib/format';

const FILTERS: Array<{ id: VerificationStatus | ''; label: string }> = [
  { id: '', label: 'All' },
  { id: 'unverified', label: 'Awaiting check' },
  { id: 'verified', label: 'Verified' },
  { id: 'rejected', label: 'Rejected' },
];

const TONE: Record<VerificationStatus, 'success' | 'warning' | 'danger'> = {
  verified: 'success', unverified: 'warning', rejected: 'danger',
};

/**
 * A customer claiming to have paid is not the same as a payment. Claims arrive
 * as `unverified` and only a person can move one to `verified` — the API
 * stamps who did it, and a database trigger rejects any verified row without a
 * real staff user attached.
 */
export function Payments() {
  const { canWrite, currency, refreshCounts } = useSession();
  const isMobile = useIsMobile();
  const toast = useToast();

  const [filter, setFilter] = useState<VerificationStatus | ''>('unverified');
  const state = useAsync(() => getPayments(filter || undefined), [filter]);

  const [confirming, setConfirming] = useState<Payment | null>(null);
  const [rejecting, setRejecting] = useState<Payment | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [receiptHtml, setReceiptHtml] = useState<string | null>(null);

  const decide = useMutation(async (id: string, decision: 'verified' | 'rejected', reason?: string) => {
    await verifyPayment(id, decision, reason);
    toast.push('success', decision === 'verified' ? 'Payment verified.' : 'Payment claim rejected.');
    setConfirming(null); setRejecting(null); setRejectReason('');
    state.reload();
    refreshCounts();
  });

  const receipt = useMutation(async (id: string) => {
    const r = await issueReceipt(id);
    setReceiptHtml(r.html);
    if (!r.delivery.sent) {
      toast.push('info', 'Receipt generated. Automatic delivery is not configured yet.');
    }
    state.reload();
  });

  const payments = state.data?.payments ?? [];

  return (
    <>
      <PageHeader
        title="Payments"
        subtitle="Customers claim a payment; you confirm it. Your AI agent can never mark a payment verified."
      />

      <div style={{ padding: '14px 20px 0', display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <FilterChip key={f.id} active={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</FilterChip>
        ))}
      </div>

      <InlineError message={decide.error ?? receipt.error} />

      <div className="scroll-y" style={{ flex: 1, padding: 20 }}>
        {state.loading && !state.data ? (
          <LoadingState rows={5} />
        ) : state.error ? (
          <ErrorState message={state.error} onRetry={state.reload} />
        ) : payments.length === 0 ? (
          <EmptyState
            icon={<CreditCard size={26} />}
            title={filter === 'unverified' ? 'Nothing awaiting your check' : 'No payments yet'}
            body={
              filter === 'unverified'
                ? 'When a customer says they have paid, the claim will appear here for you to verify.'
                : 'Payment claims appear here as customers report paying.'
            }
          />
        ) : isMobile ? (
          <div style={{ display: 'grid', gap: 10 }}>
            {payments.map((p) => (
              <Card key={p.id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ flex: 1, fontSize: 16, fontWeight: 600 }}>
                    {formatMoney(p.amount, p.currency ?? currency)}
                  </span>
                  <Pill tone={TONE[p.verification_status]}>{humanize(p.verification_status)}</Pill>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
                  {p.customer_id || p.customer_phone || 'Unknown customer'}
                </div>
                {p.transaction_code && (
                  <div className="mono" style={{ fontSize: 12, marginTop: 3 }}>{p.transaction_code}</div>
                )}
                <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 4 }}>
                  {formatDateTime(p.created_at)}
                </div>
                {canWrite && <Actions p={p} onVerify={setConfirming} onReject={setRejecting}
                  onReceipt={(id) => receipt.run(id)} busy={receipt.busy} />}
              </Card>
            ))}
          </div>
        ) : (
          <TableWrap>
            <table className="tbl" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Customer</th><th>Transaction code</th><th>Amount</th><th>Method</th>
                  <th>Status</th><th>Claimed</th><th>Verified</th><th></th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="primary">
                      <div>{p.customer_id || p.customer_phone || '—'}</div>
                      {p.customer_email && (
                        <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{p.customer_email}</div>
                      )}
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>{p.transaction_code || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}>
                      {formatMoney(p.amount, p.currency ?? currency)}
                    </td>
                    <td style={{ fontSize: 12.5 }}>{p.payment_method || '—'}</td>
                    <td>
                      <Pill tone={TONE[p.verification_status]}>{humanize(p.verification_status)}</Pill>
                      {p.rejected_reason && (
                        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{p.rejected_reason}</div>
                      )}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                      {formatDateTime(p.created_at)}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                      {p.verified_at ? formatDateTime(p.verified_at) : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {canWrite && <Actions p={p} onVerify={setConfirming} onReject={setRejecting}
                        onReceipt={(id) => receipt.run(id)} busy={receipt.busy} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(confirming)}
        title="Verify this payment?"
        body={
          confirming
            ? `Confirm you have checked your account and received ${formatMoney(confirming.amount, confirming.currency ?? currency)}${confirming.transaction_code ? ` under ${confirming.transaction_code}` : ''}. This is recorded against your name.`
            : ''
        }
        confirmLabel="Yes, I received it"
        tone="accent"
        busy={decide.busy}
        onCancel={() => setConfirming(null)}
        onConfirm={() => confirming && decide.run(confirming.id, 'verified')}
      />

      <Modal
        open={Boolean(rejecting)} onClose={() => setRejecting(null)} title="Reject payment claim" width={440}
        footer={
          <>
            <Button variant="subtle" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button variant="danger" loading={decide.busy}
              onClick={() => rejecting && decide.run(rejecting.id, 'rejected', rejectReason || undefined)}>
              Reject claim
            </Button>
          </>
        }
      >
        <Field label="Reason" hint="Optional, but useful for your own records.">
          <Textarea rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
            placeholder="No matching transaction found…" />
        </Field>
      </Modal>

      <Modal open={Boolean(receiptHtml)} onClose={() => setReceiptHtml(null)} title="Receipt" width={620}>
        {receiptHtml && (
          <iframe
            title="Receipt preview" srcDoc={receiptHtml} sandbox=""
            style={{ width: '100%', height: '60vh', border: 0, borderRadius: 'var(--radius)', background: '#fff' }}
          />
        )}
      </Modal>
    </>
  );
}

function Actions({
  p, onVerify, onReject, onReceipt, busy,
}: {
  p: Payment;
  onVerify: (p: Payment) => void;
  onReject: (p: Payment) => void;
  onReceipt: (id: string) => void;
  busy: boolean;
}) {
  if (p.verification_status === 'unverified') {
    return (
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
        <Button size="sm" variant="success" icon={<Check size={12} />} onClick={() => onVerify(p)}>Verify</Button>
        <Button size="sm" variant="danger" icon={<X size={12} />} onClick={() => onReject(p)}>Reject</Button>
      </div>
    );
  }
  if (p.verification_status === 'verified') {
    return (
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center', marginTop: 8 }}>
        <ShieldCheck size={13} style={{ color: 'var(--success)' }} />
        <Button size="sm" variant="outline" icon={<Receipt size={12} />} loading={busy}
          onClick={() => onReceipt(p.id)}>Receipt</Button>
      </div>
    );
  }
  return null;
}
