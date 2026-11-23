import { Router } from 'express';
import type { Request, Response } from 'express';

export const goRouter = Router();

/**
 * Sending a phone to a Meta sign-in page without the phone opening an app.
 *
 * On a phone, a link to instagram.com or facebook.com is claimed by the
 * installed app: tapping "Connect Instagram" opened the Instagram app on its
 * home screen, and the sign-in and permission page never appeared. Phones
 * hand a link to an app when the navigation comes from a tap or from the
 * server redirect that follows one. They do not when a page that has already
 * loaded moves on by itself.
 *
 * So the browser is first sent here, to a page of ours, and this page then
 * moves on to Meta with no tap involved. On a desktop it is an invisible extra
 * hop.
 *
 * Only Meta's own sign-in hosts are accepted, so this cannot be used to bounce
 * someone to an arbitrary site.
 */
const ALLOWED_HOSTS = new Set([
  'www.instagram.com',
  'business.facebook.com',
  'www.facebook.com',
  'm.facebook.com',
]);

export function safeMetaUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 4000) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

const esc = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The page that moves on by itself. Exported for the sign-in route. */
export function hopPage(target: string, service: string): string {
  const href = esc(target);
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="1;url=${href}">
<title>Continue to ${esc(service)}</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#000;color:#f0f0f0;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  main{max-width:340px;padding:24px;text-align:center}
  p{color:#999;margin:8px 0 20px}
  a{display:inline-block;padding:11px 18px;border-radius:10px;background:#fff;color:#000;text-decoration:none;font-weight:600}
  small{display:block;margin-top:16px;color:#666;font-size:12.5px}
</style>
</head><body><main>
  <h1 style="font-size:18px;margin:0">Opening ${esc(service)} sign-in…</h1>
  <p>You'll sign in and choose what to allow in your browser.</p>
  <a id="go" href="${href}" rel="noreferrer">Continue</a>
  <small>If the ${esc(service)} app opens instead, come back here, press and hold Continue, and choose “Open in browser”.</small>
</main>
<script>
  // No tap is involved in this navigation, which is what keeps it in the browser.
  setTimeout(function () { window.location.replace(${JSON.stringify(target)}); }, 350);
</script>
</body></html>`;
}

function serviceName(url: string): string {
  const { hostname, pathname } = new URL(url);
  if (hostname.includes('instagram')) return 'Instagram';
  // WhatsApp signup lives on business.facebook.com; the plain Facebook
  // sign-in dialog is how a Page is connected.
  return /\/dialog\/oauth\/?$/.test(pathname) ? 'Facebook' : 'WhatsApp';
}

goRouter.get('/go', (req: Request, res: Response) => {
  const target = safeMetaUrl(req.query.to);
  if (!target) return res.status(400).json({ error: 'That is not a sign-in address this app uses.' });
  res.setHeader('cache-control', 'no-store');
  res.status(200).type('html').send(hopPage(target, serviceName(target)));
});
