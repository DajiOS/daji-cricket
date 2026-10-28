import { many } from '../db.ts';
import { formatPhone } from '@daji/shared';
import { addDays, istDate, monthRange } from '../time.ts';
import { profitAndLoss, type DateRange } from './statements.ts';
import { now } from '../clock.ts';
import type { SheetSpec, Cell } from './xlsx.ts';

// Reports built on top of the same ledger the other statements use, so every figure agrees with them.
// A report here is a plain table: a few columns, rows of text and rupee amounts (in paise), an optional notes list.

export interface TableColumn { label: string; money?: boolean }
export interface TableRow { kind: 'head' | 'row' | 'sub' | 'net'; cells: (string | number | null)[] }
export interface TableReport { title: string; sub: string; columns: TableColumn[]; rows: TableRow[]; notes: string[] }

// ---------------------------------------------------------------- profit and loss by month or quarter

/** Calendar months, or Indian financial-year quarters (Apr-Jun, Jul-Sep, Oct-Dec, Jan-Mar), clipped to the range. */
export function periodsOf(range: DateRange, by: 'month' | 'quarter'): { label: string; range: DateRange }[] {
  const out: { label: string; range: DateRange }[] = [];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let from = range.from;
  while (from <= range.to) {
    const y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7));
    const qStart = by === 'month' ? m : m >= 10 ? 10 : m >= 7 ? 7 : m >= 4 ? 4 : 1;
    const span = by === 'month' ? 1 : 3;
    const endMonth = qStart + span - 1;
    const end = monthRange(`${y}-${String(endMonth).padStart(2, '0')}`)!.to;
    const to = end < range.to ? end : range.to;
    const label = by === 'month' ? `${MON[m - 1]} ${y}` : `${MON[qStart - 1]}–${MON[endMonth - 1]} ${y}`;
    out.push({ label, range: { from, to } });
    from = addDays(end, 1);
  }
  return out;
}

export function pnlByPeriod(ownerId: string, range: DateRange, by: 'month' | 'quarter', basis: 'accrual' | 'cash'): TableReport {
  const periods = periodsOf(range, by);
  const pnls = periods.map((p) => profitAndLoss(ownerId, p.range, { basis }));
  const section = (key: 'revenue' | 'expenses', title: string, rows: TableRow[]): number[] => {
    rows.push({ kind: 'head', cells: [title, ...periods.map(() => null), null] });
    const names = new Map<string, { name: string; group: string }>();
    for (const p of pnls) for (const g of p[key].groups) for (const r of g.rows) names.set(r.code, { name: r.name, group: g.name });
    for (const [code, info] of names) {
      const vals = pnls.map((p) => p[key].groups.flatMap((g) => g.rows).find((r) => r.code === code)?.paise ?? 0);
      rows.push({ kind: 'row', cells: [`${info.group}: ${info.name}`, ...vals, vals.reduce((a, b) => a + b, 0)] });
    }
    const totals = pnls.map((p) => p[key].totalPaise);
    rows.push({ kind: 'sub', cells: [`Total ${title.toLowerCase()}`, ...totals, totals.reduce((a, b) => a + b, 0)] });
    return totals;
  };
  const rows: TableRow[] = [];
  const rev = section('revenue', 'Revenue', rows), exp = section('expenses', 'Expenses', rows);
  const net = rev.map((v, i) => v - exp[i]!);
  rows.push({ kind: 'net', cells: ['Net profit', ...net, net.reduce((a, b) => a + b, 0)] });
  const unc = pnls.reduce((n, p) => n + p.uncategorised.count, 0);
  return {
    title: by === 'month' ? 'Profit and loss by month' : 'Quarterly profit and loss summary',
    sub: `${range.from} to ${range.to}, ${basis} basis`,
    columns: [{ label: '' }, ...periods.map((p) => ({ label: p.label, money: true })), { label: 'Total', money: true }],
    rows,
    notes: [basis === 'cash' ? 'Cash basis: booking money is counted when it was received.' : 'Booking income is counted on the day the session is played.', ...(unc ? [`${unc} bank transactions in this period have no category yet, so the profit is not complete.`] : [])],
  };
}

// ---------------------------------------------------------------- what customers owe

interface OweRow { id: string; ref: string; date: string; customer_name: string; customer_phone: string | null; ground_name: string; total_paise: number; paid_paise: number; status: string; end_at: number }

