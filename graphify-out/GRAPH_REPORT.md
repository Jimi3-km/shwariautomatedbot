# Graph Report - .  (2026-09-27)

## Corpus Check
- 168 files · ~145,021 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1068 nodes · 2765 edges · 66 communities (56 shown, 10 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 24 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Server Entrypoint & Express Bootstrap
- Onboarding & Lead Filters UI
- Dashboard UI Components & Tables
- Admin Link & Pairing Verification
- React App & Session Routing
- Meta Webhooks & Cryptographic Signatures
- Channel Connect & Embed Widgets
- React Hooks & Mutation States
- TypeScript Configuration & Targets
- Catalog Form Controls & Services UI
- Client API Client & Bootstrap
- Shwari Dashboard Chat Client
- Build Tooling & Tailwind Config
- Navigation Drawers & Buttons
- Runtime Core Dependencies
- Agent QA & Telemetry Evaluation
- WhatsApp Cloud Channel Provider
- Inbound Channel Parsers & Media
- Instagram Channel Provider
- Business Profile & Knowledge Tools
- Appointments & Operations Tools
- Agent Turn Runtime & Memory
- Role System Prompts & Directives
- Workforce Provisioning & Roles
- NVIDIA NIM Multi-Model Gateway
- Setup Readiness & Telegram Integration
- Tool RBAC & Security Tests
- Rate Limiting & Abuse Defense
- Product Catalog Management UI
- Catalog Tools & Business Insights
- Dashboard Reads & Agent Handover
- Agent Delegation & Execution Context
- Telegram Channel & Webhook Dispatch
- App Shell & Dashboard Navigation
- Multi-Step Operations Planner
- End-to-End Workforce Tests
- Package Manifest & NPM Scripts
- Appointments UI & Diary Calendar
- Agent QA Evaluation Dashboard
- Encrypted Token Vault & Security
- Omnichannel Provider Base Interfaces
- Workforce Architecture & Guardrails
- Brevo Email Notifications
- Admin QA Endpoints Tests
- Channel Routing Integration Tests
- Channel Provider Registry
- Admin Controls & Conversation Handling
- Webchat Widget Security & Resolvers
- Operations Tools Validation Tests
- HTML Receipts & Invoicing
- OAuth State & CSRF Tokens
- Tenant Provisioning & Setup
- Dashboard Metric Visualizations
- Webchat Pipeline Test Harness
- Vite Bundler Configuration
- WhatsApp Diagnostics CLI
- Subsystem Community 56
- Subsystem Community 57
- Subsystem Community 58
- Subsystem Community 59
- Subsystem Community 60
- Subsystem Community 61
- Subsystem Community 62

## God Nodes (most connected - your core abstractions)
1. `request()` - 76 edges
2. `useSession()` - 47 edges
3. `useAsync()` - 40 edges
4. `useMutation()` - 37 edges
5. `serviceClient` - 36 edges
6. `useToast()` - 34 edges
7. `Button()` - 23 edges
8. `LoadingState()` - 20 edges
9. `formatMoney()` - 20 edges
10. `runAgentTurn()` - 20 edges

## Surprising Connections (you probably didn't know these)
- `Multi-Model NIM Gateway` --implements--> `resolveModel()`  [INFERRED]
  docs/AGENT_ARCHITECTURE.md → src/server/ai/llm.ts
- `Agent Turn Reasoning Loop` --implements--> `runAgentTurn()`  [INFERRED]
  docs/HOW_THE_LLM_WORKS.md → src/server/ai/agent.ts
- `Five-Role Agent Workforce` --implements--> `AGENT_BLUEPRINTS`  [INFERRED]
  docs/AGENT_ARCHITECTURE.md → src/server/ai/roles.ts
- `Agent QA Evaluation Framework` --implements--> `logAgentTurn()`  [INFERRED]
  docs/AGENT_QA.md → src/server/security/eval.ts
- `handleEvents()` --indirect_call--> `event()`  [INFERRED]
  src/server/routes/webhooks/meta.ts → src/server/channels/meta/__tests__/routing.test.mjs

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Shwari Autonomous Workforce Core Flow** — docs_agent_architecture_three_layer_engine, docs_agent_architecture_workforce_roles, docs_how_the_llm_works_reasoning_loop, docs_agent_qa_evaluation_framework [EXTRACTED 1.00]

## Communities (66 total, 10 thin omitted)

### Community 0 - "Server Entrypoint & Express Bootstrap"
Cohesion: 0.06
Nodes (41): app, PORT, createApp(), bearer(), Express, handler(), isSuperAdmin(), rejectClientTenantId() (+33 more)

### Community 1 - "Onboarding & Lead Filters UI"
Cohesion: 0.06
Nodes (54): OnboardingChecklist(), ConversationFilters, LeadFilters, AgentActivity, AgentConfig, AgentRole, AgentSettings, AgentStatus (+46 more)

### Community 2 - "Dashboard UI Components & Tables"
Cohesion: 0.12
Nodes (35): Avatar(), FilterChip(), LoadingState(), Pagination(), TableWrap(), useAsync(), useDebounced(), useIsMobile() (+27 more)

### Community 3 - "Admin Link & Pairing Verification"
Cohesion: 0.11
Nodes (32): AdminLink, findAdmin(), IssuedCode, issuePairingCode(), looksLikePairingCode(), newCode(), redeemPairingCode(), RedeemResult (+24 more)

### Community 4 - "React App & Session Routing"
Cohesion: 0.09
Nodes (29): App(), arrivedForPasswordReset(), router, Counts, Ctx, SessionProvider(), SessionValue, signOutOfSupabase() (+21 more)

### Community 5 - "Meta Webhooks & Cryptographic Signatures"
Cohesion: 0.09
Nodes (32): SignatureResult, verifyChallenge(), verifyMetaSignature(), ConfigGap, gap(), INSTAGRAM_AUTHORIZE_URL, INSTAGRAM_GRAPH_URL, INSTAGRAM_OAUTH_URL (+24 more)

### Community 6 - "Channel Connect & Embed Widgets"
Cohesion: 0.07
Nodes (30): ConnectChannelDialog(), Copy, EmbedSnippetBlock(), completeOnboarding(), createOnboardingBusiness(), disconnectChannel(), getOnboardingState(), saveOnboardingAgent() (+22 more)

### Community 7 - "React Hooks & Mutation States"
Cohesion: 0.10
Nodes (29): Input, Tabs(), useToast(), AsyncState, useMutation(), cancelFollowUp(), createTicket(), getBusiness() (+21 more)

### Community 8 - "TypeScript Configuration & Targets"
Cohesion: 0.07
Nodes (28): api, dist, DOM, DOM.Iterable, ES2022, legacy, node, node_modules (+20 more)

### Community 9 - "Catalog Form Controls & Services UI"
Cohesion: 0.11
Nodes (21): Field(), InlineError(), Select(), Textarea, archiveService(), getAgents(), getAgentSettings(), updateAgentSettings() (+13 more)

### Community 10 - "Client API Client & Bootstrap"
Cohesion: 0.12
Nodes (26): qs(), request(), bootstrapTenant(), createService(), deleteProduct(), deleteService(), getAgentActivity(), getAgentTurns() (+18 more)

### Community 11 - "Shwari Dashboard Chat Client"
Cohesion: 0.10
Nodes (18): createPairingCode(), getAttention(), getLinkedAdmins(), getShwariHistory(), getShwariStatus(), sendToShwari(), unlinkAdmin(), ACTION_LABELS (+10 more)

### Community 12 - "Build Tooling & Tailwind Config"
Cohesion: 0.08
Nodes (25): autoprefixer, cross-env, devDependencies, autoprefixer, cross-env, tailwindcss, tsx, @types/cors (+17 more)

### Community 13 - "Navigation Drawers & Buttons"
Cohesion: 0.11
Nodes (19): ButtonProps, ButtonSize, ButtonVariant, Drawer(), EmptyState(), ErrorState(), FieldWrapProps, Modal() (+11 more)

### Community 14 - "Runtime Core Dependencies"
Cohesion: 0.09
Nodes (23): axios, cors, lucide-react, motion, multer, dependencies, axios, cors (+15 more)

### Community 15 - "Agent QA & Telemetry Evaluation"
Cohesion: 0.11
Nodes (13): detectLanguage(), main(), TurnLabel, AgentTurnEvaluation, ConflictError, TenantExport, assertSupabaseConfigured(), getServiceClient() (+5 more)

### Community 16 - "WhatsApp Cloud Channel Provider"
Cohesion: 0.14
Nodes (16): url, buildEmbeddedSignupUrl(), DebugTokenResponse, discoverWabaId(), EMBEDDED_SIGNUP_EXTRAS, EMBEDDED_SIGNUP_URL, EmbeddedSignupReturn, exchangeSignupCode() (+8 more)

### Community 17 - "Inbound Channel Parsers & Media"
Cohesion: 0.21
Nodes (16): asArray(), asObject(), asString(), instagramMedia(), Json, parseInstagram(), parseMetaWebhook(), parseWhatsApp() (+8 more)

### Community 18 - "Instagram Channel Provider"
Cohesion: 0.19
Nodes (13): CallbackResult, ConnectContext, ConnectedAccount, ConnectMode, ConnectStart, CredentialField, EmbedSnippet, HealthReport (+5 more)

### Community 19 - "Business Profile & Knowledge Tools"
Cohesion: 0.11
Nodes (18): DAYS, FACT_CATEGORIES, getBusinessProfile, getOpeningHours, getPaymentInstructions, listKnowledgeGaps, listServices, recordKnowledgeGap (+10 more)

### Community 20 - "Appointments & Operations Tools"
Cohesion: 0.19
Nodes (17): ALL, bookAppointment, cancelAppointment, cancelFollowUp, escalateToHuman, listAppointments, listFollowUps, listOrders (+9 more)

### Community 21 - "Agent Turn Runtime & Memory"
Cohesion: 0.19
Nodes (17): AgentTurnInput, AgentTurnResult, CONVERSATION_RULES, customerContext(), fallbackReply(), history(), loadAgent(), orientation() (+9 more)

### Community 22 - "Role System Prompts & Directives"
Cohesion: 0.14
Nodes (11): AgentRow, COMMON_CONVERSATION_GUIDELINES, PromptAgentInput, ROLE_DIRECTIVES, AgentBlueprint, AgentRole, ALL_ROLES, CUSTOMER_BASICS (+3 more)

### Community 23 - "Workforce Provisioning & Roles"
Cohesion: 0.17
Nodes (13): AgentUnavailableError, ensureWorkforce(), llmConfigured(), AGENT_BLUEPRINTS, DEPARTMENTS, chooseDepartment(), AGENT_STATES, shwariRouter (+5 more)

### Community 24 - "NVIDIA NIM Multi-Model Gateway"
Cohesion: 0.16
Nodes (15): baseUrl(), complete(), CompleteOptions, Completion, DEFAULT_MAX_TOKENS, executeCompletion(), LlmError, llmModel() (+7 more)

### Community 25 - "Setup Readiness & Telegram Integration"
Cohesion: 0.20
Nodes (12): SetupReadinessPanel(), Button(), Card(), Pill(), connectTelegram(), getChannelProviders(), getChannels(), getChannelStatus() (+4 more)

### Community 26 - "Tool RBAC & Security Tests"
Cohesion: 0.12
Nodes (13): audit, CONFIGURATION_TOOLS, ctx, DASHBOARD_READS, DEPARTMENTS, exploding, registry, spy (+5 more)

### Community 27 - "Rate Limiting & Abuse Defense"
Cohesion: 0.15
Nodes (11): Bucket, buckets, rateLimit(), RateLimitResult, sweep(), issueVisitorToken(), newSiteKey(), newVisitorId() (+3 more)

### Community 28 - "Product Catalog Management UI"
Cohesion: 0.19
Nodes (12): Checkbox(), archiveProduct(), createProduct(), getProducts(), ProductInput, updateProduct(), emptyForm, FormState (+4 more)

### Community 29 - "Catalog Tools & Business Insights"
Cohesion: 0.13
Nodes (11): ctx, attentionNeeded, businessMetrics, findCustomers, LEAD_STAGES, listProducts, removeProduct, saveCustomerDetails (+3 more)

### Community 30 - "Dashboard Reads & Agent Handover"
Cohesion: 0.13
Nodes (11): getAgentSettings, getBusinessSettings, HANDLED_BY, listChannels, listConversations, listPaymentClaims, readConversation, updateAgentSettings (+3 more)

### Community 31 - "Agent Delegation & Execution Context"
Cohesion: 0.21
Nodes (11): DELEGATABLE, delegateToAgent, oneOf(), record(), runTool(), Tool, ToolOutcome, truncate() (+3 more)

### Community 32 - "Telegram Channel & Webhook Dispatch"
Cohesion: 0.29
Nodes (8): call(), deleteWebhook(), generateSecretToken(), getMe(), getWebhookInfo(), sendTelegramMessage(), setWebhook(), TelegramBotInfo

### Community 33 - "App Shell & Dashboard Navigation"
Cohesion: 0.23
Nodes (11): useSession(), AppShell(), NAV, SidebarContent(), TenantSwitcher(), TopBar(), UserMenu(), getOnboarding() (+3 more)

### Community 34 - "Multi-Step Operations Planner"
Cohesion: 0.19
Nodes (12): ToolDefinition, createAndExecutePlan(), PlanExecutionResult, PlanStep, StructuredPlan, TOOLS, Role, canUserRunTool() (+4 more)

### Community 35 - "End-to-End Workforce Tests"
Cohesion: 0.17
Nodes (5): customer(), db, owner(), rows, script

### Community 36 - "Package Manifest & NPM Scripts"
Cohesion: 0.17
Nodes (11): name, private, scripts, build, clean, dev, lint, preview (+3 more)

### Community 37 - "Appointments UI & Diary Calendar"
Cohesion: 0.29
Nodes (11): ConfirmDialog(), createAppointment(), updateAppointment(), Appointments(), dayLabel(), formatWhen(), groupByDay(), NewAppointment() (+3 more)

### Community 38 - "Agent QA Evaluation Dashboard"
Cohesion: 0.18
Nodes (11): AgentTurnFilters, AgentTurnItem, AgentTurnLabel, labelAgentTurn(), AgentQA(), CHANNELS, LABELS, PROFILES (+3 more)

### Community 39 - "Encrypted Token Vault & Security"
Cohesion: 0.25
Nodes (10): decryptToken(), deleteToken(), encryptToken(), Envelope, LoadedToken, loadKey(), loadToken(), MetaPlatform (+2 more)

### Community 41 - "Workforce Architecture & Guardrails"
Cohesion: 0.22
Nodes (9): Multi-Model NIM Gateway, Payment Verification Barrier, Three-Layer Agent Architecture, Five-Role Agent Workforce, Strict Zero-Hallucination Guardrails, Agent QA Evaluation Framework, Supabase Multi-Tenant RLS Isolation, Agent Turn Reasoning Loop (+1 more)

### Community 42 - "Brevo Email Notifications"
Cohesion: 0.31
Nodes (7): BrevoSendResult, EmailRecipient, getBrevoSender(), sendAppointmentConfirmation(), sendBrevoEmail(), SendEmailOptions, sendOrderReceipt()

### Community 43 - "Admin QA Endpoints Tests"
Cohesion: 0.22
Nodes (3): app, db, rows

### Community 44 - "Channel Routing Integration Tests"
Cohesion: 0.29
Nodes (4): db, eqValue(), event(), matches()

### Community 45 - "Channel Provider Registry"
Cohesion: 0.25
Nodes (7): isProviderId(), PROVIDER_ORDER, PROVIDERS, instagramProvider, telegramProvider, webchatProvider, whatsappProvider

### Community 46 - "Admin Controls & Conversation Handling"
Cohesion: 0.29
Nodes (4): messageCustomer, setConversationHandling, updateBusinessSettings, ToolInputError

### Community 47 - "Webchat Widget Security & Resolvers"
Cohesion: 0.33
Nodes (3): WIDGET_SOURCE, ResolvedWebchat, webchatRouter

### Community 48 - "Operations Tools Validation Tests"
Cohesion: 0.40
Nodes (4): inConversation, noConversation, reachedTheDatabase(), rejects()

### Community 49 - "HTML Receipts & Invoicing"
Cohesion: 0.53
Nodes (5): esc(), money(), ReceiptInput, receiptsRouter, renderReceiptHtml()

### Community 50 - "OAuth State & CSRF Tokens"
Cohesion: 0.53
Nodes (5): createOAuthState(), OAuthStatePayload, secret(), sign(), verifyOAuthState()

### Community 51 - "Tenant Provisioning & Setup"
Cohesion: 0.53
Nodes (5): CreatedTenant, createTenantForUser(), CreateTenantInput, slugify(), uniqueSlug()

### Community 52 - "Dashboard Metric Visualizations"
Cohesion: 0.50
Nodes (3): AreaChart(), BarList(), SeriesPoint

### Community 54 - "Vite Bundler Configuration"
Cohesion: 0.67
Nodes (3): vite, vite, vite

## Knowledge Gaps
- **250 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+245 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `serviceClient` connect `Agent QA & Telemetry Evaluation` to `Server Entrypoint & Express Bootstrap`, `Telegram Channel & Webhook Dispatch`, `Admin Link & Pairing Verification`, `Meta Webhooks & Cryptographic Signatures`, `Encrypted Token Vault & Security`, `Admin Controls & Conversation Handling`, `Webchat Widget Security & Resolvers`, `WhatsApp Cloud Channel Provider`, `Instagram Channel Provider`, `Business Profile & Knowledge Tools`, `Appointments & Operations Tools`, `Agent Turn Runtime & Memory`, `Tenant Provisioning & Setup`, `Workforce Provisioning & Roles`, `Tool RBAC & Security Tests`, `Catalog Tools & Business Insights`, `Dashboard Reads & Agent Handover`, `Agent Delegation & Execution Context`?**
  _High betweenness centrality (0.064) - this node is a cross-community bridge._
- **Why does `useSession()` connect `App Shell & Dashboard Navigation` to `Dashboard UI Components & Tables`, `React App & Session Routing`, `Appointments UI & Diary Calendar`, `Agent QA Evaluation Dashboard`, `React Hooks & Mutation States`, `Catalog Form Controls & Services UI`, `Client API Client & Bootstrap`, `Shwari Dashboard Chat Client`, `Navigation Drawers & Buttons`, `Setup Readiness & Telegram Integration`, `Product Catalog Management UI`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **Why does `ChannelProvider` connect `Omnichannel Provider Base Interfaces` to `Telegram Channel & Webhook Dispatch`, `Server Entrypoint & Express Bootstrap`, `Channel Provider Registry`, `WhatsApp Cloud Channel Provider`, `Instagram Channel Provider`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _250 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Server Entrypoint & Express Bootstrap` be split into smaller, more focused modules?**
  _Cohesion score 0.06057692307692308 - nodes in this community are weakly interconnected._
- **Should `Onboarding & Lead Filters UI` be split into smaller, more focused modules?**
  _Cohesion score 0.06140350877192982 - nodes in this community are weakly interconnected._
- **Should `Dashboard UI Components & Tables` be split into smaller, more focused modules?**
  _Cohesion score 0.11879432624113476 - nodes in this community are weakly interconnected._