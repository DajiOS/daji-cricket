import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, hold, bookAndPay, dayFromNow, setNow, T0, HOUR, type Harness, type GroundLite } from './helpers.ts';

let h: Harness;
let g: GroundLite;
let owner: string;
let staff: string;
let cust: string;

before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset();
  g = (await grounds(h))[0]!;
  owner = await h.login('owner1');
  staff = await h.login('staff1');
  cust = await h.login('customer');
});

const newGround = (extra: Record<string, unknown> = {}) => ({ name: 'Test Nets', city: 'Vadodara', pricePaise: 50000, openTime: '06:00', closeTime: '22:00', ...extra });

test('an owner creates a ground; it gets a unique slug and appears publicly', async () => {
  const a = await h.post('/api/staff/grounds', newGround(), owner);
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(a.body.slug, 'test-nets');
  const b = await h.post('/api/staff/grounds', newGround(), owner);
  assert.equal(b.body.slug, 'test-nets-2');
  assert.equal(a.body.ownerId, (await h.get('/api/me', owner)).body.user.id);
  const pub = (await h.get('/api/grounds')).body.items.map((x: any) => x.name);
  assert.ok(pub.includes('Test Nets'));
});

test('ground details are validated with field-level problems', async () => {
  const r = await h.post('/api/staff/grounds', { name: 'X', city: '', pricePaise: -5, openTime: '25:00', slotMinutes: 5, advanceMode: 'percent', advanceValue: 150 }, owner);
  assert.equal(r.status, 400);
  const f = r.body.error.details.fields.map((x: any) => x.field);
  for (const need of ['name', 'city', 'pricePaise', 'openTime', 'slotMinutes', 'advanceValue']) assert.ok(f.includes(need), `${need} should be flagged: ${f}`);
  const hours = await h.post('/api/staff/grounds', newGround({ openTime: '10:00', closeTime: '10:30' }), owner);
  assert.equal(hours.status, 400, 'closing time must leave room for a slot');
});

test('a super admin must say which owner a new ground belongs to', async () => {
  const admin = await h.login('admin');
  assert.equal((await h.post('/api/staff/grounds', newGround(), admin)).status, 400);
  const ownerId = (await grounds(h)).find((x) => x.name === 'Riverside Box Cricket')!.ownerId;
  const ok = await h.post('/api/staff/grounds', { ...newGround(), ownerId }, admin);
  assert.equal(ok.status, 201);
  assert.equal(ok.body.ownerId, ownerId);
});

test('an inactive ground disappears from the public list and refuses bookings', async () => {
  assert.equal((await h.patch(`/api/staff/grounds/${g.id}`, { active: false }, owner)).status, 200);
  assert.ok(!(await h.get('/api/grounds')).body.items.some((x: any) => x.id === g.id));
  assert.ok((await h.get('/api/staff/grounds', owner)).body.items.some((x: any) => x.id === g.id), 'staff still see it');
  const r = await hold(h, cust, g.id, dayFromNow(2), '10:00');
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'GROUND_INACTIVE');
});

test('blocked times show as blocked and cannot be booked', async () => {
  const date = dayFromNow(2);
  const blk = await h.post(`/api/staff/grounds/${g.id}/blocks`, { date, startTime: '10:00', endTime: '12:00', note: 'Pitch rolling' }, owner);
  assert.equal(blk.status, 201);
  assert.equal(blk.body.blocked, 2);
  const av = (await h.get(`/api/grounds/${g.id}/availability?date=${date}`)).body.slots;
  assert.deepEqual(av.filter((s: any) => s.state === 'blocked').map((s: any) => s.time), ['10:00', '11:00']);
  const r = await hold(h, cust, g.id, date, '10:00');
  assert.equal(r.status, 409);
  const spanning = await hold(h, cust, g.id, date, '09:00', 2);
  assert.equal(spanning.status, 409, 'a booking that would run into a block is refused');
});

