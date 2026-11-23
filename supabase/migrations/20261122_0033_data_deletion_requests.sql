-- ============================================================================
-- 0033  Requests to delete data
-- ============================================================================
-- Meta requires an app to accept a deletion request when someone removes it
-- from their Instagram or Facebook account, to answer with a code, and to
-- offer a page where that code shows what happened. The same table records a
-- request made by a person on the website. Each row says who asked, through
-- which door, and what was done about it.
-- ============================================================================

create table if not exists public.data_deletion_requests (
  id              uuid        primary key default gen_random_uuid(),
  -- The code the person is given to look their request up. Not guessable.
  code            text        not null unique,
  -- meta_callback: Meta told us someone removed the app and asked for deletion.
  -- meta_deauthorize: Meta told us someone removed the app.
  -- website: a person asked on the data-deletion page.
  source          text        not null check (source in ('meta_callback', 'meta_deauthorize', 'website')),
  platform        text,
  -- Meta's id for the person, as Meta sent it. Not a name or an address.
  meta_user_id    text,
  -- For a website request: where to reach the person. Kept only to answer them.
  contact_email   text,
  details         text,
  tenant_id       uuid        references public.tenants(id) on delete set null,
  -- received: recorded, nothing done yet. completed: the connection and its
  -- credentials were removed. no_data: nothing held for that id.
  -- needs_review: a person must finish it.
  status          text        not null default 'received'
                    check (status in ('received', 'completed', 'no_data', 'needs_review')),
  outcome         text,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);

create index if not exists data_deletion_requests_created_idx on public.data_deletion_requests (created_at desc);

-- Read and written by the server only. The status page reads one row by its code.
alter table public.data_deletion_requests enable row level security;
revoke all on public.data_deletion_requests from anon, authenticated;
grant all on public.data_deletion_requests to service_role;
