/**
 * Meta platform configuration.
 *
 * Every value is optional at boot so the server still starts without Meta
 * credentials — the affected routes return a clear 503 instead of the process
 * refusing to run. That mirrors how N8N_TELEGRAM_WEBHOOK_URL already behaves.
 */

// Kept current with Meta's docs; v21 is several releases behind and each
// version has a ~2 year support window.
export const META_GRAPH_VERSION = 'v25.0';
export const META_GRAPH_URL = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
/**
 * Instagram Login for Business uses three different hosts, and mixing them up
 * is silent breakage:
 *   www.instagram.com    the authorization window the user sees
 *   api.instagram.com    code -> short-lived token
 *   graph.instagram.com  long-lived token, refresh, and all data calls
 */
export const INSTAGRAM_AUTHORIZE_URL = 'https://www.instagram.com';
export const INSTAGRAM_OAUTH_URL = 'https://api.instagram.com';
export const INSTAGRAM_GRAPH_URL = 'https://graph.instagram.com';

import { publicApiUrl } from './publicUrl.js';

/**
 * A callback address, from the environment when given and otherwise worked out
 * from this deployment's own public address. Leaving the variable unset used
 * to send Meta an empty or wrong redirect, which Meta answers with an error
 * page of its own rather than anything we can explain.
 */
function callbackUrl(envName: string, path: string): string {
  const explicit = (process.env[envName] ?? '').trim();
  if (explicit) return explicit;
  const origin = publicApiUrl();
  return origin ? `${origin}${path}` : '';
}

export const metaConfig = {
  appId: (process.env.META_APP_ID ?? '').trim(),
  appSecret: (process.env.META_APP_SECRET ?? '').trim(),
  /** Echoed back during webhook subscription (hub.verify_token). */
  verifyToken: (process.env.META_VERIFY_TOKEN ?? '').trim(),

  instagram: {
    clientId: (process.env.INSTAGRAM_CLIENT_ID ?? '').trim(),
    clientSecret: (process.env.INSTAGRAM_CLIENT_SECRET ?? '').trim(),
    /** Callback for Instagram sign-in (creates an account). */
    redirectUri: callbackUrl('INSTAGRAM_REDIRECT_URI', '/api/auth/instagram/callback'),
    /** Callback for attaching Instagram to an existing workspace. */
    connectRedirectUri: callbackUrl('INSTAGRAM_CONNECT_REDIRECT_URI', '/api/channels/oauth/instagram/callback'),
  },

  whatsapp: {
    /**
     * Embedded Signup configuration id from the Meta app dashboard. This is
     * what makes the popup walk the user through creating/selecting their
     * WhatsApp Business account rather than asking them for tokens.
     */
    configId: (process.env.META_WHATSAPP_CONFIG_ID ?? '').trim(),
    redirectUri: callbackUrl('META_WHATSAPP_REDIRECT_URI', '/api/channels/oauth/whatsapp/callback'),
    /**
     * Which signup flow to open. The default onboards a business that already
     * uses the WhatsApp Business app; set META_WHATSAPP_FEATURE_TYPE=standard
     * for the plain Cloud API signup, which asks less of the Meta app.
     */
    featureType: (process.env.META_WHATSAPP_FEATURE_TYPE ?? '').trim(),
  },

  facebook: {
    /**
     * A Facebook Login for Business configuration id. The configuration, not
     * a scope list, decides which permissions the owner is asked for: the six
     * Page permissions listed in docs/FACEBOOK.md.
     */
    configId: (process.env.META_FACEBOOK_CONFIG_ID ?? '').trim(),
    redirectUri: callbackUrl('META_FACEBOOK_REDIRECT_URI', '/api/channels/oauth/facebook/callback'),
  },

  /** 32-byte key, hex or base64, used for AES-256-GCM token encryption. */
  tokenEncryptionKey: (process.env.META_TOKEN_ENCRYPTION_KEY ?? '').trim(),
} as const;

