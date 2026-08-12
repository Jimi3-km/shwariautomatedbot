/**
 * Meta inbound webhook tests.
 *
 * Pure-function coverage of signature verification and both parsers, plus HTTP
 * coverage of the endpoint's contract, run against a live server on
 * INBOUND_TEST_URL when one is available.
 *
 * Run with:  npx tsx src/server/channels/meta/__tests__/inbound.test.mjs
 */

import crypto from 'node:crypto';
import assert from 'node:assert';

const APP_SECRET = 'test-app-secret';
const VERIFY_TOKEN = 'test-verify-token';

process.env.META_APP_SECRET = APP_SECRET;
process.env.META_VERIFY_TOKEN = VERIFY_TOKEN;

const { verifyMetaSignature, verifyChallenge } = await import('../signature.ts');
const { parseWhatsApp, parseInstagram, parseMetaWebhook } = await import('../parsers.ts');

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

const sign = (body, secret = APP_SECRET) =>
  'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');

// ---------------------------------------------------------------------------
// Signature
// ---------------------------------------------------------------------------
console.log('\n--- signature ---');

const body = Buffer.from(JSON.stringify({ object: 'instagram', entry: [] }));

t('valid signature is accepted', () => {
  assert.equal(verifyMetaSignature(body, sign(body)), 'ok');
});

t('signature from the wrong secret is rejected', () => {
  assert.equal(verifyMetaSignature(body, sign(body, 'not-the-secret')), 'mismatch');
});

t('missing signature header is rejected', () => {
  assert.equal(verifyMetaSignature(body, undefined), 'missing');
});

t('empty body is rejected', () => {
  assert.equal(verifyMetaSignature(Buffer.alloc(0), sign(body)), 'missing');
});

t('sha1 signatures are refused, not downgraded to', () => {
  const sha1 = 'sha1=' + crypto.createHmac('sha1', APP_SECRET).update(body).digest('hex');
  assert.equal(verifyMetaSignature(body, sha1), 'malformed');
});

t('non-hex signature is refused before any comparison', () => {
  assert.equal(verifyMetaSignature(body, 'sha256=' + 'z'.repeat(64)), 'malformed');
});

t('truncated signature is refused rather than compared', () => {
  assert.equal(verifyMetaSignature(body, 'sha256=abc'), 'malformed');
});

t('a body altered after signing no longer verifies', () => {
  const good = sign(body);
  const tampered = Buffer.from(JSON.stringify({ object: 'instagram', entry: [1] }));
  assert.equal(verifyMetaSignature(tampered, good), 'mismatch');
});

// ---------------------------------------------------------------------------
// Challenge
// ---------------------------------------------------------------------------
console.log('\n--- verification challenge ---');

t('correct verify token echoes the challenge', () => {
  const out = verifyChallenge({
    'hub.mode': 'subscribe',
    'hub.verify_token': VERIFY_TOKEN,
    'hub.challenge': '1158201444',
  });
  assert.equal(out, '1158201444');
});

t('wrong verify token is refused', () => {
  const out = verifyChallenge({
    'hub.mode': 'subscribe',
    'hub.verify_token': 'guess',
    'hub.challenge': '1158201444',
  });
  assert.equal(out, null);
});

t('a challenge without subscribe mode is refused', () => {
  assert.equal(
    verifyChallenge({ 'hub.mode': 'unsubscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': 'x' }),
    null
  );
});

// ---------------------------------------------------------------------------
// WhatsApp normalization
// ---------------------------------------------------------------------------
console.log('\n--- WhatsApp normalization ---');

const whatsappBody = {
  object: 'whatsapp_business_account',
  entry: [{
    id: 'WABA_ID',
    changes: [{
      field: 'messages',
      value: {
        messaging_product: 'whatsapp',
        metadata: { display_phone_number: '15550001111', phone_number_id: 'PHONE_NUMBER_ID' },
        contacts: [{ profile: { name: 'Amina' }, wa_id: '254700000001' }],
        messages: [{
          from: '254700000001',
          id: 'wamid.ABC123',
          timestamp: '1786480000',
          type: 'text',
          text: { body: 'Do you have the 128GB in stock?' },
        }],
      },
    }],
  }],
};

