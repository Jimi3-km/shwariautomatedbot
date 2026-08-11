import express from 'express';
import cors from 'cors';
import { rejectClientTenantId } from './auth.js';
import { assertSupabaseConfigured, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase.js';
import { accountRouter } from './routes/account.js';
import { catalogRouter } from './routes/catalog.js';
import { inboxRouter } from './routes/inbox.js';
import { commerceRouter } from './routes/commerce.js';
import { channelsRouter } from './routes/channels.js';
import { receiptsRouter } from './routes/receipts.js';
import { analyticsRouter } from './routes/analytics.js';
import { onboardingRouter } from './routes/onboarding.js';
import { instagramAuthRouter } from './routes/auth/instagram.js';

export function createApp() {
  const app = express();

  app.use(express.json({ limit: '1mb' }));
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true,
      credentials: false,
    })
  );

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  /**
   * The only configuration the browser is given: the project URL and the
   * publishable anon key, which are safe by design because RLS governs what
   * that key can reach. The service-role key is never exposed here.
   */
  app.get('/api/public-config', (_req, res) => {
    res.json({ supabase_url: SUPABASE_URL, supabase_anon_key: SUPABASE_ANON_KEY });
  });

  // Instagram OAuth is a pre-authentication browser redirect flow: there is no
  // session yet and no tenant to steer, so it is mounted ahead of the tenancy
  // guard and of the routers that require a bearer token.
  app.use('/api', instagramAuthRouter);

  // Applied before every router: a client that tries to steer tenancy gets a
  // 400 rather than having the field quietly ignored.
  app.use('/api', rejectClientTenantId);

  app.use('/api', accountRouter);
  app.use('/api', catalogRouter);
  app.use('/api', inboxRouter);
  app.use('/api', commerceRouter);
  app.use('/api', channelsRouter);
  app.use('/api', receiptsRouter);
  app.use('/api', analyticsRouter);
  app.use('/api', onboardingRouter);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  return app;
}

export { assertSupabaseConfigured };
