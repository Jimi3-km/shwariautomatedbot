import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from './app/routes';
import { SessionProvider, signOutOfSupabase } from './app/SessionContext';
import { SetNewPassword } from './pages/AuthScreen';
import { ToastProvider, LoadingState, ErrorState } from './components/ui';
import {
  ApiError, acceptInvitation, getActiveTenant, getMe, getPlatformMe, initSupabase, lookUpInvitation,
  setActiveTenant, setAuthFailureHandler,
} from './lib/api';

// Signed-in users never need the marketing page, and a finished workspace
// never needs the wizard, so neither is in the main bundle.
const LandingPage = lazy(() => import('./pages/LandingPage').then((m) => ({ default: m.LandingPage })));
const Onboarding = lazy(() => import('./pages/Onboarding').then((m) => ({ default: m.Onboarding })));
const Platform = lazy(() => import('./pages/Platform').then((m) => ({ default: m.Platform })));

/**
 * A staff invitation arrives as ?invite=<token>. It is taken out of the
 * address bar at once and remembered, because accepting it may be several
 * steps away: creating an account, confirming the email, signing in.
 */
const INVITE_KEY = 'shwari.pending_invite';
function captureInvite(): void {
  try {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('invite');
    if (!token) return;
    if (/^[0-9a-f]{64}$/.test(token)) localStorage.setItem(INVITE_KEY, token);
    params.delete('invite');
    const rest = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash);
  } catch { /* storage unavailable: the invitation link can be opened again */ }
}
function pendingInvite(): string | null {
  try { return localStorage.getItem(INVITE_KEY); } catch { return null; }
}
function clearInvite(): void {
  try { localStorage.removeItem(INVITE_KEY); } catch { /* nothing to clear */ }
}
captureInvite();
import type { Me } from './types';

type Status = 'booting' | 'signed-out' | 'recovery' | 'onboarding' | 'ready' | 'error';

/**
 * Did we arrive on a password-reset link?
 *
 * Supabase's reset email uses the implicit flow, so the recovery token comes in
 * the URL hash as `type=recovery`. Reading it synchronously matters:
 * supabase-js strips the hash while consuming the token, so by the time the
 * client is ready the marker is gone. Capture it before any of that runs.
 */
