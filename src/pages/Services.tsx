import React, { useState } from 'react';
import { Wrench, Plus, Pencil, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getServices, createService, updateService, archiveService } from '../lib/api';
import type { Service, ServiceInput, BookingMode } from '../types';
import { useAsync, useMutation } from '../hooks';
import { useSession } from '../app/SessionContext';
import {
  Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, FilterChip,
  InlineError, Input, LoadingState, Modal, PageHeader, Pill, Select,
  Textarea, useToast,
} from '../components/ui';
import { formatMoney } from '../lib/format';

/**
 * What the business does, as opposed to what it sells.
 *
 * These are the rows the sales and booking agents read every time a customer
 * asks "do you do X?" or tries to book. Adding a service here and asking Shwari
 * to add one end up in the same place, so there is no second copy to keep in
 * step.
 *
 * `booking_mode` is the field that earns its keep: it is what stops the booking
 * agent offering a slot for something that needs a consultation first.
 */

const MODE_LABEL: Record<BookingMode, string> = {
  direct: 'Bookable directly',
  consultation: 'Consultation first',
  enquiry: 'Enquiry only',
};

const MODE_HINT: Record<BookingMode, string> = {
  direct: 'The agents can book this outright.',
  consultation: 'The agents book a consultation instead of the treatment.',
  enquiry: 'The agents take details and leave it to your team.',
};

const MODE_TONE: Record<BookingMode, 'success' | 'info' | 'neutral'> = {
  direct: 'success', consultation: 'info', enquiry: 'neutral',
};

