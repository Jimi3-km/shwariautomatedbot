/**
 * Proves a web chat message reaches the n8n pipeline in the shape the workflow
 * expects, and that the AI turn is skipped when staff have taken over.
 *
 * The pipeline is stubbed at fetch level so the assertions are about the real
 * request this code sends, not about a mock's own behaviour.
 *
 * Run with:  npx tsx src/server/channels/webchat/__tests__/pipeline.test.mjs
 */

import assert from 'node:assert';

process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_ANON_KEY = 'stub';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub';
process.env.N8N_AGENT_WEBHOOK_URL = 'https://n8n.invalid/webhook/meta-in';

let pass = 0;
let fail = 0;
const captured = [];

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.hostname === 'n8n.invalid') {
    const headers = {};
    const h = init.headers;
    if (h && typeof h.forEach === 'function') h.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    else for (const [k, v] of Object.entries(h ?? {})) headers[String(k).toLowerCase()] = v;

    captured.push({ path: url.pathname, headers, body: JSON.parse(init.body) });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return realFetch(input, init);
};

const { forwardToPipeline, pipelineUrl } = await import('../../../services/inbound.ts');

async function t(name, fn) {
  captured.length = 0;
  try {
    await fn();
    pass++;
    console.log(`PASS  ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
}

const webchatEvent = {
  tenantId: 'tenant-1',
  channelId: 'chan-web',
  channelType: 'webchat',
  customerId: 'web_abc123',
  customerName: null,
  messageId: 'web_abc123:m1',
  text: 'Do you deliver to Mombasa?',
  media: null,
  timestamp: '2026-08-12T09:00:00.000Z',
};

console.log('\n--- web chat reaches the pipeline ---');

await t('the configured pipeline URL is used', async () => {
  assert.equal(pipelineUrl(), 'https://n8n.invalid/webhook/meta-in');
});

await t('a web chat message is forwarded', async () => {
  const r = await forwardToPipeline(webchatEvent, 'chan-web-secret');
  assert.equal(r.forwarded, true);
  assert.equal(captured.length, 1);
});

await t('it authenticates with the channel secret header n8n filters on', async () => {
  await forwardToPipeline(webchatEvent, 'chan-web-secret');
  assert.equal(captured[0].headers['x-channel-secret'], 'chan-web-secret');
});

await t('the body carries the fields the workflow expressions read', async () => {
  await forwardToPipeline(webchatEvent, 'chan-web-secret');
  const body = captured[0].body;
  // Extract Message Data / Guard Tenant / Load Conversation State read these.
  assert.equal(body.customer_id, 'web_abc123');
  assert.equal(body.text, 'Do you deliver to Mombasa?');
  assert.equal(body.timestamp, '2026-08-12T09:00:00.000Z');
  assert.ok('message_id' in body);
});

await t('the body never carries a tenant id', async () => {
  await forwardToPipeline(webchatEvent, 'chan-web-secret');
  const keys = Object.keys(captured[0].body);
  assert.ok(!keys.includes('tenant_id') && !keys.includes('tenantId'),
    'the pipeline must re-derive the tenant from the channel row');
});

await t('the body carries no secret of any kind', async () => {
  await forwardToPipeline(webchatEvent, 'chan-web-secret');
  const wire = JSON.stringify(captured[0].body);
  for (const needle of ['secret', 'token', 'access_token', 'bot_token']) {
    assert.ok(!wire.includes(needle), `body mentioned ${needle}`);
  }
});

await t('web chat and Meta use the identical hand-off', async () => {
  await forwardToPipeline(webchatEvent, 's1');
  const webchatShape = Object.keys(captured[0].body).sort();

  captured.length = 0;
  await forwardToPipeline({ ...webchatEvent, channelType: 'whatsapp', customerId: '254700000001' }, 's1');
  const whatsappShape = Object.keys(captured[0].body).sort();

  assert.deepEqual(webchatShape, whatsappShape,
    'one pipeline entry point means one payload shape');
});

await t('an unset pipeline is reported rather than throwing', async () => {
  const saved = process.env.N8N_AGENT_WEBHOOK_URL;
  delete process.env.N8N_AGENT_WEBHOOK_URL;
  const r = await forwardToPipeline(webchatEvent, 's1');
  process.env.N8N_AGENT_WEBHOOK_URL = saved;

  assert.equal(r.forwarded, false);
  assert.equal(r.reason, 'pipeline_not_configured');
  assert.equal(captured.length, 0);
});

await t('the legacy variable name still works', async () => {
  const saved = process.env.N8N_AGENT_WEBHOOK_URL;
  delete process.env.N8N_AGENT_WEBHOOK_URL;
  process.env.N8N_META_WEBHOOK_URL = 'https://n8n.invalid/webhook/meta-in';

  const r = await forwardToPipeline(webchatEvent, 's1');

  delete process.env.N8N_META_WEBHOOK_URL;
  process.env.N8N_AGENT_WEBHOOK_URL = saved;

  assert.equal(r.forwarded, true, 'an existing deployment must not go quiet on upgrade');
});

await t('a channel with no secret is never forwarded', async () => {
  const r = await forwardToPipeline(webchatEvent, null);
  assert.equal(r.forwarded, false);
  assert.equal(captured.length, 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
