import { Router } from 'express';
import { requireAuth, requireAdmin, handler } from '../auth.js';
import { allProviders } from '../channels/providers/index.js';
import { pipelineUrl } from '../services/inbound.js';
import { metaConfig } from '../config/meta.js';
import { widgetOrigin } from '../channels/providers/webchat.js';

export const setupRouter = Router();

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
    const pipeline = pipelineUrl();
    const deliveryReady = Boolean(pipeline);

    res.json({
      channels,
      delivery: {
        // Inbound reaches the agent only when this is set.
        pipeline_configured: deliveryReady,
        missing_environment_variables: deliveryReady ? [] : ['N8N_AGENT_WEBHOOK_URL'],
        // Outbound replies come back through this, which needs the shared secret.
        internal_send_configured: Boolean(process.env.INTERNAL_API_SECRET),
        internal_send_missing: process.env.INTERNAL_API_SECRET ? [] : ['INTERNAL_API_SECRET'],
      },
      /** Values to paste into the Meta dashboard, derived from this deployment. */
      register_with_meta: {
        webhook_callback_url: `${origin}/api/webhooks/meta`,
        verify_token_is_set: Boolean(metaConfig.verifyToken),
        whatsapp_redirect_uri: `${origin}/api/channels/oauth/whatsapp/callback`,
        instagram_connect_redirect_uri: `${origin}/api/channels/oauth/instagram/callback`,
        instagram_signin_redirect_uri: `${origin}/api/auth/instagram/callback`,
        subscribe_to_fields: ['messages'],
      },
      public_api_url: origin,
      all_ready: channels.every((c) => c.ready) && deliveryReady,
    });
  })
);
