/**
 * Automated tests for Admin Agent QA & Evaluation API routes:
 *   - GET /api/admin/agent-turns
 *   - POST /api/admin/agent-turns/:id/label
 *   - GET /api/admin/agent-turns/export
 *
 * Run with: npx tsx src/server/__tests__/adminQa.test.mjs
 */

import assert from 'node:assert';
import http from 'node:http';

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
// Supabase PostgREST Mock
// ---------------------------------------------------------------------------
const realFetch = globalThis.fetch;
let db = [];
let rows = {};

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

globalThis.fetch = async (url, init = {}) => {
  const href = String(url);
  if (href.startsWith('http://127.0.0.1')) {
    return realFetch(url, init);
  }
  const method = init.method ?? 'GET';

  // Auth getUser
  if (href.includes('/auth/v1/user')) {
    const token = (init.headers?.authorization || init.headers?.Authorization || '').replace('Bearer ', '').trim();
    if (token === 'admin-token') {
      return json({ user: { id: 'user-admin', email: 'admin@shwari.ai' } });
    }
    if (token === 'superadmin-token') {
      return json({ user: { id: 'user-super', email: 'super@shwari.ai' } });
    }
    if (token === 'viewer-token') {
      return json({ user: { id: 'user-viewer', email: 'viewer@shwari.ai' } });
    }
    return json({ error: 'unauthorized' }, 401);
  }

  // PostgREST
  const path = href.replace('https://example.supabase.co/rest/v1/', '');
  const table = path.split('?')[0];
  db.push({ method, table, path, body: init.body ? JSON.parse(init.body) : null });

  let out = rows[`${method} ${table}`] ?? [];

  if (table === 'tenant_users' && path.includes('user_id=eq.')) {
    const uid = path.split('user_id=eq.')[1]?.split('&')[0];
    out = (rows['GET tenant_users'] ?? []).filter((u) => u.user_id === uid);
  } else if (table === 'audit_events') {
    if (path.includes('?id=eq.') || path.includes('&id=eq.')) {
      const part = path.includes('?id=eq.') ? path.split('?id=eq.')[1] : path.split('&id=eq.')[1];
      const targetId = parseInt(part?.split('&')[0], 10);
      out = (rows['GET audit_events'] ?? []).filter((e) => e.id === targetId);
    } else if (path.includes('tenant_id=eq.')) {
      const tid = path.split('tenant_id=eq.')[1]?.split('&')[0];
      out = (rows['GET audit_events'] ?? []).filter((e) => e.tenant_id === tid);
    }
  }

  const accept = init.headers && (init.headers.get ? init.headers.get('accept') : init.headers.Accept);
  if (String(accept ?? '').includes('vnd.pgrst.object') && Array.isArray(out)) {
    out = out[0] ?? null;
  }
  return json(out, 200, { 'content-range': `0-${Array.isArray(out) ? out.length : 1}/${Array.isArray(out) ? out.length : 1}` });
};

const { createApp } = await import('../app.js');
const app = createApp();

let server;
let baseUrl;

async function startServer() {
  return new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
}

async function stopServer() {
  return new Promise((resolve) => server.close(resolve));
}

await startServer();

const TENANT_1 = 'tenant-1111-1111';
const TENANT_2 = 'tenant-2222-2222';

function reset(seed = {}) {
  db = [];
  rows = {
    'GET tenant_users': [
      { tenant_id: TENANT_1, role: 'admin', user_id: 'user-admin' },
      { tenant_id: TENANT_1, role: 'viewer', user_id: 'user-viewer' },
      { tenant_id: TENANT_1, role: 'owner', user_id: 'user-super' },
    ],
    'GET audit_events': [
      {
        id: 101,
        tenant_id: TENANT_1,
        actor_id: 'sales',
        actor_type: 'agent',
        agent_role: 'sales',
        action: 'agent.turn',
        resource_type: 'llm_turn',
        details: {
          model_profile: 'primary',
          model_name: 'moonshotai/kimi-k3',
          channel_type: 'whatsapp',
          input_preview: 'Habari, bei ya car wash ni ngapi?',
          reply_preview: 'Deluxe Car Wash ni KES 1500.',
          tools_invoked: ['list_services'],
          duration_ms: 320,
          status: 'success',
        },
        created_at: '2026-09-26T12:00:00Z',
      },
      {
        id: 102,
        tenant_id: TENANT_1,
        actor_id: 'booking',
        actor_type: 'agent',
        agent_role: 'booking',
        action: 'agent.turn',
        resource_type: 'llm_turn',
        details: {
          model_profile: 'fast',
          model_name: 'nvidia/nemotron-3.5',
          channel_type: 'webchat',
          input_preview: 'I want to book Friday at 10am',
          reply_preview: 'Booked Friday 10am.',
          tools_invoked: ['list_appointments', 'book_appointment'],
          duration_ms: 180,
          status: 'success',
        },
        created_at: '2026-09-26T13:00:00Z',
      },
      {
        id: 201,
        tenant_id: TENANT_2,
        actor_id: 'support',
        actor_type: 'agent',
        agent_role: 'support',
        action: 'agent.turn',
        resource_type: 'llm_turn',
        details: {
          model_profile: 'primary',
          channel_type: 'email',
          input_preview: 'My order is delayed',
          tools_invoked: ['list_orders'],
          status: 'success',
        },
        created_at: '2026-09-26T14:00:00Z',
      },
    ],
    'GET agent_turn_labels': [
      {
        id: 'label-1',
        turn_event_id: 101,
        tenant_id: TENANT_1,
        label: 'ok',
        tags: ['swahili_fluency'],
        notes: 'Great response',
        labeled_by: 'user-admin',
        created_at: '2026-09-26T12:05:00Z',
        updated_at: '2026-09-26T12:05:00Z',
      },
    ],
    'POST agent_turn_labels': [
      {
        id: 'label-2',
        turn_event_id: 102,
        tenant_id: TENANT_1,
        label: 'needs_improvement',
        tags: ['slow_latency'],
        notes: 'Took too long to verify diary',
        labeled_by: 'user-admin',
      },
    ],
    ...seed,
  };
}

