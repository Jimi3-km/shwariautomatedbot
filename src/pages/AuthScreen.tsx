import React, { useEffect, useState } from 'react';
import { Sparkles, Instagram } from 'lucide-react';
import { getSupabase, request } from '../lib/api';
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
  const [instagramAvailable, setInstagramAvailable] = useState(false);
  // Set when a confirmation email is the missing step, so we can offer to send
  // it again — the first one is easily lost to spam filters or rate limits.
  const [canResend, setCanResend] = useState(false);

  // Only offer the button when the server can actually honour it, so a user
  // never gets bounced to a 503.
  useEffect(() => {
    request<{ available: boolean }>('/auth/instagram/available')
      .then((r) => setInstagramAvailable(r.available))
      .catch(() => setInstagramAvailable(false));
  }, []);

  // The OAuth callback returns here with a single-use token. Exchanging it
  // yields a genuine Supabase session, so auth.uid() and RLS keep working.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get('auth_error');
    if (authError) {
      setError(
        authError === 'instagram_cancelled'
          ? 'Instagram sign-in was cancelled.'
          : 'Instagram sign-in did not complete. Please try again.'
      );
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }

    const token = params.get('ig_token');
    const email = params.get('ig_email');
    if (!token || !email) return;

    window.history.replaceState({}, '', window.location.pathname);
    setBusy(true);
    getSupabase()
      .auth.verifyOtp({ type: 'magiclink', token_hash: token })
      .then(({ error }) => {
        if (error) throw error;
        onSignedIn();
      })
      .catch(() => setError('Could not complete Instagram sign-in. Please try again.'))
      .finally(() => setBusy(false));
  }, [onSignedIn]);

  function switchMode(next: Mode) {
    setMode(next); setError(null); setNotice(null); setCanResend(false);
  }

  // Send the confirmation email again. Supabase rate-limits this, so a failure
  // here is usually "too many requests" rather than a real error.
  async function resendConfirmation() {
    setBusy(true); setError(null);
    try {
      const { error } = await getSupabase().auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: `${window.location.origin}/` },
      });
      if (error) throw error;
      setNotice('Sent again. Check your inbox and your spam folder.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend just now. Try again in a minute.');
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setNotice(null);
    const sb = getSupabase();

    try {
      if (mode === 'login') {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) {
          // Supabase blocks sign-in until the address is confirmed. Rather than
          // show its raw "Email not confirmed", point the user at the fix.
          if (/not confirmed/i.test(error.message)) {
            setCanResend(true);
            throw new Error('Please confirm your email first — check your inbox for the link.');
          }
          throw error;
        }
        onSignedIn();
      } else if (mode === 'signup') {
        if (password.length < 8) throw new Error('Please use at least 8 characters.');
        // Send the confirmation link back to whatever origin the user signed up
        // on, so local development lands on http://localhost:3000 instead of
        // whatever the project's Site URL happens to be. The origin must also
        // be listed under Supabase -> Authentication -> URL Configuration ->
        // Redirect URLs for it to be honoured.
        const { data, error } = await sb.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/` },
        });
        if (error) throw error;
        if (data.session) {
          onSignedIn();
        } else {
          setNotice('Check your email to confirm your account, then sign in.');
          setCanResend(true);
        }
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

          {canResend && (
            <button
              type="button"
              onClick={resendConfirmation}
              disabled={busy || !email}
              style={{
                fontSize: 12.5, color: 'var(--accent)', background: 'none',
                border: 0, cursor: 'pointer', padding: 4,
              }}
            >
              Resend confirmation email
            </button>
          )}
        </form>

        {instagramAvailable && mode !== 'reset' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '18px 0 14px' }}>
              <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>or</span>
              <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            </div>
            <Button
              type="button" variant="outline" size="lg" style={{ width: '100%' }}
              icon={<Instagram size={15} />} disabled={busy}
              onClick={() => { window.location.href = '/api/auth/instagram'; }}
            >
              Continue with Instagram
            </Button>
          </>
        )}

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

/**
 * The other half of "reset password".
 *
 * The reset email lands the user back on the app with a one-time recovery
 * token, which supabase-js turns into a session. That session is only good for
 * one thing — setting a new password — so this screen exists to do exactly
 * that, and nothing routes the user into the dashboard until it is done.
 * Without it the reset email was a dead end: a session with the *old* password
 * still in force and no way to change it.
 */
export function SetNewPassword({ onDone, onCancel }: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) { setError('Please use at least 8 characters.'); return; }
    if (password !== confirm) { setError('Those two passwords do not match.'); return; }

    setBusy(true); setError(null);
    try {
      const { error } = await getSupabase().auth.updateUser({ password });
      if (error) throw error;
      // Drop the recovery token from the URL so a refresh does not reprocess it.
      window.history.replaceState({}, '', window.location.pathname);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set your password. Request a new link.');
    } finally {
      setBusy(false);
    }
  }

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
          <h1 style={{ fontSize: 21, fontWeight: 600, letterSpacing: '-0.02em' }}>Choose a new password</h1>
          <p style={{ fontSize: 13.5, color: 'var(--text-2)', marginTop: 4 }}>
            Enter it twice and you're back in.
          </p>
        </div>

        <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
          <Field label="New password" hint="At least 8 characters.">
            <Input
              type="password" required autoComplete="new-password" value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label="Confirm password">
            <Input
              type="password" required autoComplete="new-password" value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>

          {error && (
            <div style={{
              fontSize: 12.5, color: 'var(--danger)', background: 'var(--danger-bg)',
              padding: '8px 11px', borderRadius: 'var(--radius)',
            }}>
              {error}
            </div>
          )}

          <Button type="submit" variant="solid" size="lg" loading={busy} style={{ width: '100%' }}>
            Set password and continue
          </Button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 18, fontSize: 12.5, color: 'var(--text-2)' }}>
          <button onClick={onCancel}>Back to sign in</button>
        </div>
      </div>
    </div>
  );
}
