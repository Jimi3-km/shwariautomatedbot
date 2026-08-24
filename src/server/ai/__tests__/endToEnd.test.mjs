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
/** The system prompt of the most recent model call. */
let lastSystemPrompt = '';
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
    // The system prompt is the first message; keep the latest so tests can
    // assert what the agent was actually told about the customer.
    lastSystemPrompt = (JSON.parse(init.body).messages ?? []).find((m) => m.role === 'system')?.content ?? '';
    const next = script.shift();
    if (!next) throw new Error('the model was called more times than the test scripted');
    return json(next);
  }

  // --- PostgREST ---
  const path = href.replace('https://example.supabase.co/rest/v1/', '');
  const table = path.split('?')[0];
  db.push({ method, table, path, body: init.body ? JSON.parse(init.body) : null });

  let out = rows[`${method} ${table}`] ?? [];
  // .single()/.maybeSingle() ask PostgREST for a single object via the Accept
  // header; the real server returns the object, not a one-element array, so the
  // double must too — otherwise a tool reading a field off a .single() result
  // sees an array and finds nothing.
  const accept = init.headers && (init.headers.get ? init.headers.get('accept') : init.headers.Accept);
  if (String(accept ?? '').includes('vnd.pgrst.object') && Array.isArray(out)) {
    out = out[0] ?? null;
  }
  return json(out);
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
const { TOOLS } = await import('../tools/index.ts');
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

// ---------------------------------------------------------------------------
// Remembering a customer
// ---------------------------------------------------------------------------

console.log('\n--- customer details ---');

const salesAgent = () => ({
  'GET agents': [{
    role: 'sales', name: 'Sales', objective: '', instructions: '',
    tools: AGENT_BLUEPRINTS.sales.tools, permissions: {}, escalation: '', status: 'active',
  }],
});

await t('collected name, email and phone are saved to the lead', async () => {
  reset({
    ...salesAgent(),
    'GET conversations': [{ id: 'conv-1', lead_id: 7, channel_type: 'telegram', customer_id: '55501' }],
  });
  rows['GET leads'] = [{ id: 7, customer_name: null, email: null, phone: null }];
  script = [
    toolCall('save_customer_details', {
      name: 'Amina Wanjiku', email: 'amina@example.com', phone: '0712 345 678',
    }),
    says("Thanks Amina — I've got your details."),
  ];

  const turn = await runAgentTurn({ ...customer('sales'), text: "I'm Amina, amina@example.com, 0712 345 678" });

  const updates = wrote('leads', 'PATCH');
  assert.equal(updates.length, 1, 'the details were not written to the lead');
  assert.equal(updates[0].body.customer_name, 'Amina Wanjiku');
  assert.equal(updates[0].body.email, 'amina@example.com');
  assert.equal(updates[0].body.phone, '+254712345678'.replace('+254', '0') === '0712345678' ? '0712345678' : updates[0].body.phone);
  // Phone is normalised to digits (leading + kept); the spaces are gone.
  assert.ok(/^\+?\d+$/.test(updates[0].body.phone), 'phone should be digits only');
  assert.deepEqual(turn.actions, ['save_customer_details']);
});

await t('a malformed email is refused before any write', async () => {
  reset({
    ...salesAgent(),
    'GET conversations': [{ id: 'conv-1', lead_id: 7, channel_type: 'telegram', customer_id: '55501' }],
  });
  script = [
    toolCall('save_customer_details', { email: 'not-an-email' }),
    says('Could you give me that email again?'),
  ];

  const turn = await runAgentTurn({ ...customer('sales'), text: 'my email is not-an-email' });

  assert.equal(wrote('leads', 'PATCH').length, 0, 'a bad email must not reach the database');
  assert.deepEqual(turn.actions, [], 'a refused save is not an action');
});

