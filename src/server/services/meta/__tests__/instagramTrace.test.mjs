/**
 * The record a refused Instagram connection leaves behind.
 *
 * One attempt has to say what Instagram refused and how, because each attempt
 * needs a person to sign in. And the record must never hold a token, a code or
 * a secret, whatever Instagram puts in its answers.
 *
 * Run with:  npx tsx src/server/services/meta/__tests__/instagramTrace.test.mjs
 */

import assert from 'node:assert';

const IG_SECRET = 'ig-secret-value-123';
const APP_SECRET = 'meta-secret-value-456';
const SHORT = 'IGAAshort-lived-token-value-789';
const LONG = 'IGAAlong-lived-token-value-000';

process.env.INSTAGRAM_CLIENT_ID = '111';
process.env.INSTAGRAM_CLIENT_SECRET = IG_SECRET;
process.env.META_APP_ID = '222';
process.env.META_APP_SECRET = APP_SECRET;

const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
const refused = () => reply(400, {
  error: {
    // Instagram is made to echo the token here: the record must still be clean.
    message: `Unsupported request - method type: get ${SHORT}`,
    type: 'IGApiException', code: 100, fbtrace_id: 'AbC123',
  },
});

let handler = () => refused();
const calls = [];
globalThis.fetch = async (url, init) => {
  calls.push(String(url));
  return handler(new URL(String(url)), init);
};

const { exchangeCodeForToken, diagnoseInstagramAccess, formatInstagramTrace } =
  await import('../instagram.ts');

let pass = 0;
let fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

const clean = (text) => {
  for (const secret of [SHORT, LONG, IG_SECRET, APP_SECRET]) {
    assert.ok(!text.includes(secret), `the record contains a secret: ${secret.slice(0, 6)}...`);
  }
};

await t('the code exchange records the form of the answer, not its values', async () => {
  handler = () => reply(200, { data: [{ access_token: SHORT, user_id: 17841400001234, permissions: 'instagram_business_basic' }] });
  const token = await exchangeCodeForToken('the-code', 'https://example.test/cb');
  assert.deepEqual(token.shape, {
    topLevelKeys: ['data'], dataIsArray: true, userIdPresent: true, userIdTail: '1234',
    tokenPrefix: 'IGAA', tokenLength: SHORT.length,
  });
  clean(formatInstagramTrace(token.shape, []));
});

await t('a refusal is recorded for every way of asking, with no secret in it', async () => {
  handler = (url) => url.host === 'graph.facebook.com'
    ? reply(200, { data: { is_valid: true, type: 'USER', app_id: '111', scopes: ['instagram_business_basic'] } })
    : refused();
  const d = await diagnoseInstagramAccess(SHORT);
  assert.equal(d.longLived, null);
  const byCall = d.probes.map((p) => p.call);
  assert.deepEqual(byCall, [
    'GET graph.instagram.com/access_token',
    'GET graph.instagram.com/v25.0/access_token',
    'GET graph.instagram.com/me fields=user_id,username',
    'GET graph.instagram.com/me fields=id,user_id,username,account_type,profile_picture_url',
    'GET graph.instagram.com/v25.0/me fields=user_id,username',
    'GET graph.facebook.com/debug_token',
  ]);
  const first = d.probes[0];
  assert.equal(first.status, 400);
  assert.equal(first.code, '100');
  assert.equal(first.type, 'IGApiException');
  assert.equal(first.fbtrace, 'AbC123');
  assert.match(d.probes[5].note, /valid=true type=USER app=the Instagram app/);

  const trace = formatInstagramTrace(undefined, d.probes);
  assert.match(trace, /access_token -> 400 \[code 100, IGApiException, fbtrace AbC123\] Unsupported request/);
  clean(trace);
  clean(JSON.stringify(d.probes));
});

await t('when the versioned exchange is answered, its token is handed back', async () => {
  handler = (url) => url.pathname === '/v25.0/access_token'
    ? reply(200, { access_token: LONG, token_type: 'bearer', expires_in: 5000 })
    : refused();
  const d = await diagnoseInstagramAccess(SHORT);
  assert.equal(d.longLived?.accessToken, LONG);
  assert.equal(d.longLived?.via, 'GET graph.instagram.com/v25.0/access_token');
  clean(formatInstagramTrace(undefined, d.probes));
});

await t('a call that never gets an answer is recorded, not thrown', async () => {
  handler = () => { throw new Error('network down'); };
  const d = await diagnoseInstagramAccess(SHORT);
  assert.ok(d.probes.every((p) => p.status === null && !p.ok));
  assert.match(formatInstagramTrace(undefined, d.probes), /no answer network down/);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
