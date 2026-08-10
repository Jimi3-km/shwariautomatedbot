import React, { useEffect, useState, useCallback } from 'react';
import { Plus, Pencil, Archive } from 'lucide-react';
import { api, fmtMoney } from '../lib/api';
import { PageHeader, Badge, Empty, ErrorNote, inputStyle } from './Shell';

const blank = {
  id: null as string | null, name: '', sku: '', description: '', price: '',
  variant_text: '', in_stock: true, payment_options_text: '',
};

/**
 * The product catalogue the AI quotes from. Prices are numeric here and the
 * agent is instructed never to invent one, so anything a customer is quoted
 * originates on this page.
 */
export function Products({ canWrite, currency }: { canWrite: boolean; currency: string }) {
  const [products, setProducts] = useState<any[]>([]);
  const [form, setForm] = useState<typeof blank | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setProducts((await api<{ products: any[] }>('/products')).products); }
    catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  function edit(p: any) {
    setForm({
      id: p.id, name: p.name ?? '', sku: p.sku ?? '', description: p.description ?? '',
      price: p.price == null ? '' : String(p.price),
      variant_text: JSON.stringify(p.variant ?? {}, null, 0),
      payment_options_text: JSON.stringify(p.payment_options ?? {}, null, 0),
      in_stock: Boolean(p.in_stock),
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true); setError(null);
    try {
      let variant = {}; let payment_options = {};
      try { variant = form.variant_text.trim() ? JSON.parse(form.variant_text) : {}; }
      catch { throw new Error('Variants must be valid JSON, e.g. {"storage":"128GB"}'); }
      try { payment_options = form.payment_options_text.trim() ? JSON.parse(form.payment_options_text) : {}; }
      catch { throw new Error('Payment options must be valid JSON'); }

      const body = {
        name: form.name, sku: form.sku || null, description: form.description || null,
        price: form.price === '' ? null : Number(form.price),
        currency, variant, payment_options, in_stock: form.in_stock,
      };
      if (form.id) await api(`/products/${form.id}`, { method: 'PUT', body });
      else await api('/products', { method: 'POST', body });
      setForm(null);
      await load();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function archive(id: string) {
    try { await api(`/products/${id}`, { method: 'DELETE' }); await load(); }
    catch (e: any) { setError(e.message); }
  }

  return (
    <>
      <PageHeader
        title="Products"
        subtitle="Your AI agent quotes only from this catalogue and can never invent a price."
        action={canWrite && (
          <button
            onClick={() => setForm({ ...blank })}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm"
            style={{ background: 'var(--white)', color: 'var(--black)' }}
          >
            <Plus size={15} /> Add product
          </button>
        )}
      />
      <ErrorNote error={error} />

      {form && (
        <form onSubmit={save} className="mx-6 mt-4 p-4 rounded-xl grid md:grid-cols-2 gap-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <Field label="Name"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={inputStyle} /></Field>
          <Field label="SKU (optional)"><input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={inputStyle} /></Field>
          <Field label={`Price (${currency})`}><input type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={inputStyle} /></Field>
          <Field label="Variants (JSON)"><input value={form.variant_text} onChange={(e) => setForm({ ...form, variant_text: e.target.value })} placeholder='{"storage":"128GB","condition":"new"}' className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={inputStyle} /></Field>
          <Field label="Installment / payment options (JSON)"><input value={form.payment_options_text} onChange={(e) => setForm({ ...form, payment_options_text: e.target.value })} placeholder='{"deposit":5000,"weekly":1500,"weeks":12}' className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={inputStyle} /></Field>
          <Field label="Description">
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={inputStyle} />
          </Field>
          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-2)' }}>
            <input type="checkbox" checked={form.in_stock} onChange={(e) => setForm({ ...form, in_stock: e.target.checked })} />
            In stock (the agent only offers in-stock products)
          </label>
          <div className="flex gap-2 justify-end md:col-span-2">
            <button type="button" onClick={() => setForm(null)} className="px-3 py-1.5 rounded-lg text-sm" style={{ color: 'var(--text-2)' }}>Cancel</button>
            <button type="submit" disabled={busy} className="px-3 py-1.5 rounded-lg text-sm disabled:opacity-50" style={{ background: 'var(--white)', color: 'var(--black)' }}>
              {busy ? 'Saving…' : 'Save product'}
            </button>
          </div>
        </form>
      )}

      <div className="p-6">
        {!products.length ? <Empty message="No products yet. Add your first one so the agent has something to sell." /> : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {products.map((p) => (
              <div key={p.id} className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{p.name}</div>
                    {p.sku && <div className="text-xs" style={{ color: 'var(--text-3)' }}>{p.sku}</div>}
                  </div>
                  <Badge tone={p.in_stock ? 'good' : 'neutral'}>{p.in_stock ? 'in stock' : 'archived'}</Badge>
                </div>
                <div className="text-lg font-semibold mt-2">{p.price == null ? 'No price set' : fmtMoney(p.price, p.currency || currency)}</div>
                {p.variant && Object.keys(p.variant).length > 0 && (
                  <div className="text-xs mt-1" style={{ color: 'var(--text-2)' }}>
                    {Object.entries(p.variant).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                  </div>
                )}
                {p.description && <p className="text-xs mt-2" style={{ color: 'var(--text-2)' }}>{p.description}</p>}
                {canWrite && (
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => edit(p)} className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-2)' }}><Pencil size={12} /> Edit</button>
                    {p.in_stock && <button onClick={() => archive(p.id)} className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-2)' }}><Archive size={12} /> Archive</button>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs" style={{ color: 'var(--text-2)' }}>{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
