import type { Booking } from '@daji/shared';
import { formatPaise } from '@daji/shared';
import { many, one, run, tx, registerSchema } from './db.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { HttpError } from './errors.ts';
import { audit, type Actor } from './audit.ts';
import { Validator } from './input.ts';
import { HOUR, MIN, timeOfDay } from './time.ts';
import { getSettings, requireFeature } from './settings.ts';
import { accessBooking, releaseSlotsExcept, viewBooking, type BookingRow } from './bookings.ts';
import * as credits from './credits.ts';
import { refundPayment } from './payments.ts';
import type { PaymentRow } from './payments.ts';
import { getGroundOr404, slotPrice, slotStarts } from './grounds.ts';
import { assertDayOpen, assertOnlineWindow, planFor, takeSlots } from './hold.ts';
import { resolveOption } from './options.ts';
import { cancelBooking } from './cancellation.ts';
import { notify, pushStaffOf, venueData } from './notifications.ts';
import { requirePermission, scopeOwnerId, type UserRow } from './auth.ts';
import type { Config } from './config.ts';

// Moving a confirmed booking, adding time to it, and cancelling a whole day for weather. None of these is a second booking path: the new slots go through the
// same planner and the same slot guard as a hold, inside one transaction, so a move either lands completely or changes nothing.

registerSchema('reschedule-1', `
ALTER TABLE bookings ADD COLUMN reschedule_count INTEGER NOT NULL DEFAULT 0;
CREATE TABLE booking_reschedules (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('move','extend')),
  from_start_at INTEGER NOT NULL, from_end_at INTEGER NOT NULL, from_slots INTEGER NOT NULL, from_total_paise INTEGER NOT NULL,
  to_start_at INTEGER NOT NULL, to_end_at INTEGER NOT NULL, to_slots INTEGER NOT NULL, to_total_paise INTEGER NOT NULL,
  actor_id TEXT NOT NULL, actor_role TEXT NOT NULL, reason TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX ix_booking_reschedules_booking ON booking_reschedules(booking_id, created_at);
CREATE TRIGGER trg_ao_booking_reschedules_update BEFORE UPDATE ON booking_reschedules BEGIN SELECT RAISE(ABORT, 'booking_reschedules is append-only: update refused'); END;
CREATE TRIGGER trg_ao_booking_reschedules_delete BEFORE DELETE ON booking_reschedules BEGIN SELECT RAISE(ABORT, 'booking_reschedules is append-only: delete refused'); END;
`);

// The policy numbers are settings (rescheduleCutoffHours, rescheduleMaxMoves), decided by the owner: 24 hours and 2 completed moves. Only a move the customer made and that
// completed counts; a failed or abandoned attempt changes nothing and so uses none. Staff are not limited and their moves are not the customer's.

/** What a cheaper new time did with the difference. Never a silent refund: credit (recorded, audited, the customer is told) or a refund request that goes through the approval chain. */
export interface Settlement { treatment: 'none' | 'credit' | 'refund_request'; paiseSettled: number; creditPaise: number; refundRequestedPaise: number; creditLotId?: string }
export interface RescheduleResult { booking: Booking; fromStartAt: number; toStartAt: number; fromTotalPaise: number; toTotalPaise: number; balancePaise: number; settlement?: Settlement }

/** Completed moves the customer made on this booking, from the append-only history (not from a counter that could drift). */
export function customerMovesDone(bookingId: string): number {
  return one<{ n: number }>("SELECT COUNT(*) n FROM booking_reschedules WHERE booking_id = ? AND kind = 'move' AND actor_role = 'customer'", bookingId)!.n;
}

/** The customer's policy as configured; null when either number is not configured (then customers cannot move a booking). */
export function reschedulePolicy(): { cutoffHours: number; maxMoves: number } | null {
  const s = getSettings();
  return s.rescheduleCutoffHours === null || s.rescheduleMaxMoves === null ? null : { cutoffHours: s.rescheduleCutoffHours, maxMoves: s.rescheduleMaxMoves };
}

