/**
 * Marketing: the content library, the weekly plan, approval and publishing.
 *
 * The rules under test are the ones that must never bend: only approved posts
 * are published, each exactly once, and a caption states nothing the
 * catalogue does not.
 *
 * As elsewhere, the real services and the real tools run. Only PostgREST and
 * Instagram are doubles: PostgREST is a small in-memory table store that
 * honours the filters the code sends (so "claim it only if it is still
 * approved" is really exercised), and Instagram is a recorder that counts
 * what would have been published.
 *
 * Run with:  npx tsx src/server/ai/__tests__/marketing.test.mjs
 */

import assert from 'node:assert';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SHWARI_API_KEY = 'test-key';
// Read once when the Meta config module loads, so they are set before any import.
process.env.META_APP_SECRET = 'test-app-secret';
process.env.INSTAGRAM_CLIENT_SECRET = 'test-ig-secret';
process.env.INSTAGRAM_CLIENT_ID = 'test-ig-client';
// A made-up key, for encrypting the made-up token the double hands back.
process.env.META_TOKEN_ENCRYPTION_KEY = 'ab'.repeat(32);

let pass = 0;
let fail = 0;

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

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const LIVE = ['proposed', 'approved', 'publishing', 'published'];

/** The unique indexes migration 0024 (and 0021) create, enforced here too. */
function violates(table, row, self) {
  const others = (tables[table] ?? []).filter((r) => r !== self);
  if (table === 'scheduled_posts' && LIVE.includes(row.status)) {
    return others.some((r) => LIVE.includes(r.status) && r.tenant_id === row.tenant_id &&
      r.platform === row.platform && r.scheduled_for === row.scheduled_for);
  }
  if (table === 'notifications' && row.ref_id) {
    return others.some((r) => r.tenant_id === row.tenant_id && r.kind === row.kind && r.ref_id === row.ref_id);
  }
  return false;
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
  if (table === 'posting_settings') delete base.id;
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

function database(url, init) {
  const method = init.method ?? 'GET';
  const table = url.pathname.replace('/rest/v1/', '');
  if (missingTables.has(table)) {
    return json({ code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` }, 404);
  }
  tables[table] ??= [];
  const params = [...url.searchParams.entries()];
  const matches = matcher(params);
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
      if (violates(table, row, null)) return json({ code: '23505', message: 'duplicate key value violates unique constraint' }, 409);
      tables[table].push(row);
      out.push(row);
    }
  } else if (method === 'PATCH') {
    for (const row of tables[table].filter(matches)) {
      const next = { ...row, ...body };
      if (violates(table, next, row)) return json({ code: '23505', message: 'duplicate key value violates unique constraint' }, 409);
      Object.assign(row, body);
      out.push(row);
    }
  } else if (method === 'DELETE') {
    out = tables[table].filter(matches);
    tables[table] = tables[table].filter((r) => !out.includes(r));
  }

  const accept = init.headers && (init.headers.get ? init.headers.get('accept') : init.headers.Accept);
  if (String(accept ?? '').includes('vnd.pgrst.object')) return json(out[0] ?? null);
  return json(out.map((r) => ({ ...r })));
}

// ---------------------------------------------------------------------------
// The Instagram double
// ---------------------------------------------------------------------------

let ig;
const resetInstagram = () => {
  ig = { calls: [], containers: 0, published: [], containerStatus: 'FINISHED', failCreate: null, failPublish: null };
};

function instagram(url, init) {
  const method = init.method ?? 'GET';
  const path = url.pathname.replace(/^\//, '');
  ig.calls.push(`${method} ${path}`);

  if (method === 'POST' && path.endsWith('/media')) {
    if (ig.failCreate) return json(ig.failCreate.body, ig.failCreate.status);
    ig.containers++;
    return json({ id: `container-${ig.containers}` });
  }
  if (method === 'POST' && path.endsWith('/media_publish')) {
    if (ig.failPublish) return json(ig.failPublish.body, ig.failPublish.status);
    const id = `media-${ig.published.length + 1}`;
    ig.published.push({ id, creation: new URLSearchParams(String(init.body)).get('creation_id') });
    return json({ id });
  }
  if (method === 'GET' && path.startsWith('container-')) {
    const status = typeof ig.containerStatus === 'function' ? ig.containerStatus() : ig.containerStatus;
    return json({ status_code: status, id: path });
  }
  if (method === 'GET' && path.startsWith('media-')) return json({ permalink: `https://www.instagram.com/p/${path}/`, id: path });
  return json({ error: { message: 'unexpected call', code: 1 } }, 400);
}

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (url.hostname === 'graph.instagram.com') return instagram(url, init);
  if (url.hostname === 'example.supabase.co') return database(url, init);
  throw new Error(`a test reached ${url.hostname}, which nothing here should`);
};

// ---------------------------------------------------------------------------

const {
  captionCheck, priceFigures, planWeek, planDueWeeks, approvePosts, updatePost, schedulePost,
  publishDuePosts, publishNow, saveSettings, getSettings, upcomingSlots, DAILY_POST_CAP,
} = await import('../../services/marketing.js');
const { encryptToken } = await import('../../services/meta/tokens.js');
const { buildAuthorizeUrl, createState } = await import('../../services/meta/instagram.js');
const { RECONNECT_MESSAGE } = await import('../../services/meta/instagramPublish.js');
const { AGENT_BLUEPRINTS, DEPARTMENTS } = await import('../roles.js');
const { TOOLS, runTool } = await import('../tools/index.js');
const { canUserRunTool } = await import('../../security/permissions.js');
const { checkReply } = await import('../guard.js');

const TENANT = 't1';
// Monday 23 November 2026, 09:00 in Nairobi. The default posting times
// (Mon, Wed, Fri at 18:00) are therefore the 23rd, 25th and 27th at 15:00 UTC.
const NOW = new Date('2026-11-23T06:00:00Z');
const MON = '2026-11-23T15:00:00.000Z';
const WED = '2026-11-25T15:00:00.000Z';
const FRI = '2026-11-27T15:00:00.000Z';
const after = (iso, minutes = 5) => new Date(Date.parse(iso) + minutes * 60_000);

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P_BRIDAL = uuid(901);
const P_LACE = uuid(902);

function item(n, extra = {}) {
  return withDefaults('content_items', {
    id: uuid(n), tenant_id: TENANT, media_url: `https://cdn.example/${n}.jpg`, media_path: `${TENANT}/${n}.jpg`,
    caption: `Caption ${n}`, status: 'approved', about: `Thing ${n}`,
    created_at: new Date(Date.parse('2026-11-01T00:00:00Z') + n * 60_000).toISOString(),
    ...extra,
  });
}

function seed({ items = [item(1), item(2), item(3), item(4), item(5)], settings, facts = [] } = {}) {
  resetInstagram();
  missingTables = new Set();
  tables = {
    tenants: [{ id: TENANT, timezone: 'Africa/Nairobi', currency: 'KES' }],
    products: [
      { id: P_BRIDAL, tenant_id: TENANT, name: 'Bridal Bundle', description: 'Three bundles and a closure', price: 28000, in_stock: true },
      { id: P_LACE, tenant_id: TENANT, name: 'Lace Front Wig', description: '', price: 2500, in_stock: true },
    ],
    services: [{ id: uuid(801), tenant_id: TENANT, name: 'Wig Installation', description: '', price_amount: 1500, price_note: null, active: true }],
    business_facts: facts.map((value, i) => ({ tenant_id: TENANT, fact_key: `fact_${i}`, value })),
    content_items: items,
    scheduled_posts: [],
    posting_settings: settings ? [{ tenant_id: TENANT, last_planned_at: null, ...settings }] : [],
    notifications: [],
    meta_tokens: [{
      tenant_id: TENANT, platform: 'instagram', access_token_encrypted: encryptToken('test-instagram-token'),
      token_expires_at: null, phone_number_id: null, instagram_user_id: '1789', instagram_username: 'glamour',
      scopes: ['instagram_business_basic', 'instagram_business_content_publish'],
    }],
  };
}

const posts = () => tables.scheduled_posts;
const notes = (kind) => tables.notifications.filter((n) => n.kind === kind);
const publishCalls = () => ig.calls.filter((c) => c.endsWith('/media_publish')).length;
const createCalls = () => ig.calls.filter((c) => c.endsWith('/media')).length;

function post(extra = {}) {
  const row = withDefaults('scheduled_posts', {
    tenant_id: TENANT, content_item_id: uuid(1), caption: 'Caption 1', media_url: 'https://cdn.example/1.jpg',
    media_type: 'image', about: 'Thing 1', scheduled_for: MON, week_start: '2026-11-23', ...extra,
  });
  tables.scheduled_posts.push(row);
  return row;
}

// ---------------------------------------------------------------------------
console.log('\n--- the caption check ---');

await t('a price that is not in the catalogue is flagged', async () => {
  seed();
  const out = await captionCheck(TENANT, 'Our bridal bundle is now only KES 19,999!');
  assert.equal(out.ok, false);
  assert.match(out.reason, /price/i);
  assert.match(out.reason, /19,999/);
});

await t('a price that matches the catalogue passes, however it is written', async () => {
  seed();
  for (const caption of ['Bridal bundle, KES 28,000.', 'Lace fronts from Ksh 2500', 'Installation 1,500/=', 'sh 2,500 only', 'Now 28k KES']) {
    const out = await captionCheck(TENANT, caption);
    assert.equal(out.ok, true, `${caption} -> ${out.reason}`);
  }
});

await t('a bare number with thousands separators counts as a price', async () => {
  seed();
  assert.equal((await captionCheck(TENANT, 'Yours for 31,000 this week')).ok, false);
  assert.deepEqual(priceFigures('Call 0712 345 678 or visit shop 14').map((f) => f.value), [], 'a phone number is not a price');
});

await t('a caption about one product may not quote another product\'s price', async () => {
  seed();
  const out = await captionCheck(TENANT, 'The bridal bundle for KES 2,500', { product_id: P_BRIDAL });
  assert.equal(out.ok, false);
  assert.match(out.reason, /Bridal Bundle is 28000/);
});

await t('offer words need a business fact behind them', async () => {
  seed();
  for (const caption of ['20% off all wigs this week', 'Huge discount on bundles', 'Free delivery in Nairobi', 'Our weekend sale is on', 'Special offer ends Friday']) {
    assert.equal((await captionCheck(TENANT, caption)).ok, false, caption);
  }
  for (const caption of ['We offer braiding and installs', 'Feel free to message us', 'Lace fronts for sale now']) {
    const out = await captionCheck(TENANT, caption);
    assert.equal(out.ok, true, `${caption} -> ${out.reason}`);
  }

  seed({ facts: ['Free delivery within Nairobi for orders above 5000', 'December discount: 20% off closures'] });
  assert.equal((await captionCheck(TENANT, 'Free delivery in Nairobi')).ok, true);
  assert.equal((await captionCheck(TENANT, '20% discount on closures')).ok, true);
  assert.equal((await captionCheck(TENANT, '50% discount on closures')).ok, false, 'a different percentage is a different offer');
});

// ---------------------------------------------------------------------------
console.log('\n--- planning a week ---');

await t('posting times are read in the business timezone', () => {
  const slots = upcomingSlots([{ day: 1, time: '18:00' }, { day: 3, time: '18:00' }, { day: 5, time: '18:00' }], 'Africa/Nairobi', NOW);
  assert.deepEqual(slots.map((s) => s.toISOString()), [MON, WED, FRI]);
});

await t('a week is proposed from approved items, one per posting time, never the same item twice', async () => {
  seed({ items: [item(1), item(2), item(3), item(4, { status: 'draft' }), item(5, { status: 'archived' })] });
  const plan = await planWeek(TENANT, { now: NOW });
  assert.equal(plan.proposed.length, 3);
  assert.deepEqual(plan.proposed.map((p) => p.scheduled_for), [MON, WED, FRI]);
  assert.equal(new Set(plan.proposed.map((p) => p.content_item_id)).size, 3, 'no item is repeated');
  assert.ok(plan.proposed.every((p) => p.status === 'proposed'), 'the default mode only proposes');
  assert.ok(plan.proposed.every((p) => p.approved_at === null));
  assert.ok(!plan.proposed.some((p) => [uuid(4), uuid(5)].includes(p.content_item_id)), 'drafts and archived items are never posted');
  assert.equal(plan.unfilled.length, 0);
});

await t('planning the same week again adds nothing, and announces it once', async () => {
  seed();
  await planWeek(TENANT, { now: NOW });
  const again = await planWeek(TENANT, { now: NOW });
  assert.equal(again.proposed.length, 0);
  assert.equal(again.already_planned, 3);
  assert.equal(posts().length, 3);
  assert.equal(notes('posts_to_approve').length, 1);
  assert.match(notes('posts_to_approve')[0].title, /3 posts to approve/);
});

await t('two plans started at the same moment still make one calendar', async () => {
  seed();
  await Promise.all([planWeek(TENANT, { now: NOW }), planWeek(TENANT, { now: NOW })]);
  assert.equal(posts().length, 3);
  assert.equal(new Set(posts().map((p) => p.scheduled_for)).size, 3);
});

await t('an item that has reached its reuse limit is not chosen', async () => {
  seed({ items: [item(1, { max_uses: 1, times_used: 1 }), item(2), item(3), item(4)] });
  const plan = await planWeek(TENANT, { now: NOW });
  assert.equal(plan.proposed.length, 3);
  assert.ok(!plan.proposed.some((p) => p.content_item_id === uuid(1)));
});

await t('a use already waiting on the calendar counts towards the limit', async () => {
  seed({ items: [item(1, { max_uses: 1 }), item(2)] });
  post({ content_item_id: uuid(1), scheduled_for: '2026-12-20T15:00:00.000Z', status: 'approved' });
  const plan = await planWeek(TENANT, { now: NOW });
  assert.deepEqual(plan.proposed.map((p) => p.content_item_id), [uuid(2)]);
});

await t('posting times it cannot fill are reported, with the reason', async () => {
  seed({ items: [item(1), item(2)] });
  const plan = await planWeek(TENANT, { now: NOW });
  assert.equal(plan.proposed.length, 2);
  assert.equal(plan.unfilled.length, 1);
  assert.equal(plan.unfilled[0].scheduled_for, FRI);
  assert.match(plan.unfilled[0].when, /Friday 27 Nov, 18:00/);
  assert.match(plan.unfilled[0].why, /already in this week|library/i);
  assert.match(notes('posts_to_approve')[0].body, /running low/);

  seed({ items: [] });
  const empty = await planWeek(TENANT, { now: NOW });
  assert.equal(empty.proposed.length, 0);
  assert.equal(empty.unfilled.length, 3);
  assert.equal(notes('posts_to_approve').length, 0, 'nothing to approve, nothing announced');
});

await t('the same product is not posted twice running when there is something else', async () => {
  seed({ items: [
    item(1, { product_id: P_BRIDAL, about: 'Bridal Bundle' }),
    item(2, { product_id: P_BRIDAL, about: 'Bridal Bundle' }),
    item(3, { product_id: P_LACE, about: 'Lace Front Wig' }),
  ] });
  const plan = await planWeek(TENANT, { now: NOW });
  assert.deepEqual(plan.proposed.map((p) => p.about), ['Bridal Bundle', 'Lace Front Wig', 'Bridal Bundle']);
});

await t('a rejected post is replaced by a different item, not the same one', async () => {
  seed({ items: [item(1), item(2), item(3), item(4)] });
  const first = await planWeek(TENANT, { now: NOW });
  const rejected = first.proposed[0];
  await updatePost(TENANT, rejected.id, { status: 'rejected' }, { by: 'u1', now: NOW });
  const again = await planWeek(TENANT, { now: NOW });
  assert.equal(again.proposed.length, 1);
  assert.equal(again.proposed[0].scheduled_for, rejected.scheduled_for);
  assert.notEqual(again.proposed[0].content_item_id, rejected.content_item_id);
});

await t('a caption that fails the check is proposed with the reason attached', async () => {
  seed({ items: [item(1, { caption: 'Bundles at KES 999 this week only' }), item(2), item(3)] });
  const plan = await planWeek(TENANT, { now: NOW });
  const flagged = plan.proposed.find((p) => p.content_item_id === uuid(1));
  assert.match(flagged.needs_review_reason, /price/i);
  assert.match(notes('posts_to_approve')[0].body, /1 should be read first/);
});

await t('autopilot approves clean posts itself, but never one that needs a read', async () => {
  seed({
    items: [item(1, { caption: 'Huge discount today' }), item(2), item(3)],
    settings: { approval_mode: 'autopilot', paused: false, slots: [{ day: 1, time: '18:00' }, { day: 3, time: '18:00' }, { day: 5, time: '18:00' }] },
  });
  const plan = await planWeek(TENANT, { now: NOW });
  const flagged = plan.proposed.find((p) => p.content_item_id === uuid(1));
  assert.equal(flagged.status, 'proposed', 'a post with a reason is never auto-approved');
  assert.equal(plan.proposed.filter((p) => p.status === 'approved').length, 2);
  assert.ok(plan.proposed.filter((p) => p.status === 'approved').every((p) => p.approved_at));
});

await t('the scheduler lays out a week once, not on every run', async () => {
  seed();
  const first = await planDueWeeks({ now: NOW });
  assert.equal(first.planned, 1);
  assert.equal(first.proposed, 3);
  const second = await planDueWeeks({ now: after(NOW.toISOString(), 5) });
  assert.equal(second.planned, 0);
  assert.equal(posts().length, 3);

  seed({ settings: { approval_mode: 'week', paused: true, slots: [{ day: 1, time: '18:00' }] } });
  assert.equal((await planDueWeeks({ now: NOW })).planned, 0, 'a paused business is not planned for');
});

// ---------------------------------------------------------------------------
console.log('\n--- approving ---');

await t('approving a week approves its proposed posts and nothing else', async () => {
  seed();
  await planWeek(TENANT, { now: NOW });
  const rejected = posts()[2];
  await updatePost(TENANT, rejected.id, { status: 'rejected' }, { by: 'u1', now: NOW });

  const out = await approvePosts(TENANT, { weekStart: '2026-11-23', by: 'u1', now: NOW });
  assert.equal(out.approved.length, 2);
  assert.ok(out.approved.every((p) => p.status === 'approved' && p.approved_by === 'u1' && p.approved_at));
  assert.equal(posts().find((p) => p.id === rejected.id).status, 'rejected');
});

await t('a post whose time has passed cannot be approved late', async () => {
  seed();
  const late = post({ scheduled_for: MON });
  const out = await approvePosts(TENANT, { ids: [late.id], by: 'u1', now: after(MON, 60) });
  assert.equal(out.approved.length, 0);
  assert.match(out.skipped[0].why, /passed/);
  assert.equal(late.status, 'proposed');
});

await t('"approve each post" refuses to approve a whole week at once', async () => {
  seed({ settings: { approval_mode: 'each', paused: false, slots: [{ day: 1, time: '18:00' }] } });
  const one = post();
  await assert.rejects(() => approvePosts(TENANT, { weekStart: '2026-11-23', by: 'u1', now: NOW }), /one at a time/);
  assert.equal(one.status, 'proposed');
  assert.equal((await approvePosts(TENANT, { ids: [one.id], by: 'u1', now: NOW })).approved.length, 1);
});

await t('a caption Shwari rewrites on an approved post sends it back for approval', async () => {
  seed();
  const p = post({ status: 'approved', approved_by: 'u1', approved_at: NOW.toISOString() });
  const byAgent = await updatePost(TENANT, p.id, { caption: 'A warmer caption' }, { by: 'u1', byAgent: true, now: NOW });
  assert.equal(byAgent.status, 'proposed');
  assert.equal(byAgent.approved_at, null);

  const q = post({ status: 'approved', scheduled_for: WED });
  const byPerson = await updatePost(TENANT, q.id, { caption: 'Edited by the owner, KES 77' }, { by: 'u1', now: NOW });
  assert.equal(byPerson.status, 'approved', 'the owner editing their own approved post keeps it approved');
  assert.match(byPerson.needs_review_reason, /price/i, 'but the check still runs and is shown');
});

await t('a published post cannot be changed', async () => {
  seed();
  const p = post({ status: 'published' });
  await assert.rejects(() => updatePost(TENANT, p.id, { caption: 'x' }, { by: 'u1', now: NOW }), /already been published/);
  await assert.rejects(() => updatePost(TENANT, p.id, { status: 'cancelled' }, { by: 'u1', now: NOW }), /already been published/);
});

await t('only an approved library item can be put on the calendar', async () => {
  seed({ items: [item(1, { status: 'draft' }), item(2)] });
  await assert.rejects(() => schedulePost(TENANT, { contentItemId: uuid(1), scheduledFor: new Date(WED), now: NOW }), /approved library item/);
  const ok = await schedulePost(TENANT, { contentItemId: uuid(2), scheduledFor: new Date(WED), now: NOW });
  assert.equal(ok.status, 'proposed');
  await assert.rejects(() => schedulePost(TENANT, { contentItemId: uuid(2), scheduledFor: new Date(WED), now: NOW }), /already a post at that time/);
});

// ---------------------------------------------------------------------------
console.log('\n--- publishing ---');

await t('an unapproved week publishes nothing', async () => {
  seed();
  await planWeek(TENANT, { now: NOW });
  const out = await publishDuePosts({ now: after(FRI, 60) });
  assert.equal(out.due, 0);
  assert.equal(out.published, 0);
  assert.equal(ig.calls.length, 0, 'Instagram was never called');
  assert.ok(posts().every((p) => p.status === 'proposed'));
});

await t('only approved posts whose time has come are published', async () => {
  seed();
  const due = post({ status: 'approved', scheduled_for: MON });
  const later = post({ status: 'approved', scheduled_for: WED, content_item_id: uuid(2) });
  const proposed = post({ status: 'proposed', scheduled_for: '2026-11-23T14:00:00.000Z', content_item_id: uuid(3) });
  const rejected = post({ status: 'rejected', scheduled_for: '2026-11-23T13:00:00.000Z', content_item_id: uuid(4) });
  const cancelled = post({ status: 'cancelled', scheduled_for: '2026-11-23T12:00:00.000Z', content_item_id: uuid(5) });

  const out = await publishDuePosts({ now: after(MON) });
  assert.equal(out.published, 1);
  assert.equal(publishCalls(), 1);
  assert.equal(due.status, 'published');
  assert.equal(due.external_post_id, 'media-1');
  assert.equal(due.external_permalink, 'https://www.instagram.com/p/media-1/');
  assert.ok(due.published_at);
  assert.equal(later.status, 'approved', 'not yet due');
  assert.equal(proposed.status, 'proposed');
  assert.equal(rejected.status, 'rejected');
  assert.equal(cancelled.status, 'cancelled');

  const used = tables.content_items.find((i) => i.id === uuid(1));
  assert.equal(used.times_used, 1);
  assert.ok(used.last_used_at);
  assert.equal(notes('post_published').length, 1);
});

await t('a second run finds nothing: a post is never published twice', async () => {
  seed();
  post({ status: 'approved', scheduled_for: MON });
  await publishDuePosts({ now: after(MON) });
  const again = await publishDuePosts({ now: after(MON, 10) });
  assert.equal(again.due, 0);
  assert.equal(again.published, 0);
  assert.equal(publishCalls(), 1);
  assert.equal(ig.published.length, 1);
});

await t('two runners at the same moment publish it once', async () => {
  seed();
  post({ status: 'approved', scheduled_for: MON });
  const [a, b] = await Promise.all([publishDuePosts({ now: after(MON) }), publishDuePosts({ now: after(MON) })]);
  assert.equal(a.published + b.published, 1);
  assert.equal(publishCalls(), 1);
});

await t('a failure is recorded with a reason a person can act on, and is not retried', async () => {
  seed();
  const p = post({ status: 'approved', scheduled_for: MON });
  ig.failCreate = { status: 400, body: { error: { message: '(#10) Application does not have permission for this action', type: 'OAuthException', code: 10 } } };

  const out = await publishDuePosts({ now: after(MON) });
  assert.equal(out.failed, 1);
  assert.equal(p.status, 'failed');
  assert.equal(p.failure_reason, RECONNECT_MESSAGE);
  assert.match(p.failure_reason, /Reconnect Instagram/);
  assert.equal(notes('post_failed').length, 1);
  assert.equal(publishCalls(), 0);

  ig.failCreate = null;
  const again = await publishDuePosts({ now: after(MON, 10) });
  assert.equal(again.due, 0, 'a failed post waits for a person');
  assert.equal(publishCalls(), 0);
});

await t('if Instagram does not confirm, the reason says it may have gone out', async () => {
  seed();
  const p = post({ status: 'approved', scheduled_for: MON });
  ig.failPublish = { status: 500, body: { error: { message: 'An unknown error occurred', code: 2 } } };
  await publishDuePosts({ now: after(MON) });
  assert.equal(p.status, 'failed');
  assert.match(p.failure_reason, /may or may not have gone out/);
  ig.failPublish = null;
  await publishDuePosts({ now: after(MON, 10) });
  assert.equal(publishCalls(), 1, 'it is not published again to find out');
});

await t('with no Instagram connection the post fails plainly and nothing is sent', async () => {
  seed();
  tables.meta_tokens = [];
  const p = post({ status: 'approved', scheduled_for: MON });
  await publishDuePosts({ now: after(MON) });
  assert.equal(p.status, 'failed');
  assert.match(p.failure_reason, /not connected/);
  assert.equal(ig.calls.length, 0);
});

await t('paused means nothing is published, and the post keeps its approval', async () => {
  seed({ settings: { approval_mode: 'week', paused: true, slots: [{ day: 1, time: '18:00' }] } });
  const p = post({ status: 'approved', scheduled_for: MON });
  const out = await publishDuePosts({ now: after(MON) });
  assert.equal(out.published, 0);
  assert.equal(out.held, 1);
  assert.equal(ig.calls.length, 0);
  assert.equal(p.status, 'approved');

  await saveSettings(TENANT, { paused: false });
  assert.equal((await publishDuePosts({ now: after(MON, 30) })).published, 1, 'it goes out once posting is resumed');
});

await t('a post more than a day late is marked missed, not published late', async () => {
  seed();
  const p = post({ status: 'approved', scheduled_for: MON });
  const out = await publishDuePosts({ now: after(MON, 25 * 60) });
  assert.equal(out.failed, 1);
  assert.equal(p.status, 'failed');
  assert.match(p.failure_reason, /missed its time/);
  assert.equal(ig.calls.length, 0);
});

await t('a post stuck in publishing is marked failed honestly, never sent again', async () => {
  seed();
  const p = post({ status: 'publishing', scheduled_for: MON, updated_at: after(MON, 1).toISOString() });
  const out = await publishDuePosts({ now: after(MON, 30) });
  assert.equal(out.swept, 1);
  assert.equal(p.status, 'failed');
  assert.match(p.failure_reason, /may or may not have gone out/);
  assert.equal(ig.calls.length, 0);

  const fresh = post({ status: 'publishing', scheduled_for: WED, updated_at: after(WED, 1).toISOString() });
  await publishDuePosts({ now: after(WED, 5) });
  assert.equal(fresh.status, 'publishing', 'one that started a moment ago is left alone');
});

await t('the daily ceiling holds further posts back', async () => {
  seed();
  for (let i = 0; i < DAILY_POST_CAP; i++) {
    post({ status: 'published', scheduled_for: new Date(Date.parse(MON) - (i + 1) * 60_000).toISOString(), published_at: new Date(Date.parse(MON) - (i + 1) * 60_000).toISOString() });
  }
  const p = post({ status: 'approved', scheduled_for: MON });
  const out = await publishDuePosts({ now: after(MON) });
  assert.equal(out.held, 1);
  assert.equal(p.status, 'approved');
  assert.equal(ig.calls.length, 0);
});

await t('a video still processing is resumed from its container, not uploaded again', async () => {
  seed();
  const p = post({ status: 'approved', scheduled_for: MON, media_type: 'video', media_url: 'https://cdn.example/1.mp4' });
  ig.containerStatus = 'IN_PROGRESS';
  const first = await publishDuePosts({ now: after(MON), budgetMs: 4_000 });
  assert.equal(first.published, 0);
  assert.equal(first.held, 1);
  assert.equal(p.status, 'approved');
  assert.equal(p.container_id, 'container-1');
  assert.equal(publishCalls(), 0);

  ig.containerStatus = 'FINISHED';
  const second = await publishDuePosts({ now: after(MON, 10) });
  assert.equal(second.published, 1);
  assert.equal(createCalls(), 1, 'the video was uploaded once');
  assert.equal(ig.published[0].creation, 'container-1');
});

await t('publish now is itself the approval, and still publishes once', async () => {
  seed();
  const p = post({ status: 'proposed', scheduled_for: WED });
  const [a, b] = await Promise.allSettled([
    publishNow(TENANT, p.id, { by: 'u1', now: NOW }),
    publishNow(TENANT, p.id, { by: 'u1', now: NOW }),
  ]);
  assert.ok([a, b].some((r) => r.status === 'fulfilled' && r.value.outcome === 'published'));
  assert.equal(publishCalls(), 1);
  assert.equal(p.status, 'published');
  assert.equal(p.approved_by, 'u1');
  await assert.rejects(() => publishNow(TENANT, p.id, { by: 'u1', now: NOW }), /already been published/);
});

await t('before migration 0024 is applied nothing breaks and nothing is published', async () => {
  seed();
  missingTables = new Set(['scheduled_posts', 'content_items', 'posting_settings']);
  const plan = await planWeek(TENANT, { now: NOW });
  assert.equal(plan.available, false);
  assert.deepEqual(await publishDuePosts({ now: NOW }), { due: 0, published: 0, failed: 0, held: 0, deferred: 0, swept: 0 });
  assert.deepEqual(await planDueWeeks({ now: NOW }), { checked: 0, planned: 0, proposed: 0 });
  assert.equal((await getSettings(TENANT)).approval_mode, 'week', 'the default is approve the week');
  assert.equal(ig.calls.length, 0);
});

// ---------------------------------------------------------------------------
console.log('\n--- Shwari and the calendar ---');

const MARKETING_TOOLS = [
  'list_content_library', 'propose_week_posts', 'list_scheduled_posts', 'approve_posts',
  'update_scheduled_post', 'set_posting_schedule', 'pause_posting',
];

const managerCtx = (extra = {}) => ({
  tenantId: TENANT, userId: 'u1', agentRole: 'manager', conversationId: null,
  allowedTools: AGENT_BLUEPRINTS.manager.tools, userRole: 'owner', timezone: 'Africa/Nairobi',
  turn: { done: new Map() }, ...extra,
});
const call = (name, args, ctx = managerCtx()) => runTool(TOOLS, name, JSON.stringify(args), ctx);

await t('the posting tools exist and only the manager holds them', () => {
  for (const name of MARKETING_TOOLS) {
    assert.ok(TOOLS.has(name), `${name} is not in the catalogue`);
    assert.ok(AGENT_BLUEPRINTS.manager.tools.includes(name), `Shwari is missing ${name}`);
    for (const role of DEPARTMENTS) {
      assert.ok(!AGENT_BLUEPRINTS[role].tools.includes(name), `${role} must not hold ${name}`);
    }
  }
});

await t('every posting tool has a label on the AI team page', async () => {
  const page = await readFile(new URL('../../../pages/Agents.tsx', import.meta.url), 'utf8');
  for (const name of MARKETING_TOOLS) {
    assert.ok(page.includes(`${name}:`), `${name} would show as a raw tool name`);
  }
});

await t('a customer-facing department cannot reach the calendar even if it asks', async () => {
  seed();
  const p = post();
  const ctx = { tenantId: TENANT, userId: null, agentRole: 'sales', conversationId: 'c1', allowedTools: AGENT_BLUEPRINTS.sales.tools, turn: { done: new Map() } };
  const out = await call('approve_posts', { post_ids: [p.id] }, ctx);
  assert.equal(out.ok, false);
  assert.match(out.payload.error, /not permitted/);
  assert.equal(p.status, 'proposed');
});

await t('a staff member without the right role cannot approve posts through Shwari', async () => {
  seed();
  const p = post();
  for (const name of ['approve_posts', 'update_scheduled_post', 'pause_posting', 'set_posting_schedule', 'propose_week_posts']) {
    assert.equal(canUserRunTool('member', name), false, `${name} is open to members`);
    assert.equal(canUserRunTool('admin', name), true);
  }
  const out = await call('approve_posts', { post_ids: [p.id] }, managerCtx({ userRole: 'member' }));
  assert.equal(out.ok, false);
  assert.equal(p.status, 'proposed');
});

await t('proposing a week reports real counts, and says nothing is approved', async () => {
  seed({ items: [item(1), item(2)] });
  const out = await call('propose_week_posts', {});
  assert.equal(out.ok, true);
  // The tool reads the real clock, so only the shape is asserted here.
  assert.equal(out.payload.proposed_count, out.payload.proposed.length);
  assert.equal(out.payload.proposed_count, posts().length);
  assert.equal(out.payload.waiting_for_approval, posts().length);
  assert.equal(out.payload.unfilled_count, out.payload.unfilled.length);
  assert.ok(posts().every((p) => p.status === 'proposed'));
  if (posts().length) assert.match(out.payload.note, /NOT approved and will NOT be published/);
});

await t('approving through Shwari approves exactly what was named, and says it is not yet posted', async () => {
  seed();
  const future = (days) => new Date(Date.now() + days * 86_400_000).toISOString();
  const a = post({ scheduled_for: future(1) });
  const b = post({ scheduled_for: future(2), content_item_id: uuid(2) });
  const out = await call('approve_posts', { post_ids: [a.id, 'not-a-post'] });
  assert.equal(out.ok, true);
  assert.equal(out.payload.approved_count, 1);
  assert.equal(out.payload.not_approved_count, 1);
  assert.equal(a.status, 'approved');
  assert.equal(a.approved_by, 'u1');
  assert.equal(b.status, 'proposed');
  assert.match(out.payload.note, /approved, not yet published/);
  assert.equal(ig.calls.length, 0, 'approving publishes nothing by itself');
  assert.equal(tables.payments, undefined, 'approving posts never reads or writes a payment');
  assert.equal(tables.orders, undefined);
});

await t('reading the calendar tells Shwari what is and is not approved', async () => {
  seed({ settings: { approval_mode: 'week', paused: true, slots: [{ day: 1, time: '18:00' }] } });
  post({ scheduled_for: new Date(Date.now() + 86_400_000).toISOString() });
  const out = await call('list_scheduled_posts', {});
  assert.equal(out.payload.total, 1);
  assert.deepEqual(out.payload.by_status, { proposed: 1 });
  assert.equal(out.payload.posting_paused, true);
  assert.match(out.payload.note, /1 post is waiting for approval/);
  assert.match(out.payload.note, /paused/);
});

await t('pausing through Shwari stops publishing', async () => {
  seed();
  const p = post({ status: 'approved', scheduled_for: MON });
  const out = await call('pause_posting', { paused: true });
  assert.equal(out.payload.posting_paused, true);
  assert.equal((await publishDuePosts({ now: after(MON) })).published, 0);
  assert.equal(p.status, 'approved');
});

await t('the schedule Shwari sets is the one the dashboard reads', async () => {
  seed();
  const out = await call('set_posting_schedule', { slots: [{ day: 2, time: '9:30' }, { day: 6, time: '12:00' }, { day: 9, time: 'noon' }], approval_mode: 'each' });
  assert.equal(out.ok, true);
  assert.equal(out.payload.posts_per_week, 2);
  assert.deepEqual(out.payload.posting_times, ['Tuesday 09:30', 'Saturday 12:00']);
  const saved = await getSettings(TENANT);
  assert.equal(saved.approval_mode, 'each');
  assert.deepEqual(saved.slots, [{ day: 2, time: '09:30' }, { day: 6, time: '12:00' }]);
});

await t('the library tool shows what there is and never offers to make media', async () => {
  seed({ items: [item(1), item(2, { status: 'draft', caption: 'Half price today, KES 5' })] });
  const out = await call('list_content_library', {});
  assert.equal(out.payload.total, 2);
  assert.deepEqual(out.payload.by_status, { approved: 1, draft: 1 });
  assert.match(out.payload.items.find((i) => i.status === 'draft').needs_review, /price/i);
  for (const name of MARKETING_TOOLS) {
    assert.ok(!/generate|create (?:an? )?(?:image|photo|video)/i.test(TOOLS.get(name).description.replace(/cannot[^.]*\./gi, '')), `${name} must not offer to make media`);
  }
});

await t('saying posts were approved or published without doing it is caught', () => {
  const names = [...TOOLS.keys()];
  const check = (reply, okTools = []) => checkReply({ reply, okTools, toolNames: names, customerFacing: false });
  assert.ok(check("I've approved all three posts for this week.").issues.includes('unbacked_action'));
  assert.ok(check('Your posts have been published to Instagram.').issues.includes('unbacked_action'));
  assert.ok(check("I've approved all three posts for this week.", ['approve_posts']).ok);
  assert.ok(check('3 posts are laid out and none is approved yet. Shall I approve them?', ['list_scheduled_posts']).ok);
});

await t('connecting Instagram now asks for permission to post', () => {
  const url = decodeURIComponent(buildAuthorizeUrl(createState()));
  assert.match(url, /instagram_business_content_publish/);
  assert.match(url, /instagram_business_manage_messages/);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
