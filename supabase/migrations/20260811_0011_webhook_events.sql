-- Inbound webhook idempotency.
--
-- Meta retries a delivery until it gets a 200, and will happily send the same
-- event more than once. Without a record of what has already been handled, a
-- retry produces a duplicate customer message, a duplicate lead touch and a
-- second AI reply to the same sentence.
--
-- The unique constraint is the mechanism, not the lookup: two concurrent
-- deliveries of the same event both pass a SELECT, so the insert is what
-- decides. A duplicate key means "already handled" and the request is acked
-- without doing the work again.
--
-- Additive: no existing table, policy or grant is touched.

create table if not exists public.webhook_events (
  id            bigserial primary key,
  provider      text        not null check (provider in ('whatsapp', 'instagram', 'telegram')),
  -- The provider's own id for the event. Unique per provider, not globally.
  event_id      text        not null,
  tenant_id     uuid        references public.tenants(id) on delete cascade,
  channel_id    uuid        references public.channels(id) on delete set null,
  received_at   timestamptz not null default now(),

  constraint webhook_events_provider_event_key unique (provider, event_id)
);

-- Tenant-scoped reads for anything that wants to audit delivery.
create index if not exists webhook_events_tenant_received_idx
  on public.webhook_events (tenant_id, received_at desc);

comment on table public.webhook_events is
  'One row per inbound provider event, keyed by the provider''s own event id. Exists to make webhook delivery idempotent.';

-- This table is written only by the server (service role) on the webhook path,
-- which has no user session. RLS is enabled with no policy for `authenticated`
-- so a dashboard session cannot read or write it at all — the same shape used
-- for meta_tokens.
alter table public.webhook_events enable row level security;

revoke all on public.webhook_events from anon, authenticated;
revoke all on sequence public.webhook_events_id_seq from anon, authenticated;

grant all privileges on public.webhook_events to service_role;
grant all privileges on sequence public.webhook_events_id_seq to service_role;

-- Deliveries are only useful while retries are plausible; keep the table small.
-- Called opportunistically by the webhook route rather than by a cron job, so
-- there is nothing extra to operate.
create or replace function public.prune_webhook_events(older_than interval default '7 days')
returns void
language sql
security definer
set search_path = public, pg_catalog
as $fn$
  delete from public.webhook_events where received_at < now() - older_than;
$fn$;

revoke all on function public.prune_webhook_events(interval) from public, anon, authenticated;
grant execute on function public.prune_webhook_events(interval) to service_role;
