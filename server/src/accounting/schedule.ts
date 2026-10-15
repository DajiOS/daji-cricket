import { many, one } from '../db.ts';
import { now } from '../clock.ts';
import { HttpError } from '../errors.ts';
import { DAY, addDays, dayOfWeek, istDate, istMidnight, monthRange, timeOfDay } from '../time.ts';
import { gstInside, gstPercent, ledgerLines, sumBy } from './ledger.ts';
import { rangeFrom, type DateRange } from './statements.ts';

// The two schedules in the Reports tab.
//   Future schedule: sessions that are booked and have not finished yet, and the money that goes with them.
//   Past schedule: what happened: sessions played, no-shows and cancellations, and what each earned.
// Money on the past schedule is read from the same ledger as the profit and loss, so the two always agree.

export type GroupBy = 'day' | 'week' | 'month';
export const GROUPS: GroupBy[] = ['day', 'week', 'month'];
export const MAX_SCHEDULE_DAYS = 366;
export const MAX_EXPORT_ROWS = 20_000;

export function parseGroupBy(v: string | null | undefined, dflt: GroupBy): GroupBy {
  if (v === null || v === undefined || v === '') return dflt;
  if (!(GROUPS as string[]).includes(v)) throw new HttpError(400, 'VALIDATION_FAILED', 'groupBy must be day, week or month', { fields: [{ field: 'groupBy', message: 'Must be day, week or month' }] });
  return v as GroupBy;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dm = (d: string) => `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]}`;

export interface Bucket { key: string; label: string; from: string; to: string }

/** The day, Monday-to-Sunday week or calendar month a date falls in, cut to the requested range. */
export function bucketOf(date: string, by: GroupBy, range: DateRange): Bucket {
  let from = date, to = date;
  if (by === 'week') { from = addDays(date, -((dayOfWeek(date) + 6) % 7)); to = addDays(from, 6); }
  if (by === 'month') { const m = monthRange(date.slice(0, 7))!; from = m.from; to = m.to; }
  const key = from;
  if (from < range.from) from = range.from;
  if (to > range.to) to = range.to;
  const label = by === 'day' ? `${DOW[dayOfWeek(date)]} ${dm(date)}`
    : by === 'month' ? `${MONTH[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`
    : from === to ? dm(from) : from.slice(5, 7) === to.slice(5, 7) ? `${Number(from.slice(8, 10))}–${dm(to)}` : `${dm(from)} – ${dm(to)}`;
  return { key, label, from, to };
}

function checkSpan(r: DateRange, maxDays: number): DateRange {
  if ((istMidnight(r.to) - istMidnight(r.from)) / DAY >= maxDays) throw new HttpError(400, 'RANGE_TOO_LONG', `A schedule covers at most ${maxDays} days at a time`);
  return r;
}

/** `maxDays` is 366 for the API; Ask AI may look further back. */
export interface ScheduleOpts { maxDays?: number }

function checkGround(ownerId: string, groundId: string | null | undefined): string | null {
  if (!groundId) return null;
  if (!one('SELECT 1 FROM grounds WHERE id = ? AND owner_id = ?', groundId, ownerId)) throw new HttpError(404, 'NOT_FOUND', 'Ground not found');
  return groundId;
}

interface Raw {
  id: string; ref: string; ground_id: string; ground_name: string; customer_name: string; date: string; start_at: number; end_at: number;
  slot_count: number; status: string; cancel_kind: string | null; cancelled_at: number | null; total_paise: number; paid_paise: number; refund_paise: number; credit_paise: number;
}
const COLS = `b.id, b.ref, b.ground_id, g.name AS ground_name, u.name AS customer_name, b.date, b.start_at, b.end_at, b.slot_count, b.status,
  b.cancel_kind, b.cancelled_at, b.total_paise, b.paid_paise, b.refund_paise, b.credit_paise`;
const FROM = 'FROM bookings b JOIN grounds g ON g.id = b.ground_id JOIN users u ON u.id = b.customer_id';

export interface ScheduleRow {
  id: string; ref: string; groundId: string; groundName: string; customerName: string;
  /** Play date for sessions; the day it was cancelled for cancellations. */
  date: string;
  startAt: number; endAt: number; startTime: string; endTime: string; slots: number;
  /** future: 'booked' | 'in_progress'. past: 'played' | 'no_show' | 'cancelled_in_time' | 'cancelled_late'. */
  kind: string;
  totalPaise: number; paidPaise: number; duePaise: number;
  /** Past rows: what this earned (net of GST), what was kept from the advance, and the GST in it. */
  earnedPaise?: number; keptPaise?: number; gstPaise?: number; refundedPaise?: number; creditedPaise?: number;
}

const base = (r: Raw): Omit<ScheduleRow, 'kind' | 'date'> => ({
  id: r.id, ref: r.ref, groundId: r.ground_id, groundName: r.ground_name, customerName: r.customer_name, startAt: r.start_at, endAt: r.end_at,
  startTime: timeOfDay(r.start_at), endTime: timeOfDay(r.end_at), slots: r.slot_count, totalPaise: r.total_paise, paidPaise: r.paid_paise, duePaise: Math.max(r.total_paise - r.paid_paise, 0),
});

export interface Group { key: string; label: string; from: string; to: string }

// ------------------------------------------------------------------ future

export interface FutureBucket extends Group { bookings: number; slots: number; valuePaise: number; paidPaise: number; duePaise: number }
export interface FutureGround { groundId: string; groundName: string; bookings: number; slots: number; valuePaise: number; paidPaise: number; duePaise: number }
export interface FutureSchedule {
  asOf: number;
  range: DateRange;
  groupBy: GroupBy;
  groundId: string | null;
  summary: { bookings: number; slots: number; valuePaise: number; gstPaise: number; netPaise: number; paidPaise: number; duePaise: number; inProgress: number };
  buckets: FutureBucket[];
  byGround: FutureGround[];
  /** Waiting for payment: not counted above because they are not confirmed. */
  holds: { count: number; valuePaise: number; needsReview: number };
  /** Money held for sessions not yet played, straight from the books (the "customer advances" line of the balance sheet). */
  advancesHeldPaise: number;
  credits: { outstandingPaise: number; expiringWithin30DaysPaise: number };
  refundsOwed: { count: number; paise: number };
  items: ScheduleRow[];
  total: number;
  limit: number;
  offset: number;
  notes: string[];
}

export function futureSchedule(ownerId: string, q: { month?: string | null; from?: string | null; to?: string | null; groupBy?: string | null; groundId?: string | null }, limit = 100, offset = 0, opts: ScheduleOpts = {}): FutureSchedule {
  const maxDays = opts.maxDays ?? MAX_SCHEDULE_DAYS;
  const t = now();
  const today = istDate(t);
  const range = checkSpan(rangeFrom(q, () => ({ from: today, to: addDays(today, 89) }), 1e6), maxDays);
  const by = parseGroupBy(q.groupBy, 'week');
  const groundId = checkGround(ownerId, q.groundId);
  const gst = gstPercent(ownerId);
  const gw = groundId ? ' AND b.ground_id = ?' : '';
  const gp = groundId ? [groundId] : [];

  const raws = many<Raw>(`SELECT ${COLS} ${FROM} WHERE b.owner_id = ? AND b.status = 'confirmed' AND b.end_at > ? AND b.date BETWEEN ? AND ?${gw} ORDER BY b.start_at, b.ref`, ownerId, t, range.from, range.to, ...gp);
  const rows = raws.map((r): ScheduleRow => ({ ...base(r), date: r.date, kind: r.start_at <= t ? 'in_progress' : 'booked' }));

  const summary = { bookings: rows.length, slots: 0, valuePaise: 0, gstPaise: 0, netPaise: 0, paidPaise: 0, duePaise: 0, inProgress: 0 };
  const buckets = new Map<string, FutureBucket>();
  const grounds = new Map<string, FutureGround>();
  for (const r of rows) {
    summary.slots += r.slots; summary.valuePaise += r.totalPaise; summary.paidPaise += r.paidPaise; summary.duePaise += r.duePaise;
    summary.gstPaise += gstInside(r.totalPaise, gst);
    if (r.kind === 'in_progress') summary.inProgress++;
    const b = bucketOf(r.date, by, range);
    const x = buckets.get(b.key) ?? { ...b, bookings: 0, slots: 0, valuePaise: 0, paidPaise: 0, duePaise: 0 };
    x.bookings++; x.slots += r.slots; x.valuePaise += r.totalPaise; x.paidPaise += r.paidPaise; x.duePaise += r.duePaise;
    buckets.set(b.key, x);
    const g = grounds.get(r.groundId) ?? { groundId: r.groundId, groundName: r.groundName, bookings: 0, slots: 0, valuePaise: 0, paidPaise: 0, duePaise: 0 };
    g.bookings++; g.slots += r.slots; g.valuePaise += r.totalPaise; g.paidPaise += r.paidPaise; g.duePaise += r.duePaise;
    grounds.set(r.groundId, g);
  }
  summary.netPaise = summary.valuePaise - summary.gstPaise;

  const holds = one<{ n: number; v: number | null; review: number | null }>(
    `SELECT COUNT(*) n, SUM(b.total_paise) v, SUM(b.needs_review) review FROM bookings b
     WHERE b.owner_id = ? AND b.status = 'held' AND (b.hold_expires_at > ? OR b.needs_review = 1) AND b.date BETWEEN ? AND ?${gw}`, ownerId, t, range.from, range.to, ...gp)!;
  const adv = sumBy(ledgerLines(ownerId, today)).get('customer_advances');
  const credit = one<{ s: number | null; soon: number | null }>(
    'SELECT SUM(remaining_paise) s, SUM(CASE WHEN expires_at <= ? THEN remaining_paise ELSE 0 END) soon FROM credit_lots WHERE owner_id = ? AND remaining_paise > 0 AND expires_at > ?', t + 30 * DAY, ownerId, t)!;
  const owed = one<{ n: number; s: number | null }>("SELECT COUNT(*) n, SUM(amount_paise) s FROM refunds WHERE owner_id = ? AND status IN ('pending','processing')", ownerId)!;

  const notes = [
    'Only confirmed bookings are listed. A session is "in progress" from its start time until it ends.',
    'Value is the full price of each booking. Paid is what has been received so far; Due is what is still to be collected before or at the ground.',
  ];
  if (gst > 0) notes.push(`Prices include ${gst}% GST. The GST shown is the part of the value that is owed to the government when the session is played.`);
  if (groundId) notes.push('Filtered to one ground. "Money held for sessions not yet played" and the credit and refund figures always cover all of your grounds.');

  return {
    asOf: t, range, groupBy: by, groundId, summary,
    buckets: [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key)),
    byGround: [...grounds.values()].sort((a, b) => b.valuePaise - a.valuePaise || a.groundName.localeCompare(b.groundName)),
    holds: { count: holds.n, valuePaise: holds.v ?? 0, needsReview: holds.review ?? 0 },
    advancesHeldPaise: adv ? adv.credit - adv.debit : 0,
    credits: { outstandingPaise: credit.s ?? 0, expiringWithin30DaysPaise: credit.soon ?? 0 },
    refundsOwed: { count: owed.n, paise: owed.s ?? 0 },
    items: rows.slice(offset, offset + limit), total: rows.length, limit, offset, notes,
  };
}

