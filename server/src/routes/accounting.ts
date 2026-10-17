import { deleteCoa, listCoa, patchCoa } from '../accounting/coa.ts';
import { feedLog, feedStatus, linkAccount, syncAccount } from '../accounting/feed.ts';
import { aaWebhookAuthorised, createConsent, handleAaWebhook, listConsents, mapAccount, revokeLocal, syncConsent, viewAaSettings } from '../accounting/aa.ts';
import { autoLinkAccounts, disconnectProviderAccount, fastLinkSession, listProviderAccounts, ownersInWebhook, refreshProviderAccount, webhookAuthorised } from '../accounting/yodlee.ts';
import { Router, ok, created } from '../http.ts';
import type { Ctx, Reply } from '../http.ts';
import { U, page, ownerOrFail } from './helpers.ts';
import { HttpError, forbidden } from '../errors.ts';
import { audit, SYSTEM } from '../audit.ts';
import { hasPermission, requireRevenue } from '../auth.ts';
import { many, one, run } from '../db.ts';
import { now } from '../clock.ts';
import { istDate, monthRange, addDays as addDaysIst } from '../time.ts';
import { balanceSheet, accountLedger, financialYear, profitAndLoss, rangeFrom, requireDate, trialBalance } from '../accounting/statements.ts';
import { futureSchedule, pastSchedule, MAX_EXPORT_ROWS } from '../accounting/schedule.ts';
import { accountingOverview } from '../accounting/overview.ts';
import { pdfBuffer } from '../accounting/pdf.ts';
import { assetSheets, balanceSheetSheets, budgetSheets, cashFlowSheets, csvText, gstSheets, futureSheets, ledgerSheets, pastSheets, pnlSheets, trialBalanceSheets, xlsxBuffer } from '../accounting/exports.ts';
import type { SheetSpec } from '../accounting/xlsx.ts';
import { auditReport, customerBalances, pnlByPeriod, tableSheets, type TableReport } from '../accounting/reports2.ts';
import { addAsset, budgetVsActual, cashFlow, disposeAsset, gstSummary, listAssets, listBudgets, removeAsset, runDepreciation, setBudgets, transfer } from '../accounting/plus.ts';
import {
  accountsForJournal, addTransaction, createAccount, createCategory, createJournal, deleteAccount, deleteTransaction, getAcctSettings, getMemo, listAccounts, listCategories, listJournals,
  listSignOffs, listTransactions, parseTxnFilter, reopenMonth, setMemo, signOffMonth, updateAccount, updateAcctSettings, updateTransaction, voidJournal,
} from '../accounting/store.ts';

const STAFF_ROLES: ('owner' | 'staff' | 'super_admin')[] = ['owner', 'staff', 'super_admin'];
const A = { auth: STAFF_ROLES };

/** Looking at the books needs "view_reports" or "manage_accounting"; changing them needs "manage_accounting". */
function canRead(c: Ctx): void {
  const u = U(c);
  if (!hasPermission(u, 'view_reports') && !hasPermission(u, 'manage_accounting')) throw forbidden('This needs the "view_reports" permission');
  requireRevenue(u);
}
function canWrite(c: Ctx): void {
  const u = U(c);
  if (!hasPermission(u, 'manage_accounting')) throw forbidden('This needs the "manage_accounting" permission');
}
const actor = (c: Ctx) => ({ id: U(c).id, role: U(c).role });

type Format = 'json' | 'csv' | 'xlsx' | 'pdf';
function formatOf(c: Ctx): Format {
  const f = c.query.get('format') ?? 'json';
  if (f !== 'json' && f !== 'csv' && f !== 'xlsx' && f !== 'pdf') throw new HttpError(400, 'VALIDATION_FAILED', 'format must be json, csv, xlsx or pdf', { fields: [{ field: 'format', message: 'Must be json, csv, xlsx or pdf' }] });
  return f;
}

