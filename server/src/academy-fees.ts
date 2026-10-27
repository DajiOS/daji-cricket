import { checkCashSingle } from './taxrules.ts';
import { many, one, registerSchema, run, tx } from './db.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { HttpError, notFound } from './errors.ts';
import { Validator } from './input.ts';
import { audit, type Actor } from './audit.ts';
import { istDate } from './time.ts';

// Academy fees and the coach's revenue share. The share terms are NOT assumed: until the owner enters an agreed percentage
// the statement shows what was collected and says the terms are not set. Amounts are paise. Scoped to one owner (one set of books).

registerSchema('academy-2', `
CREATE TABLE academy_fees (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  student_id TEXT NOT NULL REFERENCES academy_students(id),
  month TEXT NOT NULL,
  amount_paise INTEGER NOT NULL,
  due_on TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (student_id, month)
);
CREATE INDEX ix_academy_fees_owner ON academy_fees(owner_id, month);

CREATE TABLE academy_fee_payments (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  fee_id TEXT NOT NULL REFERENCES academy_fees(id),
  amount_paise INTEGER NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('cash','upi','bank','cheque','card')),
  received_on TEXT NOT NULL,
  note TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_academy_pay_owner ON academy_fee_payments(owner_id, received_on);

CREATE TABLE academy_share (
  owner_id TEXT PRIMARY KEY REFERENCES users(id),
  party_name TEXT NOT NULL,
  percent_bp INTEGER,
  agreed_on TEXT,
  updated_at INTEGER NOT NULL
);
`);

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MODES = ['cash', 'upi', 'bank', 'cheque', 'card'] as const;

export interface FeeRow { id: string; studentId: string; studentName: string; batch: string | null; month: string; amountPaise: number; paidPaise: number; duePaise: number; dueOn: string; status: 'paid' | 'part' | 'unpaid' | 'overdue' }

function feeRows(ownerId: string, month: string): FeeRow[] {
  const today = istDate(now());
  return many<{ id: string; student_id: string; name: string; batch: string | null; month: string; amount_paise: number; due_on: string; paid: number }>(
    `SELECT f.id, f.student_id, s.name, s.batch, f.month, f.amount_paise, f.due_on,
            COALESCE((SELECT SUM(amount_paise) FROM academy_fee_payments p WHERE p.fee_id = f.id), 0) paid
       FROM academy_fees f JOIN academy_students s ON s.id = f.student_id
      WHERE f.owner_id = ? AND f.month = ? ORDER BY s.name`, ownerId, month).map((r) => {
    const due = r.amount_paise - r.paid;
    return { id: r.id, studentId: r.student_id, studentName: r.name, batch: r.batch, month: r.month, amountPaise: r.amount_paise, paidPaise: r.paid, duePaise: due, dueOn: r.due_on,
      status: due <= 0 ? 'paid' : r.paid > 0 ? 'part' : r.due_on < today ? 'overdue' : 'unpaid' };
  });
}

export function listFees(ownerId: string, month: unknown): { month: string; items: FeeRow[]; billedPaise: number; collectedPaise: number; outstandingPaise: number } {
  if (typeof month !== 'string' || !MONTH.test(month)) throw new HttpError(400, 'VALIDATION', 'Choose a month like 2026-10');
  const items = feeRows(ownerId, month);
  return { month, items, billedPaise: items.reduce((a, r) => a + r.amountPaise, 0), collectedPaise: items.reduce((a, r) => a + Math.min(r.paidPaise, r.amountPaise), 0), outstandingPaise: items.reduce((a, r) => a + Math.max(0, r.duePaise), 0) };
}

/** Raises the month's fee for every active student that does not have one yet; a student's own fee can differ, so the amount comes with the request. */
export function raiseFees(actor: Actor, ownerId: string, src: unknown): { created: number } {
  const v = new Validator(src);
  const month = v.str('month', { required: true, min: 7, max: 7 });
  const amount = v.int('amountPaise', { required: true, min: 100, max: 100000000 });
  const dueOn = v.date('dueOn');
  const studentIds = v.strArray('studentIds', { max: 500 });
  v.done();
  if (!MONTH.test(month!)) throw new HttpError(400, 'VALIDATION', 'Choose a month like 2026-10');
  const due = dueOn ?? `${month}-10`;
  let n = 0;
  tx(() => {
    const kids = many<{ id: string }>(`SELECT id FROM academy_students WHERE owner_id = ? AND status = 'active'`, ownerId).filter((k) => !studentIds || studentIds.includes(k.id));
    for (const k of kids) {
      if (one('SELECT 1 FROM academy_fees WHERE student_id = ? AND month = ?', k.id, month)) continue;
      run('INSERT INTO academy_fees(id, owner_id, student_id, month, amount_paise, due_on, created_at) VALUES(?,?,?,?,?,?,?)', newId('fee'), ownerId, k.id, month, amount, due, now());
      n++;
    }
  });
  audit(actor, 'academy.fees_raise', 'academy_fees', month!, { created: n, amountPaise: amount }, ownerId);
  return { created: n };
}

