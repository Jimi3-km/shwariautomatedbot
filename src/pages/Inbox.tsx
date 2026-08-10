import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Bot, User, Send, ArrowLeft, Search, MessageSquare, Sparkles, Hand, CircleDot,
} from 'lucide-react';
import {
  getConversations, getConversation, markConversationRead,
  setConversationTakeover, sendMessage, updateLead, ApiError,
  type ConversationFilters,
} from '../lib/api';
import type { Conversation, ConversationDetail, LeadStage } from '../types';
import { useAsync, useDebounced, useIsMobile, useVisiblePolling } from '../hooks';
import { useSession } from '../app/SessionContext';
import {
  Avatar, Button, EmptyState, ErrorState, FilterChip, InlineError, LoadingState,
  Pill, Select, useToast, Pagination,
} from '../components/ui';
import { formatDateTime, formatMoney, humanize, relativeTime } from '../lib/format';

const PAGE_SIZE = 30;

const STAGES: LeadStage[] = [
  'new', 'contacted', 'interested', 'quoted',
  'payment_claimed', 'payment_verified', 'won', 'lost',
];

/**
 * Unified inbox across every channel. A business owner never sees separate
 * Telegram and WhatsApp dashboards: channel is a property of a conversation,
 * not a separate product surface.
 */
