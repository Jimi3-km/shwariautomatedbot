-- ============================================================================
-- 0023  The scheduler proves itself with a token only the database holds
--
-- 0022 had the database send the same CRON_SECRET that Vercel holds, which
-- meant a person copying one secret into two systems. In practice the two
-- copies did not match and every scheduled call was refused.
--
-- Now the database generates its own random token, keeps it in Vault, and
-- sends it with each call. The app does not hold a copy: it asks the database
-- "is this your token?" through verify_scheduler_token, which only the service
-- role may call. Nobody has to see, copy or paste anything.
-- ============================================================================

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'scheduler_token') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'scheduler_token');
  end if;
end $$;

create or replace function public.verify_scheduler_token(token text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  expected text;
begin
  if token is null or length(token) < 32 then return false; end if;
  select decrypted_secret into expected from vault.decrypted_secrets where name = 'scheduler_token' limit 1;
  if expected is null then return false; end if;
  -- Compared as digests, so the comparison does not depend on where the
  -- strings first differ.
  return extensions.digest(token, 'sha256') = extensions.digest(expected, 'sha256');
end $$;

revoke all on function public.verify_scheduler_token(text) from public, anon, authenticated;
grant execute on function public.verify_scheduler_token(text) to service_role;

create or replace function public.call_scheduled(path text)
returns bigint
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  token text;
  base  text;
  request_id bigint;
begin
  -- Only the app's own scheduled endpoints may be called this way.
  if path !~ '^/api/internal/cron/[a-z-]+$' then
    raise exception 'call_scheduled: % is not a scheduled endpoint', path;
  end if;

  select decrypted_secret into token from vault.decrypted_secrets where name = 'scheduler_token' limit 1;
  select decrypted_secret into base  from vault.decrypted_secrets where name = 'app_base_url' limit 1;

  if token is null or base is null then
    raise notice 'call_scheduled: scheduler_token or app_base_url is not set in Vault; skipping %', path;
    return null;
  end if;

  select net.http_get(
    url := rtrim(base, '/') || path,
    headers := jsonb_build_object('x-scheduler-token', token),
    timeout_milliseconds := 55000
  ) into request_id;

  return request_id;
end $$;

revoke all on function public.call_scheduled(text) from public, anon, authenticated;

-- The hand-copied secret is no longer used by anything.
delete from vault.secrets where name = 'cron_secret';
