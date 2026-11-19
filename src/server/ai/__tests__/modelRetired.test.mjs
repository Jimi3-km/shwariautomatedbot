/**
 * A retired model must not take the agent offline.
 *
 * The provider answers 404 or 410 for a model id it no longer serves. The
 * completion layer is expected to move to a model that still answers, remember
 * the substitution, and fail clearly only when nothing answers.
 */
import assert from 'node:assert';

process.env.SHWARI_API_KEY = 'test-key';
process.env.SHWARI_MODEL = 'vendor/retired-model';
delete process.env.SHWARI_PRIMARY_MODEL;
delete process.env.SHWARI_FAST_MODEL;
delete process.env.SHWARI_FALLBACK_MODEL;

const { complete, LlmError } = await import('../llm.js');

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

/** Models the stub provider still serves, and the ids it was asked for. */
let served = new Set();
let asked = [];

globalThis.fetch = async (_url, init) => {
  const model = JSON.parse(init.body).model;
  asked.push(model);
  if (!served.has(model)) {
    return new Response('{"detail":"model is gone"}', { status: 410 });
  }
  return new Response(
    JSON.stringify({ choices: [{ message: { role: 'assistant', content: `hello from ${model}` }, finish_reason: 'stop' }] }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
};

const messages = [{ role: 'user', content: 'hello' }];

await t('nothing answers: fails with a message naming the retired model', async () => {
  served = new Set();
  asked = [];
  await assert.rejects(
    () => complete({ messages }),
    (e) => e instanceof LlmError && /vendor\/retired-model/.test(e.message) && /no longer served/.test(e.message)
  );
  assert.ok(asked.length > 1, 'substitutes were tried');
  assert.equal(new Set(asked).size, asked.length, 'no model was tried twice');
});

await t('a retired model is replaced by one that still answers', async () => {
  served = new Set(['nvidia/nemotron-3-ultra-550b-a55b']);
  asked = [];
  const result = await complete({ messages });
  assert.match(result.text ?? '', /nemotron-3-ultra/);
  assert.equal(asked[0], 'vendor/retired-model');
});

await t('the substitution is remembered, so later turns do not retry the dead model', async () => {
  asked = [];
  await complete({ messages });
  assert.deepEqual(asked, ['nvidia/nemotron-3-ultra-550b-a55b']);
});

await t('an error that is not "model gone" is not swallowed by the substitute search', async () => {
  process.env.SHWARI_MODEL = 'vendor/another-retired';
  globalThis.fetch = async (_url, init) => {
    const model = JSON.parse(init.body).model;
    if (model === 'vendor/another-retired') return new Response('gone', { status: 404 });
    return new Response('bad key', { status: 401 });
  };
  await assert.rejects(() => complete({ messages }), (e) => e instanceof LlmError && e.status === 401);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
