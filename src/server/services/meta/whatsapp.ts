import crypto from 'node:crypto';
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
 * Meta offers this as a hosted redirect as well as a JS SDK popup. The
 * redirect is used here so the browser loads no third-party script and the
 * callback follows the same signed-state path as every other provider.
 */

export class WhatsAppError extends Error {
  readonly metaCode?: string;
  readonly httpStatus?: number;
  constructor(message: string, metaCode?: string, httpStatus?: number) {
    super(message);
    this.name = 'WhatsAppError';
    this.metaCode = metaCode;
    this.httpStatus = httpStatus;
  }
}

/**
 * Sign a Graph call with the app secret.
 *
 * A Meta app can be set to "Require app secret", after which every call made
 * with a user or business token is refused unless it carries an
 * appsecret_proof: an HMAC of the token, keyed with the app secret. Sending it
 * is harmless when the setting is off and necessary when it is on, so it is
 * always sent. App tokens ("id|secret") already contain the secret and are
 * left alone.
 */
export function withAppSecretProof(path: string, init?: RequestInit): string {
  const secret = metaConfig.appSecret;
  if (!secret) return path;

  const [base, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  if (params.has('appsecret_proof')) return path;

  let token = params.get('access_token') ?? '';
  if (!token) {
    const headers = new Headers(init?.headers as HeadersInit | undefined);
    const auth = headers.get('authorization') ?? '';
    if (/^bearer\s+/i.test(auth)) token = auth.replace(/^bearer\s+/i, '').trim();
  }
  if (!token || token.includes('|')) return path;

  params.set('appsecret_proof', crypto.createHmac('sha256', secret).update(token).digest('hex'));
  return `${base}?${params}`;
}

async function graph<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${META_GRAPH_URL}${withAppSecretProof(path, init)}`, init);
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
    throw new WhatsAppError(detail, code, res.status);
  }
  return (await res.json()) as T;
}

/**
 * Embedded Signup v4, redirect flow.
 *
 * Meta hosts a redirect entry point for Embedded Signup at
 * business.facebook.com/messaging/whatsapp/onboard/ alongside the JS SDK
 * variant. It takes app_id (not client_id), the Facebook Login for Business
 * config_id, and an `extras` JSON blob that pins the flow version — without
 * `extras` you get an older flow, and v2 is retired on 15 October 2026.
 *
 * redirect_uri is passed per request so it lands on our callback rather than
 * the app root, which is what lets the signed state come back with it. The URI
 * must be registered under Facebook Login for Business -> Valid OAuth redirect
 * URIs, and its domain under Allowed domains, or Meta refuses the request.
 */
export const EMBEDDED_SIGNUP_URL =
  'https://business.facebook.com/messaging/whatsapp/onboard/';

/** Pins the flow to v4 with the session-info shape that returns account ids. */
const EMBEDDED_SIGNUP_EXTRAS = {
  version: 'v4',
  sessionInfoVersion: '3',
  featureType: 'whatsapp_business_app_onboarding',
} as const;

/** The extras for the flow the operator chose; see metaConfig.whatsapp.featureType. */
function signupExtras(): Record<string, string> {
  const chosen = metaConfig.whatsapp.featureType.toLowerCase();
  if (!chosen) return { ...EMBEDDED_SIGNUP_EXTRAS };
  const { featureType: _coexistence, ...plain } = EMBEDDED_SIGNUP_EXTRAS;
  return chosen === 'standard' || chosen === 'none' ? plain : { ...plain, featureType: metaConfig.whatsapp.featureType };
}

export function buildEmbeddedSignupUrl(state: string): string {
  const params = new URLSearchParams({
    app_id: metaConfig.appId,
    config_id: metaConfig.whatsapp.configId,
    extras: JSON.stringify(signupExtras()),
    redirect_uri: metaConfig.whatsapp.redirectUri,
    state,
  });
  return `${EMBEDDED_SIGNUP_URL}?${params}`;
}

/**
 * What Meta hands back on the redirect.
 *
 * sessionInfoVersion 3 can return the WABA and phone number ids directly, which
 * saves a Graph round trip. They are treated as a hint rather than a guarantee:
 * when absent, discoverWabaId falls back to debug_token, which is the
 * documented path and always works.
 */
export interface EmbeddedSignupReturn {
  code?: string;
  wabaId?: string;
  phoneNumberId?: string;
}

export function readSignupReturn(params: Record<string, string>): EmbeddedSignupReturn {
  let wabaId = params.waba_id;
  let phoneNumberId = params.phone_number_id;

  // Some variants nest the ids in a session_info JSON blob instead.
  if ((!wabaId || !phoneNumberId) && params.session_info) {
    try {
      const info = JSON.parse(params.session_info) as {
        data?: { waba_id?: string; phone_number_id?: string };
        waba_id?: string;
        phone_number_id?: string;
      };
      wabaId = wabaId || info.data?.waba_id || info.waba_id;
      phoneNumberId = phoneNumberId || info.data?.phone_number_id || info.phone_number_id;
    } catch {
      // Malformed session_info is not fatal: the Graph fallback covers it.
    }
  }

  return { code: params.code, wabaId, phoneNumberId };
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
    signal: AbortSignal.timeout(15_000),
  });
}

/**
 * A pre-approved template message — the only kind WhatsApp accepts once the
 * 24-hour customer-service window has closed.
 *
 * The template is expected to have exactly one body variable, {{1}}, which
 * carries the text. Template parameters may not contain newlines, tabs or runs
 * of more than four spaces, and are capped at 1024 characters, so the text is
 * flattened to fit.
 */
export async function sendWhatsAppTemplate(
  accessToken: string,
  phoneNumberId: string,
  to: string,
  template: { name: string; language: string },
  bodyText: string
): Promise<void> {
  const param = bodyText.replace(/\s+/g, ' ').trim().slice(0, 1024);
  await graph(`/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.language },
        components: [{ type: 'body', parameters: [{ type: 'text', text: param }] }],
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
}
