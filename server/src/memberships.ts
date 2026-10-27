import { checkCashSingle } from './taxrules.ts';
import { many, one, registerSchema, run, tx } from './db.ts';
import { now } from './clock.ts';
import { audit, listAudit, type Actor } from './audit.ts';
import { conflict, notFound } from './errors.ts';
import { newId } from './ids.ts';
import { Validator } from './input.ts';
import { addDays, istDate, monthRange } from './time.ts';
import { postToLedger, type LedgerRef } from './accounting/autopost.ts';

// Club memberships: plans, members, and every sale or renewal as a payment row.

registerSchema('memberships-1', `
CREATE TABLE membership_plans (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  price_paise INTEGER NOT NULL,
  duration_days INTEGER NOT NULL,
  perks TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  deleted_at INTEGER,
  deleted_by TEXT
);
CREATE INDEX ix_membership_plans_owner ON membership_plans(owner_id);

CREATE TABLE memberships (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  plan_id TEXT NOT NULL REFERENCES membership_plans(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  notes TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  deleted_at INTEGER,
  deleted_by TEXT
);
CREATE INDEX ix_memberships_owner ON memberships(owner_id, end_date);
CREATE UNIQUE INDEX uq_memberships_phone ON memberships(owner_id, phone) WHERE deleted_at IS NULL;

CREATE TABLE membership_payments (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  membership_id TEXT NOT NULL REFERENCES memberships(id),
  plan_id TEXT NOT NULL REFERENCES membership_plans(id),
  kind TEXT NOT NULL CHECK (kind IN ('sale','renewal')),
  amount_paise INTEGER NOT NULL,
  method TEXT NOT NULL,
  reference TEXT,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  paid_on TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  deleted_at INTEGER,
  deleted_by TEXT
);
CREATE INDEX ix_membership_payments_owner ON membership_payments(owner_id, paid_on);
CREATE INDEX ix_membership_payments_member ON membership_payments(membership_id);
`);

registerSchema('memberships-2', `ALTER TABLE membership_payments ADD COLUMN ledger_txn_id TEXT;`);

export const METHODS = ['cash', 'upi', 'bank_transfer', 'card', 'other'] as const;
export const EXPIRING_DAYS = 14;
const today = (): string => istDate(now());

export type MemberStatus = 'active' | 'expiring' | 'expired';
export function statusOf(endDate: string, on = today()): MemberStatus {
  if (endDate < on) return 'expired';
  return endDate <= addDays(on, EXPIRING_DAYS) ? 'expiring' : 'active';
}
const daysBetween = (a: string, b: string): number => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000);

// ------------------------------------------------------------------ plans

interface PlanRow { id: string; owner_id: string; name: string; price_paise: number; duration_days: number; perks: string | null; active: number; created_at: number }
export interface PlanOut { id: string; name: string; pricePaise: number; durationDays: number; perks: string; active: boolean; members: number }
const toPlan = (r: PlanRow & { members?: number }): PlanOut => ({ id: r.id, name: r.name, pricePaise: r.price_paise, durationDays: r.duration_days, perks: r.perks ?? '', active: !!r.active, members: r.members ?? 0 });