console.log('\n--- GET /api/admin/agent-turns ---');

await t('rejects unauthenticated requests with 401', async () => {
  reset();
  const res = await fetch(`${baseUrl}/api/admin/agent-turns`);
  assert.equal(res.status, 401);
});

await t('rejects viewer role with 403', async () => {
  reset();
  const res = await fetch(`${baseUrl}/api/admin/agent-turns`, {
    headers: { authorization: 'Bearer viewer-token' },
  });
  assert.equal(res.status, 403);
});

await t('admin retrieves turns with joined labels for their tenant', async () => {
  reset();
  const res = await fetch(`${baseUrl}/api/admin/agent-turns`, {
    headers: { authorization: 'Bearer admin-token' },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.turns));
  assert.ok(data.turns.length >= 2);

  const turn101 = data.turns.find((t) => t.id === 101);
  assert.ok(turn101);
  assert.equal(turn101.agent_role, 'sales');
  assert.equal(turn101.label?.label, 'ok');
  assert.ok(turn101.label?.tags.includes('swahili_fluency'));

  const turn102 = data.turns.find((t) => t.id === 102);
  assert.ok(turn102);
  assert.equal(turn102.label, null, 'turn 102 was not yet labeled');
});

await t('filters turns by tool name', async () => {
  reset();
  const res = await fetch(`${baseUrl}/api/admin/agent-turns?tool=book_appointment`, {
    headers: { authorization: 'Bearer admin-token' },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.turns.length, 1);
  assert.equal(data.turns[0].id, 102);
});

await t('filters turns by label: ok', async () => {
  reset();
  const res = await fetch(`${baseUrl}/api/admin/agent-turns?label=ok`, {
    headers: { authorization: 'Bearer admin-token' },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.turns.length, 1);
  assert.equal(data.turns[0].id, 101);
});

console.log('\n--- POST /api/admin/agent-turns/:id/label ---');

await t('rejects invalid label value with 400', async () => {
  reset();
  const res = await fetch(`${baseUrl}/api/admin/agent-turns/102/label`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer admin-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ label: 'invalid_label' }),
  });
  assert.equal(res.status, 400);
});

await t('saves label and tags for an agent turn', async () => {
  reset();
  const res = await fetch(`${baseUrl}/api/admin/agent-turns/102/label`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer admin-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      label: 'needs_improvement',
      tags: ['slow_latency'],
      notes: 'Took too long to verify diary',
    }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.label.label, 'needs_improvement');
});

await t('forbids labeling a turn belonging to another tenant', async () => {
  reset();
  const res = await fetch(`${baseUrl}/api/admin/agent-turns/201/label`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer admin-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ label: 'ok' }),
  });
  assert.equal(res.status, 403);
});

console.log('\n--- GET /api/admin/agent-turns/export ---');

await t('exports labeled dataset in valid JSONL format', async () => {
  reset();
  const res = await fetch(`${baseUrl}/api/admin/agent-turns/export?labeled_only=true`, {
    headers: { authorization: 'Bearer admin-token' },
  });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(text.trim().length > 0);

  const lines = text.trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(lines.length >= 1);
  const entry = lines[0];
  assert.ok('input' in entry);
  assert.ok('expected_tools' in entry);
  assert.ok('actual_tools' in entry);
  assert.ok('role' in entry);
  assert.ok('channel' in entry);
  assert.ok('language_hint' in entry);
  assert.ok('label' in entry);
  assert.ok('notes' in entry);

  assert.equal(entry.role, 'sales');
  assert.equal(entry.label, 'ok');
  assert.equal(entry.language_hint, 'sw');
});

await stopServer();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
