import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MessageSquare, Users, Plug, ArrowRight } from 'lucide-react';
import { getOverview, getOnboarding } from '../lib/api';
import { useAsync } from '../hooks';
import { useSession } from '../app/SessionContext';
import {
  Avatar, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, Pill, StatTile,
} from '../components/ui';
import { OnboardingChecklist } from '../components/OnboardingChecklist';
import { formatMoney, humanize, relativeTime } from '../lib/format';

const CHANNELS: Array<{ type: string; label: string }> = [
  { type: 'telegram', label: 'Telegram' },
  { type: 'whatsapp', label: 'WhatsApp' },
];

export function Overview() {
  const { tenant, currency } = useSession();
  const overview = useAsync(() => getOverview(), []);
  const onboarding = useAsync(() => getOnboarding(), []);

  if (overview.loading && !overview.data) {
    return <><PageHeader title="Overview" /><LoadingState label="Loading your dashboard…" /></>;
  }
  if (overview.error) {
    return <><PageHeader title="Overview" /><ErrorState message={overview.error} onRetry={overview.reload} /></>;
  }

  const stats = overview.data!.stats;
  const channels = overview.data!.channels ?? [];
  const recentConversations = overview.data!.recent_conversations ?? [];
  const recentLeads = overview.data!.recent_leads ?? [];

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={tenant ? `What's happening at ${tenant.business_name}` : undefined}
      />

      <div className="scroll-y" style={{ flex: 1, padding: 20 }}>
        <div style={{ display: 'grid', gap: 16, maxWidth: 1280, margin: '0 auto' }}>

          {onboarding.data && !onboarding.data.dismissed && (
            <OnboardingChecklist data={onboarding.data} />
          )}

          <Group title="Conversations">
            <StatTile label="Total" value={stats.total_conversations} />
            <StatTile label="New this week" value={stats.new_conversations} />
            <StatTile label="Open" value={stats.active_conversations} />
            <StatTile label="Unread" value={stats.unread_conversations}
              tone={stats.unread_conversations > 0 ? 'info' : undefined} />
          </Group>

          <Group title="AI performance">
            <StatTile label="Handled by AI" value={stats.ai_conversations} tone="accent" />
            <StatTile label="Needed a human" value={stats.human_conversations}
              tone={stats.human_conversations > 0 ? 'warning' : undefined} />
            <StatTile label="AI handling rate" value={`${stats.ai_resolution_rate}%`}
              hint="Share of conversations the AI still owns" />
            <StatTile label="Conversion rate" value={`${stats.conversion_rate}%`} />
          </Group>

          <Group title="Leads">
            <StatTile label="Total" value={stats.total_leads} />
            <StatTile label="New this week" value={stats.new_leads} />
            <StatTile label="Qualified" value={stats.qualified_leads} />
            <StatTile label="Converted" value={stats.converted_leads} tone="success" />
          </Group>

          <Group title="Sales">
            <StatTile label="Revenue" value={formatMoney(stats.sales, currency)} tone="success"
              hint="From verified payments only" />
            <StatTile label="Payment claims" value={stats.payment_claims}
              tone={stats.payment_claims > 0 ? 'warning' : undefined} hint="Awaiting your check" />
            <StatTile label="Verified payments" value={stats.verified_payments} />
            <StatTile label="Orders" value={stats.total_orders} />
          </Group>

          <ChannelStatus channels={channels} />

          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
            <RecentConversations items={recentConversations} />
            <RecentLeads items={recentLeads} currency={currency} />
          </div>
        </div>
      </div>
    </>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="section-label" style={{ marginBottom: 8 }}>{title}</div>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        {children}
      </div>
    </section>
  );
}

function ChannelStatus({ channels }: { channels: Array<{ channel_type: string; status: string; display_name: string | null }> }) {
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>Channels</h2>
        <Link to="/integrations" style={{ fontSize: 12.5, color: 'var(--text-2)' }}>Manage</Link>
      </div>
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        {CHANNELS.map(({ type, label }) => {
          const found = channels.find((c) => c.channel_type === type && c.status === 'active');
          return (
            <div key={type} style={{
              display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px',
              background: 'var(--surface-2)', borderRadius: 'var(--radius)',
            }}>
              <Plug size={15} style={{ color: found ? 'var(--success)' : 'var(--text-4)' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13 }}>{label}</div>
                {found?.display_name && (
                  <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{found.display_name}</div>
                )}
              </div>
              <Pill tone={found ? 'success' : 'neutral'} dot>
                {found ? 'Connected' : 'Not connected'}
              </Pill>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function RecentConversations({ items }: { items: Array<any> }) {
  const navigate = useNavigate();
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>Recent conversations</h2>
        <Link to="/inbox" style={{ fontSize: 12.5, color: 'var(--text-2)' }}>View all</Link>
      </div>
      {items.length === 0 ? (
        <EmptyState
          icon={<MessageSquare size={22} />}
          title="No conversations yet"
          body="Connect Telegram or WhatsApp to start receiving customer conversations."
          action={<Button size="sm" variant="solid" onClick={() => navigate('/integrations')} icon={<ArrowRight size={13} />}>Connect a channel</Button>}
        />
      ) : (
        <div>
          {items.map((c) => (
            <button key={c.id} onClick={() => navigate(`/inbox/${c.id}`)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 9,
                padding: '8px 0', borderBottom: '1px solid var(--border)', textAlign: 'left',
              }}>
              <Avatar name={c.customer_name ?? c.customer_id} seed={c.customer_id} size={28} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.customer_name || c.customer_id}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.last_message_preview || '—'}
                </div>
              </div>
              {c.unread_count > 0 && <Pill tone="info">{c.unread_count}</Pill>}
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{relativeTime(c.last_message_at)}</span>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

function RecentLeads({ items, currency }: { items: Array<any>; currency: string | null }) {
  const navigate = useNavigate();
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>Recent leads</h2>
        <Link to="/leads" style={{ fontSize: 12.5, color: 'var(--text-2)' }}>View all</Link>
      </div>
      {items.length === 0 ? (
        <EmptyState
          icon={<Users size={22} />}
          title="No leads yet"
          body="Leads are created automatically as customers tell your AI agent what they want."
        />
      ) : (
        <div>
          {items.map((l) => (
            <button key={l.id} onClick={() => navigate(`/leads/${l.id}`)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 9,
                padding: '8px 0', borderBottom: '1px solid var(--border)', textAlign: 'left',
              }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {l.customer_name || l.customer_id}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                  {l.product_model || '—'} · {l.channel_type}
                </div>
              </div>
              {l.product_price != null && (
                <span style={{ fontSize: 12.5 }}>{formatMoney(l.product_price, currency)}</span>
              )}
              <Pill tone="neutral">{humanize(l.stage ?? 'new')}</Pill>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
