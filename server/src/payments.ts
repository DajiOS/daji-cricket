import { createHash } from 'node:crypto';
import type { Page, Payment, PayMethod, RefundRow } from '@daji/shared';
import { many, one, registerSchema, run, tx } from './db.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { HttpError, notFound } from './errors.ts';
import { audit, SYSTEM, type Actor } from './audit.ts';
import { notify } from './notifications.ts';
import { accessBooking, bookingOr404, confirmBooking, toPayment, type BookingRow } from './bookings.ts';
import { requirePermission, scopeOwnerId, type UserRow } from './auth.ts';
import { getSettings } from './settings.ts';
import { MIN, istDate } from './time.ts';
import { checkCashReceipt } from './taxrules.ts';
import type { Config } from './config.ts';
import { getGateway, verifyWebhookSignature, webhookSecretFor } from './gateway.ts';

export interface PaymentRow {
  id: string; booking_id: string; customer_id: string; owner_id: string; method: PayMethod;
  status: 'created' | 'pending' | 'submitted' | 'captured' | 'failed' | 'rejected' | 'refunded' | 'partially_refunded';
  purpose: 'advance' | 'balance' | 'full'; amount_paise: number; refunded_paise: number; reference: string | null; rp_order_id: string | null;
  rp_payment_id: string | null; proof_note: string | null; submitted_at: number | null; verified_by: string | null; verified_at: number | null;
  reject_reason: string | null; late: number; recorded_by: string | null; created_at: number; updated_at: number;
}

export const paymentRow = (id: string): PaymentRow | undefined => one<PaymentRow>('SELECT * FROM payments WHERE id = ?', id);
export function paymentOr404(id: string): PaymentRow {
  const p = paymentRow(id);
  if (!p) throw notFound('Payment not found');
  return p;
}

export function logEvent(paymentId: string, actorId: string | null, event: string, detail: unknown = null): void {
  run('INSERT INTO payment_events(id, payment_id, at, actor_id, event, detail) VALUES(?,?,?,?,?,?)', newId('pev'), paymentId, now(), actorId, event, detail === null ? null : JSON.stringify(detail));
}

/** What the customer still owes now to confirm a held booking. */
export const amountDue = (b: BookingRow): number => Math.max(b.advance_paise - b.paid_paise, 0);

