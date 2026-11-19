-- ============================================================================
-- Baseline schema
-- ----------------------------------------------------------------------------
-- The eleven core tables were created by hand in the live project before this
-- repository had migrations, so every later migration assumed they existed and
-- a fresh database could not be built from the repo at all.
--
-- This file reconstructs them from the live schema (columns, defaults,
-- constraints, indexes) as it stands today. Everything is `if not exists`:
--
--   * on a NEW database it creates the tables, and the migrations that follow
--     (which are all written as `add column if not exists` / `create or
--     replace`) apply cleanly on top;
--   * on the LIVE database it is a no-op.
--
-- Columns that later migrations add (inbox columns, lead notes, onboarding
-- columns, bot_token ...) are included here already. That is deliberate: those
-- migrations then find the column present and skip it.
--
-- Row Level Security is switched on here with no policies, which denies
-- everything to anon/authenticated until 0001 adds the tenant policies.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- tenants
-- ---------------------------------------------------------------------------
create table if not exists public.tenants (
  id                      uuid primary key default gen_random_uuid(),
  slug                    text not null,
  business_name           text not null,
  business_description    text,
  agent_name              text not null default 'Assistant',
  address                 text,
  timezone                text not null default 'Africa/Nairobi',
  currency                character(3) not null default 'KES',
  business_hours          jsonb not null default '{}'::jsonb,
  delivery_rules          jsonb not null default '{}'::jsonb,
  payment_details         jsonb not null default '{}'::jsonb,
  branding                jsonb not null default '{}'::jsonb,
  languages               text[] not null default array['en'::text],
  contact_info            jsonb not null default '{}'::jsonb,
  order_prefix            text not null default 'ORD',
  notification_channel    text,
  notification_target     text,
  api_key_hash            text,
  status                  text not null default 'active',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  business_category       text,
  onboarding_completed_at timestamptz,
  constraint tenants_slug_key unique (slug),
  constraint tenants_status_check
    check (status = any (array['active'::text, 'suspended'::text, 'trial'::text, 'cancelled'::text]))
);

create unique index if not exists tenants_api_key_hash_uidx
  on public.tenants (api_key_hash) where api_key_hash is not null;

-- ---------------------------------------------------------------------------
-- tenant_users
-- ---------------------------------------------------------------------------
create table if not exists public.tenant_users (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  user_id    uuid not null,
  role       text not null default 'member',
  created_at timestamptz not null default now(),
  constraint tenant_users_tenant_id_user_id_key unique (tenant_id, user_id),
  constraint tenant_users_role_check
    check (role = any (array['owner'::text, 'admin'::text, 'member'::text, 'viewer'::text]))
);

create index if not exists tenant_users_user_idx on public.tenant_users (user_id);

-- ---------------------------------------------------------------------------
-- channels
-- ---------------------------------------------------------------------------
create table if not exists public.channels (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  channel_type       text not null,
  channel_account_id text not null,
  secret_token       text,
  credentials_ref    text,
  display_name       text,
  status             text not null default 'active',
  created_at         timestamptz not null default now(),
  bot_token          text,
  constraint channels_channel_type_channel_account_id_key unique (channel_type, channel_account_id),
  constraint channels_channel_type_check
    check (channel_type = any (array['telegram'::text, 'whatsapp'::text, 'instagram'::text, 'webchat'::text])),
  constraint channels_status_check
    check (status = any (array['active'::text, 'disabled'::text]))
);

create unique index if not exists channels_secret_token_uidx
  on public.channels (secret_token) where secret_token is not null;
create index if not exists channels_tenant_idx on public.channels (tenant_id);

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------
create table if not exists public.products (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  sku             text,
  name            text not null,
  variant         jsonb not null default '{}'::jsonb,
  description     text,
  price           numeric(12,2),
  currency        character(3),
  payment_options jsonb not null default '{}'::jsonb,
  in_stock        boolean not null default true,
  created_at      timestamptz not null default now(),
  constraint products_tenant_id_sku_key unique (tenant_id, sku)
);

create index if not exists products_tenant_instock_idx
  on public.products (tenant_id) where in_stock;

-- ---------------------------------------------------------------------------
-- leads
-- ---------------------------------------------------------------------------
create table if not exists public.leads (
  id                bigint generated always as identity primary key,
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  channel_type      text not null default 'telegram',
  customer_id       text not null,
  phone             text,
  inbox_number      text,
  customer_name     text,
  email             text,
  intent            text,
  urgency           text,
  stage             text,
  last_message      text,
  last_contact      timestamptz,
  delivery_location text,
  payment_method    text,
  transaction_code  text,
  product_model     text,
  product_storage   text,
  product_condition text,
  product_price     numeric(12,2),
  upsell_items      text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  notes             text,
  assigned_to       uuid references auth.users(id) on delete set null
);

create unique index if not exists leads_tenant_customer_uidx
  on public.leads (tenant_id, channel_type, customer_id);
create index if not exists leads_tenant_contact_idx
  on public.leads (tenant_id, last_contact desc);
create index if not exists leads_tenant_stage_idx
  on public.leads (tenant_id, stage);
create index if not exists leads_tenant_assigned_idx
  on public.leads (tenant_id, assigned_to) where assigned_to is not null;

