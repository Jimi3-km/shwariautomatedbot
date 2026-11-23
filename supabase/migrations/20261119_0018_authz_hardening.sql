-- ============================================================================
-- Migration: 20261119_0018_authz_hardening.sql
-- Authorization hardening
-- ----------------------------------------------------------------------------
-- Closes holes that were reachable by calling PostgREST directly with the
-- public anon key and a valid session, i.e. without going through the API:
--
--   1. tenant_users   an admin could make themselves owner, demote or remove
--                     the owner, or repoint a membership row at another user.
--   2. agent_turn_labels  a label could be attached to another tenant's turn.
--   3. payments       a member could attribute a verification to someone else
--                     and change the amount of a verified payment.
--   4. agents / business_facts  members could edit what the API reserves for
--                     admins (agent instructions, the business's stated facts).
--   5. audit_events   the select policy trusted a session setting.
--
-- Idempotent: every statement can be re-run. Safe on the live database -- it
-- changes rules, not data, except for one clean-up of forged labels (2).
--
-- "End user" below means a request carrying a user JWT (auth.role() =
-- 'authenticated'). The service role and direct SQL are the server and the
-- operator; they are constrained only by the invariants, not by the role rules.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. tenant_users
-- ---------------------------------------------------------------------------
create or replace function public.enforce_tenant_user_rules()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_is_end_user  boolean := coalesce(auth.role(), '') = 'authenticated';
  v_caller       uuid    := auth.uid();
  v_caller_role  text;
  v_tenant       uuid;
  v_other_owners integer;
begin
  -- OLD is not available on INSERT and NEW is not available on DELETE, so the
  -- tenant is picked per operation rather than with a coalesce over both.
  if tg_op = 'INSERT' then
    v_tenant := new.tenant_id;
  else
    v_tenant := old.tenant_id;
  end if;

  -- Invariants that hold for every caller ------------------------------------
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id or new.tenant_id is distinct from old.tenant_id then
      raise exception 'tenant_users.user_id and tenant_id cannot be changed; remove the row and add a new one'
        using errcode = 'check_violation';
    end if;
  end if;

  -- Role rules for end users --------------------------------------------------
  if v_is_end_user then
    select tu.role into v_caller_role
    from public.tenant_users tu
    where tu.tenant_id = v_tenant and tu.user_id = v_caller;

    if tg_op = 'INSERT' then
      if new.user_id = v_caller then
        raise exception 'You cannot add yourself to a workspace' using errcode = 'insufficient_privilege';
      end if;
      if new.role = 'owner' and v_caller_role is distinct from 'owner' then
        raise exception 'Only an owner can grant the owner role' using errcode = 'insufficient_privilege';
      end if;

    elsif tg_op = 'UPDATE' then
      if new.role is distinct from old.role then
        if old.user_id = v_caller then
          raise exception 'You cannot change your own role' using errcode = 'insufficient_privilege';
        end if;
        if (new.role = 'owner' or old.role = 'owner') and v_caller_role is distinct from 'owner' then
          raise exception 'Only an owner can grant or remove the owner role'
            using errcode = 'insufficient_privilege';
        end if;
      end if;

    elsif tg_op = 'DELETE' then
      if old.role = 'owner' and old.user_id is distinct from v_caller
         and v_caller_role is distinct from 'owner' then
        raise exception 'Only an owner can remove an owner' using errcode = 'insufficient_privilege';
      end if;
    end if;
  end if;

  -- A workspace keeps at least one owner --------------------------------------
  if (tg_op = 'UPDATE' and old.role = 'owner' and new.role <> 'owner')
     or (tg_op = 'DELETE' and old.role = 'owner') then
    -- Lock the tenant so two concurrent demotions cannot both see "one other
    -- owner". When the tenant row is already gone this is the cascade of a
    -- tenant delete, and there is nothing left to protect.
    perform 1 from public.tenants t where t.id = old.tenant_id for update;
    if found then
      select count(*) into v_other_owners
      from public.tenant_users tu
      where tu.tenant_id = old.tenant_id and tu.role = 'owner' and tu.id <> old.id;
      if v_other_owners = 0 then
        raise exception 'A workspace must keep at least one owner' using errcode = 'check_violation';
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_tenant_user_rules() from public, anon, authenticated;

drop trigger if exists tenant_users_rules on public.tenant_users;
create trigger tenant_users_rules
  before insert or update or delete on public.tenant_users
  for each row execute function public.enforce_tenant_user_rules();

comment on function public.enforce_tenant_user_rules() is
  'Membership rules: immutable user_id/tenant_id, no self role change, only owners grant or remove owner, at least one owner per tenant.';

-- ---------------------------------------------------------------------------
-- 2. agent_turn_labels
-- ---------------------------------------------------------------------------
-- A label is only meaningful on a turn of the same tenant. The old policy
-- checked the label's tenant_id but not that the turn belonged to it, and
-- turn_event_id is unique, so a label written under tenant A could occupy --
-- and be displayed on -- tenant B's turn.

-- Remove any label that does not match its turn's tenant.
delete from public.agent_turn_labels l
where not exists (
  select 1 from public.audit_events e
  where e.id = l.turn_event_id and e.tenant_id = l.tenant_id
);

create or replace function public.enforce_turn_label_tenant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if not exists (
    select 1 from public.audit_events e
    where e.id = new.turn_event_id and e.tenant_id = new.tenant_id
  ) then
    raise exception 'agent_turn_labels: turn % does not belong to tenant %', new.turn_event_id, new.tenant_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_turn_label_tenant() from public, anon, authenticated;

drop trigger if exists agent_turn_labels_tenant_guard on public.agent_turn_labels;
create trigger agent_turn_labels_tenant_guard
  before insert or update on public.agent_turn_labels
  for each row execute function public.enforce_turn_label_tenant();

drop policy if exists agent_turn_labels_select on public.agent_turn_labels;
create policy agent_turn_labels_select on public.agent_turn_labels
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()));

