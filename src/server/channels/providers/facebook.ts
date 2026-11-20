import { serviceClient } from '../../supabase.js';
import { generateSecretToken } from '../telegram.js';
import { facebookConnectConfigured } from '../../config/meta.js';
import { createOAuthState } from '../../services/meta/oauthState.js';
import {
  buildFacebookAuthorizeUrl,
  exchangeFacebookCode,
  exchangeForLongLivedUserToken,
  listPages,
  subscribePage,
  pageIsSubscribed,
  sendMessengerMessage,
  savePageChoice,
  loadPageChoice,
  clearPageChoice,
  FacebookError,
  PageChoiceUnavailableError,
  DATABASE_UPDATE_NEEDED,
  type FacebookPage,
} from '../../services/meta/facebook.js';
import { storeToken, loadToken, deleteToken } from '../../services/meta/tokens.js';
import { chunkText, withRetry, lastInboundAt, windowIsOpen, TEXT_LIMITS } from '../outbound.js';
import {
  ProviderError,
  ProviderNotConfiguredError,
  type ChannelProvider,
  type ConnectContext,
  type ConnectStart,
  type CallbackResult,
  type OAuthCallbackResult,
  type ConnectedAccount,
  type HealthReport,
  type ProviderAvailability,
} from './types.js';

/**
 * A Facebook Page as a channel: Messenger in, Messenger out, and the Page the
 * marketing calendar posts to.
 *
 * Meta only lets an app act on a Page, so connecting is two decisions: the
 * owner signs in, and then says which Page this business uses. When they
 * manage exactly one, the second decision is already made. When they manage
 * several, nothing is connected until they choose (see selectFacebookPage).
 *
 * The Page access token is written to meta_tokens (AES-256-GCM, service-role
 * only). The channels row holds the Page id and name and nothing secret.
 */

const SELECT_SAFE = 'id, tenant_id, channel_type, channel_account_id, display_name, status, created_at';

function toAccount(row: {
  id: string; channel_account_id: string; display_name: string | null; status: string;
}): ConnectedAccount {
  return {
    channel_id: row.id,
    provider: 'facebook',
    account_id: row.channel_account_id,
    display_name: row.display_name,
    status: row.status === 'active' ? 'active' : 'disabled',
  };
}

/** The channel_type check has not been widened yet: migration 0025 is pending. */
function rejectedByOldSchema(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === '23514' || /channels_channel_type_check|violates check constraint/i.test(error.message ?? '');
}

const databaseUpdateNeeded = () =>
  new ProviderError(DATABASE_UPDATE_NEEDED, { status: 503, code: 'DATABASE_UPDATE_NEEDED' });

/**
 * Attach one Page to a business.
 *
 * The tenant comes from the caller's signed state or session, never from
 * input. Safe to repeat: connecting the same Page again updates the same row.
 */
