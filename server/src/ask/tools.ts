import { formatPaise } from '@daji/shared';
import { many, one } from '../db.ts';
import { now } from '../clock.ts';
import { forbidden, HttpError } from '../errors.ts';
import { hasPermission, type UserRow } from '../auth.ts';
import { mainSiteBusinessId } from '../businesses.ts';
import { addDays, istDate, istMidnight } from '../time.ts';
import { overview as opsOverview } from '../reports.ts';
import { summarize } from '../contacts.ts';
import { balanceSheet, profitAndLoss, type BalanceSheet } from '../accounting/statements.ts';
import { futureSchedule, pastSchedule } from '../accounting/schedule.ts';
import { listAccounts } from '../accounting/store.ts';
import { listOpen, getFlow, describe, looksAfterAny, APPROVAL_KINDS, KIND_INFO } from '../approvals.ts';
import { changes as lawChanges, lastChecks, register } from '../compliance.ts';
import { alerts as lawAlerts, lastFeedRun } from '../lawUpdates.ts';
import { sheetSummary } from '../sheets.ts';
import { staffAuctionFacts } from '../auction.ts';
import { depositsAt } from '../auctionDeposit.ts';
import { staffWaitlist } from '../waitlist.ts';
import { checkInsOn } from '../players.ts';
import { leaders } from '../playerStats.ts';
import { fantasyOverview } from '../fantasy.ts';
import { serverConsole, serverStatus } from '../serverConsole.ts';
import { areaFilter, listAreas } from '../areas.ts';
import type { Config } from '../config.ts';

// The questions Ask AI can put to the software. Every tool calls the same functions as the Reports tab, so an answer
// can never disagree with a report. They are read-only, scoped to one owner and checked against the asker's permissions.
// The built-in answerer and the optional Claude mode use exactly these.

/** `cfg` is there for the server status only (Settings › Server); every other tool reads the database. */
export interface Ctx { ownerId: string; user: UserRow; cfg?: Config }
export type Area = 'reports' | 'bookings' | 'customers' | 'tasks' | 'team' | 'approvals' | 'compliance' | 'tournaments';

const AREA_PERMISSION: Record<Area, string> = { reports: 'view_reports', bookings: 'manage_bookings', customers: 'view_customers', tasks: 'manage_tasks', team: 'owner', approvals: 'manage_accounting', compliance: 'owner', tournaments: 'manage_matches' };
const AREA_WORDS: Record<Area, string> = { reports: 'the money reports', bookings: 'bookings', customers: 'customers', tasks: 'the jobs', team: 'the team', approvals: 'the approvals', compliance: 'the compliance register', tournaments: 'the tournaments' };

