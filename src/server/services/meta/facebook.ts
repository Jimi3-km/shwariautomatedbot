import { META_GRAPH_URL, META_GRAPH_VERSION, metaConfig } from '../../config/meta.js';
import { serviceClient } from '../../supabase.js';
import { withAppSecretProof } from './whatsapp.js';
import { decryptToken, encryptToken, loadToken } from './tokens.js';

/**
 * Facebook Pages: sign-in, choosing a Page, Messenger, and the Page lookups
 * everything else builds on.
 *
 * Meta lets an app act on a Page, never on a personal profile. So "connect
 * Facebook" means the owner signs in with Facebook Login for Business and says
 * which Page this business uses; from then on every call is made with that
 * Page's own access token.
 *
 * Three tokens pass through here and none of them leaves the server: the
 * person's user token (used once, to list their Pages, then dropped), the
 * Page tokens of the Pages they could choose from (kept encrypted for a few
 * minutes while they choose), and the chosen Page's token (stored encrypted in
 * meta_tokens). Nothing in this file returns a token to a caller that hands
 * its result to the browser: see PageChoice.
 */

export class FacebookError extends Error {
  readonly metaCode?: string;
  readonly metaSubcode?: string;
  readonly httpStatus?: number;
  constructor(message: string, opts: { code?: string; subcode?: string; httpStatus?: number } = {}) {
    super(message);
    this.name = 'FacebookError';
    this.metaCode = opts.code;
    this.metaSubcode = opts.subcode;
    this.httpStatus = opts.httpStatus;
  }
}

const TIMEOUT_MS = 15_000;

/**
 * One Graph call. The token travels in the Authorization header, never in the
 * address, and every call is signed with the app secret (see
 * withAppSecretProof) so it still works when the Meta app requires that.
 */
async function graph<T>(
  path: string,
  opts: { token?: string; method?: 'GET' | 'POST'; json?: unknown; timeoutMs?: number } = {}
): Promise<T> {
  const init: RequestInit = {
    method: opts.method ?? 'GET',
    headers: {
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.json !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(opts.json !== undefined ? { body: JSON.stringify(opts.json) } : {}),
    signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
  };
  const res = await fetch(`${META_GRAPH_URL}${withAppSecretProof(path, init)}`, init);

  let body: unknown = null;
  try { body = await res.json(); } catch { /* non-JSON body */ }

  const error = (body as { error?: { message?: string; code?: number; error_subcode?: number } } | null)?.error;
  if (!res.ok || error) {
    throw new FacebookError(error?.message ?? `Graph API returned HTTP ${res.status}`, {
      code: error?.code != null ? String(error.code) : undefined,
      subcode: error?.error_subcode != null ? String(error.error_subcode) : undefined,
      httpStatus: res.status,
    });
  }
  return (body ?? {}) as T;
}

// ---------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------

export const FACEBOOK_DIALOG_URL = `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`;

/**
 * Where the owner is sent to sign in.
 *
 * Facebook Login for Business takes a configuration id in place of a scope
 * list: the configuration made in the Meta dashboard decides what is asked
 * for. `override_default_response_type` is what makes the dialog honour
 * response_type=code for a configuration, so the callback receives a code to
 * exchange server-side rather than a token in the address bar.
 */
export function buildFacebookAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: metaConfig.appId,
    config_id: metaConfig.facebook.configId,
    redirect_uri: metaConfig.facebook.redirectUri,
    response_type: 'code',
    override_default_response_type: 'true',
    state,
  });
  return `${FACEBOOK_DIALOG_URL}?${params}`;
}

/** Exchange the code from the callback for the person's user token. */
export async function exchangeFacebookCode(code: string): Promise<string> {
  const params = new URLSearchParams({
    client_id: metaConfig.appId,
    client_secret: metaConfig.appSecret,
    redirect_uri: metaConfig.facebook.redirectUri,
    code,
  });
  const json = await graph<{ access_token?: string }>(`/oauth/access_token?${params}`);
  if (!json.access_token) throw new FacebookError('Meta did not return an access token');
  return json.access_token;
}

/**
 * Swap the user token for a long-lived one.
 *
 * A Page token inherits its lifetime from the user token it was read with: one
 * read with a short-lived user token stops working within hours, one read with
 * a long-lived user token does not expire. So the exchange is made before the
 * Pages are listed.
 */
export async function exchangeForLongLivedUserToken(userToken: string): Promise<string> {
  const params = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: metaConfig.appId,
    client_secret: metaConfig.appSecret,
    fb_exchange_token: userToken,
  });
  const json = await graph<{ access_token?: string }>(`/oauth/access_token?${params}`);
  if (!json.access_token) throw new FacebookError('Meta did not return a long-lived token');
  return json.access_token;
}

/** A Page the person can act for, with its token. Server-side only. */
export interface FacebookPage {
  id: string;
  name: string;
  accessToken: string;
  /** What the person may do on the Page, e.g. MESSAGING, CREATE_CONTENT. */
  tasks: string[];
}

