import { istDate } from './time.ts';
import { assertOpen } from './accounting/store.ts';
import type { Booking, BookingStatus, Page, Payment } from '@daji/shared';
import { many, one, run, registerSchema } from './db.ts';
import { now } from './clock.ts';
import { HttpError, forbidden, notFound } from './errors.ts';
import { audit, type Actor } from './audit.ts';
import { notify, pushStaffOf, venueData } from './notifications.ts';
import { hasPermission, scopeOwnerId, type UserRow } from './auth.ts';
import type { StaffPermission } from '@daji/shared';
import { HOUR, fmtDateTime } from './time.ts';
import { formatPaise } from '@daji/shared';
import { getSettings } from './settings.ts';
import type { GroundRow } from './grounds.ts';

registerSchema('approval-1', `ALTER TABLE bookings ADD COLUMN approval TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE bookings ADD COLUMN resolution TEXT;
ALTER TABLE bookings ADD COLUMN owner_cancelled INTEGER NOT NULL DEFAULT 0;`);
registerSchema('series-1', `CREATE TABLE booking_series(
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, customer_id TEXT NOT NULL, ground_id TEXT NOT NULL,
  frequency TEXT NOT NULL, requested INTEGER NOT NULL, first_booking_id TEXT, created_at INTEGER NOT NULL
);
ALTER TABLE bookings ADD COLUMN series_id TEXT;
ALTER TABLE bookings ADD COLUMN series_index INTEGER;
CREATE INDEX idx_bookings_series ON bookings(series_id);`);
registerSchema('series-kind-1', `ALTER TABLE booking_series ADD COLUMN kind TEXT;
UPDATE booking_series SET kind = 'block' WHERE frequency = 'daily' AND first_booking_id IN (SELECT id FROM bookings WHERE source <> 'online');`);
registerSchema('offers-1', `ALTER TABLE bookings ADD COLUMN cancel_offers TEXT;`);

export interface BookingRow {
  id: string; ref: string; ground_id: string; owner_id: string; customer_id: string; date: string; start_at: number; end_at: number; slot_count: number; format_label: string | null; ball: 'red' | 'white' | 'tennis' | null;
  status: BookingStatus; source: 'online' | 'walk_in' | 'enquiry'; total_paise: number; advance_paise: number; paid_paise: number; pay_method: 'razorpay' | 'upi' | null;
  hold_expires_at: number | null; hold_extensions: number; needs_review: number; confirmed_at: number | null; cancelled_at: number | null;
  cancel_kind: 'free' | 'credit' | 'none' | null; cancel_reason: string | null; cancelled_by: string | null; refund_paise: number; credit_paise: number;
  approval: 'pending' | 'approved'; resolution: 'awaiting' | 'refund' | 'half' | 'credit' | null; owner_cancelled: number; cancel_offers: string | null; promo_code: string | null; discount_paise: number; series_id: string | null; series_index: number | null;
  players: number | null; notes: string | null; enquiry_id: string | null; created_by: string | null; reminded_at: number | null; created_at: number; updated_at: number;
}
type Joined = BookingRow & { ground_name: string; customer_name: string; customer_phone: string | null };

const JOIN = `SELECT b.*, g.name AS ground_name, u.name AS customer_name, u.phone AS customer_phone
  FROM bookings b JOIN grounds g ON g.id = b.ground_id JOIN users u ON u.id = b.customer_id`;

export function toBooking(r: Joined): Booking {
  return {
    id: r.id, ref: r.ref, groundId: r.ground_id, groundName: r.ground_name, ownerId: r.owner_id, customerId: r.customer_id,
    customerName: r.customer_name, customerPhone: r.customer_phone, date: r.date, startAt: r.start_at, endAt: r.end_at, slotCount: r.slot_count, formatLabel: r.format_label ?? null, ball: r.ball ?? null,
    status: r.status, source: r.source, totalPaise: r.total_paise, advancePaise: r.advance_paise, paidPaise: r.paid_paise,
    balancePaise: Math.max(r.total_paise - r.paid_paise, 0), holdExpiresAt: r.hold_expires_at, needsReview: !!r.needs_review,
    cancelKind: r.cancel_kind, approval: r.approval, cancelledByOwner: !!r.owner_cancelled, resolution: r.resolution ?? null, promoCode: r.promo_code ?? null, seriesId: r.series_id ?? null, seriesIndex: r.series_index ?? null, discountPaise: r.discount_paise ?? 0, cancelOffers: (r.cancel_offers ? r.cancel_offers.split(',') : r.owner_cancelled ? ['refund', 'credit'] : []) as Booking['cancelOffers'], cancelReason: r.cancel_reason ?? null, refundPaise: r.refund_paise, creditPaise: r.credit_paise, cancelledAt: r.cancelled_at, confirmedAt: r.confirmed_at,
    players: r.players, notes: r.notes, createdAt: r.created_at,
  };
}

