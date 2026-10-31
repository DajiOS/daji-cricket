import { many, one } from './db.ts';
import { now } from './clock.ts';
import { HttpError, notFound, forbidden } from './errors.ts';
import { userRow, type UserRow } from './auth.ts';
import { audit } from './audit.ts';
import { portfolioOf } from './portfolio.ts';
import { balanceOf } from './cashbook.ts';
import { profitAndLoss } from './accounting/statements.ts';
import { addDays, istDate, istMidnight, isValidDate } from './time.ts';

// The owner's combined view, "All my businesses" (redesign step 6, design doc 30 Oct 2026). One owner's sign-in opens several
// businesses (portfolio.ts); the ones they mark "Mine" are shown here side by side: each business, its branches (areas.ts) and its
// projects. A business they only support (Antroli, a friend's ground) never appears.
//
// It only reads. Each business is read on its own, with the same functions its own pages use, and the results are put next to
// each other; nothing is written, and no combined book is made. To act on a line the owner opens it in its own business.
//
// The rules from the design doc:
// - Every line keeps its business, branch and project, and a link to the original record.
// - Totals are per currency and per business first, then added up. A business that cannot be read says "not available", never ₹0,
//   and the combined total says which businesses it leaves out.
// - Money moved into a supervisor's wallet is a movement of the owner's own cash, not spending: it is shown once, as "handed out",
//   and only the spends from the wallet count as spending.
// - Cash records are not posted to the books yet (the accountant decides how, cashbook.ts), so the books and the cash spends are
//   shown side by side and never added together: that would count the same rupee twice once the posting starts.
// - The books are kept per business, not per branch. Narrowed to a branch, project or person, the books say "not split by branch"
//   rather than showing the whole business's figure under a branch name.

export const CURRENCY = 'INR'; // every Daji business keeps its books in rupees today; the totals are still kept per currency
const MAX_DAYS = 3 * 366;
/** Lines of each kind shown for each business; kept in an object so a test can lower it. */
export const limits = { lines: 200 };

export interface CombinedFilters { businessId: string | null; areaId: string | null; projectId: string | null; personId: string | null; from: string; to: string }

type Avail<T> = ({ status: 'ok' } & T) | { status: 'not_split'; why: string } | { status: 'unavailable'; why: string };

export interface Books { revenuePaise: number; expensesPaise: number; netProfitPaise: number }
export interface Wallet { holderId: string; holderName: string | null; givenPaise: number; expectedPaise: number; confirmedPaise: number; waiting: number; spentWaitingPaise: number }
export interface Cash { handedOutPaise: number; returnedPaise: number; spentConfirmedPaise: number; spentWaitingPaise: number; spends: number; wallets: Wallet[] | null }
export interface Tasks { open: number; overdue: number; doneInRange: number }

export interface BusinessBlock {
  id: string; name: string; own: boolean; currency: string;
  status: 'ok' | 'unavailable';
  books: Avail<Books>;
  cash: Avail<Cash>;
  tasks: Avail<Tasks>;
  approvalsWaiting: Avail<{ count: number }>;
}

export interface Row {
  businessId: string; businessName: string; areaId: string | null; areaName: string | null; restricted: boolean;
  projectId: string | null; projectName: string | null;
  spentConfirmedPaise: number; spentWaitingPaise: number; openTasks: number; overdueTasks: number; doneTasks: number;
}

export interface Line {
  kind: 'spend' | 'task'; id: string; businessId: string; businessName: string; areaName: string | null; projectName: string | null;
  personName: string | null; date: string | null; title: string; amountPaise: number | null; status: string;
  /** Where the original record is: the page of that business (the desk opens it in that business). */
  open: { businessId: string; page: 'cash' | 'tasks'; id: string; holderId?: string };
}

/**
 * One part of the total (the books, the cash or the jobs). Each part says which businesses it covers and which it leaves out
 * because that part of them could not be read: a part with no business read is null ("not available"), never zero, and a part
 * that leaves some out is marked partial. A part kept for the whole business only (the books, narrowed to a branch) is null with
 * `notSplit`.
 */
export interface Part<T> { value: T | null; included: string[]; leftOut: string[]; partial: boolean; notSplit: boolean }

