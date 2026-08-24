import React, { useState } from 'react';
import { LifeBuoy, Plus, Sparkles, Clock, X } from 'lucide-react';
import {
  getTickets, createTicket, updateTicket,
  getFollowUps, cancelFollowUp,
} from '../lib/api';
import type { SupportTicket, TicketStatus, TicketPriority, FollowUp } from '../types';
import type { AsyncState } from '../hooks';
import { useAsync, useMutation } from '../hooks';
import { useSession } from '../app/SessionContext';
import {
  Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, FilterChip,
  InlineError, Input, LoadingState, Modal, PageHeader, Pill, Select, Tabs,
  Textarea, useToast,
} from '../components/ui';
import { relativeTime } from '../lib/format';

/**
 * Two lists that both answer "what is the AI leaving for me": tickets it
 * opened or escalated, and messages it intends to send but has not sent yet.
 *
 * The queued follow-ups matter more than they look. An agent never messages a
 * customer directly — it writes the message here first — so this page is the
 * last point at which a person can read something before a customer does.
 */

const PRIORITY_TONE: Record<TicketPriority, 'danger' | 'warning' | 'info' | 'neutral'> = {
  urgent: 'danger', high: 'warning', normal: 'info', low: 'neutral',
};

const STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  waiting: 'Waiting',
  resolved: 'Resolved',
  closed: 'Closed',
};

export function Tickets() {
  const [tab, setTab] = useState('tickets');
  const pending = useAsync(() => getFollowUps('pending'), []);

  return (
    <>
      <PageHeader title="Support" subtitle="Issues to resolve, and messages waiting to go out." />

      <div className="px-5 pt-4">
        <Tabs
          active={tab}
          onChange={setTab}
          tabs={[
            { id: 'tickets', label: 'Tickets' },
            {
              id: 'followups',
              label: 'Queued messages',
              count: pending.data?.follow_ups.length || undefined,
            },
          ]}
        />
      </div>

      {tab === 'tickets' ? <TicketList /> : <FollowUpList state={pending} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

function TicketList() {
  const { canWrite } = useSession();
  const toast = useToast();
  const [filter, setFilter] = useState<TicketStatus | ''>('');
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<SupportTicket | null>(null);

  const state = useAsync(() => getTickets(filter || undefined), [filter]);

  return (
    <div className="p-5" style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <FilterChip active={filter === ''} onClick={() => setFilter('')}>All</FilterChip>
        {(Object.keys(STATUS_LABEL) as TicketStatus[]).map((s) => (
          <FilterChip key={s} active={filter === s} onClick={() => setFilter(s)}>
            {STATUS_LABEL[s]}
          </FilterChip>
        ))}
        {canWrite && (
          <Button
            size="sm" variant="accent" icon={<Plus size={14} />}
            onClick={() => setAdding(true)} style={{ marginLeft: 'auto' }}
          >
            New ticket
          </Button>
        )}
      </div>

      {state.loading && !state.data && <LoadingState rows={4} />}
      {state.error && <ErrorState message={state.error} onRetry={state.reload} />}

      {state.data && !state.data.tickets.length && (
        <EmptyState
          icon={<LifeBuoy size={22} />}
          title="Nothing outstanding"
          body="When an agent cannot resolve something, or hands a conversation to a person, it leaves a ticket here."
        />
      )}

      <div style={{ display: 'grid', gap: 8 }}>
        {(state.data?.tickets ?? []).map((t) => (
          <Card key={t.id} padded={false}>
            <button className="ticket-row" onClick={() => setOpen(t)}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                  <Pill tone={PRIORITY_TONE[t.priority]} dot>{t.priority}</Pill>
                  <span style={{ fontSize: 13.5, fontWeight: 550, wordBreak: 'break-word' }}>
                    {t.subject}
                  </span>
                  {t.opened_by_agent && (
                    <span
                      title={`Opened by the ${t.opened_by_agent} agent`}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--accent)' }}
                    >
                      <Sparkles size={11} /> AI
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 4 }}>
                  {t.customer_name || 'No customer'} · {relativeTime(t.created_at)}
                </div>
              </div>
              <Pill tone={t.status === 'resolved' || t.status === 'closed' ? 'success' : 'neutral'}>
                {STATUS_LABEL[t.status]}
              </Pill>
            </button>
          </Card>
        ))}
      </div>

      {adding && (
        <NewTicket
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); toast.push('success', 'Ticket opened.'); state.reload(); }}
        />
      )}

      {open && (
        <TicketDetail
          ticket={open}
          canWrite={canWrite}
          onClose={() => setOpen(null)}
          onSaved={() => { setOpen(null); state.reload(); }}
        />
      )}
    </div>
  );
}

