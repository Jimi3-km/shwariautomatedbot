# Graph Report - .  (2026-09-27)

## Corpus Check
- 187 files · ~148,820 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1092 nodes · 2780 edges · 89 communities (76 shown, 13 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 20 edges (avg confidence: 0.77)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 55
- Community 56
- Community 57
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- Community 66
- Community 67
- Community 68
- Community 69
- Community 70
- Community 71
- Community 72
- Community 73
- Community 74
- Community 75
- Community 83

## God Nodes (most connected - your core abstractions)
1. `request()` - 78 edges
2. `useSession()` - 47 edges
3. `useAsync()` - 40 edges
4. `useMutation()` - 37 edges
5. `serviceClient` - 37 edges
6. `useToast()` - 34 edges
7. `Button()` - 23 edges
8. `LoadingState()` - 20 edges
9. `formatMoney()` - 20 edges
10. `runAgentTurn()` - 19 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `complete()`  [EXTRACTED]
  scratch_test_llm.ts → src/server/ai/llm.ts
- `handleEvents()` --indirect_call--> `event()`  [INFERRED]
  src/server/routes/webhooks/meta.ts → src/server/channels/meta/__tests__/routing.test.mjs
- `SessionProvider()` --calls--> `useVisiblePolling()`  [EXTRACTED]
  src/app/SessionContext.tsx → src/hooks/index.ts
- `SessionProvider()` --calls--> `setActiveTenant()`  [EXTRACTED]
  src/app/SessionContext.tsx → src/lib/api/client.ts
- `SidebarContent()` --calls--> `useSession()`  [EXTRACTED]
  src/layouts/AppShell.tsx → src/app/SessionContext.tsx

## Import Cycles
- None detected.

## Communities (89 total, 13 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (58): SessionValue, OnboardingChecklist(), ConversationFilters, LeadFilters, ProductInput, AgentActivity, AgentConfig, AgentRole (+50 more)

### Community 1 - "Community 1"
Cohesion: 0.13
Nodes (31): Avatar(), FilterChip(), useAsync(), useDebounced(), useIsMobile(), useMediaQuery(), useVisiblePolling(), getLead() (+23 more)

### Community 2 - "Community 2"
Cohesion: 0.08
Nodes (35): SetupReadinessPanel(), ButtonProps, ButtonSize, ButtonVariant, Card(), ConfirmDialog(), Drawer(), ErrorState() (+27 more)

### Community 3 - "Community 3"
Cohesion: 0.08
Nodes (28): ConfigGap, gap(), INSTAGRAM_AUTHORIZE_URL, INSTAGRAM_GRAPH_URL, INSTAGRAM_OAUTH_URL, instagramConnectConfigured(), instagramOAuthConfigured(), META_GRAPH_URL (+20 more)

### Community 4 - "Community 4"
Cohesion: 0.10
Nodes (30): qs(), request(), bootstrapTenant(), createAppointment(), createService(), deleteProduct(), deleteService(), getAgentActivity() (+22 more)

### Community 5 - "Community 5"
Cohesion: 0.07
Nodes (28): api, dist, DOM, DOM.Iterable, ES2022, legacy, node, node_modules (+20 more)

### Community 6 - "Community 6"
Cohesion: 0.11
Nodes (19): App(), arrivedForPasswordReset(), router, signOutOfSupabase(), Status, ToastProvider(), ApiError, defaultMessage() (+11 more)

### Community 7 - "Community 7"
Cohesion: 0.09
Nodes (22): completeOnboarding(), createOnboardingBusiness(), getOnboardingChannels(), getOnboardingState(), saveOnboardingAgent(), sendOnboardingTestMessage(), submitChannelCredentials(), AgentStep() (+14 more)

### Community 8 - "Community 8"
Cohesion: 0.10
Nodes (18): createPairingCode(), getAttention(), getLinkedAdmins(), getShwariHistory(), getShwariStatus(), sendToShwari(), unlinkAdmin(), ACTION_LABELS (+10 more)

### Community 9 - "Community 9"
Cohesion: 0.08
Nodes (25): autoprefixer, cross-env, devDependencies, autoprefixer, cross-env, tailwindcss, tsx, @types/cors (+17 more)

### Community 10 - "Community 10"
Cohesion: 0.13
Nodes (19): ConnectChannelDialog(), Copy, EmbedSnippetBlock(), completeInstagramLogin(), completeMetaEmbeddedSignup(), connectTelegram(), disconnectChannel(), getChannelProviders() (+11 more)

### Community 11 - "Community 11"
Cohesion: 0.09
Nodes (23): axios, cors, lucide-react, motion, multer, dependencies, axios, cors (+15 more)

### Community 12 - "Community 12"
Cohesion: 0.10
Nodes (20): Button(), Input, Textarea, AgentTurnFilters, AgentTurnItem, AgentTurnLabel, getAgents(), updateAgent() (+12 more)

### Community 13 - "Community 13"
Cohesion: 0.16
Nodes (17): notConfigured(), appOrigin(), failRedirect(), instagramAuthRouter, buildAuthorizeUrl(), createState(), exchangeCodeForToken(), exchangeForLongLivedToken() (+9 more)

### Community 14 - "Community 14"
Cohesion: 0.13
Nodes (14): Bucket, buckets, rateLimit(), RateLimitResult, sweep(), issueVisitorToken(), newSiteKey(), newVisitorId() (+6 more)

### Community 15 - "Community 15"
Cohesion: 0.15
Nodes (17): Field(), Select(), AsyncState, useMutation(), cancelFollowUp(), createTicket(), getAgentSettings(), updateAgentSettings() (+9 more)

### Community 16 - "Community 16"
Cohesion: 0.15
Nodes (15): DEPARTMENTS, DELEGATABLE, delegateToAgent, activateAgent, CONFIGURABLE_ROLES, configureAgent, listTeam, setupStatus (+7 more)

### Community 17 - "Community 17"
Cohesion: 0.19
Nodes (13): CallbackResult, ConnectContext, ConnectedAccount, ConnectMode, ConnectStart, CredentialField, EmbedSnippet, HealthReport (+5 more)

### Community 18 - "Community 18"
Cohesion: 0.19
Nodes (17): ALL, bookAppointment, cancelAppointment, cancelFollowUp, escalateToHuman, listAppointments, listFollowUps, listOrders (+9 more)

### Community 19 - "Community 19"
Cohesion: 0.21
Nodes (15): AgentTurnResult, CONVERSATION_RULES, customerContext(), fallbackReply(), history(), loadAgent(), orientation(), runAgentTurn() (+7 more)

### Community 20 - "Community 20"
Cohesion: 0.16
Nodes (14): baseUrl(), CompleteOptions, Completion, DEFAULT_MAX_TOKENS, executeCompletion(), LlmError, llmModel(), LlmNotConfiguredError (+6 more)

### Community 21 - "Community 21"
Cohesion: 0.18
Nodes (14): llmConfigured(), BrevoInboundItem, brevoWebhookRouter, handleInboundEmail(), resolveTenantForEmail(), BrevoSendResult, EmailRecipient, getBrevoSender() (+6 more)

### Community 22 - "Community 22"
Cohesion: 0.16
Nodes (9): app, PORT, createApp(), rejectClientTenantId(), BOOKING_MODES, catalogRouter, TENANT_EDITABLE, channelsRouter (+1 more)

### Community 23 - "Community 23"
Cohesion: 0.14
Nodes (9): detectLanguage(), main(), TurnLabel, TenantExport, assertSupabaseConfigured(), getServiceClient(), SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (+1 more)

### Community 24 - "Community 24"
Cohesion: 0.20
Nodes (13): useToast(), getBusiness(), getTeam(), updateBusiness(), updateTeamMember(), AccountSection(), BusinessForm(), fromPairs() (+5 more)

### Community 25 - "Community 25"
Cohesion: 0.12
Nodes (15): DAYS, FACT_CATEGORIES, getBusinessProfile, getOpeningHours, getPaymentInstructions, listKnowledgeGaps, listServices, recordKnowledgeGap (+7 more)

### Community 26 - "Community 26"
Cohesion: 0.17
Nodes (12): bearer(), Express, isSuperAdmin(), Request, requireAuth(), requireUser(), ROLE_RANK, TenantContext (+4 more)

### Community 27 - "Community 27"
Cohesion: 0.19
Nodes (12): InboundMedia, NormalizedInboundEvent, ParsedEvent, ParsedMessage, ProviderId, captured, webchatEvent, mediaPlaceholder() (+4 more)

### Community 28 - "Community 28"
Cohesion: 0.19
Nodes (12): Checkbox(), EmptyState(), archiveProduct(), createProduct(), getProducts(), updateProduct(), emptyForm, FormState (+4 more)

### Community 29 - "Community 29"
Cohesion: 0.13
Nodes (11): getAgentSettings, getBusinessSettings, HANDLED_BY, listChannels, listConversations, listPaymentClaims, readConversation, updateAgentSettings (+3 more)

### Community 30 - "Community 30"
Cohesion: 0.29
Nodes (8): call(), deleteWebhook(), generateSecretToken(), getMe(), getWebhookInfo(), sendTelegramMessage(), setWebhook(), TelegramBotInfo

### Community 31 - "Community 31"
Cohesion: 0.19
Nodes (7): COMMON_CONVERSATION_GUIDELINES, ROLE_DIRECTIVES, AGENT_BLUEPRINTS, AgentBlueprint, ALL_ROLES, CUSTOMER_BASICS, UNIVERSAL_RULES

### Community 32 - "Community 32"
Cohesion: 0.14
Nodes (10): ctx, businessMetrics, findCustomers, LEAD_STAGES, listProducts, removeProduct, saveCustomerDetails, saveProduct (+2 more)

### Community 33 - "Community 33"
Cohesion: 0.24
Nodes (11): Counts, Ctx, SessionProvider(), useCurrency(), useSession(), NAV, SidebarContent(), TenantSwitcher() (+3 more)

### Community 34 - "Community 34"
Cohesion: 0.26
Nodes (11): AdminLink, findAdmin(), IssuedCode, issuePairingCode(), looksLikePairingCode(), newCode(), redeemPairingCode(), RedeemResult (+3 more)

### Community 35 - "Community 35"
Cohesion: 0.19
Nodes (11): ToolDefinition, PlanExecutionResult, PlanStep, StructuredPlan, TOOLS, Role, canUserRunTool(), hasPermission() (+3 more)

### Community 36 - "Community 36"
Cohesion: 0.17
Nodes (5): customer(), db, owner(), rows, script

### Community 37 - "Community 37"
Cohesion: 0.42
Nodes (12): asArray(), asObject(), asString(), instagramMedia(), Json, parseInstagram(), parseMetaWebhook(), parseWhatsApp() (+4 more)

### Community 38 - "Community 38"
Cohesion: 0.17
Nodes (11): name, private, scripts, build, clean, dev, lint, preview (+3 more)

### Community 39 - "Community 39"
Cohesion: 0.33
Nodes (10): getAppointments(), updateAppointment(), Appointments(), dayLabel(), formatWhen(), groupByDay(), NewAppointment(), STATUS_LABEL (+2 more)

### Community 40 - "Community 40"
Cohesion: 0.20
Nodes (7): requireAdmin, allProviders(), ChannelSummary, onboardingRouter, safeHealth(), TONES, setupRouter

### Community 41 - "Community 41"
Cohesion: 0.25
Nodes (10): decryptToken(), deleteToken(), encryptToken(), Envelope, LoadedToken, loadKey(), loadToken(), MetaPlatform (+2 more)

### Community 42 - "Community 42"
Cohesion: 0.20
Nodes (8): audit, CONFIGURATION_TOOLS, ctx, DASHBOARD_READS, DEPARTMENTS, exploding, registry, spy

### Community 43 - "Community 43"
Cohesion: 0.20
Nodes (4): handler(), analyticsRouter, Bucket, internalRouter

### Community 44 - "Community 44"
Cohesion: 0.29
Nodes (6): handleUpdate(), mediaOf(), parseUpdate(), resolveBySecret(), telegramWebhookRouter, timingSafeEqual()

### Community 45 - "Community 45"
Cohesion: 0.22
Nodes (7): requireWrite, inboxRouter, LEAD_STAGES, APPOINTMENT_STATES, operationsRouter, TICKET_PRIORITIES, TICKET_STATES

### Community 46 - "Community 46"
Cohesion: 0.25
Nodes (8): getProvider(), isProviderId(), PROVIDER_ORDER, PROVIDERS, instagramProvider, telegramProvider, webchatProvider, whatsappProvider

### Community 47 - "Community 47"
Cohesion: 0.22
Nodes (3): app, db, rows

### Community 48 - "Community 48"
Cohesion: 0.25
Nodes (5): AgentUnavailableError, syncCapabilities(), attentionNeeded, AGENT_STATES, shwariRouter

### Community 49 - "Community 49"
Cohesion: 0.25
Nodes (6): messageCustomer, setConversationHandling, updateBusinessSettings, time(), when(), str()

### Community 50 - "Community 50"
Cohesion: 0.39
Nodes (6): SignatureResult, verifyChallenge(), verifyMetaSignature(), handleEvents(), normalize(), resolveChannel()

### Community 51 - "Community 51"
Cohesion: 0.29
Nodes (4): db, eqValue(), event(), matches()

### Community 53 - "Community 53"
Cohesion: 0.39
Nodes (6): accountRouter, CreatedTenant, createTenantForUser(), CreateTenantInput, slugify(), uniqueSlug()

### Community 54 - "Community 54"
Cohesion: 0.43
Nodes (5): main(), ensureWorkforce(), complete(), createAndExecutePlan(), chooseDepartment()

### Community 55 - "Community 55"
Cohesion: 0.33
Nodes (5): AppShell(), archiveService(), NotFound(), Services(), Tickets()

### Community 56 - "Community 56"
Cohesion: 0.29
Nodes (7): AgentRow, AgentTurnInput, ChatMessage, PromptAgentInput, AgentRole, Routed, AgentContext

### Community 57 - "Community 57"
Cohesion: 0.38
Nodes (5): commerceRouter, ORDER_STATES, AuditRecord, logAuditEvent(), sanitizeAuditPayload()

### Community 58 - "Community 58"
Cohesion: 0.40
Nodes (4): inConversation, noConversation, reachedTheDatabase(), rejects()

### Community 59 - "Community 59"
Cohesion: 0.33
Nodes (3): body, instagramBody, whatsappBody

### Community 60 - "Community 60"
Cohesion: 0.53
Nodes (5): esc(), money(), ReceiptInput, receiptsRouter, renderReceiptHtml()

### Community 62 - "Community 62"
Cohesion: 0.53
Nodes (5): createOAuthState(), OAuthStatePayload, secret(), sign(), verifyOAuthState()

### Community 63 - "Community 63"
Cohesion: 0.50
Nodes (3): AreaChart(), BarList(), SeriesPoint

### Community 64 - "Community 64"
Cohesion: 0.83
Nodes (3): exchangeWhatsAppCode(), getAppSecretProof(), linkInstagramAccount()

### Community 65 - "Community 65"
Cohesion: 0.67
Nodes (3): vite, vite, vite

## Knowledge Gaps
- **249 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+244 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **13 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `serviceClient` connect `Community 61` to `Community 13`, `Community 14`, `Community 16`, `Community 17`, `Community 18`, `Community 19`, `Community 21`, `Community 23`, `Community 25`, `Community 26`, `Community 27`, `Community 29`, `Community 30`, `Community 32`, `Community 34`, `Community 40`, `Community 41`, `Community 43`, `Community 44`, `Community 45`, `Community 48`, `Community 49`, `Community 53`, `Community 54`, `Community 57`?**
  _High betweenness centrality (0.052) - this node is a cross-community bridge._
- **Why does `ChannelProvider` connect `Community 52` to `Community 40`, `Community 13`, `Community 46`, `Community 17`, `Community 30`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **Why does `useSession()` connect `Community 33` to `Community 1`, `Community 2`, `Community 4`, `Community 39`, `Community 8`, `Community 10`, `Community 12`, `Community 15`, `Community 55`, `Community 24`, `Community 28`?**
  _High betweenness centrality (0.007) - this node is a cross-community bridge._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _249 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05683060109289618 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.12579281183932348 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.08416389811738649 - nodes in this community are weakly interconnected._