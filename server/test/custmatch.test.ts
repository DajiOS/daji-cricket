import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, dayFromNow, type Harness } from './helpers.ts';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });

test('lookup finds an existing customer and sign-up claims a desk record', async () => {
  const staff = await h.login('staff1');
  const g = (await grounds(h))[0]!;
  const none = await h.get('/api/staff/customers/lookup?phone=9811111111', staff);
  assert.equal(none.body.found, false);
  const b = await h.post('/api/staff/bookings', { groundId: g.id, date: dayFromNow(9), startTime: '08:00', slots: 1, customer: { name: 'Meera Joshi', phone: '9811111111', email: 'meera@x.in' }, payment: { method: 'cash', amountPaise: 180000 } }, staff);
  assert.equal(b.status, 201);
  const hit = await h.get('/api/staff/customers/lookup?phone=9811111111', staff);
  assert.equal(hit.body.found, true); assert.equal(hit.body.hasAccount, false); assert.equal(hit.body.name, 'Meera Joshi'); assert.equal(hit.body.email, 'meera@x.in');
  const reg = await h.post('/api/auth/register', { firstName: 'Meera', lastName: 'Joshi', email: 'meera@x.in', phone: '9811111111', password: 'Meera@12345' });
  assert.equal(reg.status, 201);
  const again = await h.post('/api/auth/register', { firstName: 'Meera', lastName: 'Joshi', email: 'meera@x.in', password: 'Meera@12345' });
  assert.equal(again.status, 409); assert.equal(again.body.error?.code ?? again.body.code, 'ACCOUNT_EXISTS');
  const after = await h.get('/api/staff/customers/lookup?email=MEERA@x.in', staff);
  assert.equal(after.body.hasAccount, true);
});

test('a tournament with a ground booking, and a multi-day booking marked as a tournament, are linked both ways', async () => {
  const staff = await h.login('owner1'), g = (await grounds(h))[0]!;
  const t = await h.post('/api/staff/tournaments', { name: 'Diwali Cup', startDate: dayFromNow(20), endDate: dayFromNow(22), organiser: { firstName: 'Asha', lastName: 'Rao', phone: '9822222222' },
    booking: { groundId: g.id, startTime: '08:00', endTime: '18:00', totalPaise: 3000000, payment: { method: 'upi', amountPaise: 1500000, reference: 'UTRTOURN0001' } } }, staff);
  assert.equal(t.status, 201, JSON.stringify(t.body));
  assert.equal(t.body.booking.totalPaise, 3000000);
  const list = await h.get('/api/staff/bookings?group=1', staff);
  const row = list.body.items.find((b: any) => b.block?.seriesId === t.body.booking.seriesId);
  assert.equal(row.block.tournament.name, 'Diwali Cup');
  const c = await h.get('/api/staff/customers/lookup?phone=9822222222', staff);
  assert.equal(c.body.found, true); assert.equal(c.body.name, 'Asha Rao');

  const blk = await h.post('/api/staff/bookings/block', { groundId: g.id, fromDate: dayFromNow(30), toDate: dayFromNow(31), startTime: '08:00', endTime: '18:00', totalPaise: 2000000,
    customer: { firstName: 'Ravi', lastName: 'Shah', phone: '9833333333' }, payment: { method: 'cash', amountPaise: 1000000 }, tournament: { name: 'Summer Cup' } }, staff);
  assert.equal(blk.status, 201, JSON.stringify(blk.body));
  assert.equal(blk.body.tournament.booking.seriesId, blk.body.series.id);
  const all = await h.get('/api/staff/tournaments', staff);
  assert.ok(all.body.items.some((x: any) => x.name === 'Summer Cup' && x.booking && x.organiser.lastName === 'Shah'));
});

test('first and last name are accepted for an enquiry and a profile edit', async () => {
  const g = (await grounds(h))[0]!;
  const e = await h.post('/api/enquiries', { groundId: g.id, firstName: 'Neha', lastName: 'Kulkarni', phone: '9844444444', message: 'Planning a corporate match' });
  assert.equal(e.status, 201); assert.equal(e.body.name, 'Neha Kulkarni');
  const me = await h.login('customer');
  const p = await h.patch('/api/me', { firstName: 'Priya', lastName: 'Menon' }, me);
  assert.equal(p.status, 200); assert.equal(p.body.user.name, 'Priya Menon'); assert.equal(p.body.user.lastName, 'Menon');
});

test('a booking can be made with nothing received, single or multi-day; the whole amount stays due', async () => {
  const staff = await h.login('owner1'), g = (await grounds(h))[0]!;
  const one = await h.post('/api/staff/bookings', { groundId: g.id, date: dayFromNow(80), startTime: '10:00', slots: 1, customer: { firstName: 'Nil', lastName: 'Advance', phone: '9833333333' }, payment: { method: 'cash', amountPaise: 0 } }, staff);
  assert.equal(one.status, 201, JSON.stringify(one.body));
  assert.equal(one.body.booking.status, 'confirmed'); assert.equal(one.body.booking.paidPaise, 0); assert.ok(one.body.booking.balancePaise > 0);
  const many = await h.post('/api/staff/bookings/block', { groundId: g.id, fromDate: dayFromNow(90), toDate: dayFromNow(92), startTime: '08:00', endTime: '12:00', totalPaise: 900000, customer: { firstName: 'Nil', lastName: 'Block', phone: '9833333334' }, payment: { method: 'cash', amountPaise: 0 } }, staff);
  assert.equal(many.status, 201, JSON.stringify(many.body));
  assert.ok(many.body.bookings.every((b: any) => b.status === 'confirmed' && b.paidPaise === 0));
  const neg = await h.post('/api/staff/bookings', { groundId: g.id, date: dayFromNow(81), startTime: '10:00', slots: 1, customer: { firstName: 'A', lastName: 'B', phone: '9833333335' }, payment: { method: 'cash', amountPaise: -5 } }, staff);
  assert.equal(neg.status, 400);
});
