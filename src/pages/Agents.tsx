import React, { useState } from 'react';
import {
  Sparkles, ShoppingBag, LifeBuoy, CalendarDays, Receipt, Lock, Check, MessageSquare,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { getAgents, updateAgent } from '../lib/api';
import type { AgentConfig, AgentRole, AgentStatus } from '../types';
import { useAsync, useMutation } from '../hooks';
import { useSession } from '../app/SessionContext';
import {
  Button, Card, ErrorState, Field, InlineError, LoadingState,
  Modal, PageHeader, Pill, Select, Textarea, Input, useToast,
} from '../components/ui';

/**
 * The workforce.
 *
 * Five agents, the same five for every business, provisioned before the owner
 * sees this page. There is nothing to add, nothing to assemble and no
 * capability picker — a department arrives knowing its job.
 *
 * Every capability listed is a real tool the agent holds, read from the same
 * row the runtime reads. The label map below is the only thing this page adds,
 * and a tool with no label is shown by name rather than hidden, so the list can
 * never quietly claim less than the agent can actually do.
 */

const ROLE_ICON: Record<AgentRole, React.ReactNode> = {
  manager: <Sparkles size={16} />,
  sales: <ShoppingBag size={16} />,
  support: <LifeBuoy size={16} />,
  booking: <CalendarDays size={16} />,
  orders: <Receipt size={16} />,
};

const STATUS_TONE: Record<AgentStatus, 'success' | 'warning' | 'neutral'> = {
  active: 'success', draft: 'warning', disabled: 'neutral',
};

const STATUS_LABEL: Record<AgentStatus, string> = {
  active: 'Working', draft: 'Draft', disabled: 'Off',
};

/** Real tool names → what they mean to a business owner. */
const CAPABILITY_LABELS: Record<string, string> = {
  get_business_profile: 'Read your business details',
  update_business_profile: 'Update your business details',
  list_services: 'Look up your services',
  save_service: 'Add or change a service',
  remove_service: 'Stop offering a service',
  list_products: 'Look up your products',
  save_product: 'Add or change a product',
  remove_product: 'Take a product out of stock',
  get_opening_hours: 'Check your opening hours',
  set_opening_hours: 'Set your opening hours',
  search_business_knowledge: 'Search what your business has told it',
  save_business_fact: 'Record a policy or fact',
  record_knowledge_gap: 'Note a question it could not answer',
  list_knowledge_gaps: 'Review unanswered questions',
  business_metrics: 'Read your numbers',
  attention_needed: 'Spot what needs you today',
  find_customers: 'Search your customers',
  update_customer: 'Update a customer or their stage',
  list_appointments: 'Check the diary',
  book_appointment: 'Book an appointment',
  reschedule_appointment: 'Move an appointment',
  cancel_appointment: 'Cancel an appointment',
  list_orders: 'Look up orders',
  record_order: 'Record an order',
  update_order_status: 'Move an order along',
  record_payment_claim: 'Write down a payment claim for you to verify',
  open_ticket: 'Open a support ticket',
  list_tickets: 'Review open tickets',
  update_ticket: 'Update or resolve a ticket',
  escalate_to_human: 'Hand the conversation to a person',
  schedule_follow_up: 'Queue a follow-up message',
  list_follow_ups: 'Review queued messages',
  cancel_follow_up: 'Cancel a queued message',
  list_team: 'Check on the rest of the team',
  configure_agent: 'Adjust how a department works',
  activate_agent: 'Switch a department on or off',
  delegate_to_agent: 'Hand a job to a department',
  setup_status: 'Check what setup still needs',
};

export function Agents() {
  const { isAdmin } = useSession();
  const toast = useToast();
  const state = useAsync(() => getAgents(), []);
  const [editing, setEditing] = useState<AgentConfig | null>(null);

  if (state.loading && !state.data) {
    return <><PageHeader title="Your AI team" /><LoadingState rows={4} /></>;
  }
  if (state.error) {
    return <><PageHeader title="Your AI team" /><ErrorState message={state.error} onRetry={state.reload} /></>;
  }

  const agents = state.data!.agents;
  const manager = agents.find((a) => a.role === 'manager');
  const departments = agents.filter((a) => a.role !== 'manager');

  return (
    <>
      <PageHeader
        title="Your AI team"
        subtitle="Five agents, ready to work. You run them by talking to Shwari."
      />

      <div className="p-5" style={{ display: 'grid', gap: 16, maxWidth: 860 }}>
        <Card>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <MessageSquare size={15} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} />
            <p style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.6 }}>
              You don't configure these — they already know their jobs.{' '}
              <Link to="/shwari" style={{ color: 'var(--accent)' }}>Tell Shwari</Link>{' '}
              what you want changed, or edit a department directly below.
            </p>
          </div>
        </Card>

        {manager && (
          <section>
            <div className="section-label" style={{ marginBottom: 8 }}>Works with you</div>
            <AgentCard agent={manager} isAdmin={isAdmin} onEdit={setEditing} />
          </section>
        )}

        <section>
          <div className="section-label" style={{ marginBottom: 8 }}>Works with your customers</div>
          <div style={{ display: 'grid', gap: 10 }}>
            {departments.map((a) => (
              <AgentCard key={a.id} agent={a} isAdmin={isAdmin} onEdit={setEditing} />
            ))}
          </div>
        </section>
      </div>

      {editing && (
        <AgentEditor
          agent={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); toast.push('success', 'Saved.'); state.reload(); }}
        />
      )}
    </>
  );
}

