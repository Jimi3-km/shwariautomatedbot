import React, { useEffect, useState } from 'react';
import { Save, LogOut, Plus, X } from 'lucide-react';
import { getBusiness, updateBusiness, getTeam, updateTeamMember, getSupabase } from '../lib/api';
import type { Tenant } from '../types';
import { useAsync, useMutation } from '../hooks';
import { useSession } from '../app/SessionContext';
import {
  Button, Card, ErrorState, Field, Input, InlineError, LoadingState,
  PageHeader, Pill, Select, Tabs, Textarea, useToast,
} from '../components/ui';
import { formatDateTime } from '../lib/format';

type Pair = { key: string; value: string };

const toPairs = (o: Record<string, unknown> | null | undefined): Pair[] =>
  o ? Object.entries(o).map(([key, value]) => ({ key, value: String(value ?? '') })) : [];

const fromPairs = (pairs: Pair[]): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const p of pairs) if (p.key.trim()) out[p.key.trim()] = p.value;
  return out;
};

const TABS = [
  { id: 'business', label: 'Business' },
  { id: 'delivery', label: 'Delivery' },
  { id: 'payments', label: 'Payments' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'team', label: 'Team' },
  { id: 'account', label: 'Account' },
];

export function Settings() {
  const { isAdmin } = useSession();
  const [tab, setTab] = useState('business');
  const state = useAsync(() => getBusiness(), []);

  if (state.loading && !state.data) {
    return <><PageHeader title="Settings" /><LoadingState /></>;
  }
  if (state.error || !state.data) {
    return <><PageHeader title="Settings" /><ErrorState message={state.error ?? 'Could not load settings'} onRetry={state.reload} /></>;
  }

  return (
    <>
      <PageHeader title="Settings" subtitle="Your agent uses all of this when it talks to customers." />

      <div style={{ padding: '0 20px' }}>
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
      </div>

      <div className="scroll-y" style={{ flex: 1, padding: 20 }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          {tab === 'team' ? (
            <TeamSection isAdmin={isAdmin} />
          ) : tab === 'account' ? (
            <AccountSection />
          ) : (
            <BusinessForm business={state.data.business} tab={tab} isAdmin={isAdmin} onSaved={state.reload} />
          )}
        </div>
      </div>
    </>
  );
}

function BusinessForm({
  business, tab, isAdmin, onSaved,
}: { business: Tenant; tab: string; isAdmin: boolean; onSaved: () => void }) {
  const { refresh } = useSession();
  const toast = useToast();

  const [form, setForm] = useState(() => ({
    business_name: business.business_name ?? '',
    business_description: business.business_description ?? '',
    agent_name: business.agent_name ?? '',
    address: business.address ?? '',
    timezone: business.timezone ?? '',
    currency: business.currency ?? '',
    order_prefix: business.order_prefix ?? '',
    languages: (business.languages ?? []).join(', '),
    notification_channel: business.notification_channel ?? 'telegram',
    notification_target: business.notification_target ?? '',
    business_hours: toPairs(business.business_hours as Record<string, unknown>),
    delivery_rules: toPairs(business.delivery_rules as Record<string, unknown>),
    payment_details: toPairs(business.payment_details as Record<string, unknown>),
    contact_info: toPairs(business.contact_info as Record<string, unknown>),
  }));

  const save = useMutation(async () => {
    await updateBusiness({
      business_name: form.business_name,
      business_description: form.business_description,
      agent_name: form.agent_name,
      address: form.address,
      timezone: form.timezone,
      currency: form.currency,
      order_prefix: form.order_prefix,
      languages: form.languages.split(',').map((s) => s.trim()).filter(Boolean),
      notification_channel: form.notification_channel,
      notification_target: form.notification_target,
      business_hours: fromPairs(form.business_hours),
      delivery_rules: fromPairs(form.delivery_rules),
      payment_details: fromPairs(form.payment_details),
      contact_info: fromPairs(form.contact_info),
    } as Partial<Tenant>);
    toast.push('success', 'Settings saved.');
    onSaved();
    // The business name and currency are shown across the whole app.
    await refresh();
  });

  const ro = !isAdmin;
  const set = (k: string, v: unknown) => setForm({ ...form, [k]: v });

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <InlineError message={save.error} onDismiss={save.clearError} />

      {tab === 'business' && (
        <Card>
          <div style={{ display: 'grid', gap: 12 }}>
            <Field label="Business name" required>
              <Input value={form.business_name} disabled={ro}
                onChange={(e) => set('business_name', e.target.value)} />
            </Field>
            <Field label="Description" hint="Your agent uses this to explain who you are.">
              <Textarea rows={3} value={form.business_description} disabled={ro}
                onChange={(e) => set('business_description', e.target.value)} />
            </Field>
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              <Field label="Agent name" hint="What your AI assistant calls itself.">
                <Input value={form.agent_name} disabled={ro} onChange={(e) => set('agent_name', e.target.value)} />
              </Field>
              <Field label="Currency" hint="Three-letter code, e.g. USD.">
                <Input maxLength={3} value={form.currency} disabled={ro}
                  onChange={(e) => set('currency', e.target.value.toUpperCase())} />
              </Field>
              <Field label="Timezone">
                <Input value={form.timezone} disabled={ro} onChange={(e) => set('timezone', e.target.value)}
                  placeholder="Africa/Nairobi" />
              </Field>
              <Field label="Order reference prefix" hint="Appears at the front of every order number.">
                <Input value={form.order_prefix} disabled={ro} onChange={(e) => set('order_prefix', e.target.value)} />
              </Field>
            </div>
            <Field label="Address">
              <Input value={form.address} disabled={ro} onChange={(e) => set('address', e.target.value)} />
            </Field>
            <Field label="Languages" hint="Comma separated, e.g. English, Swahili.">
              <Input value={form.languages} disabled={ro} onChange={(e) => set('languages', e.target.value)} />
            </Field>
            <PairEditor label="Business hours" hint="For example: Monday–Friday / 9am–6pm."
              pairs={form.business_hours} disabled={ro}
              onChange={(v) => set('business_hours', v)}
              placeholderKey="Monday–Friday" placeholderValue="9am–6pm" />
          </div>
        </Card>
      )}

      {tab === 'delivery' && (
        <Card>
          <PairEditor
            label="Delivery rules"
            hint="Your agent quotes these directly. For example: Nairobi CBD / Free same day."
            pairs={form.delivery_rules} disabled={ro}
            onChange={(v) => set('delivery_rules', v)}
            placeholderKey="Region or condition" placeholderValue="Cost and timing" />
        </Card>
      )}

      {tab === 'payments' && (
        <Card>
          <PairEditor
            label="Payment details"
            hint="Your agent may only quote payment details that appear here — it can never invent an account number."
            pairs={form.payment_details} disabled={ro}
            onChange={(v) => set('payment_details', v)}
            placeholderKey="Method" placeholderValue="Account or instructions" />
          <div style={{ marginTop: 14 }}>
            <PairEditor label="Contact information" hint="Shown on receipts and shared by your agent."
              pairs={form.contact_info} disabled={ro}
              onChange={(v) => set('contact_info', v)}
              placeholderKey="phone" placeholderValue="+254…" />
          </div>
        </Card>
      )}

      {tab === 'notifications' && (
        <Card>
          <div style={{ display: 'grid', gap: 12 }}>
            <Field label="Send alerts via">
              <Select
                value={form.notification_channel} disabled={ro}
                onChange={(e) => set('notification_channel', e.target.value)}
                options={[
                  { value: 'telegram', label: 'Telegram' },
                  { value: 'whatsapp', label: 'WhatsApp' },
                ]}
              />
            </Field>
            <Field
              label="Send alerts to"
              hint="Your chat ID on that channel. New leads and payment claims are sent here."
            >
              <Input value={form.notification_target} disabled={ro}
                onChange={(e) => set('notification_target', e.target.value)} />
            </Field>
          </div>
        </Card>
      )}

      {isAdmin ? (
        <div>
          <Button variant="solid" icon={<Save size={14} />} loading={save.busy} onClick={() => save.run()}>
            Save changes
          </Button>
        </div>
      ) : (
        <p style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
          Only owners and admins can change business settings.
        </p>
      )}
    </div>
  );
}

