import React, { useEffect, useState } from 'react';
import { Bot, Plus, X, Save } from 'lucide-react';
import { getAgentSettings, updateAgentSettings } from '../lib/api';
import type { AgentSettings as AgentSettingsType } from '../types';
import { useAsync, useMutation } from '../hooks';
import { useSession } from '../app/SessionContext';
import {
  Button, Card, ErrorState, Field, Input, InlineError, LoadingState,
  PageHeader, Select, Textarea, useToast,
} from '../components/ui';

const MODELS = [
  { value: 'gpt-4o-mini', label: 'Standard — fast and economical' },
  { value: 'gpt-4o', label: 'Advanced — best quality, higher cost' },
];

interface FormState {
  persona: string;
  customInstructions: string;
  followupTemplate: string;
  model: string;
  memoryWindow: number;
  followupDelayHours: number;
  salesScript: string[];
  upsells: string[];
  escalationRules: string[];
}

function toForm(a: AgentSettingsType): FormState {
  const rules = (a.escalation_rules ?? {}) as { handover_if?: unknown };
  const handover = Array.isArray(rules.handover_if)
    ? rules.handover_if.filter((r): r is string => typeof r === 'string')
    : [];
  return {
    persona: a.persona ?? '',
    customInstructions: a.custom_instructions ?? '',
    followupTemplate: a.followup_template ?? '',
    model: a.model ?? 'gpt-4o-mini',
    memoryWindow: a.memory_window ?? 50,
    followupDelayHours: a.followup_delay_hours ?? 24,
    salesScript: Array.isArray(a.sales_script) ? a.sales_script : [],
    upsells: Array.isArray(a.upsell_catalogue) ? a.upsell_catalogue : [],
    escalationRules: handover,
  };
}

/**
 * Agent configuration in the business owner's language. Nothing here exposes
 * the automation engine underneath: no workflow names, node names or webhook
 * URLs. Free-text fields feed a fixed prompt structure server-side, so a
 * business configures behaviour without being able to rewrite the guardrails.
 */
