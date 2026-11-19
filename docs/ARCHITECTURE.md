# Multi-Tenant AI Workforce Platform Architecture

The dashboard is the management portal. The native Express server and native AI workforce engine (`src/server/ai/`, NVIDIA-hosted model) handle inbound conversations and operational workflows. Supabase is the system of record with PostgreSQL Row-Level Security (RLS). WhatsApp, Instagram, Telegram, and WebChat are integrated channels.

```
Business owner ──> Dashboard (React) ──> Dashboard API (Express) ──> Supabase
                                                                       ▲
Customer ──> WhatsApp / IG / Telegram / WebChat ──> Native Webhooks (Express) ──> AI Workforce Engine ──> Supabase
```

Native Express webhooks (`/api/webhooks/meta`, `/api/webhooks/telegram`, `/api/webchat/messages`) serve all tenants with zero external workflow tools.

## Tenancy

`tenant_id` is **never** accepted from a client. It is derived:

| Surface | How the tenant is resolved |
|---|---|
| Dashboard API | verified Supabase JWT → `tenant_users.user_id` → `tenant_id` |
| Telegram inbound | `X-Telegram-Bot-Api-Secret-Token` header → `channels.secret_token` → `tenant_id` |
| Meta inbound (WhatsApp/IG) | HMAC-SHA256 signature verification + Phone/Page ID lookup → `tenant_id` |
| WebChat inbound | Cryptographic visitor token & session lookup → `tenant_id` |

The API rejects any request carrying `tenant_id` in the body or query with a
400. A user in several tenants may pass `x-tenant-id`, but only a value that
already appears in their own memberships.

Customer identity is `tenant_id + channel_type + customer_id`. Never phone
number alone — `leads` and `conversations` are both uniquely keyed that way.

## Two layers of isolation

1. Every API query filters `.eq('tenant_id', ctx.tenantId)` explicitly.
2. Dashboard routes (catalog, commerce, inbox, operations, analytics, team)
   run through a Supabase client carrying the caller's JWT, so RLS applies
   independently. A missed filter there still cannot cross a tenant boundary.

The exception is code that has no user session or must cross RLS on purpose:
webhooks, the AI agent and its tools, onboarding, the Shwari routes and the
admin QA routes use the service-role client. There the explicit `tenant_id`
filter is the only layer, so every such query must carry one. The tenant always
comes from the verified session or the resolved channel, never from the client.

Rules that must hold even for someone calling PostgREST directly are enforced
in the database (`20261119_0018_authz_hardening.sql`): membership roles, QA
labels, payment verification and agent configuration.

Run `supabase/tests/tenant_isolation.sql` to verify. It seeds its own two
tenants inside a transaction and rolls back, impersonates the `authenticated`
role with `request.jwt.claims` to exercise the real policies and triggers, and
pairs every denial with a positive control.

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
staff user of the same tenant — so it binds the service-role path (the AI
agent) too, not only the dashboard. A signed-in user can only attest as
themselves, and the amount of a verified payment cannot be changed.

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
| POST | `/conversations/:id/takeover` | `{ai_enabled}` — flips whether the AI replies |
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
business settings, channels, agents and team. Only an `owner` can grant or
remove `owner`; nobody can change their own role; a workspace always keeps at
least one owner.

## Channels

Each channel is a provider under `src/server/channels/providers/` (Telegram,
WhatsApp, Instagram, web chat). Connecting one validates the credentials with
the platform, mints a per-channel webhook secret, registers the webhook against
this API and writes a `channels` row. Secrets are never returned to the browser.

`channels` has `UNIQUE (channel_type, channel_account_id)`, so one account
cannot be claimed by two tenants.

## Inbound pipeline

```
Platform webhook  (/api/webhooks/meta | /api/webhooks/telegram | web chat POST)
  → authenticate          (HMAC signature / secret header / signed visitor token)
  → resolve channel       (→ tenant; the client never names a tenant)
  → claim event           (webhook_events unique key: duplicates are dropped)
  → persist message       (conversations + conversation_messages)
  → AI still handling?    (false when staff took over → stop)
  → route to a department agent and run the turn   (src/server/ai/)
  → send reply through the channel provider, store it in the transcript
```

n8n is no longer involved: there is no external workflow, and the
`N8N_*` variables are not read. Scheduled work (follow-ups, token refresh,
clean-up) is triggered by the `crons` declared in `vercel.json`, which call the
internal routes with `INTERNAL_API_SECRET`.

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
serve an unauthenticated API, and there are no built-in fallback values. Set
`CORS_ORIGIN` in production. `SUPER_ADMIN_EMAILS` (comma-separated) names the
operators who may read agent turns across tenants; it only matches accounts
whose email address has been confirmed.
