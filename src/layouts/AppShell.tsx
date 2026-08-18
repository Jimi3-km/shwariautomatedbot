import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Inbox as InboxIcon, Users, Package, ShoppingCart, CreditCard,
  BarChart3, Bot, Plug, Settings as SettingsIcon, LogOut, Menu, Search, Bell, ChevronDown, Check,
  Sparkles, CalendarDays, LifeBuoy,
} from 'lucide-react';
import { Avatar, Drawer, Button } from '../components/ui';
import { useIsMobile } from '../hooks';
import { useSession } from '../app/SessionContext';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/shwari', label: 'Shwari', icon: Sparkles },
  { to: '/inbox', label: 'Inbox', icon: InboxIcon, badge: 'unread' as const },
  { to: '/leads', label: 'Leads', icon: Users },
  { to: '/products', label: 'Products', icon: Package },
  { to: '/orders', label: 'Orders', icon: ShoppingCart },
  { to: '/appointments', label: 'Appointments', icon: CalendarDays },
  { to: '/support', label: 'Support', icon: LifeBuoy },
  { to: '/payments', label: 'Payments', icon: CreditCard, badge: 'claims' as const },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/agent', label: 'AI Agent', icon: Bot },
  { to: '/integrations', label: 'Integrations', icon: Plug },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

export function AppShell() {
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--bg)' }}>
      {!isMobile && (
        <aside className="sidebar" style={{ width: 'var(--sidebar-w)', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
          <SidebarContent />
        </aside>
      )}

      {isMobile && (
        <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
               onClick={() => setDrawerOpen(false)}>
            <SidebarContent />
          </div>
        </Drawer>
      )}

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <TopBar onMenu={() => setDrawerOpen(true)} showMenu={isMobile} />
        <main style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function SidebarContent() {
  const { tenant, counts } = useSession();

  return (
    <>
      <div style={{ padding: '16px 14px 12px' }}>
        <TenantSwitcher />
      </div>

      <nav className="scroll-y" style={{ flex: 1, padding: '0 8px 8px' }}>
        {NAV.map(({ to, label, icon: Icon, end, badge }) => {
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

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => multiple && setOpen((o) => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '7px 8px',
          borderRadius: 'var(--radius)', background: 'var(--surface-2)', cursor: multiple ? 'pointer' : 'default',
        }}
        aria-haspopup={multiple ? 'listbox' : undefined}
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
        <div role="listbox" style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 20,
          background: 'var(--surface-2)', border: '1px solid var(--border-2)',
          borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-md)', padding: 4,
        }}>
          {memberships.map((m) => (
            <button
              key={m.tenant_id} role="option" aria-selected={m.tenant_id === tenant?.id}
              onClick={() => { setOpen(false); switchTenant(m.tenant_id); }}
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

      <button
        onClick={() => navigate('/inbox?unread=true')}
        aria-label={`${counts.unread} unread conversations`}
        style={{ position: 'relative', color: 'var(--text-2)', padding: 6 }}
      >
        <Bell size={17} />
        {counts.unread > 0 && (
          <span style={{
            position: 'absolute', top: 2, right: 2, width: 7, height: 7,
            borderRadius: 999, background: 'var(--accent)',
          }} />
        )}
      </button>
    </header>
  );
}