export interface ConfigGap {
  configured: boolean;
  missing: string[];
}

function gap(pairs: Array<[string, string]>): ConfigGap {
  const missing = pairs.filter(([, v]) => !v).map(([k]) => k);
  return { configured: missing.length === 0, missing };
}

export const instagramOAuthConfigured = (): ConfigGap =>
  gap([
    ['INSTAGRAM_CLIENT_ID', metaConfig.instagram.clientId],
    ['INSTAGRAM_CLIENT_SECRET', metaConfig.instagram.clientSecret],
    ['INSTAGRAM_REDIRECT_URI', metaConfig.instagram.redirectUri],
    ['META_TOKEN_ENCRYPTION_KEY', metaConfig.tokenEncryptionKey],
  ]);

/**
 * Attaching Instagram to an existing workspace, as opposed to signing in.
 *
 * META_APP_SECRET and META_VERIFY_TOKEN are here because connecting is only
 * half the job: inbound DMs arrive on the Meta webhook, whose signature is
 * verified with the app secret and whose subscription handshake echoes the
 * verify token. Without them a business could connect Instagram, see a green
 * tick, and silently never receive a message — so the readiness check covers
 * the whole round trip rather than just the authorization leg.
 */
export const instagramConnectConfigured = (): ConfigGap =>
  gap([
    ['META_APP_ID', metaConfig.appId],
    ['META_APP_SECRET', metaConfig.appSecret],
    // The authorization itself runs on the Instagram app's own id and secret,
    // and the token it returns cannot be stored without the encryption key.
    // Without these the Connect button led to an Instagram error page.
    ['INSTAGRAM_CLIENT_ID', metaConfig.instagram.clientId],
    ['INSTAGRAM_CLIENT_SECRET', metaConfig.instagram.clientSecret],
    ['META_TOKEN_ENCRYPTION_KEY', metaConfig.tokenEncryptionKey],
    ['INSTAGRAM_CONNECT_REDIRECT_URI', metaConfig.instagram.connectRedirectUri],
  ]);

/** WhatsApp Embedded Signup: the user never pastes a token. */
export const whatsappEmbeddedSignupConfigured = (): ConfigGap =>
  gap([
    ['META_APP_ID', metaConfig.appId],
    ['META_APP_SECRET', metaConfig.appSecret],
    // Without a configuration id Meta's signup page opens and then refuses.
    ['META_WHATSAPP_CONFIG_ID', metaConfig.whatsapp.configId],
    ['META_WHATSAPP_REDIRECT_URI', metaConfig.whatsapp.redirectUri],
    ['META_TOKEN_ENCRYPTION_KEY', metaConfig.tokenEncryptionKey],
  ]);

/**
 * Connecting a Facebook Page. The app secret is needed twice over: to finish
 * the sign-in, and to verify the Messenger webhooks that follow.
 */
export const facebookConnectConfigured = (): ConfigGap =>
  gap([
    ['META_APP_ID', metaConfig.appId],
    ['META_APP_SECRET', metaConfig.appSecret],
    // Without a configuration id Facebook has no permissions to ask for.
    ['META_FACEBOOK_CONFIG_ID', metaConfig.facebook.configId],
    ['META_FACEBOOK_REDIRECT_URI', metaConfig.facebook.redirectUri],
    ['META_TOKEN_ENCRYPTION_KEY', metaConfig.tokenEncryptionKey],
  ]);

export const webhookConfigured = (): ConfigGap =>
  gap([
    ['META_APP_SECRET', metaConfig.appSecret],
    ['META_VERIFY_TOKEN', metaConfig.verifyToken],
  ]);

/** Standard 503 body so the UI can explain exactly what an operator must supply. */
export function notConfigured(feature: string, g: ConfigGap) {
  return {
    error: `${feature} is not configured on the server`,
    code: 'META_NOT_CONFIGURED',
    missing_environment_variables: g.missing,
  };
}
