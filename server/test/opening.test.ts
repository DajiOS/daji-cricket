import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, dayFromNow, setting, type Harness, type GroundLite } from './helpers.ts';

let h: Harness, g: GroundLite, cust: string, admin: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => { h.reset(); g = (await grounds(h))[0]!; cust = await h.login('customer'); admin = await h.login('admin'); });

test('customers cannot book before the opening day, and can from it', async () => {
  const open = dayFromNow(10);
  setting({ bookingsOpenFrom: open });
  assert.equal((await h.get('/api/config')).body.bookingsOpenFrom, open);
  const early = await h.post('/api/bookings', { groundId: g.id, date: dayFromNow(5), startTime: '17:00', slots: 1 }, cust);
  assert.equal(early.status, 409); assert.equal(early.body.error.code, 'NOT_OPEN_YET'); assert.match(early.body.error.message, /Online bookings open on/);
  assert.equal((await h.post('/api/bookings', { groundId: g.id, date: open, startTime: '17:00', slots: 1 }, cust)).status, 201);
});

test('the software owner can change the opening day, and clear it to open now', async () => {
  assert.equal((await h.call('PUT', '/api/admin/settings', { token: admin, body: { bookingsOpenFrom: '2026-11-14' } })).body.bookingsOpenFrom, '2026-11-14');
  assert.equal((await h.call('PUT', '/api/admin/settings', { token: admin, body: { bookingsOpenFrom: 'soon' } })).status, 400);
  assert.equal((await h.call('PUT', '/api/admin/settings', { token: admin, body: { bookingsOpenFrom: '' } })).body.bookingsOpenFrom, '');
});

test('the fresh install opens bookings on 14 November 2026', async () => {
  const { DEFAULT_SETTINGS } = await import('../src/settings.ts');
  assert.equal(DEFAULT_SETTINGS.bookingsOpenFrom, '2026-11-14');
});

test('bookings close from a date until the software owner clears it', async () => {
  const close = dayFromNow(20);
  setting({ bookingsCloseFrom: close });
  assert.equal((await h.get('/api/config')).body.bookingsCloseFrom, close);
  const late = await h.post('/api/bookings', { groundId: g.id, date: close, startTime: '17:00', slots: 1 }, cust);
  assert.equal(late.status, 409); assert.equal(late.body.error.code, 'BOOKINGS_CLOSED');
  assert.equal((await h.post('/api/bookings', { groundId: g.id, date: dayFromNow(19), startTime: '17:00', slots: 1 }, cust)).status, 201);
  await h.call('PUT', '/api/admin/settings', { token: admin, body: { bookingsCloseFrom: '' } });
  assert.equal((await h.post('/api/bookings', { groundId: g.id, date: close, startTime: '17:00', slots: 1 }, cust)).status, 201);
});

test('a fresh install closes bookings from 1 June 2027', async () => {
  const { DEFAULT_SETTINGS } = await import('../src/settings.ts');
  assert.equal(DEFAULT_SETTINGS.bookingsCloseFrom, '2027-06-01');
});

test('days can be switched off for everything at once, or for the ground, practice or academy alone', async () => {
  const d = dayFromNow(8), d2 = dayFromNow(9);
  const off = await h.post('/api/admin/closed-dates', { dates: [d, d2], closed: true, reason: 'Private event' }, admin);
  assert.equal(off.status, 200); assert.equal(off.body.changed, 6); // 2 days x ground, practice, academy
  assert.deepEqual((await h.get('/api/config')).body.closedDates, { ground: [d, d2], practice: [d, d2], academy: [d, d2] });
  const r = await h.post('/api/bookings', { groundId: g.id, date: d, startTime: '17:00', slots: 1 }, cust);
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'DATE_CLOSED');
  assert.equal((await h.post('/api/bookings', { groundId: g.id, date: dayFromNow(7), startTime: '17:00', slots: 1 }, cust)).status, 201);
  const enq = { groundId: g.id, name: 'Parent', phone: '9811100022', message: 'Admission for my son', preferredDate: d, kind: 'academy' };
  assert.equal((await h.post('/api/enquiries', enq)).status, 409);
  // open the ground alone: the ground takes bookings again, the academy stays closed
  const on = await h.post('/api/admin/closed-dates', { dates: [d], closed: false, scopes: ['ground'] }, admin);
  assert.equal(on.body.changed, 1);
  assert.deepEqual((await h.get('/api/config')).body.closedDates, { ground: [d2], practice: [d, d2], academy: [d, d2] });
  assert.equal((await h.post('/api/bookings', { groundId: g.id, date: d, startTime: '17:00', slots: 1 }, cust)).status, 201);
  assert.equal((await h.post('/api/enquiries', enq)).status, 409);
  assert.equal((await h.post('/api/enquiries', { ...enq, preferredDate: dayFromNow(3) })).status, 201);
  // close only practice on a fresh day
  await h.post('/api/admin/closed-dates', { dates: [dayFromNow(12)], closed: true, scopes: ['practice'] }, admin);
  assert.deepEqual((await h.get('/api/config')).body.closedDates.practice.includes(dayFromNow(12)), true);
  assert.equal((await h.get('/api/config')).body.closedDates.ground.includes(dayFromNow(12)), false);
  assert.equal((await h.post('/api/admin/closed-dates', { dates: ['nope'], closed: true }, admin)).status, 400);
  assert.equal((await h.post('/api/admin/closed-dates', { dates: [d], closed: true, scopes: ['moon'] }, admin)).status, 400);
  assert.equal((await h.post('/api/admin/closed-dates', { dates: [d], closed: true }, await h.login('staff1'))).status, 403, 'staff cannot');
  assert.equal((await h.post('/api/admin/closed-dates', { dates: [d], closed: true, scopes: ['academy'] }, await h.login('owner1'))).status, 200, 'the owner can');
});
