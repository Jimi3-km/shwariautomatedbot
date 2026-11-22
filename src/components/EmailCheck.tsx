import React, { useState } from 'react';
import { AlertTriangle, Check, CircleHelp, Mail, Send, X } from 'lucide-react';
import { getEmailCheck, sendTestEmail } from '../lib/api';
import { useMutation } from '../hooks';
import { Button, Card, InlineError, Pill } from './ui';
import { relativeTime } from '../lib/format';

/**
 * Why is email not arriving?
 *
 * Asks the email service about the account, the sending address and its
 * domain, shows what happened to recent messages, and can send one real test
 * email. For the platform admin only: it names server settings.
 */
export function EmailCheck() {
  const check = useMutation(() => getEmailCheck());
  const test = useMutation(() => sendTestEmail());
  const [result, setResult] = useState<Awaited<ReturnType<typeof getEmailCheck>> | null>(null);
  const [sent, setSent] = useState<Awaited<ReturnType<typeof sendTestEmail>> | null>(null);

  async function run() {
    const data = await check.run();
    if (data) setResult(data);
  }
  async function sendTest() {
    const data = await test.run();
    if (data) { setSent(data); void run(); }
  }

  const failing = result?.checks.filter((c) => c.ok === false).length ?? 0;

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{
          width: 34, height: 34, borderRadius: 'var(--radius)', flexShrink: 0,
          background: 'var(--info-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Mail size={16} style={{ color: 'var(--info)' }} />
        </div>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Email check</span>
            {result && (failing > 0
              ? <Pill tone="danger" dot>{failing} to fix</Pill>
              : <Pill tone="success" dot>Nothing blocking</Pill>)}
          </div>
          <p className="field-hint" style={{ marginTop: 3 }}>
            Receipts and booking confirmations go by email. This finds out why they are not arriving.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="outline" loading={check.busy} onClick={run}>{result ? 'Check again' : 'Run the check'}</Button>
          <Button variant="subtle" icon={<Send size={13} />} loading={test.busy} onClick={sendTest}>Send me a test email</Button>
        </div>
      </div>

      <InlineError message={check.error ?? test.error} />

      {sent && (
        <div style={{
          marginTop: 12, padding: '10px 12px', borderRadius: 'var(--radius)', fontSize: 12.5, lineHeight: 1.55,
          background: sent.accepted ? 'var(--success-bg)' : 'var(--danger-bg)',
        }}>
          {sent.accepted
            ? `The email service accepted a test email from ${sent.from} to ${sent.to}. Look for it in your inbox and your spam folder. If it is in spam or does not arrive, the sending domain needs authenticating (see below).`
            : `The email service refused the test email: ${sent.error}`}
        </div>
      )}

      {result && (
        <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
          <div style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
            Sending as <strong>{result.sender.name}</strong> &lt;{result.sender.email}&gt;
          </div>
          {result.checks.map((c) => (
            <div key={c.id} style={{
              display: 'flex', gap: 10, padding: '10px 12px',
              border: '1px solid var(--border)', borderRadius: 'var(--radius)',
              background: c.ok === false ? 'var(--danger-bg)' : 'transparent',
            }}>
              <span style={{ flexShrink: 0, marginTop: 1 }}>
                {c.ok === true && <Check size={15} style={{ color: 'var(--success)' }} />}
                {c.ok === false && <X size={15} style={{ color: 'var(--danger)' }} />}
                {c.ok === null && <CircleHelp size={15} style={{ color: 'var(--text-3)' }} />}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 550, overflowWrap: 'anywhere' }}>{c.label}</div>
                <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 3, lineHeight: 1.55, overflowWrap: 'anywhere' }}>{c.detail}</p>
                {c.ok !== true && c.fix && (
                  <p style={{ fontSize: 12.5, marginTop: 5, lineHeight: 1.55, display: 'flex', gap: 6 }}>
                    <AlertTriangle size={13} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 2 }} />
                    <span>{c.fix}</span>
                  </p>
                )}
              </div>
            </div>
          ))}

          {result.events.length > 0 && (
            <>
              <div className="section-label" style={{ marginTop: 8 }}>What the email service did with recent messages</div>
              {result.events.slice(0, 10).map((e, i) => {
                const bad = /bounce|blocked|invalid|spam|error|deferred/i.test(e.event);
                return (
                  <div key={i} style={{
                    display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline',
                    padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', fontSize: 12.5,
                  }}>
                    <Pill tone={bad ? 'danger' : /delivered|opened|click/i.test(e.event) ? 'success' : 'neutral'}>{e.event}</Pill>
                    <span style={{ flex: '1 1 180px', minWidth: 0, overflowWrap: 'anywhere' }}>
                      {e.to}{e.subject ? ` · ${e.subject}` : ''}{e.reason ? ` · ${e.reason}` : ''}
                    </span>
                    <span style={{ color: 'var(--text-3)' }}>{relativeTime(e.at)}</span>
                  </div>
                );
              })}
            </>
          )}

          {result.recent.length > 0 && (
            <>
              <div className="section-label" style={{ marginTop: 8 }}>What the platform tried to send</div>
              {result.recent.slice(0, 10).map((r, i) => (
                <div key={i} style={{
                  display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline',
                  padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', fontSize: 12.5,
                }}>
                  <Pill tone={r.ok ? 'success' : 'danger'}>{r.ok ? 'accepted' : 'refused'}</Pill>
                  <span style={{ flex: '1 1 180px', minWidth: 0, overflowWrap: 'anywhere' }}>
                    {r.kind} · {r.recipient}{r.error ? ` · ${r.error}` : ''}
                  </span>
                  <span style={{ color: 'var(--text-3)' }}>{relativeTime(r.at)}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </Card>
  );
}
