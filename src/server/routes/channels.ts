import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth, requireAdmin, handler } from '../auth.js';
import { serviceClient } from '../supabase.js';
import { getWebhookInfo } from '../channels/telegram.js';
import {
  allProviders, getProvider, ProviderError, telegramProvider,
} from '../channels/providers/index.js';
import { webhookUrl as telegramWebhookUrl } from '../channels/providers/telegram.js';
import { verifyOAuthState } from '../services/meta/oauthState.js';

export const channelsRouter = Router();

/** Turns a provider failure into the wording a business owner should read. */
function sendProviderError(res: Response, e: unknown, fallback: string) {
  if (e instanceof ProviderError) {
    console.warn(`[channels] ${e.code}: ${e.message}`);
    return res.status(e.status).json({ error: e.userMessage, code: e.code });
  }
  console.error('[channels] unexpected provider failure:', e);
  return res.status(500).json({ error: fallback });
}

/**
 * List connected channels.
 *
 * Reads through channels_safe, whose definition reduces secret_token,
 * bot_token and credentials_ref to booleans. Even if this handler regressed,
 * the column-level revokes in migration 0001 mean the authenticated role has
 * no privilege to read those columns at all.
 */
channelsRouter.get(
  '/channels',
  requireAuth,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const { data, error } = await ctx.db
      .from('channels_safe').select('*').eq('tenant_id', ctx.tenantId)
      .order('created_at', { ascending: true });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ channels: data ?? [] });
  })
);

/**
 * Connect a Telegram bot.
 *
 * Kept at this path for the existing Integrations screen, but it is now only a
 * thin wrapper over the Telegram provider — the same code path as
 * POST /channels/telegram/credentials. The bot's webhook is registered against
 * this application (/api/webhooks/telegram), never against an external
 * pipeline, and the token never travels back to the browser.
 */
channelsRouter.post(
  '/channels/telegram',
  requireAuth,
  requireAdmin,
  handler(async (req, res) => {
    const botToken = String(req.body?.bot_token || '').trim();
    if (!botToken) return res.status(400).json({ error: 'bot_token is required' });

    try {
      const { account } = await telegramProvider.submitCredentials!({ bot_token: botToken }, req.ctx!);
      res.status(201).json({
        account,
        // The shape this route has always returned.
        channel: {
          id: account.channel_id,
          tenant_id: req.ctx!.tenantId,
          channel_type: 'telegram',
          channel_account_id: account.account_id,
          display_name: account.display_name,
          status: account.status,
        },
        bot: {
          id: Number(account.account_id),
          username: account.display_name?.startsWith('@') ? account.display_name.slice(1) : null,
        },
      });
    } catch (e) {
      sendProviderError(res, e, "We couldn't connect that bot. Please try again.");
    }
  })
);

/** Health/diagnostics: what Telegram thinks the webhook is. No secrets returned. */
channelsRouter.get(
  '/channels/:id/status',
  requireAuth,
  requireAdmin,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const { data: channel } = await serviceClient
      .from('channels').select('id, channel_type, bot_token, status')
      .eq('id', req.params.id).eq('tenant_id', ctx.tenantId).maybeSingle();
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    if (channel.channel_type !== 'telegram' || !channel.bot_token) {
      return res.status(400).json({ error: 'Status is only available for connected Telegram channels' });
    }
    try {
      const info = await getWebhookInfo(channel.bot_token);
      res.json({
        status: channel.status,
        webhook: {
          configured: Boolean(info.url),
          matches_expected: Boolean(info.url) && info.url === telegramWebhookUrl(),
          pending_update_count: info.pending_update_count,
          last_error_message: info.last_error_message ?? null,
        },
      });
    } catch (e) {
      console.warn('[channels] getWebhookInfo failed:', e instanceof Error ? e.message : e);
      res.status(502).json({ error: "We couldn't reach Telegram just now. Try again in a moment." });
    }
  })
);

/**
 * Disconnect. Delegates to the provider so each one tears down its own remote
 * state — Telegram unregisters the webhook, the Meta providers forget the
 * encrypted token — before the row is disabled.
 */
channelsRouter.delete(
  '/channels/:id',
  requireAuth,
  requireAdmin,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const { data: channel } = await serviceClient
      .from('channels').select('id, channel_type')
      .eq('id', req.params.id).eq('tenant_id', ctx.tenantId).maybeSingle();
    if (!channel) return res.status(404).json({ error: 'That channel is no longer connected.' });

    const provider = getProvider(channel.channel_type);
    if (!provider) {
      const { error } = await serviceClient
        .from('channels')
        .update({ status: 'disabled', bot_token: null, secret_token: null, credentials_ref: null })
        .eq('id', channel.id).eq('tenant_id', ctx.tenantId);
      if (error) return res.status(500).json({ error: "We couldn't disconnect that channel." });
      return res.json({ disconnected: true });
    }

    try {
      await provider.disconnect(channel.id, ctx);
      res.json({ disconnected: true });
    } catch (e) {
      sendProviderError(res, e, "We couldn't disconnect that channel. Please try again.");
    }
  })
);

