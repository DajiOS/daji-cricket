import { writeXlsx, type Cell, type SheetSpec } from './xlsx.ts';
import { toCsv } from './csv.ts';
import type { BalanceSheet, LedgerEntry, Pnl, TrialRow } from './statements.ts';
import type { FutureSchedule, PastSchedule } from './schedule.ts';
import type { AssetOut, BudgetReport, CashFlow, GstSummary } from './plus.ts';

// Downloads of the Reports tab, as an Excel workbook (with live totals an accountant can check) or a CSV.
// Money is written in rupees. Every figure on the screen is in the file; nothing is recalculated differently.

const rs = (paise: number): number => paise / 100;
const money = (paise: number): Cell => ({ v: rs(paise), s: 'money' });
const bold = (paise: number, f?: string): Cell => ({ v: rs(paise), s: 'moneyBold', ...(f ? { f } : {}) });
const when = (ms: number): string => new Date(ms + 330 * 60_000).toISOString().replace('T', ' ').slice(0, 16) + ' IST';
const head = (...labels: string[]): Cell[] => labels.map((l) => ({ v: l, s: 'header' as const }));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const niceDate = (d: string): string => `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
const span = (r: { from: string; to: string }): string => (r.from === r.to ? niceDate(r.from) : `${niceDate(r.from)} to ${niceDate(r.to)}`);

class Sheet {
  rows: Cell[][] = [];
  /** The 1-based row number the next pushed row will have (for formulas). */
  get next(): number { return this.rows.length + 1; }
  add(...cells: Cell[]): number { this.rows.push(cells); return this.rows.length; }
  blank(): void { this.rows.push([]); }
}

const title = (s: Sheet, business: string, what: string, sub: string): void => {
  s.add({ v: `${business}: ${what}`, s: 'title' });
  s.add({ v: sub, s: 'note' });
  s.blank();
};

// ------------------------------------------------------------------ profit and loss

export function pnlSheets(business: string, p: Pnl): SheetSpec[] {
  const s = new Sheet();
  title(s, business, 'Profit and loss', `${span(p.range)} · ${p.basis === 'cash' ? 'cash basis' : 'accrual basis'}`);
  const cmp = !!p.previous;
  s.add(...head('', 'Amount (₹)', ...(cmp ? [`Before: ${span(p.previous!.range)}`, 'Change'] : [])));
  const section = (name: string, sec: Pnl['revenue']): number => {
    s.add({ v: name, s: 'bold' });
    const groupTotals: number[] = [];
    for (const g of sec.groups) {
      s.add({ v: g.name, s: 'bold' });
      const first = s.next;
      for (const r of g.rows) {
        const row = s.next;
        s.add(`  ${r.name}`, money(r.paise), ...(cmp ? [money(r.previousPaise ?? 0), { v: rs(r.paise - (r.previousPaise ?? 0)), f: `B${row}-C${row}`, s: 'money' as const }] : []));
      }
      const last = s.next - 1;
      const tot = s.next;
      groupTotals.push(tot);
      s.add(`Total ${g.name.toLowerCase()}`, bold(g.totalPaise, `SUM(B${first}:B${last})`), ...(cmp ? [bold(g.previousTotalPaise ?? 0, `SUM(C${first}:C${last})`), bold(g.totalPaise - (g.previousTotalPaise ?? 0), `B${tot}-C${tot}`)] : []));
    }
    const row = s.next;
    const sumOf = (col: string) => (groupTotals.length ? groupTotals.map((r) => `${col}${r}`).join('+') : '0');
    s.add({ v: `Total ${name.toLowerCase()}`, s: 'bold' }, bold(sec.totalPaise, sumOf('B')), ...(cmp ? [bold(sec.previousTotalPaise ?? 0, sumOf('C')), bold(sec.totalPaise - (sec.previousTotalPaise ?? 0), `B${row}-C${row}`)] : []));
    s.blank();
    return row;
  };
  const rev = section('Revenue', p.revenue);
  const exp = section('Expenses', p.expenses);
  const net = s.next;
  s.add({ v: 'Net profit', s: 'bold' }, bold(p.netProfitPaise, `B${rev}-B${exp}`), ...(cmp ? [bold(p.previousNetProfitPaise ?? 0, `C${rev}-C${exp}`), bold(p.netProfitPaise - (p.previousNetProfitPaise ?? 0), `B${net}-C${net}`)] : []));
  s.add('Profit margin', p.marginPercent === null ? 'n/a' : { v: p.marginPercent / 100, s: 'percent' });
  s.blank();
  for (const n of p.notes) s.add({ v: n, s: 'note' });
  return [{ name: 'Profit and loss', rows: s.rows, widths: [46, 16, 24, 16], freezeRows: 4 }];
}

// ------------------------------------------------------------------ balance sheet

export function balanceSheetSheets(business: string, b: BalanceSheet): SheetSpec[] {
  const s = new Sheet();
  title(s, business, 'Balance sheet', `As at ${niceDate(b.asOf)}`);
  s.add(...head('', 'Amount (₹)'));
  const side = (name: string, side: BalanceSheet['assets']): number => {
    s.add({ v: name, s: 'bold' });
    const totals: number[] = [];
    for (const g of side.groups) {
      s.add({ v: g.name, s: 'bold' });
      const first = s.next;
      for (const r of g.rows) s.add(`  ${r.name}`, money(r.paise));
      const last = s.next - 1;
      totals.push(s.next);
      s.add(`Total ${g.name.toLowerCase()}`, bold(g.totalPaise, last >= first ? `SUM(B${first}:B${last})` : '0'));
    }
    const row = s.next;
    s.add({ v: `Total ${name.toLowerCase()}`, s: 'bold' }, bold(side.totalPaise, totals.length ? totals.map((r) => `B${r}`).join('+') : '0'));
    s.blank();
    return row;
  };
  const a = side('Assets', b.assets);
  const l = side('Liabilities', b.liabilities);
  const e = side('Equity', b.equity);
  s.add({ v: 'Assets less liabilities less equity (should be 0)', s: 'bold' }, bold(b.differencePaise, `B${a}-B${l}-B${e}`));
  s.blank();
  for (const n of b.notes) s.add({ v: n, s: 'note' });
  return [{ name: 'Balance sheet', rows: s.rows, widths: [60, 16], freezeRows: 4 }];
}

// ------------------------------------------------------------------ trial balance and account ledger

export function trialBalanceSheets(business: string, t: { asOf: string; rows: TrialRow[]; totalDebitPaise: number; totalCreditPaise: number }): SheetSpec[] {
  const s = new Sheet();
  title(s, business, 'Trial balance', `As at ${niceDate(t.asOf)}`);
  s.add(...head('Account', 'Type', 'Debit (₹)', 'Credit (₹)'));
  const first = s.next;
  for (const r of t.rows) s.add(r.name, r.type, r.debitPaise ? money(r.debitPaise) : null, r.creditPaise ? money(r.creditPaise) : null);
  const last = s.next - 1;
  s.add({ v: 'Total', s: 'bold' }, null, bold(t.totalDebitPaise, last >= first ? `SUM(C${first}:C${last})` : '0'), bold(t.totalCreditPaise, last >= first ? `SUM(D${first}:D${last})` : '0'));
  return [{ name: 'Trial balance', rows: s.rows, widths: [52, 12, 16, 16], freezeRows: 4 }];
}

export function ledgerSheets(business: string, l: { account: { name: string; type: string }; openingPaise: number; entries: LedgerEntry[]; closingPaise: number }, range: { from: string; to: string }): SheetSpec[] {
  const s = new Sheet();
  title(s, business, `Account: ${l.account.name}`, span(range));
  s.add(...head('Date', 'Source', 'Reference', 'Debit (₹)', 'Credit (₹)', 'Balance (₹)'));
  s.add('', 'Opening balance', '', null, null, money(l.openingPaise));
  for (const e of l.entries) s.add({ v: e.date, s: 'quote' }, e.src, e.ref, e.debitPaise ? money(e.debitPaise) : null, e.creditPaise ? money(e.creditPaise) : null, money(e.balancePaise));
  s.add('', { v: 'Closing balance', s: 'bold' }, '', null, null, bold(l.closingPaise));
  return [{ name: 'Account ledger', rows: s.rows, widths: [12, 12, 28, 16, 16, 16], freezeRows: 4 }];
}

// ------------------------------------------------------------------ schedules

const KIND: Record<string, string> = {
  booked: 'Booked', in_progress: 'In progress', played: 'Played', no_show: 'No-show', cancelled_in_time: 'Cancelled in time', cancelled_late: 'Cancelled late',
};

export function futureSheets(business: string, f: FutureSchedule, rows: FutureSchedule['items']): SheetSpec[] {
  const sum = new Sheet();
  title(sum, business, 'Future schedule', `${span(f.range)} · generated ${when(f.asOf)}`);
  sum.add(...head('', 'Value'));
  sum.add('Confirmed bookings', f.summary.bookings);
  sum.add('Slots', f.summary.slots);
  sum.add('Value of bookings (₹)', money(f.summary.valuePaise));
  sum.add('  of which GST (₹)', money(f.summary.gstPaise));
  sum.add('Paid so far (₹)', money(f.summary.paidPaise));
  sum.add('Still to collect (₹)', money(f.summary.duePaise));
  sum.add('Sessions in progress now', f.summary.inProgress);
  sum.blank();
  sum.add({ v: 'Waiting for payment (not confirmed)', s: 'bold' });
  sum.add('Unpaid holds', f.holds.count);
  sum.add('Value of unpaid holds (₹)', money(f.holds.valuePaise));
  sum.add('Paid after the hold lapsed, needs a decision', f.holds.needsReview);
  sum.blank();
  sum.add({ v: 'Owed to customers right now', s: 'bold' });
  sum.add('Money held for sessions not yet played (₹)', money(f.advancesHeldPaise));
  sum.add('Account credit outstanding (₹)', money(f.credits.outstandingPaise));
  sum.add('  of which expires within 30 days (₹)', money(f.credits.expiringWithin30DaysPaise));
  sum.add('Refunds still to send (₹)', money(f.refundsOwed.paise));
  sum.blank();
  for (const n of f.notes) sum.add({ v: n, s: 'note' });

  const per = new Sheet();
  per.add(...head('Period', 'From', 'To', 'Bookings', 'Slots', 'Value (₹)', 'Paid (₹)', 'To collect (₹)'));
  const first = per.next;
  for (const b of f.buckets) per.add(b.label, { v: b.from, s: 'quote' }, { v: b.to, s: 'quote' }, b.bookings, b.slots, money(b.valuePaise), money(b.paidPaise), money(b.duePaise));
  const last = per.next - 1;
  if (last >= first) per.add({ v: 'Total', s: 'bold' }, '', '', { v: f.summary.bookings, f: `SUM(D${first}:D${last})`, s: 'bold' }, { v: f.summary.slots, f: `SUM(E${first}:E${last})`, s: 'bold' },
    bold(f.summary.valuePaise, `SUM(F${first}:F${last})`), bold(f.summary.paidPaise, `SUM(G${first}:G${last})`), bold(f.summary.duePaise, `SUM(H${first}:H${last})`));

  const g = new Sheet();
  g.add(...head('Ground', 'Bookings', 'Slots', 'Value (₹)', 'Paid (₹)', 'To collect (₹)'));
  for (const x of f.byGround) g.add(x.groundName, x.bookings, x.slots, money(x.valuePaise), money(x.paidPaise), money(x.duePaise));

  const d = new Sheet();
  d.add(...head('Date', 'Start', 'End', 'Ground', 'Reference', 'Customer', 'Slots', 'Status', 'Value (₹)', 'Paid (₹)', 'To collect (₹)'));
  for (const r of rows) d.add({ v: r.date, s: 'quote' }, r.startTime, r.endTime, r.groundName, r.ref, r.customerName, r.slots, KIND[r.kind] ?? r.kind, money(r.totalPaise), money(r.paidPaise), money(r.duePaise));

  return [
    { name: 'Summary', rows: sum.rows, widths: [48, 18] },
    { name: 'By period', rows: per.rows, widths: [20, 12, 12, 10, 8, 14, 14, 14], freezeRows: 1 },
    { name: 'By ground', rows: g.rows, widths: [30, 10, 8, 14, 14, 14], freezeRows: 1 },
    { name: 'Bookings', rows: d.rows, widths: [12, 8, 8, 26, 12, 24, 7, 14, 14, 14, 14], freezeRows: 1 },
  ];
}

export function pastSheets(business: string, p: PastSchedule, rows: PastSchedule['items']): SheetSpec[] {
  const s = p.summary;
  const sum = new Sheet();
  title(sum, business, 'Past schedule', `${span(p.range)} · generated ${when(p.asOf)}`);
  sum.add(...head('', 'Value'));
  sum.add({ v: 'Sessions played', s: 'bold' });
  sum.add('Sessions', s.sessions);
  sum.add('Slots', s.slots);
  sum.add('Price of sessions played (₹)', money(s.valuePaise));
  sum.add('  of which GST (₹)', money(s.gstPaise));
  sum.add('Income, before GST (₹)', money(s.incomePaise));
  sum.add('Collected (₹)', money(s.collectedPaise));
  sum.add('Not collected yet (₹)', money(s.outstandingPaise));
  sum.blank();
  sum.add({ v: 'No-shows and cancellations', s: 'bold' });
  sum.add('No-shows', s.noShows);
  sum.add('Advance kept from no-shows (₹)', money(s.noShowKeptPaise));
  sum.add('Cancelled in time', s.cancelledInTime);
  sum.add('Cancelled late', s.cancelledLate);
  sum.add('Refunded on cancellation (₹)', money(s.cancelRefundedPaise));
  sum.add('Turned into account credit (₹)', money(s.cancelCreditedPaise));
  sum.add('Advance kept from late cancellations (₹)', money(s.cancelKeptPaise));
  sum.blank();
  sum.add({ v: 'Earned in the period (₹)', s: 'bold' }, bold(s.earnedPaise));
  sum.add('Credit that expired unused (₹)', money(s.expiredCreditPaise));
  sum.blank();
  for (const n of p.notes) sum.add({ v: n, s: 'note' });

  const per = new Sheet();
  per.add(...head('Period', 'From', 'To', 'Sessions', 'Slots', 'Price (₹)', 'GST (₹)', 'Income (₹)', 'Collected (₹)', 'Not collected (₹)', 'No-shows', 'Kept: no-shows (₹)', 'Cancelled', 'Refunded (₹)', 'Credit given (₹)', 'Kept: late cancels (₹)', 'Earned (₹)'));
  for (const b of p.buckets) per.add(b.label, { v: b.from, s: 'quote' }, { v: b.to, s: 'quote' }, b.sessions, b.slots, money(b.valuePaise), money(b.gstPaise), money(b.incomePaise), money(b.collectedPaise), money(b.outstandingPaise),
    b.noShows, money(b.noShowKeptPaise), b.cancellations, money(b.cancelRefundedPaise), money(b.cancelCreditedPaise), money(b.cancelKeptPaise), money(b.earnedPaise));

  const g = new Sheet();
  g.add(...head('Ground', 'Sessions', 'Slots', 'Price (₹)', 'Income (₹)', 'No-shows', 'Cancelled', 'Earned (₹)'));
  for (const x of p.byGround) g.add(x.groundName, x.sessions, x.slots, money(x.valuePaise), money(x.incomePaise), x.noShows, x.cancellations, money(x.earnedPaise));

  const d = new Sheet();
  d.add(...head('Date', 'Start', 'End', 'Ground', 'Reference', 'Customer', 'Slots', 'What happened', 'Price (₹)', 'Paid (₹)', 'Not collected (₹)', 'Earned (₹)', 'Kept (₹)', 'Refunded (₹)', 'Credit given (₹)'));
  for (const r of rows) d.add({ v: r.date, s: 'quote' }, r.startTime, r.endTime, r.groundName, r.ref, r.customerName, r.slots, KIND[r.kind] ?? r.kind, money(r.totalPaise), money(r.paidPaise), money(r.duePaise),
    r.earnedPaise === undefined ? null : money(r.earnedPaise), r.keptPaise === undefined ? null : money(r.keptPaise), r.refundedPaise === undefined ? null : money(r.refundedPaise), r.creditedPaise === undefined ? null : money(r.creditedPaise));

  return [
    { name: 'Summary', rows: sum.rows, widths: [48, 18] },
    { name: 'By period', rows: per.rows, widths: [20, 12, 12, 9, 7, 13, 11, 13, 13, 14, 9, 15, 10, 13, 14, 16, 13], freezeRows: 1 },
    { name: 'By ground', rows: g.rows, widths: [30, 9, 7, 13, 13, 9, 10, 13], freezeRows: 1 },
    { name: 'Sessions', rows: d.rows, widths: [12, 8, 8, 26, 12, 24, 7, 18, 13, 13, 15, 13, 11, 13, 14], freezeRows: 1 },
  ];
}

// ------------------------------------------------------------------ cash flow, budget, GST, assets

export function cashFlowSheets(business: string, c: CashFlow): SheetSpec[] {
  const s = new Sheet();
  title(s, business, 'Cash flow statement', span(c.range));
  s.add(...head('', 'Amount (₹)'));
  s.add({ v: 'Opening cash and bank', s: 'bold' }, bold(c.openingPaise));
  const block = (label: string, b: CashFlow['operating']) => {
    s.add({ v: label, s: 'bold' }, null);
    const first = s.next;
    for (const r of b.rows) s.add(`  ${r.name}`, money(r.paise));
    const last = s.next - 1;
    s.add({ v: `Net cash from ${label.toLowerCase()}`, s: 'bold' }, bold(b.totalPaise, last >= first ? `SUM(B${first}:B${last})` : '0'));
  };
  block('Operating activities', c.operating); block('Investing activities', c.investing); block('Financing activities', c.financing);
  if (c.betweenAccountsPaise !== 0) s.add('Moved between your own accounts', money(c.betweenAccountsPaise));
  if (c.newAccountsOpeningPaise !== 0) s.add('Opening balances of accounts added in this period', money(c.newAccountsOpeningPaise));
  s.add({ v: 'Net change in cash and bank', s: 'bold' }, bold(c.netChangePaise));
  s.add({ v: 'Closing cash and bank', s: 'bold' }, bold(c.closingPaise));
  s.blank(); s.add({ v: c.ties ? 'Opening plus the movements equals the closing balance on the balance sheet.' : 'Opening plus the movements does NOT equal the closing balance: check for entries dated inside this period.', s: 'note' });
  return [{ name: 'Cash flow', rows: s.rows, widths: [56, 18], freezeRows: 4 }];
}

export function budgetSheets(business: string, b: BudgetReport): SheetSpec[] {
  const s = new Sheet();
  title(s, business, 'Budget against actual', `${span(b.range)} (${b.months} month${b.months === 1 ? '' : 's'} of budget)`);
  s.add(...head('Line', 'Budget (₹)', 'Actual (₹)', 'Difference (₹)', '% used'));
  const part = (label: string, rows: BudgetReport['income']) => {
    s.add({ v: label, s: 'bold' }, null, null, null, null);
    for (const r of rows) s.add(`  ${r.name}`, money(r.budgetPaise), money(r.actualPaise), money(r.variancePaise), r.percentUsed === null ? null : r.percentUsed / 100);
  };
  part('Income', b.income); part('Expenses', b.expenses);
  s.blank();
  s.add({ v: 'Profit', s: 'bold' }, bold(b.totals.budgetProfitPaise), bold(b.totals.actualProfitPaise), bold(b.totals.actualProfitPaise - b.totals.budgetProfitPaise));
  s.blank(); s.add({ v: 'Difference is shown so that a positive figure is good: income above budget, or spending below budget.', s: 'note' });
  return [{ name: 'Budget', rows: s.rows, widths: [48, 16, 16, 16, 10], freezeRows: 4 }];
}

export function gstSheets(business: string, g: GstSummary): SheetSpec[] {
  const s = new Sheet();
  title(s, business, 'GST summary', `${span(g.range)}, prices include ${g.percent}% GST`);
  s.add(...head('Month', 'Taxable value (₹)', 'GST collected (₹)', 'GST paid (₹)', 'Net (₹)'));
  const first = s.next;
  for (const r of g.rows) s.add(r.month, money(r.taxableValuePaise), money(r.gstCollectedPaise), money(r.gstPaidPaise), money(r.netPaise));
  const last = s.next - 1;
  const f = (c: string) => (last >= first ? `SUM(${c}${first}:${c}${last})` : '0');
  s.add({ v: 'Total', s: 'bold' }, bold(g.totals.taxableValuePaise, f('B')), bold(g.totals.gstCollectedPaise, f('C')), bold(g.totals.gstPaidPaise, f('D')), bold(g.totals.netPaise, f('E')));
  s.blank(); s.add('GST still payable at the end of the period', money(g.payableAtEndPaise));
  for (const n of g.notes) s.add({ v: n, s: 'note' });
  return [{ name: 'GST', rows: s.rows, widths: [14, 20, 20, 16, 16], freezeRows: 4 }];
}

export function assetSheets(business: string, a: { items: AssetOut[]; totals: { costPaise: number; depreciatedPaise: number; bookValuePaise: number } }): SheetSpec[] {
  const s = new Sheet();
  title(s, business, 'Fixed asset register', `As at ${niceDate(new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10))}`);
  s.add(...head('Asset', 'Bought', 'Life (months)', 'Cost (₹)', 'Depreciated (₹)', 'Book value (₹)', 'Status'));
  for (const x of a.items) s.add(x.name, niceDate(x.purchaseDate), x.lifeMonths, money(x.costPaise), money(x.depreciatedPaise), money(x.bookValuePaise), x.status);
  s.add({ v: 'Total (not disposed)', s: 'bold' }, null, null, bold(a.totals.costPaise), bold(a.totals.depreciatedPaise), bold(a.totals.bookValuePaise), null);
  return [{ name: 'Assets', rows: s.rows, widths: [34, 14, 12, 16, 16, 16, 18], freezeRows: 4 }];
}

// ------------------------------------------------------------------ output

export function xlsxBuffer(sheets: SheetSpec[], business: string): Buffer {
  return writeXlsx(sheets, { creator: business });
}

/** The first sheet as a CSV (the headline report). Money cells are plain rupee numbers; formulas are written as their values. */
export function csvText(sheets: SheetSpec[], which = 0): string {
  const sheet = sheets[which]!;
  const flat = (c: Cell): string | number | null => (c === null || c === undefined ? null : typeof c === 'object' ? c.v ?? null : c);
  return toCsv(sheet.rows.map((r) => r.map(flat)));
}
