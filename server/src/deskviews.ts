import { many, one } from './db.ts';
import { forbidden, HttpError } from './errors.ts';
import { canSeeRevenue, hasPermission, type UserRow } from './auth.ts';
import { addDays, istDate, istMidnight, monthRange } from './time.ts';
import { manages } from './tasks.ts';
import { now } from './clock.ts';

// Views that gather what the desk already holds into one picture (the starter kit's operations calendar and money flow).
// Each part shows only what the same person can already open on its own page, so nothing new becomes visible.

export type CalKind = 'bookings' | 'closed' | 'tournament' | 'match' | 'membership' | 'task' | 'bill' | 'payroll' | 'fees' | 'close' | 'compliance';
export interface CalItem { date: string; kind: CalKind; title: string; href: string | null; done?: boolean; amountPaise?: number }

function monthOrFail(m: string | null): { month: string; from: string; to: string } {
  const month = m || istDate(now()).slice(0, 7);
  const r = monthRange(month);
  if (!r) throw new HttpError(400, 'VALIDATION_FAILED', 'month must look like 2026-10', { fields: [{ field: 'month', message: 'YYYY-MM' }] });
  return { month, ...r };
}
const readsBooks = (u: UserRow) => (hasPermission(u, 'view_reports') || hasPermission(u, 'manage_accounting')) && canSeeRevenue(u);