drop policy if exists agent_turn_labels_insert on public.agent_turn_labels;
create policy agent_turn_labels_insert on public.agent_turn_labels
  for insert to authenticated
  with check (
    public.is_tenant_admin(tenant_id)
    and exists (
      select 1 from public.audit_events e
      where e.id = turn_event_id and e.tenant_id = agent_turn_labels.tenant_id
    )
  );

drop policy if exists agent_turn_labels_update on public.agent_turn_labels;
create policy agent_turn_labels_update on public.agent_turn_labels
  for update to authenticated
  using (public.is_tenant_admin(tenant_id))
  with check (
    public.is_tenant_admin(tenant_id)
    and exists (
      select 1 from public.audit_events e
      where e.id = turn_event_id and e.tenant_id = agent_turn_labels.tenant_id
    )
  );

-- 0017 granted ALL (including TRUNCATE, TRIGGER, REFERENCES) to authenticated.
revoke all on public.agent_turn_labels from anon, authenticated;
grant select, insert, update on public.agent_turn_labels to authenticated;
grant all on public.agent_turn_labels to service_role;

-- ---------------------------------------------------------------------------
-- 3. payments
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

drop trigger if exists payments_verification_guard on public.payments;
create trigger payments_verification_guard
  before insert or update on public.payments
  for each row execute function public.enforce_payment_verification();

comment on function public.enforce_payment_verification() is
  'A payment is verified only with a real staff verified_by; an end user may only attest as themselves; a verified amount is immutable.';

-- ---------------------------------------------------------------------------
-- 4. agents and business_facts: writes are admin-only, as in the API
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['agents', 'business_facts']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format($f$
      create policy %I on public.%I
        for insert to authenticated
        with check (public.is_tenant_admin(tenant_id))
    $f$, t || '_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format($f$
      create policy %I on public.%I
        for update to authenticated
        using (public.is_tenant_admin(tenant_id))
        with check (public.is_tenant_admin(tenant_id))
    $f$, t || '_update', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. audit_events: membership only
-- ---------------------------------------------------------------------------
-- The policy also admitted `tenant_id = get_app_tenant_context()`, a value read
-- from a session setting. Nothing in the application sets it, so it granted
-- nothing useful and was one misconfiguration away from granting too much.
drop policy if exists audit_events_select on public.audit_events;
create policy audit_events_select on public.audit_events
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()));

drop function if exists public.get_app_tenant_context();
drop function if exists public.set_app_tenant_context(uuid);

-- ---------------------------------------------------------------------------
-- 6. Dead view that exposed bot tokens
-- ---------------------------------------------------------------------------
-- followup_candidates joined leads to their channel's bot_token for the old
-- n8n follow-up workflow. Nothing reads it any more.
drop view if exists public.followup_candidates;
