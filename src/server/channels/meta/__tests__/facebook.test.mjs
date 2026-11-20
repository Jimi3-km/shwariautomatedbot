/**
 * Connect a Facebook Page: sign-in, choosing a Page, Messenger in and out, and
 * publishing to the Page.
 *
 * The real provider, services, parser, inbound pipeline, marketing service and
 * HTTP callback route run. Only PostgREST and Meta's Graph API are doubles:
 * PostgREST is an in-memory table store that honours the filters and unique
 * keys the code relies on, and Graph is a recorder that answers the calls a
 * Page connection makes. Nothing here reaches the network.
 *
 * The rules under test are the ones that must hold whatever else changes: the
 * business is never taken from input, a Page is never guessed, a token never
 * reaches a response, a row or a log line, and a post goes out exactly once.
 *
 * Run with:  npx tsx src/server/channels/meta/__tests__/facebook.test.mjs
 */

import assert from 'node:assert';
import crypto from 'node:crypto';
import http from 'node:http';
import { readFile } from 'node:fs/promises';

const APP_ID = '1561926828265582';
const APP_SECRET = 'fb-test-app-secret';
const CONFIG_ID = '998877665544';
const REDIRECT = 'https://app.example/api/channels/oauth/facebook/callback';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';
// Read once when the Meta config module loads, so they are set before any import.
process.env.META_APP_ID = APP_ID;
process.env.META_APP_SECRET = APP_SECRET;
process.env.META_VERIFY_TOKEN = 'fb-test-verify';
process.env.META_FACEBOOK_CONFIG_ID = CONFIG_ID;
process.env.META_FACEBOOK_REDIRECT_URI = REDIRECT;
// A made-up key, for encrypting the made-up tokens the double hands back.
process.env.META_TOKEN_ENCRYPTION_KEY = 'cd'.repeat(32);
// No model key: a customer message gets the plain holding reply, which is
// enough to prove the message was routed and answered on the right Page.
delete process.env.SHWARI_API_KEY;

// Made-up values that must never appear in a response, a row or a log line.
const USER_SHORT = 'USERTOKEN-short-1a2b3c';
const USER_LONG = 'USERTOKEN-long-4d5e6f';
const TOKEN_ONE = 'PAGETOKEN-one-7g8h9i';
const TOKEN_TWO = 'PAGETOKEN-two-0j1k2l';
const TOKEN_THREE = 'PAGETOKEN-three-3m4n5o';
const SECRETS = [USER_SHORT, USER_LONG, TOKEN_ONE, TOKEN_TWO, TOKEN_THREE, APP_SECRET];

const PAGE_ONE = { id: '100000000000001', name: 'Glamour Crown Wigs', access_token: TOKEN_ONE, tasks: ['MESSAGING', 'CREATE_CONTENT', 'MODERATE'] };
const PAGE_TWO = { id: '100000000000002', name: 'Glamour Crown Salon', access_token: TOKEN_TWO, tasks: ['MESSAGING', 'CREATE_CONTENT'] };
const PAGE_THREE = { id: '100000000000003', name: 'Someone Else Ltd', access_token: TOKEN_THREE, tasks: ['MESSAGING'] };

let pass = 0;
let fail = 0;

// Everything the code logs is kept, so the last test can prove no secret was logged.
const logged = [];
for (const level of ['log', 'warn', 'error', 'info']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    logged.push(args.map((a) => (typeof a === 'string' ? a : a instanceof Error ? `${a.message}\n${a.stack}` : JSON.stringify(a))).join(' '));
    if (level === 'log' && typeof args[0] === 'string' && /^(PASS|FAIL|\n---|\n\d+ passed)/.test(args[0])) original(...args);
  };
}

async function t(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`PASS  ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// The database double
// ---------------------------------------------------------------------------

let tables = {};
let missingTables = new Set();
/** False = migration 0025 has not been applied: 'facebook' is not a channel type yet. */
let facebookAllowed = true;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const LIVE = ['proposed', 'approved', 'publishing', 'published'];
const unique = () => json({ code: '23505', message: 'duplicate key value violates unique constraint' }, 409);

/** The unique keys and CHECK constraints the code relies on, enforced here too. */
function refusal(table, row, self) {
  const others = (tables[table] ?? []).filter((r) => r !== self);
  if (table === 'channels') {
    const allowed = ['telegram', 'whatsapp', 'instagram', 'webchat', ...(facebookAllowed ? ['facebook'] : [])];
    if (!allowed.includes(row.channel_type)) {
      return json({ code: '23514', message: 'new row for relation "channels" violates check constraint "channels_channel_type_check"' }, 400);
    }
    if (others.some((r) => r.channel_type === row.channel_type && r.channel_account_id === row.channel_account_id)) return unique();
  }
  if (table === 'webhook_events') {
    const allowed = ['whatsapp', 'instagram', 'telegram', 'webchat', ...(facebookAllowed ? ['facebook'] : [])];
    if (!allowed.includes(row.provider)) {
      return json({ code: '23514', message: 'violates check constraint "webhook_events_provider_check"' }, 400);
    }
    if (others.some((r) => r.provider === row.provider && r.event_id === row.event_id)) return unique();
  }
  if (table === 'scheduled_posts' && LIVE.includes(row.status)) {
    // One posting time holds one live post per business and platform.
    if (others.some((r) => LIVE.includes(r.status) && r.tenant_id === row.tenant_id &&
      r.platform === row.platform && r.scheduled_for === row.scheduled_for)) return unique();
  }
  if (table === 'notifications' && row.ref_id) {
    if (others.some((r) => r.tenant_id === row.tenant_id && r.kind === row.kind && r.ref_id === row.ref_id)) return unique();
  }
  return null;
}

function withDefaults(table, row) {
  const now = new Date().toISOString();
  const base = { id: crypto.randomUUID(), created_at: now, updated_at: now };
  if (table === 'scheduled_posts') {
    Object.assign(base, {
      platform: 'instagram', status: 'proposed', attempt_count: 0, container_id: null,
      needs_review_reason: null, approved_by: null, approved_at: null, published_at: null,
      external_post_id: null, external_permalink: null, failure_reason: null,
    });
  }
  if (table === 'content_items') {
    Object.assign(base, {
      status: 'draft', times_used: 0, max_uses: null, last_used_at: null, platforms: ['instagram'],
      product_id: null, service_id: null, about: null, caption: '', media_type: 'image',
    });
  }
  if (table === 'conversations') Object.assign(base, { ai_enabled: true, unread_count: 0, customer_name: null, lead_id: null });
  if (table === 'channels') Object.assign(base, { status: 'active', bot_token: null });
  if (['posting_settings', 'facebook_page_choices', 'meta_tokens'].includes(table)) delete base.id;
  return { ...base, ...row };
}

function matcher(params) {
  const tests = [];
  for (const [key, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(key)) continue;
    const dot = raw.indexOf('.');
    const op = raw.slice(0, dot);
    const value = raw.slice(dot + 1);
    const cmp = (a) => (typeof a === 'number' ? a - Number(value) : String(a ?? '').localeCompare(value));
    if (op === 'eq') tests.push((r) => String(r[key]) === value);
    else if (op === 'neq') tests.push((r) => String(r[key]) !== value);
    else if (op === 'in') {
      const set = value.replace(/^\(|\)$/g, '').split(',').map((v) => v.replace(/^"|"$/g, ''));
      tests.push((r) => set.includes(String(r[key])));
    }
    else if (op === 'is') tests.push((r) => (value === 'null' ? r[key] == null : String(r[key]) === value));
    else if (op === 'gt') tests.push((r) => r[key] != null && cmp(r[key]) > 0);
    else if (op === 'gte') tests.push((r) => r[key] != null && cmp(r[key]) >= 0);
    else if (op === 'lt') tests.push((r) => r[key] != null && cmp(r[key]) < 0);
    else if (op === 'lte') tests.push((r) => r[key] != null && cmp(r[key]) <= 0);
    else throw new Error(`the database double does not know the filter ${key}=${raw}`);
  }
  return (row) => tests.every((fn) => fn(row));
}

function headerOf(init, name) {
  const h = init.headers;
  if (!h) return '';
  if (typeof h.get === 'function') return h.get(name) ?? '';
  const hit = Object.entries(h).find(([k]) => k.toLowerCase() === name.toLowerCase());
  return hit ? String(hit[1]) : '';
}

function database(url, init) {
  const method = init.method ?? 'GET';
  const table = url.pathname.replace('/rest/v1/', '');
  if (missingTables.has(table)) {
    return json({ code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` }, 404);
  }
  tables[table] ??= [];
  const matches = matcher([...url.searchParams.entries()]);
  const body = init.body ? JSON.parse(init.body) : null;
  let out = [];

  if (method === 'GET' || method === 'HEAD') {
    out = tables[table].filter(matches);
    const order = url.searchParams.get('order');
    if (order) {
      const [column, direction] = order.split('.');
      out = [...out].sort((a, b) => String(a[column] ?? '').localeCompare(String(b[column] ?? '')) * (direction === 'desc' ? -1 : 1));
    }
    const limit = Number(url.searchParams.get('limit'));
    if (limit) out = out.slice(0, limit);
  } else if (method === 'POST') {
    const conflict = url.searchParams.get('on_conflict');
    for (const raw of Array.isArray(body) ? body : [body]) {
      const existing = conflict
        ? tables[table].find((r) => conflict.split(',').every((c) => r[c] === raw[c]))
        : null;
      if (existing) { Object.assign(existing, raw); out.push(existing); continue; }
      const row = withDefaults(table, raw);
      const refused = refusal(table, row, null);
      if (refused) return refused;
      tables[table].push(row);
      out.push(row);
    }
  } else if (method === 'PATCH') {
    for (const row of tables[table].filter(matches)) {
      const refused = refusal(table, { ...row, ...body }, row);
      if (refused) return refused;
      Object.assign(row, body);
      out.push(row);
    }
  } else if (method === 'DELETE') {
    out = tables[table].filter(matches);
    tables[table] = tables[table].filter((r) => !out.includes(r));
  }

  if (headerOf(init, 'accept').includes('vnd.pgrst.object')) {
    // What PostgREST answers when exactly one row was asked for and none matched.
    return out.length ? json({ ...out[0] }) : json({ code: 'PGRST116', message: 'no rows' }, 406);
  }
  return json(out.map((r) => ({ ...r })));
}