export function can(ctx: Ctx, area: Area): boolean {
  const u = ctx.user;
  if (area === 'reports') return (hasPermission(u, 'view_reports') || hasPermission(u, 'manage_accounting')) && hasPermission(u, 'view_revenue');
  if (area === 'bookings') return hasPermission(u, 'manage_bookings') || hasPermission(u, 'view_reports');
  if (area === 'tasks') return hasPermission(u, 'manage_tasks');
  if (area === 'team') return u.role !== 'staff';
  if (area === 'approvals') return looksAfterAny(u);
  // the same people as the Compliance page: the software owner, and the owner of the main site's business (requireMainBusiness)
  if (area === 'compliance') { const main = mainSiteBusinessId(); return u.role === 'super_admin' || (u.role === 'owner' && (!main || main === u.id)); }
  // the same people as the Tournaments page
  if (area === 'tournaments') return hasPermission(u, 'manage_matches');
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
  const out: BookingsAnswer = {
    from: a.from, to: a.to, groundId: a.groundId ?? null,
    played: { sessions: s.sessions, slots: s.slots, valuePaise: s.valuePaise, incomePaise: s.incomePaise, collectedPaise: s.collectedPaise, notCollectedPaise: s.outstandingPaise },
    noShows: { count: s.noShows, advanceKeptPaise: s.noShowKeptPaise },
    cancellations: { count: s.cancellations, inTime: s.cancelledInTime, late: s.cancelledLate, refundedPaise: s.cancelRefundedPaise, creditGivenPaise: s.cancelCreditedPaise, advanceKeptPaise: s.cancelKeptPaise },
    upcoming: { bookings: fut.summary.bookings, slots: fut.summary.slots, valuePaise: fut.summary.valuePaise, paidPaise: fut.summary.paidPaise, toCollectPaise: fut.summary.duePaise },
    byGround: [...ground.values()].sort((x, y) => (y.earnedPaise + y.upcomingValuePaise) - (x.earnedPaise + x.upcomingValuePaise) || x.groundName.localeCompare(y.groundName)),
  };
  if (hasPermission(ctx.user, 'view_revenue')) return out;
  // A team member without "Can see revenue" gets the counts but no rupee figures, however the question is asked.
  const hide = <T extends object>(o: T, keys: string[]): T => { const c = { ...o } as Record<string, unknown>; for (const k of keys) if (k in c) c[k] = null; return c as T; };
  out.played = hide(out.played, ['valuePaise', 'incomePaise', 'collectedPaise', 'notCollectedPaise']);
  out.noShows = hide(out.noShows, ['advanceKeptPaise']);
  out.cancellations = hide(out.cancellations, ['refundedPaise', 'creditGivenPaise', 'advanceKeptPaise']);
  out.upcoming = hide(out.upcoming, ['valuePaise', 'paidPaise', 'toCollectPaise']);
  out.byGround = out.byGround.map((g) => hide(g, ['earnedPaise', 'upcomingValuePaise']));
  return out;
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
  // a multi-day booking is one booking however many of its days are still to come
  const fut = one<{ n: number; s: number | null }>(`SELECT COUNT(DISTINCT CASE WHEN s.kind = 'block' THEN b.series_id ELSE b.id END) n, SUM(b.total_paise - b.paid_paise) s FROM bookings b LEFT JOIN booking_series s ON s.id = b.series_id
    WHERE b.owner_id = ? AND b.status = 'confirmed' AND b.end_at > ? AND b.total_paise > b.paid_paise`, ctx.ownerId, t)!;
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

/** Jobs on the task board: how many are open, overdue and finished, and the titles of what is overdue. Titles only; no names. */
export function jobs(ctx: Ctx, a: Range) {
  need(ctx, 'tasks');
  checkRange(a);
  const today = todayIst();
  // jobs in a project of a branch the asker may not see (areas.ts) are left out of every figure, as on the task board
  const f = areaFilter(ctx.user, ctx.ownerId, 'area_id');
  const seen = `AND (project_id IS NULL OR project_id IN (SELECT id FROM projects WHERE ${f.sql}))`;
  const n = (sql: string, ...p: (string | number)[]) => one<{ n: number }>(`${sql} ${seen}`, ctx.ownerId, ...p, ...f.params)!.n;
  const overdue = many<{ title: string; due_date: string }>(`SELECT title, due_date FROM tasks WHERE owner_id = ? AND status = 'open' AND due_date < ? ${seen} ORDER BY due_date LIMIT 10`, ctx.ownerId, today, ...f.params);
  return {
    today,
    open: n("SELECT COUNT(*) n FROM tasks WHERE owner_id = ? AND status = 'open'"),
    overdue: n("SELECT COUNT(*) n FROM tasks WHERE owner_id = ? AND status = 'open' AND due_date < ?", today),
    dueInPeriod: n("SELECT COUNT(*) n FROM tasks WHERE owner_id = ? AND status = 'open' AND due_date BETWEEN ? AND ?", a.from, a.to),
    doneInPeriod: n("SELECT COUNT(*) n FROM tasks WHERE owner_id = ? AND status = 'done' AND completed_at >= ? AND completed_at < ?", istMidnight(a.from), istMidnight(addDays(a.to, 1))),
    overdueJobs: overdue.map((t) => ({ title: t.title, due: t.due_date })),
  };
}

/**
 * The branches of this business the asker may see (areas.ts), each with its projects and their open and overdue jobs. A restricted
 * branch the asker was not given is not mentioned at all. Names of branches and projects only; no people, no money.
 */
export function branches(ctx: Ctx) {
  need(ctx, 'tasks');
  const today = todayIst();
  const projects = (areaId: string | null) => many<{ id: string; name: string; status: string }>(
    `SELECT id, name, status FROM projects WHERE owner_id = ? AND ${areaId ? 'area_id = ?' : 'area_id IS NULL'} ORDER BY status, name`, ctx.ownerId, ...(areaId ? [areaId] : []))
    .map((p) => ({
      name: p.name, archived: p.status === 'archived',
      openJobs: one<{ n: number }>("SELECT COUNT(*) n FROM tasks WHERE project_id = ? AND status = 'open'", p.id)!.n,
      overdueJobs: one<{ n: number }>("SELECT COUNT(*) n FROM tasks WHERE project_id = ? AND status = 'open' AND due_date < ?", p.id, today)!.n,
    }));
  const list = listAreas(ctx.user, ctx.ownerId).items;
  return { today, branches: list.map((a) => ({ name: a.name, restricted: a.restricted, projects: projects(a.id) })), notInABranch: projects(null) };
}

/** The team's attendance sheet for a period: days present, half days, absences and leave, as totals. No names. */
export function team(ctx: Ctx, a: Range) {
  need(ctx, 'team');
  checkRange(a);
  const rows = many<{ status: string; n: number }>('SELECT status, COUNT(*) n FROM payroll_attendance WHERE owner_id = ? AND deleted_at IS NULL AND date BETWEEN ? AND ? GROUP BY status', ctx.ownerId, a.from, a.to);
  const get = (s: string) => rows.find((r) => r.status === s)?.n ?? 0;
  const active = one<{ n: number }>('SELECT COUNT(*) n FROM payroll_staff WHERE owner_id = ? AND active = 1', ctx.ownerId)!.n;
  return { from: a.from, to: a.to, activeStaff: active, present: get('present'), halfDays: get('half'), absent: get('absent'), onLeave: get('leave') };
}

/** What is waiting for a sign-off, and on whom: the same list, and the same visibility, as the Approvals page. Titles and amounts, never bank details. */
export function approvalsWaiting(ctx: Ctx) {
  need(ctx, 'approvals');
  const open = listOpen(ctx.ownerId, ctx.user);
  return {
    waiting: open.length,
    items: open.slice(0, 20).map((r) => {
      const now = r.steps.find((s) => s.state === 'now');
      return { kind: KIND_INFO[r.kind as keyof typeof KIND_INFO].name, title: r.title, amountPaise: r.amountPaise, sentInBy: r.submittedByName, sentInAt: r.submittedAt, round: r.round,
        waitingOn: now ? `${now.label} (${now.who})` : 'nobody', stepsDone: r.steps.filter((s) => s.state === 'done').length, stepsTotal: r.steps.length,
        youCanSign: r.canSign, whyNot: r.whyNot, rule: r.rule };
    }),
  };
}

/** The sign-off rules for each kind of approval, in words. */
export function approvalRules(ctx: Ctx) {
  need(ctx, 'approvals');
  return { rules: APPROVAL_KINDS.map((k) => ({ kind: KIND_INFO[k].name, rule: describe(k, getFlow(ctx.ownerId, k).flow) })) };
}

/** Why this person may not sign one waiting item, found by what it is called. */
export function whyCantISign(ctx: Ctx, a: { text: string }) {
  need(ctx, 'approvals');
  const q = a.text.trim().toLowerCase();
  const hit = listOpen(ctx.ownerId, ctx.user).filter((r) => !q || r.title.toLowerCase().includes(q)).slice(0, 5);
  return { matches: hit.map((r) => ({ title: r.title, amountPaise: r.amountPaise, canSign: r.canSign, reason: r.whyNot, waitingOn: r.steps.find((s) => s.state === 'now')?.who ?? null, rule: r.rule })) };
}

// The audit actions that count as approval decisions: bills and pay runs as before, and the same steps for refunds (plus the
// ground clearing one and the super admin authorising or declining it), discounts, fee waivers and expenses.
const DECIDED = ['bill.signoff', 'bill.sendback', 'bill.approve', 'bill.reject', 'payroll.signoff', 'payroll.approve', 'payroll.sendback', 'payroll.submit', 'payroll.withdraw',
  'refund.signoff', 'refund.sendback', 'refund.cleared', 'refund.reject', 'refund.approve', 'refund.decline',
  ...(['discount', 'waiver', 'expense'] as const).flatMap((k) => ['submit', 'signoff', 'sendback', 'approve', 'reject', 'withdraw'].map((a) => `${k}.${a}`))];

/** A count of approvals decided in a period, from the audit trail. */
export function approvalsDecided(ctx: Ctx, a: Range) {
  need(ctx, 'approvals');
  checkRange(a);
  const rows = many<{ action: string; n: number }>(`SELECT action, COUNT(*) n FROM audit_log WHERE owner_id = ? AND at >= ? AND at < ? AND action IN (${DECIDED.map(() => '?').join(',')}) GROUP BY action`, ctx.ownerId, istMidnight(a.from), istMidnight(addDays(a.to, 1)), ...DECIDED);
  return { from: a.from, to: a.to, decisions: Object.fromEntries(rows.map((r) => [r.action, r.n])) };
}

// ---------------------------------------------------------------- compliance

/** The compliance register as the Compliance page shows it: each rule and its review date, the law-change log, the last check and the law updates waiting. */
export function compliance(ctx: Ctx) {
  need(ctx, 'compliance');
  const rules = register();
  const waiting = lawAlerts(200).filter((a) => a.status === 'new');
  const feed = lastFeedRun();
  return {
    today: todayIst(), rulesOnRegister: rules.length,
    overdue: rules.filter((r) => r.status === 'due').length, dueWithin30Days: rules.filter((r) => r.status === 'soon').length,
    rules: rules.map((r) => ({ code: r.code, title: r.title, law: r.authority, rule: r.rule, enforcedAs: r.currentValue, where: r.enforcedIn, lastReviewedOn: r.lastReviewedOn, nextReviewOn: r.nextReviewOn, status: r.status === 'due' ? 'review overdue' : r.status === 'soon' ? 'review soon' : 'up to date' })),
    lastCheck: lastChecks(1)[0] ?? null,
    recentLawChanges: lawChanges().slice(0, 10).map((c) => ({ code: c.code, changedOn: c.changedOn, summary: c.summary, oldValue: c.oldValue, newValue: c.newValue, source: c.source })),
    lawUpdatesWaiting: waiting.length,
    lawUpdates: waiting.slice(0, 10).map((a) => ({ title: a.title, publishedOn: a.publishedOn, rules: a.codes, from: a.source === 'feed' ? 'the updates feed' : 'added by hand', link: a.url })),
    feed: feed ? { lastReadOn: feed.ranOn, ok: feed.ok, message: feed.message } : null,
  };
}

// ---------------------------------------------------------------- shared spreadsheet

/** The shared spreadsheet (Settings › Connections): what is linked, the last send and read, and the booking requests from it waiting for review. Names only for people who see customers. */
export function sheet(ctx: Ctx) {
  need(ctx, 'bookings');
  return sheetSummary(ctx.ownerId, can(ctx, 'customers'));
}

/** Tournaments customers host at this business (player auctions and teams entering directly): status, host, teams, players, and the hosting deposits due, held or waived. Bids are points; no contact details. */
export function auctionTournaments(ctx: Ctx) {
  need(ctx, 'tournaments');
  const items = staffAuctionFacts(ctx.ownerId);
  const dep = depositsAt(ctx.ownerId);
  return withText({ count: items.length, running: items.filter((i) => i.status === 'Auction running').length, signingUp: items.filter((i) => i.status === 'Players signing up').length,
    depositsHeldPaise: dep.heldPaise, depositsDuePaise: dep.duePaise, waiverRequestsWaiting: dep.waiversWaiting, items: items.slice(0, 20) });
}

/**
 * The weekly waitlist (Sunday leather ball unless changed): who is waiting and for which day, and the sessions offered now. The same list as the desk's
 * Waitlist page. Names only when asked for by someone who may see customers; Claude mode never gets names.
 */
export function waitlist(ctx: Ctx, names: boolean) {
  need(ctx, 'bookings');
  if (!hasPermission(ctx.user, 'manage_bookings')) throw forbidden('You do not have access to the waitlist. Ask the owner to give you the "manage_bookings" permission.');
  const w = staffWaitlist(ctx.user, ctx.ownerId);
  const show = names && can(ctx, 'customers');
  const live = w.entries.filter((e) => e.status === 'waiting' || e.status === 'won');
  const byDate = new Map<string, number>();
  for (const e of live) byDate.set(e.nextDate, (byDate.get(e.nextDate) ?? 0) + 1);
  return {
    name: w.settings.name, switchedOn: w.settings.enabled, confirmHours: w.settings.confirmHours, tierPriority: w.settings.tierPriority, waveMinutes: w.settings.waveMinutes, tiers: w.settings.tiers,
    waiting: live.length, byDate: [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, people]) => ({ date, people })),
    people: live.map((e) => ({ ...(show ? { name: e.customerName } : {}), ground: e.groundName, session: e.session, nextDate: e.nextDate, status: e.status === 'won' ? 'accepted a slot' : 'waiting', everyWeek: e.everyWeek, weeksRolled: e.rollovers, gamesPlayed: e.games, tier: e.tier })),
    offers: w.offers.filter((o) => o.status !== 'closed').map((o) => ({ ground: o.groundName, session: o.session, date: o.date, time: `${o.time} to ${o.endTime}`, status: o.status === 'open' ? 'offered, nobody has accepted yet' : 'accepted', peopleTold: o.told, people: o.people, ...(show && o.takenBy ? { acceptedBy: o.takenBy } : {}) })),
  };
}

