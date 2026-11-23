import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Search, Columns3, List, Flame } from 'lucide-react';
import { getLeads, getLeadStages, updateLead } from '../lib/api';
import type { Lead, LeadStage } from '../types';
import { useAsync, useDebounced, useIsMobile } from '../hooks';
import { useSession } from '../app/SessionContext';
import {
  Avatar, EmptyState, ErrorState, FilterChip, InlineError, LoadingState,
  PageHeader, Pill, Select, TableWrap,
} from '../components/ui';
import { formatDateTime, formatMoney, humanize, relativeTime, customerLabel } from '../lib/format';

const STAGE_TONE: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  won: 'success', payment_verified: 'success', payment_claimed: 'warning',
  lost: 'danger', quoted: 'info', interested: 'info',
};

type LeadsView = 'board' | 'list';
const VIEW_KEY = 'shwari-leads-view';

function readView(): LeadsView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'board';
  } catch {
    return 'board';
  }
}

/** Stages only a verified payment may set; a card cannot be dragged into them. */
const LOCKED_STAGES = new Set(['payment_verified', 'won']);

const TEMPERATURE_TONE: Record<string, 'danger' | 'warning' | 'neutral'> = {
  hot: 'danger', warm: 'warning', cold: 'neutral',
};

/**
 * The pipeline as a board: one column per stage, a card per customer.
 *
 * Cards move by dragging on a desktop and by the stage menu on each card
 * everywhere, so the board works by touch and by keyboard too. A move the
 * server refuses snaps back, exactly as it does in the list.
 */
