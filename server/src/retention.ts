import type { Booking } from '@daji/shared';
import { formatPaise } from '@daji/shared';
import { many, one, run, tx, registerSchema } from './db.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { HttpError } from './errors.ts';
import { audit, type Actor } from './audit.ts';
import { Validator } from './input.ts';
import { accessBooking, viewBooking, type BookingRow } from './bookings.ts';
import { refundPayment, type PaymentRow } from './payments.ts';
import * as credits from './credits.ts';
import { notify, pushStaffOf } from './notifications.ts';
import { requirePermission, type UserRow } from './auth.ts';
import { requireFeature } from './settings.ts';

// Money kept from a customer's deposit. When a booking is cancelled late, or only part of the cash is refunded, the rest of the deposit is kept (the cancellation rules). The customer can dispute
// that. The ground answers with a figure to give back, as credit or as a refund to their payment method; the owner approves exactly that figure; it is applied once.
// Every step is a row that is never changed: a new version is a new row, an approval names the version it approves, and an approval of an out-of-date figure is refused.

registerSchema('retention-1', `
CREATE TABLE retention_cases (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL UNIQUE REFERENCES bookings(id),
  owner_id TEXT NOT NULL, customer_id TEXT NOT NULL,
  retained_paise INTEGER NOT NULL CHECK (retained_paise > 0),
  opened_at INTEGER NOT NULL
);
CREATE TABLE retention_events (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES retention_cases(id),
  version INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('opened','proposed','amended','approved','applied','rejected','withdrawn')),
  release_paise INTEGER, as_kind TEXT CHECK (as_kind IN ('credit','refund')),
  note TEXT, actor_id TEXT NOT NULL, actor_role TEXT NOT NULL, at INTEGER NOT NULL,
  UNIQUE (case_id, version)
);
CREATE TRIGGER trg_ao_retention_events_update BEFORE UPDATE ON retention_events BEGIN SELECT RAISE(ABORT, 'retention_events is append-only: update refused'); END;
CREATE TRIGGER trg_ao_retention_events_delete BEFORE DELETE ON retention_events BEGIN SELECT RAISE(ABORT, 'retention_events is append-only: delete refused'); END;
CREATE TRIGGER trg_ao_retention_cases_delete BEFORE DELETE ON retention_cases BEGIN SELECT RAISE(ABORT, 'retention_cases cannot be deleted'); END;
`);

export type RetentionStatus = 'open' | 'proposed' | 'applied' | 'rejected' | 'withdrawn';
export interface RetentionEvent { version: number; kind: string; releasePaise: number | null; as: 'credit' | 'refund' | null; note: string | null; actorId: string; actorRole: string; at: number }
export interface RetentionCase { id: string; bookingId: string; retainedPaise: number; status: RetentionStatus; version: number; releasePaise: number | null; as: 'credit' | 'refund' | null; history: RetentionEvent[] }

interface CaseRow { id: string; booking_id: string; owner_id: string; customer_id: string; retained_paise: number; opened_at: number }
interface EvRow { version: number; kind: string; release_paise: number | null; as_kind: 'credit' | 'refund' | null; note: string | null; actor_id: string; actor_role: string; at: number }

/** What the ground kept from this booking's deposit and has not given back. */
export function retainedFor(b: BookingRow): number {
  if (b.status === 'cancelled' && b.resolution !== 'awaiting' && !b.owner_cancelled) return Math.max(b.paid_paise - b.credit_paise - b.refund_paise, 0);
  if (b.status === 'no_show') return Math.max(b.paid_paise - b.refund_paise, 0);
  return 0;
}

function caseOf(bookingId: string): CaseRow | undefined { return one<CaseRow>('SELECT * FROM retention_cases WHERE booking_id = ?', bookingId); }
function events(caseId: string): EvRow[] { return many<EvRow>('SELECT version, kind, release_paise, as_kind, note, actor_id, actor_role, at FROM retention_events WHERE case_id = ? ORDER BY version', caseId); }
function push(caseId: string, kind: string, actor: Actor, o: { release?: number | null; as?: 'credit' | 'refund' | null; note?: string | null } = {}): number {
  const v = (one<{ v: number }>('SELECT COALESCE(MAX(version),0) v FROM retention_events WHERE case_id = ?', caseId)!.v) + 1;
  run('INSERT INTO retention_events(id, case_id, version, kind, release_paise, as_kind, note, actor_id, actor_role, at) VALUES(?,?,?,?,?,?,?,?,?,?)', newId('ret'), caseId, v, kind, o.release ?? null, o.as ?? null, o.note ?? null, actor.id ?? 'system', actor.role, now());
  return v;
}

