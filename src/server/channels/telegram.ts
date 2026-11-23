import crypto from 'node:crypto';

const API = 'https://api.telegram.org';

export interface TelegramBotInfo {
  id: number;
  username: string;
  first_name: string;
}

export class TelegramError extends Error {
  readonly httpStatus: number;
  constructor(message: string, httpStatus: number) {
    super(message);
    this.name = 'TelegramError';
    this.httpStatus = httpStatus;
  }
}

async function call<T>(token: string, method: string, body?: unknown): Promise<T> {
  const r = await fetch(`${API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(15_000),
  });
  const json: any = await r.json().catch(() => ({}));
  if (!r.ok || !json?.ok) {
    // Never echo the token back in an error.
    throw new TelegramError(
      json?.description || `Telegram ${method} failed with HTTP ${r.status}`,
      r.status
    );
  }
  return json.result as T;
}

/** Validates a bot token by asking Telegram who the bot is. */
export function getMe(token: string): Promise<TelegramBotInfo> {
  return call<TelegramBotInfo>(token, 'getMe');
}

/**
 * Points the bot at our inbound webhook and pins the secret header. The
 * webhook route matches that header against channels.secret_token, which is
 * what maps an incoming update to exactly one tenant.
 */
export function setWebhook(token: string, url: string, secretToken: string) {
  return call(token, 'setWebhook', {
    url,
    secret_token: secretToken,
    allowed_updates: ['message'],
    drop_pending_updates: true,
  });
}

export function deleteWebhook(token: string) {
  return call(token, 'deleteWebhook', { drop_pending_updates: false });
}

export function getWebhookInfo(token: string) {
  return call<any>(token, 'getWebhookInfo');
}

export async function sendTelegramMessage(token: string, chatId: string, text: string) {
  return call(token, 'sendMessage', { chat_id: chatId, text });
}

/**
 * Telegram requires the secret header to match [A-Za-z0-9_-]{1,256}.
 * 32 bytes of CSPRNG output, base64url encoded.
 */
export function generateSecretToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}
