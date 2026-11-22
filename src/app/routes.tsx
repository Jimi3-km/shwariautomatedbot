import React, { Suspense, lazy } from 'react';
import { createBrowserRouter, Navigate, useRouteError } from 'react-router-dom';
import { AppShell } from '../layouts/AppShell';
import { ErrorState, LoadingState } from '../components/ui';

/**
 * Every page is its own chunk, fetched the first time it is visited, so the
 * initial download is the shell plus one screen rather than all of them.
 */
const Overview = lazyPage(() => import('../pages/Overview'), 'Overview');
const Shwari = lazyPage(() => import('../pages/Shwari'), 'Shwari');
const Appointments = lazyPage(() => import('../pages/Appointments'), 'Appointments');
const Tickets = lazyPage(() => import('../pages/Tickets'), 'Tickets');
const Agents = lazyPage(() => import('../pages/Agents'), 'Agents');
const Inbox = lazyPage(() => import('../pages/Inbox'), 'Inbox');
const Leads = lazyPage(() => import('../pages/Leads'), 'Leads');
const LeadDetail = lazyPage(() => import('../pages/LeadDetail'), 'LeadDetail');
const Products = lazyPage(() => import('../pages/Products'), 'Products');
const Services = lazyPage(() => import('../pages/Services'), 'Services');
const Marketing = lazyPage(() => import('../pages/Marketing'), 'Marketing');
const Orders = lazyPage(() => import('../pages/Orders'), 'Orders');
const Payments = lazyPage(() => import('../pages/Payments'), 'Payments');
const Analytics = lazyPage(() => import('../pages/Analytics'), 'Analytics');
const AgentSettings = lazyPage(() => import('../pages/AgentSettings'), 'AgentSettings');
const Integrations = lazyPage(() => import('../pages/Integrations'), 'Integrations');
const Settings = lazyPage(() => import('../pages/Settings'), 'Settings');
const AgentQA = lazyPage(() => import('../pages/AgentQA'), 'AgentQA');
const NotFound = lazyPage(() => import('../pages/NotFound'), 'NotFound');
const Platform = lazyPage(() => import('../pages/Platform'), 'Platform');

const RELOAD_KEY = 'shwari-chunk-reload';

function isChunkError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported|Failed to fetch/i.test(msg);
}

/**
 * Load a page chunk, surviving the two ways that normally fails.
 *
 * A brief network drop: retried twice with a short pause. A new deploy: the
 * tab still holds the old index, whose chunk names no longer exist, so the tab
 * is reloaded once to pick up the new build. The reload is recorded in
 * sessionStorage so a chunk that is truly missing cannot cause a reload loop.
 */
function lazyPage<K extends string>(
  load: () => Promise<Record<K, React.ComponentType>>,
  name: K
) {
  return lazy(async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const mod = await load();
        try { sessionStorage.removeItem(RELOAD_KEY); } catch { /* storage unavailable */ }
        return { default: mod[name] };
      } catch (e) {
        lastError = e;
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
    let alreadyReloaded = true;
    try {
      alreadyReloaded = sessionStorage.getItem(RELOAD_KEY) === '1';
      if (!alreadyReloaded) sessionStorage.setItem(RELOAD_KEY, '1');
    } catch { /* storage unavailable: do not risk a loop */ }
    if (!alreadyReloaded && isChunkError(lastError)) {
      window.location.reload();
      return new Promise<never>(() => {}); // the page is going away
    }
    throw lastError;
  });
}

/** Shown instead of React Router's developer error screen. */
function RouteError() {
  const error = useRouteError();
  const chunk = isChunkError(error);
  return (
    <div style={{ padding: 40, maxWidth: 560, margin: '0 auto' }}>
      <ErrorState
        message={
          chunk
            ? "This page couldn't be loaded. Check your connection, then reload."
            : 'Something went wrong on this page. Reloading usually fixes it.'
        }
        onRetry={() => window.location.reload()}
      />
    </div>
  );
}

function page(node: React.ReactNode) {
  return (
    <Suspense fallback={<div style={{ padding: 40 }}><LoadingState label="Loading…" /></div>}>
      {node}
    </Suspense>
  );
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      // A pathless layer with its own boundary, so a page that fails to load
      // shows its error inside the shell and the navigation stays usable.
      { errorElement: <RouteError />, children: [
      { index: true, element: page(<Overview />) },
      { path: 'shwari', element: page(<Shwari />) },
      { path: 'inbox', element: page(<Inbox />) },
      { path: 'inbox/:conversationId', element: page(<Inbox />) },
      { path: 'leads', element: page(<Leads />) },
      { path: 'leads/:leadId', element: page(<LeadDetail />) },
      { path: 'products', element: page(<Products />) },
      { path: 'services', element: page(<Services />) },
      { path: 'marketing', element: page(<Marketing />) },
      { path: 'orders', element: page(<Orders />) },
      { path: 'appointments', element: page(<Appointments />) },
      { path: 'support', element: page(<Tickets />) },
      { path: 'payments', element: page(<Payments />) },
      { path: 'analytics', element: page(<Analytics />) },
      { path: 'agents', element: page(<Agents />) },
      { path: 'agent', element: page(<AgentSettings />) },
      { path: 'integrations', element: page(<Integrations />) },
      { path: 'settings', element: page(<Settings />) },
      { path: 'admin/agent-qa', element: page(<AgentQA />) },
      { path: 'platform', element: page(<Platform />) },
      // Legacy hash-era links.
      { path: 'conversations', element: <Navigate to="/inbox" replace /> },
      { path: 'channels', element: <Navigate to="/integrations" replace /> },
      { path: '*', element: page(<NotFound />) },
      ] },
    ],
  },
]);
