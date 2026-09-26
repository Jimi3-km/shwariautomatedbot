-- ============================================================================
-- Security Hardening: RLS Defenses, Audit Trails & Idempotency Tables
-- ============================================================================

-- 1. Secure Tenant Context for Background / Tool Operations
create or replace function public.set_app_tenant_context(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if p_tenant_id is null then
    raise exception 'Tenant ID cannot be null';
  end if;
  perform set_config('app.current_tenant_id', p_tenant_id::text, true);
end;
$$;

create or replace function public.get_app_tenant_context()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.current_tenant_id', true), '')::uuid;
$$;

revoke all on function public.set_app_tenant_context(uuid) from public, anon;
revoke all on function public.get_app_tenant_context() from public, anon;
grant execute on function public.set_app_tenant_context(uuid) to service_role;
grant execute on function public.get_app_tenant_context() to authenticated, service_role;

-- 2. Immutable Enterprise Audit Trail
create table if not exists public.audit_events (
  id              bigserial    primary key,
  tenant_id       uuid         not null references public.tenants(id) on delete cascade,
  actor_id        text         not null, -- userId, customerId, or 'system'
  actor_type      text         not null check (actor_type in ('user', 'customer', 'agent', 'webhook', 'system')),
  agent_role      text,                  -- e.g. 'manager', 'sales', null if direct user
  action          text         not null, -- e.g. 'order.create', 'service.delete', 'settings.update'
  resource_type   text         not null, -- 'orders', 'services', 'tenants', etc.
  resource_id     text,
  details         jsonb        not null default '{}'::jsonb,
  ip_address      text,
  user_agent      text,
  created_at      timestamptz  not null default now()
);

create index if not exists audit_events_tenant_created_idx
  on public.audit_events (tenant_id, created_at desc);

create index if not exists audit_events_resource_idx
  on public.audit_events (tenant_id, resource_type, resource_id);

-- RLS: Audit logs are append-only. Users may read their tenant logs, but never update or delete.
alter table public.audit_events enable row level security;

drop policy if exists audit_events_select on public.audit_events;
create policy audit_events_select on public.audit_events
  for select to authenticated
  using (
    tenant_id in (select public.current_tenant_ids())
    or tenant_id = public.get_app_tenant_context()
  );

revoke all on public.audit_events from anon, authenticated;
grant select on public.audit_events to authenticated;
grant all on public.audit_events to service_role;
grant usage, select on sequence public.audit_events_id_seq to service_role;

-- 3. Distributed Idempotency Tracking Table
create table if not exists public.idempotency_keys (
  key             text         not null,
  tenant_id       uuid         not null references public.tenants(id) on delete cascade,
  action          text         not null,
  response_hash   text,
  response_body   jsonb,
  status          text         not null default 'processing' check (status in ('processing', 'completed', 'failed')),
  created_at      timestamptz  not null default now(),
  expires_at      timestamptz  not null default (now() + interval '10 minutes'),
  primary key (tenant_id, key)
);

create index if not exists idempotency_keys_expires_idx on public.idempotency_keys (expires_at);

alter table public.idempotency_keys enable row level security;
revoke all on public.idempotency_keys from anon, authenticated;
grant all on public.idempotency_keys to service_role;
