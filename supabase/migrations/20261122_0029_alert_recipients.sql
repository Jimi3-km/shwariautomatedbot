-- ============================================================================
-- 0029  Alerts to the owner's phone
-- ============================================================================
-- Every notification already appears in the dashboard bell. These tables let
-- the owner choose WhatsApp numbers that receive the same news, which kinds of
-- news, and whether the Telegram chats linked to Shwari get it too.
-- ============================================================================

create table if not exists public.notification_recipients (
  id           uuid        primary key default gen_random_uuid(),
  tenant_id    uuid        not null references public.tenants(id) on delete cascade,
  channel      text        not null default 'whatsapp' check (channel in ('whatsapp')),
  -- Digits only, with the country code: the form WhatsApp addresses a number by.
  address      text        not null,
  label        text,
  active       boolean     not null default true,
  last_sent_at timestamptz,
  last_error   text,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  constraint notification_recipients_unique unique (tenant_id, channel, address)
);

create index if not exists notification_recipients_tenant_idx
  on public.notification_recipients (tenant_id);

-- Read and written by the server only, which checks the caller's role.
alter table public.notification_recipients enable row level security;
revoke all on public.notification_recipients from anon, authenticated;
grant all on public.notification_recipients to service_role;

alter table public.tenants
  add column if not exists alert_kinds    text[]  not null default array['payment_claim', 'new_order', 'needs_human'],
  add column if not exists alert_telegram boolean not null default true;

comment on column public.tenants.alert_kinds is
  'Which kinds of notification are also sent to the owner''s phone.';
comment on column public.tenants.alert_telegram is
  'Also send alerts to the Telegram chats linked to Shwari.';

-- public.tenants grants SELECT column by column; a new column is unreadable
-- by signed-in users until it is granted (see 0028).
grant select (alert_kinds, alert_telegram) on public.tenants to authenticated;
