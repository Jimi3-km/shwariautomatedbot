-- ============================================================================
-- Migration: 20260926_0017_agent_turn_labels.sql
-- Agent QA & Evaluation: Turn Labels, Tags, and Quality Notes
-- ============================================================================

create table if not exists public.agent_turn_labels (
  id              uuid         primary key default gen_random_uuid(),
  turn_event_id   bigint       not null references public.audit_events(id) on delete cascade,
  tenant_id       uuid         not null references public.tenants(id) on delete cascade,
  labeled_by      uuid         references auth.users(id) on delete set null,
  label           text         not null check (label in ('ok', 'needs_improvement', 'bug')),
  tags            text[]       not null default '{}',
  notes           text         not null default '',
  created_at      timestamptz  not null default now(),
  updated_at      timestamptz  not null default now(),
  constraint agent_turn_labels_turn_event_uniq unique (turn_event_id)
);

-- Indices for fast tenant-scoped and label-based QA queries
create index if not exists agent_turn_labels_tenant_created_idx
  on public.agent_turn_labels (tenant_id, created_at desc);

create index if not exists agent_turn_labels_tenant_label_idx
  on public.agent_turn_labels (tenant_id, label);

create index if not exists agent_turn_labels_turn_event_idx
  on public.agent_turn_labels (turn_event_id);

-- Enable Row Level Security
alter table public.agent_turn_labels enable row level security;

-- RLS: Authenticated tenant users can view turn labels for their tenant
drop policy if exists agent_turn_labels_select on public.agent_turn_labels;
create policy agent_turn_labels_select on public.agent_turn_labels
  for select to authenticated
  using (
    tenant_id in (
      select tenant_id from public.tenant_users where user_id = auth.uid()
    )
  );

-- RLS: Tenant owners and admins can insert or update turn labels
drop policy if exists agent_turn_labels_insert on public.agent_turn_labels;
create policy agent_turn_labels_insert on public.agent_turn_labels
  for insert to authenticated
  with check (
    tenant_id in (
      select tenant_id from public.tenant_users
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

drop policy if exists agent_turn_labels_update on public.agent_turn_labels;
create policy agent_turn_labels_update on public.agent_turn_labels
  for update to authenticated
  using (
    tenant_id in (
      select tenant_id from public.tenant_users
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  )
  with check (
    tenant_id in (
      select tenant_id from public.tenant_users
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

-- Grants
grant all on public.agent_turn_labels to authenticated, service_role;
