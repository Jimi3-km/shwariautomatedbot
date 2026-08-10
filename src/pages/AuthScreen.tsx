import React, { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { getSupabase } from '../lib/api';
import { Button, Field, Input, InlineError } from '../components/ui';

type Mode = 'login' | 'signup' | 'reset';

const COPY: Record<Mode, { title: string; subtitle: string; cta: string }> = {
  login: { title: 'Welcome back', subtitle: 'Sign in to your dashboard.', cta: 'Sign in' },
  signup: { title: 'Create your account', subtitle: 'Start handling customer conversations with AI.', cta: 'Create account' },
  reset: { title: 'Reset your password', subtitle: "We'll email you a link to set a new one.", cta: 'Send reset link' },
};

export function AuthScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function switchMode(next: Mode) {
    setMode(next); setError(null); setNotice(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setNotice(null);
    const sb = getSupabase();

    try {
      if (mode === 'login') {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onSignedIn();
      } else if (mode === 'signup') {
        if (password.length < 8) throw new Error('Please use at least 8 characters.');
        const { data, error } = await sb.auth.signUp({ email, password });
        if (error) throw error;
        if (data.session) onSignedIn();
        else setNotice('Check your email to confirm your account, then sign in.');
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/`,
        });
        if (error) throw error;
        // Deliberately not confirming whether the address exists.
        setNotice('If that email has an account, a reset link is on its way.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const copy = COPY[mode];

  return (
    <div style={{
      height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', padding: 20,
    }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 26 }}>
          <div style={{
            width: 42, height: 42, borderRadius: 12, background: 'var(--accent)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14,
          }}>
            <Sparkles size={20} color="#fff" />
          </div>
          <h1 style={{ fontSize: 21, fontWeight: 600, letterSpacing: '-0.02em' }}>{copy.title}</h1>
          <p style={{ fontSize: 13.5, color: 'var(--text-2)', marginTop: 4 }}>{copy.subtitle}</p>
        </div>

        <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
          <Field label="Email">
            <Input
              type="email" required autoComplete="email" value={email}
              placeholder="you@yourbusiness.com"
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>

          {mode !== 'reset' && (
            <Field
              label="Password"
              hint={mode === 'signup' ? 'At least 8 characters.' : undefined}
            >
              <Input
                type="password" required value={password}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
          )}

          {error && (
            <div style={{
              fontSize: 12.5, color: 'var(--danger)', background: 'var(--danger-bg)',
              padding: '8px 11px', borderRadius: 'var(--radius)',
            }}>
              {error}
            </div>
          )}
          {notice && (
            <div style={{
              fontSize: 12.5, color: 'var(--success)', background: 'var(--success-bg)',
              padding: '8px 11px', borderRadius: 'var(--radius)',
            }}>
              {notice}
            </div>
          )}

          <Button type="submit" variant="solid" size="lg" loading={busy} style={{ width: '100%' }}>
            {copy.cta}
          </Button>
        </form>

        <div style={{
          display: 'flex', justifyContent: 'space-between', marginTop: 18,
          fontSize: 12.5, color: 'var(--text-2)',
        }}>
          {mode === 'login' ? (
            <>
              <button onClick={() => switchMode('signup')}>Create an account</button>
              <button onClick={() => switchMode('reset')}>Forgot password?</button>
            </>
          ) : (
            <button onClick={() => switchMode('login')}>Back to sign in</button>
          )}
        </div>
      </div>
    </div>
  );
}
