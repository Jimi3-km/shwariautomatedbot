import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Send, Bot, User } from 'lucide-react';
import { api, fmtDate, relativeTime } from '../lib/api';
import { PageHeader, Badge, Empty, ErrorNote, inputStyle } from './Shell';

/**
 * Channel-agnostic inbox. Nothing here branches on Telegram vs WhatsApp
 * except the small channel label; sending is dispatched server-side.
 */
export function Conversations({ canWrite }: { canWrite: boolean }) {
  const [list, setList] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadList = useCallback(async () => {
    try {
      const r = await api<{ conversations: any[] }>('/conversations');
      setList(r.conversations);
      setSelectedId((cur) => cur ?? r.conversations[0]?.id ?? null);
    } catch (e: any) { setError(e.message); }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const r = await api(`/conversations/${id}`);
      setDetail(r);
      if (canWrite) {
        await api(`/conversations/${id}/read`, { method: 'POST' });
        setList((cur) => cur.map((c) => (c.id === id ? { ...c, unread_count: 0 } : c)));
      }
    } catch (e: any) { setError(e.message); }
  }, [canWrite]);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { if (selectedId) loadDetail(selectedId); }, [selectedId, loadDetail]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [detail?.messages?.length]);

  async function toggleAi(enabled: boolean) {
    if (!selectedId) return;
    try {
      await api(`/conversations/${selectedId}/takeover`, { method: 'POST', body: { ai_enabled: enabled } });
      await loadDetail(selectedId);
    } catch (e: any) { setError(e.message); }
  }

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !draft.trim()) return;
    setSending(true); setError(null);
    try {
      await api(`/conversations/${selectedId}/reply`, { method: 'POST', body: { body: draft.trim() } });
      setDraft('');
      await loadDetail(selectedId);
      await loadList();
    } catch (e: any) { setError(e.message); }
    finally { setSending(false); }
  }

  async function setStage(stage: string) {
    if (!detail?.lead) return;
    try {
      await api(`/leads/${detail.lead.id}`, { method: 'PATCH', body: { stage } });
      await loadDetail(selectedId!);
    } catch (e: any) { setError(e.message); }
  }

  const convo = detail?.conversation;

  return (
    <div className="flex flex-col h-screen">
      <PageHeader title="Conversations" subtitle="Read, take over, and reply across every channel." />
      <ErrorNote error={error} />

      <div className="flex-1 flex min-h-0">
        {/* List */}
        <div className="w-72 shrink-0 border-r overflow-y-auto" style={{ borderColor: 'var(--border)' }}>
          {!list.length ? <Empty message="No conversations yet." /> : list.map((c) => (
            <button
              key={c.id} onClick={() => setSelectedId(c.id)}
              className="w-full text-left px-4 py-3 border-b"
              style={{
                borderColor: 'var(--border)',
                background: c.id === selectedId ? 'var(--surface-2)' : 'transparent',
              }}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate flex-1">{c.customer_name || c.customer_id}</span>
                {c.unread_count > 0 && (
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: '#60a5fa' }} />
                )}
                <span className="text-xs shrink-0" style={{ color: 'var(--text-3)' }}>
                  {relativeTime(c.last_message_at)}
                </span>
              </div>
              <div className="text-xs truncate mt-1" style={{ color: 'var(--text-3)' }}>
                {c.last_message_preview || '—'}
              </div>
              <div className="flex gap-1.5 mt-1.5">
                <Badge>{c.channel_type}</Badge>
                {c.lead_stage && <Badge tone="info">{c.lead_stage}</Badge>}
                {!c.ai_enabled && <Badge tone="warn">human</Badge>}
              </div>
            </button>
          ))}
        </div>

        {/* Thread */}
        <div className="flex-1 flex flex-col min-w-0">
          {!convo ? <Empty message="Select a conversation." /> : (
            <>
              <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{convo.customer_name || convo.customer_id}</div>
                  <div className="text-xs" style={{ color: 'var(--text-3)' }}>
                    {convo.channel_type} · {convo.customer_id}
                  </div>
                </div>
                {canWrite && (
                  <button
                    onClick={() => toggleAi(!convo.ai_enabled)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium"
                    style={convo.ai_enabled
                      ? { background: '#78350f', color: '#fcd34d' }
                      : { background: '#064e3b', color: '#6ee7b7' }}
                  >
                    {convo.ai_enabled ? 'Take over from AI' : 'Return to AI'}
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                {detail.messages.map((m: any) => (
                  <Message key={m.id} m={m} />
                ))}
                <div ref={bottomRef} />
              </div>

              {/* Customer / lead context */}
              {detail.lead && (
                <div className="px-5 py-2.5 border-t flex flex-wrap items-center gap-2 text-xs" style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}>
                  <span>Stage:</span>
                  <select
                    value={detail.lead.stage ?? 'new'} disabled={!canWrite}
                    onChange={(e) => setStage(e.target.value)}
                    className="px-2 py-1 rounded text-xs" style={inputStyle}
                  >
                    {['new','contacted','interested','quoted','payment_claimed','payment_verified','won','lost'].map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  {detail.lead.email && <span>· {detail.lead.email}</span>}
                  {detail.lead.delivery_location && <span>· {detail.lead.delivery_location}</span>}
                  {detail.payments?.length > 0 && (
                    <Badge tone={detail.payments[0].verification_status === 'verified' ? 'good' : 'warn'}>
                      payment {detail.payments[0].verification_status}
                    </Badge>
                  )}
                </div>
              )}

              {canWrite && (
                <form onSubmit={sendReply} className="p-3 border-t flex gap-2" style={{ borderColor: 'var(--border)' }}>
                  <input
                    value={draft} onChange={(e) => setDraft(e.target.value)}
                    placeholder={convo.ai_enabled ? 'Reply manually (the AI is still active)…' : 'Reply as staff…'}
                    className="flex-1 px-3 py-2 rounded-lg text-sm outline-none" style={inputStyle}
                  />
                  <button
                    type="submit" disabled={sending || !draft.trim()}
                    className="px-3 py-2 rounded-lg disabled:opacity-40"
                    style={{ background: 'var(--white)', color: 'var(--black)' }}
                  >
                    <Send size={16} />
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Message({ m }: { m: any }) {
  if (m.sender === 'system') {
    return (
      <div className="text-center text-xs py-1" style={{ color: 'var(--text-3)' }}>
        {m.body} · {fmtDate(m.created_at)}
      </div>
    );
  }
  const isCustomer = m.sender === 'customer';
  const tone = isCustomer
    ? { background: 'var(--surface-2)', color: 'var(--text)' }
    : m.sender === 'staff'
      ? { background: '#1e3a8a', color: '#dbeafe' }
      : { background: 'var(--white)', color: 'var(--black)' };

  return (
    <div className={`flex ${isCustomer ? 'justify-start' : 'justify-end'}`}>
      <div className="max-w-[75%]">
        <div className="flex items-center gap-1.5 mb-1 text-xs" style={{ color: 'var(--text-3)' }}>
          {m.sender === 'agent' ? <Bot size={11} /> : m.sender === 'staff' ? <User size={11} /> : null}
          <span>{m.sender}</span>
          <span>· {fmtDate(m.created_at)}</span>
        </div>
        <div className="px-3 py-2 rounded-xl text-sm whitespace-pre-wrap" style={tone}>{m.body}</div>
      </div>
    </div>
  );
}
