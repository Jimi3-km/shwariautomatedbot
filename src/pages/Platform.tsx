import React, { useMemo, useState } from 'react';
import { AlertTriangle, Building2, Check, LogIn, Pause, Play, ShieldCheck } from 'lucide-react';
import {
  getPlatformOverview, setBusinessStatus, setBusinessAgentsPaused, resolvePlatformAlert,
  type PlatformBusiness,
} from '../lib/api';
import { useAsync, useMutation } from '../hooks';
import { useSession } from '../app/SessionContext';
import {
  Button, Card, ConfirmDialog, EmptyState, ErrorState, FilterChip, InlineError, Input, LoadingState,
  PageHeader, Pill, StatTile, useToast, type PillTone,
} from '../components/ui';
import { MetaSetupCheck } from '../components/MetaSetupCheck';
import { EmailCheck } from '../components/EmailCheck';
import { SetupReadinessPanel } from '../components/SetupReadinessPanel';
import { formatDate, humanize, relativeTime } from '../lib/format';

const STATUS_TONE: Record<string, PillTone> = {
  pending: 'warning', active: 'success', trial: 'info', suspended: 'danger', cancelled: 'neutral',
};
const STATUS_LABEL: Record<string, string> = {
  pending: 'Waiting for approval', active: 'Live', trial: 'Trial', suspended: 'Suspended', cancelled: 'Cancelled',
};

type Filter = 'all' | 'pending' | 'live' | 'suspended';

/**
 * The platform console: every business on the platform, for the people who
 * run it. Opening a business here loads the ordinary dashboard for it in
 * support mode, where everything changed is logged for its owner to see.
 */
