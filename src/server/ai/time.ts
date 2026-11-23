/**
 * Time, in the business's own timezone.
 *
 * The server runs in UTC and the model has no clock. Without help, "tomorrow at
 * 10" is a guess and a time written without an offset lands hours away from
 * what the customer meant. Everything here exists so that a date the model
 * writes down means what a person in the business's city would take it to mean.
 */

const DEFAULT_TIMEZONE = process.env.SHWARI_DEFAULT_TIMEZONE || 'Africa/Nairobi';

/** A timezone Intl accepts, falling back to the platform default. */
export function safeTimezone(tz: string | null | undefined): string {
  const candidate = (tz ?? '').trim();
  if (candidate) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: candidate });
      return candidate;
    } catch {
      /* fall through */
    }
  }
  return DEFAULT_TIMEZONE;
}

interface WallClock {
  year: number; month: number; day: number;
  hour: number; minute: number; second: number;
  /** 0 = Sunday, matching business_hours.day_of_week. */
  weekday: number;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** What the clock on the wall reads in `tz` at this instant. */
export function wallClock(at: Date, tz: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimezone(tz), hourCycle: 'h23', weekday: 'long',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: Number(get('year')), month: Number(get('month')), day: Number(get('day')),
    hour: Number(get('hour')) % 24, minute: Number(get('minute')), second: Number(get('second')),
    weekday: Math.max(0, WEEKDAYS.indexOf(get('weekday'))),
  };
}

/** Minutes `tz` is ahead of UTC at this instant. */
function offsetMinutes(at: Date, tz: string): number {
  const w = wallClock(at, tz);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((asUtc - at.getTime()) / 60_000);
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

const HAS_OFFSET = /(z|[+-]\d{2}:?\d{2})$/i;
const NAIVE = /^(\d{4})-(\d{2})-(\d{2})(?:[t\s](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?$/i;

/**
 * Read a date-time the model wrote.
 *
 * With an explicit offset it means exactly what it says. Without one it is a
 * wall-clock time in the business's timezone — "2026-09-04T14:30" is half past
 * two in Nairobi, not in UTC. Returns null when it is not a date at all.
 */
export function parseInTimezone(raw: string, tz: string | null | undefined): Date | null {
  const text = raw.trim();
  if (!text) return null;

  if (HAS_OFFSET.test(text)) {
    const d = new Date(text);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const m = NAIVE.exec(text);
  if (!m) {
    const d = new Date(text);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const zone = safeTimezone(tz);
  const naive = Date.UTC(
    Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)
  );
  if (Number.isNaN(naive)) return null;
  // Two passes settle the offset across a daylight-saving boundary.
  const first = naive - offsetMinutes(new Date(naive), zone) * 60_000;
  const second = naive - offsetMinutes(new Date(first), zone) * 60_000;
  return new Date(second);
}

/** "Thursday 19 November 2026, 14:35" plus the zone, for the prompt. */
export function describeNow(tz: string | null | undefined, at: Date = new Date()): string {
  const zone = safeTimezone(tz);
  const w = wallClock(at, zone);
  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(at);
  const hhmm = `${String(w.hour).padStart(2, '0')}:${String(w.minute).padStart(2, '0')}`;
  const iso = `${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`;
  return `${date}, ${hhmm} (${iso}, timezone ${zone}, UTC${formatOffset(offsetMinutes(at, zone))})`;
}

/** An instant rendered as local ISO with the zone's offset, e.g. 2026-09-04T14:30:00+03:00. */
export function toLocalIso(at: Date, tz: string | null | undefined): string {
  const zone = safeTimezone(tz);
  const w = wallClock(at, zone);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${w.year}-${p(w.month)}-${p(w.day)}T${p(w.hour)}:${p(w.minute)}:${p(w.second)}${formatOffset(offsetMinutes(at, zone))}`;
}
