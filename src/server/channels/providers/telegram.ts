import { serviceClient } from '../../supabase.js';
import {
  getMe, setWebhook, deleteWebhook, getWebhookInfo, sendTelegramMessage, generateSecretToken,
} from '../telegram.js';
import {
  ProviderError,
  ProviderNotConfiguredError,
  type ChannelProvider,
  type ConnectContext,
  type ConnectStart,
  type CallbackResult,
  type ConnectedAccount,
  type HealthReport,
  type ProviderAvailability,
} from './types.js';

/**
 * Telegram, unchanged in behaviour.
 *
 * This wraps the flow that /api/channels/telegram has always used — validate
 * with getMe, mint a secret, register the webhook, store the row with the
 * service client — so that existing connected bots keep working exactly as
 * before. Only the call site moves.
 */

const webhookUrl = () => process.env.N8N_TELEGRAM_WEBHOOK_URL || '';

const SELECT_SAFE = 'id, tenant_id, channel_type, channel_account_id, display_name, status, created_at';

function toAccount(row: {
  id: string; channel_account_id: string; display_name: string | null; status: string;
}): ConnectedAccount {
  return {
    channel_id: row.id,
    provider: 'telegram',
    account_id: row.channel_account_id,
    display_name: row.display_name,
    status: row.status === 'active' ? 'active' : 'disabled',
  };
}

/** Reads the row including its secrets. Server-side only, never serialised out. */
async function loadChannel(channelId: string, ctx: ConnectContext) {
  const { data } = await serviceClient
    .from('channels')
    .select('id, channel_type, channel_account_id, display_name, status, bot_token')
    .eq('id', channelId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  return data;
}

export const telegramProvider: ChannelProvider = {
  id: 'telegram',
  label: 'Telegram',
  mode: 'credential',

  availability(): ProviderAvailability {
    const missing = webhookUrl() ? [] : ['N8N_TELEGRAM_WEBHOOK_URL'];
    return { available: missing.length === 0, missing };
  },

  async connect(): Promise<ConnectStart> {
    const a = this.availability();
    if (!a.available) throw new ProviderNotConfiguredError('Telegram', a.missing);
    return {
      mode: 'credential',
      fields: [
        {
          name: 'bot_token',
          label: 'Bot token',
          hint: 'Open Telegram, message @BotFather, create a bot, and paste the token it gives you.',
          placeholder: '123456789:AA…',
          secret: true,
        },
      ],
    };
  },

  async submitCredentials(values, ctx): Promise<CallbackResult> {
    const a = this.availability();
    if (!a.available) throw new ProviderNotConfiguredError('Telegram', a.missing);

    const botToken = String(values.bot_token || '').trim();
    if (!botToken) throw new ProviderError('Please paste your bot token.');
    if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(botToken)) {
      throw new ProviderError("That doesn't look like a Telegram bot token. Copy the whole line from BotFather.");
    }

    let bot;
    try {
      bot = await getMe(botToken);
    } catch (e) {
      throw new ProviderError(
        'Telegram rejected that token. Check you copied all of it, then try again.',
        { detail: e instanceof Error ? e.message : undefined }
      );
    }

    const accountId = String(bot.id);

    // UNIQUE (channel_type, channel_account_id) already prevents two tenants
    // owning one bot; checking first turns that into a readable message.
    const { data: existing } = await serviceClient
      .from('channels')
      .select('id, tenant_id')
      .eq('channel_type', 'telegram')
      .eq('channel_account_id', accountId)
      .maybeSingle();

    if (existing && existing.tenant_id !== ctx.tenantId) {
      throw new ProviderError('That Telegram bot is already connected to another business.', { status: 409 });
    }

    const secretToken = generateSecretToken();
    try {
      await setWebhook(botToken, webhookUrl(), secretToken);
    } catch (e) {
      throw new ProviderError(
        "Telegram accepted the token but we couldn't finish setting up message delivery. Please try again.",
        { status: 502, detail: e instanceof Error ? e.message : undefined }
      );
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

    const { data, error } = existing
      ? await serviceClient.from('channels').update(row).eq('id', existing.id).select(SELECT_SAFE).single()
      : await serviceClient.from('channels').insert(row).select(SELECT_SAFE).single();

    if (error || !data) {
      console.error('[providers/telegram] save failed', error);
      throw new ProviderError("We couldn't save that connection. Please try again.", { status: 500 });
    }

    return { account: toAccount(data) };
  },

  async disconnect(channelId, ctx) {
    const channel = await loadChannel(channelId, ctx);
    if (!channel) throw new ProviderError('That channel is no longer connected.', { status: 404 });

    if (channel.bot_token) {
      try {
        await deleteWebhook(channel.bot_token);
      } catch (e) {
        // Disable locally regardless: leaving the row active would be worse.
        console.warn('[providers/telegram] deleteWebhook failed, disabling anyway:',
          e instanceof Error ? e.message : e);
      }
    }

    const { error } = await serviceClient
      .from('channels')
      .update({ status: 'disabled', bot_token: null, secret_token: null })
      .eq('id', channelId)
      .eq('tenant_id', ctx.tenantId);
    if (error) throw new ProviderError("We couldn't disconnect that channel. Please try again.", { status: 500 });
  },

  async healthCheck(channelId, ctx): Promise<HealthReport> {
    const channel = await loadChannel(channelId, ctx);
    if (!channel) return { healthy: false, summary: 'This channel is no longer connected.', needs_reconnect: true };
    if (channel.status !== 'active' || !channel.bot_token) {
      return { healthy: false, summary: 'Telegram is disconnected.', needs_reconnect: true };
    }

    try {
      const info = await getWebhookInfo(channel.bot_token);
      if (!info.url) {
        return { healthy: false, summary: "Telegram isn't delivering messages to us yet. Reconnect to fix it.", needs_reconnect: true };
      }
      if (info.url !== webhookUrl()) {
        return { healthy: false, summary: 'Telegram is delivering messages somewhere else. Reconnect to fix it.', needs_reconnect: true };
      }
      if (info.last_error_message) {
        console.warn('[providers/telegram] webhook last_error:', info.last_error_message);
        return { healthy: false, summary: 'Telegram is having trouble delivering messages. We are retrying.', needs_reconnect: false };
      }
      return { healthy: true, summary: 'Connected and receiving messages.', needs_reconnect: false };
    } catch (e) {
      console.warn('[providers/telegram] healthCheck failed:', e instanceof Error ? e.message : e);
      return { healthy: false, summary: "We couldn't reach Telegram just now. Try again in a moment.", needs_reconnect: false };
    }
  },

  async sendMessage(channelId, recipientId, text, ctx) {
    const channel = await loadChannel(channelId, ctx);
    if (!channel?.bot_token) throw new ProviderError('Telegram is not connected.', { status: 409 });
    try {
      await sendTelegramMessage(channel.bot_token, recipientId, text);
    } catch (e) {
      throw new ProviderError("We couldn't send that message. Please try again.", {
        status: 502, detail: e instanceof Error ? e.message : undefined,
      });
    }
  },

  async getAccount(channelId, ctx) {
    const channel = await loadChannel(channelId, ctx);
    return channel ? toAccount(channel) : null;
  },
};
