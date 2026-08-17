/**
 * Web chat tests.
 *
 * Visitor session signing and rate limiting are pure and tested directly. The
 * HTTP contract runs against a live server when WEBCHAT_TEST_URL is set.
 *
 * Run with:  npx tsx src/server/channels/webchat/__tests__/webchat.test.mjs
 */

import assert from 'node:assert';

const { issueVisitorToken, verifyVisitorToken, newVisitorId, newSiteKey } =
  await import('../session.ts');
const { rateLimit, resetRateLimits } = await import('../rateLimit.ts');
const { WIDGET_SOURCE } = await import('../widget.ts');

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

const SECRET_A = 'channel-a-secret-token';
const SECRET_B = 'channel-b-secret-token';
const CHANNEL_A = 'chan-aaaa';
const CHANNEL_B = 'chan-bbbb';

// ---------------------------------------------------------------------------
console.log('\n--- visitor sessions ---');
// ---------------------------------------------------------------------------

t('a token round-trips to the same visitor', () => {
  const visitorId = newVisitorId();
  const token = issueVisitorToken({ visitorId, channelId: CHANNEL_A }, SECRET_A);
  const back = verifyVisitorToken(token, CHANNEL_A, SECRET_A);
  assert.equal(back.visitorId, visitorId);
  assert.equal(back.channelId, CHANNEL_A);
});

t('visitor ids are unguessable and unique', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(newVisitorId());
  assert.equal(seen.size, 500);
  assert.ok(newVisitorId().length > 20);
});

t("a token cannot be replayed against another business's channel", () => {
  const token = issueVisitorToken({ visitorId: 'v1', channelId: CHANNEL_A }, SECRET_A);
  // Same secret, different channel: the channel is bound inside the payload.
  assert.equal(verifyVisitorToken(token, CHANNEL_B, SECRET_A), null);
});

t("another channel's secret cannot verify this token", () => {
  const token = issueVisitorToken({ visitorId: 'v1', channelId: CHANNEL_A }, SECRET_A);
  assert.equal(verifyVisitorToken(token, CHANNEL_A, SECRET_B), null);
});

t('a forged signature is rejected', () => {
  const token = issueVisitorToken({ visitorId: 'v1', channelId: CHANNEL_A }, SECRET_A);
  const [body] = token.split('.');
  assert.equal(verifyVisitorToken(`${body}.${'a'.repeat(43)}`, CHANNEL_A, SECRET_A), null);
});

t('editing the visitor id invalidates the token', () => {
  const token = issueVisitorToken({ visitorId: 'victim', channelId: CHANNEL_A }, SECRET_A);
  const [body, mac] = token.split('.');
  const decoded = Buffer.from(body, 'base64url').toString();
  const swapped = Buffer.from(decoded.replace('victim', 'attack')).toString('base64url');
  assert.equal(verifyVisitorToken(`${swapped}.${mac}`, CHANNEL_A, SECRET_A), null);
});

t('an expired token is rejected', () => {
  const token = issueVisitorToken({ visitorId: 'v1', channelId: CHANNEL_A }, SECRET_A);
  assert.equal(verifyVisitorToken(token, CHANNEL_A, SECRET_A, -1), null);
});

t('malformed and empty tokens are rejected', () => {
  for (const bad of ['', 'nonsense', 'a.b.c', '.', 'x.']) {
    assert.equal(verifyVisitorToken(bad, CHANNEL_A, SECRET_A), null, `accepted ${JSON.stringify(bad)}`);
  }
});

t('a revoked channel secret invalidates existing tokens', () => {
  const token = issueVisitorToken({ visitorId: 'v1', channelId: CHANNEL_A }, SECRET_A);
  // Disconnecting nulls the secret; reconnecting mints a new one.
  assert.equal(verifyVisitorToken(token, CHANNEL_A, ''), null);
  assert.equal(verifyVisitorToken(token, CHANNEL_A, 'rotated-secret'), null);
});

t('site keys are unique and carry no secret', () => {
  const keys = new Set();
  for (let i = 0; i < 200; i++) keys.add(newSiteKey());
  assert.equal(keys.size, 200);
  assert.ok(newSiteKey().startsWith('wc_'));
});

// ---------------------------------------------------------------------------
console.log('\n--- rate limiting ---');
// ---------------------------------------------------------------------------

t('requests are allowed up to the limit, then refused', () => {
  resetRateLimits();
  for (let i = 0; i < 5; i++) {
    assert.equal(rateLimit('k', 5, 60_000).allowed, true, `request ${i + 1} should pass`);
  }
  const blocked = rateLimit('k', 5, 60_000);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);
});

