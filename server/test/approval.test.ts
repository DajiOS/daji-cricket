import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { many, one } from '../src/db.ts';
import { startHarness, grounds, bookAndPay, dayFromNow, setting, type Harness, type GroundLite } from './helpers.ts';
import { flushNotifications } from '../src/notifications.ts';

let h: Harness, g: GroundLite, owner: string, staff: string, cust: string, owner2: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset();
  setting({ requireApproval: true });
  g = (await grounds(h))[0]!;
  owner = await h.login('owner1'); staff = await h.login('staff1'); cust = await h.login('customer'); owner2 = await h.login('owner2');
});

const TOKEN = (n: string) => `ExponentPushToken[${n.padEnd(12, 'x')}]`;
const pushRows = (template?: string) => many<{ user_id: string; template: string; subject: string; body: string }>("SELECT user_id, template, subject, body FROM notifications WHERE channel = 'push'" + (template ? ' AND template = ?' : ''), ...(template ? [template] : []));
const userId = (email: string) => one<{ id: string }>('SELECT id FROM users WHERE email = ?', email)!.id;

test('a paid online booking waits for approval, holds the slot, and the owner is pushed', async () => {
  assert.equal((await h.post('/api/me/push-token', { token: TOKEN('owner-phone') }, owner)).status, 200);
  const b = await bookAndPay(h, cust, g.id, dayFromNow(4), '19:00', 1);
  await flushNotifications();
  assert.equal(b.status, 'confirmed'); assert.equal(b.approval, 'pending');
  const mine = (await h.get('/api/bookings', cust)).body.items.find((x: any) => x.id === b.id);
  assert.equal(mine.approval, 'pending');
  // the slot is held: nobody else can take it
  const again = await h.post('/api/bookings', { groundId: g.id, date: dayFromNow(4), startTime: '19:00', slots: 1 }, await h.login('owner2'));
  assert.notEqual(again.status, 201);
  const templates = many<{ template: string }>("SELECT template FROM notifications WHERE booking_id = ? AND channel = 'email'", b.id).map((r) => r.template);
  assert.ok(templates.includes('booking_pending')); assert.ok(!templates.includes('booking_confirmed'));
  const p = pushRows('booking_needs_approval');
  assert.equal(p.length, 1); assert.equal(p[0]!.user_id, userId('owner1@daji.test'));
  assert.match(p[0]!.body, /deposit/);
});

test('approving confirms it for the customer; customers cannot approve and other owners cannot see it', async () => {
  const b = await bookAndPay(h, cust, g.id, dayFromNow(4), '20:00', 1);
  assert.equal((await h.post(`/api/staff/bookings/${b.id}/approve`, {}, cust)).status, 403);
  assert.equal((await h.post(`/api/staff/bookings/${b.id}/approve`, {}, owner2)).status, 404);
  const r = await h.post(`/api/staff/bookings/${b.id}/approve`, {}, staff);
  assert.equal(r.status, 200); assert.equal(r.body.booking.approval, 'approved');
  const templates = many<{ template: string }>("SELECT template FROM notifications WHERE booking_id = ? AND channel = 'email'", b.id).map((x) => x.template);
  assert.ok(templates.includes('booking_confirmed'));
  assert.equal((await h.post(`/api/staff/bookings/${b.id}/approve`, {}, staff)).status, 200); // approving twice changes nothing
});

test('with approval switched off a paid booking is confirmed straight away', async () => {
  setting({ requireApproval: false });
  const b = await bookAndPay(h, cust, g.id, dayFromNow(4), '21:00', 1);
  assert.equal(b.approval, 'approved');
});

test('the owner and the staff are pushed when a customer cancels, and the customer when the ground cancels', async () => {
  await h.post('/api/me/push-token', { token: TOKEN('owner-phone') }, owner);
  await h.post('/api/me/push-token', { token: TOKEN('staff-phone') }, staff);
  await h.post('/api/me/push-token', { token: TOKEN('cust-phone') }, cust);
  const b = await bookAndPay(h, cust, g.id, dayFromNow(5), '19:00', 1);
  await h.post(`/api/bookings/${b.id}/cancel`, { reason: 'plans changed' }, cust);
  const c = pushRows('booking_cancelled_by_customer');
  assert.deepEqual(c.map((r) => r.user_id).sort(), [userId('owner1@daji.test'), userId('staff1@daji.test')].sort());
  const b2 = await bookAndPay(h, cust, g.id, dayFromNow(5), '20:00', 1);
  await h.post(`/api/staff/bookings/${b2.id}/cancel`, { reason: 'the tournament is not going ahead' }, staff);
  const own = pushRows('booking_cancelled_owner');
  assert.equal(own.length, 1); assert.equal(own[0]!.user_id, userId('customer@daji.test'));
  assert.match(own[0]!.body, /tournament is not going ahead/);
});

test('push tokens must look like Expo tokens, can be removed, and a person with no phone registered gets no push record', async () => {
  assert.equal((await h.post('/api/me/push-token', { token: 'not-a-token' }, cust)).status, 400);
  assert.equal((await h.post('/api/me/push-token', { token: TOKEN('cust-phone') }, cust)).status, 200);
  assert.equal((await h.post('/api/me/push-token/remove', { token: TOKEN('cust-phone') }, cust)).status, 200);
  await bookAndPay(h, cust, g.id, dayFromNow(6), '19:00', 1);
  assert.equal(pushRows('booking_pending').length, 0);
});
