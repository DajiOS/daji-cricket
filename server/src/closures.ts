import { many, run, registerSchema } from './db.ts';
import { now } from './clock.ts';
import { HttpError } from './errors.ts';
import { audit } from './audit.ts';
import { isValidDate } from './time.ts';
import type { UserRow } from './auth.ts';

// Single days the software owner has switched off for online booking: for the ground, for practice sessions, for academy enquiries, or all three.
// Works alongside the opening and closing dates.
registerSchema('closures-1', `CREATE TABLE closed_dates (date TEXT NOT NULL, scope TEXT NOT NULL CHECK (scope IN ('ground','practice','academy')), reason TEXT, created_at INTEGER NOT NULL, created_by TEXT, PRIMARY KEY (date, scope));`);

export const SCOPES = ['ground', 'practice', 'academy'] as const;
export type Scope = (typeof SCOPES)[number];
export interface Closure { date: string; scope: Scope; reason: string | null }

export const closedDates = (from = '0000-00-00'): Closure[] => many<Closure>('SELECT date, scope, reason FROM closed_dates WHERE date >= ? ORDER BY date, scope', from);
export const isClosedDate = (date: string, scope: Scope): boolean => many('SELECT 1 FROM closed_dates WHERE date = ? AND scope = ?', date, scope).length > 0;
/** The days that are off for each scope, for the website. */
export function closedByScope(from: string): Record<Scope, string[]> {
  const out: Record<Scope, string[]> = { ground: [], practice: [], academy: [] };
  for (const c of closedDates(from)) out[c.scope].push(c.date);
  return out;
}

/** Closes or reopens a list of days for some scopes (all three when none are named). Days are YYYY-MM-DD; at most 400 at a time. */
export function setClosed(u: UserRow, dates: unknown, closed: unknown, reason: unknown, scopesIn?: unknown): { changed: number } {
  if (!Array.isArray(dates) || dates.length < 1 || dates.length > 400 || dates.some((d) => typeof d !== 'string' || !isValidDate(d))) throw new HttpError(400, 'VALIDATION_FAILED', 'Send 1 to 400 dates like 2026-12-25', { fields: [{ field: 'dates', message: '1 to 400 valid dates' }] });
  if (typeof closed !== 'boolean') throw new HttpError(400, 'VALIDATION_FAILED', 'closed must be true or false', { fields: [{ field: 'closed', message: 'true or false' }] });
  const scopes: Scope[] = scopesIn === undefined || scopesIn === null ? [...SCOPES] : (Array.isArray(scopesIn) && scopesIn.length && scopesIn.every((s) => (SCOPES as readonly unknown[]).includes(s)) ? [...new Set(scopesIn as Scope[])] : (() => { throw new HttpError(400, 'VALIDATION_FAILED', 'scopes can be ground, practice and academy', { fields: [{ field: 'scopes', message: 'ground, practice, academy' }] }); })());
  const why = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 100) : null;
  let changed = 0;
  for (const d of new Set(dates as string[])) for (const s of scopes) {
    if (closed) { run('INSERT INTO closed_dates(date, scope, reason, created_at, created_by) VALUES (?,?,?,?,?) ON CONFLICT(date, scope) DO UPDATE SET reason = excluded.reason', d, s, why, now(), u.id); changed++; }
    else changed += run('DELETE FROM closed_dates WHERE date = ? AND scope = ?', d, s).changes;
  }
  audit({ id: u.id, role: u.role }, closed ? 'dates.close' : 'dates.open', 'dates', 'booking', { count: dates.length, first: (dates as string[])[0], scopes, reason: why });
  return { changed };
}
