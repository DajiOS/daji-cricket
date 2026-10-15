// IST (UTC+05:30, no DST). Dates are YYYY-MM-DD strings in IST; instants are epoch ms.
export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
export const IST_OFFSET_MS = 330 * MIN;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidDate(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const y = +m[1]!, mo = +m[2]!, d = +m[3]!;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Epoch ms of 00:00 IST on the given date. */
export function istMidnight(date: string): number {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`bad date ${date}`);
  return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!) - IST_OFFSET_MS;
}

/** IST calendar date of an instant. */
export function istDate(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  return istDate(istMidnight(date) + n * DAY + 12 * HOUR);
}

/** 0 = Sunday … 6 = Saturday, for an IST date. */
export function dayOfWeek(date: string): number {
  return new Date(istMidnight(date) + IST_OFFSET_MS).getUTCDay();
}

export function isWeekend(date: string): boolean {
  const d = dayOfWeek(date);
  return d === 0 || d === 6;
}

/** "HH:MM" → minutes since midnight. A closing time may run past midnight: "27:00" is 3 am the next morning (the most allowed). Null if invalid. */
export function minutesOf(t: unknown): number | null {
  if (typeof t !== 'string') return null;
  const m = /^(\d{2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const h = +m[1]!, mi = +m[2]!;
  if (mi > 59 || h > 27 || (h === 27 && mi !== 0)) return null;
  return h * 60 + mi;
}

export function timeOfDay(ms: number): string {
  const d = new Date(ms + IST_OFFSET_MS);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export function fmtDateTime(ms: number): string {
  const d = new Date(ms + IST_OFFSET_MS);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  return `${d.getUTCDate()} ${mon} ${d.getUTCFullYear()}, ${timeOfDay(ms)} IST`;
}

/** First and last date (inclusive) of a YYYY-MM month. */
export function monthRange(month: string): { from: string; to: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const y = +m[1]!, mo = +m[2]!;
  if (mo < 1 || mo > 12) return null;
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { from: `${m[1]}-${m[2]}-01`, to: `${m[1]}-${m[2]}-${String(last).padStart(2, '0')}` };
}
