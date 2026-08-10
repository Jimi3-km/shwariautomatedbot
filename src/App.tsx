import React, { useCallback, useEffect, useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from './app/routes';
import { SessionProvider, signOutOfSupabase } from './app/SessionContext';
import { AuthScreen } from './pages/AuthScreen';
import { CreateBusinessScreen } from './pages/CreateBusinessScreen';
import { ToastProvider, LoadingState, ErrorState } from './components/ui';
import { ApiError, getMe, getSupabase, initSupabase, setAuthFailureHandler } from './lib/api';
import type { Me } from './types';

type Status = 'booting' | 'signed-out' | 'no-tenant' | 'ready' | 'error';

export default function App() {
  const [status, setStatus] = useState<Status>('booting');
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSession = useCallback(async () => {
    try {
      setMe(await getMe());
      setStatus('ready');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NO_TENANT') setStatus('no-tenant');
      else if (err instanceof ApiError && err.isAuthError) setStatus('signed-out');
      else {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
        setStatus('error');
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Any 401 from anywhere in the app returns the user to sign-in rather
    // than leaving a half-authenticated screen on display.
    setAuthFailureHandler(() => {
      if (!cancelled) { setMe(null); setStatus('signed-out'); }
    });

    (async () => {
      try {
        const sb = await initSupabase();
        const { data } = await sb.auth.getSession();
        if (cancelled) return;
        if (!data.session) setStatus('signed-out');
        else await loadSession();

        sb.auth.onAuthStateChange((_event, session) => {
          if (cancelled) return;
          if (!session) { setMe(null); setStatus('signed-out'); }
        });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not start the application.');
        setStatus('error');
      }
    })();

    return () => { cancelled = true; };
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
    content = <AuthScreen onSignedIn={loadSession} />;
  } else if (status === 'no-tenant') {
    content = <CreateBusinessScreen onCreated={loadSession} onSignOut={signOut} />;
  } else if (me) {
    content = (
      <SessionProvider me={me} onReload={loadSession} onSignOut={signOut}>
        <RouterProvider router={router} />
      </SessionProvider>
    );
  }

  return <ToastProvider>{content}</ToastProvider>;
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
