/**
 * Outbound and reliability helpers.
 *
 * Pure-logic tests for the pieces the channel pipeline leans on: message
 * splitting, the retry rule, the 24-hour window, background work surviving a
 * sent response, the email loop guard, HTML escaping in outgoing mail, and the
 * scheduler's authentication.
 *
 * Run with:  npx tsx src/server/channels/__tests__/outbound.test.mjs
 */

import assert from 'node:assert';

process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_ANON_KEY = 'stub-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-service-key';
process.env.META_APP_SECRET = 'test-app-secret';
process.env.INSTAGRAM_CLIENT_SECRET = 'test-instagram-secret';
process.env.BREVO_SENDER_EMAIL = 'hello@shop.example';

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

const { chunkText, isTransient, withRetry, windowIsOpen, TEXT_LIMITS } =
  await import('../outbound.ts');
const { runInBackground, withDeadline } = await import('../../services/background.ts');
const { isAutomatedMail } = await import('../../routes/webhooks/brevo.ts');
const { esc } = await import('../../services/brevo.ts');
const { verifyMetaSignature } = await import('../meta/signature.ts');
const { verifyOAuthState, createOAuthState } = await import('../../services/meta/oauthState.ts');
const crypto = await import('node:crypto');

// ---------------------------------------------------------------------------
console.log('\n--- splitting long messages ---');
// ---------------------------------------------------------------------------

await t('a short message is sent as one piece', () => {
  assert.deepEqual(chunkText('Hello there', 4096), ['Hello there']);
});

await t('an empty message produces nothing to send', () => {
  assert.deepEqual(chunkText('   ', 4096), []);
});

await t('every piece fits the platform limit', () => {
  const text = Array.from({ length: 400 }, (_, i) => `Sentence number ${i} of the reply.`).join(' ');
  const parts = chunkText(text, TEXT_LIMITS.instagram);
  assert.ok(parts.length > 1);
  for (const p of parts) assert.ok(p.length <= TEXT_LIMITS.instagram, `piece of ${p.length}`);
});

await t('no text is lost when splitting', () => {
  const text = Array.from({ length: 300 }, (_, i) => `word${i}`).join(' ');
  const parts = chunkText(text, 200);
  assert.equal(parts.join(' ').replace(/\s+/g, ' '), text);
});

await t('paragraph breaks are preferred over mid-sentence cuts', () => {
  const a = 'A'.repeat(60);
  const b = 'B'.repeat(60);
  const parts = chunkText(`${a}\n\n${b}`, 100);
  assert.deepEqual(parts, [a, b]);
});

await t('one unbroken run longer than the limit is still cut', () => {
  const parts = chunkText('x'.repeat(250), 100);
  assert.equal(parts.length, 3);
  assert.equal(parts.join('').length, 250);
});

// ---------------------------------------------------------------------------
console.log('\n--- retry rule ---');
// ---------------------------------------------------------------------------

await t('server errors and rate limits are transient', () => {
  assert.equal(isTransient({ httpStatus: 503 }), true);
  assert.equal(isTransient({ httpStatus: 429 }), true);
});

await t('a rejected request is not retried', () => {
  assert.equal(isTransient({ httpStatus: 400 }), false);
  assert.equal(isTransient({ httpStatus: 403 }), false);
  assert.equal(isTransient(new Error('nope')), false);
});

await t('a network failure is transient', () => {
  assert.equal(isTransient(new TypeError('fetch failed')), true);
});

await t('a transient failure is retried exactly once', async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    calls++;
    if (calls === 1) throw Object.assign(new Error('busy'), { httpStatus: 503 });
    return 'sent';
  }, 1);
  assert.equal(result, 'sent');
  assert.equal(calls, 2);
});

await t('a second transient failure is surfaced, not retried forever', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => {
      calls++;
      throw Object.assign(new Error('busy'), { httpStatus: 503 });
    }, 1)
  );
  assert.equal(calls, 2);
});

await t('a permanent failure is not sent twice', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(async () => {
      calls++;
      throw Object.assign(new Error('bad'), { httpStatus: 400 });
    }, 1)
  );
  assert.equal(calls, 1);
});

// ---------------------------------------------------------------------------
console.log('\n--- 24-hour customer window ---');
// ---------------------------------------------------------------------------

const NOW = Date.parse('2026-11-19T12:00:00Z');

await t('a customer who wrote an hour ago can be replied to', () => {
  assert.equal(windowIsOpen(new Date(NOW - 3_600_000), NOW), true);
});

