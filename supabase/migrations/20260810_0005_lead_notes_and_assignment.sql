-- Columns backing the lead detail screen (notes) and lead ownership
-- (assignment), both required by the dashboard's Leads section.

alter table public.leads
  add column if not exists notes text,
  add column if not exists assigned_to uuid references auth.users(id) on delete set null;

comment on column public.leads.notes is 'Free-form staff notes shown on the lead detail screen.';
comment on column public.leads.assigned_to is 'Staff member responsible for this lead.';

create index if not exists leads_tenant_assigned_idx
  on public.leads (tenant_id, assigned_to) where assigned_to is not null;
