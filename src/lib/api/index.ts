import { request, qs } from './client';
import type {
  Me, TenantUser, Tenant, Overview, Analytics, Onboarding,
  Conversation, ConversationDetail, ConversationMessage,
  Lead, LeadDetail, LeadStage, Product, Order, OrderStatus,
  Payment, AgentSettings, Channel, VerificationStatus, ChannelType,
  ChannelProviderInfo, ProviderId, ConnectStart, ConnectedChannel, ChannelHealth,
  OnboardingState, LaunchResult, AgentTone, SetupStatus,
} from '../../types';

export * from './client';

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------
export const getMe = () => request<Me>('/me');

export const bootstrapTenant = (body: { business_name: string; agent_name?: string; currency?: string; timezone?: string }) =>
  request<{ tenant_id: string; role: string; created: boolean }>('/bootstrap', { method: 'POST', body });

export const getTeam = () => request<{ members: TenantUser[] }>('/team');

export const updateTeamMember = (id: string, role: string) =>
  request<TenantUser>(`/team/${id}`, { method: 'PATCH', body: { role } });

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
export const getOverview = () => request<Overview>('/overview');
export const getAnalytics = (days = 30) => request<Analytics>(`/analytics${qs({ days })}`);
export const getOnboarding = () => request<Onboarding>('/onboarding');

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------
export interface ConversationFilters {
  search?: string;
  channel_type?: ChannelType | '';
  status?: 'open' | 'closed' | '';
  handled_by?: 'ai' | 'human' | '';
  unread?: boolean;
  limit?: number;
  offset?: number;
}

export const getConversations = (f: ConversationFilters = {}, signal?: AbortSignal) =>
  request<{ conversations: Conversation[]; total: number; limit: number; offset: number }>(
    `/conversations${qs({ ...f, unread: f.unread ? 'true' : undefined })}`,
    { signal }
  );

export const getConversation = (id: string) => request<ConversationDetail>(`/conversations/${id}`);

export const markConversationRead = (id: string) =>
  request<{ id: string; unread_count: number }>(`/conversations/${id}/read`, { method: 'POST' });

/**
 * Hand a conversation between the AI and a human. The backend flag is the
 * source of truth: n8n reads conversations.ai_enabled before generating any
 * reply, so this is not a cosmetic toggle.
 */
export const setConversationTakeover = (id: string, aiEnabled: boolean) =>
  request<{ id: string; ai_enabled: boolean; assigned_to: string | null }>(
    `/conversations/${id}/takeover`, { method: 'POST', body: { ai_enabled: aiEnabled } }
  );

export const sendMessage = (id: string, body: string) =>
  request<ConversationMessage>(`/conversations/${id}/reply`, { method: 'POST', body: { body } });

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------
export interface LeadFilters {
  stage?: LeadStage | '';
  channel_type?: ChannelType | '';
  search?: string;
  limit?: number;
}

export const getLeads = (f: LeadFilters = {}, signal?: AbortSignal) =>
  request<{ leads: Lead[] }>(`/leads${qs(f)}`, { signal });

export const getLeadStages = () => request<{ stages: LeadStage[] }>('/leads/stages');
export const getLead = (id: number | string) => request<LeadDetail>(`/leads/${id}`);

export const updateLead = (id: number | string, body: Partial<Lead>) =>
  request<Lead>(`/leads/${id}`, { method: 'PATCH', body });

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------
export interface ProductInput {
  name: string;
  sku?: string | null;
  description?: string | null;
  price?: number | null;
  currency?: string;
  variant?: Record<string, unknown>;
  payment_options?: Record<string, unknown>;
  in_stock?: boolean;
}

export const getProducts = () => request<{ products: Product[] }>('/products');
export const createProduct = (body: ProductInput) => request<Product>('/products', { method: 'POST', body });
export const updateProduct = (id: string, body: ProductInput) => request<Product>(`/products/${id}`, { method: 'PUT', body });
export const archiveProduct = (id: string) => request<{ archived: boolean }>(`/products/${id}`, { method: 'DELETE' });
export const deleteProduct = (id: string) => request<{ deleted: boolean }>(`/products/${id}?hard=true`, { method: 'DELETE' });

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------
export const getOrders = (status?: OrderStatus | '') =>
  request<{ orders: Order[] }>(`/orders${qs({ status })}`);

