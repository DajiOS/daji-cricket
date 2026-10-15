import { createHash } from 'node:crypto';
import { many, one, run, tx } from '../db.ts';
import { now } from '../clock.ts';
import { audit, type Actor } from '../audit.ts';
import { HttpError, conflict, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import { Validator } from '../input.ts';
import { addDays, istDate, monthRange } from '../time.ts';
import { directory, isBankCode, journalAccounts } from './chart.ts';
import { categoryId } from './schema.ts';
import { profitAndLoss } from './statements.ts';

// Everything an owner can type into the books: bank and cash accounts, individual transactions, categories, journal
// entries, the GST rate, and the month-end sign-off. Bank statements (upload, Yodlee) arrive through ingest, in import.ts.
// Money is integer paise. Every write names who did it and is audited; nothing the owner enters is ever hard-deleted.

const today = (): string => istDate(now());

// ------------------------------------------------------------------ month lock

/** Months the owner has signed off. Nothing dated in them can be added, changed or removed until the month is re-opened. */
export function lockedMonths(ownerId: string): string[] {
  return many<{ month: string }>('SELECT month FROM acct_signoffs WHERE owner_id = ? AND reopened_at IS NULL ORDER BY month', ownerId).map((r) => r.month);
}

export function assertOpen(ownerId: string, date: string): void {
  const m = date.slice(0, 7);
  if (one('SELECT 1 FROM acct_signoffs WHERE owner_id = ? AND month = ? AND reopened_at IS NULL', ownerId, m)) {
    throw conflict('PERIOD_LOCKED', `${m} has been signed off. Re-open the month to change anything dated in it.`, { month: m });
  }
}

// ------------------------------------------------------------------ settings

export function getAcctSettings(ownerId: string): { gstPercent: number; lockedMonths: string[] } {
  return { gstPercent: one<{ g: number }>('SELECT gst_percent g FROM acct_settings WHERE owner_id = ?', ownerId)?.g ?? 0, lockedMonths: lockedMonths(ownerId) };
}

export function updateAcctSettings(ownerId: string, actor: Actor, body: unknown): { gstPercent: number; lockedMonths: string[] } {
  const v = new Validator(body);
  const gst = v.int('gstPercent', { min: 0, max: 28 });
  v.done();
  if (gst !== undefined) {
    const t = now();
    run(`INSERT INTO acct_settings(owner_id, gst_percent, updated_at, updated_by) VALUES(?,?,?,?)
         ON CONFLICT(owner_id) DO UPDATE SET gst_percent = excluded.gst_percent, updated_at = excluded.updated_at, updated_by = excluded.updated_by`, ownerId, gst, t, actor.id);
    audit(actor, 'acct.settings', 'acct_settings', ownerId, { gstPercent: gst }, ownerId);
  }
  return getAcctSettings(ownerId);
}

// ------------------------------------------------------------------ accounts

export interface AcctAccountOut {
  id: string; kind: 'bank' | 'cash'; name: string; bankName: string | null; last4: string | null; source: string;
  openingPaise: number; openingDate: string | null; balancePaise: number; transactions: number; uncategorised: number; lastTransactionDate: string | null;
}
interface AccountRow { id: string; kind: 'bank' | 'cash'; name: string; bank_name: string | null; last4: string | null; source: string; opening_paise: number; opening_date: string | null; n: number; net: number; unc: number; last: string | null }

export function listAccounts(ownerId: string): AcctAccountOut[] {
  return many<AccountRow>(
    `SELECT a.id, a.kind, a.name, a.bank_name, a.last4, a.source, a.opening_paise, a.opening_date,
       (SELECT COUNT(*) FROM acct_transactions t WHERE t.account_id = a.id AND t.deleted_at IS NULL) n,
       (SELECT COALESCE(SUM(t.amount_paise), 0) FROM acct_transactions t WHERE t.account_id = a.id AND t.deleted_at IS NULL) net,
       (SELECT COUNT(*) FROM acct_transactions t WHERE t.account_id = a.id AND t.deleted_at IS NULL AND t.category_id IS NULL) unc,
       (SELECT MAX(t.txn_date) FROM acct_transactions t WHERE t.account_id = a.id AND t.deleted_at IS NULL) last
     FROM acct_accounts a WHERE a.owner_id = ? AND a.deleted_at IS NULL ORDER BY a.created_at, a.name`, ownerId)
    .map((r) => ({ id: r.id, kind: r.kind, name: r.name, bankName: r.bank_name, last4: r.last4, source: r.source, openingPaise: r.opening_paise, openingDate: r.opening_date,
      balancePaise: r.opening_paise + r.net, transactions: r.n, uncategorised: r.unc, lastTransactionDate: r.last }));
}

export function accountOr404(ownerId: string, id: string): AccountRow & { owner_id: string } {
  const a = one<AccountRow & { owner_id: string }>('SELECT *, 0 n, 0 net, 0 unc, NULL last FROM acct_accounts WHERE id = ? AND owner_id = ? AND deleted_at IS NULL', id, ownerId);
  if (!a) throw notFound('Account not found');
  return a;
}

export function createAccount(ownerId: string, actor: Actor, body: unknown): AcctAccountOut {
  const v = new Validator(body);
  const kind = v.oneOf('kind', ['bank', 'cash'] as const, true);
  const name = v.str('name', { required: true, min: 2, max: 60 });
  const bankName = v.str('bankName', { max: 60 });
  const last4 = v.str('last4', { max: 4 });
  if (last4 !== undefined && !/^\d{4}$/.test(last4)) v.fail('last4', 'Must be the last 4 digits of the account number');
  const opening = v.int('openingPaise', { min: -100_000_000_000, max: 100_000_000_000 }) ?? 0;
  const openingDate = v.date('openingDate');
  if (opening !== 0 && !openingDate) v.fail('openingDate', 'Say which day this opening balance is for');
  v.done();
  const dupe = one('SELECT 1 FROM acct_accounts WHERE owner_id = ? AND deleted_at IS NULL AND lower(name) = lower(?)', ownerId, name!);
  if (dupe) throw conflict('DUPLICATE', 'You already have an account with this name');
  if (openingDate) assertOpen(ownerId, openingDate);
  const id = newId('acc'), t = now();
  run(`INSERT INTO acct_accounts(id, owner_id, kind, name, bank_name, last4, source, opening_paise, opening_date, created_at, created_by, updated_at, updated_by)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, ownerId, kind!, name!, bankName ?? null, last4 ?? null, 'manual', opening, openingDate ?? null, t, actor.id, t, actor.id);
  audit(actor, 'acct.account.create', 'acct_account', id, { kind, name, openingPaise: opening }, ownerId);
  return listAccounts(ownerId).find((a) => a.id === id)!;
}

export function updateAccount(ownerId: string, id: string, actor: Actor, body: unknown): AcctAccountOut {
  const a = accountOr404(ownerId, id);
  const v = new Validator(body);
  const name = v.str('name', { min: 2, max: 60 });
  const bankName = v.str('bankName', { max: 60 });
  const last4 = v.str('last4', { max: 4 });
  if (last4 !== undefined && !/^\d{4}$/.test(last4)) v.fail('last4', 'Must be the last 4 digits of the account number');
  const opening = v.int('openingPaise', { min: -100_000_000_000, max: 100_000_000_000 });
  const openingDate = v.date('openingDate');
  v.done();
  if (name && one('SELECT 1 FROM acct_accounts WHERE owner_id = ? AND deleted_at IS NULL AND lower(name) = lower(?) AND id <> ?', ownerId, name, id)) throw conflict('DUPLICATE', 'You already have an account with this name');
  const nextOpening = opening ?? a.opening_paise;
  const nextDate = openingDate ?? a.opening_date;
  if (nextOpening !== 0 && !nextDate) throw new HttpError(400, 'VALIDATION_FAILED', 'Say which day this opening balance is for', { fields: [{ field: 'openingDate', message: 'Required with an opening balance' }] });
  if (opening !== undefined || openingDate !== undefined) { if (a.opening_date) assertOpen(ownerId, a.opening_date); if (nextDate) assertOpen(ownerId, nextDate); }
  run('UPDATE acct_accounts SET name = ?, bank_name = ?, last4 = ?, opening_paise = ?, opening_date = ?, updated_at = ?, updated_by = ? WHERE id = ?',
    name ?? a.name, bankName ?? a.bank_name, last4 ?? a.last4, nextOpening, nextDate, now(), actor.id, id);
  audit(actor, 'acct.account.update', 'acct_account', id, { name, openingPaise: opening, openingDate }, ownerId);
  return listAccounts(ownerId).find((x) => x.id === id)!;
}

/** An account with transactions cannot be removed: its balance is part of the balance sheet. */
export function deleteAccount(ownerId: string, id: string, actor: Actor): void {
  const a = accountOr404(ownerId, id);
  const n = one<{ n: number }>('SELECT COUNT(*) n FROM acct_transactions WHERE account_id = ? AND deleted_at IS NULL', id)!.n;
  if (n > 0) throw conflict('ACCOUNT_HAS_TRANSACTIONS', `This account has ${n} transaction${n === 1 ? '' : 's'}. Remove them first, or keep the account.`);
  if (a.opening_date) assertOpen(ownerId, a.opening_date);
  run('UPDATE acct_accounts SET deleted_at = ?, deleted_by = ? WHERE id = ?', now(), actor.id, id);
  audit(actor, 'acct.account.delete', 'acct_account', id, { name: a.name }, ownerId);
}

// ------------------------------------------------------------------ categories

export interface CategoryOut { id: string; code: string; name: string; kind: string; group: string; builtin: boolean }

export function listCategories(ownerId: string): CategoryOut[] {
  return many<{ id: string; owner_id: string | null; code: string; name: string; kind: string; group_name: string }>(
    'SELECT id, owner_id, code, name, kind, group_name FROM acct_categories WHERE (owner_id IS NULL OR owner_id = ?) AND deleted_at IS NULL ORDER BY kind, group_name, sort, name', ownerId)
    .map((c) => ({ id: c.id, code: c.code, name: c.name, kind: c.kind, group: c.group_name, builtin: c.owner_id === null }));
}

export function createCategory(ownerId: string, actor: Actor, body: unknown): CategoryOut {
  const v = new Validator(body);
  const name = v.str('name', { required: true, min: 2, max: 50 });
  const kind = v.oneOf('kind', ['income', 'expense'] as const, true);
  const group = v.str('group', { max: 40 });
  v.done();
  const slug = name!.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
  if (!slug) throw new HttpError(400, 'VALIDATION_FAILED', 'Use letters or numbers in the name', { fields: [{ field: 'name', message: 'Use letters or numbers' }] });
  const code = `c_${slug}`;
  if (one('SELECT 1 FROM acct_categories WHERE (owner_id IS NULL OR owner_id = ?) AND lower(code) = lower(?) AND deleted_at IS NULL', ownerId, code)) throw conflict('DUPLICATE', 'You already have a category with this name');
  if (one('SELECT 1 FROM acct_categories WHERE (owner_id IS NULL OR owner_id = ?) AND lower(name) = lower(?) AND deleted_at IS NULL', ownerId, name!)) throw conflict('DUPLICATE', 'There is already a category with this name');
  const id = newId('cat'), t = now();
  run(`INSERT INTO acct_categories(id, owner_id, code, name, kind, group_name, sort, created_at, created_by, updated_at, updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    id, ownerId, code, name!, kind!, group ?? (kind === 'income' ? 'Other income' : 'Other'), 95, t, actor.id, t, actor.id);
  audit(actor, 'acct.category.create', 'acct_category', id, { name, kind }, ownerId);
  return listCategories(ownerId).find((c) => c.id === id)!;
}

function categoryOr400(ownerId: string, id: string): { id: string; code: string; kind: string } {
  const c = one<{ id: string; code: string; kind: string }>('SELECT id, code, kind FROM acct_categories WHERE id = ? AND (owner_id IS NULL OR owner_id = ?) AND deleted_at IS NULL', id, ownerId);
  if (!c) throw new HttpError(400, 'VALIDATION_FAILED', 'No such category', { fields: [{ field: 'categoryId', message: 'No such category' }] });
  return c;
}

// ------------------------------------------------------------------ transactions

export interface TxnOut {
  id: string; accountId: string; accountName: string; date: string; amountPaise: number; balancePaise: number | null; description: string; counterparty: string | null; reference: string | null;
  source: string; categoryId: string | null; categoryName: string | null; categoryKind: string | null; categoryBy: string | null; bookingId: string | null; paymentId: string | null; note: string | null; createdAt: number;
}
interface TxnRow {
  id: string; account_id: string; account_name: string; txn_date: string; amount_paise: number; balance_paise: number | null; description: string; counterparty: string | null; reference: string | null;
  source: string; category_id: string | null; cat_name: string | null; cat_kind: string | null; category_by: string | null; booking_id: string | null; payment_id: string | null; note: string | null; created_at: number;
}
const toTxn = (r: TxnRow): TxnOut => ({ id: r.id, accountId: r.account_id, accountName: r.account_name, date: r.txn_date, amountPaise: r.amount_paise, balancePaise: r.balance_paise, description: r.description, counterparty: r.counterparty, reference: r.reference,
  source: r.source, categoryId: r.category_id, categoryName: r.cat_name, categoryKind: r.cat_kind, categoryBy: r.category_by, bookingId: r.booking_id, paymentId: r.payment_id, note: r.note, createdAt: r.created_at });

const TXN_SELECT = `SELECT t.id, t.account_id, a.name account_name, t.txn_date, t.amount_paise, t.balance_paise, t.description, t.counterparty, t.reference, t.source, t.category_id,
  c.name cat_name, c.kind cat_kind, t.category_by, t.booking_id, t.payment_id, t.note, t.created_at
  FROM acct_transactions t JOIN acct_accounts a ON a.id = t.account_id AND a.deleted_at IS NULL LEFT JOIN acct_categories c ON c.id = t.category_id`;

export interface TxnFilter { accountId?: string; from?: string; to?: string; categorised?: boolean; categoryId?: string; direction?: 'in' | 'out'; q?: string }

export function parseTxnFilter(src: Record<string, string | null>): TxnFilter {
  const v = new Validator(Object.fromEntries(Object.entries(src).filter(([, x]) => x !== null && x !== '')));
  const f: TxnFilter = {};
  const accountId = v.str('accountId', { max: 60 }), from = v.date('from'), to = v.date('to'), categoryId = v.str('categoryId', { max: 60 }), q = v.str('q', { max: 80 });
  const direction = v.oneOf('direction', ['in', 'out'] as const);
  const cat = v.oneOf('categorised', ['yes', 'no'] as const);
  v.done();
  if (accountId) f.accountId = accountId;
  if (from) f.from = from;
  if (to) f.to = to;
  if (categoryId) f.categoryId = categoryId;
  if (direction) f.direction = direction;
  if (cat) f.categorised = cat === 'yes';
  if (q) f.q = q;
  return f;
}

export function listTransactions(ownerId: string, f: TxnFilter, limit: number, offset: number): { items: TxnOut[]; total: number; limit: number; offset: number; moneyInPaise: number; moneyOutPaise: number } {
  const where = ['t.owner_id = ?', 't.deleted_at IS NULL'];
  const p: (string | number)[] = [ownerId];
  if (f.accountId) { where.push('t.account_id = ?'); p.push(f.accountId); }
  if (f.from) { where.push('t.txn_date >= ?'); p.push(f.from); }
  if (f.to) { where.push('t.txn_date <= ?'); p.push(f.to); }
  if (f.categorised === true) where.push('t.category_id IS NOT NULL');
  if (f.categorised === false) where.push('t.category_id IS NULL');
  if (f.categoryId) { where.push('t.category_id = ?'); p.push(f.categoryId); }
  if (f.direction === 'in') where.push('t.amount_paise > 0');
  if (f.direction === 'out') where.push('t.amount_paise < 0');
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, '\\$&')}%`;
    where.push("(t.description LIKE ? ESCAPE '\\' OR t.counterparty LIKE ? ESCAPE '\\' OR t.reference LIKE ? ESCAPE '\\' OR t.note LIKE ? ESCAPE '\\')");
    p.push(like, like, like, like);
  }
  const w = where.join(' AND ');
  const tot = one<{ n: number; i: number | null; o: number | null }>(
    `SELECT COUNT(*) n, SUM(CASE WHEN t.amount_paise > 0 THEN t.amount_paise ELSE 0 END) i, SUM(CASE WHEN t.amount_paise < 0 THEN -t.amount_paise ELSE 0 END) o
     FROM acct_transactions t JOIN acct_accounts a ON a.id = t.account_id AND a.deleted_at IS NULL WHERE ${w}`, ...p)!;
  const items = many<TxnRow>(`${TXN_SELECT} WHERE ${w} ORDER BY t.txn_date DESC, t.created_at DESC, t.id LIMIT ? OFFSET ?`, ...p, limit, offset).map(toTxn);
  return { items, total: tot.n, limit, offset, moneyInPaise: tot.i ?? 0, moneyOutPaise: tot.o ?? 0 };
}

function txnOr404(ownerId: string, id: string): TxnRow {
  const t = one<TxnRow>(`${TXN_SELECT} WHERE t.id = ? AND t.owner_id = ? AND t.deleted_at IS NULL`, id, ownerId);
  if (!t) throw notFound('Transaction not found');
  return t;
}

export const fingerprint = (date: string, amountPaise: number, description: string, balance: number | null): string =>
  createHash('sha256').update(`${date}|${amountPaise}|${description.replace(/\s+/g, ' ').trim().toLowerCase()}|${balance ?? ''}`).digest('hex').slice(0, 32);

/** A transaction typed in by hand: cash spent at the ground, a payment the bank feed does not show. Positive = money in, negative = money out. */
export function addTransaction(ownerId: string, actor: Actor, body: unknown): TxnOut {
  const v = new Validator(body);
  const accountId = v.str('accountId', { required: true, max: 60 });
  const date = v.date('date', true);
  const amount = v.int('amountPaise', { required: true, min: -100_000_000_000, max: 100_000_000_000 });
  const description = v.str('description', { required: true, min: 2, max: 200 });
  const counterparty = v.str('counterparty', { max: 100 });
  const reference = v.str('reference', { max: 60 });
  const catId = v.str('categoryId', { max: 60 });
  const note = v.str('note', { max: 300 });
  if (amount === 0) v.fail('amountPaise', 'Cannot be zero');
  if (date && date > addDays(today(), 1)) v.fail('date', 'Cannot be in the future');
  v.done();
  accountOr404(ownerId, accountId!);
  if (catId) categoryOr400(ownerId, catId);
  assertOpen(ownerId, date!);
  const id = newId('txn'), t = now();
  run(`INSERT INTO acct_transactions(id, owner_id, account_id, source, txn_date, amount_paise, description, counterparty, reference, fingerprint, seq, category_id, category_by, note, created_at, created_by, updated_at, updated_by)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, ownerId, accountId!, 'manual', date!, amount!, description!, counterparty ?? null, reference ?? null, `manual:${id}`, 0, catId ?? null, catId ? 'manual' : null, note ?? null, t, actor.id, t, actor.id);
  audit(actor, 'acct.txn.create', 'acct_transaction', id, { accountId, date, amountPaise: amount, categoryId: catId ?? null }, ownerId);
  return toTxn(txnOr404(ownerId, id));
}