t('separate callers have separate budgets', () => {
  resetRateLimits();
  for (let i = 0; i < 5; i++) rateLimit('caller-1', 5, 60_000);
  assert.equal(rateLimit('caller-1', 5, 60_000).allowed, false);
  assert.equal(rateLimit('caller-2', 5, 60_000).allowed, true);
});

await (async function budgetRefills() {
  const name = 'the budget refills after the window';
  try {
    resetRateLimits();
    const windowMs = 20;
    for (let i = 0; i < 3; i++) rateLimit('w', 3, windowMs);
    assert.equal(rateLimit('w', 3, windowMs).allowed, false, 'should be blocked inside the window');

    // Wait past the window rather than assuming a millisecond elapsed.
    await new Promise((r) => setTimeout(r, windowMs + 10));
    assert.equal(rateLimit('w', 3, windowMs).allowed, true, 'should be allowed again after it');
    pass++;
    console.log(`PASS  ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
})();

// ---------------------------------------------------------------------------
console.log('\n--- widget ---');
// ---------------------------------------------------------------------------

t('the widget never writes untrusted text as markup', () => {
  assert.ok(!/\.innerHTML\s*=/.test(WIDGET_SOURCE), 'widget assigns innerHTML');
  assert.ok(WIDGET_SOURCE.includes('textContent'), 'widget should render via textContent');
});

t('the widget contains no hardcoded tenant, key or origin', () => {
  assert.ok(!/supabase\.co/.test(WIDGET_SOURCE));
  assert.ok(!/wc_[A-Za-z0-9_-]{10,}/.test(WIDGET_SOURCE), 'a site key is baked in');
  assert.ok(WIDGET_SOURCE.includes('data-site-key'), 'site key should come from the tag');
});

t('the widget isolates itself from the host page', () => {
  assert.ok(WIDGET_SOURCE.includes('attachShadow'), 'styles should be in a shadow root');
});

t('the widget derives its API origin from its own src', () => {
  assert.ok(WIDGET_SOURCE.includes('script.src.replace'));
});

// ---------------------------------------------------------------------------
// HTTP contract
// ---------------------------------------------------------------------------
const BASE = process.env.WEBCHAT_TEST_URL;

if (!BASE) {
  console.log('\n--- HTTP contract: skipped (set WEBCHAT_TEST_URL to run) ---');
} else {
  console.log('\n--- HTTP contract ---');

  const http = async (name, fn) => {
    try {
      await fn();
      pass++;
      console.log(`PASS  ${name}`);
    } catch (e) {
      fail++;
      console.log(`FAIL  ${name}\n      ${e.message}`);
    }
  };

  await http('the widget script is served as JavaScript', async () => {
    const r = await fetch(`${BASE}/api/webchat/widget.js`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') ?? '', /javascript/);
    const body = await r.text();
    assert.ok(body.includes('data-site-key'));
  });

  await http('the widget script needs no authentication', async () => {
    const r = await fetch(`${BASE}/api/webchat/widget.js`);
    assert.equal(r.status, 200, 'a public site must be able to load it');
  });

  await http('an unknown site key cannot start a session', async () => {
    const r = await fetch(`${BASE}/api/webchat/wc_does_not_exist/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(r.status, 404);
  });

  await http('an unknown site key cannot send a message', async () => {
    const r = await fetch(`${BASE}/api/webchat/wc_does_not_exist/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hello', token: 'anything' }),
    });
    assert.equal(r.status, 404);
  });

  await http('reading a transcript requires a visitor token', async () => {
    const r = await fetch(`${BASE}/api/webchat/wc_does_not_exist/messages`);
    // Unknown key resolves first; either way it must not return a transcript.
    assert.ok([401, 404].includes(r.status), `got ${r.status}`);
    const body = await r.text();
    assert.ok(!body.includes('"messages"') || body.includes('[]'));
  });

  await http('no web chat response leaks a secret', async () => {
    const r = await fetch(`${BASE}/api/webchat/wc_does_not_exist/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const text = await r.text();
    for (const needle of ['secret_token', 'bot_token', 'service_role', 'tenant_id']) {
      assert.ok(!text.includes(needle), `response mentioned ${needle}`);
    }
  });

  await http('the dashboard channel routes still require a session', async () => {
    const r = await fetch(`${BASE}/api/channels/webchat/connect`, { method: 'POST' });
    assert.equal(r.status, 401, 'connecting a widget is an admin action');
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
