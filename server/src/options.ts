import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Config } from './config.ts';
import { many, one } from './db.ts';
import { now } from './clock.ts';
import { HttpError } from './errors.ts';
import { addDays, MIN, timeOfDay } from './time.ts';
import { advanceFor } from './bookings.ts';
import { getGroundOr404, slotStarts, type GroundRow } from './grounds.ts';
import { assertDayOpen, assertOnlineWindow, holdSlots, planFor } from './hold.ts';
import type { HoldResponse } from '@daji/shared';
import type { UserRow } from './auth.ts';
import { Validator } from './input.ts';

// Booking options: what can be booked for a request, and what the nearest alternatives are when the exact slot is not free.
// Every option is made here, from the ground's own rules, prices and the slots that are really free right now. A customer-facing option carries a signed
// `optionId` that only this server can produce, tied to the person it was made for and valid for a few minutes. The hold can be started from that id
// alone, so an assistant (Guppi) or any other channel can only offer what was issued here and cannot invent a slot or a price.

export const OPTION_TTL_MS = 10 * 60_000;
const SEARCH_DAYS = 3;          // alternatives on the same day and up to this many days either side
const DEFAULT_MAX_OPTIONS = 5;

export interface OptionRequest { groundId: string; date: string; startTime: string; slots?: number; formatId?: string; ruleId?: string }
export interface BookingOption {
  optionId?: string;
  groundId: string; groundName: string; date: string; startTime: string; endTime: string; slots: number;
  formatId?: string; ruleId?: string; label: string | null;
  totalPaise: number; advancePaise: number;
  /** True when this is the slot that was asked for. */
  exact: boolean;
  expiresAt?: number;
}
export interface OptionsResult {
  request: OptionRequest;
  available: boolean;
  /** The slot that was asked for, when it is free. */
  exact: BookingOption | null;
  /** When the exact slot is not free (or not bookable), the nearest ones that are. */
  alternatives: BookingOption[];
  /** Why the exact slot is not on offer, in plain words. */
  reason: string | null;
}

export function parseOptionRequest(body: unknown): OptionRequest & { max?: number } {
  const v = new Validator(body);
  const groundId = v.str('groundId', { required: true });
  const date = v.date('date', true);
  const startTime = v.time('startTime', true);
  const formatId = v.str('formatId', { max: 40 });
  const ruleId = v.str('ruleId', { max: 40 });
  const slots = v.int('slots', { required: !formatId && !ruleId, min: 1, max: 24 });
  const max = v.int('max', { min: 1, max: 10 });
  v.done();
  return { groundId: groundId!, date: date!, startTime: startTime!, slots, formatId, ruleId, max };
}

const keyFor = (cfg: Config): Buffer => createHash('sha256').update(`booking-option:${cfg.jwtSecret}`).digest();
interface OptionPayload { u: string; g: string; d: string; t: string; n?: number; f?: string; r?: string; tp: number; exp: number }

function sign(cfg: Config, p: OptionPayload): string {
  const body = Buffer.from(JSON.stringify(p)).toString('base64url');
  return `${body}.${createHmac('sha256', keyFor(cfg)).update(body).digest('base64url')}`;
}

/** Checks an option id: made here, for this person, not expired. Returns the request it stands for and the price it was offered at. */
export function resolveOption(cfg: Config, userId: string, optionId: string): { request: OptionRequest; totalPaise: number } {
  const bad = () => new HttpError(400, 'OPTION_INVALID', 'That booking option is not valid. Ask for the options again.');
  const [body, sig] = optionId.split('.');
  if (!body || !sig) throw bad();
  const want = createHmac('sha256', keyFor(cfg)).update(body).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw bad();
  let p: OptionPayload;
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OptionPayload; } catch { throw bad(); }
  if (p.u !== userId) throw bad();
  if (!(p.exp > now())) throw new HttpError(410, 'OPTION_EXPIRED', 'That booking option has expired. Ask for the options again.');
  return { request: { groundId: p.g, date: p.d, startTime: p.t, slots: p.n, formatId: p.f, ruleId: p.r }, totalPaise: p.tp };
}

function isFree(ground: GroundRow, starts: number[]): boolean {
  if (!starts.length) return false;
  const lo = starts[0]!, hi = starts[starts.length - 1]!;
  const taken = new Set(many<{ slot_start: number }>('SELECT slot_start FROM booking_slots WHERE ground_id = ? AND slot_start >= ? AND slot_start <= ?', ground.id, lo, hi).map((r) => r.slot_start));
  return starts.every((s) => !taken.has(s));
}

