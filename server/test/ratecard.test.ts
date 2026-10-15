import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, dayFromNow, setNow, slotStart, type Harness, type GroundLite } from './helpers.ts';

let h: Harness, g: GroundLite, owner: string, cust: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset();
  g = (await grounds(h))[0]!;
  owner = await h.login('owner1'); cust = await h.login('customer');
});

const R = (rupees: number) => rupees * 100;
const NIGHT = { days: [2, 3, 4, 5, 6, 0], from: '19:00', to: '27:00', mode: 'hourly' };
const RATES = [
  { id: 'l-night', label: 'Evening hours', ball: 'leather', ...NIGHT, pricePaise: R(3500) },
  { id: 'l-day', label: 'Day session', ball: 'leather', days: [2, 3, 4, 5], from: '10:00', to: '18:00', mode: 'fixed', pricePaise: R(6000) },
  { id: 'l-morn', label: 'Morning session', ball: 'leather', days: [2, 3, 4, 5], from: '07:00', to: '10:00', mode: 'fixed', pricePaise: R(4000) },
  { id: 'l-wknd', label: 'Weekend day', ball: 'leather', days: [6, 0], from: '07:00', to: '19:00', mode: 'fixed', pricePaise: R(15000) },
  { id: 't-night', label: 'Evening hours', ball: 'tennis', ...NIGHT, pricePaise: R(3500) },
  { id: 't-day', label: 'Day session', ball: 'tennis', days: [2, 3, 4, 5], from: '10:00', to: '18:00', mode: 'fixed', pricePaise: R(7000) },
  { id: 't-morn', label: 'Morning session', ball: 'tennis', days: [2, 3, 4, 5], from: '07:00', to: '10:00', mode: 'fixed', pricePaise: R(5000) },
  { id: 't-both', label: 'Two-day tournament', ball: 'tennis', days: [6], from: '07:00', to: '23:00', mode: 'fixed', pricePaise: R(151000), bundleDays: 2 },
  { id: 't-sat', label: 'Saturday tournament', ball: 'tennis', days: [6], from: '07:00', to: '19:00', mode: 'fixed', pricePaise: R(100000) },
  { id: 't-sun', label: 'Sunday tournament', ball: 'tennis', days: [0], from: '07:00', to: '23:00', mode: 'fixed', pricePaise: R(90000) },
];
const CONFIG = { slotMinutes: 60, maxSlots: 8, closedDays: [1], rates: RATES, ratesNote: 'For custom days and reservations please call.' };
const on = (dow: number): string => { for (let n = 3; n < 30; n++) { const d = dayFromNow(n); if (new Date(d + 'T00:00:00Z').getUTCDay() === dow) return d; } throw new Error('no day'); };
const av = async (date: string) => (await h.get(`/api/grounds/${g.id}/availability?date=${date}`)).body;
const line = (o: any) => `${o.ball}:${o.time}-${o.endTime}:${o.pricePaise / 100}:${o.mode}`;
async function setup() { const r = await h.patch(`/api/staff/grounds/${g.id}`, CONFIG, owner); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; }

test('the price list and closed days are saved and returned', async () => {
  const b = await setup();
  assert.equal(b.rates.length, RATES.length); assert.deepEqual(b.closedDays, [1]); assert.equal(b.ratesNote, CONFIG.ratesNote);
  assert.equal(b.rates[0].ball, 'leather');
});

test('every Monday is closed: nothing to book', async () => {
  await setup();
  const a = await av(on(1));
  assert.equal(a.closed, true); assert.deepEqual(a.rates, []);
  assert.equal((await h.post('/api/bookings', { groundId: g.id, date: on(1), startTime: '19:00', ruleId: 'l-night', slots: 1 }, cust)).status, 409);
});

test('Tuesday to Friday: morning and day sessions are fixed, nights are priced by the hour', async () => {
  await setup();
  const a = await av(on(3));
  assert.deepEqual(a.rates.map(line), [
    'leather:07:00-10:00:4000:fixed', 'leather:10:00-18:00:6000:fixed', 'leather:19:00-03:00:3500:hourly',
    'tennis:07:00-10:00:5000:fixed', 'tennis:10:00-18:00:7000:fixed', 'tennis:19:00-03:00:3500:hourly']);
  const night = a.rates.find((o: any) => o.ruleId === 'l-night');
  assert.equal(night.slots.length, 8); assert.equal(night.slots[7].time, '02:00'); assert.equal(night.slots[0].pricePaise, R(3500));
});

test('weekends: one long leather session, and the tennis tournaments', async () => {
  await setup();
  const sat = (await av(on(6))).rates.map(line), sun = (await av(on(0))).rates.map(line);
  assert.deepEqual(sat.filter((x: string) => x.includes(':fixed')), ['leather:07:00-19:00:15000:fixed', 'tennis:07:00-23:00:151000:fixed', 'tennis:07:00-19:00:100000:fixed']);
  assert.deepEqual(sun.filter((x: string) => x.includes(':fixed')), ['leather:07:00-19:00:15000:fixed', 'tennis:07:00-23:00:90000:fixed']);
});