export const updateOrder = (id: string, body: { status?: OrderStatus; delivery_location?: string }) =>
  request<Order>(`/orders/${id}`, { method: 'PATCH', body });

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------
export const getPayments = (verification_status?: VerificationStatus | '') =>
  request<{ payments: Payment[] }>(`/payments${qs({ verification_status })}`);

/**
 * Verification always goes through the API, which stamps verified_by from the
 * session. The browser cannot mark a payment verified directly: a database
 * trigger rejects any verified row without a real staff user of the tenant.
 */
export const verifyPayment = (id: string, decision: 'verified' | 'rejected', reason?: string) =>
  request<Payment>(`/payments/${id}/verify`, { method: 'POST', body: { decision, reason } });

export const issueReceipt = (id: string) =>
  request<{ order_ref: string | null; recipient: string | null; html: string; delivery: { sent: boolean; reason: string } }>(
    `/payments/${id}/receipt`, { method: 'POST' }
  );

// ---------------------------------------------------------------------------
// AI agent
// ---------------------------------------------------------------------------
export const getAgentSettings = () => request<{ agent: AgentSettings | null }>('/agent');
export const updateAgentSettings = (body: Partial<AgentSettings>) =>
  request<AgentSettings>('/agent', { method: 'PUT', body });

// ---------------------------------------------------------------------------
// Business settings
// ---------------------------------------------------------------------------
export const getBusiness = () => request<{ business: Tenant }>('/business');
export const updateBusiness = (body: Partial<Tenant>) => request<Tenant>('/business', { method: 'PUT', body });

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------
export const getChannels = () => request<{ channels: Channel[] }>('/channels');

/** The token is posted once and never returned by any endpoint afterwards. */
export const connectTelegram = (botToken: string) =>
  request<{ channel: Channel; bot: { id: number; username: string } }>(
    '/channels/telegram', { method: 'POST', body: { bot_token: botToken } }
  );

export const getChannelStatus = (id: string) =>
  request<{ status: string; webhook: { configured: boolean; matches_expected: boolean; pending_update_count: number; last_error_message: string | null } }>(
    `/channels/${id}/status`
  );

export const disconnectChannel = (id: string) =>
  request<{ disconnected: boolean }>(`/channels/${id}`, { method: 'DELETE' });

export const getChannelProviders = () =>
  request<{ providers: ChannelProviderInfo[] }>('/channels/providers');

/**
 * Start a connection. OAuth providers answer with a URL to navigate to;
 * credential providers answer with the fields to collect.
 */
export const startChannelConnect = (provider: ProviderId) =>
  request<ConnectStart>(`/channels/${provider}/connect`, { method: 'POST', body: {} });

/** Finish a credential connection. Values are posted once and never returned. */
export const submitChannelCredentials = (provider: ProviderId, values: Record<string, string>) =>
  request<{ account: ConnectedChannel }>(`/channels/${provider}/credentials`, {
    method: 'POST', body: values,
  });

export const getChannelHealth = (channelId: string) =>
  request<ChannelHealth>(`/channels/${channelId}/health`);

// ---------------------------------------------------------------------------
// Setup wizard
// ---------------------------------------------------------------------------
export const getOnboardingState = () => request<OnboardingState>('/onboarding/state');

/** Operator readiness. Admin-only; 403 for anyone else. */
export const getSetupStatus = () => request<SetupStatus>('/setup/status');

export const createOnboardingBusiness = (body: {
  business_name: string;
  business_category?: string;
  timezone?: string;
  currency?: string;
}) => request<{ business_name: string; created: boolean }>('/onboarding/business', { method: 'POST', body });

export const getOnboardingChannels = (probe = false) =>
  request<{ providers: ChannelProviderInfo[]; connected: ConnectedChannel[] }>(
    `/onboarding/channels${qs({ probe: probe ? 1 : undefined })}`
  );

export const saveOnboardingAgent = (body: {
  sells: string;
  description?: string;
  tone: AgentTone;
  agent_name?: string;
}) => request<{ agent_name: string; configured: boolean }>('/onboarding/agent', { method: 'POST', body });

export const completeOnboarding = () =>
  request<LaunchResult>('/onboarding/complete', { method: 'POST', body: {} });

export const sendOnboardingTestMessage = (channelId: string, recipient: string) =>
  request<{ sent: boolean }>('/onboarding/test-message', {
    method: 'POST', body: { channel_id: channelId, recipient },
  });