-- ---------------------------------------------------------------------------
-- conversations
-- ---------------------------------------------------------------------------
create table if not exists public.conversations (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  channel_id           uuid references public.channels(id) on delete set null,
  channel_type         text not null default 'telegram',
  customer_id          text not null,
  status               text not null default 'open',
  last_message_at      timestamptz,
  created_at           timestamptz not null default now(),
  ai_enabled           boolean not null default true,
  customer_name        text,
  unread_count         integer not null default 0,
  last_message_preview text,
  assigned_to          uuid references auth.users(id) on delete set null,
  lead_id              bigint references public.leads(id) on delete set null,
  constraint conversations_tenant_id_channel_type_customer_id_key
    unique (tenant_id, channel_type, customer_id),
  constraint conversations_status_check
    check (status = any (array['open'::text, 'closed'::text]))
);

create index if not exists conversations_tenant_recent_idx
  on public.conversations (tenant_id, last_message_at desc);
create index if not exists conversations_tenant_unread_idx
  on public.conversations (tenant_id) where unread_count > 0;

-- ---------------------------------------------------------------------------
-- conversation_messages
-- ---------------------------------------------------------------------------
create table if not exists public.conversation_messages (
  id              bigint generated always as identity primary key,
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender          text not null,
  body            text,
  extracted       jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  constraint conversation_messages_sender_check
    check (sender = any (array['customer'::text, 'agent'::text, 'staff'::text, 'system'::text]))
);

create index if not exists conv_msgs_tenant_convo_idx
  on public.conversation_messages (tenant_id, conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- conversation_logs (legacy flat log; kept because the analytics read it)
-- ---------------------------------------------------------------------------
create table if not exists public.conversation_logs (
  id                bigint generated always as identity primary key,
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  conversation_id   uuid references public.conversations(id) on delete set null,
  channel_type      text not null default 'telegram',
  customer_id       text,
  customer_phone    text,
  inbox_number      text,
  message           text,
  response          text,
  sender            text,
  intent            text,
  urgency           text,
  customer_name     text,
  email             text,
  delivery_location text,
  payment_method    text,
  transaction_code  text,
  product_model     text,
  product_storage   text,
  product_condition text,
  product_price     numeric(12,2),
  upsell_items      text,
  created_at        timestamptz not null default now()
);

create index if not exists conv_logs_tenant_idx
  on public.conversation_logs (tenant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------
create table if not exists public.orders (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  lead_id           bigint references public.leads(id) on delete set null,
  order_ref         text not null,
  items             jsonb not null default '[]'::jsonb,
  subtotal          numeric(12,2),
  total             numeric(12,2),
  currency          character(3),
  status            text not null default 'pending',
  delivery_location text,
  created_at        timestamptz not null default now(),
  payment_status    text not null default 'unpaid',
  customer_id       text,
  channel_type      text,
  updated_at        timestamptz not null default now(),
  constraint orders_tenant_id_order_ref_key unique (tenant_id, order_ref),
  constraint orders_status_check
    check (status = any (array['pending'::text, 'confirmed'::text, 'delivered'::text, 'cancelled'::text]))
);

create index if not exists orders_tenant_created_idx
  on public.orders (tenant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- payments
-- ---------------------------------------------------------------------------
create table if not exists public.payments (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  lead_id             bigint references public.leads(id) on delete set null,
  order_id            uuid references public.orders(id) on delete set null,
  transaction_code    text,
  customer_id         text,
  customer_phone      text,
  customer_email      text,
  amount              numeric(12,2),
  currency            character(3),
  product_model       text,
  product_storage     text,
  product_condition   text,
  upsell_items        text,
  delivery_location   text,
  payment_method      text,
  payment_status      text not null default 'pending',
  verification_status text not null default 'unverified',
  verified_by         uuid,
  verified_at         timestamptz,
  receipt_sent_at     timestamptz,
  created_at          timestamptz not null default now(),
  conversation_id     uuid references public.conversations(id) on delete set null,
  rejected_reason     text,
  constraint payments_verification_status_check
    check (verification_status = any (array['unverified'::text, 'verified'::text, 'rejected'::text]))
);

create index if not exists payments_tenant_created_idx
  on public.payments (tenant_id, created_at desc);
create index if not exists payments_tenant_verification_idx
  on public.payments (tenant_id, verification_status);

-- ---------------------------------------------------------------------------
-- agent_settings
-- ---------------------------------------------------------------------------
create table if not exists public.agent_settings (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  persona              text,
  sales_script         jsonb not null default '[]'::jsonb,
  escalation_rules     jsonb not null default '{}'::jsonb,
  custom_instructions  text,
  upsell_catalogue     text[],
  model                text not null default 'gpt-4o-mini',
  memory_window        integer not null default 50,
  followup_template    text,
  followup_delay_hours integer not null default 24,
  updated_at           timestamptz not null default now(),
  constraint agent_settings_tenant_id_key unique (tenant_id)
);

-- ---------------------------------------------------------------------------
-- Row Level Security: on, with no policies yet (deny by default).
-- ---------------------------------------------------------------------------
alter table public.tenants               enable row level security;
alter table public.tenant_users          enable row level security;
alter table public.channels              enable row level security;
alter table public.products              enable row level security;
alter table public.leads                 enable row level security;
alter table public.conversations         enable row level security;
alter table public.conversation_messages enable row level security;
alter table public.conversation_logs     enable row level security;
alter table public.orders                enable row level security;
alter table public.payments              enable row level security;
alter table public.agent_settings        enable row level security;
