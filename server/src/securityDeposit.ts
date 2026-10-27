import { many, one, run, tx, registerSchema } from './db.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { HttpError, forbidden } from './errors.ts';
import { audit, type Actor } from './audit.ts';
import { Validator } from './input.ts';
import { requireFeature } from './settings.ts';
import { accessBooking, type BookingRow } from './bookings.ts';
import { hasPermission, type UserRow } from './auth.ts';
import './bookings.ts';

// The security (damage) deposit. Decided by the owner (27 Oct 2026): it is NOT the booking advance. The advance is part of the booking price and lives on the booking
// (advance_paise, paid_paise). The security deposit is separate money the ground holds for the customer against damage, extras or other approved deductions, and gives back.
// It has its own records, its own balance and its own accounting meaning (a liability, never booking income). Nothing here touches a booking's price, advance, paid figure,
// payments or refunds, so a deposit cannot change what a booking earned. Staff record it; Guppi and the customer's apps can only read it; there is no route that moves
// money from the customer's side, and nothing here talks to the payment provider: the ground hands the cash or UPI over at the desk and records it.
//
// Every figure is derived from append-only entries, so the balance cannot drift from its history:
//   held = collected - deducted + reversed - refunded

registerSchema('security-deposit-1', `
CREATE TABLE security_deposit_entries (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  owner_id TEXT NOT NULL, customer_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('collect','deduct','refund','reverse')),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  method TEXT CHECK (method IN ('cash','upi','card','bank')),
  reason TEXT, reference TEXT,
  reverses_id TEXT REFERENCES security_deposit_entries(id),
  actor_id TEXT NOT NULL, actor_role TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX ix_security_deposit_booking ON security_deposit_entries(booking_id, created_at);
CREATE TRIGGER trg_ao_security_deposit_entries_update BEFORE UPDATE ON security_deposit_entries BEGIN SELECT RAISE(ABORT, 'security_deposit_entries is append-only: update refused'); END;
CREATE TRIGGER trg_ao_security_deposit_entries_delete BEFORE DELETE ON security_deposit_entries BEGIN SELECT RAISE(ABORT, 'security_deposit_entries is append-only: delete refused'); END;
`);

export interface DepositEntry { id: string; kind: 'collect' | 'deduct' | 'refund' | 'reverse'; amountPaise: number; method: string | null; reason: string | null; reference: string | null; reversesId: string | null; actorRole: string; createdAt: number }
export interface DepositView { bookingId: string; collectedPaise: number; deductedPaise: number; reversedPaise: number; keptPaise: number; refundedPaise: number; heldPaise: number; entries: DepositEntry[] }

const rows = (bookingId: string) => many<{ id: string; kind: DepositEntry['kind']; amount_paise: number; method: string | null; reason: string | null; reference: string | null; reverses_id: string | null; actor_role: string; created_at: number }>(
  'SELECT id, kind, amount_paise, method, reason, reference, reverses_id, actor_role, created_at FROM security_deposit_entries WHERE booking_id = ? ORDER BY created_at, rowid', bookingId);

export function depositView(bookingId: string): DepositView {
  const es = rows(bookingId);
  const sum = (k: string) => es.filter((e) => e.kind === k).reduce((s, e) => s + e.amount_paise, 0);
  const collected = sum('collect'), deducted = sum('deduct'), reversed = sum('reverse'), refunded = sum('refund');
  return { bookingId, collectedPaise: collected, deductedPaise: deducted, reversedPaise: reversed, keptPaise: deducted - reversed, refundedPaise: refunded, heldPaise: collected - deducted + reversed - refunded,
    entries: es.map((e) => ({ id: e.id, kind: e.kind, amountPaise: e.amount_paise, method: e.method, reason: e.reason, reference: e.reference, reversesId: e.reverses_id, actorRole: e.actor_role, createdAt: e.created_at })) };
}

/** The customer reads their own booking's deposit; staff read it with the booking permission. */
export function readDeposit(user: UserRow, bookingId: string): DepositView {
  requireFeature('securityDepositEnabled', 'The security deposit');
  const b = accessBooking(user, bookingId, user.role === 'customer' ? undefined : 'manage_bookings');
  return depositView(b.id);
}

