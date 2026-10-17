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

test('multi-day block: 8 days, 7am to 7pm, one agreed total, split across the days; cash over Rs 2 lakh refused', async () => {
  const staff = await h.login('staff1'), g = (await grounds(h))[0]!;
  const body = { groundId: g.id, fromDate: dayFromNow(60), toDate: dayFromNow(67), startTime: '07:00', endTime: '19:00', totalPaise: 25_500_000, customer: { name: 'Camp Organiser', phone: '9890000099' } };
  const cash = await h.post('/api/staff/bookings/block', { ...body, payment: { method: 'cash', amountPaise: 20_000_000 } }, staff);
  assert.equal(cash.status, 422, JSON.stringify(cash.body)); assert.equal(cash.body.error.code, 'CASH_LIMIT_269ST');
  const low = await h.post('/api/staff/bookings/block', { ...body, payment: { method: 'upi', amountPaise: 100, reference: 'UTRLOW000001' } }, staff);
  assert.equal(low.status, 409);
  const ok = await h.post('/api/staff/bookings/block', { ...body, payment: { method: 'upi', amountPaise: 4_000_000, reference: 'UTRBLOCK00001' } }, staff);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.bookings.length, 8);
  assert.equal(ok.body.bookings.reduce((a: number, b: any) => a + b.totalPaise, 0), 25_500_000);
  assert.ok(ok.body.bookings.every((b: any) => b.status === 'confirmed'));
  assert.equal(ok.body.bookings.reduce((a: number, b: any) => a + b.paidPaise, 0), 4_000_000);
  const clash = await h.post('/api/staff/bookings/block', { ...body, fromDate: dayFromNow(66), toDate: dayFromNow(68), customer: { name: 'Other', phone: '9890000098' }, payment: { method: 'upi', amountPaise: 4_000_000, reference: 'UTRBLOCK00002' } }, staff);
  assert.equal(clash.status, 409);                                              // overlaps two booked days: nothing is created
});

test('cash for a multi-day block cannot be split over its days to get round the Rs 2 lakh limit', async () => {
  const staff = await h.login('staff1'), g = (await grounds(h))[0]!;
  const r = await h.post('/api/staff/bookings/block', { groundId: g.id, fromDate: dayFromNow(80), toDate: dayFromNow(81), startTime: '07:00', endTime: '19:00', totalPaise: 25_500_000, customer: { name: 'Camp', phone: '9890000055' }, payment: { method: 'cash', amountPaise: 15_000_000 } }, staff);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const second = r.body.bookings[1].id as string;
  const bad = await h.post(`/api/staff/bookings/${second}/payments`, { method: 'cash', amountPaise: 5_000_000 }, staff);
  assert.equal(bad.status, 422); assert.equal(bad.body.error.code, 'CASH_LIMIT_269ST');
  const ok = await h.post(`/api/staff/bookings/${second}/payments`, { method: 'upi', amountPaise: 5_000_000, reference: 'UTRSPLIT0001' }, staff);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
});

test('a multi-day block is one row in the staff list, opens with every day, and takes one payment for all days', async () => {
  const staff = await h.login('staff1'), g = (await grounds(h))[0]!;
  const r = await h.post('/api/staff/bookings/block', { groundId: g.id, fromDate: dayFromNow(90), toDate: dayFromNow(93), startTime: '07:00', endTime: '19:00', totalPaise: 4_000_000, customer: { name: 'Camp Group', phone: '9890000044' }, payment: { method: 'upi', amountPaise: 1_000_000, reference: 'UTRGROUP0001' } }, staff);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const list = await h.get('/api/staff/bookings?group=1&q=Camp%20Group', staff);
  assert.equal(list.body.total, 1); assert.equal(list.body.items.length, 1);
  const row = list.body.items[0];
  assert.equal(row.block.days, 4); assert.equal(row.block.totalPaise, 4_000_000); assert.equal(row.block.paidPaise, 1_000_000); assert.equal(row.block.balancePaise, 3_000_000);
  assert.equal(row.block.fromDate, dayFromNow(90)); assert.equal(row.block.toDate, dayFromNow(93));
  const inRange = await h.get(`/api/staff/bookings?group=1&from=${dayFromNow(92)}&to=${dayFromNow(92)}&q=Camp%20Group`, staff);
  assert.equal(inRange.body.items.length, 1, 'a date inside the block finds it');
  assert.equal((await h.get('/api/staff/bookings?q=Camp%20Group', staff)).body.items.length, 4, 'without group, every day is its own row (day view, approvals)');
  const detail = await h.get(`/api/staff/bookings/${row.id}`, staff);
  assert.equal(detail.body.block.items.length, 4);
  const pay = await h.post(`/api/staff/bookings/block/${row.block.seriesId}/payments`, { method: 'upi', amountPaise: 3_000_000, reference: 'UTRGROUP0002' }, staff);
  assert.equal(pay.status, 201, JSON.stringify(pay.body));
  assert.equal(pay.body.block.balancePaise, 0); assert.equal(pay.body.block.paidPaise, 4_000_000);
  const over = await h.post(`/api/staff/bookings/block/${row.block.seriesId}/payments`, { method: 'upi', amountPaise: 100, reference: 'UTRGROUP0003' }, staff);
  assert.equal(over.status, 409);
});

