-- ============================================================================
-- 0020  Agent learning and lead nurturing
--
--   agent_lessons          what the team has been taught: corrections from the
--                          owner, from QA labels, and from how staff answered.
--                          Read into every agent's briefing.
--   leads.*                behaviour signals worked out from the conversation:
--                          a 0-100 score, a temperature, and the detail.
--   knowledge_gaps.*       which conversation a question came from, so a staff
--                          reply to that conversation can teach the answer.
--
-- Additive and idempotent. The application tolerates this migration not being
-- applied yet: it simply learns and scores less.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. agent_lessons
-- ---------------------------------------------------------------------------
create table if not exists public.agent_lessons (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null references public.tenants(id) on delete cascade,
  -- null = every agent; otherwise one department.
  role        text        check (role is null or role in ('manager', 'sales', 'support', 'booking', 'orders')),
  lesson      text        not null check (char_length(lesson) between 3 and 600),
  source      text        not null default 'owner'
                check (source in ('owner', 'qa_label', 'staff_reply')),
  status      text        not null default 'active'
                check (status in ('active', 'retired')),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists agent_lessons_tenant_idx
  on public.agent_lessons (tenant_id, status, created_at desc);

create unique index if not exists agent_lessons_tenant_lesson_key
  on public.agent_lessons (tenant_id, coalesce(role, ''), lower(lesson));

comment on table public.agent_lessons is
  'Standing corrections the agents were taught. Appended to an agent''s briefing as house guidance; they never widen what an agent is permitted to do.';

alter table public.agent_lessons enable row level security;

drop policy if exists agent_lessons_select on public.agent_lessons;
create policy agent_lessons_select on public.agent_lessons
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()));

-- Writes go through the API (service role), which checks the caller's role.
revoke all on public.agent_lessons from anon, authenticated;
grant select on public.agent_lessons to authenticated;
grant all on public.agent_lessons to service_role;

-- ---------------------------------------------------------------------------
-- 2. Behaviour signals on a lead
-- ---------------------------------------------------------------------------
alter table public.leads add column if not exists score integer
  check (score is null or (score between 0 and 100));
alter table public.leads add column if not exists temperature text
  check (temperature is null or temperature in ('hot', 'warm', 'cold'));
alter table public.leads add column if not exists behaviour jsonb;

create index if not exists leads_tenant_temperature_idx
  on public.leads (tenant_id, temperature, score desc);

comment on column public.leads.score is
  'How likely this customer is to buy or book, 0-100, worked out from what they said and did.';
comment on column public.leads.behaviour is
  'The signals behind the score: intent, urgency, sentiment, objections, suggested next step.';

-- ---------------------------------------------------------------------------
-- 3. Where an unanswered question came from
-- ---------------------------------------------------------------------------
alter table public.knowledge_gaps add column if not exists conversation_id uuid
  references public.conversations(id) on delete set null;

create index if not exists knowledge_gaps_conversation_idx
  on public.knowledge_gaps (conversation_id) where conversation_id is not null;
