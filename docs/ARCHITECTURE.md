# Multi-tenant AI sales platform

The dashboard is the product. n8n is the automation engine. Supabase is the
system of record. Telegram and WhatsApp are channels, not the product.

```
Business owner ──> Dashboard (React) ──> Dashboard API (Express) ──> Supabase
                                                                       ▲
Customer ──> Telegram/WhatsApp ──> channel webhook ──> n8n ────────────┘
```

One n8n workflow (`5jnXTH4jhXo3pJAs`) serves every tenant. There is never a
workflow per business.

## Tenancy

`tenant_id` is **never** accepted from a client. It is derived:

| Surface | How the tenant is resolved |
|---|---|
| Dashboard API | verified Supabase JWT → `tenant_users.user_id` → `tenant_id` |
| n8n inbound | `X-Telegram-Bot-Api-Secret-Token` header → `channels.secret_token` → `tenant_id` |

The API rejects any request carrying `tenant_id` in the body or query with a
400. A user in several tenants may pass `x-tenant-id`, but only a value that
already appears in their own memberships.

Customer identity is `tenant_id + channel_type + customer_id`. Never phone
number alone — `leads` and `conversations` are both uniquely keyed that way.

## Two layers of isolation

1. Every API query filters `.eq('tenant_id', ctx.tenantId)` explicitly.
2. Every query runs through a Supabase client carrying the caller's JWT, so
   RLS applies independently. A missed filter in application code still
   cannot cross a tenant boundary.

Run `supabase/tests/tenant_isolation.sql` to verify. It impersonates the
`authenticated` role and sets `request.jwt.claims`, exercising the real
policies, and pairs every negative assertion with a positive control.

## Secrets

`channels.secret_token`, `channels.bot_token`, `channels.credentials_ref` and
`tenants.api_key_hash` are not granted to `anon` or `authenticated` at the
column level. The dashboard reads channels through `public.channels_safe`,
which reduces them to booleans. Bot tokens exist only in the database and in
the server process; they are never returned to the browser after saving.

## Payments

The AI records an unverified **claim**. It cannot verify one. This is enforced
by `payments_verification_guard`, a database trigger that rejects any write
setting `verification_status = 'verified'` unless `verified_by` is a real
staff user of the same tenant — so it binds the service-role/n8n path too, not
only the dashboard.

Flow: claim recorded `unverified` → dashboard shows it → staff verifies →
`verified` → receipt can be issued. A receipt for a non-verified payment is
refused with a 409.

## Dashboard API

All routes are under `/api`, all require `Authorization: Bearer <supabase jwt>`
except `/api/health` and `/api/public-config`.

| Method | Path | Notes |
|---|---|---|
| POST | `/bootstrap` | creates tenant + owner membership after signup |
| GET | `/me` | user, role, tenant, memberships |
| GET/PATCH | `/team`, `/team/:id` | admin only |
| GET | `/overview` | tiles, recent conversations and leads |
| GET | `/conversations` | filters: search, channel_type, status, handled_by, unread; paginated |
| GET | `/conversations/:id` | thread, lead, payments |
| POST | `/conversations/:id/read` | clear unread |
| POST | `/conversations/:id/takeover` | `{ai_enabled}` — flips whether n8n replies |
| POST | `/conversations/:id/reply` | staff reply, dispatched by channel type |
| GET | `/analytics?days=` | time series + totals, real data only |
| GET | `/onboarding` | setup checklist, completion computed server-side |
| GET | `/leads` | filters: stage, channel_type, search |
| GET | `/leads/stages` | stage vocabulary, so the UI never hardcodes it |
| GET | `/leads/:id` | lead detail: conversation, orders, payments, timeline |
| PATCH | `/leads/:id` | stage, notes, assignment (assignee must be a tenant member) |
| GET/POST/PUT/DELETE | `/products`, `/products/:id` | delete archives; `?hard=true` for admins |
| GET/PUT | `/agent` | agent settings |
| GET/PUT | `/business` | tenant record; PUT is admin only |
| GET | `/channels` | via `channels_safe` |
| POST | `/channels/telegram` | connect a bot |
| GET | `/channels/:id/status` | webhook health |
| DELETE | `/channels/:id` | unregister and clear secrets |
| POST | `/channels/whatsapp` | 501, lists the credentials still required |
| GET | `/payments` | filter by `verification_status` |
| POST | `/payments/:id/verify` | `{decision: verified\|rejected}`; `verified_by` comes from the session |
| POST | `/payments/:id/receipt` | requires a verified payment |
| GET/POST/PATCH | `/orders`, `/orders/:id` | |

Roles: `viewer` read-only, `member` writes, `admin`/`owner` also manage
business settings, channels and team.

## Channel connection (Telegram)

1. Owner pastes a BotFather token into the dashboard.
2. Server calls `getMe` to validate it and learn the bot id.
3. Server mints a 32-byte CSPRNG webhook secret.
4. Server calls `setWebhook` against `N8N_TELEGRAM_WEBHOOK_URL` with that secret.
5. Row written to `channels` with `status='active'`.
6. Token never returned to the browser.

`channels` has `UNIQUE (channel_type, channel_account_id)`, so one bot cannot
be claimed by two tenants.

WhatsApp is modelled but not implemented. `POST /api/channels/whatsapp`
returns 501 listing exactly what Meta credentials are required. Nothing is
faked.

## n8n workflow shape

```
Telegram Inbound (webhook /telegram-in)
  → Resolve Channel        (secret header → tenant)
  → Load Tenant Config
  → Load Agent Settings
  → Guard Tenant
  → Load Conversation State
  → AI Still Handling?     (false when staff took over → stop)
  → Extract Message Data
  → Sales Agent            (Product Tool, tenant-scoped memory)
  → Prepare Reply
  → Send Reply             (tenant's own bot token)
  → Log Conversation       (legacy conversation_logs, kept for compatibility)
  → Upsert Conversation    (normalized, primary)
  → Log Conversation Messages
  → Check Existing Lead → Create/Update Lead
  → Is Payment? → Record Payment Claim (unverified) → Payment Alert
              └→ Notify Admin          (tenant's notification_target)
```

Follow-ups read `public.followup_candidates`, a view that applies each
tenant's own `followup_delay_hours` and composes the message from that
tenant's own `agent_name`, `business_name` and template. The branch is
currently **disabled** pending end-to-end testing.

## Frontend structure

```
src/
  app/        router + session context (tenant resolution, badge counts)
  components/ ui/ design system, Chart, OnboardingChecklist
  hooks/      useAsync, useMutation, useDebounced, useIsMobile, useVisiblePolling
  layouts/    AppShell: sidebar, topbar, mobile drawer
  lib/        api/ typed client, format helpers
  pages/      one file per route
  types/      shared API types
```

Routing is `react-router-dom` with real URLs. Every list state that matters
(inbox search, unread filter, selected conversation) lives in the URL.

Responsive: below 768px the sidebar becomes a drawer and the inbox becomes a
list-to-detail flow. Tables become cards on Leads, Orders and Payments.

`legacy/` holds the previous single-tenant application for reference. Nothing
in `src/` imports from it, and the build excludes it.

## Environment

See `.env.example`. The server refuses to start unless `SUPABASE_URL`,
`SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are all set — it will not
serve an unauthenticated API.
