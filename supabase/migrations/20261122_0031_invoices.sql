-- ============================================================================
-- 0031  Invoices
-- ============================================================================
-- A service business bills for work: it issues an invoice, the customer pays,
-- and a person confirms the money arrived. An invoice here is a request for
-- payment; the payment itself is still a row in public.payments, verified by a
-- person exactly as before. Verifying a payment that belongs to an invoice is
-- what marks the invoice paid.
-- ============================================================================

create table if not exists public.invoices (
  id              uuid        primary key default gen_random_uuid(),
  tenant_id       uuid        not null references public.tenants(id) on delete cascade,
  -- Numbered per business: INV-00001, INV-00002, ...
  seq             integer     not null,
  invoice_no      text        not null,

  lead_id         bigint      references public.leads(id) on delete set null,
  conversation_id uuid        references public.conversations(id) on delete set null,
  appointment_id  uuid        references public.appointments(id) on delete set null,
  customer_name   text,
  customer_email  text,
  customer_phone  text,

  -- [{ "name": "...", "qty": 1, "price": 1500 }]
  items           jsonb       not null default '[]'::jsonb,
  subtotal        numeric(14,2) not null default 0,
  discount        numeric(14,2) not null default 0,
  tax_label       text,
  tax_rate        numeric(6,3)  not null default 0,
  tax_amount      numeric(14,2) not null default 0,
  total           numeric(14,2) not null default 0,
  currency        text        not null default 'KES',

  -- draft: not sent yet. sent: with the customer, awaiting payment.
  -- paid: a person verified the payment. void: cancelled.
  -- "Overdue" is not stored: it is a sent invoice past its due date.
  status          text        not null default 'draft'
                    check (status in ('draft', 'sent', 'paid', 'void')),
  issue_date      date        not null default current_date,
  due_date        date,
  notes           text,

  -- The verified payment that settled it.
  payment_id      uuid        references public.payments(id) on delete set null,
  sent_at         timestamptz,
  sent_via        text,
  paid_at         timestamptz,
  reminded_at     timestamptz,

  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint invoices_seq_unique unique (tenant_id, seq),
  constraint invoices_no_unique  unique (tenant_id, invoice_no)
);

create index if not exists invoices_tenant_created_idx on public.invoices (tenant_id, created_at desc);
create index if not exists invoices_tenant_status_idx  on public.invoices (tenant_id, status);
create index if not exists invoices_lead_idx           on public.invoices (tenant_id, lead_id);

-- Everyone in the business can read its invoices. Writing goes through the
-- server, which checks the caller's role and keeps the totals honest.
alter table public.invoices enable row level security;

drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()));

revoke all on public.invoices from anon, authenticated;
grant select on public.invoices to authenticated;
grant all on public.invoices to service_role;

-- A payment can be for an invoice.
alter table public.payments add column if not exists invoice_id uuid references public.invoices(id) on delete set null;
create index if not exists payments_invoice_idx on public.payments (invoice_id) where invoice_id is not null;

-- An invoice being paid is news.
do $$
begin
  alter table public.notifications drop constraint if exists notifications_kind_check;
  alter table public.notifications
    add constraint notifications_kind_check
    check (kind in ('new_order', 'payment_claim', 'payment_verified', 'needs_human',
                    'posts_to_approve', 'post_published', 'post_failed',
                    'invoice_paid', 'invoice_overdue'));
end $$;

-- On for every business, like the other alerts.
alter table public.tenants alter column alert_kinds set default array[
  'payment_claim', 'new_order', 'needs_human', 'payment_verified',
  'posts_to_approve', 'post_failed', 'post_published', 'invoice_paid', 'invoice_overdue'
];
update public.tenants
  set alert_kinds = alert_kinds || array['invoice_paid', 'invoice_overdue']
  where not (alert_kinds @> array['invoice_paid']);
