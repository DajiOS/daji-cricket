import type { Booking, CancelPreview } from '@daji/shared';
import { formatPaise } from '@daji/shared';
import { many, run, tx } from './db.ts';
import { now } from './clock.ts';
import { HttpError } from './errors.ts';
import { audit, type Actor } from './audit.ts';
import { HOUR } from './time.ts';
import { getSettings } from './settings.ts';
import { accessBooking, releaseSiblings, releaseSlots, viewBooking, type BookingRow } from './bookings.ts';
import { hasPermission, type UserRow } from './auth.ts';
import { logEvent, refundPayment, type PaymentRow } from './payments.ts';
import * as credits from './credits.ts';
import { notify, pushStaffOf, venueData } from './notifications.ts';
import { fmtDateTime } from './time.ts';
import { one } from './db.ts';

/**
 * The policy, in one place.
 *  - Free: strictly MORE than `freeCancelHours` before the start. Exactly 24h counts as "within 24 hours".
 *    Refunded to the original payment method it returns `cashRefundPercent` (50) of the cash paid; chosen as account credit it returns everything paid.
 *  - Late (inside the window): no cash refund; `lateCancelCreditPercent` of what was paid becomes credit, the rest is retained.
 *  - A booking that was never paid (still held) is always free: there is nothing to refund or retain.
 */
