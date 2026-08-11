import { serviceClient } from '../../supabase.js';
import { instagramConnectConfigured, metaConfig } from '../../config/meta.js';
import { createOAuthState } from '../../services/meta/oauthState.js';
import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  fetchProfile,
  sendInstagramMessage,
  InstagramOAuthError,
} from '../../services/meta/instagram.js';
import { storeToken, loadToken, deleteToken } from '../../services/meta/tokens.js';
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
 * Instagram as a messaging channel for an existing tenant.
 *
 * Distinct from Instagram sign-in (routes/auth/instagram.ts), which creates an
 * account. Here the user is already signed in and is attaching their business
 * Instagram account to their workspace, so the OAuth state carries the tenant
 * and is verified on the way back.
 *
 * The access token is written to meta_tokens (AES-256-GCM, service-role only)
 * and the channels row holds nothing but the public account id.
 */

const SELECT_SAFE = 'id, tenant_id, channel_type, channel_account_id, display_name, status, created_at';

function toAccount(row: {
  id: string; channel_account_id: string; display_name: string | null; status: string;
}): ConnectedAccount {
  return {
    channel_id: row.id,
    provider: 'instagram',
    account_id: row.channel_account_id,
    display_name: row.display_name,
    status: row.status === 'active' ? 'active' : 'disabled',
  };
}

export const instagramProvider: ChannelProvider = {
  id: 'instagram',
  label: 'Instagram',
  mode: 'oauth',

  availability(): ProviderAvailability {
    const g = instagramConnectConfigured();
    return { available: g.configured, missing: g.missing };
  },

  async connect(ctx: ConnectContext): Promise<ConnectStart> {
    const a = this.availability();
    if (!a.available) throw new ProviderNotConfiguredError('Instagram', a.missing);

    const state = createOAuthState({ provider: 'instagram', tenantId: ctx.tenantId, userId: ctx.userId });
    // Connecting a channel comes back on its own callback, not the sign-in
    // one, so the redirect URI is passed explicitly through both legs.
    return {
      mode: 'oauth',
      authorize_url: buildAuthorizeUrl(state, metaConfig.instagram.connectRedirectUri),
    };
  },

  /**
   * The route has already verified the state and resolved ctx from it, so the
   * tenant here is the one that started the flow — never a query parameter.
   */
  async callback(params, ctx): Promise<CallbackResult> {
    const code = params.code;
    if (!code) throw new ProviderError('Instagram did not complete the authorization. Please try again.');

    let profile;
    let longLived;
    try {
      const shortLived = await exchangeCodeForToken(code, metaConfig.instagram.connectRedirectUri);
      longLived = await exchangeForLongLivedToken(shortLived.accessToken);
      profile = await fetchProfile(longLived.accessToken);
    } catch (e) {
      if (e instanceof InstagramOAuthError) {
        console.error(`[providers/instagram] Meta error (${e.metaCode ?? 'n/a'}): ${e.message}`);
      } else {
        console.error('[providers/instagram] token exchange failed:', e);
      }
      throw new ProviderError(
        "Instagram couldn't be connected. Please try again.",
        { status: 502, code: 'INSTAGRAM_EXCHANGE_FAILED' }
      );
    }

    // One Instagram account belongs to one workspace.
    const { data: existing } = await serviceClient
      .from('channels')
      .select('id, tenant_id')
      .eq('channel_type', 'instagram')
      .eq('channel_account_id', profile.id)
      .maybeSingle();

    if (existing && existing.tenant_id !== ctx.tenantId) {
      throw new ProviderError('That Instagram account is already connected to another business.', { status: 409 });
    }

    await storeToken({
      tenantId: ctx.tenantId,
      platform: 'instagram',
      accessToken: longLived.accessToken,
      expiresAt: longLived.expiresAt,
      instagramUserId: profile.id,
      instagramUsername: profile.username,
    });

    const row = {
      tenant_id: ctx.tenantId,
      channel_type: 'instagram' as const,
      channel_account_id: profile.id,
      display_name: profile.username ? `@${profile.username}` : 'Instagram',
      // Points at meta_tokens rather than holding a credential itself.
      credentials_ref: `meta_tokens:${ctx.tenantId}:instagram`,
      status: 'active' as const,
    };

    const { data, error } = existing
      ? await serviceClient.from('channels').update(row).eq('id', existing.id).select(SELECT_SAFE).single()
      : await serviceClient.from('channels').insert(row).select(SELECT_SAFE).single();

    if (error || !data) {
      console.error('[providers/instagram] save failed', error);
      throw new ProviderError("We couldn't save that connection. Please try again.", { status: 500 });
    }

    return { account: toAccount(data) };
  },

  async disconnect(channelId, ctx) {
    const { data: channel } = await serviceClient
      .from('channels').select('id')
      .eq('id', channelId).eq('tenant_id', ctx.tenantId).maybeSingle();
    if (!channel) throw new ProviderError('That channel is no longer connected.', { status: 404 });

    await deleteToken(ctx.tenantId, 'instagram');

    const { error } = await serviceClient
      .from('channels')
      .update({ status: 'disabled', credentials_ref: null })
      .eq('id', channelId).eq('tenant_id', ctx.tenantId);
    if (error) throw new ProviderError("We couldn't disconnect that channel. Please try again.", { status: 500 });
  },

  async healthCheck(channelId, ctx): Promise<HealthReport> {
    const { data: channel } = await serviceClient
      .from('channels').select('id, status')
      .eq('id', channelId).eq('tenant_id', ctx.tenantId).maybeSingle();
    if (!channel) return { healthy: false, summary: 'This channel is no longer connected.', needs_reconnect: true };
    if (channel.status !== 'active') {
      return { healthy: false, summary: 'Instagram is disconnected.', needs_reconnect: true };
    }

    const token = await loadToken(ctx.tenantId, 'instagram');
    if (!token) {
      return { healthy: false, summary: 'Instagram authorization is missing. Reconnect Instagram.', needs_reconnect: true };
    }
    if (token.isExpired) {
      return { healthy: false, summary: 'Instagram authorization expired. Reconnect Instagram.', needs_reconnect: true };
    }

    // A live call is the only way to know the permissions are still granted.
    try {
      await fetchProfile(token.accessToken);
      return { healthy: true, summary: 'Connected and ready to receive messages.', needs_reconnect: false };
    } catch (e) {
      console.warn('[providers/instagram] healthCheck failed:', e instanceof Error ? e.message : e);
      return {
        healthy: false,
        summary: "Your connection is active, but we couldn't verify messaging permissions.",
        needs_reconnect: true,
      };
    }
  },

  async sendMessage(_channelId, recipientId, text, ctx) {
    const token = await loadToken(ctx.tenantId, 'instagram');
    if (!token?.instagramUserId) {
      throw new ProviderError('Instagram is not connected.', { status: 409 });
    }
    try {
      await sendInstagramMessage(token.accessToken, token.instagramUserId, recipientId, text);
    } catch (e) {
      throw new ProviderError("We couldn't send that message on Instagram. Please try again.", {
        status: 502, detail: e instanceof Error ? e.message : undefined,
      });
    }
  },

  async getAccount(channelId, ctx) {
    const { data } = await serviceClient
      .from('channels')
      .select('id, channel_account_id, display_name, status')
      .eq('id', channelId).eq('tenant_id', ctx.tenantId).maybeSingle();
    return data ? toAccount(data) : null;
  },
};
