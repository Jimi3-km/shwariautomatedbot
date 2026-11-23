import { metaConfig, META_GRAPH_URL } from '../../config/meta.js';
import { publicApiUrl } from '../../config/publicUrl.js';

/**
 * A health check for the Meta side of the product.
 *
 * Connecting Instagram or WhatsApp fails on Meta's pages, with Meta's wording
 * ("Sorry, this page isn't available", "This isn't working at the moment"),
 * and nothing in our logs. Almost every cause is a mismatch between what this
 * server sends and what the Meta app has registered. This checks each of those
 * from the server, where the app credentials are, and says in plain words what
 * to change and where.
 *
 * It reports whether a value is set and whether it matches, never the value of
 * a secret.
 */

export interface MetaCheck {
  id: string;
  area: 'app' | 'instagram' | 'whatsapp' | 'facebook' | 'webhook';
  label: string;
  /** true = fine, false = needs fixing, null = could not be checked from here. */
  ok: boolean | null;
  detail: string;
  /** What to do about it, when not ok. */
  fix?: string;
  /** A value worth copying into the Meta dashboard. */
  copy?: string;
  /** A webhook this server can switch on itself, without the Meta dashboard. */
  subscribe?: WebhookObject;
}

export type WebhookObject = 'instagram' | 'whatsapp_business_account' | 'page';
export const WEBHOOK_OBJECTS: WebhookObject[] = ['instagram', 'whatsapp_business_account', 'page'];

/**
 * Register this site's webhook for one Meta product and subscribe it to
 * "messages", using the app's own credentials.
 *
 * Verifying the callback URL in the Meta dashboard and subscribing to a field
 * are two separate steps there, and the second is easy to miss: the webhook
 * then looks set up while no message is ever delivered. Meta calls the
 * callback URL with the verify token before it accepts this, so it only
 * succeeds when the site is really reachable.
 */
export async function subscribeWebhook(object: WebhookObject): Promise<{ ok: boolean; message: string }> {
  if (!present(metaConfig.appId) || !present(metaConfig.appSecret) || !present(metaConfig.verifyToken)) {
    return { ok: false, message: 'META_APP_ID, META_APP_SECRET and META_VERIFY_TOKEN must all be set on the server first.' };
  }
  const appToken = `${metaConfig.appId}|${metaConfig.appSecret}`;
  const callback = `${publicApiUrl()}/api/webhooks/meta`;

  // Keep whatever is already switched on: this call replaces the field list.
  const current = await graph(`/${metaConfig.appId}/subscriptions`, appToken);
  const existing = (Array.isArray(current.body?.data) ? current.body.data : []).find((s: any) => s?.object === object);
  const fields = new Set<string>(
    Array.isArray(existing?.fields) ? existing.fields.map((f: any) => String(f?.name ?? f)) : []
  );
  fields.add('messages');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(`${META_GRAPH_URL}/${metaConfig.appId}/subscriptions`, {
      method: 'POST',
      signal: controller.signal,
      body: new URLSearchParams({
        object,
        callback_url: callback,
        fields: [...fields].join(','),
        verify_token: metaConfig.verifyToken,
        include_values: 'true',
        access_token: appToken,
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.success === false) {
      console.warn(`[meta] could not subscribe the ${object} webhook: ${metaMessage(body)}`);
      return { ok: false, message: metaMessage(body) };
    }
    console.log(`[meta] ${object} webhook subscribed to: ${[...fields].join(', ')}`);
    return { ok: true, message: 'Subscribed. Messages will now be delivered to this site.' };
  } catch {
    return { ok: false, message: 'Meta did not answer in time. Try again in a moment.' };
  } finally {
    clearTimeout(timer);
  }
}

export interface MetaDiagnostics {
  checks: MetaCheck[];
  expected: {
    webhook_callback_url: string;
    instagram_connect_redirect_uri: string;
    instagram_signin_redirect_uri: string;
    whatsapp_redirect_uri: string;
    facebook_redirect_uri: string;
  };
  summary: { ok: number; failing: number; unknown: number };
}

const present = (v: string) => Boolean(v && v.trim());

async function graph(path: string, token: string, timeoutMs = 8000): Promise<{ ok: boolean; body: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`${META_GRAPH_URL}${path}${sep}access_token=${encodeURIComponent(token)}`, {
      signal: controller.signal,
    });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, body };
  } catch {
    return { ok: false, body: null };
  } finally {
    clearTimeout(timer);
  }
}

const metaMessage = (body: any): string =>
  String(body?.error?.message ?? 'Meta did not answer.').slice(0, 220);

