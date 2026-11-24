import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, Check, Circle } from 'lucide-react';
import { getSupabase } from '../lib/api';
import { Button, Field, Input } from '../components/ui';
import { passwordProblem, passwordRules } from '../lib/password';

type Mode = 'login' | 'signup' | 'verify' | 'reset';

const COPY: Record<Mode, { title: string; subtitle: string; cta: string }> = {
  login: { title: 'Welcome back', subtitle: 'Sign in to your dashboard.', cta: 'Sign in' },
  signup: { title: 'Create your account', subtitle: 'Start handling customer conversations with AI.', cta: 'Create account' },
  verify: { title: 'Check your email', subtitle: 'Enter the 6-digit code we sent you.', cta: 'Confirm and continue' },
  reset: { title: 'Reset your password', subtitle: "We'll email you a link to set a new one.", cta: 'Send reset link' },
};

const CODE_LENGTH = 6;
// The sign-in service allows one code a minute per address.
const RESEND_WAIT_SECONDS = 60;

/** What the sign-in service says, in words a person can act on. */
function friendly(err: unknown): string {
  const raw = err instanceof Error ? err.message : '';
  if (/rate limit|too many|only request this after/i.test(raw)) return 'Too many attempts. Wait a minute and try again.';
  if (/expired|invalid.*(token|otp)|otp.*invalid/i.test(raw)) return 'That code is wrong or has expired. Check it, or send a new one.';
  if (/invalid login credentials/i.test(raw)) return 'That email and password do not match an account.';
  if (/already registered|already been registered/i.test(raw)) return 'An account with this email already exists. Sign in instead.';
  if (/password/i.test(raw) && /(weak|should|least|contain)/i.test(raw)) {
    return 'That password is not strong enough. Use at least 10 characters with a capital letter, a lower-case letter and a number.';
  }
  return raw || 'Something went wrong. Please try again.';
}

