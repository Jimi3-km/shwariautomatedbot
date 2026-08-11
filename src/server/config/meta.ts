/**
 * Meta platform configuration.
 *
 * Every value is optional at boot so the server still starts without Meta
 * credentials — the affected routes return a clear 503 instead of the process
 * refusing to run. That mirrors how N8N_TELEGRAM_WEBHOOK_URL already behaves.
 */

export const META_GRAPH_VERSION = 'v21.0';
export const META_GRAPH_URL = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
/** Instagram Basic Display / Instagram Login uses its own host for token exchange. */
export const INSTAGRAM_OAUTH_URL = 'https://api.instagram.com';
export const INSTAGRAM_GRAPH_URL = 'https://graph.instagram.com';

export const metaConfig = {
  appId: process.env.META_APP_ID ?? '',
  appSecret: process.env.META_APP_SECRET ?? '',
  /** System-user token for the platform-owned WhatsApp numbers. */
  accessToken: process.env.META_ACCESS_TOKEN ?? '',
  /** Echoed back during webhook subscription (hub.verify_token). */
  verifyToken: process.env.META_VERIFY_TOKEN ?? '',

  instagram: {
    clientId: process.env.INSTAGRAM_CLIENT_ID ?? '',
    clientSecret: process.env.INSTAGRAM_CLIENT_SECRET ?? '',
    /** Callback for Instagram sign-in (creates an account). */
    redirectUri: process.env.INSTAGRAM_REDIRECT_URI ?? '',
    /** Callback for attaching Instagram to an existing workspace. */
    connectRedirectUri: process.env.INSTAGRAM_CONNECT_REDIRECT_URI ?? '',
  },

  whatsapp: {
    /**
     * Embedded Signup configuration id from the Meta app dashboard. This is
     * what makes the popup walk the user through creating/selecting their
     * WhatsApp Business account rather than asking them for tokens.
     */
    configId: process.env.META_WHATSAPP_CONFIG_ID ?? '',
    redirectUri: process.env.META_WHATSAPP_REDIRECT_URI ?? '',
  },

  /** 32-byte key, hex or base64, used for AES-256-GCM token encryption. */
  tokenEncryptionKey: process.env.META_TOKEN_ENCRYPTION_KEY ?? '',
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

/** Attaching Instagram to an existing workspace, as opposed to signing in. */
export const instagramConnectConfigured = (): ConfigGap =>
  gap([
    ['INSTAGRAM_CLIENT_ID', metaConfig.instagram.clientId],
    ['INSTAGRAM_CLIENT_SECRET', metaConfig.instagram.clientSecret],
    ['INSTAGRAM_CONNECT_REDIRECT_URI', metaConfig.instagram.connectRedirectUri],
    ['META_TOKEN_ENCRYPTION_KEY', metaConfig.tokenEncryptionKey],
  ]);

/** WhatsApp Embedded Signup: the user never pastes a token. */
export const whatsappEmbeddedSignupConfigured = (): ConfigGap =>
  gap([
    ['META_APP_ID', metaConfig.appId],
    ['META_APP_SECRET', metaConfig.appSecret],
    ['META_WHATSAPP_CONFIG_ID', metaConfig.whatsapp.configId],
    ['META_WHATSAPP_REDIRECT_URI', metaConfig.whatsapp.redirectUri],
    ['META_VERIFY_TOKEN', metaConfig.verifyToken],
    ['META_TOKEN_ENCRYPTION_KEY', metaConfig.tokenEncryptionKey],
  ]);

export const whatsappConfigured = (): ConfigGap =>
  gap([
    ['META_APP_ID', metaConfig.appId],
    ['META_APP_SECRET', metaConfig.appSecret],
    ['META_ACCESS_TOKEN', metaConfig.accessToken],
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
