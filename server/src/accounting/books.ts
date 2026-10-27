import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { many, one, registerSchema, run, tx } from '../db.ts';
import { now } from '../clock.ts';
import { storeUpload } from '../intake.ts';
import { audit, type Actor } from '../audit.ts';
import { HttpError, conflict, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import { Validator } from '../input.ts';
import { addDays, istDate } from '../time.ts';
import { accountOr404 } from './store.ts';
import { categoryId } from './schema.ts';
import { assertAccountActive, assertCategoryActive, effName } from './catprefs.ts';

// Receipts and documents, bank reconciliation against booking payments, and recurring entries.

registerSchema('books-2', `
CREATE TABLE acct_attachments (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  entity TEXT NOT NULL CHECK (entity IN ('transaction','journal')),
  entity_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  deleted_at INTEGER,
  deleted_by TEXT
);
CREATE INDEX ix_acct_attachments_entity ON acct_attachments(owner_id, entity, entity_id);

CREATE TABLE acct_recurring (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  account_id TEXT NOT NULL REFERENCES acct_accounts(id),
  description TEXT NOT NULL,
  amount_paise INTEGER NOT NULL,
  category_id TEXT REFERENCES acct_categories(id),
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly','monthly','quarterly','yearly')),
  start_date TEXT NOT NULL,
  end_date TEXT,
  next_date TEXT NOT NULL,
  last_run_date TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  deleted_at INTEGER,
  deleted_by TEXT
);
CREATE INDEX ix_acct_recurring_owner ON acct_recurring(owner_id, next_date);
`);

const today = (): string => istDate(now());

// ------------------------------------------------------------------ attachments

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_PER_ENTITY = 10;

/** The type comes from the file's own first bytes, never from its name or the browser's claim. */
export function sniff(b: Buffer): { mime: string; ext: string } | null {
  if (b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}
const cleanName = (n: string, ext: string): string => {
  const base = n.replace(/[\\/]/g, '_').replace(/[^\w .()\-]/g, '_').replace(/\.+$/, '').slice(0, 80).trim() || 'document';
  return /\.(pdf|png|jpe?g|webp)$/i.test(base) ? base : `${base}.${ext}`;
};

export interface AttachmentOut { id: string; entity: string; entityId: string; filename: string; mime: string; sizeBytes: number; createdAt: number }
const toAtt = (r: { id: string; entity: string; entity_id: string; filename: string; mime: string; size_bytes: number; created_at: number }): AttachmentOut => ({ id: r.id, entity: r.entity, entityId: r.entity_id, filename: r.filename, mime: r.mime, sizeBytes: r.size_bytes, createdAt: r.created_at });

function entityOr404(ownerId: string, entity: string, id: string): void {
  const sql = entity === 'transaction' ? 'SELECT 1 FROM acct_transactions WHERE id = ? AND owner_id = ?' : 'SELECT 1 FROM acct_journals WHERE id = ? AND owner_id = ?';
  if (!one(sql, id, ownerId)) throw notFound(entity === 'transaction' ? 'Transaction not found' : 'Journal entry not found');
}

export function addAttachment(dataDir: string, ownerId: string, actor: Actor, entity: string, entityId: string, filename: string, buf: Buffer): AttachmentOut {
  if (entity !== 'transaction' && entity !== 'journal') throw new HttpError(400, 'VALIDATION_FAILED', 'entity must be transaction or journal');
  entityOr404(ownerId, entity, entityId);
  if (!buf.length) throw new HttpError(400, 'EMPTY_FILE', 'The file is empty');
  if (buf.length > MAX_ATTACHMENT_BYTES) throw new HttpError(413, 'FILE_TOO_LARGE', 'Files can be at most 5 MB. Photograph at lower quality or send a PDF.');
  const kind = sniff(buf);
  if (!kind) throw new HttpError(415, 'FILE_TYPE_NOT_ALLOWED', 'Only PDF, PNG, JPEG and WebP files can be attached.');
  const n = one<{ c: number }>('SELECT COUNT(*) c FROM acct_attachments WHERE owner_id = ? AND entity = ? AND entity_id = ? AND deleted_at IS NULL', ownerId, entity, entityId)!.c;
  if (n >= MAX_PER_ENTITY) throw conflict('TOO_MANY_FILES', `At most ${MAX_PER_ENTITY} files per entry.`);
  const id = newId('att'), t = now();
  const name = cleanName(filename, kind.ext);
  storeUpload({
    dataDir, buf, finalPath: join(dataDir, 'uploads', ownerId, id), purpose: 'accounting_attachment', actor, ownerId,
    writeMetadata: () => {
      run('INSERT INTO acct_attachments(id, owner_id, entity, entity_id, filename, mime, size_bytes, sha256, created_at, created_by) VALUES(?,?,?,?,?,?,?,?,?,?)',
        id, ownerId, entity, entityId, name, kind.mime, buf.length, createHash('sha256').update(buf).digest('hex'), t, actor.id);
      audit(actor, 'acct.attachment.add', 'acct_attachment', id, { entity, entityId, filename: name, bytes: buf.length }, ownerId);
    },
  });
  return toAtt(one(`SELECT * FROM acct_attachments WHERE id = ?`, id)!);
}

export function listAttachments(ownerId: string, entity: string, entityId: string): AttachmentOut[] {
  return many(`SELECT * FROM acct_attachments WHERE owner_id = ? AND entity = ? AND entity_id = ? AND deleted_at IS NULL ORDER BY created_at`, ownerId, entity, entityId).map((r) => toAtt(r as never));
}

/** Which transactions in a list have files, so the screen can show a paperclip without one request per row. */
export function attachmentCounts(ownerId: string, entity: string, ids: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  if (!ids.length) return out;
  for (const r of many<{ entity_id: string; c: number }>(`SELECT entity_id, COUNT(*) c FROM acct_attachments WHERE owner_id = ? AND entity = ? AND deleted_at IS NULL AND entity_id IN (${ids.map(() => '?').join(',')}) GROUP BY entity_id`, ownerId, entity, ...ids)) out[r.entity_id] = r.c;
  return out;
}

export function readAttachment(dataDir: string, ownerId: string, id: string): { meta: AttachmentOut; data: Buffer } {
  const r = one<{ id: string; entity: string; entity_id: string; filename: string; mime: string; size_bytes: number; created_at: number }>('SELECT * FROM acct_attachments WHERE id = ? AND owner_id = ? AND deleted_at IS NULL', id, ownerId);
  if (!r) throw notFound('File not found');
  try { return { meta: toAtt(r), data: readFileSync(join(dataDir, 'uploads', ownerId, id)) }; } catch { throw notFound('The file is missing from storage'); }
}

/** Removes the link; the stored bytes stay for the audit trail and the backup. */
export function removeAttachment(ownerId: string, actor: Actor, id: string): void {
  const r = run('UPDATE acct_attachments SET deleted_at = ?, deleted_by = ? WHERE id = ? AND owner_id = ? AND deleted_at IS NULL', now(), actor.id, id, ownerId);
  if (!r.changes) throw notFound('File not found');
  audit(actor, 'acct.attachment.remove', 'acct_attachment', id, null, ownerId);
}

// ------------------------------------------------------------------ reconciliation

export interface PaymentCandidate { paymentId: string; bookingId: string; customerName: string | null; method: string; amountPaise: number; reference: string | null; paidOn: string; strength: 'utr' | 'amount' }
export interface ReconRow { txnId: string; date: string; description: string; reference: string | null; amountPaise: number; accountName: string; candidates: PaymentCandidate[] }

const RECEIPT_CAT: Record<string, string> = { upi: categoryId('upi_booking'), bank_transfer: categoryId('bank_booking') };

function openPayments(ownerId: string): { id: string; booking_id: string; cname: string | null; method: string; amount_paise: number; reference: string | null; at: number }[] {
  return many(`SELECT p.id, p.booking_id, u.name cname, p.method, p.amount_paise, p.reference, COALESCE(p.verified_at, p.submitted_at, p.created_at) at
    FROM payments p LEFT JOIN users u ON u.id = p.customer_id
    WHERE p.owner_id = ? AND p.status IN ('captured','partially_refunded','refunded') AND p.method IN ('upi','bank_transfer')
      AND NOT EXISTS (SELECT 1 FROM acct_transactions t WHERE t.payment_id = p.id AND t.deleted_at IS NULL)`, ownerId);
}

/** Bank credits not yet tied to a booking payment, each with the payments that could be the other half (UTR in the bank text is a strong match, same amount within 4 days a weaker one). */
export function reconciliationQueue(ownerId: string, accountId?: string): { rows: ReconRow[]; unmatchedPayments: number } {
  const pays = openPayments(ownerId);
  const txns = many<{ id: string; txn_date: string; description: string; reference: string | null; amount_paise: number; aname: string }>(
    `SELECT t.id, t.txn_date, t.description, t.reference, t.amount_paise, a.name aname FROM acct_transactions t JOIN acct_accounts a ON a.id = t.account_id
     WHERE t.owner_id = ? AND t.deleted_at IS NULL AND t.amount_paise > 0 AND t.payment_id IS NULL AND (t.category_id IS NULL OR t.category_id IN ('${categoryId('upi_booking')}','${categoryId('bank_booking')}'))
     ${accountId ? 'AND t.account_id = ?' : ''} ORDER BY t.txn_date DESC LIMIT 300`, ...(accountId ? [ownerId, accountId] : [ownerId]));
  const rows: ReconRow[] = [];
  for (const t of txns) {
    const hay = `${t.description} ${t.reference ?? ''}`;
    const cands: PaymentCandidate[] = [];
    for (const p of pays) {
      if (p.amount_paise !== t.amount_paise) continue;
      const paidOn = istDate(p.at);
      const utr = !!p.reference && /^\d{12}$/.test(p.reference) && hay.includes(p.reference);
      const near = Math.abs(Date.parse(paidOn) - Date.parse(t.txn_date)) <= 4 * 86_400_000;
      if (utr || near) cands.push({ paymentId: p.id, bookingId: p.booking_id, customerName: p.cname, method: p.method, amountPaise: p.amount_paise, reference: p.reference, paidOn, strength: utr ? 'utr' : 'amount' });
    }
    cands.sort((a, b) => (a.strength === b.strength ? 0 : a.strength === 'utr' ? -1 : 1));
    rows.push({ txnId: t.id, date: t.txn_date, description: t.description, reference: t.reference, amountPaise: t.amount_paise, accountName: t.aname, candidates: cands });
  }
  return { rows, unmatchedPayments: pays.length };
}

function link(ownerId: string, actor: Actor, txnId: string, paymentId: string, kind: 'utr' | 'manual'): void {
  const t = one<{ id: string; amount_paise: number; txn_date: string; payment_id: string | null }>('SELECT id, amount_paise, txn_date, payment_id FROM acct_transactions WHERE id = ? AND owner_id = ? AND deleted_at IS NULL', txnId, ownerId);
  if (!t) throw notFound('Transaction not found');
  const p = one<{ id: string; booking_id: string; amount_paise: number; method: string }>('SELECT id, booking_id, amount_paise, method FROM payments WHERE id = ? AND owner_id = ?', paymentId, ownerId);
  if (!p) throw notFound('Payment not found');
  if (t.payment_id) throw conflict('ALREADY_MATCHED', 'This bank line is already matched.');
  if (t.amount_paise !== p.amount_paise) throw conflict('AMOUNT_DIFFERS', 'The bank amount and the payment amount are different, so they cannot be the same money.');
  if (one('SELECT 1 FROM acct_signoffs WHERE owner_id = ? AND month = ? AND reopened_at IS NULL', ownerId, t.txn_date.slice(0, 7))) throw conflict('MONTH_LOCKED', 'That month is signed off. Re-open it first.');
  const cat = RECEIPT_CAT[p.method] ?? categoryId('bank_booking');
  try {
    run("UPDATE acct_transactions SET payment_id = ?, booking_id = ?, match_kind = ?, match_locked = 1, category_id = ?, category_by = 'match', updated_at = ?, updated_by = ? WHERE id = ?", p.id, p.booking_id, kind, cat, now(), actor.id, txnId);
  } catch (e) {
    if (String((e as Error).message).includes('UNIQUE')) throw conflict('PAYMENT_ALREADY_MATCHED', 'That payment is already matched to another bank line.');
    throw e;
  }
  audit(actor, 'acct.reconcile.match', 'acct_transaction', txnId, { paymentId, kind }, ownerId);
}

export function matchPayment(ownerId: string, actor: Actor, txnId: string, paymentId: unknown): void {
  if (typeof paymentId !== 'string' || !paymentId) throw new HttpError(400, 'VALIDATION_FAILED', 'paymentId is required', { fields: [{ field: 'paymentId', message: 'Required' }] });
  link(ownerId, actor, txnId, paymentId, 'manual');
}

export function unmatchPayment(ownerId: string, actor: Actor, txnId: string): void {
  const t = one<{ payment_id: string | null; txn_date: string }>('SELECT payment_id, txn_date FROM acct_transactions WHERE id = ? AND owner_id = ? AND deleted_at IS NULL', txnId, ownerId);
  if (!t) throw notFound('Transaction not found');
  if (!t.payment_id) throw conflict('NOT_MATCHED', 'This bank line is not matched.');
  if (one('SELECT 1 FROM acct_signoffs WHERE owner_id = ? AND month = ? AND reopened_at IS NULL', ownerId, t.txn_date.slice(0, 7))) throw conflict('MONTH_LOCKED', 'That month is signed off. Re-open it first.');
  run('UPDATE acct_transactions SET payment_id = NULL, booking_id = NULL, match_kind = NULL, match_locked = 0, category_id = NULL, category_by = NULL, updated_at = ?, updated_by = ? WHERE id = ?', now(), actor.id, txnId);
  audit(actor, 'acct.reconcile.unmatch', 'acct_transaction', txnId, { paymentId: t.payment_id }, ownerId);
}

/** Matches every bank line whose text contains exactly one payment's 12-digit UTR and whose amount is identical. Anything less certain is left for a person. */
export function autoMatch(ownerId: string, actor: Actor): { matched: number; left: number } {
  const q = reconciliationQueue(ownerId);
  let matched = 0;
  const used = new Set<string>();
  for (const r of q.rows) {
    const strong = r.candidates.filter((c) => c.strength === 'utr' && !used.has(c.paymentId));
    if (strong.length !== 1) continue;
    try { link(ownerId, actor, r.txnId, strong[0]!.paymentId, 'utr'); used.add(strong[0]!.paymentId); matched++; } catch { /* locked month or lost a race: leave it for a person */ }
  }
  audit(actor, 'acct.reconcile.auto', 'acct_reconcile', ownerId, { matched }, ownerId);
  return { matched, left: q.rows.length - matched };
}

export interface AccountCheck { accountId: string; name: string; booksBalancePaise: number; statementBalancePaise: number | null; statementDate: string | null; differencePaise: number | null; unmatchedCredits: number; uncategorised: number }
/** Does the balance printed on the latest imported statement line equal opening balance plus everything in the books? A gap means a missing or duplicated line. */
export function accountChecks(ownerId: string): AccountCheck[] {
  return many<{ id: string; name: string; opening_paise: number; net: number; unc: number; cred: number }>(
    `SELECT a.id, a.name, a.opening_paise,
      (SELECT COALESCE(SUM(amount_paise),0) FROM acct_transactions WHERE account_id = a.id AND deleted_at IS NULL) net,
      (SELECT COUNT(*) FROM acct_transactions WHERE account_id = a.id AND deleted_at IS NULL AND category_id IS NULL) unc,
      (SELECT COUNT(*) FROM acct_transactions WHERE account_id = a.id AND deleted_at IS NULL AND amount_paise > 0 AND payment_id IS NULL AND (category_id IS NULL OR category_id IN ('${categoryId('upi_booking')}','${categoryId('bank_booking')}'))) cred
     FROM acct_accounts a WHERE a.owner_id = ? AND a.deleted_at IS NULL AND a.kind = 'bank' ORDER BY a.created_at`, ownerId).map((a) => {
    const last = one<{ balance_paise: number; txn_date: string }>('SELECT balance_paise, txn_date FROM acct_transactions WHERE account_id = ? AND deleted_at IS NULL AND balance_paise IS NOT NULL ORDER BY txn_date DESC, created_at DESC, rowid DESC LIMIT 1', a.id);
    const books = a.opening_paise + a.net;
    return { accountId: a.id, name: a.name, booksBalancePaise: books, statementBalancePaise: last?.balance_paise ?? null, statementDate: last?.txn_date ?? null, differencePaise: last ? books - last.balance_paise : null, unmatchedCredits: a.cred, uncategorised: a.unc };
  });
}

// ------------------------------------------------------------------ recurring entries

export type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export interface RecurringOut { id: string; accountId: string; accountName: string; description: string; amountPaise: number; categoryId: string | null; categoryName: string | null; frequency: Frequency; startDate: string; endDate: string | null; nextDate: string | null; lastRunDate: string | null; active: boolean }

const lastDay = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** The next date after `d`, keeping the day-of-month of the start date (the 31st becomes the 28th, 29th or 30th in short months, then returns to the 31st). */
export function nextOccurrence(start: string, d: string, f: Frequency): string {
  if (f === 'weekly') return addDays(d, 7);
  const step = f === 'monthly' ? 1 : f === 'quarterly' ? 3 : 12;
  const anchor = Number(start.slice(8, 10));
  let y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)) + step;
  while (m > 12) { m -= 12; y++; }
  return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(anchor, lastDay(y, m))).padStart(2, '0')}`;
}

interface RecRow { id: string; account_id: string; aname: string; description: string; amount_paise: number; category_id: string | null; cname: string | null; frequency: Frequency; start_date: string; end_date: string | null; next_date: string; last_run_date: string | null; active: number }
const REC_SELECT = `SELECT r.*, a.name aname, ${effName('c', 'r.owner_id')} cname FROM acct_recurring r JOIN acct_accounts a ON a.id = r.account_id LEFT JOIN acct_categories c ON c.id = r.category_id`;
const toRec = (r: RecRow): RecurringOut => ({ id: r.id, accountId: r.account_id, accountName: r.aname, description: r.description, amountPaise: r.amount_paise, categoryId: r.category_id, categoryName: r.cname, frequency: r.frequency, startDate: r.start_date, endDate: r.end_date,
  nextDate: r.end_date && r.next_date > r.end_date ? null : r.next_date, lastRunDate: r.last_run_date, active: !!r.active });

export function listRecurring(ownerId: string): RecurringOut[] {
  return many<RecRow>(`${REC_SELECT} WHERE r.owner_id = ? AND r.deleted_at IS NULL ORDER BY r.next_date, r.created_at`, ownerId).map(toRec);
}

function recInput(ownerId: string, body: unknown, partial: boolean) {
  const v = new Validator(body);
  const o = {
    accountId: v.str('accountId', { required: !partial, max: 60 }),
    description: v.str('description', { required: !partial, min: 2, max: 200 }),
    amountPaise: v.int('amountPaise', { required: !partial, min: -100_000_000_000, max: 100_000_000_000 }),
    categoryId: v.str('categoryId', { max: 60 }),
    frequency: v.oneOf('frequency', ['weekly', 'monthly', 'quarterly', 'yearly'] as const, !partial),
    startDate: v.date('startDate', !partial),
    endDate: v.date('endDate'),
    active: v.bool('active'),
  };
  if (o.amountPaise === 0) v.fail('amountPaise', 'Cannot be zero');
  if (o.startDate && o.endDate && o.endDate < o.startDate) v.fail('endDate', 'Must be on or after the start date');
  v.done();
  if (o.accountId) { accountOr404(ownerId, o.accountId); assertAccountActive(o.accountId); }
  if (o.categoryId) assertCategoryActive(ownerId, o.categoryId);
  if (o.categoryId && !one('SELECT 1 FROM acct_categories WHERE id = ? AND (owner_id = ? OR owner_id IS NULL) AND deleted_at IS NULL', o.categoryId, ownerId)) throw new HttpError(400, 'VALIDATION_FAILED', 'No such category', { fields: [{ field: 'categoryId', message: 'No such category' }] });
  return o;
}

export function createRecurring(ownerId: string, actor: Actor, body: unknown): RecurringOut {
  const o = recInput(ownerId, body, false);
  const id = newId('rec'), t = now();
  run(`INSERT INTO acct_recurring(id, owner_id, account_id, description, amount_paise, category_id, frequency, start_date, end_date, next_date, active, created_at, created_by, updated_at, updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, ownerId, o.accountId!, o.description!, o.amountPaise!, o.categoryId ?? null, o.frequency!, o.startDate!, o.endDate ?? null, o.startDate!, o.active === false ? 0 : 1, t, actor.id, t, actor.id);
  audit(actor, 'acct.recurring.create', 'acct_recurring', id, { description: o.description, amountPaise: o.amountPaise, frequency: o.frequency }, ownerId);
  return listRecurring(ownerId).find((r) => r.id === id)!;
}

