-- Allow web chat messages to use the same idempotency table.
--
-- webhook_events.provider was constrained to the three external providers.
-- Web chat messages arrive on our own endpoint rather than a provider webhook,
-- but they go through the identical claim-then-persist path, so they need to be
-- representable here too — a retried submit must not produce two messages.
--
-- Additive: widens a CHECK, touches no rows, no policy and no grant.

alter table public.webhook_events
  drop constraint if exists webhook_events_provider_check;

alter table public.webhook_events
  add constraint webhook_events_provider_check
  check (provider in ('whatsapp', 'instagram', 'telegram', 'webchat'));