/** Team lists and check-ins at the ground for one day (today unless given): games, players, how many checked in, by phone or by staff. */
export function checkIns(ctx: Ctx, names: boolean, date?: string) {
  need(ctx, 'bookings');
  if (!hasPermission(ctx.user, 'manage_bookings')) throw forbidden('You do not have access to team lists. Ask the owner to give you the "manage_bookings" permission.');
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : istDate(now());
  const from = istMidnight(day);
  return { date: day, ...checkInsOn(ctx.ownerId, from, from + 24 * 3600 * 1000, names && can(ctx, 'customers')) };
}

/** Player records at this business (from finished scored matches, linked players only): the leaders by runs, wickets and dismissals. No names. */
export function playerRecords(ctx: Ctx) {
  if (!hasPermission(ctx.user, 'manage_matches') && !hasPermission(ctx.user, 'view_customers')) throw forbidden('You do not have access to player records. Ask the owner to give you the "manage_matches" permission.');
  const l = leaders(ctx.ownerId, 5);
  const strip = ({ userId: _u, name: _n, ...x }: (typeof l.runs)[number], i: number) => ({ rank: i + 1, ...x });
  return { playersWithARecord: l.players, finishedMatches: l.matches, mostRuns: l.runs.map(strip), mostWickets: l.wickets.map(strip), mostFieldingDismissals: l.fielding.map(strip) };
}