/** Give a transaction a category (or `null` to clear it) and/or a note. Moves it between profit-and-loss lines or off the profit and loss. */
export function updateTransaction(ownerId: string, id: string, actor: Actor, body: unknown): TxnOut {
  const t = txnOr404(ownerId, id);
  const v = new Validator(body);
  const hasCat = Object.prototype.hasOwnProperty.call(v.src, 'categoryId');
  const catId = hasCat && v.src.categoryId !== null ? v.str('categoryId', { max: 60, required: true }) : undefined;
  const note = Object.prototype.hasOwnProperty.call(v.src, 'note') ? (v.src.note === null ? null : v.str('note', { max: 300 }) ?? null) : undefined;
  v.done();
  assertOpen(ownerId, t.txn_date);
  if (catId) categoryOr400(ownerId, catId);
  if (hasCat) {
    run('UPDATE acct_transactions SET category_id = ?, category_by = ?, rule_id = NULL, updated_at = ?, updated_by = ? WHERE id = ?', catId ?? null, catId ? 'manual' : null, now(), actor.id, id);
    audit(actor, 'acct.txn.categorise', 'acct_transaction', id, { from: t.category_id, to: catId ?? null }, ownerId);
  }
  if (note !== undefined) {
    run('UPDATE acct_transactions SET note = ?, updated_at = ?, updated_by = ? WHERE id = ?', note, now(), actor.id, id);
    audit(actor, 'acct.txn.note', 'acct_transaction', id, null, ownerId);
  }
  return toTxn(txnOr404(ownerId, id));
}

