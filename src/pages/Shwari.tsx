import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Send, Sparkles, Link2, Check, Copy, Trash2, HelpCircle, AlertTriangle,
} from 'lucide-react';
import {
  getShwariStatus, getShwariHistory, sendToShwari, getAttention,
  createPairingCode, getLinkedAdmins, unlinkAdmin, ApiError,
} from '../lib/api';
import type { ShwariMessage, ShwariStatus, PairingCode, AttentionReport } from '../types';
import { useAsync } from '../hooks';
import { useSession } from '../app/SessionContext';
import {
  Button, Card, ConfirmDialog, EmptyState, ErrorState, InlineError,
  LoadingState, Modal, PageHeader, Pill, useToast,
} from '../components/ui';
import { relativeTime } from '../lib/format';
import { Link } from 'react-router-dom';

/**
 * Talking to Shwari.
 *
 * The point of this page is that a business owner never has to fill in a form
 * to configure their business. They describe it, Shwari asks about what is
 * missing, and the answers become services, opening hours and policies the
 * other agents read.
 *
 * Nothing technical surfaces here. No tool names, no table names, no ids — the
 * only signal that a turn did something is a quiet "updated" marker, and the
 * detail of what changed lives on the pages that own it.
 */

const SUGGESTIONS = [
  'I run a dental clinic in Nairobi. We do cleaning, whitening, braces and implants — cleaning and whitening can be booked directly, braces and implants need a consultation first.',
  "We're open 8am to 6pm on weekdays, 9 to 1 on Saturday, closed Sunday.",
  'What else do you need to know before we go live?',
];

