import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { PageHeader, ErrorNote, inputStyle } from './Shell';

/**
 * Plain-language agent configuration. Deliberately exposes no n8n concepts --
 * no node names, webhook URLs or workflow ids appear anywhere on this page.
 */
export function AgentSettings({ canWrite }: { canWrite: boolean }) {
  const [agent, setAgent] = useState<any>(null);
  const [scriptText, setScriptText] = useState('');
  const [upsellText, setUpsellText] = useState('');
  const [escalationText, setEscalationText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ agent: any }>('/agent').then((r) => {
      const a = r.agent ?? {};
      setAgent(a);
      setScriptText(Array.isArray(a.sales_script) ? a.sales_script.join('\n') : '');
      setUpsellText(Array.isArray(a.upsell_catalogue) ? a.upsell_catalogue.join(', ') : '');
      setEscalationText(
        a.escalation_rules && Object.keys(a.escalation_rules).length
          ? JSON.stringify(a.escalation_rules, null, 2) : ''
      );
    }).catch((e) => setError(e.message));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setSaved(false);
    try {
      let escalation_rules: any = {};
      if (escalationText.trim()) {
        try { escalation_rules = JSON.parse(escalationText); }
        catch { throw new Error('Escalation rules must be valid JSON'); }
      }
      const body = {
        persona: agent.persona,
        custom_instructions: agent.custom_instructions,
        followup_template: agent.followup_template,
        model: agent.model,
        memory_window: Number(agent.memory_window),
        followup_delay_hours: Number(agent.followup_delay_hours),
        sales_script: scriptText.split('\n').map((s) => s.trim()).filter(Boolean),
        upsell_catalogue: upsellText.split(',').map((s) => s.trim()).filter(Boolean),
        escalation_rules,
      };
      const updated = await api('/agent', { method: 'PUT', body });
      setAgent(updated);
      setSaved(true);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }

  if (!agent) return <><PageHeader title="AI Agent" /><ErrorNote error={error} /></>;

  const set = (k: string) => (e: any) => setAgent({ ...agent, [k]: e.target.value });

  return (
    <>
      <PageHeader title="AI Agent" subtitle="How your agent talks to customers and sells for you." />
      <ErrorNote error={error} />

      <form onSubmit={save} className="p-6 max-w-3xl space-y-5">
        <Section title="Personality and tone"
          hint="Describe how the agent should come across — friendly, formal, brief, warm. Written in plain language.">
          <textarea
            value={agent.persona ?? ''} onChange={set('persona')} rows={4} disabled={!canWrite}
            placeholder="Warm, confident and concise. Speaks English and Swahili. Never pushy."
            className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={inputStyle}
          />
        </Section>

        <Section title="Sales steps"
          hint="One step per line. The agent follows these in order and asks only one question per reply.">
          <textarea
            value={scriptText} onChange={(e) => setScriptText(e.target.value)} rows={7} disabled={!canWrite}
            placeholder={'Greet and ask what they are looking for\nConfirm the exact model and budget\nQuote the price from the catalogue\nAsk for delivery location\nShare payment details'}
            className="w-full px-3 py-2 rounded-lg text-sm outline-none font-mono" style={inputStyle}
          />
        </Section>

        <Section title="Upsells" hint="Comma separated. The agent may offer these alongside a main product.">
          <input
            value={upsellText} onChange={(e) => setUpsellText(e.target.value)} disabled={!canWrite}
            placeholder="Screen protector, Case, Charger"
            className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={inputStyle}
          />
        </Section>

        <Section title="Custom instructions" hint="Anything specific to your business the agent must always know.">
          <textarea
            value={agent.custom_instructions ?? ''} onChange={set('custom_instructions')} rows={4} disabled={!canWrite}
            className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={inputStyle}
          />
        </Section>

        <Section title="Escalation rules (JSON)" hint="When the agent should stop and hand over to a human.">
          <textarea
            value={escalationText} onChange={(e) => setEscalationText(e.target.value)} rows={4} disabled={!canWrite}
            placeholder='{"handover_if":["customer is angry","order above 200000"]}'
            className="w-full px-3 py-2 rounded-lg text-sm outline-none font-mono" style={inputStyle}
          />
        </Section>

        <Section title="Follow-up message"
          hint="Sent to a lead that has gone quiet. Your business name and agent name are filled in automatically.">
          <textarea
            value={agent.followup_template ?? ''} onChange={set('followup_template')} rows={3} disabled={!canWrite}
            placeholder="Hi! {agent_name} here from {business_name}. You were looking at something earlier — can I help you finish your order?"
            className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={inputStyle}
          />
        </Section>

        <div className="grid md:grid-cols-3 gap-3">
          <Section title="Model" hint="Which AI model answers customers.">
            <select value={agent.model ?? 'gpt-4o-mini'} onChange={set('model')} disabled={!canWrite}
              className="w-full px-3 py-2 rounded-lg text-sm" style={inputStyle}>
              <option value="gpt-4o-mini">gpt-4o-mini (fast, low cost)</option>
              <option value="gpt-4o">gpt-4o (most capable)</option>
            </select>
          </Section>
          <Section title="Memory" hint="How many past messages the agent remembers.">
            <input type="number" min={1} max={200} value={agent.memory_window ?? 50}
              onChange={set('memory_window')} disabled={!canWrite}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={inputStyle} />
          </Section>
          <Section title="Follow up after (hours)" hint="Quiet time before a follow-up is sent.">
            <input type="number" min={1} max={720} value={agent.followup_delay_hours ?? 24}
              onChange={set('followup_delay_hours')} disabled={!canWrite}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={inputStyle} />
          </Section>
        </div>

        {canWrite && (
          <div className="flex items-center gap-3">
            <button type="submit" disabled={busy}
              className="px-4 py-2 rounded-lg text-sm disabled:opacity-50"
              style={{ background: 'var(--white)', color: 'var(--black)' }}>
              {busy ? 'Saving…' : 'Save agent settings'}
            </button>
            {saved && <span className="text-sm" style={{ color: '#6ee7b7' }}>Saved</span>}
          </div>
        )}
      </form>
    </>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-sm font-medium">{title}</h2>
      {hint && <p className="text-xs mt-0.5 mb-2" style={{ color: 'var(--text-2)' }}>{hint}</p>}
      {children}
    </div>
  );
}