// ---------------------------------------------------------------------------
// The Graph API double
// ---------------------------------------------------------------------------

let fb;
const resetGraph = () => {
  fb = {
    calls: [],
    /** What /me/accounts lists for the person who signed in. */
    pages: [PAGE_ONE],
    refuseLongLived: false,
    failSend: null,
    failPublish: null,
    subscribed: true,
    posts: 0,
  };
};
resetGraph();

const metaError = (code, message, status = 400, subcode) =>
  json({ error: { message, type: 'OAuthException', code, ...(subcode ? { error_subcode: subcode } : {}) } }, status);

function graph(url, init) {
  const method = init.method ?? 'GET';
  const path = url.pathname.replace(/^\/v[\d.]+\//, '');
  const token = headerOf(init, 'authorization').replace(/^Bearer\s+/i, '');
  const contentType = headerOf(init, 'content-type');
  const body = !init.body ? null
    : contentType.includes('json') ? JSON.parse(String(init.body))
    : Object.fromEntries(new URLSearchParams(String(init.body)));
  const call = { method, path, query: Object.fromEntries(url.searchParams), token, body, href: url.href };
  fb.calls.push(call);

  if (path === 'oauth/access_token') {
    if (call.query.grant_type === 'fb_exchange_token') {
      return fb.refuseLongLived ? metaError(100, 'Unsupported exchange') : json({ access_token: USER_LONG, token_type: 'bearer' });
    }
    return call.query.code === 'good-code' ? json({ access_token: USER_SHORT, token_type: 'bearer' }) : metaError(100, 'This authorization code has been used.');
  }
  if (method === 'GET' && path === 'me/accounts') return json({ data: fb.pages });

  const [node, edge] = path.split('/');
  if (edge === 'subscribed_apps') {
    if (method === 'POST') return json({ success: true });
    return json({ data: fb.subscribed ? [{ id: APP_ID, subscribed_fields: ['messages', 'messaging_postbacks', 'feed'] }] : [] });
  }
  if (method === 'POST' && edge === 'messages') {
    if (fb.failSend) return metaError(fb.failSend.code, fb.failSend.message ?? 'refused', fb.failSend.status ?? 400, fb.failSend.subcode);
    return json({ recipient_id: body?.recipient?.id, message_id: `mid.out.${fb.calls.length}` });
  }
  if (method === 'POST' && (edge === 'photos' || edge === 'videos')) {
    if (fb.failPublish) return json(fb.failPublish.body, fb.failPublish.status);
    fb.posts++;
    return edge === 'photos'
      ? json({ id: `photo-${fb.posts}`, post_id: `${node}_post${fb.posts}` })
      : json({ id: `video-${fb.posts}` });
  }
  if (method === 'GET' && !edge && call.query.fields === 'permalink_url') {
    return json({ id: node, permalink_url: node.startsWith('video-') ? `/${node}/` : `https://www.facebook.com/${node}` });
  }
  if (method === 'GET' && !edge && call.query.fields === 'first_name,last_name') {
    return json({ first_name: 'Amina', last_name: 'Otieno', id: node });
  }
  return metaError(1, 'unexpected call');
}

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (url.hostname === 'graph.facebook.com') return graph(url, init);
  if (url.hostname === 'example.supabase.co') return database(url, init);
  throw new Error(`a test reached ${url.hostname}, which nothing here should`);
};

const callsTo = (method, suffix) => fb.calls.filter((c) => c.method === method && c.path.endsWith(suffix));

// ---------------------------------------------------------------------------

const { facebookProvider, connectFacebookPage, selectFacebookPage } = await import('../../providers/facebook.ts');
const { getProvider, isProviderId, PROVIDER_ORDER, allProviders, ProviderError } = await import('../../providers/index.ts');
const { listPageChoices, PAGE_SUBSCRIBED_FIELDS } = await import('../../../services/meta/facebook.ts');
const { decryptToken, encryptToken } = await import('../../../services/meta/tokens.ts');
const { verifyOAuthState, createOAuthState } = await import('../../../services/meta/oauthState.ts');
const { safeMetaUrl } = await import('../../../routes/go.ts');
const { parseFacebook, parseMetaWebhook } = await import('../parsers.ts');
const { resolveChannel, normalize, resetEventTracking } = await import('../../../services/inbound.ts');
const { processInbound } = await import('../../../services/pipeline.ts');
const { TEXT_LIMITS } = await import('../../outbound.ts');
const { sendImageToCustomer } = await import('../../media.ts');
const {
  planWeek, publishDuePosts, publishNow, schedulePost, facebookStatus, postingPlatforms,
} = await import('../../../services/marketing.ts');
const { facebookConnectConfigured } = await import('../../../config/meta.ts');

const TENANT_A = '00000000-0000-4000-8000-00000000000a';
const TENANT_B = '00000000-0000-4000-8000-00000000000b';
const USER_A = '00000000-0000-4000-8000-0000000000a1';
const USER_B = '00000000-0000-4000-8000-0000000000b1';
const CTX_A = { tenantId: TENANT_A, userId: USER_A };
const CTX_B = { tenantId: TENANT_B, userId: USER_B };

function seed() {
  resetGraph();
  resetEventTracking();
  missingTables = new Set();
  facebookAllowed = true;
  tables = {
    tenants: [
      { id: TENANT_A, timezone: 'Africa/Nairobi', currency: 'KES', business_name: 'Glamour Crown' },
      { id: TENANT_B, timezone: 'Africa/Nairobi', currency: 'KES', business_name: 'Other Shop' },
    ],
    channels: [], meta_tokens: [], facebook_page_choices: [], webhook_events: [],
    conversations: [], conversation_messages: [], leads: [],
    content_items: [], scheduled_posts: [], posting_settings: [], notifications: [],
    products: [], services: [], business_facts: [],
  };
}

const channelsOf = (tenantId) => tables.channels.filter((c) => c.tenant_id === tenantId && c.channel_type === 'facebook');
const tokenOf = (tenantId) => tables.meta_tokens.find((r) => r.tenant_id === tenantId && r.platform === 'facebook');
const noSecretIn = (value, what) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const s of SECRETS) assert.ok(!text.includes(s), `${what} contains a secret`);
};
async function refused(fn, code) {
  try {
    await fn();
  } catch (e) {
    assert.ok(e instanceof ProviderError, `expected a ProviderError, got ${e?.name}: ${e?.message}`);
    assert.equal(e.code, code);
    noSecretIn(e.userMessage, 'the error shown to the owner');
    return e;
  }
  assert.fail(`expected ${code}, but it succeeded`);
}

/** Connect PAGE_ONE to tenant A the ordinary way. */
async function connectOne(ctx = CTX_A, page = PAGE_ONE) {
  fb.pages = [page];
  return facebookProvider.callback({ code: 'good-code' }, ctx);
}

// ---------------------------------------------------------------------------
console.log('\n--- starting the connection ---');

await t('the provider is available when everything it needs is set', () => {
  assert.deepEqual(facebookConnectConfigured(), { configured: true, missing: [] });
  assert.deepEqual(facebookProvider.availability(), { available: true, missing: [] });
  assert.equal(facebookProvider.mode, 'oauth');
});