await t('a returning customer is remembered in the prompt, not re-asked', async () => {
  reset({
    ...salesAgent(),
    'GET conversations': [{ id: 'conv-1', lead_id: 7, customer_name: 'Amina', channel_type: 'telegram', customer_id: '55501' }],
  });
  rows['GET leads'] = [{ id: 7, customer_name: 'Amina Wanjiku', email: 'amina@example.com', phone: '0712345678' }];
  script = [says('Welcome back, Amina! What can I get you today?')];

  await runAgentTurn({ ...customer('sales'), text: 'hi again' });

  assert.match(lastSystemPrompt, /Amina Wanjiku/, 'the agent was not told the customer already exists');
  assert.match(lastSystemPrompt, /amina@example\.com/);
  assert.match(lastSystemPrompt, /never ask again/i, 'the agent was not told to skip re-asking');
});

await t('the manager is never handed a customer-memory block', async () => {
  reset();
  script = [says('Hello.')];
  await runAgentTurn({ ...owner('manager'), conversationId: 'conv-1' });
  assert.ok(!/WHO YOU ARE TALKING TO/.test(lastSystemPrompt),
    'the manager talks to the owner, not a customer');
});

// ---------------------------------------------------------------------------
// Guiding a payment
// ---------------------------------------------------------------------------

console.log('\n--- payment guidance ---');

await t('the agent reads out the real payment instructions', async () => {
  reset({
    ...salesAgent(),
    'GET conversations': [{ id: 'conv-1', lead_id: 7, channel_type: 'telegram', customer_id: '55501' }],
    'GET business_facts': [{ value: 'Send to M-Pesa Till 5678, then share the code.' }],
  });
  rows['GET leads'] = [{ id: 7, customer_name: 'Amina', email: null, phone: null }];
  script = [
    toolCall('get_payment_instructions', {}),
    says('Pay via M-Pesa Till 5678, then send me the code.'),
  ];

  const turn = await runAgentTurn({ ...customer('sales'), text: 'how do I pay?' });

  assert.ok(
    db.some((r) => r.table === 'business_facts' && r.method === 'GET' && /payment/.test(r.path)),
    'it did not look up the payment instructions',
  );
  assert.match(turn.reply, /5678/, 'the real till number should reach the customer');
  assert.deepEqual(turn.actions, [], 'reading instructions changes nothing');
});

await t('the owner can set payment instructions from chat', async () => {
  reset();
  rows['POST business_facts'] = [{ category: 'payment', fact_key: 'how_to_pay' }];
  script = [
    toolCall('set_payment_instructions', { instructions: 'Bank transfer to 0123456789, ref your name.' }),
    says("Saved — the team will read that out when customers want to pay."),
  ];

  const turn = await runAgentTurn(owner());

  const writes = wrote('business_facts', 'POST');
  assert.equal(writes.length, 1, 'the instructions were not stored');
  assert.equal(writes[0].body.category, 'payment');
  assert.equal(writes[0].body.fact_key, 'how_to_pay');
  assert.match(writes[0].body.value, /0123456789/);
  assert.deepEqual(turn.actions, ['set_payment_instructions']);
});

await t('a payment claim is recorded unverified, never confirmed', async () => {
  reset({
    'GET agents': [{
      role: 'orders', name: 'Orders', objective: '', instructions: '',
      tools: AGENT_BLUEPRINTS.orders.tools, permissions: {}, escalation: '', status: 'active',
    }],
    'GET conversations': [{ id: 'conv-1', lead_id: 7, channel_type: 'telegram', customer_id: '55501' }],
    'GET payments': [],
  });
  rows['GET leads'] = [{ id: 7, customer_name: 'Amina', email: null, phone: null }];
  rows['POST payments'] = [{ id: 'pay-1', transaction_code: 'ABC123', verification_status: 'unverified' }];
  script = [
    toolCall('record_payment_claim', { transaction_code: 'ABC123', amount: 900 }),
    says("Got it — someone will confirm your payment shortly."),
  ];

  const turn = await runAgentTurn({ ...customer('orders'), text: 'paid, code ABC123' });

  const writes = wrote('payments', 'POST');
  assert.equal(writes.length, 1, 'the claim was not recorded');
  assert.equal(writes[0].body.verification_status, 'unverified', 'an agent can never verify a payment');
  assert.equal(writes[0].body.transaction_code, 'ABC123');
  assert.deepEqual(turn.actions, ['record_payment_claim']);
});

