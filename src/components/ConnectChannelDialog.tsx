import React from 'react';
import { ExternalLink, ShieldCheck } from 'lucide-react';
import { Button, Modal } from './ui';
import type { ProviderId } from '../types';

/**
 * Shown before sending someone to Meta.
 *
 * An unexplained jump to facebook.com is where people abandon a connection —
 * they do not know what is about to be asked of them, or what we will be able
 * to see. This says both, in the order it will happen, and names what we never
 * get access to. It is the last screen we control before Meta owns the flow.
 */

interface Copy {
  title: string;
  intro: string;
  steps: string[];
  reassurance: string;
  cta: string;
}

const COPY: Partial<Record<ProviderId, Copy>> = {
  whatsapp: {
    title: 'Connect WhatsApp Business',
    intro: "We'll hand you to Meta to approve access. It usually takes about two minutes.",
    steps: [
      'Sign in to Facebook and pick (or create) your Business account',
      'Choose the WhatsApp number customers will message',
      'Confirm the number with the code Meta sends you',
      "You'll come straight back here, connected",
    ],
    reassurance:
      'We only get permission to send and receive messages for that number. We never see your Facebook password, your personal profile or your contacts.',
    cta: 'Continue to Meta',
  },
  instagram: {
    title: 'Connect Instagram',
    intro: "We'll hand you to Instagram to approve access. It takes under a minute.",
    steps: [
      'Sign in to the Instagram account for your business',
      'Approve access to your messages',
      "You'll come straight back here, connected",
    ],
    reassurance:
      'We only get permission to read and reply to your direct messages. We never see your password, and we cannot post to your account.',
    cta: 'Continue to Instagram',
  },
};

export function ConnectChannelDialog({
  provider, open, busy, onConfirm, onClose,
}: {
  provider: ProviderId | null;
  open: boolean;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const copy = provider ? COPY[provider] : undefined;
  if (!copy) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={copy.title}
      width={460}
      footer={
        <>
          <Button variant="subtle" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant="solid" loading={busy}
            icon={<ExternalLink size={14} />} onClick={onConfirm}
          >
            {copy.cta}
          </Button>
        </>
      }
    >
      <p style={{ fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.6 }}>{copy.intro}</p>

      <ol style={{ margin: '14px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 10 }}>
        {copy.steps.map((step, i) => (
          <li key={step} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span
              aria-hidden
              style={{
                width: 20, height: 20, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                background: 'var(--surface-2)', color: 'var(--text-2)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 600,
              }}
            >
              {i + 1}
            </span>
            <span style={{ fontSize: 13, lineHeight: 1.5 }}>{step}</span>
          </li>
        ))}
      </ol>

      <div style={{
        display: 'flex', gap: 9, alignItems: 'flex-start', marginTop: 16,
        padding: '11px 13px', background: 'var(--surface-2)', borderRadius: 'var(--radius)',
      }}>
        <ShieldCheck size={15} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.55 }}>
          {copy.reassurance}
        </div>
      </div>
    </Modal>
  );
}
