-- Account emails (confirm address, reset password, sign-in link) go out
-- through the platform's own email account instead of the sign-in service's
-- shared mailer.
--
-- The sign-in service calls this function for every email it would have sent
-- (Authentication > Hooks > Send email). The function passes the request to
-- the app, authenticated with the scheduler's token, and returns at once: the
-- request is queued and sent after the transaction commits, so a slow or
-- failing email never blocks a sign-up.

create or replace function public.send_auth_email(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  token text;
  base  text;
begin
  select decrypted_secret into token from vault.decrypted_secrets where name = 'scheduler_token' limit 1;
  select decrypted_secret into base  from vault.decrypted_secrets where name = 'app_base_url' limit 1;

  if token is null or base is null then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 500,
      'message', 'Email is not set up on this platform yet.'));
  end if;

  perform net.http_post(
    url := rtrim(base, '/') || '/api/internal/auth-email',
    body := event,
    headers := jsonb_build_object('x-scheduler-token', token, 'Content-Type', 'application/json'),
    timeout_milliseconds := 25000
  );

  return '{}'::jsonb;
end $$;

-- Only the sign-in service may call it.
revoke all on function public.send_auth_email(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.send_auth_email(jsonb) to supabase_auth_admin;
