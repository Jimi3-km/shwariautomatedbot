-- Re-revoke tenants.api_key_hash from the browser role.
--
-- Migration 0006 restored service_role's privileges with a blanket
-- `grant all privileges on all tables`, which also handed `authenticated` a
-- table-level grant on public.tenants. A table-level grant cannot be narrowed
-- by a column-level REVOKE, so api_key_hash became readable again. RLS still
-- confined a caller to their own tenant's row, so this was never cross-tenant
-- exposure, but the column was deliberately unreadable by the browser in
-- migration 0001 and should stay that way.
--
-- The fix is the same shape as 0001: drop the table-level grant, then grant
-- column by column. Verified alongside this: channels.bot_token,
-- channels.secret_token, channels.credentials_ref and meta_tokens were all
-- still correctly denied and are untouched here.

revoke all on public.tenants from authenticated;
revoke all on public.tenants from anon;

-- Everything except api_key_hash is readable by a member of the tenant.
grant select (
  id, slug, status, business_name, business_description, business_category,
  agent_name, address, timezone, currency, business_hours, delivery_rules,
  payment_details, branding, languages, contact_info, order_prefix,
  notification_channel, notification_target, onboarding_completed_at,
  created_at, updated_at
) on public.tenants to authenticated;

-- Writable business settings. Deliberately excluded:
--   api_key_hash            never reachable from the browser
--   id, slug, created_at    identity, assigned once
--   status                  account state, operator-controlled
--   onboarding_completed_at set server-side when the wizard completes, so the
--                           browser cannot mark itself onboarded
grant update (
  business_name, business_description, business_category, agent_name, address,
  timezone, currency, business_hours, delivery_rules, payment_details,
  branding, languages, contact_info, order_prefix, notification_channel,
  notification_target, updated_at
) on public.tenants to authenticated;

-- Tenants are created and deleted by the service role only.
