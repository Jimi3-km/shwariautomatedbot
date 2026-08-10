import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, MessageSquare, Save } from 'lucide-react';
import { getLead, getLeadStages, updateLead } from '../lib/api';
import type { LeadStage } from '../types';
import { useAsync, useMutation } from '../hooks';
import { useSession } from '../app/SessionContext';
import {
  Avatar, Button, Card, ErrorState, Field, InlineError, LoadingState,
  PageHeader, Pill, Select, Textarea, useToast,
} from '../components/ui';
import { formatDateTime, formatMoney, humanize } from '../lib/format';

export function LeadDetail() {
  const { leadId } = useParams();
  const navigate = useNavigate();
  const { canWrite, currency } = useSession();
  const toast = useToast();

  const state = useAsync(() => getLead(leadId!), [leadId]);
  const stagesState = useAsync(() => getLeadStages(), []);
  const [notes, setNotes] = useState('');
  const [notesDirty, setNotesDirty] = useState(false);

  useEffect(() => {
    if (state.data && !notesDirty) setNotes(state.data.lead.notes ?? '');
  }, [state.data, notesDirty]);

  const saveNotes = useMutation(async () => {
    await updateLead(leadId!, { notes });
    setNotesDirty(false);
    toast.push('success', 'Notes saved.');
    state.reload();
  });

  const changeStage = useMutation(async (stage: string) => {
    await updateLead(leadId!, { stage: stage as LeadStage });
    state.reload();
  });

  if (state.loading && !state.data) {
    return <><PageHeader title="Lead" /><LoadingState /></>;
  }
  if (state.error || !state.data) {
    return <><PageHeader title="Lead" /><ErrorState message={state.error ?? 'Lead not found'} onRetry={state.reload} /></>;
  }

  const { lead, conversation, orders, payments, timeline } = state.data;
  const stages = stagesState.data?.stages ?? [];
  const displayName = lead.customer_name || lead.customer_id;

  return (
    <>
      <PageHeader
        title={displayName}
        subtitle={`${lead.channel_type} · joined ${formatDateTime(lead.created_at)}`}
        actions={
          <>
            <Button size="sm" variant="subtle" icon={<ArrowLeft size={13} />} onClick={() => navigate('/leads')}>
              Back
            </Button>
            {conversation && (
              <Link to={`/inbox/${conversation.id}`}>
                <Button size="sm" variant="solid" icon={<MessageSquare size={13} />}>Open conversation</Button>
              </Link>
            )}
          </>
        }
      />

      <InlineError message={saveNotes.error ?? changeStage.error} />

      <div className="scroll-y" style={{ flex: 1, padding: 20 }}>
        <div style={{
          display: 'grid', gap: 16, maxWidth: 1100, margin: '0 auto',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        }}>

          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 14 }}>
              <Avatar name={displayName} seed={lead.customer_id} size={44} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{displayName}</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{lead.customer_id}</div>
              </div>
            </div>

            <Field label="Stage">
              {canWrite && stages.length > 0 ? (
                <Select
                  value={lead.stage ?? 'new'}
                  disabled={changeStage.busy}
                  onChange={(e) => changeStage.run(e.target.value)}
                  options={stages.map((s) => ({ value: s, label: humanize(s) }))}
                />
              ) : (
                <Pill tone="neutral">{humanize(lead.stage ?? 'new')}</Pill>
              )}
            </Field>

            <div style={{ marginTop: 14 }}>
              <div className="section-label" style={{ marginBottom: 7 }}>Contact</div>
              <Row label="Channel" value={lead.channel_type} />
              <Row label="Phone" value={lead.phone} />
              <Row label="Email" value={lead.email} />
              <Row label="Location" value={lead.delivery_location} />
              <Row label="Last contact" value={formatDateTime(lead.last_contact)} />
            </div>
          </Card>

          <Card>
            <div className="section-label" style={{ marginBottom: 9 }}>Interest</div>
            <Row label="Product" value={[lead.product_model, lead.product_storage, lead.product_condition].filter(Boolean).join(' ') || null} />
            <Row label="Price" value={lead.product_price != null ? formatMoney(lead.product_price, currency) : null} />
            <Row label="Upsells" value={lead.upsell_items} />
            <Row label="Payment method" value={lead.payment_method} />

            <div className="section-label" style={{ margin: '16px 0 9px' }}>Orders</div>
            {orders.length === 0 ? (
              <p style={{ fontSize: 12.5, color: 'var(--text-3)' }}>No orders yet.</p>
            ) : orders.map((o) => (
              <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
                <span className="mono" style={{ fontSize: 12, flex: 1 }}>{o.order_ref}</span>
                <span style={{ fontSize: 12.5 }}>{formatMoney(o.total, o.currency ?? currency)}</span>
                <Pill tone={o.status === 'delivered' ? 'success' : o.status === 'cancelled' ? 'danger' : 'info'}>
                  {humanize(o.status)}
                </Pill>
              </div>
            ))}

            <div className="section-label" style={{ margin: '16px 0 9px' }}>Payments</div>
            {payments.length === 0 ? (
              <p style={{ fontSize: 12.5, color: 'var(--text-3)' }}>No payment claims yet.</p>
            ) : payments.map((p) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
                <span className="mono" style={{ fontSize: 12, flex: 1 }}>{p.transaction_code || '—'}</span>
                <span style={{ fontSize: 12.5 }}>{formatMoney(p.amount, p.currency ?? currency)}</span>
                <Pill tone={
                  p.verification_status === 'verified' ? 'success'
                    : p.verification_status === 'rejected' ? 'danger' : 'warning'
                }>
                  {humanize(p.verification_status)}
                </Pill>
              </div>
            ))}
          </Card>

          <Card>
            <div className="section-label" style={{ marginBottom: 9 }}>Notes</div>
            <Textarea
              rows={6} value={notes} disabled={!canWrite}
              onChange={(e) => { setNotes(e.target.value); setNotesDirty(true); }}
              placeholder="Anything your team should know about this customer…"
            />
            {canWrite && (
              <Button
                size="sm" variant="solid" icon={<Save size={13} />} style={{ marginTop: 9 }}
                loading={saveNotes.busy} disabled={!notesDirty}
                onClick={() => saveNotes.run()}
              >
                Save notes
              </Button>
            )}
          </Card>

          <Card>
            <div className="section-label" style={{ marginBottom: 11 }}>Timeline</div>
            {timeline.length === 0 ? (
              <p style={{ fontSize: 12.5, color: 'var(--text-3)' }}>Nothing recorded yet.</p>
            ) : (
              <ol style={{ display: 'grid', gap: 12 }}>
                {timeline.map((entry, i) => (
                  <li key={`${entry.at}-${i}`} style={{ display: 'flex', gap: 10 }}>
                    <span style={{
                      width: 7, height: 7, borderRadius: 999, marginTop: 5, flexShrink: 0,
                      background: entry.kind === 'payment' ? 'var(--success)'
                        : entry.kind === 'order' ? 'var(--warning)' : 'var(--accent)',
                    }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13 }}>{entry.label}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{formatDateTime(entry.at)}</div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, padding: '4px 0' }}>
      <span style={{ color: 'var(--text-3)' }}>{label}</span>
      <span style={{ textAlign: 'right', wordBreak: 'break-word', textTransform: label === 'Channel' ? 'capitalize' : 'none' }}>
        {value || '—'}
      </span>
    </div>
  );
}