function view(c: CaseRow): RetentionCase {
  const ev = events(c.id);
  const last = ev[ev.length - 1]!;
  const prop = [...ev].reverse().find((e) => e.kind === 'proposed' || e.kind === 'amended');
  const status: RetentionStatus = last.kind === 'applied' ? 'applied' : last.kind === 'rejected' ? 'rejected' : last.kind === 'withdrawn' ? 'withdrawn' : last.kind === 'opened' ? 'open' : 'proposed';
  return { id: c.id, bookingId: c.booking_id, retainedPaise: c.retained_paise, status, version: last.version, releasePaise: prop?.release_paise ?? null, as: prop?.as_kind ?? null,
    history: ev.map((e) => ({ version: e.version, kind: e.kind, releasePaise: e.release_paise, as: e.as_kind, note: e.note, actorId: e.actor_id, actorRole: e.actor_role, at: e.at })) };
}

export function getRetentionCase(user: UserRow, bookingId: string): RetentionCase | null {
  const b = accessBooking(user, bookingId);
  const c = caseOf(b.id);
  return c ? view(c) : null;
}

export function listRetentionCases(user: UserRow, ownerId: string | null, status?: string): RetentionCase[] {
  const rows = many<CaseRow>(`SELECT * FROM retention_cases ${ownerId ? 'WHERE owner_id = ?' : ''} ORDER BY opened_at DESC LIMIT 200`, ...(ownerId ? [ownerId] : []));
  void user;
  return rows.map(view).filter((c) => !status || c.status === status);
}

/** The customer disputes what was kept. One dispute per booking. */
export function openRetentionDispute(user: UserRow, bookingId: string, body: unknown): RetentionCase {
  if (user.role !== 'customer') throw new HttpError(403, 'FORBIDDEN', 'Only the customer disputes what was kept');
  requireFeature('retentionDisputesEnabled', 'Disputing a deposit here');
  const v = new Validator(body);
  const reason = v.str('reason', { required: true, min: 10, max: 500 });
  v.done();
  const actor: Actor = { id: user.id, role: user.role };
  return tx(() => {
    const b = accessBooking(user, bookingId);
    const kept = retainedFor(b);
    if (kept <= 0) throw new HttpError(409, 'NOTHING_RETAINED', 'Nothing was kept from this booking\'s deposit.');
    if (caseOf(b.id)) throw new HttpError(409, 'ALREADY_OPENED', 'A dispute was already opened for this booking.');
    const id = newId('rtc');
    run('INSERT INTO retention_cases(id, booking_id, owner_id, customer_id, retained_paise, opened_at) VALUES(?,?,?,?,?,?)', id, b.id, b.owner_id, b.customer_id, kept, now());
    push(id, 'opened', actor, { note: reason });
    audit(actor, 'retention.open', 'booking', b.id, { retainedPaise: kept, reason }, b.owner_id);
    pushStaffOf(b.owner_id, 'retention_dispute', 'Deposit dispute', `${b.ref}: the customer disputes ${formatPaise(kept)} kept from the deposit. Open the booking to answer.`, b.id);
    return view(caseOf(b.id)!);
  });
}

export function withdrawRetentionDispute(user: UserRow, bookingId: string): RetentionCase {
  if (user.role !== 'customer') throw new HttpError(403, 'FORBIDDEN', 'Only the customer withdraws a dispute');
  const actor: Actor = { id: user.id, role: user.role };
  return tx(() => {
    const b = accessBooking(user, bookingId);
    const c = caseOf(b.id);
    if (!c) throw new HttpError(404, 'NOT_FOUND', 'No dispute for this booking');
    const s = view(c);
    if (s.status === 'applied' || s.status === 'rejected' || s.status === 'withdrawn') throw new HttpError(409, 'BAD_STATE', `This dispute is already ${s.status}`);
    push(c.id, 'withdrawn', actor);
    audit(actor, 'retention.withdraw', 'booking', b.id, {}, b.owner_id);
    return view(c);
  });
}

