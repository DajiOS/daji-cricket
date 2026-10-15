import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  startHarness, grounds, hold, bookAndPay, dayFromNow, sendWebhook, capturedEvent, setting, advance, MIN, webhookSignature, DEMO,
  type Harness, type GroundLite,
} from './helpers.ts';
import { runSweeps } from '../src/jobs.ts';
import { many, one } from '../src/db.ts';
import { register } from './register.ts';

let h: Harness;
let g: GroundLite;
let cust: string;
let staff: string;

before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset();
  g = (await grounds(h))[0]!;
  cust = await h.login('customer');
  staff = await h.login('staff1');
});

const UTR = (n: number) => String(100000000000 + n);

// ------------------------------------------------------------------ the global Razorpay switch

test('with Razorpay switched off, a hold asks for a direct UPI payment instead', async () => {
  const off = await h.put('/api/admin/settings', { razorpayEnabled: false }, await h.login('admin'));
  assert.equal(off.status, 200);
  assert.equal((await h.get('/api/config')).body.razorpayEnabled, false);
  const r = await hold(h, cust, g.id, dayFromNow(2), '19:00');
  assert.equal(r.status, 201);
  assert.equal(r.body.payment.mode, 'upi');
  assert.match(r.body.payment.upi!.uri, /^upi:\/\/pay\?pa=dajicricket%40okhdfcbank/);
  assert.match(r.body.payment.upi!.uri, new RegExp(`am=${r.body.booking.advancePaise / 100}`));
  assert.equal(r.body.payment.razorpay, undefined);
});

test('switching Razorpay on and off needs a super admin', async () => {
  assert.equal((await h.put('/api/admin/settings', { razorpayEnabled: false }, staff)).status, 403);
  assert.equal((await h.put('/api/admin/settings', { razorpayEnabled: false }, cust)).status, 403);
  assert.equal((await h.put('/api/admin/settings', { razorpayEnabled: false }, null)).status, 401);
  assert.equal((await h.get('/api/config')).body.razorpayEnabled, true);
});

test('settings reject values outside their range with field problems', async () => {
  const admin = await h.login('admin');
  const r = await h.put('/api/admin/settings', { advanceMode: 'percent', advanceValue: 150, holdMinutesOnline: 1, nonsense: 1 }, admin);
  assert.equal(r.status, 400);
  const fields = r.body.error.details.fields.map((f: any) => f.field).sort();
  assert.deepEqual(fields, ['advanceValue', 'holdMinutesOnline', 'nonsense']);
});

// ------------------------------------------------------------------ direct UPI with manual verification

test('UPI: customer submits a UTR, staff verify it, booking is confirmed', async () => {
  setting({ razorpayEnabled: false });
  const r = await hold(h, cust, g.id, dayFromNow(2), '19:00');
  const id = r.body.booking.id;

  const sub = await h.post(`/api/bookings/${id}/upi-reference`, { utr: UTR(1) }, cust);
  assert.equal(sub.status, 200);
  assert.equal(sub.body.payment.status, 'submitted');
  assert.equal(sub.body.booking.status, 'held', 'still held until staff verify');
  assert.ok(sub.body.booking.holdExpiresAt >= 2 * 60 * MIN, 'the hold now covers the 120 minute verification window');

  const v = await h.post(`/api/staff/payments/${sub.body.payment.id}/verify`, { approve: true }, staff);
  assert.equal(v.status, 200);
  assert.equal(v.body.outcome, 'confirmed');
  assert.equal(v.body.booking.status, 'confirmed');
  assert.equal(v.body.booking.paidPaise, r.body.booking.advancePaise);
});

test('UPI: the reference must be 12 digits', async () => {
  setting({ razorpayEnabled: false });
  const r = await hold(h, cust, g.id, dayFromNow(2), '19:00');
  for (const bad of ['123', 'abcdefghijkl', '1234567890123', '']) {
    const x = await h.post(`/api/bookings/${r.body.booking.id}/upi-reference`, { utr: bad }, cust);
    assert.equal(x.status, 400, `utr ${JSON.stringify(bad)}`);
    assert.equal(x.body.error.code, 'VALIDATION_FAILED');
  }
});