t('extracts the account, customer, text and time', () => {
  const [event] = parseWhatsApp(whatsappBody);
  assert.equal(event.accountId, 'PHONE_NUMBER_ID');
  assert.equal(event.messages.length, 1);
  const m = event.messages[0];
  assert.equal(m.customerId, '254700000001');
  assert.equal(m.customerName, 'Amina');
  assert.equal(m.messageId, 'wamid.ABC123');
  assert.equal(m.text, 'Do you have the 128GB in stock?');
  assert.equal(m.timestamp, new Date(1786480000 * 1000).toISOString());
});

t('resolves the channel by phone_number_id, not by the WABA id', () => {
  const [event] = parseWhatsApp(whatsappBody);
  assert.equal(event.accountId, 'PHONE_NUMBER_ID');
  assert.notEqual(event.accountId, 'WABA_ID');
});

t('reads an image with its caption', () => {
  const b = structuredClone(whatsappBody);
  b.entry[0].changes[0].value.messages[0] = {
    from: '254700000001', id: 'wamid.IMG', timestamp: '1786480000', type: 'image',
    image: { id: 'MEDIA_ID', mime_type: 'image/jpeg', caption: 'Is this the one?' },
  };
  const m = parseWhatsApp(b)[0].messages[0];
  assert.equal(m.media.kind, 'image');
  assert.equal(m.media.mediaId, 'MEDIA_ID');
  assert.equal(m.text, 'Is this the one?');
});

t('reads a button reply as what the customer said', () => {
  const b = structuredClone(whatsappBody);
  b.entry[0].changes[0].value.messages[0] = {
    from: '254700000001', id: 'wamid.BTN', timestamp: '1786480000', type: 'interactive',
    interactive: { type: 'button_reply', button_reply: { id: 'buy', title: 'Buy now' } },
  };
  assert.equal(parseWhatsApp(b)[0].messages[0].text, 'Buy now');
});

t('delivery receipts produce no messages', () => {
  const b = structuredClone(whatsappBody);
  delete b.entry[0].changes[0].value.messages;
  b.entry[0].changes[0].value.statuses = [{ id: 'wamid.ABC123', status: 'delivered' }];
  assert.deepEqual(parseWhatsApp(b), []);
});

t('a malformed payload yields nothing instead of throwing', () => {
  assert.deepEqual(parseWhatsApp({ object: 'whatsapp_business_account', entry: 'nope' }), []);
  assert.deepEqual(parseWhatsApp(null), []);
  assert.deepEqual(parseWhatsApp({ object: 'whatsapp_business_account', entry: [{ changes: [{}] }] }), []);
});

// ---------------------------------------------------------------------------
// Instagram normalization
// ---------------------------------------------------------------------------
console.log('\n--- Instagram normalization ---');

const instagramBody = {
  object: 'instagram',
  entry: [{
    id: 'IG_BUSINESS_ID',
    time: 1786480000000,
    messaging: [{
      sender: { id: 'IG_CUSTOMER_ID' },
      recipient: { id: 'IG_BUSINESS_ID' },
      timestamp: 1786480000000,
      message: { mid: 'mid.XYZ789', text: 'Hi, are you open today?' },
    }],
  }],
};

t('extracts the business account, customer, text and time', () => {
  const [event] = parseInstagram(instagramBody);
  assert.equal(event.accountId, 'IG_BUSINESS_ID');
  const m = event.messages[0];
  assert.equal(m.customerId, 'IG_CUSTOMER_ID');
  assert.equal(m.messageId, 'mid.XYZ789');
  assert.equal(m.text, 'Hi, are you open today?');
  assert.equal(m.timestamp, new Date(1786480000000).toISOString());
});

t('our own echoed messages are ignored so the agent cannot reply to itself', () => {
  const b = structuredClone(instagramBody);
  b.entry[0].messaging[0].sender.id = 'IG_BUSINESS_ID';
  assert.deepEqual(parseInstagram(b), []);
});

t('echo and deleted flags are ignored', () => {
  const echo = structuredClone(instagramBody);
  echo.entry[0].messaging[0].message.is_echo = true;
  assert.deepEqual(parseInstagram(echo), []);

  const deleted = structuredClone(instagramBody);
  deleted.entry[0].messaging[0].message.is_deleted = true;
  assert.deepEqual(parseInstagram(deleted), []);
});

