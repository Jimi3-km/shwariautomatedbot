-- ============================================================================
-- 0030  Alerts on Telegram through the owner's own bot, every alert on by
--       default, invitations by WhatsApp, and a record of every email
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Telegram as an alert destination
-- ---------------------------------------------------------------------------
alter table public.notification_recipients drop constraint if exists notification_recipients_channel_check;
alter table public.notification_recipients add constraint notification_recipients_channel_check
  check (channel in ('whatsapp', 'telegram'));

-- The bot the owner sets up for alerts. One per business. The token is stored
-- encrypted and is only ever read by the server.
create table if not exists public.notification_bots (
  tenant_id            uuid        primary key references public.tenants(id) on delete cascade,
  bot_token_encrypted  text        not null,
  bot_username         text,
  bot_name             text,
  -- A short-lived code a person sends to the bot to add their chat.
  link_code            text,
  link_expires_at      timestamptz,
  -- The last Telegram update already read, so none is processed twice.
  last_update_id       bigint,
  created_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

alter table public.notification_bots enable row level security;
revoke all on public.notification_bots from anon, authenticated;
grant all on public.notification_bots to service_role;

-- ---------------------------------------------------------------------------
-- 2. Every kind of alert is on unless the owner turns it off
-- ---------------------------------------------------------------------------
alter table public.tenants alter column alert_kinds set default array[
  'payment_claim', 'new_order', 'needs_human', 'payment_verified',
  'posts_to_approve', 'post_failed', 'post_published'
];
update public.tenants set alert_kinds = array[
  'payment_claim', 'new_order', 'needs_human', 'payment_verified',
  'posts_to_approve', 'post_failed', 'post_published'
];

-- ---------------------------------------------------------------------------
-- 3. An invitation can also go to a WhatsApp number
-- ---------------------------------------------------------------------------
alter table public.tenant_invitations add column if not exists phone text;

-- ---------------------------------------------------------------------------
-- 4. A record of every email the platform tries to send
-- ---------------------------------------------------------------------------
-- "Did the receipt go?" had no answer anywhere: a failure was a line in the
-- server log. Each attempt is now kept with what the email service said.
create table if not exists public.email_log (
  id          bigserial   primary key,
  tenant_id   uuid        references public.tenants(id) on delete cascade,
  kind        text        not null,
  recipient   text        not null,
  subject     text,
  ok          boolean     not null,
  -- The email service's id for the message when accepted, for tracing it.
  message_id  text,
  error       text,
  created_at  timestamptz not null default now()
);

create index if not exists email_log_created_idx on public.email_log (created_at desc);
create index if not exists email_log_tenant_idx on public.email_log (tenant_id, created_at desc);

alter table public.email_log enable row level security;
revoke all on public.email_log from anon, authenticated;
grant all on public.email_log to service_role;
grant usage, select on sequence public.email_log_id_seq to service_role;
