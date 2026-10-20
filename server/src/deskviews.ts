import { many, one } from './db.ts';
import { forbidden, HttpError } from './errors.ts';
import { canSeeRevenue, hasPermission, type UserRow } from './auth.ts';
import { addDays, istDate, istMidnight, monthRange } from './time.ts';
import { manages } from './tasks.ts';
import { now } from './clock.ts';
import { overview } from './reports.ts';
import { profitAndLoss } from './accounting/statements.ts';
import { budgetVsActual } from './accounting/plus.ts';

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
    items.push({ date: to, kind: 'close', title: 'Month-end close', href: `/close/${month}`, done: signed });
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
  if (entity === 'acct_signoff') return { href: id ? `/close/${id}` : '/close', cta: 'Open' };
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

// ---------------------------------------------------------------- month-end close
// The starter kit's guided month-end: eight checks in order, each worked out from the books, ending with the sign-off.

export type StepState = 'done' | 'todo' | 'warn' | 'na';
export interface CloseStep { key: string; title: string; state: StepState; count: number; text: string; href: string | null; blocks: boolean }

export function closeChecklist(u: UserRow, owner: string, monthIn: string | null): { month: string; over: boolean; signedOff: boolean; steps: CloseStep[] } {
  if (!readsBooks(u)) throw forbidden('This needs the "view_reports" permission and "Can see revenue"');
  // the month just gone, unless one is named
  const month = monthIn ?? addDays(istDate(now()).slice(0, 7) + '-01', -1).slice(0, 7);
  const { from, to } = monthOrFail(month);
  const fromMs = istMidnight(from), toMs = istMidnight(addDays(to, 1));
  const n = (sql: string, ...p: (string | number)[]) => one<{ n: number | null }>(sql, ...p)?.n ?? 0;
  const isOwner = u.role === 'owner' || u.role === 'super_admin';
  const steps: CloseStep[] = [];
  const add = (key: string, title: string, state: StepState, count: number, text: string, href: string | null, blocks = false) => steps.push({ key, title, state, count, text, href, blocks });

  // 1. statements: every bank account has lines into the last week of the month
  const accts = many<{ name: string; last: string | null }>(`SELECT a.name, (SELECT MAX(t.txn_date) FROM acct_transactions t WHERE t.account_id = a.id AND t.deleted_at IS NULL AND t.txn_date <= ?) last
    FROM acct_accounts a WHERE a.owner_id = ? AND a.deleted_at IS NULL AND a.kind = 'bank'`, to, owner);
  const short = accts.filter((a) => !a.last || a.last < addDays(to, -6));
  add('statements', 'Import the bank statements', !accts.length ? 'warn' : short.length ? 'todo' : 'done', short.length,
    !accts.length ? 'No bank account is set up in Accounting yet.' : short.length ? `${short.map((a) => a.name).join(', ')} ${short.length === 1 ? 'has' : 'have'} no lines in the last week of the month.` : 'Every bank account has lines to the end of the month.', '/bank');
  // 2. categorise: sign-off refuses while any line is uncategorised
  const unc = n('SELECT COUNT(*) n FROM acct_transactions WHERE owner_id = ? AND deleted_at IS NULL AND category_id IS NULL AND txn_date BETWEEN ? AND ?', owner, from, to);
  add('categorise', 'Categorise every bank and cash line', unc ? 'todo' : 'done', unc, unc ? `${unc} line${unc === 1 ? '' : 's'} still need a category.` : 'Every line has a category.', '/transactions/pending', true);
  // 3. match online payments to the bank
  const unmatched = n(`SELECT COUNT(*) n FROM payments p WHERE p.owner_id = ? AND p.status IN ('captured','partially_refunded') AND p.method IN ('razorpay','upi','bank_transfer') AND p.created_at >= ? AND p.created_at < ?
    AND NOT EXISTS (SELECT 1 FROM acct_transactions t WHERE t.payment_id = p.id AND t.deleted_at IS NULL)`, owner, fromMs, toMs);
  add('reconcile', 'Match payments to the bank', unmatched ? 'warn' : 'done', unmatched, unmatched ? `${unmatched} online payment${unmatched === 1 ? ' is' : 's are'} not matched to a bank line yet.` : 'Every online payment is matched.', '/accounting/reconcile');
  // 4. UPI payments customers sent that nobody has checked
  const upi = n(`SELECT COUNT(*) n FROM payments WHERE owner_id = ? AND status = 'submitted' AND created_at < ?`, owner, toMs);
  add('upi', 'Verify UPI payments', upi ? 'todo' : 'done', upi, upi ? `${upi} UPI payment${upi === 1 ? ' waits' : 's wait'} to be checked.` : 'No UPI payment is waiting.', '/bookings/payments');
  // 5. sessions played with money still owed
  const owed = one<{ n: number; s: number | null }>(`SELECT COUNT(*) n, SUM(total_paise - paid_paise) s FROM bookings WHERE owner_id = ? AND date BETWEEN ? AND ? AND status IN ('confirmed','completed') AND total_paise > paid_paise`, owner, from, to)!;
  add('balances', 'Collect booking balances', owed.n ? 'warn' : 'done', owed.n, owed.n ? `${owed.n} session${owed.n === 1 ? '' : 's'} in the month still owe ₹${((owed.s ?? 0) / 100).toLocaleString('en-IN')}.` : 'Every session in the month is paid.', '/bookings');
  // 6. bills dated in the month that are not settled
  const bills = one<{ pend: number; appr: number }>(`SELECT SUM(CASE WHEN status IN ('draft','pending_approval') THEN 1 ELSE 0 END) pend, SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) appr
    FROM acct_bills WHERE owner_id = ? AND deleted_at IS NULL AND bill_date <= ?`, owner, to)!;
  const bp = bills.pend ?? 0, ba = bills.appr ?? 0;
  add('bills', 'Approve and pay the bills', bp + ba ? 'todo' : 'done', bp + ba, bp + ba ? [bp ? `${bp} waiting for approval` : '', ba ? `${ba} approved but not paid` : ''].filter(Boolean).join(', ') + '.' : 'No bill from the month is open.', bp ? '/approvals' : '/bills');
  // 7. payroll, the owner's step
  if (isOwner) {
    const pr = one<{ lines: number; paid: number }>(`SELECT COUNT(l.id) lines, SUM(CASE WHEN l.paid_on IS NOT NULL THEN 1 ELSE 0 END) paid FROM payroll_runs r LEFT JOIN payroll_lines l ON l.run_id = r.id WHERE r.owner_id = ? AND r.month = ? AND r.deleted_at IS NULL`, owner, month);
    const finalised = !!one('SELECT 1 FROM payroll_runs WHERE owner_id = ? AND month = ? AND deleted_at IS NULL', owner, month);
    const staffN = n('SELECT COUNT(*) n FROM payroll_staff WHERE owner_id = ? AND active = 1 AND deleted_at IS NULL', owner);
    const unpaid = finalised ? (pr?.lines ?? 0) - (pr?.paid ?? 0) : 0;
    add('payroll', 'Run and pay payroll', !staffN ? 'na' : !finalised || unpaid ? 'todo' : 'done', unpaid, !staffN ? 'No staff are on payroll.' : !finalised ? 'The payroll for the month is not finalised yet.' : unpaid ? `${unpaid} salar${unpaid === 1 ? 'y is' : 'ies are'} not marked paid.` : 'Payroll is finalised and paid.', '/payroll/run');
  } else add('payroll', 'Run and pay payroll', 'na', 0, 'The owner runs payroll.', null);
  // 8. sign off
  const signed = !!one('SELECT 1 FROM acct_signoffs WHERE owner_id = ? AND month = ? AND reopened_at IS NULL', owner, month);
  const over = to < istDate(now());
  add('signoff', 'Sign off the month', signed ? 'done' : 'todo', 0, signed ? 'The month is signed off and locked.' : !over ? 'A month can be signed off once its last day has passed.' : unc ? 'Categorise every line first, then sign off.' : 'Ready to sign off. This locks the month and keeps its profit and loss on record.', null);
  return { month, over, signedOff: signed, steps };
}

