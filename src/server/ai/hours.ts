import { serviceClient } from '../supabase.js';

/**
 * Opening hours live in two places, and they have to agree.
 *
 *   business_hours           one row per weekday. What the agents read, and
 *                            what a booking is checked against.
 *   tenants.business_hours   a small JSON object. What the Settings page
 *                            shows and edits.
 *
 * They were written independently: Shwari saved hours to the table and said
 * "done", and the owner opened Settings and saw nothing. Every write to either
 * side now carries across to the other through this file.
 */

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** Monday first: how a person reads a week. */
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export interface HoursRow {
  day_of_week: number;
  closed: boolean;
  opens: string | null;
  closes: string | null;
  note?: string | null;
}

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '');

/** The table rows as the object the Settings page shows. */
export function rowsToSettings(rows: HoursRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const day of DISPLAY_ORDER) {
    const row = rows.find((r) => r.day_of_week === day);
    if (!row) continue;
    const text = row.closed ? 'Closed' : `${hhmm(row.opens)} - ${hhmm(row.closes)}`;
    out[DAY_NAMES[day]] = row.note ? `${text} (${row.note})` : text;
  }
  return out;
}

function dayIndex(word: string): number {
  const w = word.trim().toLowerCase().replace(/[^a-z]/g, '');
  if (w.length < 3) return -1;
  return DAY_NAMES.findIndex((d) => d.toLowerCase().startsWith(w.slice(0, 3)));
}

function parseTime(raw: string): string | null {
  const m = raw.trim().toLowerCase().replace(/\s+/g, '').match(/^(\d{1,2})(?:[:.](\d{2}))?(am|pm)?$/);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? '0');
  if (m[3] === 'pm' && hour < 12) hour += 12;
  if (m[3] === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Which weekdays a key such as "Monday", "Mon-Fri", "Weekdays" or "Daily" means. */
function daysOf(key: string): number[] {
  const k = key.trim().toLowerCase();
  if (/^(daily|every ?day|all week|mon(day)?\s*[-–—to]+\s*sun(day)?)$/.test(k)) return [0, 1, 2, 3, 4, 5, 6];
  if (/^week ?days?$/.test(k)) return [1, 2, 3, 4, 5];
  if (/^week ?ends?$/.test(k)) return [6, 0];

  const range = k.split(/\s*(?:-|–|—|\bto\b)\s*/);
  if (range.length === 2) {
    const from = dayIndex(range[0]);
    const to = dayIndex(range[1]);
    if (from >= 0 && to >= 0) {
      const days: number[] = [];
      for (let d = from; ; d = (d + 1) % 7) {
        days.push(d);
        if (d === to || days.length === 7) break;
      }
      return days;
    }
  }
  return k.split(/\s*(?:,|&|\band\b)\s*/).map(dayIndex).filter((d) => d >= 0);
}

/**
 * Read the Settings object back into table rows. Anything it cannot make
 * sense of is skipped rather than guessed: a note such as "by appointment"
 * stays in Settings and simply does not become a row.
 */
export function settingsToRows(settings: unknown): HoursRow[] {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return [];
  const rows = new Map<number, HoursRow>();

  for (const [key, raw] of Object.entries(settings as Record<string, unknown>)) {
    const days = daysOf(key);
    if (!days.length) continue;
    const value = String(raw ?? '').trim();
    if (!value) continue;

    if (/^(closed|shut|off|hakuna|imefungwa)\b/i.test(value)) {
      for (const d of days) rows.set(d, { day_of_week: d, closed: true, opens: null, closes: null });
      continue;
    }
    const m = value.match(/^(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)\s*(?:-|–|—|to|until)\s*(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)/i);
    if (!m) continue;
    let opens = parseTime(m[1]);
    let closes = parseTime(m[2]);
    if (!opens || !closes) continue;
    // "8-5" means eight in the morning to five in the afternoon.
    if (closes <= opens && !/am|pm/i.test(m[2]) && Number(closes.slice(0, 2)) < 12) {
      closes = `${String(Number(closes.slice(0, 2)) + 12).padStart(2, '0')}${closes.slice(2)}`;
    }
    if (closes <= opens) continue;
    for (const d of days) rows.set(d, { day_of_week: d, closed: false, opens, closes });
  }
  return [...rows.values()];
}

/** After the table changed: show the same hours on the Settings page. */
export async function mirrorHoursToSettings(tenantId: string): Promise<boolean> {
  const { data, error } = await serviceClient
    .from('business_hours')
    .select('day_of_week, closed, opens, closes, note')
    .eq('tenant_id', tenantId);
  if (error || !Array.isArray(data)) return false;

  const { error: writeErr } = await serviceClient
    .from('tenants')
    .update({ business_hours: rowsToSettings(data as HoursRow[]), updated_at: new Date().toISOString() })
    .eq('id', tenantId);
  if (writeErr) console.warn('[hours] could not update the Settings copy:', writeErr.message);
  return !writeErr;
}

/** After the Settings page was saved: give the agents the same hours. */
export async function syncHoursFromSettings(tenantId: string, settings: unknown): Promise<number> {
  const rows = settingsToRows(settings);
  if (!rows.length) return 0;
  const now = new Date().toISOString();
  const { error } = await serviceClient.from('business_hours').upsert(
    rows.map((r) => ({ tenant_id: tenantId, ...r, note: null, updated_at: now })),
    { onConflict: 'tenant_id,day_of_week' }
  );
  if (error) {
    console.warn('[hours] could not copy Settings hours to the diary:', error.message);
    return 0;
  }
  return rows.length;
}
