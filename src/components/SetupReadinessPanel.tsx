import React, { useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronRight, Copy, Wrench } from 'lucide-react';
import { getSetupStatus } from '../lib/api';
import { useAsync } from '../hooks';
import { Button, Card, Pill } from './ui';

/**
 * Operator readiness, shown only to admins.
 *
 * This is the one surface in the product that speaks in environment variables.
 * The rule everywhere else — a business owner never sees one — still holds;
 * this exists because the person deploying is also an admin, and without it
 * they diagnose a silent misconfiguration by reading server logs.
 *
 * It renders nothing at all once everything is ready, so a finished
 * installation does not carry a permanent settings panel it no longer needs.
 */
export function SetupReadinessPanel() {
  const state = useAsync(() => getSetupStatus(), []);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  // Not an admin, or the endpoint is unreachable: stay silent rather than
  // showing a broken diagnostic panel.
  if (state.loading || state.error || !state.data) return null;

  const s = state.data;
  const blocked = s.channels.filter((c) => !c.ready);
  const deliveryGaps = [
    ...s.delivery.missing_environment_variables,
    ...s.delivery.internal_send_missing,
  ];

  if (s.all_ready && !deliveryGaps.length) return null;

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1600);
    } catch { /* clipboard refused; the text is selectable */ }
  }

  const rows: Array<{ label: string; value: string }> = [
    { label: 'Webhook callback URL', value: s.register_with_meta.webhook_callback_url },
    { label: 'WhatsApp redirect URI', value: s.register_with_meta.whatsapp_redirect_uri },
    { label: 'Instagram redirect URI', value: s.register_with_meta.instagram_connect_redirect_uri },
  ];

  return (
    <Card>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
          background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer',
        }}
      >
        <div style={{
          width: 34, height: 34, borderRadius: 'var(--radius)', flexShrink: 0,
          background: 'var(--warning-bg)', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Wrench size={16} style={{ color: 'var(--warning)' }} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Finish server setup</span>
            <Pill tone="warning" dot>Admin only</Pill>
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 2 }}>
            {blocked.length > 0
              ? `${blocked.map((c) => c.label).join(' and ')} ${blocked.length === 1 ? 'is' : 'are'} not available yet.`
              : 'Messages arrive, but the assistant cannot reply yet.'}
          </p>
        </div>

        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>

      {open && (
        <div style={{ marginTop: 14, display: 'grid', gap: 14 }}>
          {blocked.length > 0 && (
            <section>
              <div className="section-label" style={{ marginBottom: 7 }}>Channels not yet available</div>
              <div style={{ display: 'grid', gap: 8 }}>
                {blocked.map((c) => (
                  <div key={c.id} style={{
                    padding: '10px 12px', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 550, marginBottom: 5 }}>{c.label}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {c.missing_environment_variables.map((v) => (
                        <code key={v} style={{
                          fontSize: 11, padding: '2px 6px', borderRadius: 5,
                          background: 'var(--surface-2)', color: 'var(--text-2)',
                        }}>
                          {v}
                        </code>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {deliveryGaps.length > 0 && (
            <section>
              <div className="section-label" style={{ marginBottom: 7 }}>Replies</div>
              <div style={{
                display: 'flex', gap: 9, alignItems: 'flex-start', padding: '11px 13px',
                background: 'var(--warning-bg)', borderRadius: 'var(--radius)',
              }}>
                <AlertTriangle size={15} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 1 }} />
                <div style={{ fontSize: 12.5, color: 'var(--warning)', lineHeight: 1.55 }}>
                  Messages will reach the Inbox, but the assistant cannot answer until{' '}
                  {deliveryGaps.map((v) => <code key={v} style={{ fontWeight: 600 }}>{v}</code>)
                    .reduce<React.ReactNode[]>((acc, el, i) => i === 0 ? [el] : [...acc, ' and ', el], [])}
                  {' '}is set, and the <strong>Send Reply (Channel API)</strong> node in n8n points at this server.
                </div>
              </div>
            </section>
          )}

          <section>
            <div className="section-label" style={{ marginBottom: 7 }}>Paste these into Meta</div>
            <div style={{ display: 'grid', gap: 6 }}>
              {rows.map((r) => (
                <div key={r.label} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                  background: 'var(--surface-2)', borderRadius: 'var(--radius)',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{r.label}</div>
                    <div style={{
                      fontSize: 11.5, fontFamily: 'ui-monospace, monospace',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {r.value}
                    </div>
                  </div>
                  <Button
                    size="sm" variant={copied === r.label ? 'success' : 'subtle'}
                    icon={copied === r.label ? <Check size={12} /> : <Copy size={12} />}
                    onClick={() => copy(r.value, r.label)}
                  >
                    {copied === r.label ? 'Copied' : 'Copy'}
                  </Button>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 8 }}>
              Subscribe to the <code>messages</code> field. Full walkthrough in
              {' '}<code>docs/SETUP.md</code>.
            </p>
          </section>
        </div>
      )}
    </Card>
  );
}