await t('the authorize URL carries the app id, config id, redirect and a signed state', async () => {
  const start = await facebookProvider.connect({ ...CTX_A, returnTo: null });
  assert.equal(start.mode, 'oauth');
  const url = new URL(start.authorize_url);
  assert.equal(url.hostname, 'www.facebook.com');
  assert.match(url.pathname, /^\/v\d+\.\d+\/dialog\/oauth$/);
  const q = url.searchParams;
  assert.equal(q.get('client_id'), APP_ID);
  assert.equal(q.get('config_id'), CONFIG_ID);
  assert.equal(q.get('redirect_uri'), REDIRECT);
  assert.equal(q.get('response_type'), 'code');
  assert.equal(q.get('override_default_response_type'), 'true');
  assert.equal(q.get('scope'), null, 'the configuration decides the permissions, not a scope list');

  const state = verifyOAuthState(q.get('state'));
  assert.ok(state, 'the state verifies');
  assert.equal(state.provider, 'facebook');
  assert.equal(state.tenantId, TENANT_A);
  assert.equal(state.userId, USER_A);
  noSecretIn(start.authorize_url, 'the address sent to the browser');
});

await t('a state for another provider or an edited state does not verify as Facebook', async () => {
  const start = await facebookProvider.connect({ ...CTX_A, returnTo: null });
  const state = new URL(start.authorize_url).searchParams.get('state');
  assert.equal(verifyOAuthState(`${state.slice(0, -2)}xx`), null);
  assert.equal(verifyOAuthState(createOAuthState({ provider: 'instagram', ...CTX_A })).provider, 'instagram');
});

await t('the phone hop accepts the Facebook sign-in address and nothing that only looks like it', async () => {
  const start = await facebookProvider.connect({ ...CTX_A, returnTo: null });
  assert.equal(safeMetaUrl(start.authorize_url), start.authorize_url);
  assert.equal(safeMetaUrl('https://www.facebook.com.evil.example/v25.0/dialog/oauth'), null);
  assert.equal(safeMetaUrl('http://www.facebook.com/v25.0/dialog/oauth'), null);
});

// ---------------------------------------------------------------------------
console.log('\n--- one Page ---');

await t('signing in with one Page connects it, stores the token encrypted and subscribes the Page', async () => {
  seed();
  const result = await connectOne();

  assert.equal(result.account.provider, 'facebook');
  assert.equal(result.account.account_id, PAGE_ONE.id);
  assert.equal(result.account.display_name, 'Glamour Crown Wigs');
  assert.equal(result.account.status, 'active');
  noSecretIn(result, 'the result');

  const [channel] = channelsOf(TENANT_A);
  assert.equal(channelsOf(TENANT_A).length, 1);
  assert.equal(channel.channel_account_id, PAGE_ONE.id);
  assert.equal(channel.display_name, 'Glamour Crown Wigs');
  assert.equal(channel.status, 'active');
  assert.equal(channel.credentials_ref, `meta_tokens:${TENANT_A}:facebook`);
  assert.equal(channel.bot_token, null);
  noSecretIn(channel, 'the channels row');

  const stored = tokenOf(TENANT_A);
  assert.ok(stored, 'a token row exists');
  noSecretIn(stored, 'the meta_tokens row');
  assert.equal(decryptToken(stored.access_token_encrypted), TOKEN_ONE, 'it decrypts to the Page token');
  assert.equal(stored.facebook_page_id, PAGE_ONE.id);
  assert.equal(stored.facebook_page_name, 'Glamour Crown Wigs');
  assert.deepEqual(stored.scopes, PAGE_ONE.tasks);

  const [subscribe] = callsTo('POST', '/subscribed_apps');
  assert.ok(subscribe, 'the Page was subscribed');
  assert.equal(subscribe.path, `${PAGE_ONE.id}/subscribed_apps`);
  assert.equal(subscribe.query.subscribed_fields, 'messages,messaging_postbacks,feed');
  assert.deepEqual([...PAGE_SUBSCRIBED_FIELDS], ['messages', 'messaging_postbacks', 'feed']);
  assert.equal(subscribe.token, TOKEN_ONE, 'with the Page token, in the header');
  assert.equal(
    subscribe.query.appsecret_proof,
    crypto.createHmac('sha256', APP_SECRET).update(TOKEN_ONE).digest('hex'),
    'signed with the app secret'
  );
  assert.equal(tables.facebook_page_choices.length, 0, 'no choice is left waiting');
});

await t('the code is exchanged with the redirect it was issued for, and the Pages are read with a long-lived token', async () => {
  seed();
  await connectOne();
  const [exchange, longLived] = fb.calls.filter((c) => c.path === 'oauth/access_token');
  assert.equal(exchange.query.client_id, APP_ID);
  assert.equal(exchange.query.redirect_uri, REDIRECT);
  assert.equal(exchange.query.code, 'good-code');
  assert.equal(longLived.query.grant_type, 'fb_exchange_token');
  assert.equal(longLived.query.fb_exchange_token, USER_SHORT);

  const [accounts] = callsTo('GET', 'me/accounts');
  assert.equal(accounts.query.fields, 'id,name,access_token,tasks');
  assert.equal(accounts.token, USER_LONG);
  assert.ok(!accounts.href.includes(USER_LONG), 'the token is not in the address');
  // The person's own token is used to list Pages and then dropped.
  noSecretIn(tables, 'the database');
});

await t('a refused long-lived exchange does not stop the connection', async () => {
  seed();
  fb.refuseLongLived = true;
  const result = await connectOne();
  assert.equal(result.account.account_id, PAGE_ONE.id);
  assert.equal(callsTo('GET', 'me/accounts')[0].token, USER_SHORT);
});

await t('connecting the same Page again updates the one row instead of adding another', async () => {
  seed();
  const first = await connectOne();
  const second = await connectOne();
  assert.equal(channelsOf(TENANT_A).length, 1);
  assert.equal(second.account.channel_id, first.account.channel_id);
  assert.equal(tables.meta_tokens.filter((r) => r.platform === 'facebook').length, 1);
});

await t('a rejected code connects nothing', async () => {
  seed();
  await refused(() => facebookProvider.callback({ code: 'stale-code' }, CTX_A), 'FACEBOOK_EXCHANGE_FAILED');
  await refused(() => facebookProvider.callback({}, CTX_A), 'PROVIDER_ERROR');
  assert.equal(tables.channels.length, 0);
  assert.equal(tables.meta_tokens.length, 0);
});

await t('signing in without sharing a Page says so and connects nothing', async () => {
  seed();
  fb.pages = [];
  const e = await refused(() => facebookProvider.callback({ code: 'good-code' }, CTX_A), 'NO_PAGES');
  assert.match(e.userMessage, /Page/);
  assert.match(e.userMessage, /personal profile/);
  // A Page the person can see but holds no token for is not one they can connect.
  fb.pages = [{ id: '555', name: 'Read only' }];
  await refused(() => facebookProvider.callback({ code: 'good-code' }, CTX_A), 'NO_PAGES');
  assert.equal(tables.channels.length, 0);
});

// ---------------------------------------------------------------------------
console.log('\n--- several Pages ---');

await t('with several Pages nothing is connected: the choice waits, encrypted, on the server', async () => {
  seed();
  fb.pages = [PAGE_ONE, PAGE_TWO];
  const result = await facebookProvider.callback({ code: 'good-code' }, CTX_A);

  assert.deepEqual(result, { account: null, pending: 'pick_page' });
  assert.equal(tables.channels.length, 0, 'no channel was guessed');
  assert.equal(tables.meta_tokens.length, 0, 'no token was stored as the business\'s');
  assert.equal(callsTo('POST', '/subscribed_apps').length, 0, 'no Page was subscribed');

  assert.equal(tables.facebook_page_choices.length, 1);
  const waiting = tables.facebook_page_choices[0];
  assert.equal(waiting.tenant_id, TENANT_A);
  noSecretIn(waiting, 'the pending choice row');
  assert.ok(Date.parse(waiting.expires_at) > Date.now());
  assert.ok(Date.parse(waiting.expires_at) - Date.now() <= 15 * 60 * 1000 + 1000, 'and it does not wait for long');
});

await t('the Pages offered to the browser are names and ids, with no token', async () => {
  seed();
  fb.pages = [PAGE_ONE, PAGE_TWO];
  await facebookProvider.callback({ code: 'good-code' }, CTX_A);

  const offered = await listPageChoices(TENANT_A);
  assert.deepEqual(offered, [
    { id: PAGE_ONE.id, name: 'Glamour Crown Wigs' },
    { id: PAGE_TWO.id, name: 'Glamour Crown Salon' },
  ]);
  noSecretIn(offered, 'the list sent to the browser');
  assert.deepEqual(await listPageChoices(TENANT_B), [], 'another business is offered nothing');
});

