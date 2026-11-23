import React, { useEffect, useId, useState } from 'react';
import {
  Sparkles, ShoppingBag, LifeBuoy, CalendarDays, Receipt, Megaphone, Lock, Check, ChevronDown,
  MessageSquare, ShieldCheck, GraduationCap, AlertTriangle, ChevronsDownUp, ChevronsUpDown,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { getAgents, getAgentLessons, updateAgent } from '../lib/api';
import type { AgentConfig, AgentLesson, AgentRole, AgentStatus } from '../types';
import { useAsync, useMutation } from '../hooks';
import { useSession } from '../app/SessionContext';
import {
  Button, Disclosure, DisclosurePanel, ErrorState, Field, InlineError, LoadingState,
  PageHeader, Pill, Switch, Textarea, Input, useToast,
} from '../components/ui';

/**
 * The workforce.
 *
 * Six agents, the same six for every business, provisioned before the owner
 * sees this page. There is nothing to add, nothing to assemble and no
 * capability picker — an agent arrives knowing its job.
 *
 * The page is layered so it can be read at a glance and opened where it
 * matters: one row per agent, and inside each, a section per question an owner
 * asks ("what does it handle", "what can it do", "what did I tell it").
 *
 * Every capability listed is a real tool the agent holds, read from the same
 * row the runtime reads. The label map below is the only thing this page adds,
 * and a tool with no label is shown in plain words rather than hidden, so the
 * list can never quietly claim less than the agent can actually do. What an
 * agent can do is not editable here or anywhere else.
 */

const ROLE_ICON: Record<AgentRole, React.ReactNode> = {
  manager: <Sparkles size={16} />,
  sales: <ShoppingBag size={16} />,
  support: <LifeBuoy size={16} />,
  booking: <CalendarDays size={16} />,
  orders: <Receipt size={16} />,
  marketing: <Megaphone size={16} />,
};

const STATUS_TONE: Record<AgentStatus, 'success' | 'warning' | 'neutral'> = {
  active: 'success', draft: 'warning', disabled: 'neutral',
};

const STATUS_LABEL: Record<AgentStatus, string> = {
  active: 'On', draft: 'Draft', disabled: 'Off',
};

/** The four departments that answer customers, in the order they are shown. */
const CUSTOMER_ROLES: AgentRole[] = ['sales', 'support', 'booking', 'orders'];

const LESSON_SOURCE: Record<AgentLesson['source'], string> = {
  owner: 'You told it', qa_label: 'From a quality review', staff_reply: 'From how your team answered',
};

type SectionId = 'handles' | 'tools' | 'rules' | 'instructions' | 'lessons' | 'escalation';

/** A tool that only looks something up, as opposed to one that changes something. */
const READS = /^(?:list|get|search|find|read|review)_/;
const READS_BY_NAME = ['business_metrics', 'attention_needed', 'lead_pipeline', 'setup_status'];
/** Tools that pass the work to someone else. */
const HANDOVERS = ['escalate_to_human', 'hand_to_department', 'delegate_to_agent'];

// What is open is remembered per browser. Storage can be unavailable (private
// windows, blocked site data), so every read and write is guarded and the page
// works the same without it.
const STORE_KEY = 'shwari.aiTeam.v1';

interface Remembered {
  /** The agents whose rows are open. */
  open: AgentRole[];
  /** True after "Expand all": rows then open and close independently. */
  many: boolean;
  /** Sub-sections, keyed "role:section". Absent means the default. */
  sections: Record<string, boolean>;
}

const FIRST_VISIT: Remembered = { open: ['manager'], many: false, sections: {} };

function remembered(): Remembered {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return FIRST_VISIT;
    const saved = JSON.parse(raw) as Partial<Remembered> | null;
    if (!saved || typeof saved !== 'object') return FIRST_VISIT;
    return {
      open: Array.isArray(saved.open) ? saved.open.filter((r) => typeof r === 'string') : FIRST_VISIT.open,
      many: saved.many === true,
      sections: saved.sections && typeof saved.sections === 'object' ? saved.sections : {},
    };
  } catch {
    return FIRST_VISIT;
  }
}

