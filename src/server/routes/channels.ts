import { Router } from 'express';
import { requireAuth, requireAdmin, handler } from '../auth.js';
import { serviceClient } from '../supabase.js';
import {
  getMe, setWebhook, deleteWebhook, getWebhookInfo, generateSecretToken,
} from '../channels/telegram.js';

export const channelsRouter = Router();

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

/** Disconnect: unregister at Telegram and clear the stored secrets. */
channelsRouter.delete(
  '/channels/:id',
  requireAuth,
  requireAdmin,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const { data: channel } = await serviceClient
      .from('channels').select('id, channel_type, bot_token')
      .eq('id', req.params.id).eq('tenant_id', ctx.tenantId).maybeSingle();
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    if (channel.channel_type === 'telegram' && channel.bot_token) {
      try { await deleteWebhook(channel.bot_token); }
      catch (e: any) { console.warn('[channels] deleteWebhook failed, disabling anyway:', e.message); }
    }

    const { error } = await serviceClient
      .from('channels')
      .update({ status: 'disabled', bot_token: null, secret_token: null })
      .eq('id', channel.id).eq('tenant_id', ctx.tenantId);
    if (error) return res.status(500).json({ error: 'Could not disconnect the channel' });

    res.json({ disconnected: true });
  })
);

/**
 * WhatsApp -- structure only.
 *
 * The database, the channel resolution path and the dashboard all treat
 * WhatsApp as a first-class channel already. What is missing is a real Meta
 * WhatsApp Business Cloud API app (phone_number_id, WABA id, permanent access
 * token, verify token). Rather than fake it, this records the intent and
 * reports the integration as pending.
 */
channelsRouter.post(
  '/channels/whatsapp',
  requireAuth,
  requireAdmin,
  handler(async (req, res) => {
    return res.status(501).json({
      error: 'WhatsApp Cloud API integration is not implemented yet',
      code: 'CHANNEL_PENDING',
      required_from_operator: [
        'Meta app with WhatsApp product enabled',
        'phone_number_id',
        'whatsapp_business_account_id',
        'permanent system-user access token',
        'webhook verify token',
      ],
      note: 'The channels table, tenant resolution and dashboard already support channel_type=whatsapp; only the Meta credentials and the inbound webhook mapping remain.',
    });
  })
);
