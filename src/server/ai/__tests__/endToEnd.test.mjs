/**
 * The jobs the agent is actually for, driven through the real runtime.
 *
 * Everything below runs the genuine runAgentTurn loop, the genuine runTool
 * guard and the genuine tool code. Only two things are doubles: the model,
 * which is scripted so the test controls which tool gets called, and PostgREST,
 * which records the requests that leave the process.
 *
 * That combination is what makes this worth having. A test that asserts "the
 * manager holds save_service" proves a list is correct. This proves the call
 * arrives at the database as the right INSERT, which is the thing an owner
 * actually cares about when they say "add a service".
 *
 * Run with:  npx tsx src/server/ai/__tests__/endToEnd.test.mjs
 */

import assert from 'node:assert';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SHWARI_API_KEY = 'test-key';

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

// ---------------------------------------------------------------------------
// The doubles
// ---------------------------------------------------------------------------

/** Turns the model is scripted to take, in order. */
let script = [];
/** Every PostgREST request that left the process. */
let db = [];
/** What a given table should return, keyed by "METHOD /table". */
let rows = {};

function toolCall(name, args) {
  return {
    choices: [{
      finish_reason: 'tool_calls',
      message: {
        content: null,
        tool_calls: [{
          id: `call_${name}`,
          type: 'function',
          function: { name, arguments: JSON.stringify(args) },
        }],
      },
    }],
  };
}

const says = (text) => ({ choices: [{ finish_reason: 'stop', message: { content: text } }] });

globalThis.fetch = async (url, init = {}) => {
  const href = String(url);
  const method = init.method ?? 'GET';

  // --- the model ---
  if (href.includes('/chat/completions')) {
    const next = script.shift();
    if (!next) throw new Error('the model was called more times than the test scripted');
    return json(next);
  }

  // --- PostgREST ---
  const path = href.replace('https://example.supabase.co/rest/v1/', '');
  const table = path.split('?')[0];
  db.push({ method, table, path, body: init.body ? JSON.parse(init.body) : null });

  return json(rows[`${method} ${table}`] ?? []);
};

const json = (body) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

/** Requests that hit one table, for asserting on what was written. */
const wrote = (table, method) => db.filter((r) => r.table === table && r.method === method);

function reset(seed = {}) {
  script = [];
  db = [];
  rows = {
    // Agents are provisioned on demand; returning the manager row keeps the
    // runtime from inventing one mid-test.
    'GET agents': [{
      role: 'manager', name: 'Shwari', objective: '', instructions: '',
      tools: MANAGER_TOOLS, permissions: {}, escalation: '', status: 'active',
    }],
    'GET tenants': [{ business_name: 'Test Co', currency: 'KES', timezone: 'Africa/Nairobi' }],
    'GET services': [],
    'GET products': [],
    'GET appointments': [],
    'GET conversations': [],
    'GET knowledge_gaps': [],
    'POST agent_tool_calls': [],
    ...seed,
  };
}

const { AGENT_BLUEPRINTS } = await import('../roles.ts');
const MANAGER_TOOLS = AGENT_BLUEPRINTS.manager.tools;

const { runAgentTurn } = await import('../agent.ts');

const owner = (role = 'manager') => ({
  tenantId: 'tenant-a',
  role,
  userId: 'user-1',
  conversationId: null,
  text: 'do the thing',
  history: [],
});

const customer = (role) => ({ ...owner(role), userId: null, conversationId: 'conv-1' });

// ---------------------------------------------------------------------------
// Managing what the business offers
// ---------------------------------------------------------------------------

console.log('\n--- services ---');

await t('"add a service" writes the service', async () => {
  reset();
  script = [
    toolCall('save_service', {
      name: 'Teeth cleaning', price_amount: 3000,
      duration_minutes: 30, booking_mode: 'direct',
    }),
    says('Added teeth cleaning at 3,000, bookable directly.'),
  ];

  const turn = await runAgentTurn(owner());

  const inserts = wrote('services', 'POST');
  assert.equal(inserts.length, 1, 'the service was not written');
  assert.equal(inserts[0].body.name, 'Teeth cleaning');
  assert.equal(inserts[0].body.price_amount, 3000);
  assert.equal(inserts[0].body.booking_mode, 'direct');
  assert.equal(inserts[0].body.tenant_id, 'tenant-a', 'the write must be scoped to the tenant');
  assert.deepEqual(turn.actions, ['save_service']);
});

