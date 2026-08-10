-- ============================================================================
-- Privilege grants for the dashboard role.
-- ----------------------------------------------------------------------------
-- Discovered during isolation testing: these tables were created without any
-- GRANT to the `authenticated` role. RLS can only narrow access that has
-- already been granted, so every dashboard query failed with
-- "permission denied for table ..." before a policy was ever consulted.
--
-- With these grants in place, RLS becomes the actual filter.
-- ============================================================================

grant select, insert, update, delete on
  public.agent_settings, public.products, public.leads, public.conversations,
  public.conversation_messages, public.conversation_logs, public.orders, public.payments
  to authenticated;

grant select, update on public.tenants to authenticated;
grant select, insert, update, delete on public.tenant_users to authenticated;

-- channels: column-level grants only. secret_token, bot_token and
-- credentials_ref are deliberately omitted, so the dashboard role has no
-- privilege to read or write them even through a raw PostgREST call.
grant select (id, tenant_id, channel_type, channel_account_id, display_name, status, created_at)
  on public.channels to authenticated;
grant insert (id, tenant_id, channel_type, channel_account_id, display_name, status)
  on public.channels to authenticated;
grant update (display_name, status) on public.channels to authenticated;
grant delete on public.channels to authenticated;

-- anon has no access to tenant data; it exists only to reach GoTrue.
revoke all on public.tenants, public.tenant_users, public.channels, public.products,
  public.leads, public.conversations, public.conversation_messages,
  public.conversation_logs, public.orders, public.payments, public.agent_settings from anon;

-- ---------------------------------------------------------------------------
-- channels_safe
-- ---------------------------------------------------------------------------
-- A security_invoker view cannot evaluate (secret_token is not null) for a
-- caller that holds no privilege on that column. So this view runs as its
-- owner and carries its own tenant filter derived from auth.uid(). The caller
-- gains no access to the underlying secret columns either way.

drop view if exists public.channels_safe;

create view public.channels_safe
with (security_invoker = false) as
  select id, tenant_id, channel_type, channel_account_id, display_name, status, created_at,
         (secret_token    is not null) as has_secret_token,
         (bot_token       is not null) as has_bot_token,
         (credentials_ref is not null) as has_credentials_ref
  from public.channels
  where tenant_id in (select public.current_tenant_ids());

comment on view public.channels_safe is
  'Channel listing with secrets reduced to booleans. Runs as owner but filters to the caller''s own tenants via auth.uid(), so it can never expose another tenant''s channels.';

revoke all on public.channels_safe from anon, public;
grant select on public.channels_safe to authenticated;
