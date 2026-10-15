import { many, one } from '../db.ts';
import { HttpError } from '../errors.ts';
import { addDays, isValidDate, istDate, istMidnight, monthRange, DAY } from '../time.ts';
import { directory, type AcctInfo } from './chart.ts';
import { gstInside, gstPercent, ledgerLines, sumBy, type Line } from './ledger.ts';

// ---------------------------------------------------------------- dates

/** The Indian financial year: 1 April to 31 March. */
export function financialYear(date: string): { from: string; to: string } {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
}

export interface DateRange { from: string; to: string }

export function requireDate(v: string | null | undefined, field: string): string {
  if (!isValidDate(v)) throw new HttpError(400, 'VALIDATION_FAILED', `${field} must be a date like 2026-10-31`, { fields: [{ field, message: 'Must be a date like 2026-10-31' }] });
  return v;
}

/** `month=2026-10` or `from`+`to`. */
export function rangeFrom(q: { month?: string | null; from?: string | null; to?: string | null }, dflt: () => DateRange, maxDays = 732): DateRange {
  if (q.month) {
    const m = monthRange(q.month);
    if (!m) throw new HttpError(400, 'VALIDATION_FAILED', 'month must look like 2026-10', { fields: [{ field: 'month', message: 'Must look like 2026-10' }] });
    return m;
  }
  if (!q.from && !q.to) return dflt();
  const from = requireDate(q.from, 'from'), to = requireDate(q.to, 'to');
  if (to < from) throw new HttpError(400, 'VALIDATION_FAILED', 'to must not be before from', { fields: [{ field: 'to', message: 'Must not be before from' }] });
  if ((istMidnight(to) - istMidnight(from)) / DAY > maxDays) throw new HttpError(400, 'RANGE_TOO_LONG', maxDays === 732 ? 'A report covers at most two years at a time' : `A report covers at most ${maxDays} days at a time`);
  return { from, to };
}

/** The period of the same length that ends the day before `r` starts (for "compared with before"). */
export function previousRange(r: DateRange): DateRange {
  const month = /^(\d{4})-(\d{2})-01$/.exec(r.from);
  const whole = month ? monthRange(r.from.slice(0, 7)) : null;
  if (month && whole && whole.to === r.to) {
    const y = Number(month[1]), m = Number(month[2]);
    const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
    return monthRange(`${py}-${String(pm).padStart(2, '0')}`)!;
  }
  const days = Math.round((istMidnight(r.to) - istMidnight(r.from)) / DAY) + 1;
  return { from: addDays(r.from, -days), to: addDays(r.from, -1) };
}

// ---------------------------------------------------------------- profit and loss

export interface PnlRow { code: string; name: string; paise: number; previousPaise?: number }
export interface PnlGroup { name: string; rows: PnlRow[]; totalPaise: number; previousTotalPaise?: number }
export interface PnlSection { groups: PnlGroup[]; totalPaise: number; previousTotalPaise?: number }
export interface Pnl {
  range: DateRange;
  basis: 'accrual' | 'cash';
  revenue: PnlSection;
  expenses: PnlSection;
  netProfitPaise: number;
  previousNetProfitPaise?: number;
  /** Net profit as a percentage of revenue, one decimal. Null when there is no revenue. */
  marginPercent: number | null;
  previous: { range: DateRange } | null;
  /** Bank transactions in the period that nobody has categorised yet: the profit is not complete until they are. */
  uncategorised: { count: number; amountPaise: number };
  notes: string[];
}

const ACCRUAL_NOTE = 'Booking income is counted on the day the session is played, not the day it was paid for. Money paid in advance for future sessions is a liability on the balance sheet until then.';
const CASH_NOTE = 'Cash basis: booking money is counted on the day it was received, less refunds. Account credit, depreciation and goodwill credits are left out because no cash moved.';