t('reads an image attachment', () => {
  const b = structuredClone(instagramBody);
  b.entry[0].messaging[0].message = {
    mid: 'mid.IMG',
    attachments: [{ type: 'image', payload: { url: 'https://cdn.example/i.jpg' } }],
  };
  const m = parseInstagram(b)[0].messages[0];
  assert.equal(m.media.kind, 'image');
  assert.equal(m.text, null);
});

t('a malformed payload yields nothing instead of throwing', () => {
  assert.deepEqual(parseInstagram({ object: 'instagram', entry: [{ messaging: 'nope' }] }), []);
  assert.deepEqual(parseInstagram(undefined), []);
});

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------
console.log('\n--- dispatch ---');

t('routes each product to its own parser', () => {
  assert.equal(parseMetaWebhook(whatsappBody).provider, 'whatsapp');
  assert.equal(parseMetaWebhook(instagramBody).provider, 'instagram');
});

t('an unknown product is ignored rather than guessed at', () => {
  const out = parseMetaWebhook({ object: 'page', entry: [] });
  assert.equal(out.provider, null);
  assert.deepEqual(out.events, []);
});

t('a payload cannot smuggle a tenant id through the parser', () => {
  const b = structuredClone(whatsappBody);
  b.tenant_id = '00000000-0000-0000-0000-000000000000';
  b.entry[0].changes[0].value.tenant_id = '11111111-1111-1111-1111-111111111111';
  const [event] = parseWhatsApp(b);
  // The parser's output shape has no tenant field at all: tenancy can only
  // come from the channel lookup that happens after this.
  assert.deepEqual(Object.keys(event).sort(), ['accountId', 'messages']);
  assert.ok(!('tenantId' in event.messages[0]));
});

// ---------------------------------------------------------------------------
// HTTP contract
// ---------------------------------------------------------------------------
const BASE = process.env.INBOUND_TEST_URL;

if (!BASE) {
  console.log('\n--- HTTP contract: skipped (set INBOUND_TEST_URL to run) ---');
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

  const post = (payload, signature) => {
    const raw = JSON.stringify(payload);
    return fetch(`${BASE}/api/webhooks/meta`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(signature === null ? {} : { 'x-hub-signature-256': signature ?? sign(Buffer.from(raw)) }),
      },
      body: raw,
    });
  };

  await http('unsigned delivery is refused', async () => {
    const r = await post(whatsappBody, null);
    assert.equal(r.status, 401);
  });

  await http('wrongly signed delivery is refused', async () => {
    const r = await post(whatsappBody, sign(Buffer.from(JSON.stringify(whatsappBody)), 'wrong'));
    assert.equal(r.status, 401);
  });

  await http('correctly signed delivery is accepted', async () => {
    const r = await post(whatsappBody);
    assert.equal(r.status, 200);
  });

  await http('an unknown channel is acked, not retried forever', async () => {
    // No channel is connected for this phone number id, so nothing is stored —
    // but Meta must still get a 200 or it disables the subscription.
    const r = await post(whatsappBody);
    assert.equal(r.status, 200);
  });

  await http('verification challenge echoes only with the right token', async () => {
    const ok = await fetch(
      `${BASE}/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=42`
    );
    assert.equal(ok.status, 200);
    assert.equal((await ok.text()).trim(), '42');

    const bad = await fetch(
      `${BASE}/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42`
    );
    assert.equal(bad.status, 403);
  });

  await http('the webhook never requires a dashboard token', async () => {
    const r = await post(instagramBody);
    assert.equal(r.status, 200, 'signed request should not need an Authorization header');
  });

  await http('internal send refuses callers without the shared secret', async () => {
    const r = await fetch(`${BASE}/api/internal/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel_id: 'x', customer_id: 'y', text: 'z' }),
    });
    assert.ok([401, 503].includes(r.status), `expected 401/503, got ${r.status}`);
  });

  await http('internal send refuses a wrong shared secret', async () => {
    const r = await fetch(`${BASE}/api/internal/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': 'wrong' },
      body: JSON.stringify({ channel_id: 'x', customer_id: 'y', text: 'z' }),
    });
    assert.ok([401, 503].includes(r.status), `expected 401/503, got ${r.status}`);
  });

  await http('no response body leaks a secret', async () => {
    const r = await post(whatsappBody);
    const text = await r.text();
    for (const needle of ['bot_token', 'secret_token', 'access_token', APP_SECRET, 'service_role']) {
      assert.ok(!text.includes(needle), `response mentioned ${needle}`);
    }
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
