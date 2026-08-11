-- Onboarding support columns.
--
-- Additive only: two nullable columns on tenants. No existing column, policy,
-- grant or trigger is touched, so every tenant that already exists keeps
-- working unchanged and simply reads NULL for both.
--
-- Table-level grants from migration 0003 cover future columns, and the tenant
-- RLS policies are row-scoped rather than column-scoped, so nothing further is
-- required for `authenticated` to read and update these through the API.

alter table public.tenants
  add column if not exists business_category text,
  add column if not exists onboarding_completed_at timestamptz;

comment on column public.tenants.business_category is
  'Free-text category chosen during onboarding (e.g. retail, salon, electronics). Used to seed agent defaults.';
comment on column public.tenants.onboarding_completed_at is
  'Set when the owner finishes the setup wizard. NULL means the wizard should be shown.';

-- Tenants created before this migration have already been using the product,
-- so treat them as onboarded rather than throwing them back into the wizard.
update public.tenants
   set onboarding_completed_at = created_at
 where onboarding_completed_at is null;
