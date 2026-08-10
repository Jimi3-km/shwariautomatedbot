import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Search } from 'lucide-react';
import { getLeads, getLeadStages, updateLead } from '../lib/api';
import type { Lead, LeadStage } from '../types';
import { useAsync, useDebounced, useIsMobile } from '../hooks';
import { useSession } from '../app/SessionContext';
import {
  Avatar, EmptyState, ErrorState, FilterChip, InlineError, LoadingState,
  PageHeader, Pill, Select, TableWrap,
} from '../components/ui';
import { formatDateTime, formatMoney, humanize, relativeTime } from '../lib/format';

const STAGE_TONE: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  won: 'success', payment_verified: 'success', payment_claimed: 'warning',
  lost: 'danger', quoted: 'info', interested: 'info',
};

export function Leads() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { canWrite, currency } = useSession();

  const [search, setSearch] = useState('');
  const [stage, setStage] = useState<LeadStage | ''>('');
  const [channel, setChannel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const debouncedSearch = useDebounced(search, 300);

  // Stage vocabulary comes from the backend, never a frontend constant.
  const stagesState = useAsync(() => getLeadStages(), []);
  const stages = stagesState.data?.stages ?? [];

  const state = useAsync(
    (signal) => getLeads({
      search: debouncedSearch || undefined,
      stage: stage || undefined,
      channel_type: (channel || undefined) as never,
    }, signal),
    [debouncedSearch, stage, channel]
  );

  const leads = state.data?.leads ?? [];

  async function changeStage(lead: Lead, next: string) {
    setError(null);
    const previous = lead.stage;
    // Optimistic: stage changes are cheap to revert if the server refuses.
    state.setData((cur) => cur && ({
      ...cur, leads: cur.leads.map((l) => (l.id === lead.id ? { ...l, stage: next as LeadStage } : l)),
    }));
    try {
      await updateLead(lead.id, { stage: next as LeadStage });
    } catch (err) {
      state.setData((cur) => cur && ({
        ...cur, leads: cur.leads.map((l) => (l.id === lead.id ? { ...l, stage: previous } : l)),
      }));
      setError(err instanceof Error ? err.message : 'Could not update that lead.');
    }
  }

  return (
    <>
      <PageHeader title="Leads" subtitle="Every customer your AI agent has spoken to." />

      <div style={{ padding: '14px 20px 0', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', width: 260 }}>
          <Search size={14} style={{
            position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)',
          }} />
          <input
            className="field" style={{ paddingLeft: 30, height: 32 }}
            placeholder="Search name, contact or email"
            value={search} onChange={(e) => setSearch(e.target.value)}
            aria-label="Search leads"
          />
        </div>

        <Select
          aria-label="Filter by channel" value={channel}
          onChange={(e) => setChannel(e.target.value)} placeholder="All channels"
          options={[
            { value: 'telegram', label: 'Telegram' },
            { value: 'whatsapp', label: 'WhatsApp' },
            { value: 'instagram', label: 'Instagram' },
            { value: 'webchat', label: 'Web chat' },
          ]}
          style={{ height: 32, width: 160 }}
        />
      </div>

      <div style={{ padding: '10px 20px 0', display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        <FilterChip active={stage === ''} onClick={() => setStage('')}>All</FilterChip>
        {stages.map((s) => (
          <FilterChip key={s} active={stage === s} onClick={() => setStage(stage === s ? '' : s)}>
            {humanize(s)}
          </FilterChip>
        ))}
      </div>

      <InlineError message={error} onDismiss={() => setError(null)} />

      <div className="scroll-y" style={{ flex: 1, padding: 20 }}>
        {state.loading && !state.data ? (
          <LoadingState rows={6} />
        ) : state.error ? (
          <ErrorState message={state.error} onRetry={state.reload} />
        ) : leads.length === 0 ? (
          <EmptyState
            icon={<Users size={26} />}
            title={search || stage || channel ? 'No leads match those filters' : 'No leads yet'}
            body={
              search || stage || channel
                ? 'Try widening your search.'
                : 'Leads appear automatically as customers message you and share what they are looking for.'
            }
          />
        ) : isMobile ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {leads.map((l) => (
              <button key={l.id} onClick={() => navigate(`/leads/${l.id}`)}
                className="card p-3" style={{ textAlign: 'left', display: 'flex', gap: 10 }}>
                <Avatar name={l.customer_name ?? l.customer_id} seed={l.customer_id} size={34} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500 }}>{l.customer_name || l.customer_id}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 1 }}>
                    {l.product_model || 'No product yet'}
                  </div>
                  <div style={{ display: 'flex', gap: 5, marginTop: 6, alignItems: 'center' }}>
                    <Pill tone="neutral">{l.channel_type}</Pill>
                    <Pill tone={STAGE_TONE[l.stage ?? ''] ?? 'neutral'}>{humanize(l.stage ?? 'new')}</Pill>
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{relativeTime(l.last_contact)}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <TableWrap>
            <table className="tbl" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Customer</th><th>Channel</th><th>Contact</th><th>Product</th>
                  <th>Price</th><th>Location</th><th>Stage</th><th>Last contact</th><th>Created</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id} style={{ cursor: 'pointer' }}
                      onClick={() => navigate(`/leads/${l.id}`)}>
                    <td className="primary">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Avatar name={l.customer_name ?? l.customer_id} seed={l.customer_id} size={26} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 }}>
                            {l.customer_name || '—'}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{l.customer_id}</div>
                        </div>
                      </div>
                    </td>
                    <td><Pill tone="neutral">{l.channel_type}</Pill></td>
                    <td style={{ fontSize: 12 }}>
                      <div>{l.phone || '—'}</div>
                      {l.email && <div style={{ color: 'var(--text-3)' }}>{l.email}</div>}
                    </td>
                    <td style={{ fontSize: 12.5 }}>
                      {[l.product_model, l.product_storage, l.product_condition].filter(Boolean).join(' ') || '—'}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {l.product_price != null ? formatMoney(l.product_price, currency) : '—'}
                    </td>
                    <td style={{ fontSize: 12.5 }}>{l.delivery_location || '—'}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {canWrite && stages.length > 0 ? (
                        <Select
                          aria-label={`Stage for ${l.customer_name ?? l.customer_id}`}
                          value={l.stage ?? 'new'}
                          onChange={(e) => changeStage(l, e.target.value)}
                          options={stages.map((s) => ({ value: s, label: humanize(s) }))}
                          style={{ height: 28, fontSize: 12, width: 145 }}
                        />
                      ) : (
                        <Pill tone={STAGE_TONE[l.stage ?? ''] ?? 'neutral'}>{humanize(l.stage ?? 'new')}</Pill>
                      )}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                      {relativeTime(l.last_contact)}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                      {formatDateTime(l.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </div>
    </>
  );
}
