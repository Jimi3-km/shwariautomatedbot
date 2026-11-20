-- ============================================================================
-- 0022  The database runs the schedule
--
-- Vercel's Hobby plan runs a cron at most once a day, which is far too coarse
-- for "follow up in two hours" and would make timed posting impossible. The
-- database has its own scheduler, so it calls the app's scheduled endpoints
-- instead: every five minutes for follow-ups, check-ins and interrupted
-- messages, and once a day for upkeep and learning.
--
-- The endpoints still require the shared secret. It is read from Supabase
-- Vault at call time and is never written into this file, a job definition or
-- a log. Until the secret is saved (see below) the jobs run and do nothing.
--
--   select vault.create_secret('<the same value as CRON_SECRET>', 'cron_secret');
--
-- Vercel's own daily cron stays in place as a backstop.
-- ============================================================================

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- The app's public address. Not a secret; kept in Vault only so that it sits
-- beside the secret and can be changed without a migration.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'app_base_url') then
    perform vault.create_secret('https://shwariautomatedbot.vercel.app', 'app_base_url');
  end if;
end $$;

create or replace function public.call_scheduled(path text)
returns bigint
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  secret text;
  base   text;
  request_id bigint;
begin
  -- Only the app's own scheduled endpoints may be called this way.
  if path !~ '^/api/internal/cron/[a-z-]+$' then
    raise exception 'call_scheduled: % is not a scheduled endpoint', path;
  end if;

  select decrypted_secret into secret from vault.decrypted_secrets where name = 'cron_secret' limit 1;
  select decrypted_secret into base   from vault.decrypted_secrets where name = 'app_base_url' limit 1;

  if secret is null or base is null then
    raise notice 'call_scheduled: cron_secret or app_base_url is not set in Vault; skipping %', path;
    return null;
  end if;

  select net.http_get(
    url := rtrim(base, '/') || path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || secret),
    timeout_milliseconds := 55000
  ) into request_id;

  return request_id;
end $$;

-- Nobody calls this through the API: only the scheduler, as the owner.
revoke all on function public.call_scheduled(text) from public, anon, authenticated;

-- Replace rather than duplicate if this migration is run again.
select cron.unschedule(jobid) from cron.job where jobname in ('shwari-dispatch', 'shwari-maintenance');

select cron.schedule('shwari-dispatch', '*/5 * * * *',
  $job$select public.call_scheduled('/api/internal/cron/dispatch')$job$);

select cron.schedule('shwari-maintenance', '30 2 * * *',
  $job$select public.call_scheduled('/api/internal/cron/maintenance')$job$);