export async function connectFacebookPage(
  ctx: Pick<ConnectContext, 'tenantId' | 'userId'>,
  page: FacebookPage
): Promise<CallbackResult> {
  // One Page belongs to one workspace.
  const { data: matches, error: lookupErr } = await serviceClient
    .from('channels')
    .select('id, tenant_id, channel_account_id')
    .eq('channel_type', 'facebook')
    .eq('channel_account_id', page.id);
  if (lookupErr) {
    console.error('[providers/facebook] channel lookup failed', { code: lookupErr.code, message: lookupErr.message });
    throw new ProviderError("We couldn't save that connection. Please try again.", { status: 500 });
  }

  const candidates = Array.isArray(matches) ? matches : [];
  if (candidates.some((r) => r.tenant_id !== ctx.tenantId)) {
    throw new ProviderError('That Facebook Page is already connected to another business.', {
      status: 409, code: 'PAGE_IN_USE',
    });
  }
  const existing = candidates[0] ?? null;

  const row = {
    tenant_id: ctx.tenantId,
    channel_type: 'facebook' as const,
    channel_account_id: page.id,
    display_name: page.name,
    // Points at meta_tokens rather than holding a credential itself.
    credentials_ref: `meta_tokens:${ctx.tenantId}:facebook`,
    // Authenticates this channel to the automation pipeline. Not a Meta credential.
    secret_token: generateSecretToken(),
    status: 'active' as const,
  };

  const { data, error } = existing
    ? await serviceClient.from('channels').update(row).eq('id', existing.id).eq('tenant_id', ctx.tenantId).select(SELECT_SAFE).single()
    : await serviceClient.from('channels').insert(row).select(SELECT_SAFE).single();

  if (error || !data) {
    if (rejectedByOldSchema(error)) throw databaseUpdateNeeded();
    // Two businesses connecting the same Page at once: the unique key decided.
    if (error?.code === '23505') {
      throw new ProviderError('That Facebook Page is already connected to another business.', {
        status: 409, code: 'PAGE_IN_USE',
      });
    }
    console.error('[providers/facebook] save failed', { code: error?.code, message: error?.message });
    throw new ProviderError("We couldn't save that connection. Please try again.", { status: 500 });
  }

  try {
    await storeToken({
      tenantId: ctx.tenantId,
      platform: 'facebook',
      accessToken: page.accessToken,
      // A Page token read with a long-lived user token carries no expiry.
      expiresAt: null,
      facebookPageId: page.id,
      facebookPageName: page.name,
      // What the person may do on the Page, so Marketing can say whether posting is allowed.
      scopes: page.tasks.length ? page.tasks : null,
    });
  } catch (e) {
    // A channel with no token would look connected and answer nobody.
    await serviceClient.from('channels')
      .update({ status: 'disabled', credentials_ref: null })
      .eq('id', data.id).eq('tenant_id', ctx.tenantId);
    console.error('[providers/facebook] token store failed:', e instanceof Error ? e.message : e);
    throw new ProviderError("We couldn't save that connection. Please try again.", { status: 500 });
  }

  // A business has one Page. One connected earlier is switched off, since the
  // stored token now belongs to this one.
  const { error: retireErr } = await serviceClient
    .from('channels')
    .update({ status: 'disabled', credentials_ref: null })
    .eq('tenant_id', ctx.tenantId).eq('channel_type', 'facebook').neq('id', data.id);
  if (retireErr) console.warn('[providers/facebook] could not retire the earlier Page:', retireErr.message);

  // Without this the Page is authorized but Meta sends us no messages.
  // Not fatal: the health check reports it and reconnecting retries it.
  try {
    await subscribePage(page.id, page.accessToken);
  } catch (e) {
    console.warn(
      '[providers/facebook] could not subscribe the Page to message webhooks:',
      e instanceof Error ? e.message : e
    );
  }

  await clearPageChoice(ctx.tenantId);
  return { account: toAccount(data) };
}

/**
 * Finish a connection by choosing one of the Pages offered at sign-in.
 *
 * `pageId` is the only thing taken from the request, and it is only ever used
 * to pick among the Pages this business was itself offered: an id that was not
 * on that list connects nothing.
 */
export async function selectFacebookPage(
  ctx: Pick<ConnectContext, 'tenantId' | 'userId'>,
  pageId: string
): Promise<CallbackResult> {
  const offered = await loadPageChoice(ctx.tenantId);
  if (!offered.length) {
    throw new ProviderError('That choice has expired. Connect Facebook again to pick a Page.', {
      status: 410, code: 'PAGE_CHOICE_EXPIRED',
    });
  }
  const page = offered.find((p) => p.id === String(pageId ?? '').trim());
  if (!page) {
    throw new ProviderError('That is not one of the Pages you can choose from.', {
      status: 400, code: 'PAGE_NOT_OFFERED',
    });
  }
  return connectFacebookPage(ctx, page);
}