await t('choosing a Page connects that one, with its own token', async () => {
  seed();
  fb.pages = [PAGE_ONE, PAGE_TWO];
  await facebookProvider.callback({ code: 'good-code' }, CTX_A);

  const result = await selectFacebookPage(CTX_A, PAGE_TWO.id);
  assert.equal(result.account.account_id, PAGE_TWO.id);
  assert.equal(result.account.display_name, 'Glamour Crown Salon');
  noSecretIn(result, 'the response');

  assert.equal(channelsOf(TENANT_A).length, 1);
  assert.equal(channelsOf(TENANT_A)[0].channel_account_id, PAGE_TWO.id);
  assert.equal(decryptToken(tokenOf(TENANT_A).access_token_encrypted), TOKEN_TWO);
  assert.equal(callsTo('POST', '/subscribed_apps')[0].path, `${PAGE_TWO.id}/subscribed_apps`);
  assert.equal(tables.facebook_page_choices.length, 0, 'the choice is used up');
  await refused(() => selectFacebookPage(CTX_A, PAGE_ONE.id), 'PAGE_CHOICE_EXPIRED');
});

await t('a Page id that was not offered is refused and connects nothing', async () => {
  seed();
  fb.pages = [PAGE_ONE, PAGE_TWO];
  await facebookProvider.callback({ code: 'good-code' }, CTX_A);

  for (const id of [PAGE_THREE.id, '', 'undefined', `${PAGE_ONE.id} `.repeat(2)]) {
    await refused(() => selectFacebookPage(CTX_A, id), 'PAGE_NOT_OFFERED');
  }
  assert.equal(tables.channels.length, 0);
  assert.equal(tables.meta_tokens.length, 0);
  assert.equal(tables.facebook_page_choices.length, 1, 'the real choice is still there to be made');
});

await t('one business cannot choose from the Pages offered to another', async () => {
  seed();
  fb.pages = [PAGE_ONE, PAGE_TWO];
  await facebookProvider.callback({ code: 'good-code' }, CTX_A);
  await refused(() => selectFacebookPage(CTX_B, PAGE_ONE.id), 'PAGE_CHOICE_EXPIRED');
  assert.equal(tables.channels.length, 0);
});

await t('a choice left too long expires and is removed', async () => {
  seed();
  fb.pages = [PAGE_ONE, PAGE_TWO];
  await facebookProvider.callback({ code: 'good-code' }, CTX_A);
  tables.facebook_page_choices[0].expires_at = new Date(Date.now() - 1000).toISOString();

  assert.deepEqual(await listPageChoices(TENANT_A), []);
  await refused(() => selectFacebookPage(CTX_A, PAGE_ONE.id), 'PAGE_CHOICE_EXPIRED');
  assert.equal(tables.facebook_page_choices.length, 0);
  assert.equal(tables.channels.length, 0);
});

// ---------------------------------------------------------------------------
console.log('\n--- one Page, one business ---');

await t('a Page already connected to another business is refused', async () => {
  seed();
  await connectOne(CTX_B, PAGE_ONE);
  const before = JSON.stringify(tables.channels);

  await refused(() => connectOne(CTX_A, PAGE_ONE), 'PAGE_IN_USE');
  assert.equal(JSON.stringify(tables.channels), before, "the other business's connection is untouched");
  assert.equal(channelsOf(TENANT_A).length, 0);
  assert.equal(tokenOf(TENANT_A), undefined, 'and no token was stored for the one refused');
  assert.equal(decryptToken(tokenOf(TENANT_B).access_token_encrypted), TOKEN_ONE);
});

await t('the same refusal applies when the Page is chosen from a list', async () => {
  seed();
  await connectOne(CTX_B, PAGE_TWO);
  fb.pages = [PAGE_ONE, PAGE_TWO];
  await facebookProvider.callback({ code: 'good-code' }, CTX_A);
  await refused(() => selectFacebookPage(CTX_A, PAGE_TWO.id), 'PAGE_IN_USE');
  assert.equal(channelsOf(TENANT_A).length, 0);
  // The other Page on the list is still theirs to choose.
  const ok = await selectFacebookPage(CTX_A, PAGE_ONE.id);
  assert.equal(ok.account.account_id, PAGE_ONE.id);
});

await t('connecting a different Page retires the earlier one', async () => {
  seed();
  await connectOne(CTX_A, PAGE_ONE);
  await connectOne(CTX_A, PAGE_TWO);
  const rows = channelsOf(TENANT_A);
  assert.equal(rows.find((r) => r.channel_account_id === PAGE_ONE.id).status, 'disabled');
  assert.equal(rows.find((r) => r.channel_account_id === PAGE_TWO.id).status, 'active');
  assert.equal(decryptToken(tokenOf(TENANT_A).access_token_encrypted), TOKEN_TWO);
});

await t('disconnecting deletes the stored token and disables the channel', async () => {
  seed();
  const { account } = await connectOne();
  await refused(() => facebookProvider.disconnect(account.channel_id, CTX_B), 'PROVIDER_ERROR');
  assert.ok(tokenOf(TENANT_A), 'another business cannot disconnect it');

  await facebookProvider.disconnect(account.channel_id, CTX_A);
  assert.equal(tokenOf(TENANT_A), undefined);
  assert.equal(channelsOf(TENANT_A)[0].status, 'disabled');
  assert.equal(channelsOf(TENANT_A)[0].credentials_ref, null);
  const health = await facebookProvider.healthCheck(account.channel_id, CTX_A);
  assert.equal(health.healthy, false);
  assert.equal(health.needs_reconnect, true);
});

await t('the health check notices a Page that is no longer subscribed', async () => {
  seed();
  const { account } = await connectOne();
  assert.equal((await facebookProvider.healthCheck(account.channel_id, CTX_A)).healthy, true);
  fb.subscribed = false;
  const health = await facebookProvider.healthCheck(account.channel_id, CTX_A);
  assert.equal(health.healthy, false);
  assert.match(health.summary, /not sending its messages here/);
});

// ---------------------------------------------------------------------------
console.log('\n--- before the database update ---');

await t('without migration 0025 connecting fails with a clear message, not a crash', async () => {
  seed();
  facebookAllowed = false;
  const e = await refused(() => connectOne(), 'DATABASE_UPDATE_NEEDED');
  assert.match(e.userMessage, /database needs its latest update/i);
  assert.equal(e.status, 503);
  assert.equal(tables.channels.length, 0);
  assert.equal(tables.meta_tokens.length, 0, 'no token is stored for a channel that does not exist');
  assert.equal(callsTo('POST', '/subscribed_apps').length, 0);
});

await t('without the pending-choice table a several-Page sign-in fails the same clear way', async () => {
  seed();
  missingTables.add('facebook_page_choices');
  fb.pages = [PAGE_ONE, PAGE_TWO];
  const e = await refused(() => facebookProvider.callback({ code: 'good-code' }, CTX_A), 'DATABASE_UPDATE_NEEDED');
  assert.match(e.userMessage, /database needs its latest update/i);
  assert.deepEqual(await listPageChoices(TENANT_A), []);
  assert.equal(tables.channels.length, 0);
});

await t('a database without the Page columns still stores the token', async () => {
  seed();
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/meta_tokens') && init.body && String(init.body).includes('facebook_page_id')) {
      return json({ code: 'PGRST204', message: "Could not find the 'facebook_page_id' column of 'meta_tokens' in the schema cache" }, 400);
    }
    return real(input, init);
  };
  try {
    const result = await connectOne();
    assert.equal(result.account.account_id, PAGE_ONE.id);
    assert.equal(decryptToken(tokenOf(TENANT_A).access_token_encrypted), TOKEN_ONE);
    assert.equal('facebook_page_id' in tokenOf(TENANT_A), false);
  } finally {
    globalThis.fetch = real;
  }
});

// ---------------------------------------------------------------------------
console.log('\n--- the callback route ---');

const express = (await import('express')).default;
const { channelsRouter } = await import('../../../routes/channels.ts');
const app = express();
app.use(express.json());
app.use('/api', channelsRouter);
const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const port = server.address().port;

/** A plain HTTP request, made without the stubbed fetch and without following redirects. */
function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method, headers: body ? { 'content-type': 'application/json' } : {} },
      (res) => {
        let text = '';
        res.on('data', (c) => { text += c; });
        res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location ?? '', headers: res.headers, text }));
      }
    );
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}
const callbackPath = (state, extra = 'code=good-code') =>
  `/api/channels/oauth/facebook/callback?${extra}&state=${encodeURIComponent(state)}`;
const stateFor = (ctx) => createOAuthState({ provider: 'facebook', ...ctx });

