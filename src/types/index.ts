/**
 * Shared API types. These mirror the Supabase schema and the Express API
 * responses. Nothing here is business-specific: the same types serve a phone
 * retailer, a spa or an electronics shop.
 */

export type Role = 'owner' | 'admin' | 'member' | 'viewer';
export type ChannelType = 'telegram' | 'whatsapp' | 'instagram' | 'webchat';
export type ChannelStatus = 'active' | 'disabled';
export type ConversationStatus = 'open' | 'closed';
export type MessageSender = 'customer' | 'agent' | 'staff' | 'system';
export type VerificationStatus = 'unverified' | 'verified' | 'rejected';
export type OrderStatus = 'pending' | 'confirmed' | 'delivered' | 'cancelled';
export type LeadStage =
  | 'new' | 'contacted' | 'interested' | 'quoted'
  | 'payment_claimed' | 'payment_verified' | 'won' | 'lost';

export type Json = Record<string, unknown>;

export interface Tenant {
  id: string;
  slug: string;
  status: string;
  business_name: string;
  business_description: string | null;
  /** Chosen during onboarding. Free text, used to seed agent defaults. */
  business_category: string | null;
  /** Null while the setup wizard is still unfinished. */
  onboarding_completed_at: string | null;
  agent_name: string;
  address: string | null;
  timezone: string;
  currency: string;
  business_hours: Json;
  delivery_rules: Json;
  payment_details: Json;
  branding: Json;
  languages: string[];
  contact_info: Json;
  order_prefix: string;
  notification_channel: string | null;
  notification_target: string | null;
  created_at?: string;
}

export interface Membership {
  tenant_id: string;
  role: Role;
  tenants?: { business_name: string } | null;
}

export interface TenantUser {
  id: string;
  user_id: string;
  role: Role;
  created_at: string;
}

export interface Me {
  user: { id: string; email: string | null };
  role: Role;
  tenant: Pick<
    Tenant,
    | 'id' | 'business_name' | 'slug' | 'currency' | 'timezone' | 'agent_name'
    | 'order_prefix' | 'status' | 'business_category' | 'onboarding_completed_at'
  > | null;
  memberships: Membership[];
}

/** Channel as the browser sees it: secrets reduced to booleans. */
export interface Channel {
  id: string;
  tenant_id: string;
  channel_type: ChannelType;
  channel_account_id: string;
  display_name: string | null;
  status: ChannelStatus;
  created_at: string;
  has_secret_token: boolean;
  has_bot_token: boolean;
  has_credentials_ref: boolean;
}

export interface Conversation {
  id: string;
  channel_type: ChannelType;
  channel_id: string | null;
  customer_id: string;
  customer_name: string | null;
  status: ConversationStatus;
  ai_enabled: boolean;
  unread_count: number;
  last_message_preview: string | null;
  last_message_at: string | null;
  lead_id: number | null;
  lead_stage?: LeadStage | null;
  assigned_to?: string | null;
  created_at: string;
}

export interface ConversationMessage {
  id: number;
  sender: MessageSender;
  body: string | null;
  extracted: Json;
  created_at: string;
}

export interface Lead {
  id: number;
  tenant_id: string;
  channel_type: ChannelType;
  customer_id: string;
  phone: string | null;
  customer_name: string | null;
  email: string | null;
  intent: string | null;
  urgency: string | null;
  stage: LeadStage | null;
  last_message: string | null;
  last_contact: string | null;
  delivery_location: string | null;
  payment_method: string | null;
  transaction_code: string | null;
  product_model: string | null;
  product_storage: string | null;
  product_condition: string | null;
  product_price: number | null;
  upsell_items: string | null;
  notes: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  tenant_id: string;
  sku: string | null;
  name: string;
  variant: Json;
  description: string | null;
  price: number | null;
  currency: string | null;
  payment_options: Json;
  in_stock: boolean;
  created_at: string;
}

export interface Order {
  id: string;
  tenant_id: string;
  lead_id: number | null;
  order_ref: string;
  customer_id: string | null;
  channel_type: ChannelType | null;
  items: Array<{ name?: string; product?: string; qty?: number; price?: number }>;
  subtotal: number | null;
  total: number | null;
  currency: string | null;
  status: OrderStatus;
  payment_status: string;
  delivery_location: string | null;
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: string;
  tenant_id: string;
  lead_id: number | null;
  order_id: string | null;
  conversation_id: string | null;
  transaction_code: string | null;
  customer_id: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  amount: number | null;
  currency: string | null;
  product_model: string | null;
  product_storage: string | null;
  product_condition: string | null;
  delivery_location: string | null;
  payment_method: string | null;
  payment_status: string;
  verification_status: VerificationStatus;
  verified_by: string | null;
  verified_at: string | null;
  rejected_reason: string | null;
  receipt_sent_at: string | null;
  created_at: string;
}

