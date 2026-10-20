import { many, one, registerSchema, run, tx } from '../db.ts';
import { seal, unseal } from '../vault.ts';
import { now } from '../clock.ts';
import { audit, type Actor } from '../audit.ts';
import { HttpError, conflict, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import { Validator } from '../input.ts';
import { addDays, istDate, isValidDate } from '../time.ts';
import { statutory, STATUTORY_RULES_CHECKED } from './statutory.ts';
import { postToLedger, removeFromLedger, type LedgerRef } from './autopost.ts';
import { pendingFor, startRequest, withdrawRequest } from '../approvals.ts';

// Staff pay profiles, monthly attendance, advances and deductions, the monthly payroll run (net pay in paise),
// month locking, salary payments and payslips. Everything is per owner. A month is "open" (worked out live from
// attendance) until it is finalised; finalising freezes the figures into payroll_lines and locks the month.

registerSchema('payroll-1', `
CREATE TABLE payroll_staff (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  phone TEXT,
  pay_type TEXT NOT NULL CHECK (pay_type IN ('monthly','daily')),
  rate_paise INTEGER NOT NULL,
  joined_on TEXT NOT NULL,
  left_on TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  deleted_at INTEGER,
  deleted_by TEXT
);
CREATE INDEX ix_payroll_staff_owner ON payroll_staff(owner_id, active);

CREATE TABLE payroll_attendance (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  staff_id TEXT NOT NULL REFERENCES payroll_staff(id),
  date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('present','half','absent','leave')),
  created_at INTEGER NOT NULL,
  created_by TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  deleted_at INTEGER,
  deleted_by TEXT
);
CREATE UNIQUE INDEX ux_payroll_attendance ON payroll_attendance(staff_id, date) WHERE deleted_at IS NULL;
CREATE INDEX ix_payroll_attendance_owner ON payroll_attendance(owner_id, date);

CREATE TABLE payroll_adjustments (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  staff_id TEXT NOT NULL REFERENCES payroll_staff(id),
  kind TEXT NOT NULL CHECK (kind IN ('advance','deduction','bonus')),
  amount_paise INTEGER NOT NULL,
  given_on TEXT NOT NULL,
  month TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  deleted_at INTEGER,
  deleted_by TEXT
);
CREATE INDEX ix_payroll_adjustments_owner ON payroll_adjustments(owner_id, month);

CREATE TABLE payroll_runs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  month TEXT NOT NULL,
  finalised_at INTEGER NOT NULL,
  finalised_by TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  deleted_at INTEGER,
  deleted_by TEXT
);
CREATE UNIQUE INDEX ux_payroll_runs ON payroll_runs(owner_id, month) WHERE deleted_at IS NULL;

CREATE TABLE payroll_lines (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  run_id TEXT NOT NULL REFERENCES payroll_runs(id),
  month TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES payroll_staff(id),
  staff_name TEXT NOT NULL,
  staff_role TEXT NOT NULL,
  pay_type TEXT NOT NULL,
  rate_paise INTEGER NOT NULL,
  days_in_month INTEGER NOT NULL,
  present INTEGER NOT NULL,
  half INTEGER NOT NULL,
  absent INTEGER NOT NULL,
  leave INTEGER NOT NULL,
  unmarked INTEGER NOT NULL,
  paid_units2 INTEGER NOT NULL,
  gross_paise INTEGER NOT NULL,
  bonus_paise INTEGER NOT NULL,
  advance_paise INTEGER NOT NULL,
  deduction_paise INTEGER NOT NULL,
  net_paise INTEGER NOT NULL,
  shortfall_paise INTEGER NOT NULL,
  paid_on TEXT,
  paid_method TEXT,
  paid_ref TEXT,
  paid_at INTEGER,
  paid_by TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  deleted_at INTEGER,
  deleted_by TEXT
);
CREATE INDEX ix_payroll_lines_run ON payroll_lines(run_id);
CREATE INDEX ix_payroll_lines_staff ON payroll_lines(owner_id, staff_id, month);
`);

export const PAY_TYPES = ['monthly', 'daily'] as const;
export const ATT_STATUSES = ['present', 'half', 'absent', 'leave'] as const;
export const ADJ_KINDS = ['advance', 'deduction', 'bonus'] as const;
registerSchema('payroll-2', `ALTER TABLE payroll_lines ADD COLUMN ledger_txn_id TEXT;`);

registerSchema('payroll-3', `
ALTER TABLE payroll_staff ADD COLUMN pf INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payroll_staff ADD COLUMN esi INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payroll_staff ADD COLUMN pt INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payroll_staff ADD COLUMN tds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payroll_staff ADD COLUMN tds_fixed_paise INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payroll_staff ADD COLUMN uan TEXT;
ALTER TABLE payroll_staff ADD COLUMN esic_no TEXT;
ALTER TABLE payroll_staff ADD COLUMN pan TEXT;
ALTER TABLE payroll_lines ADD COLUMN pf_employee_paise INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN pf_employer_paise INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN pf_admin_paise INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN esi_employee_paise INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN esi_employer_paise INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN pt_paise INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN tds_paise INTEGER NOT NULL DEFAULT 0;
`);

export const METHODS = ['cash', 'upi', 'bank', 'cheque', 'other'] as const;
const MAX_PAISE = 100_000_000_00; // 10 crore rupees: a sanity limit, not a business rule

const today = (): string => istDate(now());

// ------------------------------------------------------------------ helpers

export function checkMonth(m: unknown): string {
  if (typeof m !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new HttpError(400, 'VALIDATION_FAILED', 'month must look like 2026-10', { fields: [{ field: 'month', message: 'Use YYYY-MM' }] });
  return m;
}
export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
}
const monthStart = (month: string): string => `${month}-01`;
const monthEnd = (month: string): string => `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;

export function runFor(ownerId: string, month: string): { id: string; month: string; finalised_at: number; finalised_by: string | null } | undefined {
  return one('SELECT id, month, finalised_at, finalised_by FROM payroll_runs WHERE owner_id = ? AND month = ? AND deleted_at IS NULL', ownerId, month);
}
export const isLocked = (ownerId: string, month: string): boolean => !!runFor(ownerId, month);
function assertOpen(ownerId: string, month: string): void {
  if (isLocked(ownerId, month)) throw conflict('MONTH_LOCKED', `Payroll for ${month} is finalised and locked. Reopen it first to change anything.`);
}

/**
 * The pay rule, in integers. `units2` is paid days counted in halves (present = 2, half day = 1, paid leave = 2).
 * Monthly salary: rate x paid days / days in the month. Daily wage: rate x paid days (leave is not paid).
 */
export function grossFor(payType: string, ratePaise: number, units2: number, dim: number): number {
  return payType === 'monthly' ? Math.round((ratePaise * units2) / (2 * dim)) : Math.round((ratePaise * units2) / 2);
}

// ------------------------------------------------------------------ staff

function statFields(v: Validator) {
  const flag = (k: string): number | undefined => { const x = v.bool(k); return x === undefined ? undefined : x ? 1 : 0; };
  const pan = v.str('pan', { max: 10 }), uan = v.str('uan', { max: 12 }), esicNo = v.str('esicNo', { max: 17 });
  if (pan && !/^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/.test(pan)) v.fail('pan', 'A PAN looks like ABCDE1234F');
  if (uan && !/^\d{12}$/.test(uan)) v.fail('uan', 'A UAN is 12 digits');
  // Provident Fund does not apply to Daji (fewer than 20 people), so it is never switched on
  return { pf: v.bool('pf') === undefined ? undefined : 0, esi: flag('esi'), pt: flag('pt'), tds: flag('tds'), tdsFixed: v.int('tdsFixedPaise', { min: 0, max: MAX_PAISE }), uan, esicNo, pan: pan?.toUpperCase() };
}

export interface PayStaff {
  id: string; name: string; role: string; phone: string | null; payType: string; ratePaise: number;
  joinedOn: string; leftOn: string | null; active: boolean; notes: string | null; createdAt: number;
  pf: boolean; esi: boolean; pt: boolean; tds: boolean; tdsFixedPaise: number; uan: string | null; esicNo: string | null; pan: string | null;
}
/** A PAN is sealed with FIELD_KEY when one is set, so it is not readable in the database file or a stolen backup. */
const sealPan = (v: string | null): string | null => (v ? seal(v) : v);
const openPan = (v: string | null): string | null => { if (!v) return v; try { return unseal(v); } catch { return null; } };
interface StaffRow { id: string; owner_id: string; name: string; role: string; phone: string | null; pay_type: string; rate_paise: number; joined_on: string; left_on: string | null; active: number; notes: string | null; created_at: number; pf: number; esi: number; pt: number; tds: number; tds_fixed_paise: number; uan: string | null; esic_no: string | null; pan: string | null }
const toStaff = (r: StaffRow): PayStaff => ({ id: r.id, name: r.name, role: r.role, phone: r.phone, payType: r.pay_type, ratePaise: r.rate_paise, joinedOn: r.joined_on, leftOn: r.left_on, active: !!r.active, notes: r.notes, createdAt: r.created_at, pf: !!r.pf, esi: !!r.esi, pt: !!r.pt, tds: !!r.tds, tdsFixedPaise: r.tds_fixed_paise, uan: r.uan, esicNo: r.esic_no, pan: openPan(r.pan) });

export function listStaff(ownerId: string, includeInactive = true): PayStaff[] {
  return many<StaffRow>(`SELECT * FROM payroll_staff WHERE owner_id = ? AND deleted_at IS NULL ${includeInactive ? '' : 'AND active = 1'} ORDER BY active DESC, name COLLATE NOCASE`, ownerId).map(toStaff);
}
function staffOr404(ownerId: string, id: string): StaffRow {
  const r = one<StaffRow>('SELECT * FROM payroll_staff WHERE id = ? AND owner_id = ? AND deleted_at IS NULL', id, ownerId);
  if (!r) throw notFound('Staff member not found');
  return r;
}

export function createStaff(ownerId: string, actor: Actor, body: unknown): PayStaff {
  const v = new Validator(body);
  const name = v.str('name', { required: true, max: 80 }), role = v.str('role', { max: 60 }) ?? 'Staff';
  const payType = v.str('payType', { required: true }), rate = v.int('ratePaise', { required: true, min: 0, max: MAX_PAISE });
  const joinedOn = v.date('joinedOn') ?? today();
  const phone = v.str('phone', { max: 20 }), notes = v.str('notes', { max: 500 });
  if (payType && !(PAY_TYPES as readonly string[]).includes(payType)) v.fail('payType', 'Must be monthly or daily');
  const sf = statFields(v);
  v.done();
  const id = newId('pst'), t = now();
  run(`INSERT INTO payroll_staff(id, owner_id, name, role, phone, pay_type, rate_paise, joined_on, active, notes, pf, esi, pt, tds, tds_fixed_paise, uan, esic_no, pan, created_at, created_by, updated_at, updated_by) VALUES(?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, ownerId, name!, role, phone ?? null, payType!, rate!, joinedOn, notes ?? null, sf.pf ?? 0, sf.esi ?? 0, sf.pt ?? 0, sf.tds ?? 0, sf.tdsFixed ?? 0, sf.uan ?? null, sf.esicNo ?? null, sealPan(sf.pan ?? null), t, actor.id, t, actor.id);
  audit(actor, 'payroll.staff.create', 'payroll_staff', id, { name, payType, ratePaise: rate }, ownerId);
  return toStaff(staffOr404(ownerId, id));
}

