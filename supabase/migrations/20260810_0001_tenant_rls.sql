-- ============================================================================
-- Multi-tenant Row Level Security
-- ----------------------------------------------------------------------------
-- Context: RLS was already ENABLED on all 11 tenant tables but ZERO policies
-- existed, so every table denied all access to the anon/authenticated roles.
-- Only the service_role key (used by n8n) could read or write anything.
--
-- This migration adds the tenant-scoping policies. Tenancy is derived from
-- auth.uid() -> tenant_users -> tenant_id. A client can never supply its own
-- tenant_id: the WITH CHECK clauses reject any row whose tenant_id is not one
-- the authenticated user actually belongs to.
--
-- Reversible: see the companion .down.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tenant resolution helpers
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so that reading tenant_users from inside a tenant_users
-- policy does not recurse. The definer (table owner) bypasses RLS.

create or replace function public.current_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select tu.tenant_id from public.tenant_users tu where tu.user_id = auth.uid()
$$;

comment on function public.current_tenant_ids() is
  'Tenant ids the currently authenticated user belongs to. Never trust a client-supplied tenant_id; use this.';

create or replace function public.current_tenant_role(p_tenant uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select tu.role
  from public.tenant_users tu
  where tu.user_id = auth.uid() and tu.tenant_id = p_tenant
  limit 1
$$;

-- Can this user write (i.e. is not a read-only viewer) in this tenant?
create or replace function public.can_write_tenant(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(public.current_tenant_role(p_tenant) in ('owner','admin','member'), false)
$$;

-- Owner/admin only: billing-grade and destructive operations.
create or replace function public.is_tenant_admin(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(public.current_tenant_role(p_tenant) in ('owner','admin'), false)
$$;

revoke all on function public.current_tenant_ids()      from public;
revoke all on function public.current_tenant_role(uuid) from public;
revoke all on function public.can_write_tenant(uuid)    from public;
revoke all on function public.is_tenant_admin(uuid)     from public;
grant execute on function public.current_tenant_ids()      to authenticated;
grant execute on function public.current_tenant_role(uuid) to authenticated;
grant execute on function public.can_write_tenant(uuid)    to authenticated;
grant execute on function public.is_tenant_admin(uuid)     to authenticated;

-- ---------------------------------------------------------------------------
-- 2. tenants
-- ---------------------------------------------------------------------------
drop policy if exists tenants_select on public.tenants;
create policy tenants_select on public.tenants
  for select to authenticated
  using (id in (select public.current_tenant_ids()));

-- Only owners/admins may edit business settings.
drop policy if exists tenants_update on public.tenants;
create policy tenants_update on public.tenants
  for update to authenticated
  using (public.is_tenant_admin(id))
  with check (public.is_tenant_admin(id));

-- No INSERT/DELETE policy: tenant creation happens on signup through the
-- server (service_role), never directly from the browser.

-- ---------------------------------------------------------------------------
-- 3. tenant_users
-- ---------------------------------------------------------------------------
drop policy if exists tenant_users_select on public.tenant_users;
create policy tenant_users_select on public.tenant_users
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()));

drop policy if exists tenant_users_write on public.tenant_users;
create policy tenant_users_write on public.tenant_users
  for all to authenticated
  using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));

-- ---------------------------------------------------------------------------
-- 4. Generic tenant-scoped tables
-- ---------------------------------------------------------------------------
-- Read for any member of the tenant; write for non-viewer members.
-- WITH CHECK is what stops a client from writing a row into another tenant.

do $$
declare
  t text;
begin
  foreach t in array array[
    'agent_settings',
    'products',
    'leads',
    'conversations',
    'conversation_messages',
    'conversation_logs',
    'orders',
    'payments'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format($f$
      create policy %I on public.%I
        for select to authenticated
        using (tenant_id in (select public.current_tenant_ids()))
    $f$, t || '_select', t);

    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format($f$
      create policy %I on public.%I
        for insert to authenticated
        with check (public.can_write_tenant(tenant_id))
    $f$, t || '_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format($f$
      create policy %I on public.%I
        for update to authenticated
        using (public.can_write_tenant(tenant_id))
        with check (public.can_write_tenant(tenant_id))
    $f$, t || '_update', t);

    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format($f$
      create policy %I on public.%I
        for delete to authenticated
        using (public.is_tenant_admin(tenant_id))
    $f$, t || '_delete', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. channels -- secrets must never reach the browser
-- ---------------------------------------------------------------------------
-- RLS is row-level, so it cannot hide a column. Column-level privileges can.
-- After this, `select *` on channels fails for authenticated clients rather
-- than silently returning bot tokens; callers must name safe columns, or use
-- the channels_safe view below.

drop policy if exists channels_select on public.channels;
create policy channels_select on public.channels
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()));

drop policy if exists channels_write on public.channels;
create policy channels_write on public.channels
  for all to authenticated
  using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));

revoke select (secret_token, bot_token, credentials_ref) on public.channels from anon, authenticated;
revoke update (secret_token, bot_token, credentials_ref) on public.channels from anon, authenticated;
revoke insert (secret_token, bot_token, credentials_ref) on public.channels from anon, authenticated;

create or replace view public.channels_safe
with (security_invoker = true) as
  select id, tenant_id, channel_type, channel_account_id, display_name, status, created_at,
         (secret_token   is not null) as has_secret_token,
         (bot_token      is not null) as has_bot_token,
         (credentials_ref is not null) as has_credentials_ref
  from public.channels;

comment on view public.channels_safe is
  'Channel listing with secrets reduced to booleans. security_invoker keeps the caller''s RLS in force.';

grant select on public.channels_safe to authenticated;

-- Same treatment for the tenant API key digest.
revoke select (api_key_hash) on public.tenants from anon, authenticated;
revoke update (api_key_hash) on public.tenants from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. The AI may never verify a payment
-- ---------------------------------------------------------------------------
-- RLS does not constrain service_role, which is the key n8n uses. So the
-- "only a human verifies payments" rule is enforced in the database itself:
-- a row can only reach verification_status='verified' when it also carries a
-- verified_by user id that belongs to that tenant's staff.

create or replace function public.enforce_payment_verification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if new.verification_status = 'verified' then
    if new.verified_by is null then
      raise exception
        'payments.verification_status may only be set to verified together with verified_by (a staff user id)'
        using errcode = 'check_violation';
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
  'Blocks any path -- including service_role/n8n and the LLM -- from marking a payment verified without a real staff user.';