// ------------------------------------------------------------------ past

export interface PastBucket extends Group {
  sessions: number; slots: number; valuePaise: number; gstPaise: number; incomePaise: number; collectedPaise: number; outstandingPaise: number;
  noShows: number; noShowKeptPaise: number;
  cancellations: number; cancelRefundedPaise: number; cancelCreditedPaise: number; cancelKeptPaise: number;
  earnedPaise: number;
}
export interface PastGround { groundId: string; groundName: string; sessions: number; slots: number; valuePaise: number; incomePaise: number; noShows: number; cancellations: number; earnedPaise: number }
export interface PastSchedule {
  asOf: number;
  range: DateRange;
  groupBy: GroupBy;
  groundId: string | null;
  summary: Omit<PastBucket, keyof Group> & { cancelledInTime: number; cancelledLate: number; expiredCreditPaise: number };
  buckets: PastBucket[];
  byGround: PastGround[];
  items: ScheduleRow[];
  total: number;
  limit: number;
  offset: number;
  notes: string[];
}

const zeroBucket = (): Omit<PastBucket, keyof Group> => ({
  sessions: 0, slots: 0, valuePaise: 0, gstPaise: 0, incomePaise: 0, collectedPaise: 0, outstandingPaise: 0,
  noShows: 0, noShowKeptPaise: 0, cancellations: 0, cancelRefundedPaise: 0, cancelCreditedPaise: 0, cancelKeptPaise: 0, earnedPaise: 0,
});