export function AuthScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Seconds until another code may be asked for. The service refuses sooner.
  const [wait, setWait] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  // A sign-in handed back by an older Instagram sign-in link still completes;
  // the button itself is gone. Accounts are created with an email and password.
  useEffect(() => {
    const params = readAuthCallbackParams();
    if (params.get('auth_error')) {
      setError('That sign-in did not complete. Sign in with your email and password.');
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }
    const token = params.get('ig_token');
    if (!token) return;
    window.history.replaceState({}, '', window.location.pathname);
    setBusy(true);
    getSupabase()
      .auth.verifyOtp({ type: 'magiclink', token_hash: token })
      .then(({ error }) => {
        if (error) throw error;
        onSignedIn();
      })
      .catch(() => setError('Could not complete sign-in. Sign in with your email and password.'))
      .finally(() => setBusy(false));
  }, [onSignedIn]);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  useEffect(() => {
    if (mode === 'verify') codeRef.current?.focus();
  }, [mode]);

  function switchMode(next: Mode) {
    setMode(next); setError(null); setNotice(null); setCode('');
    if (next !== 'verify') setConfirm('');
  }

  function startVerifying(message: string) {
    setMode('verify'); setError(null); setCode(''); setNotice(message); setWait(RESEND_WAIT_SECONDS);
  }

  async function resendCode() {
    if (wait > 0 || !email) return;
    setBusy(true); setError(null);
    try {
      const { error } = await getSupabase().auth.resend({ type: 'signup', email });
      if (error) throw error;
      setNotice(`We sent a new code to ${email}. Check your spam folder too.`);
      setWait(RESEND_WAIT_SECONDS);
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setNotice(null);
    const sb = getSupabase();
    const address = email.trim().toLowerCase();

    try {
      if (mode === 'login') {
        const { error } = await sb.auth.signInWithPassword({ email: address, password });
        if (error) {
          // The address was never confirmed: send a fresh code and ask for it.
          if (/not confirmed/i.test(error.message)) {
            await sb.auth.resend({ type: 'signup', email: address }).catch(() => undefined);
            setEmail(address);
            startVerifying(`Confirm your email to finish. We sent a ${CODE_LENGTH}-digit code to ${address}.`);
            return;
          }
          throw error;
        }
        onSignedIn();
      } else if (mode === 'signup') {
        const problem = passwordProblem(password, address);
        if (problem) throw new Error(problem);
        if (password !== confirm) throw new Error('Those two passwords do not match.');

        const { data, error } = await sb.auth.signUp({
          email: address,
          password,
          options: { emailRedirectTo: `${window.location.origin}/` },
        });
        if (error) throw error;
        // For an address that already has an account the service answers as if
        // it worked, with an empty list of sign-in methods, and sends nothing.
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          throw new Error('An account with this email already exists. Sign in instead.');
        }
        if (data.session) {
          onSignedIn();
        } else {
          setEmail(address);
          startVerifying(`We sent a ${CODE_LENGTH}-digit code to ${address}.`);
        }
      } else if (mode === 'verify') {
        if (code.length !== CODE_LENGTH) throw new Error(`Enter the ${CODE_LENGTH}-digit code from the email.`);
        const { data, error } = await sb.auth.verifyOtp({ email: address, token: code, type: 'signup' });
        if (error) throw error;
        if (!data.session) {
          // Confirmed, but no session came back: sign in with the password.
          const again = await sb.auth.signInWithPassword({ email: address, password });
          if (again.error) {
            switchMode('login');
            setNotice('Your email is confirmed. Sign in to continue.');
            return;
          }
        }
        // A new account has no business yet, so this lands on the setup steps.
        onSignedIn();
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(address, {
          redirectTo: `${window.location.origin}/`,
        });
        if (error) throw error;
        // Deliberately not confirming whether the address exists.
        setNotice('If that email has an account, a reset link is on its way.');
      }
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  const copy = COPY[mode];
  const rules = passwordRules(password, email);

  return (
    <div style={{
      height: '100%', display: 'flex',
      background: 'var(--bg)', padding: 20, overflowY: 'auto',
    }}>
      <div style={{ width: '100%', maxWidth: 380, margin: 'auto' }}>
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
          {mode === 'verify' ? (
            <Field label="Confirmation code" hint={`Sent to ${email}. It expires in 60 minutes.`}>
              <input
                ref={codeRef}
                className="field"
                inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*"
                maxLength={CODE_LENGTH} required value={code} placeholder="000000"
                aria-label="Confirmation code"
                style={{ fontSize: 22, letterSpacing: '0.4em', textAlign: 'center', height: 50 }}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))}
              />
            </Field>
          ) : (
            <Field label="Email">
              <Input
                type="email" required autoComplete="email" value={email}
                placeholder="you@yourbusiness.com"
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
          )}

          {(mode === 'login' || mode === 'signup') && (
            <Field label="Password">
              <Input
                type="password" required value={password}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
          )}

          {mode === 'signup' && (
            <>
              <ul style={{ listStyle: 'none', display: 'grid', gap: 4, margin: '-2px 0 2px' }}>
                {rules.map((r) => (
                  <li key={r.id} style={{
                    display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5,
                    color: r.ok ? 'var(--success)' : 'var(--text-3)',
                  }}>
                    {r.ok ? <Check size={13} /> : <Circle size={13} />}
                    {r.label}
                  </li>
                ))}
              </ul>
              <Field
                label="Confirm password"
                error={confirm && confirm !== password ? 'These do not match yet.' : undefined}
              >
                <Input
                  type="password" required value={confirm} autoComplete="new-password"
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </Field>
            </>
          )}

          {error && (
            <div role="alert" style={{
              fontSize: 12.5, color: 'var(--danger)', background: 'var(--danger-bg)',
              padding: '8px 11px', borderRadius: 'var(--radius)',
            }}>
              {error}
            </div>
          )}
          {notice && (
            <div role="status" style={{
              fontSize: 12.5, color: 'var(--success)', background: 'var(--success-bg)',
              padding: '8px 11px', borderRadius: 'var(--radius)',
            }}>
              {notice}
            </div>
          )}

          <Button type="submit" variant="solid" size="lg" loading={busy} style={{ width: '100%' }}>
            {copy.cta}
          </Button>

          {mode === 'verify' && (
            <button
              type="button"
              onClick={resendCode}
              disabled={busy || wait > 0}
              style={{
                fontSize: 12.5, background: 'none', border: 0, padding: 6,
                color: wait > 0 ? 'var(--text-3)' : 'var(--accent)',
                cursor: wait > 0 ? 'default' : 'pointer',
              }}
            >
              {wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}
            </button>
          )}
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
          ) : mode === 'verify' ? (
            <button onClick={() => switchMode('signup')}>Use a different email</button>
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
    const problem = passwordProblem(password);
    if (problem) { setError(problem); return; }
    if (password !== confirm) { setError('Those two passwords do not match.'); return; }

    setBusy(true); setError(null);
    try {
      const { error } = await getSupabase().auth.updateUser({ password });
      if (error) throw error;
      // Drop the recovery token from the URL so a refresh does not reprocess it.
      window.history.replaceState({}, '', window.location.pathname);
      onDone();
    } catch (err) {
      setError(friendly(err));
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
          <Field label="New password" hint="At least 10 characters, with a capital letter, a lower-case letter and a number.">
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

/**
 * Parameters the Instagram OAuth callback hands back. They may arrive in the
 * query string or in the URL fragment (the fragment keeps the single-use token
 * out of server logs and Referer headers), so both are read.
 */
export function readAuthCallbackParams(): URLSearchParams {
  const merged = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  for (const key of ['ig_token', 'ig_email', 'auth_error']) {
    const v = hash.get(key);
    if (v && !merged.has(key)) merged.set(key, v);
  }
  return merged;
}

/** True when the page was opened by the OAuth callback and sign-in must finish. */
export function hasAuthCallback(): boolean {
  const p = readAuthCallbackParams();
  return p.has('ig_token') || p.has('auth_error');
}
