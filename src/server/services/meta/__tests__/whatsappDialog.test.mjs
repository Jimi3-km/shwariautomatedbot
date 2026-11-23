/**
 * WhatsApp signup through Facebook's sign-in dialog, and number activation.
 *
 * The hosted signup page finishes on Meta's side without handing a code back,
 * so the app never learned a number had been added. The dialog returns to our
 * callback. And a number that has been added is not a WhatsApp account until
 * it is registered.
 *
 * Run with:  npx tsx src/server/services/meta/__tests__/whatsappDialog.test.mjs
 */

import assert from 'node:assert';

process.env.META_APP_ID = '1561926828265582';
process.env.META_APP_SECRET = 'test-secret';
process.env.META_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);
process.env.META_WHATSAPP_CONFIG_ID = '1587433812299366';
process.env.META_WHATSAPP_REDIRECT_URI =
  'https://shwariautomatedbot.vercel.app/api/channels/oauth/whatsapp/callback';
process.env.META_WHATSAPP_FEATURE_TYPE = 'standard';
delete process.env.META_WHATSAPP_FLOW;

const { buildEmbeddedSignupUrl, getNumberState, registerNumber, registrationPin } =
  await import('../whatsapp.ts');

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

let calls = [];
let replies = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null });
  const next = replies.shift() ?? {};
  return new Response(JSON.stringify(next), { status: 200, headers: { 'content-type': 'application/json' } });
};

const url = new URL(buildEmbeddedSignupUrl('signed-state-value'));
const q = url.searchParams;

await t('signup starts at the sign-in dialog, which returns a code to our callback', () => {
  assert.equal(url.hostname, 'www.facebook.com');
  assert.match(url.pathname, /\/dialog\/oauth$/);
  assert.equal(q.get('client_id'), '1561926828265582');
  assert.equal(q.get('config_id'), '1587433812299366');
  assert.equal(q.get('response_type'), 'code');
  assert.equal(q.get('override_default_response_type'), 'true');
  assert.equal(q.get('redirect_uri'), 'https://shwariautomatedbot.vercel.app/api/channels/oauth/whatsapp/callback');
  assert.equal(q.get('state'), 'signed-state-value');
});

await t('the standard flow does not ask for the business-app migration feature', () => {
  const extras = JSON.parse(q.get('extras'));
  assert.equal(extras.sessionInfoVersion, '3');
  assert.ok(!('featureType' in extras));
});

await t('a number is only "live" once it is on the Cloud API', async () => {
  calls = []; replies = [{ status: 'PENDING', platform_type: 'NOT_APPLICABLE', code_verification_status: 'VERIFIED' }];
  const pending = await getNumberState('555', 'tok');
  assert.equal(pending.live, false);
  assert.match(calls[0].url, /\/555\?/);
  assert.match(calls[0].url, /fields=status%2Cplatform_type%2Ccode_verification_status/);

  replies = [{ status: 'CONNECTED', platform_type: 'CLOUD_API', code_verification_status: 'VERIFIED' }];
  assert.equal((await getNumberState('555', 'tok')).live, true);
});

await t('registering sends the WhatsApp product and a six-digit PIN that is the same every time', async () => {
  calls = []; replies = [{ success: true }];
  await registerNumber('555', 'tok');
  assert.equal(calls[0].method, 'POST');
  assert.match(calls[0].url, /\/555\/register/);
  assert.equal(calls[0].body.messaging_product, 'whatsapp');
  assert.match(calls[0].body.pin, /^\d{6}$/);
  assert.equal(calls[0].body.pin, registrationPin('555'));
  assert.notEqual(registrationPin('555'), registrationPin('556'), 'each number has its own PIN');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
