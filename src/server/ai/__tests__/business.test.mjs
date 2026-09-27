/**
 * Argument validation in the business tools.
 *
 * These run against the tools' own validation rather than the database: the
 * point being tested is that a model cannot write nonsense into a business, and
 * every one of these rejections happens before any query is built.
 *
 * Run with:  npx tsx src/server/ai/__tests__/business.test.mjs
 */

import assert from 'node:assert';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';

// Nothing here should reach the network. If it does, the test is not testing
// validation and should fail loudly rather than quietly hitting a real host.
globalThis.fetch = async (url) => {
  throw new Error(`a tool reached the network before validating its arguments: ${url}`);
};

const { updateBusinessProfile, saveService, setOpeningHours, saveBusinessFact } =
  await import('../tools/business.ts');
const { saveProduct } = await import('../tools/insight.ts');
const { sanitizeCompletionText } = await import('../llm.ts');
const { ToolInputError, str, num, oneOf } = await import('../tools/types.ts');

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

const ctx = {
  tenantId: 'tenant-a', userId: null, agentRole: 'manager',
  conversationId: null, allowedTools: [],
};

const rejects = (fn, pattern) =>
  assert.rejects(fn, (e) => e instanceof ToolInputError && pattern.test(e.message));

console.log('\n--- argument helpers ---');

await t('a missing required string is refused', () => {
  assert.throws(() => str({}, 'name', { required: true }), ToolInputError);
});

await t('a non-numeric number is refused', () => {
  assert.throws(() => num({ price: 'about five thousand' }, 'price'), ToolInputError);
});

await t('an absent number is null, not zero', () => {
  assert.equal(num({}, 'price'), null, 'zero would mean free, which is a different claim');
});

await t('an unlisted enum value is refused', () => {
  assert.throws(() => oneOf({ mode: 'whenever' }, 'mode', ['direct', 'enquiry'], 'enquiry'), ToolInputError);
});

await t('an absent enum falls back rather than failing', () => {
  assert.equal(oneOf({}, 'mode', ['direct', 'enquiry'], 'enquiry'), 'enquiry');
});

console.log('\n--- the business profile ---');

await t('an invented timezone is refused', () =>
  rejects(() => updateBusinessProfile.run({ timezone: 'Africa/Nairobiii' }, ctx), /not a recognised timezone/));

await t('a real timezone would be accepted', () => {
  // Reaching the network means validation passed, which is the assertion.
  return assert.rejects(
    () => updateBusinessProfile.run({ timezone: 'Africa/Nairobi' }, ctx),
    (e) => !(e instanceof ToolInputError)
  );
});

await t('a currency that is not three letters is refused', () =>
  rejects(() => updateBusinessProfile.run({ currency: 'shillings' }, ctx), /three-letter code/));

await t('an empty update is refused rather than silently doing nothing', () =>
  rejects(() => updateBusinessProfile.run({}, ctx), /Nothing to update/));

console.log('\n--- services ---');

await t('a service needs a name', () =>
  rejects(() => saveService.run({ description: 'teeth cleaning' }, ctx), /name is required/));

await t('a negative price is refused (via price_amount or price alias)', async () => {
  await rejects(() => saveService.run({ name: 'Cleaning', price_amount: -100 }, ctx), /cannot be negative/);
  await rejects(() => saveService.run({ name: 'Cleaning', price: -50 }, ctx), /cannot be negative/);
});

await t('a negative duration is refused (via duration_minutes or duration alias)', async () => {
  await rejects(() => saveService.run({ name: 'Cleaning', duration_minutes: -10 }, ctx), /cannot be negative/);
  await rejects(() => saveService.run({ name: 'Cleaning', duration: -15 }, ctx), /cannot be negative/);
});

await t('saveService accepts price and duration aliases and proceeds to write', async () => {
  // Reaching network proves argument validation succeeded
  await assert.rejects(
    () => saveService.run({ name: 'Deluxe Car Wash', price: 1500, duration: 45 }, ctx),
    (e) => !(e instanceof ToolInputError)
  );
});

