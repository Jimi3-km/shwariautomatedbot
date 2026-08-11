import { META_GRAPH_URL, META_GRAPH_VERSION, metaConfig } from '../../config/meta.js';

/**
 * WhatsApp Business Cloud API via Meta's Embedded Signup.
 *
 * Embedded Signup is the flow where the business owner clicks one button,
 * walks through Meta's own dialog (creating or picking their WhatsApp Business
 * account and phone number), and comes back with an authorization code. We
 * exchange that for a business token and read the account details from the
 * Graph API — the user never sees or pastes a token, a WABA id or a phone
 * number id.
 *
 * The redirect-based variant is used rather than Meta's JS SDK so the browser
 * loads no third-party script and the callback follows the same signed-state
 * path as every other provider here.
 */

export class WhatsAppError extends Error {
  readonly metaCode?: string;
  constructor(message: string, metaCode?: string) {
    super(message);
    this.name = 'WhatsAppError';
    this.metaCode = metaCode;
  }
}

async function graph<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${META_GRAPH_URL}${path}`, init);
  if (!res.ok) {
    let detail = `Graph API returned HTTP ${res.status}`;
    let code: string | undefined;
    try {
      const body = (await res.json()) as { error?: { message?: string; code?: number } };
      detail = body.error?.message ?? detail;
      code = body.error?.code != null ? String(body.error.code) : undefined;
    } catch {
      /* non-JSON error body */
    }
    throw new WhatsAppError(detail, code);
  }
  return (await res.json()) as T;
}

/** Where the browser is sent to start Embedded Signup. */
export function buildEmbeddedSignupUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: metaConfig.appId,
    config_id: metaConfig.whatsapp.configId,
    redirect_uri: metaConfig.whatsapp.redirectUri,
    response_type: 'code',
    // Embedded Signup returns an authorization code rather than the default
    // token response; without this the callback receives a fragment we cannot
    // read server-side.
    override_default_response_type: 'true',
    state,
  });
  return `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth?${params}`;
}

/** Exchange the Embedded Signup code for the business access token. */
export async function exchangeSignupCode(code: string): Promise<{ accessToken: string }> {
  const params = new URLSearchParams({
    client_id: metaConfig.appId,
    client_secret: metaConfig.appSecret,
    redirect_uri: metaConfig.whatsapp.redirectUri,
    code,
  });
  const json = await graph<{ access_token?: string }>(`/oauth/access_token?${params}`);
  if (!json.access_token) throw new WhatsAppError('Meta did not return an access token');
  return { accessToken: json.access_token };
}

interface DebugTokenResponse {
  data?: {
    granular_scopes?: Array<{ scope: string; target_ids?: string[] }>;
  };
}

/**
 * Which WhatsApp Business Account did the user just grant us?
 *
 * debug_token reports the granted scopes together with the ids they apply to,
 * which is the documented way to discover the WABA without asking the user.
 */
export async function discoverWabaId(accessToken: string): Promise<string> {
  const params = new URLSearchParams({
    input_token: accessToken,
    access_token: `${metaConfig.appId}|${metaConfig.appSecret}`,
  });
  const json = await graph<DebugTokenResponse>(`/debug_token?${params}`);

  const scopes = json.data?.granular_scopes ?? [];
  const waba = scopes.find((s) => s.scope === 'whatsapp_business_management')
    ?? scopes.find((s) => s.scope === 'whatsapp_business_messaging');
  const id = waba?.target_ids?.[0];

  if (!id) throw new WhatsAppError('No WhatsApp Business account was granted');
  return id;
}

export interface WhatsAppPhoneNumber {
  id: string;
  displayPhoneNumber: string;
  verifiedName: string | null;
  qualityRating: string | null;
}

export async function listPhoneNumbers(
  wabaId: string,
  accessToken: string
): Promise<WhatsAppPhoneNumber[]> {
  const params = new URLSearchParams({
    fields: 'id,display_phone_number,verified_name,quality_rating',
    access_token: accessToken,
  });
  const json = await graph<{
    data?: Array<{
      id: string;
      display_phone_number: string;
      verified_name?: string;
      quality_rating?: string;
    }>;
  }>(`/${wabaId}/phone_numbers?${params}`);

  return (json.data ?? []).map((p) => ({
    id: p.id,
    displayPhoneNumber: p.display_phone_number,
    verifiedName: p.verified_name ?? null,
    qualityRating: p.quality_rating ?? null,
  }));
}

/**
 * Subscribe our app to the WABA so inbound messages reach the webhook.
 * Without this the connection looks fine but no message ever arrives.
 */
export async function subscribeApp(wabaId: string, accessToken: string): Promise<void> {
  await graph(`/${wabaId}/subscribed_apps`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
  });
}

export async function listSubscribedApps(wabaId: string, accessToken: string): Promise<string[]> {
  const json = await graph<{ data?: Array<{ whatsapp_business_api_data?: { id?: string } }> }>(
    `/${wabaId}/subscribed_apps?access_token=${encodeURIComponent(accessToken)}`
  );
  return (json.data ?? [])
    .map((d) => d.whatsapp_business_api_data?.id)
    .filter((id): id is string => Boolean(id));
}

export async function sendWhatsAppMessage(
  accessToken: string,
  phoneNumberId: string,
  to: string,
  text: string
): Promise<void> {
  await graph(`/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    }),
  });
}