function settleCheaper(b: BookingRow, user: UserRow, excess: number, actor: Actor, t: number): Settlement {
  const treatment = getSettings().rescheduleCheaperTreatment;
  let toRefund = 0, requested = 0;
  if (treatment === 'refund_request') {
    toRefund = excess;
    const pays = many<PaymentRow>("SELECT * FROM payments WHERE booking_id = ? AND method <> 'credit' AND status IN ('captured','partially_refunded') ORDER BY created_at DESC, rowid DESC", b.id);
    for (const p of pays) {
      if (toRefund <= 0) break;
      const take = Math.min(p.amount_paise - p.refunded_paise, toRefund);
      if (take > 0) { refundPayment(p, take, `booking ${b.ref} moved to a cheaper time`, actor, { onBooking: true }); toRefund -= take; requested += take; }
    }
  }
  const credit = excess - requested; // credit is also where any part a refund could not cover goes
  let lotId: string | undefined;
  if (credit > 0) lotId = credits.issueCredit({ customerId: b.customer_id, ownerId: b.owner_id, amountPaise: credit, source: 'restore', bookingId: b.id, note: `Booking ${b.ref} moved to a cheaper time`, by: user.id }).lotId;
  run('UPDATE bookings SET paid_paise = paid_paise - ?, updated_at = ? WHERE id = ?', excess, t, b.id);
  return { treatment: requested > 0 && credit === 0 ? 'refund_request' : 'credit', paiseSettled: excess, creditPaise: credit, refundRequestedPaise: requested, ...(lotId ? { creditLotId: lotId } : {}) };
}

function parseMove(cfg: Config, user: UserRow, body: unknown): { groundId?: string; date: string; startTime: string; slots?: number; formatId?: string; ruleId?: string; reason?: string; totalPaise?: number } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (typeof b.optionId === 'string') {
    const extra = Object.keys(b).filter((k) => k !== 'optionId' && k !== 'reason');
    if (extra.length) throw new HttpError(400, 'OPTION_FIELDS_NOT_ALLOWED', `A booking option fixes the slot and price; these fields cannot be sent with it: ${extra.join(', ')}`);
    const { request, totalPaise } = resolveOption(cfg, user.id, b.optionId);
    return { ...request, reason: typeof b.reason === 'string' ? b.reason.slice(0, 300) : undefined, totalPaise };
  }
  const v = new Validator(body);
  const groundId = v.str('groundId', { max: 40 });
  const date = v.date('date', true), startTime = v.time('startTime', true);
  const formatId = v.str('formatId', { max: 40 }), ruleId = v.str('ruleId', { max: 40 });
  const slots = v.int('slots', { min: 1, max: 24 });
  const reason = v.str('reason', { max: 300 });
  v.done();
  return { groundId, date: date!, startTime: startTime!, slots, formatId, ruleId, reason };
}

function ensureMovable(b: BookingRow): void {
  if (b.status !== 'confirmed') throw new HttpError(409, 'BAD_STATE', `Only a confirmed booking can be moved. This one is ${b.status}.`);
  if (b.series_id) throw new HttpError(409, 'SERIES_NOT_MOVABLE', 'A repeating or block booking cannot be moved one date at a time. Cancel the date and book another.');
  if (b.start_at <= now()) throw new HttpError(409, 'ALREADY_STARTED', 'This booking has already started.');
  const inFlight = one<{ n: number }>("SELECT COUNT(*) n FROM payments WHERE booking_id = ? AND status IN ('created','pending','submitted')", b.id)!.n;
  if (inFlight) throw new HttpError(409, 'PAYMENT_IN_FLIGHT', 'A payment on this booking is still being confirmed. Move it once that is settled.');
}

