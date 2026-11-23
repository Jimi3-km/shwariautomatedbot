import React, { useEffect, useRef, useState } from 'react';
import { Eye, ImagePlus, Save, Trash2 } from 'lucide-react';
import {
  getReceiptSettings, updateReceiptSettings, uploadReceiptImage, previewReceipt,
  getInvoiceSettings, updateInvoiceSettings,
  type ReceiptSettings, type InvoiceSettings,
} from '../lib/api';
import { useAsync, useMutation } from '../hooks';
import { useSession } from '../app/SessionContext';
import {
  Button, Card, ErrorState, Field, InlineError, Input, LoadingState, Switch, Textarea, useToast,
} from './ui';

type TextKey =
  | 'display_name' | 'tagline' | 'address' | 'phone' | 'email' | 'website'
  | 'tax_label' | 'tax_id' | 'footer_note';

const TEXT_KEYS: TextKey[] = [
  'display_name', 'tagline', 'address', 'phone', 'email', 'website', 'tax_label', 'tax_id', 'footer_note',
];

const DEFAULT_ACCENT = '#1f2937';

/**
 * How receipts look: the letterhead or logo, the details printed on them, a
 * tax number, a closing note and a colour.
 *
 * The same settings drive the picture sent in chat, the receipt email and the
 * printable page. The preview is drawn by the server with the real renderer,
 * so what is shown here is what a customer receives.
 */
