import { createHash } from 'node:crypto';
import { serviceClient } from '../supabase.js';

/**
 * A record of every attempt to connect a channel.
 *
 * Connecting Instagram, Facebook or WhatsApp happens on Meta's pages, in
 * whatever browser the phone decides to use, and when it goes wrong it goes
 * wrong there, where this server sees nothing. Until now a failed attempt left
 * no trace at all: a business said "it didn't work on my iPhone" and there was
 * nothing to look at.
 *
 * Each attempt is now written down when it starts and again when Meta sends
 * the browser back: which channel, what kind of device and browser started it,
 * what kind came back, and how it ended. No token, code or address is kept,
 * only a hash of the one-time state that ties the two halves together.
 */

export interface DeviceInfo {
  /** ios, android, desktop or other. */
  device: string;
  /** safari, chrome, firefox, edge, samsung, or in_app:<which app>. */
  browser: string;
}

/**
 * What kind of device and browser a request came from.
 *
 * The part that matters is spotting a browser inside another app (Instagram,
 * Facebook, TikTok, a generic Android web view). Those keep their own cookies,
 * often refuse Meta's sign-in outright, and cannot be the browser the owner is
 * signed in to this dashboard with.
 */
export function classifyUserAgent(ua: string | undefined | null): DeviceInfo {
  const s = String(ua ?? '');
  const device = /iPhone|iPad|iPod/i.test(s) ? 'ios'
    : /Android/i.test(s) ? 'android'
    : /Windows|Macintosh|Linux|CrOS/i.test(s) ? 'desktop'
    : 'other';

  const inApp =
    /Instagram/i.test(s) ? 'instagram'
    : /FBAN|FBAV|FB_IAB|FBIOS|FB4A/i.test(s) ? 'facebook'
    : /musical_ly|BytedanceWebview|TikTok/i.test(s) ? 'tiktok'
    : /LinkedInApp/i.test(s) ? 'linkedin'
    : /Snapchat/i.test(s) ? 'snapchat'
    : /Twitter/i.test(s) ? 'twitter'
    : /Line\//i.test(s) ? 'line'
    : /MicroMessenger/i.test(s) ? 'wechat'
    : /GSA\//i.test(s) ? 'google_app'
    // An Android web view marks itself with "; wv)".
    : /; wv\)/i.test(s) ? 'webview'
    // An iOS web view has no "Safari" in its name; real Safari and Chrome do.
    : device === 'ios' && /AppleWebKit/i.test(s) && !/Safari/i.test(s) ? 'webview'
    : null;
  if (inApp) return { device, browser: `in_app:${inApp}` };

  const browser = /EdgiOS|EdgA|Edg\//i.test(s) ? 'edge'
    : /SamsungBrowser/i.test(s) ? 'samsung'
    : /FxiOS|Firefox/i.test(s) ? 'firefox'
    : /CriOS|Chrome/i.test(s) ? 'chrome'
    : /Safari/i.test(s) ? 'safari'
    : 'other';
  return { device, browser };
}

const hashState = (state: string) => createHash('sha256').update(state).digest('hex').slice(0, 40);

/** The one-time state inside a sign-in address, which ties start to finish. */
export function stateOf(authorizeUrl: string): string | null {
  try {
    return new URL(authorizeUrl).searchParams.get('state');
  } catch {
    return null;
  }
}

/** Write down that a connection was started. Never throws. */
export async function recordConnectStart(input: {
  tenantId: string; provider: string; state: string | null; userAgent?: string | null;
}): Promise<void> {
  if (!input.state) return;
  try {
    const d = classifyUserAgent(input.userAgent);
    await serviceClient.from('connect_attempts').insert({
      tenant_id: input.tenantId,
      provider: input.provider,
      state_hash: hashState(input.state),
      start_device: d.device,
      start_browser: d.browser,
      outcome: 'started',
    });
  } catch { /* a record is a convenience; it must not affect the connection */ }
}

/** Write down how it ended, and in which browser Meta sent the person back. Never throws. */
export async function recordConnectFinish(input: {
  state: string | null | undefined; provider: string; tenantId?: string | null;
  outcome: string; detail?: string | null; userAgent?: string | null;
}): Promise<void> {
  try {
    const d = classifyUserAgent(input.userAgent);
    const patch = {
      outcome: input.outcome.slice(0, 60),
      detail: input.detail ? input.detail.slice(0, 400) : null,
      return_device: d.device,
      return_browser: d.browser,
      finished_at: new Date().toISOString(),
    };
    if (input.state) {
      const { data } = await serviceClient.from('connect_attempts')
        .update(patch).eq('state_hash', hashState(input.state)).select('id').maybeSingle();
      if (data) return;
    }
    // A return with no matching start (an expired or unknown state) is still worth a line.
    await serviceClient.from('connect_attempts').insert({
      tenant_id: input.tenantId ?? null,
      provider: input.provider,
      state_hash: input.state ? hashState(input.state) : null,
      start_device: 'unknown', start_browser: 'unknown',
      ...patch,
    });
  } catch { /* never affects the connection */ }
}
