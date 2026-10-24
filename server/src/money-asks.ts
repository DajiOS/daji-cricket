import { many, one, registerSchema, run, tx } from './db.ts';
import { now } from './clock.ts';
import { audit, type Actor } from './audit.ts';
import { conflict, forbidden, HttpError, notFound } from './errors.ts';
import { newId } from './ids.ts';
import { Validator } from './input.ts';
import type { UserRow } from './auth.ts';
import { KIND_INFO, getFlow, looksAfter, sendBack, signStep, startRequest, stepsFor, withdrawRequest, type ReqRow } from './approvals.ts';
import { addTransaction, checkTransaction } from './accounting/store.ts';

// Money the ground gives up or pays out on a team member's word: a discount off what a booking still owes, a waiver of
// an academy fee, and an expense entered in the books. Each one is an "ask" that goes through the owner's approval rules
// for its kind; when no step applies to the amount it is carried out on the spot, exactly as if there were no rules.
// The thing itself changes only when the last step signs, and the figures are checked again at that moment.

registerSchema('money-asks-1', `
CREATE TABLE money_asks (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('discount','waiver','expense')),
  target_id TEXT,
  title TEXT NOT NULL,
  amount_paise INTEGER NOT NULL,
  reason TEXT NOT NULL,
  payload TEXT,
  status TEXT NOT NULL CHECK (status IN ('waiting','done','sent_back','withdrawn')),
  result_id TEXT,
  asked_by TEXT,
  asked_at INTEGER NOT NULL,
  decided_at INTEGER,
  decided_by TEXT,
  decided_note TEXT
);
CREATE INDEX ix_money_asks_owner ON money_asks(owner_id, status, kind);
CREATE INDEX ix_money_asks_target ON money_asks(kind, target_id);
`);

export type AskKind = 'discount' | 'waiver' | 'expense';
interface AskRow { id: string; owner_id: string; kind: AskKind; target_id: string | null; title: string; amount_paise: number; reason: string; payload: string | null; status: 'waiting' | 'done' | 'sent_back' | 'withdrawn'; result_id: string | null; asked_by: string | null; asked_at: number; decided_at: number | null; decided_by: string | null; decided_note: string | null }