/** Everything with a date in one month: bookings, closed days, tournaments and matches, memberships ending, jobs due, bills due, payroll, academy fees, month-end and compliance reviews. */
export function opsCalendar(u: UserRow, owner: string, monthIn: string | null): { month: string; from: string; to: string; kinds: CalKind[]; items: CalItem[] } {
  const { month, from, to } = monthOrFail(monthIn);
  const items: CalItem[] = [];
  const kinds: CalKind[] = [];
  const isOwner = u.role === 'owner' || u.role === 'super_admin';

  if (hasPermission(u, 'manage_bookings')) {
    kinds.push('bookings', 'closed', 'membership');
    const rev = canSeeRevenue(u);
    for (const r of many<{ date: string; n: number; total: number }>(
      `SELECT date, COUNT(*) n, SUM(total_paise) total FROM bookings WHERE owner_id = ? AND date BETWEEN ? AND ? AND status IN ('held','confirmed','completed','no_show') GROUP BY date`, owner, from, to))
      items.push({ date: r.date, kind: 'bookings', title: `${r.n} booking${r.n === 1 ? '' : 's'}`, href: '/bookings/day', ...(rev ? { amountPaise: r.total } : {}) });
    for (const r of many<{ date: string; scopes: string; reason: string | null }>(`SELECT date, GROUP_CONCAT(scope, ', ') scopes, MAX(reason) reason FROM closed_dates WHERE date BETWEEN ? AND ? GROUP BY date`, from, to))
      items.push({ date: r.date, kind: 'closed', title: `Closed: ${r.scopes}${r.reason ? ` (${r.reason})` : ''}`, href: null });
    for (const r of many<{ id: string; name: string; end_date: string }>(`SELECT id, name, end_date FROM memberships WHERE owner_id = ? AND deleted_at IS NULL AND end_date BETWEEN ? AND ?`, owner, from, to))
      items.push({ date: r.end_date, kind: 'membership', title: `Membership ends: ${r.name}`, href: '/memberships/expiring' });
  }
  if (hasPermission(u, 'manage_matches')) {
    kinds.push('tournament', 'match');
    for (const t of many<{ id: string; name: string; start_date: string; end_date: string; status: string }>(
      `SELECT id, name, start_date, end_date, status FROM tournaments WHERE owner_id = ? AND deleted_at IS NULL AND start_date <= ? AND end_date >= ?`, owner, to, from))
      for (let d = t.start_date < from ? from : t.start_date; d <= t.end_date && d <= to; d = addDays(d, 1))
        items.push({ date: d, kind: 'tournament', title: t.name, href: '/tournaments', done: t.status === 'completed' });
    for (const m of many<{ title: string; scheduled_for: number; status: string }>(
      `SELECT title, scheduled_for, status FROM matches WHERE owner_id = ? AND scheduled_for >= ? AND scheduled_for < ?`, owner, istMidnight(from), istMidnight(addDays(to, 1))))
      items.push({ date: istDate(m.scheduled_for), kind: 'match', title: m.title, href: '/matches', done: m.status === 'completed' });
  }
  // the same jobs the task list shows this person
  kinds.push('task');
  for (const t of many<{ title: string; due_date: string; status: string }>(
    `SELECT title, due_date, status FROM tasks WHERE owner_id = ? AND status <> 'cancelled' AND due_date BETWEEN ? AND ? ${u.role === 'staff' && !manages(u) ? 'AND (assigned_to IS NULL OR assigned_to = ?)' : ''}`,
    owner, from, to, ...(u.role === 'staff' && !manages(u) ? [u.id] : [])))
    items.push({ date: t.due_date, kind: 'task', title: t.title, href: '/tasks', done: t.status === 'done' });
  if (readsBooks(u)) {
    kinds.push('bill', 'close');
    for (const b of many<{ id: string; due_date: string; amount_paise: number; status: string; vendor: string }>(
      `SELECT b.id, b.due_date, b.amount_paise, b.status, v.name vendor FROM acct_bills b JOIN acct_vendors v ON v.id = b.vendor_id WHERE b.owner_id = ? AND b.deleted_at IS NULL AND b.status <> 'rejected' AND b.due_date BETWEEN ? AND ?`, owner, from, to))
      items.push({ date: b.due_date, kind: 'bill', title: `Bill due: ${b.vendor}`, href: `/bills/${b.id}`, done: b.status === 'paid', amountPaise: b.amount_paise });
    const signed = !!one('SELECT 1 FROM acct_signoffs WHERE owner_id = ? AND month = ? AND reopened_at IS NULL', owner, month);
    items.push({ date: to, kind: 'close', title: 'Month-end close', href: '/accounting/close', done: signed });
  }
  if (hasPermission(u, 'manage_academy')) {
    kinds.push('fees');
    for (const f of many<{ due_on: string; n: number; open: number }>(
      `SELECT f.due_on, COUNT(*) n, SUM(CASE WHEN COALESCE((SELECT SUM(p.amount_paise) FROM academy_fee_payments p WHERE p.fee_id = f.id), 0) < f.amount_paise THEN 1 ELSE 0 END) open
       FROM academy_fees f WHERE f.owner_id = ? AND f.due_on BETWEEN ? AND ? GROUP BY f.due_on`, owner, from, to))
      items.push({ date: f.due_on, kind: 'fees', title: f.open ? `Academy fees due: ${f.open} of ${f.n} unpaid` : `Academy fees due: all ${f.n} paid`, href: '/academy/fees', done: f.open === 0 });
  }
  if (isOwner) {
    kinds.push('payroll', 'compliance');
    const run = one<{ n: number; paid: number }>(`SELECT COUNT(l.id) n, SUM(CASE WHEN l.paid_on IS NOT NULL THEN 1 ELSE 0 END) paid FROM payroll_runs r LEFT JOIN payroll_lines l ON l.run_id = r.id WHERE r.owner_id = ? AND r.month = ? AND r.deleted_at IS NULL`, owner, month);
    const finalised = !!one('SELECT 1 FROM payroll_runs WHERE owner_id = ? AND month = ? AND deleted_at IS NULL', owner, month);
    items.push({ date: to, kind: 'payroll', title: finalised ? (run && run.n && run.paid === run.n ? 'Payroll paid' : 'Payroll finalised, pay the staff') : 'Payroll run', href: '/payroll/run', done: !!(finalised && run && run.n && run.paid === run.n) });
    for (const c of many<{ title: string; next_review_on: string }>(`SELECT title, next_review_on FROM compliance_items WHERE next_review_on BETWEEN ? AND ?`, from, to))
      items.push({ date: c.next_review_on, kind: 'compliance', title: `Review: ${c.title}`, href: '/compliance/rules' });
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || kinds.indexOf(a.kind) - kinds.indexOf(b.kind));
  return { month, from, to, kinds, items };
}

