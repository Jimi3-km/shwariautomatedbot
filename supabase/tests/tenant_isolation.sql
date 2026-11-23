-- ============================================================================
-- Tenant isolation and authorization test suite
-- ----------------------------------------------------------------------------
-- Self-contained: it seeds two throwaway tenants inside a transaction, runs
-- every assertion, prints the results and ROLLS BACK. Nothing is left behind,
-- so it is safe on any database that has the migrations applied -- a fresh
-- local one or the live project.
--
-- Run with a privileged connection (the postgres role), e.g.
--   psql "$DATABASE_URL" -f supabase/tests/tenant_isolation.sql
--
-- It impersonates the `authenticated` role and sets request.jwt.claims so that
-- auth.uid() and auth.role() resolve, which exercises the real RLS policies and
-- triggers rather than a simulation of them.
--
-- Every denial is paired with a positive control, so a blanket "deny
-- everything" regression cannot pass. Any FAIL row at the end is a defect.
-- ============================================================================

begin;

create temp table iso(id serial, name text, result text, detail text) on commit drop;
grant all on iso to authenticated;
grant usage on sequence iso_id_seq to authenticated;

create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function pg_temp.as_admin() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function pg_temp.record(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into iso(name, result, detail)
  values (p_name, case when p_ok then 'PASS' else 'FAIL' end, p_detail);
$$;

/** Runs a statement as a user; returns 'ok:<rows>' or 'error:<sqlstate>'. */
create or replace function pg_temp.attempt(p_user uuid, p_sql text) returns text
language plpgsql as $$
declare
  n bigint;
  outcome text;
begin
  perform pg_temp.as_user(p_user);
  begin
    execute p_sql;
    get diagnostics n = row_count;
    outcome := 'ok:' || n;
  exception when others then
    outcome := 'error:' || sqlstate;
  end;
  perform pg_temp.as_admin();
  return outcome;
end $$;

/** Runs a scalar query as a user and returns it as text ('error:<sqlstate>' on failure). */
create or replace function pg_temp.ask(p_user uuid, p_sql text) returns text
language plpgsql as $$
declare
  v text;
begin
  perform pg_temp.as_user(p_user);
  begin
    execute p_sql into v;
  exception when others then
    v := 'error:' || sqlstate;
  end;
  perform pg_temp.as_admin();
  return v;
end $$;

do $t$
declare
  -- Tenant A staff
  a_owner  uuid := 'a0000000-0000-4000-8000-000000000001';
  a_admin  uuid := 'a0000000-0000-4000-8000-000000000002';
  a_member uuid := 'a0000000-0000-4000-8000-000000000003';
  a_viewer uuid := 'a0000000-0000-4000-8000-000000000004';
  -- Tenant B staff
  b_owner  uuid := 'b0000000-0000-4000-8000-000000000001';
  outsider uuid := 'c0000000-0000-4000-8000-000000000001';

  ta uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  tb uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';

  ch_a uuid; ch_b uuid;
  lead_a bigint; lead_b bigint;
  pay_a uuid; pay_b uuid;
  turn_a bigint; turn_b bigint;
  r text;
begin
  -- -------------------------------------------------------------------------
  -- Fixtures (as the privileged role)
  -- -------------------------------------------------------------------------
  insert into public.tenants (id, slug, business_name, notification_target)
  values (ta, 'iso-test-a', 'Isolation Test A', 'secret-target-a'),
         (tb, 'iso-test-b', 'Isolation Test B', 'secret-target-b');

  insert into public.tenant_users (tenant_id, user_id, role) values
    (ta, a_owner, 'owner'), (ta, a_admin, 'admin'), (ta, a_member, 'member'), (ta, a_viewer, 'viewer'),
    (tb, b_owner, 'owner');

  insert into public.channels (tenant_id, channel_type, channel_account_id, secret_token, bot_token, display_name)
  values (ta, 'telegram', 'iso-acct-a', 'iso-secret-a', 'iso-bot-token-a', 'A bot') returning id into ch_a;
  insert into public.channels (tenant_id, channel_type, channel_account_id, secret_token, bot_token, display_name)
  values (tb, 'telegram', 'iso-acct-b', 'iso-secret-b', 'iso-bot-token-b', 'B bot') returning id into ch_b;

  insert into public.products (tenant_id, name, price) values (ta, 'A product', 100), (tb, 'B product', 200);

  insert into public.leads (tenant_id, customer_id, customer_name, notes)
  values (ta, 'cust-a', 'Customer A', 'note a') returning id into lead_a;
  insert into public.leads (tenant_id, customer_id, customer_name, notes)
  values (tb, 'cust-b', 'Customer B', 'note b') returning id into lead_b;

  insert into public.conversations (tenant_id, channel_id, customer_id) values (ta, ch_a, 'cust-a'), (tb, ch_b, 'cust-b');
  insert into public.orders (tenant_id, order_ref, total) values (ta, 'ISO-A-1', 100), (tb, 'ISO-B-1', 200);

  insert into public.payments (tenant_id, lead_id, amount, currency)
  values (ta, lead_a, 100, 'KES') returning id into pay_a;
  insert into public.payments (tenant_id, lead_id, amount, currency)
  values (tb, lead_b, 200, 'KES') returning id into pay_b;

  insert into public.audit_events (tenant_id, actor_id, actor_type, agent_role, action, resource_type)
  values (ta, 'system', 'agent', 'sales', 'agent.turn', 'llm_turn') returning id into turn_a;
  insert into public.audit_events (tenant_id, actor_id, actor_type, agent_role, action, resource_type)
  values (tb, 'system', 'agent', 'sales', 'agent.turn', 'llm_turn') returning id into turn_b;

  -- -------------------------------------------------------------------------
  -- 1. Read isolation
  -- -------------------------------------------------------------------------
  r := pg_temp.ask(a_owner, format('select count(*) from public.products where tenant_id = %L', tb));
  perform pg_temp.record('A cannot see B products', r = '0', r);
  r := pg_temp.ask(a_owner, 'select count(*) from public.products');
  perform pg_temp.record('Control: A sees exactly its own product', r = '1', r);

  r := pg_temp.ask(b_owner, format('select count(*) from public.leads where tenant_id = %L', ta));
  perform pg_temp.record('B cannot see A leads', r = '0', r);
  r := pg_temp.ask(b_owner, 'select count(*) from public.leads');
  perform pg_temp.record('Control: B sees exactly its own lead', r = '1', r);

  r := pg_temp.ask(a_owner, format(
    'select (select count(*) from public.conversations where tenant_id = %1$L)'
    ' + (select count(*) from public.orders where tenant_id = %1$L)'
    ' + (select count(*) from public.payments where tenant_id = %1$L)'
    ' + (select count(*) from public.audit_events where tenant_id = %1$L)'
    ' + (select count(*) from public.tenant_users where tenant_id = %1$L)', tb));
  perform pg_temp.record('A cannot see B conversations, orders, payments, audit trail or team', r = '0', r);

  r := pg_temp.ask(a_owner, format('select count(*) from public.tenants where id = %L', tb));
  perform pg_temp.record('A cannot read the B tenant row', r = '0', r);

  r := pg_temp.ask(outsider, 'select (select count(*) from public.tenants) + (select count(*) from public.products)');
  perform pg_temp.record('A user with no membership sees nothing', r = '0', r);

  -- -------------------------------------------------------------------------
  -- 2. Write isolation
  -- -------------------------------------------------------------------------
  r := pg_temp.attempt(a_owner, format('insert into public.products (tenant_id, name) values (%L, ''planted'')', tb));
  perform pg_temp.record('A cannot insert into B', r like 'error:%', r);

  r := pg_temp.attempt(a_owner, format('update public.leads set notes = ''hijacked'' where id = %s', lead_b));
  perform pg_temp.record('A cannot update a B lead', r = 'ok:0', r);

  r := pg_temp.attempt(a_member, format('update public.leads set notes = ''mine'' where id = %s', lead_a));
  perform pg_temp.record('Control: an A member can update an A lead', r = 'ok:1', r);

  r := pg_temp.attempt(a_viewer, format('update public.leads set notes = ''viewer'' where id = %s', lead_a));
  perform pg_temp.record('A viewer cannot write', r = 'ok:0', r);

  -- -------------------------------------------------------------------------
  -- 3. Channel secrets
  -- -------------------------------------------------------------------------
  r := pg_temp.ask(a_owner, 'select bot_token from public.channels limit 1');
  perform pg_temp.record('Bot token unreadable by the dashboard role', r like 'error:%', r);
  r := pg_temp.ask(a_owner, 'select secret_token from public.channels limit 1');
  perform pg_temp.record('Webhook secret unreadable by the dashboard role', r like 'error:%', r);
  r := pg_temp.ask(a_owner, 'select count(*) from public.channels_safe');
  perform pg_temp.record('Control: channels_safe lists only the caller''s channel', r = '1', r);
  r := pg_temp.ask(a_owner, 'select api_key_hash from public.tenants limit 1');
  perform pg_temp.record('API key digest unreadable by the dashboard role', r like 'error:%', r);
  r := pg_temp.ask(a_owner, 'select count(*) from public.meta_tokens');
  perform pg_temp.record('meta_tokens unreachable by the dashboard role', r like 'error:%' or r = '0', r);

  -- -------------------------------------------------------------------------
  -- 4. Membership escalation (migration 0018)
  -- -------------------------------------------------------------------------
  r := pg_temp.attempt(a_admin, format(
    'update public.tenant_users set role = ''owner'' where tenant_id = %L and user_id = %L', ta, a_admin));
  perform pg_temp.record('An admin cannot make themselves owner', r like 'error:%', r);

  r := pg_temp.attempt(a_admin, format(
    'update public.tenant_users set role = ''member'' where tenant_id = %L and user_id = %L', ta, a_owner));
  perform pg_temp.record('An admin cannot demote the owner', r like 'error:%', r);

  r := pg_temp.attempt(a_admin, format(
    'delete from public.tenant_users where tenant_id = %L and user_id = %L', ta, a_owner));
  perform pg_temp.record('An admin cannot remove the owner', r like 'error:%', r);

  r := pg_temp.attempt(a_admin, format(
    'update public.tenant_users set role = ''owner'' where tenant_id = %L and user_id = %L', ta, a_member));
  perform pg_temp.record('An admin cannot grant owner to someone else', r like 'error:%', r);

  r := pg_temp.attempt(a_admin, format(
    'update public.tenant_users set user_id = %L where tenant_id = %L and user_id = %L', outsider, ta, a_member));
  perform pg_temp.record('A membership row cannot be repointed at another user', r like 'error:%', r);

  r := pg_temp.attempt(a_admin, format(
    'insert into public.tenant_users (tenant_id, user_id, role) values (%L, %L, ''owner'')', ta, outsider));
  perform pg_temp.record('An admin cannot add a new owner', r like 'error:%', r);

  r := pg_temp.attempt(a_member, format(
    'update public.tenant_users set role = ''admin'' where tenant_id = %L and user_id = %L', ta, a_viewer));
  perform pg_temp.record('A member cannot change roles at all', r = 'ok:0', r);

  r := pg_temp.attempt(a_owner, format(
    'update public.tenant_users set role = ''member'' where tenant_id = %L and user_id = %L', ta, a_owner));
  perform pg_temp.record('An owner cannot change their own role', r like 'error:%', r);

  r := pg_temp.attempt(a_owner, format(
    'insert into public.tenant_users (tenant_id, user_id, role) values (%L, %L, ''viewer'')', tb, a_owner));
  perform pg_temp.record('A user cannot add themselves to another tenant', r like 'error:%', r);

  r := pg_temp.attempt(a_admin, format(
    'update public.tenant_users set role = ''member'' where tenant_id = %L and user_id = %L', ta, a_viewer));
  perform pg_temp.record('Control: an admin can promote a viewer to member', r = 'ok:1', r);

  r := pg_temp.attempt(a_owner, format(
    'update public.tenant_users set role = ''owner'' where tenant_id = %L and user_id = %L', ta, a_admin));
  perform pg_temp.record('Control: an owner can grant owner', r = 'ok:1', r);

  -- The last owner is protected even from the privileged role.
  begin
    delete from public.tenant_users where tenant_id = tb and user_id = b_owner;
    perform pg_temp.record('The last owner of a workspace cannot be removed', false, 'delete succeeded');
  exception when others then
    perform pg_temp.record('The last owner of a workspace cannot be removed', true, sqlstate);
  end;

  -- -------------------------------------------------------------------------
  -- 5. QA labels (migration 0018)
  -- -------------------------------------------------------------------------
  r := pg_temp.attempt(a_owner, format(
    'insert into public.agent_turn_labels (turn_event_id, tenant_id, label) values (%s, %L, ''bug'')', turn_b, ta));
  perform pg_temp.record('A cannot label a B turn under its own tenant id', r like 'error:%', r);

  r := pg_temp.attempt(a_owner, format(
    'insert into public.agent_turn_labels (turn_event_id, tenant_id, label) values (%s, %L, ''bug'')', turn_b, tb));
  perform pg_temp.record('A cannot label a B turn under B''s tenant id', r like 'error:%', r);

  r := pg_temp.attempt(a_member, format(
    'insert into public.agent_turn_labels (turn_event_id, tenant_id, label) values (%s, %L, ''ok'')', turn_a, ta));
  perform pg_temp.record('A member cannot label turns', r like 'error:%', r);

  r := pg_temp.attempt(a_admin, format(
    'insert into public.agent_turn_labels (turn_event_id, tenant_id, label) values (%s, %L, ''ok'')', turn_a, ta));
  perform pg_temp.record('Control: an A admin can label an A turn', r = 'ok:1', r);

  r := pg_temp.attempt(a_admin, format(
    'update public.agent_turn_labels set turn_event_id = %s where turn_event_id = %s', turn_b, turn_a));
  perform pg_temp.record('A label cannot be moved onto a B turn', r like 'error:%', r);

  r := pg_temp.ask(b_owner, 'select count(*) from public.agent_turn_labels');
  perform pg_temp.record('B sees no labels written by A', r = '0', r);

  -- -------------------------------------------------------------------------
  -- 6. Payment verification (migrations 0001 + 0018)
  -- -------------------------------------------------------------------------
  r := pg_temp.attempt(a_member, format(
    'update public.payments set verification_status = ''verified'', verified_by = %L where id = %L', a_owner, pay_a));
  perform pg_temp.record('A member cannot verify a payment in the owner''s name', r like 'error:%', r);

  r := pg_temp.attempt(a_viewer, format(
    'update public.payments set verification_status = ''verified'', verified_by = %L where id = %L', a_viewer, pay_a));
  perform pg_temp.record('A viewer cannot verify a payment', r = 'ok:0' or r like 'error:%', r);

  r := pg_temp.attempt(a_owner, format(
    'update public.payments set verification_status = ''verified'', verified_by = %L where id = %L', a_owner, pay_b));
  perform pg_temp.record('A cannot verify a B payment', r = 'ok:0', r);

  r := pg_temp.attempt(a_member, format(
    'update public.payments set verification_status = ''verified'', verified_by = %L where id = %L', a_member, pay_a));
  perform pg_temp.record('Control: a member can verify a payment as themselves', r = 'ok:1', r);

  r := pg_temp.attempt(a_member, format('update public.payments set amount = 1 where id = %L', pay_a));
  perform pg_temp.record('The amount of a verified payment cannot be changed', r like 'error:%', r);

  -- The server (no user JWT) cannot verify without a real staff member either.
  begin
    update public.payments set verification_status = 'verified', verified_by = null where id = pay_b;
    perform pg_temp.record('No path verifies a payment without a staff user', false, 'update succeeded');
  exception when others then
    perform pg_temp.record('No path verifies a payment without a staff user', true, sqlstate);
  end;
  begin
    update public.payments set verification_status = 'verified', verified_by = a_owner where id = pay_b;
    perform pg_temp.record('verified_by must be staff of the payment''s own tenant', false, 'update succeeded');
  exception when others then
    perform pg_temp.record('verified_by must be staff of the payment''s own tenant', true, sqlstate);
  end;

  -- -------------------------------------------------------------------------
  -- 7. Agent configuration is admin-only (migration 0018)
  -- -------------------------------------------------------------------------
  insert into public.business_facts (tenant_id, fact_key, value) values (ta, 'iso_topic', 'original');

  r := pg_temp.attempt(a_member, format(
    'update public.business_facts set value = ''tampered'' where tenant_id = %L and fact_key = ''iso_topic''', ta));
  perform pg_temp.record('A member cannot edit business facts directly', r = 'ok:0', r);

  r := pg_temp.attempt(a_admin, format(
    'update public.business_facts set value = ''corrected'' where tenant_id = %L and fact_key = ''iso_topic''', ta));
  perform pg_temp.record('Control: an admin can edit business facts', r = 'ok:1', r);

  r := pg_temp.attempt(b_owner, format(
    'update public.business_facts set value = ''cross'' where tenant_id = %L', ta));
  perform pg_temp.record('B cannot edit A business facts', r = 'ok:0', r);
end
$t$;

select id, result, name, detail from iso order by id;

select
  count(*) filter (where result = 'PASS') as passed,
  count(*) filter (where result = 'FAIL') as failed
from iso;

rollback;
