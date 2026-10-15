import type { BallType, FormatAvailability, FormatWindow, PlayFormat } from '@daji/shared';
import { registerSchema } from './db.ts';
import { HttpError } from './errors.ts';
import { MIN, isWeekend, istMidnight, timeOfDay } from './time.ts';
import type { GroundRow } from './grounds.ts';
import { hoursOn } from './hours.ts';
import { isClosedOn } from './rates.ts';

// Play formats: which ball, and how long a session is. Added after the first release, so it is a migration.
registerSchema('play-formats-1', `ALTER TABLE grounds ADD COLUMN formats TEXT NOT NULL DEFAULT '[]';
ALTER TABLE bookings ADD COLUMN format_label TEXT;
ALTER TABLE bookings ADD COLUMN ball TEXT;`);

export const BALLS: readonly BallType[] = ['combo', 'leather', 'red', 'white', 'tennis'];
export const MAX_FORMATS = 12;

export const groundFormats = (g: Pick<GroundRow, 'formats'>): PlayFormat[] => {
  try { const v = JSON.parse(g.formats || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
};

/** Checks a list sent by the owner. Returns the cleaned list, or a message saying what is wrong. */
export function cleanFormats(raw: unknown, slotMinutes: number, span: number, maxSlots: number): { ok: PlayFormat[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length > MAX_FORMATS) return { error: `Send a list of up to ${MAX_FORMATS} formats` };
  const out: PlayFormat[] = [], seen = new Set<string>();
  for (const x of raw) {
    if (!x || typeof x !== 'object') return { error: 'Each format needs a label, ball, length and price' };
    const f = x as Record<string, unknown>;
    const label = typeof f.label === 'string' ? f.label.trim() : '';
    if (label.length < 2 || label.length > 40) return { error: 'A format name must be 2 to 40 characters' };
    if (!BALLS.includes(f.ball as BallType)) return { error: `${label}: choose red, white or tennis ball` };
    const minutes = f.minutes;
    if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < slotMinutes) return { error: `${label}: the session must be at least one slot (${slotMinutes} minutes)` };
    if (minutes % slotMinutes !== 0) return { error: `${label}: the length must be a multiple of the ${slotMinutes}-minute slot` };
    if (minutes / slotMinutes > maxSlots) return { error: `${label}: longer than the most slots allowed together (${maxSlots})` };
    if (minutes > span) return { error: `${label}: longer than the opening hours` };
    const price = f.pricePaise;
    if (typeof price !== 'number' || !Number.isInteger(price) || price < 0 || price > 1_000_000_00) return { error: `${label}: enter a price` };
    let weekend: number | null = null;
    if (f.weekendPricePaise != null && f.weekendPricePaise !== '') {
      if (typeof f.weekendPricePaise !== 'number' || !Number.isInteger(f.weekendPricePaise) || f.weekendPricePaise < 0 || f.weekendPricePaise > 1_000_000_00) return { error: `${label}: the weekend price is not valid` };
      weekend = f.weekendPricePaise;
    }
    const id = `${f.ball}-${minutes}`;
    if (seen.has(id)) return { error: `${label}: there is already a ${f.ball} ball format of ${minutes} minutes` };
    seen.add(id);
    out.push({ id, label, ball: f.ball as BallType, minutes, pricePaise: price, weekendPricePaise: weekend });
  }
  return { ok: out };
}

export interface RawWindow { start: number; end: number; slotStarts: number[]; pricePaise?: number }

/** Sessions of a format on a date: back to back from opening time, each as long as the format, while they fit before closing. */
export function formatWindows(g: GroundRow, date: string, f: PlayFormat): RawWindow[] {
  const { open, close } = hoursOn(g, date), base = istMidnight(date);
  const out: RawWindow[] = [];
  if (isClosedOn(g, date)) return out;
  for (let m = open; m + f.minutes <= close; m += f.minutes) {
    const slotStarts: number[] = [];
    for (let k = m; k < m + f.minutes; k += g.slot_minutes) slotStarts.push(base + k * MIN);
    out.push({ start: base + m * MIN, end: base + (m + f.minutes) * MIN, slotStarts });
  }
  return out;
}

export const formatPrice = (f: PlayFormat, date: string): number => (isWeekend(date) && f.weekendPricePaise != null ? f.weekendPricePaise : f.pricePaise);

export function findFormat(g: GroundRow, formatId: string): PlayFormat {
  const f = groundFormats(g).find((x) => x.id === formatId);
  if (!f) throw new HttpError(400, 'UNKNOWN_FORMAT', 'That way of playing is not offered at this ground');
  return f;
}

export function availabilityByFormat(g: GroundRow, date: string, stateOf: (slotStart: number) => FormatWindow['state'], t: number): FormatAvailability[] {
  return groundFormats(g).map((f) => ({
    formatId: f.id,
    windows: formatWindows(g, date, f).map((w) => {
      const states = w.slotStarts.map(stateOf);
      const worst = (['booked', 'held', 'blocked', 'past'] as const).find((s) => states.includes(s)) ?? 'available';
      const state: FormatWindow['state'] = !g.active ? 'blocked' : w.start <= t || w.start < t + g.min_notice_minutes * MIN ? (worst === 'available' ? 'past' : worst) : worst;
      return { start: w.start, end: w.end, time: timeOfDay(w.start), endTime: timeOfDay(w.end), pricePaise: w.pricePaise ?? formatPrice(f, date), state };
    }),
  }));
}