await t('the callback connects a single Page and returns to Integrations', async () => {
  seed();
  const r = await request('GET', callbackPath(stateFor(CTX_A)));
  assert.equal(r.status, 302);
  assert.equal(r.location, '/integrations?connect=facebook&status=connected');
  assert.equal(channelsOf(TENANT_A).length, 1);
  noSecretIn(`${r.location}${r.text}${JSON.stringify(r.headers)}`, 'the callback response');
});

await t('with several Pages the callback sends the browser to the picker and no token with it', async () => {
  seed();
  fb.pages = [PAGE_ONE, PAGE_TWO];
  const r = await request('GET', callbackPath(stateFor(CTX_A)));
  assert.equal(r.status, 302);
  assert.equal(r.location, '/integrations?connect=facebook&status=pick_page');
  assert.equal(tables.channels.length, 0);
  assert.equal(tables.facebook_page_choices.length, 1);
  noSecretIn(`${r.location}${r.text}${JSON.stringify(r.headers)}`, 'the callback response');
});

await t('the business comes from the signed state, never from the query', async () => {
  seed();
  const r = await request('GET', callbackPath(stateFor(CTX_A), `code=good-code&tenant_id=${TENANT_B}&tenantId=${TENANT_B}`));
  assert.equal(r.location, '/integrations?connect=facebook&status=connected');
  assert.equal(channelsOf(TENANT_A).length, 1);
  assert.equal(channelsOf(TENANT_B).length, 0);
});

await t('a forged, foreign or missing state connects nothing', async () => {
  seed();
  const forged = `${stateFor(CTX_A).slice(0, -3)}abc`;
  const foreign = createOAuthState({ provider: 'instagram', ...CTX_A });
  for (const state of [forged, foreign, '']) {
    const r = await request('GET', callbackPath(state));
    assert.equal(r.location, '/integrations?connect=facebook&status=expired');
  }
  assert.equal(tables.channels.length, 0);
  assert.equal(fb.calls.length, 0, 'Meta was never called');
});

await t('declining at Facebook, no Pages, and a Page in use each come back with their own status', async () => {
  seed();
  let r = await request('GET', callbackPath(stateFor(CTX_A), 'error=access_denied'));
  assert.equal(r.location, '/integrations?connect=facebook&status=cancelled');

  fb.pages = [];
  r = await request('GET', callbackPath(stateFor(CTX_A)));
  assert.equal(r.location, '/integrations?connect=facebook&status=no_pages');

  await connectOne(CTX_B, PAGE_ONE);
  fb.pages = [PAGE_ONE];
  r = await request('GET', callbackPath(stateFor(CTX_A)));
  assert.equal(r.location, '/integrations?connect=facebook&status=page_in_use');

  facebookAllowed = false;
  fb.pages = [PAGE_TWO];
  r = await request('GET', callbackPath(stateFor(CTX_A)));
  assert.equal(r.location, '/integrations?connect=facebook&status=database_update_needed');
  assert.equal(channelsOf(TENANT_A).length, 0);
});

await t('the picker routes need a signed-in admin: no session, no Pages and no connection', async () => {
  seed();
  fb.pages = [PAGE_ONE, PAGE_TWO];
  await facebookProvider.callback({ code: 'good-code' }, CTX_A);

  const list = await request('GET', '/api/channels/facebook/pages');
  assert.equal(list.status, 401);
  noSecretIn(list.text, 'the response');
  assert.ok(!list.text.includes(PAGE_ONE.id), 'not even the Page ids');

  const pick = await request('POST', '/api/channels/facebook/select-page', { page_id: PAGE_ONE.id, tenant_id: TENANT_A });
  assert.equal(pick.status, 401);
  assert.equal(tables.channels.length, 0);
});

await new Promise((resolve) => server.close(resolve));

// ---------------------------------------------------------------------------
console.log('\n--- Messenger webhooks ---');

const PSID = '7700000000000042';
const messengerBody = (pageId, messaging, extra = {}) => ({
  object: 'page',
  entry: [{ id: pageId, time: 1795170000000, messaging, ...extra }],
});
const textEvent = (mid, text, sender = PSID, pageId = PAGE_ONE.id) => ({
  sender: { id: sender }, recipient: { id: pageId }, timestamp: 1795170000000, message: { mid, text },
});

await t('a text message is parsed with the Page as the account', () => {
  const out = parseMetaWebhook(messengerBody(PAGE_ONE.id, [textEvent('m_1', 'Do you have the bob wig?')]));
  assert.equal(out.provider, 'facebook');
  assert.equal(out.events.length, 1);
  assert.equal(out.events[0].accountId, PAGE_ONE.id);
  assert.deepEqual(out.events[0].messages[0], {
    customerId: PSID, customerName: null, messageId: 'm_1', text: 'Do you have the bob wig?', media: null,
    timestamp: new Date(1795170000000).toISOString(),
  });
});

await t('an attachment is parsed as media, with or without words', () => {
  const [event] = parseFacebook(messengerBody(PAGE_ONE.id, [
    { sender: { id: PSID }, recipient: { id: PAGE_ONE.id }, timestamp: 1795170000001,
      message: { mid: 'm_2', attachments: [{ type: 'image', payload: { url: 'https://cdn.example/receipt.jpg' } }] } },
    { sender: { id: PSID }, recipient: { id: PAGE_ONE.id }, timestamp: 1795170000002,
      message: { mid: 'm_3', text: 'here', attachments: [{ type: 'file', payload: { url: 'https://cdn.example/a.pdf' } }] } },
  ]));
  assert.equal(event.messages.length, 2);
  assert.deepEqual(event.messages[0].media, { kind: 'image', mediaId: 'https://cdn.example/receipt.jpg', mimeType: null, caption: null });
  assert.equal(event.messages[0].text, null);
  assert.equal(event.messages[1].media.kind, 'document');
  assert.equal(event.messages[1].text, 'here');
});

await t('echoes of what the Page itself sent are ignored', () => {
  const echo = { sender: { id: PAGE_ONE.id }, recipient: { id: PSID }, timestamp: 1, message: { mid: 'm_e', text: 'Thanks!', is_echo: true } };
  const flaggedOnly = { sender: { id: PSID }, recipient: { id: PAGE_ONE.id }, timestamp: 1, message: { mid: 'm_e2', text: 'x', is_echo: true } };
  const fromPage = { sender: { id: PAGE_ONE.id }, recipient: { id: PSID }, timestamp: 1, message: { mid: 'm_e3', text: 'x' } };
  assert.deepEqual(parseFacebook(messengerBody(PAGE_ONE.id, [echo, flaggedOnly, fromPage])), []);
});

await t('a feed change (a comment on a post) is ignored without error', () => {
  const feedOnly = { object: 'page', entry: [{ id: PAGE_ONE.id, time: 1, changes: [{ field: 'feed', value: { item: 'comment', verb: 'add', comment_id: '1_2', message: 'How much?', from: { id: '9', name: 'A' } } }] }] };
  const out = parseMetaWebhook(feedOnly);
  assert.equal(out.provider, 'facebook');
  assert.deepEqual(out.events, []);

  // A delivery carrying both keeps the message and drops the feed change.
  const both = messengerBody(PAGE_ONE.id, [textEvent('m_4', 'hello')], { changes: feedOnly.entry[0].changes });
  assert.equal(parseFacebook(both)[0].messages.length, 1);
});

await t('receipts, reactions and malformed deliveries produce nothing, and a tapped button is read as words', () => {
  const noise = [
    { sender: { id: PSID }, recipient: { id: PAGE_ONE.id }, timestamp: 1, delivery: { mids: ['m_1'], watermark: 1 } },
    { sender: { id: PSID }, recipient: { id: PAGE_ONE.id }, timestamp: 1, read: { watermark: 1 } },
    { sender: { id: PSID }, recipient: { id: PAGE_ONE.id }, timestamp: 1, reaction: { mid: 'm_1', action: 'react' } },
    { recipient: { id: PAGE_ONE.id }, message: { mid: 'm_x', text: 'no sender' } },
    { sender: { id: PSID }, message: { text: 'no id' } },
    'nope', null,
  ];
  assert.deepEqual(parseFacebook(messengerBody(PAGE_ONE.id, noise)), []);
  for (const junk of [null, 'x', { object: 'page' }, { object: 'page', entry: 'nope' }, { object: 'page', entry: [{ messaging: [] }] }, { object: 'page', entry: [{ id: PAGE_ONE.id, messaging: 'nope' }] }]) {
    assert.deepEqual(parseFacebook(junk), []);
  }
  const [event] = parseFacebook(messengerBody(PAGE_ONE.id, [
    { sender: { id: PSID }, recipient: { id: PAGE_ONE.id }, timestamp: 5, postback: { title: 'Get started', payload: 'START', mid: 'm_pb' } },
  ]));
  assert.equal(event.messages[0].text, 'Get started');
  assert.equal(event.messages[0].messageId, 'm_pb');
});

