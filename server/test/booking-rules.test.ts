import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, dayFromNow, setting, bookAndPay, setNow, HOUR, type Harness, type GroundLite } from './helpers.ts';
import { chargeDue } from '../src/autodebit.ts';
import { run } from '../src/db.ts';

let h: Harness, g: GroundLite, cust: string, staff: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset();
  g = (await grounds(h))[0]!; cust = await h.login('customer'); staff = await h.login('staff1');
});

test('auto-debit charges online bookings only, never a booking the desk made for the customer to pay at the ground', async () => {
  setting({ autoDebitEnabled: true, autoDebitHoursBefore: 24 });
  const me = (await h.get('/api/me', cust)).body.user;
  const s = await h.post('/api/autodebit/start', {}, cust);
  assert.equal((await h.post('/api/autodebit/confirm', { mandateId: s.body.mandateId }, cust)).status, 200);
  const w = await h.post('/api/staff/bookings', { groundId: g.id, date: dayFromNow(5), startTime: '07:00', slots: 1, customer: { name: me.name, phone: me.phone }, payment: { method: 'cash', amountPaise: 0 } }, staff);
  assert.equal(w.status, 201, JSON.stringify(w.body));
  assert.equal(w.body.booking.customerId, me.id, 'the walk-in went to the customer with the mandate');
  const online = await bookAndPay(h, cust, g.id, dayFromNow(5), '17:00');
  setNow(w.body.booking.startAt - 2 * HOUR);
  const r = await chargeDue(h.cfg);
  assert.equal(r.charged, 1, JSON.stringify(r));
  assert.equal((await h.get(`/api/staff/bookings/${w.body.booking.id}`, staff)).body.booking.paidPaise, 0, 'the walk-in was not charged');
  assert.equal((await h.get(`/api/bookings/${online.id}`, cust)).body.booking.balancePaise, 0, 'the online booking was');
});

test('staff cannot "waive" on a paid booking (the ground cancel already offers a full refund); on an unpaid one it still works', async () => {
  const paid = await bookAndPay(h, cust, g.id, dayFromNow(3), '19:00');
  const w = await h.post(`/api/staff/bookings/${paid.id}/cancel`, { reason: 'Ground under repair this week', waive: true }, staff);
  assert.equal(w.status, 409); assert.equal(w.body.error.code, 'WAIVE_NOT_APPLICABLE');
  assert.equal((await h.get(`/api/staff/bookings/${paid.id}/cancel-preview?waive=1`, staff)).status, 409, 'the preview says the same');
  assert.equal((await h.get(`/api/staff/bookings/${paid.id}`, staff)).body.booking.status, 'confirmed', 'nothing was cancelled');
  const c = await h.post(`/api/staff/bookings/${paid.id}/cancel`, { reason: 'Ground under repair this week' }, staff);
  assert.equal(c.status, 200); assert.equal(c.body.outcome.kind, 'owner');

  const unpaid = await h.post('/api/staff/bookings', { groundId: g.id, date: dayFromNow(4), startTime: '07:00', slots: 1, customer: { name: 'No Money', phone: '9866000201' }, payment: { method: 'cash', amountPaise: 0 } }, staff);
  const u = await h.post(`/api/staff/bookings/${unpaid.body.booking.id}/cancel`, { waive: true }, staff);
  assert.equal(u.status, 200, JSON.stringify(u.body)); assert.equal(u.body.booking.status, 'cancelled');
});

test('a multi-day block can run past midnight: 6 pm to 2 am books the evening and the early-morning hours of each day', async () => {
  run("UPDATE grounds SET open_time = '07:00', close_time = '27:00', winter_open = NULL, winter_close = NULL WHERE id = ?", g.id);
  const r = await h.post('/api/staff/bookings/block', { groundId: g.id, fromDate: dayFromNow(90), toDate: dayFromNow(91), startTime: '18:00', endTime: '02:00', totalPaise: 2_000_000, customer: { name: 'Night League', phone: '9890000301' }, payment: { method: 'upi', amountPaise: 2_000_000, reference: 'UTRNIGHT0001' } }, staff);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  for (const b of r.body.bookings) {
    assert.equal(b.slotCount, 8, '6 pm to 2 am');
    assert.equal(b.endAt - b.startAt, 8 * HOUR);
  }
  const same = await h.post('/api/staff/bookings/block', { groundId: g.id, fromDate: dayFromNow(95), toDate: dayFromNow(95), startTime: '18:00', endTime: '18:00', totalPaise: 100_000, customer: { name: 'Zero Hours', phone: '9890000302' }, payment: { method: 'cash', amountPaise: 0 } }, staff);
  assert.equal(same.status, 400, 'start and end cannot be the same');
});
