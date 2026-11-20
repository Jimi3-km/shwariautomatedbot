import { serviceClient } from '../../supabase.js';
import { generateSecretToken } from '../telegram.js';
import { whatsappEmbeddedSignupConfigured } from '../../config/meta.js';
import { createOAuthState } from '../../services/meta/oauthState.js';
import {
  buildEmbeddedSignupUrl,
  exchangeSignupCode,
  discoverWabaId,
  listPhoneNumbers,
  subscribeApp,
  listSubscribedApps,
  sendWhatsAppMessage,
  sendWhatsAppTemplate,
  readSignupReturn,
  WhatsAppError,
} from '../../services/meta/whatsapp.js';
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
 * WhatsApp via Meta Embedded Signup.
 *
 * The owner clicks once, completes Meta's dialog, and returns connected. The
 * WABA id, phone number id and business token are all discovered from the
 * Graph API afterwards and stored server-side — none of them is ever asked
 * for, returned to the browser, or shown in the UI.
 */

const SELECT_SAFE = 'id, tenant_id, channel_type, channel_account_id, display_name, status, created_at';

function toAccount(row: {
  id: string; channel_account_id: string; display_name: string | null; status: string;
}): ConnectedAccount {
  return {
    channel_id: row.id,
    provider: 'whatsapp',
    account_id: row.channel_account_id,
    display_name: row.display_name,
    status: row.status === 'active' ? 'active' : 'disabled',
  };
}

