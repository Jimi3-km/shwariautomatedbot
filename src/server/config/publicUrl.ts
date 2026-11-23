/**
 * The public origin of this API, with no trailing slash.
 *
 * PUBLIC_API_URL is authoritative. On Vercel, where it is easy to forget, the
 * project's production domain is used instead — the platform sets
 * VERCEL_PROJECT_PRODUCTION_URL on every deployment — so Telegram webhooks and
 * the web-chat snippet point at the right place without extra configuration.
 * Returns '' when neither is known.
 */
export function publicApiUrl(): string {
  const explicit = (process.env.PUBLIC_API_URL || '').trim().replace(/\/+$/, '');
  if (explicit) return explicit;

  const vercel = (process.env.VERCEL_PROJECT_PRODUCTION_URL || '').trim().replace(/\/+$/, '');
  if (vercel) return /^https?:\/\//i.test(vercel) ? vercel : `https://${vercel}`;

  return '';
}
