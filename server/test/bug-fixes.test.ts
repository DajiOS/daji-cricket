import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, dayFromNow, type Harness } from './helpers.ts';
import { run } from '../src/db.ts';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });

test('a played booking can still be paid, and its balance shows as outstanding until it is', async () => {
  const staff = await h.login('owner1'), g = (await grounds(h))[0]!;
  const r = await h.post('/api/staff/bookings', { groundId: g.id, date: dayFromNow(150), startTime: '08:00', slots: 1, customer: { name: 'Late Payer', phone: '9866000001' }, payment: { method: 'cash', amountPaise: 0 } }, staff);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = r.body.booking.id as string, total = r.body.booking.totalPaise as number;
  run("UPDATE bookings SET status = 'completed' WHERE id = ?", id);
  const rep = await h.get(`/api/staff/reports/overview?from=${dayFromNow(150)}&to=${dayFromNow(150)}`, staff);
  assert.equal(rep.body.payments.outstandingBalances.amountPaise, total, 'the unpaid balance of a played booking is still owed');
  const pay = await h.post(`/api/staff/bookings/${id}/payments`, { method: 'cash', amountPaise: total }, staff);
  assert.equal(pay.status, 201, JSON.stringify(pay.body));
  const after = await h.get(`/api/staff/bookings/${id}`, staff);
  assert.equal(after.body.booking.paidPaise, total); assert.equal(after.body.booking.balancePaise, 0);
});

test('a tournament can be created with the ground booking and nothing received', async () => {
  const staff = await h.login('owner1'), g = (await grounds(h))[0]!;
  const t = await h.post('/api/staff/tournaments', { name: 'Free Entry Cup', startDate: dayFromNow(160), endDate: dayFromNow(161), organiser: { firstName: 'Zed', lastName: 'Khan', phone: '9866000002' },
    booking: { groundId: g.id, startTime: '08:00', endTime: '12:00', totalPaise: 1000000, payment: { method: 'cash', amountPaise: 0 } } }, staff);
  assert.equal(t.status, 201, JSON.stringify(t.body));
  assert.equal(t.body.booking.paidPaise, 0);
});

test('opening times must sit on the slot grid, so booking slots and price lines cannot overlap', async () => {
  const owner = await h.login('owner1');
  const base = { name: 'Grid Nets', city: 'Vadodara', pricePaise: 50000, closeTime: '22:00' };
  const bad = await h.post('/api/staff/grounds', { ...base, openTime: '06:30', slotMinutes: 60 }, owner);
  assert.equal(bad.status, 400); assert.ok(JSON.stringify(bad.body).includes('openTime'));
  const bad90 = await h.post('/api/staff/grounds', { ...base, name: 'Grid Nets 2', openTime: '07:00', slotMinutes: 90 }, owner);
  assert.equal(bad90.status, 400);
  const ok = await h.post('/api/staff/grounds', { ...base, name: 'Grid Nets 3', openTime: '06:30', slotMinutes: 30 }, owner);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
});
