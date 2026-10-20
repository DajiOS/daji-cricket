import type { Config } from './config.ts';
import { many, one, run, registerSchema, tx } from './db.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { HttpError } from './errors.ts';
import { audit, SYSTEM } from './audit.ts';
import { getSettings } from './settings.ts';
import { HOUR, MIN } from './time.ts';
import { getGateway } from './gateway.ts';
import { applyCaptured, insertPayment, logEvent } from './payments.ts';
import { notify } from './notifications.ts';
import type { BookingRow } from './bookings.ts';
import type { UserRow } from './auth.ts';

// Auto-debit: the customer approves a UPI AutoPay mandate once (a small ₹1 check that is refunded). After that the balance of each confirmed
// booking is charged from their bank a set number of hours before the start. The ground never sees bank details; Razorpay holds the token.
// It is off until the owner switches it on in Booking controls, and it needs Recurring Payments enabled on the Razorpay account.

registerSchema('autodebit-1', `CREATE TABLE autodebit_mandates(
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL CHECK (status IN ('pending','active','cancelled')),
  rp_customer_id TEXT, rp_token_id TEXT, rp_order_id TEXT, max_amount_paise INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX idx_mandates_customer ON autodebit_mandates(customer_id, status);
ALTER TABLE bookings ADD COLUMN autodebit_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN autodebit_last_at INTEGER;`);

export const MAX_ATTEMPTS = 3;
export const RETRY_AFTER_MS = 60 * MIN;
export const LIMITS = { min: 10_000, max: 1_500_000, default: 500_000 }; // ₹100 to ₹15,000 per charge (UPI AutoPay limit without extra authentication)

interface MandateRow { id: string; customer_id: string; status: 'pending' | 'active' | 'cancelled'; rp_customer_id: string | null; rp_token_id: string | null; rp_order_id: string | null; max_amount_paise: number; created_at: number; updated_at: number }

export interface MandateView { status: 'none' | 'pending' | 'active'; maxAmountPaise: number | null; since: number | null; enabled: boolean; hoursBefore: number }

const current = (customerId: string): MandateRow | undefined => one<MandateRow>("SELECT * FROM autodebit_mandates WHERE customer_id = ? AND status IN ('pending','active') ORDER BY created_at DESC LIMIT 1", customerId);

export function mandateView(customerId: string): MandateView {
  const s = getSettings(), m = current(customerId);
  return { status: m ? m.status as 'pending' | 'active' : 'none', maxAmountPaise: m?.max_amount_paise ?? null, since: m?.status === 'active' ? m.updated_at : null, enabled: s.autoDebitEnabled, hoursBefore: s.autoDebitHoursBefore };
}

function needEnabled(): void {
  if (!getSettings().autoDebitEnabled) throw new HttpError(409, 'AUTODEBIT_OFF', 'Auto-debit is not switched on yet');
}

/** Step 1: ask Razorpay for the one-time approval order. The app opens the checkout with it; the customer approves in their UPI app. */
export async function startMandate(cfg: Config, user: UserRow, maxAmountPaise = LIMITS.default) {
  needEnabled();
  if (user.role !== 'customer') throw new HttpError(403, 'FORBIDDEN', 'Auto-debit is for customer accounts');
  if (!Number.isInteger(maxAmountPaise) || maxAmountPaise < LIMITS.min || maxAmountPaise > LIMITS.max) throw new HttpError(400, 'VALIDATION_FAILED', 'The most charged at once must be between ₹100 and ₹15,000', { fields: [{ field: 'maxAmountPaise', message: 'Between 10000 and 1500000 paise' }] });
  if (current(user.id)?.status === 'active') throw new HttpError(409, 'ALREADY_ACTIVE', 'Auto-debit is already set up. Cancel it first to change the limit.');
  const gw = getGateway(cfg);
  if (!gw) throw new HttpError(503, 'PAYMENTS_UNAVAILABLE', 'Online payments are not set up yet.');
  const prev = one<{ rp_customer_id: string | null }>("SELECT rp_customer_id FROM autodebit_mandates WHERE customer_id = ? AND rp_customer_id IS NOT NULL ORDER BY created_at DESC LIMIT 1", user.id);
  const m = await gw.createMandate({ name: user.name, email: user.email ?? null, phone: user.phone ?? null }, prev?.rp_customer_id ?? null, maxAmountPaise);
  const id = newId('mdt'), t = now();
  tx(() => {
    run("UPDATE autodebit_mandates SET status = 'cancelled', updated_at = ? WHERE customer_id = ? AND status = 'pending'", t, user.id);
    run("INSERT INTO autodebit_mandates(id, customer_id, status, rp_customer_id, rp_order_id, max_amount_paise, created_at, updated_at) VALUES(?,?,'pending',?,?,?,?,?)", id, user.id, m.rpCustomerId, m.orderId, maxAmountPaise, t, t);
  });
  return { mandateId: id, razorpay: { keyId: gw.keyId, orderId: m.orderId, customerId: m.rpCustomerId, demo: gw.demo, amountPaise: m.authAmountPaise, recurring: true } };
}