export interface AgentSettings {
  id: string;
  tenant_id: string;
  persona: string | null;
  sales_script: string[];
  escalation_rules: Json;
  custom_instructions: string | null;
  upsell_catalogue: string[] | null;
  model: string;
  memory_window: number;
  followup_template: string | null;
  followup_delay_hours: number;
  updated_at: string;
}

export interface DashboardStats {
  total_conversations: number;
  new_conversations: number;
  active_conversations: number;
  unread_conversations: number;
  ai_conversations: number;
  human_conversations: number;
  total_leads: number;
  new_leads: number;
  qualified_leads: number;
  converted_leads: number;
  total_orders: number;
  payment_claims: number;
  verified_payments: number;
  sales: number;
  conversion_rate: number;
  ai_resolution_rate: number;
}

export interface Overview {
  stats: DashboardStats;
  channels: Array<Pick<Channel, 'channel_type' | 'status' | 'display_name'>>;
  recent_conversations: Conversation[];
  recent_leads: Lead[];
}

export interface SeriesPoint { date: string; value: number }

export interface Analytics {
  window_days: number;
  has_data: boolean;
  series: {
    conversations: SeriesPoint[];
    leads: SeriesPoint[];
    orders: SeriesPoint[];
    revenue: SeriesPoint[];
  };
  totals: {
    conversations: number;
    leads: number;
    orders: number;
    revenue: number;
    ai_handled: number;
    human_handled: number;
    conversion_rate: number;
  };
  channels: Array<{ channel: string; conversations: number; leads: number }>;
}

export interface OnboardingStep {
  id: string;
  label: string;
  done: boolean;
  href: string;
}

export interface Onboarding {
  steps: OnboardingStep[];
  completed: number;
  total: number;
  dismissed: boolean;
}

// ---------------------------------------------------------------------------
// Setup wizard
// ---------------------------------------------------------------------------

export type ProviderId = 'whatsapp' | 'instagram' | 'webchat' | 'telegram';

/**
 * How a channel is connected: a redirect to the provider, a token we take, or
 * nothing at all (web chat, which we mint ourselves).
 */
export type ConnectMode = 'oauth' | 'credential' | 'instant';

export interface ChannelProviderInfo {
  id: ProviderId;
  label: string;
  mode: ConnectMode;
  available: boolean;
  /** Plain-language reason. The server never sends variable names here. */
  unavailable_reason: string | null;
}

export interface ChannelHealth {
  healthy: boolean;
  summary: string;
  needs_reconnect: boolean;
}

export interface ConnectedChannel {
  channel_id: string;
  provider: ProviderId;
  display_name: string | null;
  status: ChannelStatus;
  health: ChannelHealth | null;
}

export interface CredentialField {
  name: string;
  label: string;
  hint?: string;
  placeholder?: string;
  secret: boolean;
}

export interface EmbedSnippet {
  /** Ready-to-paste HTML. Contains a public site key, never a secret. */
  html: string;
  site_key: string;
  script_url: string;
}

export type ConnectStart =
  | { mode: 'oauth'; authorize_url: string }
  | { mode: 'credential'; fields: CredentialField[] }
  | { mode: 'instant'; account: ConnectedChannel; embed?: EmbedSnippet };

export type OnboardingStepId = 'business' | 'channels' | 'agent' | 'launch' | 'done';

export interface OnboardingBusiness {
  business_name: string;
  business_category: string | null;
  business_description: string | null;
  agent_name: string;
  timezone: string;
  currency: string;
}

export interface OnboardingState {
  step: OnboardingStepId;
  complete: boolean;
  business: OnboardingBusiness | null;
  has_channel: boolean;
  agent_configured: boolean;
}

export interface LaunchResult {
  launched: boolean;
  checks: Array<{ provider: ProviderId; healthy: boolean; summary: string }>;
  all_healthy: boolean;
}

export type AgentTone = 'friendly' | 'professional' | 'concise' | 'enthusiastic';

/**
 * Operator readiness. The one payload that names environment variables to the
 * browser — admin-only, and it lists what is *missing*, never a value that is
 * set. See GET /api/setup/status.
 */
export interface SetupChannelStatus {
  id: ProviderId;
  label: string;
  mode: ConnectMode;
  ready: boolean;
  missing_environment_variables: string[];
}

export interface SetupStatus {
  channels: SetupChannelStatus[];
  delivery: {
    pipeline_configured: boolean;
    missing_environment_variables: string[];
    internal_send_configured: boolean;
    internal_send_missing: string[];
  };
  register_with_meta: {
    webhook_callback_url: string;
    verify_token_is_set: boolean;
    whatsapp_redirect_uri: string;
    instagram_connect_redirect_uri: string;
    instagram_signin_redirect_uri: string;
    subscribe_to_fields: string[];
  };
  shwari: {
    ready: boolean;
    missing_environment_variables: string[];
    model: string | null;
    telegram_webhook_url: string;
  };
  public_api_url: string;
  all_ready: boolean;
}

