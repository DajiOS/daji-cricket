import { createHash } from 'node:crypto';
import { many, one, registerSchema, run, tx } from '../db.ts';
import { now } from '../clock.ts';
import { audit, type Actor } from '../audit.ts';
import { HttpError, conflict, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import { Validator } from '../input.ts';
import { accountOr404, assertOpen, fingerprint } from './store.ts';
import { assertAccountActive, assertCategoryActive, effName } from './catprefs.ts';
import { decodeText, parseCsv, MAX_CSV_BYTES, MAX_CSV_ROWS } from './csv.ts';
import { readXlsx } from './xlsx.ts';
import { detectDateOrder, parseAmount, parseDate, excelSerialToDate } from './parse.ts';

// Bank statements in (CSV, Excel or a text PDF), rules that categorise them, and undo. A PDF has no real columns, so its table is rebuilt
// from where the text sits on the page (see pdfstatement.ts) and every file, whatever its format, is checked against its own running balance:
// a row that does not add up with the balance column is reported before anything is saved.

export interface StatementRow { date: string; amountPaise: number; balancePaise: number | null; description: string; reference: string | null; line: number }
export type StatementSource = 'csv' | 'xlsx' | 'pdf';
/** How well the rows agree with the statement's own running balance column. */
export interface Reconcile { checked: number; mismatched: number; firstBadLine: number | null; openingPaise: number | null; closingPaise: number | null; order: 'oldest-first' | 'newest-first' | null }
export interface ParsedStatement { rows: StatementRow[]; skipped: { line: number; reason: string }[]; warnings: string[]; columns: Record<string, string>; dateOrder: 'dmy' | 'mdy'; source: StatementSource; reconcile: Reconcile }

export const HEAD: Record<string, RegExp> = {
  date: /^(txn|transaction|value|posting|tran)?\s*date$|^date$/i,
  description: /(narration|description|particulars|details|remarks|transaction remarks)/i,
  debit: /(withdrawal|debit|dr\.?$|paid out|money out)/i,
  credit: /(deposit|credit|cr\.?$|paid in|money in)/i,
  amount: /^(txn |transaction )?amount( \(inr\)| \(rs\.?\))?$/i,
  balance: /(closing balance|balance|bal\.?$)/i,
  reference: /(chq|cheque|ref|utr|instrument)/i,
  drcr: /^(dr\s*\/\s*cr|type|cr\s*\/\s*dr)$/i,
};

export const cellText = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim();

/** Reads CSV and Excel files (PDFs go through pdfstatement.ts, which is asynchronous). */
export function parseStatement(filename: string, buf: Buffer): ParsedStatement {
  if (!buf.length) throw new HttpError(400, 'EMPTY_FILE', 'The file is empty');
  let grid: string[][];
  const lower = filename.toLowerCase();
  if (buf.subarray(0, 4).toString('latin1') === '%PDF') throw new HttpError(409, 'PDF_NEEDS_READER', 'PDF statements are read by the statement reader, not here');
  let source: StatementSource = 'csv';
  if (lower.endsWith('.xlsx') || (buf[0] === 0x50 && buf[1] === 0x4b)) {
    source = 'xlsx';
    const sheets = readXlsx(buf).filter((s) => !s.hidden && s.rows.length);
    if (!sheets.length) throw new HttpError(400, 'EMPTY_FILE', 'The workbook has no data');
    grid = sheets[0]!.rows;
  } else {
    if (buf.length > MAX_CSV_BYTES) throw new HttpError(413, 'FILE_TOO_LARGE', 'That statement is larger than 15 MB. Split it by month.');
    grid = parseCsv(decodeText(buf)).rows;
  }
  return parseGrid(grid, source);
}

/** Checks the rows against the statement's own balance column. Tries oldest-first and newest-first and keeps whichever agrees better. */
export function reconcileRows(rows: StatementRow[]): Reconcile {
  const out: Reconcile = { checked: 0, mismatched: 0, firstBadLine: null, openingPaise: null, closingPaise: null, order: null };
  const test = (newer: StatementRow, older: StatementRow): boolean | null => (newer.balancePaise === null || older.balancePaise === null ? null : older.balancePaise + newer.amountPaise === newer.balancePaise);
  let fwd = { checked: 0, bad: 0, first: null as number | null }, bwd = { checked: 0, bad: 0, first: null as number | null };
  for (let i = 1; i < rows.length; i++) {
    const f = test(rows[i]!, rows[i - 1]!); if (f !== null) { fwd.checked++; if (!f) { fwd.bad++; fwd.first ??= rows[i]!.line; } }
    const b = test(rows[i - 1]!, rows[i]!); if (b !== null) { bwd.checked++; if (!b) { bwd.bad++; bwd.first ??= rows[i - 1]!.line; } }
  }
  if (!fwd.checked) return out;
  const useBwd = bwd.bad < fwd.bad;
  const use = useBwd ? bwd : fwd;
  out.checked = use.checked; out.mismatched = use.bad; out.firstBadLine = use.first; out.order = useBwd ? 'newest-first' : 'oldest-first';
  const first = rows[0]!, last = rows[rows.length - 1]!;
  if (useBwd) { out.closingPaise = first.balancePaise; out.openingPaise = last.balancePaise === null ? null : last.balancePaise - last.amountPaise; }
  else { out.openingPaise = first.balancePaise === null ? null : first.balancePaise - first.amountPaise; out.closingPaise = last.balancePaise; }
  return out;
}

/** Finds the header row (banks put account details above it), maps columns, reads every row. Never guesses silently: odd rows are listed in `skipped`. */
export function parseGrid(grid: string[][], source: StatementSource): ParsedStatement {
  if (grid.length > MAX_CSV_ROWS) throw new HttpError(413, 'FILE_TOO_LARGE', 'Too many rows. Split the statement by month.');

  let hi = -1; let map: Record<string, number> = {};
  for (let i = 0; i < Math.min(grid.length, 30); i++) {
    const m: Record<string, number> = {};
    grid[i]!.forEach((c, j) => {
      const t = cellText(c); if (!t) return;
      for (const [k, re] of Object.entries(HEAD)) if (m[k] === undefined && re.test(t) && !(k === 'balance' && /^(opening)/i.test(t))) { m[k] = j; break; }
    });
    if (m.date !== undefined && m.description !== undefined && (m.amount !== undefined || m.debit !== undefined || m.credit !== undefined)) { hi = i; map = m; break; }
  }
  if (hi < 0) throw new HttpError(422, 'COLUMNS_NOT_FOUND', 'Could not find the date, description and amount columns. The header row needs words like Date, Narration, Withdrawal, Deposit, Balance.');

  const body = grid.slice(hi + 1);
  const dateSamples = body.slice(0, 200).map((r) => cellText(r[map.date!]));
  const { order, ambiguous } = detectDateOrder(dateSamples);
  const warnings: string[] = [];
  if (ambiguous) warnings.push('Dates like 03/04/2026 could be 3 April or 4 March. Read as day/month, which is how Indian banks write them. Check the first rows.');

  const rows: StatementRow[] = []; const skipped: { line: number; reason: string }[] = [];
  body.forEach((r, i) => {
    const line = hi + 2 + i;
    if (r.every((c) => !cellText(c))) return;
    const rawDate = cellText(r[map.date!]);
    let date = parseDate(rawDate, order);
    if (!date && /^\d{5}(\.\d+)?$/.test(rawDate)) date = excelSerialToDate(Number(rawDate));
    const desc = cellText(r[map.description!]).replace(/\s+/g, ' ');
    if (!date) { if (rawDate || desc) skipped.push({ line, reason: /total|opening|closing|balance/i.test(rawDate + desc) ? 'Summary line' : 'No valid date' }); return; }
    let paise: number | null = null;
    if (map.debit !== undefined || map.credit !== undefined) {
      const d = parseAmount(map.debit !== undefined ? r[map.debit] : null), c = parseAmount(map.credit !== undefined ? r[map.credit] : null);
      if (d === undefined || c === undefined) { skipped.push({ line, reason: 'Amount is not a number' }); return; }
      if (d && d.paise && c && c.paise) { skipped.push({ line, reason: 'Both debit and credit filled' }); return; }
      if (d && d.paise) paise = -d.paise; else if (c && c.paise) paise = c.paise;
    } else {
      const a = parseAmount(r[map.amount!]);
      if (a === undefined) { skipped.push({ line, reason: 'Amount is not a number' }); return; }
      if (a && a.paise) {
        const t = map.drcr !== undefined ? cellText(r[map.drcr]).toLowerCase() : '';
        const out = a.marker === 'dr' || /^(dr|d|debit|withdrawal)/.test(t) || (a.negative && a.marker !== 'cr' && !/^(cr|c|credit)/.test(t));
        paise = out ? -a.paise : a.paise;
      }
    }
    if (paise === null) { skipped.push({ line, reason: /^(b\/f|brought|opening|balance b)/i.test(desc) ? 'Opening balance (used to check the totals)' : 'No amount' }); return; }
    if (!desc) { skipped.push({ line, reason: 'No description' }); return; }
    const bal = map.balance !== undefined ? parseAmount(r[map.balance]) : null;
    const balancePaise = bal ? (bal.negative || bal.marker === 'dr' ? -bal.paise : bal.paise) : null;
    const ref = map.reference !== undefined ? cellText(r[map.reference]).slice(0, 60) || null : null;
    rows.push({ date, amountPaise: paise, balancePaise, description: desc.slice(0, 200), reference: ref, line });
  });
  if (!rows.length) throw new HttpError(422, 'NO_ROWS', 'No transactions were found in that file', { skipped: skipped.slice(0, 20) });
  const names: Record<string, string> = {}; for (const [k, j] of Object.entries(map)) names[k] = cellText(grid[hi]![j]);
  const reconcile = reconcileRows(rows);
  if (reconcile.mismatched) warnings.push(`${reconcile.mismatched} of ${reconcile.checked} rows do not add up with the Balance column (first one at line ${reconcile.firstBadLine}). Compare those rows with your statement before importing.`);
  return { rows, skipped, warnings, columns: names, dateOrder: order, source, reconcile };
}

// ------------------------------------------------------------------ rules

interface RuleRow { id: string; name: string | null; priority: number; field: string; match_type: string; pattern: string; direction: string; min_paise: number | null; max_paise: number | null; category_id: string; active: number }
export interface RuleOut { id: string; name: string | null; priority: number; field: string; matchType: string; pattern: string; direction: string; minPaise: number | null; maxPaise: number | null; categoryId: string; categoryName: string; active: boolean }

export function listRules(ownerId: string): RuleOut[] {
  return many<RuleRow & { cname: string }>(`SELECT r.*, ${effName('c', 'r.owner_id')} cname FROM acct_rules r JOIN acct_categories c ON c.id = r.category_id WHERE r.owner_id = ? AND r.deleted_at IS NULL ORDER BY r.priority, r.created_at`, ownerId)
    .map((r) => ({ id: r.id, name: r.name, priority: r.priority, field: r.field, matchType: r.match_type, pattern: r.pattern, direction: r.direction, minPaise: r.min_paise, maxPaise: r.max_paise, categoryId: r.category_id, categoryName: r.cname, active: !!r.active }));
}

function ruleInput(ownerId: string, body: unknown, partial: boolean) {
  const v = new Validator(body);
  const o = {
    name: v.str('name', { max: 60 }),
    priority: v.int('priority', { min: 1, max: 10_000 }),
    field: v.oneOf('field', ['description', 'counterparty', 'reference', 'any'] as const, !partial),
    matchType: v.oneOf('matchType', ['contains', 'starts_with', 'equals', 'regex'] as const, !partial),
    pattern: v.str('pattern', { required: !partial, min: 1, max: 120 }),
    direction: v.oneOf('direction', ['any', 'in', 'out'] as const),
    minPaise: v.int('minPaise', { min: 0 }), maxPaise: v.int('maxPaise', { min: 0 }),
    categoryId: v.str('categoryId', { required: !partial, max: 60 }),
    active: v.bool('active'),
  };
  v.done();
  if (o.matchType === 'regex' && o.pattern) {
    try { new RegExp(o.pattern, 'i'); } catch { throw new HttpError(400, 'VALIDATION_FAILED', 'That pattern is not a valid regular expression', { fields: [{ field: 'pattern', message: 'Not a valid regular expression' }] }); }
    if (/(\([^)]*[+*][^)]*\))[+*{]/.test(o.pattern)) throw new HttpError(400, 'VALIDATION_FAILED', 'That pattern could hang the server. Simplify it.', { fields: [{ field: 'pattern', message: 'Nested repeats are not allowed' }] });
  }
  if (o.categoryId) {
    const c = one<{ kind: string }>('SELECT kind FROM acct_categories WHERE id = ? AND (owner_id = ? OR owner_id IS NULL) AND deleted_at IS NULL', o.categoryId, ownerId);
    if (!c) throw new HttpError(400, 'VALIDATION_FAILED', 'No such category', { fields: [{ field: 'categoryId', message: 'No such category' }] });
    assertCategoryActive(ownerId, o.categoryId);
  }
  return o;
}