export function updateStaff(ownerId: string, actor: Actor, id: string, body: unknown): PayStaff {
  const cur = staffOr404(ownerId, id);
  const v = new Validator(body);
  const name = v.str('name', { max: 80 }), role = v.str('role', { max: 60 });
  const payType = v.str('payType'), rate = v.int('ratePaise', { min: 0, max: MAX_PAISE });
  const joinedOn = v.date('joinedOn'), leftOn = v.date('leftOn');
  const phone = v.str('phone', { max: 20 }), notes = v.str('notes', { max: 500 });
  const active = v.bool('active');
  if (payType && !(PAY_TYPES as readonly string[]).includes(payType)) v.fail('payType', 'Must be monthly or daily');
  const sf = statFields(v);
  v.done();
  const b = body as Record<string, unknown>;
  const nextActive = active === undefined ? cur.active : active ? 1 : 0;
  const nextJoined = joinedOn ?? cur.joined_on;
  let nextLeft: string | null = b.leftOn === null || b.leftOn === '' ? null : leftOn ?? cur.left_on;
  if (active === false && !nextLeft && cur.active) nextLeft = today();
  if (active === true) nextLeft = null;
  if (nextLeft && nextLeft < nextJoined) throw new HttpError(400, 'VALIDATION_FAILED', 'The last day cannot be before the joining date', { fields: [{ field: 'leftOn', message: 'Before joining date' }] });
  run(`UPDATE payroll_staff SET name = ?, role = ?, phone = ?, pay_type = ?, rate_paise = ?, joined_on = ?, left_on = ?, active = ?, notes = ?, pf = ?, esi = ?, pt = ?, tds = ?, tds_fixed_paise = ?, uan = ?, esic_no = ?, pan = ?, updated_at = ?, updated_by = ? WHERE id = ?`,
    name ?? cur.name, role ?? cur.role, b.phone === '' ? null : phone ?? cur.phone, payType ?? cur.pay_type, rate ?? cur.rate_paise, nextJoined, nextLeft, nextActive,
    b.notes === '' ? null : notes ?? cur.notes, sf.pf ?? cur.pf, sf.esi ?? cur.esi, sf.pt ?? cur.pt, sf.tds ?? cur.tds, sf.tdsFixed ?? cur.tds_fixed_paise,
    b.uan === '' ? null : sf.uan ?? cur.uan, b.esicNo === '' ? null : sf.esicNo ?? cur.esic_no, b.pan === '' ? null : sf.pan ? sealPan(sf.pan) : cur.pan, now(), actor.id, id);
  audit(actor, 'payroll.staff.update', 'payroll_staff', id, { changed: Object.keys(b) }, ownerId);
  return toStaff(staffOr404(ownerId, id));
}

