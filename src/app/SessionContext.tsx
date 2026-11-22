import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Me, Membership, Role } from '../types';
import { getActivity, getMe, getOverview, getSupabase, setActiveTenant, type ActivityCounts } from '../lib/api';
import { useVisiblePolling } from '../hooks';

interface Counts { unread: number; paymentClaims: number }

/** Pages whose dot counts what has arrived since they were last opened. */
export type SeenPage = 'orders' | 'leads' | 'appointments' | 'support';
const SEEN_PAGES: SeenPage[] = ['orders', 'leads', 'appointments', 'support'];

const NO_ACTIVITY: ActivityCounts = {
  orders: 0, leads: 0, appointments: 0, support: 0, inbox: 0, payments: 0, marketing: 0, platform: 0,
};

/**
 * When this person last opened each page, kept in this browser per business.
 * A page never opened before counts from now, so a new member is not shown a
 * dot for the business's whole history.
 */
function seenKey(tenantId: string, page: SeenPage) { return `shwari.seen.${tenantId}.${page}`; }
function readSeen(tenantId: string): Record<SeenPage, string> {
  const out = {} as Record<SeenPage, string>;
  for (const page of SEEN_PAGES) {
    let at: string | null = null;
    try { at = localStorage.getItem(seenKey(tenantId, page)); } catch { /* storage unavailable */ }
    if (!at) {
      at = new Date().toISOString();
      try { localStorage.setItem(seenKey(tenantId, page), at); } catch { /* counts from now, this visit only */ }
    }
    out[page] = at;
  }
  return out;
}

interface SessionValue {
  user: Me['user'];
  role: Role;
  tenant: Me['tenant'];
  memberships: Membership[];
  counts: Counts;
  /** What is new on each page, for the numbered dots in the menu. */
  activity: ActivityCounts;
  /** Call when a page is opened: its dot clears. */
  markSeen: (page: SeenPage) => void;
  /** Currency for this tenant; never assumed, always from the tenant record. */
  currency: string | null;
  canWrite: boolean;
  /** Owner or manager: settings, agents, channels, catalogue. */
  isAdmin: boolean;
  /** The owner alone: staff and billing. */
  isOwner: boolean;
  /** Runs the platform. */
  isPlatformAdmin: boolean;
  /** A platform admin working inside a business they do not belong to. */
  supportMode: boolean;
  /** The role as the product words it. */
  roleLabel: string;
  refresh: () => Promise<void>;
  refreshCounts: () => void;
  switchTenant: (tenantId: string) => void;
  signOut: () => Promise<void>;
}

/** What the product calls each stored role. */
export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner', admin: 'Manager', member: 'Staff', viewer: 'Viewer',
};

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({
  me, onReload, onSignOut, children,
}: {
  me: Me;
  onReload: () => Promise<void>;
  onSignOut: () => Promise<void>;
  children: React.ReactNode;
}) {
  const [counts, setCounts] = useState<Counts>({ unread: 0, paymentClaims: 0 });
  const [activity, setActivity] = useState<ActivityCounts>(NO_ACTIVITY);
  const tenantId = me.tenant?.id ?? null;

  const refreshActivity = useCallback(() => {
    if (!tenantId) return;
    getActivity(readSeen(tenantId))
      .then(setActivity)
      .catch(() => { /* the dots are a convenience; stay quiet */ });
  }, [tenantId]);

  const markSeen = useCallback((page: SeenPage) => {
    if (!tenantId) return;
    try { localStorage.setItem(seenKey(tenantId, page), new Date().toISOString()); } catch { /* storage unavailable */ }
    setActivity((a) => (a[page] ? { ...a, [page]: 0 } : a));
  }, [tenantId]);

  useEffect(() => { refreshActivity(); }, [refreshActivity]);
  useVisiblePolling(refreshActivity, 45_000);

  const refreshCounts = useCallback(() => {
    // A platform admin with no business open has nothing to count.
    if (!me.tenant) return;
    getOverview()
      .then((o) => setCounts({
        unread: o.stats.unread_conversations ?? 0,
        paymentClaims: o.stats.payment_claims ?? 0,
      }))
      .catch(() => { /* badge counts are non-critical; stay quiet */ });
  }, [me.tenant]);

  useEffect(() => { refreshCounts(); }, [refreshCounts, me.tenant?.id]);
  // Refresh badges periodically, but only while the tab is visible.
  useVisiblePolling(refreshCounts, 60_000);

  const switchTenant = useCallback((tenantId: string) => {
    setActiveTenant(tenantId);
    // A full reload guarantees no page keeps data from the previous tenant.
    window.location.assign('/');
  }, []);

  const value = useMemo<SessionValue>(() => ({
    user: me.user,
    role: me.role,
    tenant: me.tenant,
    memberships: me.memberships,
    counts,
    activity,
    markSeen,
    currency: me.tenant?.currency ?? null,
    canWrite: me.role !== 'viewer',
    isAdmin: me.role === 'owner' || me.role === 'admin',
    isOwner: me.role === 'owner',
    isPlatformAdmin: Boolean(me.platform_admin),
    supportMode: Boolean(me.support_mode),
    roleLabel: me.support_mode ? 'Platform support' : ROLE_LABELS[me.role] ?? me.role,
    refresh: onReload,
    refreshCounts,
    switchTenant,
    signOut: onSignOut,
  }), [me, counts, activity, markSeen, onReload, onSignOut, refreshCounts, switchTenant]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}

/** Convenience for pages that only need the tenant currency. */
export function useCurrency(): string | null {
  return useSession().currency;
}

export async function signOutOfSupabase() {
  await getSupabase().auth.signOut();
  setActiveTenant(null);
}