/** Fantasy cricket at this business: contests, teams entered, the latest contest's and the season's top points. No team or player names. */
export function fantasy(ctx: Ctx) {
  if (!hasPermission(ctx.user, 'manage_matches')) throw forbidden('You do not have access to fantasy contests. Ask the owner to give you the "manage_matches" permission.');
  return fantasyOverview(ctx.ownerId, false);
}

// ---------------------------------------------------------------- the server

/**
 * Settings › Server, for the ground owner and the software owner (never staff): is the server healthy, how full are the disk and memory, when was the last backup, and which Lightsail
 * instance the SSH button opens. Never a secret, and nothing here can reach the server: the SSH session itself happens at Amazon.
 */
export function server(ctx: Ctx) {
  if (ctx.user.role !== 'owner' && ctx.user.role !== 'super_admin') throw forbidden('Only the owner can see the server status (Settings › Server).');
  if (!ctx.cfg) throw new HttpError(503, 'NOT_AVAILABLE', 'The server status is not available here.');
  const s = serverStatus(ctx.cfg), c = serverConsole();
  return {
    healthy: s.ok, database: s.database, environment: s.env, demoMode: s.demo, version: s.version ?? 'not recorded on this server', startedAt: new Date(s.startedAt).toISOString(), upHours: Math.round(s.upSeconds / 360) / 10,
    memoryUsedPercent: s.memory.usedPercent, diskUsedPercent: s.disk?.usedPercent ?? null, diskFreeGb: s.disk?.freeGb ?? null, load: s.load,
    backups: { switchedOn: s.backups.enabled, kept: s.backups.count, lastAt: s.backups.lastAt ? new Date(s.backups.lastAt).toISOString() : null, lastOffsiteCopyAt: s.backups.offsiteAt ? new Date(s.backups.offsiteAt).toISOString() : null },
    warnings: s.warnings,
    sshButton: c.instance ? `Opens Amazon Lightsail's browser SSH for instance ${c.instance} in ${c.regionName} (${c.region}); you sign in to AWS there.` : 'Not set up: enter the Lightsail instance name in Settings › Server.',
    codingConsole: c.codingUrl,
  };
}