export function recordPayment(actor: Actor, ownerId: string, feeId: string, src: unknown): FeeRow {
  const fee = one<{ id: string; month: string; amount_paise: number }>('SELECT id, month, amount_paise FROM academy_fees WHERE id = ? AND owner_id = ?', feeId, ownerId);
  if (!fee) throw notFound('Fee not found');
  const v = new Validator(src);
  const amount = v.int('amountPaise', { required: true, min: 100, max: 100000000 });
  const mode = v.oneOf('mode', MODES);
  const receivedOn = v.date('receivedOn');
  const note = v.str('note', { max: 200 });
  v.done();
  const paid = one<{ s: number }>('SELECT COALESCE(SUM(amount_paise),0) s FROM academy_fee_payments WHERE fee_id = ?', feeId)!.s;
  if (paid + amount! > fee.amount_paise) throw new HttpError(409, 'OVERPAID', 'That is more than is due on this fee.');
  checkCashSingle(mode ?? 'cash', amount!);
  run('INSERT INTO academy_fee_payments(id, owner_id, fee_id, amount_paise, mode, received_on, note, created_by, created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    newId('fpy'), ownerId, feeId, amount, mode ?? 'cash', receivedOn ?? istDate(now()), note ?? null, actor.id, now());
  audit(actor, 'academy.fee_payment', 'academy_fee', feeId, { amountPaise: amount, mode: mode ?? 'cash' }, ownerId);
  return feeRows(ownerId, fee.month).find((r) => r.id === feeId)!;
}

export interface Share { partyName: string; percent: number | null; agreedOn: string | null; agreed: boolean }
export function getShare(ownerId: string): Share {
  const r = one<{ party_name: string; percent_bp: number | null; agreed_on: string | null }>('SELECT party_name, percent_bp, agreed_on FROM academy_share WHERE owner_id = ?', ownerId);
  return { partyName: r?.party_name ?? 'Munaf Patel', percent: r?.percent_bp == null ? null : r.percent_bp / 100, agreedOn: r?.agreed_on ?? null, agreed: r?.percent_bp != null };
}
/** The owner records the percentage once it has been agreed. Sending percent: null clears it back to "not agreed". */
export function setShare(actor: Actor, ownerId: string, src: unknown): Share {
  const v = new Validator(src);
  const party = v.str('partyName', { max: 80 });
  const clear = (src as { percent?: unknown })?.percent === null;
  const pct = clear ? undefined : v.num('percent', { min: 0, max: 100 });
  const agreedOn = v.date('agreedOn');
  v.done();
  const cur = getShare(ownerId);
  const bp = clear ? null : pct !== undefined ? Math.round(pct * 100) : cur.percent == null ? null : Math.round(cur.percent * 100);
  run(`INSERT INTO academy_share(owner_id, party_name, percent_bp, agreed_on, updated_at) VALUES(?,?,?,?,?)
       ON CONFLICT(owner_id) DO UPDATE SET party_name = excluded.party_name, percent_bp = excluded.percent_bp, agreed_on = excluded.agreed_on, updated_at = excluded.updated_at`,
    ownerId, party ?? cur.partyName, bp, bp == null ? null : (agreedOn ?? cur.agreedOn ?? istDate(now())), now());
  audit(actor, 'academy.share_set', 'academy_share', ownerId, { percent: bp == null ? null : bp / 100 }, ownerId);
  return getShare(ownerId);
}

/** What came in during the month (by payment date) and, only when terms are set, how it divides. Rounded down to the paisa for the coach; the remainder stays with the academy. */
export function shareStatement(ownerId: string, month: unknown) {
  if (typeof month !== 'string' || !MONTH.test(month)) throw new HttpError(400, 'VALIDATION', 'Choose a month like 2026-10');
  const rows = many<{ mode: string; s: number }>(`SELECT mode, SUM(amount_paise) s FROM academy_fee_payments WHERE owner_id = ? AND substr(received_on,1,7) = ? GROUP BY mode`, ownerId, month);
  const collected = rows.reduce((a, r) => a + r.s, 0);
  const sh = getShare(ownerId);
  const coachPaise = sh.agreed ? Math.floor(collected * (sh.percent as number) / 100) : null;
  return { month, collectedPaise: collected, byMode: rows.map((r) => ({ mode: r.mode, paise: r.s })), share: sh,
    coachSharePaise: coachPaise, academyKeepsPaise: coachPaise == null ? null : collected - coachPaise,
    note: sh.agreed ? `${sh.partyName} receives ${sh.percent}% of fees collected in the month.` : 'The share terms have not been agreed yet, so no split is calculated.' };
}
