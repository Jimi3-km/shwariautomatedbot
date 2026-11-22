import React, { useMemo, useState } from 'react';
import { BadgeCheck, Ban, FileDown, FileText, Plus, Send, Trash2 } from 'lucide-react';
import {
  getInvoices, getInvoiceOptions, createInvoice, sendInvoice, markInvoicePaid, voidInvoice,
  type Invoice, type InvoiceDelivery,
} from '../lib/api';
import { useAsync, useDebounced, useIsMobile, useMutation } from '../hooks';
import { useSession } from '../app/SessionContext';
import {
  Button, Card, ConfirmDialog, EmptyState, ErrorState, Field, FilterChip, InlineError, Input, LoadingState,
  Modal, PageHeader, Pill, Select, StatTile, TableWrap, Textarea, useToast, ActionMenu,
  type MenuItem, type PillTone,
} from '../components/ui';
import { formatDate, formatMoney } from '../lib/format';

const TONE: Record<string, PillTone> = { draft: 'neutral', sent: 'info', overdue: 'danger', paid: 'success', void: 'neutral' };
const LABEL: Record<string, string> = { draft: 'Draft', sent: 'Awaiting payment', overdue: 'Overdue', paid: 'Paid', void: 'Cancelled' };
const FILTERS: Array<{ id: string; label: string }> = [
  { id: '', label: 'All' }, { id: 'sent', label: 'Awaiting payment' }, { id: 'overdue', label: 'Overdue' },
  { id: 'paid', label: 'Paid' }, { id: 'draft', label: 'Drafts' }, { id: 'void', label: 'Cancelled' },
];

/** Says in one line where an invoice went, and what did not work. */
function deliveryNote(d: InvoiceDelivery): { ok: boolean; text: string } {
  const went = [
    d.chat.sent ? `their ${d.chat.channel === 'webchat' ? 'web chat' : d.chat.channel} chat${d.chat.file === false ? ' (as a link)' : ''}` : null,
    d.email.sent ? 'their email' : null,
  ].filter(Boolean);
  if (went.length) return { ok: true, text: `Sent as a PDF to ${went.join(' and ')}.` };
  return { ok: false, text: `Not sent. Chat: ${d.chat.reason ?? 'not sent'} Email: ${d.email.reason ?? 'not sent'}` };
}

/**
 * Invoices: raise one, send it to the customer as a PDF, and mark it paid once
 * the money has been checked. A customer's payment message for an invoice also
 * arrives on the Payments page; verifying it there marks the invoice paid.
 */
