import { formatPaise } from '@daji/shared';
import { many, one } from '../db.ts';
import { now } from '../clock.ts';
import { forbidden, HttpError } from '../errors.ts';
import { hasPermission, type UserRow } from '../auth.ts';
import { addDays, istDate, istMidnight } from '../time.ts';
import { overview as opsOverview } from '../reports.ts';
import { summarize } from '../contacts.ts';
import { balanceSheet, profitAndLoss, type BalanceSheet } from '../accounting/statements.ts';
import { futureSchedule, pastSchedule } from '../accounting/schedule.ts';
import { listAccounts } from '../accounting/store.ts';

// The questions Ask AI can put to the software. Every tool calls the same functions as the Reports tab, so an answer
// can never disagree with a report. They are read-only, scoped to one owner and checked against the asker's permissions.
// The built-in answerer and the optional Claude mode use exactly these.

export interface Ctx { ownerId: string; user: UserRow }
export type Area = 'reports' | 'bookings' | 'customers';

const AREA_PERMISSION: Record<Area, string> = { reports: 'view_reports', bookings: 'manage_bookings', customers: 'view_customers' };
const AREA_WORDS: Record<Area, string> = { reports: 'the money reports', bookings: 'bookings', customers: 'customers' };

export function can(ctx: Ctx, area: Area): boolean {
  const u = ctx.user;
  if (area === 'reports') return hasPermission(u, 'view_reports') || hasPermission(u, 'manage_accounting');
  if (area === 'bookings') return hasPermission(u, 'manage_bookings') || hasPermission(u, 'view_reports');
  return hasPermission(u, 'view_customers');
}
export function need(ctx: Ctx, area: Area): void {
  if (!can(ctx, area)) throw forbidden(`You do not have access to ${AREA_WORDS[area]}. Ask the owner to give you the "${AREA_PERMISSION[area]}" permission.`);
}

const todayIst = (): string => istDate(now());

/** Adds a readable `…Text` next to every `…Paise` number, so nothing downstream has to convert paise to rupees. */
export function withText<T>(v: T): T {
  if (Array.isArray(v)) return v.map(withText) as unknown as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      out[k] = withText(x);
      if (k.endsWith('Paise') && typeof x === 'number') out[`${k.slice(0, -5)}Text`] = formatPaise(x);
    }
    return out as T;
  }
  return v;
}

/** The first day anything was recorded, for "all time". */
export function earliestDate(ownerId: string): string {
  const r = one<{ d: string | null }>(
    `SELECT MIN(d) d FROM (SELECT MIN(date) d FROM bookings WHERE owner_id = ? UNION ALL SELECT MIN(txn_date) FROM acct_transactions WHERE owner_id = ? AND deleted_at IS NULL
      UNION ALL SELECT MIN(entry_date) FROM acct_journals WHERE owner_id = ? AND deleted_at IS NULL UNION ALL SELECT MIN(opening_date) FROM acct_accounts WHERE owner_id = ? AND deleted_at IS NULL)`,
    ownerId, ownerId, ownerId, ownerId);
  return r?.d ?? todayIst();
}

interface Range { from: string; to: string }
const checkRange = (r: Range): Range => {
  if (r.to < r.from) throw new HttpError(400, 'VALIDATION_FAILED', 'The end date is before the start date');
  return r;
};

// ---------------------------------------------------------------- money

export function pnl(ctx: Ctx, a: Range & { basis?: 'accrual' | 'cash'; compare?: boolean }) {
  need(ctx, 'reports');
  const p = profitAndLoss(ctx.ownerId, checkRange(a), { basis: a.basis, compare: a.compare });
  const rows = (sec: typeof p.revenue) => sec.groups.flatMap((g) => g.rows.map((r) => ({ group: g.name, code: r.code, name: r.name, paise: r.paise, ...(r.previousPaise !== undefined ? { previousPaise: r.previousPaise } : {}) }))).sort((x, y) => y.paise - x.paise);
  return {
    from: p.range.from, to: p.range.to, basis: p.basis,
    revenuePaise: p.revenue.totalPaise, expensesPaise: p.expenses.totalPaise, netProfitPaise: p.netProfitPaise, marginPercent: p.marginPercent,
    revenue: rows(p.revenue), expenses: rows(p.expenses),
    ...(p.previous ? { previous: { from: p.previous.range.from, to: p.previous.range.to, revenuePaise: p.revenue.previousTotalPaise ?? 0, expensesPaise: p.expenses.previousTotalPaise ?? 0, netProfitPaise: p.previousNetProfitPaise ?? 0 } } : {}),
    uncategorisedTransactions: p.uncategorised.count,
  };
}

