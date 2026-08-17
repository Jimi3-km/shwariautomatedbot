/**
 * WhatsApp Embedded Signup v4 URL and return-parameter tests.
 *
 * The expected URL shape is taken from the entry point Meta generated for this
 * app, so these assertions are against a real example rather than a guess.
 *
 * Run with:  npx tsx src/server/services/meta/__tests__/embeddedSignup.test.mjs
 */

import assert from 'node:assert';

process.env.META_APP_ID = '1561926828265582';
process.env.META_APP_SECRET = 'test-secret';
process.env.META_WHATSAPP_CONFIG_ID = '1089974970383116';
process.env.META_WHATSAPP_REDIRECT_URI =
  'https://shwariautomatedbot.vercel.app/api/channels/oauth/whatsapp/callback';

const { buildEmbeddedSignupUrl, readSignupReturn, EMBEDDED_SIGNUP_URL } =
  await import('../whatsapp.ts');

let pass = 0;
let fail = 0;

function t(name, fn) {
  try {
    fn();
    pass++;
    console.log(`PASS  ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
}

const url = new URL(buildEmbeddedSignupUrl('signed-state-value'));
const q = url.searchParams;

console.log('\n--- authorize URL ---');

t('points at the hosted Embedded Signup entry point', () => {
  assert.equal(`${url.origin}${url.pathname}`, EMBEDDED_SIGNUP_URL);
  assert.equal(url.hostname, 'business.facebook.com');
  assert.equal(url.pathname, '/messaging/whatsapp/onboard/');
});

t('is not the generic OAuth dialog', () => {
  assert.ok(!url.href.includes('/dialog/oauth'),
    'the generic dialog is not the Embedded Signup entry point');
});

t('identifies the app with app_id, not client_id', () => {
  assert.equal(q.get('app_id'), '1561926828265582');
  assert.equal(q.get('client_id'), null);
});

t('carries the Facebook Login for Business config id', () => {
  assert.equal(q.get('config_id'), '1089974970383116');
});

t('pins the flow to v4 via extras', () => {
  const extras = JSON.parse(q.get('extras'));
  assert.equal(extras.version, 'v4');
  assert.equal(extras.sessionInfoVersion, '3');
  assert.equal(extras.featureType, 'whatsapp_business_app_onboarding');
});

t('returns to our callback, not the app root', () => {
  assert.equal(
    q.get('redirect_uri'),
    'https://shwariautomatedbot.vercel.app/api/channels/oauth/whatsapp/callback'
  );
});

t('carries the signed state so the tenant survives the round trip', () => {
  assert.equal(q.get('state'), 'signed-state-value');
});

console.log('\n--- return parameters ---');

t('reads a plain code', () => {
  const r = readSignupReturn({ code: 'AQB123' });
  assert.equal(r.code, 'AQB123');
  assert.equal(r.wabaId, undefined);
});

t('reads ids returned as flat query parameters', () => {
  const r = readSignupReturn({
    code: 'AQB123', waba_id: '102289599326934', phone_number_id: '106540352242922',
  });
  assert.equal(r.wabaId, '102289599326934');
  assert.equal(r.phoneNumberId, '106540352242922');
});

t('reads ids nested in session_info', () => {
  const r = readSignupReturn({
    code: 'AQB123',
    session_info: JSON.stringify({
      data: { waba_id: '900', phone_number_id: '901' },
    }),
  });
  assert.equal(r.wabaId, '900');
  assert.equal(r.phoneNumberId, '901');
});

t('reads ids from a flat session_info too', () => {
  const r = readSignupReturn({
    code: 'AQB123',
    session_info: JSON.stringify({ waba_id: '800', phone_number_id: '801' }),
  });
  assert.equal(r.wabaId, '800');
  assert.equal(r.phoneNumberId, '801');
});

t('flat parameters win over session_info', () => {
  const r = readSignupReturn({
    code: 'AQB123',
    waba_id: 'flat',
    session_info: JSON.stringify({ waba_id: 'nested' }),
  });
  assert.equal(r.wabaId, 'flat');
});

t('malformed session_info degrades to the Graph fallback', () => {
  const r = readSignupReturn({ code: 'AQB123', session_info: 'not json{' });
  assert.equal(r.code, 'AQB123');
  assert.equal(r.wabaId, undefined, 'undefined means discoverWabaId runs instead');
});

t('a cancelled flow yields no code', () => {
  const r = readSignupReturn({ error: 'access_denied' });
  assert.equal(r.code, undefined, 'the provider refuses without a code');
});

t('no return value is ever a secret', () => {
  const r = readSignupReturn({
    code: 'AQB123', waba_id: '1', phone_number_id: '2',
  });
  assert.deepEqual(Object.keys(r).sort(), ['code', 'phoneNumberId', 'wabaId']);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