export const whatsappProvider: ChannelProvider = {
  id: 'whatsapp',
  label: 'WhatsApp',
  mode: 'oauth',

  availability(): ProviderAvailability {
    const g = whatsappEmbeddedSignupConfigured();
    return { available: g.configured, missing: g.missing };
  },

  async connect(ctx: ConnectContext): Promise<ConnectStart> {
    const a = this.availability();
    if (!a.available) throw new ProviderNotConfiguredError('WhatsApp', a.missing);

    const state = createOAuthState({ provider: 'whatsapp', tenantId: ctx.tenantId, userId: ctx.userId, returnTo: ctx.returnTo ?? null });
    return { mode: 'oauth', authorize_url: buildEmbeddedSignupUrl(state) };
  },

  async callback(params, ctx): Promise<CallbackResult> {
    const signup = readSignupReturn(params);
    if (!signup.code) {
      throw new ProviderError("WhatsApp couldn't be connected. Please try again.");
    }

    let accessToken: string;
    let wabaId: string;
    let phone;

    try {
      // The code is short-lived — Meta gives it 30 seconds — so the exchange
      // happens before anything else.
      ({ accessToken } = await exchangeSignupCode(signup.code));

      // Embedded Signup v4 usually hands back the WABA id directly; the
      // debug_token lookup is the documented fallback when it does not.
      wabaId = signup.wabaId ?? (await discoverWabaId(accessToken));

      const numbers = await listPhoneNumbers(wabaId, accessToken);
      phone = signup.phoneNumberId
        ? numbers.find((n) => n.id === signup.phoneNumberId) ?? numbers[0]
        : numbers[0];

      if (!phone) {
        throw new ProviderError(
          'No WhatsApp number was set up. Finish adding a phone number in the WhatsApp dialog, then try again.',
          { code: 'WHATSAPP_NO_NUMBER' }
        );
      }

      // Inbound messages only arrive once the app is subscribed to the WABA.
      await subscribeApp(wabaId, accessToken);
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      if (e instanceof WhatsAppError) {
        console.error(`[providers/whatsapp] Meta error (${e.metaCode ?? 'n/a'}): ${e.message}`);
      } else {
        console.error('[providers/whatsapp] signup failed:', e);
      }
      throw new ProviderError("WhatsApp couldn't be connected. Please try again.", {
        status: 502, code: 'WHATSAPP_SIGNUP_FAILED',
      });
    }

    const { data: existing } = await serviceClient
      .from('channels')
      .select('id, tenant_id')
      .eq('channel_type', 'whatsapp')
      .eq('channel_account_id', phone.id)
      .maybeSingle();

    if (existing && existing.tenant_id !== ctx.tenantId) {
      throw new ProviderError('That WhatsApp number is already connected to another business.', { status: 409 });
    }

    await storeToken({
      tenantId: ctx.tenantId,
      platform: 'whatsapp',
      accessToken,
      // Embedded Signup business tokens do not carry an expiry.
      expiresAt: null,
      phoneNumberId: phone.id,
      whatsappBusinessAccountId: wabaId,
    });

    const row = {
      tenant_id: ctx.tenantId,
      channel_type: 'whatsapp' as const,
      channel_account_id: phone.id,
      display_name: phone.verifiedName
        ? `${phone.verifiedName} (${phone.displayPhoneNumber})`
        : phone.displayPhoneNumber,
      credentials_ref: `meta_tokens:${ctx.tenantId}:whatsapp`,
      // Authenticates this channel to the automation pipeline, exactly as the
      // Telegram webhook secret does. Not a Meta credential.
      secret_token: generateSecretToken(),
      status: 'active' as const,
    };

    const { data, error } = existing
      ? await serviceClient.from('channels').update(row).eq('id', existing.id).select(SELECT_SAFE).single()
      : await serviceClient.from('channels').insert(row).select(SELECT_SAFE).single();

    if (error || !data) {
      console.error('[providers/whatsapp] save failed', error);
      throw new ProviderError("We couldn't save that connection. Please try again.", { status: 500 });
    }

    return { account: toAccount(data) };
  },

  async disconnect(channelId, ctx) {
    const { data: channel } = await serviceClient
      .from('channels').select('id')
      .eq('id', channelId).eq('tenant_id', ctx.tenantId).maybeSingle();
    if (!channel) throw new ProviderError('That channel is no longer connected.', { status: 404 });

    await deleteToken(ctx.tenantId, 'whatsapp');

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
      return { healthy: false, summary: 'WhatsApp is disconnected.', needs_reconnect: true };
    }

    const token = await loadToken(ctx.tenantId, 'whatsapp');
    if (!token) {
      return { healthy: false, summary: 'WhatsApp authorization is missing. Reconnect WhatsApp.', needs_reconnect: true };
    }

    // The row records the WABA; re-reading it proves the token still works and
    // that we are still subscribed for inbound messages.
    const { data: meta } = await serviceClient
      .from('meta_tokens')
      .select('whatsapp_business_account_id')
      .eq('tenant_id', ctx.tenantId).eq('platform', 'whatsapp').maybeSingle();

    const wabaId = meta?.whatsapp_business_account_id;
    if (!wabaId) {
      return { healthy: false, summary: 'WhatsApp authorization is incomplete. Reconnect WhatsApp.', needs_reconnect: true };
    }

    try {
      const apps = await listSubscribedApps(wabaId, token.accessToken);
      if (!apps.length) {
        return {
          healthy: false,
          summary: "Your connection is active, but we couldn't verify messaging permissions.",
          needs_reconnect: true,
        };
      }
      return { healthy: true, summary: 'Connected and ready to receive messages.', needs_reconnect: false };
    } catch (e) {
      console.warn('[providers/whatsapp] healthCheck failed:', e instanceof Error ? e.message : e);
      return {
        healthy: false,
        summary: "We couldn't reach WhatsApp just now. Try again in a moment.",
        needs_reconnect: false,
      };
    }
  },

  /**
   * Free-form text is only allowed within 24 hours of the customer's last
   * message. Outside that window Meta rejects everything except an approved
   * template, so a late message goes out as the configured template or fails
   * with a reason a person can act on, never as a send that is known to bounce.
   */
  async sendMessage(_channelId, recipientId, text, ctx) {
    const token = await loadToken(ctx.tenantId, 'whatsapp');
    if (!token?.phoneNumberId) throw new ProviderError('WhatsApp is not connected.', { status: 409 });
    const phoneNumberId = token.phoneNumberId;

    const open = windowIsOpen(await lastInboundAt(ctx.tenantId, 'whatsapp', recipientId));

    try {
      if (!open) {
        const template = followUpTemplate();
        if (!template) {
          throw new ProviderError(
            "WhatsApp only allows free-form messages within 24 hours of the customer's last message. This customer hasn't written in that time, so the message was not sent.",
            { status: 409, code: 'OUTSIDE_24H_WINDOW' }
          );
        }
        await withRetry(() =>
          sendWhatsAppTemplate(token.accessToken, phoneNumberId, recipientId, template, text)
        );
        return;
      }

      for (const part of chunkText(text, TEXT_LIMITS.whatsapp)) {
        await withRetry(() => sendWhatsAppMessage(token.accessToken, phoneNumberId, recipientId, part));
      }
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      throw describeSendFailure(e);
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

/** The approved template used once the 24-hour window has closed, if any. */
function followUpTemplate(): { name: string; language: string } | null {
  const name = (process.env.WHATSAPP_FOLLOWUP_TEMPLATE || '').trim();
  if (!name) return null;
  return { name, language: (process.env.WHATSAPP_FOLLOWUP_TEMPLATE_LANG || 'en').trim() || 'en' };
}

/** Meta's numeric error codes, turned into something a business owner can act on. */
function describeSendFailure(e: unknown): ProviderError {
  const detail = e instanceof Error ? e.message : undefined;
  const code = e instanceof WhatsAppError ? e.metaCode : undefined;

  switch (code) {
    case '131047':
      return new ProviderError(
        "WhatsApp rejected the message because the customer hasn't written in the last 24 hours.",
        { status: 409, code: 'OUTSIDE_24H_WINDOW', detail }
      );
    case '131026':
      return new ProviderError(
        "That number can't receive WhatsApp messages right now.",
        { status: 422, code: 'WHATSAPP_UNDELIVERABLE', detail }
      );
    case '131030':
      return new ProviderError(
        'That number is not on the allowed list for this WhatsApp test number.',
        { status: 422, code: 'WHATSAPP_RECIPIENT_NOT_ALLOWED', detail }
      );
    case '190':
      return new ProviderError(
        'WhatsApp authorization has expired. Reconnect WhatsApp in Integrations.',
        { status: 409, code: 'WHATSAPP_REAUTH_REQUIRED', detail }
      );
    case '4':
    case '80007':
    case '130429':
    case '131048':
    case '131056':
      return new ProviderError(
        'WhatsApp is limiting how fast we can send right now. Please try again shortly.',
        { status: 429, code: 'WHATSAPP_RATE_LIMITED', detail }
      );
    case '132000':
    case '132001':
    case '132012':
      return new ProviderError(
        'The WhatsApp follow-up template is missing or does not match. Check WHATSAPP_FOLLOWUP_TEMPLATE.',
        { status: 502, code: 'WHATSAPP_TEMPLATE_INVALID', detail }
      );
    default:
      return new ProviderError("We couldn't send that message on WhatsApp. Please try again.", {
        status: 502, code: 'WHATSAPP_SEND_FAILED', detail,
      });
  }
}
