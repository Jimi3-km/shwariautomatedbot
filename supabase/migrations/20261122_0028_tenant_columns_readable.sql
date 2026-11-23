-- ============================================================================
-- 0028  The new tenant columns are readable by signed-in users
-- ============================================================================
-- public.tenants grants SELECT column by column (migration 0001), so a column
-- added later is unreadable until it is granted. 0027 added agents_paused and
-- status_reason and the app's session read asks for them; without this grant
-- that read failed for every user and the app showed the setup wizard.
-- Row-level policies still decide WHICH business a user can read.
-- ============================================================================
grant select (agents_paused, status_reason, approved_at) on public.tenants to authenticated;
