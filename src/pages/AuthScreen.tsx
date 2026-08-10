import React, { useState } from 'react';
import { getSupabase } from '../lib/api';

type Mode = 'login' | 'signup' | 'reset';

export function AuthScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
        if (password.length < 8) throw new Error('Password must be at least 8 characters');
        const { data, error } = await sb.auth.signUp({ email, password });
        if (error) throw error;
        if (data.session) onSignedIn();
        else setNotice('Check your email to confirm your account, then sign in.');
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/`,
        });
        if (error) throw error;
        setNotice('If that email has an account, a reset link is on its way.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--text)' }}>Sales OS</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-2)' }}>
            AI sales and customer communication for your business
          </p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <input
            type="email" required value={email} placeholder="you@business.com"
            onChange={(e) => setEmail(e.target.value)} autoComplete="email"
            className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)' }}
          />
          {mode !== 'reset' && (
            <input
              type="password" required value={password} placeholder="Password"
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)' }}
            />
          )}

          {error && <p className="text-sm" style={{ color: '#f87171' }}>{error}</p>}
          {notice && <p className="text-sm" style={{ color: '#34d399' }}>{notice}</p>}

          <button
            type="submit" disabled={busy}
            className="w-full py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
            style={{ background: 'var(--white)', color: 'var(--black)' }}
          >
            {busy ? 'Please wait…'
              : mode === 'login' ? 'Sign in'
              : mode === 'signup' ? 'Create account'
              : 'Send reset link'}
          </button>
        </form>

        <div className="mt-5 flex justify-between text-xs" style={{ color: 'var(--text-2)' }}>
          {mode !== 'login' ? (
            <button onClick={() => { setMode('login'); setError(null); setNotice(null); }}>Back to sign in</button>
          ) : (
            <button onClick={() => { setMode('signup'); setError(null); setNotice(null); }}>Create an account</button>
          )}
          {mode === 'login' && (
            <button onClick={() => { setMode('reset'); setError(null); setNotice(null); }}>Forgot password?</button>
          )}
        </div>
      </div>
    </div>
  );
}