export function profitAndLoss(ownerId: string, range: DateRange, opts: { basis?: 'accrual' | 'cash'; compare?: boolean } = {}): Pnl {
  const basis = opts.basis ?? 'accrual';
  const dir = directory(ownerId);
  const lines = ledgerLines(ownerId, range.to);
  const prev = opts.compare ? previousRange(range) : null;

  const amounts = (r: DateRange): Map<string, number> => {
    const m = new Map<string, number>();
    const inRange = (l: Line) => l.date >= r.from && l.date <= r.to;
    for (const [code, b] of sumBy(lines, inRange)) {
      const a = dir.get(code);
      if (!a || (a.type !== 'income' && a.type !== 'expense')) continue;
      m.set(code, a.type === 'income' ? b.credit - b.debit : b.debit - b.credit);
    }
    if (basis === 'cash') {
      for (const c of ['booking_income', 'forfeited_income', 'exp:goodwill', 'exp:depreciation']) m.delete(c);
      const gross = cashBookingReceipts(ownerId, r);
      m.set('booking_receipts', gross - gstInside(gross, gstPercent(ownerId)));
    }
    return m;
  };
  const cur = amounts(range);
  const before = prev ? amounts(prev) : null;
  const info = (code: string): AcctInfo => dir.get(code) ?? (code === 'booking_receipts' ? { code, name: 'Booking money received (net of refunds)', type: 'income', group: 'Bookings', sort: 10 } : { code, name: code, type: 'expense', group: 'Other', sort: 99 });

  const section = (type: 'income' | 'expense'): PnlSection => {
    const codes = new Set<string>([...cur.keys(), ...(before?.keys() ?? [])]);
    const byGroup = new Map<string, { sort: number; rows: PnlRow[] }>();
    for (const code of codes) {
      const a = info(code);
      if (a.type !== type) continue;
      const paise = cur.get(code) ?? 0;
      const previousPaise = before ? before.get(code) ?? 0 : undefined;
      if (paise === 0 && !previousPaise) continue;
      const g = byGroup.get(a.group) ?? { sort: 0, rows: [] };
      g.rows.push({ code, name: a.name, paise, ...(previousPaise !== undefined ? { previousPaise } : {}), });
      g.sort = Math.min(g.sort || a.sort, a.sort);
      byGroup.set(a.group, g);
    }
    const groups = [...byGroup.entries()].map(([name, g]): PnlGroup => {
      g.rows.sort((x, y) => info(x.code).sort - info(y.code).sort || x.name.localeCompare(y.name));
      const totalPaise = g.rows.reduce((s, r) => s + r.paise, 0);
      const previousTotalPaise = before ? g.rows.reduce((s, r) => s + (r.previousPaise ?? 0), 0) : undefined;
      return { name, rows: g.rows, totalPaise, ...(previousTotalPaise !== undefined ? { previousTotalPaise } : {}) };
    });
    groups.sort((a, b) => groupRank(type, a.name) - groupRank(type, b.name) || a.name.localeCompare(b.name));
    const totalPaise = groups.reduce((s, g) => s + g.totalPaise, 0);
    return { groups, totalPaise, ...(before ? { previousTotalPaise: groups.reduce((s, g) => s + (g.previousTotalPaise ?? 0), 0) } : {}) };
  };

  const revenue = section('income');
  const expenses = section('expense');
  const net = revenue.totalPaise - expenses.totalPaise;
  const un = one<{ n: number; s: number | null }>('SELECT COUNT(*) n, SUM(ABS(amount_paise)) s FROM acct_transactions WHERE owner_id = ? AND deleted_at IS NULL AND category_id IS NULL AND txn_date BETWEEN ? AND ?', ownerId, range.from, range.to)!;
  const notes = [basis === 'cash' ? CASH_NOTE : ACCRUAL_NOTE];
  if (gstPercent(ownerId) > 0) notes.push(`Prices are treated as including ${gstPercent(ownerId)}% GST. Revenue here is before GST; the GST is owed to the government and shows on the balance sheet.`);
  if (un.n > 0) notes.push(`${un.n} bank transaction${un.n === 1 ? ' is' : 's are'} not categorised yet, so this profit may be incomplete.`);
  return {
    range, basis, revenue, expenses, netProfitPaise: net,
    ...(before ? { previousNetProfitPaise: (revenue.previousTotalPaise ?? 0) - (expenses.previousTotalPaise ?? 0) } : {}),
    marginPercent: revenue.totalPaise > 0 ? Math.round((net / revenue.totalPaise) * 1000) / 10 : null,
    previous: prev ? { range: prev } : null,
    uncategorised: { count: un.n, amountPaise: un.s ?? 0 },
    notes,
  };
}

const EXPENSE_ORDER = ['Staff', 'Ground upkeep', 'Utilities', 'Premises', 'Admin & finance', 'Other'];
const INCOME_ORDER = ['Bookings', 'Other income'];
function groupRank(type: 'income' | 'expense', name: string): number {
  const i = (type === 'income' ? INCOME_ORDER : EXPENSE_ORDER).indexOf(name);
  return i < 0 ? 50 : i;
}

