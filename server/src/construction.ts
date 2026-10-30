import { many, one, registerSchema, run, tx } from './db.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { audit, type Actor } from './audit.ts';
import { HttpError, conflict, forbidden, notFound } from './errors.ts';
import { Validator } from './input.ts';
import { hasPermission, type UserRow } from './auth.ts';
import { areaFilter, canSeeArea } from './areas.ts';
import { createProject } from './taskboard.ts';
import { createBill, submitBill } from './accounting/bills.ts';
import { sendBack, signStep, startRequest, withdrawRequest, type ReqRow } from './approvals.ts';
import { istDate } from './time.ts';

// Construction inside Daji Admin (redesign step 8, 30 Oct 2026). The separate Construction package (its own PostgreSQL server
// and sign-in, never deployed) is folded into this server instead of being run beside it, so a construction project is the
// same `projects` row the task board, Supervisor Cash and branches already use: one record, more views. This module adds
// what a building job needs on top of it: a bill of quantities, purchase and work orders, goods received, measurements and
// running-account (RA) bills, defects, and the drawings and documents of the project.
//
// Money goes through what Daji already has, never a second set of books. Suppliers are the vendors of the books, an order is
// approved on the Approvals board (kind "purchase_order"), a supplier invoice is a bill (accounting/bills.ts) linked to its
// order, and a certified RA bill becomes a bill for its net amount. Bills are approved and paid where they always are, so
// Revenue & Accounting holds every rupee once. Rules carried over from the package: amounts exact to the paisa (half up per
// line), no receipt beyond what was ordered, a measurement is paid once, retention capped by the order, and a certified
// measurement or RA bill can never change, even by direct SQL. Quantities are kept as thousandths (12.5 m = 12500).

registerSchema('construction-1', `
CREATE TABLE construction_projects (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  code TEXT NOT NULL,
  site TEXT,
  phase TEXT NOT NULL DEFAULT 'planning' CHECK (phase IN ('planning','active','on_hold','completed')),
  start_date TEXT,
  target_end_date TEXT,
  retention_bps INTEGER NOT NULL DEFAULT 0 CHECK (retention_bps BETWEEN 0 AND 2000),
  created_at INTEGER NOT NULL,
  created_by TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);
CREATE UNIQUE INDEX ux_construction_projects_code ON construction_projects(owner_id, code);

CREATE TABLE boq_items (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  item_code TEXT NOT NULL,
  description TEXT NOT NULL,
  unit TEXT NOT NULL,
  qty_milli INTEGER NOT NULL CHECK (qty_milli >= 0),
  rate_paise INTEGER NOT NULL CHECK (rate_paise >= 0),
  revision INTEGER NOT NULL DEFAULT 1,
  supersedes_id TEXT REFERENCES boq_items(id),
  current INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  UNIQUE (project_id, item_code, revision)
);
CREATE INDEX ix_boq_items_project ON boq_items(project_id, current);

CREATE TABLE purchase_orders (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  vendor_id TEXT NOT NULL REFERENCES acct_vendors(id),
  po_no TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('supply','work')),
  status TEXT NOT NULL CHECK (status IN ('draft','pending_approval','approved','partly_received','received','closed','cancelled')),
  subtotal_paise INTEGER NOT NULL,
  tax_paise INTEGER NOT NULL,
  total_paise INTEGER NOT NULL,
  retention_bps INTEGER NOT NULL DEFAULT 0 CHECK (retention_bps BETWEEN 0 AND 2000),
  expected_date TEXT,
  notes TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  submitted_at INTEGER,
  decided_at INTEGER,
  decided_by TEXT,
  decided_note TEXT,
  cancelled_reason TEXT,
  updated_at INTEGER NOT NULL,
  UNIQUE (project_id, po_no)
);
CREATE INDEX ix_purchase_orders_project ON purchase_orders(owner_id, project_id, status);

CREATE TABLE po_lines (
  id TEXT PRIMARY KEY,
  po_id TEXT NOT NULL REFERENCES purchase_orders(id),
  boq_item_id TEXT REFERENCES boq_items(id),
  position INTEGER NOT NULL,
  description TEXT NOT NULL,
  unit TEXT NOT NULL,
  qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),
  rate_paise INTEGER NOT NULL CHECK (rate_paise >= 0),
  tax_bps INTEGER NOT NULL DEFAULT 0 CHECK (tax_bps BETWEEN 0 AND 10000),
  amount_paise INTEGER NOT NULL,
  tax_paise INTEGER NOT NULL
);
CREATE INDEX ix_po_lines_po ON po_lines(po_id);

CREATE TABLE goods_receipts (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  po_id TEXT NOT NULL REFERENCES purchase_orders(id),
  grn_no TEXT NOT NULL,
  received_date TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  UNIQUE (project_id, grn_no)
);
CREATE INDEX ix_goods_receipts_po ON goods_receipts(po_id);
CREATE TABLE goods_receipt_lines (
  grn_id TEXT NOT NULL REFERENCES goods_receipts(id),
  po_line_id TEXT NOT NULL REFERENCES po_lines(id),
  received_milli INTEGER NOT NULL CHECK (received_milli > 0),
  rejected_milli INTEGER NOT NULL DEFAULT 0 CHECK (rejected_milli >= 0),
  rejection_reason TEXT,
  CHECK (rejected_milli <= received_milli),
  PRIMARY KEY (grn_id, po_line_id)
);
CREATE INDEX ix_goods_receipt_lines_line ON goods_receipt_lines(po_line_id);

CREATE TABLE measurements (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  po_id TEXT NOT NULL REFERENCES purchase_orders(id),
  po_line_id TEXT NOT NULL REFERENCES po_lines(id),
  measured_date TEXT NOT NULL,
  qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),
  location TEXT,
  notes TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  supersedes_id TEXT UNIQUE REFERENCES measurements(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','billed','certified','superseded')),
  created_at INTEGER NOT NULL,
  created_by TEXT
);
CREATE INDEX ix_measurements_po ON measurements(po_id, status);

CREATE TABLE ra_bills (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  po_id TEXT NOT NULL REFERENCES purchase_orders(id),
  bill_no TEXT NOT NULL,
  sequence_no INTEGER NOT NULL CHECK (sequence_no >= 1),
  gross_paise INTEGER NOT NULL CHECK (gross_paise >= 0),
  tax_paise INTEGER NOT NULL CHECK (tax_paise >= 0),
  retention_paise INTEGER NOT NULL DEFAULT 0 CHECK (retention_paise >= 0),
  advance_recovery_paise INTEGER NOT NULL DEFAULT 0 CHECK (advance_recovery_paise >= 0),
  other_deduction_paise INTEGER NOT NULL DEFAULT 0 CHECK (other_deduction_paise >= 0),
  net_paise INTEGER NOT NULL CHECK (net_paise >= 0),
  adjustments TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','certified','cancelled')),
  version INTEGER NOT NULL DEFAULT 1,
  acct_bill_id TEXT REFERENCES acct_bills(id),
  created_at INTEGER NOT NULL,
  created_by TEXT,
  certified_at INTEGER,
  certified_by TEXT,
  UNIQUE (project_id, bill_no),
  UNIQUE (po_id, sequence_no),
  CHECK (net_paise = gross_paise + tax_paise - retention_paise - advance_recovery_paise - other_deduction_paise),
  CHECK ((status = 'certified') = (certified_at IS NOT NULL))
);
CREATE TABLE ra_bill_lines (
  ra_bill_id TEXT NOT NULL REFERENCES ra_bills(id),
  measurement_id TEXT NOT NULL UNIQUE REFERENCES measurements(id),
  rate_paise INTEGER NOT NULL,
  tax_bps INTEGER NOT NULL,
  amount_paise INTEGER NOT NULL,
  tax_paise INTEGER NOT NULL,
  PRIMARY KEY (ra_bill_id, measurement_id)
);

-- A certified measurement or RA bill is final: nothing can change or remove it, not even a direct SQL statement. The trg_ao_
-- prefix lets the restore and test tooling lift these guards the way it lifts the other append-only ones (appendOnly.ts).
CREATE TRIGGER trg_ao_measurements_certified_update BEFORE UPDATE ON measurements WHEN OLD.status = 'certified'
BEGIN SELECT RAISE(ABORT, 'a certified measurement cannot be changed'); END;
CREATE TRIGGER trg_ao_measurements_certified_delete BEFORE DELETE ON measurements WHEN OLD.status = 'certified'
BEGIN SELECT RAISE(ABORT, 'a certified measurement cannot be removed'); END;
CREATE TRIGGER trg_ao_ra_bills_certified_update BEFORE UPDATE ON ra_bills WHEN OLD.status = 'certified'
BEGIN SELECT RAISE(ABORT, 'a certified RA bill cannot be changed'); END;
CREATE TRIGGER trg_ao_ra_bills_certified_delete BEFORE DELETE ON ra_bills WHEN OLD.status = 'certified'
BEGIN SELECT RAISE(ABORT, 'a certified RA bill cannot be removed'); END;

-- Supplier invoices are bills in the books; this says which project and order each one belongs to.
CREATE TABLE construction_bills (
  bill_id TEXT PRIMARY KEY REFERENCES acct_bills(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  po_id TEXT REFERENCES purchase_orders(id),
  ra_bill_id TEXT REFERENCES ra_bills(id),
  created_at INTEGER NOT NULL,
  created_by TEXT
);
CREATE INDEX ix_construction_bills_po ON construction_bills(po_id);
CREATE INDEX ix_construction_bills_project ON construction_bills(project_id);

CREATE TABLE construction_defects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  location TEXT,
  severity TEXT NOT NULL CHECK (severity IN ('minor','major','critical')),
  vendor_id TEXT REFERENCES acct_vendors(id),
  status TEXT NOT NULL CHECK (status IN ('open','fixed','closed')),
  note TEXT,
  raised_at INTEGER NOT NULL,
  raised_by TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);
CREATE INDEX ix_construction_defects_project ON construction_defects(project_id, status);

-- Drawings and documents are documents of the business (docs.ts), linked here to a project. A new revision of a drawing
-- number replaces the earlier one as current; the earlier one stays on file.
CREATE TABLE construction_docs (
  doc_id TEXT NOT NULL REFERENCES docs(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('drawing','document')),
  title TEXT NOT NULL,
  drawing_no TEXT,
  revision TEXT,
  current INTEGER NOT NULL DEFAULT 1,
  linked_at INTEGER NOT NULL,
  linked_by TEXT,
  PRIMARY KEY (doc_id, project_id)
);
CREATE INDEX ix_construction_docs_project ON construction_docs(project_id, kind, current);
`);

// ------------------------------------------------------------------ access

/** Who works on construction: the owner, and team members who run jobs, keep the books or see the reports. */
export const seesConstruction = (u: UserRow): boolean => u.role === 'owner' || u.role === 'super_admin' || hasPermission(u, 'manage_tasks') || hasPermission(u, 'manage_accounting') || hasPermission(u, 'view_reports');
/** Rates, order values, invoices and payments: the owner, the books, and anyone allowed to see revenue. Others see quantities only. */
export const seesMoney = (u: UserRow): boolean => u.role === 'owner' || u.role === 'super_admin' || hasPermission(u, 'manage_accounting') || hasPermission(u, 'view_revenue');
/** Running the site: projects, BOQ, orders, receipts, measurements, defects and drawings. */
const runsSite = (u: UserRow): boolean => hasPermission(u, 'manage_tasks');
/** Supplier invoices and RA bill certification put money in the books. */
const keepsBooks = (u: UserRow): boolean => hasPermission(u, 'manage_accounting');