test('UPI: a UTR already used by someone else is refused', async () => {
  setting({ razorpayEnabled: false });
  const a = await hold(h, cust, g.id, dayFromNow(2), '19:00');
  const other = await register(h, 'Other UPI', '9844444444');
  const b = await hold(h, other, g.id, dayFromNow(2), '20:00');
  assert.equal((await h.post(`/api/bookings/${a.body.booking.id}/upi-reference`, { utr: UTR(5) }, cust)).status, 200);
  const dup = await h.post(`/api/bookings/${b.body.booking.id}/upi-reference`, { utr: UTR(5) }, other);
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, 'UTR_ALREADY_USED');
});

test('UPI: a rejected reference frees its UTR and the customer can try again', async () => {
  setting({ razorpayEnabled: false });
  const r = await hold(h, cust, g.id, dayFromNow(2), '19:00');
  const id = r.body.booking.id;
  const sub = await h.post(`/api/bookings/${id}/upi-reference`, { utr: UTR(7) }, cust);

  const noReason = await h.post(`/api/staff/payments/${sub.body.payment.id}/verify`, { approve: false }, staff);
  assert.equal(noReason.status, 400);
  const rej = await h.post(`/api/staff/payments/${sub.body.payment.id}/verify`, { approve: false, reason: 'No such credit in the bank' }, staff);
  assert.equal(rej.status, 200);
  assert.equal(rej.body.outcome, 'rejected');
  assert.equal(rej.body.booking.status, 'held');

  const again = await h.post(`/api/bookings/${id}/upi-reference`, { utr: UTR(7) }, cust);
  assert.equal(again.status, 200, 'the same UTR can be re-submitted after a rejection');
});

test('UPI: staff cannot verify without the verify_payments permission, and cannot verify another owner\'s payment', async () => {
  setting({ razorpayEnabled: false });
  const r = await hold(h, cust, g.id, dayFromNow(2), '19:00');
  const sub = await h.post(`/api/bookings/${r.body.booking.id}/upi-reference`, { utr: UTR(9) }, cust);
  const admin = await h.login('admin');

  // a staff member without the permission
  const created = await h.post('/api/staff/team', { name: 'Limited Staff', email: 'limited@daji.test', phone: '9855555555', password: 'Limited@12345', permissions: ['manage_bookings'] }, await h.login('owner1'));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const lim = (await h.post('/api/auth/login', { email: 'limited@daji.test', password: 'Limited@12345' })).body.token;
  assert.equal((await h.post(`/api/staff/payments/${sub.body.payment.id}/verify`, { approve: true }, lim)).status, 403);

  // the other owner cannot even see it
  const owner2 = await h.login('owner2');
  assert.equal((await h.post(`/api/staff/payments/${sub.body.payment.id}/verify`, { approve: true }, owner2)).status, 404);
  assert.ok(admin);
});

test('UPI: if the hold timer runs out while a payment is submitted, the hold is extended and flagged for review, not released', async () => {
  setting({ razorpayEnabled: false, verifyMinutesUpi: 15 });
  const r = await hold(h, cust, g.id, dayFromNow(2), '19:00');
  const id = r.body.booking.id;
  await h.post(`/api/bookings/${id}/upi-reference`, { utr: UTR(11) }, cust);

  advance(16 * MIN);
  const out = await runSweeps(h.cfg);
  assert.equal(out.expiry.extended, 1);
  assert.equal(out.expiry.released, 0);
  const b = (await h.get(`/api/bookings/${id}`, cust)).body.booking;
  assert.equal(b.status, 'held');
  assert.equal(b.needsReview, true);

  // two grace extensions at most (10 minutes each), then it is released
  advance(11 * MIN);
  assert.equal((await runSweeps(h.cfg)).expiry.extended, 1, 'second extension');
  advance(11 * MIN);
  const last = await runSweeps(h.cfg);
  assert.equal(last.expiry.extended, 0, 'no third extension');
  assert.equal(last.expiry.released, 1);
  const after = (await h.get(`/api/bookings/${id}`, cust)).body.booking;
  assert.equal(after.status, 'expired');
  assert.equal(after.needsReview, true, 'staff are told money may still arrive for this one');
});