export function previewCancel(b: BookingRow, opts: { waive?: boolean; at?: number; prefer?: 'refund' | 'credit' } = {}): CancelPreview {
  const at = opts.at ?? now();
  const s = getSettings();
  const msBefore = b.start_at - at;
  const hours = msBefore / HOUR;
  const paid = b.paid_paise;
  const free = opts.waive === true || b.status === 'held' || msBefore > s.freeCancelHours * HOUR;
  if (free) {
    const cashPaid = cashPaidPaise(b.id);
    const creditPaid = paid - cashPaid;
    const pct = s.cashRefundPercent;
    // Back to the original payment method only a share comes back; keeping it as credit returns everything. Staff can waive the rule.
    const cashBack = opts.waive === true || b.status === 'held' ? cashPaid : Math.floor((cashPaid * pct) / 100);
    let refund = cashBack, credit = creditPaid, retained = cashPaid - cashBack;
    if (opts.prefer === 'credit') { credit = paid; refund = 0; retained = 0; }
    const hasChoice = cashPaid > 0 && cashBack < cashPaid;
    const message = paid === 0 ? 'Free cancellation. Nothing was paid.'
      : opts.prefer === 'credit' ? `Free cancellation. ${formatPaise(credit)} goes to your account credit.`
      : hasChoice ? `Free cancellation. Refund to your payment method: ${formatPaise(refund)} (${pct}% of ${formatPaise(cashPaid)}). Or keep the full ${formatPaise(paid)} as account credit for a future booking.`
      : `Free cancellation. ${refund ? `${formatPaise(refund)} will be refunded. ` : ''}${credit ? `${formatPaise(credit)} goes to your account credit.` : ''}`.trim();
    return {
      bookingId: b.id, kind: 'free', hoursBeforeStart: round1(hours), paidPaise: paid, refundPaise: refund, creditPaise: credit, retainedPaise: retained,
      creditOptionPaise: paid, cashRefundPercent: pct, message,
    };
  }
  const credit = Math.floor((paid * s.lateCancelCreditPercent) / 100);
  return {
    bookingId: b.id, kind: 'credit', hoursBeforeStart: round1(hours), paidPaise: paid, refundPaise: 0, creditPaise: credit, retainedPaise: paid - credit,
    message: `Within ${s.freeCancelHours} hours of the start there is no cash refund. ${formatPaise(credit)} will be added to your account credit${paid - credit ? ` and ${formatPaise(paid - credit)} is retained` : ''}.`,
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function cashPaidPaise(bookingId: string): number {
  const rows = many<{ amount_paise: number; refunded_paise: number }>("SELECT amount_paise, refunded_paise FROM payments WHERE booking_id = ? AND status IN ('captured','partially_refunded') AND method <> 'credit'", bookingId);
  return rows.reduce((s, r) => s + r.amount_paise - r.refunded_paise, 0);
}

export function cancelPreviewFor(user: UserRow, bookingId: string, prefer?: 'refund' | 'credit'): CancelPreview {
  const b = accessBooking(user, bookingId);
  ensureCancellable(b);
  return previewCancel(b, { prefer, waive: false });
}

function ensureCancellable(b: BookingRow): void {
  if (b.status !== 'held' && b.status !== 'confirmed') throw new HttpError(409, 'BAD_STATE', `A ${b.status} booking cannot be cancelled`);
  if (b.status === 'confirmed' && b.start_at <= now()) throw new HttpError(409, 'ALREADY_STARTED', 'This booking has already started. If the customer did not come, mark it as a no-show.');
}

export function cancelBooking(user: UserRow, bookingId: string, input: { reason?: string; prefer?: 'refund' | 'credit'; waive?: boolean; offers?: string[] }): { booking: Booking; outcome: CancelPreview } {
  const b0 = accessBooking(user, bookingId, user.role === 'customer' ? undefined : 'manage_bookings');
  const byStaff = user.role !== 'customer';
  if (input.waive && !byStaff) throw new HttpError(403, 'FORBIDDEN', 'Only staff can waive the cancellation rule');
  if (input.waive && !hasPermission(user, 'manage_bookings')) throw new HttpError(403, 'FORBIDDEN', 'This needs the "manage_bookings" permission');
  const actor: Actor = { id: user.id, role: user.role };
  // With money on it, the ground's cancel lets the customer choose (a full refund is always one of the offers), so there is no rule to waive.
  if (byStaff && b0.paid_paise > 0 && input.waive) throw new HttpError(409, 'WAIVE_NOT_APPLICABLE', 'This booking has been paid, so cancelling it offers the customer a full refund or credit instead. Leave "waive" off and choose what to offer.');
  if (byStaff && b0.paid_paise > 0) return ownerCancel(user, b0.id, input.reason, input.offers);
  return tx(() => {
    const b = accessBooking(user, b0.id);
    ensureCancellable(b);
    const out = previewCancel(b, { waive: input.waive === true, prefer: input.prefer });
    const t = now();
    const pays = many<PaymentRow>('SELECT * FROM payments WHERE booking_id = ? ORDER BY created_at, rowid', b.id);

    // Money that is still in flight cannot confirm anything any more; a late capture will be refunded automatically.
    for (const p of pays) if (p.status === 'created' || p.status === 'pending') {
      run("UPDATE payments SET status = 'failed', reject_reason = 'booking cancelled', updated_at = ? WHERE id = ?", t, p.id);
      logEvent(p.id, user.id, 'failed', { reason: 'booking cancelled' });
    } else if (p.status === 'submitted') logEvent(p.id, user.id, 'cancel.while_pending', { note: 'a UTR was sent; staff can still verify it and it is refunded' }); // left as it is so the money can be matched and returned

    let refundTotal = 0;
    if (out.kind === 'free') {
      // Cash goes back to where it came from, newest payment first, unless the customer chose credit.
      let toRefund = out.refundPaise;
      for (const p of [...pays].reverse()) {
        if (toRefund <= 0) break;
        if (p.method === 'credit' || (p.status !== 'captured' && p.status !== 'partially_refunded')) continue;
        const refundable = p.amount_paise - p.refunded_paise;
        const take = Math.min(refundable, toRefund);
        if (take > 0) { refundPayment(p, take, input.reason ? `cancelled: ${input.reason}` : 'free cancellation', actor); toRefund -= take; refundTotal += take; }
      }
      for (const p of pays) if (p.method === 'credit' && p.status === 'captured') run("UPDATE payments SET status = 'refunded', refunded_paise = amount_paise, updated_at = ? WHERE id = ?", t, p.id);
      if (out.creditPaise > 0) credits.issueCredit({ customerId: b.customer_id, ownerId: b.owner_id, amountPaise: out.creditPaise, source: 'restore', bookingId: b.id, note: `Booking ${b.ref} cancelled`, by: user.id, silent: true });
    } else if (out.creditPaise > 0) {
      credits.issueCredit({ customerId: b.customer_id, ownerId: b.owner_id, amountPaise: out.creditPaise, source: 'cancellation', bookingId: b.id, note: `Booking ${b.ref} cancelled inside ${getSettings().freeCancelHours} hours`, by: user.id, silent: true });
    }

    releaseSlots(b.id);
    if (b.status === 'held') releaseSiblings(b);
    run("UPDATE bookings SET status = 'cancelled', cancelled_at = ?, cancel_kind = ?, cancel_reason = ?, cancelled_by = ?, refund_paise = ?, credit_paise = ?, hold_expires_at = NULL, needs_review = 0, updated_at = ? WHERE id = ?",
      t, out.kind, input.reason ?? null, user.id, refundTotal, out.creditPaise, t, b.id);
    for (const p of pays) logEvent(p.id, user.id, 'booking.cancelled', { kind: out.kind });
    audit(actor, 'booking.cancel', 'booking', b.id, { kind: out.kind, refundPaise: refundTotal, creditPaise: out.creditPaise, retainedPaise: out.retainedPaise, waived: !!input.waive, hoursBeforeStart: out.hoursBeforeStart, reason: input.reason ?? null }, b.owner_id);

    const lot = out.creditPaise > 0 ? many<{ expires_at: number }>('SELECT expires_at FROM credit_lots WHERE booking_id = ? ORDER BY issued_at DESC LIMIT 1', b.id)[0] : undefined;
    if (out.kind === 'free') notify(b.customer_id, 'booking_cancelled_free', { ref: b.ref, refundPaise: refundTotal, creditPaise: out.creditPaise }, b.id);
    else notify(b.customer_id, 'booking_cancelled_credit', { ref: b.ref, creditPaise: out.creditPaise, expiresAt: lot?.expires_at }, b.id);
    if (!byStaff && b.paid_paise > 0) {
      const g = one<{ name: string }>('SELECT name FROM grounds WHERE id = ?', b.ground_id), who = one<{ name: string }>('SELECT name FROM users WHERE id = ?', b.customer_id);
      pushStaffOf(b.owner_id, 'booking_cancelled_by_customer', 'Booking cancelled', `${who?.name ?? 'A customer'} cancelled ${b.ref} · ${g?.name ?? ''} · ${fmtDateTime(b.start_at)}. The slot is free again.`, b.id);
    }
    return { booking: viewBooking(b.id), outcome: { ...out, refundPaise: refundTotal } };
  });
}

/**
 * The ground cancels a booking that has money on it (for example a tournament that will not run). The owner must explain why;
 * the customer sees it and then chooses: a full refund, the full amount as account credit, or another slot. Until they choose, nothing moves.
 */
function ownerCancel(user: UserRow, bookingId: string, reasonIn: string | undefined, offersIn?: string[]): { booking: Booking; outcome: CancelPreview } {
  const offers = [...new Set(offersIn?.length ? offersIn : ['refund', 'credit'])];
  if (!offers.every((o) => o === 'refund' || o === 'half' || o === 'credit')) throw new HttpError(400, 'BAD_OFFERS', 'Offer refund, half or credit');
  const reason = (reasonIn ?? '').trim();
  if (reason.length < 10) throw new HttpError(400, 'REASON_REQUIRED', 'Explain to the customer why this booking is being cancelled (at least 10 characters). They will read it.');
  const actor: Actor = { id: user.id, role: user.role };
  return tx(() => {
    const b = accessBooking(user, bookingId, 'manage_bookings');
    ensureCancellable(b);
    const t = now();
    for (const p of many<PaymentRow>('SELECT * FROM payments WHERE booking_id = ?', b.id)) if (p.status === 'created' || p.status === 'pending') {
      run("UPDATE payments SET status = 'failed', reject_reason = 'booking cancelled', updated_at = ? WHERE id = ?", t, p.id);
      logEvent(p.id, user.id, 'failed', { reason: 'booking cancelled' });
    }
    releaseSlots(b.id);
    run("UPDATE bookings SET status = 'cancelled', cancelled_at = ?, cancel_kind = 'free', cancel_reason = ?, cancelled_by = ?, owner_cancelled = 1, resolution = 'awaiting', cancel_offers = ?, refund_paise = 0, credit_paise = 0, hold_expires_at = NULL, needs_review = 0, updated_at = ? WHERE id = ?", t, reason, user.id, offers.join(','), t, b.id);
    audit(actor, 'booking.cancel_by_owner', 'booking', b.id, { paidPaise: b.paid_paise, reason, offers }, b.owner_id);
    const g = one<{ name: string }>('SELECT name FROM grounds WHERE id = ?', b.ground_id);
    notify(b.customer_id, 'booking_cancelled_owner', { ref: b.ref, ground: g?.name, startAt: b.start_at, amountPaise: b.paid_paise, reason, ...venueData(b.ground_id) }, b.id);
    return {
      booking: viewBooking(b.id),
      outcome: { bookingId: b.id, kind: 'owner' as const, hoursBeforeStart: round1((b.start_at - t) / HOUR), paidPaise: b.paid_paise, refundPaise: 0, creditPaise: 0, retainedPaise: 0, creditOptionPaise: b.paid_paise,
        message: `Cancelled. The customer has been told why and can now choose: ${offerText(offers, b.paid_paise)}.` },
    };
  });
}

/** The customer's choice after the ground cancelled their booking: everything back to the payment method, everything as credit, or credit now to book another slot. */
export function resolveOwnerCancel(user: UserRow, bookingId: string, choice: 'refund' | 'half' | 'credit' | 'rebook', opts: { byStaff?: boolean } = {}): { booking: Booking; refundPaise: number; creditPaise: number; rebook: boolean } {
  const b0 = accessBooking(user, bookingId);
  if (!b0.owner_cancelled || b0.status !== 'cancelled' || b0.resolution !== 'awaiting') throw new HttpError(409, 'NOTHING_TO_CHOOSE', 'There is nothing to choose for this booking');
  const offered = b0.cancel_offers ? b0.cancel_offers.split(',') : ['refund', 'credit'];
  if (!opts.byStaff && !offered.includes(choice === 'rebook' ? 'credit' : choice)) throw new HttpError(409, 'NOT_OFFERED', 'The ground did not offer that option for this booking');
  const actor: Actor = { id: user.id, role: user.role };
  return tx(() => {
    const b = accessBooking(user, bookingId);
    const paid = b.paid_paise, cashPaid = cashPaidPaise(b.id), creditPaid = paid - cashPaid;
    const pays = many<PaymentRow>('SELECT * FROM payments WHERE booking_id = ? ORDER BY created_at, rowid', b.id);
    const t = now();
    let refund = 0;
    if (choice === 'refund' || choice === 'half') {
      let toRefund = choice === 'half' ? Math.floor(cashPaid * getSettings().cashRefundPercent / 100) : cashPaid;
      for (const p of [...pays].reverse()) {
        if (toRefund <= 0) break;
        if (p.method === 'credit' || (p.status !== 'captured' && p.status !== 'partially_refunded')) continue;
        const take = Math.min(p.amount_paise - p.refunded_paise, toRefund);
        if (take > 0) { refundPayment(p, take, `cancelled by the ground: ${b.cancel_reason ?? ''}`.slice(0, 200), actor); toRefund -= take; refund += take; }
      }
    }
    const credit = choice === 'refund' || choice === 'half' ? creditPaid : paid;
    for (const p of pays) if (p.method === 'credit' && p.status === 'captured') run("UPDATE payments SET status = 'refunded', refunded_paise = amount_paise, updated_at = ? WHERE id = ?", t, p.id);
    if (credit > 0) credits.issueCredit({ customerId: b.customer_id, ownerId: b.owner_id, amountPaise: credit, source: 'restore', bookingId: b.id, note: `Booking ${b.ref} cancelled by the ground`, by: user.id, silent: true });
    run("UPDATE bookings SET resolution = ?, refund_paise = ?, credit_paise = ?, updated_at = ? WHERE id = ?", choice === 'refund' ? 'refund' : choice === 'half' ? 'half' : 'credit', refund, credit, t, b.id);
    audit(actor, 'booking.cancel_choice', 'booking', b.id, { choice, refundPaise: refund, creditPaise: credit }, b.owner_id);
    const text = choice === 'refund' || choice === 'half' ? `${formatPaise(refund)} is being refunded to your payment method${credit ? ` and ${formatPaise(credit)} is added to your account credit` : ''}.` : `${formatPaise(credit)} is in your account credit${choice === 'rebook' ? '. Pick your new slot now and it will be used automatically' : ''}.`;
    notify(b.customer_id, 'booking_resolved', { ref: b.ref, extra: text }, b.id);
    const g = one<{ name: string }>('SELECT name FROM grounds WHERE id = ?', b.ground_id);
    pushStaffOf(b.owner_id, 'cancel_choice', 'Customer made a choice', `${b.ref} · ${g?.name ?? ''}: ${choice === 'refund' ? 'full refund' : choice === 'half' ? 'partial refund' : choice === 'rebook' ? 'wants another slot (credit)' : 'keeps it as credit'}.`, b.id);
    return { booking: viewBooking(b.id), refundPaise: refund, creditPaise: credit, rebook: choice === 'rebook' };
  });
}

function offerText(offers: string[], paid: number): string {
  const pct = getSettings().cashRefundPercent;
  const parts = [offers.includes('refund') ? `a full refund of ${formatPaise(paid)}` : '', offers.includes('half') ? `${pct}% back to the payment method` : '', offers.includes('credit') ? 'the full amount as account credit, or another slot' : ''].filter(Boolean);
  return parts.join(', ');
}

/** Staff settle a cancelled booking for the customer (who agreed by phone or in person): the money goes back or becomes credit now. */
export function settleForCustomer(staff: UserRow, bookingId: string, choice: 'refund' | 'half' | 'credit') {
  if (staff.role === 'customer') throw new HttpError(403, 'FORBIDDEN', 'Not allowed');
  accessBooking(staff, bookingId, 'manage_bookings');
  return resolveOwnerCancel(staff, bookingId, choice, { byStaff: true });
}

/**
 * Cancels every day of a multi-day booking that has not started, in one go. Days with money on them are cancelled by the ground
 * (the reason is shown to the customer); with `settle` the money is also returned or credited at once, otherwise the customer chooses.
 */
export function cancelBlock(staff: UserRow, seriesId: string, input: { reason?: string; offers?: string[]; settle?: 'refund' | 'half' | 'credit' }) {
  if (staff.role === 'customer') throw new HttpError(403, 'FORBIDDEN', 'Not allowed');
  const days = many<BookingRow>("SELECT * FROM bookings WHERE series_id = ? AND status IN ('held','confirmed') AND start_at > ? ORDER BY series_index", seriesId, now());
  if (!days.length || !one("SELECT 1 FROM booking_series WHERE id = ? AND kind = 'block'", seriesId)) throw new HttpError(404, 'NOT_FOUND', 'No days left to cancel on this multi-day booking');
  accessBooking(staff, days[0]!.id, 'manage_bookings');
  const offers = input.settle ? [input.settle] : input.offers;
  return tx(() => {
    for (const d of days) {
      cancelBooking(staff, d.id, { reason: input.reason, offers });
      if (input.settle && d.paid_paise > 0) resolveOwnerCancel(staff, d.id, input.settle, { byStaff: true });
    }
    // a tournament that was booked this way cannot go ahead without the ground
    run("UPDATE tournaments SET status = 'cancelled', updated_at = ?, updated_by = ? WHERE series_id = ? AND status <> 'completed'", now(), staff.id, seriesId);
    return { cancelled: days.length };
  });
}

/** Settles every day of a cancelled multi-day booking that is still waiting for the customer's choice. */
export function settleBlock(staff: UserRow, seriesId: string, choice: 'refund' | 'half' | 'credit') {
  const days = many<BookingRow>("SELECT * FROM bookings WHERE series_id = ? AND status = 'cancelled' AND resolution = 'awaiting' ORDER BY series_index", seriesId);
  if (!days.length) throw new HttpError(409, 'NOTHING_TO_CHOOSE', 'Nothing is waiting to be settled on this multi-day booking');
  return tx(() => { for (const d of days) settleForCustomer(staff, d.id, choice); return { settled: days.length }; });
}
