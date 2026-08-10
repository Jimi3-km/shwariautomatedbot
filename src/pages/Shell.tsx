import React, { useEffect, useState } from 'react';
import {
  LayoutDashboard, MessagesSquare, Users, Package, Bot, Radio,
  CreditCard, ShoppingCart, Settings, LogOut,
} from 'lucide-react';
import type { Session } from '../App';
import { Overview } from './Overview';
import { Conversations } from './Conversations';
import { Leads } from './Leads';
import { Products } from './Products';
import { AgentSettings } from './AgentSettings';
import { Channels } from './Channels';
import { Payments } from './Payments';
import { Orders } from './Orders';
import { BusinessSettings } from './BusinessSettings';

const NAV = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'conversations', label: 'Conversations', icon: MessagesSquare },
  { id: 'leads', label: 'Leads', icon: Users },
  { id: 'products', label: 'Products', icon: Package },
  { id: 'agent', label: 'AI Agent', icon: Bot },
  { id: 'channels', label: 'Channels', icon: Radio },
  { id: 'payments', label: 'Payments', icon: CreditCard },
  { id: 'orders', label: 'Orders', icon: ShoppingCart },
  { id: 'settings', label: 'Business', icon: Settings },
] as const;

type TabId = (typeof NAV)[number]['id'];

function currentTab(): TabId {
  const h = window.location.hash.replace('#/', '');
  return (NAV.find((n) => n.id === h)?.id ?? 'overview') as TabId;
}

export function Shell({
  session, onSignOut, onReloadSession,
}: { session: Session; onSignOut: () => void; onReloadSession: () => void }) {
  const [tab, setTab] = useState<TabId>(currentTab);

  useEffect(() => {
    const onHash = () => setTab(currentTab());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  function go(id: TabId) {
    window.location.hash = `#/${id}`;
    setTab(id);
  }

  const canWrite = session.role !== 'viewer';
  const isAdmin = session.role === 'owner' || session.role === 'admin';
  const currency = session.tenant?.currency ?? 'KES';

  return (
    <div className="min-h-screen flex" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      <aside
        className="w-56 shrink-0 flex flex-col border-r"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="px-4 py-5 border-b" style={{ borderColor: 'var(--border)' }}>
          {/* Business name always comes from the tenant record, never a constant. */}
          <div className="text-sm font-semibold truncate">{session.tenant?.business_name ?? 'Business'}</div>
          <div className="text-xs mt-0.5 capitalize" style={{ color: 'var(--text-2)' }}>{session.role}</div>
        </div>

        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id} onClick={() => go(id)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-colors"
              style={{
                background: tab === id ? 'var(--surface-2)' : 'transparent',
                color: tab === id ? 'var(--text)' : 'var(--text-2)',
              }}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>

        <div className="p-2 border-t" style={{ borderColor: 'var(--border)' }}>
          <div className="px-3 py-1.5 text-xs truncate" style={{ color: 'var(--text-3)' }}>{session.user.email}</div>
          <button
            onClick={onSignOut}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm"
            style={{ color: 'var(--text-2)' }}
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto h-screen">
        {tab === 'overview' && <Overview currency={currency} onNavigate={go} />}
        {tab === 'conversations' && <Conversations canWrite={canWrite} />}
        {tab === 'leads' && <Leads canWrite={canWrite} currency={currency} />}
        {tab === 'products' && <Products canWrite={canWrite} currency={currency} />}
        {tab === 'agent' && <AgentSettings canWrite={canWrite} />}
        {tab === 'channels' && <Channels isAdmin={isAdmin} />}
        {tab === 'payments' && <Payments canWrite={canWrite} currency={currency} />}
        {tab === 'orders' && <Orders canWrite={canWrite} currency={currency} />}
        {tab === 'settings' && <BusinessSettings isAdmin={isAdmin} onSaved={onReloadSession} />}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared primitives used by every page.
// ---------------------------------------------------------------------------

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between px-6 py-5 border-b" style={{ borderColor: 'var(--border)' }}>
      <div>
        <h1 className="text-lg font-semibold">{title}</h1>
        {subtitle && <p className="text-sm mt-0.5" style={{ color: 'var(--text-2)' }}>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl p-4 ${className}`}
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      {children}
    </div>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info' }) {
  const tones = {
    neutral: { bg: '#1f1f1f', fg: '#999' },
    good: { bg: '#064e3b', fg: '#6ee7b7' },
    warn: { bg: '#78350f', fg: '#fcd34d' },
    bad: { bg: '#7f1d1d', fg: '#fca5a5' },
    info: { bg: '#1e3a8a', fg: '#93c5fd' },
  }[tone];
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-xs whitespace-nowrap"
      style={{ background: tones.bg, color: tones.fg }}
    >
      {children}
    </span>
  );
}

export function Empty({ message }: { message: string }) {
  return <div className="py-16 text-center text-sm" style={{ color: 'var(--text-3)' }}>{message}</div>;
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="mx-6 my-3 px-3 py-2 rounded-lg text-sm" style={{ background: '#3f1d1d', color: '#fca5a5' }}>{error}</div>;
}

export const inputStyle: React.CSSProperties = {
  background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)',
};