export function pastSchedule(ownerId: string, q: { month?: string | null; from?: string | null; to?: string | null; groupBy?: string | null; groundId?: string | null }, limit = 100, offset = 0, opts: ScheduleOpts = {}): PastSchedule {
  const maxDays = opts.maxDays ?? MAX_SCHEDULE_DAYS;
  const t = now();
  const today = istDate(t);
  const range = checkSpan(rangeFrom(q, () => ({ from: addDays(today, -29), to: today }), 1e6), maxDays);
  const by = parseGroupBy(q.groupBy, 'week');
  const groundId = checkGround(ownerId, q.groundId);
  const gw = groundId ? ' AND b.ground_id = ?' : '';
  const gp = groundId ? [groundId] : [];
  const fromMs = istMidnight(range.from), toMs = istMidnight(addDays(range.to, 1));

  // Sessions are counted on the day they were played; cancellations on the day they were cancelled (that is when the books count what was kept).
  const raws = many<Raw>(
    `SELECT ${COLS} ${FROM} WHERE b.owner_id = ?${gw} AND (
       ((b.status = 'no_show' OR (b.status IN ('confirmed','completed') AND b.end_at <= ?)) AND b.date BETWEEN ? AND ?)
       OR (b.status = 'cancelled' AND b.confirmed_at IS NOT NULL AND b.cancelled_at >= ? AND b.cancelled_at < ?))
     ORDER BY b.start_at, b.ref`, ownerId, ...gp, t, range.from, range.to, fromMs, toMs);

  // What each booking earned, from the same ledger the profit and loss uses.
  const earned = new Map<string, { income: number; gst: number; kept: number }>();
  for (const l of ledgerLines(ownerId, range.to)) {
    if (l.src !== 'booking') continue;
    const e = earned.get(l.ref) ?? { income: 0, gst: 0, kept: 0 };
    if (l.account === 'booking_income') e.income += l.credit - l.debit;
    else if (l.account === 'gst_payable') e.gst += l.credit - l.debit;
    else if (l.account === 'forfeited_income') e.kept += l.credit - l.debit;
    earned.set(l.ref, e);
  }

  const rows: ScheduleRow[] = [];
  const buckets = new Map<string, PastBucket>();
  const grounds = new Map<string, PastGround>();
  const sum = { ...zeroBucket(), cancelledInTime: 0, cancelledLate: 0, expiredCreditPaise: 0 };
  for (const r of raws) {
    const e = earned.get(r.id) ?? { income: 0, gst: 0, kept: 0 };
    const cancelled = r.status === 'cancelled';
    const date = cancelled ? istDate(r.cancelled_at!) : r.date;
    const kind = cancelled ? (r.cancel_kind === 'credit' ? 'cancelled_late' : 'cancelled_in_time') : r.status === 'no_show' ? 'no_show' : 'played';
    const row: ScheduleRow = { ...base(r), date, kind };
    if (kind === 'played') { row.earnedPaise = e.income; row.gstPaise = e.gst; }
    else if (kind === 'no_show') { row.keptPaise = e.kept; row.earnedPaise = e.kept; row.duePaise = 0; }
    else { row.keptPaise = e.kept; row.earnedPaise = e.kept; row.refundedPaise = r.refund_paise; row.creditedPaise = r.credit_paise; row.duePaise = 0; }
    rows.push(row);

    const b = bucketOf(date, by, range);
    const x = buckets.get(b.key) ?? { ...b, ...zeroBucket() };
    const g = grounds.get(r.ground_id) ?? { groundId: r.ground_id, groundName: r.ground_name, sessions: 0, slots: 0, valuePaise: 0, incomePaise: 0, noShows: 0, cancellations: 0, earnedPaise: 0 };
    for (const t2 of [x, sum]) {
      if (kind === 'played') {
        t2.sessions++; t2.slots += r.slot_count; t2.valuePaise += r.total_paise; t2.gstPaise += e.gst; t2.incomePaise += e.income;
        t2.collectedPaise += Math.min(r.paid_paise, r.total_paise); t2.outstandingPaise += Math.max(r.total_paise - r.paid_paise, 0); t2.earnedPaise += e.income;
      } else if (kind === 'no_show') { t2.noShows++; t2.noShowKeptPaise += e.kept; t2.earnedPaise += e.kept; }
      else { t2.cancellations++; t2.cancelRefundedPaise += r.refund_paise; t2.cancelCreditedPaise += r.credit_paise; t2.cancelKeptPaise += e.kept; t2.earnedPaise += e.kept; }
    }
    if (kind === 'played') { g.sessions++; g.slots += r.slot_count; g.valuePaise += r.total_paise; g.incomePaise += e.income; }
    else if (kind === 'no_show') g.noShows++; else g.cancellations++;
    g.earnedPaise += kind === 'played' ? e.income : e.kept;
    if (kind === 'cancelled_in_time') sum.cancelledInTime++; else if (kind === 'cancelled_late') sum.cancelledLate++;
    buckets.set(b.key, x); grounds.set(r.ground_id, g);
  }
  sum.expiredCreditPaise = -(one<{ s: number | null }>("SELECT SUM(amount_paise) s FROM credit_ledger WHERE owner_id = ? AND kind = 'expired' AND amount_paise < 0 AND created_at >= ? AND created_at < ?", ownerId, fromMs, toMs)!.s ?? 0);

  rows.sort((a, b) => b.date.localeCompare(a.date) || b.startAt - a.startAt || a.ref.localeCompare(b.ref));
  const gst = gstPercent(ownerId);
  const notes = [
    'Sessions are counted on the day they were played. A session counts as played once its end time has passed, unless it was marked a no-show.',
    'Cancellations are counted on the day they were cancelled, because that is the day any advance that was kept is added to your income.',
    '"Earned" is the booking income in the profit and loss: the price of played sessions, plus advances kept from no-shows and late cancellations. It does not include credit that expired unused; that is shown separately.',
    'Outstanding is the part of a played session\'s price that has not been collected yet.',
  ];
  if (gst > 0) notes.push(`Prices include ${gst}% GST. "Income" is the price less that GST.`);
  if (groundId) notes.push('Filtered to one ground. Expired credit covers all of your grounds.');

  return {
    asOf: t, range, groupBy: by, groundId, summary: sum,
    buckets: [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key)),
    byGround: [...grounds.values()].sort((a, b) => b.earnedPaise - a.earnedPaise || a.groundName.localeCompare(b.groundName)),
    items: rows.slice(offset, offset + limit), total: rows.length, limit, offset, notes,
  };
}
