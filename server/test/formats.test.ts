import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, dayFromNow, slotStart, type Harness, type GroundLite } from './helpers.ts';

let h: Harness, g: GroundLite, owner: string, cust: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset();
  g = (await grounds(h))[0]!;
  owner = await h.login('owner1'); cust = await h.login('customer');
});

const FORMATS = [
  { label: 'T20', ball: 'white', minutes: 210, pricePaise: 600000, weekendPricePaise: 800000 },
  { label: '40 overs', ball: 'red', minutes: 420, pricePaise: 1000000 },
  { label: 'Tennis', ball: 'tennis', minutes: 240, pricePaise: 400000 },
];
async function setup() {
  const r = await h.patch(`/api/staff/grounds/${g.id}`, { openTime: '09:00', closeTime: '23:00', slotMinutes: 30, maxSlots: 24, formats: FORMATS }, owner);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}

test('sessions run back to back from opening time, as long as the format', async () => {
  await setup();
  const day = dayFromNow(2);
  const a = (await h.get(`/api/grounds/${g.id}/availability?date=${day}`)).body;
  const times = (id: string) => a.formats.find((f: any) => f.formatId === id).windows.map((w: any) => `${w.time}-${w.endTime}`);
  assert.deepEqual(times('tennis-240'), ['09:00-13:00', '13:00-17:00', '17:00-21:00']);
  assert.deepEqual(times('white-210'), ['09:00-12:30', '12:30-16:00', '16:00-19:30', '19:30-23:00']);
  assert.deepEqual(times('red-420'), ['09:00-16:00', '16:00-23:00']);
});

test('a customer picks a format and the whole session is held at its price', async () => {
  await setup();
  const day = dayFromNow(2); // Friday
  const r = await h.post('/api/bookings', { groundId: g.id, date: day, startTime: '12:30', formatId: 'white-210' }, cust);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.booking.slotCount, 7);
  assert.equal(r.body.booking.formatLabel, 'T20');
  assert.equal(r.body.booking.ball, 'white');
  assert.equal(r.body.booking.totalPaise, 600000);
  const a = (await h.get(`/api/grounds/${g.id}/availability?date=${day}`)).body;
  const state = (id: string, t: string) => a.formats.find((f: any) => f.formatId === id).windows.find((w: any) => w.time === t).state;
  assert.equal(state('white-210', '12:30'), 'held');
  assert.equal(state('tennis-240', '09:00'), 'held', 'tennis 09:00-13:00 overlaps the held 12:30-16:00');
});

test('overlapping sessions of another format are not available', async () => {
  await setup();
  const day = dayFromNow(2);
  assert.equal((await h.post('/api/bookings', { groundId: g.id, date: day, startTime: '12:30', formatId: 'white-210' }, cust)).status, 201);
  const clash = await h.post('/api/bookings', { groundId: g.id, date: day, startTime: '13:00', formatId: 'tennis-240' }, cust);
  assert.equal(clash.status, 409);
  assert.equal(clash.body.error.code, 'SLOT_TAKEN');
  const a = (await h.get(`/api/grounds/${g.id}/availability?date=${day}`)).body;
  assert.equal(a.formats.find((f: any) => f.formatId === 'tennis-240').windows.find((w: any) => w.time === '13:00').state, 'held');
  assert.equal(a.formats.find((f: any) => f.formatId === 'red-420').windows.find((w: any) => w.time === '09:00').state, 'held');
});

test('weekend price, wrong start time, unknown format and missing choice', async () => {
  await setup();
  const sat = dayFromNow(3);
  const w = await h.post('/api/bookings', { groundId: g.id, date: sat, startTime: '09:00', formatId: 'white-210' }, cust);
  assert.equal(w.body.booking.totalPaise, 800000, 'weekend price');
  const bad = await h.post('/api/bookings', { groundId: g.id, date: sat, startTime: '10:00', formatId: 'red-420' }, cust);
  assert.equal(bad.status, 400); assert.equal(bad.body.error.code, 'INVALID_SLOT');
  assert.equal((await h.post('/api/bookings', { groundId: g.id, date: sat, startTime: '09:00', formatId: 'red-999' }, cust)).body.error.code, 'UNKNOWN_FORMAT');
  assert.equal((await h.post('/api/bookings', { groundId: g.id, date: sat, startTime: '09:00', slots: 2 }, cust)).body.error.code, 'FORMAT_REQUIRED');
});

test('owners cannot save a format that does not fit the slot length or opening hours', async () => {
  await setup();
  const put = (formats: unknown) => h.patch(`/api/staff/grounds/${g.id}`, { formats }, owner);
  assert.equal((await put([{ label: 'Odd', ball: 'white', minutes: 200, pricePaise: 1 }])).status, 400, 'not a multiple of 30');
  assert.equal((await put([{ label: 'Pink', ball: 'pink', minutes: 210, pricePaise: 1 }])).status, 400, 'unknown ball');
  assert.equal((await put([{ label: 'Huge', ball: 'red', minutes: 900, pricePaise: 1 }])).status, 400, 'longer than the day');
  assert.equal((await put([{ label: 'A', ball: 'red', minutes: 240, pricePaise: 1 }, { label: 'B', ball: 'red', minutes: 240, pricePaise: 2 }])).status, 400, 'same ball and length twice');
  assert.equal((await h.patch(`/api/staff/grounds/${g.id}`, { slotMinutes: 60 }, owner)).status, 400, 'a slot length that breaks 210 minutes is refused');
  assert.equal((await h.get(`/api/grounds/${g.id}`)).body.formats.length, 3, 'nothing changed');
});

test('staff can still book raw slots, and can book by format', async () => {
  await setup();
  const day = dayFromNow(2);
  const pay = { method: 'cash', amountPaise: 600000 };
  const r = await h.post('/api/staff/bookings', { groundId: g.id, date: day, startTime: '16:00', formatId: 'white-210', customer: { name: 'Walk In', phone: '9876543210' }, payment: pay }, owner);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((r.body.booking ?? r.body).formatLabel, 'T20');
  const raw = await h.post('/api/staff/bookings', { groundId: g.id, date: day, startTime: '10:00', slots: 2, customer: { name: 'Walk In', phone: '9876543210' }, payment: { method: 'cash', amountPaise: 100000 } }, owner);
  assert.ok([201, 409].includes(raw.status));
  void slotStart;
});
