/**
 * Tenancy, idempotency and takeover tests for the inbound path.
 *
 * These exercise src/server/services/inbound.ts against a stubbed PostgREST
 * layer: supabase-js talks over fetch, so intercepting fetch runs the real
 * client, the real query building and the real handler logic without needing
 * database connectivity. What is stubbed is the database's answers, not any of
 * the code under test.
 *
 * Run with:  npx tsx src/server/channels/meta/__tests__/routing.test.mjs
 */

import assert from 'node:assert';

process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_ANON_KEY = 'stub-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-service-key';
process.env.META_APP_SECRET = 'test-app-secret';
process.env.N8N_META_WEBHOOK_URL = 'https://n8n.invalid/webhook/meta-in';

let pass = 0;
let fail = 0;

async function t(name, fn) {
  db.reset();
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
// Stub database
// ---------------------------------------------------------------------------

const db = {
  channels: [],
  webhook_events: [],
  conversations: [],
  conversation_messages: [],
  leads: [],
  pipelineCalls: [],
  reset() {
    this.channels = [];
    this.webhook_events = [];
    this.conversations = [];
    this.conversation_messages = [];
    this.leads = [];
    this.pipelineCalls = [];
  },
};

/** `eq.VALUE` → VALUE, for the filters supabase-js puts in the query string. */
const eqValue = (v) => (v && v.startsWith('eq.') ? v.slice(3) : v);

function matches(row, params) {
  for (const [key, raw] of params) {
    if (key === 'select' || key === 'on_conflict' || key === 'columns') continue;
    if (row[key] !== eqValue(raw)) return false;
  }
  return true;
}

const realFetch = globalThis.fetch;

/** supabase-js may pass a Headers instance, an array or a plain object. */
function headerMap(headers) {
  const out = {};
  if (!headers) return out;
  if (typeof headers.forEach === 'function' && !Array.isArray(headers)) {
    headers.forEach((value, key) => { out[String(key).toLowerCase()] = value; });
    return out;
  }
  for (const [key, value] of Array.isArray(headers) ? headers : Object.entries(headers)) {
    out[String(key).toLowerCase()] = value;
  }
  return out;
}

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const headers = headerMap(init.headers);

  // The onward hop to the AI pipeline.
  if (url.hostname === 'n8n.invalid') {
    db.pipelineCalls.push({
      secret: headers['x-channel-secret'],
      body: JSON.parse(init.body),
    });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }

  if (url.hostname !== 'stub.supabase.co') return realFetch(input, init);

  const table = url.pathname.replace('/rest/v1/', '');
  const method = (init.method ?? 'GET').toUpperCase();
  const params = [...url.searchParams.entries()];
  const wantsSingle = String(headers.accept ?? '').includes('pgrst.object');

  const json = (payload, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  if (method === 'GET') {
    const rows = (db[table] ?? []).filter((r) => matches(r, params));
    if (wantsSingle) {
      if (rows.length === 0) {
        // What PostgREST returns for .maybeSingle() with no match.
        return json({ code: 'PGRST116', message: 'no rows' }, 406);
      }
      return json(rows[0]);
    }
    return json(rows);
  }

  if (method === 'POST') {
    const payload = JSON.parse(init.body);
    const rows = Array.isArray(payload) ? payload : [payload];
    const inserted = [];

    for (const row of rows) {
      // Emulate the unique constraint that makes delivery idempotent.
      if (table === 'webhook_events') {
        const clash = db.webhook_events.some(
          (e) => e.provider === row.provider && e.event_id === row.event_id
        );
        if (clash) {
          return json(
            { code: '23505', message: 'duplicate key value violates unique constraint' },
            409
          );
        }
      }
      const stored = { id: `${table}-${db[table].length + 1}`, ai_enabled: true, ...row };
      db[table].push(stored);
      inserted.push(stored);
    }
    return wantsSingle ? json(inserted[0], 201) : json(inserted, 201);
  }

  if (method === 'PATCH') {
    const payload = JSON.parse(init.body);
    const updated = [];
    for (const row of db[table] ?? []) {
      if (!matches(row, params)) continue;
      Object.assign(row, payload);
      updated.push(row);
    }
    return wantsSingle ? json(updated[0] ?? null) : json(updated);
  }

  return json([], 200);
};

const { resolveChannel, claimEvent, persistInbound, forwardToPipeline, normalize } =
  await import('../../../services/inbound.ts');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const TENANT_B = 'bbbbbbbb-0000-0000-0000-000000000002';

function connectChannel({
  id = 'chan-a', tenant = TENANT_A, type = 'whatsapp',
  account = 'PHONE_A', status = 'active', secret = 'secret-a',
} = {}) {
  db.channels.push({
    id, tenant_id: tenant, channel_type: type,
    channel_account_id: account, status, secret_token: secret,
  });
}

const event = (over = {}) => ({
  tenantId: TENANT_A,
  channelId: 'chan-a',
  channelType: 'whatsapp',
  customerId: '254700000001',
  customerName: 'Amina',
  messageId: 'wamid.ONE',
  text: 'Hello',
  media: null,
  timestamp: '2026-08-11T20:00:00.000Z',
  ...over,
});

// ---------------------------------------------------------------------------
console.log('\n--- channel resolution ---');
// ---------------------------------------------------------------------------

await t('resolves an account to its own tenant', async () => {
  connectChannel();
  const c = await resolveChannel('whatsapp', 'PHONE_A');
  assert.equal(c.tenantId, TENANT_A);
  assert.equal(c.id, 'chan-a');
});

await t('an unknown account resolves to nothing', async () => {
  connectChannel();
  assert.equal(await resolveChannel('whatsapp', 'PHONE_UNKNOWN'), null);
});

await t('a disabled channel is resolved but reports its status', async () => {
  connectChannel({ status: 'disabled' });
  const c = await resolveChannel('whatsapp', 'PHONE_A');
  assert.equal(c.status, 'disabled', 'the route drops it on this, rather than treating it as active');
});

await t('the same account id on another product is a different channel', async () => {
  connectChannel({ id: 'chan-wa', type: 'whatsapp', account: 'SHARED_ID', tenant: TENANT_A });
  connectChannel({ id: 'chan-ig', type: 'instagram', account: 'SHARED_ID', tenant: TENANT_B });

  assert.equal((await resolveChannel('whatsapp', 'SHARED_ID')).tenantId, TENANT_A);
  assert.equal((await resolveChannel('instagram', 'SHARED_ID')).tenantId, TENANT_B);
});

await t('tenancy comes from the channel row, not from the payload', async () => {
  connectChannel({ tenant: TENANT_A });
  const channel = await resolveChannel('whatsapp', 'PHONE_A');
  // A hostile payload claiming another tenant cannot change the outcome:
  // normalize() takes tenancy only from the resolved channel.
  const [normalized] = normalize(
    { accountId: 'PHONE_A', messages: [{ ...event(), tenantId: TENANT_B, tenant_id: TENANT_B }] },
    channel
  );
  assert.equal(normalized.tenantId, TENANT_A);
});

// ---------------------------------------------------------------------------
console.log('\n--- idempotency ---');
// ---------------------------------------------------------------------------

await t('a first delivery is claimed', async () => {
  assert.equal(await claimEvent('whatsapp', 'wamid.ONE', TENANT_A, 'chan-a'), true);
});

await t('a repeated delivery is refused', async () => {
  assert.equal(await claimEvent('whatsapp', 'wamid.ONE', TENANT_A, 'chan-a'), true);
  assert.equal(await claimEvent('whatsapp', 'wamid.ONE', TENANT_A, 'chan-a'), false);
  assert.equal(db.webhook_events.length, 1);
});

await t('the same id from a different product is a different event', async () => {
  assert.equal(await claimEvent('whatsapp', 'shared-id', TENANT_A, 'chan-a'), true);
  assert.equal(await claimEvent('instagram', 'shared-id', TENANT_A, 'chan-b'), true);
});

await t('a duplicate delivery creates no second message or lead', async () => {
  connectChannel();
  const e = event();

  for (let i = 0; i < 3; i++) {
    if (await claimEvent('whatsapp', e.messageId, e.tenantId, e.channelId)) {
      await persistInbound(e);
    }
  }

  assert.equal(db.conversation_messages.length, 1, 'one message');
  assert.equal(db.conversations.length, 1, 'one conversation');
  assert.equal(db.leads.length, 1, 'one lead');
});

// ---------------------------------------------------------------------------
console.log('\n--- inbox persistence ---');
// ---------------------------------------------------------------------------

await t('a new customer creates a conversation, a message and a lead', async () => {
  const result = await persistInbound(event());
  assert.equal(db.conversations.length, 1);
  assert.equal(db.conversation_messages.length, 1);
  assert.equal(db.leads.length, 1);

  const convo = db.conversations[0];
  assert.equal(convo.tenant_id, TENANT_A);
  assert.equal(convo.customer_id, '254700000001');
  assert.equal(convo.unread_count, 1);
  assert.equal(convo.last_message_preview, 'Hello');
  assert.equal(db.conversation_messages[0].sender, 'customer');
  assert.equal(result.aiEnabled, true);
});

await t('a second message increments unread instead of duplicating', async () => {
  await persistInbound(event());
  await persistInbound(event({ messageId: 'wamid.TWO', text: 'Still there?' }));

  assert.equal(db.conversations.length, 1);
  assert.equal(db.conversations[0].unread_count, 2);
  assert.equal(db.conversations[0].last_message_preview, 'Still there?');
  assert.equal(db.conversation_messages.length, 2);
});

await t('the provider message id is recorded on the message', async () => {
  await persistInbound(event());
  assert.equal(db.conversation_messages[0].extracted.provider_message_id, 'wamid.ONE');
});

await t('an image with no text still gets a readable preview', async () => {
  await persistInbound(event({ text: null, media: { kind: 'image', mediaId: 'M1', mimeType: 'image/jpeg', caption: null } }));
  assert.equal(db.conversations[0].last_message_preview, '[image]');
  assert.equal(db.conversation_messages[0].extracted.media.kind, 'image');
});

await t('a WhatsApp lead records the phone, an Instagram lead does not', async () => {
  await persistInbound(event());
  assert.equal(db.leads[0].phone, '254700000001');

  db.reset();
  await persistInbound(event({ channelType: 'instagram', customerId: 'IG_SCOPED_ID' }));
  assert.equal(db.leads[0].phone, null, 'an Instagram id is not a phone number');
});

await t('two tenants messaged by the same person keep separate records', async () => {
  await persistInbound(event({ tenantId: TENANT_A }));
  await persistInbound(event({ tenantId: TENANT_B, channelId: 'chan-b', messageId: 'wamid.OTHER' }));

  assert.equal(db.conversations.length, 2, 'one conversation per tenant');
  assert.equal(db.leads.length, 2, 'one lead per tenant');
  assert.deepEqual(
    db.conversations.map((c) => c.tenant_id).sort(),
    [TENANT_A, TENANT_B].sort()
  );
});

// ---------------------------------------------------------------------------
console.log('\n--- AI takeover ---');
// ---------------------------------------------------------------------------

await t('a fresh conversation is AI-handled', async () => {
  const r = await persistInbound(event());
  assert.equal(r.aiEnabled, true);
});

await t('a staff-handled conversation reports ai disabled', async () => {
  await persistInbound(event());
  db.conversations[0].ai_enabled = false;

  const r = await persistInbound(event({ messageId: 'wamid.TWO' }));
  assert.equal(r.aiEnabled, false, 'the route uses this to skip the AI turn');
});

await t('a staff takeover survives the next inbound message', async () => {
  await persistInbound(event());
  db.conversations[0].ai_enabled = false;

  await persistInbound(event({ messageId: 'wamid.TWO' }));

  assert.equal(
    db.conversations[0].ai_enabled, false,
    'writing the message must not hand the conversation back to the AI'
  );
});

await t('a staff-handled message still reaches the Inbox', async () => {
  await persistInbound(event());
  db.conversations[0].ai_enabled = false;

  await persistInbound(event({ messageId: 'wamid.TWO', text: 'Any update?' }));

  assert.equal(db.conversation_messages.length, 2);
  assert.equal(db.conversations[0].last_message_preview, 'Any update?');
  assert.equal(db.conversations[0].unread_count, 2);
});

// ---------------------------------------------------------------------------
console.log('\n--- pipeline handoff ---');
// ---------------------------------------------------------------------------

await t('forwards with the channel secret, never a tenant id', async () => {
  const r = await forwardToPipeline(event(), 'secret-a');
  assert.equal(r.forwarded, true);
  assert.equal(db.pipelineCalls.length, 1);
  assert.equal(db.pipelineCalls[0].secret, 'secret-a');

  const keys = Object.keys(db.pipelineCalls[0].body);
  assert.ok(!keys.includes('tenant_id') && !keys.includes('tenantId'),
    'the pipeline re-derives the tenant from the channel, so it is not sent');
});

await t('a channel with no secret is not forwarded', async () => {
  const r = await forwardToPipeline(event(), null);
  assert.equal(r.forwarded, false);
  assert.equal(r.reason, 'channel_not_provisioned');
  assert.equal(db.pipelineCalls.length, 0);
});

await t('an unconfigured pipeline is reported, not crashed on', async () => {
  const saved = process.env.N8N_META_WEBHOOK_URL;
  delete process.env.N8N_META_WEBHOOK_URL;
  const r = await forwardToPipeline(event(), 'secret-a');
  process.env.N8N_META_WEBHOOK_URL = saved;

  assert.equal(r.forwarded, false);
  assert.equal(r.reason, 'pipeline_not_configured');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
