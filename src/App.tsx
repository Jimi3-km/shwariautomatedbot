import React, { useCallback, useEffect, useState } from 'react';
import { initSupabase, getSupabase, api, ApiError } from './lib/api';
import { AuthScreen } from './pages/AuthScreen';
import { CreateBusinessScreen } from './pages/CreateBusinessScreen';
import { Shell } from './pages/Shell';

export interface Session {
  user: { id: string; email: string | null };
  role: 'owner' | 'admin' | 'member' | 'viewer';
  tenant: { id: string; business_name: string; currency: string; slug: string } | null;
  memberships: Array<{ tenant_id: string; role: string; tenants?: { business_name: string } }>;
}

type Status = 'booting' | 'signed-out' | 'no-tenant' | 'ready' | 'error';

export default function App() {
  const [status, setStatus] = useState<Status>('booting');
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSession = useCallback(async () => {
    try {
      const me = await api<Session>('/me');
      setSession(me);
      setStatus('ready');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'NO_TENANT') {
        setStatus('no-tenant');
      } else if (e instanceof ApiError && e.status === 401) {
        setStatus('signed-out');
      } else {
        setError(e instanceof Error ? e.message : 'Something went wrong');
        setStatus('error');
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sb = await initSupabase();
        const { data } = await sb.auth.getSession();
        if (cancelled) return;
        if (!data.session) {
          setStatus('signed-out');
        } else {
          await loadSession();
        }
        sb.auth.onAuthStateChange((_event, s) => {
          if (!s) {
            setSession(null);
            setStatus('signed-out');
          }
        });
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not start');
          setStatus('error');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [loadSession]);

  const signOut = useCallback(async () => {
    await getSupabase().auth.signOut();
    setSession(null);
    setStatus('signed-out');
  }, []);

  if (status === 'booting') {
    return <CenterMessage title="Loading" body="Starting the dashboard…" />;
  }
  if (status === 'error') {
    return <CenterMessage title="Cannot start" body={error ?? 'Unknown error'} tone="error" />;
  }
  if (status === 'signed-out') {
    return <AuthScreen onSignedIn={loadSession} />;
  }
  if (status === 'no-tenant') {
    return <CreateBusinessScreen onCreated={loadSession} onSignOut={signOut} />;
  }
  return <Shell session={session!} onSignOut={signOut} onReloadSession={loadSession} />;
}

function CenterMessage({ title, body, tone }: { title: string; body: string; tone?: 'error' }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--bg)' }}>
      <div className="text-center max-w-md">
        <h1 className="text-xl font-semibold mb-2" style={{ color: tone === 'error' ? '#f87171' : 'var(--text)' }}>
          {title}
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-2)' }}>{body}</p>
      </div>
    </div>
  );
}