function remember(value: Remembered) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(value));
  } catch {
    /* Not being able to remember is not an error worth showing. */
  }
}

/** Real tool names → what they mean to a business owner. */
const CAPABILITY_LABELS: Record<string, string> = {
  get_business_profile: 'Read your business details',
  update_business_profile: 'Update your business details',
  update_business_settings: 'Change your settings',
  get_business_settings: 'Read your settings',
  list_channels: 'See the connected channels',
  list_conversations: 'Read the inbox',
  read_conversation: 'Read a customer conversation',
  list_payment_claims: 'Review payment claims awaiting your check',
  get_agent_settings: 'Read the AI Agent settings',
  update_agent_settings: 'Change the AI Agent settings',
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
  message_customer: 'Message a customer in the inbox',
  set_conversation_handling: 'Take over a chat or hand it back',
  save_customer_details: 'Save a customer’s name, email and phone',
  set_payment_instructions: 'Set how customers should pay you',
  get_payment_instructions: 'Read out how to pay',
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
  configure_agent: 'Adjust how an agent works',
  activate_agent: 'Switch an agent on or off',
  delegate_to_agent: 'Hand a job to one of the team',
  setup_status: 'Check what setup still needs',
  get_customer_history: "Look up a customer's bookings, orders and tickets",
  hand_to_department: 'Pass a customer to the right department',
  teach_team: 'Teach the team a correction',
  list_lessons: 'See what the team has been taught',
  forget_lesson: 'Retire a lesson',
  lead_pipeline: 'Read the sales pipeline and who to chase',
  review_agent_quality: 'Review how the team is performing',
  save_products: 'Add or change several products',
  save_services: 'Add or change several services',
  remove_products: 'Delete products',
  remove_services: 'Stop offering several services',
  resend_receipt: 'Send a receipt again',
  list_content_library: 'See the photos and videos you uploaded for posting',
  propose_week_posts: 'Lay out a week of posts for you to approve',
  list_scheduled_posts: 'Read the posting calendar',
  approve_posts: 'Approve posts when you say so',
  update_scheduled_post: 'Edit, move, swap or reject a post',
  set_posting_schedule: 'Set your posting days and approval mode',
  pause_posting: 'Pause or resume posting',
};