export function ReceiptDesignPanel() {
  const { isAdmin, supportMode } = useSession();
  const canEdit = isAdmin;
  const toast = useToast();
  const state = useAsync(() => getReceiptSettings(), []);

  const [form, setForm] = useState<Record<TextKey, string>>(() => blank());
  const [accent, setAccent] = useState(DEFAULT_ACCENT);
  const [stamp, setStamp] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const logoInput = useRef<HTMLInputElement>(null);
  const letterheadInput = useRef<HTMLInputElement>(null);

  // Fill the form from what is stored, once it arrives and after each save.
  useEffect(() => {
    const s = state.data?.settings;
    if (!s) return;
    setForm(Object.fromEntries(TEXT_KEYS.map((k) => [k, s[k] ?? ''])) as Record<TextKey, string>);
    setAccent(s.accent ?? DEFAULT_ACCENT);
    setStamp(s.show_stamp);
    setDirty(false);
  }, [state.data]);

  const draft = (): Partial<ReceiptSettings> => ({
    ...(Object.fromEntries(TEXT_KEYS.map((k) => [k, form[k].trim() || null])) as Partial<ReceiptSettings>),
    accent,
    show_stamp: stamp,
  });

  const showPreview = useMutation(async () => {
    const r = await previewReceipt(draft());
    setPreview(r.image);
  });
  const save = useMutation(async () => {
    await updateReceiptSettings(draft());
    toast.push('success', 'Receipt design saved.');
    state.reload();
    void showPreview.run();
  });
  const upload = useMutation(async (kind: 'logo' | 'letterhead', file: File) => {
    if (file.size > 2 * 1024 * 1024) throw new Error('That picture is too large. Use one under 2 MB.');
    await uploadReceiptImage(kind, file);
    toast.push('success', kind === 'logo' ? 'Logo added.' : 'Letterhead added.');
    state.reload();
    void showPreview.run();
  });
  const removeImage = useMutation(async (key: 'logo_url' | 'letterhead_url') => {
    await updateReceiptSettings({ [key]: null });
    state.reload();
    void showPreview.run();
  });

  // Draw the first preview once the settings are known.
  useEffect(() => {
    if (state.data && !preview && !showPreview.busy) void showPreview.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.data]);

  if (state.loading && !state.data) return <LoadingState rows={4} />;
  if (state.error) return <ErrorState message={state.error} onRetry={state.reload} />;
  const stored = state.data!.settings;
  const effective = state.data!.effective;

  const set = (k: TextKey, v: string) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); };
  const text = (k: TextKey, label: string, opts: { hint?: string; placeholder?: string; max?: number; type?: string } = {}) => (
    <Field label={label} hint={opts.hint} htmlFor={`rc-${k}`}>
      <Input
        id={`rc-${k}`} type={opts.type ?? 'text'} disabled={!canEdit} maxLength={opts.max ?? 120}
        placeholder={opts.placeholder ?? (effective[k] && !form[k] ? String(effective[k]) : undefined)}
        value={form[k]} onChange={(e) => set(k, e.target.value)}
      />
    </Field>
  );

  const pick = (kind: 'logo' | 'letterhead') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void upload.run(kind, file);
  };

  return (
    <div className="receipt-design">
      <div style={{ display: 'grid', gap: 14, minWidth: 0 }}>
        <InlineError message={save.error ?? upload.error ?? removeImage.error ?? showPreview.error} />

        <InvoiceSettingsCard canEdit={canEdit} />

        <Card>
          <div className="section-label" style={{ marginBottom: 4 }}>Letterhead</div>
          <p className="field-hint" style={{ marginBottom: 12 }}>
            Used on every invoice and receipt. Upload a letterhead banner to use your own across the top, or a logo to sit beside your business name. PNG or JPG, under 2 MB.
          </p>

          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
            <ImageSlot
              title="Letterhead banner"
              hint="Wide picture, about 1600 × 380. Replaces the logo and name."
              url={stored.letterhead_url} wide canEdit={canEdit} busy={upload.busy || removeImage.busy}
              onPick={() => letterheadInput.current?.click()}
              onRemove={() => removeImage.run('letterhead_url')}
            />
            <ImageSlot
              title="Logo"
              hint="Square picture, at least 300 × 300."
              url={stored.logo_url} canEdit={canEdit} busy={upload.busy || removeImage.busy}
              onPick={() => logoInput.current?.click()}
              onRemove={() => removeImage.run('logo_url')}
            />
          </div>
          <input ref={letterheadInput} type="file" accept="image/png,image/jpeg" hidden onChange={pick('letterhead')} />
          <input ref={logoInput} type="file" accept="image/png,image/jpeg" hidden onChange={pick('logo')} />
          {stored.letterhead_url && stored.logo_url && (
            <p className="field-hint" style={{ marginTop: 10 }}>
              The banner is used. Remove it to show the logo and your business name instead.
            </p>
          )}
        </Card>

        <Card>
          <div className="section-label" style={{ marginBottom: 12 }}>Business details on invoices and receipts</div>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            {text('display_name', 'Name on the receipt', { hint: 'Leave empty to use your business name.', placeholder: state.data!.business_name, max: 60 })}
            {text('tagline', 'Tagline', { hint: 'One short line under the name.', max: 90 })}
            {text('phone', 'Phone', { max: 40, type: 'tel' })}
            {text('email', 'Email', { max: 120, type: 'email' })}
            {text('website', 'Website', { max: 120 })}
            {text('address', 'Address', { max: 140 })}
          </div>
          <p className="field-hint" style={{ marginTop: 10 }}>
            Anything left empty is filled from your business details where they exist; the grey text shows what will print.
          </p>
        </Card>

        <Card>
          <div className="section-label" style={{ marginBottom: 12 }}>Tax and closing note</div>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            {text('tax_label', 'Tax number label', { placeholder: 'KRA PIN', hint: 'What the number is called.', max: 24 })}
            {text('tax_id', 'Tax or registration number', { max: 40 })}
          </div>
          <div style={{ marginTop: 12 }}>
            <Field label="Closing note" hint="A returns policy, a thank-you, your opening hours. Up to 240 characters." htmlFor="rc-footer_note">
              <Textarea
                id="rc-footer_note" rows={3} maxLength={240} disabled={!canEdit}
                placeholder={`Thank you for choosing ${form.display_name || state.data!.business_name || 'us'}.`}
                value={form.footer_note} onChange={(e) => set('footer_note', e.target.value)}
              />
            </Field>
          </div>
        </Card>

        <Card>
          <div className="section-label" style={{ marginBottom: 12 }}>Look</div>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
              <input
                type="color" value={accent} disabled={!canEdit} aria-label="Receipt colour"
                onChange={(e) => { setAccent(e.target.value); setDirty(true); }}
                style={{ width: 38, height: 30, padding: 0, border: '1px solid var(--border)', borderRadius: 6, background: 'none', cursor: canEdit ? 'pointer' : 'default' }}
              />
              <span>Colour <span style={{ color: 'var(--text-3)' }}>{accent}</span></span>
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
              <Switch checked={stamp} disabled={!canEdit} label="Show a PAID mark"
                onChange={(on: boolean) => { setStamp(on); setDirty(true); }} />
              <span>Show a PAID mark</span>
            </div>
          </div>
        </Card>

        {canEdit ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="solid" icon={<Save size={14} />} loading={save.busy} disabled={!dirty} onClick={() => save.run()}>
              Save design
            </Button>
            <Button variant="outline" icon={<Eye size={14} />} loading={showPreview.busy} onClick={() => showPreview.run()}>
              Preview changes
            </Button>
          </div>
        ) : (
          <p className="field-hint">
            {supportMode ? 'Viewing in support mode.' : 'Only the owner or a manager can change the receipt design.'}
          </p>
        )}
      </div>

      <div className="receipt-preview">
        <div className="section-label" style={{ marginBottom: 8 }}>Preview</div>
        <div className="receipt-preview-frame">
          {preview
            ? <img src={preview} alt="A sample receipt drawn with your settings" />
            : <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
                {showPreview.busy ? 'Drawing the preview…' : 'The preview will appear here.'}
              </div>}
        </div>
        <p className="field-hint" style={{ marginTop: 8 }}>
          A sample receipt. Invoices use the same letterhead, details and colour. Both reach customers as a PDF, in chat and by email.
        </p>
      </div>
    </div>
  );
}

