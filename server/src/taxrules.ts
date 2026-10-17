import { one } from './db.ts';
import { HttpError } from './errors.ts';
import { istDate } from './time.ts';

// India's cash limits, enforced where the money is recorded (not just advised). Each rule has an id that matches the
// compliance register (compliance.ts), so a change in the law is one edit here and one entry in the law-change log.
//   269ST   : a business cannot receive Rs 2,00,000 or more in cash from one person in a day, for one transaction, or for one event.
//   40A(3)  : a cash payment to one person above Rs 10,000 in a day is not an allowed expense (penalty is loss of the deduction).
//   269SS/T : loans, deposits and repayments of them of Rs 20,000 or more must go by account payee cheque, bank transfer or UPI.
// Amounts are paise.

const RUPEE = 100;
export const CASH_LIMITS = {
  receiptPaise: 200_000 * RUPEE,    // 269ST: the limit itself is NOT allowed, so reaching it is refused
  expensePaise: 10_000 * RUPEE,     // 40A(3): more than this per payee per day is refused
  loanDepositPaise: 20_000 * RUPEE, // 269SS/269T: this much or more is refused
} as const;

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
  const event = one<{ s: number }>(`SELECT COALESCE(SUM(amount_paise), 0) s FROM payments WHERE booking_id = ? AND ${cash}`, i.bookingId)!.s;
  if (event + i.amountPaise >= CASH_LIMITS.receiptPaise) refuse('CASH_LIMIT_269ST', '269ST',
    `Cash for this one booking would reach ${inr(event + i.amountPaise)}. A business cannot take ${inr(CASH_LIMITS.receiptPaise)} or more in cash for one event`);
}

/** A cash payment out to one vendor or person. `alreadyPaidToday` is what the same payee already got in cash that day. */
export function checkCashExpense(i: { amountPaise: number; alreadyPaidTodayPaise?: number; what?: string }): void {
  const total = i.amountPaise + (i.alreadyPaidTodayPaise ?? 0);
  if (total > CASH_LIMITS.expensePaise) refuse('CASH_LIMIT_40A3', '40A(3)',
    `${i.what ?? 'Cash paid'} to one person would total ${inr(total)} in a day, above the ${inr(CASH_LIMITS.expensePaise)} limit, and the expense would not be allowed in your tax`);
}

/** Taking or repaying a loan or deposit in cash. */
export function checkCashLoanDeposit(amountPaise: number, what: string): void {
  if (amountPaise >= CASH_LIMITS.loanDepositPaise) refuse('CASH_LIMIT_269SS', '269SS and 269T',
    `${what} of ${inr(amountPaise)} cannot be taken or repaid in cash; the limit is ${inr(CASH_LIMITS.loanDepositPaise)}`);
}

function istMidnight(date: string): number { return Date.parse(`${date}T00:00:00+05:30`); }
export { istDate };