// ------------------------------------------------------------------ attendance

export type AttStatus = typeof ATT_STATUSES[number];
interface AttRow { staff_id: string; date: string; status: AttStatus }

function attendanceRows(ownerId: string, month: string): AttRow[] {
  return many<AttRow>('SELECT staff_id, date, status FROM payroll_attendance WHERE owner_id = ? AND date >= ? AND date <= ? AND deleted_at IS NULL', ownerId, monthStart(month), monthEnd(month));
}

/** Staff who belong in a month's payroll: joined by month end, and either still active, left during/after it, or have marks in it. */
function staffInMonth(ownerId: string, month: string): StaffRow[] {
  const from = monthStart(month), to = monthEnd(month);
  return many<StaffRow>(
    `SELECT * FROM payroll_staff s WHERE s.owner_id = ? AND s.deleted_at IS NULL AND s.joined_on <= ?
       AND (s.active = 1 OR s.left_on >= ?
            OR EXISTS (SELECT 1 FROM payroll_attendance a WHERE a.staff_id = s.id AND a.date >= ? AND a.date <= ? AND a.deleted_at IS NULL)
            OR EXISTS (SELECT 1 FROM payroll_adjustments j WHERE j.staff_id = s.id AND j.month = ? AND j.deleted_at IS NULL))
     ORDER BY s.name COLLATE NOCASE`, ownerId, to, from, from, to, month);
}

export function attendanceSheet(ownerId: string, month: string) {
  checkMonth(month);
  const rows = attendanceRows(ownerId, month);
  const marks = new Map<string, Record<string, AttStatus>>();
  for (const r of rows) { const m = marks.get(r.staff_id) ?? {}; m[r.date.slice(8)] = r.status; marks.set(r.staff_id, m); }
  const staff = staffInMonth(ownerId, month).map((s) => {
    const m = marks.get(s.id) ?? {};
    const c = { present: 0, half: 0, absent: 0, leave: 0 };
    for (const k of Object.values(m)) c[k]++;
    return { ...toStaff(s), marks: m, counts: c };
  });
  return { month, days: daysInMonth(month), locked: isLocked(ownerId, month), today: today(), staff };
}

