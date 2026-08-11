-- ============================================================================
-- Phase 1: Instagram OAuth signup + encrypted Meta token storage
-- ----------------------------------------------------------------------------
-- Design note on "add instagram_id to the users table":
--
-- There is no application-owned users table. Supabase Auth owns auth.users,
-- and the entire RLS model resolves tenancy through auth.uid(). Minting our
-- own JWT alongside it would bypass auth.uid(), silently disabling every RLS
-- policy in migrations 0001-0003.
--
-- So Instagram identity is LINKED to a real Supabase Auth user instead:
-- the OAuth callback creates/finds an auth.users row via the Admin API and
-- records the Instagram identity here. auth.uid() keeps working, RLS keeps
-- working, and the session the browser receives is a genuine Supabase session.
-- ============================================================================

create table if not exists public.user_profiles (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  instagram_id     text unique,
  instagram_username text,
  profile_picture  text,
  provider         text not null default 'email'
                     check (provider in ('email','instagram','facebook','google')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists user_profiles_instagram_idx
  on public.user_profiles (instagram_id) where instagram_id is not null;

comment on table public.user_profiles is
  'Auth-provider identity attached to a Supabase Auth user. instagram_id is unique so an Instagram account maps to exactly one dashboard user.';

alter table public.user_profiles enable row level security;

-- A user may read and update only their own profile row.
drop policy if exists user_profiles_select on public.user_profiles;
create policy user_profiles_select on public.user_profiles
  for select to authenticated using (user_id = auth.uid());

drop policy if exists user_profiles_update on public.user_profiles;
create policy user_profiles_update on public.user_profiles
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Inserts happen server-side during the OAuth callback (service_role).

grant select, update on public.user_profiles to authenticated;
grant all privileges on public.user_profiles to service_role;
revoke all on public.user_profiles from anon;

-- ---------------------------------------------------------------------------
-- meta_tokens: encrypted Meta/Instagram/WhatsApp credentials per tenant
-- ---------------------------------------------------------------------------
-- access_token is stored as AES-256-GCM ciphertext produced by
-- src/server/services/meta/tokens.ts. The encryption key lives only in the
-- server environment, so a database read alone does not yield a usable token.

create table if not exists public.meta_tokens (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenants(id) on delete cascade,
  platform                    text not null check (platform in ('whatsapp','instagram','facebook')),
  -- Envelope: {v, iv, tag, data} — never plaintext.
  access_token_encrypted      text not null,
  token_expires_at            timestamptz,
  phone_number_id             text,
  whatsapp_business_account_id text,
  instagram_user_id           text,
  instagram_username          text,
  scopes                      text[],
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (tenant_id, platform)
);

create index if not exists meta_tokens_tenant_idx on public.meta_tokens (tenant_id);

comment on table public.meta_tokens is
  'Encrypted Meta platform credentials. Service-role only: never exposed to anon or authenticated, so a compromised dashboard session cannot exfiltrate tokens.';

alter table public.meta_tokens enable row level security;

-- Deliberately NO policy for authenticated: this table is server-side only.
-- service_role bypasses RLS, which is the only intended access path.
revoke all on public.meta_tokens from anon, authenticated;
grant all privileges on public.meta_tokens to service_role;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists user_profiles_touch on public.user_profiles;
create trigger user_profiles_touch before update on public.user_profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists meta_tokens_touch on public.meta_tokens;
create trigger meta_tokens_touch before update on public.meta_tokens
  for each row execute function public.touch_updated_at();
