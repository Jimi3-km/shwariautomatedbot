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
import { setupRouter } from './routes/setup.js';
import { metaWebhookRouter } from './routes/webhooks/meta.js';
import { telegramWebhookRouter } from './routes/webhooks/telegram.js';
import { shwariRouter } from './routes/shwari.js';
import { operationsRouter } from './routes/operations.js';
import { internalRouter } from './routes/internal.js';
import { webchatRouter } from './routes/webchat.js';
import { instagramAuthRouter } from './routes/auth/instagram.js';

export function createApp() {
  const app = express();

  /**
   * The Meta webhook is parsed as a raw Buffer, and only on its own path.
   *
   * Meta signs the exact bytes it sent. Re-serialising a parsed object does not
   * reproduce them — key order and whitespace both differ — so the signature can
   * only be checked against the original buffer. A `verify` hook on the JSON
   * parser also captures that buffer, but it depends on this process being the
   * first thing to read the request stream, which is not true everywhere: some
   * serverless runtimes, Vercel's Node runtime among them, parse the body
   * before the handler runs, leaving the hook with nothing and every delivery
   * failing signature verification.
   *
   * Taking the raw body explicitly on this one route removes that dependency.
   * The route JSON-parses it itself, after the signature has been checked —
   * which is the right order anyway: nothing should interpret an unverified
   * payload.
   */
  app.use('/api/webhooks/meta', express.raw({ type: '*/*', limit: '1mb' }));

  /** Everything else is ordinary JSON. */
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        (req as express.Request).rawBody = buf;
      },
    })
  );
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

  /**
   * Machine callers, mounted ahead of the tenancy guard and the JWT routers.
   *
   * Meta's webhook authenticates with an HMAC over the raw body; Telegram with
   * the secret header it echoes back to us; n8n with a shared secret. None has
   * a dashboard session, and none may be reached by a browser, so each does its
   * own check rather than borrowing requireAuth.
   */
  app.use('/api', metaWebhookRouter);
  app.use('/api', telegramWebhookRouter);
  app.use('/api', internalRouter);

  /**
   * Web chat is called by anonymous visitors on our customers' websites, so it
   * is public by design. It authenticates a visitor with a signed token issued
   * against the channel's own secret, and rate-limits every route.
   */
  app.use('/api', webchatRouter);

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
  app.use('/api', setupRouter);
  app.use('/api', shwariRouter);
  app.use('/api', operationsRouter);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  return app;
}

export { assertSupabaseConfigured };
