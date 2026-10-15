import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, dayFromNow, setting, bookAndPay, advance, setNow, HOUR, type Harness, type GroundLite } from './helpers.ts';
import { chargeDue } from '../src/autodebit.ts';
import { db } from '../src/db.ts';

let h: Harness, g: GroundLite, cust: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset(); setting({ requireApproval: false, autoDebitEnabled: true, autoDebitHoursBefore: 24 });
  g = (await grounds(h))[0]!; cust = await h.login('customer');
});
const enable = async (max?: number) => {
  const s = await h.post('/api/autodebit/start', max ? { maxAmountPaise: max } : {}, cust);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const c = await h.post('/api/autodebit/confirm', { mandateId: s.body.mandateId }, cust);
  assert.equal(c.status, 200, JSON.stringify(c.body));
  return c.body;
};
// a booking made well ahead pays only the advance; the balance is left for auto-debit
let startAt = 0;
const bookFar = async (days = 5) => { const b = await bookAndPay(h, cust, g.id, dayFromNow(days), '17:00'); startAt = b.startAt; return b; };
// moves the clock to 22 hours before the start, inside the 24-hour window
const toWindow = () => setNow(startAt - 22 * HOUR);

test('off by default for the platform: customers cannot start it', async () => {
  setting({ autoDebitEnabled: false });
  const s = await h.post('/api/autodebit/start', {}, cust);
  assert.equal(s.status, 409); assert.equal(s.body.error.code, 'AUTODEBIT_OFF');
  assert.equal((await h.get('/api/autodebit', cust)).body.enabled, false);
});

test('approve once, then the balance is charged inside the window and the booking is fully paid', async () => {
  const b = await bookFar(5);
  assert.ok(b.balancePaise > 0, 'needs a balance to charge');
  const v = await enable();
  assert.equal(v.status, 'active');
  assert.deepEqual(await chargeDue(h.cfg), { charged: 0, failed: 0, skipped: 0 }); // too early
  toWindow(); // 22h before the start
  const r = await chargeDue(h.cfg);
  assert.equal(r.charged, 1, JSON.stringify(r));
  const after = (await h.get(`/api/bookings/${b.id}`, cust)).body;
  assert.equal(after.booking.balancePaise, 0);
  assert.ok(after.payments.some((p: any) => p.purpose === 'balance' && p.status === 'captured'));
  assert.deepEqual(await chargeDue(h.cfg), { charged: 0, failed: 0, skipped: 0 }); // not twice
});

test('without a mandate, or after cancelling it, nothing is charged', async () => {
  await bookFar(5);
  toWindow();
  assert.equal((await chargeDue(h.cfg)).charged, 0);
  await enable();
  const del = await h.del('/api/autodebit', cust);
  assert.equal(del.body.status, 'none');
  assert.equal((await chargeDue(h.cfg)).charged, 0);
});

test('a declined charge tells the customer, retries later, and stops after three tries', async () => {
  await bookFar(5);
  await enable();
  db().prepare("UPDATE autodebit_mandates SET rp_token_id = 'token_demo_fail' WHERE status = 'active'").run();
  toWindow();
  assert.equal((await chargeDue(h.cfg)).failed, 1);
  assert.equal((await chargeDue(h.cfg)).failed, 0); // not again within the hour
  advance(HOUR + 1); assert.equal((await chargeDue(h.cfg)).failed, 1);
  advance(HOUR + 1); assert.equal((await chargeDue(h.cfg)).failed, 1);
  advance(HOUR + 1); assert.equal((await chargeDue(h.cfg)).failed, 0);
  const msgs = db().prepare("SELECT COUNT(*) n FROM notifications WHERE template = 'autodebit_failed' AND channel = 'email'").get() as { n: number };
  assert.ok(msgs.n >= 1);
});

test('a balance above the approved limit is skipped and the customer is told', async () => {
  await bookFar(5);
  await enable(10_000); // ₹100 limit
  toWindow();
  assert.deepEqual(await chargeDue(h.cfg), { charged: 0, failed: 0, skipped: 1 });
});

test('limits are checked and a second set-up needs the first to be cancelled', async () => {
  const bad = await h.post('/api/autodebit/start', { maxAmountPaise: 5 }, cust);
  assert.equal(bad.status, 400);
  await enable();
  assert.equal((await h.post('/api/autodebit/start', {}, cust)).status, 409);
  assert.equal((await h.post('/api/autodebit/start', {}, await h.login('owner1'))).status, 403);
});
