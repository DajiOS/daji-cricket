import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, dayFromNow, type Harness } from './helpers.ts';
import { run } from '../src/db.ts';
import { checkCashExpense, checkCashLoanDeposit, CASH_LIMITS } from '../src/taxrules.ts';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); });

test('40A(3): more than Rs 10,000 in cash to one person in a day needs a written reason, exactly Rs 10,000 is fine', () => {
  assert.equal(checkCashExpense({ amountPaise: CASH_LIMITS.expensePaise }), null);
  assert.throws(() => checkCashExpense({ amountPaise: CASH_LIMITS.expensePaise + 1 }), /40A\(3\)/);
  assert.throws(() => checkCashExpense({ amountPaise: 600_000, alreadyPaidTodayPaise: 500_000, reason: 'no' }), /40A\(3\)/);
  assert.equal(checkCashExpense({ amountPaise: 600_000, alreadyPaidTodayPaise: 500_000, reason: 'Village has no bank, rule 6DD' }), 'Village has no bank, rule 6DD');
});

test('269SS/269T: Rs 20,000 or more of loan or deposit in cash is refused', () => {
  checkCashLoanDeposit(CASH_LIMITS.loanDepositPaise - 1, 'A deposit');
  assert.throws(() => checkCashLoanDeposit(CASH_LIMITS.loanDepositPaise, 'A deposit'), /269SS/);
});

test('269ST: cash that would reach Rs 2,00,000 for one customer is refused on a booking, UPI is not', async () => {
  const staff = await h.login('staff1'), g = (await grounds(h))[0]!;
  const r = await h.post('/api/staff/bookings', { groundId: g.id, date: dayFromNow(3), startTime: '08:00', slots: 1, customer: { name: 'Big Cash', phone: '9890000077' }, payment: { method: 'upi', amountPaise: 110000, reference: 'UTR000111222' } }, staff);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = r.body.booking.id as string;
  run('UPDATE bookings SET total_paise = 50000000 WHERE id = ?', id);           // pretend a Rs 5 lakh corporate booking
  const bad = await h.post(`/api/staff/bookings/${id}/payments`, { method: 'cash', amountPaise: 20000000 }, staff);
  assert.equal(bad.status, 422); assert.equal(bad.body.error.code, 'CASH_LIMIT_269ST');
  const fine = await h.post(`/api/staff/bookings/${id}/payments`, { method: 'cash', amountPaise: 19999900 }, staff);
  assert.equal(fine.status, 201, JSON.stringify(fine.body));
  const more = await h.post(`/api/staff/bookings/${id}/payments`, { method: 'cash', amountPaise: 200000 }, staff);
  assert.equal(more.status, 422);                                               // the day's cash is now at the limit
  const online = await h.post(`/api/staff/bookings/${id}/payments`, { method: 'upi', amountPaise: 200000, reference: 'UTR000333444' }, staff);
  assert.equal(online.status, 201, JSON.stringify(online.body));
});
