import React, { useMemo, useState } from 'react';
import { CalendarDays, Plus, Sparkles, User } from 'lucide-react';
import { getAppointments, createAppointment, updateAppointment } from '../lib/api';
import type { Appointment, AppointmentStatus } from '../types';
import { useAsync, useMutation } from '../hooks';
import { useSession } from '../app/SessionContext';
import {
  Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, FilterChip,
  InlineError, Input, LoadingState, Modal, PageHeader, Pill, Textarea, useToast,
} from '../components/ui';

/**
 * The diary.
 *
 * Agents book into the same table staff do, so this page is both the schedule
 * and the record of what the AI arranged. The one distinction drawn is who made
 * each booking — an appointment an agent took is worth a second look in a way
 * one a colleague took is not.
 */

const STATUS_TONE: Record<AppointmentStatus, 'success' | 'info' | 'neutral' | 'warning'> = {
  scheduled: 'info',
  completed: 'success',
  cancelled: 'neutral',
  no_show: 'warning',
};

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  scheduled: 'Scheduled',
  completed: 'Done',
  cancelled: 'Cancelled',
  no_show: 'No show',
};

export function Appointments() {
  const { canWrite } = useSession();
  const toast = useToast();
  const [filter, setFilter] = useState<AppointmentStatus | ''>('');
  const [adding, setAdding] = useState(false);
  const [cancelling, setCancelling] = useState<Appointment | null>(null);

  const state = useAsync(() => getAppointments(filter ? { status: filter } : {}), [filter]);

  const grouped = useMemo(() => groupByDay(state.data?.appointments ?? []), [state.data]);

  const cancel = useMutation(async (appointment: Appointment) => {
    await updateAppointment(appointment.id, { status: 'cancelled' });
    toast.push('success', 'Appointment cancelled.');
    setCancelling(null);
    state.reload();
  });

  const complete = useMutation(async (appointment: Appointment) => {
    await updateAppointment(appointment.id, { status: 'completed' });
    state.reload();
  });

  return (
    <>
      <PageHeader
        title="Appointments"
        subtitle="Everything booked, by your team and by your agents."
        actions={canWrite && (
          <Button size="sm" variant="accent" icon={<Plus size={14} />} onClick={() => setAdding(true)}>
            New
          </Button>
        )}
      />

      <div className="p-5" style={{ display: 'grid', gap: 16 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <FilterChip active={filter === ''} onClick={() => setFilter('')}>All</FilterChip>
          {(Object.keys(STATUS_LABEL) as AppointmentStatus[]).map((s) => (
            <FilterChip key={s} active={filter === s} onClick={() => setFilter(s)}>
              {STATUS_LABEL[s]}
            </FilterChip>
          ))}
        </div>

        <InlineError message={cancel.error || complete.error} />

        {state.loading && !state.data && <LoadingState rows={4} />}
        {state.error && <ErrorState message={state.error} onRetry={state.reload} />}

        {state.data && !grouped.length && (
          <EmptyState
            icon={<CalendarDays size={22} />}
            title="Nothing booked"
            body={
              filter
                ? 'No appointments with that status.'
                : 'When a customer books — or when you or an agent books for them — it appears here.'
            }
          />
        )}

        {grouped.map(([day, items]) => (
          <section key={day}>
            <div className="section-label" style={{ marginBottom: 8 }}>{day}</div>
            <div style={{ display: 'grid', gap: 8 }}>
              {items.map((a) => (
                <Card key={a.id} padded={false}>
                  <div className="appointment-row">
                    <div className="appointment-time">
                      <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.02em' }}>
                        {timeOf(a.starts_at)}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                        {a.duration_minutes} min
                      </div>
                    </div>

                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13.5, fontWeight: 550 }}>{a.service_name}</span>
                        <Pill tone={STATUS_TONE[a.status]} dot>{STATUS_LABEL[a.status]}</Pill>
                        {a.booked_by_agent && (
                          <span
                            title={`Booked by the ${a.booked_by_agent} agent`}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 3,
                              fontSize: 11, color: 'var(--accent)',
                            }}
                          >
                            <Sparkles size={11} /> AI
                          </span>
                        )}
                      </div>
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 5,
                        fontSize: 12, color: 'var(--text-2)', marginTop: 3,
                      }}>
                        <User size={11} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {a.customer_name || 'Unnamed customer'}
                        </span>
                      </div>
                      {a.notes && (
                        <p style={{
                          fontSize: 12, color: 'var(--text-3)', marginTop: 5,
                          lineHeight: 1.5, wordBreak: 'break-word',
                        }}>
                          {a.notes}
                        </p>
                      )}
                    </div>

                    {canWrite && a.status === 'scheduled' && (
                      <div className="appointment-actions">
                        <Button size="sm" variant="subtle" onClick={() => complete.run(a)}>Done</Button>
                        <Button size="sm" variant="subtle" onClick={() => setCancelling(a)}>Cancel</Button>
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          </section>
        ))}
      </div>

      {adding && (
        <NewAppointment
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); toast.push('success', 'Booked.'); state.reload(); }}
        />
      )}

      <ConfirmDialog
        open={Boolean(cancelling)}
        title="Cancel this appointment?"
        body={
          cancelling
            ? `${cancelling.service_name} with ${cancelling.customer_name || 'this customer'} on ${formatWhen(cancelling.starts_at)}. The customer is not told automatically.`
            : ''
        }
        confirmLabel="Cancel appointment"
        busy={cancel.busy}
        onConfirm={() => cancelling && cancel.run(cancelling)}
        onCancel={() => setCancelling(null)}
      />
    </>
  );
}

function NewAppointment({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [service, setService] = useState('');
  const [customer, setCustomer] = useState('');
  const [when, setWhen] = useState('');
  const [duration, setDuration] = useState('30');
  const [notes, setNotes] = useState('');

  const save = useMutation(async () => {
    await createAppointment({
      service_name: service.trim(),
      // A datetime-local value has no zone; the browser's own zone is the only
      // sensible reading of what the person typing it meant.
      starts_at: new Date(when).toISOString(),
      duration_minutes: Number(duration) || 30,
      customer_name: customer.trim() || undefined,
      notes: notes.trim() || undefined,
    });
    onSaved();
  });

  const valid = service.trim() && when && !Number.isNaN(new Date(when).getTime());

  return (
    <Modal
      open
      onClose={onClose}
      title="New appointment"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="accent" loading={save.busy} disabled={!valid} onClick={() => save.run()}>
            Book
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 13 }}>
        <InlineError message={save.error} />
        <Field label="Service" required>
          <Input value={service} onChange={(e) => setService(e.target.value)} placeholder="Cleaning" />
        </Field>
        <Field label="Customer">
          <Input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Who it is for" />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 10 }}>
          <Field label="When" required>
            <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </Field>
          <Field label="Minutes">
            <Input type="number" min={5} max={480} value={duration} onChange={(e) => setDuration(e.target.value)} />
          </Field>
        </div>
        <Field label="Notes">
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

function groupByDay(appointments: Appointment[]): Array<[string, Appointment[]]> {
  const days = new Map<string, Appointment[]>();
  for (const a of appointments) {
    const key = dayLabel(a.starts_at);
    const bucket = days.get(key);
    if (bucket) bucket.push(a);
    else days.set(key, [a]);
  }
  return [...days.entries()];
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86_400_000);

  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(date, today)) return 'Today';
  if (sameDay(date, tomorrow)) return 'Tomorrow';

  return date.toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

const formatWhen = (iso: string) => `${dayLabel(iso).toLowerCase()} at ${timeOf(iso)}`;