export interface Total {
  currency: string;
  books: Part<Books>;
  cash: Part<{ handedOutPaise: number; returnedPaise: number; spentConfirmedPaise: number; spentWaitingPaise: number }>;
  tasks: Part<{ open: number; overdue: number; done: number }>;
  /** Every business with some part not read, and what that part was, in words ("Sunny's Portfolio: books"). */
  leftOut: string[];
  booksNote: string | null;
}

export interface Combined {
  label: string; readOnly: true; asOf: string;
  filters: CombinedFilters;
  options: {
    businesses: { id: string; name: string; own: boolean }[];
    supported: number;
    areas: { id: string; name: string; businessId: string; restricted: boolean; archived: boolean }[];
    projects: { id: string; name: string; businessId: string; areaId: string | null }[];
    people: { id: string; name: string; businessIds: string[] }[];
  };
  businesses: BusinessBlock[];
  byArea: Row[];
  byProject: Row[];
  lines: Line[];
  /** True when some list was cut at `limits.lines`: the lines are not everything in these dates. */
  linesCut: boolean;
  totals: Total[];
  notes: string[];
}

// ---------------------------------------------------------------- the readers (one business at a time)

interface Scope { ownerId: string; f: CombinedFilters }

/** SQL for "this record is in the chosen branch / project", through the project's branch where the record has no branch of its own. */
function scopeSql(s: Scope, areaCol: string | null, projectCol: string): { sql: string; params: string[] } {
  const parts: string[] = [], params: string[] = [];
  if (s.f.projectId) { parts.push(`${projectCol} = ?`); params.push(s.f.projectId); }
  else if (s.f.areaId) {
    const viaProject = `${projectCol} IN (SELECT id FROM projects WHERE area_id = ?)`;
    parts.push(areaCol ? `(${areaCol} = ? OR (${areaCol} IS NULL AND ${viaProject}))` : viaProject);
    params.push(...(areaCol ? [s.f.areaId, s.f.areaId] : [s.f.areaId]));
  }
  return { sql: parts.length ? parts.join(' AND ') : '1 = 1', params };
}

// A request someone raised (the Tasks inbox, step 5) is not a job until a manager takes it in, so it is left out of every job count
// and list here, as on the board. Checked by column so this view works the same before and after that change reaches a database.
const notRequest = (): string => (many<{ name: string }>('PRAGMA table_info(tasks)').some((c) => c.name === 'intake_state') ? " AND (intake_state IS NULL OR intake_state <> 'new')" : '');

const startMs = (d: string) => istMidnight(d);
const endMs = (d: string) => istMidnight(addDays(d, 1));