function arrivedForPasswordReset(): boolean {
  const hash = window.location.hash.replace(/^#/, '');
  return new URLSearchParams(hash).get('type') === 'recovery';
}

export default function App() {
  const [status, setStatus] = useState<Status>('booting');
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteNote, setInviteNote] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);

  // Say what the invitation is for before the person has signed in.
  useEffect(() => {
    const token = pendingInvite();
    if (!token) return;
    lookUpInvitation(token)
      .then((inv) => setInviteNote({
        tone: 'info',
        text: `You've been invited to join ${inv.business_name} as ${inv.role_label}. Sign in or create an account with ${inv.email} to accept.`,
      }))
      .catch(() => {
        clearInvite();
        setInviteNote({ tone: 'error', text: 'That invitation is no longer valid. Ask the owner to send a new one.' });
      });
  }, []);

  const loadSession = useCallback(async () => {
    try {
      // An invitation is accepted first, so the person lands in the business
      // they were invited to rather than in the wizard for a new one.
      const invite = pendingInvite();
      if (invite) {
        try {
          const joined = await acceptInvitation(invite);
          clearInvite();
          setActiveTenant(joined.tenant_id);
          setInviteNote(null);
        } catch (err) {
          const code = err instanceof ApiError ? err.code : undefined;
          // Waiting on an email confirmation keeps the invitation for later.
          if (code !== 'INVITE_EMAIL_UNVERIFIED') clearInvite();
          setInviteNote({
            tone: 'error',
            text: err instanceof Error ? err.message : 'That invitation could not be accepted.',
          });
        }
      }

      let next: Me;
      try {
        next = await getMe();
      } catch (err) {
        // A remembered business the user no longer belongs to (removed from
        // the team, or a different account on this browser) must not lock
        // them out: forget it and fall back to their default workspace.
        if (getActiveTenant() && err instanceof ApiError && !err.isAuthError) {
          setActiveTenant(null);
          next = await getMe();
        } else {
          throw err;
        }
      }
      const remembered = getActiveTenant();
      // A platform admin may have a business open that they are not a member of.
      if (remembered && !next.platform_admin && !next.memberships.some((m) => m.tenant_id === remembered)) {
        setActiveTenant(null);
        next = await getMe();
      }
      setMe(next);
      // A workspace that has not finished the wizard goes back into it — but
      // only for the people who can finish it. Completing setup is admin-only
      // on the server, so sending a member or viewer there would trap them.
      const canSetUp = !next.tenant || next.role === 'owner' || next.role === 'admin';
      setStatus(next.tenant?.onboarding_completed_at || !canSetUp || next.support_mode ? 'ready' : 'onboarding');
    } catch (err) {
      // A platform admin who belongs to no business gets the console alone.
      if (err instanceof ApiError && err.code === 'PLATFORM_NO_TENANT') {
        try {
          setActiveTenant(null);
          setMe(await getPlatformMe());
          setStatus('ready');
        } catch {
          setError('Something went wrong.');
          setStatus('error');
        }
      }
      // No workspace yet: the wizard's first step creates one.
      else if (err instanceof ApiError && err.code === 'NO_TENANT') setStatus('onboarding');
      else if (err instanceof ApiError && err.isAuthError) setStatus('signed-out');
      else {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
        setStatus('error');
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    // Captured before supabase-js processes and clears the URL hash.
    const recovering = arrivedForPasswordReset();

    // Any 401 from anywhere in the app returns the user to sign-in rather
    // than leaving a half-authenticated screen on display.
    setAuthFailureHandler(() => {
      if (!cancelled) { setMe(null); setStatus('signed-out'); }
    });

    (async () => {
      try {
        const sb = await initSupabase();

        // Register before reading the session so the recovery event is never
        // missed. A recovery session must land on "choose a new password",
        // never in the dashboard — it is only good for that one change.
        const { data: listener } = sb.auth.onAuthStateChange((event, session) => {
          if (cancelled) return;
          if (event === 'PASSWORD_RECOVERY') { setStatus('recovery'); return; }
          if (!session) { setMe(null); setStatus('signed-out'); }
        });
        // StrictMode runs this effect twice; without this the first listener
        // would live for the whole session.
        if (cancelled) listener.subscription.unsubscribe();
        else unsubscribe = () => listener.subscription.unsubscribe();

        const { data } = await sb.auth.getSession();
        if (cancelled) return;
        if (recovering) { setStatus('recovery'); return; }
        if (!data.session) setStatus('signed-out');
        else await loadSession();
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not start the application.');
        setStatus('error');
      }
    })();

    return () => { cancelled = true; unsubscribe?.(); };
  }, [loadSession]);

  const signOut = useCallback(async () => {
    await signOutOfSupabase();
    setMe(null);
    setStatus('signed-out');
  }, []);

  let content: React.ReactNode;
  if (status === 'booting') {
    content = <Centered><LoadingState label="Starting…" /></Centered>;
  } else if (status === 'error') {
    content = (
      <Centered>
        <ErrorState message={error ?? 'Unknown error'} onRetry={() => window.location.reload()} />
      </Centered>
    );
  } else if (status === 'signed-out') {
    content = <LandingPage onSignedIn={loadSession} />;
  } else if (status === 'recovery') {
    content = (
      <SetNewPassword
        onDone={loadSession}
        onCancel={async () => { await signOut(); }}
      />
    );
  } else if (status === 'onboarding') {
    content = <Onboarding onFinished={loadSession} onSignOut={signOut} />;
  } else if (me && !me.tenant) {
    // No business open: the platform console on its own.
    content = (
      <SessionProvider me={me} onReload={loadSession} onSignOut={signOut}>
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
            borderBottom: '1px solid var(--border)', fontSize: 12.5,
          }}>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {me.user.email} · Platform admin
            </span>
            <button type="button" className="btn btn-sm btn-subtle" onClick={signOut}>Sign out</button>
          </div>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <Platform />
          </div>
        </div>
      </SessionProvider>
    );
  } else if (me) {
    content = (
      <SessionProvider me={me} onReload={loadSession} onSignOut={signOut}>
        <RouterProvider router={router} />
      </SessionProvider>
    );
  }

  return (
    <ToastProvider>
      {inviteNote && (
        <div
          role="status"
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000,
            display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px',
            fontSize: 13, lineHeight: 1.5, color: 'var(--text)',
            background: inviteNote.tone === 'error' ? 'var(--danger-bg)' : 'var(--info-bg)',
            borderBottom: '1px solid var(--border)', backdropFilter: 'blur(8px)',
          }}
        >
          <span style={{ flex: 1, minWidth: 0 }}>{inviteNote.text}</span>
          <button type="button" className="btn btn-sm btn-subtle" onClick={() => setInviteNote(null)}>Dismiss</button>
        </div>
      )}
      <Suspense fallback={<Centered><LoadingState label="Loading…" /></Centered>}>
        {content}
      </Suspense>
    </ToastProvider>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      height: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: 'var(--bg)',
    }}>
      {children}
    </div>
  );
}
