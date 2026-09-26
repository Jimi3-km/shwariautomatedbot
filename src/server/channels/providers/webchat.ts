import { serviceClient } from '../../supabase.js';
import { generateSecretToken } from '../telegram.js';
import { newSiteKey } from '../webchat/session.js';
import {
  ProviderError,
  type ChannelProvider,
  type ConnectContext,
  type ConnectStart,
  type ConnectedAccount,
  type EmbedSnippet,
  type HealthReport,
  type ProviderAvailability,
} from './types.js';

/**
 * Web chat: the AI agent as a widget on the business's own website.
 *
 * The only channel with no third party in it. There is nothing to authorize,
 * no token to store and no external API to call, so it is always available and
 * connects in one click. That also makes it the channel a business can use on
 * the day they sign up, before any Meta review has happened.
 *
 * Two identifiers, and the distinction matters:
 *
 *   channel_account_id  the public site key, pasted into the customer's HTML
 *   secret_token        server-only; signs visitor tokens and authenticates
 *                       the hand-off to the automation pipeline
 *
 * Outbound is a deliberate no-op — see sendMessage.
 */

const SELECT_SAFE = 'id, tenant_id, channel_type, channel_account_id, display_name, status, created_at';

function toAccount(row: {
  id: string; channel_account_id: string; display_name: string | null; status: string;
}): ConnectedAccount {
  return {
    channel_id: row.id,
    provider: 'webchat',
    account_id: row.channel_account_id,
    display_name: row.display_name,
    status: row.status === 'active' ? 'active' : 'disabled',
  };
}

/**
 * Where the widget script lives. Derived from the public API origin so the
 * snippet works in development and production without a second setting.
 */
export function widgetOrigin(): string {
  return (process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, '');
}

export function buildEmbed(siteKey: string): EmbedSnippet {
  const scriptUrl = `${widgetOrigin()}/api/webchat/widget.js`;
  return {
    site_key: siteKey,
    script_url: scriptUrl,
    html: `<script src="${scriptUrl}" data-site-key="${siteKey}" async></script>`,
  };
}

export const webchatProvider: ChannelProvider = {
  id: 'webchat',
  label: 'Web chat',
  mode: 'instant',

  /** No external dependency, so nothing can be missing. */
  availability(): ProviderAvailability {
    return { available: true, missing: [] };
  },

  /**
   * Connecting mints the channel immediately. Re-connecting an existing web
   * chat channel returns the same site key rather than a new one, so a snippet
   * already pasted into a live website keeps working.
   */
  async connect(ctx: ConnectContext): Promise<ConnectStart> {
    const { data: existing } = await serviceClient
      .from('channels')
      .select('id, channel_account_id, display_name, status')
      .eq('tenant_id', ctx.tenantId)
      .eq('channel_type', 'webchat')
      .maybeSingle();

    if (existing) {
      // Re-enable a previously disconnected widget in place.
      if (existing.status !== 'active') {
        await serviceClient
          .from('channels')
          .update({ status: 'active', secret_token: generateSecretToken() })
          .eq('id', existing.id)
          .eq('tenant_id', ctx.tenantId);
        existing.status = 'active';
      }
      return {
        mode: 'instant',
        account: toAccount(existing),
        embed: buildEmbed(existing.channel_account_id),
      };
    }

    const siteKey = newSiteKey();
    const { data, error } = await serviceClient
      .from('channels')
      .insert({
        tenant_id: ctx.tenantId,
        channel_type: 'webchat',
        channel_account_id: siteKey,
        display_name: 'Website widget',
        secret_token: generateSecretToken(),
        status: 'active',
      })
      .select(SELECT_SAFE)
      .single();

    if (error || !data) {
      console.error('[providers/webchat] save failed', error);
      throw new ProviderError("We couldn't set up your web chat. Please try again.", { status: 500 });
    }

    return { mode: 'instant', account: toAccount(data), embed: buildEmbed(siteKey) };
  },

  /**
   * Disabling stops the widget answering. The site key is kept so that
   * reconnecting revives the same snippet; the secret is rotated on reconnect,
   * which invalidates any visitor token issued before.
   */
  async disconnect(channelId, ctx) {
    const { data: channel } = await serviceClient
      .from('channels').select('id')
      .eq('id', channelId).eq('tenant_id', ctx.tenantId).maybeSingle();
    if (!channel) throw new ProviderError('That channel is no longer connected.', { status: 404 });

    const { error } = await serviceClient
      .from('channels')
      .update({ status: 'disabled', secret_token: null })
      .eq('id', channelId).eq('tenant_id', ctx.tenantId);
    if (error) throw new ProviderError("We couldn't disconnect the widget. Please try again.", { status: 500 });
  },

  async healthCheck(channelId, ctx): Promise<HealthReport> {
    const { data: channel } = await serviceClient
      .from('channels').select('id, status, secret_token')
      .eq('id', channelId).eq('tenant_id', ctx.tenantId).maybeSingle();

    if (!channel) {
      return { healthy: false, summary: 'This channel is no longer connected.', needs_reconnect: true };
    }
    if (channel.status !== 'active') {
      return { healthy: false, summary: 'Your website widget is switched off.', needs_reconnect: true };
    }
    if (!channel.secret_token) {
      return { healthy: false, summary: 'Your website widget needs reconnecting.', needs_reconnect: true };
    }
    // Nothing external to reach, so an active row with a secret is the whole
    // of the health story. Reporting anything less certain would be theatre.
    return { healthy: true, summary: 'Ready. Add the snippet to your site to go live.', needs_reconnect: false };
  },

  /**
   * Deliberately a no-op.
   *
   * Every other provider has to push a reply to an external API. Web chat has
   * no outbound API: the widget polls conversation_messages, and the caller
   * (staff reply, or the pipeline's logging step) has already written the row.
   * Sending here would duplicate the message rather than deliver it.
   */
  async sendMessage(_channelId, _recipientId, _text, _ctx) {
    return;
  },

  async getAccount(channelId, ctx) {
    const { data } = await serviceClient
      .from('channels')
      .select('id, channel_account_id, display_name, status')
      .eq('id', channelId).eq('tenant_id', ctx.tenantId).maybeSingle();
    return data ? toAccount(data) : null;
  },
};