await t('a payload cannot name its own business: the parser output has no tenant at all', () => {
  const body = messengerBody(PAGE_ONE.id, [{ ...textEvent('m_5', 'hi'), tenant_id: TENANT_B }]);
  body.tenant_id = TENANT_B;
  body.entry[0].tenant_id = TENANT_B;
  assert.ok(!JSON.stringify(parseFacebook(body)).includes(TENANT_B));
});

// ---------------------------------------------------------------------------
console.log('\n--- routing to the right business ---');

async function deliver(body) {
  const outcomes = [];
  const { provider, events } = parseMetaWebhook(body);
  for (const parsed of events) {
    const channel = await resolveChannel(provider, parsed.accountId);
    if (!channel || channel.status !== 'active') { outcomes.push('no_channel'); continue; }
    for (const event of normalize(parsed, channel)) outcomes.push(await processInbound(event, channel, 'test'));
  }
  return outcomes;
}

await t('a Messenger message reaches the business that connected that Page, and only it', async () => {
  seed();
  await connectOne(CTX_A, PAGE_ONE);
  await connectOne(CTX_B, PAGE_TWO);
  fb.calls = [];

  const resolved = await resolveChannel('facebook', PAGE_TWO.id);
  assert.equal(resolved.tenantId, TENANT_B);
  assert.equal(resolved.channelType, 'facebook');

  assert.deepEqual(await deliver(messengerBody(PAGE_ONE.id, [textEvent('m_10', 'Is the shop open today?')])), ['dispatched']);

  assert.equal(tables.conversations.length, 1);
  const convo = tables.conversations[0];
  assert.equal(convo.tenant_id, TENANT_A);
  assert.equal(convo.channel_type, 'facebook');
  assert.equal(convo.customer_id, PSID);
  assert.equal(convo.channel_id, channelsOf(TENANT_A)[0].id);
  assert.equal(convo.customer_name, 'Amina Otieno', 'named from the Messenger profile');
  assert.equal(tables.leads[0].tenant_id, TENANT_A);
  assert.equal(tables.leads[0].channel_type, 'facebook');
  assert.equal(tables.leads[0].phone, null, 'a page-scoped id is not a phone number');
  assert.ok(tables.conversation_messages.every((m) => m.tenant_id === TENANT_A));
  assert.equal(tables.webhook_events[0].provider, 'facebook');

  // The name was read, and the reply sent, with tenant A's Page token on tenant A's Page.
  const name = fb.calls.find((c) => c.path === PSID);
  assert.equal(name.token, TOKEN_ONE);
  const [sent] = callsTo('POST', '/messages');
  assert.equal(sent.path, `${PAGE_ONE.id}/messages`);
  assert.equal(sent.token, TOKEN_ONE);
  assert.equal(sent.body.recipient.id, PSID);
});

await t('the same delivery twice is handled once', async () => {
  seed();
  await connectOne();
  const body = messengerBody(PAGE_ONE.id, [textEvent('m_11', 'hello')]);
  assert.deepEqual(await deliver(body), ['dispatched']);
  const sends = callsTo('POST', '/messages').length;
  assert.deepEqual(await deliver(body), ['duplicate']);
  assert.equal(tables.conversation_messages.filter((m) => m.sender === 'customer').length, 1);
  assert.equal(callsTo('POST', '/messages').length, sends, 'and answered once');
});

await t('a message for a Page nobody connected, or one disconnected, is dropped', async () => {
  seed();
  assert.deepEqual(await deliver(messengerBody(PAGE_THREE.id, [textEvent('m_12', 'hi', PSID, PAGE_THREE.id)])), ['no_channel']);
  const { account } = await connectOne();
  await facebookProvider.disconnect(account.channel_id, CTX_A);
  assert.deepEqual(await deliver(messengerBody(PAGE_ONE.id, [textEvent('m_13', 'hi')])), ['no_channel']);
  assert.equal(tables.conversations.length, 0);
});

await t('a customer whose profile Meta withholds is still received, without a name', async () => {
  seed();
  await connectOne();
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.hostname === 'graph.facebook.com' && url.pathname.endsWith(`/${PSID}`)) {
      return metaError(100, 'Insufficient permission to access user profile.', 400, 2018218);
    }
    return real(input, init);
  };
  try {
    assert.deepEqual(await deliver(messengerBody(PAGE_ONE.id, [textEvent('m_14', 'hello')])), ['dispatched']);
    assert.equal(tables.conversations[0].customer_name, null);
  } finally {
    globalThis.fetch = real;
  }
});

// ---------------------------------------------------------------------------
console.log('\n--- sending ---');

/** A conversation in which the customer last wrote `hoursAgo` hours ago. */
function wrote(hoursAgo, tenantId = TENANT_A) {
  const convo = withDefaults('conversations', { tenant_id: tenantId, channel_type: 'facebook', customer_id: PSID });
  tables.conversations.push(convo);
  tables.conversation_messages.push(withDefaults('conversation_messages', {
    tenant_id: tenantId, conversation_id: convo.id, sender: 'customer', body: 'hi',
    created_at: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(),
  }));
}

await t('a reply is sent to the Page\'s messages endpoint in the shape Messenger expects', async () => {
  seed();
  const { account } = await connectOne();
  wrote(1);
  fb.calls = [];
  await facebookProvider.sendMessage(account.channel_id, PSID, 'Yes, we are open until 6pm.', CTX_A);

  const [sent] = callsTo('POST', '/messages');
  assert.equal(fb.calls.length, 1);
  assert.equal(sent.path, `${PAGE_ONE.id}/messages`);
  assert.deepEqual(sent.body, {
    recipient: { id: PSID }, messaging_type: 'RESPONSE', message: { text: 'Yes, we are open until 6pm.' },
  });
  assert.equal(sent.token, TOKEN_ONE);
  assert.ok(!sent.href.includes(TOKEN_ONE), 'the token is not in the address');
  assert.ok(sent.query.appsecret_proof);
});

await t('a long reply is split into messages Messenger will accept', async () => {
  seed();
  const { account } = await connectOne();
  wrote(1);
  fb.calls = [];
  const long = Array.from({ length: 120 }, (_, i) => `Sentence number ${i} about the catalogue and what is in stock.`).join(' ');
  await facebookProvider.sendMessage(account.channel_id, PSID, long, CTX_A);
  const parts = callsTo('POST', '/messages').map((c) => c.body.message.text);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => p.length <= TEXT_LIMITS.facebook));
  assert.equal(TEXT_LIMITS.facebook, 2000);
});