/** The ground answers with a figure and how it is returned. Sending another figure while one is waiting makes a new version; nothing is approved until the owner approves that version. */
export function proposeRetentionRelease(user: UserRow, bookingId: string, body: unknown): RetentionCase {
  if (user.role === 'customer') throw new HttpError(403, 'FORBIDDEN', 'Not allowed');
  const v = new Validator(body);
  const release = v.int('releasePaise', { required: true, min: 0 });
  const as = v.oneOf('as', ['credit', 'refund'] as const, true);
  const note = v.str('note', { max: 500 });
  v.done();
  const actor: Actor = { id: user.id, role: user.role };
  return tx(() => {
    const b = accessBooking(user, bookingId, 'record_payments');
    requirePermission(user, 'record_payments');
    const c = caseOf(b.id);
    if (!c) throw new HttpError(404, 'NOT_FOUND', 'No dispute for this booking');
    const s = view(c);
    if (s.status !== 'open' && s.status !== 'proposed') throw new HttpError(409, 'BAD_STATE', `This dispute is ${s.status}`);
    if (release! > c.retained_paise) throw new HttpError(409, 'RELEASE_TOO_LARGE', `At most ${c.retained_paise} paise was kept`);
    if (b.status === 'no_show' && as === 'credit') throw new HttpError(409, 'CREDIT_NOT_ALLOWED', 'For a no-show the money can only go back to the payment method');
    const kind = s.status === 'proposed' ? 'amended' : 'proposed';
    const ver = push(c.id, kind, actor, { release, as: as!, note });
    audit(actor, `retention.${kind}`, 'booking', b.id, { version: ver, releasePaise: release, as, note: note ?? null }, b.owner_id);
    return view(c);
  });
}

function decide(user: UserRow, bookingId: string, body: unknown, approve: boolean): { case: RetentionCase; booking: Booking } {
  if (user.role !== 'owner' && user.role !== 'super_admin') throw new HttpError(403, 'FORBIDDEN', 'Only the owner approves what is given back from a deposit');
  const v = new Validator(body);
  const version = v.int('version', { required: true, min: 1 });
  const note = v.str('note', { required: !approve, max: 500 });
  v.done();
  const actor: Actor = { id: user.id, role: user.role };
  return tx(() => {
    const b = accessBooking(user, bookingId);
    const c = caseOf(b.id);
    if (!c) throw new HttpError(404, 'NOT_FOUND', 'No dispute for this booking');
    const s = view(c);
    if (s.status !== 'proposed') throw new HttpError(409, 'BAD_STATE', s.status === 'open' ? 'There is no figure to approve yet' : `This dispute is ${s.status}`);
    if (s.version !== version) throw new HttpError(409, 'STALE_VERSION', `The figure changed (now version ${s.version}). Review it again.`, { current: s.version });
    if (!approve) {
      push(c.id, 'rejected', actor, { note });
      audit(actor, 'retention.reject', 'booking', b.id, { version, note }, b.owner_id);
      notify(b.customer_id, 'retention_update', { ref: b.ref, extra: 'Your dispute was reviewed and the amount kept stands.' }, b.id);
      return { case: view(c), booking: viewBooking(b.id) };
    }
    const give = s.releasePaise ?? 0;
    const as = s.as!;
    push(c.id, 'approved', actor, { release: give, as, note });
    let done = 0;
    if (give > 0) {
      const t = now();
      if (as === 'credit') {
        credits.issueCredit({ customerId: b.customer_id, ownerId: b.owner_id, amountPaise: give, source: 'restore', bookingId: b.id, note: `Deposit dispute on ${b.ref}`, by: user.id, silent: true });
        run('UPDATE bookings SET credit_paise = credit_paise + ?, updated_at = ? WHERE id = ?', give, t, b.id);
        done = give;
      } else {
        let left = give;
        const pays = many<PaymentRow>("SELECT * FROM payments WHERE booking_id = ? AND method <> 'credit' AND status IN ('captured','partially_refunded') ORDER BY created_at DESC, rowid DESC", b.id);
        for (const p of pays) {
          if (left <= 0) break;
          const take = Math.min(p.amount_paise - p.refunded_paise, left);
          if (take > 0) { refundPayment(p, take, `deposit dispute on ${b.ref}`, actor, { onBooking: true }); left -= take; done += take; }
        }
        if (left > 0) throw new HttpError(409, 'REFUND_EXCEEDS_CASH', `Only ${done} paise can go back to the payment method; give the rest as credit`);
        run('UPDATE bookings SET refund_paise = refund_paise + ?, updated_at = ? WHERE id = ?', done, t, b.id);
      }
    }
    push(c.id, 'applied', actor, { release: done, as });
    audit(actor, 'retention.apply', 'booking', b.id, { version, releasePaise: done, as }, b.owner_id);
    notify(b.customer_id, 'retention_update', { ref: b.ref, extra: done > 0 ? `${formatPaise(done)} is ${as === 'credit' ? 'added to your account credit' : 'being refunded to your payment method'}.` : 'Your dispute was reviewed and the amount kept stands.' }, b.id);
    return { case: view(c), booking: viewBooking(b.id) };
  });
}

export const approveRetentionRelease = (user: UserRow, bookingId: string, body: unknown) => decide(user, bookingId, body, true);
export const rejectRetentionRelease = (user: UserRow, bookingId: string, body: unknown) => decide(user, bookingId, body, false);
