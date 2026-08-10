import React, { useEffect, useState, useCallback } from 'react';
import { api, fmtMoney, fmtDate } from '../lib/api';
import { PageHeader, Badge, Empty, ErrorNote, inputStyle } from './Shell';

const STATES = ['pending', 'confirmed', 'delivered', 'cancelled'];
const TONE: Record<string, any> = { delivered: 'good', confirmed: 'info', cancelled: 'bad', pending: 'warn' };

export function Orders({ canWrite, currency }: { canWrite: boolean; currency: string }) {
  const [orders, setOrders] = useState<any[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = status ? `?status=${status}` : '';
      setOrders((await api<{ orders: any[] }>(`/orders${qs}`)).orders);
    } catch (e: any) { setError(e.message); }
  }, [status]);
  useEffect(() => { load(); }, [load]);

  async function setOrderStatus(id: string, next: string) {
    try {
      await api(`/orders/${id}`, { method: 'PATCH', body: { status: next } });
      setOrders((cur) => cur.map((o) => (o.id === id ? { ...o, status: next } : o)));
    } catch (e: any) { setError(e.message); }
  }

  return (
    <>
      <PageHeader title="Orders" subtitle="Every order placed through your channels." />
      <ErrorNote error={error} />

      <div className="px-6 pt-4 flex gap-2">
        <button onClick={() => setStatus('')} className="px-3 py-1.5 rounded-lg text-xs"
          style={{ background: status === '' ? 'var(--white)' : 'var(--surface-2)', color: status === '' ? 'var(--black)' : 'var(--text-2)' }}>
          All
        </button>
        {STATES.map((s) => (
          <button key={s} onClick={() => setStatus(s)} className="px-3 py-1.5 rounded-lg text-xs"
            style={{ background: status === s ? 'var(--white)' : 'var(--surface-2)', color: status === s ? 'var(--black)' : 'var(--text-2)' }}>
            {s}
          </button>
        ))}
      </div>

      <div className="p-6">
        {!orders.length ? <Empty message="No orders yet." /> : (
          <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid var(--border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>
                  {['Reference', 'Customer', 'Products', 'Amount', 'Payment', 'Status', 'Delivery', 'Created'].map((h) => (
                    <th key={h} className="text-left font-medium px-3 py-2 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-3 py-2 font-mono text-xs">{o.order_ref}</td>
                    <td className="px-3 py-2 text-xs">{o.customer_id || '—'}</td>
                    <td className="px-3 py-2 text-xs max-w-[220px] truncate">
                      {Array.isArray(o.items) && o.items.length
                        ? o.items.map((i: any) => i.name ?? i.product ?? 'item').join(', ')
                        : '—'}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{fmtMoney(o.total, o.currency || currency)}</td>
                    <td className="px-3 py-2">
                      <Badge tone={o.payment_status === 'paid' ? 'good' : 'warn'}>{o.payment_status}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      {canWrite ? (
                        <select value={o.status} onChange={(e) => setOrderStatus(o.id, e.target.value)}
                          className="px-2 py-1 rounded text-xs" style={inputStyle}>
                          {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      ) : <Badge tone={TONE[o.status]}>{o.status}</Badge>}
                    </td>
                    <td className="px-3 py-2 text-xs">{o.delivery_location || '—'}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap" style={{ color: 'var(--text-3)' }}>{fmtDate(o.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