export const facebookProvider: ChannelProvider = {
  id: 'facebook',
  label: 'Facebook Page',
  mode: 'oauth',

  availability(): ProviderAvailability {
    const g = facebookConnectConfigured();
    return { available: g.configured, missing: g.missing };
  },

  async connect(ctx: ConnectContext): Promise<ConnectStart> {
    const a = this.availability();
    if (!a.available) throw new ProviderNotConfiguredError('Facebook', a.missing);

    const state = createOAuthState({ provider: 'facebook', tenantId: ctx.tenantId, userId: ctx.userId, returnTo: ctx.returnTo ?? null });
    return { mode: 'oauth', authorize_url: buildFacebookAuthorizeUrl(state) };
  },

  /**
   * The route has already verified the state and resolved ctx from it, so the
   * tenant here is the one that started the flow - never a query parameter.
   */
  async callback(params, ctx): Promise<OAuthCallbackResult> {
    const code = params.code;
    if (!code) throw new ProviderError('Facebook did not complete the authorization. Please try again.');

    let pages: FacebookPage[];
    try {
      let userToken = await exchangeFacebookCode(code);
      try {
        userToken = await exchangeForLongLivedUserToken(userToken);
      } catch (e) {
        // Some configurations already hand back a long-lived token and refuse
        // the exchange. The health check will say so if the Page token lapses.
        console.warn('[providers/facebook] long-lived exchange refused:', e instanceof Error ? e.message : e);
      }
      pages = await listPages(userToken);
      // The user token is not kept: only Page tokens act from here on.
    } catch (e) {
      if (e instanceof FacebookError) {
        console.error(`[providers/facebook] Meta error (${e.metaCode ?? 'n/a'}): ${e.message}`);
      } else {
        console.error('[providers/facebook] token exchange failed:', e instanceof Error ? e.message : e);
      }
      throw new ProviderError("Facebook couldn't be connected. Please try again.", {
        status: 502, code: 'FACEBOOK_EXCHANGE_FAILED',
      });
    }

    if (!pages.length) {
      throw new ProviderError(
        'No Facebook Page was shared. Only a Page can be connected, not a personal profile: sign in as someone who manages the Page and tick it when Facebook asks which Pages to share.',
        { status: 409, code: 'NO_PAGES' }
      );
    }

    if (pages.length === 1) return connectFacebookPage(ctx, pages[0]);

    // Several Pages: which one is this business's is the owner's call, not ours.
    try {
      await savePageChoice(ctx.tenantId, ctx.userId, pages);
    } catch (e) {
      if (e instanceof PageChoiceUnavailableError) throw databaseUpdateNeeded();
      throw new ProviderError("We couldn't finish connecting. Please try again.", { status: 500 });
    }
    return { account: null, pending: 'pick_page' };
  },

  async disconnect(channelId, ctx) {
    const { data: channel } = await serviceClient
      .from('channels').select('id')
      .eq('id', channelId).eq('tenant_id', ctx.tenantId).maybeSingle();
    if (!channel) throw new ProviderError('That channel is no longer connected.', { status: 404 });

    await deleteToken(ctx.tenantId, 'facebook');
    await clearPageChoice(ctx.tenantId);

    const { error } = await serviceClient
      .from('channels')
      .update({ status: 'disabled', credentials_ref: null })
      .eq('id', channelId).eq('tenant_id', ctx.tenantId);
    if (error) throw new ProviderError("We couldn't disconnect that channel. Please try again.", { status: 500 });
  },

  async healthCheck(channelId, ctx): Promise<HealthReport> {
    const { data: channel } = await serviceClient
      .from('channels').select('id, status, channel_account_id')
      .eq('id', channelId).eq('tenant_id', ctx.tenantId).maybeSingle();
    if (!channel) return { healthy: false, summary: 'This channel is no longer connected.', needs_reconnect: true };
    if (channel.status !== 'active') {
      return { healthy: false, summary: 'The Facebook Page is disconnected.', needs_reconnect: true };
    }

    const token = await loadToken(ctx.tenantId, 'facebook');
    if (!token) {
      return { healthy: false, summary: 'Facebook authorization is missing. Reconnect the Page.', needs_reconnect: true };
    }
    if (token.isExpired) {
      return { healthy: false, summary: 'Facebook authorization expired. Reconnect the Page.', needs_reconnect: true };
    }

    // A live call is the only way to know the token and the subscription still stand.
    try {
      const subscribed = await pageIsSubscribed(String(channel.channel_account_id), token.accessToken);
      return subscribed
        ? { healthy: true, summary: 'Connected and ready to receive messages.', needs_reconnect: false }
        : {
            healthy: false,
            summary: 'The Page is connected, but Facebook is not sending its messages here. Reconnect the Page.',
            needs_reconnect: true,
          };
    } catch (e) {
      console.warn('[providers/facebook] healthCheck failed:', e instanceof Error ? e.message : e);
      return {
        healthy: false,
        summary: "Your connection is active, but we couldn't verify messaging permissions.",
        needs_reconnect: true,
      };
    }
  },

  /**
   * Messenger allows a reply only within 24 hours of the customer's last
   * message. A late message therefore fails up front with a readable reason
   * instead of being sent for Meta to refuse.
   */
  async sendMessage(channelId, recipientId, text, ctx) {
    const { data: channel } = await serviceClient
      .from('channels').select('id, channel_account_id, status')
      .eq('id', channelId).eq('tenant_id', ctx.tenantId).maybeSingle();
    const pageId = channel?.channel_account_id ? String(channel.channel_account_id) : '';

    const token = pageId ? await loadToken(ctx.tenantId, 'facebook') : null;
    if (!token || !pageId) {
      throw new ProviderError('The Facebook Page is not connected.', { status: 409 });
    }
    if (token.isExpired) {
      throw new ProviderError(
        'Facebook authorization has expired. Reconnect the Page in Integrations.',
        { status: 409, code: 'FACEBOOK_REAUTH_REQUIRED' }
      );
    }
    const accessToken = token.accessToken;

    if (!windowIsOpen(await lastInboundAt(ctx.tenantId, 'facebook', recipientId))) {
      throw new ProviderError(
        "Facebook only allows messages within 24 hours of the customer's last message. This customer hasn't written in that time, so the message was not sent.",
        { status: 409, code: 'OUTSIDE_24H_WINDOW' }
      );
    }

    try {
      for (const part of chunkText(text, TEXT_LIMITS.facebook)) {
        await withRetry(() => sendMessengerMessage(accessToken, pageId, recipientId, part));
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : undefined;
      const code = e instanceof FacebookError ? e.metaCode : undefined;
      const subcode = e instanceof FacebookError ? e.metaSubcode : undefined;

      if (code === '190') {
        throw new ProviderError(
          'Facebook authorization has expired. Reconnect the Page in Integrations.',
          { status: 409, code: 'FACEBOOK_REAUTH_REQUIRED', detail }
        );
      }
      // Checked before the permission codes: Meta reports a closed window as
      // error 10 with this subcode.
      if (code === '551' || subcode === '2018278') {
        throw new ProviderError(
          "Facebook rejected the message because the customer hasn't written in the last 24 hours.",
          { status: 409, code: 'OUTSIDE_24H_WINDOW', detail }
        );
      }
      if (code === '10' || code === '200') {
        throw new ProviderError(
          'Facebook has not given this app permission to message from this Page. Reconnect the Page in Integrations and allow messaging.',
          { status: 409, code: 'FACEBOOK_PERMISSION_MISSING', detail }
        );
      }
      if (code === '4' || code === '613') {
        throw new ProviderError(
          'Facebook is limiting how fast we can send right now. Please try again shortly.',
          { status: 429, code: 'FACEBOOK_RATE_LIMITED', detail }
        );
      }
      throw new ProviderError("We couldn't send that message on Facebook. Please try again.", {
        status: 502, code: 'FACEBOOK_SEND_FAILED', detail,
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