// ---------------------------------------------------------------------------
// Running the rest of the dashboard from chat
// ---------------------------------------------------------------------------

console.log('\n--- settings and the inbox ---');

await t('the owner changes settings by chat', async () => {
  reset();
  rows['GET tenants'] = [{ business_name: 'Test Co', currency: 'KES', timezone: 'Africa/Nairobi', contact_info: { email: 'old@test.co' } }];
  script = [
    toolCall('update_business_settings', {
      assistant_name: 'Zuri', order_prefix: 'shop-01', contact_phone: '0712000000',
    }),
    says("Done — I'm Zuri now, orders start SHOP01, and I've added your phone."),
  ];

  const turn = await runAgentTurn(owner());

  const updates = wrote('tenants', 'PATCH');
  assert.equal(updates.length, 1, 'settings were not written');
  assert.equal(updates[0].body.agent_name, 'Zuri');
  assert.equal(updates[0].body.order_prefix, 'SHOP01', 'prefix is normalised');
  // contact_info is merged, not clobbered — the old email survives.
  assert.equal(updates[0].body.contact_info.email, 'old@test.co');
  assert.equal(updates[0].body.contact_info.phone, '0712000000');
  assert.deepEqual(turn.actions, ['update_business_settings']);
});

await t('Shwari messages a customer in the inbox', async () => {
  reset({
    'GET leads': [{ id: 7, customer_name: 'Amina', channel_type: 'webchat', customer_id: 'v1' }],
    'GET conversations': [{ id: 'conv-9', ai_enabled: true }],
  });
  script = [
    toolCall('message_customer', { lead_id: 7, text: 'Your order is ready for pickup.' }),
    says("I've let Amina know."),
  ];

  const turn = await runAgentTurn(owner());

  const msgs = wrote('conversation_messages', 'POST');
  assert.equal(msgs.length, 1, 'nothing was written to the transcript');
  assert.equal(msgs[0].body.sender, 'agent');
  assert.equal(msgs[0].body.conversation_id, 'conv-9');
  assert.match(msgs[0].body.body, /ready for pickup/);
  assert.deepEqual(turn.actions, ['message_customer']);
});

await t('Shwari takes a conversation over from the AI', async () => {
  reset({
    'GET leads': [{ id: 7, customer_name: 'Amina', channel_type: 'telegram', customer_id: '55501' }],
    'GET conversations': [{ id: 'conv-9', ai_enabled: true }],
  });
  script = [
    toolCall('set_conversation_handling', { lead_id: 7, handled_by: 'person' }),
    says("You've got this one — the AI will hold off."),
  ];

  await runAgentTurn(owner());

  const updates = wrote('conversations', 'PATCH');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].body.ai_enabled, false, 'taking over must switch the AI off');
});

await t('an order can be moved and re-routed in one call', async () => {
  reset();
  rows['PATCH orders'] = [{ order_ref: 'ORD-X', status: 'confirmed', payment_status: 'unpaid', delivery_location: 'Westlands' }];
  script = [
    toolCall('update_order_status', { order_ref: 'ORD-X', status: 'confirmed', delivery_location: 'Westlands' }),
    says('Confirmed, delivering to Westlands.'),
  ];

  await runAgentTurn(owner());

  const updates = wrote('orders', 'PATCH');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].body.status, 'confirmed');
  assert.equal(updates[0].body.delivery_location, 'Westlands');
  assert.equal(updates[0].body.payment_status, undefined, 'fulfilment must not touch payment');
});

console.log('\n--- the lines Shwari must not cross ---');

await t('no tool can verify or reject a payment', () => {
  for (const name of TOOLS.keys()) {
    assert.ok(!/verify|reject|approve/.test(name) || name === 'setup_status',
      `${name} would let an agent decide a payment; only a person may`);
  }
});

await t('the manager holds no channel, role or delete power', () => {
  const forbidden = /connect|oauth|token|grant_role|set_role|invite|delete_(customer|order|tenant)|hard_delete/;
  for (const name of AGENT_BLUEPRINTS.manager.tools) {
    assert.ok(!forbidden.test(name), `the manager must not hold ${name}`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
