# Shwari AI Workforce Platform

An autonomous, multi-tenant AI workforce platform for commerce, operations, customer support, and appointment scheduling across WhatsApp, Instagram, Telegram, and WebChat.

Powered by a native Express backend, Supabase Row-Level Security (PostgreSQL), and an NVIDIA Moonshot LLM reasoning core (`moonshotai/kimi-k3`) executing under strict zero-hallucination guardrails.

---

## 📁 Codebase Architecture & Directory Map

The codebase is organized into clean, decoupled layers following modern full-stack TypeScript conventions:

```
shwariautomatedbot/
├── index.html                   # HTML entrypoint for the Single Page Application (SPA)
├── server.ts                    # Root Node.js entrypoint (Express + Vite dev middleware)
├── vite.config.ts               # Vite bundler, React plugin, Tailwind CSS v4, manualChunks
├── tsconfig.json                # TypeScript compiler configuration (ES2022, bundler module resolution)
├── package.json                 # Project dependencies, scripts, and runtime configuration
├── metadata.json                # Application metadata
├── .env.example                 # Environment variable templates and security documentation
│
├── api/                         # Serverless entrypoint
│   └── index.ts                 # Vercel serverless adapter wrapping createApp()
│
├── src/                         # All Application Source Code
│   ├── main.tsx                 # React DOM mount point (createRoot)
│   ├── App.tsx                  # Root React application component (Router & Auth gate)
│   ├── index.css                # Global stylesheet, design tokens, Tailwind v4 imports
│   │
│   ├── app/                     # Frontend App Architecture
│   │   ├── routes.tsx           # Client-side route declarations (18 pages)
│   │   └── SessionContext.tsx   # Global authentication, active tenant state & polling
│   │
│   ├── components/              # Frontend Reusable React Components
│   │   ├── ui/                  # Design System Primitives (Button, Modal, Card, Table, Drawer)
│   │   ├── ConnectChannelDialog.tsx  # Modal for connecting WhatsApp, IG, Telegram, WebChat
│   │   ├── EmbedSnippetBlock.tsx     # Copy-paste embed code generator for WebChat
│   │   ├── OnboardingChecklist.tsx   # Progress checklist for setting up business profile
│   │   ├── SetupReadinessPanel.tsx   # Diagnostics panel checking channel webhooks & keys
│   │   └── Chart.tsx                 # Analytics area & bar charts
│   │
│   ├── layouts/                 # Frontend Shell Layouts
│   │   └── AppShell.tsx         # Sidebar navigation, tenant switcher, user profile bar
│   │
│   ├── pages/                   # Frontend Page Views (18 Screens)
│   │   ├── Overview.tsx         # Dashboard KPI metrics, attention items, quick actions
│   │   ├── Inbox.tsx            # Real-time omnichannel inbox with AI takeover toggle
│   │   ├── Agents.tsx           # AI Workforce overview (5 Department Agents)
│   │   ├── AgentSettings.tsx    # Per-agent standing instruction & status configuration
│   │   ├── Appointments.tsx     # Calendar view of booked appointments & consultations
│   │   ├── Orders.tsx           # Orders pipeline, status changes, delivery tracking
│   │   ├── Payments.tsx         # Customer payment claims awaiting human verification
│   │   ├── Products.tsx         # Catalog inventory (items, pricing, stock toggles)
│   │   ├── Services.tsx         # Service catalog (pricing, duration, consultation flags)
│   │   ├── Tickets.tsx          # Escalated customer support tickets
│   │   ├── Analytics.tsx        # Revenue, customer volume, and conversion trends
│   │   ├── Leads.tsx            # CRM pipeline of prospective customers
│   │   ├── LeadDetail.tsx       # Single customer CRM view with interaction history
│   │   ├── Integrations.tsx     # Channel connection center (WhatsApp, IG, TG, WebChat)
│   │   ├── Settings.tsx         # Tenant business details, opening hours, currencies
│   │   ├── Shwari.tsx           # Direct chat interface with the Executive Assistant
│   │   ├── Onboarding.tsx       # First-run setup wizard for new tenants
│   │   └── AuthScreen.tsx       # Sign-in, sign-up, and password recovery
│   │
│   ├── hooks/                   # Frontend Custom React Hooks
│   │   └── index.ts             # useSession, useAsync, useMutation, useToast, useDebounced
│   │
│   ├── lib/                     # Frontend Shared Utilities & API Client
│   │   ├── format.ts            # Currency, relative time, and phone formatters
│   │   └── api/                 # Typed REST API client communicating with Express backend
│   │       ├── client.ts        # Fetch wrapper with tenant header injection & auth
│   │       └── index.ts         # High-level API methods (getOrders, updateAgent, etc.)
│   │
│   ├── types/                   # Frontend Shared TypeScript Interfaces
│   │   └── index.ts             # Tenant, Agent, Lead, Appointment, Order, Ticket schemas
│   │
│   └── server/                  # BACKEND ARCHITECTURE (Node.js + Express)
│       ├── app.ts               # Express factory (CORS, body parsers, routes, error handlers)
│       ├── auth.ts              # JWT authentication & tenant isolation (rejectClientTenantId)
│       ├── supabase.ts          # Supabase client singletons (service-role & anon)
│       │
│       ├── config/              # Server Configuration
│       │   └── meta.ts          # Meta Graph & Instagram OAuth URLs and keys
│       │
│       ├── routes/              # REST API Controllers
│       │   ├── auth/            # Meta & Instagram OAuth callbacks
│       │   ├── channels/        # Channel configuration & status checks
│       │   ├── webhooks/        # Inbound webhooks for Meta (WhatsApp/IG) & Telegram
│       │   ├── admin.ts         # Business metrics & pairing code endpoints
│       │   ├── appointments.ts  # Appointments CRUD
│       │   ├── orders.ts        # Orders & payment claim endpoints
│       │   ├── products.ts      # Products inventory CRUD
│       │   ├── services.ts      # Services catalog CRUD
│       │   ├── shwari.ts        # Executive manager chat endpoint
│       │   ├── webchat.ts       # Public WebChat session & message endpoints
│       │   └── ...              # Leads, tickets, messages, analytics, setup
│       │
│       ├── services/            # Backend Business Services
│       │   ├── inbound.ts       # Message normalization, lead deduplication & routing
│       │   ├── tenantSetup.ts   # Initial provisioning of business defaults
│       │   └── meta/            # Meta API drivers (WhatsApp Cloud API, Instagram Graph API)
│       │       ├── whatsapp.ts  # WhatsApp message dispatch & embedded signup
│       │       ├── instagram.ts # Instagram DM dispatch
│       │       └── tokens.ts    # AES-256-GCM token encryption & decryption
│       │
│       ├── channels/            # Omnichannel Abstraction Layer
│       │   ├── providers/       # Channel provider interfaces (WhatsApp, IG, TG, WebChat)
│       │   ├── meta/            # Meta signature (HMAC-SHA256) validation & event parsers
│       │   ├── telegram/        # Telegram Bot API driver & secret token verification
│       │   └── webchat/         # Visitor token issuance, session cookies & rate limits
│       │
│       └── ai/                  # AI WORKFORCE & LLM ENGINE
│           ├── llm.ts           # NVIDIA Moonshot AI completion client & tool-calling loop
│           ├── agent.ts         # Agent turn runner (runAgentTurn), system prompt & memory
│           ├── roles.ts         # 5 Agent Blueprints, Universal Rules, Zero-Hallucination
│           ├── router.ts        # Intent classification & department routing
│           ├── admins.ts        # Mobile pairing code generator for owner chat
│           │
│           ├── tools/           # 42 Autonomous Operational Tools
│           │   ├── business.ts  # Profile, hours, facts, knowledge gaps, payment instructions
│           │   ├── operations.ts# Appointments (clash-free booking), orders, payment claims
│           │   ├── insight.ts   # Customer details, stage transitions, handover
│           │   ├── team.ts      # Workforce management (configure/activate agents)
│           │   ├── admin.ts     # Business metrics & attention items
│           │   ├── delegate.ts  # Cross-department task delegation
│           │   └── types.ts     # Tool runner execution & validation framework
│           │
│           └── __tests__/       # Comprehensive Automated Test Suites
│               ├── tools.test.mjs    # Security guarantees, permissions & tool catalogue
│               ├── endToEnd.test.mjs # Multi-turn conversational flow & DB mutation tests
│               └── ...               # Unit tests for prompt, routing, and operations
│
├── supabase/                    # Database & Schema Architecture
│   ├── migrations/              # SQL migrations (Tenants, RLS policies, Agents, Ops)
│   └── tests/                   # SQL tests for tenant isolation & security
│
├── scripts/                     # Operational & Diagnostic Utilities
│   └── whatsapp-check.cjs       # Diagnostic script for Meta WhatsApp credentials
│
└── archive/                     # Historical Migrations & Single-Tenant Artifacts
```