/** Only entries typed in by hand can be removed one by one. A statement that was imported by mistake is undone as a whole. */
export function deleteTransaction(ownerId: string, id: string, actor: Actor): void {
  const t = txnOr404(ownerId, id);
  if (t.source !== 'manual') throw conflict('IMPORTED_TRANSACTION', 'This came from a bank statement or feed. Undo the import it belongs to, or categorise it as "Ignore".');
  assertOpen(ownerId, t.txn_date);
  run('UPDATE acct_transactions SET deleted_at = ?, deleted_by = ? WHERE id = ?', now(), actor.id, id);
  audit(actor, 'acct.txn.delete', 'acct_transaction', id, { date: t.txn_date, amountPaise: t.amount_paise, description: t.description }, ownerId);
}

// ------------------------------------------------------------------ journal entries

export interface JournalOut { id: string; date: string; memo: string; totalPaise: number; createdAt: number; createdBy: string | null; deletedAt: number | null; deleteReason: string | null; lines: { account: string; accountName: string; debitPaise: number; creditPaise: number; note: string | null }[] }

export function accountsForJournal(ownerId: string): { code: string; name: string; type: string; group: string }[] {
  return journalAccounts(ownerId).map((a) => ({ code: a.code, name: a.name, type: a.type, group: a.group }));
}