/** Money that actually arrived in the period (cash basis), whatever session it was for. */
export function collections(ctx: Ctx, a: Range) {
  need(ctx, 'reports');
  const p = profitAndLoss(ctx.ownerId, checkRange(a), { basis: 'cash' });
  const received = p.revenue.groups.flatMap((g) => g.rows).find((r) => r.code === 'booking_receipts')?.paise ?? 0;
  return { from: a.from, to: a.to, bookingMoneyReceivedPaise: received, otherIncomePaise: p.revenue.totalPaise - received, totalReceivedPaise: p.revenue.totalPaise };
}

const sideRow = (b: BalanceSheet, code: string): number => {
  for (const s of [b.assets, b.liabilities, b.equity]) for (const g of s.groups) for (const r of g.rows) if (r.code === code) return r.paise;
  return 0;
};

export function balance(ctx: Ctx, a: { asOf?: string }) {
  need(ctx, 'reports');
  const asOf = a.asOf ?? todayIst();
  const b = balanceSheet(ctx.ownerId, asOf);
  return {
    asOf, totalAssetsPaise: b.totalAssetsPaise, totalLiabilitiesPaise: b.totalLiabilitiesPaise, totalEquityPaise: b.totalEquityPaise, balanced: b.balanced,
    cashAndBankPaise: b.assets.groups.find((g) => g.name === 'Cash and bank')?.totalPaise ?? 0,
    customerAdvancesPaise: sideRow(b, 'customer_advances'), customerCreditsPaise: sideRow(b, 'customer_credits'),
    customersOweYouPaise: sideRow(b, 'receivables'), gstPayablePaise: sideRow(b, 'gst_payable'),
    uncategorisedTransactions: b.attention.uncategorisedCount,
  };
}

/** Each bank and cash account with its balance (today, or on a past date). */
export function accounts(ctx: Ctx, a: { asOf?: string }) {
  need(ctx, 'reports');
  const today = todayIst();
  const asOf = a.asOf && a.asOf < today ? a.asOf : today;
  let list: { name: string; kind: string; balancePaise: number }[];
  if (asOf === today) list = listAccounts(ctx.ownerId).map((x) => ({ name: x.name, kind: x.kind, balancePaise: x.balancePaise }));
  else {
    const b = balanceSheet(ctx.ownerId, asOf);
    const kinds = new Map(listAccounts(ctx.ownerId).map((x) => [`bank:${x.id}`, x.kind]));
    list = (b.assets.groups.find((g) => g.name === 'Cash and bank')?.rows ?? []).map((r) => ({ name: r.name.replace(/ \(overdrawn\)$/, ''), kind: kinds.get(r.code) ?? 'bank', balancePaise: r.paise }));
  }
  list.sort((x, y) => Number(y.kind === 'bank') - Number(x.kind === 'bank')); // bank accounts first, then cash; stable within each
  const bs = balanceSheet(ctx.ownerId, asOf);
  return {
    asOf, accounts: list, totalPaise: list.reduce((s, x) => s + x.balancePaise, 0),
    heldForCustomersPaise: sideRow(bs, 'customer_advances') + sideRow(bs, 'customer_credits'),
  };
}

export function gst(ctx: Ctx, a: Range) {
  need(ctx, 'reports');
  const s = pastSchedule(ctx.ownerId, { from: a.from, to: a.to }, 1, 0, { maxDays: 4000 }).summary;
  const percent = one<{ g: number }>('SELECT gst_percent g FROM acct_settings WHERE owner_id = ?', ctx.ownerId)?.g ?? 0;
  return { percent, from: a.from, to: a.to, gstOnSessionsPlayedPaise: s.gstPaise, gstPayableNowPaise: balance(ctx, {}).gstPayablePaise };
}

export function uncategorised(ctx: Ctx) {
  need(ctx, 'reports');
  const r = one<{ n: number; s: number | null }>('SELECT COUNT(*) n, SUM(ABS(amount_paise)) s FROM acct_transactions WHERE owner_id = ? AND deleted_at IS NULL AND category_id IS NULL', ctx.ownerId)!;
  return { count: r.n, totalPaise: r.s ?? 0 };
}

// ---------------------------------------------------------------- bookings