export interface FlowMonth {
  month: string;
  earned: { totalPaise: number; bookingsPaise: number; membershipsPaise: number; academyPaise: number };
  collected: { totalPaise: number; bookingsPaise: number; membershipsPaise: number; academyPaise: number };
  banked: { totalPaise: number; bankPaise: number; cashPaise: number };
  paidOut: { totalPaise: number; billsPaise: number; payrollPaise: number; otherPaise: number };
  toCollectPaise: number;
}

function flowMonth(owner: string, month: string): FlowMonth {
  const { from, to } = monthRange(month)!;
  const fromMs = istMidnight(from), toMs = istMidnight(addDays(to, 1));
  const n = (sql: string, ...p: (string | number)[]) => one<{ s: number | null }>(sql, ...p)?.s ?? 0;
  const bookingsEarned = n(`SELECT SUM(total_paise) s FROM bookings WHERE owner_id = ? AND date BETWEEN ? AND ? AND status IN ('confirmed','completed','no_show')`, owner, from, to);
  const members = n('SELECT SUM(amount_paise) s FROM membership_payments WHERE owner_id = ? AND paid_on BETWEEN ? AND ?', owner, from, to);
  const academyEarned = n('SELECT SUM(amount_paise) s FROM academy_fees WHERE owner_id = ? AND month = ?', owner, month);
  const bookingsIn = n(`SELECT SUM(amount_paise - refunded_paise) s FROM payments WHERE owner_id = ? AND status IN ('captured','partially_refunded','refunded') AND method <> 'credit' AND created_at >= ? AND created_at < ?`, owner, fromMs, toMs);
  const academyIn = n('SELECT SUM(amount_paise) s FROM academy_fee_payments WHERE owner_id = ? AND received_on BETWEEN ? AND ?', owner, from, to);
  const bank = n(`SELECT SUM(t.amount_paise) s FROM acct_transactions t JOIN acct_accounts a ON a.id = t.account_id WHERE t.owner_id = ? AND t.deleted_at IS NULL AND a.kind = 'bank' AND t.amount_paise > 0 AND t.txn_date BETWEEN ? AND ?`, owner, from, to);
  const cash = n(`SELECT SUM(t.amount_paise) s FROM acct_transactions t JOIN acct_accounts a ON a.id = t.account_id WHERE t.owner_id = ? AND t.deleted_at IS NULL AND a.kind = 'cash' AND t.amount_paise > 0 AND t.txn_date BETWEEN ? AND ?`, owner, from, to);
  const bills = n(`SELECT SUM(amount_paise) s FROM acct_bills WHERE owner_id = ? AND deleted_at IS NULL AND status = 'paid' AND paid_date BETWEEN ? AND ?`, owner, from, to);
  const payroll = n('SELECT SUM(net_paise) s FROM payroll_lines WHERE owner_id = ? AND paid_on BETWEEN ? AND ?', owner, from, to);
  // money that left the bank or cash book and is not already counted as a paid bill
  const other = -n(`SELECT SUM(t.amount_paise) s FROM acct_transactions t WHERE t.owner_id = ? AND t.deleted_at IS NULL AND t.amount_paise < 0 AND t.txn_date BETWEEN ? AND ?
    AND NOT EXISTS (SELECT 1 FROM acct_bills b WHERE b.transaction_id = t.id AND b.deleted_at IS NULL)`, owner, from, to);
  const owedBookings = n(`SELECT SUM(total_paise - paid_paise) s FROM bookings WHERE owner_id = ? AND date BETWEEN ? AND ? AND status IN ('confirmed','completed') AND total_paise > paid_paise`, owner, from, to);
  const owedFees = n(`SELECT SUM(f.amount_paise - COALESCE((SELECT SUM(p.amount_paise) FROM academy_fee_payments p WHERE p.fee_id = f.id), 0)) s FROM academy_fees f WHERE f.owner_id = ? AND f.month = ?
    AND f.amount_paise > COALESCE((SELECT SUM(p.amount_paise) FROM academy_fee_payments p WHERE p.fee_id = f.id), 0)`, owner, month);
  return {
    month,
    earned: { totalPaise: bookingsEarned + members + academyEarned, bookingsPaise: bookingsEarned, membershipsPaise: members, academyPaise: academyEarned },
    collected: { totalPaise: bookingsIn + members + academyIn, bookingsPaise: bookingsIn, membershipsPaise: members, academyPaise: academyIn },
    banked: { totalPaise: bank + cash, bankPaise: bank, cashPaise: cash },
    paidOut: { totalPaise: bills + payroll + other, billsPaise: bills, payrollPaise: payroll, otherPaise: other },
    toCollectPaise: owedBookings + owedFees,
  };
}

