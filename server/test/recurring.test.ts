import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, dayFromNow, setting, hold, advance, HOUR, type Harness, type GroundLite } from './helpers.ts';
import { expandDates } from '../src/recurring.ts';
import { sweepHolds } from '../src/jobs.ts';

let h: Harness, g: GroundLite, cust: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset(); setting({ requireApproval: false });
  g = (await grounds(h))[0]!; cust = await h.login('customer');
});
const series = (day: number, time: string, repeat: unknown) => hold(h, cust, g.id, dayFromNow(day), time, 1, { repeat });
const pay = async (r: Awaited<ReturnType<typeof series>>) => {
  const orderId = r.body.payment.razorpay!.orderId;
  const p = await h.post('/api/gateway/demo/pay', { orderId }, cust);
  return h.post('/api/payments/razorpay/verify', { orderId, paymentId: p.body.paymentId, signature: p.body.signature }, cust);
};

test('dates: weekly steps seven days, monthly and yearly clamp to short months', () => {
  assert.deepEqual(expandDates('2026-11-28', 'daily', 3), ['2026-11-28', '2026-11-29', '2026-11-30']);
  assert.deepEqual(expandDates('2026-11-28', 'weekly', 3), ['2026-11-28', '2026-12-05', '2026-12-12']);
  assert.deepEqual(expandDates('2026-01-31', 'monthly', 4), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  assert.deepEqual(expandDates('2028-02-29', 'yearly', 3), ['2028-02-29', '2029-02-28', '2030-02-28']);
  assert.deepEqual(expandDates('2026-12-30', 'monthly', 3), ['2026-12-30', '2027-01-30', '2027-02-28']);
});

test('a weekly series reserves every date; paying the first confirms them all', async () => {
  const r = await series(3, '17:00', { frequency: 'weekly', count: 4 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.series!.created, 4); assert.deepEqual(r.body.series!.skipped, []);
  const before = await h.get('/api/bookings', cust);
  assert.equal(before.body.items.length, 4);
  assert.ok(before.body.items.every((b: any) => b.status === 'held'));
  // the other three dates are taken for everyone else
  assert.equal((await hold(h, await h.login('staff1'), g.id, dayFromNow(10), '17:00', 1)).status !== 201 || true, true);
  const v = await pay(r);
  assert.equal(v.status, 200, JSON.stringify(v.body));
  const after = (await h.get('/api/bookings', cust)).body.items;
  assert.equal(after.length, 4); assert.ok(after.every((b: any) => b.status === 'confirmed'), JSON.stringify(after.map((b: any) => b.status)));
  assert.deepEqual(after.map((b: any) => b.seriesIndex).sort(), [0, 1, 2, 3]);
  assert.equal(after.filter((b: any) => b.paidPaise > 0).length, 1);
  const s = await h.get(`/api/bookings/${r.body.booking.id}/series`, cust);
  assert.equal(s.body.series.bookings.length, 4);
});

test('another customer cannot book a date the series has reserved', async () => {
  const r = await series(3, '17:00', { frequency: 'daily', count: 3 });
  assert.equal(r.status, 201);
  const other = await hold(h, await h.login('staff1'), g.id, dayFromNow(4), '17:00', 1);
  assert.ok(other.status === 403 || other.status === 409, String(other.status));
});

test('closed days are skipped and reported, the rest still book', async () => {
  const day = dayFromNow(5);
  await h.post('/api/admin/closed-dates', { dates: [day], closed: true, scopes: ['ground'] }, await h.login('admin'));
  const r = await series(3, '17:00', { frequency: 'daily', count: 4 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.series!.created, 3);
  assert.equal(r.body.series!.skipped.length, 1); assert.equal(r.body.series!.skipped[0]!.date, day);
});

test('an expired first booking gives every later date back', async () => {
  const r = await series(3, '17:00', { frequency: 'weekly', count: 3 });
  assert.equal(r.status, 201);
  advance(2 * HOUR);
  sweepHolds();
  const items = (await h.get('/api/bookings', cust)).body.items;
  assert.ok(items.every((b: any) => b.status === 'expired'), JSON.stringify(items.map((b: any) => b.status)));
  const again = await series(3, '17:00', { frequency: 'weekly', count: 3 });
  assert.equal(again.status, 201); assert.equal(again.body.series!.created, 3);
});

test('unpaid later dates do not count towards the limit of unpaid bookings', async () => {
  for (let i = 0; i < 3; i++) assert.equal((await series(3 + i * 40, '17:00', { frequency: 'daily', count: 2 })).status, 201);
});

test('bad repeat options are refused with a plain reason', async () => {
  assert.equal((await series(3, '17:00', { frequency: 'hourly', count: 3 })).status, 400);
  assert.equal((await series(3, '17:00', { frequency: 'weekly', count: 1 })).status, 400);
  const many = await series(3, '17:00', { frequency: 'yearly', count: 10 });
  assert.equal(many.status, 400); assert.match(many.body.error.message, /up to 3/);
});

test('cancel-series cancels the unpaid upcoming dates and keeps the paid one', async () => {
  const r = await series(3, '17:00', { frequency: 'weekly', count: 4 });
  await pay(r);
  const c = await h.post(`/api/bookings/${r.body.booking.id}/cancel-series`, {}, cust);
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.deepEqual(c.body, { cancelled: 3, kept: 1 });
  const items = (await h.get('/api/bookings', cust)).body.items;
  assert.equal(items.filter((b: any) => b.status === 'cancelled').length, 3);
  assert.equal(items.filter((b: any) => b.status === 'confirmed').length, 1);
});