const business = (ownerId: string): string => one<{ name: string }>('SELECT name FROM users WHERE id = ?', ownerId)?.name ?? 'Daji Cricket Ground';

function download(c: Ctx, ownerId: string, format: 'csv' | 'xlsx' | 'pdf', file: string, sheets: SheetSpec[], csvSheet = 0): Reply {
  audit(actor(c), 'acct.export', 'acct_report', file, { format }, ownerId);
  const name = `${file}.${format}`;
  if (format === 'csv') return { status: 200, raw: csvText(sheets, csvSheet), contentType: 'text/csv; charset=utf-8', headers: { 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' } };
  if (format === 'pdf') return { status: 200, raw: pdfBuffer(sheets[csvSheet]!, business(ownerId), `${file} - made ${new Date(now() + 330 * 60_000).toISOString().replace('T', ' ').slice(0, 16)} IST`), contentType: 'application/pdf', headers: { 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' } };
  return { status: 200, raw: xlsxBuffer(sheets, business(ownerId)), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', headers: { 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' } };
}

const asOfFrom = (c: Ctx): string => {
  const today = istDate(now());
  const v = c.query.get('asOf');
  if (!v) return today;
  const d = requireDate(v, 'asOf');
  if (d > today) throw new HttpError(400, 'VALIDATION_FAILED', 'asOf cannot be in the future', { fields: [{ field: 'asOf', message: 'Cannot be in the future' }] });
  return d;
};

const qs = (c: Ctx, ...keys: string[]): Record<string, string | null> => Object.fromEntries(keys.map((k) => [k, c.query.get(k)]));

export function accountingRoutes(r: Router): void {
  // ------------------------------------------------------------ reports
  r.get('/api/accounting/overview', (c) => { canRead(c); return ok(accountingOverview(ownerOrFail(c, 'see the books'))); }, A);

  r.get('/api/accounting/reports/pnl', (c) => {
    canRead(c);
    const owner = ownerOrFail(c, 'run a report');
    const range = rangeFrom(qs(c, 'month', 'from', 'to'), () => monthRange(istDate(now()).slice(0, 7))!);
    const basis = c.query.get('basis') ?? 'accrual';
    if (basis !== 'accrual' && basis !== 'cash') throw new HttpError(400, 'VALIDATION_FAILED', 'basis must be accrual or cash', { fields: [{ field: 'basis', message: 'Must be accrual or cash' }] });
    const p = profitAndLoss(owner, range, { basis, compare: c.query.get('compare') === '1' || c.query.get('compare') === 'true' });
    const f = formatOf(c);
    return f === 'json' ? ok(p) : download(c, owner, f, `profit-and-loss-${range.from}-to-${range.to}`, pnlSheets(business(owner), p));
  }, A);

  r.get('/api/accounting/reports/balance-sheet', (c) => {
    canRead(c);
    const owner = ownerOrFail(c, 'run a report');
    const b = balanceSheet(owner, asOfFrom(c));
    const f = formatOf(c);
    return f === 'json' ? ok(b) : download(c, owner, f, `balance-sheet-${b.asOf}`, balanceSheetSheets(business(owner), b));
  }, A);

  r.get('/api/accounting/reports/trial-balance', (c) => {
    canRead(c);
    const owner = ownerOrFail(c, 'run a report');
    const t = trialBalance(owner, asOfFrom(c));
    const f = formatOf(c);
    return f === 'json' ? ok(t) : download(c, owner, f, `trial-balance-${t.asOf}`, trialBalanceSheets(business(owner), t));
  }, A);

  r.get('/api/accounting/reports/ledger', (c) => {
    canRead(c);
    const owner = ownerOrFail(c, 'run a report');
    const account = c.query.get('account');
    if (!account) throw new HttpError(400, 'VALIDATION_FAILED', 'Say which account', { fields: [{ field: 'account', message: 'Required' }] });
    const today = istDate(now());
    const range = rangeFrom(qs(c, 'month', 'from', 'to'), () => ({ from: financialYear(today).from, to: today }));
    const l = accountLedger(owner, account, range);
    const f = formatOf(c);
    return f === 'json' ? ok({ range, ...l }) : download(c, owner, f, `ledger-${l.account.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${range.from}-to-${range.to}`, ledgerSheets(business(owner), l, range));
  }, A);

  r.get('/api/accounting/reports/pnl-periods', (c) => {
    canRead(c);
    const owner = ownerOrFail(c, 'run a report');
    const today = istDate(now());
    const range = rangeFrom(qs(c, 'month', 'from', 'to'), () => ({ from: financialYear(today).from, to: today }));
    const by = c.query.get('by') === 'quarter' ? 'quarter' : 'month';
    const basis = c.query.get('basis') === 'cash' ? 'cash' : 'accrual';
    const t = pnlByPeriod(owner, range, by, basis), f = formatOf(c);
    return f === 'json' ? ok(t) : download(c, owner, f, `profit-and-loss-by-${by}-${range.from}-to-${range.to}`, tableSheets(business(owner), t));
  }, A);
  r.get('/api/accounting/reports/customer-balances', (c) => {
    canRead(c);
    const owner = ownerOrFail(c, 'run a report');
    const t = customerBalances(owner, asOfFrom(c), c.query.get('view') === 'detail' ? 'detail' : 'summary'), f = formatOf(c);
    return f === 'json' ? ok(t) : download(c, owner, f, `customer-balances-${t.sub.replace('As of ', '')}`, tableSheets(business(owner), t));
  }, A);
  r.get('/api/accounting/reports/audit-log', (c) => {
    canRead(c);
    const owner = ownerOrFail(c, 'run a report');
    const today = istDate(now());
    const range = rangeFrom(qs(c, 'month', 'from', 'to'), () => ({ from: addDaysIst(today, -30), to: today }));
    const t = auditReport(owner, range), f = formatOf(c);
    return f === 'json' ? ok(t) : download(c, owner, f, `audit-log-${range.from}-to-${range.to}`, tableSheets(business(owner), t));
  }, A);

  for (const which of ['future', 'past'] as const) {
    r.get(`/api/accounting/reports/schedule/${which}`, (c) => {
      canRead(c);
      const owner = ownerOrFail(c, 'run a report');
      const q = qs(c, 'month', 'from', 'to', 'groupBy', 'groundId');
      const f = formatOf(c);
      const { limit, offset } = page(c, 100);
      if (which === 'future') {
        const s = futureSchedule(owner, q, f === 'json' ? limit : MAX_EXPORT_ROWS, f === 'json' ? offset : 0);
        return f === 'json' ? ok(s) : download(c, owner, f, `future-schedule-${s.range.from}-to-${s.range.to}`, futureSheets(business(owner), s, s.items), 3);
      }
      const s = pastSchedule(owner, q, f === 'json' ? limit : MAX_EXPORT_ROWS, f === 'json' ? offset : 0);
      return f === 'json' ? ok(s) : download(c, owner, f, `past-schedule-${s.range.from}-to-${s.range.to}`, pastSheets(business(owner), s, s.items), 3);
    }, A);
  }

  // ------------------------------------------------------------ settings, accounts, categories
  r.get('/api/accounting/settings', (c) => { canRead(c); return ok(getAcctSettings(ownerOrFail(c, 'see settings'))); }, A);
  r.patch('/api/accounting/settings', (c) => { canWrite(c); return ok(updateAcctSettings(ownerOrFail(c, 'change settings'), actor(c), c.json())); }, A);

  r.get('/api/accounting/accounts', (c) => { canRead(c); return ok({ items: listAccounts(ownerOrFail(c, 'list accounts')) }); }, A);
  r.post('/api/accounting/accounts', (c) => { canWrite(c); return created(createAccount(ownerOrFail(c, 'add an account'), actor(c), c.json())); }, A);
  r.patch('/api/accounting/accounts/:id', (c) => { canWrite(c); return ok(updateAccount(ownerOrFail(c, 'change an account'), c.params.id!, actor(c), c.json())); }, A);
  r.get('/api/accounting/coa', (c) => { canRead(c); return ok({ items: listCoa(ownerOrFail(c, 'see the chart of accounts')) }); }, A);
  r.patch('/api/accounting/coa/:id', (c) => { canWrite(c); return ok(patchCoa(ownerOrFail(c, 'change the chart of accounts'), c.params.id!, actor(c), c.json())); }, A);
  r.del('/api/accounting/coa/:id', (c) => { canWrite(c); deleteCoa(ownerOrFail(c, 'change the chart of accounts'), c.params.id!, actor(c)); return ok({ deleted: true }); }, A);
  r.del('/api/accounting/accounts/:id', (c) => { canWrite(c); deleteAccount(ownerOrFail(c, 'remove an account'), c.params.id!, actor(c)); return ok({ deleted: true }); }, A);

  r.get('/api/accounting/categories', (c) => { canRead(c); return ok({ items: listCategories(ownerOrFail(c, 'list categories')) }); }, A);
  r.post('/api/accounting/categories', (c) => { canWrite(c); return created(createCategory(ownerOrFail(c, 'add a category'), actor(c), c.json())); }, A);

  // ------------------------------------------------------------ transactions
  r.get('/api/accounting/transactions', (c) => {
    canRead(c);
    const owner = ownerOrFail(c, 'list transactions');
    const { limit, offset } = page(c, 50);
    return ok(listTransactions(owner, parseTxnFilter(qs(c, 'accountId', 'from', 'to', 'categoryId', 'direction', 'categorised', 'q')), limit, offset));
  }, A);
  r.get('/api/accounting/transactions/export', (c) => {
    canRead(c);
    const owner = ownerOrFail(c, 'export transactions');
    const filter = parseTxnFilter(qs(c, 'accountId', 'from', 'to', 'categoryId', 'direction', 'categorised', 'q'));
    const fmt = formatOf(c), f = fmt === 'json' ? 'csv' : fmt;
    const items = listTransactions(owner, filter, MAX_EXPORT_ROWS, 0).items;
    const t: TableReport = {
      title: 'Bank transactions', sub: `${items.length} transactions` + (filter.from || filter.to ? `, ${filter.from ?? 'start'} to ${filter.to ?? 'today'}` : ''),
      columns: [{ label: 'Date' }, { label: 'Account' }, { label: 'Description' }, { label: 'Reference' }, { label: 'Spent', money: true }, { label: 'Received', money: true }, { label: 'Category' }],
      rows: items.map((x) => ({ kind: 'row' as const, cells: [x.date, x.accountName, x.description, x.reference ?? '', x.amountPaise < 0 ? -x.amountPaise : null, x.amountPaise > 0 ? x.amountPaise : null, x.categoryName ?? (x.paymentId ? 'Matched to a booking' : 'Uncategorised')] })),
      notes: [],
    };
    return download(c, owner, f, `bank-transactions-${istDate(now())}`, tableSheets(business(owner), t));
  }, A);
  r.post('/api/accounting/transactions', (c) => { canWrite(c); return created(addTransaction(ownerOrFail(c, 'add a transaction'), actor(c), c.json())); }, A);
  r.patch('/api/accounting/transactions/:id', (c) => { canWrite(c); return ok(updateTransaction(ownerOrFail(c, 'change a transaction'), c.params.id!, actor(c), c.json())); }, A);
  r.del('/api/accounting/transactions/:id', (c) => { canWrite(c); deleteTransaction(ownerOrFail(c, 'remove a transaction'), c.params.id!, actor(c)); return ok({ deleted: true }); }, A);

  // ------------------------------------------------------------ journal entries
  r.get('/api/accounting/journal-accounts', (c) => { canRead(c); return ok({ items: accountsForJournal(ownerOrFail(c, 'list accounts')) }); }, A);
  r.get('/api/accounting/journals', (c) => {
    canRead(c);
    const owner = ownerOrFail(c, 'list journal entries');
    const { limit, offset } = page(c, 50);
    const from = c.query.get('from'), to = c.query.get('to');
    return ok(listJournals(owner, { from: from ? requireDate(from, 'from') : undefined, to: to ? requireDate(to, 'to') : undefined, includeDeleted: c.query.get('includeVoided') === '1' }, limit, offset));
  }, A);
  r.post('/api/accounting/journals', (c) => { canWrite(c); return created(createJournal(ownerOrFail(c, 'add a journal entry'), actor(c), c.json())); }, A);
  r.post('/api/accounting/journals/:id/void', (c) => { canWrite(c); return ok(voidJournal(ownerOrFail(c, 'void a journal entry'), c.params.id!, actor(c), c.json())); }, A);

  // ------------------------------------------------------------ month-end
  r.get('/api/accounting/signoffs', (c) => { canRead(c); return ok({ items: listSignOffs(ownerOrFail(c, 'list sign-offs')) }); }, A);
  r.post('/api/accounting/signoffs', (c) => { canWrite(c); return created(signOffMonth(ownerOrFail(c, 'sign off a month'), actor(c), c.json())); }, A);
  r.post('/api/accounting/signoffs/reopen', (c) => { canWrite(c); return ok(reopenMonth(ownerOrFail(c, 're-open a month'), actor(c), c.json())); }, A);
  r.get('/api/accounting/memos/:month', (c) => { canRead(c); return ok(getMemo(ownerOrFail(c, 'read a note'), c.params.month!)); }, A);
  r.put('/api/accounting/memos/:month', (c) => { canWrite(c); return ok(setMemo(ownerOrFail(c, 'write a note'), actor(c), c.params.month!, c.json())); }, A);

  // ------------------------------------------------------------ cash flow, budget, GST, transfers, fixed assets
  const rangeOf = (c: Ctx) => rangeFrom(qs(c, 'month', 'from', 'to'), () => monthRange(istDate(now()).slice(0, 7))!);
  r.get('/api/accounting/reports/cash-flow', (c) => {
    canRead(c);
    const owner = ownerOrFail(c, 'run a report');
    const range = rangeOf(c), f = formatOf(c), cf = cashFlow(owner, range);
    return f === 'json' ? ok(cf) : download(c, owner, f, `cash-flow-${range.from}-to-${range.to}`, cashFlowSheets(business(owner), cf));
  }, A);
  r.get('/api/accounting/reports/budget', (c) => {
    canRead(c);
    const owner = ownerOrFail(c, 'run a report');
    const range = rangeOf(c), f = formatOf(c), b = budgetVsActual(owner, range);
    return f === 'json' ? ok(b) : download(c, owner, f, `budget-${range.from}-to-${range.to}`, budgetSheets(business(owner), b));
  }, A);
  r.get('/api/accounting/reports/gst', (c) => {
    canRead(c);
    const owner = ownerOrFail(c, 'run a report');
    const range = rangeFrom(qs(c, 'month', 'from', 'to'), () => financialYear(istDate(now())));
    const f = formatOf(c), g = gstSummary(owner, range);
    return f === 'json' ? ok(g) : download(c, owner, f, `gst-${range.from}-to-${range.to}`, gstSheets(business(owner), g));
  }, A);
  r.get('/api/accounting/feed', (c) => { canRead(c); return ok(feedStatus(c.cfg, ownerOrFail(c, 'see the bank feed'))); }, A);
  r.post('/api/accounting/feed/link', (c) => { canWrite(c); return ok(linkAccount(c.cfg, ownerOrFail(c, 'link a bank account'), actor(c), c.json())); }, A);
  r.post('/api/accounting/feed/sync', async (c) => {
    canWrite(c);
    const owner = ownerOrFail(c, 'sync a bank account');
    const accountId = String((c.json() as { accountId?: unknown })?.accountId ?? '');
    return ok(await syncAccount(c.cfg, owner, actor(c), accountId));
  }, { ...A, rate: 'auth' });
  // ---- Yodlee: connect a bank (FastLink), see what was connected, disconnect, and the webhook Yodlee calls with fresh data
  r.post('/api/accounting/feed/yodlee/session', async (c) => {
    canWrite(c);
    const b = (c.json() ?? {}) as { flow?: unknown; providerAccountId?: unknown };
    const flow = b.flow === 'edit' || b.flow === 'refresh' ? b.flow : undefined;
    return ok(await fastLinkSession(c.cfg, ownerOrFail(c, 'connect a bank'), { flow, providerAccountId: b.providerAccountId === undefined ? undefined : String(b.providerAccountId) }));
  }, { ...A, rate: 'auth' });
  r.post('/api/accounting/feed/yodlee/refresh', async (c) => {
    canWrite(c);
    const owner = ownerOrFail(c, 'refresh a bank');
    const id = String((c.json() as { providerAccountId?: unknown })?.providerAccountId ?? '');
    await refreshProviderAccount(c.cfg, owner, id);
    audit(actor(c), 'feed.refresh', 'acct_account', id, { provider: 'yodlee' }, owner);
    return ok({ ok: true });
  }, { ...A, rate: 'auth' });
  r.post('/api/accounting/feed/yodlee/autolink', async (c) => { canWrite(c); return ok(await autoLinkAccounts(c.cfg, ownerOrFail(c, 'join connected banks'), actor(c))); }, { ...A, rate: 'auth' });
  r.get('/api/accounting/feed/log', (c) => { canRead(c); return ok({ items: feedLog(ownerOrFail(c, 'see the sync record')) }); }, A);
  r.get('/api/accounting/feed/yodlee/accounts', async (c) => { canRead(c); return ok({ accounts: await listProviderAccounts(c.cfg, ownerOrFail(c, 'see connected banks')) }); }, A);
  r.post('/api/accounting/feed/yodlee/disconnect', async (c) => {
    canWrite(c);
    const owner = ownerOrFail(c, 'disconnect a bank');
    const id = String((c.json() as { providerAccountId?: unknown })?.providerAccountId ?? '');
    await disconnectProviderAccount(c.cfg, owner, id);
    run("UPDATE acct_accounts SET provider_ref = NULL, source = 'upload', updated_at = ?, updated_by = ? WHERE owner_id = ? AND provider_ref = ?", now(), actor(c).id, owner, `yodlee:${id}`);
    audit(actor(c), 'feed.disconnect', 'acct_account', id, { provider: 'yodlee' }, owner);
    return ok({ ok: true });
  }, A);
  r.post('/api/webhooks/yodlee', (c) => {
    if (!webhookAuthorised(c.cfg, c.query.get('token') ?? undefined)) throw new HttpError(401, 'UNAUTHORISED', 'Not allowed');
    let body: unknown = null; try { body = JSON.parse(c.raw.toString('utf8')); } catch { throw new HttpError(400, 'BAD_REQUEST', 'The webhook body is not valid'); }
    const owners = ownersInWebhook(c.cfg, body);
    // answer Yodlee at once; the pull runs behind it, and a failure is recorded against the account
    for (const o of owners) {
      const ids = many<{ id: string }>("SELECT id FROM acct_accounts WHERE owner_id = ? AND provider_ref LIKE 'yodlee:%' AND deleted_at IS NULL", o).map((x) => x.id);
      setImmediate(async () => { for (const id of ids) { try { await syncAccount(c.cfg, o, SYSTEM, id, fetch, 'webhook'); } catch (e) { if ((e as { code?: string }).code === 'SYNC_RUNNING') continue; console.error(JSON.stringify({ level: 'error', where: 'yodlee-webhook', error: String((e as Error)?.message ?? e) })); } } });
    }
    return ok({ received: true, owners: owners.length });
  }, { rate: 'none', maxBody: 1024 * 1024 });
  // ---- Account Aggregator (Setu, Finvu): the account holder approves on the gateway's page, then the data arrives like any other bank feed
  r.get('/api/accounting/aa', (c) => { canRead(c); const s = viewAaSettings(c.cfg); return ok({ providers: { setu: s.setuReady, finvu: false }, consents: listConsents(ownerOrFail(c, 'see bank consents')) }); }, A);
  r.post('/api/accounting/aa/consents', async (c) => { canWrite(c); return created(await createConsent(c.cfg, ownerOrFail(c, 'ask for bank access'), actor(c), c.json())); }, { ...A, rate: 'auth' });
  r.post('/api/accounting/aa/consents/:id/sync', async (c) => { canWrite(c); return ok(await syncConsent(c.cfg, ownerOrFail(c, 'get the latest'), actor(c), c.params.id!)); }, { ...A, rate: 'auth' });
  r.post('/api/accounting/aa/consents/:id/forget', (c) => { canWrite(c); revokeLocal(ownerOrFail(c, 'stop a bank consent'), actor(c), c.params.id!); return ok({ ok: true }); }, A);
  r.put('/api/accounting/aa/accounts/:id', (c) => { canWrite(c); mapAccount(ownerOrFail(c, 'join a bank account'), actor(c), c.params.id!, c.json()); return ok({ ok: true }); }, A);
  r.post('/api/webhooks/aa/:provider', (c) => {
    if (!aaWebhookAuthorised(c.query.get('token') ?? undefined)) throw new HttpError(401, 'UNAUTHORISED', 'Not allowed');
    const provider = c.params.provider; if (provider !== 'setu' && provider !== 'finvu') throw new HttpError(404, 'NOT_FOUND', 'Unknown provider');
    let body: unknown = null; try { body = JSON.parse(c.raw.toString('utf8')); } catch { throw new HttpError(400, 'BAD_REQUEST', 'The webhook body is not valid'); }
    setImmediate(() => { handleAaWebhook(c.cfg, provider, body).catch((e) => console.error(JSON.stringify({ level: 'error', where: 'aa-webhook', error: String((e as Error)?.message ?? e) }))); });
    return ok({ received: true });
  }, { rate: 'none', maxBody: 1024 * 1024 });
  r.get('/api/accounting/budgets', (c) => { canRead(c); return ok(listBudgets(ownerOrFail(c, 'see budgets'))); }, A);
  r.put('/api/accounting/budgets', (c) => { canWrite(c); return ok(setBudgets(ownerOrFail(c, 'set budgets'), actor(c), c.json())); }, A);
  r.post('/api/accounting/transfers', (c) => { canWrite(c); return created(transfer(ownerOrFail(c, 'move money between accounts'), actor(c), c.json())); }, A);
  r.get('/api/accounting/assets', (c) => {
    canRead(c);
    const owner = ownerOrFail(c, 'see assets'), f = formatOf(c), a = listAssets(owner);
    return f === 'json' ? ok(a) : download(c, owner, f, 'fixed-assets', assetSheets(business(owner), a));
  }, A);
  r.post('/api/accounting/assets', (c) => { canWrite(c); return created(addAsset(ownerOrFail(c, 'add an asset'), actor(c), c.json())); }, A);
  r.post('/api/accounting/assets/depreciate', (c) => { canWrite(c); return ok(runDepreciation(ownerOrFail(c, 'post depreciation'), actor(c))); }, A);
  r.post('/api/accounting/assets/:id/dispose', (c) => { canWrite(c); return ok(disposeAsset(ownerOrFail(c, 'dispose of an asset'), actor(c), c.params.id!, c.json())); }, A);
  r.del('/api/accounting/assets/:id', (c) => { canWrite(c); removeAsset(ownerOrFail(c, 'remove an asset'), actor(c), c.params.id!); return ok({ deleted: true }); }, A);
}
