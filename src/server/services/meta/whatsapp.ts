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

/** Facebook's sign-in dialog, which is what returns a code to our callback. */
export const SIGNUP_DIALOG_URL = `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`;

export function buildEmbeddedSignupUrl(state: string): string {
  if (metaConfig.whatsapp.flow === 'dialog') {
    const chosen = metaConfig.whatsapp.featureType.toLowerCase();
    const extras: Record<string, unknown> = { setup: {}, sessionInfoVersion: '3' };
    if (chosen && chosen !== 'standard' && chosen !== 'none') extras.featureType = metaConfig.whatsapp.featureType;
    const dialog = new URLSearchParams({
      client_id: metaConfig.appId,
      config_id: metaConfig.whatsapp.configId,
      response_type: 'code',
      // Required with a configuration id, or the dialog ignores response_type.
      override_default_response_type: 'true',
      redirect_uri: metaConfig.whatsapp.redirectUri,
      extras: JSON.stringify(extras),
      state,
    });
    return `${SIGNUP_DIALOG_URL}?${dialog}`;
  }

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
  // What was granted, by name and count only: enough to diagnose a failed
  // signup from the log without recording an id or a token.
  console.log(
    '[whatsapp] granted:',
    scopes.map((s) => `${s.scope}(${s.target_ids?.length ?? 'all'})`).join(', ') || 'no granular scopes'
  );

  // 1. The account named on a WhatsApp permission.
  const direct = scopes
    .filter((s) => s.scope.startsWith('whatsapp_business'))
    .flatMap((s) => s.target_ids ?? [])[0];
  if (direct) return direct;

  // 2. The permission was granted without naming an account (Meta does this
  //    when access covers everything the person chose). Find the account
  //    through the businesses the token can see.
  const businessIds = new Set<string>(
    scopes.filter((s) => s.scope === 'business_management').flatMap((s) => s.target_ids ?? [])
  );
  try {
    const mine = await graph<{ data?: Array<{ id: string }> }>(
      `/me/businesses?${new URLSearchParams({ fields: 'id', access_token: accessToken })}`
    );
    for (const b of mine.data ?? []) businessIds.add(b.id);
  } catch { /* the token may not be allowed to list businesses */ }

  for (const businessId of businessIds) {
    for (const edge of ['owned_whatsapp_business_accounts', 'client_whatsapp_business_accounts']) {
      try {
        const found = await graph<{ data?: Array<{ id: string }> }>(
          `/${businessId}/${edge}?${new URLSearchParams({ fields: 'id', access_token: accessToken })}`
        );
        const id = found.data?.[0]?.id;
        if (id) return id;
      } catch { /* try the next edge */ }
    }
  }

  const hasWhatsApp = scopes.some((s) => s.scope.startsWith('whatsapp_business'));
  throw new WhatsAppError(
    hasWhatsApp
      ? 'A WhatsApp permission was granted but no WhatsApp Business account could be found on it'
      : 'The sign-in did not grant any WhatsApp permission',
    hasWhatsApp ? 'NO_WABA' : 'NO_WHATSAPP_PERMISSION'
  );
}

export interface WhatsAppPhoneNumber {
  id: string;
  displayPhoneNumber: string;
  verifiedName: string | null;
  qualityRating: string | null;
}

export interface WhatsAppNumberState {
  /** CONNECTED once the number is live on the Cloud API. */
  status: string | null;
  /** CLOUD_API once registered; NOT_APPLICABLE or ON_PREMISE otherwise. */
  platformType: string | null;
  codeVerificationStatus: string | null;
  live: boolean;
}

/** Is this number actually a working WhatsApp account yet? */
export async function getNumberState(phoneNumberId: string, accessToken: string): Promise<WhatsAppNumberState> {
  const params = new URLSearchParams({
    fields: 'status,platform_type,code_verification_status',
    access_token: accessToken,
  });
  const json = await graph<{ status?: string; platform_type?: string; code_verification_status?: string }>(
    `/${phoneNumberId}?${params}`
  );
  const status = json.status ?? null;
  const platformType = json.platform_type ?? null;
  return {
    status,
    platformType,
    codeVerificationStatus: json.code_verification_status ?? null,
    live: platformType === 'CLOUD_API' && (status === 'CONNECTED' || status === null),
  };
}

/**
 * The six-digit PIN the number is registered with.
 *
 * WhatsApp asks for one when a number is registered and again if it is ever
 * registered anew. It is derived from the server's encryption key and the
 * number's id, so it is the same every time without being stored anywhere.
 */
export function registrationPin(phoneNumberId: string): string {
  const key = metaConfig.tokenEncryptionKey || metaConfig.appSecret || 'unconfigured';
  const digest = crypto.createHmac('sha256', key).update(`wa-pin:${phoneNumberId}`).digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, '0');
}

/**
 * Register the number with the Cloud API.
 *
 * Signing up adds the number to the business's account; it does not make it a
 * live WhatsApp account. Until this call succeeds the number cannot send or
 * receive anything and does not show up as being on WhatsApp at all.
 */
export async function registerNumber(phoneNumberId: string, accessToken: string): Promise<void> {
  await graph(`/${phoneNumberId}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ messaging_product: 'whatsapp', pin: registrationPin(phoneNumberId) }),
    signal: AbortSignal.timeout(20_000),
  });
}

export async function listPhoneNumbers(
  wabaId: string,
  accessToken: string
): Promise<WhatsAppPhoneNumber[]> {
  type Row = { id: string; display_phone_number: string; verified_name?: string; quality_rating?: string };
  const read = (fields: string) =>
    graph<{ data?: Row[] }>(
      `/${wabaId}/phone_numbers?${new URLSearchParams({ fields, access_token: accessToken })}`
    );

  let json: { data?: Row[] };
  try {
    json = await read('id,display_phone_number,verified_name,quality_rating');
  } catch (e) {
    // A number that has only just been added can refuse some fields. The id
    // and the number itself are all the connection needs.
    if (!(e instanceof WhatsAppError)) throw e;
    json = await read('id,display_phone_number');
  }

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
