import React, { useEffect, useState } from 'react';
import {
  Send, MessageCircle, Instagram, Globe, CheckCircle2, ExternalLink, Plug,
} from 'lucide-react';
import {
  getChannels, connectTelegram, disconnectChannel, getChannelStatus,
  getChannelProviders, startChannelConnect,
} from '../lib/api';
import { EmbedSnippetBlock } from '../components/EmbedSnippetBlock';
import { ConnectChannelDialog } from '../components/ConnectChannelDialog';
import { SetupReadinessPanel } from '../components/SetupReadinessPanel';
import type { Channel, ChannelProviderInfo, EmbedSnippet, ProviderId } from '../types';
import { useAsync, useMutation } from '../hooks';
import { useSession } from '../app/SessionContext';
import {
  Button, Card, ConfirmDialog, ErrorState, Field, Input, InlineError,
  LoadingState, Modal, PageHeader, Pill, useToast,
} from '../components/ui';
import { formatDateTime } from '../lib/format';

/**
 * Channel management. Credentials are posted once over an authenticated
 * request and are never returned to the browser again — the listing comes
 * from a view that reduces every secret to a boolean.
 */
export function Integrations() {
  const { isAdmin } = useSession();
  const state = useAsync(() => getChannels(), []);
  const providers = useAsync(() => getChannelProviders(), []);
  const [telegramOpen, setTelegramOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState<Channel | null>(null);
  const [embed, setEmbed] = useState<EmbedSnippet | null>(null);
  const [confirming, setConfirming] = useState<ProviderId | null>(null);

  const toast = useToast();

  // Meta sends the browser back here after an authorization attempt.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('status');
    if (!status) return;
    window.history.replaceState({}, '', window.location.pathname);

    if (status === 'connected') { toast.push('success', 'Connected.'); state.reload(); }
    else if (status === 'cancelled') toast.push('info', 'That connection was cancelled.');
    else if (status === 'expired') toast.push('error', 'That took too long, so we stopped for safety. Please try again.');
    else toast.push('error', "We couldn't finish connecting. Please try again.");
    // Runs once on mount; the query string is cleared immediately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Web chat connects in place: there is nothing to authorize, so the response
   * already contains the channel and the snippet to paste.
   */
  const connectWebchat = useMutation(async () => {
    const result = await startChannelConnect('webchat');
    if (result.mode === 'instant') {
      if (result.embed) setEmbed(result.embed);
      toast.push('success', 'Web chat is on. Copy the snippet into your website.');
      state.reload();
    }
  });

  /** OAuth providers hand back a URL for the browser to follow. */
  const beginOAuth = useMutation(async (provider: ProviderId) => {
    const result = await startChannelConnect(provider);
    if (result.mode === 'oauth') window.location.href = result.authorize_url;
  });

  const providerInfo = (id: ProviderId): ChannelProviderInfo | undefined =>
    providers.data?.providers.find((p) => p.id === id);

  const disconnect = useMutation(async (id: string) => {
    await disconnectChannel(id);
    toast.push('success', 'Channel disconnected.');
    setDisconnecting(null);
    state.reload();
  });

  const channels = state.data?.channels ?? [];
  const telegram = channels.filter((c) => c.channel_type === 'telegram' && c.status === 'active');
  const whatsapp = channels.filter((c) => c.channel_type === 'whatsapp' && c.status === 'active');
  const instagram = channels.filter((c) => c.channel_type === 'instagram' && c.status === 'active');
  const webchat = channels.filter((c) => c.channel_type === 'webchat' && c.status === 'active');

  /**
   * An already-connected widget still needs its snippet on screen. The site key
   * is part of the ordinary channel listing because it is public, so the
   * snippet is rebuilt from it rather than requiring a reconnect.
   */
  const scriptUrl = `${window.location.origin}/api/webchat/widget.js`;
  const liveEmbed: EmbedSnippet | null = embed ?? (webchat[0]
    ? {
        site_key: webchat[0].channel_account_id,
        script_url: scriptUrl,
        html: `<script src="${scriptUrl}" data-site-key="${webchat[0].channel_account_id}" async></script>`,
      }
    : null);

  if (state.loading && !state.data) {
    return <><PageHeader title="Integrations" /><LoadingState /></>;
  }
  if (state.error) {
    return <><PageHeader title="Integrations" /><ErrorState message={state.error} onRetry={state.reload} /></>;
  }

  return (
    <>
      <PageHeader
        title="Integrations"
        subtitle="Connect the places your customers already message you."
      />

      <InlineError message={disconnect.error ?? beginOAuth.error ?? connectWebchat.error} />

      <div className="scroll-y" style={{ flex: 1, padding: 20 }}>
        <div style={{ display: 'grid', gap: 14, maxWidth: 760, margin: '0 auto' }}>

          {/* Renders nothing once the server is fully configured. */}
          {isAdmin && <SetupReadinessPanel />}

          <div className="section-label">Messaging</div>

          <IntegrationCard
            icon={<Send size={18} />}
            name="Telegram"
            description="Let customers talk to your AI agent through a Telegram bot you own."
            connected={telegram.length > 0}
            channels={telegram}
            isAdmin={isAdmin}
            onConnect={() => setTelegramOpen(true)}
            onDisconnect={setDisconnecting}
          />

          {whatsapp.length > 0 || providerInfo('whatsapp')?.available ? (
            <IntegrationCard
              icon={<MessageCircle size={18} />}
              name="WhatsApp Business"
              description="Approve access with Meta and we'll set up your WhatsApp number for you."
              connected={whatsapp.length > 0}
              channels={whatsapp}
              isAdmin={isAdmin}
              onConnect={() => setConfirming('whatsapp')}
              onDisconnect={setDisconnecting}
            />
          ) : (
            <ComingSoon icon={<MessageCircle size={18} />} name="WhatsApp Business"
              description="Reach customers on WhatsApp from the same inbox." />
          )}

          {instagram.length > 0 || providerInfo('instagram')?.available ? (
            <IntegrationCard
              icon={<Instagram size={18} />}
              name="Instagram"
              description="Approve access with Instagram and we'll start handling your DMs."
              connected={instagram.length > 0}
              channels={instagram}
              isAdmin={isAdmin}
              onConnect={() => setConfirming('instagram')}
              onDisconnect={setDisconnecting}
            />
          ) : (
            <ComingSoon icon={<Instagram size={18} />} name="Instagram"
              description="Handle Instagram direct messages from the same inbox." />
          )}

          <IntegrationCard
            icon={<Globe size={18} />}
            name="Web chat"
            description="Add a chat bubble to your own website. Nothing to sign up for."
            connected={webchat.length > 0}
            channels={webchat}
            isAdmin={isAdmin}
            onConnect={() => connectWebchat.run()}
            onDisconnect={setDisconnecting}
          />

          {/* The snippet is the whole of the setup, so it sits with the card. */}
          {liveEmbed && <EmbedSnippetBlock embed={liveEmbed} />}
        </div>
      </div>

      <ConnectChannelDialog
        provider={confirming}
        open={Boolean(confirming)}
        busy={beginOAuth.busy}
        onClose={() => setConfirming(null)}
        onConfirm={() => confirming && beginOAuth.run(confirming)}
      />

      <TelegramModal
        open={telegramOpen}
        onClose={() => setTelegramOpen(false)}
        onConnected={() => { setTelegramOpen(false); state.reload(); }}
      />

      <ConfirmDialog
        open={Boolean(disconnecting)}
        title="Disconnect this channel?"
        body="Customers will no longer reach your AI agent through it, and the stored credentials are deleted. Your conversation history is kept."
        confirmLabel="Disconnect"
        busy={disconnect.busy}
        onCancel={() => setDisconnecting(null)}
        onConfirm={() => disconnecting && disconnect.run(disconnecting.id)}
      />
    </>
  );
}

function IntegrationCard({
  icon, name, description, connected, channels, isAdmin, pending, onConnect, onDisconnect,
}: {
  icon: React.ReactNode; name: string; description: string; connected: boolean;
  channels: Channel[]; isAdmin: boolean; pending?: boolean;
  onConnect: () => void; onDisconnect: (c: Channel) => void;
}) {
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 'var(--radius)', background: 'var(--surface-2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          {icon}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 14.5, fontWeight: 600 }}>{name}</h2>
            <Pill tone={connected ? 'success' : pending ? 'warning' : 'neutral'} dot>
              {connected ? 'Connected' : pending ? 'Setup required' : 'Not connected'}
            </Pill>
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 3, lineHeight: 1.5 }}>{description}</p>

          {channels.length > 0 && (
            <div style={{ marginTop: 11 }}>
              {channels.map((c) => (
                <ConnectedChannelRow key={c.id} channel={c} isAdmin={isAdmin} onDisconnect={onDisconnect} />
              ))}
            </div>
          )}
        </div>

        {isAdmin ? (
          !connected && <Button size="sm" variant="solid" onClick={onConnect}>Connect</Button>
        ) : (
          <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>Admins only</span>
        )}
      </div>
    </Card>
  );
}