function AgentCard({ agent, isAdmin, onEdit }: {
  agent: AgentConfig;
  isAdmin: boolean;
  onEdit: (a: AgentConfig) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? agent.capabilities : agent.capabilities.slice(0, 6);
  const hidden = agent.capabilities.length - shown.length;

  return (
    <Card>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{
          width: 34, height: 34, borderRadius: 'var(--radius)', flexShrink: 0,
          background: 'var(--accent-soft)', color: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {ROLE_ICON[agent.role]}
        </div>

        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14.5, fontWeight: 600 }}>{agent.name}</span>
            <Pill tone={STATUS_TONE[agent.status]} dot>{STATUS_LABEL[agent.status]}</Pill>
            {!agent.editable && (
              <span
                title="Shwari directs your other agents, so its own setup is fixed."
                style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--text-3)' }}
              >
                <Lock size={10} /> Fixed
              </span>
            )}
          </div>

          <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 5, lineHeight: 1.55 }}>
            {agent.summary}
          </p>

          <ul style={{ margin: '10px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 4 }}>
            {agent.responsibilities.map((r) => (
              <li key={r} style={{
                display: 'flex', gap: 7, alignItems: 'flex-start',
                fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5,
              }}>
                <Check size={11} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 3 }} />
                <span style={{ minWidth: 0 }}>{r}</span>
              </li>
            ))}
          </ul>

          {agent.instructions && (
            <p style={{
              fontSize: 12, color: 'var(--text-3)', marginTop: 10, lineHeight: 1.55,
              paddingLeft: 10, borderLeft: '2px solid var(--border-2)',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {agent.instructions}
            </p>
          )}

          {agent.capabilities.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="section-label" style={{ marginBottom: 6 }}>
                What it can do ({agent.capabilities.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {shown.map((c) => (
                  <span key={c} style={{
                    fontSize: 11, padding: '3px 8px', borderRadius: 999,
                    background: 'var(--surface-2)', color: 'var(--text-2)',
                  }}>
                    {/* An unmapped tool shows its own name rather than
                        disappearing: the list must never understate the agent. */}
                    {CAPABILITY_LABELS[c] ?? c}
                  </span>
                ))}
                {hidden > 0 && (
                  <button
                    onClick={() => setShowAll(true)}
                    style={{
                      fontSize: 11, padding: '3px 8px', borderRadius: 999,
                      background: 'none', border: '1px dashed var(--border-2)',
                      color: 'var(--text-3)', cursor: 'pointer',
                    }}
                  >
                    +{hidden} more
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {isAdmin && agent.editable && (
          <Button size="sm" onClick={() => onEdit(agent)} style={{ flexShrink: 0 }}>
            Edit
          </Button>
        )}
      </div>
    </Card>
  );
}

function AgentEditor({ agent, onClose, onSaved }: {
  agent: AgentConfig;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(agent.name);
  const [instructions, setInstructions] = useState(agent.instructions);
  const [escalation, setEscalation] = useState(agent.escalation);
  const [status, setStatus] = useState<AgentStatus>(agent.status);

  const save = useMutation(async () => {
    await updateAgent(agent.role, {
      name: name.trim(),
      instructions: instructions.trim(),
      escalation: escalation.trim(),
      status,
    });
    onSaved();
  });

  return (
    <Modal
      open onClose={onClose} title={`Edit ${agent.name}`} width={560}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="accent" loading={save.busy} disabled={!name.trim()} onClick={() => save.run()}>
            Save
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 14 }}>
        <InlineError message={save.error} />

        <p style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.6 }}>
          {agent.summary}
        </p>

        <Field label="Name" hint="What customers see it called." required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <Field
          label="How it should work"
          hint="Anything specific to your business — tone, what to push, what to avoid. Added to its built-in rules, never instead of them."
        >
          <Textarea
            rows={5}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Be warm but brief. Never quote implant prices — book a consultation instead."
          />
        </Field>

        <Field label="When to fetch a person" hint="It always hands over for complaints and anything about money already paid.">
          <Textarea rows={2} value={escalation} onChange={(e) => setEscalation(e.target.value)} />
        </Field>

        <Field label="Status" hint="Only a working agent answers customers.">
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as AgentStatus)}
            options={[
              { value: 'active', label: 'Working — answering customers' },
              { value: 'disabled', label: 'Off' },
            ]}
          />
        </Field>

        <p style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.5 }}>
          What this agent is able to do is fixed and cannot be changed here — the
          safeguards around payments and escalation depend on it.
        </p>
      </div>
    </Modal>
  );
}
