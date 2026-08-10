import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Me, Membership, Role } from '../types';
import { getMe, getOverview, getSupabase, setActiveTenant } from '../lib/api';
import { useVisiblePolling } from '../hooks';

interface Counts { unread: number; paymentClaims: number }

interface SessionValue {
  user: Me['user'];
  role: Role;
  tenant: Me['tenant'];
  memberships: Membership[];
  counts: Counts;
  /** Currency for this tenant; never assumed, always from the tenant record. */
  currency: string | null;
  canWrite: boolean;
  isAdmin: boolean;
  refresh: () => Promise<void>;
  refreshCounts: () => void;
  switchTenant: (tenantId: string) => void;
  signOut: () => Promise<void>;
}

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

  const refreshCounts = useCallback(() => {
    getOverview()
      .then((o) => setCounts({
        unread: o.stats.unread_conversations ?? 0,
        paymentClaims: o.stats.payment_claims ?? 0,
      }))
      .catch(() => { /* badge counts are non-critical; stay quiet */ });
  }, []);

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
    currency: me.tenant?.currency ?? null,
    canWrite: me.role !== 'viewer',
    isAdmin: me.role === 'owner' || me.role === 'admin',
    refresh: onReload,
    refreshCounts,
    switchTenant,
    signOut: onSignOut,
  }), [me, counts, onReload, onSignOut, refreshCounts, switchTenant]);

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