export interface BookingsAnswer {
  from: string; to: string; groundId: string | null;
  played: { sessions: number; slots: number; valuePaise: number; incomePaise: number; collectedPaise: number; notCollectedPaise: number };
  noShows: { count: number; advanceKeptPaise: number };
  cancellations: { count: number; inTime: number; late: number; refundedPaise: number; creditGivenPaise: number; advanceKeptPaise: number };
  upcoming: { bookings: number; slots: number; valuePaise: number; paidPaise: number; toCollectPaise: number };
  byGround: { groundId: string; groundName: string; played: number; upcoming: number; earnedPaise: number; upcomingValuePaise: number }[];
}

export function bookings(ctx: Ctx, a: Range & { groundId?: string | null }): BookingsAnswer {
  need(ctx, 'bookings');
  checkRange(a);
  const q = { from: a.from, to: a.to, groundId: a.groundId ?? null };
  const past = pastSchedule(ctx.ownerId, q, 1, 0, { maxDays: 4000 });
  const fut = futureSchedule(ctx.ownerId, q, 1, 0, { maxDays: 4000 });
  const ground = new Map<string, BookingsAnswer['byGround'][number]>();
  const g = (id: string, name: string) => { const x = ground.get(id) ?? { groundId: id, groundName: name, played: 0, upcoming: 0, earnedPaise: 0, upcomingValuePaise: 0 }; ground.set(id, x); return x; };
  for (const x of past.byGround) { const y = g(x.groundId, x.groundName); y.played += x.sessions; y.earnedPaise += x.earnedPaise; }
  for (const x of fut.byGround) { const y = g(x.groundId, x.groundName); y.upcoming += x.bookings; y.upcomingValuePaise += x.valuePaise; }
  const s = past.summary;
  return {
    from: a.from, to: a.to, groundId: a.groundId ?? null,
    played: { sessions: s.sessions, slots: s.slots, valuePaise: s.valuePaise, incomePaise: s.incomePaise, collectedPaise: s.collectedPaise, notCollectedPaise: s.outstandingPaise },
    noShows: { count: s.noShows, advanceKeptPaise: s.noShowKeptPaise },
    cancellations: { count: s.cancellations, inTime: s.cancelledInTime, late: s.cancelledLate, refundedPaise: s.cancelRefundedPaise, creditGivenPaise: s.cancelCreditedPaise, advanceKeptPaise: s.cancelKeptPaise },
    upcoming: { bookings: fut.summary.bookings, slots: fut.summary.slots, valuePaise: fut.summary.valuePaise, paidPaise: fut.summary.paidPaise, toCollectPaise: fut.summary.duePaise },
    byGround: [...ground.values()].sort((x, y) => (y.earnedPaise + y.upcomingValuePaise) - (x.earnedPaise + x.upcomingValuePaise) || x.groundName.localeCompare(y.groundName)),
  };
}

export interface UpcomingRow { ref: string; ground: string; date: string; start: string; end: string; slots: number; status: string; totalPaise: number; paidPaise: number; toCollectPaise: number; customer?: string }

/** The next sessions. Customer names only when `names` is true: the built-in answer shows them to staff, the Claude tool never does. */
export function upcoming(ctx: Ctx, a: Range & { groundId?: string | null; limit?: number }, names: boolean): { from: string; to: string; total: number; sessions: UpcomingRow[] } {
  need(ctx, 'bookings');
  const f = futureSchedule(ctx.ownerId, { from: a.from, to: a.to, groundId: a.groundId ?? null }, Math.min(a.limit ?? 8, 25), 0, { maxDays: 4000 });
  return {
    from: a.from, to: a.to, total: f.total,
    sessions: f.items.map((r): UpcomingRow => ({ ref: r.ref, ground: r.groundName, date: r.date, start: r.startTime, end: r.endTime, slots: r.slots, status: r.kind === 'in_progress' ? 'in progress' : 'booked', totalPaise: r.totalPaise, paidPaise: r.paidPaise, toCollectPaise: r.duePaise, ...(names ? { customer: r.customerName } : {}) })),
  };
}

