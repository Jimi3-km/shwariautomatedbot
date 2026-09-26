# Graph Report - .  (2026-09-16)

## Corpus Check
- 149 files · ~125,730 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 956 nodes · 2511 edges · 55 communities (46 shown, 9 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 19 edges (avg confidence: 0.77)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Express Server Entrypoint
- Business Onboarding Flow
- AI Tooling & Operations
- UI Design System Atoms
- Navigation & App Shell
- Business Onboarding Flow
- UI Design System Atoms
- Express Server Entrypoint
- WhatsApp Cloud Channel
- Agent Management UI
- TypeScript Build Config
- Shwari Executive Assistant UI
- Agent Runtime & Execution Loop
- Project Dependencies
- Project Dependencies
- WebChat Channel & Sessions
- AI Workforce Roles & Blueprints
- WhatsApp Cloud Channel
- Agent Management UI
- Instagram & Meta Channel
- NVIDIA LLM Client
- Agent Runtime & Execution Loop
- WhatsApp Cloud Channel
- WhatsApp Cloud Channel
- Telegram Bot Channel
- UI Design System Atoms
- Module 26 (archiveProduct())
- Module 27 (admins.ts)
- WebChat Channel & Sessions
- Module 29 (endToEnd.test.mjs)
- Project Dependencies
- UI Design System Atoms
- UI Design System Atoms
- Telegram Bot Channel
- Module 34 (tokens.ts)
- Module 35 (tools.test.mjs)
- React Router & Hooks
- Module 37 (routing.test.mjs)
- Multi-Channel Provider Layer
- Authentication & Session Context
- Module 40 (operations.test.mjs)
- WhatsApp Cloud Channel
- Module 42 (Chart.tsx)
- Project Dependencies
- WhatsApp Cloud Channel
- Project Dependencies
- Project Dependencies
- Project Dependencies
- Project Dependencies
- Project Dependencies
- Project Dependencies
- Module 51 (vercel.json)

## God Nodes (most connected - your core abstractions)
1. `request()` - 74 edges
2. `useSession()` - 45 edges
3. `useAsync()` - 40 edges
4. `useMutation()` - 37 edges
5. `useToast()` - 32 edges
6. `serviceClient` - 28 edges
7. `Button()` - 22 edges
8. `formatMoney()` - 20 edges
9. `LoadingState()` - 19 edges
10. `ErrorState()` - 18 edges

## Surprising Connections (you probably didn't know these)
- `handleEvents()` --indirect_call--> `event()`  [INFERRED]
  src/server/routes/webhooks/meta.ts → src/server/channels/meta/__tests__/routing.test.mjs
- `SessionProvider()` --calls--> `useVisiblePolling()`  [EXTRACTED]
  src/app/SessionContext.tsx → src/hooks/index.ts
- `SidebarContent()` --calls--> `useSession()`  [EXTRACTED]
  src/layouts/AppShell.tsx → src/app/SessionContext.tsx
- `TenantSwitcher()` --calls--> `useSession()`  [EXTRACTED]
  src/layouts/AppShell.tsx → src/app/SessionContext.tsx
- `TopBar()` --calls--> `useSession()`  [EXTRACTED]
  src/layouts/AppShell.tsx → src/app/SessionContext.tsx

## Import Cycles
- None detected.

## Communities (55 total, 9 thin omitted)

### Community 0 - "Express Server Entrypoint"
Cohesion: 0.05
Nodes (50): app, PORT, createApp(), bearer(), Express, handler(), rejectClientTenantId(), Request (+42 more)

### Community 1 - "Business Onboarding Flow"
Cohesion: 0.06
Nodes (54): OnboardingChecklist(), ConversationFilters, LeadFilters, AgentActivity, AgentConfig, AgentRole, AgentSettings, AgentStatus (+46 more)

### Community 2 - "AI Tooling & Operations"
Cohesion: 0.08
Nodes (46): DAYS, FACT_CATEGORIES, getBusinessProfile, getOpeningHours, getPaymentInstructions, listKnowledgeGaps, listServices, recordKnowledgeGap (+38 more)

### Community 3 - "UI Design System Atoms"
Cohesion: 0.09
Nodes (28): App(), arrivedForPasswordReset(), router, Counts, Ctx, SessionProvider(), SessionValue, signOutOfSupabase() (+20 more)

### Community 4 - "Navigation & App Shell"
Cohesion: 0.14
Nodes (30): Avatar(), Pagination(), AsyncState, useAsync(), useDebounced(), useIsMobile(), useMediaQuery(), useVisiblePolling() (+22 more)

### Community 5 - "Business Onboarding Flow"
Cohesion: 0.07
Nodes (31): ConnectChannelDialog(), Copy, EmbedSnippetBlock(), completeOnboarding(), createOnboardingBusiness(), disconnectChannel(), getOnboardingChannels(), getOnboardingState() (+23 more)

### Community 6 - "UI Design System Atoms"
Cohesion: 0.09
Nodes (28): ButtonProps, ButtonSize, ButtonVariant, Checkbox(), Drawer(), EmptyState(), ErrorState(), FieldWrapProps (+20 more)

### Community 7 - "Express Server Entrypoint"
Cohesion: 0.07
Nodes (37): qs(), request(), archiveService(), bootstrapTenant(), cancelFollowUp(), connectTelegram(), createAppointment(), createService() (+29 more)

### Community 8 - "WhatsApp Cloud Channel"
Cohesion: 0.11
Nodes (27): ConfigGap, gap(), INSTAGRAM_AUTHORIZE_URL, INSTAGRAM_GRAPH_URL, INSTAGRAM_OAUTH_URL, instagramConnectConfigured(), instagramOAuthConfigured(), META_GRAPH_URL (+19 more)

### Community 9 - "Agent Management UI"
Cohesion: 0.12
Nodes (26): useSession(), useToast(), useMutation(), NAV, SidebarContent(), TenantSwitcher(), TopBar(), UserMenu() (+18 more)

### Community 10 - "TypeScript Build Config"
Cohesion: 0.07
Nodes (28): api, dist, DOM, DOM.Iterable, ES2022, legacy, node, node_modules (+20 more)

### Community 11 - "Shwari Executive Assistant UI"
Cohesion: 0.10
Nodes (18): createPairingCode(), getAttention(), getLinkedAdmins(), getShwariHistory(), getShwariStatus(), sendToShwari(), unlinkAdmin(), ACTION_LABELS (+10 more)

### Community 12 - "Agent Runtime & Execution Loop"
Cohesion: 0.10
Nodes (16): AgentUnavailableError, syncCapabilities(), baseUrl(), complete(), CompleteOptions, Completion, DEFAULT_MAX_TOKENS, llmConfigured() (+8 more)

### Community 13 - "Project Dependencies"
Cohesion: 0.08
Nodes (25): autoprefixer, cross-env, devDependencies, autoprefixer, cross-env, tailwindcss, tsx, @types/cors (+17 more)

### Community 14 - "Project Dependencies"
Cohesion: 0.09
Nodes (23): axios, cors, lucide-react, motion, multer, dependencies, axios, cors (+15 more)

### Community 15 - "WebChat Channel & Sessions"
Cohesion: 0.13
Nodes (14): Bucket, buckets, rateLimit(), RateLimitResult, sweep(), issueVisitorToken(), newSiteKey(), newVisitorId() (+6 more)

### Community 16 - "AI Workforce Roles & Blueprints"
Cohesion: 0.14
Nodes (18): AgentRow, AGENT_BLUEPRINTS, AgentBlueprint, AgentRole, ALL_ROLES, CUSTOMER_BASICS, DEPARTMENTS, UNIVERSAL_RULES (+10 more)

### Community 17 - "WhatsApp Cloud Channel"
Cohesion: 0.14
Nodes (16): url, buildEmbeddedSignupUrl(), DebugTokenResponse, discoverWabaId(), EMBEDDED_SIGNUP_EXTRAS, EMBEDDED_SIGNUP_URL, EmbeddedSignupReturn, exchangeSignupCode() (+8 more)

### Community 18 - "Agent Management UI"
Cohesion: 0.13
Nodes (15): Field(), InlineError(), Select(), Textarea, updateAgent(), AgentEditor(), CAPABILITY_LABELS, ROLE_ICON (+7 more)

### Community 19 - "Instagram & Meta Channel"
Cohesion: 0.19
Nodes (13): CallbackResult, ConnectContext, ConnectedAccount, ConnectMode, ConnectStart, CredentialField, EmbedSnippet, HealthReport (+5 more)

### Community 20 - "NVIDIA LLM Client"
Cohesion: 0.12
Nodes (11): ToolDefinition, ctx, messageCustomer, setConversationHandling, updateBusinessSettings, bool(), record(), Tool (+3 more)

### Community 21 - "Agent Runtime & Execution Loop"
Cohesion: 0.20
Nodes (16): AgentTurnInput, AgentTurnResult, CONVERSATION_RULES, customerContext(), ensureWorkforce(), fallbackReply(), history(), loadAgent() (+8 more)

### Community 22 - "WhatsApp Cloud Channel"
Cohesion: 0.29
Nodes (15): asArray(), asObject(), asString(), instagramMedia(), Json, parseInstagram(), parseMetaWebhook(), parseWhatsApp() (+7 more)

### Community 23 - "WhatsApp Cloud Channel"
Cohesion: 0.16
Nodes (10): getProvider(), isProviderId(), PROVIDER_ORDER, PROVIDERS, instagramProvider, telegramProvider, webchatProvider, whatsappProvider (+2 more)

### Community 24 - "Telegram Bot Channel"
Cohesion: 0.29
Nodes (8): call(), deleteWebhook(), generateSecretToken(), getMe(), getWebhookInfo(), sendTelegramMessage(), setWebhook(), TelegramBotInfo

### Community 25 - "UI Design System Atoms"
Cohesion: 0.19
Nodes (10): ConfirmDialog(), Tabs(), formatDate(), relativeTime(), ConversationList(), RecentConversations(), FollowUpList(), PRIORITY_TONE (+2 more)

### Community 26 - "Module 26 (archiveProduct())"
Cohesion: 0.21
Nodes (11): archiveProduct(), createProduct(), getProducts(), ProductInput, updateProduct(), emptyForm, FormState, fromPairs() (+3 more)

### Community 27 - "Module 27 (admins.ts)"
Cohesion: 0.24
Nodes (12): AdminLink, findAdmin(), IssuedCode, issuePairingCode(), looksLikePairingCode(), newCode(), redeemPairingCode(), RedeemResult (+4 more)

### Community 28 - "WebChat Channel & Sessions"
Cohesion: 0.21
Nodes (11): NormalizedInboundEvent, ProviderId, captured, webchatEvent, forwardToPipeline(), mediaPlaceholder(), persistInbound(), PersistResult (+3 more)

### Community 29 - "Module 29 (endToEnd.test.mjs)"
Cohesion: 0.17
Nodes (5): customer(), db, owner(), rows, script

### Community 30 - "Project Dependencies"
Cohesion: 0.17
Nodes (11): name, private, scripts, build, clean, dev, lint, preview (+3 more)

### Community 31 - "UI Design System Atoms"
Cohesion: 0.29
Nodes (11): Input, getAppointments(), updateAppointment(), Appointments(), dayLabel(), formatWhen(), groupByDay(), NewAppointment() (+3 more)

### Community 32 - "UI Design System Atoms"
Cohesion: 0.29
Nodes (7): SetupReadinessPanel(), Button(), Card(), Pill(), getChannels(), getSetupStatus(), Integrations()

### Community 33 - "Telegram Bot Channel"
Cohesion: 0.27
Nodes (7): handleUpdate(), mediaOf(), parseUpdate(), resolveBySecret(), telegramWebhookRouter, timingSafeEqual(), claimEvent()

### Community 34 - "Module 34 (tokens.ts)"
Cohesion: 0.25
Nodes (10): decryptToken(), deleteToken(), encryptToken(), Envelope, LoadedToken, loadKey(), loadToken(), MetaPlatform (+2 more)

### Community 35 - "Module 35 (tools.test.mjs)"
Cohesion: 0.22
Nodes (7): audit, CONFIGURATION_TOOLS, ctx, DEPARTMENTS, exploding, registry, spy

### Community 36 - "React Router & Hooks"
Cohesion: 0.33
Nodes (7): SignatureResult, verifyChallenge(), verifyMetaSignature(), handleEvents(), metaWebhookRouter, normalize(), resolveChannel()

### Community 37 - "Module 37 (routing.test.mjs)"
Cohesion: 0.29
Nodes (4): db, eqValue(), event(), matches()

### Community 39 - "Authentication & Session Context"
Cohesion: 0.43
Nodes (6): metaConfig, createOAuthState(), OAuthStatePayload, secret(), sign(), verifyOAuthState()

### Community 40 - "Module 40 (operations.test.mjs)"
Cohesion: 0.40
Nodes (4): inConversation, noConversation, reachedTheDatabase(), rejects()

### Community 41 - "WhatsApp Cloud Channel"
Cohesion: 0.33
Nodes (3): body, instagramBody, whatsappBody

### Community 42 - "Module 42 (Chart.tsx)"
Cohesion: 0.50
Nodes (3): AreaChart(), BarList(), SeriesPoint

### Community 43 - "Project Dependencies"
Cohesion: 0.67
Nodes (3): vite, vite, vite

## Knowledge Gaps
- **216 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+211 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `serviceClient` connect `WhatsApp Cloud Channel` to `Express Server Entrypoint`, `Telegram Bot Channel`, `AI Tooling & Operations`, `Module 34 (tokens.ts)`, `WhatsApp Cloud Channel`, `Agent Runtime & Execution Loop`, `WebChat Channel & Sessions`, `AI Workforce Roles & Blueprints`, `WhatsApp Cloud Channel`, `Instagram & Meta Channel`, `NVIDIA LLM Client`, `Agent Runtime & Execution Loop`, `Telegram Bot Channel`, `Module 27 (admins.ts)`, `WebChat Channel & Sessions`?**
  _High betweenness centrality (0.047) - this node is a cross-community bridge._
- **Why does `ChannelProvider` connect `Multi-Channel Provider Layer` to `Express Server Entrypoint`, `WhatsApp Cloud Channel`, `Instagram & Meta Channel`, `WhatsApp Cloud Channel`, `Telegram Bot Channel`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **Why does `useSession()` connect `Agent Management UI` to `UI Design System Atoms`, `UI Design System Atoms`, `Navigation & App Shell`, `UI Design System Atoms`, `Express Server Entrypoint`, `Shwari Executive Assistant UI`, `Agent Management UI`, `UI Design System Atoms`, `Module 26 (archiveProduct())`, `UI Design System Atoms`?**
  _High betweenness centrality (0.006) - this node is a cross-community bridge._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _216 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Express Server Entrypoint` be split into smaller, more focused modules?**
  _Cohesion score 0.05271629778672032 - nodes in this community are weakly interconnected._
- **Should `Business Onboarding Flow` be split into smaller, more focused modules?**
  _Cohesion score 0.06140350877192982 - nodes in this community are weakly interconnected._
- **Should `AI Tooling & Operations` be split into smaller, more focused modules?**
  _Cohesion score 0.07591836734693877 - nodes in this community are weakly interconnected._