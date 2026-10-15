import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, dayFromNow, setting, type Harness, type GroundLite } from './helpers.ts';

let h: Harness, g: GroundLite, owner: string, owner2: string, cust: string, admin: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset(); setting({ requireApproval: false });
  g = (await grounds(h))[0]!;
  owner = await h.login('owner1'); owner2 = await h.login('owner2'); cust = await h.login('customer'); admin = await h.login('admin');
});
const hold = (day: number, time: string, promoCode?: string, token = cust) => h.post('/api/bookings', { groundId: g.id, date: dayFromNow(day), startTime: time, slots: 1, promoCode }, token);

test('a typed code takes a percentage off, capped, and the booking total is the discounted price', async () => {
  const mk = await h.post('/api/staff/promos', { code: 'diwali10', kind: 'percent', value: 10, maxDiscountPaise: 5000 }, owner);
  assert.equal(mk.status, 201, JSON.stringify(mk.body));
  assert.equal(mk.body.items[0].code, 'DIWALI10');
  const chk = await h.post('/api/promo/check', { groundId: g.id, date: dayFromNow(4), startTime: '17:00', slots: 1, promoCode: ' diwali10 ' }, cust);
  assert.equal(chk.status, 200, JSON.stringify(chk.body));
  const full = chk.body.fullPricePaise;
  const want = Math.min(Math.floor(full * 0.1), 5000);
  assert.equal(chk.body.discountPaise, want);
  const b = (await hold(4, '17:00', 'DIWALI10')).body.booking;
  assert.equal(b.totalPaise, full - want); assert.equal(b.discountPaise, want); assert.equal(b.promoCode, 'DIWALI10');
});

test('a flat code, limits, dates and the wrong ground are refused with a plain message', async () => {
  await h.post('/api/staff/promos', { code: 'FLAT100', kind: 'flat', value: 10000, perCustomerLimit: 1 }, owner);
  assert.equal((await hold(3, '16:00', 'FLAT100')).status, 201);
  const again = await hold(4, '16:00', 'FLAT100');
  assert.equal(again.status, 400); assert.equal(again.body.error.code, 'PROMO_INVALID'); assert.match(again.body.error.message, /already used/);
  await h.post('/api/staff/promos', { code: 'OLD', kind: 'flat', value: 5000, validTo: dayFromNow(-2) }, owner);
  assert.match((await hold(6, '16:00', 'OLD')).body.error.message, /expired/);
  assert.equal((await hold(6, '16:00', 'NOPE')).status, 400);
  await h.post('/api/staff/promos', { code: 'OTHER', kind: 'flat', value: 5000 }, owner2);
  assert.match((await hold(6, '16:00', 'OTHER')).body.error.message, /does not apply/);
});

test('auto-generated one-time codes are unique, single use, and the owner can switch one off', async () => {
  const mk = await h.post('/api/staff/promos', { auto: true, count: 3, prefix: 'vip', oneTime: true, kind: 'percent', value: 20 }, owner);
  assert.equal(mk.status, 201, JSON.stringify(mk.body));
  const codes = mk.body.items.map((p: any) => p.code);
  assert.equal(new Set(codes).size, 3); assert.ok(codes.every((c: string) => /^VIP-[A-Z2-9]{6}$/.test(c)));
  assert.equal(mk.body.items[0].usageLimit, 1);
  assert.equal((await hold(3, '18:00', codes[0])).status, 201);
  assert.match((await hold(4, '18:00', codes[0])).body.error.message, /fully used/);
  const off = await h.post(`/api/staff/promos/${mk.body.items[1].id}/active`, { active: false }, owner);
  assert.equal(off.body.active, false);
  assert.equal((await hold(4, '18:00', codes[1])).status, 400);
  assert.equal((await h.post(`/api/staff/promos/${mk.body.items[2].id}/active`, { active: false }, owner2)).status, 404);
  const list = (await h.get('/api/staff/promos', owner)).body.items;
  assert.equal(list.find((p: any) => p.code === codes[0]).used, 1);
  assert.equal((await h.get('/api/staff/promos', owner2)).body.items.length, 0);
});

test('the super admin makes codes that work at every ground; customers cannot make codes', async () => {
  assert.equal((await h.post('/api/staff/promos', { code: 'SNEAKY', kind: 'flat', value: 100 }, cust)).status, 403);
  const mk = await h.post('/api/staff/promos', { code: 'ALLGROUNDS', kind: 'flat', value: 5000 }, admin);
  assert.equal(mk.status, 201, JSON.stringify(mk.body));
  assert.equal((await hold(3, '15:00', 'ALLGROUNDS')).status, 201);
  assert.equal((await h.post('/api/staff/promos', { code: 'allgrounds', kind: 'flat', value: 1 }, owner)).status, 409);
  assert.equal((await h.post('/api/staff/promos', { code: 'BAD', kind: 'percent', value: 150 }, owner)).status, 400);
});