/** Played sessions (and no-shows) with money still unpaid. Matches the "Booking balances owed by customers" line on the balance sheet. */
export function customerBalances(ownerId: string, asOf: string, view: 'summary' | 'detail'): TableReport {
  const t = now();
  const rows = many<OweRow>(
    `SELECT b.id, b.ref, b.date, u.name AS customer_name, u.phone AS customer_phone, g.name AS ground_name, b.total_paise, b.paid_paise, b.status, b.end_at
       FROM bookings b JOIN users u ON u.id = b.customer_id JOIN grounds g ON g.id = b.ground_id
      WHERE b.owner_id = ? AND b.status IN ('confirmed','completed') AND b.end_at <= ? AND b.date <= ? AND b.total_paise > b.paid_paise
      ORDER BY b.date, b.ref`, ownerId, t, asOf);
  const ageDays = (d: string) => Math.max(0, Math.round((Date.parse(asOf + 'T00:00:00Z') - Date.parse(d + 'T00:00:00Z')) / 86400000));
  const bucket = (d: string) => { const a = ageDays(d); return a <= 30 ? 0 : a <= 60 ? 1 : a <= 90 ? 2 : 3; };
  const notes = ['Counts sessions already played where the customer has not paid in full. Money for sessions still to come is not listed here; it is held as an advance.'];
  if (view === 'detail') {
    const out: TableRow[] = rows.map((r) => ({ kind: 'row', cells: [istLabel(r.date), r.ref, r.customer_name, formatPhone(r.customer_phone), r.ground_name, r.total_paise, r.paid_paise, r.total_paise - r.paid_paise, ageDays(r.date)] }));
    const tot = rows.reduce((s, r) => s + r.total_paise - r.paid_paise, 0);
    out.push({ kind: 'sub', cells: ['Total owed', '', '', '', '', rows.reduce((s, r) => s + r.total_paise, 0), rows.reduce((s, r) => s + r.paid_paise, 0), tot, null] });
    return { title: 'Customer balance detail', sub: `As of ${asOf}`, columns: [{ label: 'Session' }, { label: 'Ref' }, { label: 'Customer' }, { label: 'Phone' }, { label: 'Ground' }, { label: 'Total', money: true }, { label: 'Paid', money: true }, { label: 'Owed', money: true }, { label: 'Days' }], rows: out, notes };
  }
  const by = new Map<string, { name: string; phone: string; n: number; b: number[] }>();
  for (const r of rows) {
    const key = `${r.customer_name}|${r.customer_phone ?? ''}`;
    const x = by.get(key) ?? { name: r.customer_name, phone: formatPhone(r.customer_phone), n: 0, b: [0, 0, 0, 0] };
    x.n++; x.b[bucket(r.date)]! += r.total_paise - r.paid_paise; by.set(key, x);
  }
  const list = [...by.values()].sort((a, b) => b.b.reduce((s, v) => s + v, 0) - a.b.reduce((s, v) => s + v, 0));
  const out: TableRow[] = list.map((x) => ({ kind: 'row', cells: [x.name, x.phone, x.n, ...x.b, x.b.reduce((s, v) => s + v, 0)] }));
  const sums = [0, 1, 2, 3].map((i) => list.reduce((s, x) => s + x.b[i]!, 0));
  out.push({ kind: 'sub', cells: ['Total', '', list.reduce((s, x) => s + x.n, 0), ...sums, sums.reduce((a, b) => a + b, 0)] });
  return { title: 'Customer balance summary (aging)', sub: `As of ${asOf}`, columns: [{ label: 'Customer' }, { label: 'Phone' }, { label: 'Sessions' }, { label: '0–30 days', money: true }, { label: '31–60 days', money: true }, { label: '61–90 days', money: true }, { label: 'Over 90 days', money: true }, { label: 'Total owed', money: true }], rows: out, notes };
}
const istLabel = (d: string) => d;

// ---------------------------------------------------------------- audit log

export function auditReport(ownerId: string, range: DateRange, limit = 500): TableReport {
  const from = Date.parse(range.from + 'T00:00:00+05:30'), to = Date.parse(range.to + 'T23:59:59.999+05:30');
  const rows = many<{ at: number; actor_role: string | null; name: string | null; action: string; entity: string; entity_id: string | null; detail: string | null }>(
    `SELECT a.at, a.actor_role, u.name, a.action, a.entity, a.entity_id, a.detail FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.owner_id = ? AND a.at BETWEEN ? AND ? ORDER BY a.at DESC, a.id DESC LIMIT ?`, ownerId, from, to, limit);
  const when = (ms: number) => new Date(ms + 330 * 60_000).toISOString().replace('T', ' ').slice(0, 16);
  return {
    title: 'Audit log', sub: `${range.from} to ${range.to}`,
    columns: [{ label: 'When (IST)' }, { label: 'Who' }, { label: 'Action' }, { label: 'Item' }, { label: 'Details' }],
    rows: rows.map((r) => ({ kind: 'row', cells: [when(r.at), r.name ?? r.actor_role ?? 'System', r.action, `${r.entity}${r.entity_id ? ' ' + r.entity_id : ''}`, (r.detail ?? '').slice(0, 200)] })),
    notes: rows.length >= limit ? [`Showing the latest ${limit}. Narrow the dates to see older entries.`] : [],
  };
}

// ---------------------------------------------------------------- download

export function tableSheets(business: string, r: TableReport): SheetSpec[] {
  const head = (l: string): Cell => ({ v: l, s: 'header' });
  const rows: Cell[][] = [[{ v: `${business}: ${r.title}`, s: 'title' }], [{ v: r.sub, s: 'note' }], [], r.columns.map((c) => head(c.label))];
  for (const x of r.rows) {
    rows.push(x.cells.map((v, i): Cell => {
      const money = r.columns[i]?.money && typeof v === 'number';
      if (money) return { v: (v as number) / 100, s: x.kind === 'row' ? 'money' : 'moneyBold' };
      return x.kind === 'row' || v === null ? v : { v, s: 'bold' };
    }));
  }
  if (r.notes.length) { rows.push([]); for (const n of r.notes) rows.push([{ v: n, s: 'note' }]); }
  return [{ name: r.title.slice(0, 28), rows, widths: r.columns.map((c, i) => (i === 0 ? 40 : c.money ? 16 : 18)), freezeRows: 4 }];
}
export const _today = () => istDate(now());