test('a customer books a fixed session at its price, and hours by the hour', async () => {
  await setup();
  const d = on(4);
  const a = await h.post('/api/bookings', { groundId: g.id, date: d, startTime: '10:00', ruleId: 'l-day' }, cust);
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(a.body.booking.totalPaise, R(6000)); assert.equal(a.body.booking.slotCount, 8); assert.equal(a.body.booking.ball, 'leather'); assert.equal(a.body.booking.formatLabel, 'Day session');
  const b = await h.post('/api/bookings', { groundId: g.id, date: d, startTime: '20:00', ruleId: 'l-night', slots: 3 }, cust);
  assert.equal(b.status, 201, JSON.stringify(b.body));
  assert.equal(b.body.booking.totalPaise, R(10500)); assert.equal(b.body.booking.slotCount, 3);
  // the same hours are no longer offered, for either ball
  const after = await av(d);
  assert.equal(after.rates.find((o: any) => o.ruleId === 't-day').state, 'held');
  assert.equal(after.rates.find((o: any) => o.ruleId === 't-night').slots.find((s: any) => s.time === '21:00').state, 'held');
  assert.equal(after.rates.find((o: any) => o.ruleId === 't-morn').state, 'available');
});

test('hours after midnight can be booked, and too many hours are refused', async () => {
  await setup();
  const d = on(2);
  const r = await h.post('/api/bookings', { groundId: g.id, date: d, startTime: '23:00', ruleId: 't-night', slots: 4 }, cust);
  assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.booking.totalPaise, R(14000));
  assert.equal((await h.post('/api/bookings', { groundId: g.id, date: d, startTime: '19:00', ruleId: 'l-night', slots: 9 }, cust)).status, 400);
  assert.equal((await h.post('/api/bookings', { groundId: g.id, date: d, startTime: '02:00', ruleId: 'l-night', slots: 2 }, cust)).status, 400, 'runs past the end');
});

test('the two-day tennis tournament holds Saturday and Sunday together', async () => {
  await setup();
  const sat = on(6);
  const r = await h.post('/api/bookings', { groundId: g.id, date: sat, startTime: '07:00', ruleId: 't-both' }, cust);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.booking.totalPaise, R(151000)); assert.equal(r.body.booking.slotCount, 32);
  const sunDate = new Date(Date.parse(sat + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  const sun = await av(sunDate);
  assert.equal(sun.rates.find((o: any) => o.ruleId === 't-sun').state, 'held');
  assert.equal(sun.rates.find((o: any) => o.ruleId === 'l-wknd').state, 'held');
});

test('customers must use the price list, and a price only works on its own days', async () => {
  await setup();
  assert.equal((await h.post('/api/bookings', { groundId: g.id, date: on(3), startTime: '10:00', slots: 2 }, cust)).status, 400);
  assert.equal((await h.post('/api/bookings', { groundId: g.id, date: on(6), startTime: '10:00', ruleId: 'l-day' }, cust)).status, 400);
  assert.equal((await h.post('/api/bookings', { groundId: g.id, date: on(3), startTime: '10:00', ruleId: 'nope' }, cust)).status, 400);
});

test('bad price lists are refused', async () => {
  const bad = (rates: unknown, extra: object = {}) => h.patch(`/api/staff/grounds/${g.id}`, { ...CONFIG, rates, ...extra }, owner);
  assert.equal((await bad([...RATES, { ...RATES[0], id: 'x', from: '20:00', to: '23:00' }])).status, 400, 'two hourly prices at once');
  assert.equal((await bad([{ ...RATES[1], from: '10:30' }])).status, 400, 'off the slot grid');
  assert.equal((await bad([{ ...RATES[1], to: '10:00' }])).status, 400, 'ends before it starts');
  assert.equal((await bad([{ ...RATES[0], bundleDays: 2 }])).status, 400, 'hourly cannot cover two days');
  assert.equal((await bad([{ ...RATES[0], ball: 'golf' }])).status, 400, 'unknown ball');
  assert.equal((await bad(RATES, { closedDays: [0, 1, 2, 3, 4, 5, 6] })).status, 400, 'closed every day');
  assert.equal((await bad([{ ...RATES[0], label: '' }])).status, 400, 'no name');
});

test('red and white are accepted and stored as leather', async () => {
  const r = await h.patch(`/api/staff/grounds/${g.id}`, { ...CONFIG, rates: [{ ...RATES[1], ball: 'red' }] }, owner);
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.rates[0].ball, 'leather');
});

