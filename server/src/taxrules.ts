import { one, registerSchema } from './db.ts';
import { HttpError } from './errors.ts';
import { istDate } from './time.ts';

// India's cash limits, enforced where the money is recorded (not just advised). Each rule has an id that matches the
// compliance register (compliance.ts), so a change in the law is one edit here and one entry in the law-change log.
//   269ST   : a business cannot receive Rs 2,00,000 or more in cash from one person in a day, for one transaction, or for one event.
//   40A(3)  : a cash payment to one person above Rs 10,000 in a day is not an allowed expense (penalty is loss of the deduction).
//   269SS/T : loans, deposits and repayments of them of Rs 20,000 or more must go by account payee cheque, bank transfer or UPI.
// Amounts are paise.

const RUPEE = 100;
// The owner can change a limit in Compliance when the law changes; no new release is needed. These are the starting values.
registerSchema('limit-overrides-1', `CREATE TABLE compliance_values (code TEXT PRIMARY KEY, value_paise INTEGER NOT NULL, set_by TEXT, set_at INTEGER NOT NULL);`);
export const LIMIT_DEFAULTS = { CASH_269ST: 200_000 * RUPEE, CASH_40A3: 10_000 * RUPEE, CASH_269SS: 20_000 * RUPEE } as const;
export type LimitCode = keyof typeof LIMIT_DEFAULTS;
export const limitOf = (code: LimitCode): number => one<{ v: number }>('SELECT value_paise v FROM compliance_values WHERE code = ?', code)?.v ?? LIMIT_DEFAULTS[code];
export const CASH_LIMITS = {
  get receiptPaise() { return limitOf('CASH_269ST'); },    // 269ST: the limit itself is NOT allowed, so reaching it is refused
  get expensePaise() { return limitOf('CASH_40A3'); },     // 40A(3): above this per payee per day needs a written reason
  get loanDepositPaise() { return limitOf('CASH_269SS'); }, // 269SS/269T: this much or more is refused
};

const inr = (p: number): string => `Rs ${(p / RUPEE).toLocaleString('en-IN')}`;
const refuse = (code: string, section: string, msg: string): never => {
  throw new HttpError(422, code, `${msg} (Income-tax Act, section ${section}). Take this by UPI, bank transfer or an account payee cheque instead.`);
};

/** A cash receipt from one customer. `cashSoFar*` are what that customer has already handed over in cash. */
export function checkCashReceipt(i: { ownerId: string; customerId: string; bookingId: string; date: string; amountPaise: number }): void {
  const cash = "method = 'cash' AND status IN ('captured','partially_refunded','refunded')";
  const day = one<{ s: number }>(`SELECT COALESCE(SUM(amount_paise), 0) s FROM payments WHERE owner_id = ? AND customer_id = ? AND ${cash} AND created_at >= ? AND created_at < ?`,
    i.ownerId, i.customerId, istMidnight(i.date), istMidnight(i.date) + 86_400_000)!.s;
  if (day + i.amountPaise >= CASH_LIMITS.receiptPaise) refuse('CASH_LIMIT_269ST', '269ST',
    `This would bring cash from this customer to ${inr(day + i.amountPaise)} today. A business cannot take ${inr(CASH_LIMITS.receiptPaise)} or more in cash in a day`);
  // One event: this booking, plus every day of the same multi-day block or repeat series (a camp over several days is one occasion).
  const event = one<{ s: number }>(`SELECT COALESCE(SUM(amount_paise), 0) s FROM payments WHERE ${cash} AND booking_id IN (
      SELECT id FROM bookings WHERE id = ?1 OR (series_id IS NOT NULL AND series_id = (SELECT series_id FROM bookings WHERE id = ?1)))`, i.bookingId)!.s;
  if (event + i.amountPaise >= CASH_LIMITS.receiptPaise) refuse('CASH_LIMIT_269ST', '269ST',
    `Cash for this one booking would reach ${inr(event + i.amountPaise)}. A business cannot take ${inr(CASH_LIMITS.receiptPaise)} or more in cash for one event`);
}

/** One cash payment taken outside the booking flow (academy fees, memberships): on its own it must stay below the receipt limit. */
export function checkCashSingle(method: string, amountPaise: number): void {
  if (method !== 'cash') return;
  if (amountPaise >= CASH_LIMITS.receiptPaise) refuse('CASH_LIMIT_269ST', '269ST', `A cash payment of ${inr(amountPaise)} is at or above the ${inr(CASH_LIMITS.receiptPaise)} limit for cash received`);
}

/**
 * A cash payment out to one vendor or person. `alreadyPaidToday` is what the same payee already got in cash that day.
 * Above the limit the expense is not deductible unless a rule-6DD exception applies (no bank in the village, payment on a bank
 * holiday and so on), so it is allowed only with a written reason. Returns the reason to keep on the record, or null.
 */
export function checkCashExpense(i: { amountPaise: number; alreadyPaidTodayPaise?: number; what?: string; reason?: unknown }): string | null {
  const total = i.amountPaise + (i.alreadyPaidTodayPaise ?? 0);
  if (total <= CASH_LIMITS.expensePaise) return null;
  const reason = typeof i.reason === 'string' ? i.reason.trim() : '';
  if (reason.length < 5) throw new HttpError(422, 'CASH_REASON_NEEDED',
    `${i.what ?? 'Cash paid'} to one person would total ${inr(total)} in a day, above ${inr(CASH_LIMITS.expensePaise)}. The expense is not allowed in your tax unless an exception in rule 6DD applies (Income-tax Act, section 40A(3)). Pay by UPI or bank transfer, or write the reason this payment falls under an exception.`);
  return reason.slice(0, 300);
}

/** Taking or repaying a loan or deposit in cash. */
export function checkCashLoanDeposit(amountPaise: number, what: string): void {
  if (amountPaise >= CASH_LIMITS.loanDepositPaise) refuse('CASH_LIMIT_269SS', '269SS and 269T',
    `${what} of ${inr(amountPaise)} cannot be taken or repaid in cash; the limit is ${inr(CASH_LIMITS.loanDepositPaise)}`);
}

function istMidnight(date: string): number { return Date.parse(`${date}T00:00:00+05:30`); }
export { istDate };

// Indexes for the reports and dashboards that filter by owner and date.
registerSchema('perf-indexes-1', `
CREATE INDEX IF NOT EXISTS ix_refunds_owner_created ON refunds(owner_id, created_at);
CREATE INDEX IF NOT EXISTS ix_credit_ledger_owner_created ON credit_ledger(owner_id, created_at);
CREATE INDEX IF NOT EXISTS ix_credit_lots_owner_expires ON credit_lots(owner_id, expires_at);
CREATE INDEX IF NOT EXISTS ix_payments_booking ON payments(booking_id);
CREATE INDEX IF NOT EXISTS ix_payments_customer_created ON payments(customer_id, created_at);`);
