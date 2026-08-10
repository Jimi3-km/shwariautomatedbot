import React, { useEffect, useState, useCallback } from 'react';
import { api, fmtMoney, fmtDate } from '../lib/api';
import { PageHeader, Badge, Empty, ErrorNote } from './Shell';

const FILTERS = [
  { id: '', label: 'All' },
  { id: 'unverified', label: 'Unverified' },
  { id: 'verified', label: 'Verified' },
  { id: 'rejected', label: 'Rejected' },
];

/**
 * Payment claims. The AI records a claim as unverified and can do nothing
 * else; only a person can move it to verified, and the database rejects any
 * attempt to do so without a real staff user attached.
 */
export function Payments({ canWrite, currency }: { canWrite: boolean; currency: string }) {
  const [payments, setPayments] = useState<any[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = filter ? `?verification_status=${filter}` : '';
      setPayments((await api<{ payments: any[] }>(`/payments${qs}`)).payments);
    } catch (e: any) { setError(e.message); }
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  async function decide(id: string, decision: 'verified' | 'rejected') {
    setBusyId(id); setError(null);
    try {
      const reason = decision === 'rejected'
        ? window.prompt('Why is this claim being rejected? (optional)') ?? undefined
        : undefined;
      await api(`/payments/${id}/verify`, { method: 'POST', body: { decision, reason } });
      await load();
    } catch (e: any) { setError(e.message); }
    finally { setBusyId(null); }
  }

  async function issueReceipt(id: string) {
    setError(null);
    try {
      const r = await api<{ html: string }>(`/payments/${id}/receipt`, { method: 'POST' });
      setReceipt(r.html);
    } catch (e: any) { setError(e.message); }
  }

  return (
    <>
      <PageHeader
        title="Payments"
        subtitle="Customers claim a payment; you confirm it. The AI can never mark a payment verified."
      />
      <ErrorNote error={error} />

      <div className="px-6 pt-4 flex gap-2">
        {FILTERS.map((f) => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className="px-3 py-1.5 rounded-lg text-xs"
            style={{ background: filter === f.id ? 'var(--white)' : 'var(--surface-2)', color: filter === f.id ? 'var(--black)' : 'var(--text-2)' }}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="p-6">
        {!payments.length ? <Empty message="No payment claims yet." /> : (
          <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid var(--border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>
                  {['Customer', 'Transaction code', 'Amount', 'Method', 'Status', 'Claimed', 'Actions'].map((h) => (
                    <th key={h} className="text-left font-medium px-3 py-2 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-3 py-2">
                      <div className="truncate max-w-[160px]">{p.customer_id || p.customer_phone || '—'}</div>
                      {p.customer_email && <div className="text-xs" style={{ color: 'var(--text-3)' }}>{p.customer_email}</div>}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{p.transaction_code || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtMoney(p.amount, p.currency || currency)}</td>
                    <td className="px-3 py-2 text-xs">{p.payment_method || '—'}</td>
                    <td className="px-3 py-2">
                      <Badge tone={p.verification_status === 'verified' ? 'good' : p.verification_status === 'rejected' ? 'bad' : 'warn'}>
                        {p.verification_status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap" style={{ color: 'var(--text-3)' }}>{fmtDate(p.created_at)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {canWrite && p.verification_status === 'unverified' && (
                        <span className="flex gap-2">
                          <button disabled={busyId === p.id} onClick={() => decide(p.id, 'verified')}
                            className="px-2 py-1 rounded text-xs disabled:opacity-40" style={{ background: '#064e3b', color: '#6ee7b7' }}>
                            Verify
                          </button>
                          <button disabled={busyId === p.id} onClick={() => decide(p.id, 'rejected')}
                            className="px-2 py-1 rounded text-xs disabled:opacity-40" style={{ background: '#7f1d1d', color: '#fca5a5' }}>
                            Reject
                          </button>
                        </span>
                      )}
                      {canWrite && p.verification_status === 'verified' && (
                        <button onClick={() => issueReceipt(p.id)} className="text-xs" style={{ color: 'var(--text-2)' }}>
                          Receipt
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {receipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: 'rgba(0,0,0,.8)' }}
          onClick={() => setReceipt(null)}>
          <div className="bg-white rounded-xl overflow-hidden max-w-xl w-full max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
            <iframe title="Receipt" srcDoc={receipt} sandbox="" className="w-full h-[80vh] border-0" />
          </div>
        </div>
      )}
    </>
  );
}