/** Step 2: the customer approved. In demo mode no signature is needed; with the real gateway the checkout signature must verify. */
export async function confirmMandate(cfg: Config, user: UserRow, input: { mandateId: string; paymentId?: string; signature?: string }): Promise<MandateView> {
  needEnabled();
  const m = one<MandateRow>("SELECT * FROM autodebit_mandates WHERE id = ? AND customer_id = ? AND status = 'pending'", input.mandateId, user.id);
  if (!m) throw new HttpError(404, 'NOT_FOUND', 'No auto-debit set-up is waiting for approval');
  const gw = getGateway(cfg);
  if (!gw) throw new HttpError(503, 'PAYMENTS_UNAVAILABLE', 'Online payments are not set up yet.');
  if (!gw.demo) {
    if (!input.paymentId || !input.signature || !gw.verifyCheckout(m.rp_order_id!, input.paymentId, input.signature)) throw new HttpError(400, 'BAD_SIGNATURE', 'The approval could not be verified');
  }
  const token = await gw.tokenForPayment(input.paymentId ?? 'demo');
  const t = now();
  tx(() => {
    run("UPDATE autodebit_mandates SET status = 'cancelled', updated_at = ? WHERE customer_id = ? AND status = 'active'", t, user.id);
    run("UPDATE autodebit_mandates SET status = 'active', rp_token_id = ?, updated_at = ? WHERE id = ?", token, t, m.id);
    audit({ id: user.id, role: user.role }, 'autodebit.enable', 'user', user.id, { maxAmountPaise: m.max_amount_paise }, null);
  });
  return mandateView(user.id);
}

export function cancelMandate(user: UserRow): MandateView {
  const t = now();
  const r = run("UPDATE autodebit_mandates SET status = 'cancelled', updated_at = ? WHERE customer_id = ? AND status IN ('pending','active')", t, user.id);
  if (r.changes > 0) audit({ id: user.id, role: user.role }, 'autodebit.cancel', 'user', user.id, null, null);
  return mandateView(user.id);
}

export interface ChargeResult { charged: number; failed: number; skipped: number }

/**
 * Charges the balance of confirmed online bookings that start soon, for customers with an active mandate. Safe to run every minute.
 * Bookings made at the desk (walk-in, enquiry, multi-day) are left alone: the customer agreed to pay those at the ground.
 */
export async function chargeDue(cfg: Config): Promise<ChargeResult> {
  const res: ChargeResult = { charged: 0, failed: 0, skipped: 0 };
  const s = getSettings();
  if (!s.autoDebitEnabled) return res;
  const gw = getGateway(cfg);
  if (!gw) return res;
  const t = now();
  const rows = many<BookingRow & { autodebit_attempts: number; m_id: string; rp_customer_id: string; rp_token_id: string; max_amount_paise: number }>(
    `SELECT b.*, m.id AS m_id, m.rp_customer_id, m.rp_token_id, m.max_amount_paise FROM bookings b
       JOIN autodebit_mandates m ON m.customer_id = b.customer_id AND m.status = 'active'
      WHERE b.status = 'confirmed' AND b.source = 'online' AND b.total_paise > b.paid_paise AND b.start_at > ? AND b.start_at <= ? AND b.autodebit_attempts < ?
        AND (b.autodebit_last_at IS NULL OR b.autodebit_last_at <= ?)
        AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id AND p.status IN ('created','pending','submitted') AND p.purpose = 'balance')
      ORDER BY b.start_at LIMIT 200`, t, t + s.autoDebitHoursBefore * HOUR, MAX_ATTEMPTS, t - RETRY_AFTER_MS);
  for (const b of rows) {
    const amount = b.total_paise - b.paid_paise;
    const who = one<{ email: string | null; phone: string | null }>('SELECT email, phone FROM users WHERE id = ?', b.customer_id);
    const g = one<{ name: string }>('SELECT name FROM grounds WHERE id = ?', b.ground_id);
    if (amount > b.max_amount_paise) {
      run('UPDATE bookings SET autodebit_attempts = ? WHERE id = ?', MAX_ATTEMPTS, b.id);
      notify(b.customer_id, 'autodebit_failed', { ref: b.ref, ground: g?.name, startAt: b.start_at, amountPaise: amount, reason: 'it is more than the limit you approved' }, b.id);
      audit(SYSTEM, 'autodebit.skip', 'booking', b.id, { amountPaise: amount, limit: b.max_amount_paise }, b.owner_id);
      res.skipped++; continue;
    }
    run('UPDATE bookings SET autodebit_attempts = autodebit_attempts + 1, autodebit_last_at = ? WHERE id = ?', t, b.id);
    try {
      const c = await gw.charge({ rpCustomerId: b.rp_customer_id, tokenId: b.rp_token_id }, { amountPaise: amount, receipt: b.ref, email: who?.email ?? null, phone: who?.phone ?? null, notes: { booking: b.id, ref: b.ref, autodebit: '1' } });
      const pid = insertPayment(b, { method: 'razorpay', status: 'created', purpose: 'balance', amountPaise: amount, rpOrderId: c.orderId });
      logEvent(pid, null, 'autodebit.charge', { orderId: c.orderId, rpPaymentId: c.rpPaymentId });
      audit(SYSTEM, 'autodebit.charge', 'booking', b.id, { amountPaise: amount, instant: c.instant }, b.owner_id);
      if (c.instant) applyCaptured(pid, { actor: SYSTEM, via: 'client', rpPaymentId: c.rpPaymentId });
      res.charged++;
    } catch (e) {
      const reason = e instanceof HttpError ? e.message : 'the bank did not accept it';
      audit(SYSTEM, 'autodebit.fail', 'booking', b.id, { amountPaise: amount, reason, attempt: b.autodebit_attempts + 1 }, b.owner_id);
      notify(b.customer_id, 'autodebit_failed', { ref: b.ref, ground: g?.name, startAt: b.start_at, amountPaise: amount, reason }, b.id);
      res.failed++;
    }
  }
  return res;
}
