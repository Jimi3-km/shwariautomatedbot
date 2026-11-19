import React, { Suspense, lazy } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from '../layouts/AppShell';
import { LoadingState } from '../components/ui';

/**
 * Every page is its own chunk, fetched the first time it is visited, so the
 * initial download is the shell plus one screen rather than all of them.
 */
const Overview = lazy(() => import('../pages/Overview').then((m) => ({ default: m.Overview })));
const Shwari = lazy(() => import('../pages/Shwari').then((m) => ({ default: m.Shwari })));
const Appointments = lazy(() => import('../pages/Appointments').then((m) => ({ default: m.Appointments })));
const Tickets = lazy(() => import('../pages/Tickets').then((m) => ({ default: m.Tickets })));
const Agents = lazy(() => import('../pages/Agents').then((m) => ({ default: m.Agents })));
const Inbox = lazy(() => import('../pages/Inbox').then((m) => ({ default: m.Inbox })));
const Leads = lazy(() => import('../pages/Leads').then((m) => ({ default: m.Leads })));
const LeadDetail = lazy(() => import('../pages/LeadDetail').then((m) => ({ default: m.LeadDetail })));
const Products = lazy(() => import('../pages/Products').then((m) => ({ default: m.Products })));
const Services = lazy(() => import('../pages/Services').then((m) => ({ default: m.Services })));
const Orders = lazy(() => import('../pages/Orders').then((m) => ({ default: m.Orders })));
const Payments = lazy(() => import('../pages/Payments').then((m) => ({ default: m.Payments })));
const Analytics = lazy(() => import('../pages/Analytics').then((m) => ({ default: m.Analytics })));
const AgentSettings = lazy(() => import('../pages/AgentSettings').then((m) => ({ default: m.AgentSettings })));
const Integrations = lazy(() => import('../pages/Integrations').then((m) => ({ default: m.Integrations })));
const Settings = lazy(() => import('../pages/Settings').then((m) => ({ default: m.Settings })));
const AgentQA = lazy(() => import('../pages/AgentQA').then((m) => ({ default: m.AgentQA })));
const NotFound = lazy(() => import('../pages/NotFound').then((m) => ({ default: m.NotFound })));

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
    children: [
      { index: true, element: page(<Overview />) },
      { path: 'shwari', element: page(<Shwari />) },
      { path: 'inbox', element: page(<Inbox />) },
      { path: 'inbox/:conversationId', element: page(<Inbox />) },
      { path: 'leads', element: page(<Leads />) },
      { path: 'leads/:leadId', element: page(<LeadDetail />) },
      { path: 'products', element: page(<Products />) },
      { path: 'services', element: page(<Services />) },
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
      // Legacy hash-era links.
      { path: 'conversations', element: <Navigate to="/inbox" replace /> },
      { path: 'channels', element: <Navigate to="/integrations" replace /> },
      { path: '*', element: page(<NotFound />) },
    ],
  },
]);
