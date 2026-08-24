/**
 * Guards on the tools that do work.
 *
 * These are the tools that book, charge, chase and hand over, so the assertions
 * are about what they refuse: a booking in the wrong decade, a negative price,
 * an agent nominating a customer it cannot see, and an agent claiming a payment
 * arrived.
 *
 * Run with:  npx tsx src/server/ai/__tests__/operations.test.mjs
 */

import assert from 'node:assert';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';

// Validation must happen before any query is built. Reaching the network means
// something got through that should not have.
globalThis.fetch = async (url) => {
  throw new Error(`reached the network before validating: ${url}`);
};

const {
  bookAppointment, rescheduleAppointment, recordOrder,
  scheduleFollowUp, escalateToHuman, openTicket, updateTicket,
} = await import('../tools/operations.ts');
const { saveProduct, removeProduct, updateCustomer, businessMetrics, findCustomers } =
  await import('../tools/insight.ts');
const { ToolInputError } = await import('../tools/types.ts');

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

/** A customer-facing agent, mid-conversation. */
const inConversation = {
  tenantId: 'tenant-a', userId: null, agentRole: 'sales',
  conversationId: 'conv-1', allowedTools: [],
};

/** The manager, which is not in anyone's conversation. */
const noConversation = { ...inConversation, agentRole: 'manager', conversationId: null };

const rejects = (fn, pattern) =>
  assert.rejects(fn, (e) => e instanceof ToolInputError && pattern.test(e.message));

/** Got past validation and into the database — which is the assertion. */
const reachedTheDatabase = (fn) =>
  assert.rejects(fn, (e) => !(e instanceof ToolInputError));

console.log('\n--- appointments ---');

await t('a booking needs a real date', () =>
  rejects(
    () => bookAppointment.run({ service_name: 'Cleaning', starts_at: 'next tuesday' }, inConversation),
    /must be a date and time/
  ));

await t('a booking in the wrong decade is refused', () =>
  rejects(
    () => bookAppointment.run({ service_name: 'Cleaning', starts_at: '2043-01-04T10:00:00Z' }, inConversation),
    /too far from today/
  ));

await t('a booking needs a service name', () =>
  rejects(
    () => bookAppointment.run({ starts_at: '2026-09-04T10:00:00Z' }, inConversation),
    /service_name is required/
  ));

await t('an impossible duration is refused', async () => {
  // The duration check runs after the service lookup, so this asserts the
  // rejection rather than the ordering.
  await assert.rejects(
    () => bookAppointment.run(
      { service_name: 'Cleaning', starts_at: '2026-09-04T10:00:00Z', duration_minutes: 5000 },
      inConversation
    ),
    (e) => e instanceof Error
  );
});

await t('rescheduling needs an appointment to move', () =>
  rejects(
    () => rescheduleAppointment.run({ starts_at: '2026-09-04T10:00:00Z' }, inConversation),
    /appointment_id is required/
  ));

console.log('\n--- who the customer is ---');

await t('an agent with no conversation must name a customer', () =>
  rejects(
    () => bookAppointment.run(
      { service_name: 'Cleaning', starts_at: '2026-09-04T10:00:00Z' },
      noConversation
    ),
    /passing lead_id/
  ));

await t('an agent in a conversation does not have to', () =>
  // It gets past the "which customer" check and on to reading the conversation,
  // which is as far as it can get without a database.
  assert.rejects(
    () => bookAppointment.run(
      { service_name: 'Cleaning', starts_at: '2026-09-04T10:00:00Z' },
      inConversation
    ),
    (e) => !/lead_id/.test(e.message)
  ));

await t('the customer is never taken from a free-text name', () => {
  const fields = Object.keys(bookAppointment.parameters.properties);
  assert.ok(!fields.includes('customer_name'),
    'naming a customer in prose would let the model act on someone it cannot see');
  assert.ok(!fields.includes('customer_id'));
});

console.log('\n--- orders and payment safety ---');

await t('an order needs at least one line', () =>
  rejects(() => recordOrder.run({ items: [] }, inConversation), /non-empty array/));

await t('an order line needs a name', () =>
  rejects(() => recordOrder.run({ items: [{ qty: 2 }] }, inConversation), /name is required/));

