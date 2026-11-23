import { SUPABASE_URL } from '../supabase.js';
import { safeReturnOrigin } from '../config/origins.js';
import { esc, sendBrevoEmail } from './brevo.js';
import { raisePlatformAlert } from './platform.js';

/**
 * Account emails: confirm your address, reset your password, sign-in links.
 *
 * The sign-in service used to send these itself, from its own shared mailer:
 * a handful an hour, from an address that is not ours, with links that fell
 * back to a development address. It now hands each one to this function
 * instead (a "send email" hook), and they go out through the same email
 * account, from the same sender, as receipts and booking confirmations.
 *
 * The link still goes through the sign-in service, which checks the one-time
 * token and then sends the person on to the app. Where it sends them is the
 * address they asked from, but only if that address is one of ours.
 */

/** The public address used when a request does not say where it came from. */
export const OFFICIAL_APP_URL = 'https://ai.tryavora.space';

const PRODUCT = 'Shwari';

type Action = 'signup' | 'recovery' | 'magiclink' | 'invite' | 'email_change' | 'reauthentication';

interface Copy { subject: string; heading: string; body: string; button: string; after: string }

const COPY: Record<Action, Copy> = {
  signup: {
    subject: `Your ${PRODUCT} confirmation code`,
    heading: 'Confirm your email address',
    body: `Thanks for creating a ${PRODUCT} account. Enter this code on the sign-up page to confirm your email address.`,
    button: '',
    after: 'If you did not create an account, you can ignore this email.',
  },
  recovery: {
    subject: `Reset your ${PRODUCT} password`,
    heading: 'Reset your password',
    body: 'We received a request to reset your password. Use the button below to choose a new one.',
    button: 'Choose a new password',
    after: 'If you did not ask for this, you can ignore this email. Your password stays as it is.',
  },
  magiclink: {
    subject: `Your ${PRODUCT} sign-in link`,
    heading: 'Sign in',
    body: 'Use the button below to sign in. The link works once.',
    button: 'Sign in',
    after: 'If you did not ask to sign in, you can ignore this email.',
  },
  invite: {
    subject: `You have been invited to ${PRODUCT}`,
    heading: 'You have been invited',
    body: `You have been invited to ${PRODUCT}. Accept to set up your account.`,
    button: 'Accept invitation',
    after: 'If you were not expecting this, you can ignore this email.',
  },
  email_change: {
    subject: `Confirm your new email for ${PRODUCT}`,
    heading: 'Confirm the change of email address',
    body: 'Confirm this change to the email address on your account.',
    button: 'Confirm change',
    after: 'If you did not ask for this, ignore this email and the address stays as it is.',
  },
  reauthentication: {
    subject: `Your ${PRODUCT} confirmation code`,
    heading: 'Confirm it is you',
    body: 'Enter this code to continue.',
    button: '',
    after: 'If you did not ask for this, you can ignore this email.',
  },
};

function actionOf(raw: unknown): Action | null {
  const t = String(raw ?? '').toLowerCase();
  if (t === 'signup' || t === 'recovery' || t === 'magiclink' || t === 'invite' || t === 'reauthentication') return t;
  if (t.startsWith('email_change')) return 'email_change';
  return null;
}

/** Where the person lands after the token is checked: their own origin, or the official one. */
export function landingUrl(redirectTo: unknown): string {
  const origin = typeof redirectTo === 'string' ? safeReturnOrigin(redirectTo) : null;
  if (!origin) return `${OFFICIAL_APP_URL}/`;
  try {
    const u = new URL(String(redirectTo));
    return `${origin}${u.pathname || '/'}`;
  } catch {
    return `${origin}/`;
  }
}

export function verifyLink(tokenHash: string, type: string, redirectTo: unknown): string {
  const q = new URLSearchParams({ token: tokenHash, type, redirect_to: landingUrl(redirectTo) });
  return `${SUPABASE_URL.replace(/\/+$/, '')}/auth/v1/verify?${q.toString()}`;
}