const rupees = (p: number) => '₹' + (p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const name = (id: string | null): string | null => (id ? one<{ name: string }>('SELECT name FROM users WHERE id = ?', id)?.name ?? null : null);
const askRow = (ownerId: string, id: string) => one<AskRow>('SELECT * FROM money_asks WHERE id = ? AND owner_id = ?', id, ownerId);
const isBoss = (u: { role: string | null }) => u.role === 'owner' || u.role === 'super_admin';

export function askOut(a: AskRow) {
  return {
    id: a.id, kind: a.kind, kindName: KIND_INFO[a.kind].name, targetId: a.target_id, title: a.title, amountPaise: a.amount_paise, reason: a.reason,
    status: a.status, waiting: a.status === 'waiting', resultId: a.result_id, askedBy: a.asked_by, askedByName: name(a.asked_by), askedAt: a.asked_at,
    decidedAt: a.decided_at, decidedByName: name(a.decided_by), decidedNote: a.decided_note,
  };
}

function askBody(raw: unknown, maxPaise = 100_000_000_00): { amountPaise: number; reason: string } {
  const v = new Validator(raw ?? {});
  const amountPaise = v.int('amountPaise', { required: true, min: 100, max: maxPaise });
  const reason = v.str('reason', { required: true, min: 3, max: 300 });
  v.done();
  return { amountPaise: amountPaise!, reason: reason! };
}

/** Save the ask and start its chain; with no step for this amount it is carried out at once. */
function submit(ownerId: string, actor: Actor, a: { kind: AskKind; targetId: string | null; title: string; amountPaise: number; reason: string; payload?: unknown }) {
  return tx(() => {
    const id = newId('ask'), t = now();
    run(`INSERT INTO money_asks(id, owner_id, kind, target_id, title, amount_paise, reason, payload, status, asked_by, asked_at) VALUES(?,?,?,?,?,?,?,?,'waiting',?,?)`,
      id, ownerId, a.kind, a.targetId, a.title, a.amountPaise, a.reason, a.payload === undefined ? null : JSON.stringify(a.payload), actor.id, t);
    audit(actor, `${a.kind}.submit`, 'money_ask', id, { amountPaise: a.amountPaise, reason: a.reason, targetId: a.targetId }, ownerId);
    // The owner can sign every step, so what the owner asks for is carried out straight away.
    const boss = isBoss(actor);
    if (boss || !startRequest(ownerId, a.kind, id, { title: a.title, amountPaise: a.amountPaise, submittedBy: actor.id })) {
      carryOut(askRow(ownerId, id)!, actor);
      audit(actor, `${a.kind}.approve`, 'money_ask', id, { auto: true, why: boss ? 'Asked for by the owner' : 'No approval step applies to this amount' }, ownerId);
    }
    return askOut(askRow(ownerId, id)!);
  });
}

/** Make the change the ask was for. Throws, leaving everything as it was, when the figures no longer allow it. */
function carryOut(a: AskRow, actor: Actor): void {
  const t = now();
  let result: string | null = a.target_id;
  if (a.kind === 'discount') {
    const b = one<{ total_paise: number; paid_paise: number; status: string }>('SELECT total_paise, paid_paise, status FROM bookings WHERE id = ? AND owner_id = ?', a.target_id, a.owner_id);
    if (!b || !['confirmed', 'completed'].includes(b.status)) throw conflict('NOT_DISCOUNTABLE', 'This booking can no longer be discounted. Send it back.');
    if (b.total_paise - b.paid_paise < a.amount_paise) throw conflict('FIGURES_CHANGED', `The booking now owes less than ${rupees(a.amount_paise)}. Send it back so it can be asked again.`);
    run('UPDATE bookings SET total_paise = total_paise - ?, discount_paise = discount_paise + ?, advance_paise = MIN(advance_paise, total_paise - ?), updated_at = ? WHERE id = ?', a.amount_paise, a.amount_paise, a.amount_paise, t, a.target_id);
    audit(actor, 'booking.discount', 'booking', a.target_id!, { amountPaise: a.amount_paise, reason: a.reason, askId: a.id }, a.owner_id);
  } else if (a.kind === 'waiver') {
    const f = one<{ amount_paise: number; paid: number }>('SELECT f.amount_paise, COALESCE((SELECT SUM(p.amount_paise) FROM academy_fee_payments p WHERE p.fee_id = f.id), 0) paid FROM academy_fees f WHERE f.id = ? AND f.owner_id = ?', a.target_id, a.owner_id);
    if (!f) throw conflict('NOT_WAIVABLE', 'This fee no longer exists. Send it back.');
    if (f.amount_paise - f.paid < a.amount_paise) throw conflict('FIGURES_CHANGED', `Less than ${rupees(a.amount_paise)} is now owed on this fee. Send it back so it can be asked again.`);
    run('UPDATE academy_fees SET amount_paise = amount_paise - ? WHERE id = ?', a.amount_paise, a.target_id);
    audit(actor, 'academy.fee_waive', 'academy_fee', a.target_id!, { amountPaise: a.amount_paise, reason: a.reason, askId: a.id }, a.owner_id);
  } else {
    result = addTransaction(a.owner_id, actor, JSON.parse(a.payload!)).id;
  }
  run("UPDATE money_asks SET status = 'done', result_id = ?, decided_at = ?, decided_by = ? WHERE id = ?", result, t, actor.id, a.id);
}

// ---- asking

/** A discount off what a booking still owes (the balance), for example for a regular or after a problem at the ground. */
export function askDiscount(ownerId: string, actor: Actor, bookingId: string, raw: unknown) {
  const b = one<{ id: string; ref: string; total_paise: number; paid_paise: number; status: string; name: string | null }>(
    'SELECT b.id, b.ref, b.total_paise, b.paid_paise, b.status, u.name FROM bookings b LEFT JOIN users u ON u.id = b.customer_id WHERE b.id = ? AND b.owner_id = ?', bookingId, ownerId);
  if (!b) throw notFound('Booking not found');
  const { amountPaise, reason } = askBody(raw);
  if (!['confirmed', 'completed'].includes(b.status)) throw conflict('NOT_DISCOUNTABLE', 'Only a confirmed or played booking can be discounted');
  if (one("SELECT 1 x FROM money_asks WHERE kind = 'discount' AND target_id = ? AND status = 'waiting'", b.id)) throw conflict('WAITING', 'A discount on this booking is already waiting for sign-off');
  const owed = b.total_paise - b.paid_paise;
  if (amountPaise > owed) throw new HttpError(409, 'TOO_MUCH', owed > 0 ? `This booking owes ${rupees(owed)}, so the discount can be at most that` : 'Nothing is owed on this booking, so there is nothing to discount');
  return submit(ownerId, actor, { kind: 'discount', targetId: b.id, title: `Discount · ${b.name ?? 'customer'} · ${b.ref}`, amountPaise, reason });
}

/** Waive all or part of an academy fee that is still owed. */
export function askWaiver(ownerId: string, actor: Actor, feeId: string, raw: unknown) {
  const f = one<{ id: string; month: string; amount_paise: number; name: string; paid: number }>(
    `SELECT f.id, f.month, f.amount_paise, s.name, COALESCE((SELECT SUM(p.amount_paise) FROM academy_fee_payments p WHERE p.fee_id = f.id), 0) paid
       FROM academy_fees f JOIN academy_students s ON s.id = f.student_id WHERE f.id = ? AND f.owner_id = ?`, feeId, ownerId);
  if (!f) throw notFound('Fee not found');
  const { amountPaise, reason } = askBody(raw);
  if (one("SELECT 1 x FROM money_asks WHERE kind = 'waiver' AND target_id = ? AND status = 'waiting'", f.id)) throw conflict('WAITING', 'A waiver on this fee is already waiting for sign-off');
  const owed = f.amount_paise - f.paid;
  if (amountPaise > owed) throw new HttpError(409, 'TOO_MUCH', owed > 0 ? `${rupees(owed)} is owed on this fee, so the waiver can be at most that` : 'Nothing is owed on this fee, so there is nothing to waive');
  return submit(ownerId, actor, { kind: 'waiver', targetId: f.id, title: `Fee waiver · ${f.name} · ${f.month}`, amountPaise, reason });
}

/** Whether a hand-entered money-out transaction of this size has to wait for sign-off under the owner's expense rules.
 * The owner's own entries never wait. */
export function expenseNeedsSignoff(ownerId: string, actor: Actor, body: unknown): boolean {
  if (isBoss(actor)) return false;
  const amount = (body as { amountPaise?: unknown } | null)?.amountPaise;
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount >= 0) return false;
  return stepsFor(getFlow(ownerId, 'expense').flow, -amount).length > 0;
}