/** A Page as the browser may see it: no token. */
export interface PageChoice {
  id: string;
  name: string;
}

/** Every Page this person manages and granted to the app. */
export async function listPages(userToken: string): Promise<FacebookPage[]> {
  const pages: FacebookPage[] = [];
  let path: string | null = '/me/accounts?fields=id,name,access_token,tasks&limit=100';

  // A handful of pages of results is already far more Pages than anyone picks from.
  for (let i = 0; path && i < 5; i++) {
    const json: {
      data?: Array<{ id?: string | number; name?: string; access_token?: string; tasks?: unknown }>;
      paging?: { cursors?: { after?: string }; next?: string };
    } = await graph(path, { token: userToken });

    for (const p of json.data ?? []) {
      const id = p.id != null ? String(p.id) : '';
      // A Page without a token is one the person can see but not act for.
      if (!id || !p.access_token) continue;
      pages.push({
        id,
        name: (p.name ?? '').trim() || 'Facebook Page',
        accessToken: p.access_token,
        tasks: Array.isArray(p.tasks) ? p.tasks.map(String) : [],
      });
    }
    const after = json.paging?.next ? json.paging?.cursors?.after : null;
    path = after
      ? `/me/accounts?fields=id,name,access_token,tasks&limit=100&after=${encodeURIComponent(after)}`
      : null;
  }
  return pages;
}

/** What the Page is subscribed to, so Messenger events reach our webhook. */
export const PAGE_SUBSCRIBED_FIELDS = ['messages', 'messaging_postbacks', 'feed'] as const;

/**
 * Subscribe the Page to this app. Signing in is not enough: until the Page is
 * subscribed, Meta delivers none of its messages to the webhook and the
 * channel looks connected while staying silent.
 */
export async function subscribePage(pageId: string, pageToken: string): Promise<void> {
  const params = new URLSearchParams({ subscribed_fields: PAGE_SUBSCRIBED_FIELDS.join(',') });
  await graph(`/${encodeURIComponent(pageId)}/subscribed_apps?${params}`, { token: pageToken, method: 'POST' });
}

/** Is the Page still subscribed to this app for messages? */
export async function pageIsSubscribed(pageId: string, pageToken: string): Promise<boolean> {
  const json = await graph<{ data?: Array<{ id?: string | number; subscribed_fields?: unknown }> }>(
    `/${encodeURIComponent(pageId)}/subscribed_apps`, { token: pageToken }
  );
  return (json.data ?? []).some((app) =>
    (!metaConfig.appId || String(app.id ?? '') === metaConfig.appId) &&
    Array.isArray(app.subscribed_fields) && app.subscribed_fields.map(String).includes('messages'));
}

// ---------------------------------------------------------------------------
// Messenger
// ---------------------------------------------------------------------------

/** One text message to a person who wrote to the Page. */
export async function sendMessengerMessage(
  pageToken: string,
  pageId: string,
  psid: string,
  text: string
): Promise<void> {
  await graph(`/${encodeURIComponent(pageId)}/messages`, {
    token: pageToken,
    method: 'POST',
    // RESPONSE: a reply inside the 24-hour window, which is the only kind sent.
    json: { recipient: { id: psid }, messaging_type: 'RESPONSE', message: { text } },
  });
}

/** One photo, by address: Messenger fetches it itself. */
export async function sendMessengerImage(
  pageToken: string,
  pageId: string,
  psid: string,
  imageUrl: string
): Promise<void> {
  await graph(`/${encodeURIComponent(pageId)}/messages`, {
    token: pageToken,
    method: 'POST',
    json: {
      recipient: { id: psid },
      messaging_type: 'RESPONSE',
      message: { attachment: { type: 'image', payload: { url: imageUrl, is_reusable: false } } },
    },
    timeoutMs: 20_000,
  });
}

/** "Amina Otieno", from the profile of someone who has written to the Page. */
export async function fetchMessengerName(pageToken: string, psid: string, timeoutMs = 4000): Promise<string | null> {
  const json = await graph<{ first_name?: string; last_name?: string }>(
    `/${encodeURIComponent(psid)}?fields=first_name,last_name`, { token: pageToken, timeoutMs }
  );
  const name = [json.first_name, json.last_name].map((s) => (s ?? '').trim()).filter(Boolean).join(' ');
  return name || null;
}

// ---------------------------------------------------------------------------
// The Page a business has connected
// ---------------------------------------------------------------------------

export interface ConnectedPage {
  channelId: string;
  pageId: string;
  pageName: string | null;
  accessToken: string;
  isExpired: boolean;
  /** What the person who connected it may do on the Page. Empty when Meta did not say. */
  tasks: string[];
}

/**
 * The Page this business posts to and answers from, with its token.
 *
 * The channel row says which Page; meta_tokens holds the token. Null when
 * either is missing, which is what "not connected" means everywhere else.
 */
