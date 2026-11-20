-- 0025 - Facebook Pages
--
-- Lets a business connect a Facebook Page: Messenger messages reach the same
-- inbox and agents, and approved posts can be published to the Page.
--
-- Additive and safe to re-run. Nothing is dropped except two CHECK
-- constraints, which are recreated wider in the same statement block; no row
-- is touched.
--
-- The application tolerates this migration not having been applied: connecting
-- a Page then stops with "the database needs its latest update" instead of
-- failing in an unexplained way.

-- ---------------------------------------------------------------------------
-- 1. channels.channel_type accepts 'facebook'
-- ---------------------------------------------------------------------------
-- The constraint is found by what it constrains rather than by name, so a
-- database where it was created under a different name is handled too.

do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.channels'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%channel_type%'
      and pg_get_constraintdef(con.oid) ilike '%telegram%'
  loop
    execute format('alter table public.channels drop constraint %I', c.conname);
  end loop;

  alter table public.channels
    add constraint channels_channel_type_check
    check (channel_type = any (array['telegram'::text, 'whatsapp'::text, 'instagram'::text, 'webchat'::text, 'facebook'::text]));
end $$;

-- ---------------------------------------------------------------------------
-- 2. webhook_events.provider accepts 'facebook'
-- ---------------------------------------------------------------------------
-- Messenger messages go through the same claim-then-persist path as every
-- other channel. Without this a Messenger message could not be claimed, and an
-- unclaimed message is dropped rather than risk answering it twice.

do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.webhook_events'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%provider%'
      and pg_get_constraintdef(con.oid) ilike '%telegram%'
  loop
    execute format('alter table public.webhook_events drop constraint %I', c.conname);
  end loop;

  alter table public.webhook_events
    add constraint webhook_events_provider_check
    check (provider in ('whatsapp', 'instagram', 'telegram', 'webchat', 'facebook'));
end $$;

-- ---------------------------------------------------------------------------
-- 3. meta_tokens: which Page the stored token belongs to
-- ---------------------------------------------------------------------------
-- The platform check on meta_tokens has allowed 'facebook' since 0008. These
-- two columns record the Page beside its encrypted token. Neither is a secret.

alter table public.meta_tokens
  add column if not exists facebook_page_id   text,
  add column if not exists facebook_page_name text;

-- ---------------------------------------------------------------------------
-- 4. facebook_page_choices: a Page choice waiting to be made
-- ---------------------------------------------------------------------------
-- When the person who signs in manages several Pages, the server must not
-- guess which one this business uses. The candidates (with their Page access
-- tokens) are kept here, encrypted with the same key as meta_tokens, for a few
-- minutes while the owner picks one. Only Page names and ids are ever sent to
-- the browser. One row per business; choosing, reconnecting or expiry removes
-- it.

create table if not exists public.facebook_page_choices (
  tenant_id        uuid        primary key references public.tenants(id) on delete cascade,
  user_id          uuid,
  -- AES-256-GCM envelope {v, iv, tag, data} - never plaintext.
  pages_encrypted  text        not null,
  expires_at       timestamptz not null,
  created_at       timestamptz not null default now()
);

comment on table public.facebook_page_choices is
  'Facebook Pages offered to a business that has not yet chosen one. Encrypted, short-lived, service-role only.';

alter table public.facebook_page_choices enable row level security;

-- Deliberately no policy for authenticated: server-side only, like meta_tokens.
revoke all on public.facebook_page_choices from anon, authenticated;
grant all privileges on public.facebook_page_choices to service_role;