export function createJournal(ownerId: string, actor: Actor, body: unknown): JournalOut {
  const v = new Validator(body);
  const date = v.date('date', true);
  const memo = v.str('memo', { required: true, min: 3, max: 200 });
  const rawLines = v.src.lines;
  if (!Array.isArray(rawLines) || rawLines.length < 2 || rawLines.length > 20) v.fail('lines', 'Send between 2 and 20 lines');
  v.done();
  if (date! > today()) throw new HttpError(400, 'VALIDATION_FAILED', 'An entry cannot be dated in the future', { fields: [{ field: 'date', message: 'Cannot be in the future' }] });
  const allowed = new Map(journalAccounts(ownerId).map((a) => [a.code, a]));
  const lines: { account: string; debit: number; credit: number; note: string | null }[] = [];
  let d = 0, c = 0;
  (rawLines as unknown[]).forEach((raw, i) => {
    const lv = new Validator(raw);
    const account = lv.str('account', { required: true, max: 80 });
    const debit = lv.int('debitPaise', { min: 0, max: 100_000_000_000 }) ?? 0;
    const credit = lv.int('creditPaise', { min: 0, max: 100_000_000_000 }) ?? 0;
    const note = lv.str('note', { max: 200 });
    if ((debit > 0) === (credit > 0)) lv.fail('debitPaise', 'Each line needs either a debit or a credit amount, not both and not neither');
    if (account && !allowed.has(account)) lv.fail('account', isBankCode(account) ? 'Bank and cash accounts change through their transactions, not through journal entries' : 'This account cannot be used in a journal entry');
    for (const f of lv.fields) v.fail(`lines[${i}].${f.field}`, f.message);
    lines.push({ account: account ?? '', debit, credit, note: note ?? null });
    d += debit; c += credit;
  });
  v.done();
  if (d !== c) throw new HttpError(400, 'UNBALANCED', `Debits (${d}) and credits (${c}) must be equal`, { debitPaise: d, creditPaise: c, differencePaise: d - c });
  assertOpen(ownerId, date!);
  const id = newId('jrn'), t = now();
  tx(() => {
    run('INSERT INTO acct_journals(id, owner_id, entry_date, memo, created_at, created_by) VALUES(?,?,?,?,?,?)', id, ownerId, date!, memo!, t, actor.id);
    for (const l of lines) run('INSERT INTO acct_journal_lines(journal_id, account_code, debit_paise, credit_paise, note) VALUES(?,?,?,?,?)', id, l.account, l.debit, l.credit, l.note);
  });
  audit(actor, 'acct.journal.create', 'acct_journal', id, { date, memo, totalPaise: d }, ownerId);
  return journalOr404(ownerId, id);
}