/** The readers are kept in one object so a test can make one business unreadable and check it shows "not available". */
export const readers = {
  books(ownerId: string, f: CombinedFilters): Books {
    const p = profitAndLoss(ownerId, { from: f.from, to: f.to });
    return { revenuePaise: p.revenue.totalPaise, expensesPaise: p.expenses.totalPaise, netProfitPaise: p.netProfitPaise };
  },
  cash(s: Scope): Cash {
    const narrowed = !!(s.f.areaId || s.f.projectId);
    const sc = scopeSql(s, 'area_id', 'project_id');
    const who = s.f.personId ? ' AND holder_id = ?' : '';
    const wp = s.f.personId ? [s.f.personId] : [];
    const spent = one<{ conf: number; wait: number; n: number }>(
      `SELECT COALESCE(SUM(CASE WHEN status = 'confirmed' THEN amount_paise END), 0) conf, COALESCE(SUM(CASE WHEN status = 'waiting' THEN amount_paise END), 0) wait, COUNT(*) n
         FROM cash_entries WHERE owner_id = ? AND kind = 'expense' AND status IN ('confirmed','waiting') AND hidden_at IS NULL AND on_date BETWEEN ? AND ? AND ${sc.sql}${who}`,
      s.ownerId, s.f.from, s.f.to, ...sc.params, ...wp)!;
    // cash handed out is the owner's own money moving into a wallet: shown once, as a movement, never as spending. Hand-outs and
    // returns are kept apart: a return in these dates may be for an advance from earlier dates, so a net figure could go below zero.
    const moved = narrowed ? { adv: 0, ret: 0 } : one<{ adv: number; ret: number }>(
      `SELECT COALESCE(SUM(CASE WHEN kind = 'advance' THEN amount_paise END), 0) adv, COALESCE(SUM(CASE WHEN kind = 'return' THEN amount_paise END), 0) ret
         FROM cash_entries WHERE owner_id = ? AND kind IN ('advance','return') AND hidden_at IS NULL AND on_date BETWEEN ? AND ?${who}`, s.ownerId, s.f.from, s.f.to, ...wp)!;
    // what each holder should have in hand now; a wallet is not kept per branch, so it is left out when narrowed to one
    let wallets: Wallet[] | null = null;
    if (!narrowed) {
      const ids = many<{ holder_id: string }>('SELECT DISTINCT holder_id FROM cash_entries WHERE owner_id = ? UNION SELECT DISTINCT holder_id FROM cash_counts WHERE owner_id = ?', s.ownerId, s.ownerId)
        .map((r) => r.holder_id).filter((id) => !s.f.personId || id === s.f.personId);
      wallets = ids.map((id) => balanceOf(s.ownerId, id)).map((b) => ({ holderId: b.holderId, holderName: b.holderName, givenPaise: b.givenPaise, expectedPaise: b.expectedPaise, confirmedPaise: b.confirmedPaise, waiting: b.waiting, spentWaitingPaise: b.spentWaitingPaise }))
        .sort((a, b) => (a.holderName ?? '').localeCompare(b.holderName ?? ''));
    }
    return { handedOutPaise: moved.adv, returnedPaise: moved.ret, spentConfirmedPaise: spent.conf, spentWaitingPaise: spent.wait, spends: spent.n, wallets };
  },
  tasks(s: Scope): Tasks {
    const today = istDate(now());
    const sc = scopeSql(s, null, 'project_id');
    const who = s.f.personId ? ' AND assigned_to = ?' : '';
    const wp = s.f.personId ? [s.f.personId] : [];
    const r = one<{ open: number; overdue: number; done: number }>(
      `SELECT COALESCE(SUM(status = 'open'), 0) open, COALESCE(SUM(status = 'open' AND due_date IS NOT NULL AND due_date < ?), 0) overdue,
              COALESCE(SUM(status = 'done' AND completed_at >= ? AND completed_at < ?), 0) done
         FROM tasks WHERE owner_id = ? AND ${sc.sql}${who}${notRequest()}`, today, startMs(s.f.from), endMs(s.f.to), s.ownerId, ...sc.params, ...wp)!;
    return { open: r.open, overdue: r.overdue, doneInRange: r.done };
  },
  approvals(ownerId: string): { count: number } {
    return { count: one<{ n: number }>("SELECT COUNT(*) n FROM approval_requests WHERE owner_id = ? AND status = 'pending'", ownerId)!.n };
  },
};

const wrap = <T>(fn: () => T): Avail<T> => {
  try { return { status: 'ok', ...fn() } as Avail<T>; } catch { return { status: 'unavailable', why: 'Could not be read just now. Open the business itself, or try again.' }; }
};

// ---------------------------------------------------------------- the view

/** Only a business owner's own sign-in has a combined view; a team member or customer never does. */
function ownerOf(real: UserRow | null | undefined): UserRow {
  if (!real || real.role !== 'owner' || !real.active) throw forbidden('Only a business owner has the combined view of their businesses.');
  return real;
}

function parseFilters(q: Record<string, string | null | undefined>): CombinedFilters {
  const today = istDate(now());
  const clean = (k: string): string | null => { const v = q[k]; return typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : null; };
  const from = clean('from') ?? today.slice(0, 8) + '01';
  const to = clean('to') ?? today;
  const bad = (field: string, message: string) => new HttpError(400, 'VALIDATION_FAILED', message, { fields: [{ field, message }] });
  if (!isValidDate(from)) throw bad('from', 'Must be a date like 2026-10-01');
  if (!isValidDate(to)) throw bad('to', 'Must be a date like 2026-10-31');
  if (to < from) throw bad('to', 'The end date is before the start date');
  if ((istMidnight(to) - istMidnight(from)) / 86_400_000 > MAX_DAYS) throw bad('from', 'Pick at most three years at a time');
  return { businessId: clean('business'), areaId: clean('area'), projectId: clean('project'), personId: clean('person'), from, to };
}