function LeadsBoard({ leads, stages, canWrite, currency, onOpen, onMove }: {
  leads: Lead[]; stages: string[]; canWrite: boolean; currency: string;
  onOpen: (lead: Lead) => void; onMove: (lead: Lead, stage: string) => void;
}) {
  const [dragging, setDragging] = useState<Lead['id'] | null>(null);
  const [over, setOver] = useState<string | null>(null);

  // A lead whose stage the backend no longer lists still needs a column.
  const columns = [...stages];
  for (const l of leads) {
    const s = l.stage ?? 'new';
    if (!columns.includes(s)) columns.push(s);
  }

  return (
    <div className="board board-fill" role="list" aria-label="Leads by stage">
      {columns.map((stage) => {
        const cards = leads.filter((l) => (l.stage ?? 'new') === stage);
        const total = cards.reduce((sum, l) => sum + (Number(l.product_price) || 0), 0);
        const locked = LOCKED_STAGES.has(stage);
        const droppable = canWrite && !locked && dragging !== null;
        return (
          <section
            key={stage}
            role="listitem"
            aria-label={`${humanize(stage)}, ${cards.length} lead${cards.length === 1 ? '' : 's'}`}
            className={`board-column ${over === stage && droppable ? 'is-over' : ''}`}
            onDragOver={(e) => { if (droppable) { e.preventDefault(); setOver(stage); } }}
            onDragLeave={() => setOver((cur) => (cur === stage ? null : cur))}
            onDrop={(e) => {
              e.preventDefault();
              const lead = leads.find((l) => String(l.id) === String(dragging));
              setOver(null); setDragging(null);
              if (lead && droppable && (lead.stage ?? 'new') !== stage) onMove(lead, stage);
            }}
          >
            <header className="board-column-head">
              <Pill tone={STAGE_TONE[stage] ?? 'neutral'} dot>{humanize(stage)}</Pill>
              <span className="board-count">{cards.length}</span>
              <span style={{ flex: 1 }} />
              {total > 0 && <span className="board-total">{formatMoney(total, currency)}</span>}
            </header>

            <div className="scroll-y board-cards">
              {cards.length === 0 && (
                <div className="board-empty">{locked ? 'Set when a payment is verified' : 'No one here'}</div>
              )}
              {cards.map((l) => {
                const temperature = (l as any).temperature as string | undefined;
                const score = (l as any).score as number | undefined;
                return (
                  <article
                    key={l.id}
                    className={`board-card ${String(dragging) === String(l.id) ? 'is-dragging' : ''}`}
                    draggable={canWrite}
                    onDragStart={(e) => { setDragging(l.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(l.id)); }}
                    onDragEnd={() => { setDragging(null); setOver(null); }}
                  >
                    <button type="button" className="board-card-main" onClick={() => onOpen(l)}>
                      <Avatar name={customerLabel(l)} seed={l.customer_id} size={28} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span className="board-card-name">{customerLabel(l)}</span>
                        <span className="board-card-sub">
                          {[l.product_model, l.product_storage].filter(Boolean).join(' ') || humanize((l as any).intent ?? '') || 'No product yet'}
                        </span>
                      </span>
                    </button>

                    <div className="board-card-meta">
                      <Pill tone="neutral">{l.channel_type}</Pill>
                      {temperature && (
                        <Pill tone={TEMPERATURE_TONE[temperature] ?? 'neutral'}>
                          {temperature === 'hot' && <Flame size={10} />} {temperature}{typeof score === 'number' ? ` ${score}` : ''}
                        </Pill>
                      )}
                      <span style={{ flex: 1 }} />
                      {l.product_price != null && (
                        <span className="board-card-price">{formatMoney(l.product_price, currency)}</span>
                      )}
                    </div>

                    <div className="board-card-foot">
                      <span>{relativeTime(l.last_contact)}</span>
                      {canWrite && stages.length > 0 && (
                        <Select
                          aria-label={`Move ${customerLabel(l)} to another stage`}
                          value={l.stage ?? 'new'}
                          onChange={(e) => onMove(l, e.target.value)}
                          options={stages.map((s) => ({ value: s, label: humanize(s) }))}
                          className="board-move"
                        />
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function Leads() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { canWrite, currency } = useSession();

  const [view, setViewState] = useState<LeadsView>(readView);
  const setView = (next: LeadsView) => {
    setViewState(next);
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* storage unavailable */ }
  };

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
      <PageHeader
        title="Leads"
        subtitle="Every customer your AI agent has spoken to."
        actions={
          <div className="segmented" role="group" aria-label="View">
            <button type="button" aria-pressed={view === 'board'} onClick={() => { setView('board'); setStage(''); }}>
              <Columns3 size={14} /> Board
            </button>
            <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>
              <List size={14} /> List
            </button>
          </div>
        }
      />

      <div style={{ padding: '14px 20px 0', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 320 }}>
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
            { value: 'facebook', label: 'Facebook' },
            { value: 'webchat', label: 'Web chat' },
          ]}
          style={{ height: 32, flex: '0 1 160px', minWidth: 130 }}
        />
      </div>

      {/* The board already shows every stage side by side. */}
      {view === 'list' && (
        <div style={{ padding: '10px 20px 0', display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          <FilterChip active={stage === ''} onClick={() => setStage('')}>All</FilterChip>
          {stages.map((s) => (
            <FilterChip key={s} active={stage === s} onClick={() => setStage(stage === s ? '' : s)}>
              {humanize(s)}
            </FilterChip>
          ))}
        </div>
      )}

      <InlineError message={error} onDismiss={() => setError(null)} />

      {view === 'board' && state.data && !state.error && leads.length > 0 ? (
        <div className="board-wrap">
          <LeadsBoard
            leads={leads} stages={stages} canWrite={canWrite} currency={currency}
            onOpen={(l) => navigate(`/leads/${l.id}`)}
            onMove={changeStage}
          />
        </div>
      ) : (
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
                <Avatar name={customerLabel(l)} seed={l.customer_id} size={34} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500 }}>{customerLabel(l)}</div>
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
                        <Avatar name={customerLabel(l)} seed={l.customer_id} size={26} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 }}>
                            {customerLabel(l)}
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
                          aria-label={`Stage for ${customerLabel(l)}`}
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
      )}
    </>
  );
}