export function Invoices() {
  const { canWrite, currency } = useSession();
  const isMobile = useIsMobile();
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const query = useDebounced(search, 300);
  const state = useAsync(() => getInvoices({ status, search: query }), [status, query]);

  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<Invoice | null>(null);
  const [voiding, setVoiding] = useState<Invoice | null>(null);

  const send = useMutation(async (inv: Invoice) => {
    const r = await sendInvoice(inv.id);
    const note = deliveryNote(r.delivery);
    toast.push(note.ok ? 'success' : 'error', note.text);
    state.reload();
  });
  const cancel = useMutation(async (inv: Invoice) => {
    await voidInvoice(inv.id);
    setVoiding(null);
    toast.push('success', `Invoice ${inv.invoice_no} cancelled.`);
    state.reload();
  });

  const invoices = state.data?.invoices ?? [];
  const summary = state.data?.summary;
  const cur = invoices[0]?.currency ?? currency ?? '';

  // One main action per row: send a draft, or confirm payment once it is
  // with the customer. Everything else sits behind the menu, so a row stays
  // one line tall.
  const actions = (inv: Invoice) => {
    const open = inv.status === 'draft' || inv.status === 'sent';
    const more: MenuItem[] = [
      ...(inv.pdf_url ? [{ label: 'Open PDF', icon: <FileDown size={14} />, href: inv.pdf_url }] : []),
      ...(canWrite && inv.status === 'sent' ? [{ label: 'Send again', icon: <Send size={14} />, onSelect: () => { void send.run(inv); } }] : []),
      ...(canWrite && inv.status === 'draft' ? [{ label: 'Mark paid', icon: <BadgeCheck size={14} />, onSelect: () => setPaying(inv) }] : []),
      ...(canWrite && open ? [{ label: 'Cancel invoice', icon: <Ban size={14} />, tone: 'danger' as const, onSelect: () => setVoiding(inv) }] : []),
    ];
    return (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: isMobile ? 'flex-start' : 'flex-end' }}>
        {canWrite && inv.status === 'draft' && (
          <Button size="sm" variant="accent" icon={<Send size={13} />} loading={send.busy} onClick={() => send.run(inv)}>
            Send
          </Button>
        )}
        {canWrite && inv.status === 'sent' && (
          <Button size="sm" variant="success" icon={<BadgeCheck size={13} />} onClick={() => setPaying(inv)}>
            Mark paid
          </Button>
        )}
        <ActionMenu items={more} label={`More actions for invoice ${inv.invoice_no}`} />
      </div>
    );
  };

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle="Bill customers, send the invoice as a PDF, and confirm when it is paid."
        actions={canWrite && (
          <Button variant="accent" size="sm" icon={<Plus size={14} />} onClick={() => setCreating(true)}>New invoice</Button>
        )}
      />

      <div className="scroll-y" style={{ flex: 1, padding: 20 }}>
        <div style={{ display: 'grid', gap: 14 }}>
          <InlineError message={send.error ?? cancel.error} />

          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <StatTile label="Awaiting payment" value={formatMoney(summary?.outstanding ?? 0, cur)}
              hint={`${summary?.outstanding_count ?? 0} invoice${summary?.outstanding_count === 1 ? '' : 's'}`} />
            <StatTile label="Overdue" value={formatMoney(summary?.overdue ?? 0, cur)} tone={summary?.overdue_count ? 'danger' : undefined}
              hint={`${summary?.overdue_count ?? 0} past the due date`} />
            <StatTile label="Paid this month" value={formatMoney(summary?.paid_this_month ?? 0, cur)} tone="success" />
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: '1 1 320px' }}>
              {FILTERS.map((f) => (
                <FilterChip key={f.id} active={status === f.id} onClick={() => setStatus(f.id)}>{f.label}</FilterChip>
              ))}
            </div>
            <div style={{ flex: '0 1 240px', minWidth: 0 }}>
              <Input aria-label="Search invoices" placeholder="Search number or customer"
                value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>

          {state.loading && !state.data ? (
            <LoadingState />
          ) : state.error ? (
            <ErrorState message={state.error} onRetry={state.reload} />
          ) : invoices.length === 0 ? (
            <EmptyState
              icon={<FileText size={26} />}
              title={status || query ? 'No invoices match' : 'No invoices yet'}
              body={status || query ? 'Try a different filter or search.' : 'Raise an invoice for a customer and send it to their chat and email as a PDF.'}
              action={canWrite && !status && !query
                ? <Button variant="accent" icon={<Plus size={14} />} onClick={() => setCreating(true)}>New invoice</Button>
                : undefined}
            />
          ) : isMobile ? (
            <div style={{ display: 'grid', gap: 10 }}>
              {invoices.map((inv) => (
                <Card key={inv.id}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="mono" style={{ flex: 1, fontSize: 12.5 }}>{inv.invoice_no}</span>
                    <Pill tone={TONE[inv.display_status]} dot>{LABEL[inv.display_status]}</Pill>
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 600, marginTop: 6 }}>{formatMoney(inv.total, inv.currency)}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 3, overflowWrap: 'anywhere' }}>
                    {inv.customer_name}{inv.due_date ? ` · due ${formatDate(inv.due_date)}` : ''}
                  </div>
                  <div style={{ marginTop: 10 }}>{actions(inv)}</div>
                </Card>
              ))}
            </div>
          ) : (
            <TableWrap>
              <table className="tbl" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Number</th><th>Customer</th><th>Amount</th><th>Status</th>
                    <th>Issued</th><th>Due</th><th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id}>
                      <td className="mono primary" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{inv.invoice_no}</td>
                      <td style={{ fontSize: 13, maxWidth: 220 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.customer_name}</div>
                        {inv.sent_via && (
                          <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>sent via {inv.sent_via}</div>
                        )}
                      </td>
                      <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}>{formatMoney(inv.total, inv.currency)}</td>
                      <td><Pill tone={TONE[inv.display_status]} dot>{LABEL[inv.display_status]}</Pill></td>
                      <td style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{formatDate(inv.issue_date)}</td>
                      <td style={{ fontSize: 12.5, whiteSpace: 'nowrap', color: inv.display_status === 'overdue' ? 'var(--danger)' : undefined }}>
                        {inv.due_date ? formatDate(inv.due_date) : '—'}
                      </td>
                      <td>{actions(inv)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </div>
      </div>

      {creating && (
        <NewInvoiceDialog
          onClose={() => setCreating(false)}
          onDone={(note) => { setCreating(false); toast.push(note.ok ? 'success' : 'error', note.text); state.reload(); }}
        />
      )}
      {paying && (
        <MarkPaidDialog
          invoice={paying}
          onClose={() => setPaying(null)}
          onDone={() => { setPaying(null); toast.push('success', 'Marked paid. The customer has been sent their receipt.'); state.reload(); }}
        />
      )}
      <ConfirmDialog
        open={!!voiding}
        title={`Cancel invoice ${voiding?.invoice_no ?? ''}?`}
        body="It stays on record as cancelled and can no longer be paid. Raise a new invoice if the customer still owes you."
        confirmLabel="Cancel invoice"
        busy={cancel.busy}
        onConfirm={() => voiding && cancel.run(voiding)}
        onCancel={() => setVoiding(null)}
      />
    </>
  );
}