export function Agents() {
  const { isAdmin } = useSession();
  const toast = useToast();
  const state = useAsync(() => getAgents(), []);
  // Lessons are a detail of the page, not a condition of it: a server without
  // them still has a team to show.
  const taught = useAsync(
    () => getAgentLessons().catch(() => ({ lessons: [] as AgentLesson[], available: false })),
    []
  );
  const [view, setView] = useState<Remembered>(remembered);
  const [switching, setSwitching] = useState<AgentRole | null>(null);

  useEffect(() => { remember(view); }, [view]);

  if (state.loading && !state.data) {
    return <><PageHeader title="Your AI team" /><LoadingState rows={4} /></>;
  }
  if (state.error && !state.data) {
    return <><PageHeader title="Your AI team" /><ErrorState message={state.error} onRetry={state.reload} /></>;
  }

  const agents = state.data!.agents;
  const sharedRules = state.data!.shared_rules ?? [];
  const lessons = taught.data?.lessons ?? [];

  const manager = agents.find((a) => a.role === 'manager');
  const departments = CUSTOMER_ROLES
    .map((role) => agents.find((a) => a.role === role))
    .filter((a): a is AgentConfig => Boolean(a));
  const marketing = agents.find((a) => a.role === 'marketing');

  const on = agents.filter((a) => a.status === 'active');
  const off = agents.filter((a) => a.status !== 'active');
  const allOpen = agents.length > 0 && agents.every((a) => view.open.includes(a.role));

  const toggleAgent = (role: AgentRole) =>
    setView((v) => {
      const isOpen = v.open.includes(role);
      // One at a time, until the owner has asked to see everything.
      if (!v.many) return { ...v, open: isOpen ? [] : [role] };
      return { ...v, open: isOpen ? v.open.filter((r) => r !== role) : [...v.open, role] };
    });

  const toggleAll = () =>
    setView((v) => (allOpen
      ? { ...v, open: [], many: false }
      : { ...v, open: agents.map((a) => a.role), many: true }));

  const sectionOpen = (role: AgentRole, id: SectionId) =>
    view.sections[`${role}:${id}`] ?? id === 'handles';

  const setSection = (role: AgentRole, id: SectionId, open: boolean) =>
    setView((v) => ({ ...v, sections: { ...v.sections, [`${role}:${id}`]: open } }));

  const setStatus = async (agent: AgentConfig, active: boolean) => {
    setSwitching(agent.role);
    try {
      await updateAgent(agent.role, { status: active ? 'active' : 'disabled' });
      toast.push(
        active ? 'success' : 'info',
        agent.role === 'marketing'
          ? active
            ? 'Marketing is on. Posts are planned and approved posts are published again.'
            : 'Marketing is off. No posts are planned or published until it is switched back on.'
          : active
            ? `${agent.name} is on and answering customers.`
            : `${agent.name} is off. Its messages go to the rest of the team.`
      );
      state.reload();
    } catch (e) {
      toast.push('error', e instanceof Error && e.message ? e.message : 'That could not be changed. Please try again.');
    } finally {
      setSwitching(null);
    }
  };

  const row = (agent: AgentConfig) => (
    <AgentRow
      key={agent.id}
      agent={agent}
      isAdmin={isAdmin}
      open={view.open.includes(agent.role)}
      onToggle={() => toggleAgent(agent.role)}
      sectionOpen={(id) => sectionOpen(agent.role, id)}
      onSection={(id, open) => setSection(agent.role, id, open)}
      lessons={lessons.filter((l) => l.role === null || l.role === agent.role)}
      lessonsAvailable={taught.data?.available !== false}
      switching={switching === agent.role}
      onStatus={(active) => setStatus(agent, active)}
      onSaved={() => { toast.push('success', 'Saved.'); state.reload(); }}
    />
  );

  return (
    <>
      <PageHeader
        title="Your AI team"
        subtitle="The agents that run your business with you. You direct them by talking to Shwari."
      />

      <div className="scroll-y team-page">
        <div className="team-stack">
          <p className="team-intro">
            Every business gets the same team, and each agent already knows its job: Shwari works with you,
            four departments answer your customers, and Marketing keeps you posting.{' '}
            <Link to="/shwari">Tell Shwari</Link> what you want changed, or open an agent below to see what
            it handles and add your own instructions.
          </p>

          <div className="team-summary" role="status">
            <span className="team-stat">
              <strong>{on.length} of {agents.length}</strong> agents on
            </span>
            {off.length > 0 ? (
              <span className="team-stat is-warning">
                <AlertTriangle size={13} aria-hidden />
                {off.map((a) => a.name).join(', ')} {off.length === 1 ? 'is' : 'are'} off
              </span>
            ) : (
              <span className="team-stat is-ok">
                <Check size={13} aria-hidden /> Nothing needs your attention
              </span>
            )}
            {lessons.length > 0 && (
              <span className="team-stat">
                <strong>{lessons.length}</strong> {lessons.length === 1 ? 'lesson' : 'lessons'} taught
              </span>
            )}
            <span className="team-summary-spacer" />
            <Button
              size="sm"
              onClick={toggleAll}
              icon={allOpen ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
            >
              {allOpen ? 'Collapse all' : 'Expand all'}
            </Button>
          </div>

          {manager && (
            <section className="team-group" aria-label="Works with you">
              <div className="section-label">Works with you</div>
              {row(manager)}
            </section>
          )}

          {departments.length > 0 && (
            <section className="team-group" aria-label="Works with your customers">
              <div className="section-label">Works with your customers</div>
              <div className="team-group-list">{departments.map(row)}</div>
            </section>
          )}

          {marketing && (
            <section className="team-group" aria-label="Works on your posts">
              <div className="section-label">Works on your posts</div>
              <div className={`team-note ${marketing.status === 'active' ? '' : 'is-warning'}`}>
                {marketing.status === 'active'
                  ? <Megaphone size={14} aria-hidden />
                  : <AlertTriangle size={14} aria-hidden />}
                <span>
                  {marketing.status === 'active'
                    ? 'Marketing works on the Marketing page rather than in chats: it plans your posts there and publishes the ones you approve. It never talks to a customer.'
                    : 'Marketing is off, so no posts are being planned or published, including ones you already approved. They stay on the calendar until you switch it back on.'}{' '}
                  <Link to="/marketing">Open the Marketing page</Link>
                </span>
              </div>
              {row(marketing)}
            </section>
          )}

          {sharedRules.length > 0 && (
            <section className="team-group" aria-label="Rules every agent follows">
              <div className="section-label">The whole team</div>
              <Disclosure title="Rules every agent follows" count={sharedRules.length}>
                <RuleList rules={sharedRules} />
                <p className="team-muted" style={{ marginTop: 10 }}>
                  These are built in. Your instructions are added to them, never instead of them.
                </p>
              </Disclosure>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

/** A rule is written for the agent, so it names its tools. Say those in plain words. */
function plainWords(rule: string): string {
  return rule.replace(/\b[a-z]+(?:_[a-z]+)+\b/g, (token) => {
    const label = CAPABILITY_LABELS[token];
    return label ? `“${label.charAt(0).toLowerCase()}${label.slice(1)}”` : token.replace(/_/g, ' ');
  });
}

/** The owner's words for a tool. One with no label is still shown, never as a raw name. */
function capabilityLabel(tool: string): string {
  const spaced = tool.replace(/_/g, ' ');
  return CAPABILITY_LABELS[tool] ?? `${spaced.charAt(0).toUpperCase()}${spaced.slice(1)}`;
}

function RuleList({ rules }: { rules: string[] }) {
  return (
    <ul className="team-list">
      {rules.map((rule) => (
        <li key={rule}>
          <ShieldCheck size={12} style={{ color: 'var(--text-3)' }} aria-hidden />
          <span>{plainWords(rule)}</span>
        </li>
      ))}
    </ul>
  );
}

function CapabilityGroup({ label, tools }: { label: string; tools: string[] }) {
  if (!tools.length) return null;
  return (
    <>
      <div className="section-label team-sublabel">{label} ({tools.length})</div>
      <div className="team-chips">
        {tools.map((tool) => <span key={tool} className="team-chip">{capabilityLabel(tool)}</span>)}
      </div>
    </>
  );
}

function AgentRow({
  agent, isAdmin, open, onToggle, sectionOpen, onSection, lessons, lessonsAvailable, switching, onStatus, onSaved,
}: {
  agent: AgentConfig;
  isAdmin: boolean;
  open: boolean;
  onToggle: () => void;
  sectionOpen: (id: SectionId) => boolean;
  onSection: (id: SectionId, open: boolean) => void;
  lessons: AgentLesson[];
  lessonsAvailable: boolean;
  switching: boolean;
  onStatus: (active: boolean) => void;
  onSaved: () => void;
}) {
  const id = useId();
  const isOn = agent.status === 'active';
  const canEdit = isAdmin && agent.editable;
  const rules = agent.rules ?? [];

  const lookups = agent.capabilities.filter((t) => READS.test(t) || READS_BY_NAME.includes(t));
  const handovers = agent.capabilities.filter((t) => HANDOVERS.includes(t));
  const actions = agent.capabilities.filter((t) => !lookups.includes(t) && !handovers.includes(t));

  const section = (sid: SectionId) => ({
    open: sectionOpen(sid),
    onToggle: (next: boolean) => onSection(sid, next),
  });

  return (
    <div
      className={`agent-acc ${agent.role === 'manager' ? 'is-manager' : ''} ${isOn ? '' : 'is-off'}`}
      data-open={open ? 'true' : 'false'}
    >
      <div className="agent-acc-head">
        <button
          type="button" id={`${id}-head`} className="agent-acc-toggle"
          aria-expanded={open} aria-controls={`${id}-panel`} onClick={onToggle}
        >
          <span className="agent-acc-icon" aria-hidden>{ROLE_ICON[agent.role]}</span>
          <span className="agent-acc-text">
            <span className="agent-acc-name">
              <span>{agent.name}</span>
              {!agent.editable && (
                <span className="agent-acc-fixed" title="Shwari directs your other agents, so its own setup is fixed.">
                  <Lock size={10} aria-hidden /> Fixed
                </span>
              )}
            </span>
            <span className="agent-acc-summary">{agent.summary}</span>
          </span>
        </button>

        <div className="agent-acc-state">
          {canEdit ? (
            <>
              <span className="agent-acc-state-label" aria-hidden>{isOn ? 'On' : 'Off'}</span>
              <Switch
                checked={isOn}
                busy={switching}
                label={agent.name}
                onChange={onStatus}
              />
            </>
          ) : (
            <Pill tone={STATUS_TONE[agent.status]} dot>{STATUS_LABEL[agent.status]}</Pill>
          )}
        </div>

        {/* The same toggle for a mouse or a thumb. The button on the left is the
            one keyboards and screen readers use, so this one stays out of their way. */}
        <button type="button" className="agent-acc-chev" tabIndex={-1} aria-hidden onClick={onToggle}>
          <ChevronDown size={16} />
        </button>
      </div>

      <DisclosurePanel id={`${id}-panel`} open={open} labelledBy={`${id}-head`}>
        <div className="agent-acc-body">
          <Disclosure title="What it handles" count={agent.responsibilities.length} {...section('handles')}>
            <ul className="team-list">
              {agent.responsibilities.map((r) => (
                <li key={r}>
                  <Check size={12} style={{ color: 'var(--success)' }} aria-hidden />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </Disclosure>

          <Disclosure title="What it can do" count={agent.capabilities.length} {...section('tools')}>
            <CapabilityGroup label="Looks things up" tools={lookups} />
            <CapabilityGroup label="Takes action" tools={actions} />
            <CapabilityGroup label="Passes work on" tools={handovers} />
            <p className="team-muted" style={{ marginTop: 10 }}>
              What this agent is able to do is fixed and cannot be changed here — the safeguards around
              payments, posts and handing over to a person depend on it.
            </p>
          </Disclosure>

          <Disclosure title="Rules it always follows" count={rules.length || undefined} {...section('rules')}>
            {rules.length > 0
              ? <RuleList rules={rules} />
              : <p className="team-muted">It follows the rules every agent shares.</p>}
            {rules.length > 0 && (
              <p className="team-muted" style={{ marginTop: 10 }}>
                It also follows the rules every agent shares, listed at the bottom of this page.
              </p>
            )}
          </Disclosure>

          <Disclosure
            title="Your instructions"
            count={agent.instructions.trim() ? 1 : undefined}
            {...section('instructions')}
          >
            {canEdit ? (
              <InstructionsForm key={`${agent.name}|${agent.instructions}`} agent={agent} onSaved={onSaved} />
            ) : agent.editable ? (
              <>
                <p className="team-text">{agent.instructions.trim() || 'No extra instructions yet.'}</p>
                <p className="team-muted" style={{ marginTop: 8 }}>Only an owner or admin can change these.</p>
              </>
            ) : (
              <div className="team-note">
                <MessageSquare size={14} aria-hidden />
                <span>
                  Shwari directs your other agents, so its own setup is fixed.{' '}
                  <Link to="/shwari">Tell Shwari</Link> how you like things done and it will remember.
                </span>
              </div>
            )}
          </Disclosure>

          <Disclosure title="What it has been taught" count={lessons.length || undefined} {...section('lessons')}>
            {lessons.length > 0 ? (
              <ul className="team-list">
                {lessons.map((l) => (
                  <li key={l.id}>
                    <GraduationCap size={12} style={{ color: 'var(--accent)' }} aria-hidden />
                    <span>
                      {l.lesson}
                      <span className="team-lesson-from">
                        {LESSON_SOURCE[l.source] ?? 'Taught'}{l.role === null ? ' · applies to every agent' : ''}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="team-muted">
                {lessonsAvailable
                  ? <>Nothing yet. When you correct how it works, <Link to="/shwari">tell Shwari</Link> and the correction is kept here.</>
                  : 'Lessons are not available on this workspace yet.'}
              </p>
            )}
          </Disclosure>

          <Disclosure title="When it brings in a person" {...section('escalation')}>
            {canEdit
              ? <EscalationForm key={agent.escalation} agent={agent} onSaved={onSaved} />
              : <p className="team-text">{agent.escalation}</p>}
          </Disclosure>
        </div>
      </DisclosurePanel>
    </div>
  );
}

function InstructionsForm({ agent, onSaved }: { agent: AgentConfig; onSaved: () => void }) {
  const [name, setName] = useState(agent.name);
  const [instructions, setInstructions] = useState(agent.instructions);
  const changed = name.trim() !== agent.name || instructions.trim() !== agent.instructions.trim();

  const save = useMutation(async () => {
    await updateAgent(agent.role, { name: name.trim(), instructions: instructions.trim() });
    onSaved();
  });

  return (
    <div className="team-form">
      <InlineError message={save.error} />

      <Field
        label="Name"
        hint={agent.role === 'marketing' ? 'What it is called on this page and by Shwari.' : 'What customers see it called.'}
        required
      >
        <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      </Field>

      <Field
        label="How it should work"
        hint="Anything specific to your business — tone, what to push, what to avoid. Added to its built-in rules, never instead of them."
      >
        <Textarea
          rows={5}
          value={instructions}
          maxLength={4000}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder={agent.role === 'marketing'
            ? 'Keep captions short and warm. Always end with how to order.'
            : 'Be warm but brief. Never quote implant prices — book a consultation instead.'}
        />
      </Field>

      <div className="team-form-actions">
        <Button
          variant="accent" size="sm" loading={save.busy}
          disabled={!name.trim() || !changed} onClick={() => save.run()}
        >
          Save instructions
        </Button>
        {!changed && <span className="team-muted">No changes to save.</span>}
      </div>
    </div>
  );
}

function EscalationForm({ agent, onSaved }: { agent: AgentConfig; onSaved: () => void }) {
  const [escalation, setEscalation] = useState(agent.escalation);
  const changed = escalation.trim() !== agent.escalation.trim();

  const save = useMutation(async () => {
    await updateAgent(agent.role, { escalation: escalation.trim() });
    onSaved();
  });

  return (
    <div className="team-form">
      <InlineError message={save.error} />

      <Field
        label="When to fetch a person"
        hint={agent.role === 'marketing'
          ? 'It always flags a caption it cannot back with your records, and a post that failed.'
          : 'It always hands over for complaints and anything about money already paid.'}
      >
        <Textarea rows={3} value={escalation} maxLength={1000} onChange={(e) => setEscalation(e.target.value)} />
      </Field>

      <div className="team-form-actions">
        <Button
          variant="accent" size="sm" loading={save.busy}
          disabled={!changed} onClick={() => save.run()}
        >
          Save
        </Button>
        {!changed && <span className="team-muted">No changes to save.</span>}
      </div>
    </div>
  );
}
