# Shwari WhatsApp Agent

An AI-powered WhatsApp automation system and CRM dashboard for **Shwari iPhones** — a Kenyan phone shop. The bot handles customer inquiries over WhatsApp, classifies intent, escalates hot leads, and logs everything to a live admin dashboard.

---

## What This Does

| Feature | Description |
|---|---|
| **Dual WhatsApp Inbox** | Manages two separate Meta WhatsApp Cloud API numbers — one for iPhone sales (Students), one for Accessories |
| **N8N AI Agent** | N8N cloud workflow classifies customer intent, generates replies via LLM, and routes leads to the dashboard |
| **Lead Pipeline** | Admin dashboard tracks leads by stage (New → Engaged → Hot → Closed), urgency, and intent |
| **Human Handoff** | Agents can take over from the AI bot in real time, send text/photo replies directly via the dashboard |
| **Inventory Management** | Manage iPhone pricelist (general + Lipa Mdogo Mdogo payment plan) and accessories from the dashboard |
| **Payment Tracking** | Record M-Pesa/Paystack payments, send receipts, track revenue per inbox |
| **Subscription Paywall** | Monthly KES 18,000 subscription verified via Paystack; admin email gets unlimited bypass |
| **Supabase Auth** | JWT-based authentication; all dashboard API routes require a valid bearer token |

---

## Architecture

```
Meta WhatsApp Cloud API
        │
        ▼
  N8N Cloud Workflows  ←──── workflows/n8n/
        │
        ▼
  Express API (server.ts)
        │
        ├── src/db.ts      → pg pool → Supabase PostgreSQL
        ├── src/config.ts  → environment variable config
        └── React Frontend (src/App.tsx) via Vite middleware
```

---

## Technology Stack

| Layer | Technology |
|---|---|
| Backend | Node.js · Express · TypeScript |
| Frontend | React 19 · Vite · TailwindCSS v4 |
| Database | Supabase (PostgreSQL via `pg` pool) |
| Auth | Supabase Auth (JWT) |
| Automation | N8N (cloud-hosted) |
| WhatsApp | Meta WhatsApp Cloud API v25 |
| Payments | Paystack |
| Deployment | Vercel (serverless via `api/index.ts` adapter) |

---

## Repository Structure

```text
shwariautomatedbot/
├── .env.example          # Variable names — copy to .env and fill in
├── .gitignore
├── vercel.json           # Vercel routing config
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html            # Vite SPA entry
│
├── server.ts             # Express server — all API routes (entry point)
│
├── api/
│   └── index.ts          # Vercel serverless adapter
│
├── src/
│   ├── App.tsx           # React dashboard (all pages/components)
│   ├── main.tsx          # React entry point
│   ├── index.css         # Global styles
│   ├── config.ts         # Centralized env config object
│   └── db.ts             # pg pool, initDb() (auto-creates tables)
│
├── database/
│   ├── schema/
│   │   ├── supabase_schema.sql       # Base table definitions + RLS
│   │   └── payments_schema.sql       # Payments table + indexes
│   └── migrations/
│       └── migration_*.sql           # Incremental schema changes
│
├── workflows/
│   └── n8n/
│       ├── n8n-workflow-main.json          # Main WhatsApp AI agent workflow
│       └── n8n-workflow-dashboard-api.json # Dashboard webhook helper
│
├── scripts/
│   ├── init-db-script.ts       # One-time DB init script
│   ├── run-migration-script.ts # Runs a specific migration
│   └── test-accessories-api.ts # Dev utility — test accessories CRUD
│
└── docs/
    └── dashboard-standalone.html  # Standalone dashboard HTML (no server needed)
```

---

## Local Setup

### Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com) project
- A [Meta WhatsApp Business](https://developers.facebook.com) app with phone number(s)
- An [N8N](https://n8n.io) instance (cloud or self-hosted)

### 1. Clone and Install

```bash
git clone <repo-url>
cd shwariautomatedbot
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Open `.env` and fill in all values. See the [Environment Variables](#environment-variables) section below.

### 3. Run the App

```bash
npm run dev
```

Dashboard runs at **http://localhost:3000**

The server auto-creates all database tables on first run via `src/db.ts → initDb()`.

---

## Environment Variables

| Variable | Description |
|---|---|
| `PORT` | Server port (default: 3000) |
| `SUPABASE_DATABASE_URL` | Full Postgres connection string |
| `SUPABASE_URL` | Supabase project REST URL |
| `SUPABASE_ANON_KEY` | Supabase public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server only, never expose) |
| `N8N_API_URL` | N8N workflow URL (for display in settings) |
| `N8N_WEBHOOK_STUDENTS` | N8N webhook for Students inbox routing |
| `N8N_WEBHOOK_ACCESSORIES` | N8N webhook for Accessories inbox routing |
| `N8N_WEBHOOK_SEND_RECEIPT` | N8N webhook to trigger receipt delivery |
| `WHATSAPP_TOKEN_STUDENTS` | Meta permanent token for Students phone number |
| `WHATSAPP_ID_STUDENTS` | Phone Number ID for Students inbox |
| `WHATSAPP_TOKEN_ACCESSORIES` | Meta permanent token for Accessories phone number |
| `WHATSAPP_ID_ACCESSORIES` | Phone Number ID for Accessories inbox |
| `PAYSTACK_PUBLIC_KEY` | Paystack public key (frontend) |
| `PAYSTACK_SECRET_KEY` | Paystack secret key (server only) |
| `ADMIN_EMAIL` | Admin account email (seeded into Supabase Auth on startup) |
| `ADMIN_PASSWORD` | Admin account password |
| `ADMIN_FULL_NAME` | Admin display name |

---

## N8N Workflows

Import the workflows from `workflows/n8n/` into your N8N instance:

1. Open N8N → **Import from File**
2. Import `n8n-workflow-main.json` — the main WhatsApp AI agent
3. Import `n8n-workflow-dashboard-api.json` — dashboard data webhook helper
4. Update all credential nodes with your Supabase and WhatsApp API keys
5. Copy the generated webhook URLs into your `.env`

---

## Database

The schema is auto-applied on server startup via `src/db.ts`. For manual or incremental changes:

- **Initial schema**: `database/schema/supabase_schema.sql`
- **Payments schema**: `database/schema/payments_schema.sql`
- **Incremental migrations**: `database/migrations/migration_*.sql`

Run a specific migration:

```bash
npx tsx scripts/run-migration-script.ts
```

---

## Deployment (Vercel)

The `api/index.ts` file is the Vercel serverless adapter. `vercel.json` routes:

- `/api/*` → Express routes
- `/*` → React SPA (`index.html`)

Do **not** commit `vercel.env` — it contains production secrets. Set environment variables directly in the Vercel dashboard.

---

## Security Notes

- All API routes (except `/api/public-env` and `/api/webhooks/increment-unread`) require a valid Supabase JWT via `Authorization: Bearer <token>`
- Admin-only routes check against `ADMIN_EMAIL` env var
- WhatsApp tokens, database passwords, and Paystack keys must **never** be committed — they belong in `.env` only
- `vercel.env` is gitignored and should never be pushed