function PairEditor({
  label, hint, pairs, onChange, disabled, placeholderKey, placeholderValue,
}: {
  label: string; hint: string; pairs: Pair[]; onChange: (p: Pair[]) => void;
  disabled: boolean; placeholderKey: string; placeholderValue: string;
}) {
  return (
    <div>
      <label className="field-label">{label}</label>
      <p className="field-hint" style={{ marginTop: 0, marginBottom: 8 }}>{hint}</p>
      <div style={{ display: 'grid', gap: 6 }}>
        {pairs.length === 0 && (
          <p style={{ fontSize: 12.5, color: 'var(--text-3)' }}>Nothing added yet.</p>
        )}
        {pairs.map((pair, i) => (
          <div key={i} style={{ display: 'flex', gap: 6 }}>
            <Input placeholder={placeholderKey} value={pair.key} disabled={disabled} style={{ flex: 1 }}
              onChange={(e) => onChange(pairs.map((p, j) => (j === i ? { ...p, key: e.target.value } : p)))} />
            <Input placeholder={placeholderValue} value={pair.value} disabled={disabled} style={{ flex: 1.4 }}
              onChange={(e) => onChange(pairs.map((p, j) => (j === i ? { ...p, value: e.target.value } : p)))} />
            {!disabled && (
              <button onClick={() => onChange(pairs.filter((_, j) => j !== i))} aria-label="Remove"
                style={{ color: 'var(--text-3)', padding: 5 }}>
                <X size={14} />
              </button>
            )}
          </div>
        ))}
        {!disabled && (
          <div>
            <Button size="sm" variant="outline" icon={<Plus size={12} />}
              onClick={() => onChange([...pairs, { key: '', value: '' }])}>
              Add
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function TeamSection({ isAdmin }: { isAdmin: boolean }) {
  const { user } = useSession();
  const toast = useToast();
  const state = useAsync(() => getTeam(), []);

  const change = useMutation(async (id: string, role: string) => {
    await updateTeamMember(id, role);
    toast.push('success', 'Role updated.');
    state.reload();
  });

  if (state.loading && !state.data) return <LoadingState rows={3} />;
  if (state.error) return <ErrorState message={state.error} onRetry={state.reload} />;

  const members = state.data?.members ?? [];

  return (
    <Card>
      <InlineError message={change.error} />
      <div className="section-label" style={{ marginBottom: 11 }}>People with access</div>
      <div style={{ display: 'grid', gap: 8 }}>
        {members.map((m) => (
          <div key={m.id} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px',
            background: 'var(--surface-2)', borderRadius: 'var(--radius)',
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13 }}>
                {m.user_id === user.id ? 'You' : 'Team member'}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                Added {formatDateTime(m.created_at)}
              </div>
            </div>
            {isAdmin && m.user_id !== user.id ? (
              <Select
                aria-label="Role" value={m.role} disabled={change.busy}
                onChange={(e) => change.run(m.id, e.target.value)}
                options={[
                  { value: 'owner', label: 'Owner' },
                  { value: 'admin', label: 'Admin' },
                  { value: 'member', label: 'Member' },
                  { value: 'viewer', label: 'Viewer' },
                ]}
                style={{ height: 30, width: 130, fontSize: 12.5 }}
              />
            ) : (
              <Pill tone="neutral">{m.role}</Pill>
            )}
          </div>
        ))}
      </div>
      <p className="field-hint" style={{ marginTop: 12 }}>
        Owners and admins manage settings and channels. Members handle conversations
        and can verify payments. Viewers have read-only access.
      </p>
    </Card>
  );
}

function AccountSection() {
  const { user, role, signOut } = useSession();
  const toast = useToast();

  const resetPassword = useMutation(async () => {
    if (!user.email) throw new Error('No email address on this account.');
    const { error } = await getSupabase().auth.resetPasswordForEmail(user.email, {
      redirectTo: `${window.location.origin}/`,
    });
    if (error) throw new Error(error.message);
    toast.push('success', 'Password reset link sent to your email.');
  });

  return (
    <Card>
      <div className="section-label" style={{ marginBottom: 11 }}>Your account</div>
      <div style={{ display: 'grid', gap: 4, fontSize: 13 }}>
        <Row label="Email" value={user.email ?? '—'} />
        <Row label="Role" value={role} />
      </div>

      <InlineError message={resetPassword.error} />

      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        <Button variant="outline" loading={resetPassword.busy} onClick={() => resetPassword.run()}>
          Send password reset link
        </Button>
        <Button variant="subtle" icon={<LogOut size={13} />} onClick={signOut}>Sign out</Button>
      </div>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
      <span style={{ color: 'var(--text-3)' }}>{label}</span>
      <span style={{ textTransform: label === 'Role' ? 'capitalize' : 'none' }}>{value}</span>
    </div>
  );
}
