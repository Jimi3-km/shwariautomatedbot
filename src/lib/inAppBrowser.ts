/**
 * Is this page running inside another app's built-in browser?
 *
 * Tapping a link in Instagram, Facebook, TikTok and others opens it in a small
 * browser inside that app. Those browsers keep their own sign-ins, Meta's own
 * sign-in pages often refuse to run in them, and when they do run the person
 * comes back somewhere that is not the browser they are signed in to here.
 * Connecting a channel from one fails in ways that look like "it didn't accept
 * my login". So we say so before starting, and ask for the real browser.
 */
export interface InAppBrowser {
  /** The app it is inside, as a person would name it. */
  app: string;
  /** The browser to open instead. */
  openIn: 'Safari' | 'Chrome';
  ios: boolean;
}

export function detectInAppBrowser(userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): InAppBrowser | null {
  const s = userAgent;
  const ios = /iPhone|iPad|iPod/i.test(s);
  const android = /Android/i.test(s);
  const app =
    /Instagram/i.test(s) ? 'Instagram'
    : /FBAN|FBAV|FB_IAB|FBIOS|FB4A/i.test(s) ? 'Facebook'
    : /musical_ly|BytedanceWebview|TikTok/i.test(s) ? 'TikTok'
    : /LinkedInApp/i.test(s) ? 'LinkedIn'
    : /Snapchat/i.test(s) ? 'Snapchat'
    : /Twitter/i.test(s) ? 'X'
    : /Line\//i.test(s) ? 'LINE'
    : /MicroMessenger/i.test(s) ? 'WeChat'
    : /GSA\//i.test(s) ? 'the Google app'
    : android && /; wv\)/i.test(s) ? 'another app'
    : ios && /AppleWebKit/i.test(s) && !/Safari/i.test(s) ? 'another app'
    : null;
  if (!app) return null;
  return { app, openIn: ios ? 'Safari' : 'Chrome', ios };
}

/** Is this a phone or tablet? Used to word instructions. */
export function isPhone(userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): boolean {
  return /iPhone|iPad|iPod|Android/i.test(userAgent);
}