export async function loadConnectedPage(tenantId: string): Promise<ConnectedPage | null> {
  const { data, error } = await serviceClient
    .from('channels')
    .select('id, channel_account_id, display_name, status')
    .eq('tenant_id', tenantId).eq('channel_type', 'facebook').eq('status', 'active')
    .limit(1);
  const channel = !error && Array.isArray(data) ? data[0] : null;
  if (!channel?.channel_account_id) return null;

  const token = await loadToken(tenantId, 'facebook');
  if (!token) return null;

  const { data: scopeRows } = await serviceClient
    .from('meta_tokens').select('scopes')
    .eq('tenant_id', tenantId).eq('platform', 'facebook').limit(1);
  const scopes = Array.isArray(scopeRows) && Array.isArray(scopeRows[0]?.scopes) ? scopeRows[0].scopes.map(String) : [];

  return {
    channelId: channel.id,
    pageId: String(channel.channel_account_id),
    pageName: channel.display_name ?? null,
    accessToken: token.accessToken,
    isExpired: token.isExpired,
    tasks: scopes,
  };
}

/** Whether the tasks Meta listed for a Page include publishing. Unknown counts as yes. */
export function pageCanPublish(tasks: string[]): boolean {
  return !tasks.length || tasks.includes('CREATE_CONTENT') || tasks.includes('MANAGE');
}

// ---------------------------------------------------------------------------
// A choice of Page waiting to be made
// ---------------------------------------------------------------------------

/** How long the owner has to pick a Page before signing in again. */
export const PAGE_CHOICE_TTL_MS = 15 * 60 * 1000;

export const DATABASE_UPDATE_NEEDED =
  'The database needs its latest update before a Facebook Page can be connected. Ask whoever runs this workspace to apply it, then try again.';

/** True when facebook_page_choices is not there: migration 0025 has not been applied. */
export function missingChoiceTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === 'PGRST205' || error.code === '42P01' ||
    (/facebook_page_choices/.test(error.message ?? '') && /not exist|not find|schema cache/i.test(error.message ?? ''));
}

export class PageChoiceUnavailableError extends Error {
  constructor() {
    super('facebook_page_choices is missing (migration 0025)');
    this.name = 'PageChoiceUnavailableError';
  }
}

/**
 * Keep the Pages someone may choose from, encrypted, until they choose.
 *
 * Replaces any earlier choice for the business: signing in again starts over.
 */
export async function savePageChoice(tenantId: string, userId: string | null, pages: FacebookPage[]): Promise<void> {
  const { error } = await serviceClient.from('facebook_page_choices').upsert(
    {
      tenant_id: tenantId,
      user_id: /^[0-9a-f-]{36}$/i.test(userId ?? '') ? userId : null,
      pages_encrypted: encryptToken(JSON.stringify(pages)),
      expires_at: new Date(Date.now() + PAGE_CHOICE_TTL_MS).toISOString(),
      created_at: new Date().toISOString(),
    },
    { onConflict: 'tenant_id' }
  );
  if (error) {
    if (missingChoiceTable(error)) throw new PageChoiceUnavailableError();
    console.error('[meta/facebook] could not keep the Page choice:', { code: error.code, message: error.message });
    throw new Error('Could not keep the Page choice');
  }
}

/** The Pages waiting to be chosen from, tokens included. Empty when none, or too late. */
export async function loadPageChoice(tenantId: string): Promise<FacebookPage[]> {
  const { data, error } = await serviceClient
    .from('facebook_page_choices')
    .select('pages_encrypted, expires_at')
    .eq('tenant_id', tenantId)
    .limit(1);
  if (error) {
    if (!missingChoiceTable(error)) {
      console.error('[meta/facebook] could not read the Page choice:', { code: error.code, message: error.message });
    }
    return [];
  }
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return [];
  if (!row.expires_at || Date.parse(row.expires_at) <= Date.now()) {
    await clearPageChoice(tenantId);
    return [];
  }
  try {
    const pages = JSON.parse(decryptToken(row.pages_encrypted)) as FacebookPage[];
    return Array.isArray(pages) ? pages.filter((p) => p && p.id && p.accessToken) : [];
  } catch {
    // Unreadable (the key changed, or the row was tampered with): treat as gone.
    await clearPageChoice(tenantId);
    return [];
  }
}

/** The same list with nothing a browser should not see. */
export async function listPageChoices(tenantId: string): Promise<PageChoice[]> {
  return (await loadPageChoice(tenantId)).map((p) => ({ id: p.id, name: p.name }));
}

export async function clearPageChoice(tenantId: string): Promise<void> {
  const { error } = await serviceClient.from('facebook_page_choices').delete().eq('tenant_id', tenantId);
  if (error && !missingChoiceTable(error)) {
    console.warn('[meta/facebook] could not clear the Page choice:', error.message);
  }
}
