/**
 * Channel provider abstraction.
 *
 * Onboarding, the Integrations page and the health endpoint all talk to this
 * interface rather than to Telegram or Meta directly, so adding a channel is a
 * new file in this folder plus one registry entry — not edits scattered across
 * routes and UI.
 *
 * Two connection shapes exist and the UI needs to tell them apart:
 *
 *   'oauth'       the user is sent to the provider and comes back on a callback
 *   'credential'  the user supplies a token we validate (Telegram/BotFather)
 *
 * Nothing in this file returns a secret. Every method's return type is what the
 * browser is allowed to see; tokens stay in the database and in memory on the
 * server.
 */

export type ProviderId = 'telegram' | 'instagram' | 'whatsapp' | 'webchat';

/**
 * How a channel gets connected:
 *
 *   'oauth'       the user is sent to the provider and comes back on a callback
 *   'credential'  the user supplies a token we validate (Telegram/BotFather)
 *   'instant'     nothing to authorize; we mint the connection ourselves
 */
export type ConnectMode = 'oauth' | 'credential' | 'instant';

/** What the operator still has to configure before a provider can be used. */
export interface ProviderAvailability {
  available: boolean;
  /** Environment variables the server is missing. Never shown to end users. */
  missing: string[];
}

/** Result of starting a connection. */
export type ConnectStart =
  | { mode: 'oauth'; authorize_url: string }
  | { mode: 'credential'; fields: CredentialField[] }
  /**
   * Connected there and then. `embed` is the snippet the user pastes into
   * their site; it contains a public site key, never a secret.
   */
  | { mode: 'instant'; account: ConnectedAccount; embed?: EmbedSnippet };

export interface EmbedSnippet {
  /** Ready-to-paste HTML. */
  html: string;
  /** The public identifier inside it, so the UI can show it separately. */
  site_key: string;
  script_url: string;
}

export interface CredentialField {
  name: string;
  label: string;
  hint?: string;
  placeholder?: string;
  secret: boolean;
}

/** A connected channel, as the browser is allowed to see it. */
export interface ConnectedAccount {
  channel_id: string;
  provider: ProviderId;
  /** The provider's own id for the account. Not a secret. */
  account_id: string;
  display_name: string | null;
  status: 'active' | 'disabled';
}

/**
 * Health as a customer would understand it. `detail` is deliberately
 * user-facing prose; anything technical is logged server-side instead.
 */
export interface HealthReport {
  healthy: boolean;
  summary: string;
  /** Set when the fix is "reconnect", so the UI can offer that button. */
  needs_reconnect: boolean;
}

export interface ConnectContext {
  tenantId: string;
  userId: string;
}

export interface CallbackResult {
  account: ConnectedAccount;
}

export interface ChannelProvider {
  readonly id: ProviderId;
  /** Shown in the UI. Safe to change; nothing keys off it. */
  readonly label: string;
  readonly mode: ConnectMode;

  /** Whether the server is configured to offer this provider at all. */
  availability(): ProviderAvailability;

  /**
   * Begin a connection. For 'oauth' providers this mints the signed state and
   * returns the authorize URL; for 'credential' providers it describes the
   * fields the UI should collect.
   */
  connect(ctx: ConnectContext): Promise<ConnectStart>;

  /**
   * Finish an OAuth connection. Only implemented by 'oauth' providers; the
   * tenant comes from the signed state, never from the query string.
   */
  callback?(params: Record<string, string>, ctx: ConnectContext): Promise<CallbackResult>;

  /**
   * Finish a credential connection. Only implemented by 'credential' providers.
   */
  submitCredentials?(
    values: Record<string, string>,
    ctx: ConnectContext
  ): Promise<CallbackResult>;

  /** Tear down remote state (webhooks, subscriptions) and forget the secrets. */
  disconnect(channelId: string, ctx: ConnectContext): Promise<void>;

  /** Is this connection actually able to receive and send messages right now. */
  healthCheck(channelId: string, ctx: ConnectContext): Promise<HealthReport>;

  /** Outbound message on this channel. */
  sendMessage(channelId: string, recipientId: string, text: string, ctx: ConnectContext): Promise<void>;

  /** Provider-side account metadata, for display. */
  getAccount(channelId: string, ctx: ConnectContext): Promise<ConnectedAccount | null>;
}

/**
 * Raised by providers when the failure has a sensible user-facing wording.
 * Routes turn anything else into a generic message and log the detail.
 */
export class ProviderError extends Error {
  readonly status: number;
  readonly userMessage: string;
  readonly code: string;

  constructor(userMessage: string, opts: { status?: number; code?: string; detail?: string } = {}) {
    super(opts.detail ?? userMessage);
    this.name = 'ProviderError';
    this.userMessage = userMessage;
    this.status = opts.status ?? 400;
    this.code = opts.code ?? 'PROVIDER_ERROR';
  }
}

/** Thrown when the operator has not supplied the provider's configuration. */
export class ProviderNotConfiguredError extends ProviderError {
  readonly missing: string[];

  constructor(label: string, missing: string[]) {
    super(`${label} isn't available yet. Please contact support.`, {
      status: 503,
      code: 'PROVIDER_NOT_CONFIGURED',
      detail: `${label} is missing configuration: ${missing.join(', ')}`,
    });
    this.name = 'ProviderNotConfiguredError';
    this.missing = missing;
  }
}