function ConnectedChannelRow({
  channel, isAdmin, onDisconnect,
}: { channel: Channel; isAdmin: boolean; onDisconnect: (c: Channel) => void }) {
  const [health, setHealth] = useState<string | null>(null);
  const check = useMutation(async () => {
    const r = await getChannelStatus(channel.id);
    setHealth(
      !r.webhook.configured ? 'No webhook is registered with the provider.'
        : !r.webhook.matches_expected ? 'The webhook points somewhere unexpected.'
        : r.webhook.last_error_message ? `Last delivery error: ${r.webhook.last_error_message}`
        : 'Receiving messages normally.'
    );
  });

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px',
      background: 'var(--surface-2)', borderRadius: 'var(--radius)', marginBottom: 6,
    }}>
      <CheckCircle2 size={14} style={{ color: 'var(--success)', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13 }}>{channel.display_name || channel.channel_account_id}</div>
        <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
          Connected {formatDateTime(channel.created_at)}
        </div>
        {health && <div style={{ fontSize: 11.5, color: 'var(--text-2)', marginTop: 3 }}>{health}</div>}
        {check.error && <div style={{ fontSize: 11.5, color: 'var(--danger)', marginTop: 3 }}>{check.error}</div>}
      </div>
      {isAdmin && (
        <>
          <Button size="sm" variant="subtle" loading={check.busy} onClick={() => check.run()}>Check</Button>
          <Button size="sm" variant="danger" onClick={() => onDisconnect(channel)}>Disconnect</Button>
        </>
      )}
    </div>
  );
}