interface Line { name: string; qty: string; price: string }

function NewInvoiceDialog({ onClose, onDone }: {
  onClose: () => void; onDone: (note: { ok: boolean; text: string }) => void;
}) {
  const options = useAsync(() => getInvoiceOptions(), []);
  const [leadId, setLeadId] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [lines, setLines] = useState<Line[]>([{ name: '', qty: '1', price: '' }]);
  const [discount, setDiscount] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');

  const settings = options.data?.settings;
  const cur = options.data?.currency ?? '';
  const customers = options.data?.customers ?? [];
  const catalogue = options.data?.catalogue ?? [];
  const chosen = customers.find((c) => String(c.id) === leadId);

  const totals = useMemo(() => {
    const subtotal = lines.reduce((s, l) => s + (Number(l.price) || 0) * (Number(l.qty) || 0), 0);
    const disc = Math.min(Math.max(Number(discount) || 0, 0), subtotal);
    const tax = ((subtotal - disc) * (settings?.tax_rate ?? 0)) / 100;
    return { subtotal, disc, tax, total: subtotal - disc + tax };
  }, [lines, discount, settings?.tax_rate]);

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const pickItem = (i: number, value: string) => {
    const item = catalogue.find((c) => c.name === value);
    setLine(i, { name: value, ...(item && item.price !== null ? { price: String(item.price) } : {}) });
  };

  const valid = (leadId || name.trim()) && lines.some((l) => l.name.trim() && l.price !== '' && Number(l.price) >= 0);

  const save = useMutation(async (sendNow: boolean) => {
    const r = await createInvoice({
      lead_id: leadId ? Number(leadId) : null,
      customer_name: leadId ? undefined : name.trim(),
      customer_email: email.trim() || undefined,
      items: lines.filter((l) => l.name.trim() && l.price !== '').map((l) => ({ name: l.name.trim(), qty: Number(l.qty) || 1, price: Number(l.price) })),
      discount: Number(discount) || 0,
      due_date: dueDate || undefined,
      notes: notes.trim() || undefined,
      send: sendNow,
    });
    if (!sendNow || !r.delivery) return onDone({ ok: true, text: `Invoice ${r.invoice.invoice_no} saved as a draft.` });
    const note = deliveryNote(r.delivery);
    onDone({ ok: note.ok, text: `Invoice ${r.invoice.invoice_no}. ${note.text}` });
  });

  return (
    <Modal
      open onClose={onClose} title="New invoice" width={680}
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>Close</Button>
          <Button variant="outline" loading={save.busy} disabled={!valid} onClick={() => save.run(false)}>Save as draft</Button>
          <Button variant="solid" icon={<Send size={14} />} loading={save.busy} disabled={!valid} onClick={() => save.run(true)}>
            Create and send
          </Button>
        </>
      }
    >
      {options.loading && !options.data ? <LoadingState rows={4} /> : options.error ? (
        <ErrorState message={options.error} onRetry={options.reload} />
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          <InlineError message={save.error} />

          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <Field label="Customer" hint="Someone who has messaged you, so the invoice can go to their chat." htmlFor="inv-customer">
              <Select
                id="inv-customer" value={leadId} onChange={(e) => setLeadId(e.target.value)}
                placeholder="Someone new (type below)"
                options={customers.map((c) => ({ value: String(c.id), label: `${c.customer_name}${c.channel_type ? ` · ${c.channel_type}` : ''}` }))}
              />
            </Field>
            {!leadId ? (
              <Field label="Customer name" required htmlFor="inv-name">
                <Input id="inv-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
              </Field>
            ) : (
              <Field label="Email for the invoice" hint={chosen?.email ? `On file: ${chosen.email}` : 'None on file. Add one to email the PDF too.'} htmlFor="inv-email">
                <Input id="inv-email" type="email" value={email} placeholder={chosen?.email ?? 'name@example.com'} onChange={(e) => setEmail(e.target.value)} />
              </Field>
            )}
          </div>
          {!leadId && (
            <Field label="Customer email" hint="A new customer has no chat, so the invoice goes by email." htmlFor="inv-email2">
              <Input id="inv-email2" type="email" value={email} placeholder="name@example.com" onChange={(e) => setEmail(e.target.value)} />
            </Field>
          )}

          <div>
            <div className="section-label" style={{ marginBottom: 8 }}>What it is for</div>
            <datalist id="inv-catalogue">
              {catalogue.map((c) => <option key={`${c.kind}:${c.name}`} value={c.name} />)}
            </datalist>
            <div style={{ display: 'grid', gap: 8 }}>
              {lines.map((l, i) => (
                <div key={i} className="invoice-line">
                  <Input aria-label={`Line ${i + 1} description`} placeholder="Service or item" list="inv-catalogue"
                    value={l.name} maxLength={120} onChange={(e) => pickItem(i, e.target.value)} />
                  <Input aria-label={`Line ${i + 1} quantity`} type="number" min={0} step="any" inputMode="decimal"
                    value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
                  <Input aria-label={`Line ${i + 1} unit price`} type="number" min={0} step="any" inputMode="decimal" placeholder="Price"
                    value={l.price} onChange={(e) => setLine(i, { price: e.target.value })} />
                  <button type="button" className="btn-icon" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1}
                    onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 8 }}>
              <Button size="sm" variant="subtle" icon={<Plus size={13} />} onClick={() => setLines((ls) => [...ls, { name: '', qty: '1', price: '' }])}>
                Add a line
              </Button>
            </div>
          </div>

          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            <Field label="Discount" hint={`In ${cur || 'your currency'}.`} htmlFor="inv-discount">
              <Input id="inv-discount" type="number" min={0} step="any" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} />
            </Field>
            <Field label="Due date" hint={`Empty means ${settings?.due_days ?? 7} days from today.`} htmlFor="inv-due">
              <Input id="inv-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
          </div>

          <Field label="Terms or note" hint="Printed on the invoice. Empty uses your standard terms." htmlFor="inv-notes">
            <Textarea id="inv-notes" rows={2} maxLength={500} value={notes} placeholder={settings?.terms ?? ''} onChange={(e) => setNotes(e.target.value)} />
          </Field>

          <div style={{
            display: 'grid', gap: 4, justifyContent: 'end', fontSize: 13, padding: '10px 12px',
            background: 'var(--surface-2)', borderRadius: 'var(--radius)',
          }}>
            <TotalRow label="Subtotal" value={formatMoney(totals.subtotal, cur)} />
            {totals.disc > 0 && <TotalRow label="Discount" value={`- ${formatMoney(totals.disc, cur)}`} />}
            {totals.tax > 0 && <TotalRow label={`${settings?.tax_label ?? 'Tax'} ${settings?.tax_rate}%`} value={formatMoney(totals.tax, cur)} />}
            <TotalRow label="Total due" value={formatMoney(totals.total, cur)} strong />
          </div>
        </div>
      )}
    </Modal>
  );
}

function TotalRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 24, justifyContent: 'space-between', fontWeight: strong ? 600 : 400, fontSize: strong ? 15 : 13 }}>
      <span style={{ color: strong ? 'var(--text)' : 'var(--text-2)' }}>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

function MarkPaidDialog({ invoice, onClose, onDone }: { invoice: Invoice; onClose: () => void; onDone: () => void }) {
  const [method, setMethod] = useState('M-Pesa');
  const [reference, setReference] = useState('');
  const pay = useMutation(async () => {
    await markInvoicePaid(invoice.id, { method, reference: reference.trim() || undefined });
    onDone();
  });
  return (
    <Modal
      open onClose={onClose} title={`Mark ${invoice.invoice_no} as paid`} width={440}
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>Close</Button>
          <Button variant="success" icon={<BadgeCheck size={14} />} loading={pay.busy} onClick={() => pay.run()}>
            Confirm payment received
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <InlineError message={pay.error} />
        <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--text-2)' }}>
          Only confirm once you have seen {formatMoney(invoice.total, invoice.currency)} arrive.
          {' '}{invoice.customer_name} will be sent a confirmation and their receipt as a PDF, and your name is recorded as the person who verified it.
        </p>
        <Field label="How they paid" htmlFor="pay-method">
          <Select id="pay-method" value={method} onChange={(e) => setMethod(e.target.value)}
            options={['M-Pesa', 'Bank transfer', 'Cash', 'Card', 'Other'].map((m) => ({ value: m, label: m }))} />
        </Field>
        <Field label="Payment reference" hint="The M-Pesa code or bank reference, if there is one." htmlFor="pay-ref">
          <Input id="pay-ref" value={reference} maxLength={80} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
