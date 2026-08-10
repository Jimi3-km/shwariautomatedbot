import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { PageHeader, ErrorNote, inputStyle } from './Shell';

export function BusinessSettings({ isAdmin, onSaved }: { isAdmin: boolean; onSaved: () => void }) {
  const [b, setB] = useState<any>(null);
  const [json, setJson] = useState({ hours: '', delivery: '', payment: '', contact: '' });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ business: any }>('/business').then((r) => {
      setB(r.business);
      setJson({
        hours: pretty(r.business.business_hours),
        delivery: pretty(r.business.delivery_rules),
        payment: pretty(r.business.payment_details),
        contact: pretty(r.business.contact_info),
      });
    }).catch((e) => setError(e.message));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setSaved(false);
    try {
      const body = {
        business_name: b.business_name,
        business_description: b.business_description,
        agent_name: b.agent_name,
        address: b.address,
        timezone: b.timezone,
        currency: b.currency,
        order_prefix: b.order_prefix,
        notification_channel: b.notification_channel,
        notification_target: b.notification_target,
        languages: String(b.languages_text ?? (b.languages ?? []).join(', '))
          .split(',').map((s: string) => s.trim()).filter(Boolean),
        business_hours: parse(json.hours, 'Business hours'),
        delivery_rules: parse(json.delivery, 'Delivery rules'),
        payment_details: parse(json.payment, 'Payment details'),
        contact_info: parse(json.contact, 'Contact info'),
      };
      const updated = await api('/business', { method: 'PUT', body });
      setB({ ...updated });
      setSaved(true);
      onSaved();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }

  if (!b) return <><PageHeader title="Business" /><ErrorNote error={error} /></>;

  const set = (k: string) => (e: any) => setB({ ...b, [k]: e.target.value });
  const ro = !isAdmin;

  return (
    <>
      <PageHeader title="Business" subtitle="Your agent uses all of this when it talks to customers." />
      <ErrorNote error={error} />

      <form onSubmit={save} className="p-6 max-w-3xl space-y-4">
        <div className="grid md:grid-cols-2 gap-3">
          <F label="Business name"><input required value={b.business_name ?? ''} onChange={set('business_name')} disabled={ro} className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={inputStyle} /></F>
          <F label="Agent name"><input value={b.agent_name ?? ''} onChange={set('agent_name')} disabled={ro} className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={inputStyle} /></F>
          <F label="Address"><input value={b.address ?? ''} onChange={set('address')} disabled={ro} className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={inputStyle} /></F>
          <F label="Timezone"><input value={b.timezone ?? ''} onChange={set('timezone')} disabled={ro} className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={inputStyle} /></F>
          <F label="Currency"><input maxLength={3} value={b.currency ?? ''} onChange={(e) => setB({ ...b, currency: e.target.value.toUpperCase() })} disabled={ro} className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={inputStyle} /></F>
          <F label="Order reference prefix"><input value={b.order_prefix ?? ''} onChange={set('order_prefix')} disabled={ro} className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={inputStyle} /></F>
          <F label="Languages (comma separated)">
            <input value={b.languages_text ?? (b.languages ?? []).join(', ')} onChange={set('languages_text')} disabled={ro} className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={inputStyle} />
          </F>
          <F label="Notify me on" hint="Where new-lead and payment-claim alerts are sent.">
            <div className="flex gap-2">
              <select value={b.notification_channel ?? 'telegram'} onChange={set('notification_channel')} disabled={ro} className="px-3 py-2 rounded-lg text-sm" style={inputStyle}>
                <option value="telegram">Telegram</option>
                <option value="whatsapp">WhatsApp</option>
              </select>
              <input value={b.notification_target ?? ''} onChange={set('notification_target')} disabled={ro} placeholder="Your chat ID" className="flex-1 px-3 py-2 rounded-lg text-sm outline-none" style={inputStyle} />
            </div>
          </F>
        </div>

        <F label="Description"><textarea value={b.business_description ?? ''} onChange={set('business_description')} rows={3} disabled={ro} className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={inputStyle} /></F>

        <div className="grid md:grid-cols-2 gap-3">
          <F label="Business hours (JSON)"><textarea value={json.hours} onChange={(e) => setJson({ ...json, hours: e.target.value })} rows={5} disabled={ro} className="w-full px-3 py-2 rounded-lg text-xs outline-none font-mono" style={inputStyle} /></F>
          <F label="Delivery rules (JSON)"><textarea value={json.delivery} onChange={(e) => setJson({ ...json, delivery: e.target.value })} rows={5} disabled={ro} className="w-full px-3 py-2 rounded-lg text-xs outline-none font-mono" style={inputStyle} /></F>
          <F label="Payment details (JSON)" hint="The agent may only quote payment details that appear here.">
            <textarea value={json.payment} onChange={(e) => setJson({ ...json, payment: e.target.value })} rows={5} disabled={ro} className="w-full px-3 py-2 rounded-lg text-xs outline-none font-mono" style={inputStyle} />
          </F>
          <F label="Contact info (JSON)"><textarea value={json.contact} onChange={(e) => setJson({ ...json, contact: e.target.value })} rows={5} disabled={ro} className="w-full px-3 py-2 rounded-lg text-xs outline-none font-mono" style={inputStyle} /></F>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-3">
            <button type="submit" disabled={busy} className="px-4 py-2 rounded-lg text-sm disabled:opacity-50" style={{ background: 'var(--white)', color: 'var(--black)' }}>
              {busy ? 'Saving…' : 'Save business settings'}
            </button>
            {saved && <span className="text-sm" style={{ color: '#6ee7b7' }}>Saved</span>}
          </div>
        )}
      </form>
    </>
  );
}

function pretty(v: unknown) {
  return v && Object.keys(v as object).length ? JSON.stringify(v, null, 2) : '';
}
function parse(text: string, label: string) {
  if (!text.trim()) return {};
  try { return JSON.parse(text); }
  catch { throw new Error(`${label} must be valid JSON`); }
}
function F({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs" style={{ color: 'var(--text-2)' }}>{label}</span>
      {hint && <span className="block text-xs mb-1" style={{ color: 'var(--text-3)' }}>{hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  );
}