export function listPlans(ownerId: string): PlanOut[] {
  const t = today();
  return many<PlanRow & { members: number }>(`SELECT p.*, (SELECT COUNT(*) FROM memberships m WHERE m.plan_id = p.id AND m.deleted_at IS NULL AND m.end_date >= ?) members
    FROM membership_plans p WHERE p.owner_id = ? AND p.deleted_at IS NULL ORDER BY p.active DESC, p.price_paise, p.name`, t, ownerId).map(toPlan);
}
function planOr404(ownerId: string, id: string): PlanRow {
  const p = one<PlanRow>('SELECT * FROM membership_plans WHERE id = ? AND owner_id = ? AND deleted_at IS NULL', id, ownerId);
  if (!p) throw notFound('Plan not found');
  return p;
}
function planInput(body: unknown, partial: boolean) {
  const v = new Validator(body);
  const o = {
    name: v.str('name', { required: !partial, min: 2, max: 60 }),
    pricePaise: v.int('pricePaise', { required: !partial, min: 0, max: 100_000_000 }),
    durationDays: v.int('durationDays', { required: !partial, min: 1, max: 3660 }),
    perks: v.str('perks', { max: 600 }),
    active: v.bool('active'),
  };
  v.done();
  return o;
}
function dupName(ownerId: string, name: string, exceptId?: string): void {
  if (one('SELECT 1 FROM membership_plans WHERE owner_id = ? AND lower(name) = lower(?) AND deleted_at IS NULL AND id <> ?', ownerId, name, exceptId ?? ''))
    throw conflict('PLAN_EXISTS', 'There is already a plan with that name');
}
export function createPlan(ownerId: string, actor: Actor, body: unknown): PlanOut {
  const o = planInput(body, false);
  dupName(ownerId, o.name!);
  const id = newId('mpl'), t = now();
  run('INSERT INTO membership_plans(id, owner_id, name, price_paise, duration_days, perks, active, created_at, created_by, updated_at, updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    id, ownerId, o.name!, o.pricePaise!, o.durationDays!, o.perks ?? null, o.active === false ? 0 : 1, t, actor.id, t, actor.id);
  audit(actor, 'membership.plan.create', 'membership_plan', id, { name: o.name, pricePaise: o.pricePaise, durationDays: o.durationDays }, ownerId);
  return listPlans(ownerId).find((p) => p.id === id)!;
}
export function updatePlan(ownerId: string, actor: Actor, id: string, body: unknown): PlanOut {
  const cur = planOr404(ownerId, id);
  const o = planInput(body, true);
  if (o.name !== undefined) dupName(ownerId, o.name, id);
  run('UPDATE membership_plans SET name = ?, price_paise = ?, duration_days = ?, perks = ?, active = ?, updated_at = ?, updated_by = ? WHERE id = ?',
    o.name ?? cur.name, o.pricePaise ?? cur.price_paise, o.durationDays ?? cur.duration_days, o.perks !== undefined ? o.perks : cur.perks, o.active === undefined ? cur.active : o.active ? 1 : 0, now(), actor.id, id);
  audit(actor, 'membership.plan.update', 'membership_plan', id, body, ownerId);
  return listPlans(ownerId).find((p) => p.id === id)!;
}
export function deletePlan(ownerId: string, actor: Actor, id: string): void {
  planOr404(ownerId, id);
  const live = one<{ n: number }>('SELECT COUNT(*) n FROM memberships WHERE plan_id = ? AND deleted_at IS NULL AND end_date >= ?', id, today())!.n;
  if (live) throw conflict('PLAN_IN_USE', `${live} current member${live === 1 ? ' is' : 's are'} on this plan. Switch it off instead of deleting it.`);
  run('UPDATE membership_plans SET deleted_at = ?, deleted_by = ? WHERE id = ?', now(), actor.id, id);
  audit(actor, 'membership.plan.delete', 'membership_plan', id, null, ownerId);
}

// ------------------------------------------------------------------ members

interface MemberRow { id: string; plan_id: string; plan_name: string; name: string; phone: string; notes: string | null; start_date: string; end_date: string; created_at: number; paid_paise: number; renewals: number }
export interface MemberOut { id: string; name: string; phone: string; notes: string; planId: string; planName: string; startDate: string; endDate: string; status: MemberStatus; daysLeft: number; paidPaise: number; renewals: number; since: number }
const SEL = `SELECT m.id, m.plan_id, p.name plan_name, m.name, m.phone, m.notes, m.start_date, m.end_date, m.created_at,
  COALESCE((SELECT SUM(x.amount_paise) FROM membership_payments x WHERE x.membership_id = m.id AND x.deleted_at IS NULL), 0) paid_paise,
  (SELECT COUNT(*) FROM membership_payments x WHERE x.membership_id = m.id AND x.deleted_at IS NULL AND x.kind = 'renewal') renewals
  FROM memberships m JOIN membership_plans p ON p.id = m.plan_id`;
function toMember(r: MemberRow, t = today()): MemberOut {
  return { id: r.id, name: r.name, phone: r.phone, notes: r.notes ?? '', planId: r.plan_id, planName: r.plan_name, startDate: r.start_date, endDate: r.end_date, status: statusOf(r.end_date, t),
    daysLeft: daysBetween(t, r.end_date), paidPaise: r.paid_paise, renewals: r.renewals, since: r.created_at };
}

export function listMembers(ownerId: string, f: { q?: string; status?: string; planId?: string; limit?: number; offset?: number }): { items: MemberOut[]; total: number } {
  const t = today(), soon = addDays(t, EXPIRING_DAYS);
  const where = ['m.owner_id = ?', 'm.deleted_at IS NULL'], p: (string | number)[] = [ownerId];
  if (f.q) { const like = `%${f.q.replace(/[%_\\]/g, '\\$&').toLowerCase()}%`; where.push("(lower(m.name) LIKE ? ESCAPE '\\' OR m.phone LIKE ? ESCAPE '\\')"); p.push(like, like); }
  if (f.planId) { where.push('m.plan_id = ?'); p.push(f.planId); }
  if (f.status === 'expired') { where.push('m.end_date < ?'); p.push(t); }
  else if (f.status === 'expiring') { where.push('m.end_date >= ? AND m.end_date <= ?'); p.push(t, soon); }
  else if (f.status === 'active') { where.push('m.end_date > ?'); p.push(soon); }
  const w = where.join(' AND ');
  const total = one<{ n: number }>(`SELECT COUNT(*) n FROM memberships m WHERE ${w}`, ...p)!.n;
  const rows = many<MemberRow>(`${SEL} WHERE ${w} ORDER BY m.end_date, m.name LIMIT ? OFFSET ?`, ...p, Math.min(Math.max(f.limit ?? 200, 1), 500), Math.max(f.offset ?? 0, 0));
  return { items: rows.map((r) => toMember(r, t)), total };
}
function memberRow(ownerId: string, id: string): MemberRow {
  const r = one<MemberRow>(`${SEL} WHERE m.id = ? AND m.owner_id = ? AND m.deleted_at IS NULL`, id, ownerId);
  if (!r) throw notFound('Member not found');
  return r;
}

export interface PaymentOut { id: string; kind: string; amountPaise: number; method: string; reference: string; planName: string; periodStart: string; periodEnd: string; paidOn: string; at: number; ledgerTxnId: string | null }
function payments(ownerId: string, membershipId: string): PaymentOut[] {
  return many<any>(`SELECT x.*, p.name plan_name FROM membership_payments x JOIN membership_plans p ON p.id = x.plan_id
    WHERE x.owner_id = ? AND x.membership_id = ? AND x.deleted_at IS NULL ORDER BY x.created_at DESC, x.id DESC`, ownerId, membershipId)
    .map((x) => ({ id: x.id, kind: x.kind, amountPaise: x.amount_paise, method: x.method, reference: x.reference ?? '', planName: x.plan_name, periodStart: x.period_start, periodEnd: x.period_end, paidOn: x.paid_on, at: x.created_at, ledgerTxnId: x.ledger_txn_id ?? null }));
}
export function getMember(ownerId: string, id: string): MemberOut & { payments: PaymentOut[] } {
  return { ...toMember(memberRow(ownerId, id)), payments: payments(ownerId, id) };
}

function payInput(v: Validator) {
  const method = v.oneOf('method', METHODS, true);
  const reference = v.str('reference', { max: 60 });
  if ((method === 'upi' || method === 'bank_transfer') && !reference) v.fail('reference', 'Enter the UTR or transaction reference');
  return { method: method!, reference, amountPaise: v.int('amountPaise', { min: 0, max: 100_000_000 }), planId: v.str('planId', { max: 60 }) };
}

/** The period a payment buys: a new sale starts on the chosen date; a renewal continues from the day after the current end, or from today if it lapsed. */
function addPayment(ownerId: string, actor: Actor, membershipId: string, memberName: string, plan: PlanRow, kind: 'sale' | 'renewal', start: string, pay: { method: string; reference?: string; amountPaise?: number }): { end: string; ledger: LedgerRef | null } {
  const end = addDays(start, plan.duration_days - 1);
  const amount = pay.amountPaise ?? plan.price_paise;
  checkCashSingle(pay.method, amount);
  // Income in the books, 'memberships' category. `ledger` is null when the owner has no cash/bank account (or the amount is 0): the payment stands either way.
  const ledger = postToLedger(ownerId, actor, { date: today(), amountPaise: amount, description: `Membership ${kind} ${plan.name} ${memberName}`, categoryCode: 'memberships', method: pay.method, reference: pay.reference });
  run(`INSERT INTO membership_payments(id, owner_id, membership_id, plan_id, kind, amount_paise, method, reference, period_start, period_end, paid_on, ledger_txn_id, created_at, created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    newId('mpy'), ownerId, membershipId, plan.id, kind, amount, pay.method, pay.reference ?? null, start, end, today(), ledger?.transactionId ?? null, now(), actor.id);
  return { end, ledger };
}

export function sellMembership(ownerId: string, actor: Actor, body: unknown): MemberOut & { ledger: LedgerRef | null } {
  const v = new Validator(body);
  const name = v.str('name', { required: true, min: 2, max: 80 });
  const phone = v.phone('phone', true);
  const startDate = v.date('startDate');
  const notes = v.str('notes', { max: 300 });
  const pay = payInput(v);
  if (!pay.planId) v.fail('planId', 'Required');
  v.done();
  const plan = planOr404(ownerId, pay.planId!);
  if (!plan.active) throw conflict('PLAN_INACTIVE', 'That plan is switched off');
  const dup = one<{ id: string; name: string }>('SELECT id, name FROM memberships WHERE owner_id = ? AND phone = ? AND deleted_at IS NULL', ownerId, phone);
  if (dup) throw conflict('MEMBER_EXISTS', `${dup.name} already has a membership with this number. Renew it instead.`, { memberId: dup.id });
  return tx(() => {
    const id = newId('mem'), t = now(), start = startDate ?? today();
    run('INSERT INTO memberships(id, owner_id, plan_id, name, phone, notes, start_date, end_date, created_at, created_by, updated_at, updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      id, ownerId, plan.id, name!, phone!, notes ?? null, start, start, t, actor.id, t, actor.id);
    const { end, ledger } = addPayment(ownerId, actor, id, name!, plan, 'sale', start, pay);
    run('UPDATE memberships SET end_date = ? WHERE id = ?', end, id);
    audit(actor, 'membership.sell', 'membership', id, { name, plan: plan.name, amountPaise: pay.amountPaise ?? plan.price_paise, method: pay.method, reference: pay.reference ?? null, start, end }, ownerId);
    return { ...toMember(memberRow(ownerId, id)), ledger };
  });
}

export function renewMembership(ownerId: string, actor: Actor, id: string, body: unknown): MemberOut & { ledger: LedgerRef | null } {
  const cur = memberRow(ownerId, id);
  const v = new Validator(body);
  const pay = payInput(v);
  v.done();
  const plan = planOr404(ownerId, pay.planId ?? cur.plan_id);
  if (!plan.active && plan.id !== cur.plan_id) throw conflict('PLAN_INACTIVE', 'That plan is switched off');
  return tx(() => {
    const t = today();
    const start = cur.end_date >= t ? addDays(cur.end_date, 1) : t;
    const { end, ledger } = addPayment(ownerId, actor, id, cur.name, plan, 'renewal', start, pay);
    run('UPDATE memberships SET plan_id = ?, end_date = ?, updated_at = ?, updated_by = ? WHERE id = ?', plan.id, end, now(), actor.id, id);
    audit(actor, 'membership.renew', 'membership', id, { name: cur.name, plan: plan.name, amountPaise: pay.amountPaise ?? plan.price_paise, method: pay.method, reference: pay.reference ?? null, from: start, until: end }, ownerId);
    return { ...toMember(memberRow(ownerId, id)), ledger };
  });
}

export function updateMember(ownerId: string, actor: Actor, id: string, body: unknown): MemberOut {
  const cur = memberRow(ownerId, id);
  const v = new Validator(body);
  const name = v.str('name', { min: 2, max: 80 });
  const phone = v.phone('phone');
  const notes = v.str('notes', { max: 300 });
  v.done();
  if (phone && phone !== cur.phone && one('SELECT 1 FROM memberships WHERE owner_id = ? AND phone = ? AND deleted_at IS NULL AND id <> ?', ownerId, phone, id))
    throw conflict('MEMBER_EXISTS', 'Another member already has this number');
  run('UPDATE memberships SET name = ?, phone = ?, notes = ?, updated_at = ?, updated_by = ? WHERE id = ?', name ?? cur.name, phone ?? cur.phone, notes !== undefined ? notes : cur.notes, now(), actor.id, id);
  audit(actor, 'membership.update', 'membership', id, body, ownerId);
  return toMember(memberRow(ownerId, id));
}

export function expiringSoon(ownerId: string, days = EXPIRING_DAYS): MemberOut[] {
  const t = today();
  const d = Math.min(Math.max(Math.trunc(days) || EXPIRING_DAYS, 1), 90);
  return many<MemberRow>(`${SEL} WHERE m.owner_id = ? AND m.deleted_at IS NULL AND m.end_date >= ? AND m.end_date <= ? ORDER BY m.end_date, m.name`, ownerId, t, addDays(t, d)).map((r) => toMember(r, t));
}

export interface StatsOut { active: number; expiring: number; expired: number; total: number; revenueMonthPaise: number; revenueLastMonthPaise: number; salesThisMonth: number; renewalsThisMonth: number; month: string }
export function stats(ownerId: string): StatsOut {
  const t = today(), soon = addDays(t, EXPIRING_DAYS), month = t.slice(0, 7);
  const c = one<{ expired: number; expiring: number; active: number }>(`SELECT
    SUM(CASE WHEN end_date < ? THEN 1 ELSE 0 END) expired,
    SUM(CASE WHEN end_date >= ? AND end_date <= ? THEN 1 ELSE 0 END) expiring,
    SUM(CASE WHEN end_date > ? THEN 1 ELSE 0 END) active
    FROM memberships WHERE owner_id = ? AND deleted_at IS NULL`, t, t, soon, soon, ownerId)!;
  const rev = (m: string) => { const r = monthRange(m)!; return one<{ s: number; sales: number; ren: number }>(`SELECT COALESCE(SUM(amount_paise),0) s, SUM(kind = 'sale') sales, SUM(kind = 'renewal') ren FROM membership_payments WHERE owner_id = ? AND deleted_at IS NULL AND paid_on >= ? AND paid_on <= ?`, ownerId, r.from, r.to)!; };
  const prev = istDate(Date.parse(month + '-01T00:00:00Z') - 86_400_000).slice(0, 7);
  const cur = rev(month);
  const active = c.active ?? 0, expiring = c.expiring ?? 0, expired = c.expired ?? 0;
  return { active, expiring, expired, total: active + expiring + expired, revenueMonthPaise: cur.s, revenueLastMonthPaise: rev(prev).s, salesThisMonth: cur.sales ?? 0, renewalsThisMonth: cur.ren ?? 0, month };
}

export function membershipAudit(ownerId: string, limit: number, offset: number) {
  return listAudit({ ownerId, action: 'membership.', limit, offset });
}