/** Cash basis: booking money received in the period, less refunds sent in it. Account credit is not cash. */
function cashBookingReceipts(ownerId: string, r: DateRange): number {
  const from = istMidnight(r.from), to = istMidnight(addDays(r.to, 1));
  const got = one<{ s: number | null }>("SELECT SUM(amount_paise) s FROM payments WHERE owner_id = ? AND status IN ('captured','refunded','partially_refunded') AND method <> 'credit' AND verified_at >= ? AND verified_at < ?", ownerId, from, to)!.s ?? 0;
  const back = one<{ s: number | null }>("SELECT SUM(amount_paise) s FROM refunds WHERE owner_id = ? AND status <> 'failed' AND created_at >= ? AND created_at < ?", ownerId, from, to)!.s ?? 0;
  return got - back;
}

// ---------------------------------------------------------------- balance sheet

export interface BsRow { code: string; name: string; paise: number }
export interface BsGroup { name: string; rows: BsRow[]; totalPaise: number }
export interface BsSide { groups: BsGroup[]; totalPaise: number }
export interface BalanceSheet {
  asOf: string;
  financialYear: DateRange;
  assets: BsSide;
  liabilities: BsSide;
  equity: BsSide;
  totalAssetsPaise: number;
  totalLiabilitiesPaise: number;
  totalEquityPaise: number;
  /** Assets = liabilities + equity. The books are built so this always holds; if it ever did not, `differencePaise` says by how much. */
  balanced: boolean;
  differencePaise: number;
  attention: { uncategorisedCount: number; uncategorisedPaise: number };
  notes: string[];
}

const ASSET_ORDER = ['Cash and bank', 'Current assets', 'Fixed assets', 'Needs attention', 'Other balances'];
const LIAB_ORDER = ['Current liabilities', 'Loans', 'Other balances'];

export function balanceSheet(ownerId: string, asOf: string): BalanceSheet {
  const dir = directory(ownerId);
  const fy = financialYear(asOf);
  const lines = ledgerLines(ownerId, asOf);
  const totals = sumBy(lines);

  const assets = new Map<string, BsRow[]>();
  const liabilities = new Map<string, BsRow[]>();
  const equity: BsRow[] = [];
  const add = (m: Map<string, BsRow[]>, group: string, row: BsRow) => { const a = m.get(group) ?? []; a.push(row); m.set(group, a); };
  const sortOf = (code: string) => dir.get(code)?.sort ?? 99;

  const codes = new Set<string>([...totals.keys(), ...[...dir.values()].filter((a) => a.code.startsWith('bank:')).map((a) => a.code)]);
  for (const code of [...codes].sort((a, b) => sortOf(a) - sortOf(b) || a.localeCompare(b))) {
    const a = dir.get(code);
    if (!a) continue;
    const b = totals.get(code) ?? { debit: 0, credit: 0 };
    const net = b.debit - b.credit; // positive = debit balance
    if (a.type === 'asset') {
      if (net === 0 && !code.startsWith('bank:')) continue;
      if (net < 0 && !a.contra && !code.startsWith('bank:')) add(liabilities, 'Other balances', { code, name: `${a.name} (credit balance)`, paise: -net });
      else add(assets, a.group, { code, name: net < 0 && code.startsWith('bank:') ? `${a.name} (overdrawn)` : a.name, paise: net });
    } else if (a.type === 'liability') {
      if (net === 0) continue;
      if (net > 0) add(assets, 'Other balances', { code, name: `${a.name} (debit balance)`, paise: net });
      else add(liabilities, a.group, { code, name: a.name, paise: -net });
    } else if (a.type === 'equity') {
      if (net !== 0) equity.push({ code, name: a.name, paise: -net });
    }
  }

  // Income and expenses roll into equity: earlier years as retained profit, this financial year as profit so far.
  let earlier = 0, thisYear = 0;
  for (const l of lines) {
    const a = dir.get(l.account);
    if (!a || (a.type !== 'income' && a.type !== 'expense')) continue;
    const v = l.credit - l.debit;
    if (l.date < fy.from) earlier += v; else thisYear += v;
  }
  if (earlier !== 0) equity.push({ code: 'retained_earnings', name: 'Profit kept from earlier years', paise: earlier });
  equity.push({ code: 'current_profit', name: `Profit for the financial year so far (from ${fy.from})`, paise: thisYear });

  const side = (m: Map<string, BsRow[]>, order: string[]): BsSide => {
    const groups = [...m.entries()].map(([name, rows]): BsGroup => ({ name, rows, totalPaise: rows.reduce((s, r) => s + r.paise, 0) }));
    groups.sort((x, y) => (order.indexOf(x.name) < 0 ? 50 : order.indexOf(x.name)) - (order.indexOf(y.name) < 0 ? 50 : order.indexOf(y.name)));
    return { groups, totalPaise: groups.reduce((s, g) => s + g.totalPaise, 0) };
  };
  const a = side(assets, ASSET_ORDER);
  const l = side(liabilities, LIAB_ORDER);
  const e: BsSide = { groups: [{ name: 'Owner equity', rows: equity, totalPaise: equity.reduce((s, r) => s + r.paise, 0) }], totalPaise: equity.reduce((s, r) => s + r.paise, 0) };
  const diff = a.totalPaise - l.totalPaise - e.totalPaise;

  const un = one<{ n: number; s: number | null }>('SELECT COUNT(*) n, SUM(ABS(amount_paise)) s FROM acct_transactions WHERE owner_id = ? AND deleted_at IS NULL AND category_id IS NULL AND txn_date <= ?', ownerId, asOf)!;
  const notes = [
    'Money paid in advance for sessions that have not been played yet is shown as a liability: it is owed to the customer until the session happens.',
    'This is built from your bank transactions, your bookings and payments, and any journal entries you have added. Equipment, loans and bills you owe appear once you record them.',
  ];
  if (un.n > 0) notes.push(`${un.n} bank transaction${un.n === 1 ? ' is' : 's are'} not categorised yet. They are held under "Needs attention" until you categorise them.`);
  return {
    asOf, financialYear: fy, assets: a, liabilities: l, equity: e,
    totalAssetsPaise: a.totalPaise, totalLiabilitiesPaise: l.totalPaise, totalEquityPaise: e.totalPaise,
    balanced: diff === 0, differencePaise: diff,
    attention: { uncategorisedCount: un.n, uncategorisedPaise: un.s ?? 0 },
    notes,
  };
}

