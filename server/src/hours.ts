import { registerSchema } from './db.ts';
import { minutesOf } from './time.ts';
import type { GroundRow } from './grounds.ts';

// Seasonal opening hours. The columns open_time / close_time are the summer hours (and the year-round hours when no winter hours are set).
// A closing time may be past midnight ("27:00" = 3 am next morning); those late slots belong to the day the evening started on.
registerSchema('seasonal-hours-1', `ALTER TABLE grounds ADD COLUMN winter_open TEXT;
ALTER TABLE grounds ADD COLUMN winter_close TEXT;
ALTER TABLE grounds ADD COLUMN winter_from_month INTEGER NOT NULL DEFAULT 11;
ALTER TABLE grounds ADD COLUMN winter_to_month INTEGER NOT NULL DEFAULT 2;`);

export type SeasonRow = Pick<GroundRow, 'open_time' | 'close_time' | 'winter_open' | 'winter_close' | 'winter_from_month' | 'winter_to_month'>;

export function isWinter(g: Pick<SeasonRow, 'winter_open' | 'winter_close' | 'winter_from_month' | 'winter_to_month'>, date: string): boolean {
  if (!g.winter_open || !g.winter_close) return false;
  const m = Number(date.slice(5, 7)), a = g.winter_from_month, b = g.winter_to_month;
  return a <= b ? m >= a && m <= b : m >= a || m <= b;
}

/** Opening and closing in minutes since midnight of `date` (closing can be above 1440), for the season that date falls in. */
export function hoursOn(g: SeasonRow, date: string): { open: number; close: number; winter: boolean } {
  const w = isWinter(g, date);
  return { open: minutesOf(w ? g.winter_open : g.open_time)!, close: minutesOf(w ? g.winter_close : g.close_time)!, winter: w };
}

/** The shortest day of the year, in minutes: what a play format has to fit inside. */
export function shortestDay(g: SeasonRow): number {
  const s = minutesOf(g.close_time)! - minutesOf(g.open_time)!;
  return g.winter_open && g.winter_close ? Math.min(s, minutesOf(g.winter_close)! - minutesOf(g.winter_open)!) : s;
}