test('a block cannot be placed over an existing booking, and can be removed afterwards', async () => {
  const date = dayFromNow(2);
  await bookAndPay(h, cust, g.id, date, '14:00', 1);
  const over = await h.post(`/api/staff/grounds/${g.id}/blocks`, { date, startTime: '13:00', endTime: '16:00' }, owner);
  assert.equal(over.status, 409);
  assert.equal(over.body.error.code, 'SLOT_TAKEN');
  assert.equal((await h.post(`/api/staff/grounds/${g.id}/blocks`, { date, startTime: '16:00', endTime: '18:00' }, owner)).status, 201);
  const rm = await h.post(`/api/staff/grounds/${g.id}/blocks/remove`, { date, startTime: '16:00', endTime: '18:00' }, owner);
  assert.equal(rm.body.unblocked, 2);
  const av = (await h.get(`/api/grounds/${g.id}/availability?date=${date}`)).body.slots;
  assert.ok(!av.some((s: any) => s.state === 'blocked'));
  assert.equal(av.find((s: any) => s.time === '14:00').state, 'booked', 'removing blocks never frees a real booking');
});

test('block times are validated', async () => {
  const date = dayFromNow(2);
  assert.equal((await h.post(`/api/staff/grounds/${g.id}/blocks`, { date, startTime: '12:00', endTime: '10:00' }, owner)).status, 400);
  assert.equal((await h.post(`/api/staff/grounds/${g.id}/blocks`, { date, startTime: '02:00', endTime: '04:00' }, owner)).status, 400, 'no slots in that range');
  assert.equal((await h.post(`/api/staff/grounds/${g.id}/blocks`, { date: 'tomorrow', startTime: '10:00', endTime: '12:00' }, owner)).status, 400);
});

test('the slot length cannot change while bookings exist, and can when none do', async () => {
  await bookAndPay(h, cust, g.id, dayFromNow(2), '14:00', 1);
  const no = await h.patch(`/api/staff/grounds/${g.id}`, { slotMinutes: 30 }, owner);
  assert.equal(no.status, 409);
  assert.equal(no.body.error.code, 'HAS_BOOKINGS');
  assert.equal((await h.patch(`/api/staff/grounds/${g.id}`, { pricePaise: 190000 }, owner)).status, 200, 'other edits are fine');

  const other = (await h.post('/api/staff/grounds', newGround(), owner)).body;
  const yes = await h.patch(`/api/staff/grounds/${other.id}`, { slotMinutes: 30 }, owner);
  assert.equal(yes.status, 200);
  const av = (await h.get(`/api/grounds/${other.id}/availability?date=${dayFromNow(2)}`)).body.slots;
  assert.equal(av.length, 32, '06:00 to 22:00 in half-hour slots');
});

test('changing the price affects new bookings but not ones already made', async () => {
  const before_ = await bookAndPay(h, cust, g.id, dayFromNow(2), '10:00', 1);
  await h.patch(`/api/staff/grounds/${g.id}`, { pricePaise: 300000 }, owner);
  const detail = (await h.get(`/api/bookings/${before_.id}`, cust)).body.booking;
  assert.equal(detail.totalPaise, before_.totalPaise);
  const next = await hold(h, cust, g.id, dayFromNow(2), '11:00');
  assert.equal(next.body.booking.totalPaise, 300000);
});

test('minimum notice and maximum slots per booking are honoured', async () => {
  await h.patch(`/api/staff/grounds/${g.id}`, { minNoticeMinutes: 180, maxSlots: 2 }, owner);
  const today = dayFromNow(0); // it is 10:00 IST
  const tooSoon = await hold(h, cust, g.id, today, '12:00');
  assert.equal(tooSoon.status, 409, 'only two hours away');
  assert.equal(tooSoon.body.error.code, 'SLOT_IN_PAST');
  assert.equal((await hold(h, cust, g.id, today, '13:00')).status, 201, 'exactly three hours is enough');
  const tooMany = await hold(h, cust, g.id, dayFromNow(2), '10:00', 3);
  assert.equal(tooMany.status, 400);
  assert.equal(tooMany.body.error.code, 'TOO_MANY_SLOTS');
});