export function insertPayment(b: BookingRow, o: { method: PayMethod; status: PaymentRow['status']; purpose: PaymentRow['purpose']; amountPaise: number; reference?: string | null; recordedBy?: string | null; rpOrderId?: string | null; verifiedBy?: string | null }): string {
  const id = newId('pay');
  const t = now();
  run(
    `INSERT INTO payments(id, booking_id, customer_id, owner_id, method, status, purpose, amount_paise, reference, rp_order_id, verified_by, verified_at, recorded_by, created_at, updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, b.id, b.customer_id, b.owner_id, o.method, o.status, o.purpose, o.amountPaise, o.reference ?? null, o.rpOrderId ?? null,
    o.status === 'captured' ? (o.verifiedBy ?? o.recordedBy ?? null) : null, o.status === 'captured' ? t : null, o.recordedBy ?? null, t, t,
  );
  logEvent(id, o.recordedBy ?? null, `created:${o.status}`, { method: o.method, amountPaise: o.amountPaise });
  return id;
}

export interface CaptureOpts { actor: Actor; via: 'webhook' | 'client' | 'staff' | 'offline'; rpPaymentId?: string; reference?: string; amountPaise?: number }
// Every refund waits for the super admin's authorisation before any money moves. Refunds that existed before this rule are treated as already authorised.
registerSchema('refund-approval-1', `
ALTER TABLE refunds ADD COLUMN approved_at INTEGER;
ALTER TABLE refunds ADD COLUMN approved_by TEXT;
UPDATE refunds SET approved_at = created_at, approved_by = 'before-rule';
`);

export type CaptureOutcome = 'confirmed' | 'partial' | 'already' | 'extra_refunded' | 'late_reconfirmed' | 'late_refunded' | 'cancelled_refunded' | 'paid_extra';

/** The one place a payment becomes money received. Idempotent; safe to call from webhook, client callback and staff verification. */
export function applyCaptured(paymentId: string, o: CaptureOpts): { outcome: CaptureOutcome } {
  return tx(() => {
    const p = paymentOr404(paymentId);
    if (p.status === 'captured' || p.status === 'refunded' || p.status === 'partially_refunded') {
      if (o.rpPaymentId && p.rp_payment_id && p.rp_payment_id !== o.rpPaymentId) {
        // A second, different Razorpay payment for the same order: the customer paid twice. Take it in and give it back.
        const b = bookingOr404(p.booking_id);
        const extra = insertPayment(b, { method: 'razorpay', status: 'captured', purpose: p.purpose, amountPaise: o.amountPaise ?? p.amount_paise });
        run('UPDATE payments SET rp_payment_id = ?, late = 1 WHERE id = ?', o.rpPaymentId, extra);
        refundPayment(paymentOr404(extra), o.amountPaise ?? p.amount_paise, 'duplicate payment for the same order', o.actor);
        audit(o.actor, 'payment.duplicate', 'payment', extra, { of: p.id }, p.owner_id);
        return { outcome: 'extra_refunded' as const };
      }
      return { outcome: 'already' as const };
    }
    const amount = o.amountPaise ?? p.amount_paise;
    const t = now();
    run(
      `UPDATE payments SET status = 'captured', amount_paise = ?, rp_payment_id = COALESCE(?, rp_payment_id), reference = COALESCE(reference, ?),
         verified_at = ?, verified_by = ?, reject_reason = NULL, updated_at = ? WHERE id = ?`,
      amount, o.rpPaymentId ?? null, o.reference ?? null, t, o.actor.id, t, p.id);
    logEvent(p.id, o.actor.id, `captured:${o.via}`, { amountPaise: amount, rpPaymentId: o.rpPaymentId ?? null });
    audit(o.actor, 'payment.capture', 'payment', p.id, { via: o.via, amountPaise: amount, method: p.method, bookingId: p.booking_id }, p.owner_id);

    const b = bookingOr404(p.booking_id);
    if (b.status === 'held') {
      run('UPDATE bookings SET paid_paise = paid_paise + ?, updated_at = ? WHERE id = ?', amount, t, b.id);
      const nb = bookingOr404(b.id);
      if (nb.paid_paise >= nb.advance_paise) { confirmBooking(b.id, o.actor, { via: o.via }); return { outcome: 'confirmed' as const }; }
      return { outcome: 'partial' as const };
    }
    if (b.status === 'confirmed' || b.status === 'completed' || b.status === 'no_show') {
      // Only what is still owed counts toward the booking; money beyond the total (staff took cash while this payment was in flight) goes back.
      const owed = Math.max(b.total_paise - b.paid_paise, 0), keep = Math.min(amount, owed), over = amount - keep;
      run('UPDATE bookings SET paid_paise = paid_paise + ?, updated_at = ? WHERE id = ?', keep, t, b.id);
      if (over > 0) {
        refundPayment(paymentOr404(p.id), over, 'payment received after the booking was already fully paid', o.actor);
        audit(o.actor, 'payment.overpaid_refund', 'payment', p.id, { bookingId: b.id, amountPaise: over }, p.owner_id);
        notify(b.customer_id, 'late_payment_refund', { ref: b.ref, refundPaise: over }, b.id);
        if (keep === 0) return { outcome: 'extra_refunded' as const };
      }
      if (p.method === 'razorpay' && p.purpose === 'balance') {
        const g = one<{ name: string }>('SELECT name FROM grounds WHERE id = ?', b.ground_id);
        notify(b.customer_id, 'autodebit_charged', { ref: b.ref, ground: g?.name, startAt: b.start_at, amountPaise: amount }, b.id);
      }
      return { outcome: 'paid_extra' as const };
    }
    if (b.status === 'expired') return lateForExpired(b, p, amount, o.actor);
    // cancelled
    run('UPDATE payments SET late = 1 WHERE id = ?', p.id);
    refundPayment(paymentOr404(p.id), amount, 'booking was cancelled before this payment arrived', o.actor);
    notify(b.customer_id, 'late_payment_refund', { ref: b.ref, refundPaise: amount }, b.id);
    return { outcome: 'cancelled_refunded' as const };
  });
}

function lateForExpired(b: BookingRow, p: PaymentRow, amount: number, actor: Actor): { outcome: CaptureOutcome } {
  const slotMs = one<{ slot_minutes: number }>('SELECT slot_minutes FROM grounds WHERE id = ?', b.ground_id)!.slot_minutes * MIN;
  const starts = Array.from({ length: b.slot_count }, (_, i) => b.start_at + i * slotMs);
  const t = now();
  const free = b.start_at > t && starts.every((s) => !one('SELECT 1 FROM booking_slots WHERE ground_id = ? AND slot_start = ?', b.ground_id, s));
  run('UPDATE payments SET late = 1 WHERE id = ?', p.id);
  if (!free) {
    refundPayment(paymentOr404(p.id), amount, 'payment arrived after the slot was released and it is no longer free', actor);
    audit(actor, 'payment.late_refund', 'payment', p.id, { bookingId: b.id, amountPaise: amount }, b.owner_id);
    notify(b.customer_id, 'late_payment_refund', { ref: b.ref, refundPaise: amount }, b.id);
    return { outcome: 'late_refunded' };
  }
  for (const s of starts) run("INSERT INTO booking_slots(ground_id, slot_start, kind, booking_id) VALUES(?,?,'booking',?)", b.ground_id, s, b.id);
  run("UPDATE bookings SET status = 'held', paid_paise = paid_paise + ?, hold_expires_at = ?, needs_review = 1, updated_at = ? WHERE id = ?", amount, t + getSettings().holdMinutesOnline * MIN, t, b.id);
  audit(actor, 'booking.late_reconfirm', 'booking', b.id, { paymentId: p.id, amountPaise: amount }, b.owner_id);
  const nb = bookingOr404(b.id);
  if (nb.paid_paise >= nb.advance_paise) {
    confirmBooking(b.id, actor, { late: true });
    // confirming clears the flag; keep it so staff see that this booking was rescued after its hold ran out
    run('UPDATE bookings SET needs_review = 1 WHERE id = ?', b.id);
  }
  return { outcome: 'late_reconfirmed' };
}

export function markFailed(paymentId: string, reason: string, actor: Actor): void {
  const p = paymentOr404(paymentId);
  if (p.status === 'captured' || p.status === 'failed' || p.status === 'refunded' || p.status === 'partially_refunded') return;
  run("UPDATE payments SET status = 'failed', reject_reason = ?, updated_at = ? WHERE id = ?", reason, now(), paymentId);
  logEvent(paymentId, actor.id, 'failed', { reason });
  const b = bookingOr404(p.booking_id);
  if (b.status === 'held') notify(b.customer_id, 'payment_failed', { ref: b.ref, reason }, b.id);
  else if (b.status === 'confirmed' && p.method === 'razorpay' && p.purpose === 'balance') {
    const g = one<{ name: string }>('SELECT name FROM grounds WHERE id = ?', b.ground_id);
    notify(b.customer_id, 'autodebit_failed', { ref: b.ref, ground: g?.name, startAt: b.start_at, amountPaise: p.amount_paise, reason }, b.id);
  }
}

// ---------------------------------------------------------------- direct UPI

const UTR_RE = /^\d{12}$/;

/** Customer pays by UPI, then submits the 12-digit reference (UTR). Staff must verify before the booking is confirmed. */
export function submitUpiReference(user: UserRow, bookingId: string, input: { utr: string; note?: string }): Payment {
  const b = accessBooking(user, bookingId);
  if (user.role !== 'customer') throw new HttpError(403, 'FORBIDDEN', 'Only the customer submits a UPI reference');
  if (b.status !== 'held') throw new HttpError(409, 'BAD_STATE', `This booking is ${b.status}, so a payment reference cannot be added`);
  if (b.pay_method !== 'upi') throw new HttpError(409, 'WRONG_METHOD', 'This booking is being paid through Razorpay, not UPI');
  if (!UTR_RE.test(input.utr)) throw new HttpError(400, 'VALIDATION_FAILED', 'The UPI reference must be 12 digits', { fields: [{ field: 'utr', message: 'Must be the 12-digit UPI reference (UTR)' }] });
  return tx(() => {
    const t = now();
    let p = one<PaymentRow>("SELECT * FROM payments WHERE booking_id = ? AND method = 'upi' AND status = 'created' ORDER BY created_at DESC LIMIT 1", b.id);
    const due = amountDue(b);
    if (!p) {
      if (due <= 0) throw new HttpError(409, 'NOTHING_DUE', 'Nothing is due on this booking');
      const id = insertPayment(b, { method: 'upi', status: 'created', purpose: b.advance_paise === b.total_paise ? 'full' : 'advance', amountPaise: due });
      p = paymentOr404(id);
    }
    try {
      run("UPDATE payments SET status = 'submitted', reference = ?, proof_note = ?, submitted_at = ?, updated_at = ? WHERE id = ?", input.utr, input.note ?? null, t, t, p.id);
    } catch (e) {
      if (String((e as Error).message).includes('UNIQUE')) throw new HttpError(409, 'UTR_ALREADY_USED', 'This UPI reference has already been submitted');
      throw e;
    }
    logEvent(p.id, user.id, 'submitted', { utr: input.utr });
    const deadline = t + getSettings().verifyMinutesUpi * MIN;
    run('UPDATE bookings SET hold_expires_at = MAX(COALESCE(hold_expires_at, 0), ?), updated_at = ? WHERE id = ?', deadline, t, b.id);
    audit({ id: user.id, role: user.role }, 'payment.submit', 'payment', p.id, { bookingId: b.id }, b.owner_id);
    notify(b.customer_id, 'payment_pending', { ref: b.ref }, b.id);
    return toPayment(paymentOr404(p.id));
  });
}

/** Staff confirm (or reject) a submitted UPI payment after matching it to the bank credit. */
export function verifyUpi(staff: UserRow, paymentId: string, input: { approve: boolean; reason?: string; receivedPaise?: number }): { payment: Payment; outcome: CaptureOutcome | 'rejected' } {
  const p0 = paymentOr404(paymentId);
  accessBooking(staff, p0.booking_id);
  if (staff.role === 'customer') throw new HttpError(403, 'FORBIDDEN', 'Customers cannot verify payments');
  requirePermission(staff, 'verify_payments');
  const actor: Actor = { id: staff.id, role: staff.role };
  return tx(() => {
    const p = paymentOr404(paymentId);
    if (p.method !== 'upi') throw new HttpError(409, 'WRONG_METHOD', 'Only direct UPI payments are verified by hand');
    if (p.status !== 'submitted') throw new HttpError(409, 'BAD_STATE', `This payment is ${p.status}; only a submitted payment can be verified`);
    if (!input.approve) {
      const reason = (input.reason ?? '').trim();
      if (!reason) throw new HttpError(400, 'VALIDATION_FAILED', 'Say why the payment is rejected', { fields: [{ field: 'reason', message: 'Required when rejecting' }] });
      run("UPDATE payments SET status = 'rejected', reject_reason = ?, verified_by = ?, verified_at = ?, updated_at = ? WHERE id = ?", reason, staff.id, now(), now(), p.id);
      logEvent(p.id, staff.id, 'rejected', { reason });
      audit(actor, 'payment.reject', 'payment', p.id, { reason }, p.owner_id);
      const b = bookingOr404(p.booking_id);
      notify(b.customer_id, 'payment_rejected', { ref: b.ref, reason }, b.id);
      return { payment: toPayment(paymentOr404(p.id)), outcome: 'rejected' as const };
    }
    const received = input.receivedPaise ?? p.amount_paise;
    if (!Number.isInteger(received) || received <= 0 || received > p.amount_paise) {
      throw new HttpError(400, 'VALIDATION_FAILED', 'The amount received cannot be more than the amount expected', { fields: [{ field: 'receivedPaise', message: `Between 1 and ${p.amount_paise} paise` }] });
    }
    const r = applyCaptured(p.id, { actor, via: 'staff', amountPaise: received });
    return { payment: toPayment(paymentOr404(p.id)), outcome: r.outcome };
  });
}

// ---------------------------------------------------------------- offline (walk-in, cash at the ground)

export function recordOffline(staff: UserRow, bookingId: string, input: { method: Exclude<PayMethod, 'razorpay' | 'credit'>; amountPaise: number; reference?: string; note?: string }): { payment: Payment; outcome: CaptureOutcome } {
  const b0 = accessBooking(staff, bookingId, 'record_payments');
  if (staff.role === 'customer') throw new HttpError(403, 'FORBIDDEN', 'Customers cannot record payments');
  return tx(() => {
    const b = bookingOr404(b0.id);
    if (b.status !== 'held' && b.status !== 'confirmed') throw new HttpError(409, 'BAD_STATE', `A ${b.status} booking cannot take a payment`);
    const outstanding = b.total_paise - b.paid_paise;
    if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) throw new HttpError(400, 'VALIDATION_FAILED', 'Amount must be a positive whole number of paise', { fields: [{ field: 'amountPaise', message: 'Must be a positive whole number of paise' }] });
    if (input.amountPaise > outstanding) throw new HttpError(409, 'OVERPAYMENT', `Only ${outstanding} paise is outstanding on this booking`);
    if (input.method === 'cash') checkCashReceipt({ ownerId: b.owner_id, customerId: b.customer_id, bookingId: b.id, date: istDate(now()), amountPaise: input.amountPaise });
    const purpose = b.status === 'confirmed' ? 'balance' : input.amountPaise >= b.total_paise ? 'full' : 'advance';
    let id: string;
    try {
      id = insertPayment(b, { method: input.method, status: 'created', purpose, amountPaise: input.amountPaise, reference: input.reference ?? null, recordedBy: staff.id });
    } catch (e) {
      if (String((e as Error).message).includes('UNIQUE')) throw new HttpError(409, 'UTR_ALREADY_USED', 'This UPI reference has already been used');
      throw e;
    }
    if (input.note) run('UPDATE payments SET proof_note = ? WHERE id = ?', input.note, id);
    const r = applyCaptured(id, { actor: { id: staff.id, role: staff.role }, via: 'offline' });
    return { payment: toPayment(paymentOr404(id)), outcome: r.outcome };
  });
}

// ---------------------------------------------------------------- Razorpay client callback + webhooks

/** The browser/app calls this with what Razorpay Checkout returned. The signature proves it came from Razorpay. */
export function verifyRazorpayCheckout(cfg: Config, user: UserRow, input: { orderId: string; paymentId: string; signature: string }): { outcome: CaptureOutcome } {
  const gw = getGateway(cfg);
  if (!gw) throw new HttpError(503, 'PAYMENTS_UNAVAILABLE', 'Online payments are not set up');
  const p = one<PaymentRow>('SELECT * FROM payments WHERE rp_order_id = ?', input.orderId);
  if (!p) throw notFound('No payment is waiting for that order');
  if (user.role === 'customer' ? p.customer_id !== user.id : (user.role !== 'super_admin' && scopeOwnerId(user) !== p.owner_id)) throw notFound('No payment is waiting for that order');
  if (!gw.verifyCheckout(input.orderId, input.paymentId, input.signature)) throw new HttpError(400, 'BAD_SIGNATURE', 'The payment could not be verified');
  return applyCaptured(p.id, { actor: { id: user.id, role: user.role }, via: 'client', rpPaymentId: input.paymentId });
}

export function handleWebhook(cfg: Config, raw: Buffer, headers: { signature?: string; eventId?: string }): { status: number; outcome: string } {
  if (!verifyWebhookSignature(webhookSecretFor(cfg), raw, headers.signature)) return { status: 400, outcome: 'bad_signature' };
  let ev: any;
  try { ev = JSON.parse(raw.toString('utf8')); } catch { return { status: 400, outcome: 'bad_json' }; }
  const eventId = headers.eventId || `sha256:${createHash('sha256').update(raw).digest('hex')}`;
  const type: string = String(ev?.event ?? '');
  return tx(() => {
    if (one('SELECT 1 FROM webhook_events WHERE id = ?', eventId)) return { status: 200, outcome: 'duplicate' };
    const outcome = processWebhookEvent(ev, type);
    // Not ours yet (the payment or refund row may still be being written): do not remember it, and answer 404 so Razorpay delivers it again.
    if (outcome === 'unknown_order' || outcome === 'unknown_refund') return { status: 404, outcome };
    run('INSERT INTO webhook_events(id, type, received_at, outcome) VALUES(?,?,?,?)', eventId, type, now(), outcome);
    return { status: 200, outcome };
  });
}

function processWebhookEvent(ev: any, type: string): string {
  const actor: Actor = { id: null, role: 'razorpay' };
  const pay = ev?.payload?.payment?.entity;
  const findByOrder = (orderId?: string) => (orderId ? one<PaymentRow>('SELECT * FROM payments WHERE rp_order_id = ?', orderId) : undefined);
  switch (type) {
    case 'payment.authorized': {
      const p = findByOrder(pay?.order_id);
      if (!p) return 'unknown_order';
      if (p.status === 'created' || p.status === 'failed') {
        run("UPDATE payments SET status = 'pending', rp_payment_id = COALESCE(rp_payment_id, ?), updated_at = ? WHERE id = ?", pay?.id ?? null, now(), p.id);
        logEvent(p.id, null, 'authorized', { rpPaymentId: pay?.id });
      }
      return 'pending';
    }
    case 'payment.captured':
    case 'order.paid': {
      const p = findByOrder(pay?.order_id ?? ev?.payload?.order?.entity?.id);
      if (!p) return 'unknown_order';
      const amount = Number(pay?.amount);
      if (Number.isFinite(amount) && amount !== p.amount_paise && p.status !== 'captured') {
        run('UPDATE bookings SET needs_review = 1 WHERE id = ?', p.booking_id);
        logEvent(p.id, null, 'amount_mismatch', { expected: p.amount_paise, got: amount });
        audit(actor, 'payment.amount_mismatch', 'payment', p.id, { expected: p.amount_paise, got: amount }, p.owner_id);
        return 'amount_mismatch';
      }
      const r = applyCaptured(p.id, { actor, via: 'webhook', rpPaymentId: pay?.id });
      return r.outcome;
    }
    case 'payment.failed': {
      const p = findByOrder(pay?.order_id);
      if (!p) return 'unknown_order';
      markFailed(p.id, String(pay?.error_description ?? 'payment failed'), actor);
      return 'failed';
    }
    case 'refund.processed':
    case 'refund.failed': {
      const rf = ev?.payload?.refund?.entity;
      const r = one<{ id: string; status: string }>('SELECT id, status FROM refunds WHERE rp_refund_id = ?', rf?.id);
      if (!r) return 'unknown_refund';
      if (type === 'refund.processed') finishRefund(r.id, actor, rf?.id ?? null, null);
      else if (r.status !== 'done') { // Razorpay could not send it: hand it to staff to pay by hand (UPI/bank) and mark done, instead of leaving it stuck
        run("UPDATE refunds SET status = 'pending', mode = 'manual', rp_refund_id = NULL WHERE id = ?", r.id);
        const bk = one<{ owner_id: string }>('SELECT owner_id FROM refunds WHERE id = ?', r.id);
        audit(actor, 'refund.gateway_failed', 'refund', r.id, { to: 'manual' }, bk?.owner_id ?? null);
      }
      return type === 'refund.processed' ? 'refund_done' : 'refund_failed';
    }
    default:
      return 'ignored';
  }
}

// ---------------------------------------------------------------- refunds

export function refundPayment(p: PaymentRow, amountPaise: number, reason: string, actor: Actor): string {
  if (p.method === 'credit') throw new Error('credit payments are returned to the wallet, not refunded');
  const refundable = p.amount_paise - p.refunded_paise;
  if (!Number.isInteger(amountPaise) || amountPaise <= 0 || amountPaise > refundable) throw new HttpError(409, 'REFUND_TOO_LARGE', `At most ${refundable} paise can still be refunded on this payment`);
  const mode = p.method === 'razorpay' && p.rp_payment_id ? 'gateway' : 'manual';
  const id = newId('rfd');
  tx(() => {
    run("INSERT INTO refunds(id, payment_id, booking_id, owner_id, amount_paise, status, mode, reason, created_at) VALUES(?,?,?,?,?,'pending',?,?,?)", id, p.id, p.booking_id, p.owner_id, amountPaise, mode, reason, now());
    const total = p.refunded_paise + amountPaise;
    run('UPDATE payments SET refunded_paise = ?, status = ?, updated_at = ? WHERE id = ?', total, total >= p.amount_paise ? 'refunded' : 'partially_refunded', now(), p.id);
    logEvent(p.id, actor.id, 'refund.requested', { refundId: id, amountPaise, mode, reason });
    audit(actor, 'payment.refund', 'payment', p.id, { refundId: id, amountPaise, mode, reason }, p.owner_id);
  });
  return id;
}

function finishRefund(refundId: string, actor: Actor, rpRefundId: string | null, reference: string | null): void {
  const r = one<{ status: string; booking_id: string; amount_paise: number }>('SELECT status, booking_id, amount_paise FROM refunds WHERE id = ?', refundId);
  if (!r || r.status === 'done') return;
  run("UPDATE refunds SET status = 'done', completed_at = ?, completed_by = ?, rp_refund_id = COALESCE(?, rp_refund_id), reference = COALESCE(?, reference) WHERE id = ?", now(), actor.id, rpRefundId, reference, refundId);
  const b = one<BookingRow>('SELECT * FROM bookings WHERE id = ?', r.booking_id);
  if (b) notify(b.customer_id, 'refund_processed', { ref: b.ref, refundPaise: r.amount_paise }, b.id);
}

/** Sends pending gateway refunds to Razorpay. Failures stay pending and are retried on the next sweep. */
export async function processRefunds(cfg: Config): Promise<{ done: number; failed: number }> {
  const gw = getGateway(cfg);
  if (!gw) return { done: 0, failed: 0 };
  const pending = many<{ id: string; payment_id: string; amount_paise: number }>("SELECT id, payment_id, amount_paise FROM refunds WHERE mode = 'gateway' AND status = 'pending' AND rp_refund_id IS NULL AND approved_at IS NOT NULL ORDER BY created_at LIMIT 50");
  let done = 0, failed = 0;
  for (const r of pending) {
    const p = paymentRow(r.payment_id);
    if (!p?.rp_payment_id) continue;
    try {
      const out = await gw.refund(p.rp_payment_id, r.amount_paise, { refund: r.id });
      if (out.status === 'processed') finishRefund(r.id, SYSTEM, out.id, null);
      run("UPDATE refunds SET rp_refund_id = ?, status = CASE WHEN status = 'done' THEN status ELSE 'processing' END WHERE id = ?", out.id, r.id);
      done++;
    } catch (e) {
      failed++;
      logEvent(p.id, null, 'refund.gateway_error', { refundId: r.id, error: String((e as Error).message).slice(0, 200) });
    }
  }
  return { done, failed };
}

/** Staff paid a UPI/cash refund by hand and records the reference. */
export function completeManualRefund(staff: UserRow, refundId: string, reference: string): RefundRow {
  const r = one<{ id: string; booking_id: string; mode: string; status: string }>('SELECT id, booking_id, mode, status FROM refunds WHERE id = ?', refundId);
  if (!r) throw notFound('Refund not found');
  accessBooking(staff, r.booking_id);
  requirePermission(staff, 'record_payments');
  if (!one('SELECT 1 x FROM refunds WHERE id = ? AND approved_at IS NOT NULL', refundId)) throw new HttpError(409, 'NEEDS_APPROVAL', 'The super admin has to authorise this refund first');
  if (r.mode !== 'manual') throw new HttpError(409, 'WRONG_MODE', 'This refund is sent through the gateway automatically');
  if (r.status === 'done') throw new HttpError(409, 'BAD_STATE', 'This refund is already marked as paid');
  if (!reference.trim()) throw new HttpError(400, 'VALIDATION_FAILED', 'Enter the payout reference', { fields: [{ field: 'reference', message: 'Required' }] });
  tx(() => {
    finishRefund(refundId, { id: staff.id, role: staff.role }, null, reference.trim());
    audit({ id: staff.id, role: staff.role }, 'refund.complete', 'refund', refundId, { reference: reference.trim() }, scopeOwnerId(staff));
  });
  return toRefund(one<any>('SELECT * FROM refunds WHERE id = ?', refundId));
}

export const toRefund = (r: any): RefundRow => ({
  id: r.id, paymentId: r.payment_id, bookingId: r.booking_id, amountPaise: r.amount_paise, status: r.status, mode: r.mode, reference: r.reference,
  reason: r.reason, createdAt: r.created_at, completedAt: r.completed_at, approvedAt: r.approved_at ?? null,
});

/** The super admin authorises a refund (gateway ones are then sent by the next sweep; manual ones can be paid out and marked done). */
export function approveRefund(admin: UserRow, refundId: string): RefundRow {
  if (admin.role !== 'super_admin') throw new HttpError(403, 'FORBIDDEN', 'Only the super admin can authorise a refund');
  const r = one<{ id: string; status: string; approved_at: number | null; owner_id: string; amount_paise: number }>('SELECT id, status, approved_at, owner_id, amount_paise FROM refunds WHERE id = ?', refundId);
  if (!r) throw notFound('Refund not found');
  if (r.approved_at) throw new HttpError(409, 'BAD_STATE', 'This refund is already authorised');
  if (r.status !== 'pending') throw new HttpError(409, 'BAD_STATE', `This refund is ${r.status}`);
  run('UPDATE refunds SET approved_at = ?, approved_by = ? WHERE id = ?', now(), admin.id, refundId);
  logEvent(one<{ p: string }>('SELECT payment_id p FROM refunds WHERE id = ?', refundId)!.p, admin.id, 'refund.approved', { refundId });
  audit({ id: admin.id, role: admin.role }, 'refund.approve', 'refund', refundId, { amountPaise: r.amount_paise }, r.owner_id);
  return toRefund(one<any>('SELECT * FROM refunds WHERE id = ?', refundId));
}

/** The super admin declines: nothing is paid, and the payment goes back to showing the money as not refunded. */
export function declineRefund(admin: UserRow, refundId: string, reason: string): RefundRow {
  if (admin.role !== 'super_admin') throw new HttpError(403, 'FORBIDDEN', 'Only the super admin can decline a refund');
  const r = one<{ id: string; status: string; approved_at: number | null; owner_id: string; amount_paise: number; payment_id: string }>('SELECT id, status, approved_at, owner_id, amount_paise, payment_id FROM refunds WHERE id = ?', refundId);
  if (!r) throw notFound('Refund not found');
  if (r.approved_at || r.status !== 'pending') throw new HttpError(409, 'BAD_STATE', 'Only a refund waiting for authorisation can be declined');
  tx(() => {
    run("UPDATE refunds SET status = 'failed', reason = COALESCE(reason, '') || ' [declined: ' || ? || ']', completed_at = ?, completed_by = ? WHERE id = ?", reason.slice(0, 200), now(), admin.id, refundId);
    const p = one<{ amount_paise: number; refunded_paise: number }>('SELECT amount_paise, refunded_paise FROM payments WHERE id = ?', r.payment_id)!;
    const left = Math.max(p.refunded_paise - r.amount_paise, 0);
    run('UPDATE payments SET refunded_paise = ?, status = ?, updated_at = ? WHERE id = ?', left, left === 0 ? 'captured' : left >= p.amount_paise ? 'refunded' : 'partially_refunded', now(), r.payment_id);
    logEvent(r.payment_id, admin.id, 'refund.declined', { refundId, reason });
    audit({ id: admin.id, role: admin.role }, 'refund.decline', 'refund', refundId, { reason }, r.owner_id);
  });
  return toRefund(one<any>('SELECT * FROM refunds WHERE id = ?', refundId));
}

export function listRefunds(ownerId: string | null, status?: string): RefundRow[] {
  const where: string[] = [];
  const p: string[] = [];
  if (ownerId) { where.push('owner_id = ?'); p.push(ownerId); }
  if (status) { where.push('status = ?'); p.push(status); }
  return many<any>(`SELECT * FROM refunds ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 200`, ...p).map(toRefund);
}

export function listPayments(f: { ownerId?: string | null; status?: string; method?: string; from?: number; to?: number; limit: number; offset: number }): Page<Payment> {
  const where: string[] = [];
  const p: (string | number)[] = [];
  if (f.ownerId) { where.push('owner_id = ?'); p.push(f.ownerId); }
  if (f.status) { where.push('status = ?'); p.push(f.status); }
  if (f.method) { where.push('method = ?'); p.push(f.method); }
  if (f.from !== undefined) { where.push('created_at >= ?'); p.push(f.from); }
  if (f.to !== undefined) { where.push('created_at < ?'); p.push(f.to); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = one<{ n: number }>(`SELECT COUNT(*) n FROM payments ${w}`, ...p)?.n ?? 0;
  const rows = many<any>(`SELECT * FROM payments ${w} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`, ...p, f.limit, f.offset);
  return { items: rows.map(toPayment), total, limit: f.limit, offset: f.offset };
}

export function paymentHistory(paymentId: string) {
  return many<any>('SELECT * FROM payment_events WHERE payment_id = ? ORDER BY at, rowid', paymentId).map((e) => ({ id: e.id, at: e.at, actorId: e.actor_id, event: e.event, detail: e.detail ? JSON.parse(e.detail) : null }));
}