test('a block of 7 am to 7 pm on a ground open past midnight books only those 12 hours, not the early-morning slots', async () => {
  const staff = await h.login('staff1'), g = (await grounds(h))[0]!;
  run("UPDATE grounds SET open_time = '07:00', close_time = '27:00', winter_open = NULL, winter_close = NULL WHERE id = ?", g.id);
  const r = await h.post('/api/staff/bookings/block', { groundId: g.id, fromDate: dayFromNow(100), toDate: dayFromNow(101), startTime: '07:00', endTime: '19:00', totalPaise: 2_000_000, customer: { name: 'Late Ground', phone: '9890000033' }, payment: { method: 'upi', amountPaise: 2_000_000, reference: 'UTRLATE00001' } }, staff);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  for (const b of r.body.bookings) assert.equal(b.slotCount, 12, 'only 7 am to 7 pm is booked');
});

test('the dashboard can see the money already booked for the months ahead', async () => {
  const owner = await h.login('owner1'), staff = await h.login('staff1'), g = (await grounds(h))[0]!;
  const r = await h.post('/api/staff/bookings/block', { groundId: g.id, fromDate: dayFromNow(120), toDate: dayFromNow(121), startTime: '07:00', endTime: '19:00', totalPaise: 3_000_000, customer: { name: 'Ahead Group', phone: '9890000022' }, payment: { method: 'upi', amountPaise: 1_000_000, reference: 'UTRAHEAD0001' } }, staff);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const a = await h.get('/api/staff/reports/upcoming', owner);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.totalPaise, 3_000_000); assert.equal(a.body.paidPaise, 1_000_000); assert.equal(a.body.balancePaise, 2_000_000);
  assert.equal((await h.get('/api/staff/reports/upcoming', staff)).status, 403, 'staff without the revenue switch cannot see it');
});

test('a multi-day booking is cancelled on all days in one call, and the refund can be settled at once', async () => {
  const staff = await h.login('staff1'), g = (await grounds(h))[0]!;
  const r = await h.post('/api/staff/bookings/block', { groundId: g.id, fromDate: dayFromNow(110), toDate: dayFromNow(112), startTime: '07:00', endTime: '19:00', totalPaise: 3_000_000, customer: { name: 'Cancel Group', phone: '9890000011' }, payment: { method: 'upi', amountPaise: 1_000_000, reference: 'UTRCANCEL001' } }, staff);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const row = (await h.get('/api/staff/bookings?group=1&q=Cancel%20Group', staff)).body.items[0];
  const sid = row.block.seriesId as string;
  assert.equal((await h.post(`/api/staff/bookings/block/${sid}/cancel`, { settle: 'refund' }, staff)).status, 400, 'a reason is needed when money was paid');
  const c = await h.post(`/api/staff/bookings/block/${sid}/cancel`, { reason: 'The tournament is not going ahead', settle: 'refund' }, staff);
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(c.body.cancelled, 3);
  assert.equal(c.body.block.cancelled, true);
  assert.equal(c.body.block.refundedPaise, 1_000_000);
  assert.equal(c.body.block.awaitingPaise, 0);
  const again = await h.post(`/api/staff/bookings/block/${sid}/cancel`, { reason: 'The tournament is not going ahead' }, staff);
  assert.equal(again.status, 404, 'nothing left to cancel');
});

test('a booking cancelled by the ground that waits for the customer can be settled by staff', async () => {
  const staff = await h.login('staff1'), g = (await grounds(h))[0]!;
  const r = await h.post('/api/staff/bookings', { groundId: g.id, date: dayFromNow(5), startTime: '08:00', slots: 1, customer: { name: 'Settle Me', phone: '9890000012' }, payment: { method: 'upi', amountPaise: 110000, reference: 'UTRSETTLE001' } }, staff);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = r.body.booking.id as string;
  assert.equal((await h.post(`/api/staff/bookings/${id}/cancel`, { reason: 'Rain is forecast all day', offers: ['refund', 'credit'] }, staff)).status, 200);
  const s = await h.post(`/api/staff/bookings/${id}/settle`, { choice: 'refund' }, staff);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal(s.body.refundPaise, 110000);
  assert.equal(s.body.booking.resolution, 'refund');
});