/** Collecting and giving back: the people who record payments. Keeping some for damage, and undoing that, is the owner's decision. */
function allowed(user: UserRow, kind: DepositEntry['kind']): void {
  if (user.role === 'customer') throw forbidden('A customer cannot change a security deposit');
  const ownerLevel = user.role === 'owner' || user.role === 'super_admin';
  if (kind === 'deduct' || kind === 'reverse') { if (!ownerLevel) throw forbidden('Keeping part of a security deposit, or undoing that, is the owner\'s decision'); return; }
  if (!ownerLevel && !hasPermission(user, 'record_payments')) throw forbidden('This needs the "record_payments" permission');
}

export function recordDeposit(user: UserRow, bookingId: string, kind: DepositEntry['kind'], body: unknown): DepositView {
  requireFeature('securityDepositEnabled', 'The security deposit');
  allowed(user, kind);
  const v = new Validator(body);
  const amount = v.int('amountPaise', { min: 1, max: 100_000_000, required: kind !== 'reverse' });
  const method = kind === 'collect' || kind === 'refund' ? v.str('method', { required: true, max: 10 }) : undefined;
  const reason = v.str('reason', { max: 300, required: kind === 'deduct' || kind === 'reverse' });
  const reference = v.str('reference', { max: 80 });
  const reversesId = kind === 'reverse' ? v.str('reversesId', { required: true, max: 40 }) : undefined;
  v.done();
  if (method !== undefined && !['cash', 'upi', 'card', 'bank'].includes(method)) throw new HttpError(400, 'VALIDATION_FAILED', 'method must be cash, upi, card or bank', { fields: [{ field: 'method', message: 'cash, upi, card or bank' }] });
  if ((kind === 'deduct' || kind === 'reverse') && (reason ?? '').trim().length < 10) throw new HttpError(400, 'REASON_REQUIRED', 'Say what the deduction is for (at least 10 characters). The customer can see it.');
  const actor: Actor = { id: user.id, role: user.role };
  return tx(() => {
    const b: BookingRow = accessBooking(user, bookingId, 'manage_bookings');
    if (!['confirmed', 'completed', 'no_show'].includes(b.status)) throw new HttpError(409, 'BAD_STATE', `A security deposit is taken for a confirmed booking. This one is ${b.status}.`);
    const view = depositView(b.id);
    let amountPaise = amount ?? 0;
    if (kind === 'collect' && amountPaise <= 0) throw new HttpError(400, 'VALIDATION_FAILED', 'amountPaise must be positive');
    if ((kind === 'deduct' || kind === 'refund') && amountPaise > view.heldPaise) throw new HttpError(409, 'DEPOSIT_TOO_SMALL', `Only ${view.heldPaise} paise is held for this booking`, { heldPaise: view.heldPaise });
    if (kind === 'reverse') {
      const d = one<{ id: string; amount_paise: number }>("SELECT id, amount_paise FROM security_deposit_entries WHERE id = ? AND booking_id = ? AND kind = 'deduct'", reversesId ?? '', b.id);
      if (!d) throw new HttpError(404, 'NOT_FOUND', 'That deduction was not found on this booking');
      const already = one<{ s: number | null }>("SELECT SUM(amount_paise) s FROM security_deposit_entries WHERE reverses_id = ? AND kind = 'reverse'", d.id)!.s ?? 0;
      const left = d.amount_paise - already;
      if (amount === undefined) amountPaise = left;
      if (amountPaise < 1 || amountPaise > left) throw new HttpError(409, 'REVERSAL_TOO_LARGE', `At most ${left} paise of that deduction can still be reversed`, { leftPaise: left });
    }
    const id = newId('sde');
    run('INSERT INTO security_deposit_entries(id, booking_id, owner_id, customer_id, kind, amount_paise, method, reason, reference, reverses_id, actor_id, actor_role, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id, b.id, b.owner_id, b.customer_id, kind, amountPaise, method ?? null, reason?.trim() ?? null, reference ?? null, reversesId ?? null, user.id, user.role, now());
    const after = depositView(b.id);
    audit(actor, `deposit.${kind}`, 'booking', b.id, { entryId: id, amountPaise, method: method ?? null, reason: reason?.trim() ?? null, heldBefore: view.heldPaise, heldAfter: after.heldPaise }, b.owner_id);
    return after;
  });
}