/** How invoices are numbered, when they fall due, and whether a booking raises one by itself. */
function InvoiceSettingsCard({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const state = useAsync(() => getInvoiceSettings(), []);
  const [form, setForm] = useState<InvoiceSettings | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (state.data) { setForm(state.data.settings); setDirty(false); }
  }, [state.data]);

  const save = useMutation(async (next: InvoiceSettings) => {
    await updateInvoiceSettings(next);
    toast.push('success', 'Invoice settings saved.');
    state.reload();
  });

  if (!form) return state.error ? <ErrorState message={state.error} onRetry={state.reload} /> : <LoadingState rows={2} />;
  const set = <K extends keyof InvoiceSettings>(k: K, v: InvoiceSettings[K]) => { setForm({ ...form, [k]: v }); setDirty(true); };

  return (
    <Card>
      <div className="section-label" style={{ marginBottom: 4 }}>Invoices</div>
      <p className="field-hint" style={{ marginBottom: 12 }}>
        How to pay is printed from your payment details (Settings → Payments), with the invoice number as the reference.
      </p>
      <InlineError message={save.error} />

      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', marginBottom: 12,
        background: 'var(--surface-2)', borderRadius: 'var(--radius)',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Invoice bookings automatically</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5, marginTop: 2 }}>
            When an agent books a service that has a price, raise the invoice and send it to the customer straight away.
          </div>
        </div>
        <Switch
          checked={form.auto_on_booking} disabled={!canEdit || save.busy} label="Invoice bookings automatically"
          onChange={(on: boolean) => { const next = { ...form, auto_on_booking: on }; setForm(next); void save.run(next); }}
        />
      </div>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <Field label="Number prefix" hint={`Next looks like ${form.prefix || 'INV'}-00001`} htmlFor="is-prefix">
          <Input id="is-prefix" disabled={!canEdit} maxLength={6} value={form.prefix}
            onChange={(e) => set('prefix', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
        </Field>
        <Field label="Days until due" htmlFor="is-due">
          <Input id="is-due" type="number" min={0} max={365} disabled={!canEdit} value={String(form.due_days)}
            onChange={(e) => set('due_days', Math.max(0, Math.min(365, Number(e.target.value) || 0)))} />
        </Field>
        <Field label="Tax name" hint="For example VAT." htmlFor="is-taxlabel">
          <Input id="is-taxlabel" disabled={!canEdit} maxLength={24} value={form.tax_label ?? ''}
            onChange={(e) => set('tax_label', e.target.value || null)} />
        </Field>
        <Field label="Tax rate %" hint="0 adds no tax." htmlFor="is-taxrate">
          <Input id="is-taxrate" type="number" min={0} max={100} step="any" disabled={!canEdit} value={String(form.tax_rate)}
            onChange={(e) => set('tax_rate', Math.max(0, Math.min(100, Number(e.target.value) || 0)))} />
        </Field>
      </div>
      <div style={{ marginTop: 12 }}>
        <Field label="Standard terms" hint="Printed on every invoice unless one says otherwise. Up to 300 characters." htmlFor="is-terms">
          <Textarea id="is-terms" rows={2} maxLength={300} disabled={!canEdit} value={form.terms ?? ''}
            placeholder="Payment is due within 7 days."
            onChange={(e) => set('terms', e.target.value || null)} />
        </Field>
      </div>
      {canEdit && (
        <div style={{ marginTop: 12 }}>
          <Button variant="outline" icon={<Save size={14} />} loading={save.busy} disabled={!dirty} onClick={() => save.run(form)}>
            Save invoice settings
          </Button>
        </div>
      )}
    </Card>
  );
}

function blank(): Record<TextKey, string> {
  return Object.fromEntries(TEXT_KEYS.map((k) => [k, ''])) as Record<TextKey, string>;
}

function ImageSlot({ title, hint, url, wide, canEdit, busy, onPick, onRemove }: {
  title: string; hint: string; url: string | null; wide?: boolean; canEdit: boolean; busy: boolean;
  onPick: () => void; onRemove: () => void;
}) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 12, minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 2, lineHeight: 1.5 }}>{hint}</div>
      <div style={{
        marginTop: 10, height: wide ? 84 : 84, borderRadius: 8, background: '#ffffff',
        border: '1px dashed var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      }}>
        {url
          ? <img src={url} alt={title} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          : <span style={{ fontSize: 12, color: '#9ca3af' }}>None</span>}
      </div>
      {canEdit && (
        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          <Button size="sm" variant="outline" icon={<ImagePlus size={13} />} loading={busy} onClick={onPick}>
            {url ? 'Replace' : 'Upload'}
          </Button>
          {url && (
            <Button size="sm" variant="subtle" icon={<Trash2 size={13} />} disabled={busy} onClick={onRemove}>Remove</Button>
          )}
        </div>
      )}
    </div>
  );
}