const actorOf = (u: UserRow): Actor => ({ id: u.id, role: u.role });
const need = (ok: boolean, perm: string) => { if (!ok) throw forbidden(`This needs the "${perm}" permission`); };
const nameOf = (id: string | null): string | null => (id ? one<{ name: string }>('SELECT name FROM users WHERE id = ?', id)?.name ?? null : null);

export function mustSee(u: UserRow): void { if (!seesConstruction(u)) throw forbidden('Construction needs the "manage_tasks", "manage_accounting" or "view_reports" permission'); }

interface ProjRow { id: string; owner_id: string; name: string; details: string | null; status: 'active' | 'archived'; area_id: string | null }
interface CpRow { project_id: string; owner_id: string; code: string; site: string | null; phase: Phase; start_date: string | null; target_end_date: string | null; retention_bps: number }

/** A construction project this person may see. Another business's, a hidden branch's, or a plain project is the same 404. */
function cproject(u: UserRow, ownerId: string, id: string): { p: ProjRow; c: CpRow } {
  mustSee(u);
  const p = one<ProjRow>('SELECT * FROM projects WHERE id = ? AND owner_id = ?', id, ownerId);
  const c = p ? one<CpRow>('SELECT * FROM construction_projects WHERE project_id = ?', id) : undefined;
  if (!p || !c || !canSeeArea(u, ownerId, p.area_id)) throw notFound('Project not found');
  return { p, c };
}

// ------------------------------------------------------------------ quantities and money

/** A quantity as thousandths, from a number or text with at most three decimals: 12.5 → 12500. Never through a float sum. */
function milli(v: Validator, key: string, o: { required?: boolean; positive?: boolean } = {}): number | undefined {
  const raw = v.src[key];
  if (raw === undefined || raw === null || raw === '') { if (o.required) v.fail(key, 'Required'); return undefined; }
  const s = typeof raw === 'number' ? (Number.isFinite(raw) ? String(raw) : '') : typeof raw === 'string' ? raw.trim() : '';
  const m = /^(\d{1,12})(?:\.(\d{1,3}))?$/.exec(s);
  if (!m) { v.fail(key, 'Must be a quantity like 12 or 12.5 (at most 3 decimals)'); return undefined; }
  const n = Number(m[1]) * 1000 + Number((m[2] ?? '').padEnd(3, '0'));
  if (!Number.isSafeInteger(n)) { v.fail(key, 'Too large'); return undefined; }
  if (o.positive && n <= 0) { v.fail(key, 'Must be more than 0'); return undefined; }
  return n;
}
export const qtyText = (m: number): string => (m % 1000 === 0 ? String(m / 1000) : (m / 1000).toFixed(3).replace(/0+$/, ''));
/** quantity × rate, half up to the paisa, in exact integers. */
export const lineAmount = (qtyMilli: number, ratePaise: number): number => Number((BigInt(qtyMilli) * BigInt(ratePaise) + 500n) / 1000n);
/** tax on an amount at basis points (1800 = 18%), half up to the paisa. */
export const taxOn = (amountPaise: number, bps: number): number => Number((BigInt(amountPaise) * BigInt(bps) + 5000n) / 10000n);
const MAX_PAISE = 1_000_000_000_00; // ₹1,000 crore on one line or order

const PHASES = ['planning', 'active', 'on_hold', 'completed'] as const;
type Phase = (typeof PHASES)[number];
const today = () => istDate(now());

// ------------------------------------------------------------------ projects

export interface FiguresOut {
  budgetPaise: number; committedPaise: number; receivedPaise: number; measuredPaise: number; billedPaise: number; approvedBillsPaise: number; paidPaise: number;
  outstandingPaise: number; retentionHeldPaise: number; remainingBudgetPaise: number; overBudget: boolean;
}
export interface CProjectOut {
  id: string; name: string; details: string | null; code: string; site: string | null; phase: Phase; startDate: string | null; targetEndDate: string | null;
  areaId: string | null; areaName: string | null; retentionPct: number; archived: boolean;
  counts: { boqItems: number; orders: number; ordersWaiting: number; openDefects: number; drawings: number; jobs: number; jobsDone: number; milestones: number; milestonesOverdue: number };
  /** null when this person may not see money (quantities only) */
  figures: FiguresOut | null;
}

const COMMITTED = "('approved','partly_received','received','closed')";

/** Every money figure of a project, each from its own source record, so "Explain this number" can point at the rows. */
export function figuresOf(projectId: string): FiguresOut {
  const n = (sql: string, ...p: (string | number)[]) => one<{ s: number }>(sql, ...p)!.s;
  const budget = many<{ qty_milli: number; rate_paise: number }>('SELECT qty_milli, rate_paise FROM boq_items WHERE project_id = ? AND current = 1', projectId).reduce((s, b) => s + lineAmount(b.qty_milli, b.rate_paise), 0);
  const committed = n(`SELECT COALESCE(SUM(subtotal_paise), 0) s FROM purchase_orders WHERE project_id = ? AND status IN ${COMMITTED}`, projectId);
  // goods accepted on site (received less rejected) at the order rate, before tax
  const received = many<{ q: number; rate_paise: number }>(`SELECT SUM(g.received_milli - g.rejected_milli) q, l.rate_paise FROM goods_receipt_lines g JOIN po_lines l ON l.id = g.po_line_id
      JOIN purchase_orders o ON o.id = l.po_id WHERE o.project_id = ? GROUP BY l.id`, projectId).reduce((s, r) => s + lineAmount(r.q, r.rate_paise), 0);
  const measured = many<{ q: number; rate_paise: number }>(`SELECT SUM(m.qty_milli) q, l.rate_paise FROM measurements m JOIN po_lines l ON l.id = m.po_line_id
      WHERE m.project_id = ? AND m.status != 'superseded' GROUP BY l.id`, projectId).reduce((s, r) => s + lineAmount(r.q, r.rate_paise), 0);
  const bills = (status: string) => n(`SELECT COALESCE(SUM(b.amount_paise), 0) s FROM construction_bills cb JOIN acct_bills b ON b.id = cb.bill_id WHERE cb.project_id = ? AND b.deleted_at IS NULL AND b.status IN ${status}`, projectId);
  const billed = bills("('draft','pending_approval','approved','paid')");
  const approved = bills("('approved','paid')");
  const paid = bills("('paid')");
  const retention = n("SELECT COALESCE(SUM(retention_paise), 0) s FROM ra_bills WHERE project_id = ? AND status = 'certified'", projectId);
  return { budgetPaise: budget, committedPaise: committed, receivedPaise: received, measuredPaise: measured, billedPaise: billed, approvedBillsPaise: approved, paidPaise: paid,
    outstandingPaise: approved - paid, retentionHeldPaise: retention, remainingBudgetPaise: budget - committed, overBudget: budget > 0 && committed > budget };
}

function projectOut(u: UserRow, p: ProjRow, c: CpRow): CProjectOut {
  const n = (sql: string, ...a: (string | number)[]) => one<{ n: number }>(sql, ...a)!.n;
  const t = today();
  return {
    id: p.id, name: p.name, details: p.details, code: c.code, site: c.site, phase: c.phase, startDate: c.start_date, targetEndDate: c.target_end_date,
    areaId: p.area_id, areaName: p.area_id ? one<{ name: string }>('SELECT name FROM areas WHERE id = ?', p.area_id)?.name ?? null : null,
    retentionPct: c.retention_bps / 100, archived: p.status === 'archived',
    counts: {
      boqItems: n('SELECT COUNT(*) n FROM boq_items WHERE project_id = ? AND current = 1', p.id),
      orders: n("SELECT COUNT(*) n FROM purchase_orders WHERE project_id = ? AND status != 'cancelled'", p.id),
      ordersWaiting: n("SELECT COUNT(*) n FROM purchase_orders WHERE project_id = ? AND status = 'pending_approval'", p.id),
      openDefects: n("SELECT COUNT(*) n FROM construction_defects WHERE project_id = ? AND status != 'closed'", p.id),
      drawings: n("SELECT COUNT(*) n FROM construction_docs d JOIN docs x ON x.id = d.doc_id WHERE d.project_id = ? AND d.kind = 'drawing' AND d.current = 1 AND x.deleted_at IS NULL", p.id),
      jobs: n("SELECT COUNT(*) n FROM tasks WHERE project_id = ? AND status != 'cancelled'", p.id),
      jobsDone: n("SELECT COUNT(*) n FROM tasks WHERE project_id = ? AND status = 'done'", p.id),
      milestones: n('SELECT COUNT(*) n FROM milestones WHERE project_id = ?', p.id),
      milestonesOverdue: n('SELECT COUNT(*) n FROM milestones WHERE project_id = ? AND done_at IS NULL AND due_date IS NOT NULL AND due_date < ?', p.id, t),
    },
    figures: seesMoney(u) ? figuresOf(p.id) : null,
  };
}

/** The Construction portfolio: every construction project this person may see, and (for managers) the plain projects that could become one. */
export function portfolio(u: UserRow, ownerId: string): { items: CProjectOut[]; canManage: boolean; seesMoney: boolean; candidates: { id: string; name: string; areaName: string | null }[]; totals: FiguresOut | null } {
  mustSee(u);
  const f = areaFilter(u, ownerId, 'p.area_id');
  const rows = many<ProjRow & CpRow>(`SELECT p.*, c.* FROM projects p JOIN construction_projects c ON c.project_id = p.id WHERE p.owner_id = ? AND ${f.sql}
    ORDER BY p.status, CASE c.phase WHEN 'active' THEN 0 WHEN 'planning' THEN 1 WHEN 'on_hold' THEN 2 ELSE 3 END, p.name`, ownerId, ...f.params);
  const items = rows.map((r) => projectOut(u, r, r));
  const candidates = runsSite(u) ? many<{ id: string; name: string; area: string | null }>(`SELECT p.id, p.name, a.name area FROM projects p LEFT JOIN areas a ON a.id = p.area_id
      WHERE p.owner_id = ? AND p.status = 'active' AND ${f.sql} AND NOT EXISTS (SELECT 1 FROM construction_projects c WHERE c.project_id = p.id) ORDER BY p.name`, ownerId, ...f.params)
    .map((r) => ({ id: r.id, name: r.name, areaName: r.area })) : [];
  let totals: FiguresOut | null = null;
  if (seesMoney(u) && items.length) {
    const t: FiguresOut = { budgetPaise: 0, committedPaise: 0, receivedPaise: 0, measuredPaise: 0, billedPaise: 0, approvedBillsPaise: 0, paidPaise: 0, outstandingPaise: 0, retentionHeldPaise: 0, remainingBudgetPaise: 0, overBudget: false };
    for (const i of items) for (const k of Object.keys(t) as (keyof FiguresOut)[]) if (k !== 'overBudget') (t[k] as number) += i.figures![k] as number;
    t.overBudget = items.some((i) => i.figures!.overBudget);
    totals = t;
  }
  return { items, canManage: runsSite(u), seesMoney: seesMoney(u), candidates, totals };
}