// ---------------------------------------------------------------- side-by-side compare
// Two months of the books, a month against its budget, or the grounds against each other.

export interface CmpRow { label: string; kind: 'money' | 'count' | 'pct'; values: (number | null)[]; head?: boolean; better?: 'up' | 'down' }
export interface Compare { mode: 'months' | 'budget' | 'grounds'; columns: string[]; rows: CmpRow[]; notes: string[] }
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mlabel = (m: string) => `${MON[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;

export function compare(u: UserRow, owner: string, mode: string | null, aIn: string | null, bIn: string | null): Compare {
  const a = monthOrFail(aIn).month;
  if (mode === 'grounds') {
    if (!hasPermission(u, 'manage_bookings')) throw forbidden('This needs the "manage_bookings" permission');
    const r = monthRange(a)!;
    const ov = overview(owner, r);
    const money = canSeeRevenue(u);
    const per = many<{ ground_id: string; n: number; total: number; paid: number }>(`SELECT ground_id, COUNT(*) n, SUM(total_paise) total, SUM(paid_paise) paid FROM bookings WHERE owner_id = ? AND date BETWEEN ? AND ? AND status IN ('confirmed','completed','no_show') GROUP BY ground_id`, owner, r.from, r.to);
    const by = new Map(per.map((x) => [x.ground_id, x]));
    const gs = ov.utilization;
    const rows: CmpRow[] = [
      { label: 'Sessions booked', kind: 'count', values: gs.map((g) => by.get(g.groundId)?.n ?? 0), better: 'up' },
      { label: 'Hours booked', kind: 'count', values: gs.map((g) => g.bookedSlots), better: 'up' },
      { label: 'Hours open', kind: 'count', values: gs.map((g) => g.availableSlots) },
      { label: 'Use of open hours', kind: 'pct', values: gs.map((g) => g.utilization), better: 'up' },
    ];
    if (money) rows.push(
      { label: 'Booked value', kind: 'money', values: gs.map((g) => by.get(g.groundId)?.total ?? 0), better: 'up' },
      { label: 'Collected', kind: 'money', values: gs.map((g) => by.get(g.groundId)?.paid ?? 0), better: 'up' },
      { label: 'Value per booked hour', kind: 'money', values: gs.map((g) => (g.bookedSlots ? Math.round((by.get(g.groundId)?.total ?? 0) / g.bookedSlots) : null)), better: 'up' },
    );
    return { mode: 'grounds', columns: gs.map((g) => g.groundName), rows, notes: [`${mlabel(a)}. Hours count the slots that were really open, including winter hours and weekly closed days.`] };
  }
  if (!readsBooks(u)) throw forbidden('This needs the "view_reports" permission and "Can see revenue"');
  if (mode === 'budget') {
    const b = budgetVsActual(owner, monthRange(a)!);
    const line = (x: { name: string; budgetPaise: number; actualPaise: number; type: string }): CmpRow => ({ label: x.name, kind: 'money', values: [x.actualPaise, x.budgetPaise], better: x.type === 'income' ? 'up' : 'down' });
    return {
      mode: 'budget', columns: ['Actual', 'Budget'],
      rows: [
        { label: 'Income', kind: 'money', values: [b.totals.actualIncomePaise, b.totals.budgetIncomePaise], head: true, better: 'up' }, ...b.income.map(line),
        { label: 'Expenses', kind: 'money', values: [b.totals.actualExpensePaise, b.totals.budgetExpensePaise], head: true, better: 'down' }, ...b.expenses.map(line),
        { label: 'Profit', kind: 'money', values: [b.totals.actualProfitPaise, b.totals.budgetProfitPaise], head: true, better: 'up' },
      ],
      notes: [`${mlabel(a)}.`, ...b.notes],
    };
  }
  // two months of the profit and loss, row by row
  const bm = bIn ? monthOrFail(bIn).month : addDays(a + '-01', -1).slice(0, 7);
  const [pa, pb] = [profitAndLoss(owner, monthRange(a)!), profitAndLoss(owner, monthRange(bm)!)];
  const rows: CmpRow[] = [];
  for (const [title, ka, kb, better] of [['Revenue', pa.revenue, pb.revenue, 'up'], ['Expenses', pa.expenses, pb.expenses, 'down']] as const) {
    rows.push({ label: title, kind: 'money', values: [ka.totalPaise, kb.totalPaise], head: true, better });
    const names = [...new Set([...ka.groups, ...kb.groups].flatMap((g) => g.rows.map((r) => r.name)))];
    const val = (sec: typeof ka, n: string) => sec.groups.flatMap((g) => g.rows).filter((r) => r.name === n).reduce((t, r) => t + r.paise, 0);
    for (const n of names) rows.push({ label: n, kind: 'money', values: [val(ka, n), val(kb, n)], better });
  }
  rows.push({ label: 'Net profit', kind: 'money', values: [pa.netProfitPaise, pb.netProfitPaise], head: true, better: 'up' });
  rows.push({ label: 'Margin', kind: 'pct', values: [pa.marginPercent, pb.marginPercent], better: 'up' });
  const notes = [pa, pb].filter((p) => p.uncategorised.count).map((p) => `${mlabel(p.range.from.slice(0, 7))} has ${p.uncategorised.count} uncategorised bank line${p.uncategorised.count === 1 ? '' : 's'}, so its profit is not complete yet.`);
  return { mode: 'months', columns: [mlabel(a), mlabel(bm)], rows, notes };
}

// ---------------------------------------------------------------- ground health (the orbit hub)
// Eight parts of the business around one score. Each part scores 0 to 100 from simple rules that are shown with it.

export interface HubPart { key: string; title: string; score: number; line: string; rule: string; href: string }
export function groundHealth(u: UserRow, owner: string): { score: number | null; parts: HubPart[] } {
  const today = istDate(now()), month = today.slice(0, 7), from = month + '-01';
  const n = (sql: string, ...p: (string | number)[]) => one<{ n: number | null }>(sql, ...p)?.n ?? 0;
  const clamp = (x: number) => Math.max(0, Math.min(100, Math.round(x)));
  const parts: HubPart[] = [];
  if (hasPermission(u, 'manage_bookings')) {
    const ov = overview(owner, { from, to: today });
    const open = ov.utilization.reduce((t, g) => t + g.availableSlots, 0), used = ov.utilization.reduce((t, g) => t + g.bookedSlots, 0);
    const pct = open ? (used / open) * 100 : 0;
    parts.push({ key: 'use', title: 'Ground use', score: clamp((pct / 40) * 100), line: `${Math.round(pct)}% of open hours booked this month`, rule: '40% or more of open hours booked scores full marks.', href: '/bookings/day' });
    const waiting = n(`SELECT COUNT(*) n FROM bookings WHERE owner_id = ? AND approval = 'pending' AND status = 'confirmed'`, owner) + n(`SELECT COUNT(*) n FROM payments WHERE owner_id = ? AND status = 'submitted'`, owner);
    parts.push({ key: 'queue', title: 'Bookings queue', score: clamp(100 - waiting * 15), line: waiting ? `${waiting} booking${waiting === 1 ? '' : 's'} or UPI payment${waiting === 1 ? '' : 's'} waiting` : 'Nothing waiting for approval or checking', rule: 'Each booking or UPI payment waiting takes 15 points.', href: '/pipeline/bookings' });
    const played = one<{ t: number | null; p: number | null }>(`SELECT SUM(total_paise) t, SUM(paid_paise) p FROM bookings WHERE owner_id = ? AND date BETWEEN ? AND ? AND status IN ('confirmed','completed','no_show')`, owner, from, today)!;
    const rate = played.t ? ((played.p ?? 0) / played.t) * 100 : 100;
    parts.push({ key: 'collect', title: 'Collections', score: clamp(rate), line: played.t ? `${Math.round(rate)}% collected on sessions played this month` : 'No sessions played yet this month', rule: 'The share of this month\'s played sessions that is paid.', href: '/bookings' });
  }
  if (readsBooks(u)) {
    const overdue = n(`SELECT COUNT(*) n FROM acct_bills WHERE owner_id = ? AND deleted_at IS NULL AND status IN ('pending_approval','approved') AND due_date < ?`, owner, today);
    parts.push({ key: 'bills', title: 'Bills', score: clamp(100 - overdue * 25), line: overdue ? `${overdue} bill${overdue === 1 ? ' is' : 's are'} overdue` : 'No bill is overdue', rule: 'Each overdue bill takes 25 points.', href: '/pipeline/bills' });
    const stale = n('SELECT COUNT(*) n FROM acct_transactions WHERE owner_id = ? AND deleted_at IS NULL AND category_id IS NULL AND txn_date < ?', owner, addDays(today, -7));
    const last = one<{ d: string | null }>(`SELECT MAX(t.txn_date) d FROM acct_transactions t JOIN acct_accounts a ON a.id = t.account_id WHERE t.owner_id = ? AND t.deleted_at IS NULL AND a.kind = 'bank'`, owner)?.d ?? null;
    const age = last ? Math.round((istMidnight(today) - istMidnight(last)) / 86_400_000) : null;
    parts.push({ key: 'books', title: 'Books', score: clamp(100 - stale * 5 - (age === null ? 50 : Math.max(0, age - 7) * 3)), line: [stale ? `${stale} line${stale === 1 ? '' : 's'} uncategorised for over a week` : 'Lines are categorised', age === null ? 'no bank statement yet' : `bank to ${age} day${age === 1 ? '' : 's'} ago`].join(', '), rule: 'Each line left uncategorised for over a week takes 5 points; a bank statement older than a week takes 3 points a day.', href: '/close' });
  }
  {
    // jobs: the same ones the task list shows this person
    const late = n(`SELECT COUNT(*) n FROM tasks WHERE owner_id = ? AND status = 'open' AND due_date < ? ${u.role === 'staff' && !manages(u) ? 'AND (assigned_to IS NULL OR assigned_to = ?)' : ''}`, owner, today, ...(u.role === 'staff' && !manages(u) ? [u.id] : []));
    parts.push({ key: 'jobs', title: 'Jobs', score: clamp(100 - late * 15), line: late ? `${late} job${late === 1 ? ' is' : 's are'} late` : 'No job is late', rule: 'Each late job takes 15 points.', href: '/tasks' });
  }
  if (hasPermission(u, 'manage_academy')) {
    const f = one<{ due: number | null; paid: number | null }>(`SELECT SUM(f.amount_paise) due, SUM(MIN(f.amount_paise, COALESCE((SELECT SUM(p.amount_paise) FROM academy_fee_payments p WHERE p.fee_id = f.id), 0))) paid FROM academy_fees f WHERE f.owner_id = ? AND f.month = ? AND f.due_on <= ?`, owner, month, today)!;
    const rate = f.due ? ((f.paid ?? 0) / f.due) * 100 : 100;
    parts.push({ key: 'academy', title: 'Academy fees', score: clamp(rate), line: f.due ? `${Math.round(rate)}% of this month's fees due so far are paid` : 'No fees due yet this month', rule: 'The share of fees due so far this month that is paid.', href: '/academy/fees' });
  }
  if (u.role === 'owner' || u.role === 'super_admin') {
    const due = n('SELECT COUNT(*) n FROM compliance_items WHERE next_review_on < ?', today);
    parts.push({ key: 'compliance', title: 'Compliance', score: clamp(100 - due * 34), line: due ? `${due} rule${due === 1 ? ' is' : 's are'} past the review date` : 'Every rule is reviewed on time', rule: 'Each rule past its review date takes 34 points.', href: '/compliance/rules' });
  }
  return { score: parts.length ? Math.round(parts.reduce((t, p) => t + p.score, 0) / parts.length) : null, parts };
}
