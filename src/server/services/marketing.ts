import { tenantLiveness } from './platform.js';
import { serviceClient } from '../supabase.js';
import { notify } from './notify.js';
import { loadToken } from './meta/tokens.js';
import { InstagramPublishError, publishToInstagram } from './meta/instagramPublish.js';
import { FacebookPublishError, publishToFacebookPage } from './meta/facebookPublish.js';
import { loadConnectedPage, pageCanPublish } from './meta/facebook.js';
import { parseInTimezone, safeTimezone, wallClock } from '../ai/time.js';

/**
 * Marketing: the posting calendar.
 *
 * Three things are decided here and nowhere else, because they are the rules
 * that must hold whoever is asking - the dashboard, Shwari, or the scheduler:
 *
 *   1. What goes on the calendar. Posts are picked from the owner's own
 *      approved library items. Nothing is generated.
 *   2. What may be published. Only a row whose status is 'approved'. A week
 *      nobody approved publishes nothing.
 *   3. That it happens once. A row is claimed by moving it to 'publishing'
 *      with a status filter, so two runners cannot both post it, and a row
 *      that failed is never retried without a person deciding to.
 *
 * Every function tolerates migration 0024 not being applied: reads come back
 * empty and writes say plainly that posting is not set up yet.
 */

export type Platform = 'instagram' | 'facebook';
export type ApprovalMode = 'week' | 'each' | 'autopilot';
export type PostStatus =
  | 'proposed' | 'approved' | 'publishing' | 'published' | 'failed' | 'rejected' | 'cancelled';

export interface Slot { day: number; time: string }

export interface PostingSettings {
  approval_mode: ApprovalMode;
  /** The owner's own pause, on the Marketing page or through Shwari. */
  paused: boolean;
  /**
   * True when the Marketing agent is switched off on the AI team page. It is
   * read from the agent's row, not stored here, so there is one source of
   * truth for it. It stops automatic planning and publishing exactly as
   * `paused` does, and is reported separately so the owner is told which
   * switch to press. See postingStopped.
   */
  agent_off: boolean;
  slots: Slot[];
  last_planned_at: string | null;
}

export interface ContentItem {
  id: string;
  tenant_id: string;
  media_url: string;
  media_path: string | null;
  media_type: 'image' | 'video';
  caption: string;
  product_id: string | null;
  service_id: string | null;
  about: string | null;
  platforms: string[];
  status: 'draft' | 'approved' | 'archived';
  max_uses: number | null;
  times_used: number;
  last_used_at: string | null;
  created_at: string;
}

export interface ScheduledPost {
  id: string;
  tenant_id: string;
  content_item_id: string | null;
  platform: Platform;
  caption: string;
  media_url: string;
  media_type: 'image' | 'video';
  about: string | null;
  scheduled_for: string;
  status: PostStatus;
  needs_review_reason: string | null;
  approved_by: string | null;
  approved_at: string | null;
  published_at: string | null;
  container_id: string | null;
  external_post_id: string | null;
  external_permalink: string | null;
  failure_reason: string | null;
  attempt_count: number;
  week_start: string | null;
}

/** A failure the person asking can be told about as it is. */
export class MarketingError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'MarketingError';
    this.status = status;
  }
}

export const DEFAULT_SLOTS: Slot[] = [
  { day: 1, time: '18:00' }, { day: 3, time: '18:00' }, { day: 5, time: '18:00' },
];

export const PLATFORMS: Platform[] = ['instagram', 'facebook'];

export const isPlatform = (v: unknown): v is Platform => v === 'instagram' || v === 'facebook';

export const platformName = (p: string | null | undefined): string => (p === 'facebook' ? 'Facebook' : 'Instagram');

/**
 * May this library item be posted on this platform?
 *
 * An item with no platforms listed predates Facebook and was only ever meant
 * for Instagram, so it is never sent to a Page nobody marked it for.
 */
export function itemAllows(item: Pick<ContentItem, 'platforms'>, platform: Platform): boolean {
  const list = Array.isArray(item.platforms) ? item.platforms : [];
  return list.length ? list.includes(platform) : platform === 'instagram';
}

/**
 * Where this business's calendar posts to.
 *
 * Instagram alone, exactly as before, until a Facebook Page is connected. With
 * a Page connected it is every platform that is connected: the Page, and
 * Instagram too if the business has it.
 */
export async function postingPlatforms(tenantId: string): Promise<Platform[]> {
  const { data: pages, error } = await serviceClient
    .from('channels').select('id')
    .eq('tenant_id', tenantId).eq('channel_type', 'facebook').eq('status', 'active')
    .limit(1);
  if (error || !Array.isArray(pages) || !pages.length) return ['instagram'];

  const { data: ig } = await serviceClient
    .from('meta_tokens').select('platform')
    .eq('tenant_id', tenantId).eq('platform', 'instagram')
    .limit(1);
  return Array.isArray(ig) && ig.length ? ['instagram', 'facebook'] : ['facebook'];
}

/** Our own ceiling, well under Instagram's. A calendar never needs more. */
export const DAILY_POST_CAP = 20;
const STALE_PUBLISHING_MS = 15 * 60 * 1000;
const MISSED_AFTER_MS = 24 * 3_600_000;
const WEEK_MS = 7 * 24 * 3_600_000;
const MAX_VIDEO_ATTEMPTS = 6;

export const NOT_SET_UP = 'Posting is not set up on this workspace yet (a database update is pending).';

/** What the Marketing page and Shwari say when the Marketing agent is off. */
export const MARKETING_AGENT_OFF =
  'The Marketing agent is switched off on the AI team page, so no posts are planned or published automatically, including approved ones. They stay on the calendar until Marketing is switched back on.';

/** Nothing goes out: the owner paused posting, or switched the Marketing agent off. */
export function postingStopped(settings: Pick<PostingSettings, 'paused' | 'agent_off'>): boolean {
  return settings.paused === true || settings.agent_off === true;
}

/**
 * Is the Marketing agent switched off for this business?
 *
 * Only an explicit 'disabled' counts. A business with no marketing row - one
 * whose database has not had migration 0026 yet - posts exactly as it did
 * before the agent existed, and a failed read never stops posting on its own.
 */