/**
 * Moves a confirmed booking to another time on the same ground. Customers: before the free-cancellation cut-off, limited times, only to a time the ground offers online.
 * The old slots are given up and the new ones taken in one transaction; if the new ones are not free nothing changes. What was paid stays on the booking;
 * a dearer slot leaves a larger balance. A cheaper slot that would leave the booking over-paid is refused: cancel and rebook, so the money is settled by the refund rules.
 */
export function rescheduleBooking(cfg: Config, user: UserRow, bookingId: string, body: unknown, via: { channel?: 'guppi'; actionId?: string } = {}): RescheduleResult {
  const byCustomer = user.role === 'customer';
  if (byCustomer) requireFeature('customerRescheduleEnabled', 'Changing a booking yourself');
  const b0 = accessBooking(user, bookingId, byCustomer ? undefined : 'manage_bookings');
  const req = parseMove(cfg, user, body);
  if (req.groundId && req.groundId !== b0.ground_id) throw new HttpError(409, 'SAME_GROUND_ONLY', 'A booking can only be moved to another time on the same ground.');
  const actor: Actor = { id: user.id, role: user.role };
  return tx(() => {
    const b = accessBooking(user, bookingId);
    ensureMovable(b);
    const t = now();
    const policy = reschedulePolicy();
    if (byCustomer) {
      if (!policy) throw new HttpError(409, 'RESCHEDULE_NOT_CONFIGURED', 'Changing a booking yourself is not set up yet. Please call the ground.');
      // exactly the cut-off, or less, is blocked; only strictly more than the cut-off is allowed. The start is the booking's own timestamp, never text on a screen.
      if (b.start_at - t <= policy.cutoffHours * HOUR) throw new HttpError(409, 'RESCHEDULE_TOO_LATE', `A booking can be moved only when more than ${policy.cutoffHours} hours remain before it starts. Please call the ground.`);
      if (customerMovesDone(b.id) >= policy.maxMoves) throw new HttpError(409, 'RESCHEDULE_LIMIT', `A booking can be moved ${policy.maxMoves} times. Please call the ground.`);
      assertOnlineWindow(req.date);
    } else if ((req.reason ?? '').trim().length < 10) throw new HttpError(400, 'REASON_REQUIRED', 'Say why the booking is being moved (at least 10 characters). It is recorded with your name.');
    const ground = getGroundOr404(b.ground_id);
    const plan = planFor(ground, { date: req.date, startTime: req.startTime, slots: req.slots ?? (b.format_label ? undefined : b.slot_count), formatId: req.formatId, ruleId: req.ruleId }, byCustomer);
    if (byCustomer) assertDayOpen(req.date, plan.format?.ball === 'practice' ? 'practice' : 'ground');
    if (req.totalPaise !== undefined && req.totalPaise !== plan.totalPaise) throw new HttpError(409, 'OPTION_PRICE_CHANGED', 'The price changed since this option was offered. Ask for the options again.', { offeredPaise: req.totalPaise, currentPaise: plan.totalPaise });
    const sameSlots = plan.starts.length === b.slot_count && plan.starts[0] === b.start_at;
    if (sameSlots) throw new HttpError(409, 'NO_CHANGE', 'That is the time the booking already has.');
    const newTotal = Math.max(plan.totalPaise - Math.min(b.discount_paise ?? 0, plan.totalPaise), 0);
    const excess = Math.max(b.paid_paise - newTotal, 0); // a cheaper time: the difference is settled below, as credit or a refund request, never refunded silently

    // The replacement is taken FIRST (only the slots the booking does not already own); if any is taken the move stops here and the original stays exactly as it was.
    // Only after the replacement is held are the old slots it no longer needs given up.
    const owned = new Set(many<{ slot_start: number }>("SELECT slot_start FROM booking_slots WHERE booking_id = ? AND kind = 'booking'", b.id).map((r) => r.slot_start));
    takeSlots(b.id, ground, plan.starts.filter((s) => !owned.has(s)));
    releaseSlotsExcept(b.id, plan.starts);
    const endAt = plan.starts[plan.starts.length - 1]! + ground.slot_minutes * MIN;
    run(`UPDATE bookings SET date = ?, start_at = ?, end_at = ?, slot_count = ?, total_paise = ?, advance_paise = MIN(advance_paise, ?), format_label = ?, ball = ?, reminded_at = NULL, reschedule_count = reschedule_count + ?, updated_at = ? WHERE id = ?`,
      plan.date, plan.starts[0]!, endAt, plan.starts.length, newTotal, newTotal, plan.format?.label ?? null, plan.format?.ball ?? null, byCustomer ? 1 : 0, t, b.id);
    run("INSERT INTO booking_reschedules(id, booking_id, owner_id, kind, from_start_at, from_end_at, from_slots, from_total_paise, to_start_at, to_end_at, to_slots, to_total_paise, actor_id, actor_role, reason, created_at) VALUES(?,?,?,'move',?,?,?,?,?,?,?,?,?,?,?,?)",
      newId('rsc'), b.id, b.owner_id, b.start_at, b.end_at, b.slot_count, b.total_paise, plan.starts[0]!, endAt, plan.starts.length, newTotal, user.id, user.role, req.reason ?? null, t);
    const settlement = excess > 0 ? settleCheaper(b, user, excess, actor, t) : undefined;
    audit(actor, 'booking.reschedule', 'booking', b.id, { ...(settlement ? { settlement } : {}), movedBy: byCustomer ? 'customer' : 'staff', fromStartAt: b.start_at, toStartAt: plan.starts[0], fromTotalPaise: b.total_paise, toTotalPaise: newTotal, paidPaise: b.paid_paise, reason: req.reason ?? null, ...(via.channel ? { via: via.channel, actionId: via.actionId ?? null } : {}) }, b.owner_id);
    notify(b.customer_id, 'booking_rescheduled', { ref: b.ref, ground: ground.name, startAt: plan.starts[0], extra: newTotal > b.paid_paise ? `Balance to pay at the ground: ${formatPaise(newTotal - b.paid_paise)}.` : undefined, ...venueData(b.ground_id) }, b.id);
    if (byCustomer) pushStaffOf(b.owner_id, 'booking_rescheduled_by_customer', 'Booking moved', `${b.ref} was moved by the customer to ${timeOfDay(plan.starts[0]!)} on ${plan.date}.`, b.id);
    return { booking: viewBooking(b.id), fromStartAt: b.start_at, toStartAt: plan.starts[0]!, fromTotalPaise: b.total_paise, toTotalPaise: newTotal, balancePaise: Math.max(newTotal - (b.paid_paise - (settlement?.paiseSettled ?? 0)), 0), ...(settlement ? { settlement } : {}) };
  });
}

