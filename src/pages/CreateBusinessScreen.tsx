import React, { useState } from 'react';
import { Building2 } from 'lucide-react';
import { bootstrapTenant } from '../lib/api';
import { useMutation } from '../hooks';
import { Button, Field, Input, InlineError } from '../components/ui';

/**
 * Shown once, to an authenticated user with no business yet. Creating the
 * business also makes them its owner. The tenant is created server-side; the
 * browser never chooses an id.
 */
export function CreateBusinessScreen({
  onCreated, onSignOut,
}: { onCreated: () => void; onSignOut: () => void }) {
  const [businessName, setBusinessName] = useState('');
  const [agentName, setAgentName] = useState('');
  const [currency, setCurrency] = useState('');
  const [timezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  );

  const create = useMutation(async () => {
    await bootstrapTenant({
      business_name: businessName.trim(),
      agent_name: agentName.trim() || undefined,
      currency: currency.trim() || undefined,
      timezone,
    });
    onCreated();
  });

  return (
    <div style={{
      height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', padding: 20,
    }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{
            width: 42, height: 42, borderRadius: 12, background: 'var(--surface-2)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14,
          }}>
            <Building2 size={20} />
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em' }}>Set up your business</h1>
          <p style={{ fontSize: 13.5, color: 'var(--text-2)', marginTop: 4 }}>
            This becomes your workspace. Everything here can be changed later.
          </p>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); create.run(); }}
          style={{ display: 'grid', gap: 13 }}
        >
          <InlineError message={create.error} onDismiss={create.clearError} />

          <Field label="Business name" required>
            <Input
              required value={businessName} placeholder="e.g. Glow Beauty Spa"
              onChange={(e) => setBusinessName(e.target.value)}
            />
          </Field>

          <Field label="AI agent name" hint="What your assistant calls itself when talking to customers.">
            <Input value={agentName} placeholder="Assistant" onChange={(e) => setAgentName(e.target.value)} />
          </Field>

          <Field label="Currency" hint="Three-letter code, e.g. USD, KES, NGN.">
            <Input
              maxLength={3} value={currency} placeholder="USD"
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            />
          </Field>

          <Button
            type="submit" variant="solid" size="lg" style={{ width: '100%' }}
            loading={create.busy} disabled={!businessName.trim()}
          >
            Create business
          </Button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 18 }}>
          <button onClick={onSignOut} style={{ fontSize: 12.5, color: 'var(--text-3)' }}>Sign out</button>
        </div>
      </div>
    </div>
  );
}
