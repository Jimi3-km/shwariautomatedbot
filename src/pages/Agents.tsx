import React, { useState } from 'react';
import { Bot, Plus, Lock, MessageSquare } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getAgents, createAgent, updateAgent } from '../lib/api';
import type { AgentConfig, AgentRole, AgentStatus } from '../types';
import { useAsync, useMutation } from '../hooks';
import { useSession } from '../app/SessionContext';
import {
  Button, Card, EmptyState, ErrorState, Field, InlineError, LoadingState,
  Modal, PageHeader, Pill, Select, Textarea, Input, useToast,
} from '../components/ui';

/**
 * Agents, edited by hand.
 *
 * Everything here can also be done by talking to Shwari, and most owners will.
 * This exists for the times a form is simply better: checking what an agent was
 * actually told, fixing one line without a conversation, or switching one off
 * quickly.
 *
 * What is deliberately not editable is capability. An agent's tools are set by
 * its role, not per business — so the card shows how many it has and no way to
 * change them. The manager is not editable at all: it configures the others,
 * and something that could grant itself powers would not be a manager.
 */

const STATUS_TONE: Record<AgentStatus, 'success' | 'warning' | 'neutral'> = {
  active: 'success', draft: 'warning', disabled: 'neutral',
};

const STATUS_LABEL: Record<AgentStatus, string> = {
  active: 'Live', draft: 'Draft', disabled: 'Off',
};

export function Agents() {
  const { isAdmin } = useSession();
  const toast = useToast();
  const state = useAsync(() => getAgents(), []);
  const [editing, setEditing] = useState<AgentConfig | null>(null);

  const add = useMutation(async (role: AgentRole) => {
    await createAgent({ role });
    toast.push('success', 'Added as a draft. Set it up, then switch it on.');
    state.reload();
  });

  if (state.loading && !state.data) {
    return <><PageHeader title="Your AI team" /><LoadingState rows={3} /></>;
  }
  if (state.error) {
    return <><PageHeader title="Your AI team" /><ErrorState message={state.error} onRetry={state.reload} /></>;
  }

  const { agents, available } = state.data!;

  return (
    <>
      <PageHeader
        title="Your AI team"
        subtitle="Set each agent up here, or just tell Shwari what you want."
      />

      <div className="p-5" style={{ display: 'grid', gap: 14, maxWidth: 780 }}>
        <InlineError message={add.error} />

        <Card>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <MessageSquare size={15} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} />
            <p style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.6 }}>
              You can do all of this by chatting instead — try{' '}
              <Link to="/shwari" style={{ color: 'var(--accent)' }}>
                “make the sales agent more proactive”
              </Link>{' '}
              or “don’t let anyone quote implant prices”.
            </p>
          </div>
        </Card>

        {!agents.length && (
          <EmptyState
            icon={<Bot size={22} />}
            title="No agents yet"
            body="Add one below, or ask Shwari which team suits your business."
          />
        )}

        {agents.map((a) => (
          <Card key={a.id}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14.5, fontWeight: 600 }}>{a.name}</span>
                  <Pill tone={STATUS_TONE[a.status]} dot>{STATUS_LABEL[a.status]}</Pill>
                  {!a.editable && (
                    <span
                      title="Shwari runs your other agents, so its own setup is fixed."
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 3,
                        fontSize: 11, color: 'var(--text-3)',
                      }}
                    >
                      <Lock size={10} /> Fixed
                    </span>
                  )}
                </div>

                <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 5, lineHeight: 1.55 }}>
                  {a.objective}
                </p>

                {a.instructions && (
                  <p style={{
                    fontSize: 12, color: 'var(--text-3)', marginTop: 7, lineHeight: 1.55,
                    paddingLeft: 10, borderLeft: '2px solid var(--border-2)',
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}>
                    {a.instructions}
                  </p>
                )}

                <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 8 }}>
                  {a.capability_count} {a.capability_count === 1 ? 'capability' : 'capabilities'}
                </div>
              </div>

              {isAdmin && a.editable && (
                <Button size="sm" onClick={() => setEditing(a)} style={{ flexShrink: 0 }}>
                  Set up
                </Button>
              )}
            </div>
          </Card>
        ))}

        {isAdmin && available.length > 0 && (
          <Card>
            <div className="section-label" style={{ marginBottom: 10 }}>Add an agent</div>
            <div style={{ display: 'grid', gap: 8 }}>
              {available.map((v) => (
                <div key={v.role} style={{
                  display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                  padding: '10px 12px', borderRadius: 'var(--radius)', background: 'var(--surface-2)',
                }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 550 }}>{v.name}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 2, lineHeight: 1.5 }}>
                      {v.summary}
                    </div>
                  </div>
                  <Button
                    size="sm" variant="accent" icon={<Plus size={13} />}
                    loading={add.busy} onClick={() => add.run(v.role)}
                    style={{ flexShrink: 0 }}
                  >
                    Add
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        )}
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

function AgentEditor({ agent, onClose, onSaved }: {
  agent: AgentConfig;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(agent.name);
  const [objective, setObjective] = useState(agent.objective);
  const [instructions, setInstructions] = useState(agent.instructions);
  const [escalation, setEscalation] = useState(agent.escalation);
  const [status, setStatus] = useState<AgentStatus>(agent.status);

  const save = useMutation(async () => {
    await updateAgent(agent.role, {
      name: name.trim(),
      objective: objective.trim(),
      instructions: instructions.trim(),
      escalation: escalation.trim(),
      status,
    });
    onSaved();
  });

  return (
    <Modal
      open onClose={onClose} title={`Set up ${agent.name}`} width={560}
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

        <Field label="Name" hint="What customers see it called." required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <Field label="What it's for" hint="One sentence.">
          <Textarea rows={2} value={objective} onChange={(e) => setObjective(e.target.value)} />
        </Field>

        <Field
          label="How it should work"
          hint="Anything specific to your business — tone, what to push, what to avoid. This is added to its built-in rules, never instead of them."
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

        <Field label="Status" hint="Only a live agent answers customers.">
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as AgentStatus)}
            options={[
              { value: 'draft', label: 'Draft — not answering yet' },
              { value: 'active', label: 'Live — answering customers' },
              { value: 'disabled', label: 'Off' },
            ]}
          />
        </Field>
      </div>
    </Modal>
  );
}
