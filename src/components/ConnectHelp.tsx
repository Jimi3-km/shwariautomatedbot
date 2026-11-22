import React, { useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { Button, Modal } from './ui';
import type { InAppBrowser } from '../lib/inAppBrowser';

const CHANNEL_NAME: Record<string, string> = {
  instagram: 'Instagram', facebook: 'your Facebook Page', whatsapp: 'WhatsApp', telegram: 'Telegram', webchat: 'Web chat',
};

/**
 * Shown instead of starting a connection when this page is inside another
 * app's built-in browser, where Meta's sign-in does not work reliably.
 */
export function OpenInBrowserDialog({ browser, onClose }: { browser: InAppBrowser | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  if (!browser) return null;
  const address = window.location.origin;

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* the address is shown and can be selected */ }
  }

  return (
    <Modal
      open onClose={onClose} title={`Open this in ${browser.openIn} first`} width={440}
      footer={<Button variant="solid" onClick={onClose}>Close</Button>}
    >
      <div style={{ display: 'grid', gap: 12, fontSize: 13.5, lineHeight: 1.6 }}>
        <p>
          You are viewing this inside {browser.app}. Its built-in browser cannot complete a
          channel sign-in, so connecting from here will fail.
        </p>
        <ol style={{ paddingLeft: 20, display: 'grid', gap: 6 }}>
          {browser.ios ? (
            <>
              <li>Tap the <strong>⋯</strong> or share button at the top or bottom of this screen.</li>
              <li>Choose <strong>Open in Safari</strong> (or "Open in browser").</li>
            </>
          ) : (
            <>
              <li>Tap the <strong>⋮</strong> menu at the top right.</li>
              <li>Choose <strong>Open in Chrome</strong> (or "Open in browser").</li>
            </>
          )}
          <li>Sign in there and connect the channel again.</li>
        </ol>
        <p style={{ color: 'var(--text-2)' }}>Or copy the address and paste it into {browser.openIn}:</p>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
          background: 'var(--surface-2)', borderRadius: 'var(--radius)',
        }}>
          <code style={{ flex: 1, minWidth: 0, fontSize: 12.5, overflowWrap: 'anywhere', fontFamily: 'ui-monospace, monospace' }}>
            {address}
          </code>
          <Button size="sm" variant={copied ? 'success' : 'subtle'} icon={copied ? <Check size={12} /> : <Copy size={12} />} onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const RESULT: Record<string, { ok: boolean; title: string; body: string }> = {
  connected: { ok: true, title: 'Connected', body: 'is now connected to your business.' },
  pick_page: { ok: true, title: 'Signed in with Facebook', body: 'One more step: choose which Page to connect.' },
  cancelled: { ok: false, title: 'Connection cancelled', body: 'Nothing was connected.' },
  expired: { ok: false, title: 'That took too long', body: 'The sign-in was not finished in time, so it was stopped for safety. Nothing was connected.' },
  no_pages: { ok: false, title: 'No Page was shared', body: 'Only a Facebook Page can be connected, not a personal profile. Sign in as someone who manages the Page and tick it when Facebook asks.' },
  page_in_use: { ok: false, title: 'That Page is already in use', body: 'It is connected to another business.' },
  whatsapp_no_account: { ok: false, title: 'No WhatsApp Business account was shared', body: 'In the sign-up, choose or create a WhatsApp Business account and add a phone number before finishing.' },
  whatsapp_no_number: { ok: false, title: 'No WhatsApp number was set up', body: 'Finish adding a phone number in the WhatsApp sign-up, then try again.' },
  account_in_use: { ok: false, title: 'That account is already in use', body: 'It is connected to another business on this platform. Disconnect it there first, then connect it here.' },
  instagram_exchange_failed: { ok: false, title: 'Instagram did not complete the sign-in', body: 'Try again. If it keeps happening, check that the account is a Business or Creator account.' },
  platform_fault: { ok: false, title: 'A problem on our side', body: "This is not your doing. We've been notified and will fix it. Nothing was connected." },
};

/**
 * The end of a channel sign-in, for a browser that is not signed in here.
 *
 * A phone often finishes Meta's sign-in in a different browser from the one
 * the dashboard is open in. That browser has no session, so it used to show
 * the public home page, which looked exactly like a failure even when the
 * channel had connected. This says what actually happened and where to go.
 */
export function ConnectResult({ provider, status, onSignIn }: { provider: string; status: string; onSignIn: () => void }) {
  const r = RESULT[status] ?? { ok: false, title: "We couldn't finish connecting", body: 'Nothing was connected. Please try again.' };
  const channel = CHANNEL_NAME[provider] ?? 'The channel';
  const sentence = status === 'connected' ? `${channel[0].toUpperCase()}${channel.slice(1)} ${r.body}` : r.body;

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', padding: 20,
    }}>
      <div className="card p-5" style={{ maxWidth: 420, width: '100%', textAlign: 'center' }}>
        <div style={{
          width: 44, height: 44, borderRadius: 22, margin: '0 auto 12px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: r.ok ? 'var(--success-bg)' : 'var(--danger-bg)',
          color: r.ok ? 'var(--success)' : 'var(--danger)', fontSize: 20, fontWeight: 700,
        }} aria-hidden>
          {r.ok ? '✓' : '!'}
        </div>
        <h1 style={{ fontSize: 18, fontWeight: 600 }}>{r.title}</h1>
        <p style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.6, marginTop: 8 }}>{sentence}</p>

        <div style={{
          marginTop: 16, padding: '12px 14px', textAlign: 'left', fontSize: 13, lineHeight: 1.6,
          background: 'var(--surface-2)', borderRadius: 'var(--radius)',
        }}>
          <strong>You're not signed in on this browser.</strong>
          <div style={{ color: 'var(--text-2)', marginTop: 4 }}>
            {r.ok
              ? 'The sign-in finished here, but your dashboard is open in another browser or app. Go back to it and refresh the Integrations page.'
              : 'Go back to the browser or app where your dashboard is open and try again from there.'}
          </div>
        </div>

        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'center' }}>
          <Button variant="outline" icon={<ExternalLink size={14} />} onClick={onSignIn}>Sign in on this browser</Button>
        </div>
      </div>
    </div>
  );
}