// ---------------------------------------------------------------------------
// Shwari
// ---------------------------------------------------------------------------

export type AgentRole = 'manager' | 'sales' | 'support';
export type AgentStatus = 'draft' | 'active' | 'disabled';

export interface TeamMember {
  role: AgentRole;
  name: string;
  status: AgentStatus;
}

export interface KnowledgeGap {
  question: string;
  times_seen: number;
}

export interface ShwariStatus {
  /** False when the server has no model key, or the agent could not be loaded. */
  available: boolean;
  team: TeamMember[];
  open_questions: KnowledgeGap[];
}

export interface ShwariMessage {
  from: 'you' | 'shwari';
  text: string;
  at: string;
  /** Present on replies that did something. */
  actions?: string[];
}

export interface ShwariReply {
  reply: string;
  /** True when the turn changed something, so the page knows to reload. */
  changed: boolean;
  /** Which actions the turn actually carried out, for the UI to name. */
  actions: string[];
}

export interface PairingCode {
  code: string;
  expires_at: string;
  where: Array<{ channel: string; name: string | null }>;
  instructions: string;
}

export interface LinkedAdmin {
  id: string;
  channel_type: string;
  created_at: string;
}

/** One tool call, as the activity log shows it. */
export interface AgentActivity {
  agent_role: string;
  tool: string;
  arguments: Record<string, unknown>;
  ok: boolean;
  error: string | null;
  created_at: string;
}

export interface TimelineEntry { at: string; kind: string; label: string }

export interface LeadDetail {
  lead: Lead;
  conversation: Pick<Conversation, 'id' | 'channel_type' | 'customer_id' | 'status' | 'ai_enabled' | 'last_message_at'> | null;
  orders: Order[];
  payments: Payment[];
  timeline: TimelineEntry[];
}

export interface ConversationDetail {
  conversation: Conversation;
  messages: ConversationMessage[];
  lead: Lead | null;
  payments: Payment[];
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export type AppointmentStatus = 'scheduled' | 'completed' | 'cancelled' | 'no_show';

export interface Appointment {
  id: string;
  tenant_id: string;
  lead_id: number | null;
  customer_id: string | null;
  customer_name: string | null;
  channel_type: ChannelType | null;
  service_id: string | null;
  service_name: string;
  starts_at: string;
  duration_minutes: number;
  status: AppointmentStatus;
  notes: string | null;
  /** The agent role that booked it, or null when a person did. */
  booked_by_agent: string | null;
  created_at: string;
  updated_at: string;
}

export type TicketStatus = 'open' | 'in_progress' | 'waiting' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface SupportTicket {
  id: string;
  tenant_id: string;
  lead_id: number | null;
  conversation_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  subject: string;
  body: string;
  priority: TicketPriority;
  status: TicketStatus;
  assigned_to: string | null;
  opened_by_agent: string | null;
  resolution: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export type FollowUpStatus = 'pending' | 'sent' | 'cancelled' | 'failed';

export interface FollowUp {
  id: string;
  tenant_id: string;
  lead_id: number | null;
  conversation_id: string | null;
  customer_id: string;
  channel_type: ChannelType;
  due_at: string;
  message: string;
  reason: string | null;
  status: FollowUpStatus;
  sent_at: string | null;
  failure_reason: string | null;
  created_by_agent: string | null;
  created_at: string;
  updated_at: string;
}

/** What needs a person's attention, computed without the model. */
export interface AttentionReport {
  silent_customers: Array<{ id: number; customer_name: string | null; stage: string | null; last_contact: string | null }>;
  unverified_payment_claims: number;
  open_tickets: Array<{ id: string; subject: string; priority: string; created_at: string }>;
  appointments_today: Array<{ id: string; customer_name: string | null; service_name: string; starts_at: string }>;
  unanswered_questions: Array<{ question: string; times_seen: number }>;
  waiting_on_a_person: Array<{ id: string; customer_name: string | null; last_message_at: string | null }>;
}

/** An agent as the manual editor sees it. Capabilities are a count, not a list. */
export interface AgentConfig {
  id: string;
  role: AgentRole;
  name: string;
  objective: string;
  instructions: string;
  escalation: string;
  status: AgentStatus;
  capability_count: number;
  /** False for the manager: its own capabilities are fixed. */
  editable: boolean;
  created_at: string;
  updated_at: string;
}

export interface AvailableAgent {
  role: AgentRole;
  name: string;
  summary: string;
}
