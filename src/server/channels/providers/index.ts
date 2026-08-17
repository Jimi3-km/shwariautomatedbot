import { telegramProvider } from './telegram.js';
import { instagramProvider } from './instagram.js';
import { whatsappProvider } from './whatsapp.js';
import { webchatProvider } from './webchat.js';
import type { ChannelProvider, ProviderId } from './types.js';

export * from './types.js';

/**
 * The registry. Adding a channel means adding a file next to this one and one
 * entry here — routes, onboarding and the Integrations page pick it up without
 * further edits.
 *
 * Order is the order the UI offers them in: the two Meta channels first
 * because they are the one-click options, then web chat, and Telegram last
 * because it asks the user to fetch a token.
 *
 * Web chat is the only entry with no external dependency, so it is the one a
 * business can switch on the day they sign up.
 */
const PROVIDERS: Record<ProviderId, ChannelProvider> = {
  whatsapp: whatsappProvider,
  instagram: instagramProvider,
  webchat: webchatProvider,
  telegram: telegramProvider,
};

export const PROVIDER_ORDER: ProviderId[] = ['whatsapp', 'instagram', 'webchat', 'telegram'];

export function isProviderId(value: string): value is ProviderId {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, value);
}

export function getProvider(id: string): ChannelProvider | null {
  return isProviderId(id) ? PROVIDERS[id] : null;
}

export function allProviders(): ChannelProvider[] {
  return PROVIDER_ORDER.map((id) => PROVIDERS[id]);
}

export { telegramProvider, instagramProvider, whatsappProvider, webchatProvider };
