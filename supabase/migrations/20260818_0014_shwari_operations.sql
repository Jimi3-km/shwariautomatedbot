-- ============================================================================
-- What the AI workforce actually does: appointments, tickets and follow-ups.
-- ----------------------------------------------------------------------------
-- Additive only. Three tables, each the record of one kind of work an agent
-- can do on the business's behalf, and each readable in the dashboard so a
-- person can see and correct anything an agent did.
--
-- Tenancy and grants follow the pattern in 0001/0003 exactly: RLS on, policies
-- derived from auth.uid() through the existing SECURITY DEFINER helpers, and
-- explicit grants because RLS can only narrow privileges that already exist.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. appointments
-- ---------------------------------------------------------------------------
create table if not exists public.appointments (
  id            uuid        primary key default gen_random_uuid(),
  tenant_id     uuid        not null references public.tenants(id) on delete cascade,

  -- Who it is for. lead_id when we know them; the channel identity always.
  lead_id       bigint      references public.leads(id) on delete set null,
  customer_id   text,
  customer_name text,
  channel_type  text,

  -- What it is for. The service row when it matches one, and always the name
  -- as it was booked, so renaming a service does not rewrite history.
  service_id    uuid        references public.services(id) on delete set null,
  service_name  text        not null,

  starts_at     timestamptz not null,
  duration_minutes integer  not null default 30,

  status        text        not null default 'scheduled'
                  check (status in ('scheduled', 'completed', 'cancelled', 'no_show')),
  notes         text,

  -- Which agent booked it, or NULL when a person did. This is what makes an
  -- agent's work reviewable rather than indistinguishable from staff work.
  booked_by_agent text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists appointments_tenant_start_idx
  on public.appointments (tenant_id, starts_at);
create index if not exists appointments_tenant_status_idx
  on public.appointments (tenant_id, status, starts_at);

comment on table public.appointments is
  'Bookings. service_name is stored alongside service_id so a renamed or removed service does not silently rewrite what a customer booked.';

-- ---------------------------------------------------------------------------
-- 2. support_tickets
-- ---------------------------------------------------------------------------
create table if not exists public.support_tickets (
  id              uuid        primary key default gen_random_uuid(),
  tenant_id       uuid        not null references public.tenants(id) on delete cascade,

  lead_id         bigint      references public.leads(id) on delete set null,
  conversation_id uuid        references public.conversations(id) on delete set null,
  customer_id     text,
  customer_name   text,

  subject         text        not null,
  body            text        not null default '',
  priority        text        not null default 'normal'
                    check (priority in ('low', 'normal', 'high', 'urgent')),
  status          text        not null default 'open'
                    check (status in ('open', 'in_progress', 'waiting', 'resolved', 'closed')),

  assigned_to     uuid        references auth.users(id) on delete set null,
  opened_by_agent text,
  resolution      text,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists support_tickets_tenant_status_idx
  on public.support_tickets (tenant_id, status, created_at desc);

comment on table public.support_tickets is
  'Customer issues that need a person, or that an agent is tracking to resolution. An escalation always leaves one of these behind so nothing is handed over into silence.';

-- ---------------------------------------------------------------------------
-- 3. follow_ups
-- ---------------------------------------------------------------------------
-- An agent deciding to chase a silent lead is a promise to do something later.
-- Writing that promise down is what makes it keepable, auditable and
-- cancellable — and it is why an agent never "sends a follow-up" directly.
create table if not exists public.follow_ups (
  id             uuid        primary key default gen_random_uuid(),
  tenant_id      uuid        not null references public.tenants(id) on delete cascade,

  lead_id        bigint      references public.leads(id) on delete cascade,
  conversation_id uuid       references public.conversations(id) on delete set null,
  customer_id    text        not null,
  channel_type   text        not null,

  due_at         timestamptz not null,
  message        text        not null,
  reason         text,

  status         text        not null default 'pending'
                   check (status in ('pending', 'sent', 'cancelled', 'failed')),
  sent_at        timestamptz,
  failure_reason text,

  created_by_agent text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists follow_ups_due_idx
  on public.follow_ups (status, due_at) where status = 'pending';
create index if not exists follow_ups_tenant_idx
  on public.follow_ups (tenant_id, created_at desc);

comment on table public.follow_ups is
  'Scheduled outbound nudges. Pending rows are what a scheduled worker sends; an agent writes the promise, it does not send the message itself.';

-- ---------------------------------------------------------------------------
-- 4. Row level security
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['appointments', 'support_tickets', 'follow_ups']
  loop
    execute format('alter table public.%I enable row level security', t);

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

    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all privileges on public.%I to service_role', t);
  end loop;
end $$;