export function updateRecurring(ownerId: string, actor: Actor, id: string, body: unknown): RecurringOut {
  const cur = one<RecRow>(`${REC_SELECT} WHERE r.id = ? AND r.owner_id = ? AND r.deleted_at IS NULL`, id, ownerId);
  if (!cur) throw notFound('Recurring entry not found');
  const o = recInput(ownerId, body, true);
  const hasCat = Object.prototype.hasOwnProperty.call((body ?? {}) as object, 'categoryId');
  run(`UPDATE acct_recurring SET account_id = ?, description = ?, amount_paise = ?, category_id = ?, frequency = ?, end_date = ?, active = ?, updated_at = ?, updated_by = ? WHERE id = ?`,
    o.accountId ?? cur.account_id, o.description ?? cur.description, o.amountPaise ?? cur.amount_paise, hasCat ? o.categoryId ?? null : cur.category_id, o.frequency ?? cur.frequency,
    Object.prototype.hasOwnProperty.call((body ?? {}) as object, 'endDate') ? o.endDate ?? null : cur.end_date, o.active === undefined ? cur.active : o.active ? 1 : 0, now(), actor.id, id);
  audit(actor, 'acct.recurring.update', 'acct_recurring', id, null, ownerId);
  return listRecurring(ownerId).find((r) => r.id === id)!;
}