function NewTicket({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [customer, setCustomer] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('normal');

  const save = useMutation(async () => {
    await createTicket({
      subject: subject.trim(),
      body: body.trim(),
      priority,
      customer_name: customer.trim() || undefined,
    });
    onSaved();
  });

  return (
    <Modal
      open onClose={onClose} title="New ticket"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="accent" loading={save.busy} disabled={!subject.trim()} onClick={() => save.run()}>
            Open ticket
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 13 }}>
        <InlineError message={save.error} />
        <Field label="Subject" required>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <Field label="Customer">
          <Input value={customer} onChange={(e) => setCustomer(e.target.value)} />
        </Field>
        <Field label="Priority">
          <Select
            value={priority}
            onChange={(e) => setPriority(e.target.value as TicketPriority)}
            options={[
              { value: 'low', label: 'Low' },
              { value: 'normal', label: 'Normal' },
              { value: 'high', label: 'High' },
              { value: 'urgent', label: 'Urgent' },
            ]}
          />
        </Field>
        <Field label="Details">
          <Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function TicketDetail({ ticket, canWrite, onClose, onSaved }: {
  ticket: SupportTicket;
  canWrite: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<TicketStatus>(ticket.status);
  const [resolution, setResolution] = useState(ticket.resolution ?? '');

  const save = useMutation(async () => {
    await updateTicket(ticket.id, { status, resolution: resolution.trim() || undefined });
    onSaved();
  });

  return (
    <Modal
      open onClose={onClose} title={ticket.subject} width={560}
      footer={canWrite && (
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="accent" loading={save.busy} onClick={() => save.run()}>Save</Button>
        </>
      )}
    >
      <div style={{ display: 'grid', gap: 14 }}>
        <InlineError message={save.error} />

        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          <Pill tone={PRIORITY_TONE[ticket.priority]} dot>{ticket.priority}</Pill>
          {ticket.customer_name && <Pill>{ticket.customer_name}</Pill>}
          {ticket.opened_by_agent && <Pill tone="accent">Opened by the {ticket.opened_by_agent} agent</Pill>}
        </div>

        {ticket.body && (
          <p style={{
            fontSize: 13, color: 'var(--text-2)', lineHeight: 1.65,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {ticket.body}
          </p>
        )}

        {canWrite ? (
          <>
            <Field label="Status">
              <Select
                value={status}
                onChange={(e) => setStatus(e.target.value as TicketStatus)}
                options={(Object.keys(STATUS_LABEL) as TicketStatus[])
                  .map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
              />
            </Field>
            <Field label="How it was resolved" hint="Kept with the ticket so the answer is not lost.">
              <Textarea rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} />
            </Field>
          </>
        ) : (
          ticket.resolution && (
            <Field label="Resolution">
              <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>{ticket.resolution}</p>
            </Field>
          )
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Queued follow-ups
// ---------------------------------------------------------------------------

function FollowUpList({ state }: { state: AsyncState<{ follow_ups: FollowUp[] }> }) {
  const { canWrite } = useSession();
  const toast = useToast();
  const [cancelling, setCancelling] = useState<FollowUp | null>(null);

  const cancel = useMutation(async (f: FollowUp) => {
    await cancelFollowUp(f.id);
    toast.push('success', 'That message will not be sent.');
    setCancelling(null);
    state.reload();
  });

  return (
    <div className="p-5" style={{ display: 'grid', gap: 14 }}>
      <InlineError message={cancel.error} />

      {state.loading && !state.data && <LoadingState rows={3} />}
      {state.error && <ErrorState message={state.error} onRetry={state.reload} />}

      {state.data && !state.data.follow_ups.length && (
        <EmptyState
          icon={<Clock size={22} />}
          title="Nothing queued"
          body="When an agent decides to check back with a customer who went quiet, the message waits here first — so you can read it before they do."
        />
      )}

      <div style={{ display: 'grid', gap: 8 }}>
        {(state.data?.follow_ups ?? []).map((f) => (
          <Card key={f.id}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                  <Pill tone="info" dot>Sends {relativeTime(f.due_at)}</Pill>
                  <span style={{ fontSize: 11.5, color: 'var(--text-3)', textTransform: 'capitalize' }}>
                    {f.channel_type}
                  </span>
                  {f.created_by_agent && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--accent)' }}>
                      <Sparkles size={11} /> {f.created_by_agent}
                    </span>
                  )}
                </div>

                <p style={{
                  fontSize: 13, marginTop: 7, lineHeight: 1.6,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {f.message}
                </p>

                {f.reason && (
                  <p style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 6 }}>
                    Why: {f.reason}
                  </p>
                )}
              </div>

              {canWrite && (
                <Button
                  size="sm" variant="subtle" icon={<X size={13} />}
                  onClick={() => setCancelling(f)}
                >
                  Cancel
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>

      <ConfirmDialog
        open={Boolean(cancelling)}
        title="Don't send this message?"
        body="It stays on record as cancelled, so you can see what the agent intended."
        confirmLabel="Don't send"
        busy={cancel.busy}
        onConfirm={() => cancelling && cancel.run(cancelling)}
        onCancel={() => setCancelling(null)}
      />
    </div>
  );
}
