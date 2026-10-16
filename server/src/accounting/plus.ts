import { many, one, registerSchema, run, tx } from '../db.ts';
import { assertAccountActive } from './catprefs.ts';
import { now } from '../clock.ts';
import { audit, type Actor } from '../audit.ts';
import { HttpError, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import { Validator } from '../input.ts';
import { istDate, monthRange } from '../time.ts';
import { directory, isBankCode } from './chart.ts';
import { ledgerLines, sumBy } from './ledger.ts';
import { profitAndLoss, type DateRange } from './statements.ts';
import { addTransaction, assertOpen, createJournal, lockedMonths } from './store.ts';

// The fuller books: cash flow statement, budgets, transfers between accounts, a fixed-asset register with depreciation,
// and a GST summary. Like everything else, they are worked out from (or written into) the same records, so they tie to
// the profit and loss and the balance sheet. Money is integer paise.

registerSchema('accounting-plus-1', `
CREATE TABLE acct_budgets (
  owner_id TEXT NOT NULL REFERENCES users(id),
  code TEXT NOT NULL,
  monthly_paise INTEGER NOT NULL CHECK (monthly_paise > 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, code)
);
CREATE TABLE acct_assets (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  cost_paise INTEGER NOT NULL CHECK (cost_paise > 0),
  salvage_paise INTEGER NOT NULL DEFAULT 0,
  purchase_date TEXT NOT NULL,
  life_months INTEGER NOT NULL CHECK (life_months BETWEEN 1 AND 600),
  disposed_on TEXT,
  note TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  deleted_at INTEGER
);
CREATE INDEX ix_acct_assets_owner ON acct_assets(owner_id);
CREATE TABLE acct_asset_dep (
  asset_id TEXT NOT NULL REFERENCES acct_assets(id),
  month TEXT NOT NULL,
  amount_paise INTEGER NOT NULL,
  journal_id TEXT,
  PRIMARY KEY (asset_id, month)
);
INSERT OR IGNORE INTO acct_categories(id, owner_id, code, name, kind, group_name, sort, created_at, updated_at)
  VALUES ('cat_asset_purchase', NULL, 'asset_purchase', 'Equipment or asset bought (capital)', 'transfer', 'Not in profit & loss', 80, 0, 0);
`);

const today = (): string => istDate(now());

// ================================================================== cash flow

export interface FlowRow { code: string; name: string; paise: number }
export interface CashFlow {
  range: DateRange;
  openingPaise: number;
  operating: { rows: FlowRow[]; totalPaise: number };
  investing: { rows: FlowRow[]; totalPaise: number };
  financing: { rows: FlowRow[]; totalPaise: number };
  /** Money moved between your own accounts: nets to zero when both sides are in the books. */
  betweenAccountsPaise: number;
  newAccountsOpeningPaise: number;
  netChangePaise: number;
  closingPaise: number;
  /** Opening plus the movements equals the closing balance of the bank and cash accounts on the balance sheet. */
  ties: boolean;
  notes: string[];
}

const FINANCING = new Set(['owner_capital', 'owner_drawings', 'loan']);

export function cashFlow(ownerId: string, range: DateRange): CashFlow {
  const dir = directory(ownerId);
  const lines = ledgerLines(ownerId, range.to);
  const cash = (l: { account: string }) => isBankCode(l.account);
  const bal = (pred: (d: string) => boolean) => lines.filter((l) => cash(l) && pred(l.date)).reduce((s, l) => s + l.debit - l.credit, 0);
  const opening = bal((d) => d < range.from);
  const closing = bal(() => true);
  const newAccountsOpening = lines.filter((l) => cash(l) && l.src === 'opening' && l.date >= range.from).reduce((s, l) => s + l.debit - l.credit, 0);

  const rows = many<{ amount: number; kind: string | null; code: string | null; name: string | null }>(
    `SELECT t.amount_paise amount, c.kind, c.code, c.name FROM acct_transactions t
     JOIN acct_accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
     LEFT JOIN acct_categories c ON c.id = t.category_id
     WHERE t.owner_id = ? AND t.deleted_at IS NULL AND t.txn_date BETWEEN ? AND ?`, ownerId, range.from, range.to);

  const op = new Map<string, FlowRow>(), inv = new Map<string, FlowRow>(), fin = new Map<string, FlowRow>();
  let between = 0;
  const add = (m: Map<string, FlowRow>, code: string, name: string, paise: number) => { const r = m.get(code) ?? { code, name, paise: 0 }; r.paise += paise; m.set(code, r); };
  for (const t of rows) {
    if (!t.kind || !t.code) { add(op, 'uncategorised', 'Not yet categorised', t.amount); continue; }
    if (t.kind === 'transfer' && t.code === 'internal_transfer') { between += t.amount; continue; }
    if (t.kind === 'transfer' && t.code === 'asset_purchase') { add(inv, t.code, t.name ?? t.code, t.amount); continue; }
    if (t.kind === 'transfer' && FINANCING.has(t.code)) { add(fin, t.code, t.name ?? t.code, t.amount); continue; }
    if (t.kind === 'income') { add(op, `inc:${t.code}`, dir.get(`inc:${t.code}`)?.name ?? t.name ?? t.code, t.amount); continue; }
    if (t.kind === 'expense') { add(op, `exp:${t.code}`, dir.get(`exp:${t.code}`)?.name ?? t.name ?? t.code, t.amount); continue; }
    if (t.kind === 'booking_receipt') { add(op, 'booking_receipts', 'Booking money received in the bank', t.amount); continue; }
    if (t.kind === 'ignore') { add(op, 'ignored', 'Marked as not a business transaction', t.amount); continue; }
    add(op, t.code, t.name ?? t.code, t.amount); // cash deposits, GST paid, customer refunds
  }
  const fmt = (m: Map<string, FlowRow>) => { const r = [...m.values()].filter((x) => x.paise !== 0).sort((a, b) => b.paise - a.paise); return { rows: r, totalPaise: r.reduce((s, x) => s + x.paise, 0) }; };
  const operating = fmt(op), investing = fmt(inv), financing = fmt(fin);
  const net = operating.totalPaise + investing.totalPaise + financing.totalPaise + between + newAccountsOpening;
  const ties = opening + net === closing;
  const notes = ['Built from the money that actually moved in your bank and cash accounts, grouped by the category you gave each transaction.'];
  if (op.get('uncategorised')) notes.push('Some transactions are not categorised yet; they are shown together under operating activities.');
  return { range, openingPaise: opening, operating, investing, financing, betweenAccountsPaise: between, newAccountsOpeningPaise: newAccountsOpening, netChangePaise: net, closingPaise: closing, ties, notes };
}

// ================================================================== budgets

export interface BudgetLine { code: string; name: string; type: 'income' | 'expense'; group: string; monthlyPaise: number }

export function listBudgets(ownerId: string): { items: BudgetLine[]; available: { code: string; name: string; type: string; group: string }[] } {
  const dir = directory(ownerId);
  const items = many<{ code: string; monthly_paise: number }>('SELECT code, monthly_paise FROM acct_budgets WHERE owner_id = ?', ownerId)
    .map((b) => ({ b, a: dir.get(b.code) })).filter((x) => x.a && (x.a.type === 'income' || x.a.type === 'expense'))
    .map((x): BudgetLine => ({ code: x.b.code, name: x.a!.name, type: x.a!.type as 'income' | 'expense', group: x.a!.group, monthlyPaise: x.b.monthly_paise }))
    .sort((a, b) => a.type.localeCompare(b.type) || a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  const available = [...dir.values()].filter((a) => a.type === 'income' || a.type === 'expense').sort((a, b) => a.type.localeCompare(b.type) || a.group.localeCompare(b.group) || a.sort - b.sort)
    .map((a) => ({ code: a.code, name: a.name, type: a.type, group: a.group }));
  return { items, available };
}

/** Sets the monthly budget for each line sent; a line with 0 removes its budget. */
export function setBudgets(ownerId: string, actor: Actor, body: unknown): ReturnType<typeof listBudgets> {
  const v = new Validator(body);
  const raw = v.src.items;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 100) v.fail('items', 'Send between 1 and 100 budget lines');
  v.done();
  const dir = directory(ownerId);
  const out: { code: string; paise: number }[] = [];
  (raw as unknown[]).forEach((x, i) => {
    const lv = new Validator(x);
    const code = lv.str('code', { required: true, max: 80 });
    const paise = lv.int('monthlyPaise', { required: true, min: 0, max: 100_000_000_000 });
    const a = code ? dir.get(code) : undefined;
    if (code && (!a || (a.type !== 'income' && a.type !== 'expense'))) lv.fail('code', 'Budgets are for income and expense lines only');
    for (const f of lv.fields) v.fail(`items[${i}].${f.field}`, f.message);
    out.push({ code: code ?? '', paise: paise ?? 0 });
  });
  v.done();
  const t = now();
  tx(() => {
    for (const b of out) {
      if (b.paise === 0) run('DELETE FROM acct_budgets WHERE owner_id = ? AND code = ?', ownerId, b.code);
      else run('INSERT INTO acct_budgets(owner_id, code, monthly_paise, updated_at) VALUES(?,?,?,?) ON CONFLICT(owner_id, code) DO UPDATE SET monthly_paise = excluded.monthly_paise, updated_at = excluded.updated_at', ownerId, b.code, b.paise, t);
    }
  });
  audit(actor, 'acct.budget.set', 'acct_budget', null, { lines: out.length }, ownerId);
  return listBudgets(ownerId);
}

export interface BudgetRow { code: string; name: string; type: 'income' | 'expense'; group: string; budgetPaise: number; actualPaise: number; variancePaise: number; percentUsed: number | null; status: 'ok' | 'over' | 'under' | 'unbudgeted' }
export interface BudgetReport { range: DateRange; months: number; income: BudgetRow[]; expenses: BudgetRow[]; totals: { budgetIncomePaise: number; actualIncomePaise: number; budgetExpensePaise: number; actualExpensePaise: number; budgetProfitPaise: number; actualProfitPaise: number }; notes: string[] }

/** How many months of budget a date range covers: each calendar month counts for the share of its days inside the range. */
export function monthsCovered(range: DateRange): number {
  let total = 0;
  let m = range.from.slice(0, 7);
  while (m <= range.to.slice(0, 7)) {
    const r = monthRange(m)!;
    const from = r.from < range.from ? range.from : r.from, to = r.to > range.to ? range.to : r.to;
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
    const all = (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000 + 1;
    total += days / all;
    const y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7));
    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  }
  return Math.round(total * 1000) / 1000;
}

