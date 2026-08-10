import React from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from '../layouts/AppShell';
import { Overview } from '../pages/Overview';
import { Inbox } from '../pages/Inbox';
import { Leads } from '../pages/Leads';
import { LeadDetail } from '../pages/LeadDetail';
import { Products } from '../pages/Products';
import { Orders } from '../pages/Orders';
import { Payments } from '../pages/Payments';
import { Analytics } from '../pages/Analytics';
import { AgentSettings } from '../pages/AgentSettings';
import { Integrations } from '../pages/Integrations';
import { Settings } from '../pages/Settings';
import { NotFound } from '../pages/NotFound';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Overview /> },
      { path: 'inbox', element: <Inbox /> },
      { path: 'inbox/:conversationId', element: <Inbox /> },
      { path: 'leads', element: <Leads /> },
      { path: 'leads/:leadId', element: <LeadDetail /> },
      { path: 'products', element: <Products /> },
      { path: 'orders', element: <Orders /> },
      { path: 'payments', element: <Payments /> },
      { path: 'analytics', element: <Analytics /> },
      { path: 'agent', element: <AgentSettings /> },
      { path: 'integrations', element: <Integrations /> },
      { path: 'settings', element: <Settings /> },
      // Legacy hash-era links.
      { path: 'conversations', element: <Navigate to="/inbox" replace /> },
      { path: 'channels', element: <Navigate to="/integrations" replace /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