function ComingSoon({ icon, name, description }: { icon: React.ReactNode; name: string; description: string }) {
  return (
    <Card className="opacity-60">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 'var(--radius)', background: 'var(--surface-2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          {icon}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 style={{ fontSize: 14.5, fontWeight: 600 }}>{name}</h2>
            <Pill tone="neutral">Coming soon</Pill>
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 3 }}>{description}</p>
        </div>
      </div>
    </Card>
  );
}

function TelegramModal({
  open, onClose, onConnected,
}: { open: boolean; onClose: () => void; onConnected: () => void }) {
  const [token, setToken] = useState('');
  const toast = useToast();

  // The token lives in component state only for as long as this dialog is
  // open. It is never written to localStorage, and never comes back from the
  // API once saved.
  const connect = useMutation(async (value: string) => {
    const r = await connectTelegram(value);
    setToken('');
    toast.push('success', `Connected @${r.bot.username}. Customers messaging that bot now reach your agent.`);
    onConnected();
  });

  function close() { setToken(''); connect.clearError(); onClose(); }

  return (
    <Modal
      open={open} onClose={close} title="Connect Telegram" width={480}
      footer={
        <>
          <Button variant="subtle" onClick={close}>Cancel</Button>
          <Button variant="solid" loading={connect.busy} disabled={!token.trim()}
            onClick={() => connect.run(token.trim())}>
            Connect bot
          </Button>
        </>
      }
    >
      <InlineError message={connect.error} onDismiss={connect.clearError} />

      <ol style={{ display: 'grid', gap: 9, fontSize: 13, color: 'var(--text-2)', marginBottom: 16, paddingLeft: 16 }}>
        <li>Open Telegram and message <strong style={{ color: 'var(--text)' }}>@BotFather</strong>.</li>
        <li>Send <code className="mono">/newbot</code> and follow the prompts.</li>
        <li>Copy the access token BotFather gives you and paste it below.</li>
      </ol>

      <Field
        label="Bot token"
        hint="We verify the token with Telegram, register the webhook for you, and store it encrypted. It is never shown again after saving."
      >
        <Input
          type="password" autoComplete="off" spellCheck={false} className="mono"
          placeholder="123456789:AA…"
          value={token} onChange={(e) => setToken(e.target.value)}
        />
      </Field>

      <a
        href="https://core.telegram.org/bots#how-do-i-create-a-bot"
        target="_blank" rel="noreferrer noopener"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-2)', marginTop: 12 }}
      >
        Telegram's guide to creating a bot <ExternalLink size={11} />
      </a>
    </Modal>
  );
}
