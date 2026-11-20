-- ============================================================================
-- 0021  Notifications and the receipt log
--
--   notifications   what the team should know about without having to go
--                   looking: a new order, a payment to verify, a payment
--                   verified, a conversation that needs a person.
--   receipts        every receipt issued, kept as it was sent.
--
-- Additive and idempotent. The application tolerates this migration not being
-- applied yet: it simply notifies and logs nothing.
-- ============================================================================

create table if not exists public.notifications (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null references public.tenants(id) on delete cascade,
  kind        text        not null
                check (kind in ('new_order', 'payment_claim', 'payment_verified', 'needs_human')),
  title       text        not null check (char_length(title) between 1 and 200),
  body        text        not null default '',
  -- Where in the dashboard this leads, e.g. /orders or /inbox/<conversation>.
  link        text,
  -- The row it is about, so the same event is not announced twice.
  ref_id      text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_tenant_idx
  on public.notifications (tenant_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications (tenant_id) where read_at is null;
create unique index if not exists notifications_once_key
  on public.notifications (tenant_id, kind, ref_id) where ref_id is not null;

alter table public.notifications enable row level security;

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()));

-- Written and marked read through the API (service role), which checks the caller.
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant all on public.notifications to service_role;

-- ---------------------------------------------------------------------------

create table if not exists public.receipts (
  id              uuid        primary key default gen_random_uuid(),
  tenant_id       uuid        not null references public.tenants(id) on delete cascade,
  payment_id      uuid        references public.payments(id) on delete set null,
  order_id        uuid        references public.orders(id) on delete set null,
  lead_id         bigint      references public.leads(id) on delete set null,
  order_ref       text,
  amount          numeric,
  currency        text,
  -- Exactly what the customer was sent.
  text_body       text        not null default '',
  html_body       text,
  sent_in_chat    boolean     not null default false,
  sent_by_email   boolean     not null default false,
  recipient_email text,
  issued_by       uuid,
  created_at      timestamptz not null default now()
);

create index if not exists receipts_tenant_idx on public.receipts (tenant_id, created_at desc);
create index if not exists receipts_payment_idx on public.receipts (payment_id);

alter table public.receipts enable row level security;

drop policy if exists receipts_select on public.receipts;
create policy receipts_select on public.receipts
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()));

revoke all on public.receipts from anon, authenticated;
grant select on public.receipts to authenticated;
grant all on public.receipts to service_role;
