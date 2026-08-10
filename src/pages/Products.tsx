import React, { useState } from 'react';
import { Package, Plus, Pencil, Archive, RotateCcw } from 'lucide-react';
import {
  getProducts, createProduct, updateProduct, archiveProduct, type ProductInput,
} from '../lib/api';
import type { Product } from '../types';
import { useAsync, useMutation } from '../hooks';
import { useSession } from '../app/SessionContext';
import {
  Button, Card, Checkbox, EmptyState, ErrorState, Field, Input, InlineError,
  LoadingState, Modal, PageHeader, Pill, Textarea, useToast,
} from '../components/ui';
import { formatMoney } from '../lib/format';

/** Editable rows of key/value pairs — friendlier than asking for raw JSON. */
interface Pair { key: string; value: string }

function toPairs(obj: Record<string, unknown> | null | undefined): Pair[] {
  if (!obj) return [];
  return Object.entries(obj).map(([key, value]) => ({ key, value: String(value ?? '') }));
}
function fromPairs(pairs: Pair[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of pairs) {
    const k = p.key.trim();
    if (k) out[k] = p.value;
  }
  return out;
}

interface FormState {
  id: string | null;
  name: string; sku: string; description: string; price: string;
  inStock: boolean; variant: Pair[]; paymentOptions: Pair[];
}

const emptyForm: FormState = {
  id: null, name: '', sku: '', description: '', price: '',
  inStock: true, variant: [], paymentOptions: [],
};

/**
 * The catalogue the AI quotes from. It is intentionally generic: a product can
 * be a phone, a spa treatment or a service. Variants and payment options are
 * free-form attributes rather than a fixed set of phone-specific columns.
 */
export function Products() {
  const { canWrite, currency } = useSession();
  const toast = useToast();
  const state = useAsync(() => getProducts(), []);
  const [form, setForm] = useState<FormState | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const save = useMutation(async (input: FormState) => {
    const body: ProductInput = {
      name: input.name.trim(),
      sku: input.sku.trim() || null,
      description: input.description.trim() || null,
      price: input.price === '' ? null : Number(input.price),
      currency: currency ?? undefined,
      variant: fromPairs(input.variant),
      payment_options: fromPairs(input.paymentOptions),
      in_stock: input.inStock,
    };
    if (input.id) await updateProduct(input.id, body);
    else await createProduct(body);
    setForm(null);
    toast.push('success', input.id ? 'Product updated.' : 'Product added.');
    state.reload();
  });

  const archive = useMutation(async (id: string) => {
    await archiveProduct(id);
    toast.push('success', 'Product archived.');
    state.reload();
  });

  const restore = useMutation(async (p: Product) => {
    await updateProduct(p.id, {
      name: p.name, sku: p.sku, description: p.description, price: p.price,
      currency: p.currency ?? currency ?? undefined,
      variant: (p.variant ?? {}) as Record<string, unknown>,
      payment_options: (p.payment_options ?? {}) as Record<string, unknown>,
      in_stock: true,
    });
    toast.push('success', 'Product restored.');
    state.reload();
  });

  const all = state.data?.products ?? [];
  const products = showArchived ? all : all.filter((p) => p.in_stock);
  const archivedCount = all.filter((p) => !p.in_stock).length;

  function openNew() { setForm({ ...emptyForm }); }
  function openEdit(p: Product) {
    setForm({
      id: p.id, name: p.name, sku: p.sku ?? '', description: p.description ?? '',
      price: p.price == null ? '' : String(p.price), inStock: p.in_stock,
      variant: toPairs(p.variant as Record<string, unknown>),
      paymentOptions: toPairs(p.payment_options as Record<string, unknown>),
    });
  }

  return (
    <>
      <PageHeader
        title="Products"
        subtitle="Your AI agent quotes only from this catalogue and can never invent a price."
        actions={canWrite && <Button variant="solid" size="sm" icon={<Plus size={14} />} onClick={openNew}>Add product</Button>}
      />

      <InlineError message={archive.error ?? restore.error} />

      {archivedCount > 0 && (
        <div style={{ padding: '12px 20px 0' }}>
          <Checkbox
            label={`Show archived (${archivedCount})`}
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
        </div>
      )}

      <div className="scroll-y" style={{ flex: 1, padding: 20 }}>
        {state.loading && !state.data ? (
          <LoadingState rows={4} />
        ) : state.error ? (
          <ErrorState message={state.error} onRetry={state.reload} />
        ) : products.length === 0 ? (
          <EmptyState
            icon={<Package size={26} />}
            title="Your catalogue is empty"
            body="Add your first product so your AI agent can answer customer questions accurately and quote real prices."
            action={canWrite && <Button variant="solid" icon={<Plus size={14} />} onClick={openNew}>Add product</Button>}
          />
        ) : (
          <div style={{
            display: 'grid', gap: 12, maxWidth: 1280, margin: '0 auto',
            gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))',
          }}>
            {products.map((p) => (
              <Card key={p.id}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</div>
                    {p.sku && <div className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>{p.sku}</div>}
                  </div>
                  <Pill tone={p.in_stock ? 'success' : 'neutral'}>{p.in_stock ? 'In stock' : 'Archived'}</Pill>
                </div>

                <div style={{ fontSize: 19, fontWeight: 600, marginTop: 8, letterSpacing: '-0.02em' }}>
                  {p.price == null
                    ? <span style={{ fontSize: 13, color: 'var(--text-3)', fontWeight: 400 }}>No price set</span>
                    : formatMoney(p.price, p.currency ?? currency)}
                </div>

                {p.variant && Object.keys(p.variant).length > 0 && (
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 8 }}>
                    {Object.entries(p.variant).map(([k, v]) => (
                      <Pill key={k} tone="neutral">{k}: {String(v)}</Pill>
                    ))}
                  </div>
                )}

                {p.payment_options && Object.keys(p.payment_options).length > 0 && (
                  <div style={{ fontSize: 11.5, color: 'var(--text-2)', marginTop: 8 }}>
                    {Object.entries(p.payment_options).map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}
                  </div>
                )}

                {p.description && (
                  <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 8, lineHeight: 1.5 }}>
                    {p.description}
                  </p>
                )}

                {canWrite && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                    <Button size="sm" variant="outline" icon={<Pencil size={12} />} onClick={() => openEdit(p)}>Edit</Button>
                    {p.in_stock ? (
                      <Button size="sm" variant="subtle" icon={<Archive size={12} />}
                        loading={archive.busy} onClick={() => archive.run(p.id)}>Archive</Button>
                    ) : (
                      <Button size="sm" variant="subtle" icon={<RotateCcw size={12} />}
                        loading={restore.busy} onClick={() => restore.run(p)}>Restore</Button>
                    )}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      <ProductModal
        form={form} currency={currency} busy={save.busy} error={save.error}
        onChange={setForm} onClose={() => setForm(null)} onSave={() => form && save.run(form)}
      />
    </>
  );
}