---

## 🧠 Where the LLM Logic Lies (`src/server/ai/`)

The intelligence engine is located in `src/server/ai/`. It is built around zero hallucination, strict function calling, and deterministic business rules:

1. **`llm.ts` (LLM Client)**:
   - Connects to NVIDIA's AI Foundation endpoints (`https://integrate.api.nvidia.com/v1`).
   - Default model: `moonshotai/kimi-k3` (with deep reasoning capability).
   - Handles multi-turn chat completions, function/tool schema generation, and tool response processing.
   - Built with configurable token limits (`SHWARI_MAX_TOKENS`) and execution timeouts (`SHWARI_TIMEOUT_MS`).

2. **`agent.ts` (Agent Turn Runtime)**:
   - Contains `runAgentTurn()`, the core execution loop.
   - Builds dynamic system prompts compiling:
     - Business orientation (name, description, timezone, currency, recorded services).
     - Customer memory (recalled customer name, phone, email from prior leads).
     - Conversation history (short-term window of recent customer/agent messages).
     - Universal platform rules and role-specific constraints.
   - Executes up to 5 tool-calling rounds per turn.
   - Audits every single tool invocation into the `agent_tool_calls` table.

3. **`roles.ts` (The 5 Agent Workforce)**:
   - Defines the blueprints for the 5 immutable business departments:
     - **`manager` (Shwari)**: Executive assistant to the business owner.
     - **`sales`**: Catalog recommendations, quotes prices only from verified tools, creates orders.
     - **`support`**: Answers customer questions, cannot quote prices, reads verified payment methods, opens support tickets.
     - **`booking`**: Checks calendar availability (`list_appointments`), prevents clashes, executes bookings (`book_appointment`).
     - **`orders`**: Answers order status, reads exact payment instructions, records unverified payment claims for staff to review.
   - Enforces **Universal Rules**:
     - *Zero Hallucination Policy*: Only state facts returned directly by tools.
     - *Price & Availability Guardrail*: Never invent prices, hours, or calendar slots.
     - *Payment Integrity Guarantee*: No agent can ever confirm that a payment was received; every payment claim must be verified by a human staff member.