/** Earned, then collected, then banked, then paid out, for one month and the five before it. Needs the same rights as the books. */
export function moneyFlow(u: UserRow, owner: string, monthIn: string | null): { current: FlowMonth; trend: FlowMonth[] } {
  if (!hasPermission(u, 'view_reports') && !hasPermission(u, 'manage_accounting')) throw forbidden('This needs the "view_reports" permission');
  if (!canSeeRevenue(u)) throw forbidden('Revenue is hidden from your login. Ask the owner to switch on "Can see revenue".');
  const { month } = monthOrFail(monthIn);
  const months: string[] = [];
  let [y, m] = month.split('-').map(Number) as [number, number];
  for (let i = 0; i < 6; i++) { months.unshift(`${y}-${String(m).padStart(2, '0')}`); m--; if (m === 0) { m = 12; y--; } }
  const trend = months.map((x) => flowMonth(owner, x));
  return { current: trend[trend.length - 1]!, trend };
}

// ---------------------------------------------------------------- activity feed
// The audit log as a feed: every event with a short title and the one action it most likely needs.
// Each kind of event shows only to people who can open its page; logins, questions and platform housekeeping stay out.

type Area = 'bookings' | 'books' | 'matches' | 'academy' | 'tasks' | 'people' | 'messages' | 'owner';
const AREA_OF: Record<string, Area> = {
  booking: 'bookings', series: 'bookings', payment: 'bookings', refund: 'bookings', credit: 'bookings', autodebit: 'bookings', enquiry: 'bookings', membership: 'bookings',
  acct: 'books', bill: 'books', gst: 'books', feed: 'books', aa: 'books',
  match: 'matches', tournament: 'matches', academy: 'academy', task: 'tasks', project: 'tasks', milestone: 'tasks',
  card: 'people', contacts: 'people', broadcast: 'messages', reminder: 'messages',
  payroll: 'owner', staff: 'owner', user: 'owner', ground: 'owner', media: 'owner', camera: 'owner', compliance: 'owner', promo: 'owner', legal: 'owner', integration: 'owner',
};
function mayseeArea(u: UserRow, a: Area): boolean {
  switch (a) {
    case 'bookings': return hasPermission(u, 'manage_bookings');
    case 'books': return readsBooks(u);
    case 'matches': return hasPermission(u, 'manage_matches');
    case 'academy': return hasPermission(u, 'manage_academy');
    case 'tasks': return manages(u);
    case 'people': return hasPermission(u, 'view_customers');
    case 'messages': return hasPermission(u, 'send_broadcasts');
    case 'owner': return u.role === 'owner' || u.role === 'super_admin';
  }
}
export interface FeedItem { id: number; at: number; area: Area; action: string; entity: string; entityId: string | null; who: string; detail: Record<string, unknown> | null; href: string | null; cta: string }

