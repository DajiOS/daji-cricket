import type { RepeatFrequency } from '@daji/shared';
import { many, one } from './db.ts';
import { HttpError } from './errors.ts';
import { Validator } from './input.ts';
import { now } from './clock.ts';
import { accessBooking } from './bookings.ts';
import { cancelBooking } from './cancellation.ts';
import type { UserRow } from './auth.ts';

// Repeating bookings: the same time on a ground, daily, weekly, monthly or yearly.
// The count includes the first date, which is booked and paid like any booking. The later dates are reserved with it.

export const REPEAT_LIMITS: Record<RepeatFrequency, number> = { daily: 60, weekly: 52, monthly: 12, yearly: 3 };
export const FREQUENCIES = Object.keys(REPEAT_LIMITS) as RepeatFrequency[];

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12

/** The dates of a series, first included. Monthly and yearly keep the day of the month, falling back to the last day of a shorter month. */
export function expandDates(first: string, frequency: RepeatFrequency, count: number): string[] {
  const y = Number(first.slice(0, 4)), m = Number(first.slice(5, 7)), d = Number(first.slice(8, 10));
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    if (frequency === 'daily' || frequency === 'weekly') {
      const t = new Date(Date.UTC(y, m - 1, d + i * (frequency === 'daily' ? 1 : 7)));
      out.push(`${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`);
    } else {
      const total = (frequency === 'monthly' ? i : i * 12) + (m - 1);
      const yy = y + Math.floor(total / 12), mm = (total % 12) + 1;
      out.push(`${yy}-${pad(mm)}-${pad(Math.min(d, lastDay(yy, mm)))}`);
    }
  }
  return out;
}

export function parseRepeat(body: unknown): { frequency: RepeatFrequency; count: number } | undefined {
  const raw = body && typeof body === 'object' ? (body as any).repeat : undefined;
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object') throw new HttpError(400, 'VALIDATION_FAILED', 'Check the repeat option', { fields: [{ field: 'repeat', message: 'Must be an object' }] });
  const v = new Validator(raw);
  const frequency = v.oneOf('frequency', FREQUENCIES, true);
  const count = v.int('count', { required: true, min: 2, max: 60 });
  v.done();
  const max = REPEAT_LIMITS[frequency!];
  if (count! > max) throw new HttpError(400, 'VALIDATION_FAILED', `A ${frequency} booking can repeat up to ${max} times`, { fields: [{ field: 'repeat.count', message: `At most ${max}` }] });
  return { frequency: frequency!, count: count! };
}

export interface SeriesView { id: string; frequency: RepeatFrequency; requested: number; bookings: { id: string; ref: string; date: string; status: string; totalPaise: number; paidPaise: number }[] }

export function seriesOf(seriesId: string): SeriesView | null {
  const s = one<{ id: string; frequency: RepeatFrequency; requested: number }>('SELECT id, frequency, requested FROM booking_series WHERE id = ?', seriesId);
  if (!s) return null;
  const rows = many<{ id: string; ref: string; date: string; status: string; total_paise: number; paid_paise: number }>('SELECT id, ref, date, status, total_paise, paid_paise FROM bookings WHERE series_id = ? ORDER BY series_index', seriesId);
  return { id: s.id, frequency: s.frequency, requested: s.requested, bookings: rows.map((r) => ({ id: r.id, ref: r.ref, date: r.date, status: r.status, totalPaise: r.total_paise, paidPaise: r.paid_paise })) };
}

/** Cancels every upcoming date of a series that has no money on it. A date with a payment (normally the first) is kept and cancelled on its own. */
export function cancelSeries(user: UserRow, bookingId: string, reason?: string): { cancelled: number; kept: number } {
  const b = accessBooking(user, bookingId);
  if (!b.series_id) throw new HttpError(400, 'NOT_A_SERIES', 'This booking does not repeat');
  const rows = many<{ id: string; paid_paise: number }>("SELECT id, paid_paise FROM bookings WHERE series_id = ? AND status IN ('held','confirmed') AND start_at > ? ORDER BY series_index DESC", b.series_id, now());
  let cancelled = 0, kept = 0;
  for (const r of rows) {
    if (r.paid_paise > 0) { kept++; continue; }
    cancelBooking(user, r.id, { reason: reason ?? 'Repeat booking cancelled' });
    cancelled++;
  }
  return { cancelled, kept };
}