function journalOr404(ownerId: string, id: string): JournalOut {
  const j = one<{ id: string; entry_date: string; memo: string; created_at: number; created_by: string | null; deleted_at: number | null; delete_reason: string | null }>('SELECT * FROM acct_journals WHERE id = ? AND owner_id = ?', id, ownerId);
  if (!j) throw notFound('Journal entry not found');
  return toJournal(ownerId, j);
}

function toJournal(ownerId: string, j: { id: string; entry_date: string; memo: string; created_at: number; created_by: string | null; deleted_at: number | null; delete_reason: string | null }): JournalOut {
  const dir = directory(ownerId);
  const lines = many<{ account_code: string; debit_paise: number; credit_paise: number; note: string | null }>('SELECT account_code, debit_paise, credit_paise, note FROM acct_journal_lines WHERE journal_id = ? ORDER BY id', j.id)
    .map((l) => ({ account: l.account_code, accountName: dir.get(l.account_code)?.name ?? l.account_code, debitPaise: l.debit_paise, creditPaise: l.credit_paise, note: l.note }));
  return { id: j.id, date: j.entry_date, memo: j.memo, totalPaise: lines.reduce((s, l) => s + l.debitPaise, 0), createdAt: j.created_at, createdBy: j.created_by, deletedAt: j.deleted_at, deleteReason: j.delete_reason, lines };
}