await t('outside the 24-hour window nothing is sent and the reason is plain', async () => {
  seed();
  const { account } = await connectOne();
  wrote(25);
  fb.calls = [];
  const e = await refused(() => facebookProvider.sendMessage(account.channel_id, PSID, 'Still interested?', CTX_A), 'OUTSIDE_24H_WINDOW');
  assert.match(e.userMessage, /only allows messages within 24 hours of the customer's last message/);
  assert.equal(fb.calls.length, 0, 'Meta was not asked');

  // Someone who never wrote cannot be messaged at all.
  tables.conversations = []; tables.conversation_messages = [];
  await refused(() => facebookProvider.sendMessage(account.channel_id, PSID, 'Hello!', CTX_A), 'OUTSIDE_24H_WINDOW');
  assert.equal(fb.calls.length, 0);
});

await t("Meta's refusals are told apart: expired, permission, window, rate limit", async () => {
  seed();
  const { account } = await connectOne();
  wrote(1);
  const cases = [
    [{ code: 190 }, 'FACEBOOK_REAUTH_REQUIRED', /Reconnect/],
    [{ code: 10 }, 'FACEBOOK_PERMISSION_MISSING', /permission/],
    [{ code: 200 }, 'FACEBOOK_PERMISSION_MISSING', /permission/],
    [{ code: 10, subcode: 2018278 }, 'OUTSIDE_24H_WINDOW', /24 hours/],
    [{ code: 551 }, 'OUTSIDE_24H_WINDOW', /24 hours/],
    [{ code: 4 }, 'FACEBOOK_RATE_LIMITED', /limiting/],
    [{ code: 613 }, 'FACEBOOK_RATE_LIMITED', /limiting/],
    [{ code: 100 }, 'FACEBOOK_SEND_FAILED', /couldn't send/],
  ];
  for (const [failure, code, wording] of cases) {
    fb.failSend = failure;
    const e = await refused(() => facebookProvider.sendMessage(account.channel_id, PSID, 'hello', CTX_A), code);
    assert.match(e.userMessage, wording);
  }
});

await t('one business cannot send through another business\'s Page', async () => {
  seed();
  const { account } = await connectOne(CTX_A, PAGE_ONE);
  wrote(1, TENANT_B);
  fb.calls = [];
  await refused(() => facebookProvider.sendMessage(account.channel_id, PSID, 'hello', CTX_B), 'PROVIDER_ERROR');
  assert.equal(fb.calls.length, 0);
});

await t('a photo is sent to Messenger as an image attachment by address', async () => {
  seed();
  await connectOne();
  fb.calls = [];
  const out = await sendImageToCustomer({
    tenantId: TENANT_A, channelType: 'facebook', channelId: null, customerId: PSID,
    imageUrl: 'https://cdn.example/receipt.png', caption: 'Your receipt',
  });
  assert.deepEqual(out, { sent: true });
  const [sent] = callsTo('POST', '/messages');
  assert.equal(sent.path, `${PAGE_ONE.id}/messages`);
  assert.deepEqual(sent.body.message, {
    attachment: { type: 'image', payload: { url: 'https://cdn.example/receipt.png', is_reusable: false } },
  });
  assert.equal(sent.body.recipient.id, PSID);

  fb.failSend = { code: 100 };
  const failed = await sendImageToCustomer({ tenantId: TENANT_A, channelType: 'facebook', channelId: null, customerId: PSID, imageUrl: 'https://cdn.example/r.png' });
  assert.equal(failed.sent, false);
  const none = await sendImageToCustomer({ tenantId: TENANT_B, channelType: 'facebook', channelId: null, customerId: PSID, imageUrl: 'https://cdn.example/r.png' });
  assert.deepEqual(none, { sent: false, reason: 'The Facebook Page is not connected.' });
});

// ---------------------------------------------------------------------------
console.log('\n--- publishing to the Page ---');

const NOW = new Date('2026-11-23T06:00:00Z');
const MON = '2026-11-23T15:00:00.000Z';
const WED = '2026-11-25T15:00:00.000Z';
const FRI = '2026-11-27T15:00:00.000Z';
const after = (iso, minutes = 5) => new Date(Date.parse(iso) + minutes * 60_000);
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function item(n, extra = {}) {
  const row = withDefaults('content_items', {
    id: uuid(n), tenant_id: TENANT_A, media_url: `https://cdn.example/${n}.jpg`, media_path: `${TENANT_A}/${n}.jpg`,
    caption: `Caption ${n}`, status: 'approved', about: `Thing ${n}`,
    created_at: new Date(Date.parse('2026-11-01T00:00:00Z') + n * 60_000).toISOString(),
    ...extra,
  });
  tables.content_items.push(row);
  return row;
}

function post(extra = {}) {
  const row = withDefaults('scheduled_posts', {
    tenant_id: TENANT_A, content_item_id: null, platform: 'facebook', caption: 'New stock just landed',
    media_url: 'https://cdn.example/1.jpg', media_type: 'image', about: 'Bob wig',
    scheduled_for: MON, week_start: '2026-11-23', status: 'approved', ...extra,
  });
  tables.scheduled_posts.push(row);
  return row;
}

function withInstagram(tenantId = TENANT_A) {
  tables.meta_tokens.push({
    tenant_id: tenantId, platform: 'instagram', access_token_encrypted: encryptToken('made-up-instagram-token'),
    token_expires_at: null, phone_number_id: null, instagram_user_id: '1789', instagram_username: 'glamour',
    scopes: ['instagram_business_basic', 'instagram_business_content_publish'],
  });
}

const publishCalls = () => fb.calls.filter((c) => c.method === 'POST' && /\/(photos|videos)$/.test(c.path));

await t('an approved Facebook post is published to the Page once, and the link is recorded', async () => {
  seed();
  await connectOne();
  const p = post();
  fb.calls = [];

  const summary = await publishDuePosts({ now: after(MON) });
  assert.equal(summary.published, 1);
  assert.equal(publishCalls().length, 1);
  const [call] = publishCalls();
  assert.equal(call.path, `${PAGE_ONE.id}/photos`);
  assert.deepEqual(call.body, { url: 'https://cdn.example/1.jpg', caption: 'New stock just landed' });
  assert.equal(call.token, TOKEN_ONE);

  assert.equal(p.status, 'published');
  assert.equal(p.external_post_id, `${PAGE_ONE.id}_post1`);
  assert.equal(p.external_permalink, `https://www.facebook.com/${PAGE_ONE.id}_post1`);
  assert.equal(p.failure_reason, null);
  assert.match(tables.notifications.find((n) => n.kind === 'post_published').title, /Posted to Facebook/);
});

await t('running again never publishes it a second time', async () => {
  seed();
  await connectOne();
  post();
  fb.calls = [];
  await publishDuePosts({ now: after(MON) });
  await publishDuePosts({ now: after(MON, 6) });
  await publishDuePosts({ now: after(MON, 7) });
  assert.equal(publishCalls().length, 1);
  assert.equal(fb.posts, 1);
});

await t('two runners at the same moment publish it once: only one wins the claim', async () => {
  seed();
  await connectOne();
  const p = post();
  fb.calls = [];
  const [a, b, c] = await Promise.all([
    publishDuePosts({ now: after(MON) }),
    publishDuePosts({ now: after(MON) }),
    publishNow(TENANT_A, p.id, { by: USER_A, now: after(MON) }).catch((e) => ({ refused: e.message })),
  ]);
  assert.equal(publishCalls().length, 1, 'one call to Facebook');
  assert.equal(a.published + b.published + (c.outcome === 'published' ? 1 : 0), 1);
  assert.equal(p.status, 'published');
  assert.equal(p.attempt_count, 1);
});

await t('a post nobody approved is never published', async () => {
  seed();
  await connectOne();
  for (const status of ['proposed', 'rejected', 'cancelled', 'failed']) post({ status, scheduled_for: new Date(Date.parse(MON) + status.length * 60_000).toISOString() });
  fb.calls = [];
  const summary = await publishDuePosts({ now: after(MON, 30) });
  assert.equal(summary.published, 0);
  assert.equal(publishCalls().length, 0);
});

await t('a video is posted to the videos edge with its caption as the description', async () => {
  seed();
  await connectOne();
  const p = post({ media_type: 'video', media_url: 'https://cdn.example/clip.mp4', caption: 'Behind the scenes' });
  fb.calls = [];
  await publishDuePosts({ now: after(MON) });
  const [call] = publishCalls();
  assert.equal(call.path, `${PAGE_ONE.id}/videos`);
  assert.deepEqual(call.body, { file_url: 'https://cdn.example/clip.mp4', description: 'Behind the scenes' });
  assert.equal(p.status, 'published');
  assert.equal(p.external_post_id, 'video-1');
  assert.equal(p.external_permalink, 'https://www.facebook.com/video-1/');
});

await t('with no Page connected the post fails plainly and Facebook is never called', async () => {
  seed();
  const p = post();
  const summary = await publishDuePosts({ now: after(MON) });
  assert.equal(summary.failed, 1);
  assert.equal(p.status, 'failed');
  assert.match(p.failure_reason, /No Facebook Page is connected/);
  assert.equal(fb.calls.length, 0);
});

await t('if Facebook does not confirm, the reason says it may have gone out, and it is not tried again', async () => {
  seed();
  await connectOne();
  const p = post();
  fb.failPublish = { status: 500, body: { error: { message: 'An unknown error occurred', code: 1 } } };
  fb.calls = [];
  await publishDuePosts({ now: after(MON) });
  assert.equal(p.status, 'failed');
  assert.match(p.failure_reason, /may or may not have gone out/);
  assert.match(p.failure_reason, /check the Page/);

  fb.failPublish = null;
  await publishDuePosts({ now: after(MON, 10) });
  assert.equal(publishCalls().length, 1, 'a failed post is never retried without a person deciding to');
  assert.equal(fb.posts, 0);
});

await t('a refusal for missing permission tells the owner to reconnect the Page', async () => {
  seed();
  await connectOne();
  const p = post();
  fb.failPublish = { status: 403, body: { error: { message: '(#200) Requires pages_manage_posts', code: 200 } } };
  await publishDuePosts({ now: after(MON) });
  assert.equal(p.status, 'failed');
  assert.match(p.failure_reason, /Reconnect the Page/);
  noSecretIn(p.failure_reason, 'the failure reason');
});

await t('a Facebook post is published with the Page of its own business', async () => {
  seed();
  await connectOne(CTX_A, PAGE_ONE);
  await connectOne(CTX_B, PAGE_TWO);
  post({ tenant_id: TENANT_B, scheduled_for: WED });
  fb.calls = [];
  await publishDuePosts({ now: after(WED) });
  const [call] = publishCalls();
  assert.equal(call.path, `${PAGE_TWO.id}/photos`);
  assert.equal(call.token, TOKEN_TWO);
});

// ---------------------------------------------------------------------------
console.log('\n--- planning for the platforms that are connected ---');

await t('with no Page connected the plan is Instagram only, as before', async () => {
  seed();
  withInstagram();
  item(1, { platforms: ['instagram', 'facebook'] }); item(2); item(3);
  assert.deepEqual(await postingPlatforms(TENANT_A), ['instagram']);
  const plan = await planWeek(TENANT_A, { now: NOW });
  assert.deepEqual(plan.platforms, ['instagram']);
  assert.equal(plan.proposed.length, 3);
  assert.ok(plan.proposed.every((p) => p.platform === 'instagram'));
  assert.deepEqual(plan.proposed.map((p) => p.scheduled_for), [MON, WED, FRI]);
});

await t('with a Page connected an item marked for both goes out on both at the same time', async () => {
  seed();
  withInstagram();
  await connectOne();
  item(1, { platforms: ['instagram', 'facebook'] });
  item(2, { platforms: ['instagram', 'facebook'] });
  item(3, { platforms: ['instagram', 'facebook'] });

  assert.deepEqual(await postingPlatforms(TENANT_A), ['instagram', 'facebook']);
  const plan = await planWeek(TENANT_A, { now: NOW });
  assert.deepEqual(plan.platforms, ['instagram', 'facebook']);
  assert.equal(plan.proposed.length, 6);
  for (const when of [MON, WED, FRI]) {
    const at = plan.proposed.filter((p) => p.scheduled_for === when);
    assert.deepEqual(at.map((p) => p.platform).sort(), ['facebook', 'instagram'], 'one post per platform at each time');
    assert.equal(at[0].content_item_id, at[1].content_item_id, 'and it is the same item');
  }
  assert.ok(plan.proposed.every((p) => p.status === 'proposed'), 'nothing is approved by being planned');

  // Planning again adds nothing on either platform.
  const again = await planWeek(TENANT_A, { now: NOW });
  assert.equal(again.proposed.length, 0);
  assert.equal(again.already_planned, 6);
  assert.equal(tables.scheduled_posts.length, 6);
});

await t('an item is only ever planned for a platform it is marked for', async () => {
  seed();
  withInstagram();
  await connectOne();
  item(1, { platforms: ['instagram'] });
  item(2, { platforms: ['facebook'] });
  item(3, { platforms: [] });

  const plan = await planWeek(TENANT_A, { now: NOW });
  const on = (platform) => plan.proposed.filter((p) => p.platform === platform).map((p) => p.content_item_id).sort();
  assert.deepEqual(on('instagram'), [uuid(1), uuid(3)], 'an unmarked item is Instagram only');
  assert.deepEqual(on('facebook'), [uuid(2)]);
  assert.ok(plan.unfilled.some((u) => u.platform === 'facebook'));
});

await t('a Page with no Instagram plans for the Page alone', async () => {
  seed();
  await connectOne();
  item(1, { platforms: ['instagram', 'facebook'] }); item(2, { platforms: ['instagram'] });
  const plan = await planWeek(TENANT_A, { now: NOW });
  assert.deepEqual(plan.platforms, ['facebook']);
  assert.deepEqual(plan.proposed.map((p) => [p.platform, p.content_item_id]), [['facebook', uuid(1)]]);
});

await t('one outing on two platforms counts as one use of the item', async () => {
  seed();
  withInstagram();
  await connectOne();
  const once = item(1, { platforms: ['instagram', 'facebook'], max_uses: 1 });
  const plan = await planWeek(TENANT_A, { now: NOW });
  assert.equal(plan.proposed.length, 2, 'the single allowed outing goes to both platforms');
  assert.equal(new Set(plan.proposed.map((p) => p.scheduled_for)).size, 1);

  // Publish the Facebook one, then pretend the Instagram twin went out too.
  for (const p of tables.scheduled_posts) { p.status = 'approved'; }
  const ig = tables.scheduled_posts.find((p) => p.platform === 'instagram');
  ig.status = 'published';
  await publishDuePosts({ now: after(MON) });
  assert.equal(tables.scheduled_posts.find((p) => p.platform === 'facebook').status, 'published');
  assert.equal(once.times_used, 0, 'the outing was already counted when its twin went out');
});

await t('a specific item can be put on the calendar for Facebook, if it is marked for it', async () => {
  seed();
  withInstagram();
  await connectOne();
  item(1, { platforms: ['instagram', 'facebook'] });
  item(2, { platforms: ['instagram'] });
  const at = new Date('2026-11-24T10:00:00Z');

  const fbPost = await schedulePost(TENANT_A, { contentItemId: uuid(1), scheduledFor: at, platform: 'facebook', now: NOW });
  assert.equal(fbPost.platform, 'facebook');
  assert.equal(fbPost.status, 'proposed');
  // The same time on the other platform is a different slot.
  const igPost = await schedulePost(TENANT_A, { contentItemId: uuid(1), scheduledFor: at, now: NOW });
  assert.equal(igPost.platform, 'instagram');
  await assert.rejects(() => schedulePost(TENANT_A, { contentItemId: uuid(1), scheduledFor: at, platform: 'facebook', now: NOW }), /already a post at that time/);
  await assert.rejects(() => schedulePost(TENANT_A, { contentItemId: uuid(2), scheduledFor: at, platform: 'facebook', now: NOW }), /not marked for Facebook/);
});

await t('the Marketing page is told which Page is connected and whether it can post', async () => {
  seed();
  assert.deepEqual(await facebookStatus(TENANT_A), { connected: false, page_name: null, can_publish: null, expired: false });
  await connectOne(CTX_A, PAGE_ONE);
  const status = await facebookStatus(TENANT_A);
  assert.deepEqual(status, { connected: true, page_name: 'Glamour Crown Wigs', can_publish: true, expired: false });
  noSecretIn(status, 'the status sent to the browser');

  // Connected by someone who may answer messages but not post.
  await connectOne(CTX_B, PAGE_THREE);
  assert.equal((await facebookStatus(TENANT_B)).can_publish, false);
});

// ---------------------------------------------------------------------------
console.log('\n--- facebook is a channel type everywhere ---');

await t("the provider registry knows 'facebook'", () => {
  assert.equal(isProviderId('facebook'), true);
  assert.equal(getProvider('facebook'), facebookProvider);
  assert.deepEqual(PROVIDER_ORDER, ['whatsapp', 'instagram', 'facebook', 'webchat', 'telegram']);
  assert.deepEqual(allProviders().map((p) => p.id), PROVIDER_ORDER);
  assert.equal(isProviderId('messenger'), false);
});

await t('the migration widens both checks and is additive', async () => {
  const sql = await readFile(new URL('../../../../../supabase/migrations/20261120_0025_facebook_pages.sql', import.meta.url), 'utf8');
  const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  assert.match(code, /add constraint channels_channel_type_check[\s\S]*'telegram'[\s\S]*'whatsapp'[\s\S]*'instagram'[\s\S]*'webchat'[\s\S]*'facebook'/);
  assert.match(code, /add constraint webhook_events_provider_check[\s\S]*'whatsapp', 'instagram', 'telegram', 'webchat', 'facebook'/);
  assert.match(code, /pg_get_constraintdef/, 'the old constraint is found by its definition');
  assert.match(code, /add column if not exists facebook_page_id/);
  assert.match(code, /create table if not exists public\.facebook_page_choices/);
  assert.match(code, /revoke all on public\.facebook_page_choices from anon, authenticated/);
  assert.ok(!/drop table|drop column|delete from|truncate|update public\./i.test(code), 'nothing destructive');
});

await t('the dashboard types and channel filters include facebook', async () => {
  const read = (p) => readFile(new URL(`../../../../${p}`, import.meta.url), 'utf8');
  const types = await read('types/index.ts');
  assert.match(types, /export type ChannelType = [^;]*'facebook'/);
  assert.match(types, /export type ProviderId = [^;]*'facebook'/);
  for (const page of ['pages/Inbox.tsx', 'pages/Leads.tsx', 'pages/Overview.tsx', 'pages/AgentQA.tsx']) {
    assert.match(await read(page), /'facebook'/, `${page} lists facebook`);
  }
  const integrations = await read('pages/Integrations.tsx');
  assert.match(integrations, /name="Facebook Page"/);
  assert.match(integrations, /pick_page/);
  assert.match(integrations, /\/api\/go\?to=/, 'the connect redirect goes through the phone hop');
});

// ---------------------------------------------------------------------------
console.log('\n--- nothing secret was logged ---');

await t('no token or secret appeared in any log line during this run', () => {
  assert.ok(logged.length > 20, 'the run did log');
  for (const line of logged) noSecretIn(line, 'a log line');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