/**
 * Overtime: adds hours after the end of a confirmed booking when the next slots are free, at the ground's hourly price for those slots. The price is added to the balance,
 * which is collected the usual way (nothing is charged here). Staff only; a customer who wants longer asks the ground.
 */
export function extendBooking(user: UserRow, bookingId: string, body: unknown): RescheduleResult {
  const v = new Validator(body);
  const extra = v.int('slots', { required: true, min: 1, max: 6 });
  const reason = v.str('reason', { max: 300 });
  v.done();
  const actor: Actor = { id: user.id, role: user.role };
  return tx(() => {
    const b = accessBooking(user, bookingId, 'manage_bookings');
    if (b.status !== 'confirmed') throw new HttpError(409, 'BAD_STATE', `Only a confirmed booking can be extended. This one is ${b.status}.`);
    if (b.series_id) throw new HttpError(409, 'SERIES_NOT_MOVABLE', 'A repeating or block booking cannot be extended one date at a time.');
    if (b.end_at <= now() - 6 * HOUR) throw new HttpError(409, 'TOO_OLD', 'This booking ended too long ago to extend.');
    const ground = getGroundOr404(b.ground_id);
    const day = slotStarts(ground, b.date);
    const last = b.end_at - ground.slot_minutes * MIN;
    const at = day.indexOf(last);
    const next = at < 0 ? [] : day.slice(at + 1, at + 1 + extra!);
    if (next.length < extra!) throw new HttpError(409, 'OUTSIDE_HOURS', 'The ground closes before that much extra time.');
    const add = next.reduce((s, x) => s + slotPrice(ground, b.date, x), 0);
    takeSlots(b.id, ground, next);
    const t = now();
    const endAt = next[next.length - 1]! + ground.slot_minutes * MIN;
    run('UPDATE bookings SET end_at = ?, slot_count = slot_count + ?, total_paise = total_paise + ?, updated_at = ? WHERE id = ?', endAt, next.length, add, t, b.id);
    run("INSERT INTO booking_reschedules(id, booking_id, owner_id, kind, from_start_at, from_end_at, from_slots, from_total_paise, to_start_at, to_end_at, to_slots, to_total_paise, actor_id, actor_role, reason, created_at) VALUES(?,?,?,'extend',?,?,?,?,?,?,?,?,?,?,?,?)",
      newId('rsc'), b.id, b.owner_id, b.start_at, b.end_at, b.slot_count, b.total_paise, b.start_at, endAt, b.slot_count + next.length, b.total_paise + add, user.id, user.role, reason ?? null, t);
    audit(actor, 'booking.extend', 'booking', b.id, { addedSlots: next.length, addedPaise: add, fromEndAt: b.end_at, toEndAt: endAt, reason: reason ?? null }, b.owner_id);
    notify(b.customer_id, 'booking_extended', { ref: b.ref, ground: ground.name, extra: `${next.length} more hour${next.length > 1 ? 's' : ''} added (${formatPaise(add)}).` }, b.id);
    const after = viewBooking(b.id);
    return { booking: after, fromStartAt: b.start_at, toStartAt: b.start_at, fromTotalPaise: b.total_paise, toTotalPaise: b.total_paise + add, balancePaise: after.balancePaise };
  });
}

