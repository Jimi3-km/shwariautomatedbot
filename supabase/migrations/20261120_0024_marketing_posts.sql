-- ============================================================================
-- 0024  Marketing: the content library, the posting calendar and its settings
--
--   content_items     the owner's own photos and videos, each with a caption,
--                     what it is about, where it may go and how often it may
--                     be reused. Nothing here is generated: media is uploaded.
--   scheduled_posts   one row per post on the calendar. A row is published
--                     only from status 'approved', and is claimed by moving
--                     it to 'publishing' so two runners cannot both post it.
--   posting_settings  one row per business: approval mode, pause, and the
--                     days and times it posts.
--
-- Also widens notifications.kind and creates the public media bucket.
--
-- Additive and idempotent. The application tolerates this migration not being
-- applied yet: the Marketing page is empty and nothing is published.
-- ============================================================================

create table if not exists public.content_items (
  id            uuid        primary key default gen_random_uuid(),
  tenant_id     uuid        not null references public.tenants(id) on delete cascade,
  -- The public address the platform fetches the media from, and where it
  -- lives in storage so it can be removed.
  media_url     text        not null,
  media_path    text,
  media_type    text        not null default 'image'
                  check (media_type in ('image', 'video')),
  caption       text        not null default '',
  -- What the item is about. Ids are kept loose on purpose: deleting a product
  -- must not delete the photo of it.
  product_id    uuid,
  service_id    uuid,
  about         text,
  platforms     text[]      not null default '{instagram}',
  status        text        not null default 'draft'
                  check (status in ('draft', 'approved', 'archived')),
  -- How many times it may be posted in total. Null means no limit.
  max_uses      integer     check (max_uses is null or max_uses >= 1),
  times_used    integer     not null default 0,
  last_used_at  timestamptz,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists content_items_tenant_idx
  on public.content_items (tenant_id, status, created_at desc);

alter table public.content_items enable row level security;

drop policy if exists content_items_select on public.content_items;
create policy content_items_select on public.content_items
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()));

-- Written through the API (service role), which checks the caller.
revoke all on public.content_items from anon, authenticated;
grant select on public.content_items to authenticated;
grant all on public.content_items to service_role;

-- ---------------------------------------------------------------------------

create table if not exists public.scheduled_posts (
  id                  uuid        primary key default gen_random_uuid(),
  tenant_id           uuid        not null references public.tenants(id) on delete cascade,
  content_item_id     uuid        references public.content_items(id) on delete set null,
  platform            text        not null default 'instagram'
                        check (platform in ('instagram', 'facebook')),
  -- A snapshot taken when the post was proposed, so editing the library later
  -- does not silently change something already approved.
  caption             text        not null default '',
  media_url           text        not null,
  media_type          text        not null default 'image'
                        check (media_type in ('image', 'video')),
  about               text,
  scheduled_for       timestamptz not null,
  status              text        not null default 'proposed'
                        check (status in ('proposed', 'approved', 'publishing', 'published',
                                          'failed', 'rejected', 'cancelled')),
  -- Why a person should read this one before approving it.
  needs_review_reason text,
  approved_by         uuid,
  approved_at         timestamptz,
  published_at        timestamptz,
  -- The platform's media container, kept so a video still processing is
  -- resumed on the next run instead of being uploaded a second time.
  container_id        text,
  external_post_id    text,
  external_permalink  text,
  failure_reason      text,
  attempt_count       integer     not null default 0,
  -- The first day of the seven-day plan this post was proposed in.
  week_start          date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists scheduled_posts_tenant_idx
  on public.scheduled_posts (tenant_id, scheduled_for);
create index if not exists scheduled_posts_due_idx
  on public.scheduled_posts (scheduled_for) where status = 'approved';
create index if not exists scheduled_posts_publishing_idx
  on public.scheduled_posts (updated_at) where status = 'publishing';

-- The same item is never scheduled twice at the same time on one platform.
create unique index if not exists scheduled_posts_item_once_key
  on public.scheduled_posts (tenant_id, content_item_id, platform, scheduled_for)
  where content_item_id is not null;

-- And one posting time holds one live post, which is what makes planning a
-- week twice (two clicks, two schedulers) produce one calendar.
create unique index if not exists scheduled_posts_slot_once_key
  on public.scheduled_posts (tenant_id, platform, scheduled_for)
  where status in ('proposed', 'approved', 'publishing', 'published');

alter table public.scheduled_posts enable row level security;

drop policy if exists scheduled_posts_select on public.scheduled_posts;
create policy scheduled_posts_select on public.scheduled_posts
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()));

revoke all on public.scheduled_posts from anon, authenticated;
grant select on public.scheduled_posts to authenticated;
grant all on public.scheduled_posts to service_role;

-- ---------------------------------------------------------------------------

create table if not exists public.posting_settings (
  tenant_id       uuid        primary key references public.tenants(id) on delete cascade,
  approval_mode   text        not null default 'week'
                    check (approval_mode in ('week', 'each', 'autopilot')),
  paused          boolean     not null default false,
  -- When to post, in the business's own timezone. day: 0 = Sunday.
  slots           jsonb       not null default
                    '[{"day":1,"time":"18:00"},{"day":3,"time":"18:00"},{"day":5,"time":"18:00"}]'::jsonb,
  -- When the scheduler last laid out a week, so it does so at most daily.
  last_planned_at timestamptz,
  updated_at      timestamptz not null default now()
);

alter table public.posting_settings enable row level security;

drop policy if exists posting_settings_select on public.posting_settings;
create policy posting_settings_select on public.posting_settings
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()));

revoke all on public.posting_settings from anon, authenticated;
grant select on public.posting_settings to authenticated;
grant all on public.posting_settings to service_role;

-- ---------------------------------------------------------------------------
-- Notifications learn three new kinds. The old check constraint is found by
-- what it constrains rather than by name, dropped, and recreated wider.

do $$
declare
  c record;
begin
  if to_regclass('public.notifications') is null then
    return;
  end if;

  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.notifications'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%kind%'
  loop
    execute format('alter table public.notifications drop constraint %I', c.conname);
  end loop;

  alter table public.notifications
    add constraint notifications_kind_check
    check (kind in ('new_order', 'payment_claim', 'payment_verified', 'needs_human',
                    'posts_to_approve', 'post_published', 'post_failed'));
end $$;

-- ---------------------------------------------------------------------------
-- Where uploaded media lives. Public to read, because Instagram fetches a post's
-- media from its address and cannot sign in. There are deliberately no insert,
-- update or delete policies for anon or authenticated: uploads go through the
-- API, which uses the service role and checks the caller.

do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;

  insert into storage.buckets (id, name, public)
  values ('post-media', 'post-media', true)
  on conflict (id) do update set public = true;
end $$;
