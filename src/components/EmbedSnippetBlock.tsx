import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from './ui';
import type { EmbedSnippet } from '../types';

/**
 * The one thing a web chat owner has to do: copy a line of HTML into their
 * site. Shown in both the setup wizard and Integrations, so it lives here
 * rather than being written twice.
 *
 * The snippet contains only the public site key. There is no secret on screen,
 * which is why it is safe to show in full and to copy to the clipboard.
 */
export function EmbedSnippetBlock({ embed }: { embed: EmbedSnippet }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(embed.html);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access can be refused; the snippet is selectable anyway.
      setCopied(false);
    }
  }

  return (
    <div style={{
      marginTop: 12, padding: 12, borderRadius: 'var(--radius)',
      background: 'var(--surface-2)', border: '1px solid var(--border)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 8, marginBottom: 8,
      }}>
        <span style={{ fontSize: 12.5, fontWeight: 550 }}>
          Paste this before <code>&lt;/body&gt;</code> on your website
        </span>
        <Button
          size="sm" variant={copied ? 'success' : 'outline'}
          icon={copied ? <Check size={12} /> : <Copy size={12} />}
          onClick={copy}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>

      <pre style={{
        margin: 0, padding: '9px 11px', borderRadius: 8, background: 'var(--bg)',
        fontSize: 11.5, lineHeight: 1.5, overflowX: 'auto', whiteSpace: 'pre',
        border: '1px solid var(--border)',
      }}>
        <code>{embed.html}</code>
      </pre>

      <p style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 8 }}>
        Works on any website — Wordpress, Shopify, Wix or your own HTML. Messages
        arrive in your Inbox like every other channel.
      </p>
    </div>
  );
}
