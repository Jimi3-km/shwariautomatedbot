-- ============================================================================
-- Shwari Agent: the configurable agent layer, business knowledge and audit.
-- ----------------------------------------------------------------------------
-- Additive only. No existing table, column, policy, grant or trigger is
-- altered, so everything that works today keeps working unchanged.
--
-- Five ideas, one table group each:
--
--   agents            an agent is a row, not a hardcoded workflow. Role,
--                     objective, instructions, tools, permissions, escalation.
--   business_facts    durable business memory — the answers Shwari learns from
--                     the owner and hands to the other agents.
--   services          what the business actually offers, and whether each thing
--                     can be booked directly or needs a consultation first.
--   business_hours    opening hours as data, so "are you open on Sunday" has an
--                     answer instead of a guess.
--   agent_tool_calls  every tool invocation, with its arguments and outcome.
--   knowledge_gaps    the learning loop's inbox: questions we could not answer.
--   shwari_admins     which person on which channel is allowed to administer
--                     the business by chat.
--
-- Tenancy follows the pattern established in 0001: RLS on, policies derived
-- from auth.uid() through the existing SECURITY DEFINER helpers, and explicit
-- grants because RLS can only narrow privileges that already exist.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. agents
-- ---------------------------------------------------------------------------
create table if not exists public.agents (
  id           uuid        primary key default gen_random_uuid(),
  tenant_id    uuid        not null references public.tenants(id) on delete cascade,

  -- Only the three roles this phase builds. Widening the check is how a new
  -- department is added later; nothing else keys off the value.
  role         text        not null check (role in ('manager', 'sales', 'support')),
  name         text        not null,
  objective    text        not null default '',

  -- What the owner is allowed to shape conversationally.
  instructions text        not null default '',

  -- Tool names this agent may call. The runtime intersects this with the tools
  -- it actually has, so an unknown name here is inert rather than dangerous.
  tools        text[]      not null default '{}',

  -- Coarse switches the tools consult: {"can_quote_prices": true, ...}
  permissions  jsonb       not null default '{}'::jsonb,
  escalation   text        not null default '',
  config       jsonb       not null default '{}'::jsonb,

  status       text        not null default 'draft' check (status in ('draft', 'active', 'disabled')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint agents_tenant_role_key unique (tenant_id, role)
);

comment on table public.agents is
  'One row per AI agent per tenant. Agents are configuration, not code: the same engine runs every row.';
comment on column public.agents.instructions is
  'Owner-shaped guidance, appended to the role''s built-in system prompt. It never replaces it, so an agent cannot be talked out of its own rules.';

-- ---------------------------------------------------------------------------
-- 2. business_facts — durable business memory
-- ---------------------------------------------------------------------------
create table if not exists public.business_facts (
  id         uuid        primary key default gen_random_uuid(),
  tenant_id  uuid        not null references public.tenants(id) on delete cascade,

  -- Broad bucket, used to retrieve a relevant slice rather than the whole set.
  category   text        not null default 'general',
  -- Stable slug within the category: 'sunday_hours', 'refund_window'.
  fact_key   text        not null,
  value      text        not null,

  source     text        not null default 'owner' check (source in ('owner', 'agent', 'inferred')),
  confidence numeric(3,2) not null default 1.00 check (confidence >= 0 and confidence <= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint business_facts_tenant_key_key unique (tenant_id, category, fact_key)
);

create index if not exists business_facts_tenant_category_idx
  on public.business_facts (tenant_id, category);

comment on table public.business_facts is
  'Durable business memory. Retrieved by category so an agent gets the slice it needs rather than the whole company in one prompt.';

-- ---------------------------------------------------------------------------
-- 3. services
-- ---------------------------------------------------------------------------
create table if not exists public.services (
  id               uuid        primary key default gen_random_uuid(),
  tenant_id        uuid        not null references public.tenants(id) on delete cascade,
  name             text        not null,
  description      text        not null default '',
  price_amount     numeric(12,2),
  price_note       text,
  duration_minutes integer,

  -- The dental-clinic distinction, as data: cleaning is bookable, implants are
  -- a consultation first. Agents read this instead of being told per business.
  booking_mode     text        not null default 'enquiry'
                     check (booking_mode in ('direct', 'consultation', 'enquiry')),
  active           boolean     not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists services_tenant_name_key
  on public.services (tenant_id, lower(name));

comment on column public.services.booking_mode is
  'direct = the customer can book it outright; consultation = a consultation must happen first; enquiry = staff handle it.';
comment on column public.services.price_amount is
  'NULL means the price is genuinely not fixed. Agents must say so rather than estimate.';

-- ---------------------------------------------------------------------------
-- 4. business_hours
-- ---------------------------------------------------------------------------
create table if not exists public.business_hours (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null references public.tenants(id) on delete cascade,
  -- 0 = Sunday, matching JavaScript's getDay().
  day_of_week smallint    not null check (day_of_week between 0 and 6),
  closed      boolean     not null default false,
  opens       time,
  closes      time,
  note        text,
  updated_at  timestamptz not null default now(),

  constraint business_hours_tenant_day_key unique (tenant_id, day_of_week)
);

comment on table public.business_hours is
  'Opening hours as data. A missing row means unknown, which agents must report as unknown rather than assume closed.';

-- ---------------------------------------------------------------------------
-- 5. agent_tool_calls — the audit trail
-- ---------------------------------------------------------------------------
create table if not exists public.agent_tool_calls (
  id              bigserial   primary key,
  tenant_id       uuid        not null references public.tenants(id) on delete cascade,
  agent_role      text        not null,
  conversation_id uuid        references public.conversations(id) on delete set null,
  -- The user on whose behalf the agent acted, when there is one.
  actor_user_id   uuid,
  tool            text        not null,
  arguments       jsonb       not null default '{}'::jsonb,
  ok              boolean     not null,
  result          jsonb,
  error           text,
  created_at      timestamptz not null default now()
);

create index if not exists agent_tool_calls_tenant_created_idx
  on public.agent_tool_calls (tenant_id, created_at desc);

comment on table public.agent_tool_calls is
  'Every tool an agent invoked, with arguments and outcome. Append-only from the dashboard''s point of view: it may be read, never written.';

-- ---------------------------------------------------------------------------
-- 6. knowledge_gaps — the controlled learning loop
-- ---------------------------------------------------------------------------
create table if not exists public.knowledge_gaps (
  id         uuid        primary key default gen_random_uuid(),
  tenant_id  uuid        not null references public.tenants(id) on delete cascade,
  question   text        not null,
  times_seen integer     not null default 1,
  status     text        not null default 'open'
               check (status in ('open', 'asked', 'answered', 'dismissed')),
  -- Set when the owner answers; the answer becomes a business_facts row.
  resolution text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists knowledge_gaps_tenant_question_key
  on public.knowledge_gaps (tenant_id, lower(question));

comment on table public.knowledge_gaps is
  'Questions an agent could not answer from business knowledge. The owner answers them in plain English and Shwari turns the answer into a fact — the AI never invents the policy itself.';

-- ---------------------------------------------------------------------------
-- 7. shwari_admins — who may administer the business by chat
-- ---------------------------------------------------------------------------
-- Administering a business by message is a privileged act, so it is never
-- inferred from a display name or a phone number. The owner generates a pairing
-- code in the dashboard and sends it once from the account they want to use;
-- only then does that identity become an administrator on that channel.
create table if not exists public.shwari_admins (
  id           uuid        primary key default gen_random_uuid(),
  tenant_id    uuid        not null references public.tenants(id) on delete cascade,
  -- The dashboard user this chat identity belongs to.
  user_id      uuid        not null,
  channel_type text        not null,
  -- The provider's id for the person: a Telegram chat id, a web chat visitor.
  customer_id  text        not null,
  created_at   timestamptz not null default now(),

  constraint shwari_admins_identity_key unique (channel_type, customer_id)
);

create index if not exists shwari_admins_tenant_idx on public.shwari_admins (tenant_id);

comment on table public.shwari_admins is
  'Chat identities allowed to administer a tenant conversationally. Unique on (channel_type, customer_id) so one identity can never administer two businesses.';

-- Pairing codes. Short-lived, single-use, and never shown to anyone but the
-- admin who asked for one.
create table if not exists public.shwari_pairing_codes (
  code       text        primary key,
  tenant_id  uuid        not null references public.tenants(id) on delete cascade,
  user_id    uuid        not null,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists shwari_pairing_codes_expiry_idx
  on public.shwari_pairing_codes (expires_at);

-- ---------------------------------------------------------------------------
-- 8. shwari_messages — the owner's own conversation with Shwari
-- ---------------------------------------------------------------------------
-- Deliberately not a row in `conversations`. That table is the customer Inbox,
-- and an owner administering their business is not a customer enquiry: putting
-- it there would show up in unread counts, lead lists and response-time
-- analytics, all of which would then be measuring the wrong thing.
--
-- Telegram is different and stays as it is — a message from the owner's phone
-- genuinely did arrive on a customer channel, and the Inbox should show that it
-- did.
create table if not exists public.shwari_messages (
  id         bigserial   primary key,
  tenant_id  uuid        not null references public.tenants(id) on delete cascade,
  user_id    uuid        not null,
  role       text        not null check (role in ('owner', 'shwari')),
  body       text        not null,
  -- Tool names this turn actually changed something with, for the UI.
  actions    jsonb       not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists shwari_messages_thread_idx
  on public.shwari_messages (tenant_id, user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 9. Row level security
-- ---------------------------------------------------------------------------

-- Tables the dashboard may read and write, scoped exactly as the existing
-- tenant tables are.
do $$
declare
  t text;
begin
  foreach t in array array[
    'agents', 'business_facts', 'services', 'business_hours', 'knowledge_gaps'
  ]
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

-- agent_tool_calls is an audit trail: readable by the tenant, writable only by
-- the server. A dashboard session that could write it could forge the record of
-- what an agent did.
alter table public.agent_tool_calls enable row level security;

drop policy if exists agent_tool_calls_select on public.agent_tool_calls;
create policy agent_tool_calls_select on public.agent_tool_calls
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()));

revoke all on public.agent_tool_calls from anon, authenticated;
revoke all on sequence public.agent_tool_calls_id_seq from anon, authenticated;
grant select on public.agent_tool_calls to authenticated;
grant all privileges on public.agent_tool_calls to service_role;
grant all privileges on sequence public.agent_tool_calls_id_seq to service_role;

-- shwari_admins is readable so the dashboard can show "connected as", but the
-- link itself is only ever created by the server after a valid pairing code.
alter table public.shwari_admins enable row level security;

drop policy if exists shwari_admins_select on public.shwari_admins;
create policy shwari_admins_select on public.shwari_admins
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()));

drop policy if exists shwari_admins_delete on public.shwari_admins;
create policy shwari_admins_delete on public.shwari_admins
  for delete to authenticated
  using (public.is_tenant_admin(tenant_id));

revoke all on public.shwari_admins from anon, authenticated;
grant select, delete on public.shwari_admins to authenticated;
grant all privileges on public.shwari_admins to service_role;

-- Pairing codes are secrets in transit. No dashboard session reads this table;
-- the code is returned once by the API that mints it and never again.
alter table public.shwari_pairing_codes enable row level security;
revoke all on public.shwari_pairing_codes from anon, authenticated;
grant all privileges on public.shwari_pairing_codes to service_role;

-- Telegram needs no change to webhook_events: 0012 already widened the
-- provider check to cover all four channels.

-- A user reads only their own thread with Shwari, even among admins of the
-- same business: it is a private working conversation, not a shared channel.
alter table public.shwari_messages enable row level security;

drop policy if exists shwari_messages_select on public.shwari_messages;
create policy shwari_messages_select on public.shwari_messages
  for select to authenticated
  using (user_id = auth.uid() and tenant_id in (select public.current_tenant_ids()));

revoke all on public.shwari_messages from anon, authenticated;
revoke all on sequence public.shwari_messages_id_seq from anon, authenticated;
grant select on public.shwari_messages to authenticated;
grant all privileges on public.shwari_messages to service_role;
grant all privileges on sequence public.shwari_messages_id_seq to service_role;

-- ---------------------------------------------------------------------------
-- 10. Housekeeping
-- ---------------------------------------------------------------------------
create or replace function public.prune_shwari_pairing_codes()
returns void
language sql
security definer
set search_path = public, pg_catalog
as $fn$
  delete from public.shwari_pairing_codes
   where expires_at < now() - interval '1 day';
$fn$;

revoke all on function public.prune_shwari_pairing_codes() from public, anon, authenticated;
grant execute on function public.prune_shwari_pairing_codes() to service_role;