/**
 * The combined view for this signed-in owner. `real` is the person who signed in (not the business they may be switched into):
 * the view is about their portfolio, whichever business the desk has open. Filters that name a business, branch, project or person
 * outside the businesses they marked "Mine" answer 404, so nothing about another business is given away.
 */
export function combinedView(real: UserRow | null | undefined, query: Record<string, string | null | undefined>): Combined {
  const u = ownerOf(real);
  const f = parseFilters(query);
  const portfolio = portfolioOf(u);
  const mine = portfolio.filter((p) => p.relation === 'mine');
  const mineIds = mine.map((b) => b.id);
  const inMine = (id: string | null | undefined): id is string => !!id && mineIds.includes(id);

  // the owner of each business sees all its branches, restricted ones included (areas.ts); so does the person who holds it
  const areas = mineIds.length ? many<{ id: string; owner_id: string; name: string; restricted: number; archived_at: number | null }>(
    `SELECT id, owner_id, name, restricted, archived_at FROM areas WHERE owner_id IN (${mineIds.map(() => '?').join(',')}) ORDER BY lower(name)`, ...mineIds) : [];
  const projects = mineIds.length ? many<{ id: string; owner_id: string; name: string; area_id: string | null; status: string }>(
    `SELECT id, owner_id, name, area_id, status FROM projects WHERE owner_id IN (${mineIds.map(() => '?').join(',')}) ORDER BY lower(name)`, ...mineIds) : [];
  const people = new Map<string, { id: string; name: string; businessIds: string[] }>();
  for (const b of mineIds) {
    for (const s of many<{ id: string; name: string }>(`SELECT id, name FROM users WHERE role = 'staff' AND (owner_id = ? OR id IN (SELECT user_id FROM team_memberships WHERE owner_id = ? AND removed_at IS NULL)
        OR id IN (SELECT holder_id FROM cash_entries WHERE owner_id = ?) OR id IN (SELECT assigned_to FROM tasks WHERE owner_id = ? AND assigned_to IS NOT NULL)) ORDER BY name COLLATE NOCASE`, b, b, b, b)) {
      const p = people.get(s.id) ?? { id: s.id, name: s.name, businessIds: [] };
      p.businessIds.push(b); people.set(s.id, p);
    }
  }

  // every filter must point inside the owner's own businesses; the branch and project also fix the business
  if (f.businessId && !inMine(f.businessId)) throw notFound('Business not found');
  if (f.areaId) {
    const a = areas.find((x) => x.id === f.areaId);
    if (!a || (f.businessId && a.owner_id !== f.businessId)) throw notFound('Branch not found');
    f.businessId = a.owner_id;
  }
  if (f.projectId) {
    const p = projects.find((x) => x.id === f.projectId);
    if (!p || (f.businessId && p.owner_id !== f.businessId) || (f.areaId && p.area_id !== f.areaId)) throw notFound('Project not found');
    f.businessId = p.owner_id;
  }
  if (f.personId && !people.has(f.personId)) throw notFound('Person not found');
  const narrowed = !!(f.areaId || f.projectId || f.personId);

  const shown = mine.filter((b) => (!f.businessId || b.id === f.businessId) && (!f.personId || people.get(f.personId)!.businessIds.includes(b.id)));
  const notSplit = (what: string) => ({ status: 'not_split' as const, why: `${what} are kept for the whole business, not per branch, project or person. Clear those filters to see them.` });

  const businesses: BusinessBlock[] = shown.map((b) => {
    const s: Scope = { ownerId: b.id, f };
    const books = narrowed ? notSplit('The books') : wrap(() => readers.books(b.id, f));
    const cash = wrap(() => readers.cash(s));
    const tasks = wrap(() => readers.tasks(s));
    const approvalsWaiting = narrowed ? notSplit('Approvals') : wrap(() => readers.approvals(b.id));
    const parts = [books, cash, tasks, approvalsWaiting];
    return { id: b.id, name: b.businessName, own: b.own, currency: CURRENCY, status: parts.some((x) => x.status === 'unavailable') ? 'unavailable' : 'ok', books, cash, tasks, approvalsWaiting };
  });

  // ---- by branch and by project, for the businesses that could be read
  const readable = businesses.filter((b) => b.cash.status === 'ok' && b.tasks.status === 'ok').map((b) => b.id);
  const byArea: Row[] = [], byProject: Row[] = [];
  const nameOfBiz = (id: string) => mine.find((m) => m.id === id)?.businessName ?? '';
  for (const bid of readable) {
    const s: Scope = { ownerId: bid, f };
    const projArea = f.projectId ? projects.find((p) => p.id === f.projectId)?.area_id ?? null : undefined;
    const bAreas = areas.filter((a) => a.owner_id === bid && (!f.areaId || a.id === f.areaId) && (projArea === undefined || a.id === projArea));
    const rowFor = (areaId: string | null, areaName: string | null, restricted: boolean, projectId: string | null, projectName: string | null): Row => {
      // a spend is in a branch by its own tag, or by its project's branch; a job only through its project
      const spendWhere = projectId ? 'project_id = ?' : areaId ? '(area_id = ? OR (area_id IS NULL AND project_id IN (SELECT id FROM projects WHERE area_id = ?)))'
        : '(area_id IS NULL AND (project_id IS NULL OR project_id IN (SELECT id FROM projects WHERE area_id IS NULL)))';
      const spendP = projectId ? [projectId] : areaId ? [areaId, areaId] : [];
      const taskWhere = projectId ? 'project_id = ?' : areaId ? 'project_id IN (SELECT id FROM projects WHERE area_id = ?)' : '(project_id IS NULL OR project_id IN (SELECT id FROM projects WHERE area_id IS NULL))';
      const taskP = projectId ? [projectId] : areaId ? [areaId] : [];
      const sc = scopeSql(s, 'area_id', 'project_id'), tc = scopeSql(s, null, 'project_id');
      const sp = one<{ conf: number; wait: number }>(`SELECT COALESCE(SUM(CASE WHEN status = 'confirmed' THEN amount_paise END), 0) conf, COALESCE(SUM(CASE WHEN status = 'waiting' THEN amount_paise END), 0) wait
        FROM cash_entries WHERE owner_id = ? AND kind = 'expense' AND status IN ('confirmed','waiting') AND hidden_at IS NULL AND on_date BETWEEN ? AND ? AND ${spendWhere} AND ${sc.sql}${f.personId ? ' AND holder_id = ?' : ''}`,
        bid, f.from, f.to, ...spendP, ...sc.params, ...(f.personId ? [f.personId] : []))!;
      const today = istDate(now());
      const tk = one<{ open: number; overdue: number; done: number }>(`SELECT COALESCE(SUM(status = 'open'), 0) open, COALESCE(SUM(status = 'open' AND due_date IS NOT NULL AND due_date < ?), 0) overdue,
        COALESCE(SUM(status = 'done' AND completed_at >= ? AND completed_at < ?), 0) done FROM tasks WHERE owner_id = ? AND ${taskWhere} AND ${tc.sql}${f.personId ? ' AND assigned_to = ?' : ''}${notRequest()}`,
        today, startMs(f.from), endMs(f.to), bid, ...taskP, ...tc.params, ...(f.personId ? [f.personId] : []))!;
      return { businessId: bid, businessName: nameOfBiz(bid), areaId, areaName, restricted, projectId, projectName,
        spentConfirmedPaise: sp.conf, spentWaitingPaise: sp.wait, openTasks: tk.open, overdueTasks: tk.overdue, doneTasks: tk.done };
    };
    const empty = (r: Row) => !r.spentConfirmedPaise && !r.spentWaitingPaise && !r.openTasks && !r.doneTasks;
    for (const a of bAreas) { const r = rowFor(a.id, a.name, !!a.restricted, null, null); if (!a.archived_at || !empty(r)) byArea.push(r); }
    if (!f.areaId && !f.projectId) { const r = rowFor(null, null, false, null, null); if (!empty(r)) byArea.push(r); }
    for (const p of projects.filter((x) => x.owner_id === bid && (!f.areaId || x.area_id === f.areaId) && (!f.projectId || x.id === f.projectId))) {
      const a = areas.find((x) => x.id === p.area_id);
      const r = rowFor(null, a?.name ?? null, !!a?.restricted, p.id, p.name);
      r.areaId = p.area_id;
      if (p.status !== 'archived' || !empty(r)) byProject.push(r);
    }
  }

  // ---- the lines themselves, each with its labels and a link to the original record
  const lines: Line[] = [];
  // each list asks for one more row than it shows, so a cut list is known and said, never passed off as everything
  let truncated = false;
  const seen = <T,>(rows: T[]): T[] => { if (rows.length > limits.lines) truncated = true; return rows; };
  const names = new Map<string, string | null>();
  const nm = (id: string | null) => { if (!id) return null; if (!names.has(id)) names.set(id, userRow(id)?.name ?? null); return names.get(id)!; };
  const areaName = (id: string | null) => (id ? areas.find((a) => a.id === id)?.name ?? null : null);
  const proj = (id: string | null) => (id ? projects.find((p) => p.id === id) ?? null : null);
  for (const bid of readable) {
    const s: Scope = { ownerId: bid, f };
    const sc = scopeSql(s, 'area_id', 'project_id');
    for (const e of seen(many<{ id: string; holder_id: string; amount_paise: number; on_date: string; description: string; area_id: string | null; project_id: string | null; status: string }>(
      `SELECT id, holder_id, amount_paise, on_date, description, area_id, project_id, status FROM cash_entries
        WHERE owner_id = ? AND kind = 'expense' AND status IN ('confirmed','waiting') AND hidden_at IS NULL AND on_date BETWEEN ? AND ? AND ${sc.sql}${f.personId ? ' AND holder_id = ?' : ''}
        ORDER BY on_date DESC, created_at DESC LIMIT ?`, bid, f.from, f.to, ...sc.params, ...(f.personId ? [f.personId] : []), limits.lines + 1)).slice(0, limits.lines)) {
      const p = proj(e.project_id);
      lines.push({ kind: 'spend', id: e.id, businessId: bid, businessName: nameOfBiz(bid), areaName: areaName(e.area_id ?? p?.area_id ?? null), projectName: p?.name ?? null,
        personName: nm(e.holder_id), date: e.on_date, title: e.description, amountPaise: e.amount_paise, status: e.status, open: { businessId: bid, page: 'cash', id: e.id, holderId: e.holder_id } });
    }
    const tc = scopeSql(s, null, 'project_id');
    for (const t of seen(many<{ id: string; title: string; assigned_to: string | null; due_date: string | null; project_id: string | null }>(
      `SELECT id, title, assigned_to, due_date, project_id FROM tasks WHERE owner_id = ? AND status = 'open' AND ${tc.sql}${f.personId ? ' AND assigned_to = ?' : ''}${notRequest()}
        ORDER BY due_date IS NULL, due_date, created_at LIMIT ?`, bid, ...tc.params, ...(f.personId ? [f.personId] : []), limits.lines + 1)).slice(0, limits.lines)) {
      const p = proj(t.project_id);
      lines.push({ kind: 'task', id: t.id, businessId: bid, businessName: nameOfBiz(bid), areaName: areaName(p?.area_id ?? null), projectName: p?.name ?? null,
        personName: nm(t.assigned_to), date: t.due_date, title: t.title, amountPaise: null, status: 'open', open: { businessId: bid, page: 'tasks', id: t.id } });
    }
  }

  // ---- totals: per currency, each part from the businesses whose part could be read; what is left out is named per part
  const totals: Total[] = [];
  const part = <T,>(bs: BusinessBlock[], pick: (b: BusinessBlock) => Avail<unknown>, zero: () => T, add: (acc: T, b: BusinessBlock) => void, notSplit = false): Part<T> => {
    if (notSplit) return { value: null, included: [], leftOut: [], partial: false, notSplit: true };
    const ok = bs.filter((b) => pick(b).status === 'ok'), bad = bs.filter((b) => pick(b).status === 'unavailable');
    let value: T | null = null;
    if (ok.length) { value = zero(); for (const b of ok) add(value, b); }
    return { value, included: ok.map((b) => b.name), leftOut: bad.map((b) => b.name), partial: ok.length > 0 && bad.length > 0, notSplit: false };
  };
  for (const cur of [...new Set(businesses.map((b) => b.currency))]) {
    const bs = businesses.filter((b) => b.currency === cur);
    const books = part<Books>(bs, (b) => b.books, () => ({ revenuePaise: 0, expensesPaise: 0, netProfitPaise: 0 }), (a, b) => {
      const x = b.books as Books; a.revenuePaise += x.revenuePaise; a.expensesPaise += x.expensesPaise; a.netProfitPaise += x.netProfitPaise;
    }, narrowed);
    const cash = part(bs, (b) => b.cash, () => ({ handedOutPaise: 0, returnedPaise: 0, spentConfirmedPaise: 0, spentWaitingPaise: 0 }), (a, b) => {
      const x = b.cash as Cash; a.handedOutPaise += x.handedOutPaise; a.returnedPaise += x.returnedPaise; a.spentConfirmedPaise += x.spentConfirmedPaise; a.spentWaitingPaise += x.spentWaitingPaise;
    });
    const tasks = part(bs, (b) => b.tasks, () => ({ open: 0, overdue: 0, done: 0 }), (a, b) => {
      const x = b.tasks as Tasks; a.open += x.open; a.overdue += x.overdue; a.done += x.doneInRange;
    });
    const leftOut = bs.flatMap((b) => {
      const parts = ([['books', b.books], ['cash', b.cash], ['jobs', b.tasks], ['approvals', b.approvalsWaiting]] as const).filter(([, a]) => a.status === 'unavailable').map(([w]) => w);
      return parts.length ? [`${b.name}: ${parts.join(', ')}`] : [];
    });
    const booksNote = narrowed ? 'The books are kept per business, not per branch, project or person.'
      : books.value === null && books.leftOut.length ? `Not available: the books of ${books.leftOut.join(', ')} could not be read.`
      : books.partial ? `Partial: leaves out the books of ${books.leftOut.join(', ')}, which could not be read.` : null;
    totals.push({ currency: cur, books, cash, tasks, leftOut, booksNote });
  }

  const supported = portfolio.length - mine.length;
  const notes = [
    'A combined view: each business keeps its own books. Nothing here is a set of books of its own, and nothing can be changed from here.',
    'Cash handed to a wallet is a movement of your own money, shown once. Only spends from the wallet count as spending.',
    'Cash spends are not posted to the books yet, so they are shown next to the books and not added to them.',
    ...(supported ? [`${supported === 1 ? 'One business you support is' : `${supported} businesses you support are`} not included. Mark a business "Mine" in Settings › Branches and access to include it.`] : []),
    ...(businesses.some((b) => !readable.includes(b.id)) ? [`The branches, projects and lines leave out ${businesses.filter((b) => !readable.includes(b.id)).map((b) => b.name).join(', ')}, whose cash or jobs could not be read just now.`] : []),
    ...(truncated ? [`Lines are cut at the latest ${limits.lines} of each kind for each business. Narrow the dates or filters to see the rest.`] : []),
  ];

  audit({ id: u.id, role: u.role }, 'combined.view', 'portfolio', u.id, { business: f.businessId, area: f.areaId, project: f.projectId, person: f.personId, from: f.from, to: f.to }, u.id);

  return {
    label: 'All my businesses (combined view)', readOnly: true, asOf: istDate(now()), filters: f,
    options: {
      businesses: mine.map((b) => ({ id: b.id, name: b.businessName, own: b.own })), supported,
      areas: areas.map((a) => ({ id: a.id, name: a.name, businessId: a.owner_id, restricted: !!a.restricted, archived: a.archived_at !== null })),
      projects: projects.filter((p) => p.status !== 'archived').map((p) => ({ id: p.id, name: p.name, businessId: p.owner_id, areaId: p.area_id })),
      people: [...people.values()],
    },
    businesses, byArea, byProject, lines, linesCut: truncated, totals, notes,
  };
}

/**
 * The person who signed in, for code that only has the user a request acts as (Ask AI): while an owner is switched into another
 * business of their portfolio, `acting` names the real person (audit.ts).
 */
export function realOwnerFor(u: UserRow, acting: { realId: string; ownerId: string } | undefined): UserRow | null {
  if (acting && acting.ownerId === u.id) return userRow(acting.realId) ?? null;
  return u;
}