test('UPI: staff verifying after the hold was released re-confirms if the slot is still free', async () => {
  setting({ razorpayEnabled: false });
  const date = dayFromNow(2);
  const r = await hold(h, cust, g.id, date, '19:00');
  const id = r.body.booking.id;
  const sub = await h.post(`/api/bookings/${id}/upi-reference`, { utr: UTR(13) }, cust);
  setting({ maxHoldExtensions: 0 });
  advance(121 * MIN);
  await runSweeps(h.cfg);
  assert.equal((await h.get(`/api/bookings/${id}`, cust)).body.booking.status, 'expired');

  const v = await h.post(`/api/staff/payments/${sub.body.payment.id}/verify`, { approve: true }, staff);
  assert.equal(v.status, 200);
  assert.equal(v.body.outcome, 'late_reconfirmed');
  assert.equal(v.body.booking.status, 'confirmed');
});

test('UPI: staff verifying after the slot went to someone else triggers a refund instead of a double booking', async () => {
  setting({ razorpayEnabled: false, maxHoldExtensions: 0 });
  const date = dayFromNow(2);
  const r = await hold(h, cust, g.id, date, '19:00');
  const sub = await h.post(`/api/bookings/${r.body.booking.id}/upi-reference`, { utr: UTR(15) }, cust);
  advance(121 * MIN);
  await runSweeps(h.cfg);

  const other = await register(h, 'Next Player', '9866666666');
  const mine = await hold(h, other, g.id, date, '19:00');
  assert.equal(mine.status, 201, 'the slot was free again');

  const v = await h.post(`/api/staff/payments/${sub.body.payment.id}/verify`, { approve: true }, staff);
  assert.equal(v.status, 200);
  assert.equal(v.body.outcome, 'late_refunded');
  assert.equal(v.body.booking.status, 'expired');
  const refund = one<{ status: string; mode: string; amount_paise: number }>("SELECT * FROM refunds WHERE payment_id = ?", sub.body.payment.id);
  assert.equal(refund?.amount_paise, r.body.booking.advancePaise);
  assert.equal(refund?.mode, 'manual', 'UPI money is returned by hand');
  assert.equal(many('SELECT 1 FROM booking_slots WHERE ground_id = ? AND booking_id = ?', g.id, mine.body.booking.id).length, 1);
});

// ------------------------------------------------------------------ webhooks

test('webhook: payment.captured confirms the booking even if the customer never came back', async () => {
  const r = await hold(h, cust, g.id, dayFromNow(2), '19:00');
  const orderId = r.body.payment.razorpay!.orderId;
  const w = await sendWebhook(h, capturedEvent(orderId, r.body.booking.advancePaise), { eventId: 'evt_1' });
  assert.equal(w.status, 200);
  assert.equal(w.body.outcome, 'confirmed');
  assert.equal((await h.get(`/api/bookings/${r.body.booking.id}`, cust)).body.booking.status, 'confirmed');
});

test('webhook: the same event delivered twice is applied once', async () => {
  const r = await hold(h, cust, g.id, dayFromNow(2), '19:00');
  const ev = capturedEvent(r.body.payment.razorpay!.orderId, r.body.booking.advancePaise);
  const a = await sendWebhook(h, ev, { eventId: 'evt_same' });
  const b = await sendWebhook(h, ev, { eventId: 'evt_same' });
  assert.equal(a.body.outcome, 'confirmed');
  assert.equal(b.body.outcome, 'duplicate');
  assert.equal((await h.get(`/api/bookings/${r.body.booking.id}`, cust)).body.booking.paidPaise, r.body.booking.advancePaise);
});

