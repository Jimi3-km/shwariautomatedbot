-- ============================================================================
-- Columns required by the dashboard inbox, payments and orders sections.
-- ============================================================================

-- Conversations: human takeover, unread indicator, list rendering.
alter table public.conversations
  add column if not exists ai_enabled boolean not null default true,
  add column if not exists customer_name text,
  add column if not exists unread_count integer not null default 0,
  add column if not exists last_message_preview text,
  add column if not exists assigned_to uuid references auth.users(id) on delete set null,
  add column if not exists lead_id bigint references public.leads(id) on delete set null;

comment on column public.conversations.ai_enabled is
  'False when a human has taken over. The n8n agent must not reply while this is false.';
comment on column public.conversations.unread_count is
  'Inbound customer messages not yet seen in the dashboard.';

create index if not exists conversations_tenant_unread_idx
  on public.conversations (tenant_id) where unread_count > 0;

-- Payments: link a claim back to the conversation it came from, and record
-- why a claim was rejected.
alter table public.payments
  add column if not exists conversation_id uuid references public.conversations(id) on delete set null,
  add column if not exists rejected_reason text;

-- Orders: the dashboard order table needs payment status and customer identity
-- on the same row.
alter table public.orders
  add column if not exists payment_status text not null default 'unpaid',
  add column if not exists customer_id text,
  add column if not exists channel_type text,
  add column if not exists updated_at timestamptz not null default now();