await t('an unknown booking mode is refused', () =>
  rejects(() => saveService.run({ name: 'Braces', booking_mode: 'maybe' }, ctx), /booking_mode must be one of/));

console.log('\n--- products ---');

await t('a product needs a name', () =>
  rejects(() => saveProduct.run({ description: 'dental floss' }, ctx), /name is required/));

await t('a negative product price is refused (via price or price_amount alias)', async () => {
  await rejects(() => saveProduct.run({ name: 'Floss', price: -20 }, ctx), /cannot be negative/);
  await rejects(() => saveProduct.run({ name: 'Floss', price_amount: -30 }, ctx), /cannot be negative/);
});

await t('saveProduct accepts price_amount alias and proceeds to write', async () => {
  await assert.rejects(
    () => saveProduct.run({ name: 'Toothbrush', price_amount: 250 }, ctx),
    (e) => !(e instanceof ToolInputError)
  );
});

console.log('\n--- anti-repetition & sanitization ---');

await t('collapses runaway exclamation marks and question marks', () => {
  const dirty = 'The service has been added!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!';
  const clean = sanitizeCompletionText(dirty);
  assert.equal(clean, 'The service has been added!');
});

await t('collapses duplicate consecutive sentences', () => {
  const dirty = 'Added Deluxe Car Wash. Added Deluxe Car Wash. Your service is now live.';
  const clean = sanitizeCompletionText(dirty);
  assert.equal(clean, 'Added Deluxe Car Wash. Your service is now live.');
});

await t('sanitizes degenerate transcript loop reported in incident', () => {
  const dirty = [
    'The Deluxe Car Wash service has been added to your services.',
    'Add a Deluxe Car Wash service for 1500 KES, duration 45 mins',
    'Add a Deluxe Car Wash service for 1500 KES, duration 45 mins',
    '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
    'The!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
  ].join('\n');
  const clean = sanitizeCompletionText(dirty);
  assert.ok(!clean.includes('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!'), 'runaway exclamation marks removed');
  assert.ok(!clean.includes('The!'), 'dangling loop stripped');
});

console.log('\n--- opening hours ---');

await t('a day that is not a day is refused', () =>
  rejects(() => setOpeningHours.run({ days: [{ day: 'someday' }] }, ctx), /not a day of the week/));

await t('an open day needs both times', () =>
  rejects(
    () => setOpeningHours.run({ days: [{ day: 'monday', opens: '08:00' }] }, ctx),
    /needs both an opening and a closing time/
  ));

await t('a closed day needs no times at all', () =>
  // Past validation and into the write, which is what the network error proves.
  assert.rejects(
    () => setOpeningHours.run({ days: [{ day: 'sunday', closed: true }] }, ctx),
    (e) => !(e instanceof ToolInputError)
  ));

await t('a time that is not a time is refused', () =>
  rejects(
    () => setOpeningHours.run({ days: [{ day: 'monday', opens: 'morning', closes: '5' }] }, ctx),
    /is not a time/
  ));

await t('an impossible time is refused', () =>
  rejects(
    () => setOpeningHours.run({ days: [{ day: 'monday', opens: '25:00', closes: '26:00' }] }, ctx),
    /not a valid time/
  ));

await t('an empty days array is refused', () =>
  rejects(() => setOpeningHours.run({ days: [] }, ctx), /non-empty array/));

await t('more than seven days is refused', () =>
  rejects(
    () => setOpeningHours.run({ days: Array(8).fill({ day: 'monday', closed: true }) }, ctx),
    /only seven days/
  ));

console.log('\n--- business facts ---');

await t('a fact needs both a key and a value', async () => {
  await rejects(() => saveBusinessFact.run({ value: 'we close at 5' }, ctx), /key is required/);
  await rejects(() => saveBusinessFact.run({ key: 'closing_time' }, ctx), /value is required/);
});

await t('an unknown category is refused rather than invented', () =>
  rejects(
    () => saveBusinessFact.run({ key: 'x', value: 'y', category: 'vibes' }, ctx),
    /category must be one of/
  ));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