export function Services() {
  const { canWrite, currency } = useSession();
  const toast = useToast();
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [adding, setAdding] = useState(false);
  const [archiving, setArchiving] = useState<Service | null>(null);

  const state = useAsync(() => getServices(), []);

  const archive = useMutation(async (service: Service) => {
    await archiveService(service.id);
    toast.push('success', `${service.name} is no longer offered.`);
    setArchiving(null);
    state.reload();
  });

  const all = state.data?.services ?? [];
  const services = showInactive ? all : all.filter((s) => s.active);

  return (
    <>
      <PageHeader
        title="Services"
        subtitle="What you do. Your agents answer from this list and book from it."
        actions={canWrite && (
          <Button size="sm" variant="accent" icon={<Plus size={14} />} onClick={() => setAdding(true)}>
            Add service
          </Button>
        )}
      />

      <div className="p-5" style={{ display: 'grid', gap: 14, maxWidth: 820 }}>
        <Card>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <Sparkles size={15} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} />
            <p style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.6 }}>
              You can add these by chatting instead —{' '}
              <Link to="/shwari" style={{ color: 'var(--accent)' }}>tell Shwari</Link>{' '}
              “we do cleaning, whitening and braces; braces need a consultation first”
              and it will set them up.
            </p>
          </div>
        </Card>

        {all.some((s) => !s.active) && (
          <div style={{ display: 'flex', gap: 6 }}>
            <FilterChip active={!showInactive} onClick={() => setShowInactive(false)}>
              Offered
            </FilterChip>
            <FilterChip active={showInactive} onClick={() => setShowInactive(true)}>
              Everything
            </FilterChip>
          </div>
        )}

        <InlineError message={archive.error} />

        {state.loading && !state.data && <LoadingState rows={3} />}
        {state.error && <ErrorState message={state.error} onRetry={state.reload} />}

        {state.data && !services.length && (
          <EmptyState
            icon={<Wrench size={22} />}
            title="No services yet"
            body="Add what you do — a haircut, a cleaning, a consultation — and your agents can start answering questions about it and booking it."
            action={canWrite && (
              <Button variant="accent" icon={<Plus size={14} />} onClick={() => setAdding(true)}>
                Add your first service
              </Button>
            )}
          />
        )}

        <div style={{ display: 'grid', gap: 8 }}>
          {services.map((s) => (
            <Card key={s.id}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{s.name}</span>
                    <Pill tone={MODE_TONE[s.booking_mode]} dot>{MODE_LABEL[s.booking_mode]}</Pill>
                    {!s.active && <Pill tone="neutral">Not offered</Pill>}
                  </div>

                  {s.description && (
                    <p style={{
                      fontSize: 12.5, color: 'var(--text-2)', marginTop: 5,
                      lineHeight: 1.55, wordBreak: 'break-word',
                    }}>
                      {s.description}
                    </p>
                  )}

                  <div style={{
                    display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 7,
                    fontSize: 12, color: 'var(--text-3)',
                  }}>
                    <span>
                      {s.price_amount != null
                        ? formatMoney(s.price_amount, currency)
                        : s.price_note || 'Price not fixed'}
                    </span>
                    {s.duration_minutes && <span>{s.duration_minutes} min</span>}
                  </div>
                </div>

                {canWrite && (
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <Button size="sm" icon={<Pencil size={12} />} onClick={() => setEditing(s)}>
                      Edit
                    </Button>
                    {s.active && (
                      <Button size="sm" variant="subtle" onClick={() => setArchiving(s)}>
                        Stop
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      </div>

      {(adding || editing) && (
        <ServiceEditor
          service={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={() => {
            toast.push('success', editing ? 'Updated.' : 'Added. Your agents can talk about it now.');
            setAdding(false);
            setEditing(null);
            state.reload();
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(archiving)}
        title="Stop offering this?"
        body={
          archiving
            ? `Your agents will stop mentioning and booking ${archiving.name}. Past appointments keep their record, and you can switch it back on any time.`
            : ''
        }
        confirmLabel="Stop offering"
        busy={archive.busy}
        onConfirm={() => archiving && archive.run(archiving)}
        onCancel={() => setArchiving(null)}
      />
    </>
  );
}

function ServiceEditor({ service, onClose, onSaved }: {
  service: Service | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { currency } = useSession();
  const [name, setName] = useState(service?.name ?? '');
  const [description, setDescription] = useState(service?.description ?? '');
  const [price, setPrice] = useState(service?.price_amount?.toString() ?? '');
  const [priceNote, setPriceNote] = useState(service?.price_note ?? '');
  const [duration, setDuration] = useState(service?.duration_minutes?.toString() ?? '');
  const [mode, setMode] = useState<BookingMode>(service?.booking_mode ?? 'enquiry');
  const [active, setActive] = useState(service?.active ?? true);

  const save = useMutation(async () => {
    const payload: ServiceInput = {
      name: name.trim(),
      description: description.trim(),
      // Empty means "not fixed", which is a different claim from zero — the
      // agents are required to say a price depends rather than quote nothing.
      price_amount: price.trim() === '' ? null : Number(price),
      price_note: priceNote.trim() || null,
      duration_minutes: duration.trim() === '' ? null : Number(duration),
      booking_mode: mode,
      active,
    };
    if (service) await updateService(service.id, payload);
    else await createService(payload);
    onSaved();
  });

  return (
    <Modal
      open onClose={onClose} title={service ? `Edit ${service.name}` : 'Add a service'} width={560}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="accent" loading={save.busy} disabled={!name.trim()} onClick={() => save.run()}>
            {service ? 'Save' : 'Add service'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 13 }}>
        <InlineError message={save.error} />

        <Field label="Name" hint="As a customer would say it." required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Teeth cleaning" />
        </Field>

        <Field label="Description" hint="What it involves. Your agents use this when a customer asks.">
          <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label={`Price (${currency ?? 'KES'})`} hint="Leave blank if it varies.">
            <Input
              type="number" min={0} step="0.01" value={price}
              onChange={(e) => setPrice(e.target.value)} placeholder="—"
            />
          </Field>
          <Field label="Length" hint="Minutes. Used when booking.">
            <Input
              type="number" min={5} max={480} value={duration}
              onChange={(e) => setDuration(e.target.value)} placeholder="30"
            />
          </Field>
        </div>

        {price.trim() === '' && (
          <Field label="What to say about price" hint="Used instead of a figure, so nobody has to guess.">
            <Input
              value={priceNote} onChange={(e) => setPriceNote(e.target.value)}
              placeholder="From 5,000 — depends on the case"
            />
          </Field>
        )}

        <Field label="How it can be booked" hint={MODE_HINT[mode]}>
          <Select
            value={mode}
            onChange={(e) => setMode(e.target.value as BookingMode)}
            options={(Object.keys(MODE_LABEL) as BookingMode[])
              .map((m) => ({ value: m, label: MODE_LABEL[m] }))}
          />
        </Field>

        {service && (
          <Field label="Status">
            <Select
              value={active ? 'yes' : 'no'}
              onChange={(e) => setActive(e.target.value === 'yes')}
              options={[
                { value: 'yes', label: 'Offered — agents can mention and book it' },
                { value: 'no', label: 'Not offered' },
              ]}
            />
          </Field>
        )}
      </div>
    </Modal>
  );
}