await t('"change the price of X" updates rather than duplicating', async () => {
  reset({ 'GET services': [{ id: 'svc-1', name: 'Teeth cleaning' }] });
  script = [
    toolCall('save_service', { name: 'Teeth cleaning', price_amount: 3500 }),
    says('Updated.'),
  ];

  await runAgentTurn(owner());

  assert.equal(wrote('services', 'POST').length, 0, 'an existing service must not be duplicated');
  const updates = wrote('services', 'PATCH');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].body.price_amount, 3500);
});

await t('"stop offering X" switches it off rather than deleting', async () => {
  reset();
  rows['PATCH services'] = [{ id: 'svc-1', name: 'Whitening' }];
  script = [toolCall('remove_service', { name: 'Whitening' }), says('Done.')];

  const turn = await runAgentTurn(owner());

  const updates = wrote('services', 'PATCH');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].body.active, false);
  assert.equal(wrote('services', 'DELETE').length, 0, 'history must survive');
  assert.deepEqual(turn.actions, ['remove_service']);
});

console.log('\n--- products ---');

await t('"add a product" writes it with the business currency', async () => {
  reset();
  script = [
    toolCall('save_product', { name: 'Toothbrush', price: 450, description: 'Soft bristle' }),
    says('Added.'),
  ];

  await runAgentTurn(owner());

  const inserts = wrote('products', 'POST');
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].body.name, 'Toothbrush');
  assert.equal(inserts[0].body.price, 450);
  assert.equal(inserts[0].body.currency, 'KES', 'currency comes from the business, not the model');
});

await t('"edit the description" updates the existing row', async () => {
  reset({ 'GET products': [{ id: 'prod-1' }] });
  script = [
    toolCall('save_product', { name: 'Toothbrush', description: 'Medium bristle, pack of two' }),
    says('Updated.'),
  ];

  await runAgentTurn(owner());

  const updates = wrote('products', 'PATCH');
  assert.equal(updates.length, 1, 'the description edit did not reach the database');
  assert.equal(updates[0].body.description, 'Medium bristle, pack of two');
  assert.equal(wrote('products', 'POST').length, 0);
});

await t('"remove that product" takes it out of stock', async () => {
  reset();
  rows['PATCH products'] = [{ id: 'prod-1', name: 'Toothbrush' }];
  script = [toolCall('remove_product', { name: 'Toothbrush' }), says('Done.')];

  await runAgentTurn(owner());

  const updates = wrote('products', 'PATCH');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].body.in_stock, false);
  assert.equal(wrote('products', 'DELETE').length, 0, 'past orders must still make sense');
});

// ---------------------------------------------------------------------------
// Serving a customer
// ---------------------------------------------------------------------------

console.log('\n--- answering a customer ---');

await t('the sales agent reads real prices back', async () => {
  reset({
    'GET agents': [{
      role: 'sales', name: 'Sales', objective: '', instructions: '',
      tools: AGENT_BLUEPRINTS.sales.tools, permissions: {}, escalation: '', status: 'active',
    }],
    'GET products': [{ id: 'p1', name: 'Toothbrush', price: 450, currency: 'KES', in_stock: true }],
    'GET conversation_messages': [],
  });
  script = [
    toolCall('list_products', {}),
    says('The toothbrush is 450 KES.'),
  ];

  const turn = await runAgentTurn({ ...customer('sales'), text: 'how much is a toothbrush?' });

  assert.ok(db.some((r) => r.table === 'products' && r.method === 'GET'),
    'it answered without looking the price up');
  assert.match(turn.reply, /450/);
  assert.deepEqual(turn.actions, [], 'reading a price changes nothing');
});