export function listJournals(ownerId: string, o: { from?: string; to?: string; includeDeleted?: boolean }, limit: number, offset: number): { items: JournalOut[]; total: number; limit: number; offset: number } {
  const where = ['owner_id = ?'];
  const p: (string | number)[] = [ownerId];
  if (!o.includeDeleted) where.push('deleted_at IS NULL');
  if (o.from) { where.push('entry_date >= ?'); p.push(o.from); }
  if (o.to) { where.push('entry_date <= ?'); p.push(o.to); }
  const w = where.join(' AND ');
  const total = one<{ n: number }>(`SELECT COUNT(*) n FROM acct_journals WHERE ${w}`, ...p)!.n;
  const rows = many<any>(`SELECT * FROM acct_journals WHERE ${w} ORDER BY entry_date DESC, created_at DESC LIMIT ? OFFSET ?`, ...p, limit, offset);
  return { items: rows.map((j) => toJournal(ownerId, j)), total, limit, offset };
}

/** A journal entry is never edited or erased: it is voided with a reason, and a corrected one is entered instead. */
export function voidJournal(ownerId: string, id: string, actor: Actor, body: unknown): JournalOut {
  const j = journalOr404(ownerId, id);
  if (j.deletedAt) throw conflict('ALREADY_VOIDED', 'This entry has already been voided');
  const v = new Validator(body);
  const reason = v.str('reason', { required: true, min: 3, max: 200 });
  v.done();
  assertOpen(ownerId, j.date);
  run('UPDATE acct_journals SET deleted_at = ?, deleted_by = ?, delete_reason = ? WHERE id = ?', now(), actor.id, reason!, id);
  audit(actor, 'acct.journal.void', 'acct_journal', id, { reason, memo: j.memo, totalPaise: j.totalPaise }, ownerId);
  return journalOr404(ownerId, id);
}