await t('a customer silent for 25 hours cannot', () => {
  assert.equal(windowIsOpen(new Date(NOW - 25 * 3_600_000), NOW), false);
});

await t('a customer who never wrote cannot', () => {
  assert.equal(windowIsOpen(null, NOW), false);
});

await t('an unknown answer leaves the decision to the platform', () => {
  assert.equal(windowIsOpen(undefined, NOW), true);
});

// ---------------------------------------------------------------------------
console.log('\n--- work after the response ---');
// ---------------------------------------------------------------------------

await t('background work is handed to the platform so it is not frozen', async () => {
  const key = Symbol.for('@vercel/request-context');
  const kept = [];
  globalThis[key] = { get: () => ({ waitUntil: (p) => kept.push(p) }) };
  let done = false;
  try {
    const settled = runInBackground('test', async () => { done = true; });
    assert.equal(kept.length, 1, 'waitUntil received the promise');
    await settled;
    assert.equal(done, true);
  } finally {
    delete globalThis[key];
  }
});

await t('it still runs where there is no platform context', async () => {
  let done = false;
  await runInBackground('test', async () => { done = true; });
  assert.equal(done, true);
});

await t('a failing task is contained rather than crashing the process', async () => {
  await runInBackground('test', async () => { throw new Error('boom'); });
});

await t('a deadline cuts off work that overruns', async () => {
  await assert.rejects(
    withDeadline(new Promise((r) => setTimeout(r, 200)), 20, 'AI turn'),
    /AI turn exceeded/
  );
});

await t('work inside its deadline returns normally', async () => {
  assert.equal(await withDeadline(Promise.resolve('ok'), 1000, 'AI turn'), 'ok');
});

// ---------------------------------------------------------------------------
console.log('\n--- email loop guard ---');
// ---------------------------------------------------------------------------

await t('ordinary mail from a person is answered', () => {
  assert.equal(isAutomatedMail({ Headers: { Subject: 'Hi' } }, 'amina@example.com'), null);
});

await t('an auto-reply is not answered', () => {
  assert.ok(isAutomatedMail({ Headers: { 'Auto-Submitted': 'auto-replied' } }, 'amina@example.com'));
});

await t('Auto-Submitted: no is a person', () => {
  assert.equal(isAutomatedMail({ Headers: { 'auto-submitted': 'no' } }, 'amina@example.com'), null);
});

await t('bulk and list mail is not answered', () => {
  assert.ok(isAutomatedMail({ Headers: { Precedence: 'bulk' } }, 'news@example.com'));
  assert.ok(isAutomatedMail({ Headers: { 'List-Unsubscribe': '<mailto:x@y.z>' } }, 'a@example.com'));
});

await t('bounces and no-reply senders are not answered', () => {
  assert.ok(isAutomatedMail({}, 'mailer-daemon@mail.example.com'));
  assert.ok(isAutomatedMail({}, 'no-reply@example.com'));
});

await t('our own sender address is never answered', () => {
  assert.ok(isAutomatedMail({}, 'hello@shop.example'));
});

// ---------------------------------------------------------------------------
console.log('\n--- outgoing email is escaped ---');
// ---------------------------------------------------------------------------

await t('markup in customer or model text cannot become markup in mail', () => {
  const out = esc('<a href="https://evil.example">Pay here</a> & \'win\'');
  assert.ok(!out.includes('<') && !out.includes('>') && !out.includes('"'));
  assert.ok(out.includes('&lt;a href=&quot;'));
});

// ---------------------------------------------------------------------------
console.log('\n--- webhook signatures ---');
// ---------------------------------------------------------------------------

const body = Buffer.from('{"object":"instagram"}');
const sign = (secret) =>
  'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');

await t('a delivery signed with the app secret is accepted', () => {
  assert.equal(verifyMetaSignature(body, sign('test-app-secret')), 'ok');
});

await t('an Instagram Login delivery signed with the Instagram secret is accepted', () => {
  assert.equal(verifyMetaSignature(body, sign('test-instagram-secret')), 'ok');
});

await t('any other signature is rejected', () => {
  assert.equal(verifyMetaSignature(body, sign('guess')), 'mismatch');
});

await t('OAuth state round-trips and a tampered one is refused', () => {
  const state = createOAuthState({ provider: 'whatsapp', tenantId: 't1', userId: 'u1' });
  assert.equal(verifyOAuthState(state)?.tenantId, 't1');
  assert.equal(verifyOAuthState(state.slice(0, -2) + 'xx'), null);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