export async function runMetaDiagnostics(): Promise<MetaDiagnostics> {
  const origin = publicApiUrl();
  const expected = {
    webhook_callback_url: `${origin}/api/webhooks/meta`,
    instagram_connect_redirect_uri: `${origin}/api/channels/oauth/instagram/callback`,
    instagram_signin_redirect_uri: `${origin}/api/auth/instagram/callback`,
    whatsapp_redirect_uri: `${origin}/api/channels/oauth/whatsapp/callback`,
    facebook_redirect_uri: `${origin}/api/channels/oauth/facebook/callback`,
  };
  const checks: MetaCheck[] = [];
  const add = (c: MetaCheck) => checks.push(c);

  // --- the server's own settings ------------------------------------------
  const need = (id: string, area: MetaCheck['area'], name: string, value: string, why: string) =>
    add({
      id, area, label: `${name} is set`, ok: present(value),
      detail: present(value) ? 'Set on the server.' : `Not set. ${why}`,
      ...(present(value) ? {} : { fix: `Add ${name} to the server's environment variables and redeploy.` }),
    });

  need('env.app_id', 'app', 'META_APP_ID', metaConfig.appId, 'Needed to start WhatsApp signup and to check webhooks.');
  need('env.app_secret', 'app', 'META_APP_SECRET', metaConfig.appSecret, 'Needed to verify incoming messages and to finish WhatsApp signup.');
  need('env.verify_token', 'webhook', 'META_VERIFY_TOKEN', metaConfig.verifyToken, 'Meta cannot register the webhook without it.');
  need('env.token_key', 'app', 'META_TOKEN_ENCRYPTION_KEY', metaConfig.tokenEncryptionKey, 'Connections cannot be stored without it.');
  need('env.ig_client_id', 'instagram', 'INSTAGRAM_CLIENT_ID', metaConfig.instagram.clientId,
    'This is the "Instagram app ID" from Instagram > API setup with Instagram login, not the Meta app ID.');
  need('env.ig_client_secret', 'instagram', 'INSTAGRAM_CLIENT_SECRET', metaConfig.instagram.clientSecret, 'The "Instagram app secret" from the same page.');
  need('env.wa_config', 'whatsapp', 'META_WHATSAPP_CONFIG_ID', metaConfig.whatsapp.configId,
    'The configuration ID from Facebook Login for Business > Configurations (a WhatsApp Embedded Signup configuration).');

  need('env.fb_config', 'facebook', 'META_FACEBOOK_CONFIG_ID', metaConfig.facebook.configId,
    'The configuration ID from Facebook Login for Business > Configurations, for the configuration that asks for the Page permissions. It is not the WhatsApp one.');

  if (present(metaConfig.facebook.configId) && metaConfig.facebook.configId === metaConfig.whatsapp.configId) {
    add({
      id: 'fb.config_distinct', area: 'facebook', label: 'The Facebook configuration is not the WhatsApp one', ok: false,
      detail: 'META_FACEBOOK_CONFIG_ID has the same value as META_WHATSAPP_CONFIG_ID. A WhatsApp Embedded Signup configuration does not ask for Page permissions, so signing in would connect no Page.',
      fix: 'In Facebook Login for Business > Configurations create a separate configuration with the six Page permissions and use its ID for META_FACEBOOK_CONFIG_ID.',
    });
  }

  if (present(metaConfig.appId) && present(metaConfig.instagram.clientId) && metaConfig.appId === metaConfig.instagram.clientId) {
    add({
      id: 'ig.client_id_distinct', area: 'instagram', label: 'Instagram app ID is not the Meta app ID', ok: false,
      detail: 'INSTAGRAM_CLIENT_ID has the same value as META_APP_ID. Instagram Login has its own app ID, and using the Meta app ID makes Instagram show "Sorry, this page isn\'t available".',
      fix: 'In the Meta dashboard open Instagram > API setup with Instagram login and copy the Instagram app ID and Instagram app secret from there.',
    });
  }

  // --- redirect addresses: what we send must be exactly what is registered --
  const redirect = (id: string, area: MetaCheck['area'], name: string, value: string, want: string, where: string) =>
    add({
      id, area, label: `${name} points at this site`,
      ok: !origin ? null : value === want,
      detail: !origin
        ? 'The public address of this server is not known, so this could not be compared.'
        : value === want ? 'Matches this site.' : `The server will send "${value || '(nothing)'}" but this site's address is the one below.`,
      ...(value === want ? {} : { fix: `Set ${name} to the address below, and add the same address under ${where}. They must match exactly, including https and no trailing slash.` }),
      copy: want,
    });

  redirect('ig.connect_redirect', 'instagram', 'INSTAGRAM_CONNECT_REDIRECT_URI', metaConfig.instagram.connectRedirectUri,
    expected.instagram_connect_redirect_uri, 'Instagram > API setup with Instagram login > Business login settings > OAuth redirect URIs');
  redirect('wa.redirect', 'whatsapp', 'META_WHATSAPP_REDIRECT_URI', metaConfig.whatsapp.redirectUri,
    expected.whatsapp_redirect_uri, 'Facebook Login for Business > Settings > Valid OAuth redirect URIs');
  redirect('fb.redirect', 'facebook', 'META_FACEBOOK_REDIRECT_URI', metaConfig.facebook.redirectUri,
    expected.facebook_redirect_uri, 'Facebook Login for Business > Settings > Valid OAuth redirect URIs');

  // --- live checks against Meta ---------------------------------------------
  if (present(metaConfig.appId) && present(metaConfig.appSecret)) {
    const appToken = `${metaConfig.appId}|${metaConfig.appSecret}`;

    // --- the Instagram app's own ID and secret ------------------------------
    // Instagram sign-in uses a separate ID and secret from the Meta app's
    // (Instagram > API setup with Instagram login > Business login settings).
    // With the wrong secret, Instagram still signs people in and hands back a
    // token, then refuses every request made with it ("Unsupported request"),
    // so the mistake looks like a fault in the account rather than a setting.
    if (present(metaConfig.instagram.clientId) && present(metaConfig.instagram.clientSecret)) {
      const sameAsMeta = metaConfig.instagram.clientSecret === metaConfig.appSecret;
      const sameId = metaConfig.instagram.clientId === metaConfig.appId;
      // Whether the pair is valid cannot be asked of Meta directly for an
      // Instagram app (it answers the same for a right and a wrong secret), so
      // only the one mistake that can be seen from here is reported.
      add({
        id: 'ig.credentials', area: 'instagram', label: 'Instagram has its own secret, not the Meta app secret',
        ok: sameAsMeta ? false : true,
        detail: sameAsMeta
          ? 'INSTAGRAM_CLIENT_SECRET holds the same value as META_APP_SECRET. Instagram sign-in has its own secret; with the Meta app secret here, people sign in and are then refused.'
          : `A separate secret is set for Instagram${sameId ? ' (note: the Instagram app ID is the same as the Meta app ID, which is unusual)' : ''}.`,
        ...(sameAsMeta ? {
          fix: 'In the Meta dashboard open Instagram > API setup with Instagram login > Business login settings. Copy the Instagram app secret (press Show) into INSTAGRAM_CLIENT_SECRET on the server, then redeploy.',
        } : {}),
      });
    }

    const app = await graph(`/${metaConfig.appId}?fields=name`, appToken);
    add({
      id: 'app.credentials', area: 'app', label: 'Meta accepts the app ID and secret',
      ok: app.ok,
      detail: app.ok ? `Recognised as "${String(app.body?.name ?? 'your app')}".` : metaMessage(app.body),
      ...(app.ok ? {} : { fix: 'META_APP_ID and META_APP_SECRET do not belong together, or the secret was reset. Copy both again from App settings > Basic.' }),
    });

    if (app.ok) {
      const subs = await graph(`/${metaConfig.appId}/subscriptions`, appToken);
      const list: any[] = Array.isArray(subs.body?.data) ? subs.body.data : [];
      const describe = (object: string, product: string, where: string) => {
        const sub = list.find((s) => s?.object === object);
        const fields: string[] = Array.isArray(sub?.fields) ? sub.fields.map((f: any) => String(f?.name ?? f)) : [];
        const rightUrl = sub?.callback_url === expected.webhook_callback_url;
        const hasMessages = fields.includes('messages');
        const ok = Boolean(sub) && rightUrl && hasMessages && sub?.active !== false;
        // Instagram accounts connected with Instagram sign-in get their webhook
        // from the Instagram product page, which Meta does not list here. Its
        // absence is therefore not a fault: say it cannot be seen, not that it
        // is missing.
        if (object === 'instagram' && subs.ok && !sub) {
          add({
            id: `webhook.${object}`, area: 'webhook', label: `${product} messages are delivered to this site`,
            ok: null,
            detail: 'The Instagram webhook is set under Instagram > API setup with Instagram login > Configure webhooks, which cannot be read from here. If Instagram messages reach the inbox, it is working.',
            copy: expected.webhook_callback_url,
          });
          return;
        }
        add({
          id: `webhook.${object}`, area: 'webhook', label: `${product} messages are delivered to this site`,
          ok: subs.ok ? ok : null,
          detail: !subs.ok ? metaMessage(subs.body)
            : !sub ? `No ${product} webhook is registered on the Meta app, so no ${product} message can ever arrive.`
            : !rightUrl ? `The ${product} webhook points at "${String(sub.callback_url)}", not at this site.`
            : !hasMessages ? `The ${product} webhook is registered but not subscribed to the "messages" field.`
            : 'Registered, pointing here, and subscribed to messages.',
          ...(ok || !subs.ok ? {} : {
            fix: `In the Meta dashboard open ${where}, set the callback URL to the address below and the verify token to the same value as META_VERIFY_TOKEN, then subscribe to "messages".`,
          }),
          copy: expected.webhook_callback_url,
          ...(ok ? {} : { subscribe: object as WebhookObject }),
        });
      };
      describe('instagram', 'Instagram', 'Instagram > API setup with Instagram login > Configure webhooks');
      describe('whatsapp_business_account', 'WhatsApp', 'WhatsApp > Configuration > Webhook');
      describe('page', 'Facebook Page', 'Webhooks > Page (or Messenger > Messenger API settings > Configure webhooks)');
    }
  } else {
    add({
      id: 'app.credentials', area: 'app', label: 'Meta accepts the app ID and secret', ok: null,
      detail: 'Cannot be checked until META_APP_ID and META_APP_SECRET are both set.',
    });
  }

  add({
    id: 'wa.flow', area: 'whatsapp', label: 'WhatsApp signup flow',
    ok: null,
    detail: metaConfig.whatsapp.featureType.toLowerCase() === 'standard' || metaConfig.whatsapp.featureType.toLowerCase() === 'none'
      ? 'Using the standard Cloud API signup.'
      : 'Using the signup for businesses already on the WhatsApp Business app (coexistence). Meta only allows this for apps approved as a Tech Provider with that feature; otherwise the signup page opens and then says it is not working.',
    fix: 'If signup opens and then refuses, set META_WHATSAPP_FEATURE_TYPE=standard on the server, redeploy and try again. The configuration ID must be the one named "Meta-hosted Embedded Signup" in Facebook Login for Business > Configurations.',
  });
  add({
    id: 'app.ip_allowlist', area: 'app', label: 'No server IP allowlist on the Meta app', ok: null,
    detail: 'This site runs on servers whose addresses change. If App settings > Advanced > Security > Server IP allowlist has any entries, Meta rejects this server and every connection fails.',
    fix: 'Leave "Server IP allowlist" empty.',
  });

  // --- things only the Meta dashboard can show ------------------------------
  add({
    id: 'ig.testers', area: 'instagram', label: 'The Instagram account is allowed to use the app', ok: null,
    detail: 'While the Meta app is in Development mode, only Instagram accounts added to it as testers can connect. Anyone else gets "Sorry, this page isn\'t available" after logging in. The account must also be a Business or Creator account.',
    fix: 'App roles > Roles > Add people > Instagram tester, then accept the invite inside Instagram (Settings > Website permissions > Apps and websites > Tester invites). Or switch the app to Live once the permissions are approved.',
  });
  add({
    id: 'fb.pages_only', area: 'facebook', label: 'Only a Facebook Page can be connected, and others need App Review', ok: null,
    detail: 'Meta lets an app act on a Page, never on a personal profile: the person signing in must manage the Page and tick it when Facebook asks which Pages to share. While the Meta app is in Development mode, or before its permissions are approved, only people with a role on the app (admin, developer or tester) can connect a Page; anyone else sees an error from Facebook or comes back with no Page.',
    fix: 'Under App Review > Permissions and features request Advanced access for pages_show_list, pages_manage_metadata, pages_messaging, pages_read_engagement, pages_manage_engagement and pages_manage_posts, and switch the app to Live once approved. Until then, add each person who needs to connect a Page under App roles.',
  });
  add({
    id: 'wa.eligibility', area: 'whatsapp', label: 'The Meta app is allowed to onboard WhatsApp numbers', ok: null,
    detail: '"This isn\'t working at the moment. Contact your provider." is what WhatsApp signup shows when the app behind it cannot onboard numbers yet: the business is not verified, the app has not been approved for whatsapp_business_management and whatsapp_business_messaging, or the configuration ID belongs to a different app or is not a WhatsApp Embedded Signup configuration.',
    fix: 'In the Meta dashboard: complete Business verification, request Advanced access for whatsapp_business_management and whatsapp_business_messaging under App Review, and confirm under Facebook Login for Business > Configurations that the configuration is of type "WhatsApp Embedded Signup" and its ID matches META_WHATSAPP_CONFIG_ID. Until then, only people with a role on the app can complete signup.',
  });

  return {
    checks,
    expected,
    summary: {
      ok: checks.filter((c) => c.ok === true).length,
      failing: checks.filter((c) => c.ok === false).length,
      unknown: checks.filter((c) => c.ok === null).length,
    },
  };
}