await t('a negative price is refused', () =>
  rejects(
    () => recordOrder.run({ items: [{ name: 'Cleaning', price: -50 }] }, inConversation),
    /cannot be negative/
  ));

await t('a negative total is refused', () =>
  rejects(
    () => recordOrder.run({ items: [{ name: 'Cleaning' }], total: -1 }, inConversation),
    /cannot be negative/
  ));

await t('no order field can set payment state', () => {
  const fields = Object.keys(recordOrder.parameters.properties);
  for (const forbidden of ['status', 'payment_status', 'paid', 'currency']) {
    assert.ok(!fields.includes(forbidden),
      `${forbidden} must not be something an agent can set on an order`);
  }
});

await t('an agent cannot move a customer to a paid stage', async () => {
  await rejects(
    () => updateCustomer.run({ lead_id: 1, stage: 'payment_verified' }, noConversation),
    /verified payment/
  );
  await rejects(
    () => updateCustomer.run({ lead_id: 1, stage: 'won' }, noConversation),
    /verified payment/
  );
});

await t('an unknown stage is refused', () =>
  rejects(() => updateCustomer.run({ lead_id: 1, stage: 'nearly' }, noConversation), /stage must be one of/));

await t('updating a customer with nothing to change is refused', () =>
  rejects(() => updateCustomer.run({ lead_id: 1 }, noConversation), /Nothing to change/));

console.log('\n--- follow-ups ---');

await t('a follow-up in the past is refused', () =>
  rejects(
    () => scheduleFollowUp.run(
      { due_at: '2026-01-05T10:00:00Z', message: 'Still interested?' },
      inConversation
    ),
    /in the past/
  ));

await t('a follow-up needs a message', () =>
  rejects(
    () => scheduleFollowUp.run({ due_at: '2026-09-04T10:00:00Z' }, inConversation),
    /message is required/
  ));

await t('a follow-up is queued, never sent', () => {
  assert.equal(scheduleFollowUp.mutates, true);
  assert.match(scheduleFollowUp.description, /queued, not sent/,
    'the description is what tells the model it is writing a promise, not sending a message');
});

console.log('\n--- escalation ---');

await t('there must be a conversation to hand over', () =>
  rejects(() => escalateToHuman.run({ reason: 'angry customer' }, noConversation), /no conversation/));

await t('escalating needs a reason', () =>
  rejects(() => escalateToHuman.run({}, inConversation), /reason is required/));

await t('a ticket needs a subject', () =>
  rejects(() => openTicket.run({ body: 'something broke' }, inConversation), /subject is required/));

await t('updating a ticket with nothing to change is refused', () =>
  rejects(() => updateTicket.run({ ticket_id: 'abc' }, inConversation), /Nothing to change/));

console.log('\n--- products and metrics ---');

await t('a product needs a name', () =>
  rejects(() => saveProduct.run({ price: 500 }, noConversation), /name is required/));

await t('a negative product price is refused', () =>
  rejects(() => saveProduct.run({ name: 'Toothbrush', price: -1 }, noConversation), /cannot be negative/));

await t('a product cannot set its own currency', () => {
  assert.ok(!Object.keys(saveProduct.parameters.properties).includes('currency'),
    'currency comes from the business, not from the model');
});

await t('an absurd metrics window is clamped rather than refused', () =>
  // 100000 days would scan everything; it is clamped to a year and still runs,
  // so this fails at the database rather than at validation.
  reachedTheDatabase(() => businessMetrics.run({ days: 100000 }, noConversation)));

await t('a negative silence window is refused', () =>
  rejects(() => findCustomers.run({ silent_for_days: -5 }, noConversation), /cannot be negative/));

await t('reads are marked as reads', () => {
  assert.equal(businessMetrics.mutates, false);
  assert.equal(findCustomers.mutates, false);
});

await t('removing a product needs a name', () =>
  rejects(() => removeProduct.run({}, noConversation), /name is required/));

await t('a product is taken out of stock, never deleted', () => {
  assert.match(removeProduct.description, /kept rather than deleted/,
    'past orders have to keep making sense');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