export function AgentSettings() {
  const { canWrite, tenant } = useSession();
  const toast = useToast();
  const state = useAsync(() => getAgentSettings(), []);
  const [form, setForm] = useState<FormState | null>(null);

  useEffect(() => {
    if (state.data?.agent && !form) setForm(toForm(state.data.agent));
  }, [state.data, form]);

  const save = useMutation(async (f: FormState) => {
    await updateAgentSettings({
      persona: f.persona,
      custom_instructions: f.customInstructions,
      followup_template: f.followupTemplate,
      model: f.model,
      memory_window: f.memoryWindow,
      followup_delay_hours: f.followupDelayHours,
      sales_script: f.salesScript.filter((s) => s.trim()),
      upsell_catalogue: f.upsells.filter((s) => s.trim()),
      escalation_rules: { handover_if: f.escalationRules.filter((s) => s.trim()) },
    } as Partial<AgentSettingsType>);
    toast.push('success', 'Agent settings saved.');
    state.reload();
  });

  if (state.loading && !state.data) {
    return <><PageHeader title="AI Agent" /><LoadingState /></>;
  }
  if (state.error) {
    return <><PageHeader title="AI Agent" /><ErrorState message={state.error} onRetry={state.reload} /></>;
  }
  if (!form) {
    return <><PageHeader title="AI Agent" /><LoadingState /></>;
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm({ ...form, [key]: value });

  return (
    <>
      <PageHeader
        title="AI Agent"
        subtitle={tenant ? `How ${tenant.agent_name || 'your agent'} talks to your customers` : undefined}
        actions={canWrite && (
          <Button variant="solid" size="sm" icon={<Save size={13} />} loading={save.busy}
            onClick={() => save.run(form)}>
            Save changes
          </Button>
        )}
      />

      <InlineError message={save.error} onDismiss={save.clearError} />

      <div className="scroll-y" style={{ flex: 1, padding: 20 }}>
        <div style={{ display: 'grid', gap: 14, maxWidth: 760, margin: '0 auto' }}>

          <Card>
            <SectionTitle icon={<Bot size={15} />} title="Identity and tone"
              hint="Your agent's name is set in Business settings." />
            <Field
              label="Personality and tone"
              hint="Describe how your agent should come across, in plain language."
            >
              <Textarea
                rows={4} disabled={!canWrite} value={form.persona}
                onChange={(e) => set('persona', e.target.value)}
                placeholder="Warm, confident and concise. Never pushy. Happy to switch between English and the customer's language."
              />
            </Field>
          </Card>

          <Card>
            <SectionTitle title="Sales process"
              hint="The steps your agent works through. It follows these in order and asks only one question per reply." />
            <ListEditor
              items={form.salesScript} disabled={!canWrite}
              onChange={(salesScript) => set('salesScript', salesScript)}
              addLabel="Add step"
              placeholder="e.g. Confirm exactly what the customer wants"
              ordered
              emptyHint="No steps yet. Without these your agent will improvise its approach."
            />
          </Card>

          <Card>
            <SectionTitle title="Upsells"
              hint="Extras your agent may suggest alongside a main purchase." />
            <ListEditor
              items={form.upsells} disabled={!canWrite}
              onChange={(upsells) => set('upsells', upsells)}
              addLabel="Add upsell"
              placeholder="e.g. Screen protector"
              emptyHint="No upsells configured."
            />
          </Card>

          <Card>
            <SectionTitle title="When to hand over to a human"
              hint="If any of these apply, your agent stops and alerts you instead of continuing." />
            <ListEditor
              items={form.escalationRules} disabled={!canWrite}
              onChange={(escalationRules) => set('escalationRules', escalationRules)}
              addLabel="Add rule"
              placeholder="e.g. The customer is upset or asking for a refund"
              emptyHint="No handover rules yet."
            />
          </Card>

          <Card>
            <SectionTitle title="Business instructions"
              hint="Anything specific your agent must always know or never say." />
            <Textarea
              rows={4} disabled={!canWrite} value={form.customInstructions}
              onChange={(e) => set('customInstructions', e.target.value)}
              placeholder="e.g. We do not ship outside the country. Always mention the one-year warranty."
            />
          </Card>

          <Card>
            <SectionTitle title="Follow-ups"
              hint="Sent automatically to a customer who goes quiet." />
            <Field
              label="Follow-up message"
              hint="Use {agent_name}, {business_name} and {customer_name} — they are filled in automatically for you."
            >
              <Textarea
                rows={3} disabled={!canWrite} value={form.followupTemplate}
                onChange={(e) => set('followupTemplate', e.target.value)}
                placeholder="Hi {customer_name}! {agent_name} here from {business_name}. Can I help you finish your order?"
              />
            </Field>
            <div style={{ marginTop: 12, maxWidth: 220 }}>
              <Field label="Wait before following up" hint="Hours of silence.">
                <Input
                  type="number" min={1} max={720} disabled={!canWrite}
                  value={form.followupDelayHours}
                  onChange={(e) => set('followupDelayHours', Number(e.target.value))}
                />
              </Field>
            </div>
          </Card>

          <Card>
            <SectionTitle title="Advanced" hint="Sensible defaults; change only if you need to." />
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              <Field label="Model" hint="Which AI model answers your customers.">
                <Select
                  value={form.model} disabled={!canWrite} options={MODELS}
                  onChange={(e) => set('model', e.target.value)}
                />
              </Field>
              <Field label="Conversation memory" hint="How many past messages the agent keeps in mind (1–200).">
                <Input
                  type="number" min={1} max={200} disabled={!canWrite}
                  value={form.memoryWindow}
                  onChange={(e) => set('memoryWindow', Number(e.target.value))}
                />
              </Field>
            </div>
          </Card>

          {canWrite && (
            <div>
              <Button variant="solid" icon={<Save size={14} />} loading={save.busy} onClick={() => save.run(form)}>
                Save changes
              </Button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function SectionTitle({ icon, title, hint }: { icon?: React.ReactNode; title: string; hint?: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        {icon}
        <h2 style={{ fontSize: 14, fontWeight: 600 }}>{title}</h2>
      </div>
      {hint && <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 3, lineHeight: 1.5 }}>{hint}</p>}
    </div>
  );
}

function ListEditor({
  items, onChange, disabled, addLabel, placeholder, ordered, emptyHint,
}: {
  items: string[]; onChange: (items: string[]) => void; disabled: boolean;
  addLabel: string; placeholder: string; ordered?: boolean; emptyHint: string;
}) {
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {items.length === 0 && (
        <p style={{ fontSize: 12.5, color: 'var(--text-3)' }}>{emptyHint}</p>
      )}
      {items.map((item, i) => (
        <div key={i} style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
          {ordered && (
            <span style={{
              width: 20, flexShrink: 0, fontSize: 12, color: 'var(--text-3)', textAlign: 'right',
            }}>
              {i + 1}.
            </span>
          )}
          <Input
            value={item} placeholder={placeholder} disabled={disabled} style={{ flex: 1 }}
            onChange={(e) => onChange(items.map((v, j) => (j === i ? e.target.value : v)))}
          />
          {!disabled && (
            <button
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              aria-label="Remove"
              style={{ color: 'var(--text-3)', padding: 5 }}
            >
              <X size={14} />
            </button>
          )}
        </div>
      ))}
      {!disabled && (
        <div>
          <Button size="sm" variant="outline" icon={<Plus size={12} />} onClick={() => onChange([...items, ''])}>
            {addLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