// ------------------------------------------------------------------ month-end sign-off and notes

export interface SignOffOut { month: string; signedAt: number; signedBy: string | null; reopenedAt: number | null; reopenReason: string | null; netProfitPaise: number | null; revenuePaise: number | null; expensesPaise: number | null }

export function listSignOffs(ownerId: string): SignOffOut[] {
  return many<{ month: string; snapshot: string; signed_at: number; signed_by: string | null; reopened_at: number | null; reopen_reason: string | null }>(
    'SELECT month, snapshot, signed_at, signed_by, reopened_at, reopen_reason FROM acct_signoffs WHERE owner_id = ? ORDER BY month DESC, signed_at DESC', ownerId)
    .map((r) => {
      let s: { net?: number; revenue?: number; expenses?: number } = {};
      try { s = JSON.parse(r.snapshot); } catch { /* an unreadable snapshot only loses the summary figures */ }
      return { month: r.month, signedAt: r.signed_at, signedBy: r.signed_by, reopenedAt: r.reopened_at, reopenReason: r.reopen_reason, netProfitPaise: s.net ?? null, revenuePaise: s.revenue ?? null, expensesPaise: s.expenses ?? null };
    });
}

/** Locks a finished month. Refused while the month still has bank transactions nobody has categorised. */
export function signOffMonth(ownerId: string, actor: Actor, body: unknown): SignOffOut {
  const v = new Validator(body);
  const month = v.str('month', { required: true, max: 7 });
  v.done();
  const range = monthRange(month!);
  if (!range) throw new HttpError(400, 'VALIDATION_FAILED', 'month must look like 2026-10', { fields: [{ field: 'month', message: 'Must look like 2026-10' }] });
  if (range.to >= today()) throw conflict('MONTH_NOT_OVER', 'A month can be signed off after its last day has passed.');
  if (lockedMonths(ownerId).includes(month!)) throw conflict('ALREADY_SIGNED_OFF', `${month} is already signed off`);
  const un = one<{ n: number }>('SELECT COUNT(*) n FROM acct_transactions WHERE owner_id = ? AND deleted_at IS NULL AND category_id IS NULL AND txn_date BETWEEN ? AND ?', ownerId, range.from, range.to)!.n;
  if (un > 0) throw conflict('UNCATEGORISED_REMAIN', `${un} transaction${un === 1 ? ' is' : 's are'} not categorised yet in ${month}. Categorise ${un === 1 ? 'it' : 'them'}, or mark ${un === 1 ? 'it' : 'them'} "Ignore", then sign off.`, { count: un });
  const p = profitAndLoss(ownerId, range);
  const t = now();
  run('INSERT INTO acct_signoffs(id, owner_id, month, snapshot, signed_at, signed_by) VALUES(?,?,?,?,?,?)', newId('sgn'), ownerId, month!, JSON.stringify({ revenue: p.revenue.totalPaise, expenses: p.expenses.totalPaise, net: p.netProfitPaise, basis: p.basis }), t, actor.id);
  audit(actor, 'acct.signoff', 'acct_signoff', month!, { net: p.netProfitPaise }, ownerId);
  return listSignOffs(ownerId).find((s) => s.month === month && s.reopenedAt === null)!;
}

