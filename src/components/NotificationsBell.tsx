import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CreditCard, LifeBuoy, MessageSquare, ShoppingCart, BadgeCheck, Megaphone, X } from 'lucide-react';
import { getNotifications, markNotificationsRead, type AppNotification } from '../lib/api';
import { useVisiblePolling } from '../hooks';
import { useSession } from '../app/SessionContext';
import { showDesktopAlert } from '../lib/desktopAlerts';

/**
 * The bell: a dropdown of what has happened, rather than a link to one page.
 *
 * New orders, payments waiting to be checked, payments verified and
 * conversations handed to a person arrive here. Opening it marks them read;
 * choosing one goes to the place it is about.
 */
const ICONS: Record<AppNotification['kind'], React.ComponentType<{ size?: number; style?: React.CSSProperties }>> = {
  new_order: ShoppingCart,
  payment_claim: CreditCard,
  payment_verified: BadgeCheck,
  needs_human: LifeBuoy,
  posts_to_approve: Megaphone,
  post_published: Megaphone,
  post_failed: Megaphone,
};

const TONE: Record<AppNotification['kind'], string> = {
  new_order: 'var(--info)',
  payment_claim: 'var(--warning)',
  payment_verified: 'var(--success)',
  needs_human: 'var(--danger)',
  posts_to_approve: 'var(--warning)',
  post_published: 'var(--success)',
  post_failed: 'var(--danger)',
};

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function NotificationsBell() {
  const navigate = useNavigate();
  const { counts } = useSession();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Pop-ups: what has arrived since this tab last looked. The first load
  // only records what is already there, so opening the dashboard does not
  // replay old news.
  const [popups, setPopups] = useState<AppNotification[]>([]);
  const seen = useRef<Set<string> | null>(null);
  const navRef = useRef(navigate);
  navRef.current = navigate;

  const dismiss = useCallback((id: string) => setPopups((p) => p.filter((n) => n.id !== id)), []);

  const load = useCallback(() => {
    getNotifications()
      .then((r) => {
        setItems(r.notifications); setUnread(r.unread); setLoaded(true);
        if (seen.current === null) {
          seen.current = new Set(r.notifications.map((n) => n.id));
          return;
        }
        const fresh = r.notifications.filter((n) => !n.read_at && !seen.current!.has(n.id));
        for (const n of r.notifications) seen.current.add(n.id);
        if (!fresh.length) return;
        setPopups((p) => [...fresh.reverse(), ...p].slice(0, 4));
        for (const n of fresh) {
          setTimeout(() => dismiss(n.id), 12_000);
          if (document.hidden) {
            showDesktopAlert(n.title, n.body, () => { if (n.link) navRef.current(n.link); });
          }
        }
      })
      .catch(() => setLoaded(true));
  }, [dismiss]);

  useEffect(() => { load(); }, [load]);
  // Checked often, and in the background too: a payment waiting to be
  // verified should not sit unseen for half a minute.
  useEffect(() => {
    const timer = setInterval(load, 15_000);
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [load]);

  // Close on a click anywhere else, and on Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      // Seen is read. The dots stay for this viewing so it is clear what is new.
      markNotificationsRead().then(() => setUnread(0)).catch(() => {});
    }
  }

  function go(n: AppNotification) {
    setOpen(false);
    if (n.link) navigate(n.link);
  }

  const badge = unread + (counts.unread > 0 && unread === 0 ? 0 : 0);
  const showDot = badge > 0 || counts.unread > 0;

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      {popups.length > 0 && (
        <div className="notice-stack" role="region" aria-label="New notifications" aria-live="polite">
          {popups.map((n) => {
            const Icon = ICONS[n.kind] ?? Bell;
            return (
              <div key={n.id} className="notice-card">
                <button
                  type="button" className="notice-main"
                  onClick={() => { dismiss(n.id); if (n.link) navigate(n.link); }}
                >
                  <span className="notification-icon" style={{ color: TONE[n.kind] ?? 'var(--text-2)' }}>
                    <Icon size={16} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                    <span className="notice-title">{n.title}</span>
                    {n.body && <span className="notice-body">{n.body}</span>}
                    {n.link && <span className="notice-action">View</span>}
                  </span>
                </button>
                <button type="button" className="notice-close" aria-label="Dismiss" onClick={() => dismiss(n.id)}>
                  <X size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={unread > 0 ? `${unread} new notifications` : 'Notifications'}
        className="btn-icon"
        style={{ position: 'relative', color: 'var(--text-2)' }}
      >
        <Bell size={17} />
        {unread > 0 ? (
          <span className="bell-count">{unread > 9 ? '9+' : unread}</span>
        ) : showDot ? (
          <span className="bell-dot" />
        ) : null}
      </button>

      {open && (
        <div className="popover notifications-panel" role="dialog" aria-label="Notifications">
          <div className="popover-head">
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>Notifications</span>
            {counts.unread > 0 && (
              <button type="button" className="link-btn" onClick={() => { setOpen(false); navigate('/inbox?unread=true'); }}>
                <MessageSquare size={12} /> {counts.unread} unread chat{counts.unread === 1 ? '' : 's'}
              </button>
            )}
          </div>

          <div className="scroll-y notifications-list">
            {!loaded && <div className="popover-empty">Loading…</div>}
            {loaded && items.length === 0 && (
              <div className="popover-empty">
                Nothing yet. New orders, payments to verify and conversations that need a person will show up here.
              </div>
            )}
            {items.map((n) => {
              const Icon = ICONS[n.kind] ?? Bell;
              return (
                <button key={n.id} type="button" className="notification-row" onClick={() => go(n)}>
                  <span className="notification-icon" style={{ color: TONE[n.kind] ?? 'var(--text-2)' }}>
                    <Icon size={15} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="notification-title">
                      {n.title}
                      {!n.read_at && <span className="notification-new" aria-label="new" />}
                    </span>
                    {n.body && <span className="notification-body">{n.body}</span>}
                    <span className="notification-time">{ago(n.created_at)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