test('a ground can set its own advance; a booking that starts within 24 hours must be paid in full', async () => {
  await h.patch(`/api/staff/grounds/${g.id}`, { advanceMode: 'fixed', advanceValue: 100000 }, owner);
  const later = await hold(h, cust, g.id, dayFromNow(2), '10:00');
  assert.equal(later.body.booking.advancePaise, 100000, 'the ground\'s own fixed advance overrides the global 50%');
  const soon = await hold(h, cust, g.id, dayFromNow(0), '16:00');
  assert.equal(soon.body.booking.advancePaise, soon.body.booking.totalPaise, 'inside 24 hours the whole amount is due');
});

test('a fixed advance is never more than the total', async () => {
  await h.patch(`/api/staff/grounds/${g.id}`, { advanceMode: 'fixed', advanceValue: 90_000_00 }, owner);
  const r = await hold(h, cust, g.id, dayFromNow(2), '10:00');
  assert.equal(r.body.booking.advancePaise, r.body.booking.totalPaise);
});

test('availability: bad dates are rejected; past days show every slot as past', async () => {
  assert.equal((await h.get(`/api/grounds/${g.id}/availability?date=nope`)).status, 400);
  assert.equal((await h.get(`/api/grounds/${g.id}/availability`)).status, 400);
  assert.equal((await h.get('/api/grounds/gnd_missing/availability?date=2026-10-20')).status, 404);
  const past = (await h.get(`/api/grounds/${g.id}/availability?date=${dayFromNow(-1)}`)).body.slots;
  assert.ok(past.every((s: any) => s.state === 'past'));
  const today = (await h.get(`/api/grounds/${g.id}/availability?date=${dayFromNow(0)}`)).body.slots;
  assert.equal(today.find((s: any) => s.time === '09:00').state, 'past');
  assert.equal(today.find((s: any) => s.time === '10:00').state, 'past', 'a slot that has already started cannot be booked');
  assert.equal(today.find((s: any) => s.time === '11:00').state, 'available');
});

// ------------------------------------------------------------------ reports

test('the owner\'s overview adds up bookings, cash, cancellations and utilisation', async () => {
  const a = await bookAndPay(h, cust, g.id, dayFromNow(2), '10:00', 2);
  await bookAndPay(h, cust, g.id, dayFromNow(2), '14:00', 1);
  await h.post(`/api/bookings/${a.id}/cancel`, {}, cust);
  const rep = (await h.get('/api/staff/reports/overview?month=2026-10', owner)).body;
  assert.equal(rep.bookings.byStatus.confirmed.count, 1);
  assert.equal(rep.bookings.byStatus.cancelled.count, 1);
  assert.equal(rep.bookings.cancellations[0].kind, 'free');
  assert.equal(rep.bookings.cancellations[0].refundPaise, Math.round(a.paidPaise / 2));
  const util = rep.utilization.find((u: any) => u.groundId === g.id);
  assert.equal(util.bookedSlots, 1);
  assert.equal(util.availableSlots, 17 * 31);
  const cash = rep.payments.byMethod.find((m: any) => m.method === 'razorpay');
  assert.equal(cash.count, 2);
});

test('reports need a valid period', async () => {
  assert.equal((await h.get('/api/staff/reports/overview', owner)).status, 400);
  assert.equal((await h.get('/api/staff/reports/overview?month=2026-13', owner)).status, 400);
  assert.equal((await h.get('/api/staff/reports/overview?from=2026-10-10&to=2026-10-01', owner)).status, 400);
  assert.equal((await h.get('/api/staff/reports/overview?from=2025-01-01&to=2026-12-31', owner)).status, 400);
  assert.equal((await h.get('/api/staff/reports/overview?from=2026-10-01&to=2026-10-31', owner)).status, 200);
});

test('the staff "today" screen lists today\'s bookings and the work waiting', async () => {
  setNow(T0 - 2 * HOUR);
  const r = await h.post('/api/staff/bookings', { groundId: g.id, date: dayFromNow(0), startTime: '16:00', slots: 1, customer: { name: 'Today Player', phone: '9899900011' }, payment: { method: 'cash', amountPaise: 180000 } }, staff);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const t = (await h.get('/api/staff/today', staff)).body;
  assert.equal(t.date, dayFromNow(0));
  assert.equal(t.bookings.length, 1);
  assert.equal(t.awaitingVerification, 0);
});