export const bookingRow = (id: string): BookingRow | undefined => one<BookingRow>('SELECT * FROM bookings WHERE id = ?', id);
export function bookingOr404(id: string): BookingRow {
  const b = bookingRow(id);
  if (!b) throw notFound('Booking not found');
  return b;
}
export function loadBooking(id: string): Booking | undefined {
  const r = one<Joined>(`${JOIN} WHERE b.id = ?`, id);
  return r ? toBooking(r) : undefined;
}
export function viewBooking(id: string): Booking {
  const b = loadBooking(id);
  if (!b) throw notFound('Booking not found');
  return b;
}

/**
 * Who may touch a booking. Anyone outside the booking's scope gets 404 (never 403), so existence is not leaked.
 * Customers: their own. Owners: their grounds. Staff: their owner's, with the permission. Admin: all.
 */
export function accessBooking(u: UserRow, id: string, perm?: StaffPermission): BookingRow {
  const b = bookingRow(id);
  if (!b) throw notFound('Booking not found');
  if (u.role === 'super_admin') return b;
  if (u.role === 'customer') { if (b.customer_id !== u.id) throw notFound('Booking not found'); return b; }
  if (scopeOwnerId(u) !== b.owner_id) throw notFound('Booking not found');
  if (perm && !hasPermission(u, perm)) throw forbidden(`This needs the "${perm}" permission`);
  return b;
}

export function advanceFor(g: GroundRow, totalPaise: number, startAt: number, at = now()): number {
  const s = getSettings();
  const mode = g.advance_mode ?? s.advanceMode;
  const value = g.advance_value ?? s.advanceValue;
  if (startAt - at <= s.fullPaymentWithinHours * HOUR) return totalPaise;
  const raw = mode === 'fixed' ? value : Math.ceil((totalPaise * value) / 100);
  return Math.min(Math.max(raw, 100), totalPaise);
}

export function releaseSlots(bookingId: string): void {
  run("DELETE FROM booking_slots WHERE booking_id = ? AND kind = 'booking'", bookingId);
}

/** held → confirmed. Idempotent: returns false when it was already confirmed. */
export function confirmBooking(id: string, actor: Actor, detail: Record<string, unknown> = {}): boolean {
  const b = bookingOr404(id);
  if (b.status === 'confirmed') return false;
  if (b.status !== 'held') throw new HttpError(409, 'BAD_STATE', `A ${b.status} booking cannot be confirmed`);
  const t = now();
  // Online bookings wait for the owner to approve them; the deposit is in and the slot stays held meanwhile.
  const needsApproval = b.source === 'online' && getSettings().requireApproval;
  run("UPDATE bookings SET status = 'confirmed', approval = ?, confirmed_at = ?, hold_expires_at = NULL, needs_review = 0, updated_at = ? WHERE id = ?", needsApproval ? 'pending' : 'approved', t, t, id);
  audit(actor, 'booking.confirm', 'booking', id, { paidPaise: b.paid_paise, approval: needsApproval ? 'pending' : 'approved', ...detail }, b.owner_id);
  const g = one<{ name: string }>('SELECT name FROM grounds WHERE id = ?', b.ground_id);
  const d = { ref: b.ref, ground: g?.name, startAt: b.start_at, amountPaise: b.paid_paise, ...venueData(b.ground_id) };
  if (needsApproval) {
    notify(b.customer_id, 'booking_pending', d, id);
    const who = one<{ name: string }>('SELECT name FROM users WHERE id = ?', b.customer_id);
    pushStaffOf(b.owner_id, 'booking_needs_approval', 'Booking waiting for approval', `${who?.name ?? 'A customer'} · ${g?.name ?? ''} · ${fmtDateTime(b.start_at)} · deposit ${formatPaise(b.paid_paise)}. Open the app to approve.`, id);
  } else notify(b.customer_id, 'booking_confirmed', d, id);
  confirmSiblings(b, needsApproval, t);
  return true;
}