export function budgetVsActual(ownerId: string, range: DateRange): BudgetReport {
  const months = monthsCovered(range);
  const budgets = new Map(listBudgets(ownerId).items.map((b) => [b.code, b]));
  const p = profitAndLoss(ownerId, range, { basis: 'accrual', compare: false });
  const actual = new Map<string, { name: string; group: string; type: 'income' | 'expense'; paise: number }>();
  for (const [type, sec] of [['income', p.revenue], ['expense', p.expenses]] as const) for (const g of sec.groups) for (const r of g.rows) actual.set(r.code, { name: r.name, group: g.name, type, paise: r.paise });
  const codes = new Set([...budgets.keys(), ...actual.keys()]);
  const rows: BudgetRow[] = [];
  for (const code of codes) {
    const b = budgets.get(code), a = actual.get(code);
    const type = (b?.type ?? a!.type) as 'income' | 'expense';
    const budgetPaise = b ? Math.round(b.monthlyPaise * months) : 0;
    const actualPaise = a?.paise ?? 0;
    const variancePaise = type === 'expense' ? budgetPaise - actualPaise : actualPaise - budgetPaise; // positive is good
    const status: BudgetRow['status'] = !b ? 'unbudgeted' : variancePaise < 0 ? (type === 'expense' ? 'over' : 'under') : 'ok';
    rows.push({ code, name: b?.name ?? a!.name, type, group: b?.group ?? a!.group, budgetPaise, actualPaise, variancePaise, percentUsed: budgetPaise > 0 ? Math.round((actualPaise / budgetPaise) * 1000) / 10 : null, status });
  }
  const order = (x: BudgetRow, y: BudgetRow) => x.group.localeCompare(y.group) || x.name.localeCompare(y.name);
  const income = rows.filter((r) => r.type === 'income').sort(order), expenses = rows.filter((r) => r.type === 'expense').sort(order);
  const sum = (l: BudgetRow[], k: 'budgetPaise' | 'actualPaise') => l.reduce((s, r) => s + r[k], 0);
  const totals = { budgetIncomePaise: sum(income, 'budgetPaise'), actualIncomePaise: sum(income, 'actualPaise'), budgetExpensePaise: sum(expenses, 'budgetPaise'), actualExpensePaise: sum(expenses, 'actualPaise'), budgetProfitPaise: 0, actualProfitPaise: 0 };
  totals.budgetProfitPaise = totals.budgetIncomePaise - totals.budgetExpensePaise; totals.actualProfitPaise = totals.actualIncomePaise - totals.actualExpensePaise;
  const notes = [`The budget for this period is ${months} month${months === 1 ? '' : 's'} of each monthly figure. Actuals come from the profit and loss on the accrual basis, so they match that report.`];
  if (!budgets.size) notes.push('No budget is set yet. Add monthly figures on the Budget tab.');
  return { range, months, income, expenses, totals, notes };
}