export function Inbox() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [params, setParams] = useSearchParams();

  const [search, setSearch] = useState(params.get('search') ?? '');
  const [channel, setChannel] = useState('');
  const [handledBy, setHandledBy] = useState<'' | 'ai' | 'human'>('');
  const [unreadOnly, setUnreadOnly] = useState(params.get('unread') === 'true');
  const [status, setStatus] = useState<'' | 'open' | 'closed'>('');
  const [offset, setOffset] = useState(0);

  const debouncedSearch = useDebounced(search, 300);

  // Keep the URL honest so searches and filters are shareable and survive reload.
  useEffect(() => {
    const next = new URLSearchParams();
    if (debouncedSearch) next.set('search', debouncedSearch);
    if (unreadOnly) next.set('unread', 'true');
    setParams(next, { replace: true });
  }, [debouncedSearch, unreadOnly, setParams]);

  useEffect(() => { setOffset(0); }, [debouncedSearch, channel, handledBy, unreadOnly, status]);

  const filters: ConversationFilters = {
    search: debouncedSearch || undefined,
    channel_type: (channel || undefined) as ConversationFilters['channel_type'],
    handled_by: (handledBy || undefined) as ConversationFilters['handled_by'],
    status: (status || undefined) as ConversationFilters['status'],
    unread: unreadOnly || undefined,
    limit: PAGE_SIZE,
    offset,
  };

  const list = useAsync(
    (signal) => getConversations(filters, signal),
    [debouncedSearch, channel, handledBy, unreadOnly, status, offset]
  );

  // Refresh the list periodically so new customer messages appear without a
  // manual reload. Paused while the tab is hidden.
  useVisiblePolling(list.reload, 25_000);

  const conversations = list.data?.conversations ?? [];
  const showDetail = Boolean(conversationId);

  // On desktop, open the first conversation so the pane is never blank.
  useEffect(() => {
    if (!isMobile && !conversationId && conversations.length > 0) {
      navigate(`/inbox/${conversations[0].id}`, { replace: true });
    }
  }, [isMobile, conversationId, conversations, navigate]);

  const listPane = (
    <ConversationList
      state={list}
      conversations={conversations}
      activeId={conversationId ?? null}
      onSelect={(id) => navigate(`/inbox/${id}`)}
      search={search} setSearch={setSearch}
      channel={channel} setChannel={setChannel}
      handledBy={handledBy} setHandledBy={setHandledBy}
      unreadOnly={unreadOnly} setUnreadOnly={setUnreadOnly}
      status={status} setStatus={setStatus}
      offset={offset} setOffset={setOffset}
      total={list.data?.total ?? 0}
    />
  );

  // Mobile is a list-to-detail flow rather than three panes side by side.
  if (isMobile) {
    return showDetail
      ? <ConversationPane
          conversationId={conversationId!}
          onBack={() => navigate('/inbox')}
          onChanged={list.reload}
          showBack
        />
      : <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{listPane}</div>;
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <div style={{
        width: 320, flexShrink: 0, borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', minHeight: 0,
      }}>
        {listPane}
      </div>
      {conversationId ? (
        <ConversationPane conversationId={conversationId} onChanged={list.reload} />
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <EmptyState icon={<MessageSquare size={26} />} title="Select a conversation"
            body="Choose a conversation from the list to read it and reply." />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conversation list
// ---------------------------------------------------------------------------
function ConversationList(props: {
  state: ReturnType<typeof useAsync<{ conversations: Conversation[]; total: number; limit: number; offset: number }>>;
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  search: string; setSearch: (v: string) => void;
  channel: string; setChannel: (v: string) => void;
  handledBy: '' | 'ai' | 'human'; setHandledBy: (v: '' | 'ai' | 'human') => void;
  unreadOnly: boolean; setUnreadOnly: (v: boolean) => void;
  status: '' | 'open' | 'closed'; setStatus: (v: '' | 'open' | 'closed') => void;
  offset: number; setOffset: (v: number) => void;
  total: number;
}) {
  const { state, conversations, activeId, onSelect } = props;

  return (
    <>
      <div style={{ padding: 12, borderBottom: '1px solid var(--border)' }}>
        <div style={{ position: 'relative', marginBottom: 9 }}>
          <Search size={14} style={{
            position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)',
          }} />
          <input
            className="field" style={{ paddingLeft: 30, height: 32 }}
            placeholder="Search conversations"
            value={props.search} onChange={(e) => props.setSearch(e.target.value)}
            aria-label="Search conversations"
          />
        </div>

        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          <FilterChip active={props.unreadOnly} onClick={() => props.setUnreadOnly(!props.unreadOnly)}>
            Unread
          </FilterChip>
          <FilterChip active={props.handledBy === 'ai'}
            onClick={() => props.setHandledBy(props.handledBy === 'ai' ? '' : 'ai')}>
            AI
          </FilterChip>
          <FilterChip active={props.handledBy === 'human'}
            onClick={() => props.setHandledBy(props.handledBy === 'human' ? '' : 'human')}>
            Human
          </FilterChip>
          <FilterChip active={props.status === 'open'}
            onClick={() => props.setStatus(props.status === 'open' ? '' : 'open')}>
            Open
          </FilterChip>
        </div>

        <div style={{ marginTop: 8 }}>
          <Select
            aria-label="Filter by channel"
            value={props.channel} onChange={(e) => props.setChannel(e.target.value)}
            placeholder="All channels"
            options={[
              { value: 'telegram', label: 'Telegram' },
              { value: 'whatsapp', label: 'WhatsApp' },
              { value: 'instagram', label: 'Instagram' },
              { value: 'webchat', label: 'Web chat' },
            ]}
            style={{ height: 30, fontSize: 12.5 }}
          />
        </div>
      </div>

      <div className="scroll-y" style={{ flex: 1, minHeight: 0 }}>
        {state.loading && !state.data ? (
          <div style={{ padding: 12 }}><LoadingState rows={6} /></div>
        ) : state.error ? (
          <ErrorState message={state.error} onRetry={state.reload} />
        ) : conversations.length === 0 ? (
          <EmptyState
            icon={<MessageSquare size={24} />}
            title={props.search || props.unreadOnly || props.channel ? 'No matching conversations' : 'No conversations yet'}
            body={
              props.search || props.unreadOnly || props.channel
                ? 'Try clearing the filters.'
                : 'Connect a channel so customers can start messaging you.'
            }
          />
        ) : (
          conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              style={{
                width: '100%', textAlign: 'left', padding: '11px 12px',
                borderBottom: '1px solid var(--border)',
                background: c.id === activeId ? 'var(--surface-2)' : 'transparent',
                display: 'flex', gap: 10,
              }}
            >
              <Avatar name={c.customer_name ?? c.customer_id} seed={c.customer_id} size={32} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: c.unread_count > 0 ? 600 : 500,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {c.customer_name || c.customer_id}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-3)', flexShrink: 0 }}>
                    {relativeTime(c.last_message_at)}
                  </span>
                </div>
                <div style={{
                  fontSize: 12, color: c.unread_count > 0 ? 'var(--text)' : 'var(--text-3)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2,
                }}>
                  {c.last_message_preview || 'No messages yet'}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5 }}>
                  <Pill tone="neutral">{c.channel_type}</Pill>
                  {c.lead_stage && <Pill tone="info">{humanize(c.lead_stage)}</Pill>}
                  {!c.ai_enabled && <Pill tone="warning">Human</Pill>}
                  <span style={{ flex: 1 }} />
                  {c.unread_count > 0 && (
                    <span style={{
                      minWidth: 17, height: 17, padding: '0 5px', borderRadius: 9,
                      background: 'var(--accent)', color: '#fff', fontSize: 10.5, fontWeight: 600,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {c.unread_count}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      <div style={{ padding: '0 10px', borderTop: '1px solid var(--border)' }}>
        <Pagination offset={props.offset} limit={PAGE_SIZE} total={props.total} onChange={props.setOffset} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Conversation thread + customer context
// ---------------------------------------------------------------------------
function ConversationPane({
  conversationId, onBack, onChanged, showBack,
}: { conversationId: string; onBack?: () => void; onChanged: () => void; showBack?: boolean }) {
  const detail = useAsync<ConversationDetail>(() => getConversation(conversationId), [conversationId]);
  const { canWrite, refreshCounts, currency } = useSession();
  const toast = useToast();
  const isMobile = useIsMobile();

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const convo = detail.data?.conversation;
  const messages = detail.data?.messages ?? [];

  // Mark read once the thread is actually open.
  useEffect(() => {
    if (!convo || !canWrite || convo.unread_count === 0) return;
    markConversationRead(conversationId)
      .then(() => { onChanged(); refreshCounts(); })
      .catch(() => { /* non-critical */ });
  }, [convo?.id, convo?.unread_count, canWrite, conversationId, onChanged, refreshCounts]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Poll the open thread so incoming replies appear live.
  useVisiblePolling(detail.reload, 15_000, Boolean(convo));

  const toggleAi = useCallback(async (enable: boolean) => {
    setActionError(null);
    try {
      await setConversationTakeover(conversationId, enable);
      toast.push('success', enable ? 'The AI agent is handling this again.' : 'You have taken over this conversation.');
      detail.reload();
      onChanged();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not change who is handling this.');
    }
  }, [conversationId, detail, onChanged, toast]);

  async function submitReply(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    setActionError(null);
    try {
      await sendMessage(conversationId, text);
      setDraft('');
      detail.reload();
      onChanged();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Your message could not be sent.');
    } finally {
      setSending(false);
    }
  }

  if (detail.loading && !detail.data) {
    return <div style={{ flex: 1 }}><LoadingState label="Loading conversation…" /></div>;
  }
  if (detail.error || !convo) {
    return <div style={{ flex: 1 }}><ErrorState message={detail.error ?? 'Conversation not found'} onRetry={detail.reload} /></div>;
  }

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex' }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Header with the AI/human state as a first-class control */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
          borderBottom: '1px solid var(--border)', flexShrink: 0,
        }}>
          {showBack && (
            <button onClick={onBack} aria-label="Back to conversations" style={{ color: 'var(--text-2)' }}>
              <ArrowLeft size={18} />
            </button>
          )}
          <Avatar name={convo.customer_name ?? convo.customer_id} seed={convo.customer_id} size={32} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {convo.customer_name || convo.customer_id}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
              {convo.channel_type} · {convo.customer_id}
            </div>
          </div>

          <Pill tone={convo.ai_enabled ? 'accent' : 'warning'} dot>
            {convo.ai_enabled ? 'AI handling' : 'Human handling'}
          </Pill>

          {canWrite && (
            <Button
              size="sm"
              variant={convo.ai_enabled ? 'outline' : 'success'}
              icon={convo.ai_enabled ? <Hand size={13} /> : <Sparkles size={13} />}
              onClick={() => toggleAi(!convo.ai_enabled)}
            >
              {convo.ai_enabled ? 'Take over' : 'Return to AI'}
            </Button>
          )}
        </div>

        <InlineError message={actionError} onDismiss={() => setActionError(null)} />

        <div className="scroll-y" style={{ flex: 1, minHeight: 0, padding: '14px 16px' }}>
          {messages.length === 0 ? (
            <EmptyState icon={<MessageSquare size={22} />} title="No messages yet"
              body="Messages will appear here as soon as the customer writes in." />
          ) : (
            messages.map((m) => <MessageBubble key={m.id} message={m} />)
          )}
          <div ref={bottomRef} />
        </div>

        {canWrite ? (
          <form onSubmit={submitReply} style={{
            display: 'flex', gap: 8, padding: 12, borderTop: '1px solid var(--border)', flexShrink: 0,
          }}>
            <input
              className="field" value={draft} onChange={(e) => setDraft(e.target.value)}
              placeholder={convo.ai_enabled ? 'Send a manual reply (the AI is still active)…' : 'Reply as staff…'}
              aria-label="Message"
            />
            <Button type="submit" variant="solid" loading={sending} disabled={!draft.trim()} icon={<Send size={14} />}>
              Send
            </Button>
          </form>
        ) : (
          <div style={{ padding: 12, borderTop: '1px solid var(--border)', fontSize: 12.5, color: 'var(--text-3)' }}>
            Your role is view-only, so you cannot reply.
          </div>
        )}
      </div>

      {!isMobile && (
        <CustomerPanel detail={detail.data!} currency={currency} onUpdated={() => { detail.reload(); onChanged(); }} />
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: ConversationDetail['messages'][number] }) {
  if (message.sender === 'system') {
    return (
      <div style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--text-3)', padding: '8px 0' }}>
        {message.body} · {formatDateTime(message.created_at)}
      </div>
    );
  }

  const fromCustomer = message.sender === 'customer';
  const style: React.CSSProperties = fromCustomer
    ? { background: 'var(--surface-2)', color: 'var(--text)' }
    : message.sender === 'staff'
      ? { background: 'var(--accent)', color: '#fff' }
      : { background: 'var(--white)', color: 'var(--black)' };

  return (
    <div style={{ display: 'flex', justifyContent: fromCustomer ? 'flex-start' : 'flex-end', marginBottom: 10 }}>
      <div style={{ maxWidth: '74%' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3,
          fontSize: 11, color: 'var(--text-3)',
          justifyContent: fromCustomer ? 'flex-start' : 'flex-end',
        }}>
          {message.sender === 'agent' && <Bot size={11} />}
          {message.sender === 'staff' && <User size={11} />}
          <span style={{ textTransform: 'capitalize' }}>{message.sender}</span>
          <span>· {formatDateTime(message.created_at)}</span>
        </div>
        <div style={{
          ...style, padding: '8px 11px', borderRadius: 12,
          fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {message.body}
        </div>
      </div>
    </div>
  );
}

/** Right-hand context: who the customer is, their lead, and any payments. */
function CustomerPanel({
  detail, currency, onUpdated,
}: { detail: ConversationDetail; currency: string | null; onUpdated: () => void }) {
  const { canWrite } = useSession();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const { lead, payments, conversation } = detail;

  async function changeStage(stage: string) {
    if (!lead) return;
    setSaving(true);
    try {
      await updateLead(lead.id, { stage: stage as LeadStage });
      onUpdated();
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside className="scroll-y hide-lg" style={{
      width: 268, flexShrink: 0, borderLeft: '1px solid var(--border)', padding: 14,
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', paddingBottom: 14 }}>
        <Avatar name={conversation.customer_name ?? conversation.customer_id} seed={conversation.customer_id} size={52} />
        <div style={{ fontSize: 14, fontWeight: 600, marginTop: 8 }}>
          {conversation.customer_name || 'Unknown customer'}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{conversation.channel_type}</div>
      </div>

      {!lead ? (
        <p style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.55 }}>
          No lead record yet. One is created automatically once the customer shares
          what they are looking for.
        </p>
      ) : (
        <>
          <Section title="Lead">
            <Select
              aria-label="Lead stage"
              value={lead.stage ?? 'new'}
              disabled={!canWrite || saving}
              onChange={(e) => changeStage(e.target.value)}
              options={STAGES.map((s) => ({ value: s, label: humanize(s) }))}
              style={{ height: 30, fontSize: 12.5 }}
            />
          </Section>

          <Section title="Details">
            <Row label="Email" value={lead.email} />
            <Row label="Phone" value={lead.phone} />
            <Row label="Location" value={lead.delivery_location} />
          </Section>

          {(lead.product_model || lead.product_price) && (
            <Section title="Interested in">
              <Row
                label="Product"
                value={[lead.product_model, lead.product_storage, lead.product_condition].filter(Boolean).join(' ') || null}
              />
              <Row label="Price" value={lead.product_price != null ? formatMoney(lead.product_price, currency) : null} />
            </Section>
          )}

          {payments.length > 0 && (
            <Section title="Payments">
              {payments.map((p) => (
                <div key={p.id} style={{ marginBottom: 7 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Pill tone={
                      p.verification_status === 'verified' ? 'success'
                        : p.verification_status === 'rejected' ? 'danger' : 'warning'
                    }>
                      {humanize(p.verification_status)}
                    </Pill>
                    <span style={{ fontSize: 12.5 }}>{formatMoney(p.amount, p.currency ?? currency)}</span>
                  </div>
                  {p.transaction_code && (
                    <div className="mono" style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                      {p.transaction_code}
                    </div>
                  )}
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={() => navigate('/payments')} style={{ marginTop: 4 }}>
                Review payments
              </Button>
            </Section>
          )}

          <Button size="sm" variant="subtle" style={{ width: '100%', marginTop: 10 }}
            onClick={() => navigate(`/leads/${lead.id}`)}>
            Open full lead
          </Button>
        </>
      )}
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ paddingTop: 12, marginTop: 12, borderTop: '1px solid var(--border)' }}>
      <div className="section-label" style={{ marginBottom: 7 }}>{title}</div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5, padding: '3px 0' }}>
      <span style={{ color: 'var(--text-3)' }}>{label}</span>
      <span style={{ textAlign: 'right', wordBreak: 'break-word' }}>{value || '—'}</span>
    </div>
  );
}