/**
 * The first booking of a repeating series carries the deposit. The later dates are reserved with it (held without a timer);
 * once the first is confirmed they are confirmed too, with their balance due at the ground (or collected by auto-debit).
 */
function confirmSiblings(first: BookingRow, needsApproval: boolean, t: number): void {
  if (!first.series_id || first.series_index !== 0) return;
  const r = run("UPDATE bookings SET status = 'confirmed', approval = ?, confirmed_at = ?, updated_at = ? WHERE series_id = ? AND series_index > 0 AND status = 'held'", needsApproval ? 'pending' : 'approved', t, t, first.series_id);
  if (Number(r.changes) > 0) audit({ id: first.created_by ?? 'system', role: 'customer' }, 'series.confirm', 'booking', first.id, { dates: Number(r.changes) }, first.owner_id);
}

/** The first booking of a series did not go through: the reserved later dates are given back. */
export function releaseSiblings(first: { id: string; series_id: string | null; series_index: number | null }): number {
  if (!first.series_id || first.series_index !== 0) return 0;
  const rows = many<{ id: string }>("SELECT id FROM bookings WHERE series_id = ? AND series_index > 0 AND status = 'held'", first.series_id);
  for (const x of rows) {
    releaseSlots(x.id);
    run("UPDATE bookings SET status = 'expired', hold_expires_at = NULL, updated_at = ? WHERE id = ?", now(), x.id);
  }
  return rows.length;
}

/** The owner (or staff with the right) approves a booking that is waiting. The customer is told it is confirmed. */
export function approveBooking(actor: Actor, id: string): void {
  const b = bookingOr404(id);
  if (b.status !== 'confirmed') throw new HttpError(409, 'BAD_STATE', `Only a booking with its deposit paid can be approved (this one is ${b.status})`);
  if (b.approval === 'approved') return;
  run("UPDATE bookings SET approval = 'approved', updated_at = ? WHERE id = ?", now(), id);
  audit(actor, 'booking.approve', 'booking', id, null, b.owner_id);
  const g = one<{ name: string }>('SELECT name FROM grounds WHERE id = ?', b.ground_id);
  notify(b.customer_id, 'booking_confirmed', { ref: b.ref, ground: g?.name, startAt: b.start_at, amountPaise: b.paid_paise, ...venueData(b.ground_id) }, id);
}

/** Staff acknowledge a booking that was flagged (late payment, extended hold, amount mismatch). */
export function clearReview(actor: Actor, id: string): BookingRow {
  const b = bookingOr404(id);
  if (!b.needs_review) return b;
  run('UPDATE bookings SET needs_review = 0, updated_at = ? WHERE id = ?', now(), id);
  audit(actor, 'booking.review_done', 'booking', id, null, b.owner_id);
  return bookingOr404(id);
}

