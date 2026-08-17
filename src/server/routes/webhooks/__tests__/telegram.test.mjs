/**
 * Telegram inbound parsing.
 *
 * Telegram now comes through this application rather than straight to n8n, so
 * the shape it produces has to match what web chat and Meta produce exactly —
 * anything that differs would show up as a subtly different conversation
 * depending on which channel a customer used.
 *
 * Run with:  npx tsx src/server/routes/webhooks/__tests__/telegram.test.mjs
 */

import assert from 'node:assert';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';

const { parseUpdate } = await import('../telegram.ts');
const { looksLikePairingCode } = await import('../../../ai/admins.ts');

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

const T = 'tenant-1';
const C = 'channel-1';

function textUpdate(overrides = {}) {
  return {
    update_id: 900,
    message: {
      message_id: 42,
      date: 1_700_000_000,
      chat: { id: 55501, type: 'private' },
      from: { id: 55501, first_name: 'Amina', last_name: 'Wanjiku' },
      text: 'Do you open on Sunday?',
      ...overrides,
    },
  };
}

console.log('\n--- a plain message ---');

t('produces a normalized event', () => {
  const e = parseUpdate(textUpdate(), T, C);
  assert.equal(e.tenantId, T);
  assert.equal(e.channelId, C);
  assert.equal(e.channelType, 'telegram');
  assert.equal(e.text, 'Do you open on Sunday?');
});

t('identifies the customer by chat id, not user id', () => {
  const e = parseUpdate(textUpdate({ from: { id: 999, first_name: 'Amina' } }), T, C);
  assert.equal(e.customerId, '55501', 'replies go to the chat, so the chat is the identity');
});

t('builds a display name from the parts Telegram sends', () => {
  assert.equal(parseUpdate(textUpdate(), T, C).customerName, 'Amina Wanjiku');
});

t('falls back to the username when there is no name', () => {
  const e = parseUpdate(textUpdate({ from: { id: 1, username: 'amina' } }), T, C);
  assert.equal(e.customerName, '@amina');
});

t('has no name rather than a fabricated one', () => {
  const e = parseUpdate(textUpdate({ from: {} }), T, C);
  assert.equal(e.customerName, null);
});

t('the message id is unique per chat, so a retry claims the same event', () => {
  const a = parseUpdate(textUpdate(), T, C);
  const b = parseUpdate(textUpdate(), T, C);
  assert.equal(a.messageId, b.messageId, 'the same delivery must claim the same id');
  assert.match(a.messageId, /^55501:42$/);
});

t('two chats can hold the same message_id without colliding', () => {
  const a = parseUpdate(textUpdate(), T, C);
  const b = parseUpdate(textUpdate({ chat: { id: 77702 } }), T, C);
  assert.notEqual(a.messageId, b.messageId);
});

t('the timestamp is Telegram\'s, converted from seconds', () => {
  const e = parseUpdate(textUpdate(), T, C);
  assert.equal(e.timestamp, new Date(1_700_000_000_000).toISOString());
});

console.log('\n--- attachments ---');

t('a photo becomes image media at the largest size', () => {
  const e = parseUpdate(textUpdate({
    text: undefined,
    caption: 'my receipt',
    photo: [{ file_id: 'small' }, { file_id: 'large' }],
  }), T, C);
  assert.equal(e.media.kind, 'image');
  assert.equal(e.media.mediaId, 'large');
  assert.equal(e.media.caption, 'my receipt');
  assert.equal(e.text, null);
});

t('a voice note becomes audio', () => {
  const e = parseUpdate(textUpdate({ text: undefined, voice: { file_id: 'v1', mime_type: 'audio/ogg' } }), T, C);
  assert.equal(e.media.kind, 'audio');
  assert.equal(e.media.mimeType, 'audio/ogg');
});

t('a document keeps its mime type', () => {
  const e = parseUpdate(textUpdate({ text: undefined, document: { file_id: 'd1', mime_type: 'application/pdf' } }), T, C);
  assert.equal(e.media.kind, 'document');
});

console.log('\n--- what is ignored ---');

t('an edit is not a new message', () => {
  assert.equal(parseUpdate({ update_id: 1, edited_message: { message_id: 1 } }, T, C), null);
});

t('a callback query is ignored', () => {
  assert.equal(parseUpdate({ update_id: 1, callback_query: {} }, T, C), null);
});

t('a message with neither text nor media is ignored', () => {
  assert.equal(parseUpdate(textUpdate({ text: undefined }), T, C), null);
});

t('a message without a chat is ignored', () => {
  assert.equal(parseUpdate(textUpdate({ chat: undefined }), T, C), null);
});

t('junk does not throw', () => {
  assert.equal(parseUpdate(null, T, C), null);
  assert.equal(parseUpdate('hello', T, C), null);
  assert.equal(parseUpdate({ message: 'not an object' }, T, C), null);
});

console.log('\n--- pairing codes ---');

t('an eight-character code is recognised', () => {
  assert.equal(looksLikePairingCode('K7M2PQR9'), true);
  assert.equal(looksLikePairingCode('  K7M2PQR9  '), true);
});

t('ordinary messages are not mistaken for codes', () => {
  for (const text of ['Do you open on Sunday?', 'hello', 'K7M2PQ', 'K7M2PQR9X', 'K7M2 PQR9']) {
    assert.equal(looksLikePairingCode(text), false, `"${text}" should not look like a code`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