function detailsBody(v: Validator) {
  const code = v.str('code', { max: 20 });
  if (code !== undefined && !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(code)) v.fail('code', 'Letters, numbers and dashes, like HOUSE-1');
  const site = v.has('site') ? v.str('site', { max: 200 }) ?? null : undefined;
  const phase = v.oneOf('phase', PHASES);
  const startDate = v.src.startDate === null || v.src.startDate === '' ? null : v.date('startDate');
  const targetEndDate = v.src.targetEndDate === null || v.src.targetEndDate === '' ? null : v.date('targetEndDate');
  const retention = v.num('retentionPct', { min: 0, max: 20 });
  if (retention !== undefined && Math.round(retention * 100) !== retention * 100) v.fail('retentionPct', 'At most two decimals');
  return { code: code?.toUpperCase(), site, phase, startDate, targetEndDate, retentionBps: retention === undefined ? undefined : Math.round(retention * 100) };
}

/** Starts construction on a project: an existing one (projectId), or a new one made through the task board's own createProject. */
export function startConstruction(u: UserRow, ownerId: string, body: unknown): CProjectOut {
  mustSee(u); need(runsSite(u), 'manage_tasks');
  const v = new Validator(body);
  const projectId = v.str('projectId', { max: 60 });
  const name = v.str('name', { min: 2, max: 80 }), details = v.str('details', { max: 500 });
  const areaId = v.src.areaId === null || v.src.areaId === '' ? null : v.str('areaId', { max: 60 });
  const d = detailsBody(v);
  if (!projectId && !name) v.fail('name', 'Pick a project or give the new one a name');
  if (!d.code) v.fail('code', 'Required');
  v.done();
  return tx(() => {
    let pid = projectId;
    if (pid) {
      const p = one<ProjRow>('SELECT * FROM projects WHERE id = ? AND owner_id = ?', pid, ownerId);
      if (!p || !canSeeArea(u, ownerId, p.area_id)) throw notFound('Project not found');
      if (one('SELECT 1 FROM construction_projects WHERE project_id = ?', pid)) throw conflict('ALREADY_CONSTRUCTION', 'This project is already a construction project');
    } else {
      pid = createProject(u, ownerId, { name, details, areaId }).id;
    }
    if (one('SELECT 1 FROM construction_projects WHERE owner_id = ? AND code = ?', ownerId, d.code!)) throw conflict('CODE_TAKEN', `Another project already uses the code ${d.code}`);
    const t = now();
    run(`INSERT INTO construction_projects(project_id, owner_id, code, site, phase, start_date, target_end_date, retention_bps, created_at, created_by, updated_at, updated_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, pid!, ownerId, d.code!, d.site ?? null, d.phase ?? 'planning', d.startDate ?? null, d.targetEndDate ?? null, d.retentionBps ?? 0, t, u.id, t, u.id);
    audit(actorOf(u), 'construction.start', 'project', pid!, { code: d.code, existing: !!projectId }, ownerId);
    const r = cproject(u, ownerId, pid!);
    return projectOut(u, r.p, r.c);
  });
}

export function getProject(u: UserRow, ownerId: string, id: string): CProjectOut & { canManage: boolean; keepsBooks: boolean } {
  const r = cproject(u, ownerId, id);
  return { ...projectOut(u, r.p, r.c), canManage: runsSite(u), keepsBooks: keepsBooks(u) };
}

export function updateDetails(u: UserRow, ownerId: string, id: string, body: unknown): CProjectOut {
  const { c } = cproject(u, ownerId, id);
  need(runsSite(u), 'manage_tasks');
  const v = new Validator(body);
  const d = detailsBody(v);
  v.done();
  if (d.code && d.code !== c.code && one('SELECT 1 FROM construction_projects WHERE owner_id = ? AND code = ? AND project_id != ?', ownerId, d.code, id)) throw conflict('CODE_TAKEN', `Another project already uses the code ${d.code}`);
  const end = d.targetEndDate !== undefined ? d.targetEndDate : c.target_end_date, start = d.startDate !== undefined ? d.startDate : c.start_date;
  if (start && end && end < start) throw new HttpError(400, 'VALIDATION_FAILED', 'The target end date is before the start date', { fields: [{ field: 'targetEndDate', message: 'Before the start date' }] });
  run(`UPDATE construction_projects SET code = ?, site = ?, phase = ?, start_date = ?, target_end_date = ?, retention_bps = ?, updated_at = ?, updated_by = ? WHERE project_id = ?`,
    d.code ?? c.code, d.site !== undefined ? d.site : c.site, d.phase ?? c.phase, start, end, d.retentionBps ?? c.retention_bps, now(), u.id, id);
  audit(actorOf(u), 'construction.update', 'project', id, Object.fromEntries(Object.entries(d).filter(([, x]) => x !== undefined)), ownerId);
  const r = cproject(u, ownerId, id);
  return projectOut(u, r.p, r.c);
}

// ------------------------------------------------------------------ plan: BOQ, milestones

export interface BoqOut { id: string; itemCode: string; description: string; unit: string; quantity: string; qtyMilli: number; ratePaise: number | null; amountPaise: number | null; revision: number; orderedQty: string; orderedMilli: number }
interface BoqRow { id: string; owner_id: string; project_id: string; item_code: string; description: string; unit: string; qty_milli: number; rate_paise: number; revision: number; supersedes_id: string | null; current: number }

function boqOut(u: UserRow, b: BoqRow): BoqOut {
  const ordered = one<{ q: number }>(`SELECT COALESCE(SUM(l.qty_milli), 0) q FROM po_lines l JOIN purchase_orders o ON o.id = l.po_id
      JOIN boq_items b ON b.id = l.boq_item_id WHERE b.project_id = ? AND b.item_code = ? AND o.status IN ${COMMITTED}`, b.project_id, b.item_code)!.q;
  const money = seesMoney(u);
  return { id: b.id, itemCode: b.item_code, description: b.description, unit: b.unit, quantity: qtyText(b.qty_milli), qtyMilli: b.qty_milli,
    ratePaise: money ? b.rate_paise : null, amountPaise: money ? lineAmount(b.qty_milli, b.rate_paise) : null, revision: b.revision, orderedQty: qtyText(ordered), orderedMilli: ordered };
}

export function plan(u: UserRow, ownerId: string, id: string) {
  cproject(u, ownerId, id);
  const boq = many<BoqRow>('SELECT * FROM boq_items WHERE project_id = ? AND current = 1 ORDER BY item_code', id).map((b) => boqOut(u, b));
  const t = today();
  const milestones = many<{ id: string; title: string; due_date: string | null; done_at: number | null; n: number; d: number }>(
    `SELECT m.id, m.title, m.due_date, m.done_at, (SELECT COUNT(*) FROM tasks t WHERE t.milestone_id = m.id AND t.status != 'cancelled') n,
            (SELECT COUNT(*) FROM tasks t WHERE t.milestone_id = m.id AND t.status = 'done') d
       FROM milestones m WHERE m.project_id = ? ORDER BY COALESCE(m.due_date, '9999-12-31'), m.created_at`, id)
    .map((m) => ({ id: m.id, title: m.title, dueDate: m.due_date, done: m.done_at !== null, overdue: m.done_at === null && !!m.due_date && m.due_date < t, jobs: m.n, jobsDone: m.d }));
  return { boq, boqTotalPaise: seesMoney(u) ? boq.reduce((s, b) => s + (b.amountPaise ?? 0), 0) : null, milestones };
}

function boqBody(v: Validator, partial: boolean) {
  const itemCode = v.str('itemCode', { required: !partial, max: 20 });
  const description = v.str('description', { required: !partial, min: 2, max: 300 });
  const unit = v.str('unit', { required: !partial, max: 12 });
  const qty = milli(v, 'quantity', { required: !partial });
  const rate = v.int('ratePaise', { required: !partial, min: 0, max: MAX_PAISE });
  return { itemCode: itemCode?.toUpperCase(), description, unit, qty, rate };
}

export function addBoqItem(u: UserRow, ownerId: string, projectId: string, body: unknown): BoqOut {
  cproject(u, ownerId, projectId); need(runsSite(u), 'manage_tasks'); need(seesMoney(u), 'view_revenue');
  const v = new Validator(body);
  const b = boqBody(v, false);
  v.done();
  if (lineAmount(b.qty!, b.rate!) > MAX_PAISE) throw new HttpError(400, 'VALIDATION_FAILED', 'The line is too large');
  if (one('SELECT 1 FROM boq_items WHERE project_id = ? AND item_code = ?', projectId, b.itemCode!)) throw conflict('ITEM_EXISTS', `Item ${b.itemCode} is already in the BOQ; change it instead`);
  const id = newId('boq');
  run(`INSERT INTO boq_items(id, owner_id, project_id, item_code, description, unit, qty_milli, rate_paise, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    id, ownerId, projectId, b.itemCode!, b.description!, b.unit!, b.qty!, b.rate!, now(), u.id);
  audit(actorOf(u), 'boq.add', 'boq_item', id, { projectId, itemCode: b.itemCode, qtyMilli: b.qty, ratePaise: b.rate }, ownerId);
  return boqOut(u, one<BoqRow>('SELECT * FROM boq_items WHERE id = ?', id)!);
}

/** A change to a BOQ line is a new revision; the earlier one stays on file and orders keep pointing at the line they were placed against. */
export function reviseBoqItem(u: UserRow, ownerId: string, itemId: string, body: unknown): BoqOut {
  const cur = one<BoqRow>('SELECT * FROM boq_items WHERE id = ? AND owner_id = ?', itemId, ownerId);
  if (!cur) throw notFound('BOQ item not found');
  cproject(u, ownerId, cur.project_id); need(runsSite(u), 'manage_tasks'); need(seesMoney(u), 'view_revenue');
  if (!cur.current) throw conflict('NOT_CURRENT', 'This is an earlier revision; change the current one');
  const v = new Validator(body);
  const b = boqBody(v, true);
  if (b.itemCode && b.itemCode !== cur.item_code) v.fail('itemCode', 'The item code cannot change; add a new item instead');
  v.done();
  const id = newId('boq');
  tx(() => {
    run('UPDATE boq_items SET current = 0 WHERE id = ?', itemId);
    run(`INSERT INTO boq_items(id, owner_id, project_id, item_code, description, unit, qty_milli, rate_paise, revision, supersedes_id, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, ownerId, cur.project_id, cur.item_code, b.description ?? cur.description, b.unit ?? cur.unit, b.qty ?? cur.qty_milli, b.rate ?? cur.rate_paise, cur.revision + 1, itemId, now(), u.id);
  });
  audit(actorOf(u), 'boq.revise', 'boq_item', id, { itemCode: cur.item_code, revision: cur.revision + 1, from: { qtyMilli: cur.qty_milli, ratePaise: cur.rate_paise }, to: { qtyMilli: b.qty ?? cur.qty_milli, ratePaise: b.rate ?? cur.rate_paise } }, ownerId);
  return boqOut(u, one<BoqRow>('SELECT * FROM boq_items WHERE id = ?', id)!);
}

// ------------------------------------------------------------------ purchase and work orders

const PO_STATUSES = ['draft', 'pending_approval', 'approved', 'partly_received', 'received', 'closed', 'cancelled'] as const;
type PoStatus = (typeof PO_STATUSES)[number];
interface PoRow { id: string; owner_id: string; project_id: string; vendor_id: string; po_no: string; kind: 'supply' | 'work'; status: PoStatus; subtotal_paise: number; tax_paise: number; total_paise: number; retention_bps: number; expected_date: string | null; notes: string | null; version: number; created_at: number; created_by: string | null; submitted_at: number | null; decided_at: number | null; decided_by: string | null; decided_note: string | null; cancelled_reason: string | null }
interface LineRow { id: string; po_id: string; boq_item_id: string | null; position: number; description: string; unit: string; qty_milli: number; rate_paise: number; tax_bps: number; amount_paise: number; tax_paise: number }

export interface OrderOut {
  id: string; poNo: string; kind: 'supply' | 'work'; status: PoStatus; vendorId: string; vendorName: string; projectId: string; projectName: string;
  subtotalPaise: number | null; taxPaise: number | null; totalPaise: number | null; retentionPct: number; expectedDate: string | null; notes: string | null; version: number;
  createdByName: string | null; createdAt: number; decidedByName: string | null; decidedAt: number | null; decidedNote: string | null; cancelledReason: string | null;
  /** progress against the order, before tax */
  progress: { receivedPaise: number | null; measuredPaise: number | null; billedPaise: number | null; paidPaise: number | null; receivedPct: number };
}

function poRow(ownerId: string, id: string): PoRow {
  const r = one<PoRow>('SELECT * FROM purchase_orders WHERE id = ? AND owner_id = ?', id, ownerId);
  if (!r) throw notFound('Order not found');
  return r;
}
/** An order this person may see: its project must be visible to them. */
function visibleOrder(u: UserRow, ownerId: string, id: string): PoRow {
  const o = one<PoRow>('SELECT * FROM purchase_orders WHERE id = ? AND owner_id = ?', id, ownerId);
  if (!o) throw notFound('Order not found');
  try { cproject(u, ownerId, o.project_id); } catch (e) { if (e instanceof HttpError && e.status === 404) throw notFound('Order not found'); throw e; }
  return o;
}

function receivedByLine(poId: string): Map<string, { received: number; rejected: number }> {
  return new Map(many<{ po_line_id: string; r: number; x: number }>(`SELECT g.po_line_id, SUM(g.received_milli) r, SUM(g.rejected_milli) x FROM goods_receipt_lines g
      JOIN po_lines l ON l.id = g.po_line_id WHERE l.po_id = ? GROUP BY g.po_line_id`, poId).map((r) => [r.po_line_id, { received: r.r, rejected: r.x }]));
}
function measuredByLine(poId: string): Map<string, number> {
  return new Map(many<{ po_line_id: string; q: number }>("SELECT po_line_id, SUM(qty_milli) q FROM measurements WHERE po_id = ? AND status != 'superseded' GROUP BY po_line_id", poId).map((r) => [r.po_line_id, r.q]));
}
const linesOf = (poId: string) => many<LineRow>('SELECT * FROM po_lines WHERE po_id = ? ORDER BY position', poId);

function orderOut(u: UserRow, o: PoRow): OrderOut {
  const money = seesMoney(u);
  const lines = linesOf(o.id);
  const got = receivedByLine(o.id), meas = measuredByLine(o.id);
  const accepted = lines.reduce((s, l) => s + lineAmount((got.get(l.id)?.received ?? 0) - (got.get(l.id)?.rejected ?? 0), l.rate_paise), 0);
  const measured = lines.reduce((s, l) => s + lineAmount(meas.get(l.id) ?? 0, l.rate_paise), 0);
  const bills = one<{ b: number; p: number }>(`SELECT COALESCE(SUM(CASE WHEN b.status IN ('draft','pending_approval','approved','paid') THEN b.amount_paise END), 0) b,
      COALESCE(SUM(CASE WHEN b.status = 'paid' THEN b.amount_paise END), 0) p FROM construction_bills cb JOIN acct_bills b ON b.id = cb.bill_id WHERE cb.po_id = ? AND b.deleted_at IS NULL`, o.id)!;
  const done = o.kind === 'work' ? measured : accepted;
  return {
    id: o.id, poNo: o.po_no, kind: o.kind, status: o.status, vendorId: o.vendor_id, vendorName: one<{ name: string }>('SELECT name FROM acct_vendors WHERE id = ?', o.vendor_id)?.name ?? 'Supplier',
    projectId: o.project_id, projectName: one<{ name: string }>('SELECT name FROM projects WHERE id = ?', o.project_id)?.name ?? '',
    subtotalPaise: money ? o.subtotal_paise : null, taxPaise: money ? o.tax_paise : null, totalPaise: money ? o.total_paise : null,
    retentionPct: o.retention_bps / 100, expectedDate: o.expected_date, notes: o.notes, version: o.version,
    createdByName: nameOf(o.created_by), createdAt: o.created_at, decidedByName: nameOf(o.decided_by), decidedAt: o.decided_at, decidedNote: o.decided_note, cancelledReason: o.cancelled_reason,
    progress: { receivedPaise: money ? accepted : null, measuredPaise: money ? measured : null, billedPaise: money ? bills.b : null, paidPaise: money ? bills.p : null,
      receivedPct: o.subtotal_paise > 0 ? Math.min(100, Math.round((done * 100) / o.subtotal_paise)) : 0 },
  };
}

export function listOrders(u: UserRow, ownerId: string, projectId: string, status?: string): { items: OrderOut[] } {
  cproject(u, ownerId, projectId);
  const where = ['project_id = ?']; const p: string[] = [projectId];
  if (status) {
    const list = status.split(',').filter((s) => (PO_STATUSES as readonly string[]).includes(s));
    if (!list.length) throw new HttpError(400, 'VALIDATION_FAILED', 'Unknown status');
    where.push(`status IN (${list.map(() => '?').join(',')})`); p.push(...list);
  }
  return { items: many<PoRow>(`SELECT * FROM purchase_orders WHERE ${where.join(' AND ')} ORDER BY created_at DESC`, ...p).map((o) => orderOut(u, o)) };
}

/** The order with everything that hangs off it: lines and progress, receipts, measurements, RA bills, and supplier bills. */
export function orderContext(u: UserRow, ownerId: string, id: string) {
  const o = visibleOrder(u, ownerId, id);
  const money = seesMoney(u);
  const got = receivedByLine(o.id), meas = measuredByLine(o.id);
  const lines = linesOf(o.id).map((l) => {
    const g = got.get(l.id) ?? { received: 0, rejected: 0 };
    return { id: l.id, boqItemId: l.boq_item_id, boqItemCode: l.boq_item_id ? one<{ item_code: string }>('SELECT item_code FROM boq_items WHERE id = ?', l.boq_item_id)?.item_code ?? null : null,
      description: l.description, unit: l.unit, quantity: qtyText(l.qty_milli), qtyMilli: l.qty_milli, ratePaise: money ? l.rate_paise : null, taxPct: l.tax_bps / 100,
      amountPaise: money ? l.amount_paise : null, taxPaise: money ? l.tax_paise : null,
      receivedQty: qtyText(g.received), rejectedQty: qtyText(g.rejected), acceptedMilli: g.received - g.rejected, toComeQty: qtyText(Math.max(0, l.qty_milli - g.received + g.rejected)),
      measuredQty: qtyText(meas.get(l.id) ?? 0), measuredMilli: meas.get(l.id) ?? 0 };
  });
  const receipts = many<{ id: string; grn_no: string; received_date: string; note: string | null; created_by: string | null; created_at: number }>('SELECT * FROM goods_receipts WHERE po_id = ? ORDER BY created_at', o.id)
    .map((g) => ({ id: g.id, grnNo: g.grn_no, date: g.received_date, note: g.note, byName: nameOf(g.created_by), at: g.created_at,
      lines: many<{ po_line_id: string; received_milli: number; rejected_milli: number; rejection_reason: string | null; description: string }>(
        'SELECT g.*, l.description FROM goods_receipt_lines g JOIN po_lines l ON l.id = g.po_line_id WHERE g.grn_id = ? ORDER BY l.position', g.id)
        .map((x) => ({ lineId: x.po_line_id, description: x.description, received: qtyText(x.received_milli), rejected: qtyText(x.rejected_milli), reason: x.rejection_reason })) }));
  const measurements = many<MeasRow>('SELECT * FROM measurements WHERE po_id = ? ORDER BY measured_date, created_at', o.id).map((m) => measOut(u, m));
  const raBills = many<RaRow>('SELECT * FROM ra_bills WHERE po_id = ? ORDER BY sequence_no', o.id).map((b) => raOut(u, b));
  const bills = money ? many<{ id: string; bill_no: string | null; bill_date: string; amount_paise: number; status: string; ra_bill_id: string | null }>(
    `SELECT b.id, b.bill_no, b.bill_date, b.amount_paise, b.status, cb.ra_bill_id FROM construction_bills cb JOIN acct_bills b ON b.id = cb.bill_id WHERE cb.po_id = ? AND b.deleted_at IS NULL ORDER BY b.bill_date`, o.id)
    .map((b) => ({ id: b.id, billNo: b.bill_no, date: b.bill_date, amountPaise: b.amount_paise, status: b.status, fromRaBill: !!b.ra_bill_id })) : null;
  const out = orderOut(u, o);
  // "Explain this number": what was ordered, what came (or was measured), what the supplier billed and what was paid, before tax except the bills
  const explain = money ? [
    `Ordered: ${rupees(o.subtotal_paise)} before tax, ${rupees(o.total_paise)} with tax (${lines.length} line${lines.length === 1 ? '' : 's'}).`,
    o.kind === 'work' ? `Measured on site: ${rupees(out.progress.measuredPaise!)} at the order rates.` : `Accepted on site: ${rupees(out.progress.receivedPaise!)} at the order rates (received less rejected).`,
    `Billed by the supplier: ${rupees(out.progress.billedPaise!)} in ${bills!.length} bill${bills!.length === 1 ? '' : 's'} (with tax, less any retention).`,
    `Paid: ${rupees(out.progress.paidPaise!)}.`,
  ] : null;
  return { order: out, lines, receipts, measurements, raBills, bills, explain, canManage: runsSite(u), keepsBooks: keepsBooks(u) };
}
const rupees = (p: number) => '₹' + (p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A draft order. Totals are worked out here from the lines; a total sent by the client is refused, never trusted. */
export function createOrder(u: UserRow, ownerId: string, projectId: string, body: unknown): OrderOut {
  const { p, c } = cproject(u, ownerId, projectId);
  need(runsSite(u), 'manage_tasks'); need(seesMoney(u), 'view_revenue');
  if (p.status === 'archived') throw conflict('PROJECT_ARCHIVED', 'This project is archived');
  const v = new Validator(body);
  const vendorId = v.str('vendorId', { required: true, max: 60 });
  const kind = v.oneOf('kind', ['supply', 'work'] as const) ?? 'supply';
  const poNo = v.str('poNo', { max: 30 });
  const expectedDate = v.date('expectedDate');
  const notes = v.str('notes', { max: 1000 });
  const retention = v.num('retentionPct', { min: 0, max: 20 });
  for (const k of ['subtotalPaise', 'taxPaise', 'totalPaise']) if (v.has(k)) v.fail(k, 'Totals are worked out from the lines; do not send them');
  const raw = v.src.lines;
  if (!Array.isArray(raw) || !raw.length) v.fail('lines', 'Add at least one line');
  else if (raw.length > 200) v.fail('lines', 'At most 200 lines');
  v.done();
  if (!one('SELECT 1 FROM acct_vendors WHERE id = ? AND owner_id = ? AND deleted_at IS NULL', vendorId!, ownerId)) throw new HttpError(400, 'VALIDATION_FAILED', 'Unknown supplier', { fields: [{ field: 'vendorId', message: 'Pick one of your suppliers' }] });
  const lines = (raw as unknown[]).map((x, i) => {
    const lv = new Validator(x);
    const boqItemId = lv.str('boqItemId', { max: 60 });
    let description = lv.str('description', { max: 300 }), unit = lv.str('unit', { max: 12 });
    const qty = milli(lv, 'quantity', { required: true, positive: true });
    const rate = lv.int('ratePaise', { required: true, min: 0, max: MAX_PAISE });
    const taxPct = lv.num('taxPct', { min: 0, max: 100 });
    if (taxPct !== undefined && Math.round(taxPct * 100) !== taxPct * 100) lv.fail('taxPct', 'At most two decimals');
    if (lv.has('amountPaise')) lv.fail('amountPaise', 'Line amounts are worked out here');
    if (boqItemId) {
      const b = one<BoqRow>('SELECT * FROM boq_items WHERE id = ? AND project_id = ? AND current = 1', boqItemId, projectId);
      if (!b) lv.fail('boqItemId', 'Not a current BOQ item of this project');
      else { description ??= b.description; unit ??= b.unit; }
    }
    if (!description) lv.fail('description', 'Required');
    if (!unit) lv.fail('unit', 'Required');
    if (lv.fields.length) throw new HttpError(400, 'VALIDATION_FAILED', `Line ${i + 1} is not valid`, { fields: lv.fields.map((f) => ({ field: `lines[${i}].${f.field}`, message: f.message })) });
    const amount = lineAmount(qty!, rate!), taxBps = Math.round((taxPct ?? 0) * 100);
    return { boqItemId: boqItemId ?? null, description: description!, unit: unit!, qty: qty!, rate: rate!, taxBps, amount, tax: taxOn(amount, taxBps) };
  });
  const subtotal = lines.reduce((s, l) => s + l.amount, 0), tax = lines.reduce((s, l) => s + l.tax, 0);
  if (subtotal + tax > MAX_PAISE) throw new HttpError(400, 'VALIDATION_FAILED', 'The order is too large');
  return tx(() => {
    const seq = one<{ n: number }>('SELECT COUNT(*) n FROM purchase_orders WHERE project_id = ?', projectId)!.n + 1;
    const no = (poNo ?? `${kind === 'work' ? 'WO' : 'PO'}-${c.code}-${String(seq).padStart(3, '0')}`).toUpperCase();
    if (one('SELECT 1 FROM purchase_orders WHERE project_id = ? AND po_no = ?', projectId, no)) throw conflict('ORDER_NO_TAKEN', `Order ${no} already exists in this project`);
    const id = newId('po'), t = now();
    run(`INSERT INTO purchase_orders(id, owner_id, project_id, vendor_id, po_no, kind, status, subtotal_paise, tax_paise, total_paise, retention_bps, expected_date, notes, created_at, created_by, updated_at)
         VALUES (?,?,?,?,?,?, 'draft', ?,?,?,?,?,?,?,?,?)`, id, ownerId, projectId, vendorId!, no, kind, subtotal, tax, subtotal + tax,
      retention === undefined ? c.retention_bps : Math.round(retention * 100), expectedDate ?? null, notes ?? null, t, u.id, t);
    lines.forEach((l, i) => run(`INSERT INTO po_lines(id, po_id, boq_item_id, position, description, unit, qty_milli, rate_paise, tax_bps, amount_paise, tax_paise) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      newId('pol'), id, l.boqItemId, i, l.description, l.unit, l.qty, l.rate, l.taxBps, l.amount, l.tax));
    audit(actorOf(u), 'po.create', 'construction_po', id, { poNo: no, kind, projectId, vendorId, subtotalPaise: subtotal, taxPaise: tax }, ownerId);
    return orderOut(u, poRow(ownerId, id));
  });
}

const poSubject = (o: PoRow) => ({ title: `${o.po_no} · ${one<{ name: string }>('SELECT name FROM acct_vendors WHERE id = ?', o.vendor_id)?.name ?? 'Supplier'}`, amountPaise: o.total_paise, submittedBy: o.created_by });

/** Sends a draft order for approval. The owner's rules decide the steps (by default the owner signs every order, from ₹0). */
export function submitOrder(u: UserRow, ownerId: string, id: string): OrderOut {
  visibleOrder(u, ownerId, id); need(runsSite(u), 'manage_tasks');
  return tx(() => {
    const o = poRow(ownerId, id);
    if (o.status !== 'draft') throw conflict('BAD_STATUS', 'Only a draft order can be sent for approval');
    const t = now();
    run("UPDATE purchase_orders SET status = 'pending_approval', submitted_at = ?, decided_at = NULL, decided_by = NULL, decided_note = NULL, version = version + 1, updated_at = ? WHERE id = ?", t, t, id);
    audit(actorOf(u), 'po.submit', 'construction_po', id, null, ownerId);
    if (!startRequest(ownerId, 'purchase_order', id, poSubject(o))) {
      run("UPDATE purchase_orders SET status = 'approved', decided_at = ?, decided_by = ?, version = version + 1, updated_at = ? WHERE id = ?", t, u.id, t, id);
      audit(actorOf(u), 'po.approve', 'construction_po', id, { auto: true, why: 'No approval step applies to this amount' }, ownerId);
    }
    return orderOut(u, poRow(ownerId, id));
  });
}

function waitingOrder(req: ReqRow): PoRow {
  const o = one<PoRow>('SELECT * FROM purchase_orders WHERE id = ? AND owner_id = ?', req.entity_id, req.owner_id);
  if (!o) throw notFound('Order not found');
  if (o.status !== 'pending_approval') throw conflict('NOT_WAITING', 'This order is not waiting for approval');
  return o;
}
/** A sign-off from the Approvals board. The last step approves the order, so goods can be received against it. */
export function signOrder(ownerId: string, actor: Actor, req: ReqRow, note: string | null): void {
  tx(() => {
    const o = waitingOrder(req);
    const s = signStep(req, actor, note);
    if (!s.done) return;
    const t = now();
    run("UPDATE purchase_orders SET status = 'approved', decided_at = ?, decided_by = ?, decided_note = ?, version = version + 1, updated_at = ? WHERE id = ?", t, actor.id, note, t, o.id);
    audit(actor, 'po.approve', 'construction_po', o.id, { step: s.index + 1, label: s.step.label, ...(note ? { note } : {}) }, ownerId);
  });
}
/** Sent back from the Approvals board: to the person who made it (the order is a draft again), or one step back, as the rules say. */
export function sendBackOrder(ownerId: string, actor: Actor, req: ReqRow, note: string): void {
  tx(() => {
    const o = waitingOrder(req);
    if (!sendBack(req, actor, note).toStart) return;
    const t = now();
    run("UPDATE purchase_orders SET status = 'draft', decided_at = ?, decided_by = ?, decided_note = ?, version = version + 1, updated_at = ? WHERE id = ?", t, actor.id, note, t, o.id);
    audit(actor, 'po.sendback', 'construction_po', o.id, { reason: note }, ownerId);
  });
}

/** Cancels an order that nothing has happened against yet. It stays on file with the reason. */
export function cancelOrder(u: UserRow, ownerId: string, id: string, body: unknown): OrderOut {
  visibleOrder(u, ownerId, id); need(runsSite(u), 'manage_tasks');
  const v = new Validator(body);
  const reason = v.str('reason', { required: true, min: 3, max: 300 });
  v.done();
  return tx(() => {
    const o = poRow(ownerId, id);
    if (!['draft', 'pending_approval', 'approved'].includes(o.status)) throw conflict('BAD_STATUS', 'Goods or work have been recorded against this order, so it cannot be cancelled; close it instead');
    if (one('SELECT 1 FROM goods_receipts WHERE po_id = ?', id) || one("SELECT 1 FROM measurements WHERE po_id = ? AND status != 'superseded'", id) || one('SELECT 1 FROM construction_bills WHERE po_id = ?', id))
      throw conflict('ORDER_IN_USE', 'Something has been recorded against this order, so it cannot be cancelled');
    withdrawRequest(ownerId, 'purchase_order', id);
    run("UPDATE purchase_orders SET status = 'cancelled', cancelled_reason = ?, version = version + 1, updated_at = ? WHERE id = ?", reason!, now(), id);
    audit(actorOf(u), 'po.cancel', 'construction_po', id, { reason, was: o.status }, ownerId);
    return orderOut(u, poRow(ownerId, id));
  });
}

/** Closes an approved order early (the rest will not come). What came and what was billed stay as they are. */
export function closeOrder(u: UserRow, ownerId: string, id: string, body: unknown): OrderOut {
  visibleOrder(u, ownerId, id); need(runsSite(u), 'manage_tasks');
  const v = new Validator(body);
  const reason = v.str('reason', { required: true, min: 3, max: 300 });
  v.done();
  const o = poRow(ownerId, id);
  if (!['approved', 'partly_received', 'received'].includes(o.status)) throw conflict('BAD_STATUS', 'Only an approved order can be closed');
  run("UPDATE purchase_orders SET status = 'closed', decided_note = ?, version = version + 1, updated_at = ? WHERE id = ?", reason!, now(), id);
  audit(actorOf(u), 'po.close', 'construction_po', id, { reason, was: o.status }, ownerId);
  return orderOut(u, poRow(ownerId, id));
}

// ------------------------------------------------------------------ goods received

const RECEIVABLE: PoStatus[] = ['approved', 'partly_received'];

/** Records goods arriving on site against a supply order. More than is still to come is refused (409) and nothing is written. */
export function receiveGoods(u: UserRow, ownerId: string, poId: string, body: unknown) {
  visibleOrder(u, ownerId, poId); need(runsSite(u), 'manage_tasks');
  const v = new Validator(body);
  const date = v.date('date') ?? today();
  const note = v.str('note', { max: 500 });
  const grnNo = v.str('grnNo', { max: 30 });
  const raw = v.src.lines;
  if (!Array.isArray(raw) || !raw.length) v.fail('lines', 'Say what arrived');
  if (date > today()) v.fail('date', 'Goods cannot be received in the future');
  v.done();
  const items = (raw as unknown[]).map((x, i) => {
    const lv = new Validator(x);
    const lineId = lv.str('lineId', { required: true, max: 60 });
    const received = milli(lv, 'receivedQty', { required: true, positive: true });
    const rejected = milli(lv, 'rejectedQty') ?? 0;
    const reason = lv.str('rejectionReason', { max: 300 });
    if (received !== undefined && rejected > received) lv.fail('rejectedQty', 'More rejected than received');
    if (rejected > 0 && !reason) lv.fail('rejectionReason', 'Say why it was rejected');
    if (lv.fields.length) throw new HttpError(400, 'VALIDATION_FAILED', `Line ${i + 1} is not valid`, { fields: lv.fields.map((f) => ({ field: `lines[${i}].${f.field}`, message: f.message })) });
    return { lineId: lineId!, received: received!, rejected, reason: reason ?? null };
  });
  if (new Set(items.map((i) => i.lineId)).size !== items.length) throw new HttpError(400, 'VALIDATION_FAILED', 'Each order line once per receipt');
  return tx(() => {
    const o = poRow(ownerId, poId);
    if (o.kind !== 'supply') throw conflict('WORK_ORDER', 'A work order is measured, not received; record a measurement instead');
    if (!RECEIVABLE.includes(o.status)) throw conflict('NOT_RECEIVABLE', o.status === 'draft' || o.status === 'pending_approval' ? 'This order is not approved yet' : 'This order is no longer open for receipts');
    const lines = new Map(linesOf(poId).map((l) => [l.id, l]));
    const got = receivedByLine(poId);
    for (const it of items) {
      const l = lines.get(it.lineId);
      if (!l) throw new HttpError(400, 'VALIDATION_FAILED', 'That line is not on this order');
      const g = got.get(l.id) ?? { received: 0, rejected: 0 };
      const toCome = l.qty_milli - (g.received - g.rejected);
      if (it.received - it.rejected > toCome) throw conflict('OVER_RECEIPT', `${l.description}: only ${qtyText(Math.max(0, toCome))} ${l.unit} is still to come`);
    }
    const seq = one<{ n: number }>('SELECT COUNT(*) n FROM goods_receipts WHERE project_id = ?', o.project_id)!.n + 1;
    const no = (grnNo ?? `GRN-${String(seq).padStart(3, '0')}`).toUpperCase();
    if (one('SELECT 1 FROM goods_receipts WHERE project_id = ? AND grn_no = ?', o.project_id, no)) throw conflict('GRN_NO_TAKEN', `Receipt ${no} already exists in this project`);
    const id = newId('grn');
    run('INSERT INTO goods_receipts(id, owner_id, project_id, po_id, grn_no, received_date, note, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?)', id, ownerId, o.project_id, poId, no, date, note ?? null, now(), u.id);
    for (const it of items) run('INSERT INTO goods_receipt_lines(grn_id, po_line_id, received_milli, rejected_milli, rejection_reason) VALUES (?,?,?,?,?)', id, it.lineId, it.received, it.rejected, it.reason);
    const after = receivedByLine(poId);
    const full = [...lines.values()].every((l) => { const g = after.get(l.id); return !!g && g.received - g.rejected >= l.qty_milli; });
    run('UPDATE purchase_orders SET status = ?, version = version + 1, updated_at = ? WHERE id = ?', full ? 'received' : 'partly_received', now(), poId);
    audit(actorOf(u), 'po.receive', 'construction_po', poId, { grn: id, grnNo: no, lines: items.map((i) => ({ lineId: i.lineId, receivedMilli: i.received, rejectedMilli: i.rejected })) }, ownerId);
    return { id, grnNo: no, order: orderOut(u, poRow(ownerId, poId)) };
  });
}

// ------------------------------------------------------------------ supplier bills (into the books)

/** A supplier's invoice against an order becomes a bill in the books, linked to the order, and is sent for the bill approval rules. */
export function addSupplierBill(u: UserRow, ownerId: string, poId: string, body: unknown) {
  visibleOrder(u, ownerId, poId); need(keepsBooks(u), 'manage_accounting');
  const v = new Validator(body);
  const billNo = v.str('billNo', { required: true, max: 60 });
  const billDate = v.date('billDate', true);
  const dueDate = v.date('dueDate');
  const amount = v.int('amountPaise', { required: true, min: 1, max: MAX_PAISE });
  const notes = v.str('notes', { max: 500 });
  v.done();
  return tx(() => {
    const o = poRow(ownerId, poId);
    if (!['approved', 'partly_received', 'received', 'closed'].includes(o.status)) throw conflict('NOT_APPROVED', 'Bills can only be entered against an approved order');
    if (o.kind === 'work') throw conflict('WORK_ORDER', 'A work order is billed through RA bills from its measurements');
    const already = one<{ s: number }>(`SELECT COALESCE(SUM(b.amount_paise), 0) s FROM construction_bills cb JOIN acct_bills b ON b.id = cb.bill_id
        WHERE cb.po_id = ? AND b.deleted_at IS NULL AND b.status != 'rejected'`, poId)!.s;
    if (already + amount! > o.total_paise) throw conflict('OVER_BILLED', `Bills on this order would come to ${rupees(already + amount!)}, more than the order total of ${rupees(o.total_paise)}`);
    const actor = actorOf(u);
    const bill = createBill(ownerId, actor, { vendorId: o.vendor_id, billNo, billDate, dueDate: dueDate ?? billDate, amountPaise: amount, notes: notes ?? `${o.po_no}` });
    run('INSERT INTO construction_bills(bill_id, owner_id, project_id, po_id, created_at, created_by) VALUES (?,?,?,?,?,?)', bill.id, ownerId, o.project_id, poId, now(), u.id);
    const sent = submitBill(ownerId, actor, bill.id);
    audit(actor, 'po.bill', 'construction_po', poId, { billId: bill.id, billNo, amountPaise: amount }, ownerId);
    return { bill: sent, order: orderOut(u, poRow(ownerId, poId)) };
  });
}

// ------------------------------------------------------------------ measurements and RA bills

interface MeasRow { id: string; owner_id: string; project_id: string; po_id: string; po_line_id: string; measured_date: string; qty_milli: number; location: string | null; notes: string | null; revision: number; supersedes_id: string | null; status: 'draft' | 'billed' | 'certified' | 'superseded'; created_at: number; created_by: string | null }
function measOut(u: UserRow, m: MeasRow) {
  const l = one<LineRow>('SELECT * FROM po_lines WHERE id = ?', m.po_line_id)!;
  return { id: m.id, lineId: m.po_line_id, description: l.description, unit: l.unit, date: m.measured_date, quantity: qtyText(m.qty_milli), qtyMilli: m.qty_milli, location: m.location, notes: m.notes,
    revision: m.revision, supersedesId: m.supersedes_id, status: m.status, amountPaise: seesMoney(u) ? lineAmount(m.qty_milli, l.rate_paise) : null, byName: nameOf(m.created_by), at: m.created_at };
}
const WORKABLE: PoStatus[] = ['approved', 'partly_received'];

/** Work done on site, measured against a line of an approved work order. Measured in total never goes beyond the order quantity. */
export function addMeasurement(u: UserRow, ownerId: string, poId: string, body: unknown) {
  visibleOrder(u, ownerId, poId); need(runsSite(u), 'manage_tasks');
  const v = new Validator(body);
  const lineId = v.str('lineId', { required: true, max: 60 });
  const qty = milli(v, 'quantity', { required: true, positive: true });
  const date = v.date('date') ?? today();
  const location = v.str('location', { max: 120 }), notes = v.str('notes', { max: 500 });
  if (date > today()) v.fail('date', 'Work cannot be measured in the future');
  v.done();
  return tx(() => {
    const o = poRow(ownerId, poId);
    if (o.kind !== 'work') throw conflict('SUPPLY_ORDER', 'Goods on a supply order are received, not measured');
    if (!WORKABLE.includes(o.status)) throw conflict('NOT_OPEN', o.status === 'draft' || o.status === 'pending_approval' ? 'This order is not approved yet' : 'This order is no longer open');
    const l = one<LineRow>('SELECT * FROM po_lines WHERE id = ? AND po_id = ?', lineId!, poId);
    if (!l) throw new HttpError(400, 'VALIDATION_FAILED', 'That line is not on this order');
    const done = measuredByLine(poId).get(l.id) ?? 0;
    if (done + qty! > l.qty_milli) throw conflict('OVER_MEASURED', `${l.description}: only ${qtyText(l.qty_milli - done)} ${l.unit} is left on the order`);
    const id = newId('msr');
    run('INSERT INTO measurements(id, owner_id, project_id, po_id, po_line_id, measured_date, qty_milli, location, notes, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      id, ownerId, o.project_id, poId, l.id, date, qty!, location ?? null, notes ?? null, now(), u.id);
    if (o.status === 'approved') run("UPDATE purchase_orders SET status = 'partly_received', version = version + 1, updated_at = ? WHERE id = ?", now(), poId);
    audit(actorOf(u), 'measurement.add', 'measurement', id, { poId, lineId: l.id, qtyMilli: qty }, ownerId);
    return measOut(u, one<MeasRow>('SELECT * FROM measurements WHERE id = ?', id)!);
  });
}

/** A correction is a new revision that replaces the draft one; the earlier figure stays on file. Billed or certified ones cannot be corrected. */
export function correctMeasurement(u: UserRow, ownerId: string, id: string, body: unknown) {
  const m = one<MeasRow>('SELECT * FROM measurements WHERE id = ? AND owner_id = ?', id, ownerId);
  if (!m) throw notFound('Measurement not found');
  visibleOrder(u, ownerId, m.po_id); need(runsSite(u), 'manage_tasks');
  const v = new Validator(body);
  const qty = milli(v, 'quantity', { required: true, positive: true });
  const reason = v.str('reason', { required: true, min: 3, max: 300 });
  v.done();
  return tx(() => {
    const cur = one<MeasRow>('SELECT * FROM measurements WHERE id = ?', id)!;
    if (cur.status !== 'draft') throw conflict('MEASUREMENT_LOCKED', cur.status === 'superseded' ? 'This measurement was already corrected' : 'This measurement is on an RA bill, so it cannot be corrected');
    const l = one<LineRow>('SELECT * FROM po_lines WHERE id = ?', cur.po_line_id)!;
    const done = (measuredByLine(cur.po_id).get(l.id) ?? 0) - cur.qty_milli;
    if (done + qty! > l.qty_milli) throw conflict('OVER_MEASURED', `${l.description}: only ${qtyText(l.qty_milli - done)} ${l.unit} is left on the order`);
    const nid = newId('msr');
    run("UPDATE measurements SET status = 'superseded' WHERE id = ?", id);
    run('INSERT INTO measurements(id, owner_id, project_id, po_id, po_line_id, measured_date, qty_milli, location, notes, revision, supersedes_id, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      nid, ownerId, cur.project_id, cur.po_id, cur.po_line_id, cur.measured_date, qty!, cur.location, reason!, cur.revision + 1, id, now(), u.id);
    audit(actorOf(u), 'measurement.correct', 'measurement', nid, { supersedes: id, fromMilli: cur.qty_milli, toMilli: qty, reason }, ownerId);
    return measOut(u, one<MeasRow>('SELECT * FROM measurements WHERE id = ?', nid)!);
  });
}

interface RaRow { id: string; owner_id: string; project_id: string; po_id: string; bill_no: string; sequence_no: number; gross_paise: number; tax_paise: number; retention_paise: number; advance_recovery_paise: number; other_deduction_paise: number; net_paise: number; adjustments: string; status: 'draft' | 'certified' | 'cancelled'; version: number; acct_bill_id: string | null; created_at: number; created_by: string | null; certified_at: number | null; certified_by: string | null }
function raOut(u: UserRow, b: RaRow) {
  const money = seesMoney(u);
  const m = (p: number) => (money ? p : null);
  return { id: b.id, billNo: b.bill_no, sequenceNo: b.sequence_no, status: b.status, version: b.version,
    grossPaise: m(b.gross_paise), taxPaise: m(b.tax_paise), retentionPaise: m(b.retention_paise), advanceRecoveryPaise: m(b.advance_recovery_paise), otherDeductionPaise: m(b.other_deduction_paise), netPaise: m(b.net_paise),
    adjustments: money ? JSON.parse(b.adjustments) as { type: string; amountPaise: number; description: string }[] : [],
    measurementIds: many<{ measurement_id: string }>('SELECT measurement_id FROM ra_bill_lines WHERE ra_bill_id = ?', b.id).map((r) => r.measurement_id),
    billId: money ? b.acct_bill_id : null, createdByName: nameOf(b.created_by), createdAt: b.created_at, certifiedByName: nameOf(b.certified_by), certifiedAt: b.certified_at };
}

const ADJ = ['retention', 'advance_recovery', 'other_deduction'] as const;

/** A running-account bill from measured work: each measurement at the order rate, tax per line, then retention (capped by the order) and deductions. */
export function createRaBill(u: UserRow, ownerId: string, poId: string, body: unknown) {
  visibleOrder(u, ownerId, poId); need(keepsBooks(u), 'manage_accounting');
  const v = new Validator(body);
  const billNo = v.str('billNo', { max: 30 });
  const ids = v.strArray('measurementIds', { max: 500, itemMax: 60 });
  if (!ids?.length) v.fail('measurementIds', 'Pick the measurements to bill');
  const rawAdj = v.src.adjustments;
  if (rawAdj !== undefined && (!Array.isArray(rawAdj) || rawAdj.length > 50)) v.fail('adjustments', 'A list of at most 50');
  v.done();
  const adjustments = ((rawAdj ?? []) as unknown[]).map((x, i) => {
    const av = new Validator(x);
    const type = av.oneOf('type', ADJ, true), amount = av.int('amountPaise', { required: true, min: 1, max: MAX_PAISE }), description = av.str('description', { required: true, max: 300 });
    if (av.fields.length) throw new HttpError(400, 'VALIDATION_FAILED', `Adjustment ${i + 1} is not valid`, { fields: av.fields.map((f) => ({ field: `adjustments[${i}].${f.field}`, message: f.message })) });
    return { type: type!, amountPaise: amount!, description: description! };
  });
  if (new Set(ids).size !== ids!.length) throw new HttpError(400, 'VALIDATION_FAILED', 'Each measurement once');
  return tx(() => {
    const o = poRow(ownerId, poId);
    if (o.kind !== 'work') throw conflict('SUPPLY_ORDER', 'RA bills are for work orders');
    const ms = ids!.map((mid) => {
      const m = one<MeasRow>('SELECT * FROM measurements WHERE id = ? AND po_id = ?', mid, poId);
      if (!m) throw new HttpError(400, 'VALIDATION_FAILED', 'A measurement is not on this order');
      if (m.status !== 'draft') throw conflict('ALREADY_BILLED', 'A measurement is already on an RA bill or was corrected');
      return m;
    });
    const lines = ms.map((m) => {
      const l = one<LineRow>('SELECT * FROM po_lines WHERE id = ?', m.po_line_id)!;
      const amount = lineAmount(m.qty_milli, l.rate_paise);
      return { m, rate: l.rate_paise, taxBps: l.tax_bps, amount, tax: taxOn(amount, l.tax_bps) };
    });
    const gross = lines.reduce((s, l) => s + l.amount, 0), tax = lines.reduce((s, l) => s + l.tax, 0);
    const sum = (t: string) => adjustments.filter((a) => a.type === t).reduce((s, a) => s + a.amountPaise, 0);
    const retention = sum('retention'), recovery = sum('advance_recovery'), other = sum('other_deduction');
    const limit = Number((BigInt(gross) * BigInt(o.retention_bps) + 5000n) / 10000n);
    if (retention > limit) throw new HttpError(422, 'VALIDATION_FAILED', `Retention is more than this order allows (${o.retention_bps / 100}% of ${rupees(gross)} is ${rupees(limit)})`);
    if (retention + recovery + other > gross + tax) throw new HttpError(422, 'VALIDATION_FAILED', 'Deductions are more than the bill');
    const seq = one<{ n: number }>('SELECT COALESCE(MAX(sequence_no), 0) n FROM ra_bills WHERE po_id = ?', poId)!.n + 1;
    const no = (billNo ?? `${o.po_no}-RA${seq}`).toUpperCase();
    if (one('SELECT 1 FROM ra_bills WHERE project_id = ? AND bill_no = ?', o.project_id, no)) throw conflict('RA_NO_TAKEN', `RA bill ${no} already exists in this project`);
    const id = newId('rab');
    run(`INSERT INTO ra_bills(id, owner_id, project_id, po_id, bill_no, sequence_no, gross_paise, tax_paise, retention_paise, advance_recovery_paise, other_deduction_paise, net_paise, adjustments, created_at, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, ownerId, o.project_id, poId, no, seq, gross, tax, retention, recovery, other, gross + tax - retention - recovery - other, JSON.stringify(adjustments), now(), u.id);
    for (const l of lines) {
      run('INSERT INTO ra_bill_lines(ra_bill_id, measurement_id, rate_paise, tax_bps, amount_paise, tax_paise) VALUES (?,?,?,?,?,?)', id, l.m.id, l.rate, l.taxBps, l.amount, l.tax);
      run("UPDATE measurements SET status = 'billed' WHERE id = ?", l.m.id);
    }
    audit(actorOf(u), 'ra_bill.create', 'ra_bill', id, { poId, billNo: no, grossPaise: gross, taxPaise: tax, retentionPaise: retention, netPaise: gross + tax - retention - recovery - other }, ownerId);
    return raOut(u, one<RaRow>('SELECT * FROM ra_bills WHERE id = ?', id)!);
  });
}

/**
 * Certifies an RA bill: it and its measurements are final from now on, and its net amount becomes one bill in the books for
 * the supplier, sent for the bill approval rules. Certifying again (a retry) changes nothing and makes no second bill.
 * `expectedVersion` guards against two people certifying different versions at once.
 */
export function certifyRaBill(u: UserRow, ownerId: string, id: string, body: unknown) {
  const b0 = one<RaRow>('SELECT * FROM ra_bills WHERE id = ? AND owner_id = ?', id, ownerId);
  if (!b0) throw notFound('RA bill not found');
  visibleOrder(u, ownerId, b0.po_id); need(keepsBooks(u), 'manage_accounting');
  const v = new Validator(body ?? {});
  const expected = v.int('expectedVersion', { min: 1 });
  const dueDate = v.date('dueDate');
  v.done();
  return tx(() => {
    const b = one<RaRow>('SELECT * FROM ra_bills WHERE id = ?', id)!;
    if (b.status === 'certified') return { raBill: raOut(u, b), replayed: true };
    if (b.status !== 'draft') throw conflict('BAD_STATUS', 'Only a draft RA bill can be certified');
    if (expected !== undefined && expected !== b.version) throw conflict('VERSION_CHANGED', 'This RA bill changed since you opened it; look again before certifying');
    const o = poRow(ownerId, b.po_id);
    const actor = actorOf(u), t = now();
    let billId: string | null = null;
    if (b.net_paise > 0) {
      const bill = createBill(ownerId, actor, { vendorId: o.vendor_id, billNo: b.bill_no, billDate: today(), dueDate: dueDate ?? today(), amountPaise: b.net_paise,
        notes: `${o.po_no} ${b.bill_no}: gross ${rupees(b.gross_paise)}, tax ${rupees(b.tax_paise)}, retention ${rupees(b.retention_paise)}` });
      billId = bill.id;
      run('INSERT INTO construction_bills(bill_id, owner_id, project_id, po_id, ra_bill_id, created_at, created_by) VALUES (?,?,?,?,?,?,?)', bill.id, ownerId, o.project_id, o.id, id, t, u.id);
      submitBill(ownerId, actor, bill.id);
    }
    for (const r of many<{ measurement_id: string }>('SELECT measurement_id FROM ra_bill_lines WHERE ra_bill_id = ?', id)) run("UPDATE measurements SET status = 'certified' WHERE id = ?", r.measurement_id);
    run("UPDATE ra_bills SET status = 'certified', certified_at = ?, certified_by = ?, acct_bill_id = ?, version = version + 1 WHERE id = ?", t, u.id, billId, id);
    audit(actor, 'ra_bill.certify', 'ra_bill', id, { netPaise: b.net_paise, retentionPaise: b.retention_paise, billId }, ownerId);
    return { raBill: raOut(u, one<RaRow>('SELECT * FROM ra_bills WHERE id = ?', id)!), replayed: false };
  });
}

/** Cancels a draft RA bill; its measurements can be billed again. A certified one cannot be cancelled. */
export function cancelRaBill(u: UserRow, ownerId: string, id: string) {
  const b = one<RaRow>('SELECT * FROM ra_bills WHERE id = ? AND owner_id = ?', id, ownerId);
  if (!b) throw notFound('RA bill not found');
  visibleOrder(u, ownerId, b.po_id); need(keepsBooks(u), 'manage_accounting');
  if (b.status !== 'draft') throw conflict('BAD_STATUS', b.status === 'certified' ? 'A certified RA bill is final' : 'Already cancelled');
  return tx(() => {
    for (const r of many<{ measurement_id: string }>('SELECT measurement_id FROM ra_bill_lines WHERE ra_bill_id = ?', id)) run("UPDATE measurements SET status = 'draft' WHERE id = ?", r.measurement_id);
    // the lines go with the draft so each measurement can be billed again; the bill row stays, cancelled
    run('DELETE FROM ra_bill_lines WHERE ra_bill_id = ?', id);
    run("UPDATE ra_bills SET status = 'cancelled', version = version + 1 WHERE id = ?", id);
    audit(actorOf(u), 'ra_bill.cancel', 'ra_bill', id, { billNo: b.bill_no }, ownerId);
    return raOut(u, one<RaRow>('SELECT * FROM ra_bills WHERE id = ?', id)!);
  });
}

// ------------------------------------------------------------------ site: jobs, milestones, defects

const SEVERITIES = ['minor', 'major', 'critical'] as const;
interface DefectRow { id: string; project_id: string; title: string; location: string | null; severity: string; vendor_id: string | null; status: string; note: string | null; raised_at: number; raised_by: string | null; updated_at: number }
const defectOut = (d: DefectRow) => ({ id: d.id, title: d.title, location: d.location, severity: d.severity, vendorId: d.vendor_id,
  vendorName: d.vendor_id ? one<{ name: string }>('SELECT name FROM acct_vendors WHERE id = ?', d.vendor_id)?.name ?? null : null, status: d.status, note: d.note, raisedByName: nameOf(d.raised_by), raisedAt: d.raised_at, updatedAt: d.updated_at });

/** The Site view: the project's jobs (the task board's own records), its milestones, defects and recent goods received. */
export function site(u: UserRow, ownerId: string, id: string) {
  cproject(u, ownerId, id);
  const t = today();
  const jobs = many<{ id: string; title: string; status: string; stage: string; assigned_to: string | null; due_date: string | null }>(
    "SELECT id, title, status, stage, assigned_to, due_date FROM tasks WHERE project_id = ? AND status != 'cancelled' ORDER BY status = 'done', COALESCE(due_date, '9999-12-31'), created_at DESC LIMIT 200", id)
    .map((j) => ({ id: j.id, title: j.title, status: j.status, stage: j.stage, assignedName: nameOf(j.assigned_to), dueDate: j.due_date, overdue: j.status === 'open' && !!j.due_date && j.due_date < t }));
  const defects = many<DefectRow>("SELECT * FROM construction_defects WHERE project_id = ? ORDER BY status = 'closed', CASE severity WHEN 'critical' THEN 0 WHEN 'major' THEN 1 ELSE 2 END, raised_at DESC", id).map(defectOut);
  const receipts = many<{ id: string; grn_no: string; received_date: string; po_no: string; po_id: string }>(
    'SELECT g.id, g.grn_no, g.received_date, o.po_no, o.id po_id FROM goods_receipts g JOIN purchase_orders o ON o.id = g.po_id WHERE g.project_id = ? ORDER BY g.created_at DESC LIMIT 20', id)
    .map((g) => ({ id: g.id, grnNo: g.grn_no, date: g.received_date, poNo: g.po_no, poId: g.po_id }));
  const subcontractors = many<{ id: string; name: string; n: number }>("SELECT v.id, v.name, COUNT(*) n FROM purchase_orders o JOIN acct_vendors v ON v.id = o.vendor_id WHERE o.project_id = ? AND o.kind = 'work' AND o.status != 'cancelled' GROUP BY v.id ORDER BY v.name", id)
    .map((s) => ({ id: s.id, name: s.name, orders: s.n }));
  return { jobs, defects, receipts, subcontractors };
}

export function addDefect(u: UserRow, ownerId: string, projectId: string, body: unknown) {
  cproject(u, ownerId, projectId); need(runsSite(u), 'manage_tasks');
  const v = new Validator(body);
  const title = v.str('title', { required: true, min: 3, max: 200 }), location = v.str('location', { max: 120 }), note = v.str('note', { max: 1000 });
  const severity = v.oneOf('severity', SEVERITIES) ?? 'minor';
  const vendorId = v.str('vendorId', { max: 60 });
  v.done();
  if (vendorId && !one('SELECT 1 FROM acct_vendors WHERE id = ? AND owner_id = ? AND deleted_at IS NULL', vendorId, ownerId)) throw new HttpError(400, 'VALIDATION_FAILED', 'Unknown supplier');
  const id = newId('dfc'), t = now();
  run("INSERT INTO construction_defects(id, owner_id, project_id, title, location, severity, vendor_id, status, note, raised_at, raised_by, updated_at, updated_by) VALUES (?,?,?,?,?,?,?, 'open', ?,?,?,?,?)",
    id, ownerId, projectId, title!, location ?? null, severity, vendorId ?? null, note ?? null, t, u.id, t, u.id);
  audit(actorOf(u), 'defect.raise', 'construction_defect', id, { projectId, title, severity }, ownerId);
  return defectOut(one<DefectRow>('SELECT * FROM construction_defects WHERE id = ?', id)!);
}

export function updateDefect(u: UserRow, ownerId: string, id: string, body: unknown) {
  const d = one<DefectRow>('SELECT * FROM construction_defects WHERE id = ? AND owner_id = ?', id, ownerId);
  if (!d) throw notFound('Defect not found');
  try { cproject(u, ownerId, d.project_id); } catch (e) { if (e instanceof HttpError && e.status === 404) throw notFound('Defect not found'); throw e; }
  need(runsSite(u), 'manage_tasks');
  const v = new Validator(body);
  const status = v.oneOf('status', ['open', 'fixed', 'closed'] as const);
  const severity = v.oneOf('severity', SEVERITIES);
  const note = v.str('note', { max: 1000 });
  if (status === 'open' && d.status !== 'open' && !note) v.fail('note', 'Say why it is reopened');
  v.done();
  run('UPDATE construction_defects SET status = ?, severity = ?, note = ?, updated_at = ?, updated_by = ? WHERE id = ?', status ?? d.status, severity ?? d.severity, note ?? d.note, now(), u.id, id);
  audit(actorOf(u), 'defect.update', 'construction_defect', id, { from: d.status, to: status ?? d.status, ...(note ? { note } : {}) }, ownerId);
  return defectOut(one<DefectRow>('SELECT * FROM construction_defects WHERE id = ?', id)!);
}

// ------------------------------------------------------------------ plans and documents

interface CDocRow { doc_id: string; project_id: string; kind: 'drawing' | 'document'; title: string; drawing_no: string | null; revision: string | null; current: number; linked_at: number; linked_by: string | null; name: string; mime: string; bytes: number }
const cdocOut = (d: CDocRow) => ({ docId: d.doc_id, kind: d.kind, title: d.title, drawingNo: d.drawing_no, revision: d.revision, current: !!d.current, fileName: d.name, mime: d.mime, bytes: d.bytes, linkedByName: nameOf(d.linked_by), linkedAt: d.linked_at });

export function listProjectDocs(u: UserRow, ownerId: string, projectId: string) {
  cproject(u, ownerId, projectId);
  return { items: many<CDocRow>(`SELECT c.*, d.name, d.mime, d.bytes FROM construction_docs c JOIN docs d ON d.id = c.doc_id
      WHERE c.project_id = ? AND d.deleted_at IS NULL ORDER BY c.kind DESC, c.current DESC, COALESCE(c.drawing_no, c.title), c.linked_at DESC`, projectId).map(cdocOut) };
}

/** Puts a document of the business on a project, as a drawing (with its number and revision) or a document. */
export function linkProjectDoc(u: UserRow, ownerId: string, projectId: string, body: unknown) {
  cproject(u, ownerId, projectId); need(runsSite(u), 'manage_tasks');
  const v = new Validator(body);
  const docId = v.str('docId', { required: true, max: 60 });
  const kind = v.oneOf('kind', ['drawing', 'document'] as const) ?? 'document';
  const title = v.str('title', { max: 200 });
  const drawingNo = v.str('drawingNo', { max: 40 }), revision = v.str('revision', { max: 10 });
  if (kind === 'drawing' && !drawingNo) v.fail('drawingNo', 'A drawing needs its number');
  v.done();
  const d = one<{ id: string; name: string }>('SELECT id, name FROM docs WHERE id = ? AND owner_id = ? AND deleted_at IS NULL', docId!, ownerId);
  if (!d) throw notFound('Document not found');
  if (one('SELECT 1 FROM construction_docs WHERE doc_id = ? AND project_id = ?', docId!, projectId)) throw conflict('ALREADY_LINKED', 'This document is already on the project');
  const no = drawingNo?.toUpperCase() ?? null;
  tx(() => {
    if (kind === 'drawing') {
      if (one("SELECT 1 FROM construction_docs WHERE project_id = ? AND kind = 'drawing' AND drawing_no = ? AND COALESCE(revision, '') = ?", projectId, no!, revision ?? '')) throw conflict('REVISION_EXISTS', `Drawing ${no} revision ${revision ?? '(none)'} is already on the project`);
      run("UPDATE construction_docs SET current = 0 WHERE project_id = ? AND kind = 'drawing' AND drawing_no = ?", projectId, no!);
    }
    run('INSERT INTO construction_docs(doc_id, project_id, owner_id, kind, title, drawing_no, revision, current, linked_at, linked_by) VALUES (?,?,?,?,?,?,?,1,?,?)',
      docId!, projectId, ownerId, kind, title ?? d.name, no, revision ?? null, now(), u.id);
  });
  audit(actorOf(u), 'construction.doc', 'project', projectId, { docId, kind, drawingNo: no, revision: revision ?? null }, ownerId);
  return listProjectDocs(u, ownerId, projectId);
}

/** Someone who may see the project may open its drawings and documents (they are needed on site), and nothing else in Documents. */
export function projectDocAllowed(u: UserRow, ownerId: string, docId: string): void {
  mustSee(u);
  const rows = many<{ project_id: string }>('SELECT project_id FROM construction_docs WHERE doc_id = ? AND owner_id = ?', docId, ownerId);
  for (const r of rows) { try { cproject(u, ownerId, r.project_id); return; } catch { /* try the next project */ } }
  throw notFound('Document not found');
}

// ------------------------------------------------------------------ finance

/** The project's money, read from the records that hold it: BOQ, orders, receipts, measurements, bills and payments in the books. */
export function finance(u: UserRow, ownerId: string, id: string) {
  cproject(u, ownerId, id);
  if (!seesMoney(u)) throw forbidden('Project money needs the "view_revenue" or "manage_accounting" permission');
  const f = figuresOf(id);
  const orders = many<PoRow>("SELECT * FROM purchase_orders WHERE project_id = ? AND status != 'cancelled' ORDER BY created_at", id).map((o) => orderOut(u, o));
  const bills = many<{ id: string; bill_no: string | null; bill_date: string; due_date: string; amount_paise: number; status: string; vendor: string; po_no: string | null; ra: string | null }>(
    `SELECT b.id, b.bill_no, b.bill_date, b.due_date, b.amount_paise, b.status, v.name vendor, o.po_no, r.bill_no ra FROM construction_bills cb JOIN acct_bills b ON b.id = cb.bill_id
       JOIN acct_vendors v ON v.id = b.vendor_id LEFT JOIN purchase_orders o ON o.id = cb.po_id LEFT JOIN ra_bills r ON r.id = cb.ra_bill_id
      WHERE cb.project_id = ? AND b.deleted_at IS NULL ORDER BY b.bill_date DESC`, id)
    .map((b) => ({ id: b.id, billNo: b.bill_no, date: b.bill_date, dueDate: b.due_date, amountPaise: b.amount_paise, status: b.status, vendorName: b.vendor, poNo: b.po_no, raBillNo: b.ra }));
  const explain = {
    budgetPaise: 'The current BOQ: every item at its latest revision, quantity × rate, before tax.',
    committedPaise: 'Approved, receiving, received and closed orders, before tax. Drafts, orders waiting for approval and cancelled ones are left out.',
    receivedPaise: 'Goods accepted on site (received less rejected) at the order rates, before tax.',
    measuredPaise: 'Work measured on site on work orders, at the order rates, before tax. Corrected measurements count once, at the corrected figure.',
    billedPaise: 'Supplier bills in the books for this project (with tax, less retention on RA bills), not counting rejected ones.',
    paidPaise: 'Of those bills, the ones marked paid in Revenue & Accounting.',
    outstandingPaise: 'Approved bills not yet paid.',
    retentionHeldPaise: 'Retention kept back on certified RA bills. It is not in any bill yet; it is paid when the retention is released.',
  };
  return { figures: f, orders, bills, explain };
}