4. **`tools/` (The 42 Operational Tools)**:
   - Real, executable TypeScript tools that interact with Supabase tables.
   - Tools are gated per role—an agent can only invoke tools in its whitelist.
   - Tenant isolation is strictly enforced at the runner layer (`ctx.tenantId`), meaning an LLM cannot access or mutate data from another business.

---

## 💻 Where the Frontend Code Lies (`src/`)

The frontend is a modern React 19 Single Page Application bundled with Vite and styled with Tailwind CSS v4:

- **Root & Routing**:
  - `src/main.tsx` mounts the React application to the DOM.
  - `src/App.tsx` sets up the `BrowserRouter`, authentication listener, and `SessionProvider`.
  - `src/app/routes.tsx` configures the route table for all 18 dashboard views.
- **State & Context**:
  - `src/app/SessionContext.tsx` manages active user authentication, the currently selected tenant, user permissions, and real-time polling for unread messages and notifications.
- **Views & Screens (`src/pages/`)**:
  - `Inbox.tsx`: Unified live chat viewer across all connected messaging channels.
  - `Agents.tsx` & `AgentSettings.tsx`: Workforce status, capabilities, and standing instructions.
  - `Appointments.tsx`: Day-grouped calendar diary showing upcoming bookings.
  - `Orders.tsx` & `Payments.tsx`: Commerce pipelines and payment verification queues.
  - `Products.tsx` & `Services.tsx`: Offerings catalog with custom pricing and duration.
  - `Shwari.tsx`: Chat interface for business owners to talk directly with their AI manager.
- **UI System (`src/components/ui/`)**:
  - Clean, accessible component primitives: `Button`, `Card`, `Modal`, `Drawer`, `Badge`, `Input`, `Select`, `Table`, `Tabs`, `LoadingState`, and `EmptyState`.

---

## ⚙️ Where the Backend Code Lies (`src/server/`)

The backend is an Express Node.js application acting as the API gateway and webhook ingestion pipeline:

- **Server Entrypoint**:
  - `server.ts` starts the HTTP listener on port 3000, runs Vite in middleware mode during development, and serves static build assets in production.
  - `src/server/app.ts` registers global middlewares (CORS, JSON parsers, security headers) and mounts the API routers under `/api`.
- **Authentication & Security**:
  - `src/server/auth.ts` verifies Supabase JWTs and injects tenant context. It strictly rejects any user-supplied `tenant_id` query/body parameters to guarantee tenant isolation.
- **Messaging Channel Providers (`src/server/channels/` & `src/server/services/meta/`)**:
  - **WhatsApp**: Direct webhook parsing, HMAC validation, and message sending via Meta Cloud API. Includes Embedded Signup OAuth.
  - **Instagram**: Native Meta Webhook verification, token encryption (`tokens.ts`), and Graph API messaging.
  - **Telegram**: Webhook handler with `X-Telegram-Bot-Api-Secret-Token` verification and automatic webhook registration.
  - **WebChat**: Public visitor token issuance, session tracking, and sliding-window rate limiting.

---

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js**: v20 or v22+
- **Supabase Account**: A Supabase project with Row-Level Security enabled.
- **NVIDIA AI API Key**: NVIDIA NIM API key for LLM inference.

### 2. Environment Configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Fill in the required variables:
- `SUPABASE_URL` & `SUPABASE_ANON_KEY` & `SUPABASE_SERVICE_ROLE_KEY`
- `SHWARI_API_KEY` (NVIDIA API key: `nvapi-...`)
- `SHWARI_MODEL=moonshotai/kimi-k3`
- `SHWARI_API_BASE=https://integrate.api.nvidia.com/v1`
- `INTERNAL_API_SECRET`, `META_TOKEN_ENCRYPTION_KEY`, `META_VERIFY_TOKEN`

### 3. Installation & Development
```bash
# Install dependencies
npm install

# Run the development server (Express API + Vite HMR on http://localhost:3000)
npm run dev

# Run TypeScript compilation check
npm run lint

# Run automated AI test suites
npx tsx src/server/ai/__tests__/tools.test.mjs
npx tsx src/server/ai/__tests__/endToEnd.test.mjs
```