export interface DayCancelResult { cancelled: string[]; alreadyCancelled: string[]; skipped: { id: string; reason: string }[] }

/**
 * Weather or another operational reason closes a ground for a day. Every held or confirmed booking that day is cancelled by the ground with the reason;
 * a booking with money on it goes to the customer's choice (full refund, credit, or another slot), exactly as a single cancellation by the ground does.
 * Safe to run again: a booking already cancelled is left alone.
 */
export function cancelGroundDay(user: UserRow, groundId: string, date: string, reason: string, offers?: string[]): DayCancelResult {
  const g = getGroundOr404(groundId);
  if (user.role !== 'super_admin' && scopeOwnerId(user) !== g.owner_id) throw new HttpError(404, 'NOT_FOUND', 'Ground not found');
  requirePermission(user, 'manage_bookings');
  const r = reason.trim();
  if (r.length < 10) throw new HttpError(400, 'REASON_REQUIRED', 'Explain why the day is cancelled (at least 10 characters). Customers will read it.');
  const rows = many<BookingRow>("SELECT * FROM bookings WHERE ground_id = ? AND date = ? AND status IN ('held','confirmed') AND start_at > ? ORDER BY start_at", groundId, date, now());
  const out: DayCancelResult = { cancelled: [], alreadyCancelled: many<{ id: string }>("SELECT id FROM bookings WHERE ground_id = ? AND date = ? AND status = 'cancelled'", groundId, date).map((x) => x.id), skipped: [] };
  for (const b of rows) {
    try { cancelBooking(user, b.id, { reason: r, offers, waive: false }); out.cancelled.push(b.id); }
    catch (e) { out.skipped.push({ id: b.id, reason: (e as Error).message }); }
  }
  audit({ id: user.id, role: user.role }, 'ground.day_cancel', 'ground', groundId, { date, reason: r, cancelled: out.cancelled.length, skipped: out.skipped.length }, g.owner_id);
  return out;
}
