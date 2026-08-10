import React, { useEffect, useState, useCallback } from 'react';
import { api, fmtMoney, fmtDate } from '../lib/api';
import { PageHeader, Badge, Empty, ErrorNote, inputStyle } from './Shell';

const STAGES = ['new', 'contacted', 'interested', 'quoted', 'payment_claimed', 'payment_verified', 'won', 'lost'];

const STAGE_TONE: Record<string, any> = {
  won: 'good', payment_verified: 'good', payment_claimed: 'warn', lost: 'bad', quoted: 'info',
};

export function Leads({ canWrite, currency }: { canWrite: boolean; currency: string }) {
  const [leads, setLeads] = useState<any[]>([]);
  const [stage, setStage] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (stage) qs.set('stage', stage);
      if (search.trim()) qs.set('search', search.trim());
      const r = await api<{ leads: any[] }>(`/leads?${qs}`);
      setLeads(r.leads);
    } catch (e: any) { setError(e.message); }
  }, [stage, search]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  async function updateStage(id: number, next: string) {
    try {
      await api(`/leads/${id}`, { method: 'PATCH', body: { stage: next } });
      setLeads((cur) => cur.map((l) => (l.id === id ? { ...l, stage: next } : l)));
    } catch (e: any) { setError(e.message); }
  }

  return (
    <>
      <PageHeader title="Leads" subtitle="Customers are identified by channel and customer ID, not by phone number alone." />
      <ErrorNote error={error} />

      <div className="px-6 pt-4 flex flex-wrap gap-2">
        <input
          value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, contact, email…"
          className="px-3 py-1.5 rounded-lg text-sm outline-none w-64" style={inputStyle}
        />
        <button
          onClick={() => setStage('')}
          className="px-3 py-1.5 rounded-lg text-xs"
          style={{ background: stage === '' ? 'var(--white)' : 'var(--surface-2)', color: stage === '' ? 'var(--black)' : 'var(--text-2)' }}
        >
          All
        </button>
        {STAGES.map((s) => (
          <button
            key={s} onClick={() => setStage(s)}
            className="px-3 py-1.5 rounded-lg text-xs"
            style={{ background: stage === s ? 'var(--white)' : 'var(--surface-2)', color: stage === s ? 'var(--black)' : 'var(--text-2)' }}
          >
            {s.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      <div className="p-6">
        {!leads.length ? <Empty message="No leads match this filter." /> : (
          <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid var(--border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>
                  {['Customer', 'Channel', 'Contact', 'Product', 'Price', 'Location', 'Stage', 'Last contact', 'Created'].map((h) => (
                    <th key={h} className="text-left font-medium px-3 py-2 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-3 py-2">
                      <div className="truncate max-w-[160px]">{l.customer_name || '—'}</div>
                      <div className="text-xs" style={{ color: 'var(--text-3)' }}>{l.customer_id}</div>
                    </td>
                    <td className="px-3 py-2"><Badge>{l.channel_type}</Badge></td>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-2)' }}>
                      <div>{l.phone || '—'}</div>
                      <div>{l.email || ''}</div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {[l.product_model, l.product_storage, l.product_condition].filter(Boolean).join(' ') || '—'}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{l.product_price ? fmtMoney(l.product_price, currency) : '—'}</td>
                    <td className="px-3 py-2 text-xs">{l.delivery_location || '—'}</td>
                    <td className="px-3 py-2">
                      {canWrite ? (
                        <select
                          value={l.stage ?? 'new'} onChange={(e) => updateStage(l.id, e.target.value)}
                          className="px-2 py-1 rounded text-xs" style={inputStyle}
                        >
                          {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      ) : (
                        <Badge tone={STAGE_TONE[l.stage] ?? 'neutral'}>{l.stage || 'new'}</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap" style={{ color: 'var(--text-3)' }}>{fmtDate(l.last_contact)}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap" style={{ color: 'var(--text-3)' }}>{fmtDate(l.created_at)}</td>
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
