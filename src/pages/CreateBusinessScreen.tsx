import React, { useState } from 'react';
import { api } from '../lib/api';

/**
 * Shown once, to an authenticated user who has no tenant yet. Creating the
 * business also creates their tenant_users row with role=owner.
 */
export function CreateBusinessScreen({
  onCreated, onSignOut,
}: { onCreated: () => void; onSignOut: () => void }) {
  const [businessName, setBusinessName] = useState('');
  const [agentName, setAgentName] = useState('');
  const [currency, setCurrency] = useState('KES');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api('/bootstrap', {
        method: 'POST',
        body: { business_name: businessName, agent_name: agentName || 'Assistant', currency },
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create your business');
      setBusy(false);
    }
  }

  const field = {
    background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)',
  } as React.CSSProperties;

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold mb-1" style={{ color: 'var(--text)' }}>Set up your business</h1>
        <p className="text-sm mb-6" style={{ color: 'var(--text-2)' }}>
          This becomes your workspace. You can change any of it later.
        </p>

        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            <span className="text-xs" style={{ color: 'var(--text-2)' }}>Business name</span>
            <input
              required value={businessName} onChange={(e) => setBusinessName(e.target.value)}
              placeholder="e.g. Acme Electronics"
              className="mt-1 w-full px-3 py-2.5 rounded-lg text-sm outline-none" style={field}
            />
          </label>
          <label className="block">
            <span className="text-xs" style={{ color: 'var(--text-2)' }}>What should your AI agent be called?</span>
            <input
              value={agentName} onChange={(e) => setAgentName(e.target.value)} placeholder="Assistant"
              className="mt-1 w-full px-3 py-2.5 rounded-lg text-sm outline-none" style={field}
            />
          </label>
          <label className="block">
            <span className="text-xs" style={{ color: 'var(--text-2)' }}>Currency</span>
            <input
              value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
              maxLength={3} className="mt-1 w-full px-3 py-2.5 rounded-lg text-sm outline-none" style={field}
            />
          </label>

          {error && <p className="text-sm" style={{ color: '#f87171' }}>{error}</p>}

          <button
            type="submit" disabled={busy}
            className="w-full py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
            style={{ background: 'var(--white)', color: 'var(--black)' }}
          >
            {busy ? 'Creating…' : 'Create business'}
          </button>
        </form>

        <button onClick={onSignOut} className="mt-5 text-xs" style={{ color: 'var(--text-2)' }}>Sign out</button>
      </div>
    </div>
  );
}