// ================================================================== transfers between your own accounts

/** Moves money between two of the owner's accounts as a matched pair of entries. They cancel out in the books. */
export function transfer(ownerId: string, actor: Actor, body: unknown): { reference: string; fromTransactionId: string; toTransactionId: string } {
  const v = new Validator(body);
  const from = v.str('fromAccountId', { required: true, max: 60 });
  const to = v.str('toAccountId', { required: true, max: 60 });
  const date = v.date('date', true);
  const amount = v.int('amountPaise', { required: true, min: 1, max: 100_000_000_000 });
  const note = v.str('note', { max: 200 });
  if (from && to && from === to) v.fail('toAccountId', 'Choose two different accounts');
  v.done();
  const nameOf = (id: string): string => one<{ name: string }>('SELECT name FROM acct_accounts WHERE id = ? AND owner_id = ? AND deleted_at IS NULL', id, ownerId)?.name ?? (() => { throw notFound('Account not found'); })();
  const fromName = nameOf(from!), toName = nameOf(to!);
  assertAccountActive(from!); assertAccountActive(to!);
  assertOpen(ownerId, date!);
  const ref = newId('trf').slice(0, 16);
  let a = '', b = '';
  tx(() => {
    a = addTransaction(ownerId, actor, { accountId: from, date, amountPaise: -amount!, description: `Transfer to ${toName}`, reference: ref, categoryId: 'cat_internal_transfer', note }).id;
    b = addTransaction(ownerId, actor, { accountId: to, date, amountPaise: amount, description: `Transfer from ${fromName}`, reference: ref, categoryId: 'cat_internal_transfer', note }).id;
  });
  audit(actor, 'acct.transfer', 'acct_transaction', a, { from, to, amountPaise: amount, reference: ref }, ownerId);
  return { reference: ref, fromTransactionId: a, toTransactionId: b };
}

