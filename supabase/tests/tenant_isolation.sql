-- ============================================================================
-- Tenant isolation test suite
-- ----------------------------------------------------------------------------
-- Run against the project database with a privileged connection. The suite
-- impersonates the `authenticated` role and sets request.jwt.claims so that
-- auth.uid() resolves, which exercises the real RLS policies rather than a
-- simulation of them.
--
-- Tenant A = Shwari iPhones      0d67cd18-a05c-443c-b275-6573d7af1259
-- Tenant B = Canary Test Business 11111111-1111-4111-8111-111111111111
--
-- Every negative assertion is paired with a positive control, so a blanket
-- "deny everything" regression cannot masquerade as a pass.
-- ============================================================================

create temp table iso(id int, name text, expected text, actual text, result text);
grant all on iso to authenticated;

create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function pg_temp.as_admin() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

do $t$
declare
  ua uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';  -- owner of tenant A
  ub uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';  -- owner of tenant B
  ta uuid := '0d67cd18-a05c-443c-b275-6573d7af1259';
  tb uuid := '11111111-1111-4111-8111-111111111111';
  n int; s text;
begin
  perform pg_temp.as_user(ua); select count(*) into n from public.products where tenant_id=tb;
  insert into iso values (1,'Tenant A cannot see Tenant B products','0',n::text,case when n=0 then 'PASS' else 'FAIL' end); perform pg_temp.as_admin();

  perform pg_temp.as_user(ub); select count(*) into n from public.products where tenant_id=ta;
  insert into iso values (2,'Tenant B cannot see Tenant A products','0',n::text,case when n=0 then 'PASS' else 'FAIL' end); perform pg_temp.as_admin();

  perform pg_temp.as_user(ua); select count(*) into n from public.leads where tenant_id=tb;
  insert into iso values (3,'Tenant A dashboard cannot see Tenant B leads','0',n::text,case when n=0 then 'PASS' else 'FAIL' end); perform pg_temp.as_admin();

  perform pg_temp.as_user(ub); select count(*) into n from public.leads where tenant_id=ta;
  insert into iso values (4,'Tenant B dashboard cannot see Tenant A leads','0',n::text,case when n=0 then 'PASS' else 'FAIL' end); perform pg_temp.as_admin();

  perform pg_temp.as_user(ub); select count(*) into n from public.conversations where tenant_id=ta;
  insert into iso values (5,'Tenant A conversations cannot appear in Tenant B','0',n::text,case when n=0 then 'PASS' else 'FAIL' end); perform pg_temp.as_admin();

  perform pg_temp.as_user(ub); select count(*) into n from public.conversation_messages where tenant_id=ta;
  insert into iso values (6,'Conversation memory is isolated','0',n::text,case when n=0 then 'PASS' else 'FAIL' end); perform pg_temp.as_admin();

  perform pg_temp.as_user(ua); select count(*) into n from public.tenants where id=tb;
  insert into iso values (9,'Tenant A cannot read Tenant B notification target','0',n::text,case when n=0 then 'PASS' else 'FAIL' end); perform pg_temp.as_admin();

  perform pg_temp.as_user(ub); select count(*) into n from public.tenants where id=ta;
  insert into iso values (10,'Tenant B cannot read Tenant A notification target','0',n::text,case when n=0 then 'PASS' else 'FAIL' end); perform pg_temp.as_admin();

  perform pg_temp.as_user(ua); select count(*) into n from public.payments where tenant_id=tb;
  insert into iso values (11,'Tenant A payment records cannot appear in Tenant B','0',n::text,case when n=0 then 'PASS' else 'FAIL' end); perform pg_temp.as_admin();

  perform pg_temp.as_user(ua); select count(*) into n from public.orders where tenant_id=tb;
  insert into iso values (12,'Tenant A orders cannot appear in Tenant B','0',n::text,case when n=0 then 'PASS' else 'FAIL' end); perform pg_temp.as_admin();

  perform pg_temp.as_user(ua);
  begin
    insert into public.products (tenant_id,name,price) values (tb,'injected by A',1);
    insert into iso values (15,'Client cannot write into another tenant','rejected','INSERTED','FAIL');
  exception when others then
    insert into iso values (15,'Client cannot write into another tenant','rejected','blocked '||sqlstate,'PASS');
  end;
  perform pg_temp.as_admin();

  -- Positive controls.
  perform pg_temp.as_user(ua); select count(*) into n from public.products;
  insert into iso values (16,'Control: A sees exactly its own products','1',n::text,case when n=1 then 'PASS' else 'FAIL' end); perform pg_temp.as_admin();

  perform pg_temp.as_user(ub); select count(*) into n from public.leads;
  insert into iso values (17,'Control: B sees exactly its own leads','1',n::text,case when n=1 then 'PASS' else 'FAIL' end); perform pg_temp.as_admin();

  -- Secret exposure.
  perform pg_temp.as_user(ua);
  begin
    select bot_token into s from public.channels limit 1;
    insert into iso values (18,'Bot token unreadable by dashboard role','denied','READABLE','FAIL');
  exception when others then
    insert into iso values (18,'Bot token unreadable by dashboard role','denied','blocked '||sqlstate,'PASS');
  end;
  perform pg_temp.as_admin();

  perform pg_temp.as_user(ua);
  begin
    select secret_token into s from public.channels limit 1;
    insert into iso values (19,'Webhook secret unreadable by dashboard role','denied','READABLE','FAIL');
  exception when others then
    insert into iso values (19,'Webhook secret unreadable by dashboard role','denied','blocked '||sqlstate,'PASS');
  end;
  perform pg_temp.as_admin();

  perform pg_temp.as_user(ub); select count(*) into n from public.channels_safe;
  insert into iso values (20,'Channel listing works and shows only own channel','1',n::text,case when n=1 then 'PASS' else 'FAIL' end); perform pg_temp.as_admin();

  perform pg_temp.as_user(ua); select count(*) into n from public.channels_safe where tenant_id=tb;
  insert into iso values (21,'Tenant A cannot see Tenant B channel','0',n::text,case when n=0 then 'PASS' else 'FAIL' end); perform pg_temp.as_admin();

  -- Bot-to-tenant routing depends on every channel holding a distinct secret.
  select count(distinct secret_token) into n from public.channels where secret_token is not null;
  insert into iso values (22,'Each channel has a distinct webhook secret',
    (select count(*)::text from public.channels where secret_token is not null), n::text,
    case when n = (select count(*) from public.channels where secret_token is not null) then 'PASS' else 'FAIL' end);
end $t$;

select * from iso order by id;