export interface AttEntry { staffId: string; date: string; status: AttStatus | null }

export function setAttendance(ownerId: string, actor: Actor, entries: AttEntry[]): { saved: number } {
  if (!entries.length) return { saved: 0 };
  if (entries.length > 1000) throw new HttpError(400, 'VALIDATION_FAILED', 'At most 1000 marks at a time');
  const t = now();
  tx(() => {
    const months = new Set<string>();
    for (const e of entries) months.add(e.date.slice(0, 7));
    for (const m of months) assertOpen(ownerId, m);
    const cache = new Map<string, StaffRow>();
    for (const e of entries) {
      let s = cache.get(e.staffId); if (!s) { s = staffOr404(ownerId, e.staffId); cache.set(e.staffId, s); }
      if (e.date < s.joined_on) throw new HttpError(400, 'BEFORE_JOINING', `${s.name} joined on ${s.joined_on}; no attendance before that`);
      if (s.left_on && e.date > s.left_on) throw new HttpError(400, 'AFTER_LEAVING', `${s.name} left on ${s.left_on}; no attendance after that`);
      const cur = one<{ id: string }>('SELECT id FROM payroll_attendance WHERE staff_id = ? AND date = ? AND deleted_at IS NULL', e.staffId, e.date);
      if (e.status === null) { if (cur) run('UPDATE payroll_attendance SET deleted_at = ?, deleted_by = ? WHERE id = ?', t, actor.id, cur.id); }
      else if (cur) run('UPDATE payroll_attendance SET status = ?, updated_at = ?, updated_by = ? WHERE id = ?', e.status, t, actor.id, cur.id);
      else run('INSERT INTO payroll_attendance(id, owner_id, staff_id, date, status, created_at, created_by, updated_at, updated_by) VALUES(?,?,?,?,?,?,?,?,?)', newId('pat'), ownerId, e.staffId, e.date, e.status, t, actor.id, t, actor.id);
    }
  });
  audit(actor, 'payroll.attendance.set', 'payroll_attendance', null, { count: entries.length, first: entries[0] }, ownerId);
  return { saved: entries.length };
}

export function parseAttendance(body: unknown): AttEntry[] {
  const b = (body ?? {}) as Record<string, unknown>;
  const raw: unknown[] = Array.isArray(b.entries) ? b.entries : [b];
  const out: AttEntry[] = [];
  raw.forEach((x) => {
    const v = new Validator(x);
    const staffId = v.str('staffId', { required: true }), date = v.date('date', true);
    const st = (x as Record<string, unknown>).status;
    if (st !== null && !(ATT_STATUSES as readonly string[]).includes(st as string)) v.fail('status', 'Use present, half, absent, leave or null to clear');
    v.done();
    out.push({ staffId: staffId!, date: date!, status: st as AttStatus | null });
  });
  return out;
}

// ------------------------------------------------------------------ advances, deductions, bonuses

export interface Adjustment { id: string; staffId: string; staffName: string; kind: string; amountPaise: number; givenOn: string; month: string; note: string | null }
interface AdjRow { id: string; staff_id: string; staff_name: string; kind: string; amount_paise: number; given_on: string; month: string; note: string | null }
const toAdj = (r: AdjRow): Adjustment => ({ id: r.id, staffId: r.staff_id, staffName: r.staff_name, kind: r.kind, amountPaise: r.amount_paise, givenOn: r.given_on, month: r.month, note: r.note });

export function listAdjustments(ownerId: string, month: string, staffId?: string): Adjustment[] {
  checkMonth(month);
  return many<AdjRow>(
    `SELECT j.*, s.name AS staff_name FROM payroll_adjustments j JOIN payroll_staff s ON s.id = j.staff_id
     WHERE j.owner_id = ? AND j.month = ? AND j.deleted_at IS NULL ${staffId ? 'AND j.staff_id = ?' : ''} ORDER BY j.given_on, j.created_at`, ownerId, month, ...(staffId ? [staffId] : [])).map(toAdj);
}