/** An expense entered in the books that waits for sign-off: checked now, recorded when the last step signs. */
export function askExpense(ownerId: string, actor: Actor, body: unknown) {
  const c = checkTransaction(ownerId, body);
  if (c.amount >= 0) throw new HttpError(400, 'VALIDATION_FAILED', 'An expense is money going out', { fields: [{ field: 'amountPaise', message: 'Must be below zero' }] });
  return submit(ownerId, actor, { kind: 'expense', targetId: null, title: `Expense · ${c.counterparty ?? c.description}`, amountPaise: -c.amount, reason: c.description, payload: body });
}

// ---- deciding, from the Approvals board

const askFor = (req: ReqRow): AskRow => {
  const a = askRow(req.owner_id, req.entity_id);
  if (!a) throw notFound('Approval not found');
  if (a.status !== 'waiting') throw conflict('NOT_WAITING', 'This is not waiting for a decision');
  return a;
};

/** Sign the step that is waiting; the last step carries the ask out. */
export function signAsk(ownerId: string, actor: Actor, req: ReqRow, note: string | null): void {
  tx(() => {
    const a = askFor(req);
    const s = signStep(req, actor, note);
    if (s.done) {
      carryOut(a, actor);
      audit(actor, `${a.kind}.approve`, 'money_ask', a.id, { step: s.index + 1, label: s.step.label, ...(note ? { note } : {}) }, ownerId);
    }
  });
}

/** Send the ask back one step, or back to the person who asked, which closes it (they can ask again). */
export function sendBackAsk(ownerId: string, actor: Actor, req: ReqRow, note: string): void {
  tx(() => {
    const a = askFor(req);
    if (!sendBack(req, actor, note).toStart) return;
    run("UPDATE money_asks SET status = 'sent_back', decided_at = ?, decided_by = ?, decided_note = ? WHERE id = ?", now(), actor.id, note, a.id);
    audit(actor, `${a.kind}.reject`, 'money_ask', a.id, { reason: note }, ownerId);
  });
}

/** The person who asked (or the owner) takes an ask back before it is decided. */
export function withdrawAsk(ownerId: string, actor: Actor, id: string) {
  const a = askRow(ownerId, id);
  if (!a) throw notFound('Not found');
  if (a.status !== 'waiting') throw conflict('NOT_WAITING', 'This is not waiting for a decision');
  if (!isBoss(actor) && a.asked_by !== actor.id) throw forbidden('Only the person who asked, or the owner, can take this back');
  tx(() => {
    withdrawRequest(ownerId, a.kind, a.id);
    run("UPDATE money_asks SET status = 'withdrawn', decided_at = ?, decided_by = ? WHERE id = ?", now(), actor.id, a.id);
    audit(actor, `${a.kind}.withdraw`, 'money_ask', a.id, null, ownerId);
  });
  return askOut(askRow(ownerId, id)!);
}

/** Recent asks: the owner sees all of them, a team member the ones they asked for or look after. */
export function listAsks(ownerId: string, viewer: UserRow, f: { status?: string | null; targetId?: string | null } = {}) {
  const where = ['owner_id = ?'], p: string[] = [ownerId];
  if (f.status) { where.push('status = ?'); p.push(f.status); }
  if (f.targetId) { where.push('target_id = ?'); p.push(f.targetId); }
  return many<AskRow>(`SELECT * FROM money_asks WHERE ${where.join(' AND ')} ORDER BY asked_at DESC LIMIT 100`, ...p)
    .filter((a) => isBoss(viewer) || a.asked_by === viewer.id || looksAfter(viewer, a.kind))
    .map(askOut);
}