test('webhook: a replay without an event id is de-duplicated by body hash', async () => {
  const r = await hold(h, cust, g.id, dayFromNow(2), '19:00');
  const ev = capturedEvent(r.body.payment.razorpay!.orderId, r.body.booking.advancePaise);
  assert.equal((await sendWebhook(h, ev)).body.outcome, 'confirmed');
  assert.equal((await sendWebhook(h, ev)).body.outcome, 'duplicate');
});

test('webhook: wrong or missing signature is rejected and changes nothing', async () => {
  const r = await hold(h, cust, g.id, dayFromNow(2), '19:00');
  const ev = capturedEvent(r.body.payment.razorpay!.orderId, r.body.booking.advancePaise);
  assert.equal((await sendWebhook(h, ev, { secret: 'not-the-secret' })).status, 400);
  assert.equal((await sendWebhook(h, ev, { signature: '' })).status, 400);
  assert.equal((await h.get(`/api/bookings/${r.body.booking.id}`, cust)).body.booking.status, 'held');
  assert.equal(many('SELECT 1 FROM webhook_events').length, 0);
});

test('webhook: the signature covers the exact bytes — re-serialised JSON fails', async () => {
  const r = await hold(h, cust, g.id, dayFromNow(2), '19:00');
  const ev = capturedEvent(r.body.payment.razorpay!.orderId, r.body.booking.advancePaise);
  
  const pretty = Buffer.from(JSON.stringify(ev, null, 2));
  const sigOfCompact = webhookSignature(DEMO.webhookSecret, Buffer.from(JSON.stringify(ev)));
  const res = await h.call('POST', '/api/webhooks/razorpay', { raw: pretty, headers: { 'x-razorpay-signature': sigOfCompact } });
  assert.equal(res.status, 400);
});

test('webhook: an amount that does not match flags the booking for review instead of confirming it', async () => {
  const r = await hold(h, cust, g.id, dayFromNow(2), '19:00');
  const w = await sendWebhook(h, capturedEvent(r.body.payment.razorpay!.orderId, 100), { eventId: 'evt_short' });
  assert.equal(w.body.outcome, 'amount_mismatch');
  const b = (await h.get(`/api/bookings/${r.body.booking.id}`, cust)).body.booking;
  assert.equal(b.status, 'held');
  assert.equal(b.needsReview, true);
});

test('webhook: payment.failed marks the payment failed and keeps the hold until it runs out', async () => {
  const r = await hold(h, cust, g.id, dayFromNow(2), '19:00');
  const orderId = r.body.payment.razorpay!.orderId;
  const w = await sendWebhook(h, { event: 'payment.failed', payload: { payment: { entity: { id: 'pay_f', order_id: orderId, error_description: 'card declined' } } } }, { eventId: 'evt_f' });
  assert.equal(w.body.outcome, 'failed');
  const d = await h.get(`/api/bookings/${r.body.booking.id}`, cust);
  assert.equal(d.body.payments[0].status, 'failed');
  assert.equal(d.body.booking.status, 'held');
});

test('webhook: unknown orders and unknown events are acknowledged, not errors', async () => {
  const a = await sendWebhook(h, capturedEvent('order_nobody', 100), { eventId: 'evt_u1' });
  assert.equal(a.status, 200);
  assert.equal(a.body.outcome, 'unknown_order');
  const b = await sendWebhook(h, { event: 'subscription.charged', payload: {} }, { eventId: 'evt_u2' });
  assert.equal(b.body.outcome, 'ignored');
});

