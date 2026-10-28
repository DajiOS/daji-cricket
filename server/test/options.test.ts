import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, hold, dayFromNow, slotStart, advance, MIN, type Harness, type GroundLite } from './helpers.ts';
import { many, one } from '../src/db.ts';
import { register } from './register.ts';
import { setting } from './helpers.ts';

let h: Harness, g: GroundLite, cust: string, staff: string, admin: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => { h.reset(); g = (await grounds(h))[0]!; cust = await h.login('customer'); staff = await h.login('staff1'); admin = await h.login('admin'); });

const opts = (token: string, body: Record<string, unknown>) => h.post('/api/availability/options', body, token);

test('options: a free slot comes back as the exact option with a price and an id; nothing is held by asking', async () => {
  const date = dayFromNow(3);
  const r = await opts(cust, { groundId: g.id, date, startTime: '19:00', slots: 2 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.available, true);
  assert.equal(r.body.exact.exact, true); assert.equal(r.body.exact.slots, 2); assert.equal(r.body.exact.totalPaise, 2 * 260000);
  assert.ok(r.body.exact.optionId && r.body.exact.expiresAt);
  assert.equal(many('SELECT 1 FROM booking_slots').length, 0, 'asking holds nothing');
  assert.equal(many('SELECT 1 FROM bookings').length, 0);
});

test('options: a taken slot returns the nearest free ones, nearest first, each with its own id', async () => {
  const date = dayFromNow(3);
  const other = await register(h, 'Taker', '9810000001');
  assert.equal((await hold(h, other, g.id, date, '19:00', 1)).status, 201);
  const r = await opts(cust, { groundId: g.id, date, startTime: '19:00', slots: 1, max: 4 });
  assert.equal(r.body.available, false); assert.equal(r.body.exact, null); assert.equal(r.body.reason, 'Those slots are not free');
  assert.equal(r.body.alternatives.length, 4);
  assert.deepEqual(r.body.alternatives.map((a: any) => a.startTime).slice(0, 2), ['18:00', '20:00']);
  assert.ok(r.body.alternatives.every((a: any) => a.optionId && !a.exact));
  const taken = slotStart(date, '19:00');
  assert.ok(!r.body.alternatives.some((a: any) => a.date === date && a.startTime === '19:00'));
  void taken;
});

test('options: the hold started from an option id books exactly what was offered, and the id is single-person and short-lived', async () => {
  const date = dayFromNow(3);
  const r = await opts(cust, { groundId: g.id, date, startTime: '19:00', slots: 1 });
  const id = r.body.exact.optionId;
  // another person cannot use it
  const other = await register(h, 'Borrower', '9810000002');
  assert.equal((await h.post('/api/bookings', { optionId: id }, other)).body.error.code, 'OPTION_INVALID');
  // a tampered id is refused. The first signature character is changed: the last ones carry unused bits, so overwriting them can leave the signature as it was
  const dot = id.indexOf('.');
  const tampered = id.slice(0, dot + 1) + (id[dot + 1] === 'A' ? 'B' : 'A') + id.slice(dot + 2);
  assert.notEqual(tampered, id);
  assert.equal((await h.post('/api/bookings', { optionId: tampered }, cust)).body.error.code, 'OPTION_INVALID');
  // the option fixes the slot and price: other fields are refused
  const sneaky = await h.post('/api/bookings', { optionId: id, totalPaise: 1, slots: 5 }, cust);
  assert.equal(sneaky.status, 400); assert.equal(sneaky.body.error.code, 'OPTION_FIELDS_NOT_ALLOWED');
  // the real thing
  const ok = await h.post('/api/bookings', { optionId: id, players: 12 }, cust);
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.booking.totalPaise, 260000); assert.equal(ok.body.booking.players, 12);
  // expired
  const r2 = await opts(cust, { groundId: g.id, date: dayFromNow(4), startTime: '19:00', slots: 1 });
  advance(11 * MIN);
  const late = await h.post('/api/bookings', { optionId: r2.body.exact.optionId }, cust);
  assert.equal(late.status, 410); assert.equal(late.body.error.code, 'OPTION_EXPIRED');
});

test('options: if the price moved after the option was offered the hold is refused and nothing is held', async () => {
  const date = dayFromNow(3);
  const r = await opts(cust, { groundId: g.id, date, startTime: '10:00', slots: 1 });
  const owner = await h.login('owner1');
  const up = await h.patch(`/api/staff/grounds/${g.id}`, { pricePaise: 190000, weekendPricePaise: 230000 }, owner);
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const x = await h.post('/api/bookings', { optionId: r.body.exact.optionId }, cust);
  assert.equal(x.status, 409); assert.equal(x.body.error.code, 'OPTION_PRICE_CHANGED');
  assert.equal(many('SELECT 1 FROM booking_slots').length, 0);
});

test('options: customers only see what they could book online (closed day, not yet open); staff may see more', async () => {
  const date = dayFromNow(3);
  assert.equal((await h.post('/api/admin/closed-dates', { dates: [date], closed: true, reason: 'maintenance', scopes: ['ground'] }, admin)).status, 200);
  const c = await opts(cust, { groundId: g.id, date, startTime: '19:00', slots: 1 });
  assert.equal(c.body.available, false); assert.match(c.body.reason, /switched off/);
  assert.ok(c.body.alternatives.every((a: any) => a.date !== date), 'no alternative on the closed day');
  const s = await opts(staff, { groundId: g.id, date, startTime: '19:00', slots: 1 });
  assert.equal(s.body.available, true);
  assert.equal(s.body.exact.optionId, undefined, 'staff options carry no customer hold id');
  assert.equal((await h.call('POST', '/api/availability/options', { body: { groundId: g.id, date, startTime: '19:00', slots: 1 } })).status, 401);
  setting({ bookingsOpenFrom: '' });
});

test('a retry of the same hold with the same option id and key gives the same hold once', async () => {
  const date = dayFromNow(3);
  const r = await opts(cust, { groundId: g.id, date, startTime: '17:00', slots: 1 });
  const body = { optionId: r.body.exact.optionId };
  const k = { 'idempotency-key': 'opt-retry-0001' };
  const a = await h.call('POST', '/api/bookings', { token: cust, body, headers: k });
  const b = await h.call('POST', '/api/bookings', { token: cust, body, headers: k });
  assert.equal(a.status, 201); assert.equal(b.status, 201);
  assert.equal((a.body as any).booking.id, (b.body as any).booking.id);
  assert.equal(one<{ n: number }>("SELECT COUNT(*) n FROM bookings WHERE status = 'held'")!.n, 1);
});