export function Shwari() {
  const { isAdmin } = useSession();
  const toast = useToast();

  const status = useAsync(() => getShwariStatus(), []);
  const history = useAsync(() => getShwariHistory(), []);

  const [messages, setMessages] = useState<ShwariMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false);

  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (history.data) setMessages(history.data.messages);
  }, [history.data]);

  // Follow the conversation as it grows, including while Shwari is thinking.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, thinking]);

  const send = useCallback(async (text: string) => {
    const message = text.trim();
    if (!message || thinking) return;

    setError(null);
    setDraft('');
    // Show it immediately. A turn takes seconds, and watching your own words
    // disappear into nothing is the worst version of this interaction.
    setMessages((m) => [...m, { from: 'you', text: message, at: new Date().toISOString() }]);
    setThinking(true);

    try {
      const result = await sendToShwari(message);
      setMessages((m) => [...m, {
        from: 'shwari', text: result.reply, at: new Date().toISOString(),
        actions: result.actions,
      }]);
      // A turn that changed something invalidates the team and the open
      // questions, both of which are shown beside the conversation.
      if (result.changed) status.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
      // Put the message back so it is not lost to a failed request.
      setMessages((m) => m.slice(0, -1));
      setDraft(message);
    } finally {
      setThinking(false);
      composer.current?.focus();
    }
  }, [thinking, status]);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter breaks the line — the convention every
    // messaging app uses, and this reads as one.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!offline) void send(draft);
    }
  }

  if (status.loading && !status.data) {
    return <><PageHeader title="Shwari" /><LoadingState /></>;
  }
  if (status.error) {
    return <><PageHeader title="Shwari" /><ErrorState message={status.error} onRetry={status.reload} /></>;
  }

  const s = status.data as ShwariStatus;

  // A missing model key disables the conversation, not the page. Everything
  // beside it — what needs attention, the team, the open questions — is read
  // straight from the database and stays useful either way.
  const offline = !s.available;

  return (
    <>
      <PageHeader
        title="Shwari"
        subtitle="Tell me about your business and I'll set it up."
        actions={isAdmin && !offline && (
          <Button size="sm" icon={<Link2 size={14} />} onClick={() => setPairing(true)}>
            Talk on Telegram
          </Button>
        )}
      />

      <div className="shwari-layout">
        <div className="shwari-thread">
          <div ref={scroller} className="shwari-scroll">
            {history.loading && !messages.length && <LoadingState rows={3} />}

            {!history.loading && !messages.length && (
              offline ? <Offline isAdmin={isAdmin} /> : <Greeting onPick={(text) => send(text)} />
            )}

            {messages.map((m, i) => (
              <Bubble key={`${m.at}-${i}`} message={m} />
            ))}

            {thinking && <Thinking />}
          </div>

          <div className="shwari-composer">
            <InlineError message={error} onDismiss={() => setError(null)} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <textarea
                ref={composer}
                className="input"
                rows={1}
                value={draft}
                disabled={offline}
                placeholder={
                  offline
                    ? 'Shwari needs a model key before it can answer.'
                    : 'Tell Shwari about your business…'
                }
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                style={{ resize: 'none', maxHeight: 140, flex: 1 }}
              />
              <Button
                variant="accent"
                icon={<Send size={14} />}
                loading={thinking}
                disabled={offline || !draft.trim()}
                onClick={() => send(draft)}
              >
                Send
              </Button>
            </div>
          </div>
        </div>

        <aside className="shwari-side">
          <AttentionPanel />
          <TeamPanel status={s} />
          <QuestionsPanel status={s} onAnswer={(q) => { setDraft(q); composer.current?.focus(); }} />
          {isAdmin && <LinkedPanel />}
        </aside>
      </div>

      {pairing && <PairingModal onClose={() => setPairing(false)} onLinked={() => toast.push('success', 'Send that code to your bot.')} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// The conversation
// ---------------------------------------------------------------------------

function Greeting({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div style={{ maxWidth: 560, margin: '32px auto', textAlign: 'center' }}>
      <div style={{
        width: 44, height: 44, borderRadius: '50%', margin: '0 auto 14px',
        background: 'var(--accent-soft)', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Sparkles size={20} style={{ color: 'var(--accent)' }} />
      </div>

      <h2 style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.02em' }}>
        Tell me about your business
      </h2>
      <p style={{ fontSize: 13.5, color: 'var(--text-2)', marginTop: 6, lineHeight: 1.6 }}>
        Say it however you'd say it to a new member of staff. I'll ask about
        anything I still need, and set everything up as we talk.
      </p>

      <div style={{ display: 'grid', gap: 8, marginTop: 22, textAlign: 'left' }}>
        {SUGGESTIONS.map((text) => (
          <button
            key={text}
            onClick={() => onPick(text)}
            style={{
              padding: '11px 13px', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', background: 'var(--surface)',
              fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.55,
              textAlign: 'left', cursor: 'pointer',
            }}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * What a turn actually did, said the way the owner would say it.
 *
 * Only tools that changed something reach here, and each is named as an
 * outcome rather than as a function. Anything unmapped is dropped instead of
 * being shown raw: a tool name leaking into the conversation would be exactly
 * the kind of internal this product does not show.
 */
const ACTION_LABELS: Record<string, string> = {
  update_business_profile: 'Updated your business details',
  save_service: 'Saved a service',
  remove_service: 'Stopped offering a service',
  save_product: 'Saved a product',
  set_opening_hours: 'Set your opening hours',
  save_business_fact: 'Saved that for future reference',
  record_knowledge_gap: 'Noted a question to come back to',
  add_agent: 'Added an agent to your team',
  configure_agent: 'Changed how an agent works',
  activate_agent: 'Switched an agent on or off',
  book_appointment: 'Booked an appointment',
  reschedule_appointment: 'Moved an appointment',
  cancel_appointment: 'Cancelled an appointment',
  record_order: 'Recorded an order',
  open_ticket: 'Opened a ticket',
  update_ticket: 'Updated a ticket',
  escalate_to_human: 'Handed a conversation to a person',
  schedule_follow_up: 'Queued a follow-up message',
  cancel_follow_up: 'Cancelled a queued message',
  update_customer: 'Updated a customer',
};

function ActionList({ actions }: { actions: string[] }) {
  const labels = [...new Set(actions.map((a) => ACTION_LABELS[a]).filter(Boolean))];
  if (!labels.length) return null;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
      {labels.map((label) => (
        <span
          key={label}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 11, padding: '3px 8px', borderRadius: 999,
            background: 'var(--success-bg)', color: 'var(--success)',
          }}
        >
          <Check size={10} /> {label}
        </span>
      ))}
    </div>
  );
}

/**
 * Shown in place of the greeting when no model key is configured, so the page
 * says what is missing rather than looking broken.
 */
function Offline({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div style={{ maxWidth: 460, margin: '40px auto' }}>
      <EmptyState
        icon={<Sparkles size={22} />}
        title="Shwari can't answer yet"
        body={
          isAdmin
            ? "This server has no model key, so the conversation is switched off. Everything else on this page still works. Integrations names exactly what's missing."
            : 'Ask an administrator to finish setting this up. Everything else on this page still works.'
        }
      />
    </div>
  );
}

function Bubble({ message }: { message: ShwariMessage }) {
  const mine = message.from === 'you';
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: mine ? 'flex-end' : 'flex-start', marginBottom: 12,
    }}>
      <div style={{
        maxWidth: '76%',
        padding: '10px 13px',
        borderRadius: 14,
        borderBottomRightRadius: mine ? 4 : 14,
        borderBottomLeftRadius: mine ? 14 : 4,
        background: mine ? 'var(--accent)' : 'var(--surface-2)',
        color: mine ? '#fff' : 'var(--text)',
        fontSize: 13.5,
        lineHeight: 1.6,
        // Shwari writes in paragraphs and short lists; honour the line breaks
        // rather than collapsing them into a wall.
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>
        {message.text}
      </div>

      {!mine && message.actions?.length ? <ActionList actions={message.actions} /> : null}
    </div>
  );
}

function Thinking() {
  return (
    <div style={{ display: 'flex', marginBottom: 12 }}>
      <div style={{
        padding: '11px 14px', borderRadius: 14, borderBottomLeftRadius: 4,
        background: 'var(--surface-2)', display: 'flex', gap: 4,
      }}>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="shwari-dot"
            style={{ animationDelay: `${i * 160}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Side panels
// ---------------------------------------------------------------------------

const ROLE_LABELS: Record<string, string> = {
  manager: 'Shwari',
  sales: 'Sales',
  support: 'Reception',
};

/**
 * What needs a person today.
 *
 * Computed from the database, not from the model, so it is populated on a
 * server with no AI configured at all. Each line is a link into the page that
 * owns the problem rather than a description of it.
 */
function AttentionPanel() {
  const state = useAsync(() => getAttention(), []);

  if (state.loading && !state.data) {
    return <Card><LoadingState rows={2} /></Card>;
  }
  // A failed read here is not worth an error card beside a working
  // conversation; the panels below still render.
  if (state.error || !state.data) return null;

  const a = state.data as AttentionReport;
  const items: Array<{ key: string; label: string; to: string; tone: 'warning' | 'info' }> = [];

  if (a.appointments_today.length) {
    items.push({
      key: 'appointments',
      label: `${a.appointments_today.length} appointment${a.appointments_today.length === 1 ? '' : 's'} today`,
      to: '/appointments', tone: 'info',
    });
  }
  if (a.unverified_payment_claims) {
    items.push({
      key: 'payments',
      label: `${a.unverified_payment_claims} payment${a.unverified_payment_claims === 1 ? '' : 's'} to check`,
      to: '/payments', tone: 'warning',
    });
  }
  if (a.waiting_on_a_person.length) {
    items.push({
      key: 'waiting',
      label: `${a.waiting_on_a_person.length} customer${a.waiting_on_a_person.length === 1 ? '' : 's'} waiting on a reply`,
      to: '/inbox', tone: 'warning',
    });
  }
  if (a.open_tickets.length) {
    items.push({
      key: 'tickets',
      label: `${a.open_tickets.length} open ticket${a.open_tickets.length === 1 ? '' : 's'}`,
      to: '/support', tone: 'info',
    });
  }
  if (a.silent_customers.length) {
    items.push({
      key: 'silent',
      label: `${a.silent_customers.length} customer${a.silent_customers.length === 1 ? '' : 's'} gone quiet`,
      to: '/leads', tone: 'warning',
    });
  }

  if (!items.length) return null;

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
        <AlertTriangle size={14} style={{ color: 'var(--warning)' }} />
        <div className="section-label">Needs you today</div>
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        {items.map((item) => (
          <Link
            key={item.key}
            to={item.to}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 8, padding: '9px 10px', borderRadius: 'var(--radius)',
              background: 'var(--surface-2)', fontSize: 12.5, color: 'inherit',
              textDecoration: 'none', lineHeight: 1.4,
            }}
          >
            <span style={{ minWidth: 0 }}>{item.label}</span>
            <span style={{ color: 'var(--text-3)', flexShrink: 0 }}>›</span>
          </Link>
        ))}
      </div>
    </Card>
  );
}

function TeamPanel({ status }: { status: ShwariStatus }) {
  // The manager is the agent the owner is talking to; listing it as a team
  // member it can hire or fire would be misleading.
  const team = status.team.filter((a) => a.role !== 'manager');

  return (
    <Card>
      <div className="section-label" style={{ marginBottom: 10 }}>Your AI team</div>

      {team.length === 0 ? (
        <p style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.55 }}>
          No agents yet. Ask Shwari what team you should start with.
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 7 }}>
          {team.map((a) => (
            <div key={a.role} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 8, padding: '8px 10px', borderRadius: 'var(--radius)',
              background: 'var(--surface-2)',
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 550 }}>{a.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                  {ROLE_LABELS[a.role] ?? a.role}
                </div>
              </div>
              <Pill tone={a.status === 'active' ? 'success' : a.status === 'draft' ? 'warning' : 'neutral'} dot>
                {a.status === 'active' ? 'Live' : a.status === 'draft' ? 'Draft' : 'Off'}
              </Pill>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function QuestionsPanel({ status, onAnswer }: {
  status: ShwariStatus;
  onAnswer: (draft: string) => void;
}) {
  if (!status.open_questions.length) return null;

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
        <HelpCircle size={14} style={{ color: 'var(--warning)' }} />
        <div className="section-label">Customers keep asking</div>
      </div>
      <p style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 10, lineHeight: 1.5 }}>
        Nobody has told the agents the answer to these, so they don't guess.
      </p>

      <div style={{ display: 'grid', gap: 6 }}>
        {status.open_questions.map((q) => (
          <button
            key={q.question}
            onClick={() => onAnswer(`About "${q.question}" — the answer is `)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 8, padding: '9px 10px', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', background: 'var(--surface)',
              fontSize: 12.5, textAlign: 'left', cursor: 'pointer', lineHeight: 1.45,
            }}
          >
            <span style={{ minWidth: 0 }}>{q.question}</span>
            {q.times_seen > 1 && (
              <span style={{ fontSize: 11, color: 'var(--text-3)', flexShrink: 0 }}>
                ×{q.times_seen}
              </span>
            )}
          </button>
        ))}
      </div>
    </Card>
  );
}

function LinkedPanel() {
  const linked = useAsync(() => getLinkedAdmins(), []);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  if (!linked.data?.linked.length) return null;

  async function remove(id: string) {
    setBusy(true);
    try {
      await unlinkAdmin(id);
      toast.push('success', 'Disconnected.');
      linked.reload();
    } catch {
      toast.push('error', "That couldn't be removed. Try again.");
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  }

  return (
    <>
      <Card>
        <div className="section-label" style={{ marginBottom: 10 }}>Also reachable on</div>
        <div style={{ display: 'grid', gap: 6 }}>
          {linked.data.linked.map((l) => (
            <div key={l.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 8, padding: '8px 10px', borderRadius: 'var(--radius)',
              background: 'var(--surface-2)',
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 550, textTransform: 'capitalize' }}>
                  {l.channel_type}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                  Connected {relativeTime(l.created_at)}
                </div>
              </div>
              <Button
                size="sm" variant="subtle" icon={<Trash2 size={12} />}
                onClick={() => setRemoving(l.id)}
                aria-label="Disconnect"
              />
            </div>
          ))}
        </div>
      </Card>

      <ConfirmDialog
        open={Boolean(removing)}
        title="Disconnect this account?"
        body="You'll no longer be able to manage your business from that chat. You can reconnect any time."
        confirmLabel="Disconnect"
        busy={busy}
        onConfirm={() => removing && remove(removing)}
        onCancel={() => setRemoving(null)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Pairing
// ---------------------------------------------------------------------------

/**
 * The code is shown once and is not readable again afterwards, so this modal
 * fetches it on open rather than on mount, and does not cache it.
 */
function PairingModal({ onClose, onLinked }: { onClose: () => void; onLinked: () => void }) {
  const [code, setCode] = useState<PairingCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    createPairingCode()
      .then((c) => { if (live) { setCode(c); onLinked(); } })
      .catch((e) => {
        if (live) setError(e instanceof ApiError ? e.message : "We couldn't create a code.");
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
    // Deliberately runs once: asking again would invalidate the code on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function copy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard refused; the code is selectable */ }
  }

  return (
    <Modal open onClose={onClose} title="Talk to Shwari on Telegram" width={440}>
      {loading && <LoadingState label="Creating your code…" rows={2} />}

      {error && (
        <p style={{ fontSize: 13, color: 'var(--danger)', lineHeight: 1.6 }}>{error}</p>
      )}

      {code && (
        <div style={{ display: 'grid', gap: 16 }}>
          <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>
            Send this code to your bot as an ordinary message. I'll recognise you
            from then on, and you can manage your business from your phone.
          </p>

          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '14px 16px', background: 'var(--surface-2)',
            borderRadius: 'var(--radius)',
          }}>
            <code style={{
              flex: 1, fontSize: 22, fontWeight: 600, letterSpacing: '0.14em',
              fontFamily: 'ui-monospace, monospace',
            }}>
              {code.code}
            </code>
            <Button
              size="sm"
              variant={copied ? 'success' : 'subtle'}
              icon={copied ? <Check size={13} /> : <Copy size={13} />}
              onClick={copy}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>

          <p style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.55 }}>
            It works once and expires in 15 minutes. Anyone who has it can manage
            your business, so don't share it.
          </p>
        </div>
      )}
    </Modal>
  );
}
