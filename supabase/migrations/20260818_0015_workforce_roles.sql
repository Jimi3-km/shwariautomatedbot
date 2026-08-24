-- ============================================================================
-- Two more departments.
-- ----------------------------------------------------------------------------
-- The workforce is now fixed at five: manager, sales, support, booking and
-- orders. Every tenant gets all five, provisioned by the application the first
-- time anything needs one, so this migration only has to widen the check that
-- would otherwise reject the two new roles.
--
-- Widening a CHECK touches no rows and no existing agent. Nothing else changes:
-- the policies, grants and the unique constraint on (tenant_id, role) all still
-- apply exactly as before.
-- ============================================================================

alter table public.agents drop constraint if exists agents_role_check;

alter table public.agents add constraint agents_role_check
  check (role in ('manager', 'sales', 'support', 'booking', 'orders'));

comment on column public.agents.role is
  'One of five fixed roles. Businesses do not define departments; adding one is a code change plus a widening of this check.';
