import { NotificationsBell } from '../components/NotificationsBell';
import React, { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Inbox as InboxIcon, Users, Package, ShoppingCart, CreditCard,
  BarChart3, Bot, Plug, Settings as SettingsIcon, LogOut, Menu, Search, Bell, ChevronDown, Check,
  Sparkles, CalendarDays, LifeBuoy, Wrench, ShieldCheck, SlidersHorizontal, Megaphone,
} from 'lucide-react';
import { Avatar, Drawer, Button } from '../components/ui';
import { useIsMobile } from '../hooks';
import { useSession } from '../app/SessionContext';

interface NavEntry {
  to: string;
  label: string;
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  end?: boolean;
  badge?: 'unread' | 'claims';
  /** Shown only to owners and admins: the server rejects everyone else. */
  adminOnly?: boolean;
}

const NAV: NavEntry[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/shwari', label: 'Shwari', icon: Sparkles, adminOnly: true },
  { to: '/inbox', label: 'Inbox', icon: InboxIcon, badge: 'unread' },
  { to: '/leads', label: 'Leads', icon: Users },
  { to: '/products', label: 'Products', icon: Package },
  { to: '/services', label: 'Services', icon: Wrench },
  { to: '/marketing', label: 'Marketing', icon: Megaphone },
  { to: '/orders', label: 'Orders', icon: ShoppingCart },
  { to: '/appointments', label: 'Appointments', icon: CalendarDays },
  { to: '/support', label: 'Support', icon: LifeBuoy },
  { to: '/payments', label: 'Payments', icon: CreditCard, badge: 'claims' },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/agents', label: 'AI team', icon: Bot },
  { to: '/agent', label: 'AI agent settings', icon: SlidersHorizontal, adminOnly: true },
  { to: '/integrations', label: 'Integrations', icon: Plug },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

export function AppShell() {
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  // Close the mobile drawer when navigation happens, rather than on any click
  // inside it: a blanket click handler also swallowed the business switcher.
  useEffect(() => { setDrawerOpen(false); }, [location.pathname, location.search]);

  return (
    <div className="app-shell" style={{ display: 'flex', background: 'var(--bg)' }}>
      {!isMobile && (
        <aside className="sidebar" style={{ width: 'var(--sidebar-w)', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
          <SidebarContent />
        </aside>
      )}

      {isMobile && (
        <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <SidebarContent />
          </div>
        </Drawer>
      )}

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <TopBar onMenu={() => setDrawerOpen(true)} showMenu={isMobile} />
        {/* Pages with their own scrolling region fill this exactly; a page
            without one scrolls here instead of being cut off at the fold. */}
        <main className="app-main" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <Outlet />
        </main>
        {isMobile && <BottomNav onMore={() => setDrawerOpen(true)} />}
      </div>
    </div>
  );
}

/**
 * The four places a phone user goes most, one thumb-reach away, plus the full
 * menu. The drawer still holds everything; this saves the two taps it costs.
 */
function BottomNav({ onMore }: { onMore: () => void }) {
  const { counts, isAdmin } = useSession();
  const items: Array<{ to: string; label: string; icon: NavEntry['icon']; end?: boolean; count?: number }> = [
    { to: '/', label: 'Home', icon: LayoutDashboard, end: true },
    { to: '/inbox', label: 'Inbox', icon: InboxIcon, count: counts.unread },
    isAdmin
      ? { to: '/shwari', label: 'Shwari', icon: Sparkles }
      : { to: '/leads', label: 'Leads', icon: Users },
    { to: '/orders', label: 'Orders', icon: ShoppingCart },
  ];
  return (
    <nav className="bottom-nav" aria-label="Main">
      {items.map(({ to, label, icon: Icon, end, count }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <Icon size={19} />
            {!!count && count > 0 && <span className="bottom-nav-badge">{count > 9 ? '9+' : count}</span>}
          </span>
          <span>{label}</span>
        </NavLink>
      ))}
      <button type="button" className="bottom-nav-item" onClick={onMore} aria-label="Open the full menu">
        <Menu size={19} />
        <span>More</span>
      </button>
    </nav>
  );
}

function SidebarContent() {
  const { tenant, counts, isAdmin } = useSession();

  return (
    <>
      <div style={{ padding: '16px 14px 12px' }}>
        <TenantSwitcher />
      </div>

      <nav className="scroll-y" style={{ flex: 1, padding: '0 8px 8px' }}>
        {NAV.filter((n) => !n.adminOnly || isAdmin).map(({ to, label, icon: Icon, end, badge }) => {
          const count = badge === 'unread' ? counts.unread : badge === 'claims' ? counts.paymentClaims : 0;
          return (
            <NavLink
              key={to} to={to} end={end}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}
            >
              <Icon size={16} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, textAlign: 'left' }}>{label}</span>
              {count > 0 && (
                <span style={{
                  minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9,
                  background: 'var(--accent)', color: '#fff', fontSize: 11,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600,
                }}>
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </NavLink>
          );
        })}
        {isAdmin && (
          <NavLink
            to="/admin/agent-qa"
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', marginTop: 4 }}
          >
            <ShieldCheck size={16} style={{ flexShrink: 0, color: 'var(--accent)' }} />
            <span style={{ flex: 1, textAlign: 'left' }}>Agent QA</span>
          </NavLink>
        )}
      </nav>

      <div style={{ padding: 8, borderTop: '1px solid var(--border)' }}>
        <UserMenu />
      </div>
      {tenant && (
        <div style={{ padding: '0 14px 12px', fontSize: 10.5, color: 'var(--text-4)' }}>
          AI Sales Platform
        </div>
      )}
    </>
  );
}

/**
 * Switches between the businesses this user belongs to. Tenant IDs are never
 * shown; the server still verifies membership on every request, so selecting
 * here cannot grant access to anything.
 */
function TenantSwitcher() {
  const { tenant, memberships, switchTenant } = useSession();
  const [open, setOpen] = useState(false);
  const multiple = memberships.length > 1;
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close on a click anywhere else, and on Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Arrow keys move between businesses once the list is open.
  function onListKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'));
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'Home' ? 0
      : e.key === 'End' ? items.length - 1
      : e.key === 'ArrowDown' ? (i + 1) % items.length
      : (i - 1 + items.length) % items.length;
    items[next].focus();
  }

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => multiple && setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (multiple && e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); }
        }}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '7px 8px',
          borderRadius: 'var(--radius)', background: 'var(--surface-2)', cursor: multiple ? 'pointer' : 'default',
        }}
        aria-haspopup={multiple ? 'listbox' : undefined}
        aria-expanded={multiple ? open : undefined}
        aria-label={multiple ? `Switch business. Current: ${tenant?.business_name ?? 'Business'}` : undefined}
      >
        <Avatar name={tenant?.business_name} seed={tenant?.slug} size={26} />
        <span style={{
          flex: 1, minWidth: 0, textAlign: 'left', fontSize: 13, fontWeight: 600,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {tenant?.business_name ?? 'Business'}
        </span>
        {multiple && <ChevronDown size={14} style={{ color: 'var(--text-3)', flexShrink: 0 }} />}
      </button>

      {open && multiple && (
        <div role="listbox" aria-label="Your businesses" onKeyDown={onListKey} style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 20,
          background: 'var(--surface-2)', border: '1px solid var(--border-2)',
          borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-md)', padding: 4,
        }}>
          {memberships.map((m, i) => (
            <button
              key={m.tenant_id} type="button" role="option" aria-selected={m.tenant_id === tenant?.id}
              autoFocus={m.tenant_id === tenant?.id || (i === 0 && !memberships.some((x) => x.tenant_id === tenant?.id))}
              onClick={() => {
                setOpen(false);
                if (m.tenant_id !== tenant?.id) switchTenant(m.tenant_id);
              }}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px',
                borderRadius: 'var(--radius-sm)', fontSize: 13, textAlign: 'left',
              }}
            >
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {m.tenants?.business_name ?? 'Business'}
              </span>
              {m.tenant_id === tenant?.id && <Check size={13} style={{ color: 'var(--success)' }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { user, role, signOut } = useSession();
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 8px' }}>
        <Avatar name={user.email ?? '?'} seed={user.id} size={26} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user.email}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'capitalize' }}>{role}</div>
        </div>
      </div>
      <button
        onClick={signOut}
        className="nav-item"
        style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}
      >
        <LogOut size={16} /> Sign out
      </button>
    </div>
  );
}

function TopBar({ onMenu, showMenu }: { onMenu: () => void; showMenu: boolean }) {
  const navigate = useNavigate();
  const { counts } = useSession();
  const [query, setQuery] = useState('');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    // Global search resolves to the inbox, which searches customers and messages.
    navigate(`/inbox?search=${encodeURIComponent(q)}`);
    setQuery('');
  }

  return (
    <header style={{
      height: 'var(--topbar-h)', flexShrink: 0, display: 'flex', alignItems: 'center',
      gap: 10, padding: '0 14px', borderBottom: '1px solid var(--border)', background: 'var(--surface)',
    }}>
      {showMenu && (
        <button onClick={onMenu} aria-label="Open navigation" style={{ color: 'var(--text-2)' }}>
          <Menu size={19} />
        </button>
      )}

      <form onSubmit={submit} style={{ flex: 1, maxWidth: 400, position: 'relative' }}>
        <Search size={14} style={{
          position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)',
        }} />
        <input
          value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search conversations…"
          className="field" style={{ paddingLeft: 30, height: 34 }}
          aria-label="Search conversations"
        />
      </form>

      <div style={{ flex: 1 }} />

      <NotificationsBell />
    </header>
  );
}
