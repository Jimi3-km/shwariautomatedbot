import React, { useState } from 'react';
import { AlertTriangle, Check, CircleHelp, Copy, Stethoscope, X } from 'lucide-react';
import { getMetaCheck, type MetaCheck } from '../lib/api';
import { useMutation } from '../hooks';
import { Button, Card, Pill } from './ui';

/**
 * "Why won't Instagram, WhatsApp or a Facebook Page connect?"
 *
 * Those failures happen on Meta's own pages, in Meta's words, with nothing to
 * go on. This asks the server to test each setting against the Meta app and
 * lists what is fine, what is wrong, and what to change. Admins only.
 */
const AREAS: Array<{ id: MetaCheck['area']; label: string }> = [
  { id: 'app', label: 'Meta app' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'facebook', label: 'Facebook Page' },
  { id: 'webhook', label: 'Receiving messages' },
];

export function MetaSetupCheck() {
  const check = useMutation(() => getMetaCheck());
  const [result, setResult] = useState<Awaited<ReturnType<typeof getMetaCheck>> | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function run() {
    const data = await check.run();
    if (data) setResult(data);
  }

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1600);
    } catch { /* clipboard refused; the text is selectable */ }
  }

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{
          width: 34, height: 34, borderRadius: 'var(--radius)', flexShrink: 0,
          background: 'var(--info-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Stethoscope size={16} style={{ color: 'var(--info)' }} />
        </div>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Instagram, WhatsApp or Facebook won't connect?</span>
            <Pill tone="neutral">Admin only</Pill>
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 2 }}>
            Test this server's Meta settings and see exactly what to fix.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={run} disabled={check.busy}>
          {check.busy ? 'Checking…' : result ? 'Check again' : 'Run check'}
        </Button>
      </div>

      {check.error && (
        <p style={{ fontSize: 12.5, color: 'var(--danger)', marginTop: 10 }}>{check.error}</p>
      )}

      {result && (
        <div style={{ marginTop: 14, display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Pill tone="success" dot>{result.summary.ok} fine</Pill>
            {result.summary.failing > 0 && <Pill tone="danger" dot>{result.summary.failing} to fix</Pill>}
            <Pill tone="neutral" dot>{result.summary.unknown} to check in Meta</Pill>
          </div>

          {AREAS.map((area) => {
            const rows = result.checks.filter((c) => c.area === area.id);
            if (!rows.length) return null;
            return (
              <section key={area.id}>
                <div className="section-label" style={{ marginBottom: 7 }}>{area.label}</div>
                <div style={{ display: 'grid', gap: 6 }}>
                  {rows.map((c) => (
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
                        <div style={{ fontSize: 13, fontWeight: 550 }}>{c.label}</div>
                        {c.ok !== true && (
                          <p style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 3, lineHeight: 1.55 }}>{c.detail}</p>
                        )}
                        {c.ok !== true && c.fix && (
                          <p style={{ fontSize: 12.5, marginTop: 5, lineHeight: 1.55, display: 'flex', gap: 6 }}>
                            <AlertTriangle size={13} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 2 }} />
                            <span>{c.fix}</span>
                          </p>
                        )}
                        {c.ok !== true && c.copy && (
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: 8, marginTop: 7, padding: '6px 8px',
                            background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)',
                          }}>
                            <code style={{
                              flex: 1, minWidth: 0, fontSize: 11.5, overflowWrap: 'anywhere',
                              fontFamily: 'ui-monospace, monospace',
                            }}>
                              {c.copy}
                            </code>
                            <Button
                              size="sm" variant={copied === c.id ? 'success' : 'subtle'}
                              icon={copied === c.id ? <Check size={12} /> : <Copy size={12} />}
                              onClick={() => copy(c.copy!, c.id)}
                            >
                              {copied === c.id ? 'Copied' : 'Copy'}
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </Card>
  );
}
