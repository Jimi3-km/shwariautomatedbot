-- ============================================================================
-- Unread counter and tenant-aware follow-up selection.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Unread badge
-- ---------------------------------------------------------------------------
-- A PostgREST upsert cannot increment a column, so the count is maintained in
-- the database: any inbound customer message bumps it, and the dashboard
-- resets it to zero when the thread is opened.

create or replace function public.bump_conversation_unread()
returns trigger language plpgsql security definer set search_path = public, pg_catalog as $fn$
begin
  if new.sender = 'customer' then
    update public.conversations
       set unread_count = unread_count + 1,
           last_message_at = greatest(coalesce(last_message_at, new.created_at), new.created_at),
           last_message_preview = left(coalesce(new.body, ''), 160)
     where id = new.conversation_id and tenant_id = new.tenant_id;
  end if;
  return new;
end;
$fn$;

drop trigger if exists conversation_messages_bump_unread on public.conversation_messages;
create trigger conversation_messages_bump_unread
  after insert on public.conversation_messages
  for each row execute function public.bump_conversation_unread();

-- ---------------------------------------------------------------------------
-- Follow-up candidates
-- ---------------------------------------------------------------------------
-- Replaces the old global follow-up, which read every tenant's leads with no
-- filter and sent one hardcoded "Amara here from Shwari iPhones" message
-- through a single shared credential.
--
-- Each row here is already bound to its own tenant's delay, identity,
-- template and active sending channel, so a follow-up cannot be composed
-- from, or sent through, another tenant.
--
-- Service-role only: it deliberately exposes bot_token.

create or replace view public.followup_candidates as
  select
    l.id            as lead_id,
    l.tenant_id,
    l.channel_type,
    l.customer_id,
    l.customer_name,
    l.last_contact,
    t.business_name,
    t.agent_name,
    c.id            as channel_id,
    c.bot_token,
    replace(
      replace(
        replace(
          coalesce(a.followup_template,
            'Hi! {agent_name} here from {business_name}. You were looking at something earlier and we still have stock. Can I help you complete your order?'),
          '{agent_name}', t.agent_name),
        '{business_name}', t.business_name),
      '{customer_name}', coalesce(l.customer_name, 'there')
    ) as message_text
  from public.leads l
  join public.tenants t on t.id = l.tenant_id and t.status = 'active'
  left join public.agent_settings a on a.tenant_id = l.tenant_id
  join public.channels c
    on c.tenant_id = l.tenant_id
   and c.channel_type = l.channel_type
   and c.status = 'active'
   and c.bot_token is not null
  where l.last_contact is not null
    and coalesce(l.stage, 'new') not in ('won', 'lost', 'payment_verified', 'payment_claimed')
    and l.last_contact < now() - make_interval(hours => coalesce(a.followup_delay_hours, 24));

comment on view public.followup_candidates is
  'Leads due a follow-up, already joined to their own tenant identity and sending channel. Service-role only: exposes bot_token.';

revoke all on public.followup_candidates from anon, authenticated, public;
