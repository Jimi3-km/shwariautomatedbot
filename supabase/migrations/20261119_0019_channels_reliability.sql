-- 0019 — channel reliability
--
-- Two changes, both additive and safe to re-run.
--
-- 1. webhook_events gains progress tracking. Until now the table only answered
--    "have we seen this event id?". A webhook is acknowledged before its AI
--    turn runs, so the provider never retries; if the serverless function was
--    frozen or crashed mid-turn the event sat behind its own claim forever and
--    the customer was never answered. Recording how far each event got, and
--    keeping its normalized payload until it finishes, lets a later run resume
--    it.
--
-- 2. follow_ups gains a 'sending' state, so a row is only ever marked 'sent'
--    after the channel accepted the message.
--
-- The application tolerates this migration not having been applied yet: it
-- falls back to claim-only idempotency and the old follow-up claim.

-- ---------------------------------------------------------------------------
-- webhook_events: progress tracking
-- ---------------------------------------------------------------------------

alter table public.webhook_events
  add column if not exists status          text,
  add column if not exists attempts        integer     not null default 1,
  add column if not exists payload         jsonb,
  add column if not exists conversation_id uuid,
  add column if not exists last_error      text,
  add column if not exists processed_at    timestamptz;

alter table public.webhook_events
  drop constraint if exists webhook_events_status_check;

-- NULL is allowed: rows written before this migration have no status and are
-- treated as finished.
alter table public.webhook_events
  add constraint webhook_events_status_check
  check (status is null or status in ('claimed', 'persisted', 'processed', 'failed'));

comment on column public.webhook_events.status is
  'claimed → persisted → processed | failed. NULL on rows that predate tracking.';
comment on column public.webhook_events.payload is
  'The normalized inbound event, kept only until the event is processed so an interrupted turn can be resumed. Contains customer text; service-role only.';

-- The retry job looks only for unfinished rows, which are a tiny fraction.
create index if not exists webhook_events_unfinished_idx
  on public.webhook_events (received_at)
  where status in ('claimed', 'persisted');

-- Unchanged, restated so this file is self-contained: nothing but the service
-- role may read or write this table.
revoke all on public.webhook_events from anon, authenticated;
grant all privileges on public.webhook_events to service_role;

-- ---------------------------------------------------------------------------
-- follow_ups: an honest in-flight state
-- ---------------------------------------------------------------------------

alter table public.follow_ups
  drop constraint if exists follow_ups_status_check;

alter table public.follow_ups
  add constraint follow_ups_status_check
  check (status in ('pending', 'sending', 'sent', 'cancelled', 'failed'));

comment on column public.follow_ups.status is
  'pending → sending → sent | failed; cancelled by staff. A row left in sending for more than ten minutes was interrupted and is swept to failed.';
