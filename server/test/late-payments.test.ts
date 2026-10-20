import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, hold, bookAndPay, dayFromNow, sendWebhook, capturedEvent, setting, advance, setNow, MIN, HOUR, type Harness, type GroundLite } from './helpers.ts';
import { runSweeps } from '../src/jobs.ts';
import { issueCredit } from '../src/credits.ts';
import { one } from '../src/db.ts';

let h: Harness;
let g: GroundLite;
let cust: string;
let staff: string;
let customerId: string;

before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset();
  g = (await grounds(h))[0]!;
  cust = await h.login('customer');
  staff = await h.login('staff1');
  customerId = (await h.get('/api/me', cust)).body.user.id;
});

const UTR = (n: number) => String(200000000000 + n);

test('UPI: a customer who paid but came back after the hold ran out can still send the reference, and staff can confirm it', async () => {
  setting({ razorpayEnabled: false });
  const r = await hold(h, cust, g.id, dayFromNow(4), '19:00');
  const id = r.body.booking.id, asked = r.body.payment.amountPaise;
  advance(16 * MIN);
  await runSweeps(h.cfg);
  assert.equal((await h.get(`/api/bookings/${id}`, cust)).body.booking.status, 'expired');

  const sub = await h.post(`/api/bookings/${id}/upi-reference`, { utr: UTR(1) }, cust);
  assert.equal(sub.status, 200, JSON.stringify(sub.body));
  assert.equal(sub.body.payment.status, 'submitted');
  assert.equal(sub.body.payment.amountPaise, asked, 'the amount the customer was asked to send');
  assert.equal((await h.get(`/api/staff/bookings/${id}`, staff)).body.booking.needsReview, true, 'staff are told to look at it');
  assert.equal((await h.post(`/api/bookings/${id}/upi-reference`, { utr: UTR(2) }, cust)).status, 409, 'one reference at a time');

  const v = await h.post(`/api/staff/payments/${sub.body.payment.id}/verify`, { approve: true }, staff);
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.equal(v.body.outcome, 'late_reconfirmed');
  assert.equal(v.body.booking.status, 'confirmed');
});

test('UPI: a late reference for a slot someone else has taken is verified and refunded, not double booked', async () => {
  setting({ razorpayEnabled: false });
  const date = dayFromNow(4);
  const r = await hold(h, cust, g.id, date, '19:00');
  advance(16 * MIN);
  await runSweeps(h.cfg);
  const w = await h.post('/api/staff/bookings', { groundId: g.id, date, startTime: '19:00', slots: 1, customer: { name: 'Walk In', phone: '9866000101' }, payment: { method: 'cash', amountPaise: 0 } }, staff);
  assert.equal(w.status, 201, JSON.stringify(w.body));

  const sub = await h.post(`/api/bookings/${r.body.booking.id}/upi-reference`, { utr: UTR(3) }, cust);
  assert.equal(sub.status, 200);
  const v = await h.post(`/api/staff/payments/${sub.body.payment.id}/verify`, { approve: true }, staff);
  assert.equal(v.body.outcome, 'late_refunded');
  assert.equal(one<{ amount_paise: number }>('SELECT amount_paise FROM refunds WHERE payment_id = ?', sub.body.payment.id)?.amount_paise, r.body.payment.amountPaise);
});

test('a card payment that lands after the hold expired takes the credit again, so the booking is confirmed and nothing is lost', async () => {
  issueCredit({ customerId, ownerId: g.ownerId, amountPaise: 10_000, source: 'goodwill', silent: true });
  const r = await hold(h, cust, g.id, dayFromNow(4), '19:00', 1, { useCredit: true });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.creditAppliedPaise, 10_000);
  const id = r.body.booking.id, card = r.body.payment.amountPaise, advancePaise = r.body.booking.advancePaise;
  assert.equal(card + 10_000, advancePaise);

  advance(16 * MIN);
  await runSweeps(h.cfg);
  assert.equal((await h.get(`/api/bookings/${id}`, cust)).body.booking.status, 'expired');
  assert.equal((await h.get('/api/credits', cust)).body.balancePaise, 10_000, 'the credit went back to the wallet');

  const wh = await sendWebhook(h, capturedEvent(r.body.payment.razorpay!.orderId, card, 'pay_late_1'));
  assert.equal(wh.body.outcome, 'late_reconfirmed');
  const b = (await h.get(`/api/bookings/${id}`, cust)).body.booking;
  assert.equal(b.status, 'confirmed');
  assert.equal(b.paidPaise, advancePaise, 'card plus the credit taken again');
  assert.equal((await h.get('/api/credits', cust)).body.balancePaise, 0);
});

test('a declined refund puts the money back on the booking: the booking no longer shows it as refunded', async () => {
  const b = await bookAndPay(h, cust, g.id, dayFromNow(3), '19:00', 1);
  const c = await h.post(`/api/bookings/${b.id}/cancel`, { reason: 'rain' }, cust);
  assert.equal(c.status, 200);
  assert.ok(c.body.booking.refundPaise > 0);
  const id = (await h.get('/api/staff/refunds?status=pending', staff)).body.items[0].id;
  assert.equal((await h.post(`/api/admin/refunds/${id}/decline`, { reason: 'paid back in cash at the ground' }, await h.login('admin'))).status, 200);
  const after = (await h.get(`/api/bookings/${b.id}`, cust)).body;
  assert.equal(after.booking.refundPaise, 0);
  assert.equal(after.payments[0].refundedPaise, 0);
  const rep = await h.get(`/api/staff/reports/overview?from=${dayFromNow(3)}&to=${dayFromNow(3)}`, await h.login('owner1'));
  assert.equal(rep.body.bookings.cancellations.reduce((a: number, x: any) => a + x.refundPaise, 0), 0);
});

test('reports count a UPI payment on the day staff verified it, not the day it was started', async () => {
  setting({ razorpayEnabled: false });
  // the customer pays on day 0 and staff check it a day later
  const r = await hold(h, cust, g.id, dayFromNow(5), '19:00');
  const sub = await h.post(`/api/bookings/${r.body.booking.id}/upi-reference`, { utr: UTR(9) }, cust);
  assert.equal(sub.status, 200);
  const created = one<{ created_at: number }>('SELECT created_at FROM payments WHERE id = ?', sub.body.payment.id)!.created_at;
  setNow(created + 24 * HOUR);
  const v = await h.post(`/api/staff/payments/${sub.body.payment.id}/verify`, { approve: true }, staff);
  assert.equal(v.status, 200, JSON.stringify(v.body));
  const owner = await h.login('owner1');
  const sum = async (day: number) => ((await h.get(`/api/staff/reports/overview?from=${dayFromNow(day)}&to=${dayFromNow(day)}`, owner)).body.payments.byMethod as any[]).filter((m) => m.method === 'upi').reduce((a, m) => a + m.amountPaise, 0);
  assert.equal(await sum(0), 0, 'nothing was received on the day it was started');
  assert.equal(await sum(1), r.body.payment.amountPaise);
});