export async function marketingAgentOff(tenantId: string): Promise<boolean> {
  try {
    const { data, error } = await serviceClient
      .from('agents')
      .select('status')
      .eq('tenant_id', tenantId)
      .eq('role', 'marketing')
      .limit(1);
    if (error || !Array.isArray(data)) return false;
    return data[0]?.status === 'disabled';
  } catch {
    return false;
  }
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** True when the table itself is not there: migration 0024 has not been applied. */
export function missingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === 'PGRST205' || error.code === '42P01' ||
    (/content_items|scheduled_posts|posting_settings/.test(error.message ?? '') &&
      /not exist|not find|schema cache/i.test(error.message ?? ''));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Keep only well-formed slots, once each, in calendar order. */
export function cleanSlots(raw: unknown): Slot[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Slot[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const day = Number((entry as { day?: unknown }).day);
    const m = /^(\d{1,2}):(\d{2})$/.exec(String((entry as { time?: unknown }).time ?? '').trim());
    if (!Number.isInteger(day) || day < 0 || day > 6 || !m) continue;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) continue;
    const time = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    const key = `${day}@${time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ day, time });
  }
  return out.sort((a, b) => a.day - b.day || a.time.localeCompare(b.time)).slice(0, 28);
}

export async function getSettings(tenantId: string): Promise<PostingSettings> {
  const [{ data, error }, agentOff] = await Promise.all([
    serviceClient
      .from('posting_settings')
      .select('approval_mode, paused, slots, last_planned_at')
      .eq('tenant_id', tenantId)
      .limit(1),
    marketingAgentOff(tenantId),
  ]);
  const fallback: PostingSettings = {
    approval_mode: 'week', paused: false, agent_off: agentOff, slots: DEFAULT_SLOTS, last_planned_at: null,
  };
  const row = !error && Array.isArray(data) ? data[0] : null;
  if (!row) return fallback;
  const mode = row.approval_mode;
  return {
    approval_mode: mode === 'each' || mode === 'autopilot' ? mode : 'week',
    paused: row.paused === true,
    agent_off: agentOff,
    // An empty list is a real choice (post on no day); only a missing one defaults.
    slots: Array.isArray(row.slots) ? cleanSlots(row.slots) : DEFAULT_SLOTS,
    last_planned_at: row.last_planned_at ?? null,
  };
}

export interface SettingsPatch {
  approval_mode?: unknown;
  paused?: unknown;
  slots?: unknown;
}

export async function saveSettings(tenantId: string, patch: SettingsPatch): Promise<PostingSettings> {
  const current = await getSettings(tenantId);
  const next: PostingSettings = { ...current };

  if (patch.approval_mode !== undefined) {
    const mode = String(patch.approval_mode);
    if (mode !== 'week' && mode !== 'each' && mode !== 'autopilot') {
      throw new MarketingError('The approval mode must be week, each or autopilot.');
    }
    next.approval_mode = mode;
  }
  if (patch.paused !== undefined) next.paused = patch.paused === true || patch.paused === 'true';
  if (patch.slots !== undefined) {
    if (!Array.isArray(patch.slots)) throw new MarketingError('Posting times must be a list of a day and a time.');
    const slots = cleanSlots(patch.slots);
    if (patch.slots.length && !slots.length) {
      throw new MarketingError('Each posting time needs a day (0 = Sunday to 6 = Saturday) and a time such as 18:00.');
    }
    next.slots = slots;
  }

  const { error } = await serviceClient.from('posting_settings').upsert(
    {
      tenant_id: tenantId,
      approval_mode: next.approval_mode,
      paused: next.paused,
      slots: next.slots,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'tenant_id' }
  );
  if (error) {
    if (missingTable(error)) throw new MarketingError(NOT_SET_UP, 503);
    throw new Error(error.message);
  }
  return next;
}

async function tenantInfo(tenantId: string): Promise<{ timezone: string; currency: string | null }> {
  const { data } = await serviceClient
    .from('tenants').select('timezone, currency').eq('id', tenantId).limit(1);
  const row = Array.isArray(data) ? data[0] : null;
  return { timezone: safeTimezone(row?.timezone), currency: row?.currency ?? null };
}

/** "Friday 27 Nov, 18:00" in the business's own timezone. */
export function describeWhen(at: Date | string, timezone: string): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  const w = wallClock(d, timezone);
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: safeTimezone(timezone), day: 'numeric', month: 'short' }).format(d);
  return `${DAY_NAMES[w.weekday]} ${date}, ${String(w.hour).padStart(2, '0')}:${String(w.minute).padStart(2, '0')}`;
}

function localDate(at: Date, timezone: string): string {
  const w = wallClock(at, timezone);
  return `${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`;
}

/** Every posting time in the seven days after `from`, as instants. */
export function upcomingSlots(slots: Slot[], timezone: string, from: Date): Date[] {
  const out: Date[] = [];
  const end = from.getTime() + WEEK_MS;
  const start = wallClock(from, timezone);
  // Noon UTC of the local date is a safe anchor to step whole days from.
  const anchor = Date.UTC(start.year, start.month - 1, start.day, 12);
  for (let d = 0; d <= 7; d++) {
    const day = new Date(anchor + d * 86_400_000);
    const weekday = day.getUTCDay();
    const ymd = `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, '0')}-${String(day.getUTCDate()).padStart(2, '0')}`;
    for (const slot of slots) {
      if (slot.day !== weekday) continue;
      const at = parseInTimezone(`${ymd}T${slot.time}`, timezone);
      if (at && at.getTime() > from.getTime() && at.getTime() < end) out.push(at);
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

// ---------------------------------------------------------------------------
// The caption check
// ---------------------------------------------------------------------------

export interface Grounding {
  currency: string | null;
  prices: number[];
  /** Price of a product or service by id, for a caption about one in particular. */
  priced: Map<string, { name: string; price: number | null }>;
  /** Everything the business has written down: facts, descriptions, price notes. */
  text: string;
}

export interface CaptionCheck {
  ok: boolean;
  reason: string | null;
}

export async function loadGrounding(tenantId: string): Promise<Grounding> {
  const [products, services, facts, tenant] = await Promise.all([
    serviceClient.from('products').select('id, name, description, price').eq('tenant_id', tenantId).limit(500),
    serviceClient.from('services').select('id, name, description, price_amount, price_note').eq('tenant_id', tenantId).limit(500),
    serviceClient.from('business_facts').select('fact_key, value').eq('tenant_id', tenantId).limit(300),
    tenantInfo(tenantId),
  ]);

  const prices: number[] = [];
  const priced = new Map<string, { name: string; price: number | null }>();
  const text: string[] = [];
  const price = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  for (const p of (Array.isArray(products.data) ? products.data : []) as Array<Record<string, unknown>>) {
    const value = price(p.price);
    if (value !== null) prices.push(value);
    if (p.id != null) priced.set(String(p.id), { name: String(p.name ?? ''), price: value });
    text.push(String(p.description ?? ''));
  }
  for (const s of (Array.isArray(services.data) ? services.data : []) as Array<Record<string, unknown>>) {
    const value = price(s.price_amount);
    if (value !== null) prices.push(value);
    if (s.id != null) priced.set(String(s.id), { name: String(s.name ?? ''), price: value });
    text.push(String(s.description ?? ''), String(s.price_note ?? ''));
  }
  for (const f of (Array.isArray(facts.data) ? facts.data : []) as Array<Record<string, unknown>>) {
    text.push(`${String(f.fact_key ?? '')} ${typeof f.value === 'string' ? f.value : JSON.stringify(f.value ?? '')}`);
  }

  return { currency: tenant.currency, prices, priced, text: text.join('\n').toLowerCase() };
}

const CURRENCY_WORDS = ['kshs', 'ksh', 'kes', 'ugx', 'tzs', 'usd', 'sh'];

/** Offer language that has to rest on something the business actually said. */
const OFFER_CLAIMS: Array<{ what: string; pattern: RegExp; backedBy: RegExp }> = [
  { what: 'a discount', pattern: /\bdiscount(?:s|ed)?\b/i, backedBy: /\bdiscount/i },
  { what: 'something free', pattern: /(?<![-\w])(?<!feel )free\b/i, backedBy: /(?<![-\w])free\b/i },
  {
    what: 'an offer',
    pattern: /\b(?:an|the|this|our|special|limited(?:[- ]time)?|exclusive|on|weekend|today'?s)\s+offers?\b|\boffers?\s+(?:ends?|valid|runs?|lasts?|until|till)\b|\bpromo(?:tion)?s?\b|\bdeals?\b/i,
    backedBy: /\boffer|\bpromo|\bdeal/i,
  },
  { what: 'a sale', pattern: /(?<!for )\bsale\b|\bclearance\b/i, backedBy: /\bsale\b|\bclearance\b/i },
  { what: 'a buy-one-get-one deal', pattern: /\bbuy\s+\w+\s+get\b|\bbogo\b/i, backedBy: /\bbuy\s+\w+\s+get\b|\bbogo\b/i },
  { what: 'a giveaway', pattern: /\bgive[- ]?aways?\b/i, backedBy: /\bgive[- ]?away/i },
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Every amount of money a caption states, as numbers. */
export function priceFigures(caption: string, currency?: string | null): Array<{ text: string; value: number }> {
  const words = [...CURRENCY_WORDS];
  const own = (currency ?? '').trim().toLowerCase();
  if (own && /^[a-z]{2,5}$/.test(own) && !words.includes(own)) words.unshift(own);
  const cur = `(?:${words.map(escapeRegex).join('|')})`;
  const number = '(\\d[\\d,]*(?:\\.\\d+)?)(\\s?k\\b)?';

  const patterns = [
    new RegExp(`(?<![a-z])(?:${cur}\\.?|[$£€])\\s?${number}`, 'gi'),
    new RegExp(`${number}\\s?(?:${cur}(?![a-z])|\\/=|\\/-|bob\\b)`, 'gi'),
    // A number written with thousands separators is a price until shown otherwise.
    /(?<![\d.,])(\d{1,3}(?:,\d{3})+)()(?![\d])/g,
  ];

  const found = new Map<number, string>();
  for (const pattern of patterns) {
    for (const m of caption.matchAll(pattern)) {
      const raw = (m[1] ?? '').replace(/,/g, '');
      let value = Number(raw);
      if (!raw || !Number.isFinite(value)) continue;
      if (m[2] && m[2].trim()) value *= 1000;
      if (!found.has(value)) found.set(value, m[0].trim());
    }
  }
  return [...found.entries()].map(([value, text]) => ({ value, text }));
}

/**
 * Is everything this caption claims something the records say?
 *
 * Deliberately a check of figures and offer words, not of prose: a caption may
 * be as warm as it likes, but a price must be a catalogue price and an offer
 * must be one the business has written down.
 */
export function checkCaption(
  grounding: Grounding,
  caption: string,
  item?: { product_id?: string | null; service_id?: string | null } | null
): CaptionCheck {
  const text = (caption ?? '').trim();
  if (!text) return { ok: true, reason: null };
  const reasons: string[] = [];

  const figures = priceFigures(text, grounding.currency);
  const same = (a: number, b: number) => Math.abs(a - b) < 0.005;
  const unknown = figures.filter((f) => !grounding.prices.some((p) => same(p, f.value)));
  if (unknown.length) {
    reasons.push(
      `It states a price (${unknown.map((f) => f.text).join(', ')}) that is not the price of anything in the catalogue.`
    );
  } else if (figures.length && item) {
    const linked = grounding.priced.get(String(item.product_id ?? item.service_id ?? ''));
    if (linked && linked.price !== null && !figures.some((f) => same(f.value, linked.price!))) {
      reasons.push(`It states ${figures[0].text}, but ${linked.name} is ${linked.price} in the catalogue.`);
    }
  }

  for (const m of text.matchAll(/\b(\d{1,3})\s?%/g)) {
    const percent = new RegExp(`\\b${m[1]}\\s?%`);
    if (!percent.test(grounding.text)) {
      reasons.push(`It mentions ${m[1]}%, which is not in your business facts.`);
      break;
    }
  }

  for (const claim of OFFER_CLAIMS) {
    if (claim.pattern.test(text) && !claim.backedBy.test(grounding.text)) {
      reasons.push(`It mentions ${claim.what}, and nothing in your business facts or catalogue says so.`);
      break;
    }
  }

  return reasons.length ? { ok: false, reason: reasons.join(' ').slice(0, 500) } : { ok: true, reason: null };
}

/** Check one caption against the business's own records. */
export async function captionCheck(
  tenantId: string,
  caption: string,
  item?: { product_id?: string | null; service_id?: string | null } | null
): Promise<CaptionCheck> {
  return checkCaption(await loadGrounding(tenantId), caption, item);
}

// ---------------------------------------------------------------------------
// Planning a week
// ---------------------------------------------------------------------------

export interface PlanResult {
  /** False when the tables are not there yet. */
  available: boolean;
  week_start: string;
  mode: ApprovalMode;
  paused: boolean;
  /** True when the Marketing agent is off: this plan can be approved, but nothing is published until it is on. */
  agent_off: boolean;
  proposed: ScheduledPost[];
  /** Where this plan posts to: the platforms the business has connected. */
  platforms: Platform[];
  /** Posting times in the window that already held a post. */
  already_planned: number;
  unfilled: Array<{ scheduled_for: string; when: string; why: string; platform: Platform }>;
  library: { approved: number; usable: number };
  note?: string;
}

const LIVE: PostStatus[] = ['proposed', 'approved', 'publishing', 'published', 'failed'];
const PENDING: PostStatus[] = ['proposed', 'approved', 'publishing'];

function aboutKey(x: { product_id?: string | null; service_id?: string | null; about?: string | null }): string | null {
  if (x.product_id) return `product:${x.product_id}`;
  if (x.service_id) return `service:${x.service_id}`;
  const about = (x.about ?? '').trim().toLowerCase();
  return about ? `about:${about}` : null;
}

/**
 * Lay out the next seven days of posts from the approved library.
 *
 * Safe to call as often as anyone likes: a posting time that already holds a
 * post is left alone, so a second call adds nothing.
 */
export async function planWeek(
  tenantId: string,
  opts: { from?: Date | null; now?: Date } = {}
): Promise<PlanResult> {
  const now = opts.now ?? new Date();
  const from = opts.from && opts.from.getTime() > now.getTime() ? opts.from : now;
  const [settings, tenant] = await Promise.all([getSettings(tenantId), tenantInfo(tenantId)]);
  const tz = tenant.timezone;

  const result: PlanResult = {
    available: true,
    week_start: localDate(from, tz),
    mode: settings.approval_mode,
    paused: settings.paused,
    agent_off: settings.agent_off,
    proposed: [],
    platforms: ['instagram'],
    already_planned: 0,
    unfilled: [],
    library: { approved: 0, usable: 0 },
  };

  const end = new Date(from.getTime() + WEEK_MS);
  const [platforms, itemsQ, pendingQ] = await Promise.all([
    postingPlatforms(tenantId),
    serviceClient.from('content_items')
      .select('*').eq('tenant_id', tenantId).eq('status', 'approved').limit(500),
    serviceClient.from('scheduled_posts')
      .select('content_item_id, status, scheduled_for')
      .eq('tenant_id', tenantId).in('status', PENDING).limit(1000),
  ]);
  result.platforms = platforms;

  if (missingTable(itemsQ.error)) return { ...result, available: false, note: NOT_SET_UP };
  if (itemsQ.error) throw new Error(itemsQ.error.message);

  const everyApproved = (itemsQ.data ?? []) as ContentItem[];

  // One outing is one use, however many platforms it goes out on: the same
  // item at the same time on Instagram and on the Page counts once.
  const pendingOutings = new Map<string, Set<string>>();
  const noteOuting = (itemId: string, at: string | number) => {
    const key = String(typeof at === 'number' ? at : Date.parse(at));
    if (!pendingOutings.has(itemId)) pendingOutings.set(itemId, new Set());
    pendingOutings.get(itemId)!.add(key);
  };
  for (const row of (pendingQ.data ?? []) as Array<{ content_item_id: string | null; scheduled_for: string }>) {
    if (row.content_item_id) noteOuting(row.content_item_id, row.scheduled_for);
  }
  const usesLeft = (i: ContentItem) =>
    i.max_uses === null || i.max_uses === undefined
      ? Infinity
      : i.max_uses - (i.times_used ?? 0) - (pendingOutings.get(i.id)?.size ?? 0);

  const slots = upcomingSlots(settings.slots, tz, from);
  const approvedAnywhere = new Set<string>();
  const usableAnywhere = new Set<string>();
  /**
   * What each posting time holds on the platforms planned so far. The next
   * platform is given the same item at the same time when it may have it, so
   * a business on both sees one post in two places rather than two calendars.
   */
  const chosenAt = new Map<number, string>();

  let grounding: Grounding | null = null;

  for (const platform of platforms) {
    const existingQ = await serviceClient.from('scheduled_posts')
      .select('id, content_item_id, scheduled_for, status, about')
      .eq('tenant_id', tenantId).eq('platform', platform)
      .gte('scheduled_for', from.toISOString()).lt('scheduled_for', end.toISOString())
      .limit(500);
    if (missingTable(existingQ.error)) return { ...result, available: false, note: NOT_SET_UP };
    if (existingQ.error) throw new Error(existingQ.error.message);

    const existing = (existingQ.data ?? []) as Array<Pick<ScheduledPost, 'id' | 'content_item_id' | 'scheduled_for' | 'status' | 'about'>>;
    const approved = everyApproved.filter((i) => itemAllows(i, platform));
    for (const i of approved) approvedAnywhere.add(i.id);

    // Least recently posted first, so the library rotates.
    const candidates = approved
      .filter((i) => usesLeft(i) > 0)
      .sort((a, b) =>
        (a.last_used_at ? Date.parse(a.last_used_at) : 0) - (b.last_used_at ? Date.parse(b.last_used_at) : 0) ||
        (a.times_used ?? 0) - (b.times_used ?? 0) ||
        String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
    for (const i of candidates) usableAnywhere.add(i.id);

    // Anything in this window counts as used this week, including a post the
    // owner rejected: rejecting one should bring a different item, not the same.
    const usedThisWeek = new Set(existing.map((e) => e.content_item_id).filter(Boolean) as string[]);
    const aboutById = new Map(approved.map((i) => [i.id, aboutKey(i)]));
    const live = existing.filter((e) => LIVE.includes(e.status));
    const timeline: Array<{ at: number; key: string | null }> = live.map((e) => ({
      at: Date.parse(e.scheduled_for),
      key: (e.content_item_id && aboutById.get(e.content_item_id)) || aboutKey({ about: e.about }),
    }));
    const taken = new Set(live.map((e) => Date.parse(e.scheduled_for)));
    const placed = new Map<number, string>();
    for (const e of live) if (e.content_item_id) placed.set(Date.parse(e.scheduled_for), e.content_item_id);

    for (const slot of slots) {
      const at = slot.getTime();
      if (taken.has(at)) { result.already_planned++; continue; }

      // The item already going out at this time elsewhere, if this platform may have it.
      const twinId = chosenAt.get(at);
      const twin = twinId ? approved.find((i) => i.id === twinId && !usedThisWeek.has(i.id)) : undefined;

      const free = candidates.filter((i) => !usedThisWeek.has(i.id));
      if (!twin && !free.length) {
        result.unfilled.push({
          scheduled_for: slot.toISOString(),
          when: describeWhen(slot, tz),
          platform,
          why: !approved.length
            ? (platforms.length > 1
                ? `No approved item in the library is marked for ${platformName(platform)}.`
                : 'There are no approved items in the library.')
            : !candidates.length
              ? 'Every approved item has reached its reuse limit.'
              : 'Every approved item is already in this week. Add more to the library.',
        });
        continue;
      }

      // Not the same product two posts running, when there is anything else.
      const before = timeline.filter((p) => p.at < at).sort((a, b) => b.at - a.at)[0]?.key ?? null;
      const after = timeline.filter((p) => p.at > at).sort((a, b) => a.at - b.at)[0]?.key ?? null;
      const differs = (i: ContentItem, neighbour: string | null) => !neighbour || aboutKey(i) !== neighbour;
      const pick =
        twin ??
        free.find((i) => differs(i, before) && differs(i, after)) ??
        free.find((i) => differs(i, before)) ??
        free[0];

      grounding ??= await loadGrounding(tenantId);
      const check = checkCaption(grounding, pick.caption ?? '', pick);
      // Autopilot posts approved items unprompted - except one a person should read first.
      const auto = settings.approval_mode === 'autopilot' && check.ok;

      const { data: created, error } = await serviceClient
        .from('scheduled_posts')
        .insert({
          tenant_id: tenantId,
          content_item_id: pick.id,
          platform,
          caption: pick.caption ?? '',
          media_url: pick.media_url,
          media_type: pick.media_type === 'video' ? 'video' : 'image',
          about: pick.about ?? null,
          scheduled_for: slot.toISOString(),
          status: auto ? 'approved' : 'proposed',
          needs_review_reason: check.reason,
          approved_at: auto ? now.toISOString() : null,
          week_start: result.week_start,
        })
        .select('*');

      if (error) {
        // Someone else planned this time a moment ago. That is the plan working.
        if (error.code === '23505') { result.already_planned++; taken.add(at); continue; }
        if (missingTable(error)) return { ...result, available: false, note: NOT_SET_UP };
        throw new Error(error.message);
      }
      const row = (Array.isArray(created) ? created[0] : created) as ScheduledPost | undefined;
      if (!row) continue;

      result.proposed.push(row);
      usedThisWeek.add(pick.id);
      noteOuting(pick.id, at);
      taken.add(at);
      placed.set(at, pick.id);
      timeline.push({ at, key: aboutKey(pick) });
    }

    for (const [at, itemId] of placed) if (!chosenAt.has(at)) chosenAt.set(at, itemId);
  }

  result.library.approved = approvedAnywhere.size;
  result.library.usable = usableAnywhere.size;
  if (!settings.slots.length) result.note = 'No posting days are set. Choose them under Schedule.';
  else if (!approvedAnywhere.size) result.note = 'There are no approved items in the library to post.';

  const waiting = result.proposed.filter((p) => p.status === 'proposed');
  if (waiting.length) {
    const flagged = waiting.filter((p) => p.needs_review_reason).length;
    await notify({
      tenantId,
      kind: 'posts_to_approve',
      title: `${waiting.length} ${waiting.length === 1 ? 'post' : 'posts'} to approve for the week of ${describeWhen(from, tz).split(',')[0]}`,
      body: [
        'Nothing is published until you approve it.',
        flagged ? `${flagged} should be read first.` : '',
        result.unfilled.length ? `${result.unfilled.length} posting ${result.unfilled.length === 1 ? 'time has' : 'times have'} nothing to post - the library is running low.` : '',
      ].filter(Boolean).join(' '),
      link: '/marketing',
      refId: `week:${result.week_start}`,
    });
  }

  return result;
}

/**
 * The scheduler's weekly pass: lay out a week for every business that has
 * approved content and nothing on the calendar beyond the next two days.
 */
export async function planDueWeeks(
  opts: { limit?: number; budgetMs?: number; now?: Date } = {}
): Promise<{ checked: number; planned: number; proposed: number }> {
  const now = opts.now ?? new Date();
  const deadline = Date.now() + (opts.budgetMs ?? 8_000);
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
  const summary = { checked: 0, planned: 0, proposed: 0 };

  const { data, error } = await serviceClient
    .from('content_items').select('tenant_id').eq('status', 'approved').limit(1000);
  if (error) {
    if (!missingTable(error)) console.warn('[marketing] could not read the library:', error.message);
    return summary;
  }
  const tenants = [...new Set(((data ?? []) as Array<{ tenant_id: string }>).map((r) => r.tenant_id))];

  for (const tenantId of tenants) {
    if (summary.planned >= limit || Date.now() > deadline) break;
    summary.checked++;

    const settings = await getSettings(tenantId);
    // Paused by the owner, or the Marketing agent is switched off: either way
    // nobody is planning this business's week for it.
    if (postingStopped(settings) || !settings.slots.length) continue;
    // At most once a day per business, so an empty library is not re-planned every run.
    if (settings.last_planned_at && now.getTime() - Date.parse(settings.last_planned_at) < 20 * 3_600_000) continue;

    const { data: ahead } = await serviceClient
      .from('scheduled_posts').select('id')
      .eq('tenant_id', tenantId).in('status', LIVE)
      .gt('scheduled_for', new Date(now.getTime() + 2 * 86_400_000).toISOString())
      .limit(1);
    if (Array.isArray(ahead) && ahead.length) continue;

    try {
      const plan = await planWeek(tenantId, { now });
      if (!plan.available) return summary;
      summary.planned++;
      summary.proposed += plan.proposed.length;
      await serviceClient.from('posting_settings').upsert(
        {
          tenant_id: tenantId,
          approval_mode: settings.approval_mode,
          paused: settings.paused,
          slots: settings.slots,
          last_planned_at: now.toISOString(),
        },
        { onConflict: 'tenant_id' }
      );
    } catch (e) {
      console.warn('[marketing] weekly plan failed:', e instanceof Error ? e.message : e);
    }
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Reading and changing the calendar
// ---------------------------------------------------------------------------

async function getPost(tenantId: string, id: string): Promise<ScheduledPost> {
  if (!isUuid(id)) throw new MarketingError('That post could not be found.', 404);
  const { data, error } = await serviceClient
    .from('scheduled_posts').select('*').eq('tenant_id', tenantId).eq('id', id).limit(1);
  if (error) {
    if (missingTable(error)) throw new MarketingError(NOT_SET_UP, 503);
    throw new Error(error.message);
  }
  const row = Array.isArray(data) ? (data[0] as ScheduledPost | undefined) : undefined;
  if (!row) throw new MarketingError('That post could not be found.', 404);
  return row;
}

export async function listPosts(
  tenantId: string,
  opts: { from?: Date | null; to?: Date | null; status?: PostStatus | null; limit?: number } = {}
): Promise<{ available: boolean; posts: ScheduledPost[] }> {
  let q = serviceClient.from('scheduled_posts').select('*').eq('tenant_id', tenantId);
  if (opts.from) q = q.gte('scheduled_for', opts.from.toISOString());
  if (opts.to) q = q.lt('scheduled_for', opts.to.toISOString());
  if (opts.status) q = q.eq('status', opts.status);
  const { data, error } = await q.order('scheduled_for', { ascending: true }).limit(Math.min(opts.limit ?? 200, 500));
  if (error) {
    if (missingTable(error)) return { available: false, posts: [] };
    throw new Error(error.message);
  }
  return { available: true, posts: (data ?? []) as ScheduledPost[] };
}

export interface ApproveResult {
  approved: ScheduledPost[];
  skipped: Array<{ id: string; why: string }>;
}

/**
 * Approve posts: the ones named, or every proposed post in the seven days
 * from `weekStart`. Only a proposed post whose time has not passed is
 * approved; everything else is reported back with the reason.
 */
export async function approvePosts(
  tenantId: string,
  opts: { ids?: string[] | null; weekStart?: string | null; by: string | null; now?: Date }
): Promise<ApproveResult> {
  const now = opts.now ?? new Date();
  const out: ApproveResult = { approved: [], skipped: [] };
  let targets: ScheduledPost[] = [];

  if (opts.ids && opts.ids.length) {
    const ids = [...new Set(opts.ids.filter(isUuid))].slice(0, 100);
    for (const bad of opts.ids.filter((id) => !isUuid(id))) out.skipped.push({ id: String(bad), why: 'That is not a post on the calendar.' });
    if (ids.length) {
      const { data, error } = await serviceClient
        .from('scheduled_posts').select('*').eq('tenant_id', tenantId).in('id', ids);
      if (error) {
        if (missingTable(error)) throw new MarketingError(NOT_SET_UP, 503);
        throw new Error(error.message);
      }
      targets = (data ?? []) as ScheduledPost[];
      for (const id of ids) {
        if (!targets.some((t) => t.id === id)) out.skipped.push({ id, why: 'That post could not be found.' });
      }
    }
  } else if (opts.weekStart) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.weekStart)) throw new MarketingError('The week must be a date such as 2026-11-23.');
    const settings = await getSettings(tenantId);
    if (settings.approval_mode === 'each') {
      throw new MarketingError('This business approves each post one at a time. Approve them individually, or change the approval mode under Schedule.', 409);
    }
    const tenant = await tenantInfo(tenantId);
    const start = parseInTimezone(`${opts.weekStart}T00:00`, tenant.timezone);
    if (!start) throw new MarketingError('The week must be a date such as 2026-11-23.');
    const { data, error } = await serviceClient
      .from('scheduled_posts').select('*')
      .eq('tenant_id', tenantId).eq('status', 'proposed')
      .gte('scheduled_for', start.toISOString())
      .lt('scheduled_for', new Date(start.getTime() + WEEK_MS).toISOString())
      .limit(200);
    if (error) {
      if (missingTable(error)) throw new MarketingError(NOT_SET_UP, 503);
      throw new Error(error.message);
    }
    targets = (data ?? []) as ScheduledPost[];
  } else {
    throw new MarketingError('Say which posts to approve, or which week.');
  }

  const ready: ScheduledPost[] = [];
  for (const post of targets) {
    if (post.status === 'approved' || post.status === 'published' || post.status === 'publishing') {
      out.skipped.push({ id: post.id, why: `It is already ${post.status}.` });
    } else if (post.status !== 'proposed') {
      out.skipped.push({ id: post.id, why: `It was ${post.status}. Reschedule it to put it back on the calendar.` });
    } else if (Date.parse(post.scheduled_for) <= now.getTime()) {
      out.skipped.push({ id: post.id, why: 'Its time has already passed. Give it a new time first.' });
    } else {
      ready.push(post);
    }
  }
  if (!ready.length) return out;

  // The status filter makes a second, overlapping approval a no-op.
  const { data: done, error } = await serviceClient
    .from('scheduled_posts')
    .update({ status: 'approved', approved_by: opts.by, approved_at: now.toISOString(), updated_at: now.toISOString() })
    .eq('tenant_id', tenantId).eq('status', 'proposed')
    .in('id', ready.map((p) => p.id))
    .select('*');
  if (error) throw new Error(error.message);
  out.approved = (done ?? []) as ScheduledPost[];
  return out;
}

export interface PostPatch {
  caption?: string;
  scheduledFor?: Date;
  /** 'rejected' turns a proposal down; 'cancelled' takes an approved post off the calendar. */
  status?: 'rejected' | 'cancelled';
  /** Swap the photo or video for another approved library item. */
  contentItemId?: string;
}

/**
 * Edit, move, swap, reject or cancel one post.
 *
 * `byAgent` marks a change Shwari made on the owner's word: words it wrote
 * are a draft, so an approved post it re-captions goes back to proposed.
 */
export async function updatePost(
  tenantId: string,
  id: string,
  patch: PostPatch,
  opts: { by: string | null; byAgent?: boolean; now?: Date } = { by: null }
): Promise<ScheduledPost> {
  const now = opts.now ?? new Date();
  const post = await getPost(tenantId, id);
  if (post.status === 'published' || post.status === 'publishing') {
    throw new MarketingError(
      post.status === 'published'
        ? `That post has already been published. It can only be changed on ${platformName(post.platform)} itself.`
        : 'That post is being published right now.',
      409
    );
  }

  const change: Record<string, unknown> = { updated_at: now.toISOString() };

  if (patch.status) {
    if (post.status === 'rejected' || post.status === 'cancelled') return post;
    change.status = patch.status;
    change.container_id = null;
  } else {
    let caption = post.caption;
    let linked: { product_id?: string | null; service_id?: string | null } | null = null;

    if (patch.contentItemId) {
      if (!isUuid(patch.contentItemId)) throw new MarketingError('That library item could not be found.', 404);
      const { data } = await serviceClient
        .from('content_items').select('*').eq('tenant_id', tenantId).eq('id', patch.contentItemId).limit(1);
      const item = Array.isArray(data) ? (data[0] as ContentItem | undefined) : undefined;
      if (!item) throw new MarketingError('That library item could not be found.', 404);
      if (item.status !== 'approved') throw new MarketingError('Only an approved library item can be posted. Approve it in the library first.', 409);
      if (!itemAllows(item, post.platform)) {
        throw new MarketingError(`That item is not marked for ${platformName(post.platform)}. Mark it in the library first.`, 409);
      }
      change.content_item_id = item.id;
      change.media_url = item.media_url;
      change.media_type = item.media_type === 'video' ? 'video' : 'image';
      change.about = item.about ?? null;
      change.container_id = null;
      caption = item.caption ?? '';
      linked = item;
    }
    if (patch.caption !== undefined) caption = String(patch.caption).slice(0, 2200);

    const captionChanged = caption !== post.caption;
    if (captionChanged || patch.contentItemId) {
      change.caption = caption;
      change.needs_review_reason = (await captionCheck(tenantId, caption, linked)).reason;
    }

    if (patch.scheduledFor) {
      if (Number.isNaN(patch.scheduledFor.getTime())) throw new MarketingError('That is not a date and time.');
      if (patch.scheduledFor.getTime() <= now.getTime()) throw new MarketingError('Choose a time in the future.');
      if (patch.scheduledFor.getTime() - now.getTime() > 90 * 86_400_000) throw new MarketingError('That is too far ahead. Choose a time within the next three months.');
      change.scheduled_for = patch.scheduledFor.toISOString();
    }

    // A failed, rejected or cancelled post that is edited or moved comes back
    // as a proposal: it has to be approved again before it can go out.
    const revived = post.status === 'failed' || post.status === 'rejected' || post.status === 'cancelled';
    const redrafted = post.status === 'approved' && (Boolean(patch.contentItemId) || (captionChanged && opts.byAgent));
    if (revived || redrafted) {
      change.status = 'proposed';
      change.approved_by = null;
      change.approved_at = null;
      change.failure_reason = null;
      change.container_id = null;
      if (revived) change.attempt_count = 0;
    }
    if (Object.keys(change).length === 1) return post;
  }

  const { data, error } = await serviceClient
    .from('scheduled_posts')
    .update(change)
    .eq('tenant_id', tenantId).eq('id', id).eq('status', post.status)
    .select('*');
  if (error) {
    if (error.code === '23505') throw new MarketingError('Another post is already set for that time. Choose a different time.', 409);
    throw new Error(error.message);
  }
  const row = Array.isArray(data) ? (data[0] as ScheduledPost | undefined) : undefined;
  if (!row) throw new MarketingError('That post changed a moment ago. Refresh and try again.', 409);
  return row;
}

/**
 * Put one specific approved library item on the calendar, as a proposal.
 *
 * `platform` says where. Left out, it is the first connected platform the item
 * is marked for, Instagram before Facebook.
 */
export async function schedulePost(
  tenantId: string,
  input: { contentItemId: string; scheduledFor: Date; platform?: Platform | null; now?: Date }
): Promise<ScheduledPost> {
  const now = input.now ?? new Date();
  if (!isUuid(input.contentItemId)) throw new MarketingError('That library item could not be found.', 404);
  if (Number.isNaN(input.scheduledFor.getTime()) || input.scheduledFor.getTime() <= now.getTime()) {
    throw new MarketingError('Choose a time in the future.');
  }
  if (input.scheduledFor.getTime() - now.getTime() > 90 * 86_400_000) {
    throw new MarketingError('That is too far ahead. Choose a time within the next three months.');
  }

  const { data, error: readErr } = await serviceClient
    .from('content_items').select('*').eq('tenant_id', tenantId).eq('id', input.contentItemId).limit(1);
  if (readErr) {
    if (missingTable(readErr)) throw new MarketingError(NOT_SET_UP, 503);
    throw new Error(readErr.message);
  }
  const item = Array.isArray(data) ? (data[0] as ContentItem | undefined) : undefined;
  if (!item) throw new MarketingError('That library item could not be found.', 404);
  if (item.status !== 'approved') throw new MarketingError('Only an approved library item can be posted. Approve it in the library first.', 409);
  if (item.max_uses !== null && item.max_uses !== undefined && (item.times_used ?? 0) >= item.max_uses) {
    throw new MarketingError('That item has reached its reuse limit.', 409);
  }

  let platform: Platform;
  if (input.platform) {
    if (!isPlatform(input.platform)) throw new MarketingError('The platform must be instagram or facebook.');
    if (!itemAllows(item, input.platform)) {
      throw new MarketingError(`That item is not marked for ${platformName(input.platform)}. Mark it in the library first.`, 409);
    }
    platform = input.platform;
  } else {
    const allowed = (await postingPlatforms(tenantId)).find((p) => itemAllows(item, p));
    if (!allowed) {
      throw new MarketingError('That item is not marked for a platform this business has connected. Mark it in the library first.', 409);
    }
    platform = allowed;
  }

  const [settings, tenant, check] = await Promise.all([
    getSettings(tenantId), tenantInfo(tenantId), captionCheck(tenantId, item.caption ?? '', item),
  ]);
  const auto = settings.approval_mode === 'autopilot' && check.ok;

  const { data: created, error } = await serviceClient
    .from('scheduled_posts')
    .insert({
      tenant_id: tenantId,
      content_item_id: item.id,
      platform,
      caption: item.caption ?? '',
      media_url: item.media_url,
      media_type: item.media_type === 'video' ? 'video' : 'image',
      about: item.about ?? null,
      scheduled_for: input.scheduledFor.toISOString(),
      status: auto ? 'approved' : 'proposed',
      needs_review_reason: check.reason,
      approved_at: auto ? now.toISOString() : null,
      week_start: localDate(input.scheduledFor, tenant.timezone),
    })
    .select('*');
  if (error) {
    if (error.code === '23505') throw new MarketingError('There is already a post at that time. Choose a different time.', 409);
    if (missingTable(error)) throw new MarketingError(NOT_SET_UP, 503);
    throw new Error(error.message);
  }
  const row = (Array.isArray(created) ? created[0] : created) as ScheduledPost | undefined;
  if (!row) throw new Error('The post was not saved.');
  return row;
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

export interface PublishSummary {
  due: number;
  published: number;
  failed: number;
  /** Left for later: posting is paused or the Marketing agent is off, the daily ceiling was reached, or a video is still processing. */
  held: number;
  /** Rows left because the time budget ran out. */
  deferred: number;
  /** Rows found stuck in 'publishing' and marked failed. */
  swept: number;
}

type Outcome = 'published' | 'failed' | 'processing' | 'not_claimed';

/** What both publishers raise: a sentence for the owner, and whether it may have gone out anyway. */
type PublishFailure = InstagramPublishError | FacebookPublishError;

/**
 * Hand one claimed post to the platform it is for.
 *
 * Returns 'processing' only for Instagram, whose videos are made in two steps;
 * a Page takes a post in one call, so it is published or it failed.
 */
async function sendToPlatform(
  post: ScheduledPost,
  waitMs: number
): Promise<{ state: 'published'; postId: string; permalink: string | null; containerId: string | null } | { state: 'processing'; containerId: string }> {
  if (post.platform === 'facebook') {
    let page: Awaited<ReturnType<typeof loadConnectedPage>> = null;
    try {
      page = await loadConnectedPage(post.tenant_id);
    } catch (e) {
      console.error('[marketing] could not read the Facebook connection:', e instanceof Error ? e.message : e);
    }
    if (!page) {
      throw new FacebookPublishError('not_connected', 'No Facebook Page is connected. Connect one on the Integrations page, then reschedule this post.');
    }
    if (page.isExpired) {
      throw new FacebookPublishError('token', 'The Facebook connection has expired. Reconnect the Page on the Integrations page, then reschedule this post.');
    }
    const done = await publishToFacebookPage({
      accessToken: page.accessToken,
      pageId: page.pageId,
      mediaUrl: post.media_url,
      mediaType: post.media_type,
      caption: post.caption ?? '',
      timeoutMs: post.media_type === 'video' ? Math.max(waitMs + 20_000, 30_000) : 20_000,
    });
    return { ...done, containerId: null };
  }

  let token: Awaited<ReturnType<typeof loadToken>> = null;
  try {
    token = await loadToken(post.tenant_id, 'instagram');
  } catch (e) {
    console.error('[marketing] could not read the Instagram connection:', e instanceof Error ? e.message : e);
  }
  if (!token) {
    throw new InstagramPublishError('not_connected', 'Instagram is not connected. Connect it on the Integrations page, then reschedule this post.');
  }
  if (token.isExpired) {
    throw new InstagramPublishError('token', 'The Instagram connection has expired. Reconnect Instagram on the Integrations page, then reschedule this post.');
  }

  return publishToInstagram({
    accessToken: token.accessToken,
    igUserId: token.instagramUserId,
    mediaUrl: post.media_url,
    mediaType: post.media_type,
    caption: post.caption ?? '',
    containerId: post.container_id,
    waitMs,
  });
}

async function failPost(
  post: Pick<ScheduledPost, 'id' | 'tenant_id' | 'about' | 'scheduled_for'>,
  from: PostStatus,
  reason: string
): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await serviceClient
    .from('scheduled_posts')
    .update({ status: 'failed', failure_reason: reason.slice(0, 500), updated_at: now })
    .eq('id', post.id).eq('status', from)
    .select('id');
  if (error) {
    console.error(`[marketing] could not mark ${post.id} failed:`, error.message);
    return false;
  }
  if (!Array.isArray(data) || !data.length) return false;
  await notify({
    tenantId: post.tenant_id,
    kind: 'post_failed',
    title: `A post was not published${post.about ? `: ${post.about}` : ''}`,
    body: reason,
    link: '/marketing',
    refId: `post:${post.id}:${now.slice(0, 10)}`,
  });
  return true;
}

/**
 * Claim one approved post and publish it.
 *
 * The claim is the update to 'publishing' filtered on status 'approved': only
 * one runner can win it, and a post that was never approved cannot be claimed
 * at all - there is no other path to the publish call.
 */
async function publishOne(post: ScheduledPost, waitMs: number): Promise<Outcome> {
  const { data: claimed, error: claimErr } = await serviceClient
    .from('scheduled_posts')
    .update({ status: 'publishing', attempt_count: (post.attempt_count ?? 0) + 1, updated_at: new Date().toISOString() })
    .eq('id', post.id).eq('status', 'approved')
    .select('id');
  if (claimErr) {
    console.warn('[marketing] claim failed:', claimErr.message);
    return 'not_claimed';
  }
  if (!Array.isArray(claimed) || !claimed.length) return 'not_claimed';

  const where = platformName(post.platform);
  let failure: PublishFailure;
  try {
    const result = await sendToPlatform(post, waitMs);

    if (result.state === 'processing') {
      if ((post.attempt_count ?? 0) + 1 >= MAX_VIDEO_ATTEMPTS) {
        await failPost(post, 'publishing', 'Instagram did not finish processing this video. Nothing was posted.');
        return 'failed';
      }
      // Not published yet, and nothing has been sent to the feed: hand it back
      // to the queue with its container so the next run resumes, not re-uploads.
      await serviceClient
        .from('scheduled_posts')
        .update({ status: 'approved', container_id: result.containerId, updated_at: new Date().toISOString() })
        .eq('id', post.id).eq('status', 'publishing');
      return 'processing';
    }

    const publishedAt = new Date().toISOString();
    const { error: doneErr } = await serviceClient
      .from('scheduled_posts')
      .update({
        status: 'published',
        published_at: publishedAt,
        external_post_id: result.postId,
        external_permalink: result.permalink,
        container_id: result.containerId,
        failure_reason: null,
        updated_at: publishedAt,
      })
      .eq('id', post.id).eq('status', 'publishing');
    // It is out in public either way. A row we could not update stays
    // 'publishing' and is swept to failed with a note to check the account,
    // which is the honest state and never causes a second post.
    if (doneErr) console.error(`[marketing] published ${post.id} but could not record it:`, doneErr.message);

    if (post.content_item_id) {
      // One outing is one use. When the same item went out at the same time on
      // the other platform, that outing has been counted already.
      const { data: twins } = await serviceClient
        .from('scheduled_posts').select('id')
        .eq('tenant_id', post.tenant_id).eq('content_item_id', post.content_item_id)
        .eq('scheduled_for', post.scheduled_for).eq('status', 'published').neq('id', post.id)
        .limit(1);
      if (!Array.isArray(twins) || !twins.length) {
        const { data: item } = await serviceClient
          .from('content_items').select('times_used').eq('id', post.content_item_id).eq('tenant_id', post.tenant_id).limit(1);
        const used = Array.isArray(item) && item[0] ? Number(item[0].times_used) || 0 : 0;
        await serviceClient
          .from('content_items')
          .update({ times_used: used + 1, last_used_at: publishedAt, updated_at: publishedAt })
          .eq('id', post.content_item_id).eq('tenant_id', post.tenant_id);
      }
    }

    await notify({
      tenantId: post.tenant_id,
      kind: 'post_published',
      title: `Posted to ${where}${post.about ? `: ${post.about}` : ''}`,
      body: (post.caption ?? '').slice(0, 200),
      link: '/marketing',
      refId: `post:${post.id}`,
    });
    return 'published';
  } catch (e) {
    failure = e instanceof InstagramPublishError || e instanceof FacebookPublishError
      ? e
      : new InstagramPublishError('unreachable', `Something went wrong while posting. It may or may not have gone out - check ${where} before posting it again.`, { uncertain: true });
    console.error(`[marketing] publish failed for ${post.id}:`, e instanceof Error ? e.message : e);
  }

  await failPost(post, 'publishing', failure.userMessage);
  return 'failed';
}

/** A row left in 'publishing' was interrupted. Say so; never try it again unasked. */
async function sweepStale(now: Date): Promise<number> {
  const { data, error } = await serviceClient
    .from('scheduled_posts')
    .select('id, tenant_id, about, scheduled_for, platform')
    .eq('status', 'publishing')
    .lt('updated_at', new Date(now.getTime() - STALE_PUBLISHING_MS).toISOString())
    .limit(50);
  if (error || !Array.isArray(data)) return 0;
  let swept = 0;
  for (const row of data as Array<Pick<ScheduledPost, 'id' | 'tenant_id' | 'about' | 'scheduled_for' | 'platform'>>) {
    const done = await failPost(
      row, 'publishing',
      `Publishing was interrupted. The post may or may not have gone out - check ${platformName(row.platform)} before posting it again.`
    );
    if (done) swept++;
  }
  return swept;
}

async function publishedInLastDay(tenantId: string, now: Date): Promise<number> {
  const { data } = await serviceClient
    .from('scheduled_posts').select('id')
    .eq('tenant_id', tenantId).eq('status', 'published')
    .gte('published_at', new Date(now.getTime() - 86_400_000).toISOString())
    .limit(DAILY_POST_CAP + 1);
  return Array.isArray(data) ? data.length : 0;
}

/**
 * Publish the approved posts whose time has come.
 *
 * Safe to call as often as the scheduler likes. Only status 'approved' is
 * ever read; proposed, rejected and cancelled rows are not candidates, so an
 * unapproved week publishes nothing.
 */
export async function publishDuePosts(
  opts: { limit?: number; budgetMs?: number; now?: Date } = {}
): Promise<PublishSummary> {
  const now = opts.now ?? new Date();
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
  const deadline = Date.now() + (opts.budgetMs ?? 20_000);
  const summary: PublishSummary = { due: 0, published: 0, failed: 0, held: 0, deferred: 0, swept: 0 };

  const { data: due, error } = await serviceClient
    .from('scheduled_posts')
    .select('*')
    .eq('status', 'approved')
    .lte('scheduled_for', now.toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(limit);
  if (error) {
    if (missingTable(error)) return summary;
    console.error('[marketing] could not read due posts:', error.message);
    throw new Error('Could not read the posting queue');
  }

  summary.swept = await sweepStale(now);

  const rows = (due ?? []) as ScheduledPost[];
  summary.due = rows.length;
  const settings = new Map<string, PostingSettings>();
  const postedToday = new Map<string, number>();

  for (let i = 0; i < rows.length; i++) {
    if (Date.now() > deadline) { summary.deferred = rows.length - i; break; }
    const post = rows[i];
    // Belt and braces: the query asked for approved rows only.
    if (post.status !== 'approved') continue;

    if (!settings.has(post.tenant_id)) settings.set(post.tenant_id, await getSettings(post.tenant_id));
    // Held, not failed: the post keeps its approval and goes out once posting
    // is resumed or the Marketing agent is switched back on.
    if (postingStopped(settings.get(post.tenant_id)!)) { summary.held++; continue; }
    // A business that is waiting for approval, suspended or paused by the
    // platform publishes nothing. Held, so it goes out once it is live again.
    if (!(await tenantLiveness(post.tenant_id)).live) { summary.held++; continue; }

    if (now.getTime() - Date.parse(post.scheduled_for) > MISSED_AFTER_MS) {
      const done = await failPost(post, 'approved',
        'This post missed its time by more than a day, so it was not published late. Reschedule it to post it.');
      if (done) summary.failed++;
      continue;
    }

    if (!postedToday.has(post.tenant_id)) postedToday.set(post.tenant_id, await publishedInLastDay(post.tenant_id, now));
    if (postedToday.get(post.tenant_id)! >= DAILY_POST_CAP) { summary.held++; continue; }

    // Wait for the media only as long as this run can afford; a video that is
    // still processing is picked up again by the next run.
    const outcome = await publishOne(post, Math.max(2_000, Math.min(deadline - Date.now() - 3_000, 12_000)));
    if (outcome === 'published') {
      summary.published++;
      postedToday.set(post.tenant_id, postedToday.get(post.tenant_id)! + 1);
    } else if (outcome === 'failed') summary.failed++;
    else if (outcome === 'processing') summary.held++;
  }
  return summary;
}

/**
 * Publish one post now, on a person's say-so.
 *
 * Pressing the button is the approval. It still goes through the same claim,
 * so pressing it twice, or pressing it as the scheduler runs, posts once.
 */
export async function publishNow(
  tenantId: string,
  id: string,
  opts: { by: string | null; now?: Date }
): Promise<{ outcome: Outcome; post: ScheduledPost }> {
  const now = opts.now ?? new Date();
  const post = await getPost(tenantId, id);
  if (post.status === 'published') throw new MarketingError('That post has already been published.', 409);
  if (post.status === 'publishing') throw new MarketingError('That post is being published right now.', 409);
  if (post.status === 'rejected' || post.status === 'cancelled') {
    throw new MarketingError(`That post was ${post.status}. Reschedule it first.`, 409);
  }
  const settings = await getSettings(tenantId);
  if (settings.paused) {
    throw new MarketingError('Posting is paused. Resume it under Schedule before publishing.', 409);
  }
  if (settings.agent_off) {
    throw new MarketingError('The Marketing agent is switched off. Switch it on from the AI team page before publishing.', 409);
  }
  if ((await publishedInLastDay(tenantId, now)) >= DAILY_POST_CAP) {
    throw new MarketingError(`This business has already posted ${DAILY_POST_CAP} times in the last day. Try again tomorrow.`, 429);
  }

  let ready = post;
  if (post.status !== 'approved') {
    const { data, error } = await serviceClient
      .from('scheduled_posts')
      .update({
        status: 'approved',
        approved_by: opts.by,
        approved_at: now.toISOString(),
        failure_reason: null,
        container_id: null,
        updated_at: now.toISOString(),
      })
      .eq('tenant_id', tenantId).eq('id', id).eq('status', post.status)
      .select('*');
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? (data[0] as ScheduledPost | undefined) : undefined;
    if (!row) throw new MarketingError('That post changed a moment ago. Refresh and try again.', 409);
    ready = row;
  }

  const outcome = await publishOne(ready, 20_000);
  return { outcome, post: await getPost(tenantId, id) };
}

// ---------------------------------------------------------------------------
// Whether this business can post at all
// ---------------------------------------------------------------------------

export interface InstagramStatus {
  connected: boolean;
  username: string | null;
  /** True: posting was granted. False: connected without it. Null: not connected. */
  can_publish: boolean | null;
  expired: boolean;
}

const PUBLISH_SCOPE = 'instagram_business_content_publish';

/**
 * One sentence for whoever is about to be told posts are approved, when a
 * platform on the calendar cannot actually be posted to. Empty when all can.
 */
export async function postingReadiness(tenantId: string): Promise<{
  platforms: Platform[]; instagram: InstagramStatus; facebook: FacebookStatus; note: string;
}> {
  const [platforms, instagram, facebook] = await Promise.all([
    postingPlatforms(tenantId), instagramStatus(tenantId), facebookStatus(tenantId),
  ]);
  const notes: string[] = [];
  if (platforms.includes('instagram') && instagram.can_publish !== true) {
    notes.push('Instagram is not connected with permission to post, so posts for it will fail until it is reconnected on the Integrations page.');
  }
  if (platforms.includes('facebook') && (facebook.can_publish !== true || facebook.expired)) {
    notes.push('The Facebook Page is not connected with permission to post, so posts for it will fail until it is reconnected on the Integrations page.');
  }
  return { platforms, instagram, facebook, note: notes.join(' ') };
}

export interface FacebookStatus {
  connected: boolean;
  /** The Page's name, as Facebook gave it. */
  page_name: string | null;
  /** True: the Page can be posted to. False: connected without it. Null: not connected. */
  can_publish: boolean | null;
  expired: boolean;
}

/** Whether this business has a Facebook Page connected that can be posted to. */
export async function facebookStatus(tenantId: string): Promise<FacebookStatus> {
  const none: FacebookStatus = { connected: false, page_name: null, can_publish: null, expired: false };
  let page: Awaited<ReturnType<typeof loadConnectedPage>> = null;
  try {
    page = await loadConnectedPage(tenantId);
  } catch (e) {
    console.warn('[marketing] could not read the Facebook connection:', e instanceof Error ? e.message : e);
  }
  if (!page) return none;
  return {
    connected: true,
    page_name: page.pageName,
    can_publish: pageCanPublish(page.tasks),
    expired: page.isExpired,
  };
}

export async function instagramStatus(tenantId: string): Promise<InstagramStatus> {
  const { data, error } = await serviceClient
    .from('meta_tokens')
    .select('instagram_username, scopes, token_expires_at')
    .eq('tenant_id', tenantId).eq('platform', 'instagram')
    .limit(1);
  const row = !error && Array.isArray(data) ? data[0] : null;
  if (!row) return { connected: false, username: null, can_publish: null, expired: false };
  const scopes: string[] = Array.isArray(row.scopes) ? row.scopes.map(String) : [];
  return {
    connected: true,
    username: row.instagram_username ?? null,
    // A connection made before posting existed recorded no scopes and was not
    // asked for this one, so "unknown" is treated as "not granted".
    can_publish: scopes.includes(PUBLISH_SCOPE),
    expired: row.token_expires_at ? Date.parse(row.token_expires_at) <= Date.now() : false,
  };
}