/** Where an event leads, and what the button on it says. */
function nextStep(action: string, entity: string, id: string | null, d: Record<string, any> | null): { href: string | null; cta: string } {
  const bookingId = entity === 'booking' ? id : typeof d?.bookingId === 'string' ? d.bookingId : null;
  if (action === 'payment.submit') return { href: '/bookings/payments', cta: 'Verify' };
  if (action === 'booking.confirm' && d?.approval === 'pending') return { href: '/bookings/approvals', cta: 'Approve' };
  if (action === 'bill.submit') return { href: '/approvals', cta: 'Approve' };
  if (action === 'bill.approve') return { href: `/bills/${id}`, cta: 'Pay' };
  if (action === 'bill.reject') return { href: `/bills/${id}`, cta: 'Fix' };
  if (entity === 'acct_bill') return { href: `/bills/${id}`, cta: 'Open' };
  if (entity === 'acct_vendor') return { href: '/bills/vendors', cta: 'Open' };
  if (entity === 'acct_signoff') return { href: '/accounting/close', cta: 'Open' };
  if (entity === 'acct_transaction' || entity === 'acct_import') return { href: '/transactions', cta: 'Categorise' };
  if (action.startsWith('refund.') && action !== 'refund.complete') return { href: '/bookings', cta: 'Open' };
  if (bookingId) return { href: `/bookings/${bookingId}`, cta: 'Open' };
  const page: Record<string, string> = { membership: '/memberships', membership_plan: '/memberships/plans', match: '/matches', tournament: '/tournaments', task: '/tasks', project: '/tasks', milestone: '/tasks',
    biz_card: '/cards', contacts: '/contacts', broadcast: '/contacts', reminder: '/reminders', payroll_runs: '/payroll/run', payroll_lines: '/payroll/run', payroll_staff: '/payroll/staff',
    payroll_attendance: '/payroll/attendance', payroll_adjustments: '/payroll/advances', user: '/team', ground: '/settings', media: '/media', camera: '/cameras', compliance_item: '/compliance/rules', promo: '/promos', enquiry: '/bookings' };
  const href = page[entity] ?? (entity.startsWith('academy') ? '/academy' : entity.startsWith('acct') || entity.startsWith('gst') ? '/accounting' : null);
  return { href, cta: 'Open' };
}

/** The latest events for one business, newest first. `before` is the id of the last event already shown. */
export function activityFeed(u: UserRow, owner: string, beforeIn: string | null, limitIn: string | null): { items: FeedItem[]; next: number | null } {
  const limit = Math.min(Math.max(Number(limitIn) || 40, 1), 100);
  const before = Number(beforeIn) > 0 ? Number(beforeIn) : Number.MAX_SAFE_INTEGER;
  const areas = new Set((Object.values(AREA_OF) as Area[]).filter((a) => mayseeArea(u, a)));
  const prefixes = Object.keys(AREA_OF).filter((p) => areas.has(AREA_OF[p]!));
  if (!prefixes.length) return { items: [], next: null };
  const money = canSeeRevenue(u);
  const rows = many<{ id: number; at: number; action: string; entity: string; entity_id: string | null; detail: string | null; actor_role: string | null; name: string | null }>(
    `SELECT a.id, a.at, a.action, a.entity, a.entity_id, a.detail, a.actor_role, u.name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
     WHERE a.owner_id = ? AND a.id < ? AND (${prefixes.map(() => "a.action LIKE ? ESCAPE '\\'").join(' OR ')}) ORDER BY a.id DESC LIMIT ?`,
    owner, before, ...prefixes.map((p) => p.replace(/_/g, '\\_') + '.%'), limit);
  const out: FeedItem[] = rows.map((r) => {
    const raw = r.detail ? (JSON.parse(r.detail) as Record<string, unknown>) : null;
    // amounts sit in the details, so they show only with "Can see revenue"
    return { id: r.id, at: r.at, area: AREA_OF[r.action.split('.')[0]!]!, action: r.action, entity: r.entity, entityId: r.entity_id, who: r.name ?? (r.actor_role === 'customer' ? 'A customer' : 'System'), detail: money ? raw : null, ...nextStep(r.action, r.entity, r.entity_id, raw) };
  });
  return { items: out, next: out.length >= limit ? out[out.length - 1]!.id : null };
}
