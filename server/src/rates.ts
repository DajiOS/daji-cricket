import type { RateOption, RateRule, SlotView } from '@daji/shared';
import { registerSchema } from './db.ts';
import { HttpError } from './errors.ts';
import { DAY, MIN, addDays, dayOfWeek, istMidnight, minutesOf, timeOfDay } from './time.ts';
import type { GroundRow } from './grounds.ts';

// A price list: hourly and fixed-session prices by ball, weekday and time of day, plus the days the ground is shut.
registerSchema('rate-card-1', `ALTER TABLE grounds ADD COLUMN rates TEXT NOT NULL DEFAULT '[]';
ALTER TABLE grounds ADD COLUMN closed_days TEXT NOT NULL DEFAULT '[]';`);
registerSchema('rate-card-2', `ALTER TABLE grounds ADD COLUMN rates_note TEXT;`);

export const MAX_RULES = 60;
export const MAX_PRICE_PAISE = 10_00_000_00; // ₹10 lakh for one session

const parse = <T>(s: string | null | undefined): T[] => { try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
/** Lines written in the current shape only. */
export const groundRates = (g: Pick<GroundRow, 'rates'>): RateRule[] => parse<RateRule>(g.rates).filter((r) => r && (r.mode === 'hourly' || r.mode === 'fixed'));
export const closedDaysOf = (g: Pick<GroundRow, 'closed_days'>): number[] => parse<number>(g.closed_days);
export const isClosedOn = (g: Pick<GroundRow, 'closed_days'>, date: string): boolean => closedDaysOf(g).includes(dayOfWeek(date));

export function cleanClosedDays(raw: unknown): { ok: number[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length > 7 || raw.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return { error: 'Closed days must be a list of weekdays (0 = Sunday to 6 = Saturday)' };
  const u = [...new Set(raw as number[])].sort();
  if (u.length === 7) return { error: 'The ground cannot be closed every day' };
  return { ok: u };
}

/** Checks the price list an owner sent. Times must sit on the slot grid so a slot never straddles two lines. */
export function cleanRates(raw: unknown, slotMinutes: number): { ok: RateRule[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length > MAX_RULES) return { error: `Send a list of up to ${MAX_RULES} prices` };
  const out: RateRule[] = [], ids = new Set<string>();
  let n = 0;
  for (const x of raw) {
    n++;
    if (!x || typeof x !== 'object') return { error: `Price ${n}: needs a ball, days, times and a price` };
    const r = x as Record<string, unknown>;
    const name = typeof r.label === 'string' ? r.label.trim() : '';
    if (name.length < 2 || name.length > 40) return { error: `Price ${n}: give it a name of 2 to 40 characters` };
    const ball = r.ball === 'red' || r.ball === 'white' ? 'leather' : r.ball; // a plain red or white ball is the leather ball
    if (ball !== 'combo' && ball !== 'leather' && ball !== 'tennis' && ball !== 'practice') return { error: `${name}: choose red & white combo, leather, tennis ball or practice session` };
    if (!Array.isArray(r.days) || !r.days.length || r.days.some((d) => !Number.isInteger(d) || (d as number) < 0 || (d as number) > 6)) return { error: `${name}: choose at least one day` };
    const from = minutesOf(r.from), to = minutesOf(r.to);
    if (from === null || to === null || from >= 1440 || to <= from) return { error: `${name}: the start must be before the end (an end after midnight is shown as the next morning)` };
    if (from % slotMinutes !== 0 || to % slotMinutes !== 0) return { error: `${name}: times must fall on the ${slotMinutes}-minute slots` };
    const mode = r.mode;
    if (mode !== 'hourly' && mode !== 'fixed') return { error: `${name}: choose hourly or fixed session` };
    const price = r.pricePaise;
    if (typeof price !== 'number' || !Number.isInteger(price) || price < 0 || price > MAX_PRICE_PAISE) return { error: `${name}: enter a price` };
    let bundle = 1;
    if (r.bundleDays !== undefined && r.bundleDays !== null) {
      if (!Number.isInteger(r.bundleDays) || (r.bundleDays as number) < 1 || (r.bundleDays as number) > 7) return { error: `${name}: days covered must be 1 to 7` };
      bundle = r.bundleDays as number;
      if (bundle > 1 && mode !== 'fixed') return { error: `${name}: only a fixed session can cover more than one day` };
    }
    let id = typeof r.id === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(r.id) ? r.id : '';
    if (!id || ids.has(id)) id = `p${n}-${Math.random().toString(36).slice(2, 6)}`;
    ids.add(id);
    const rule: RateRule = { id, label: name, ball, days: [...new Set(r.days as number[])].sort(), from: r.from as string, to: r.to as string, mode, pricePaise: price };
    if (bundle > 1) rule.bundleDays = bundle;
    out.push(rule);
  }
  // two hourly prices may not cover the same ball at the same time on the same day (which price would apply?)
  for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
    const a = out[i]!, b = out[j]!;
    if (a.mode === 'hourly' && b.mode === 'hourly' && a.ball === b.ball && a.days.some((d) => b.days.includes(d)) && minutesOf(a.from)! < minutesOf(b.to)! && minutesOf(b.from)! < minutesOf(a.to)!) return { error: `"${a.label}" and "${b.label}" are both hourly prices for the same ball at the same time` };
  }
  return { ok: out };
}

export interface RateWindow { start: number; end: number; slotStarts: number[] }

/** The slots a rule covers when it starts on `date`: its window, repeated for each day it covers. Null if any of those days is shut. */
export function ruleWindow(g: GroundRow, date: string, rule: RateRule): RateWindow | null {
  const slotStarts: number[] = [];
  const from = minutesOf(rule.from)!, to = minutesOf(rule.to)!;
  const days = rule.mode === 'fixed' ? rule.bundleDays ?? 1 : 1;
  for (let d = 0; d < days; d++) {
    const day = addDays(date, d);
    if (isClosedOn(g, day)) return null;
    const base = istMidnight(day);
    for (let m = from; m < to; m += g.slot_minutes) slotStarts.push(base + m * MIN);
  }
  return { start: slotStarts[0]!, end: slotStarts[slotStarts.length - 1]! + g.slot_minutes * MIN, slotStarts };
}

/** Price of one slot of an hourly rule (the rule's price is for 60 minutes). */
export const hourlySlotPrice = (rule: RateRule, slotMinutes: number): number => Math.round((rule.pricePaise * slotMinutes) / 60);


/** A part-session price is rounded up to the next ₹50. */
const ROUND_UP_PAISE = 5000;

/** A fixed session that has already started today can still be sold for the hours that are left, at a share of the price. */
export function fixedShare(g: GroundRow, w: RateWindow, rule: RateRule, t: number): { starts: number[]; pricePaise: number; proRated: boolean } {
  const starts = w.slotStarts.filter((s) => s > t && s >= t + g.min_notice_minutes * MIN);
  const proRated = starts.length > 0 && starts.length < w.slotStarts.length;
  return { starts, pricePaise: proRated ? Math.min(rule.pricePaise, Math.ceil((rule.pricePaise * starts.length) / w.slotStarts.length / ROUND_UP_PAISE) * ROUND_UP_PAISE) : rule.pricePaise, proRated };
}

type State = SlotView['state'];

/** What can be booked on a date from the price list, with live availability. `taken` maps slot start → what holds it. */
export function rateOptions(g: GroundRow, date: string, taken: Map<number, { kind: string; status: string | null }>, t: number): RateOption[] {
  if (isClosedOn(g, date)) return [];
  const dow = dayOfWeek(date), out: RateOption[] = [];
  const stateOf = (s: number): State => {
    const r = taken.get(s);
    if (r) return r.kind === 'block' ? 'blocked' : r.status === 'held' ? 'held' : 'booked';
    if (s <= t || s < t + g.min_notice_minutes * MIN) return 'past';
    return g.active ? 'available' : 'blocked';
  };
  for (const rule of groundRates(g)) {
    if (!rule.days.includes(dow)) continue;
    const w = ruleWindow(g, date, rule);
    if (!w) continue;
    const base = { ruleId: rule.id, label: rule.label, ball: rule.ball, mode: rule.mode, start: w.start, end: w.end, time: timeOfDay(w.start), endTime: timeOfDay(w.end), pricePaise: rule.pricePaise, bundleDays: rule.bundleDays ?? 1 };
    if (rule.mode === 'fixed') {
      const share = fixedShare(g, w, rule, t);
      if (share.proRated) {
        const states = share.starts.map(stateOf);
        const worst = (['booked', 'held', 'blocked', 'past'] as const).find((x) => states.includes(x)) ?? 'available';
        const first = share.starts[0]!;
        out.push({ ...base, start: first, time: timeOfDay(first), pricePaise: share.pricePaise, state: worst, proRated: true, fullPricePaise: rule.pricePaise, hoursLeft: share.starts.length * g.slot_minutes / 60 });
      } else {
        const states = w.slotStarts.map(stateOf);
        const worst = (['booked', 'held', 'blocked', 'past'] as const).find((x) => states.includes(x)) ?? 'available';
        out.push({ ...base, state: worst });
      }
    } else {
      const per = hourlySlotPrice(rule, g.slot_minutes);
      const slots: SlotView[] = w.slotStarts.map((s) => ({ start: s, end: s + g.slot_minutes * MIN, time: timeOfDay(s), pricePaise: per, state: stateOf(s) }));
      out.push({ ...base, state: slots.some((x) => x.state === 'available') ? 'available' : slots[0]?.state ?? 'blocked', slots });
    }
  }
  const rank = { combo: 0, leather: 1, tennis: 2, practice: 3 };
  return out.sort((a, b) => (a.ball === b.ball ? a.start - b.start : rank[a.ball] - rank[b.ball]));
}

/** The time span (in epoch ms) that rateOptions may need availability rows for. */
export const rateSpan = (date: string): { from: number; to: number } => ({ from: istMidnight(date), to: istMidnight(date) + 9 * DAY });

export function findRule(g: GroundRow, ruleId: string): RateRule {
  const r = groundRates(g).find((x) => x.id === ruleId);
  if (!r) throw new HttpError(400, 'UNKNOWN_RATE', 'That price is not offered at this ground');
  return r;
}