// ================================================================== fixed assets and depreciation

export interface AssetOut {
  id: string; name: string; costPaise: number; salvagePaise: number; purchaseDate: string; lifeMonths: number; monthlyPaise: number; disposedOn: string | null; note: string | null;
  depreciatedPaise: number; bookValuePaise: number; monthsPosted: number; status: 'active' | 'fully depreciated' | 'disposed';
}
interface AssetRow { id: string; name: string; cost_paise: number; salvage_paise: number; purchase_date: string; life_months: number; disposed_on: string | null; note: string | null }

const monthAdd = (m: string, n: number): string => { const t = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
const monthly = (a: Pick<AssetRow, 'cost_paise' | 'salvage_paise' | 'life_months'>): number => Math.floor((a.cost_paise - a.salvage_paise) / a.life_months);
/** Straight line, by whole months from the month of purchase. The last month takes the rounding so the total is exact. */
function chargeFor(a: AssetRow, k: number): number {
  const base = monthly(a), total = a.cost_paise - a.salvage_paise;
  return k === a.life_months - 1 ? total - base * (a.life_months - 1) : base;
}

function toAsset(a: AssetRow): AssetOut {
  const dep = one<{ s: number | null; n: number }>('SELECT SUM(amount_paise) s, COUNT(*) n FROM acct_asset_dep WHERE asset_id = ?', a.id)!;
  const depreciated = dep.s ?? 0;
  return { id: a.id, name: a.name, costPaise: a.cost_paise, salvagePaise: a.salvage_paise, purchaseDate: a.purchase_date, lifeMonths: a.life_months, monthlyPaise: monthly(a), disposedOn: a.disposed_on, note: a.note,
    depreciatedPaise: depreciated, bookValuePaise: a.cost_paise - depreciated, monthsPosted: dep.n, status: a.disposed_on ? 'disposed' : depreciated >= a.cost_paise - a.salvage_paise ? 'fully depreciated' : 'active' };
}

export function listAssets(ownerId: string): { items: AssetOut[]; totals: { costPaise: number; depreciatedPaise: number; bookValuePaise: number } } {
  const items = many<AssetRow>('SELECT * FROM acct_assets WHERE owner_id = ? AND deleted_at IS NULL ORDER BY purchase_date DESC, name', ownerId).map(toAsset);
  const live = items.filter((a) => a.status !== 'disposed');
  return { items, totals: { costPaise: live.reduce((s, a) => s + a.costPaise, 0), depreciatedPaise: live.reduce((s, a) => s + a.depreciatedPaise, 0), bookValuePaise: live.reduce((s, a) => s + a.bookValuePaise, 0) } };
}

/**
 * Records an asset for depreciation. The purchase itself is NOT posted here: when you paid from a bank or cash account,
 * categorise that transaction as "Equipment or asset bought (capital)" and it lands in Equipment and fixed assets (cost).
 * If you contributed it, or bought it on credit, record a journal entry for the cost.
 */
export function addAsset(ownerId: string, actor: Actor, body: unknown): AssetOut {
  const v = new Validator(body);
  const name = v.str('name', { required: true, min: 2, max: 120 });
  const cost = v.int('costPaise', { required: true, min: 1, max: 100_000_000_000 });
  const salvage = v.int('salvagePaise', { min: 0, max: 100_000_000_000 }) ?? 0;
  const date = v.date('purchaseDate', true);
  const life = v.int('lifeMonths', { required: true, min: 1, max: 600 });
  const note = v.str('note', { max: 300 });
  if (cost !== undefined && salvage >= cost) v.fail('salvagePaise', 'Must be less than the cost');
  if (date && date > today()) v.fail('purchaseDate', 'Cannot be in the future');
  v.done();
  const id = newId('ast');
  run('INSERT INTO acct_assets(id, owner_id, name, cost_paise, salvage_paise, purchase_date, life_months, note, created_at, created_by) VALUES(?,?,?,?,?,?,?,?,?,?)', id, ownerId, name!, cost!, salvage, date!, life!, note ?? null, now(), actor.id);
  audit(actor, 'acct.asset.add', 'acct_asset', id, { name, costPaise: cost, lifeMonths: life }, ownerId);
  return toAsset(assetOr404(ownerId, id));
}

function assetOr404(ownerId: string, id: string): AssetRow {
  const a = one<AssetRow>('SELECT * FROM acct_assets WHERE id = ? AND owner_id = ? AND deleted_at IS NULL', id, ownerId);
  if (!a) throw notFound('Asset not found');
  return a;
}

/** Stops depreciation from the given date on (sold, scrapped or lost). Charges already posted stay. */
export function disposeAsset(ownerId: string, actor: Actor, id: string, body: unknown): AssetOut {
  const a = assetOr404(ownerId, id);
  const v = new Validator(body);
  const on = v.date('disposedOn', true);
  if (on && on < a.purchase_date) v.fail('disposedOn', 'Cannot be before the purchase date');
  v.done();
  run('UPDATE acct_assets SET disposed_on = ? WHERE id = ?', on!, id);
  audit(actor, 'acct.asset.dispose', 'acct_asset', id, { disposedOn: on }, ownerId);
  return toAsset(assetOr404(ownerId, id));
}

export function removeAsset(ownerId: string, actor: Actor, id: string): void {
  assetOr404(ownerId, id);
  if (one<{ n: number }>('SELECT COUNT(*) n FROM acct_asset_dep WHERE asset_id = ?', id)!.n > 0) throw new HttpError(409, 'HAS_DEPRECIATION', 'Depreciation has been posted for this asset. Mark it as disposed instead.');
  run('UPDATE acct_assets SET deleted_at = ? WHERE id = ?', now(), id);
  audit(actor, 'acct.asset.remove', 'acct_asset', id, {}, ownerId);
}

/**
 * Posts one journal entry per month that has ended and is not yet depreciated (debit Depreciation, credit Accumulated
 * depreciation), dated the last day of that month. Months that are signed off are skipped and reported.
 */
export function runDepreciation(ownerId: string | null, actor: Actor): { posted: number; totalPaise: number; skippedLocked: string[] } {
  const thisMonth = today().slice(0, 7);
  const owners = ownerId ? [ownerId] : many<{ owner_id: string }>('SELECT DISTINCT owner_id FROM acct_assets WHERE deleted_at IS NULL').map((x) => x.owner_id);
  let posted = 0, total = 0;
  const skipped = new Set<string>();
  for (const o of owners) {
    const locked = new Set(lockedMonths(o));
    for (const a of many<AssetRow>('SELECT * FROM acct_assets WHERE owner_id = ? AND deleted_at IS NULL', o)) {
      const first = a.purchase_date.slice(0, 7);
      for (let k = 0; k < a.life_months; k++) {
        const m = monthAdd(first, k);
        if (m >= thisMonth) break;                         // only months that have ended
        if (a.disposed_on && m > a.disposed_on.slice(0, 7)) break;
        if (one('SELECT 1 FROM acct_asset_dep WHERE asset_id = ? AND month = ?', a.id, m)) continue;
        if (locked.has(m)) { skipped.add(m); continue; }
        const amount = chargeFor(a, k);
        if (amount <= 0) continue;
        const j = createJournal(o, actor, { date: monthRange(m)!.to, memo: `Depreciation ${m}: ${a.name}`, lines: [{ account: 'exp:depreciation', debitPaise: amount }, { account: 'accumulated_depreciation', creditPaise: amount }] });
        run('INSERT INTO acct_asset_dep(asset_id, month, amount_paise, journal_id) VALUES(?,?,?,?)', a.id, m, amount, j.id);
        posted++; total += amount;
      }
    }
  }
  return { posted, totalPaise: total, skippedLocked: [...skipped].sort() };
}

// ================================================================== GST summary

export interface GstMonth { month: string; taxableValuePaise: number; gstCollectedPaise: number; gstPaidPaise: number; netPaise: number }
export interface GstSummary { range: DateRange; percent: number; rows: GstMonth[]; totals: { taxableValuePaise: number; gstCollectedPaise: number; gstPaidPaise: number; netPaise: number }; payableAtEndPaise: number; notes: string[] }

export function gstSummary(ownerId: string, range: DateRange): GstSummary {
  const percent = one<{ g: number }>('SELECT gst_percent g FROM acct_settings WHERE owner_id = ?', ownerId)?.g ?? 0;
  const lines = ledgerLines(ownerId, range.to);
  const byMonth = new Map<string, GstMonth>();
  const get = (d: string): GstMonth => { const k = d.slice(0, 7); let m = byMonth.get(k); if (!m) { m = { month: k, taxableValuePaise: 0, gstCollectedPaise: 0, gstPaidPaise: 0, netPaise: 0 }; byMonth.set(k, m); } return m; };
  for (const l of lines) {
    if (l.date < range.from) continue;
    if (l.account === 'booking_income' && l.src === 'booking') get(l.date).taxableValuePaise += l.credit - l.debit;
    else if (l.account === 'gst_payable') { const m = get(l.date); m.gstCollectedPaise += l.credit; m.gstPaidPaise += l.debit; }
  }
  const rows = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)).map((m) => ({ ...m, netPaise: m.gstCollectedPaise - m.gstPaidPaise }));
  const totals = rows.reduce((s, r) => ({ taxableValuePaise: s.taxableValuePaise + r.taxableValuePaise, gstCollectedPaise: s.gstCollectedPaise + r.gstCollectedPaise, gstPaidPaise: s.gstPaidPaise + r.gstPaidPaise, netPaise: s.netPaise + r.netPaise }), { taxableValuePaise: 0, gstCollectedPaise: 0, gstPaidPaise: 0, netPaise: 0 });
  const payable = sumBy(lines, (l) => l.account === 'gst_payable').get('gst_payable');
  const notes = percent > 0 ? [`Prices are treated as including ${percent}% GST. GST is counted when a session is played, the same day it becomes income. "Taxable value" is the booking income before GST.`, 'This is a summary to help you fill in your return. It is not a filed return: check it with your accountant.']
    : ['GST is set to 0%, so nothing is shown as collected. Set the rate under Setup if your prices include GST.'];
  return { range, percent, rows, totals, payableAtEndPaise: payable ? payable.credit - payable.debit : 0, notes };
}