export function addAdjustment(ownerId: string, actor: Actor, body: unknown): Adjustment {
  const v = new Validator(body);
  const staffId = v.str('staffId', { required: true }), kind = v.str('kind', { required: true });
  const amount = v.int('amountPaise', { required: true, min: 1, max: MAX_PAISE });
  const givenOn = v.date('givenOn') ?? today(), note = v.str('note', { max: 200 });
  const monthIn = v.str('month');
  if (kind && !(ADJ_KINDS as readonly string[]).includes(kind)) v.fail('kind', 'Use advance, deduction or bonus');
  if (monthIn && !/^\d{4}-(0[1-9]|1[0-2])$/.test(monthIn)) v.fail('month', 'Use YYYY-MM');
  v.done();
  const month = monthIn ?? givenOn.slice(0, 7);
  staffOr404(ownerId, staffId!);
  assertOpen(ownerId, month);
  const id = newId('pad'), t = now();
  run(`INSERT INTO payroll_adjustments(id, owner_id, staff_id, kind, amount_paise, given_on, month, note, created_at, created_by, updated_at, updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, ownerId, staffId!, kind!, amount!, givenOn, month, note ?? null, t, actor.id, t, actor.id);
  audit(actor, 'payroll.adjustment.add', 'payroll_adjustments', id, { staffId, kind, amountPaise: amount, month }, ownerId);
  return listAdjustments(ownerId, month).find((a) => a.id === id)!;
}

export function removeAdjustment(ownerId: string, actor: Actor, id: string): void {
  const r = one<{ month: string; kind: string; amount_paise: number }>('SELECT month, kind, amount_paise FROM payroll_adjustments WHERE id = ? AND owner_id = ? AND deleted_at IS NULL', id, ownerId);
  if (!r) throw notFound('Entry not found');
  assertOpen(ownerId, r.month);
  run('UPDATE payroll_adjustments SET deleted_at = ?, deleted_by = ? WHERE id = ?', now(), actor.id, id);
  audit(actor, 'payroll.adjustment.remove', 'payroll_adjustments', id, r, ownerId);
}

// ------------------------------------------------------------------ the run

export interface Line {
  id: string | null; staffId: string; staffName: string; staffRole: string; payType: string; ratePaise: number; daysInMonth: number;
  present: number; half: number; absent: number; leave: number; unmarked: number; paidDays: number;
  grossPaise: number; bonusPaise: number; advancePaise: number; deductionPaise: number; netPaise: number; shortfallPaise: number;
  paidOn: string | null; paidMethod: string | null; paidRef: string | null; paidAt: number | null; ledgerTxnId: string | null;
  pfEmployeePaise: number; pfEmployerPaise: number; pfAdminPaise: number; esiEmployeePaise: number; esiEmployerPaise: number; ptPaise: number; tdsPaise: number;
}

/** Work out each person's pay for a month from attendance and adjustments (nothing is saved). */
export function computeLines(ownerId: string, month: string): Line[] {
  const dim = daysInMonth(month), from = monthStart(month), to = monthEnd(month);
  const att = new Map<string, Record<string, AttStatus>>();
  for (const a of attendanceRows(ownerId, month)) { const m = att.get(a.staff_id) ?? {}; m[a.date] = a.status; att.set(a.staff_id, m); }
  const adj = new Map<string, { bonus: number; advance: number; deduction: number }>();
  for (const a of listAdjustments(ownerId, month)) {
    const t = adj.get(a.staffId) ?? { bonus: 0, advance: 0, deduction: 0 };
    t[a.kind as 'bonus' | 'advance' | 'deduction'] += a.amountPaise; adj.set(a.staffId, t);
  }
  return staffInMonth(ownerId, month).map((s): Line => {
    const m = att.get(s.id) ?? {};
    const c = { present: 0, half: 0, absent: 0, leave: 0 };
    for (const k of Object.values(m)) c[k]++;
    // days the person was on the books this month and still have no mark
    const cap = today() < to ? today() : to; // future days are not "unmarked" yet
    const first = s.joined_on > from ? s.joined_on : from, last = s.left_on && s.left_on < cap ? s.left_on : cap;
    let unmarked = 0;
    for (let d = first; d <= last; d = addDays(d, 1)) if (!m[d]) unmarked++;
    const units2 = c.present * 2 + c.half + (s.pay_type === 'monthly' ? c.leave * 2 : 0);
    const gross = grossFor(s.pay_type, s.rate_paise, units2, dim);
    const a = adj.get(s.id) ?? { bonus: 0, advance: 0, deduction: 0 };
    const st = statutory({ payType: s.pay_type, ratePaise: s.rate_paise, grossPaise: gross, bonusPaise: a.bonus, paidDays: units2 / 2, contractMonthlyPaise: s.pay_type === 'monthly' ? s.rate_paise : s.rate_paise * 26, pf: !!s.pf, esi: !!s.esi, pt: !!s.pt, tds: !!s.tds, tdsFixedPaise: s.tds_fixed_paise });
    const raw = gross + a.bonus - a.advance - a.deduction - st.pfEmployeePaise - st.esiEmployeePaise - st.ptPaise - st.tdsPaise;
    return {
      id: null, staffId: s.id, staffName: s.name, staffRole: s.role, payType: s.pay_type, ratePaise: s.rate_paise, daysInMonth: dim,
      ...c, unmarked, paidDays: units2 / 2, grossPaise: gross, bonusPaise: a.bonus, advancePaise: a.advance, deductionPaise: a.deduction,
      netPaise: Math.max(0, raw), shortfallPaise: Math.max(0, -raw), paidOn: null, paidMethod: null, paidRef: null, paidAt: null, ledgerTxnId: null, ...st,
    };
  });
}

interface LineRow { id: string; staff_id: string; staff_name: string; staff_role: string; pay_type: string; rate_paise: number; days_in_month: number; present: number; half: number; absent: number; leave: number; unmarked: number; paid_units2: number; gross_paise: number; bonus_paise: number; advance_paise: number; deduction_paise: number; net_paise: number; shortfall_paise: number; paid_on: string | null; paid_method: string | null; paid_ref: string | null; paid_at: number | null; ledger_txn_id: string | null; pf_employee_paise: number; pf_employer_paise: number; pf_admin_paise: number; esi_employee_paise: number; esi_employer_paise: number; pt_paise: number; tds_paise: number }
const toLine = (r: LineRow): Line => ({
  id: r.id, staffId: r.staff_id, staffName: r.staff_name, staffRole: r.staff_role, payType: r.pay_type, ratePaise: r.rate_paise, daysInMonth: r.days_in_month,
  present: r.present, half: r.half, absent: r.absent, leave: r.leave, unmarked: r.unmarked, paidDays: r.paid_units2 / 2,
  grossPaise: r.gross_paise, bonusPaise: r.bonus_paise, advancePaise: r.advance_paise, deductionPaise: r.deduction_paise, netPaise: r.net_paise, shortfallPaise: r.shortfall_paise,
  paidOn: r.paid_on, paidMethod: r.paid_method, paidRef: r.paid_ref, paidAt: r.paid_at, ledgerTxnId: r.ledger_txn_id,
  pfEmployeePaise: r.pf_employee_paise, pfEmployerPaise: r.pf_employer_paise, pfAdminPaise: r.pf_admin_paise, esiEmployeePaise: r.esi_employee_paise, esiEmployerPaise: r.esi_employer_paise, ptPaise: r.pt_paise, tdsPaise: r.tds_paise,
});
const storedLines = (runId: string): Line[] => many<LineRow>('SELECT * FROM payroll_lines WHERE run_id = ? AND deleted_at IS NULL ORDER BY staff_name COLLATE NOCASE', runId).map(toLine);

export function summarise(lines: Line[]) {
  const s = { headcount: lines.length, grossPaise: 0, bonusPaise: 0, advancePaise: 0, deductionPaise: 0, netPaise: 0, paidPaise: 0, outstandingPaise: 0, paidCount: 0, unmarkedDays: 0, presentDays: 0, absentDays: 0, leaveDays: 0, shortfallPaise: 0, pfPaise: 0, pfEmployerPaise: 0, esiPaise: 0, esiEmployerPaise: 0, ptPaise: 0, tdsPaise: 0 };
  for (const l of lines) {
    s.grossPaise += l.grossPaise; s.bonusPaise += l.bonusPaise; s.advancePaise += l.advancePaise; s.deductionPaise += l.deductionPaise; s.netPaise += l.netPaise; s.shortfallPaise += l.shortfallPaise;
    if (l.paidOn) { s.paidPaise += l.netPaise; s.paidCount++; } else s.outstandingPaise += l.netPaise;
    s.pfPaise += l.pfEmployeePaise; s.pfEmployerPaise += l.pfEmployerPaise + l.pfAdminPaise; s.esiPaise += l.esiEmployeePaise; s.esiEmployerPaise += l.esiEmployerPaise; s.ptPaise += l.ptPaise; s.tdsPaise += l.tdsPaise;
    s.unmarkedDays += l.unmarked; s.presentDays += l.present + l.half / 2; s.absentDays += l.absent; s.leaveDays += l.leave;
  }
  return s;
}

/** A month's payroll: the frozen figures when finalised, otherwise worked out live. */
export function getRun(ownerId: string, month: string) {
  checkMonth(month);
  const run_ = runFor(ownerId, month);
  const lines = run_ ? storedLines(run_.id) : computeLines(ownerId, month);
  return {
    month, status: run_ ? 'final' : pendingFor(ownerId, 'payroll', month) ? 'waiting' : 'open', locked: !!run_, finalisedAt: run_?.finalised_at ?? null, finalisedBy: run_?.finalised_by ?? null,
    lines, summary: summarise(lines),
  };
}

export function listRuns(ownerId: string, limit = 12) {
  const runs = many<{ id: string; month: string; finalised_at: number }>('SELECT id, month, finalised_at FROM payroll_runs WHERE owner_id = ? AND deleted_at IS NULL ORDER BY month DESC LIMIT ?', ownerId, limit);
  return runs.map((r) => ({ month: r.month, finalisedAt: r.finalised_at, ...summarise(storedLines(r.id)) }));
}

export function finaliseRun(ownerId: string, actor: Actor, month: string) {
  checkMonth(month);
  if (month > today().slice(0, 7)) throw new HttpError(400, 'FUTURE_MONTH', 'A month cannot be finalised before it has started');
  tx(() => {
    if (isLocked(ownerId, month)) throw conflict('MONTH_LOCKED', 'This month is already finalised');
    const lines = computeLines(ownerId, month);
    if (!lines.length) throw new HttpError(400, 'NO_STAFF', 'There is nobody on the payroll for this month');
    const id = newId('prn'), t = now();
    run('INSERT INTO payroll_runs(id, owner_id, month, finalised_at, finalised_by, created_at, created_by, updated_at, updated_by) VALUES(?,?,?,?,?,?,?,?,?)', id, ownerId, month, t, actor.id, t, actor.id, t, actor.id);
    for (const l of lines) {
      run(`INSERT INTO payroll_lines(id, owner_id, run_id, month, staff_id, staff_name, staff_role, pay_type, rate_paise, days_in_month, present, half, absent, leave, unmarked, paid_units2, gross_paise, bonus_paise, advance_paise, deduction_paise, net_paise, shortfall_paise, pf_employee_paise, pf_employer_paise, pf_admin_paise, esi_employee_paise, esi_employer_paise, pt_paise, tds_paise, created_at, created_by, updated_at, updated_by)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        newId('pln'), ownerId, id, month, l.staffId, l.staffName, l.staffRole, l.payType, l.ratePaise, l.daysInMonth, l.present, l.half, l.absent, l.leave, l.unmarked, Math.round(l.paidDays * 2),
        l.grossPaise, l.bonusPaise, l.advancePaise, l.deductionPaise, l.netPaise, l.shortfallPaise,
        l.pfEmployeePaise, l.pfEmployerPaise, l.pfAdminPaise, l.esiEmployeePaise, l.esiEmployerPaise, l.ptPaise, l.tdsPaise, t, actor.id, t, actor.id);
    }
  });
  audit(actor, 'payroll.finalise', 'payroll_runs', null, { month }, ownerId);
  return getRun(ownerId, month);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthWords = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/** The owner asks to lock a month. With no sign-off step in the pay-run rules (the default) it is finalised at once;
 * otherwise it waits on the Approvals board and is finalised when the last step signs. */