/** What customers still owe, and what is waiting on someone. */
export function outstanding(ctx: Ctx) {
  need(ctx, 'bookings');
  const t = now();
  const played = one<{ n: number; s: number | null }>("SELECT COUNT(*) n, SUM(total_paise - paid_paise) s FROM bookings WHERE owner_id = ? AND status IN ('confirmed','completed') AND end_at <= ? AND total_paise > paid_paise", ctx.ownerId, t)!;
  const fut = one<{ n: number; s: number | null }>("SELECT COUNT(*) n, SUM(total_paise - paid_paise) s FROM bookings WHERE owner_id = ? AND status = 'confirmed' AND end_at > ? AND total_paise > paid_paise", ctx.ownerId, t)!;
  const awaiting = one<{ n: number; s: number | null }>("SELECT COUNT(*) n, SUM(amount_paise) s FROM payments WHERE owner_id = ? AND status = 'submitted'", ctx.ownerId)!;
  const review = one<{ n: number }>("SELECT COUNT(*) n FROM bookings WHERE owner_id = ? AND status = 'held' AND needs_review = 1", ctx.ownerId)!.n;
  return {
    playedNotFullyPaid: { bookings: played.n, amountPaise: played.s ?? 0 },
    upcomingBalanceToCollect: { bookings: fut.n, amountPaise: fut.s ?? 0 },
    paymentsAwaitingVerification: { count: awaiting.n, amountPaise: awaiting.s ?? 0 },
    paidAfterHoldLapsedNeedsDecision: review,
  };
}

export function utilisation(ctx: Ctx, a: Range) {
  need(ctx, 'bookings');
  checkRange(a);
  const days = (istMidnight(a.to) - istMidnight(a.from)) / 86_400_000;
  if (days > 366) throw new HttpError(400, 'RANGE_TOO_LONG', 'Utilisation covers at most 366 days at a time');
  const o = opsOverview(ctx.ownerId, a);
  return { from: a.from, to: a.to, grounds: o.utilization.map((u) => ({ groundId: u.groundId, ground: u.groundName, bookedSlots: u.bookedSlots, availableSlots: u.availableSlots, utilisationPercent: u.utilization })) };
}

export function credits(ctx: Ctx) {
  need(ctx, 'bookings');
  const t = now();
  const r = one<{ s: number | null; soon: number | null; n: number }>(
    'SELECT SUM(remaining_paise) s, SUM(CASE WHEN expires_at <= ? THEN remaining_paise ELSE 0 END) soon, COUNT(DISTINCT customer_id) n FROM credit_lots WHERE owner_id = ? AND remaining_paise > 0 AND expires_at > ?', t + 30 * 86_400_000, ctx.ownerId, t)!;
  return { outstandingPaise: r.s ?? 0, expiringWithin30DaysPaise: r.soon ?? 0, customersHoldingCredit: r.n };
}

export function refunds(ctx: Ctx, a: Range) {
  need(ctx, 'bookings');
  checkRange(a);
  const owed = one<{ n: number; s: number | null }>("SELECT COUNT(*) n, SUM(amount_paise) s FROM refunds WHERE owner_id = ? AND status IN ('pending','processing')", ctx.ownerId)!;
  const done = one<{ n: number; s: number | null }>("SELECT COUNT(*) n, SUM(amount_paise) s FROM refunds WHERE owner_id = ? AND status <> 'failed' AND created_at >= ? AND created_at < ?", ctx.ownerId, istMidnight(a.from), istMidnight(addDays(a.to, 1)))!;
  return { from: a.from, to: a.to, stillToSend: { count: owed.n, amountPaise: owed.s ?? 0 }, refundedInPeriod: { count: done.n, amountPaise: done.s ?? 0 } };
}

export function customers(ctx: Ctx, a: Range) {
  need(ctx, 'customers');
  checkRange(a);
  // "Played" is the same test the Contacts tab uses: a completed session, or a confirmed one whose end time has passed.
  const played = "(status = 'completed' OR (status = 'confirmed' AND end_at <= ?))";
  const t = now();
  const inPeriod = one<{ n: number }>(`SELECT COUNT(DISTINCT customer_id) n FROM bookings WHERE owner_id = ? AND ${played} AND date BETWEEN ? AND ?`, ctx.ownerId, t, a.from, a.to)!.n;
  const first = one<{ n: number }>(`SELECT COUNT(*) n FROM (SELECT customer_id, MIN(date) d FROM bookings WHERE owner_id = ? AND ${played} GROUP BY customer_id) WHERE d BETWEEN ? AND ?`, ctx.ownerId, t, a.from, a.to)!.n;
  const everyone = summarize(ctx.ownerId, { who: 'played' });
  return { from: a.from, to: a.to, playedInPeriod: inPeriod, firstTimeInPeriod: first, haveEverPlayed: everyone.total, canEmail: everyone.reachableEmail, canWhatsapp: everyone.reachableWhatsapp };
}

export function grounds(ctx: Ctx): { id: string; name: string }[] {
  return many<{ id: string; name: string }>('SELECT id, name FROM grounds WHERE owner_id = ? ORDER BY name', ctx.ownerId);
}
