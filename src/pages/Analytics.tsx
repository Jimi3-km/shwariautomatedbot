import React, { useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { getAnalytics } from '../lib/api';
import { useAsync } from '../hooks';
import { useSession } from '../app/SessionContext';
import {
  Card, EmptyState, ErrorState, FilterChip, LoadingState, PageHeader, StatTile,
} from '../components/ui';
import { AreaChart, BarList } from '../components/Chart';
import { formatMoney } from '../lib/format';

const WINDOWS = [7, 30, 90];

export function Analytics() {
  const [days, setDays] = useState(30);
  const { currency } = useSession();
  const state = useAsync(() => getAnalytics(days), [days]);

  const filters = (
    <div style={{ display: 'flex', gap: 5 }}>
      {WINDOWS.map((d) => (
        <FilterChip key={d} active={days === d} onClick={() => setDays(d)}>{d} days</FilterChip>
      ))}
    </div>
  );

  if (state.loading && !state.data) {
    return <><PageHeader title="Analytics" actions={filters} /><LoadingState /></>;
  }
  if (state.error) {
    return <><PageHeader title="Analytics" actions={filters} /><ErrorState message={state.error} onRetry={state.reload} /></>;
  }

  const a = state.data!;

  if (!a.has_data) {
    return (
      <>
        <PageHeader title="Analytics" subtitle={`Last ${days} days`} actions={filters} />
        <EmptyState
          icon={<BarChart3 size={26} />}
          title="No activity yet"
          body="Once customers start messaging you, your conversations, leads and revenue will be charted here. We never show estimated or sample figures."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Analytics" subtitle={`Last ${days} days`} actions={filters} />

      <div className="scroll-y" style={{ flex: 1, padding: 20 }}>
        <div style={{ display: 'grid', gap: 16, maxWidth: 1280, margin: '0 auto' }}>

          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            <StatTile label="Conversations" value={a.totals.conversations} />
            <StatTile label="Leads" value={a.totals.leads} />
            <StatTile label="Orders" value={a.totals.orders} />
            <StatTile label="Revenue" value={formatMoney(a.totals.revenue, currency)} tone="success" />
            <StatTile label="Conversion" value={`${a.totals.conversion_rate}%`} />
          </div>

          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
            <ChartCard title="Conversations over time">
              <AreaChart data={a.series.conversations} />
            </ChartCard>
            <ChartCard title="Leads over time">
              <AreaChart data={a.series.leads} color="var(--info)" />
            </ChartCard>
            <ChartCard title="Orders over time">
              <AreaChart data={a.series.orders} color="var(--warning)" />
            </ChartCard>
            <ChartCard title="Revenue over time" hint="Verified payments only">
              <AreaChart
                data={a.series.revenue} color="var(--success)"
                formatValue={(n) => formatMoney(n, currency)}
              />
            </ChartCard>
          </div>

          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
            <ChartCard title="AI vs human handling">
              <BarList items={[
                { label: 'Handled by AI', value: a.totals.ai_handled },
                { label: 'Needed a human', value: a.totals.human_handled },
              ]} />
            </ChartCard>

            <ChartCard title="Channel performance">
              {a.channels.length === 0 ? (
                <p style={{ fontSize: 12.5, color: 'var(--text-3)' }}>No channel activity in this period.</p>
              ) : (
                <BarList items={a.channels.map((c) => ({ label: c.channel, value: c.conversations }))} />
              )}
            </ChartCard>
          </div>
        </div>
      </div>
    </>
  );
}

function ChartCard({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card>
      <div style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 13.5, fontWeight: 600 }}>{title}</h2>
        {hint && <p style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 1 }}>{hint}</p>}
      </div>
      {children}
    </Card>
  );
}