export function requestFinalise(ownerId: string, actor: Actor, month: string) {
  checkMonth(month);
  if (month > today().slice(0, 7)) throw new HttpError(400, 'FUTURE_MONTH', 'A month cannot be finalised before it has started');
  if (isLocked(ownerId, month)) throw conflict('MONTH_LOCKED', 'This month is already finalised');
  if (pendingFor(ownerId, 'payroll', month)) throw conflict('WAITING', 'This month is already waiting for sign-off');
  const lines = computeLines(ownerId, month);
  if (!lines.length) throw new HttpError(400, 'NO_STAFF', 'There is nobody on the payroll for this month');
  const net = summarise(lines).netPaise;
  const started = tx(() => {
    const r = startRequest(ownerId, 'payroll', month, { title: `Staff pay · ${monthWords(month)}`, amountPaise: net, submittedBy: actor.id });
    if (r) audit(actor, 'payroll.submit', 'payroll_runs', month, { month, netPaise: net, headcount: lines.length }, ownerId);
    return !!r;
  });
  return started ? getRun(ownerId, month) : finaliseRun(ownerId, actor, month);
}

/** The last sign-off locks the month, as long as the figures are still the ones that were sent. */
export function finaliseApproved(ownerId: string, actor: Actor, month: string, sentNetPaise: number) {
  const net = summarise(computeLines(ownerId, month)).netPaise;
  if (net !== sentNetPaise) throw conflict('FIGURES_CHANGED', 'The pay figures changed after this was sent. Send it back so the owner can check and send it again.');
  return finaliseRun(ownerId, actor, month);
}