export function listBookings(f: {
  ownerId?: string | null; customerId?: string; groundId?: string; status?: string; from?: string; to?: string; q?: string; needsReview?: boolean; approval?: 'pending' | 'approved'; resolution?: 'awaiting'; limit: number; offset: number; collapse?: boolean;
}): Page<Booking> {
  const where: string[] = [];
  const p: (string | number)[] = [];
  if (f.ownerId) { where.push('b.owner_id = ?'); p.push(f.ownerId); }
  if (f.customerId) { where.push('b.customer_id = ?'); p.push(f.customerId); }
  if (f.groundId) { where.push('b.ground_id = ?'); p.push(f.groundId); }
  if (f.status) { where.push('b.status = ?'); p.push(f.status); }
  if (f.collapse) {
    // a multi-day block is one row: its first day stands for it, and a date filter looks at every day of the block
    where.push(`NOT (b.series_index > 0 AND b.series_id IN (SELECT id FROM booking_series WHERE kind = 'block'))`);
    if (f.from || f.to) {
      const c: string[] = []; const q: string[] = [];
      if (f.from) { c.push('x.date >= ?'); q.push(f.from); }
      if (f.to) { c.push('x.date <= ?'); q.push(f.to); }
      where.push(`EXISTS (SELECT 1 FROM bookings x WHERE (x.id = b.id OR (b.series_id IS NOT NULL AND x.series_id = b.series_id AND b.series_id IN (SELECT id FROM booking_series WHERE kind = 'block'))) AND ${c.join(' AND ')})`);
      p.push(...q);
    }
  } else {
    if (f.from) { where.push('b.date >= ?'); p.push(f.from); }
    if (f.to) { where.push('b.date <= ?'); p.push(f.to); }
  }
  if (f.needsReview) where.push('b.needs_review = 1');
  if (f.approval) { where.push("b.approval = ? AND b.status = 'confirmed'"); p.push(f.approval); }
  if (f.resolution) { where.push('b.resolution = ?'); p.push(f.resolution); }
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, '\\$&')}%`;
    where.push("(b.ref LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\' OR u.phone LIKE ? ESCAPE '\\')");
    p.push(like, like, like);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = one<{ n: number }>(`SELECT COUNT(*) n FROM bookings b JOIN users u ON u.id = b.customer_id ${w}`, ...p)?.n ?? 0;
  const rows = many<Joined>(`${JOIN} ${w} ORDER BY b.start_at DESC, b.id DESC LIMIT ? OFFSET ?`, ...p, f.limit, f.offset);
  const items = rows.map(toBooking);
  if (f.collapse) for (const b of items) if (b.seriesId) b.block = blockOf(b.seriesId, false);
  return { items, total, limit: f.limit, offset: f.offset };
}

/** A multi-day block as one booking: its dates, the money across every day and (with `days`) each day. Null when the series is not a block. */
export function blockOf(seriesId: string, withDays = true): BlockSummary | null {
  const s = one<{ kind: string | null }>('SELECT kind FROM booking_series WHERE id = ?', seriesId);
  if (!s || s.kind !== 'block') return null;
  const rows = many<BookingRow>('SELECT * FROM bookings WHERE series_id = ? ORDER BY series_index, date', seriesId);
  if (!rows.length) return null;
  const live = rows.filter((r) => r.status !== 'cancelled' && r.status !== 'expired');
  const use = live.length ? live : rows;
  const sum = (k: 'total_paise' | 'paid_paise') => use.reduce((a, r) => a + r[k], 0);
  const total = sum('total_paise'), paid = sum('paid_paise');
  return {
    seriesId, days: use.length, fromDate: use[0]!.date, toDate: use[use.length - 1]!.date, totalPaise: total, paidPaise: paid, balancePaise: Math.max(total - paid, 0),
    ...(withDays ? { items: rows.map((r) => ({ id: r.id, ref: r.ref, date: r.date, startAt: r.start_at, endAt: r.end_at, status: r.status, totalPaise: r.total_paise, paidPaise: r.paid_paise, balancePaise: Math.max(r.total_paise - r.paid_paise, 0) })) } : {}),
  };
}

export function bookingPayments(bookingId: string): Payment[] {
  return many<any>('SELECT * FROM payments WHERE booking_id = ? ORDER BY created_at, rowid', bookingId).map(toPayment);
}

export const toPayment = (r: any): Payment => ({
  id: r.id, bookingId: r.booking_id, method: r.method, status: r.status, purpose: r.purpose, amountPaise: r.amount_paise, refundedPaise: r.refunded_paise,
  reference: r.reference, submittedAt: r.submitted_at, verifiedAt: r.verified_at, verifiedBy: r.verified_by, rejectReason: r.reject_reason, late: !!r.late, createdAt: r.created_at,
});

/** Staff marks a confirmed booking as a no-show: no refund, no credit; the advance stays as income. */
export function markNoShow(actor: Actor, id: string): BookingRow {
  const b = bookingOr404(id);
  if (b.status !== 'confirmed') throw new HttpError(409, 'BAD_STATE', `Only a confirmed booking can be a no-show (this one is ${b.status})`);
  const grace = getSettings().noShowGraceMinutes;
  if (now() < b.start_at + grace * 60_000) throw new HttpError(409, 'TOO_EARLY', `A no-show can be recorded ${grace} minutes after the start time`);
  assertOpen(b.owner_id, istDate(b.start_at)); // a signed-off month does not change
  const t = now();
  run("UPDATE bookings SET status = 'no_show', cancel_kind = 'none', updated_at = ? WHERE id = ?", t, id);
  audit(actor, 'booking.no_show', 'booking', id, { paidPaise: b.paid_paise }, b.owner_id);
  const g = one<{ name: string }>('SELECT name FROM grounds WHERE id = ?', b.ground_id);
  notify(b.customer_id, 'no_show', { ref: b.ref, ground: g?.name, startAt: b.start_at }, id);
  return bookingOr404(id);
}
