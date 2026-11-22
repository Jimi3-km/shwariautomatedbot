import { releaseDisconnectedElsewhere } from './release.js';
import { serviceClient } from '../../supabase.js';
import { generateSecretToken } from '../telegram.js';
import { instagramConnectConfigured, metaConfig } from '../../config/meta.js';
import { createOAuthState } from '../../services/meta/oauthState.js';
import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  fetchProfile,
  sendInstagramMessage,
  subscribeToMessages,
  diagnoseInstagramAccess,
  formatInstagramTrace,
  InstagramOAuthError,
  type InstagramDiagnosis,
  type TokenShape,
} from '../../services/meta/instagram.js';
import { storeToken, loadToken, deleteToken } from '../../services/meta/tokens.js';
import { chunkText, withRetry, lastInboundAt, windowIsOpen, TEXT_LIMITS } from '../outbound.js';
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

    const state = createOAuthState({ provider: 'instagram', tenantId: ctx.tenantId, userId: ctx.userId, returnTo: ctx.returnTo ?? null });
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
    let granted: string[] | null = null;
    // Each step is named, because "it failed" is useless: the three steps fail
    // for different reasons and need different fixes.
    let step = 'exchange the sign-in code';
    let shortToken: string | null = null;
    let shape: TokenShape | undefined;
    let diagnosis: InstagramDiagnosis | null = null;
    try {
      const shortLived = await exchangeCodeForToken(code, metaConfig.instagram.connectRedirectUri);
      shortToken = shortLived.accessToken;
      shape = shortLived.shape;
      granted = shortLived.permissions ?? null;
      step = 'get a long-lived token';
      try {
        longLived = await exchangeForLongLivedToken(shortLived.accessToken);
      } catch (e) {
        // Ask again several ways with the same token. If one of them is
        // answered, the connection goes ahead with it and the record says
        // which; if none is, the record holds what each was told.
        diagnosis = await diagnoseInstagramAccess(shortLived.accessToken);
        if (!diagnosis.longLived) throw e;
        longLived = diagnosis.longLived;
        console.warn(
          `[providers/instagram] the usual long-lived exchange was refused but ${diagnosis.longLived.via} worked: `
          + formatInstagramTrace(shape, diagnosis.probes)
        );
      }
      step = 'read the account';
      profile = await fetchProfile(longLived.accessToken);
    } catch (e) {
      const meta = e instanceof InstagramOAuthError
        ? `Meta error ${e.metaCode ?? 'n/a'} (HTTP ${e.httpStatus ?? 'n/a'}): ${e.message}`
        : e instanceof Error ? e.message : String(e);

      // Instagram signed the person in and handed over a token, then refused
      // to let this app use it. Meta gives the same answer for several causes
      // (an account without a role on an app in Development mode, an account
      // that is not Business or Creator, an app without approved access), so
      // no cause is claimed here: the trace below is what tells them apart.
      const refused = step !== 'exchange the sign-in code';
      // The same few calls made several ways with the first token, so this one
      // attempt says what Instagram refuses and how. No token is recorded.
      if (refused && shortToken && !diagnosis) {
        diagnosis = await diagnoseInstagramAccess(shortToken).catch(() => null);
      }
      const trace = refused ? formatInstagramTrace(shape, diagnosis?.probes ?? []) : '';
      console.error(`[providers/instagram] could not ${step}: ${meta}${trace ? `; trace: ${trace}` : ''}`);
      const grantedList = granted?.join(', ') || 'none reported';
      if (refused) {
        throw new ProviderError(
          'Instagram signed you in but did not let this app use the account.',
          {
            status: 502, code: 'INSTAGRAM_ACCESS_REFUSED',
            detail: `could not ${step}; ${meta}; granted: ${grantedList}; trace: ${trace}`,
          }
        );
      }
      throw new ProviderError(
        "Instagram couldn't be connected. Please try again.",
        { status: 502, code: 'INSTAGRAM_EXCHANGE_FAILED', detail: `could not ${step}; ${meta}` }
      );
    }

    /**
     * Webhooks identify the business by its professional account id, which is
     * `user_id` on /me, not the app-scoped `id`. A channel keyed on the wrong
     * one connects cleanly and then never matches an inbound DM.
     */
    const accountId = profile.professionalAccountId || profile.id;

    // Without this the account is authorized but Meta sends us no messages.
    // Not fatal: reconnecting retries it.
    try {
      await subscribeToMessages(longLived.accessToken);
    } catch (e) {
      console.warn(
        '[providers/instagram] could not subscribe the account to message webhooks:',
        e instanceof Error ? e.message : e
      );
    }

    // An account another business has disconnected is free to connect here.
    await releaseDisconnectedElsewhere('instagram', [accountId, profile.id], ctx.tenantId);

    // One Instagram account belongs to one workspace. Rows connected before
    // the id fix are keyed on the app-scoped id, so both are looked for.
    const { data: matches } = await serviceClient
      .from('channels')
      .select('id, tenant_id, channel_account_id')
      .eq('channel_type', 'instagram')
      .in('channel_account_id', Array.from(new Set([accountId, profile.id])));

    const candidates = Array.isArray(matches) ? matches : [];
    if (candidates.some((r) => r.tenant_id !== ctx.tenantId)) {
      throw new ProviderError('That Instagram account is already connected to another business.', {
        status: 409, code: 'ACCOUNT_IN_USE',
      });
    }
    const existing = candidates.find((r) => r.channel_account_id === accountId) ?? candidates[0] ?? null;

    await storeToken({
      tenantId: ctx.tenantId,
      platform: 'instagram',
      accessToken: longLived.accessToken,
      expiresAt: longLived.expiresAt,
      instagramUserId: accountId,
      instagramUsername: profile.username,
      // What was granted, so the Marketing page can say whether posting is allowed.
      scopes: granted,
    });

    const row = {
      tenant_id: ctx.tenantId,
      channel_type: 'instagram' as const,
      channel_account_id: accountId,
      display_name: profile.username ? `@${profile.username}` : 'Instagram',
      // Points at meta_tokens rather than holding a credential itself.
      credentials_ref: `meta_tokens:${ctx.tenantId}:instagram`,
      // Authenticates this channel to the automation pipeline, exactly as the
      // Telegram webhook secret does. Not a Meta credential.
      secret_token: generateSecretToken(),
      status: 'active' as const,
    };

    const { data, error } = existing
      ? await serviceClient.from('channels').update(row).eq('id', existing.id).select(SELECT_SAFE).single()
      : await serviceClient.from('channels').insert(row).select(SELECT_SAFE).single();

    if (error || !data) {
      console.error('[providers/instagram] save failed', error);
      // Two businesses connecting the same account at once: the unique key decided.
      if ((error as { code?: string } | null)?.code === '23505') {
        throw new ProviderError('That Instagram account is already connected to another business.', {
          status: 409, code: 'ACCOUNT_IN_USE',
        });
      }
      throw new ProviderError("We couldn't save that connection. Please try again.", { status: 500, code: 'SAVE_FAILED' });
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

  /**
   * Instagram allows a reply only within 24 hours of the customer's last
   * message, and has no template escape hatch the way WhatsApp does. A late
   * message therefore fails up front with a readable reason.
   */
  async sendMessage(_channelId, recipientId, text, ctx) {
    const token = await loadToken(ctx.tenantId, 'instagram');
    if (!token?.instagramUserId) {
      throw new ProviderError('Instagram is not connected.', { status: 409 });
    }
    if (token.isExpired) {
      throw new ProviderError(
        'Instagram authorization has expired. Reconnect Instagram in Integrations.',
        { status: 409, code: 'INSTAGRAM_REAUTH_REQUIRED' }
      );
    }
    const igUserId = token.instagramUserId;
    const accessToken = token.accessToken;

    if (!windowIsOpen(await lastInboundAt(ctx.tenantId, 'instagram', recipientId))) {
      throw new ProviderError(
        "Instagram only allows messages within 24 hours of the customer's last message. This customer hasn't written in that time, so the message was not sent.",
        { status: 409, code: 'OUTSIDE_24H_WINDOW' }
      );
    }

    try {
      for (const part of chunkText(text, TEXT_LIMITS.instagram)) {
        await withRetry(() => sendInstagramMessage(accessToken, igUserId, recipientId, part));
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : undefined;
      const code = e instanceof InstagramOAuthError ? e.metaCode : undefined;
      const subcode = e instanceof InstagramOAuthError ? e.metaSubcode : undefined;

      if (code === '190') {
        throw new ProviderError(
          'Instagram authorization has expired. Reconnect Instagram in Integrations.',
          { status: 409, code: 'INSTAGRAM_REAUTH_REQUIRED', detail }
        );
      }
      if (code === '10' || subcode === '2534022' || subcode === '2018278') {
        throw new ProviderError(
          "Instagram rejected the message because the customer hasn't written in the last 24 hours.",
          { status: 409, code: 'OUTSIDE_24H_WINDOW', detail }
        );
      }
      if (code === '4' || code === '613') {
        throw new ProviderError(
          'Instagram is limiting how fast we can send right now. Please try again shortly.',
          { status: 429, code: 'INSTAGRAM_RATE_LIMITED', detail }
        );
      }
      throw new ProviderError("We couldn't send that message on Instagram. Please try again.", {
        status: 502, code: 'INSTAGRAM_SEND_FAILED', detail,
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
