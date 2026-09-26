import assert from 'node:assert';
import { isComplexCommand } from '../planner.js';
import { buildSystemPrompt } from '../prompts.js';
import { resolveModel } from '../llm.js';
import { ALL_ROLES } from '../roles.js';

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

console.log('\n--- planner complexity heuristics ---');

await t('simple greeting is not complex', () => {
  assert.equal(isComplexCommand('hi there'), false);
  assert.equal(isComplexCommand('how much is hair cut?'), false);
});

await t('onboarding commands trigger planning', () => {
  assert.equal(isComplexCommand('Please set up my barbershop with 3 services and opening hours 9am to 6pm'), true);
  assert.equal(isComplexCommand('Configure my business for salon services'), true);
});

await t('multi-step conjunctions trigger planning', () => {
  const multi = 'First add product Shampoo for 500 KES. Then add Conditioner for 700 KES and also set payment to Till 12345.';
  assert.equal(isComplexCommand(multi), true);
});

console.log('\n--- role system prompts ---');

for (const role of ALL_ROLES) {
  await t(`buildSystemPrompt generates complete prompt for role: ${role}`, () => {
    const prompt = buildSystemPrompt(
      { role, name: `Test ${role}`, objective: 'Testing objective', instructions: 'Special owner rule' },
      'Business: Test Biz\nServices: 2',
      true,
      role === 'manager' ? null : 'Customer: Jane Doe, phone: +254700000000'
    );

    assert.ok(prompt.includes(`Test ${role}`), 'must include agent name');
    assert.ok(prompt.includes('Target Audience:'), 'must specify target audience');
    assert.ok(prompt.includes('Strict Zero-Hallucination Policy'), 'must enforce zero-hallucination');
    assert.ok(prompt.includes('Special owner rule'), 'must include owner instructions');
    if (role === 'manager') {
      assert.ok(!prompt.includes('Customer: Jane Doe'), 'manager must not see customer block');
    } else {
      assert.ok(prompt.includes('Customer: Jane Doe'), 'specialist must see customer block');
    }
  });
}

console.log('\n--- model profile resolution ---');

await t('resolves primary, fast, and fallback models correctly', () => {
  const primary = resolveModel('primary');
  const fast = resolveModel('fast');
  const fallback = resolveModel('fallback');

  assert.ok(typeof primary === 'string' && primary.length > 0);
  assert.ok(typeof fast === 'string' && fast.length > 0);
  assert.ok(typeof fallback === 'string' && fallback.length > 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
