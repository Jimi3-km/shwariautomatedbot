import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth, requireAdmin, handler } from '../auth.js';
import { serviceClient } from '../supabase.js';
import {
  getMe, setWebhook, deleteWebhook, getWebhookInfo, generateSecretToken,
} from '../channels/telegram.js';
import {
  allProviders, getProvider, ProviderError,
} from '../channels/providers/index.js';
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

const N8N_TELEGRAM_WEBHOOK_URL = process.env.N8N_TELEGRAM_WEBHOOK_URL || '';

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
 * 1. accept the token over an authenticated request
 * 2. validate it with getMe
 * 3. mint a fresh webhook secret
 * 4. register the webhook against the n8n inbound endpoint
 * 5. store the channel row
 * 6. return metadata only -- the token never travels back to the browser
 */
channelsRouter.post(
  '/channels/telegram',
  requireAuth,
  requireAdmin,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const botToken = String(req.body?.bot_token || '').trim();

    if (!botToken) return res.status(400).json({ error: 'bot_token is required' });
    if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(botToken)) {
      return res.status(400).json({ error: 'That does not look like a Telegram bot token' });
    }
    if (!N8N_TELEGRAM_WEBHOOK_URL) {
      return res.status(503).json({
        error: 'N8N_TELEGRAM_WEBHOOK_URL is not configured on the server, so the webhook cannot be registered',
        code: 'WEBHOOK_URL_MISSING',
      });
    }

    let bot;
    try {
      bot = await getMe(botToken);
    } catch (e: any) {
      return res.status(400).json({ error: `Telegram rejected that token: ${e.message}` });
    }

    const accountId = String(bot.id);

    // channels has UNIQUE (channel_type, channel_account_id), so the same bot
    // cannot be claimed by two tenants. Check first to give a clear error, and
    // to make sure we never hand another tenant's bot to this one.
    const { data: existing } = await serviceClient
      .from('channels')
      .select('id, tenant_id')
      .eq('channel_type', 'telegram')
      .eq('channel_account_id', accountId)
      .maybeSingle();

    if (existing && existing.tenant_id !== ctx.tenantId) {
      return res.status(409).json({ error: 'That Telegram bot is already connected to another business' });
    }

    const secretToken = generateSecretToken();

    try {
      await setWebhook(botToken, N8N_TELEGRAM_WEBHOOK_URL, secretToken);
    } catch (e: any) {
      return res.status(502).json({ error: `Could not register the webhook with Telegram: ${e.message}` });
    }

    const row = {
      tenant_id: ctx.tenantId,
      channel_type: 'telegram' as const,
      channel_account_id: accountId,
      display_name: bot.username ? `@${bot.username}` : bot.first_name,
      bot_token: botToken,
      secret_token: secretToken,
      status: 'active' as const,
    };

    // Service client: secret_token and bot_token are not writable by the
    // authenticated role by design.
    const { data, error } = existing
      ? await serviceClient.from('channels').update(row).eq('id', existing.id)
          .select('id, tenant_id, channel_type, channel_account_id, display_name, status, created_at').single()
      : await serviceClient.from('channels').insert(row)
          .select('id, tenant_id, channel_type, channel_account_id, display_name, status, created_at').single();

    if (error) {
      console.error('[channels] telegram save failed', error);
      return res.status(500).json({ error: 'Could not save the channel' });
    }

    res.status(201).json({ channel: data, bot: { id: bot.id, username: bot.username } });
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
          matches_expected: info.url === N8N_TELEGRAM_WEBHOOK_URL,
          pending_update_count: info.pending_update_count,
          last_error_message: info.last_error_message ?? null,
        },
      });
    } catch (e: any) {
      res.status(502).json({ error: e.message });
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
    const values = (req.body ?? {}) as Record<string, string>;
    try {
      const { account } = await provider.submitCredentials(values, req.ctx!);
      res.status(201).json({ account });
    } catch (e) {
      sendProviderError(res, e, "We couldn't connect that channel. Please try again.");
    }
  })
);

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
