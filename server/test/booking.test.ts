import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, hold, bookAndPay, dayFromNow, slotStart, type Harness, type GroundLite } from './helpers.ts';
import { runSweeps } from '../src/jobs.ts';
import { advance, T0, MIN } from './helpers.ts';
import { many, one } from '../src/db.ts';
import { register } from './register.ts';

let h: Harness;
let g: GroundLite;
let cust: string;

before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset();
  g = (await grounds(h))[0]!;
  cust = await h.login('customer');
});

test('public availability lists priced slots for a day', async () => {
  const r = await h.get(`/api/grounds/${g.id}/availability?date=${dayFromNow(2)}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.slots.length, 17); // 06:00-23:00 hourly
  assert.ok(r.body.slots.every((s: any) => s.state === 'available'));
  const eve = r.body.slots.find((s: any) => s.time === '19:00');
  const morning = r.body.slots.find((s: any) => s.time === '09:00');
  assert.equal(eve.pricePaise - morning.pricePaise, 40000, 'evening surcharge applies from 18:00');
});

test('weekend price is used on Saturday and Sunday', async () => {
  // T0 is Wed 14 Oct 2026, so +3 days is Saturday 17 Oct.
  const sat = await h.get(`/api/grounds/${g.id}/availability?date=${dayFromNow(3)}`);
  const wed = await h.get(`/api/grounds/${g.id}/availability?date=${dayFromNow(1)}`);
  const at = (r: any) => r.body.slots.find((s: any) => s.time === '10:00').pricePaise;
  assert.equal(at(wed), 180000);
  assert.equal(at(sat), 220000);
});

test('a hold reserves the slot and quotes the advance (50% by default)', async () => {
  const date = dayFromNow(2);
  const r = await hold(h, cust, g.id, date, '19:00', 2);
  assert.equal(r.status, 201);
  const b = r.body.booking;
  assert.equal(b.status, 'held');
  assert.equal(b.totalPaise, 2 * (180000 + 40000));
  assert.equal(b.advancePaise, b.totalPaise / 2);
  assert.equal(b.holdExpiresAt, T0 + 15 * MIN);
  assert.equal(r.body.payment.mode, 'razorpay');
  const av = await h.get(`/api/grounds/${g.id}/availability?date=${date}`);
  const states = av.body.slots.filter((s: any) => ['19:00', '20:00'].includes(s.time)).map((s: any) => s.state);
  assert.deepEqual(states, ['held', 'held']);
});

test('the same slot cannot be held twice', async () => {
  const date = dayFromNow(2);
  assert.equal((await hold(h, cust, g.id, date, '19:00', 1)).status, 201);
  const second = await register(h, 'Second Player', '9811111111');
  const r = await hold(h, second, g.id, date, '19:00', 1);
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'SLOT_TAKEN');
  // overlap from the other side
  const r2 = await hold(h, second, g.id, date, '18:00', 2);
  assert.equal(r2.status, 409);
});

test('ten simultaneous holds on one slot: exactly one wins', async () => {
  const date = dayFromNow(2);
  const tokens = await Promise.all(Array.from({ length: 10 }, (_, i) => register(h, `Racer ${i}`, `98000000${String(i).padStart(2, '0')}`)));
  const results = await Promise.all(tokens.map((t) => hold(h, t, g.id, date, '20:00', 1)));
  const wins = results.filter((r) => r.status === 201);
  const losses = results.filter((r) => r.status === 409);
  assert.equal(wins.length, 1);
  assert.equal(losses.length, 9);
  const rows = many('SELECT * FROM booking_slots WHERE ground_id = ? AND slot_start = ?', g.id, slotStart(date, '20:00'));
  assert.equal(rows.length, 1);
});

test('the database itself refuses a double booking even if the application check is skipped', async () => {
  const date = dayFromNow(2);
  const r = await hold(h, cust, g.id, date, '07:00', 1);
  const other = await register(h, 'Backstop Player', '9833333333');
  const r2 = await hold(h, other, g.id, date, '09:00', 1);
  // Pretend a bug let a second booking claim the first one's slot: the primary key must say no.
  assert.throws(
    () => one('INSERT INTO booking_slots(booking_id, ground_id, slot_start) VALUES(?,?,?)', r2.body.booking.id, g.id, slotStart(date, '07:00')),
    /UNIQUE|PRIMARY KEY/i,
  );
  assert.equal(many('SELECT 1 FROM booking_slots WHERE booking_id = ?', r.body.booking.id).length, 1);
});

test('bad input is rejected with field-level problems', async () => {
  const r = await hold(h, cust, 'nope', 'not-a-date', '7', 0);
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'VALIDATION_FAILED');
  const fields = r.body.error.details.fields.map((f: any) => f.field).sort();
  assert.deepEqual(fields, ['date', 'slots', 'startTime']);
});

test('past slots, far-future dates and out-of-hours times are refused', async () => {
  assert.equal((await hold(h, cust, g.id, dayFromNow(0), '09:00', 1)).status, 409); // today 09:00 is before 10:00 "now"
  assert.equal((await hold(h, cust, g.id, dayFromNow(400), '10:00', 1)).status, 400);
  assert.equal((await hold(h, cust, g.id, dayFromNow(2), '03:00', 1)).status, 400);
  assert.equal((await hold(h, cust, g.id, dayFromNow(2), '22:00', 3)).status, 400, 'runs past closing time');
});

test('a customer is limited to a few open holds at once', async () => {
  for (const t of ['06:00', '08:00', '10:00']) assert.equal((await hold(h, cust, g.id, dayFromNow(2), t, 1)).status, 201);
  const r = await hold(h, cust, g.id, dayFromNow(2), '12:00', 1);
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'TOO_MANY_HOLDS');
});

test('anonymous users cannot hold; staff accounts cannot book as customers', async () => {
  assert.equal((await hold(h, '', g.id, dayFromNow(2), '10:00')).status, 401);
  const staff = await h.login('staff1');
  assert.equal((await hold(h, staff, g.id, dayFromNow(2), '10:00')).status, 403);
});

test('paying the advance through the demo gateway confirms the booking', async () => {
  const b = await bookAndPay(h, cust, g.id, dayFromNow(2), '19:00', 1);
  assert.equal(b.status, 'confirmed');
  assert.equal(b.paidPaise, b.advancePaise);
  assert.equal(b.balancePaise, b.totalPaise - b.paidPaise);
  assert.equal(b.holdExpiresAt, null);
});

test('a forged checkout signature is rejected and does not confirm anything', async () => {
  const r = await hold(h, cust, g.id, dayFromNow(2), '19:00');
  const orderId = r.body.payment.razorpay!.orderId;
  const bad = await h.post('/api/payments/razorpay/verify', { orderId, paymentId: 'pay_fake', signature: 'a'.repeat(64) }, cust);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'BAD_SIGNATURE');
  const d = await h.get(`/api/bookings/${r.body.booking.id}`, cust);
  assert.equal(d.body.booking.status, 'held');
});

test('verifying the same payment twice is harmless', async () => {
  const r = await hold(h, cust, g.id, dayFromNow(2), '19:00');
  const orderId = r.body.payment.razorpay!.orderId;
  const pay = await h.post('/api/gateway/demo/pay', { orderId }, cust);
  const body = { orderId, paymentId: pay.body.paymentId, signature: pay.body.signature };
  const a = await h.post('/api/payments/razorpay/verify', body, cust);
  const b = await h.post('/api/payments/razorpay/verify', body, cust);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(b.body.booking.paidPaise, r.body.booking.advancePaise, 'money counted once');
  assert.equal(many('SELECT * FROM payments WHERE booking_id = ?', r.body.booking.id).length, 1);
});

test('an unpaid hold is released when the timer runs out and the slot opens again', async () => {
  const date = dayFromNow(2);
  const r = await hold(h, cust, g.id, date, '19:00');
  advance(14 * MIN);
  await runSweeps(h.cfg);
  assert.equal((await h.get(`/api/bookings/${r.body.booking.id}`, cust)).body.booking.status, 'held');
  advance(2 * MIN);
  const out = await runSweeps(h.cfg);
  assert.equal(out.expiry.released, 1);
  assert.equal((await h.get(`/api/bookings/${r.body.booking.id}`, cust)).body.booking.status, 'expired');
  const av = await h.get(`/api/grounds/${g.id}/availability?date=${date}`);
  assert.equal(av.body.slots.find((s: any) => s.time === '19:00').state, 'available');
});

test('customers only see their own bookings; another customer gets 404', async () => {
  const r = await hold(h, cust, g.id, dayFromNow(2), '19:00');
  const other = await register(h, 'Other Person', '9822222222');
  assert.equal((await h.get(`/api/bookings/${r.body.booking.id}`, other)).status, 404);
  assert.equal((await h.get('/api/bookings', other)).body.items.length, 0);
  assert.equal((await h.get('/api/bookings', cust)).body.items.length, 1);
});