test('webhook after the hold was released: the late payment re-confirms the booking when the slot is free', async () => {
  const date = dayFromNow(2);
  const r = await hold(h, cust, g.id, date, '19:00');
  const orderId = r.body.payment.razorpay!.orderId;
  advance(16 * MIN);
  await runSweeps(h.cfg);
  assert.equal((await h.get(`/api/bookings/${r.body.booking.id}`, cust)).body.booking.status, 'expired');

  const w = await sendWebhook(h, capturedEvent(orderId, r.body.booking.advancePaise), { eventId: 'evt_late' });
  assert.equal(w.body.outcome, 'late_reconfirmed');
  const b = (await h.get(`/api/bookings/${r.body.booking.id}`, cust)).body.booking;
  assert.equal(b.status, 'confirmed');
  assert.equal(b.needsReview, true, 'staff are told a late payment was reconciled');
  const staff = await h.login('staff1');
  const ack = await h.post(`/api/staff/bookings/${r.body.booking.id}/review-done`, {}, staff);
  assert.equal(ack.status, 200);
  assert.equal(ack.body.booking.needsReview, false);
  assert.equal((await h.post(`/api/staff/bookings/${r.body.booking.id}/review-done`, {}, await h.login('owner2'))).status, 404, 'another owner cannot touch it');
});

test('webhook after the hold was released and the slot re-booked: the money is refunded automatically', async () => {
  const date = dayFromNow(2);
  const r = await hold(h, cust, g.id, date, '19:00');
  const orderId = r.body.payment.razorpay!.orderId;
  advance(16 * MIN);
  await runSweeps(h.cfg);
  const other = await register(h, 'Slot Thief', '9877777777');
  assert.equal((await hold(h, other, g.id, date, '19:00')).status, 201);

  const w = await sendWebhook(h, capturedEvent(orderId, r.body.booking.advancePaise), { eventId: 'evt_late2' });
  assert.equal(w.body.outcome, 'late_refunded');
  assert.equal((await h.get(`/api/bookings/${r.body.booking.id}`, cust)).body.booking.status, 'expired');
  const rf = many<{ amount_paise: number; status: string }>('SELECT * FROM refunds WHERE booking_id = ?', r.body.booking.id);
  assert.equal(rf.length, 1);
  assert.equal(rf[0]!.amount_paise, r.body.booking.advancePaise);
});

test('paying the same order twice with different Razorpay payment ids refunds the extra one', async () => {
  const r = await hold(h, cust, g.id, dayFromNow(2), '19:00');
  const orderId = r.body.payment.razorpay!.orderId;
  const amt = r.body.booking.advancePaise;
  assert.equal((await sendWebhook(h, capturedEvent(orderId, amt, 'pay_one'), { eventId: 'evt_a' })).body.outcome, 'confirmed');
  assert.equal((await sendWebhook(h, capturedEvent(orderId, amt, 'pay_two'), { eventId: 'evt_b' })).body.outcome, 'extra_refunded');
  const b = (await h.get(`/api/bookings/${r.body.booking.id}`, cust)).body.booking;
  assert.equal(b.paidPaise, amt, 'only one payment counts');
  assert.equal(many('SELECT 1 FROM refunds WHERE booking_id = ?', r.body.booking.id).length, 1);
});

// ------------------------------------------------------------------ offline payments by staff

test('staff record the balance in cash at the ground', async () => {
  const b = await bookAndPay(h, cust, g.id, dayFromNow(2), '19:00', 1);
  const bal = b.totalPaise - b.paidPaise;
  const r = await h.post(`/api/staff/bookings/${b.id}/payments`, { method: 'cash', amountPaise: bal }, staff);
  assert.equal(r.status, 201);
  assert.equal(r.body.booking.paidPaise, b.totalPaise);
  assert.equal(r.body.booking.balancePaise, 0);
});

test('staff cannot record more than is outstanding, or a non-positive amount', async () => {
  const b = await bookAndPay(h, cust, g.id, dayFromNow(2), '19:00', 1);
  const over = await h.post(`/api/staff/bookings/${b.id}/payments`, { method: 'cash', amountPaise: b.totalPaise }, staff);
  assert.equal(over.status, 409);
  assert.equal(over.body.error.code, 'OVERPAYMENT');
  assert.equal((await h.post(`/api/staff/bookings/${b.id}/payments`, { method: 'cash', amountPaise: 0 }, staff)).status, 400);
  assert.equal((await h.post(`/api/staff/bookings/${b.id}/payments`, { method: 'cheque', amountPaise: 100 }, staff)).status, 400);
});