await t('the booking agent books when a client asks', async () => {
  reset({
    'GET agents': [{
      role: 'booking', name: 'Bookings', objective: '', instructions: '',
      tools: AGENT_BLUEPRINTS.booking.tools, permissions: {}, escalation: '', status: 'active',
    }],
    'GET conversation_messages': [],
    'GET conversations': [{
      id: 'conv-1', lead_id: 7, customer_id: '55501',
      customer_name: 'Amina', channel_type: 'telegram',
    }],
    'GET services': [{ id: 'svc-1', name: 'Teeth cleaning', duration_minutes: 30, active: true }],
  });
  rows['POST appointments'] = [{ id: 'apt-1', service_name: 'Teeth cleaning' }];
  script = [
    toolCall('book_appointment', {
      service_name: 'Teeth cleaning', starts_at: '2026-09-04T10:00:00Z',
    }),
    says("You're booked in for Friday at 10."),
  ];

  const turn = await runAgentTurn({ ...customer('booking'), text: 'can I come Friday at 10?' });

  const inserts = wrote('appointments', 'POST');
  assert.equal(inserts.length, 1, 'no appointment was created');
  assert.equal(inserts[0].body.service_name, 'Teeth cleaning');
  assert.equal(inserts[0].body.lead_id, 7, 'the customer came from the conversation, not the model');
  assert.equal(inserts[0].body.customer_id, '55501');
  assert.equal(inserts[0].body.booked_by_agent, 'booking', 'the diary must show who booked it');
  assert.deepEqual(turn.actions, ['book_appointment']);
});

await t('the sales agent records an order, always unpaid', async () => {
  reset({
    'GET agents': [{
      role: 'sales', name: 'Sales', objective: '', instructions: '',
      tools: AGENT_BLUEPRINTS.sales.tools, permissions: {}, escalation: '', status: 'active',
    }],
    'GET conversation_messages': [],
    'GET conversations': [{
      id: 'conv-1', lead_id: 7, customer_id: '55501',
      customer_name: 'Amina', channel_type: 'telegram',
    }],
  });
  rows['POST orders'] = [{ id: 'o1', order_ref: 'ORD-X' }];
  script = [
    toolCall('record_order', { items: [{ name: 'Toothbrush', qty: 2, price: 450 }], total: 900 }),
    says("That's noted — someone will confirm payment shortly."),
  ];

  const turn = await runAgentTurn({ ...customer('sales'), text: "I'll take two" });

  const inserts = wrote('orders', 'POST');
  assert.equal(inserts.length, 1, 'no order was recorded');
  assert.equal(inserts[0].body.total, 900);
  assert.equal(inserts[0].body.payment_status, 'unpaid', 'an agent can never mark an order paid');
  assert.equal(inserts[0].body.status, 'pending');
  assert.equal(inserts[0].body.lead_id, 7);
  assert.deepEqual(turn.actions, ['record_order']);
});

// ---------------------------------------------------------------------------
// The loop itself
// ---------------------------------------------------------------------------

console.log('\n--- the loop ---');

await t('a tool result comes back to the model before it answers', async () => {
  reset({ 'GET products': [{ id: 'p1', name: 'Toothbrush', price: 450 }] });
  script = [toolCall('list_products', {}), says('450 shillings.')];

  await runAgentTurn(owner());

  assert.equal(script.length, 0, 'the model should have been called twice: once to call, once to answer');
});

await t('several actions in one turn all land', async () => {
  reset();
  script = [
    toolCall('save_service', { name: 'Cleaning', price_amount: 3000 }),
    toolCall('save_service', { name: 'Whitening', price_amount: 8000 }),
    says('Both added.'),
  ];

  const turn = await runAgentTurn(owner());

  assert.equal(wrote('services', 'POST').length, 2);
  assert.deepEqual(turn.actions, ['save_service', 'save_service']);
});

await t('a tool the agent lacks is refused without reaching the database', async () => {
  reset({
    'GET agents': [{
      role: 'sales', name: 'Sales', objective: '', instructions: '',
      tools: AGENT_BLUEPRINTS.sales.tools, permissions: {}, escalation: '', status: 'active',
    }],
    'GET conversation_messages': [],
  });
  // Sales holds no save_service. A model that asks for one anyway must be
  // stopped by the guard, not by the absence of an opportunity.
  script = [
    toolCall('save_service', { name: 'Something', price_amount: 1 }),
    says('I cannot change your services.'),
  ];

  const turn = await runAgentTurn(customer('sales'));

  assert.equal(wrote('services', 'POST').length, 0, 'a refused tool must not write');
  assert.deepEqual(turn.actions, [], 'a refusal is not an action');
});

await t('every executed tool is written to the audit trail', async () => {
  reset();
  script = [toolCall('save_service', { name: 'Cleaning' }), says('Added.')];

  await runAgentTurn(owner());

  const audit = wrote('agent_tool_calls', 'POST');
  assert.equal(audit.length, 1);
  assert.equal(audit[0].body.tool, 'save_service');
  assert.equal(audit[0].body.ok, true);
  assert.equal(audit[0].body.agent_role, 'manager');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