test('a super admin can change any ground\'s price list', async () => {
  const admin = await h.login('admin');
  const r = await h.patch(`/api/staff/grounds/${g.id}`, CONFIG, admin);
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test('a red & white combo ball has its own prices and is listed before leather', async () => {
  const combo = { id: 'c-day', label: 'Combo day', ball: 'combo', days: [3], from: '10:00', to: '18:00', mode: 'fixed', pricePaise: R(6500) };
  const r = await h.patch(`/api/staff/grounds/${g.id}`, { ...CONFIG, rates: [RATES[1], combo], closedDays: [1] }, owner);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const a = await av(on(3));
  assert.deepEqual(a.rates.map((o: any) => o.ball), ['combo', 'leather']);
  const b = await h.post('/api/bookings', { groundId: g.id, date: on(3), startTime: '10:00', ruleId: 'c-day' }, cust);
  assert.equal(b.status, 201, JSON.stringify(b.body)); assert.equal(b.body.booking.ball, 'combo'); assert.equal(b.body.booking.totalPaise, R(6500));
});

test('a practice session has its own hourly price, listed after the balls', async () => {
  const prac = { id: 'p-hr', label: 'Practice hours', ball: 'practice', days: [3], from: '07:00', to: '19:00', mode: 'hourly', pricePaise: R(600) };
  const r = await h.patch(`/api/staff/grounds/${g.id}`, { ...CONFIG, rates: [prac, RATES[1]], closedDays: [1] }, owner);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const a = await av(on(3));
  assert.deepEqual(a.rates.map((o: any) => o.ball), ['leather', 'practice']);
  const b = await h.post('/api/bookings', { groundId: g.id, date: on(3), startTime: '08:00', slots: 2, ruleId: 'p-hr' }, cust);
  assert.equal(b.status, 201, JSON.stringify(b.body)); assert.equal(b.body.booking.ball, 'practice'); assert.equal(b.body.booking.totalPaise, R(1200));
});

test('a two-day tournament blocks only its own hours and leaves every other slot open', async () => {
  const r = await h.patch(`/api/staff/grounds/${g.id}`, CONFIG, owner);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const sat = on(6), sun = on(0) > sat ? on(0) : on(0);
  const nextSun = new Date(Date.parse(sat + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  const b = await h.post('/api/bookings', { groundId: g.id, date: sat, startTime: '07:00', ruleId: 't-both' }, cust);
  assert.equal(b.status, 201, JSON.stringify(b.body)); void sun;
  for (const [date, label] of [[sat, 'Saturday'], [nextSun, 'Sunday']] as const) {
    const a = await av(date);
    const hourly = a.rates.filter((o: any) => o.mode === 'hourly' && o.ball === 'leather')[0];
    const st = Object.fromEntries(hourly.slots.map((s: any) => [s.time, s.state]));
    for (const t of ['19:00', '20:00', '21:00', '22:00']) assert.notEqual(st[t], 'available', `${label} ${t} should be taken`);
    for (const t of ['23:00', '00:00', '01:00', '02:00']) assert.equal(st[t], 'available', `${label} ${t} should stay open`);
  }
});

test('a fixed session already under way today is sold for the hours left, rounded up to the next ₹50', async () => {
  const r = await h.patch(`/api/staff/grounds/${g.id}`, CONFIG, owner);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const day = on(3);
  setNow(slotStart(day, '12:30'));
  const a = await av(day);
  const o = a.rates.find((x: any) => x.ruleId === 't-day');
  assert.equal(o.proRated, true); assert.equal(o.state, 'available'); assert.equal(o.time, '13:00'); assert.equal(o.hoursLeft, 5);
  assert.equal(o.fullPricePaise, R(7000)); assert.equal(o.pricePaise, R(4400)); // 7000 x 5/8 = 4375, rounded up to 4400
  const morning = a.rates.find((x: any) => x.ruleId === 't-morn');
  assert.equal(morning.state, 'past'); // the morning session is over, nothing is left to sell
  const b = await h.post('/api/bookings', { groundId: g.id, date: day, startTime: '13:00', ruleId: 't-day' }, cust);
  assert.equal(b.status, 201, JSON.stringify(b.body)); assert.equal(b.body.booking.totalPaise, R(4400));
  const again = (await av(day)).rates.find((x: any) => x.ruleId === 't-day');
  assert.notEqual(again.state, 'available');
});

test('a part-session is only sold while the hours left are free', async () => {
  await h.patch(`/api/staff/grounds/${g.id}`, CONFIG, owner);
  const day = on(4);
  setNow(slotStart(day, '11:10'));
  const lb = await h.post('/api/bookings', { groundId: g.id, date: day, startTime: '12:00', ruleId: 'l-day' }, cust);
  assert.equal(lb.status, 201, JSON.stringify(lb.body));
  assert.equal(lb.body.booking.totalPaise, R(4500)); // 6000 x 6 of 8 hours left
  const o = (await av(day)).rates.find((x: any) => x.ruleId === 't-day');
  assert.notEqual(o.state, 'available'); // the leather day session holds the same ground and hours
  const late = await h.post('/api/bookings', { groundId: g.id, date: day, startTime: '12:00', ruleId: 't-day' }, cust);
  assert.equal(late.status, 409);
});