// ---------------------------------------------------------------- trial balance and account ledger

export interface TrialRow { code: string; name: string; type: string; debitPaise: number; creditPaise: number }
export function trialBalance(ownerId: string, asOf: string): { asOf: string; rows: TrialRow[]; totalDebitPaise: number; totalCreditPaise: number; balanced: boolean } {
  const dir = directory(ownerId);
  const totals = sumBy(ledgerLines(ownerId, asOf));
  const rows: TrialRow[] = [];
  for (const [code, b] of totals) {
    const a = dir.get(code);
    const net = b.debit - b.credit;
    if (net === 0) continue;
    rows.push({ code, name: a?.name ?? code, type: a?.type ?? 'unknown', debitPaise: net > 0 ? net : 0, creditPaise: net < 0 ? -net : 0 });
  }
  const order = ['asset', 'liability', 'equity', 'income', 'expense'];
  rows.sort((x, y) => order.indexOf(x.type) - order.indexOf(y.type) || (dir.get(x.code)?.sort ?? 99) - (dir.get(y.code)?.sort ?? 99) || x.name.localeCompare(y.name));
  const d = rows.reduce((s, r) => s + r.debitPaise, 0), c = rows.reduce((s, r) => s + r.creditPaise, 0);
  return { asOf, rows, totalDebitPaise: d, totalCreditPaise: c, balanced: d === c };
}

export interface LedgerEntry { date: string; src: string; ref: string; debitPaise: number; creditPaise: number; balancePaise: number }
/** Every posting to one account in a period, with the running balance: why a number on a report is what it is. */
export function accountLedger(ownerId: string, account: string, range: DateRange): { account: { code: string; name: string; type: string }; openingPaise: number; entries: LedgerEntry[]; closingPaise: number } {
  const dir = directory(ownerId);
  const a = dir.get(account);
  if (!a) throw new HttpError(404, 'NOT_FOUND', 'No such account');
  const sign = a.type === 'asset' || a.type === 'expense' ? 1 : -1; // show each account on its own natural side
  const all = ledgerLines(ownerId, range.to).filter((l) => l.account === account).sort((x, y) => x.date.localeCompare(y.date) || x.ref.localeCompare(y.ref));
  const opening = all.filter((l) => l.date < range.from).reduce((s, l) => s + sign * (l.debit - l.credit), 0);
  let run = opening;
  const entries = all.filter((l) => l.date >= range.from).map((l): LedgerEntry => {
    run += sign * (l.debit - l.credit);
    return { date: l.date, src: l.src, ref: l.ref, debitPaise: l.debit, creditPaise: l.credit, balancePaise: run };
  });
  return { account: { code: a.code, name: a.name, type: a.type }, openingPaise: opening, entries, closingPaise: run };
}

export const todayIst = (ms: number): string => istDate(ms);
export { many };