function optionFor(cfg: Config, user: UserRow, ground: GroundRow, req: OptionRequest, exact: boolean): BookingOption | { error: HttpError } {
  try {
    const customerFacing = user.role === 'customer';
    if (customerFacing) assertOnlineWindow(req.date);
    const plan = planFor(ground, req, customerFacing);
    if (customerFacing) assertDayOpen(req.date, plan.format?.ball === 'practice' ? 'practice' : 'ground');
    if (!isFree(ground, plan.starts)) return { error: new HttpError(409, 'SLOT_TAKEN', 'Those slots are not free') };
    const first = plan.starts[0]!, last = plan.starts[plan.starts.length - 1]!;
    const o: BookingOption = {
      groundId: ground.id, groundName: ground.name, date: plan.date, startTime: timeOfDay(first), endTime: timeOfDay(last + ground.slot_minutes * MIN), slots: plan.starts.length,
      ...(req.formatId ? { formatId: req.formatId } : {}), ...(req.ruleId ? { ruleId: req.ruleId } : {}), label: plan.format?.label ?? null,
      totalPaise: plan.totalPaise, advancePaise: advanceFor(ground, plan.totalPaise, first), exact,
    };
    if (customerFacing) {
      const exp = now() + OPTION_TTL_MS;
      // the id carries what was asked (so the hold repeats it exactly) and the price it was offered at
      o.optionId = sign(cfg, { u: user.id, g: ground.id, d: plan.date, t: req.startTime, ...(req.slots ? { n: req.slots } : {}), ...(req.formatId ? { f: req.formatId } : {}), ...(req.ruleId ? { r: req.ruleId } : {}), tp: plan.totalPaise, exp });
      o.expiresAt = exp;
    }
    return o;
  } catch (e) {
    if (e instanceof HttpError) return { error: e };
    throw e;
  }
}

/** The slot asked for if it is free, otherwise the nearest ones that are (same length, same day first, then the days around it). */
export function searchOptions(cfg: Config, user: UserRow, req: OptionRequest, max = DEFAULT_MAX_OPTIONS): OptionsResult {
  const ground = getGroundOr404(req.groundId);
  const want = optionFor(cfg, user, ground, req, true);
  if (!('error' in want)) return { request: req, available: true, exact: want, alternatives: [], reason: null };
  const reason = want.error.message;
  const t0 = timeMinutes(req.startTime);
  const found: { o: BookingOption; score: number }[] = [];
  for (let dd = 0; dd <= SEARCH_DAYS; dd++) {
    for (const sign of dd === 0 ? [1] : [1, -1]) {
      const date = addDays(req.date, dd * sign);
      for (const s of slotStarts(ground, date)) {
        const time = timeOfDay(s);
        if (dd === 0 && time === req.startTime) continue;
        const cand = optionFor(cfg, user, ground, { ...req, date, startTime: time }, false);
        if ('error' in cand) continue;
        found.push({ o: cand, score: dd * 1440 * 2 + (dd ? 0 : 0) + Math.abs(timeMinutes(time) - t0) + (sign < 0 ? 1 : 0) });
      }
    }
  }
  found.sort((a, b) => a.score - b.score);
  // one option per start time and day: the cheapest way to say the same thing
  const seen = new Set<string>();
  const alternatives: BookingOption[] = [];
  for (const f of found) {
    const k = `${f.o.date} ${f.o.startTime}`;
    if (seen.has(k)) continue;
    seen.add(k);
    alternatives.push(f.o);
    if (alternatives.length >= max) break;
  }
  return { request: req, available: false, exact: null, alternatives, reason };
}

const timeMinutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** For tests and diagnostics: how many slots are held or booked on a ground in a range. */
export function slotsTaken(groundId: string, from: number, to: number): number {
  return one<{ n: number }>('SELECT COUNT(*) n FROM booking_slots WHERE ground_id = ? AND slot_start >= ? AND slot_start < ?', groundId, from, to)!.n;
}

const OPTION_BODY_KEYS = new Set(['optionId', 'useCredit', 'players', 'notes', 'promoCode']);

/**
 * Starts a hold from an issued option id. The id fixes the ground, day, time and length; the caller can only add who is playing, notes, a promo code and
 * whether to use credit. Any other field is refused (a channel cannot change what was offered), and if the price moved since it was offered
 * the hold is refused so the person sees the new price first.
 */
export async function holdFromOption(cfg: Config, customer: UserRow, body: unknown, via: { channel?: 'guppi'; actionId?: string } = {}): Promise<HoldResponse> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (typeof b.optionId !== 'string') throw new HttpError(400, 'OPTION_REQUIRED', 'optionId is required');
  const extra = Object.keys(b).filter((k) => !OPTION_BODY_KEYS.has(k));
  if (extra.length) throw new HttpError(400, 'OPTION_FIELDS_NOT_ALLOWED', `A booking option fixes the slot and price; these fields cannot be sent with it: ${extra.join(', ')}`);
  const { request, totalPaise } = resolveOption(cfg, customer.id, b.optionId);
  const ground = getGroundOr404(request.groundId);
  const plan = planFor(ground, request, true);
  if (plan.totalPaise !== totalPaise) throw new HttpError(409, 'OPTION_PRICE_CHANGED', 'The price changed since this option was offered. Ask for the options again.', { offeredPaise: totalPaise, currentPaise: plan.totalPaise });
  const { optionId: _o, ...rest } = b;
  return holdSlots(cfg, customer, { ...request, ...rest }, via);
}