// ---------------------------------------------------------------------------
// Provider-driven connection flows
// ---------------------------------------------------------------------------

/** What can be offered, and how each one connects. No secrets, no env names. */
channelsRouter.get(
  '/channels/providers',
  requireAuth,
  handler(async (_req, res) => {
    res.json({
      providers: allProviders().map((p) => {
        const a = p.availability();
        if (!a.available) {
          console.warn(`[channels] provider ${p.id} unavailable, missing: ${a.missing.join(', ')}`);
        }
        return {
          id: p.id,
          label: p.label,
          mode: p.mode,
          available: a.available,
          unavailable_reason: a.available ? null : `${p.label} isn't available yet.`,
        };
      }),
    });
  })
);

/**
 * Start a connection.
 *
 * OAuth providers get back a URL for the browser to navigate to; the state in
 * it is signed and carries this tenant, so the callback cannot be replayed
 * against a different workspace. Credential providers get back the fields to
 * collect.
 */
channelsRouter.post(
  '/channels/:provider/connect',
  requireAuth,
  requireAdmin,
  handler(async (req, res) => {
    const provider = getProvider(req.params.provider);
    if (!provider) return res.status(404).json({ error: 'Unknown channel.' });
    try {
      res.json(await provider.connect(req.ctx!));
    } catch (e) {
      sendProviderError(res, e, "We couldn't start that connection. Please try again.");
    }
  })
);

/** Finish a credential-based connection (Telegram). */
channelsRouter.post(
  '/channels/:provider/credentials',
  requireAuth,
  requireAdmin,
  handler(async (req, res) => {
    const provider = getProvider(req.params.provider);
    if (!provider?.submitCredentials) {
      return res.status(404).json({ error: 'Unknown channel.' });
    }
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries((req.body ?? {}) as Record<string, unknown>)) {
      if (typeof value === 'string' && key.length <= 64 && value.length <= 4096) values[key] = value;
    }
    try {
      const { account } = await provider.submitCredentials(values, req.ctx!);
      res.status(201).json({ account });
    } catch (e) {
      sendProviderError(res, e, "We couldn't connect that channel. Please try again.");
    }
  })
);

/*
 * The former POST /channels/meta/whatsapp and POST /channels/meta/instagram
 * routes were removed. They accepted a code or access token from the browser,
 * stored the resulting Meta token in plaintext on the channel row and returned
 * that whole row — token included — to the browser. WhatsApp and Instagram now
 * connect only through the provider flow: POST /channels/:provider/connect
 * returns Meta's authorize URL, and the callback below stores the token
 * encrypted in meta_tokens.
 */

/**
 * OAuth return leg.
 *
 * Unauthenticated by necessity — it is a browser redirect from Meta with no
 * Authorization header. The signed state is the only thing trusted here, and
 * it is what supplies the tenant.
 */
channelsRouter.get(
  '/channels/oauth/:provider/callback',
  handler(async (req: Request, res: Response) => {
    const providerId = req.params.provider;
    const provider = getProvider(providerId);
    const params = req.query as Record<string, string>;

    const back = (status: string) =>
      res.redirect(302, `/integrations?connect=${encodeURIComponent(providerId)}&status=${status}`);

    if (!provider?.callback) return back('unknown');

    if (params.error) {
      console.log(`[channels] ${providerId} authorization declined: ${params.error}`);
      return back(params.error === 'access_denied' ? 'cancelled' : 'failed');
    }

    const state = params.state ? verifyOAuthState(params.state) : null;
    if (!state || state.provider !== providerId) {
      console.warn(`[channels] ${providerId} callback state rejected`);
      return back('expired');
    }

    try {
      await provider.callback(params, { tenantId: state.tenantId, userId: state.userId });
      return back('connected');
    } catch (e) {
      if (e instanceof ProviderError) {
        console.warn(`[channels] ${providerId} callback failed (${e.code}): ${e.message}`);
        return back(e.code === 'PROVIDER_ERROR' ? 'failed' : e.code.toLowerCase());
      }
      console.error(`[channels] ${providerId} callback failed:`, e);
      return back('failed');
    }
  })
);

/** Plain-language health for one channel. */
channelsRouter.get(
  '/channels/:id/health',
  requireAuth,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const { data: channel } = await serviceClient
      .from('channels').select('id, channel_type')
      .eq('id', req.params.id).eq('tenant_id', ctx.tenantId).maybeSingle();

    if (!channel) return res.status(404).json({ error: 'That channel is no longer connected.' });

    const provider = getProvider(channel.channel_type);
    if (!provider) {
      return res.json({ healthy: false, summary: 'This channel cannot be checked.', needs_reconnect: false });
    }

    try {
      res.json(await provider.healthCheck(channel.id, ctx));
    } catch (e) {
      console.warn('[channels] health check threw:', e instanceof Error ? e.message : e);
      res.json({ healthy: false, summary: "We couldn't check this connection just now.", needs_reconnect: false });
    }
  })
);