function layout(copy: Copy, link: string | null, code: string | null, minutes: number): { html: string; text: string } {
  const expiry = `This ${link ? 'link' : 'code'} expires in ${minutes} minutes and can be used once.`;
  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111827">' +
    `<p style="font-size:15px;font-weight:700;margin:0 0 20px">${esc(PRODUCT)}</p>` +
    `<h1 style="font-size:20px;margin:0 0 12px">${esc(copy.heading)}</h1>` +
    `<p style="font-size:14px;line-height:1.6;margin:0 0 20px">${esc(copy.body)}</p>` +
    (link
      ? `<p style="margin:0 0 20px"><a href="${esc(link)}" style="display:inline-block;background:#4f46e5;color:#ffffff;` +
        `text-decoration:none;font-size:14px;font-weight:600;padding:11px 20px;border-radius:8px">${esc(copy.button)}</a></p>` +
        '<p style="font-size:12.5px;line-height:1.6;color:#6b7280;margin:0 0 16px">If the button does not work, copy this address into your browser:<br>' +
        `<span style="word-break:break-all">${esc(link)}</span></p>`
      : '') +
    (code
      ? `<p style="font-size:26px;font-weight:700;letter-spacing:4px;margin:0 0 20px">${esc(code)}</p>`
      : '') +
    `<p style="font-size:12.5px;line-height:1.6;color:#6b7280;margin:0 0 6px">${esc(expiry)}</p>` +
    `<p style="font-size:12.5px;line-height:1.6;color:#6b7280;margin:0">${esc(copy.after)}</p>` +
    '</div>';
  const text = [copy.heading, '', copy.body, '', link ?? '', code ?? '', '', expiry, copy.after]
    .filter((l, i, a) => !(l === '' && a[i - 1] === ''))
    .join('\n');
  return { html, text };
}

export interface AuthEmailResult { sent: number; failed: number; skipped?: string }

/** Send the email (or two, for a change of address) the sign-in service asked for. */
export async function sendAuthEmail(event: any): Promise<AuthEmailResult> {
  const user = event?.user ?? {};
  const data = event?.email_data ?? {};
  const action = actionOf(data.email_action_type);
  if (!action) return { sent: 0, failed: 0, skipped: `unknown action ${String(data.email_action_type).slice(0, 40)}` };

  const copy = COPY[action];
  const minutes = 60;
  const jobs: Array<{ to: string; link: string | null; code: string | null }> = [];

  // Sign-up is confirmed by typing the code. No link is sent: mail scanners
  // open links, which would use the code up before the person sees it.
  if (action === 'reauthentication' || action === 'signup') {
    if (user.email && data.token) jobs.push({ to: user.email, link: null, code: String(data.token) });
  } else if (action === 'email_change') {
    // With both addresses confirming, the service's naming is crossed over:
    // token_hash goes to the new address and token_hash_new to the current one.
    const type = 'email_change';
    if (user.new_email && data.token_hash) {
      jobs.push({ to: user.new_email, link: verifyLink(String(data.token_hash), type, data.redirect_to), code: null });
    }
    if (user.email && data.token_hash_new) {
      jobs.push({ to: user.email, link: verifyLink(String(data.token_hash_new), type, data.redirect_to), code: null });
    }
  } else if (user.email && data.token_hash) {
    jobs.push({ to: user.email, link: verifyLink(String(data.token_hash), action, data.redirect_to), code: null });
  }

  if (!jobs.length) return { sent: 0, failed: 0, skipped: 'nothing to send' };

  let sent = 0;
  let failed = 0;
  let lastError = '';
  for (const job of jobs) {
    const { html, text } = layout(copy, job.link, job.code, minutes);
    const result = await sendBrevoEmail({
      to: [{ email: job.to }],
      subject: copy.subject,
      htmlContent: html,
      textContent: text,
      senderName: PRODUCT,
      tags: ['account', action],
    });
    if (result.success) sent += 1;
    else { failed += 1; lastError = result.error ?? 'unknown error'; }
  }

  if (failed) {
    await raisePlatformAlert({
      kind: 'email',
      dedupeKey: 'account-email-failed',
      summary: 'An account email (confirmation or password reset) could not be sent',
      detail: `Kind: ${action}. The email service answered: ${lastError.slice(0, 500)}`,
    });
  }
  return { sent, failed };
}
