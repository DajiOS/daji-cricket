import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, dayFromNow, type Harness, type GroundLite } from './helpers.ts';

let h: Harness, g: GroundLite, owner: string, cust: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset();
  g = (await grounds(h))[0]!;
  owner = await h.login('owner1'); cust = await h.login('customer');
});

const FORMATS = [{ label: '40 overs', ball: 'red', minutes: 420, pricePaise: 1000000 }, { label: 'T20', ball: 'white', minutes: 210, pricePaise: 600000 }];
const HOURS = { openTime: '06:00', closeTime: '27:00', winterOpenTime: '07:00', winterCloseTime: '27:00', slotMinutes: 30, maxSlots: 24, eveningFrom: '18:00', eveningSurchargePaise: 40000, formats: FORMATS };
const dayIn = (months: number[]): string => { for (let n = 2; n < 360; n++) { const d = dayFromNow(n); if (months.includes(Number(d.slice(5, 7)))) return d; } throw new Error('no day'); };
const summerDay = () => dayIn([4, 5, 6, 7, 8, 9]);
const winterDay = () => dayIn([12, 1, 2]);
const avail = async (d: string) => (await h.get(`/api/grounds/${g.id}/availability?date=${d}`)).body;

test('summer opens at 6 am and winter at 7 am, both until 3 am the next morning', async () => {
  const r = await h.patch(`/api/staff/grounds/${g.id}`, HOURS, owner);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ground?.winterOpenTime ?? r.body.winterOpenTime, '07:00');
  const s = (await avail(summerDay())).slots, w = (await avail(winterDay())).slots;
  assert.equal(s[0].time, '06:00'); assert.equal(s.length, 42); assert.equal(s[41].time, '02:30');
  assert.equal(w[0].time, '07:00'); assert.equal(w.length, 40);
  assert.equal(s[41].end - s[0].start, 21 * 3600_000);
});

test('the late-night slots carry the evening price and sessions run on past midnight', async () => {
  await h.patch(`/api/staff/grounds/${g.id}`, HOURS, owner);
  const a = await avail(summerDay());
  const at = (t: string) => a.slots.find((x: any) => x.time === t);
  assert.equal(at('01:00').pricePaise, at('18:00').pricePaise);
  assert.equal(at('01:00').pricePaise, at('06:00').pricePaise + 40000);
  const red = a.formats.find((f: any) => f.formatId === 'red-420').windows.map((x: any) => `${x.time}-${x.endTime}`);
  assert.deepEqual(red, ['06:00-13:00', '13:00-20:00', '20:00-03:00']);
  const wr = (await avail(winterDay())).formats.find((f: any) => f.formatId === 'red-420').windows.map((x: any) => `${x.time}-${x.endTime}`);
  assert.deepEqual(wr, ['07:00-14:00', '14:00-21:00']);
  const b = await h.post('/api/bookings', { groundId: g.id, date: summerDay(), startTime: '20:00', formatId: 'red-420' }, cust);
  assert.equal(b.status, 201, JSON.stringify(b.body));
  assert.equal(b.body.booking.slotCount, 14);
});

test('winter hours need both times, a closing past 3 am is refused, and null clears them', async () => {
  assert.equal((await h.patch(`/api/staff/grounds/${g.id}`, { winterOpenTime: '07:00' }, owner)).status, 400);
  assert.equal((await h.patch(`/api/staff/grounds/${g.id}`, { closeTime: '28:00' }, owner)).status, 400);
  assert.equal((await h.patch(`/api/staff/grounds/${g.id}`, { openTime: '24:00' }, owner)).status, 400);
  assert.equal((await h.patch(`/api/staff/grounds/${g.id}`, { ...HOURS, formats: [] }, owner)).status, 200);
  assert.equal((await h.patch(`/api/staff/grounds/${g.id}`, { winterOpenTime: null, winterCloseTime: null }, owner)).status, 200);
  assert.equal((await avail(winterDay())).slots[0].time, '06:00');
});

test('a play format longer than the shortest day is refused', async () => {
  const r = await h.patch(`/api/staff/grounds/${g.id}`, { ...HOURS, formats: [{ label: 'Marathon', ball: 'red', minutes: 1230, pricePaise: 100 }] }, owner);
  assert.equal(r.status, 400);
});