export function reopenMonth(ownerId: string, actor: Actor, body: unknown): { month: string; lockedMonths: string[] } {
  const v = new Validator(body);
  const month = v.str('month', { required: true, max: 7 });
  const reason = v.str('reason', { required: true, min: 3, max: 200 });
  v.done();
  const r = run('UPDATE acct_signoffs SET reopened_at = ?, reopened_by = ?, reopen_reason = ? WHERE owner_id = ? AND month = ? AND reopened_at IS NULL', now(), actor.id, reason!, ownerId, month!);
  if (!r.changes) throw conflict('NOT_SIGNED_OFF', `${month} is not signed off`);
  audit(actor, 'acct.reopen', 'acct_signoff', month!, { reason }, ownerId);
  return { month: month!, lockedMonths: lockedMonths(ownerId) };
}

export function getMemo(ownerId: string, month: string): { month: string; body: string; updatedAt: number | null } {
  const m = one<{ body: string; updated_at: number }>('SELECT body, updated_at FROM acct_memos WHERE owner_id = ? AND month = ?', ownerId, month);
  return { month, body: m?.body ?? '', updatedAt: m?.updated_at ?? null };
}

export function setMemo(ownerId: string, actor: Actor, month: string, body: unknown): { month: string; body: string; updatedAt: number | null } {
  if (!monthRange(month)) throw new HttpError(400, 'VALIDATION_FAILED', 'month must look like 2026-10', { fields: [{ field: 'month', message: 'Must look like 2026-10' }] });
  const v = new Validator(body);
  const text = v.src.body === '' ? '' : v.str('body', { required: true, max: 2000 });
  v.done();
  if (!text) run('DELETE FROM acct_memos WHERE owner_id = ? AND month = ?', ownerId, month);
  else run(`INSERT INTO acct_memos(owner_id, month, body, updated_at, updated_by) VALUES(?,?,?,?,?)
            ON CONFLICT(owner_id, month) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at, updated_by = excluded.updated_by`, ownerId, month, text, now(), actor.id);
  audit(actor, 'acct.memo', 'acct_memo', month, null, ownerId);
  return getMemo(ownerId, month);
}

export { categoryId };