test('a walk-in booking is created and paid in one step and takes the slot', async () => {
  const date = dayFromNow(1);
  const body = { groundId: g.id, date, startTime: '16:00', slots: 2, customer: { name: 'Walk In', phone: '9890000001' }, payment: { method: 'cash', amountPaise: 360000 } };
  const r = await h.post('/api/staff/bookings', body, staff);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.booking.status, 'confirmed');
  assert.equal(r.body.booking.source, 'walk_in');
  assert.equal(r.body.booking.paidPaise, 360000);
  const again = await h.post('/api/staff/bookings', { ...body, customer: { name: 'Someone Else', phone: '9890000002' } }, staff);
  assert.equal(again.status, 409);
});

test('a walk-in for an existing phone number reuses that customer', async () => {
  const mk = (startTime: string) => h.post('/api/staff/bookings', { groundId: g.id, date: dayFromNow(1), startTime, slots: 1, customer: { name: 'Repeat Walker', phone: '9890000003' }, payment: { method: 'cash', amountPaise: 180000 } }, staff);
  const a = await mk('08:00');
  const b = await mk('10:00');
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(a.body.booking.customerId, b.body.booking.customerId);
});

// ------------------------------------------------------------------ refunds

test('gateway refunds are queued and the sweep hands them to the gateway', async () => {
  const b = await bookAndPay(h, cust, g.id, dayFromNow(3), '19:00', 1);
  const c = await h.post(`/api/bookings/${b.id}/cancel`, { reason: 'rain' }, cust);
  assert.equal(c.status, 200);
  assert.equal(c.body.outcome.refundPaise, b.paidPaise / 2); // a refund to the payment method returns 50%
  const q = await h.get('/api/staff/refunds?status=pending', staff);
  assert.equal(q.body.items.length, 1);
  assert.equal(q.body.items[0].mode, 'gateway');

  const out = await runSweeps(h.cfg);
  assert.equal(out.refundsProcessed, 1);
  const after = await h.get('/api/staff/refunds?status=done', staff);
  assert.equal(after.body.items.length, 1);
  assert.equal((await h.get(`/api/bookings/${b.id}`, cust)).body.payments[0].status, 'partially_refunded');
});

test('manual refunds (UPI money) stay open until staff record the transfer reference', async () => {
  setting({ razorpayEnabled: false });
  const r = await hold(h, cust, g.id, dayFromNow(3), '19:00');
  const sub = await h.post(`/api/bookings/${r.body.booking.id}/upi-reference`, { utr: UTR(21) }, cust);
  await h.post(`/api/staff/payments/${sub.body.payment.id}/verify`, { approve: true }, staff);
  assert.equal((await h.post(`/api/bookings/${r.body.booking.id}/cancel`, {}, cust)).status, 200);

  const open = (await h.get('/api/staff/refunds?status=pending', staff)).body.items;
  assert.equal(open.length, 1);
  assert.equal(open[0].mode, 'manual');
  await runSweeps(h.cfg);
  assert.equal((await h.get('/api/staff/refunds?status=pending', staff)).body.items.length, 1, 'the sweep never touches manual refunds');

  assert.equal((await h.post(`/api/staff/refunds/${open[0].id}/complete`, {}, staff)).status, 400, 'a reference is required');
  const done = await h.post(`/api/staff/refunds/${open[0].id}/complete`, { reference: 'UTR998877665544' }, staff);
  assert.equal(done.status, 200);
  assert.equal(done.body.status, 'done');
  assert.equal((await h.post(`/api/staff/refunds/${open[0].id}/complete`, { reference: 'again' }, staff)).status, 409);
});