export function withdrawFinalise(ownerId: string, actor: Actor, month: string) {
  checkMonth(month);
  if (!pendingFor(ownerId, 'payroll', month)) throw notFound('This month is not waiting for sign-off');
  withdrawRequest(ownerId, 'payroll', month);
  audit(actor, 'payroll.withdraw', 'payroll_runs', month, { month }, ownerId);
  return getRun(ownerId, month);
}

export function reopenRun(ownerId: string, actor: Actor, month: string) {
  checkMonth(month);
  const r = runFor(ownerId, month);
  if (!r) throw notFound('This month is not finalised');
  if (one('SELECT 1 FROM payroll_lines WHERE run_id = ? AND paid_on IS NOT NULL AND deleted_at IS NULL', r.id)) throw conflict('HAS_PAYMENTS', 'Some salaries are already marked paid. Undo those payments before reopening the month.');
  const t = now();
  tx(() => {
    run('UPDATE payroll_lines SET deleted_at = ?, deleted_by = ? WHERE run_id = ?', t, actor.id, r.id);
    run('UPDATE payroll_runs SET deleted_at = ?, deleted_by = ? WHERE id = ?', t, actor.id, r.id);
  });
  audit(actor, 'payroll.reopen', 'payroll_runs', r.id, { month }, ownerId);
  return getRun(ownerId, month);
}

function lineOr404(ownerId: string, month: string, lineId: string): LineRow {
  const r = one<LineRow>('SELECT * FROM payroll_lines WHERE id = ? AND owner_id = ? AND month = ? AND deleted_at IS NULL', lineId, ownerId, month);
  if (!r) throw notFound('Salary line not found. Finalise the month first.');
  return r;
}

/** The salary line as it now stands, plus what happened in the books: `ledger` is null when the owner has no cash/bank account yet (nothing was posted). */
export function markPaid(ownerId: string, actor: Actor, month: string, lineId: string, body: unknown): Line & { ledger: LedgerRef | null } {
  checkMonth(month);
  const l = lineOr404(ownerId, month, lineId);
  const v = new Validator(body);
  const paidOn = v.date('paidOn') ?? today(), method = v.str('method', { required: true }), ref = v.str('reference', { max: 80 });
  if (method && !(METHODS as readonly string[]).includes(method)) v.fail('method', 'Use cash, upi, bank, cheque or other');
  v.done();
  if (l.paid_on) throw conflict('ALREADY_PAID', 'This salary is already marked paid');
  const t = now();
  // One transaction: if the books refuse (signed-off month: 409 PERIOD_LOCKED) the salary stays unpaid.
  const ledger = tx(() => {
    const posted = postToLedger(ownerId, actor, { date: paidOn, amountPaise: -l.net_paise, description: `Salary ${month} ${l.staff_name}`, categoryCode: 'salaries', method: method!, reference: ref });
    run('UPDATE payroll_lines SET paid_on = ?, paid_method = ?, paid_ref = ?, paid_at = ?, paid_by = ?, ledger_txn_id = ?, updated_at = ?, updated_by = ? WHERE id = ?', paidOn, method!, ref ?? null, t, actor.id, posted?.transactionId ?? null, t, actor.id, lineId);
    return posted;
  });
  audit(actor, 'payroll.pay', 'payroll_lines', lineId, { month, staffId: l.staff_id, netPaise: l.net_paise, method, paidOn, ledgerTxnId: ledger?.transactionId ?? null }, ownerId);
  return { ...toLine(lineOr404(ownerId, month, lineId)), ledger };
}