export function Platform() {
  const { switchTenant, tenant, memberships } = useSession();
  const toast = useToast();
  const state = useAsync(() => getPlatformOverview(), []);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [suspending, setSuspending] = useState<PlatformBusiness | null>(null);
  const [reason, setReason] = useState('');

  const setStatus = useMutation(async (b: PlatformBusiness, status: 'active' | 'suspended', why?: string) => {
    await setBusinessStatus(b.id, status, why);
    toast.push('success',
      status === 'suspended' ? `${b.business_name} is suspended.`
        : b.status === 'pending' ? `${b.business_name} is approved and live.`
        : `${b.business_name} is live again.`);
    setSuspending(null);
    setReason('');
    state.reload();
  });
  const setPaused = useMutation(async (b: PlatformBusiness, paused: boolean) => {
    await setBusinessAgentsPaused(b.id, paused);
    toast.push('success', paused ? `Agents paused for ${b.business_name}.` : `Agents resumed for ${b.business_name}.`);
    state.reload();
  });
  const resolve = useMutation(async (id: number) => {
    await resolvePlatformAlert(id);
    state.reload();
  });

  const businesses = state.data?.businesses ?? [];
  const alerts = state.data?.alerts ?? [];
  const totals = state.data?.totals;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return businesses.filter((b) => {
      if (filter === 'pending' && b.status !== 'pending') return false;
      if (filter === 'live' && b.status !== 'active' && b.status !== 'trial') return false;
      if (filter === 'suspended' && b.status !== 'suspended') return false;
      if (!q) return true;
      return b.business_name.toLowerCase().includes(q) || b.owners.some((o) => o.toLowerCase().includes(q));
    });
  }, [businesses, filter, query]);

  const nameOf = (id: string | null) => businesses.find((b) => b.id === id)?.business_name ?? null;

  if (state.loading && !state.data) return <><PageHeader title="Platform" /><LoadingState /></>;
  if (state.error) return <><PageHeader title="Platform" /><ErrorState message={state.error} onRetry={state.reload} /></>;

  return (
    <>
      <PageHeader title="Platform" subtitle="Every business on the platform, and what needs your attention." />
      <div className="scroll-y" style={{ flex: 1, padding: 20 }}>
        <div style={{ display: 'grid', gap: 16, maxWidth: 980, margin: '0 auto' }}>
          <InlineError message={setStatus.error ?? setPaused.error ?? resolve.error} />

          <div className="stat-grid" style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <StatTile label="Businesses" value={totals?.businesses ?? 0} />
            <StatTile label="Waiting for approval" value={totals?.pending ?? 0} />
            <StatTile label="Live" value={totals?.live ?? 0} />
            <StatTile label="Suspended" value={totals?.suspended ?? 0} />
          </div>

          {alerts.length > 0 && (
            <Card>
              <div className="section-label" style={{ marginBottom: 10 }}>Needs your attention</div>
              <div style={{ display: 'grid', gap: 8 }}>
                {alerts.map((a) => (
                  <div key={a.id} style={{
                    display: 'flex', gap: 10, padding: '10px 12px', alignItems: 'flex-start', flexWrap: 'wrap',
                    border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                    background: a.kind === 'new_business' ? 'var(--info-bg)' : 'var(--danger-bg)',
                  }}>
                    <AlertTriangle size={15} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 2 }} />
                    <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 550 }}>{a.summary}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 3, lineHeight: 1.5, overflowWrap: 'anywhere' }}>
                        {[nameOf(a.tenant_id), a.seen_count > 1 ? `${a.seen_count} times` : null, relativeTime(a.last_seen_at)]
                          .filter(Boolean).join(' · ')}
                      </div>
                      {a.detail && (
                        <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 4, overflowWrap: 'anywhere', fontFamily: 'ui-monospace, monospace' }}>
                          {a.detail}
                        </div>
                      )}
                    </div>
                    <Button size="sm" variant="subtle" icon={<Check size={12} />} loading={resolve.busy} onClick={() => resolve.run(a.id)}>
                      Done
                    </Button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
              <div className="section-label" style={{ flex: '1 1 120px' }}>Businesses</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(['all', 'pending', 'live', 'suspended'] as Filter[]).map((f) => (
                  <FilterChip key={f} active={filter === f} onClick={() => setFilter(f)}>
                    {f === 'all' ? 'All' : f === 'pending' ? 'Waiting' : humanize(f)}
                  </FilterChip>
                ))}
              </div>
              <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                <Input
                  aria-label="Search businesses" placeholder="Search by name or owner"
                  value={query} onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </div>

            {shown.length === 0 ? (
              <EmptyState icon={<Building2 size={20} />} title="No businesses match" body="Try a different filter or search." />
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {shown.map((b) => {
                  const isMine = memberships.some((m) => m.tenant_id === b.id);
                  const isOpen = tenant?.id === b.id;
                  return (
                    <div key={b.id} style={{
                      padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                      background: b.status === 'pending' ? 'var(--warning-bg, var(--surface-2))' : 'transparent',
                    }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 14, fontWeight: 600, overflowWrap: 'anywhere' }}>{b.business_name}</span>
                            <Pill tone={STATUS_TONE[b.status] ?? 'neutral'} dot>{STATUS_LABEL[b.status] ?? humanize(b.status)}</Pill>
                            {b.agents_paused && <Pill tone="warning">Agents paused</Pill>}
                            {isMine && <Pill tone="neutral">You're a member</Pill>}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4, lineHeight: 1.55, overflowWrap: 'anywhere' }}>
                            {b.owners.length ? b.owners.join(', ') : 'No owner on record'}
                            {b.business_category ? ` · ${b.business_category}` : ''}
                            {` · signed up ${formatDate(b.created_at)}`}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3, lineHeight: 1.55 }}>
                            {[
                              `${b.people} ${b.people === 1 ? 'person' : 'people'}`,
                              b.channels.length
                                ? b.channels.map((c) => `${humanize(c.type)}${c.status === 'active' ? '' : ' (off)'}`).join(', ')
                                : 'no channels',
                              `${b.conversations_7d} active conversation${b.conversations_7d === 1 ? '' : 's'} this week`,
                              b.last_message_at ? `last message ${relativeTime(b.last_message_at)}` : null,
                              b.payments_waiting ? `${b.payments_waiting} payment${b.payments_waiting === 1 ? '' : 's'} waiting` : null,
                              !b.onboarding_completed_at ? 'setup not finished' : null,
                            ].filter(Boolean).join(' · ')}
                          </div>
                          {b.status === 'suspended' && b.status_reason && (
                            <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 3 }}>Reason: {b.status_reason}</div>
                          )}
                        </div>

                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {b.status === 'pending' && (
                            <Button size="sm" variant="solid" icon={<Check size={13} />} loading={setStatus.busy}
                              onClick={() => setStatus.run(b, 'active')}>
                              Approve
                            </Button>
                          )}
                          {(b.status === 'suspended' || b.status === 'cancelled') && (
                            <Button size="sm" variant="outline" icon={<Play size={13} />} loading={setStatus.busy}
                              onClick={() => setStatus.run(b, 'active')}>
                              Reactivate
                            </Button>
                          )}
                          {(b.status === 'active' || b.status === 'trial') && (
                            <Button size="sm" variant="outline" icon={b.agents_paused ? <Play size={13} /> : <Pause size={13} />}
                              loading={setPaused.busy} onClick={() => setPaused.run(b, !b.agents_paused)}>
                              {b.agents_paused ? 'Resume agents' : 'Pause agents'}
                            </Button>
                          )}
                          {b.status !== 'suspended' && b.status !== 'cancelled' && (
                            <Button size="sm" variant="subtle" onClick={() => { setReason(''); setSuspending(b); }}>
                              Suspend
                            </Button>
                          )}
                          <Button size="sm" variant="subtle" icon={<LogIn size={13} />} disabled={isOpen}
                            onClick={() => switchTenant(b.id)}>
                            {isOpen ? 'Open now' : 'Open'}
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <div className="section-label" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <ShieldCheck size={14} /> Platform setup
          </div>
          <SetupReadinessPanel />
          <EmailCheck />
          <MetaSetupCheck />
        </div>
      </div>

      <ConfirmDialog
        open={!!suspending}
        title={`Suspend ${suspending?.business_name ?? 'this business'}?`}
        body="Its agents stop answering and its staff see that the business is suspended. Messages keep arriving in its inbox. You can reactivate it at any time."
        confirmLabel="Suspend"
        busy={setStatus.busy}
        onConfirm={() => suspending && setStatus.run(suspending, 'suspended', reason.trim() || undefined)}
        onCancel={() => setSuspending(null)}
      />
    </>
  );
}