function ProductModal({
  form, currency, busy, error, onChange, onClose, onSave,
}: {
  form: FormState | null; currency: string | null; busy: boolean; error: string | null;
  onChange: (f: FormState) => void; onClose: () => void; onSave: () => void;
}) {
  if (!form) return null;
  const valid = form.name.trim().length > 0;

  return (
    <Modal
      open onClose={onClose} title={form.id ? 'Edit product' : 'Add product'} width={560}
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>Cancel</Button>
          <Button variant="solid" loading={busy} disabled={!valid} onClick={onSave}>
            {form.id ? 'Save changes' : 'Add product'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 14 }}>
        <InlineError message={error} />

        <Field label="Name" required>
          <Input value={form.name} onChange={(e) => onChange({ ...form, name: e.target.value })}
            placeholder="What are you selling?" />
        </Field>

        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
          <Field label={`Price${currency ? ` (${currency})` : ''}`} hint="Leave empty if priced on request.">
            <Input type="number" min="0" step="0.01" value={form.price}
              onChange={(e) => onChange({ ...form, price: e.target.value })} />
          </Field>
          <Field label="SKU" hint="Optional internal code.">
            <Input value={form.sku} onChange={(e) => onChange({ ...form, sku: e.target.value })} />
          </Field>
        </div>

        <Field label="Description" hint="The agent uses this to answer questions about the product.">
          <Textarea rows={3} value={form.description}
            onChange={(e) => onChange({ ...form, description: e.target.value })} />
        </Field>

        <PairEditor
          label="Variants"
          hint="Any attributes that describe this item, e.g. size, colour, storage, duration."
          placeholderKey="storage" placeholderValue="128GB"
          pairs={form.variant} onChange={(variant) => onChange({ ...form, variant })}
        />

        <PairEditor
          label="Payment options"
          hint="Installment or deposit terms the agent may offer, e.g. deposit / weekly / weeks."
          placeholderKey="deposit" placeholderValue="5000"
          pairs={form.paymentOptions} onChange={(paymentOptions) => onChange({ ...form, paymentOptions })}
        />

        <Checkbox
          label="In stock — the agent only offers products that are in stock"
          checked={form.inStock}
          onChange={(e) => onChange({ ...form, inStock: e.target.checked })}
        />
      </div>
    </Modal>
  );
}

function PairEditor({
  label, hint, pairs, onChange, placeholderKey, placeholderValue,
}: {
  label: string; hint: string; pairs: Pair[];
  onChange: (p: Pair[]) => void; placeholderKey: string; placeholderValue: string;
}) {
  return (
    <div>
      <label className="field-label">{label}</label>
      <p className="field-hint" style={{ marginTop: 0, marginBottom: 7 }}>{hint}</p>
      <div style={{ display: 'grid', gap: 6 }}>
        {pairs.map((pair, i) => (
          <div key={i} style={{ display: 'flex', gap: 6 }}>
            <Input
              placeholder={placeholderKey} value={pair.key} style={{ flex: 1 }}
              onChange={(e) => onChange(pairs.map((p, j) => (j === i ? { ...p, key: e.target.value } : p)))}
            />
            <Input
              placeholder={placeholderValue} value={pair.value} style={{ flex: 1 }}
              onChange={(e) => onChange(pairs.map((p, j) => (j === i ? { ...p, value: e.target.value } : p)))}
            />
            <Button size="md" variant="subtle" onClick={() => onChange(pairs.filter((_, j) => j !== i))}>
              Remove
            </Button>
          </div>
        ))}
        <div>
          <Button size="sm" variant="outline" icon={<Plus size={12} />}
            onClick={() => onChange([...pairs, { key: '', value: '' }])}>
            Add {label.toLowerCase().replace(/s$/, '')}
          </Button>
        </div>
      </div>
    </div>
  );
}