export function createRule(ownerId: string, actor: Actor, body: unknown): RuleOut {
  const o = ruleInput(ownerId, body, false);
  const id = newId('rul'), t = now();
  run(`INSERT INTO acct_rules(id, owner_id, name, priority, field, match_type, pattern, direction, min_paise, max_paise, category_id, active, created_at, created_by, updated_at, updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, ownerId, o.name ?? null, o.priority ?? 100, o.field!, o.matchType!, o.pattern!, o.direction ?? 'any', o.minPaise ?? null, o.maxPaise ?? null, o.categoryId!, o.active === false ? 0 : 1, t, actor.id, t, actor.id);
  audit(actor, 'acct.rule.create', 'acct_rule', id, { pattern: o.pattern }, ownerId);
  return listRules(ownerId).find((r) => r.id === id)!;
}

export function updateRule(ownerId: string, actor: Actor, id: string, body: unknown): RuleOut {
  const cur = one<RuleRow>('SELECT * FROM acct_rules WHERE id = ? AND owner_id = ? AND deleted_at IS NULL', id, ownerId);
  if (!cur) throw notFound('Rule not found');
  const o = ruleInput(ownerId, body, true);
  run(`UPDATE acct_rules SET name = ?, priority = ?, field = ?, match_type = ?, pattern = ?, direction = ?, min_paise = ?, max_paise = ?, category_id = ?, active = ?, updated_at = ?, updated_by = ? WHERE id = ?`,
    o.name ?? cur.name, o.priority ?? cur.priority, o.field ?? cur.field, o.matchType ?? cur.match_type, o.pattern ?? cur.pattern, o.direction ?? cur.direction,
    o.minPaise ?? cur.min_paise, o.maxPaise ?? cur.max_paise, o.categoryId ?? cur.category_id, o.active === undefined ? cur.active : o.active ? 1 : 0, now(), actor.id, id);
  audit(actor, 'acct.rule.update', 'acct_rule', id, null, ownerId);
  return listRules(ownerId).find((r) => r.id === id)!;
}

export function deleteRule(ownerId: string, actor: Actor, id: string): void {
  const r = run('UPDATE acct_rules SET deleted_at = ?, deleted_by = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL', now(), actor.id, id, ownerId);
  if (!r.changes) throw notFound('Rule not found');
  audit(actor, 'acct.rule.delete', 'acct_rule', id, null, ownerId);
}

interface Candidate { description: string; counterparty: string | null; reference: string | null; amountPaise: number }
function matches(r: RuleRow, t: Candidate): boolean {
  if (r.direction === 'in' && t.amountPaise <= 0) return false;
  if (r.direction === 'out' && t.amountPaise >= 0) return false;
  const abs = Math.abs(t.amountPaise);
  if (r.min_paise !== null && abs < r.min_paise) return false;
  if (r.max_paise !== null && abs > r.max_paise) return false;
  const hay = r.field === 'any' ? [t.description, t.counterparty ?? '', t.reference ?? ''].join(' ') : r.field === 'description' ? t.description : r.field === 'counterparty' ? (t.counterparty ?? '') : (t.reference ?? '');
  const h = hay.toLowerCase(), p = r.pattern.toLowerCase();
  switch (r.match_type) {
    case 'contains': return h.includes(p);
    case 'starts_with': return h.startsWith(p);
    case 'equals': return h.trim() === p.trim();
    case 'regex': try { return new RegExp(r.pattern, 'i').test(hay.slice(0, 400)); } catch { return false; }
    default: return false;
  }
}
const activeRules = (ownerId: string): RuleRow[] => many<RuleRow>(`SELECT * FROM acct_rules r WHERE r.owner_id = ? AND r.active = 1 AND r.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM acct_category_prefs p WHERE p.owner_id = r.owner_id AND p.category_id = r.category_id AND p.active = 0) ORDER BY r.priority, r.created_at`, ownerId);
const firstRule = (rules: RuleRow[], t: Candidate): RuleRow | undefined => rules.find((r) => matches(r, t));

/** Applies the rules to transactions that have no category yet. Never overrides a category a person chose. */
export function applyRules(ownerId: string, actor: Actor, accountId?: string): { categorised: number; checked: number } {
  const rules = activeRules(ownerId);
  const rows = many<{ id: string; txn_date: string; description: string; counterparty: string | null; reference: string | null; amount_paise: number }>(
    `SELECT id, txn_date, description, counterparty, reference, amount_paise FROM acct_transactions WHERE owner_id = ? AND deleted_at IS NULL AND category_id IS NULL ${accountId ? 'AND account_id = ?' : ''}`, ...(accountId ? [ownerId, accountId] : [ownerId]));
  const locked = new Set(many<{ month: string }>('SELECT month FROM acct_signoffs WHERE owner_id = ? AND reopened_at IS NULL', ownerId).map((s) => s.month));
  let n = 0;
  tx(() => {
    for (const t of rows) {
      if (locked.has(t.txn_date.slice(0, 7))) continue;
      const r = firstRule(rules, { description: t.description, counterparty: t.counterparty, reference: t.reference, amountPaise: t.amount_paise });
      if (!r) continue;
      run("UPDATE acct_transactions SET category_id = ?, category_by = 'rule', rule_id = ?, updated_at = ?, updated_by = ? WHERE id = ?", r.category_id, r.id, now(), actor.id, t.id); n++;
    }
  });
  audit(actor, 'acct.rules.apply', 'acct_rules', accountId ?? 'all', { categorised: n }, ownerId);
  return { categorised: n, checked: rows.length };
}

// ------------------------------------------------------------------ import and undo

export interface ImportResult { importId: string | null; dryRun: boolean; filename: string; rowsTotal: number; rowsNew: number; rowsDuplicate: number; rowsSkipped: number; periodFrom: string | null; periodTo: string | null;
  categorisedByRules: number; warnings: string[]; skipped: { line: number; reason: string }[]; columns: Record<string, string>; sample: StatementRow[]; lockedMonthRows: number;
  source: StatementSource; reconcile: Reconcile; reviewRequired: boolean; preview: (StatementRow & { status: 'new' | 'duplicate' | 'locked' })[] }

/**
 * Reads a statement and, unless `dryRun`, saves the new rows. A row already in the books (same date, amount, text and balance) is a duplicate and is skipped,
 * so loading overlapping statements is safe. Rows in a signed-off month are refused so closed months never change.
 */
export function importStatement(ownerId: string, actor: Actor, accountId: string, filename: string, buf: Buffer, dryRun: boolean, pre?: ParsedStatement): ImportResult {
  accountOr404(ownerId, accountId);
  assertAccountActive(accountId);
  const parsed = pre ?? parseStatement(filename || 'statement', buf);
  const sha = createHash('sha256').update(buf).digest('hex');
  if (!dryRun && one('SELECT 1 FROM acct_imports WHERE owner_id = ? AND account_id = ? AND sha256 = ? AND undone_at IS NULL', ownerId, accountId, sha))
    throw conflict('ALREADY_IMPORTED', 'This exact file was already imported into this account.');
  const rules = activeRules(ownerId);
  const locked = new Set(many<{ month: string }>('SELECT month FROM acct_signoffs WHERE owner_id = ? AND reopened_at IS NULL', ownerId).map((s) => s.month));
  const existing = new Map<string, number>();
  for (const e of many<{ fingerprint: string; c: number }>('SELECT fingerprint, COUNT(*) c FROM acct_transactions WHERE owner_id = ? AND account_id = ? AND fingerprint NOT LIKE \'manual:%\' GROUP BY fingerprint', ownerId, accountId)) existing.set(e.fingerprint, e.c);
  const seen = new Map<string, number>();
  const fresh: { r: StatementRow; fp: string; seq: number }[] = []; let dup = 0, lockedRows = 0;
  const preview: ImportResult['preview'] = [];
  const note = (r: StatementRow, status: 'new' | 'duplicate' | 'locked') => { if (preview.length < 400) preview.push({ ...r, status }); };
  for (const r of parsed.rows) {
    if (locked.has(r.date.slice(0, 7))) { lockedRows++; note(r, 'locked'); continue; }
    const fp = fingerprint(r.date, r.amountPaise, r.description, r.balancePaise);
    const k = (seen.get(fp) ?? 0); seen.set(fp, k + 1); // identical lines in one file are separate transactions (two cups of tea), numbered by seq
    if (k < (existing.get(fp) ?? 0)) { dup++; note(r, 'duplicate'); continue; }
    fresh.push({ r, fp, seq: k }); note(r, 'new');
  }
  const dates = parsed.rows.map((r) => r.date).sort();
  const result: ImportResult = { importId: null, dryRun, filename, rowsTotal: parsed.rows.length + parsed.skipped.length, rowsNew: fresh.length, rowsDuplicate: dup, rowsSkipped: parsed.skipped.length + lockedRows,
    periodFrom: dates[0] ?? null, periodTo: dates[dates.length - 1] ?? null, categorisedByRules: 0, warnings: [...parsed.warnings], skipped: parsed.skipped.slice(0, 50), columns: parsed.columns, sample: parsed.rows.slice(0, 5), lockedMonthRows: lockedRows,
    source: parsed.source, reconcile: parsed.reconcile, reviewRequired: parsed.source === 'pdf' && parsed.reconcile.mismatched > 0, preview };
  if (lockedRows) result.warnings.push(`${lockedRows} row${lockedRows === 1 ? ' is' : 's are'} in a signed-off month and were not imported. Re-open that month first if they belong there.`);
  if (dryRun) { result.categorisedByRules = fresh.filter((f) => firstRule(rules, { description: f.r.description, counterparty: null, reference: f.r.reference, amountPaise: f.r.amountPaise })).length; return result; }

  const id = newId('imp'), t = now();
  tx(() => {
    run(`INSERT INTO acct_imports(id, owner_id, account_id, kind, filename, sha256, rows_total, rows_new, rows_duplicate, rows_skipped, period_from, period_to, warnings, created_at, created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, ownerId, accountId, parsed.source, filename.slice(0, 200), sha, result.rowsTotal, fresh.length, dup, result.rowsSkipped, result.periodFrom, result.periodTo, result.warnings.length ? JSON.stringify(result.warnings) : null, t, actor.id);
    for (const f of fresh) {
      const rule = firstRule(rules, { description: f.r.description, counterparty: null, reference: f.r.reference, amountPaise: f.r.amountPaise });
      if (rule) result.categorisedByRules++;
      run(`INSERT INTO acct_transactions(id, owner_id, account_id, import_id, source, txn_date, amount_paise, balance_paise, description, reference, fingerprint, seq, category_id, category_by, rule_id, created_at, created_by, updated_at, updated_by)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, newId('txn'), ownerId, accountId, id, 'upload', f.r.date, f.r.amountPaise, f.r.balancePaise, f.r.description, f.r.reference, f.fp, f.seq,
        rule?.category_id ?? null, rule ? 'rule' : null, rule?.id ?? null, t, actor.id, t, actor.id);
    }
  });
  audit(actor, 'acct.import', 'acct_import', id, { accountId, filename, rows: fresh.length, duplicates: dup }, ownerId);
  result.importId = id;
  return result;
}

export interface ImportOut { id: string; accountId: string; accountName: string; filename: string | null; kind: string; rowsNew: number; rowsDuplicate: number; rowsSkipped: number; periodFrom: string | null; periodTo: string | null; createdAt: number; undoneAt: number | null }
export function listImports(ownerId: string): ImportOut[] {
  return many<{ id: string; account_id: string; aname: string; filename: string | null; kind: string; rows_new: number; rows_duplicate: number; rows_skipped: number; period_from: string | null; period_to: string | null; created_at: number; undone_at: number | null }>(
    `SELECT i.*, a.name aname FROM acct_imports i JOIN acct_accounts a ON a.id = i.account_id WHERE i.owner_id = ? AND i.removed_at IS NULL ORDER BY i.created_at DESC LIMIT 100`, ownerId)
    .map((i) => ({ id: i.id, accountId: i.account_id, accountName: i.aname, filename: i.filename, kind: i.kind, rowsNew: i.rows_new, rowsDuplicate: i.rows_duplicate, rowsSkipped: i.rows_skipped, periodFrom: i.period_from, periodTo: i.period_to, createdAt: i.created_at, undoneAt: i.undone_at }));
}

/** Removes everything one import added. Refused if any of it sits in a signed-off month. */
export function undoImport(ownerId: string, actor: Actor, id: string): { removed: number } {
  const imp = one<{ id: string; undone_at: number | null }>('SELECT id, undone_at FROM acct_imports WHERE id = ? AND owner_id = ?', id, ownerId);
  if (!imp) throw notFound('Import not found');
  if (imp.undone_at) throw conflict('ALREADY_UNDONE', 'This import was already undone.');
  const rows = many<{ txn_date: string }>('SELECT DISTINCT txn_date FROM acct_transactions WHERE import_id = ? AND deleted_at IS NULL', id);
  for (const r of rows) assertOpen(ownerId, r.txn_date);
  let n = 0;
  tx(() => {
    n = run('UPDATE acct_transactions SET deleted_at = ?, deleted_by = ? WHERE import_id = ? AND deleted_at IS NULL', now(), actor.id, id).changes;
    run('UPDATE acct_imports SET undone_at = ?, undone_by = ? WHERE id = ?', now(), actor.id, id);
  });
  audit(actor, 'acct.import.undo', 'acct_import', id, { removed: n }, ownerId);
  return { removed: n };
}

// a removed import leaves the "Statements loaded" list; its row stays for the audit trail
registerSchema('acct-import-removed-1', 'ALTER TABLE acct_imports ADD COLUMN removed_at INTEGER; ALTER TABLE acct_imports ADD COLUMN removed_by TEXT;');

/** Takes an import off the list. One still in force is undone first, so its transactions leave the books too. */
export function removeImport(ownerId: string, actor: Actor, id: string): { removed: number } {
  const imp = one<{ undone_at: number | null; removed_at: number | null }>('SELECT undone_at, removed_at FROM acct_imports WHERE id = ? AND owner_id = ?', id, ownerId);
  if (!imp || imp.removed_at) throw notFound('Import not found');
  const { removed } = imp.undone_at ? { removed: 0 } : undoImport(ownerId, actor, id);
  run('UPDATE acct_imports SET removed_at = ?, removed_by = ? WHERE id = ?', now(), actor.id, id);
  audit(actor, 'acct.import.remove', 'acct_import', id, { removed }, ownerId);
  return { removed };
}