export function deleteRecurring(ownerId: string, actor: Actor, id: string): void {
  const r = run('UPDATE acct_recurring SET deleted_at = ?, deleted_by = ?, active = 0 WHERE id = ? AND owner_id = ? AND deleted_at IS NULL', now(), actor.id, id, ownerId);
  if (!r.changes) throw notFound('Recurring entry not found');
  audit(actor, 'acct.recurring.delete', 'acct_recurring', id, null, ownerId);
}

/** Posts every entry that has come due, as ordinary transactions. Safe to run any number of times: a date already posted is never posted twice. A signed-off month is skipped, not changed. */
export function runRecurring(ownerId: string | null, actor: Actor | null, upTo = today()): { posted: number; skippedLocked: number } {
  const rows = many<RecRow & { owner_id: string }>(`${REC_SELECT} WHERE r.deleted_at IS NULL AND r.active = 1 AND r.next_date <= ? ${ownerId ? 'AND r.owner_id = ?' : ''}`, ...(ownerId ? [upTo, ownerId] : [upTo]));
  let posted = 0, skipped = 0;
  for (const r of rows) {
    const by = actor?.id ?? null;
    tx(() => {
      let d = r.next_date, guard = 0, last = r.last_run_date;
      while (d <= upTo && (!r.end_date || d <= r.end_date) && guard++ < 60) {
        const locked = one('SELECT 1 FROM acct_signoffs WHERE owner_id = ? AND month = ? AND reopened_at IS NULL', r.owner_id, d.slice(0, 7));
        if (locked) skipped++;
        else {
          const id = newId('txn'), t = now();
          const res = run(`INSERT OR IGNORE INTO acct_transactions(id, owner_id, account_id, source, txn_date, amount_paise, description, fingerprint, seq, category_id, category_by, note, created_at, created_by, updated_at, updated_by)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, r.owner_id, r.account_id, 'manual', d, r.amount_paise, r.description, `recurring:${r.id}:${d}`, 0, r.category_id, r.category_id ? 'rule' : null, 'Recurring entry', t, by, t, by);
          if (res.changes) { posted++; last = d; }
        }
        d = nextOccurrence(r.start_date, d, r.frequency);
      }
      run('UPDATE acct_recurring SET next_date = ?, last_run_date = ? WHERE id = ?', d, last, r.id);
    });
  }
  if (posted && actor) audit(actor, 'acct.recurring.run', 'acct_recurring', ownerId ?? 'all', { posted, skippedLocked: skipped }, ownerId ?? undefined);
  return { posted, skippedLocked: skipped };
}
