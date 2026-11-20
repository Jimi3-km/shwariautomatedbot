import { Router } from 'express';
import { requireAuth, requireAdmin, handler } from '../auth.js';
import { allProviders } from '../channels/providers/index.js';
import { metaConfig } from '../config/meta.js';
import { widgetOrigin } from '../channels/providers/webchat.js';
import { llmConfigured, llmModel } from '../ai/llm.js';
import { runMetaDiagnostics, subscribeWebhook, WEBHOOK_OBJECTS, type WebhookObject } from '../services/meta/diagnostics.js';

export const setupRouter = Router();

/**
 * Test the Meta settings against Meta itself.
 *
 * Admin-only, like the readiness check below, and for the same reason: it is
 * for the person running the deployment. It reports what is set and whether it
 * matches, never a secret's value.
 */
setupRouter.get(
  '/setup/meta-check',
  requireAuth,
  requireAdmin,
  handler(async (_req, res) => {
    res.json(await runMetaDiagnostics());
  })
);

/**
 * Switch on message delivery for one Meta product from here, so the person
 * running the deployment does not have to find the right "Subscribe" toggle
 * in the Meta dashboard. Admin-only; returns Meta's own words when it refuses.
 */
setupRouter.post(
  '/setup/meta-webhook',
  requireAuth,
  requireAdmin,
  handler(async (req, res) => {
    const object = String(req.body?.object ?? '') as WebhookObject;
    if (!WEBHOOK_OBJECTS.includes(object)) {
      return res.status(400).json({ error: 'Unknown webhook.' });
    }
    const result = await subscribeWebhook(object);
    if (!result.ok) return res.status(502).json({ error: result.message });
    res.json(result);
  })
);

/**
 * Operator readiness check.
 *
 * Deliberately the one place that names environment variables to a browser.
 * Everywhere else the rule holds — a business owner never sees them — but the
 * person running this deployment is also an admin of a tenant, and the
 * alternative is that they diagnose a silent misconfiguration by reading
 * server logs. It is admin-only, and it reports which variables are *missing*,
 * never the value of one that is set.
 */
setupRouter.get(
  '/setup/status',
  requireAuth,
  requireAdmin,
  handler(async (_req, res) => {
    const origin = widgetOrigin();

    const channels = allProviders().map((p) => {
      const a = p.availability();
      return {
        id: p.id,
        label: p.label,
        mode: p.mode,
        ready: a.available,
        missing_environment_variables: a.missing,
      };
    });

    // A channel can be connectable yet unable to deliver, which is the failure
    // mode worth surfacing: it looks fine until no message ever arrives.
    // The internal agent replaces n8n entirely. Delivery is ready as long as the AI is configured.
    const deliveryReady = llmConfigured().configured;
    const shwariGate = llmConfigured();

    res.json({
      channels,
      delivery: {
        // Inbound reaches the agent natively now.
        pipeline_configured: deliveryReady,
        missing_environment_variables: [],
        // Outbound replies come back through this, which needs the shared secret.
        internal_send_configured: Boolean(process.env.INTERNAL_API_SECRET),
        internal_send_missing: process.env.INTERNAL_API_SECRET ? [] : ['INTERNAL_API_SECRET'],
      },
      /** Values to paste into the Meta dashboard, derived from this deployment. */
      register_with_meta: {
        webhook_callback_url: `${origin}/api/webhooks/meta`,
        verify_token_is_set: Boolean(metaConfig.verifyToken),

        instagram_signin_redirect_uri: `${origin}/api/auth/instagram/callback`,
        facebook_redirect_uri: `${origin}/api/channels/oauth/facebook/callback`,
        subscribe_to_fields: ['messages'],
      },
      /** Shwari runs in this process rather than in n8n, so it has its own key. */
      shwari: {
        ready: shwariGate.configured,
        missing_environment_variables: shwariGate.missing,
        model: shwariGate.configured ? llmModel() : null,
        telegram_webhook_url: `${origin}/api/webhooks/telegram`,
      },
      public_api_url: origin,
      all_ready: channels.every((c) => c.ready) && deliveryReady && shwariGate.configured,
    });
  })
);
