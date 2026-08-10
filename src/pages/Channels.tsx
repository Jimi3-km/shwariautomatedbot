import React, { useEffect, useState, useCallback } from 'react';
import { MessageCircle, Instagram, Globe, Check, X } from 'lucide-react';
import { api } from '../lib/api';
import { PageHeader, Badge, ErrorNote, inputStyle } from './Shell';

/**
 * Channel management. The bot token is sent once, over an authenticated
 * request, and is never returned to the browser afterwards -- the listing
 * comes from channels_safe, which exposes only booleans for the secrets.
 */
export function Channels({ isAdmin }: { isAdmin: boolean }) {
  const [channels, setChannels] = useState<any[]>([]);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setChannels((await api<{ channels: any[] }>('/channels')).channels); }
    catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function connectTelegram(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setNotice(null);
    try {
      const r = await api<any>('/channels/telegram', { method: 'POST', body: { bot_token: token.trim() } });
      setToken('');
      setNotice(`Connected @${r.bot.username}. Customers messaging that bot now reach your agent.`);
      await load();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function disconnect(id: string) {
    setError(null); setNotice(null);
    try { await api(`/channels/${id}`, { method: 'DELETE' }); await load(); }
    catch (e: any) { setError(e.message); }
  }

  const telegram = channels.filter((c) => c.channel_type === 'telegram');

  return (
    <>
      <PageHeader title="Channels" subtitle="Connect the places your customers message you." />
      <ErrorNote error={error} />
      {notice && <div className="mx-6 my-3 px-3 py-2 rounded-lg text-sm" style={{ background: '#064e3b', color: '#6ee7b7' }}>{notice}</div>}

      <div className="p-6 space-y-4 max-w-2xl">
        {/* Telegram */}
        <div className="rounded-xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2 mb-1">
            <MessageCircle size={18} />
            <h2 className="text-sm font-medium">Telegram</h2>
            <Badge tone={telegram.some((c) => c.status === 'active') ? 'good' : 'neutral'}>
              {telegram.some((c) => c.status === 'active') ? 'connected' : 'not connected'}
            </Badge>
          </div>

          {telegram.length > 0 && (
            <div className="my-3 space-y-2">
              {telegram.map((c) => (
                <div key={c.id} className="flex items-center gap-2 text-sm py-2 border-t" style={{ borderColor: 'var(--border)' }}>
                  <span className="flex-1">{c.display_name || c.channel_account_id}</span>
                  {c.has_bot_token ? <Check size={14} color="#6ee7b7" /> : <X size={14} color="#666" />}
                  <Badge tone={c.status === 'active' ? 'good' : 'neutral'}>{c.status}</Badge>
                  {isAdmin && c.status === 'active' && (
                    <button onClick={() => disconnect(c.id)} className="text-xs" style={{ color: '#fca5a5' }}>Disconnect</button>
                  )}
                </div>
              ))}
            </div>
          )}

          {isAdmin ? (
            <form onSubmit={connectTelegram} className="mt-3 space-y-2">
              <p className="text-xs" style={{ color: 'var(--text-2)' }}>
                Create a bot with <span style={{ color: 'var(--text)' }}>@BotFather</span> on Telegram, then paste the token
                it gives you. We verify it, register the webhook for you, and store it encrypted at rest. The token is never
                shown again after saving.
              </p>
              <div className="flex gap-2">
                <input
                  type="password" value={token} onChange={(e) => setToken(e.target.value)}
                  placeholder="123456789:AA…" autoComplete="off"
                  className="flex-1 px-3 py-2 rounded-lg text-sm outline-none font-mono" style={inputStyle}
                />
                <button type="submit" disabled={busy || !token.trim()}
                  className="px-3 py-2 rounded-lg text-sm disabled:opacity-40"
                  style={{ background: 'var(--white)', color: 'var(--black)' }}>
                  {busy ? 'Connecting…' : 'Connect'}
                </button>
              </div>
            </form>
          ) : (
            <p className="text-xs mt-2" style={{ color: 'var(--text-3)' }}>Only owners and admins can connect channels.</p>
          )}
        </div>

        {/* WhatsApp -- structure present, integration pending. Not faked. */}
        <PendingChannel
          icon={<MessageCircle size={18} />}
          name="WhatsApp"
          body="Uses the Meta WhatsApp Business Cloud API. The database, tenant routing and inbox already treat WhatsApp as a first-class channel — what is still needed is a Meta app with a phone number ID, a WhatsApp Business Account ID, a permanent access token and a webhook verify token."
        />
        <PendingChannel icon={<Instagram size={18} />} name="Instagram" body="Planned. The channel model already supports it." />
        <PendingChannel icon={<Globe size={18} />} name="Web chat" body="Planned. The channel model already supports it." />
      </div>
    </>
  );
}

function PendingChannel({ icon, name, body }: { icon: React.ReactNode; name: string; body: string }) {
  return (
    <div className="rounded-xl p-4 opacity-70" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <h2 className="text-sm font-medium">{name}</h2>
        <Badge tone="warn">integration pending</Badge>
      </div>
      <p className="text-xs" style={{ color: 'var(--text-2)' }}>{body}</p>
    </div>
  );
}
