-- ============================================================================
-- 0032  A record of every attempt to connect a channel
-- ============================================================================
-- Connecting Instagram, Facebook or WhatsApp happens on Meta's pages and fails
-- there, out of sight. Each attempt is written down when it starts and when
-- Meta sends the browser back, with the kind of device and browser at each
-- end, so "it did not work on my phone" can be looked up. No token, code or
-- address is stored: only a hash of the one-time state that links the halves.
-- ============================================================================

create table if not exists public.connect_attempts (
  id             bigserial   primary key,
  tenant_id      uuid        references public.tenants(id) on delete cascade,
  provider       text        not null,
  state_hash     text,
  start_device   text        not null,
  start_browser  text        not null,
  return_device  text,
  return_browser text,
  -- started, connected, cancelled, expired, failed, or a provider's own code.
  outcome        text        not null default 'started',
  detail         text,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz
);

create index if not exists connect_attempts_started_idx on public.connect_attempts (started_at desc);
create index if not exists connect_attempts_state_idx on public.connect_attempts (state_hash);

-- Read and written by the server only; shown to the platform admin.
alter table public.connect_attempts enable row level security;
revoke all on public.connect_attempts from anon, authenticated;
grant all on public.connect_attempts to service_role;
grant usage, select on sequence public.connect_attempts_id_seq to service_role;
