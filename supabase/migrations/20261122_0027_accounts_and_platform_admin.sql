-- ============================================================================
-- 0027  Accounts, business roles and the platform admin
-- ============================================================================
-- Two levels that never mix (see .claude/skills/shwari-platform/SKILL.md,
-- "Accounts and access"):
--
--   * Business roles live in tenant_users.role. The stored names are unchanged
--     (owner, admin, member, viewer); the product calls them Owner, Manager,
--     Staff and Viewer.
--   * A platform admin is a row in platform_admins. It is granted here, in the
--     database, and nowhere in the application.
--
-- A platform admin reaches a business through the same row-level policies as
-- its own staff. Every policy resolves the caller through current_tenant_ids()
-- and current_tenant_role(); both now also admit a platform admin, but only
-- for the one business named in the request (the x-acting-tenant header the
-- server sets), so a platform admin's query can never mix two businesses.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Platform admins
-- ---------------------------------------------------------------------------
create table if not exists public.platform_admins (
  user_id    uuid        primary key references auth.users(id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);

comment on table public.platform_admins is
  'People who run the platform. Granted by inserting a row here directly; the application never writes to this table.';

alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from anon, authenticated;
grant all on public.platform_admins to service_role;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (select 1 from public.platform_admins pa where pa.user_id = auth.uid())
$$;

-- The business a platform admin is working in for this request, if any.
create or replace function public.acting_tenant()
returns uuid
language plpgsql
stable
set search_path = public, pg_catalog
as $$
declare
  v text;
begin
  v := nullif(current_setting('request.headers', true), '')::json ->> 'x-acting-tenant';
  if v is null or v = '' then
    return null;
  end if;
  return v::uuid;
exception when others then
  return null;
end;
$$;

create or replace function public.current_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select tu.tenant_id from public.tenant_users tu where tu.user_id = auth.uid()
  union
  select public.acting_tenant()
  where public.acting_tenant() is not null and public.is_platform_admin()
$$;

create or replace function public.current_tenant_role(p_tenant uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(
    (select tu.role from public.tenant_users tu
      where tu.user_id = auth.uid() and tu.tenant_id = p_tenant limit 1),
    -- A platform admin acts in a business with a manager's reach: everything
    -- except what belongs to the owner alone.
    case when p_tenant = public.acting_tenant() and public.is_platform_admin() then 'admin' end
  )
$$;

revoke all on function public.is_platform_admin() from public;
revoke all on function public.acting_tenant()     from public;
grant execute on function public.is_platform_admin() to authenticated, service_role;
grant execute on function public.acting_tenant()     to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Businesses wait for approval
-- ---------------------------------------------------------------------------
alter table public.tenants drop constraint if exists tenants_status_check;
alter table public.tenants add constraint tenants_status_check
  check (status = any (array['pending'::text, 'active'::text, 'suspended'::text, 'trial'::text, 'cancelled'::text]));

alter table public.tenants
  add column if not exists approved_at     timestamptz,
  add column if not exists approved_by     uuid,
  add column if not exists status_reason   text,
  add column if not exists agents_paused   boolean not null default false;

comment on column public.tenants.status is
  'pending = signed up, waiting for the platform admin; agents do not answer. active/trial = live. suspended/cancelled = switched off.';
comment on column public.tenants.agents_paused is
  'Set by the platform admin to stop the agents answering without suspending the business.';

-- Every business that exists today was set up by hand and stays live.
update public.tenants set approved_at = coalesce(approved_at, created_at) where status in ('active', 'trial');

-- ---------------------------------------------------------------------------
-- 3. Staff invitations
-- ---------------------------------------------------------------------------
create table if not exists public.tenant_invitations (
  id           uuid        primary key default gen_random_uuid(),
  tenant_id    uuid        not null references public.tenants(id) on delete cascade,
  email        text        not null,
  role         text        not null check (role in ('admin', 'member', 'viewer')),
  -- Only a hash is stored: the link in the email is the only copy of the token.
  token_hash   text        not null unique,
  invited_by   uuid,
  expires_at   timestamptz not null,
  accepted_at  timestamptz,
  accepted_by  uuid,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists tenant_invitations_tenant_idx on public.tenant_invitations (tenant_id, created_at desc);
create unique index if not exists tenant_invitations_open_idx
  on public.tenant_invitations (tenant_id, lower(email))
  where accepted_at is null and revoked_at is null;

alter table public.tenant_invitations enable row level security;
revoke all on public.tenant_invitations from anon, authenticated;
grant all on public.tenant_invitations to service_role;
-- Read and written by the server only, which checks the caller is the owner.

-- ---------------------------------------------------------------------------
-- 4. Audit trail: who, by name, and whether it was the platform
-- ---------------------------------------------------------------------------
alter table public.audit_events drop constraint if exists audit_events_actor_type_check;
alter table public.audit_events add constraint audit_events_actor_type_check
  check (actor_type in ('user', 'customer', 'agent', 'webhook', 'system', 'platform_admin'));

alter table public.audit_events add column if not exists actor_label text;
comment on column public.audit_events.actor_label is
  'The actor as a person would recognise them (an email address), kept so the log still reads after someone is removed.';

-- ---------------------------------------------------------------------------
-- 5. Faults on the platform side, for the platform admin
-- ---------------------------------------------------------------------------
create table if not exists public.platform_alerts (
  id          bigserial   primary key,
  kind        text        not null,
  tenant_id   uuid        references public.tenants(id) on delete cascade,
  summary     text        not null,
  detail      text,
  -- The same fault for the same business is one open alert, not one per attempt.
  dedupe_key  text        not null,
  seen_count  integer     not null default 1,
  created_at  timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz
);

create unique index if not exists platform_alerts_open_idx
  on public.platform_alerts (dedupe_key) where resolved_at is null;
create index if not exists platform_alerts_created_idx on public.platform_alerts (created_at desc);

alter table public.platform_alerts enable row level security;
revoke all on public.platform_alerts from anon, authenticated;
grant all on public.platform_alerts to service_role;
grant usage, select on sequence public.platform_alerts_id_seq to service_role;

-- ---------------------------------------------------------------------------
-- 6. A platform admin may verify a payment while working in a business
-- ---------------------------------------------------------------------------
create or replace function public.enforce_payment_verification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_is_end_user boolean := coalesce(auth.role(), '') = 'authenticated';
  v_becoming_verified boolean;
begin
  -- A verified payment is a statement that this amount was received. Changing
  -- the figure afterwards would silently rewrite that statement, so it has to
  -- be un-verified first (which clears the attestation below).
  if tg_op = 'UPDATE' and old.verification_status = 'verified' and new.verification_status = 'verified' then
    if new.amount is distinct from old.amount or new.currency is distinct from old.currency then
      raise exception 'The amount of a verified payment cannot be changed; reject or un-verify it first'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.verification_status = 'verified' then
    if new.verified_by is null then
      raise exception
        'payments.verification_status may only be set to verified together with verified_by (a staff user id)'
        using errcode = 'check_violation';
    end if;

    if tg_op = 'INSERT' then
      v_becoming_verified := true;
    else
      v_becoming_verified :=
        old.verification_status is distinct from 'verified'
        or new.verified_by is distinct from old.verified_by;
    end if;

    -- An end user can only attest for themselves, never in a colleague's name.
    if v_is_end_user and v_becoming_verified and new.verified_by is distinct from auth.uid() then
      raise exception 'payments.verified_by must be the user performing the verification'
        using errcode = 'insufficient_privilege';
    end if;

    if not exists (
      select 1 from public.tenant_users tu
      where tu.user_id = new.verified_by
        and tu.tenant_id = new.tenant_id
        and tu.role in ('owner','admin','member')
    ) and not exists (
      select 1 from public.platform_admins pa where pa.user_id = new.verified_by
    ) then
      raise exception
        'payments.verified_by (%) is not a staff member of tenant %', new.verified_by, new.tenant_id
        using errcode = 'check_violation';
    end if;

    if new.verified_at is null then
      new.verified_at := now();
    end if;
  else
    -- Leaving the verified state clears the attestation.
    new.verified_by := null;
    new.verified_at := null;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. The role table, enforced by the database too
-- ---------------------------------------------------------------------------
-- Staff answer customers and handle orders, bookings and payments. The
-- catalogue, the opening hours and the agent's settings belong to managers
-- and the owner. The server already refuses; this makes the database refuse
-- as well, so calling it directly gets no further.
do $$
declare
  t text;
begin
  foreach t in array array['agent_settings', 'business_hours', 'products', 'services'] loop
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.is_tenant_admin(tenant_id))',
      t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.is_tenant_admin(tenant_id)) with check (public.is_tenant_admin(tenant_id))',
      t || '_update', t);
  end loop;
end;
$$;

-- Adding, changing and removing staff is the owner's alone.
drop policy if exists tenant_users_write on public.tenant_users;
create policy tenant_users_write on public.tenant_users
  for all to authenticated
  using (public.current_tenant_role(tenant_id) = 'owner')
  with check (public.current_tenant_role(tenant_id) = 'owner');
