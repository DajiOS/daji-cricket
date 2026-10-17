import { checkCashExpense } from '../taxrules.ts';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { many, one, registerSchema, run, tx } from '../db.ts';
import { now } from '../clock.ts';
import { audit, listAudit, type Actor } from '../audit.ts';
import { HttpError, conflict, forbidden, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import { Validator } from '../input.ts';
import { addDays, istDate } from '../time.ts';
import { MAX_ATTACHMENT_BYTES, sniff } from './books.ts';
import { assertCategoryActive, effName } from './catprefs.ts';

// Vendor bills: entered by the team, approved by someone with manage_accounting who did not enter them
// (the owner may approve their own), then paid. Paying can be tied to a bank transaction already imported.

registerSchema('bills-1', `
CREATE TABLE acct_vendors (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  phone TEXT,
  upi_id TEXT,
  gstin TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  deleted_at INTEGER,
  deleted_by TEXT
);
CREATE INDEX ix_acct_vendors_owner ON acct_vendors(owner_id, name);

CREATE TABLE acct_bills (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  vendor_id TEXT NOT NULL REFERENCES acct_vendors(id),
  bill_no TEXT,
  bill_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  amount_paise INTEGER NOT NULL,
  category_id TEXT REFERENCES acct_categories(id),
  notes TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft','pending_approval','approved','paid','rejected')),
  submitted_at INTEGER,
  submitted_by TEXT,
  decided_at INTEGER,
  decided_by TEXT,
  reject_reason TEXT,
  paid_date TEXT,
  pay_method TEXT CHECK (pay_method IN ('upi','bank','cash')),
  pay_reference TEXT,
  transaction_id TEXT REFERENCES acct_transactions(id),
  paid_by TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  deleted_at INTEGER,
  deleted_by TEXT
);
CREATE INDEX ix_acct_bills_owner ON acct_bills(owner_id, status, due_date);
CREATE INDEX ix_acct_bills_vendor ON acct_bills(vendor_id);

CREATE TABLE acct_bill_files (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  bill_id TEXT NOT NULL REFERENCES acct_bills(id),
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  deleted_at INTEGER,
  deleted_by TEXT
);
CREATE INDEX ix_acct_bill_files_bill ON acct_bill_files(bill_id);
`);

const today = (): string => istDate(now());
const isBoss = (a: Actor): boolean => a.role === 'owner' || a.role === 'super_admin';
export const BILL_STATUSES = ['draft', 'pending_approval', 'approved', 'paid', 'rejected'] as const;
type Status = typeof BILL_STATUSES[number];

// ------------------------------------------------------------------ vendors

export interface VendorOut { id: string; name: string; phone: string | null; upiId: string | null; gstin: string | null; notes: string | null; billCount: number; openPaise: number }
interface VendorRow { id: string; name: string; phone: string | null; upi_id: string | null; gstin: string | null; notes: string | null }

function vendorBody(raw: unknown, partial: boolean): { name?: string; phone: string | null; upi_id: string | null; gstin: string | null; notes: string | null } {
  const v = new Validator(raw);
  const name = v.str('name', { required: !partial, min: 2, max: 120 });
  const phone = v.phone('phone');
  const upi = v.str('upiId', { max: 80 });
  if (upi !== undefined && !/^[\w.\-]{2,}@[a-zA-Z][\w.\-]{1,}$/.test(upi)) v.fail('upiId', 'Must look like name@bank');
  const gstin = v.str('gstin', { max: 15 })?.toUpperCase();
  if (gstin !== undefined && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) v.fail('gstin', 'Must be a 15-character GSTIN');
  const notes = v.str('notes', { max: 500 });
  v.done();
  return { name, phone: phone ?? null, upi_id: upi ?? null, gstin: gstin ?? null, notes: notes ?? null };
}
const toVendor = (r: VendorRow & { n?: number; open?: number }): VendorOut => ({ id: r.id, name: r.name, phone: r.phone, upiId: r.upi_id, gstin: r.gstin, notes: r.notes, billCount: r.n ?? 0, openPaise: r.open ?? 0 });

export function listVendors(ownerId: string, q?: string): VendorOut[] {
  const rows = many<VendorRow & { n: number; open: number }>(`SELECT v.*,
      (SELECT COUNT(*) FROM acct_bills b WHERE b.vendor_id = v.id AND b.deleted_at IS NULL) n,
      (SELECT COALESCE(SUM(amount_paise), 0) FROM acct_bills b WHERE b.vendor_id = v.id AND b.deleted_at IS NULL AND b.status IN ('pending_approval','approved')) open
    FROM acct_vendors v WHERE v.owner_id = ? AND v.deleted_at IS NULL ORDER BY lower(v.name)`, ownerId);
  const s = q?.trim().toLowerCase();
  return rows.filter((r) => !s || r.name.toLowerCase().includes(s) || (r.upi_id ?? '').toLowerCase().includes(s) || (r.phone ?? '').includes(s)).map(toVendor);
}

function vendorOr404(ownerId: string, id: string): VendorRow {
  const r = one<VendorRow>('SELECT * FROM acct_vendors WHERE id = ? AND owner_id = ? AND deleted_at IS NULL', id, ownerId);
  if (!r) throw notFound('Vendor not found');
  return r;
}

export function createVendor(ownerId: string, actor: Actor, raw: unknown): VendorOut {
  const b = vendorBody(raw, false);
  if (one('SELECT 1 FROM acct_vendors WHERE owner_id = ? AND deleted_at IS NULL AND lower(name) = lower(?)', ownerId, b.name!)) throw conflict('VENDOR_EXISTS', 'A vendor with this name already exists');
  const id = newId('ven'), t = now();
  run('INSERT INTO acct_vendors(id, owner_id, name, phone, upi_id, gstin, notes, created_at, created_by, updated_at, updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    id, ownerId, b.name!, b.phone, b.upi_id, b.gstin, b.notes, t, actor.id, t, actor.id);
  audit(actor, 'bill.vendor.create', 'acct_vendor', id, { name: b.name }, ownerId);
  return toVendor(vendorOr404(ownerId, id));
}

export function updateVendor(ownerId: string, actor: Actor, id: string, raw: unknown): VendorOut {
  const cur = vendorOr404(ownerId, id);
  const src = raw as Record<string, unknown>;
  const b = vendorBody({ name: cur.name, phone: cur.phone, upiId: cur.upi_id, gstin: cur.gstin, notes: cur.notes, ...Object.fromEntries(Object.entries(src ?? {}).map(([k, v]) => [k, v === '' ? null : v])) }, false);
  if (one('SELECT 1 FROM acct_vendors WHERE owner_id = ? AND deleted_at IS NULL AND id <> ? AND lower(name) = lower(?)', ownerId, id, b.name!)) throw conflict('VENDOR_EXISTS', 'A vendor with this name already exists');
  run('UPDATE acct_vendors SET name = ?, phone = ?, upi_id = ?, gstin = ?, notes = ?, updated_at = ?, updated_by = ? WHERE id = ?', b.name!, b.phone, b.upi_id, b.gstin, b.notes, now(), actor.id, id);
  audit(actor, 'bill.vendor.update', 'acct_vendor', id, { name: b.name }, ownerId);
  return listVendors(ownerId).find((x) => x.id === id)!;
}

export function deleteVendor(ownerId: string, actor: Actor, id: string): void {
  vendorOr404(ownerId, id);
  if (one('SELECT 1 FROM acct_bills WHERE vendor_id = ? AND deleted_at IS NULL', id)) throw conflict('VENDOR_IN_USE', 'This vendor has bills, so it cannot be removed');
  run('UPDATE acct_vendors SET deleted_at = ?, deleted_by = ? WHERE id = ?', now(), actor.id, id);
  audit(actor, 'bill.vendor.delete', 'acct_vendor', id, null, ownerId);
}

// ------------------------------------------------------------------ bills

interface BillRow {
  id: string; vendor_id: string; bill_no: string | null; bill_date: string; due_date: string; amount_paise: number; category_id: string | null; notes: string | null;
  status: Status; submitted_at: number | null; submitted_by: string | null; decided_at: number | null; decided_by: string | null; reject_reason: string | null;
  paid_date: string | null; pay_method: string | null; pay_reference: string | null; transaction_id: string | null; paid_by: string | null;
  created_at: number; created_by: string | null; updated_at: number;
  vendor_name: string; vendor_upi: string | null; vendor_phone: string | null; category_name: string | null; created_name: string | null; decided_name: string | null; files: number;
}
export interface BillOut {
  id: string; vendorId: string; vendorName: string; vendorUpi: string | null; vendorPhone: string | null; billNo: string | null; billDate: string; dueDate: string; amountPaise: number;
  categoryId: string | null; categoryName: string | null; notes: string | null; status: Status;
  createdBy: string | null; createdByName: string | null; createdAt: number; submittedAt: number | null; decidedAt: number | null; decidedBy: string | null; decidedByName: string | null; rejectReason: string | null;
  paidDate: string | null; payMethod: string | null; payReference: string | null; transactionId: string | null;
  overdue: boolean; dueInDays: number; fileCount: number;
}
const SELECT = `SELECT b.*, v.name vendor_name, v.upi_id vendor_upi, v.phone vendor_phone, ${effName('c', 'b.owner_id')} category_name, cu.name created_name, du.name decided_name,
    (SELECT COUNT(*) FROM acct_bill_files f WHERE f.bill_id = b.id AND f.deleted_at IS NULL) files
  FROM acct_bills b JOIN acct_vendors v ON v.id = b.vendor_id LEFT JOIN acct_categories c ON c.id = b.category_id
  LEFT JOIN users cu ON cu.id = b.created_by LEFT JOIN users du ON du.id = b.decided_by`;
const daysBetween = (a: string, b: string): number => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const OPEN: Status[] = ['draft', 'pending_approval', 'approved'];

function toBill(r: BillRow): BillOut {
  const open = OPEN.includes(r.status);
  const d = daysBetween(today(), r.due_date);
  return {
    id: r.id, vendorId: r.vendor_id, vendorName: r.vendor_name, vendorUpi: r.vendor_upi, vendorPhone: r.vendor_phone, billNo: r.bill_no, billDate: r.bill_date, dueDate: r.due_date,
    amountPaise: r.amount_paise, categoryId: r.category_id, categoryName: r.category_name, notes: r.notes, status: r.status,
    createdBy: r.created_by, createdByName: r.created_name, createdAt: r.created_at, submittedAt: r.submitted_at, decidedAt: r.decided_at, decidedBy: r.decided_by, decidedByName: r.decided_name,
    rejectReason: r.reject_reason, paidDate: r.paid_date, payMethod: r.pay_method, payReference: r.pay_reference, transactionId: r.transaction_id,
    overdue: open && d < 0, dueInDays: d, fileCount: r.files,
  };
}

function billRow(ownerId: string, id: string): BillRow {
  const r = one<BillRow>(`${SELECT} WHERE b.id = ? AND b.owner_id = ? AND b.deleted_at IS NULL`, id, ownerId);
  if (!r) throw notFound('Bill not found');
  return r;
}

export interface BillFilter { status?: string; q?: string; vendorId?: string; categoryId?: string; overdue?: boolean; dueWeek?: boolean; from?: string; to?: string }

export function listBills(ownerId: string, f: BillFilter): { items: BillOut[]; stats: BillStats } {
  const where = ['b.owner_id = ?', 'b.deleted_at IS NULL'];
  const p: (string | number)[] = [ownerId];
  if (f.status) {
    const list = f.status.split(',').filter((s): s is Status => (BILL_STATUSES as readonly string[]).includes(s));
    if (!list.length) throw new HttpError(400, 'VALIDATION_FAILED', 'Unknown status');
    where.push(`b.status IN (${list.map(() => '?').join(',')})`); p.push(...list);
  }
  if (f.vendorId) { where.push('b.vendor_id = ?'); p.push(f.vendorId); }
  if (f.categoryId) { where.push('b.category_id = ?'); p.push(f.categoryId); }
  if (f.overdue) { where.push("b.status IN ('draft','pending_approval','approved') AND b.due_date < ?"); p.push(today()); }
  if (f.dueWeek) { where.push("b.status IN ('draft','pending_approval','approved') AND b.due_date >= ? AND b.due_date <= ?"); p.push(today(), addDays(today(), 7)); }
  if (f.from) { where.push('b.bill_date >= ?'); p.push(f.from); }
  if (f.to) { where.push('b.bill_date <= ?'); p.push(f.to); }
  if (f.q?.trim()) {
    const like = `%${f.q.trim().replace(/[%_\\]/g, '\\$&')}%`;
    where.push("(v.name LIKE ? ESCAPE '\\' OR b.bill_no LIKE ? ESCAPE '\\' OR b.notes LIKE ? ESCAPE '\\' OR b.pay_reference LIKE ? ESCAPE '\\')"); p.push(like, like, like, like);
  }
  const rows = many<BillRow>(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY CASE b.status WHEN 'pending_approval' THEN 0 WHEN 'approved' THEN 1 WHEN 'draft' THEN 2 WHEN 'rejected' THEN 3 ELSE 4 END, b.due_date, b.created_at DESC LIMIT 500`, ...p);
  return { items: rows.map(toBill), stats: billStats(ownerId) };
}

export interface BillStats { overdueCount: number; overduePaise: number; dueWeekCount: number; dueWeekPaise: number; pendingCount: number; pendingPaise: number; approvedCount: number; approvedPaise: number; paidMonthPaise: number }
export function billStats(ownerId: string): BillStats {
  const t = today();
  const g = (sql: string, ...p: (string | number)[]) => one<{ n: number; s: number }>(`SELECT COUNT(*) n, COALESCE(SUM(amount_paise), 0) s FROM acct_bills WHERE owner_id = ? AND deleted_at IS NULL AND ${sql}`, ownerId, ...p)!;
  const od = g("status IN ('draft','pending_approval','approved') AND due_date < ?", t);
  const wk = g("status IN ('draft','pending_approval','approved') AND due_date >= ? AND due_date <= ?", t, addDays(t, 7));
  const pe = g("status = 'pending_approval'");
  const ap = g("status = 'approved'");
  const pm = g("status = 'paid' AND paid_date >= ? AND paid_date <= ?", `${t.slice(0, 7)}-01`, `${t.slice(0, 7)}-31`);
  return { overdueCount: od.n, overduePaise: od.s, dueWeekCount: wk.n, dueWeekPaise: wk.s, pendingCount: pe.n, pendingPaise: pe.s, approvedCount: ap.n, approvedPaise: ap.s, paidMonthPaise: pm.s };
}

export function approvalsCount(ownerId: string): number {
  return one<{ n: number }>("SELECT COUNT(*) n FROM acct_bills WHERE owner_id = ? AND deleted_at IS NULL AND status = 'pending_approval'", ownerId)!.n;
}

export interface FileOut { id: string; filename: string; mime: string; sizeBytes: number; createdAt: number }
export interface EventOut { id: number; at: number; action: string; actorName: string | null; actorRole: string | null; detail: unknown }

export function getBill(ownerId: string, id: string): { bill: BillOut; files: FileOut[]; events: EventOut[]; transaction: { id: string; date: string; description: string; amountPaise: number } | null } {
  const bill = toBill(billRow(ownerId, id));
  const files = many<{ id: string; filename: string; mime: string; size_bytes: number; created_at: number }>('SELECT * FROM acct_bill_files WHERE bill_id = ? AND deleted_at IS NULL ORDER BY created_at', id)
    .map((f) => ({ id: f.id, filename: f.filename, mime: f.mime, sizeBytes: f.size_bytes, createdAt: f.created_at }));
  const log = listAudit({ ownerId, entity: 'acct_bill', entityId: id, limit: 200 }).items;
  const names = new Map<string, string>();
  for (const e of log) if (e.actorId && !names.has(e.actorId)) names.set(e.actorId, one<{ name: string }>('SELECT name FROM users WHERE id = ?', e.actorId)?.name ?? '');
  const events = log.map((e) => ({ id: e.id, at: e.at, action: e.action, actorName: e.actorId ? names.get(e.actorId) || null : null, actorRole: e.actorRole, detail: e.detail })).reverse();
  const t = bill.transactionId ? one<{ id: string; txn_date: string; description: string; amount_paise: number }>('SELECT id, txn_date, description, amount_paise FROM acct_transactions WHERE id = ? AND owner_id = ?', bill.transactionId, ownerId) : undefined;
  return { bill, files, events, transaction: t ? { id: t.id, date: t.txn_date, description: t.description, amountPaise: t.amount_paise } : null };
}

function billBody(ownerId: string, raw: unknown) {
  const v = new Validator(raw);
  const vendorId = v.str('vendorId', { required: true, max: 60 });
  const billNo = v.str('billNo', { max: 60 });
  const billDate = v.date('billDate', true);
  const dueDate = v.date('dueDate', true);
  const amount = v.int('amountPaise', { required: true, min: 1, max: 100000000000 });
  const categoryId = v.str('categoryId', { max: 60 });
  const notes = v.str('notes', { max: 1000 });
  if (billDate && dueDate && dueDate < billDate) v.fail('dueDate', 'Due date cannot be before the bill date');
  v.done();
  vendorOr404(ownerId, vendorId!);
  if (categoryId && !one("SELECT 1 FROM acct_categories WHERE id = ? AND (owner_id IS NULL OR owner_id = ?) AND deleted_at IS NULL AND kind = 'expense'", categoryId, ownerId)) throw new HttpError(400, 'VALIDATION_FAILED', 'Unknown expense category', { fields: [{ field: 'categoryId', message: 'Unknown expense category' }] });
  if (categoryId) assertCategoryActive(ownerId, categoryId);
  return { vendorId: vendorId!, billNo: billNo ?? null, billDate: billDate!, dueDate: dueDate!, amount: amount!, categoryId: categoryId ?? null, notes: notes ?? null };
}

export function createBill(ownerId: string, actor: Actor, raw: unknown): BillOut {
  const b = billBody(ownerId, raw);
  if (b.billNo && one('SELECT 1 FROM acct_bills WHERE owner_id = ? AND vendor_id = ? AND lower(bill_no) = lower(?) AND deleted_at IS NULL', ownerId, b.vendorId, b.billNo)) throw conflict('BILL_EXISTS', 'This vendor already has a bill with that number');
  const id = newId('bil'), t = now();
  run(`INSERT INTO acct_bills(id, owner_id, vendor_id, bill_no, bill_date, due_date, amount_paise, category_id, notes, status, created_at, created_by, updated_at, updated_by)
    VALUES(?,?,?,?,?,?,?,?,?, 'draft', ?,?,?,?)`, id, ownerId, b.vendorId, b.billNo, b.billDate, b.dueDate, b.amount, b.categoryId, b.notes, t, actor.id, t, actor.id);
  audit(actor, 'bill.create', 'acct_bill', id, { amountPaise: b.amount, vendorId: b.vendorId, billNo: b.billNo }, ownerId);
  return toBill(billRow(ownerId, id));
}

export function updateBill(ownerId: string, actor: Actor, id: string, raw: unknown): BillOut {
  const cur = billRow(ownerId, id);
  if (cur.status !== 'draft' && cur.status !== 'rejected') throw conflict('BILL_LOCKED', 'Only draft or rejected bills can be edited');
  const src = (raw ?? {}) as Record<string, unknown>;
  const b = billBody(ownerId, { vendorId: cur.vendor_id, billNo: cur.bill_no, billDate: cur.bill_date, dueDate: cur.due_date, amountPaise: cur.amount_paise, categoryId: cur.category_id, notes: cur.notes, ...Object.fromEntries(Object.entries(src).map(([k, v]) => [k, v === '' ? null : v])) });
  if (b.billNo && one('SELECT 1 FROM acct_bills WHERE owner_id = ? AND vendor_id = ? AND lower(bill_no) = lower(?) AND id <> ? AND deleted_at IS NULL', ownerId, b.vendorId, b.billNo, id)) throw conflict('BILL_EXISTS', 'This vendor already has a bill with that number');
  // an edited rejected bill goes back to draft so it is submitted again on purpose
  run(`UPDATE acct_bills SET vendor_id = ?, bill_no = ?, bill_date = ?, due_date = ?, amount_paise = ?, category_id = ?, notes = ?, status = 'draft', reject_reason = NULL, updated_at = ?, updated_by = ? WHERE id = ?`,
    b.vendorId, b.billNo, b.billDate, b.dueDate, b.amount, b.categoryId, b.notes, now(), actor.id, id);
  audit(actor, 'bill.update', 'acct_bill', id, { amountPaise: b.amount, was: cur.status }, ownerId);
  return toBill(billRow(ownerId, id));
}

export function deleteBill(ownerId: string, actor: Actor, id: string): void {
  const cur = billRow(ownerId, id);
  if (cur.status !== 'draft' && cur.status !== 'rejected') throw conflict('BILL_LOCKED', 'Only draft or rejected bills can be deleted');
  run('UPDATE acct_bills SET deleted_at = ?, deleted_by = ? WHERE id = ?', now(), actor.id, id);
  audit(actor, 'bill.delete', 'acct_bill', id, { vendorId: cur.vendor_id, amountPaise: cur.amount_paise }, ownerId);
}

function move(ownerId: string, id: string, from: Status[], msg: string): BillRow {
  const cur = billRow(ownerId, id);
  if (!from.includes(cur.status)) throw conflict('BAD_STATUS', msg);
  return cur;
}

export function submitBill(ownerId: string, actor: Actor, id: string): BillOut {
  move(ownerId, id, ['draft', 'rejected'], 'Only a draft or rejected bill can be submitted');
  const t = now();
  run("UPDATE acct_bills SET status = 'pending_approval', submitted_at = ?, submitted_by = ?, decided_at = NULL, decided_by = NULL, reject_reason = NULL, updated_at = ?, updated_by = ? WHERE id = ?", t, actor.id, t, actor.id, id);
  audit(actor, 'bill.submit', 'acct_bill', id, null, ownerId);
  return toBill(billRow(ownerId, id));
}

function guardApprover(cur: BillRow, actor: Actor): void {
  if (!isBoss(actor) && cur.created_by && cur.created_by === actor.id) throw forbidden('You entered this bill, so someone else has to approve it');
}

export function approveBill(ownerId: string, actor: Actor, id: string): BillOut {
  const cur = move(ownerId, id, ['pending_approval'], 'This bill is not waiting for approval');
  guardApprover(cur, actor);
  const t = now();
  run("UPDATE acct_bills SET status = 'approved', decided_at = ?, decided_by = ?, reject_reason = NULL, updated_at = ?, updated_by = ? WHERE id = ?", t, actor.id, t, actor.id, id);
  audit(actor, 'bill.approve', 'acct_bill', id, { selfApproved: cur.created_by === actor.id }, ownerId);
  return toBill(billRow(ownerId, id));
}

export function rejectBill(ownerId: string, actor: Actor, id: string, raw: unknown): BillOut {
  const v = new Validator(raw);
  const reason = v.str('reason', { required: true, min: 3, max: 500 });
  v.done();
  const cur = move(ownerId, id, ['pending_approval'], 'This bill is not waiting for approval');
  guardApprover(cur, actor);
  const t = now();
  run("UPDATE acct_bills SET status = 'rejected', decided_at = ?, decided_by = ?, reject_reason = ?, updated_at = ?, updated_by = ? WHERE id = ?", t, actor.id, reason!, t, actor.id, id);
  audit(actor, 'bill.reject', 'acct_bill', id, { reason }, ownerId);
  return toBill(billRow(ownerId, id));
}

export function payBill(ownerId: string, actor: Actor, id: string, raw: unknown): BillOut {
  const v = new Validator(raw);
  const paidDate = v.date('paidDate', true);
  const method = v.oneOf('method', ['upi', 'bank', 'cash'] as const, true);
  const reference = v.str('reference', { max: 80 });
  const txnId = v.str('transactionId', { max: 60 });
  const cashReason = v.str('cashReason', { max: 300 });
  if (paidDate && paidDate > today()) v.fail('paidDate', 'Cannot be in the future');
  if (method && method !== 'cash' && !reference && !txnId) v.fail('reference', 'Enter the UTR or reference, or link the bank transaction');
  v.done();
  return tx(() => {
    let cashNote: string | null = null;
    const cur = move(ownerId, id, ['approved'], 'Only an approved bill can be marked paid');
    if (method === 'cash') {
      const same = one<{ s: number }>("SELECT COALESCE(SUM(amount_paise), 0) s FROM acct_bills WHERE owner_id = ? AND vendor_id = ? AND status = 'paid' AND pay_method = 'cash' AND paid_date = ? AND deleted_at IS NULL AND id <> ?", ownerId, cur.vendor_id, paidDate!, id)!.s;
      cashNote = checkCashExpense({ amountPaise: cur.amount_paise, alreadyPaidTodayPaise: same, what: 'Cash for bills', reason: cashReason });
    }
    let ref = reference ?? null;
    if (txnId) {
      const t = one<{ amount_paise: number; reference: string | null }>('SELECT amount_paise, reference FROM acct_transactions WHERE id = ? AND owner_id = ? AND deleted_at IS NULL', txnId, ownerId);
      if (!t) throw notFound('Transaction not found');
      if (t.amount_paise >= 0) throw new HttpError(400, 'VALIDATION_FAILED', 'Link a payment going out, not a deposit', { fields: [{ field: 'transactionId', message: 'Must be a withdrawal' }] });
      if (one("SELECT 1 FROM acct_bills WHERE transaction_id = ? AND deleted_at IS NULL AND id <> ?", txnId, id)) throw conflict('TXN_LINKED', 'That transaction is already linked to another bill');
      ref = ref ?? t.reference;
    }
    const t = now();
    run("UPDATE acct_bills SET status = 'paid', paid_date = ?, pay_method = ?, pay_reference = ?, transaction_id = ?, paid_by = ?, updated_at = ?, updated_by = ? WHERE id = ?",
      paidDate!, method!, ref, txnId ?? null, actor.id, t, actor.id, id);
    audit(actor, 'bill.pay', 'acct_bill', id, { paidDate, method, reference: ref, transactionId: txnId ?? null, amountPaise: cur.amount_paise, ...(cashNote ? { cashException: cashNote } : {}) }, ownerId);
    return toBill(billRow(ownerId, id));
  });
}

/** Withdrawals in the last 90 days that no bill has claimed, newest first, for the "link a transaction" picker. */
export function linkableTransactions(ownerId: string, amountPaise?: number): { id: string; date: string; description: string; amountPaise: number; reference: string | null; accountName: string }[] {
  return many<{ id: string; txn_date: string; description: string; amount_paise: number; reference: string | null; aname: string }>(
    `SELECT t.id, t.txn_date, t.description, t.amount_paise, t.reference, a.name aname FROM acct_transactions t JOIN acct_accounts a ON a.id = t.account_id
     WHERE t.owner_id = ? AND t.deleted_at IS NULL AND t.amount_paise < 0 AND t.txn_date >= ?
       AND NOT EXISTS (SELECT 1 FROM acct_bills b WHERE b.transaction_id = t.id AND b.deleted_at IS NULL)
     ORDER BY (CASE WHEN ? IS NOT NULL AND t.amount_paise = -? THEN 0 ELSE 1 END), t.txn_date DESC LIMIT 60`,
    ownerId, addDays(today(), -90), amountPaise ?? null, amountPaise ?? 0)
    .map((r) => ({ id: r.id, date: r.txn_date, description: r.description, amountPaise: r.amount_paise, reference: r.reference, accountName: r.aname }));
}

// ------------------------------------------------------------------ attachments (the bill scan or photo)

export function addBillFile(dataDir: string, ownerId: string, actor: Actor, billId: string, filename: string, buf: Buffer): FileOut {
  billRow(ownerId, billId);
  if (!buf.length) throw new HttpError(400, 'EMPTY_FILE', 'The file is empty');
  if (buf.length > MAX_ATTACHMENT_BYTES) throw new HttpError(413, 'FILE_TOO_LARGE', 'Files can be at most 5 MB.');
  const kind = sniff(buf);
  if (!kind) throw new HttpError(415, 'FILE_TYPE_NOT_ALLOWED', 'Only PDF, PNG, JPEG and WebP files can be attached.');
  if (one<{ n: number }>('SELECT COUNT(*) n FROM acct_bill_files WHERE bill_id = ? AND deleted_at IS NULL', billId)!.n >= 5) throw conflict('TOO_MANY_FILES', 'At most 5 files per bill.');
  const id = newId('bfl'), t = now();
  const dir = join(dataDir, 'uploads', ownerId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, id), buf, { mode: 0o600 });
  const base = filename.replace(/[\\/]/g, '_').replace(/[^\w .()\-]/g, '_').replace(/\.+$/, '').slice(0, 80).trim() || 'bill';
  const name = /\.(pdf|png|jpe?g|webp)$/i.test(base) ? base : `${base}.${kind.ext}`;
  run('INSERT INTO acct_bill_files(id, owner_id, bill_id, filename, mime, size_bytes, sha256, created_at, created_by) VALUES(?,?,?,?,?,?,?,?,?)',
    id, ownerId, billId, name, kind.mime, buf.length, createHash('sha256').update(buf).digest('hex'), t, actor.id);
  audit(actor, 'bill.file.add', 'acct_bill', billId, { filename: name, bytes: buf.length }, ownerId);
  return { id, filename: name, mime: kind.mime, sizeBytes: buf.length, createdAt: t };
}

export function readBillFile(dataDir: string, ownerId: string, billId: string, fileId: string): { meta: FileOut; data: Buffer } {
  const f = one<{ id: string; filename: string; mime: string; size_bytes: number; created_at: number }>('SELECT * FROM acct_bill_files WHERE id = ? AND bill_id = ? AND owner_id = ? AND deleted_at IS NULL', fileId, billId, ownerId);
  if (!f) throw notFound('File not found');
  try { return { meta: { id: f.id, filename: f.filename, mime: f.mime, sizeBytes: f.size_bytes, createdAt: f.created_at }, data: readFileSync(join(dataDir, 'uploads', ownerId, f.id)) }; } catch { throw notFound('The file is missing from storage'); }
}

export function removeBillFile(ownerId: string, actor: Actor, billId: string, fileId: string): void {
  const cur = billRow(ownerId, billId);
  if (cur.status === 'paid') throw conflict('BILL_LOCKED', 'A paid bill keeps its documents');
  const r = run('UPDATE acct_bill_files SET deleted_at = ?, deleted_by = ? WHERE id = ? AND bill_id = ? AND owner_id = ? AND deleted_at IS NULL', now(), actor.id, fileId, billId, ownerId);
  if (!r.changes) throw notFound('File not found');
  audit(actor, 'bill.file.remove', 'acct_bill', billId, { fileId }, ownerId);
}
