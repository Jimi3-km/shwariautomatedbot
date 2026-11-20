import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CreditCard, LifeBuoy, MessageSquare, ShoppingCart, BadgeCheck, Megaphone } from 'lucide-react';
import { getNotifications, markNotificationsRead, type AppNotification } from '../lib/api';
import { useVisiblePolling } from '../hooks';
import { useSession } from '../app/SessionContext';

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

  const load = useCallback(() => {
    getNotifications()
      .then((r) => { setItems(r.notifications); setUnread(r.unread); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, []);

  useEffect(() => { load(); }, [load]);
  useVisiblePolling(load, 30_000, true);

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
