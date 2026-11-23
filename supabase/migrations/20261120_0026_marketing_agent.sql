-- 0026 - The Marketing agent
--
-- The workforce gains a sixth role, 'marketing': it plans the week's posts
-- from the content library, checks captions against the catalogue and reports
-- what went out. Every business gets it, provisioned by the application the
-- next time anything looks at the team, so this migration only has to widen
-- the two CHECK constraints that would otherwise reject the new role:
--
--   1. public.agents.role          - so the marketing agent's row can exist
--   2. public.agent_lessons.role   - so a lesson can be taught to marketing
--
-- Additive and safe to re-run. Nothing is dropped except those two CHECK
-- constraints, each recreated wider in the same block; no row is touched, and
-- every value the old constraints allowed is still allowed. The policies,
-- grants and the unique constraint on (tenant_id, role) are unchanged.
--
-- The application tolerates this migration not having been applied: the
-- insert of the marketing row is then refused by the old check, which the
-- application catches, and the other five agents carry on exactly as before.
-- Posting is not stopped by the agent's absence.

-- ---------------------------------------------------------------------------
-- 1. agents.role accepts 'marketing'
-- ---------------------------------------------------------------------------
-- The constraint is found by what it constrains rather than by name, so a
-- database where it was created under a different name is handled too.

do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.agents'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%role%'
      and pg_get_constraintdef(con.oid) ilike '%manager%'
  loop
    execute format('alter table public.agents drop constraint %I', c.conname);
  end loop;

  alter table public.agents
    add constraint agents_role_check
    check (role in ('manager', 'sales', 'support', 'booking', 'orders', 'marketing'));
end $$;

comment on column public.agents.role is
  'One of six fixed roles. Businesses do not define departments; adding one is a code change plus a widening of this check.';

-- ---------------------------------------------------------------------------
-- 2. agent_lessons.role accepts 'marketing'
-- ---------------------------------------------------------------------------
-- Null still means "every agent". Guarded because the table arrived in 0020:
-- on a database that has not had that migration there is nothing to widen.

do $$
declare
  c record;
begin
  if to_regclass('public.agent_lessons') is null then
    return;
  end if;

  for c in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.agent_lessons'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%role%'
      and pg_get_constraintdef(con.oid) ilike '%manager%'
  loop
    execute format('alter table public.agent_lessons drop constraint %I', c.conname);
  end loop;

  alter table public.agent_lessons
    add constraint agent_lessons_role_check
    check (role is null or role in ('manager', 'sales', 'support', 'booking', 'orders', 'marketing'));
end $$;
