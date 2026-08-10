import React, { useEffect, useState } from 'react';
import { api, fmtMoney, relativeTime } from '../lib/api';
import { Card, PageHeader, Badge, ErrorNote, Empty } from './Shell';

export function Overview({ currency, onNavigate }: { currency: string; onNavigate: (t: any) => void }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api('/overview').then(setData).catch((e) => setError(e.message));
  }, []);

  const s = data?.stats;
  const tiles = [
    { label: 'Total leads', value: s?.total_leads },
    { label: 'New this week', value: s?.new_leads },
    { label: 'Active conversations', value: s?.active_conversations },
    { label: 'Payment claims', value: s?.payment_claims, tone: 'warn' as const },
    { label: 'Verified payments', value: s?.verified_payments, tone: 'good' as const },
    { label: 'Sales', value: s ? fmtMoney(s.sales, currency) : undefined },
    { label: 'Conversion rate', value: s ? `${s.conversion_rate}%` : undefined },
  ];

  return (
    <>
      <PageHeader title="Overview" subtitle="Everything below is scoped to your business only." />
      <ErrorNote error={error} />

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {tiles.map((t) => (
            <Card key={t.label}>
              <div className="text-xs" style={{ color: 'var(--text-2)' }}>{t.label}</div>
              <div
                className="text-2xl font-semibold mt-1"
                style={{ color: t.tone === 'warn' ? '#fcd34d' : t.tone === 'good' ? '#6ee7b7' : 'var(--text)' }}
              >
                {t.value ?? '—'}
              </div>
            </Card>
          ))}
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium">Recent conversations</h2>
              <button className="text-xs" style={{ color: 'var(--text-2)' }} onClick={() => onNavigate('conversations')}>
                View all
              </button>
            </div>
            {!data?.recent_conversations?.length ? (
              <Empty message="No conversations yet." />
            ) : (
              <div className="space-y-2">
                {data.recent_conversations.map((c: any) => (
                  <button
                    key={c.id} onClick={() => onNavigate('conversations')}
                    className="w-full text-left flex items-center gap-3 py-2 border-b last:border-0"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{c.customer_name || c.customer_id}</div>
                      <div className="text-xs truncate" style={{ color: 'var(--text-3)' }}>
                        {c.last_message_preview || '—'}
                      </div>
                    </div>
                    {c.unread_count > 0 && <Badge tone="info">{c.unread_count}</Badge>}
                    <span className="text-xs" style={{ color: 'var(--text-3)' }}>{relativeTime(c.last_message_at)}</span>
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium">Recent leads</h2>
              <button className="text-xs" style={{ color: 'var(--text-2)' }} onClick={() => onNavigate('leads')}>
                View all
              </button>
            </div>
            {!data?.recent_leads?.length ? (
              <Empty message="No leads yet." />
            ) : (
              <div className="space-y-2">
                {data.recent_leads.map((l: any) => (
                  <div key={l.id} className="flex items-center gap-3 py-2 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{l.customer_name || l.customer_id}</div>
                      <div className="text-xs truncate" style={{ color: 'var(--text-3)' }}>
                        {l.product_model || '—'} · {l.channel_type}
                      </div>
                    </div>
                    <Badge>{l.stage || 'new'}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