export function unmarkPaid(ownerId: string, actor: Actor, month: string, lineId: string): Line {
  checkMonth(month);
  const l = lineOr404(ownerId, month, lineId);
  if (!l.paid_on) throw conflict('NOT_PAID', 'This salary is not marked paid');
  tx(() => {
    removeFromLedger(ownerId, actor, l.ledger_txn_id); // 409 PERIOD_LOCKED if that month is signed off
    run('UPDATE payroll_lines SET paid_on = NULL, paid_method = NULL, paid_ref = NULL, paid_at = NULL, paid_by = NULL, ledger_txn_id = NULL, updated_at = ?, updated_by = ? WHERE id = ?', now(), actor.id, lineId);
  });
  audit(actor, 'payroll.unpay', 'payroll_lines', lineId, { month, staffId: l.staff_id, was: { paidOn: l.paid_on, method: l.paid_method, ledgerTxnId: l.ledger_txn_id } }, ownerId);
  return toLine(lineOr404(ownerId, month, lineId));
}

// ------------------------------------------------------------------ payslip

export function payslip(ownerId: string, month: string, staffId: string) {
  const r = getRun(ownerId, month);
  const line = r.lines.find((l) => l.staffId === staffId);
  if (!line) throw notFound('That person is not on the payroll for this month');
  const st = one<StaffRow>('SELECT * FROM payroll_staff WHERE id = ? AND owner_id = ?', staffId, ownerId);
  const marks: Record<string, AttStatus> = {};
  for (const a of attendanceRows(ownerId, month)) if (a.staff_id === staffId) marks[a.date.slice(8)] = a.status;
  const biz = one<{ business_name: string | null; name: string }>('SELECT business_name, name FROM users WHERE id = ?', ownerId);
  return {
    month, status: r.status, finalisedAt: r.finalisedAt, employer: biz?.business_name || biz?.name || 'Daji Cricket Ground',
    staff: st ? { name: st.name, role: st.role, phone: st.phone, joinedOn: st.joined_on, uan: st.uan, esicNo: st.esic_no, pan: openPan(st.pan) } : { name: line.staffName, role: line.staffRole, phone: null, joinedOn: null, uan: null, esicNo: null, pan: null },
    line, marks, adjustments: listAdjustments(ownerId, month, staffId),
  };
}

// ------------------------------------------------------------------ month summary

export function summary(ownerId: string, month: string) {
  const cur = getRun(ownerId, month);
  const [y, m] = month.split('-').map(Number);
  const prev = new Date(Date.UTC(y!, m! - 2, 1)).toISOString().slice(0, 7);
  const prevRun = runFor(ownerId, prev);
  const outstandingAll = many<{ net: number }>('SELECT net_paise AS net FROM payroll_lines WHERE owner_id = ? AND deleted_at IS NULL AND paid_on IS NULL', ownerId).reduce((a, b) => a + b.net, 0);
  return {
    month, status: cur.status, ...cur.summary,
    activeStaff: listStaff(ownerId, false).length,
    previousNetPaise: prevRun ? summarise(storedLines(prevRun.id)).netPaise : null,
    allOutstandingPaise: outstandingAll,
  };
}

// ------------------------------------------------------------------ statutory dues

/** What is owed to the PF office, ESIC, the Gujarat PT office and the tax department for a month, with the usual due dates. */
export function statutoryDues(ownerId: string, month: string) {
  const r = getRun(ownerId, month);
  const t = summarise(r.lines);
  const [y, m] = month.split('-').map(Number);
  const nx = new Date(Date.UTC(y!, m!, 1)); // first of next month
  const ym = nx.toISOString().slice(0, 7);
  const due = (d: number) => `${ym}-${String(d).padStart(2, '0')}`;
  const tdsDue = m === 3 ? `${y}-04-30` : due(7); // March TDS is due on 30 April, every other month on the 7th
  return {
    month, status: r.status, rulesCheckedOn: STATUTORY_RULES_CHECKED,
    esi: { employeePaise: t.esiPaise, employerPaise: t.esiEmployerPaise, totalPaise: t.esiPaise + t.esiEmployerPaise, dueOn: due(15), where: 'ESIC portal' },
    pt: { totalPaise: t.ptPaise, dueOn: due(15), where: 'Gujarat Professional Tax (GSTN-linked portal)' },
    tds: { totalPaise: t.tdsPaise, dueOn: tdsDue, where: 'TRACES / Income Tax challan 281 (code 92B)' },
    lines: r.lines.map((l) => ({ staffId: l.staffId, name: l.staffName, pfEmployeePaise: l.pfEmployeePaise, pfEmployerPaise: l.pfEmployerPaise + l.pfAdminPaise, esiEmployeePaise: l.esiEmployeePaise, esiEmployerPaise: l.esiEmployerPaise, ptPaise: l.ptPaise, tdsPaise: l.tdsPaise })),
    note: r.status === 'final' ? null : 'Month still open: these figures can change until you finalise.',
  };
}
