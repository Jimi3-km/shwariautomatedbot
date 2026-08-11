-- ============================================================================
-- Restore standard service_role privileges on the public schema.
-- ----------------------------------------------------------------------------
-- Root cause of `GET /api/me` -> 500 "Failed to resolve tenant membership".
--
-- service_role held only Dxtm (TRUNCATE/REFERENCES/TRIGGER/MAINTAIN) on every
-- public table: no SELECT, INSERT, UPDATE or DELETE. rolbypassrls only skips
-- row-level POLICIES, it does not grant table PRIVILEGES, so every query the
-- server's privileged client made failed with:
--
--     42501 permission denied for table tenant_users
--
-- which surfaced as a 500 from requireAuth's membership lookup.
--
-- Migration 0003 restored these grants for `authenticated` but not for
-- `service_role`, and the isolation suite only ever impersonated
-- `authenticated`, so the gap was never exercised.
--
-- Blast radius was wider than login: /api/bootstrap, the Telegram channel
-- connect flow, and every Supabase node in the n8n workflow use this role.
--
-- This restores Supabase's documented default for service_role. It does not
-- widen the browser's reach: service_role is server-only, never sent to the
-- client, and tenant isolation for dashboard reads is still enforced by the
-- caller-JWT client under RLS plus the explicit tenant_id filters.
-- ============================================================================

grant usage on schema public to service_role;

grant all privileges on all tables    in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant all privileges on all functions in schema public to service_role;

-- Anything created later inherits the same baseline, so a new table cannot
-- silently break the server or n8n again.
alter default privileges in schema public
  grant all privileges on tables to service_role;
alter default privileges in schema public
  grant all privileges on sequences to service_role;
alter default privileges in schema public
  grant all privileges on functions to service_role;

-- Re-assert that anon still has no reach into tenant data. The grants above
-- are deliberately scoped to service_role only.
revoke all on public.tenants, public.tenant_users, public.channels, public.products,
  public.leads, public.conversations, public.conversation_messages,
  public.conversation_logs, public.orders, public.payments, public.agent_settings
  from anon;

-- The dashboard role must still never read channel secrets. Re-apply the
-- column-level revokes in case a blanket grant elsewhere reinstated them.
revoke select (secret_token, bot_token, credentials_ref) on public.channels from anon, authenticated;
revoke update (secret_token, bot_token, credentials_ref) on public.channels from anon, authenticated;
revoke insert (secret_token, bot_token, credentials_ref) on public.channels from anon, authenticated;
revoke select (api_key_hash) on public.tenants from anon, authenticated;
revoke update (api_key_hash) on public.tenants from anon, authenticated;

-- followup_candidates exposes bot_token and stays service-role only.
revoke all on public.followup_candidates from anon, authenticated, public;
