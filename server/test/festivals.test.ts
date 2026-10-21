import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, setNow, type Harness } from './helpers.ts';
import { istMidnight } from '../src/time.ts';

let h: Harness;
let owner: string;

before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset();
  owner = await h.login('owner1');
});

const at = (date: string, hhmm = '10:00') => setNow(istMidnight(date) + (+hhmm.slice(0, 2) * 60 + +hhmm.slice(3)) * 60_000);
const byName = async (name: string) => (await h.get('/api/admin/festivals', owner)).body.items.find((f: any) => f.name === name);

test('an ordinary day has no festival', async () => {
  const r = await h.get('/api/festival');
  assert.equal(r.status, 200);
  assert.equal(r.body.festival, null);
  assert.equal(r.body.forEveryone, true);
});

test('Diwali has five days, each with its own look and its day number', async () => {
  at('2026-11-06');
  let r = await h.get('/api/festival');
  assert.equal(r.body.festival.name, 'Diwali');
  assert.equal(r.body.festival.dayLook.title, 'Dhanteras');
  assert.deepEqual([r.body.festival.day, r.body.festival.of, r.body.festival.from, r.body.festival.to], [1, 5, '2026-11-06', '2026-11-10']);
  at('2026-11-09');
  r = await h.get('/api/festival');
  assert.equal(r.body.festival.dayLook.title, 'Bestu Varas');
  assert.equal(r.body.festival.day, 4);
  at('2026-11-11');
  assert.equal((await h.get('/api/festival')).body.festival, null);
});

test('Navratri gives each of its ten days a colour, and a fixed day like Republic Day comes back every year', async () => {
  const days = (await h.get('/api/festival?date=2027-10-03')).body.festival;
  assert.equal(days.name, 'Navratri and Dussehra');
  assert.equal(days.day, 4);
  assert.equal(days.of, 10);
  assert.equal(days.dayLook.colour, '#2f5bd8');
  assert.equal((await h.get('/api/festival?date=2027-10-09')).body.festival.dayLook.title, 'Dussehra');
  for (const y of [2027, 2031]) assert.equal((await h.get(`/api/festival?date=${y}-01-26`)).body.festival.name, 'Republic Day');
  assert.equal((await h.get('/api/festival?date=2027-01-15')).body.festival.dayLook.title, 'Vasi Uttarayan');
  assert.equal((await h.get('/api/festival?date=nope')).status, 400);
});

test('New Year’s Eve counts down to midnight India time from the time the owner sets', async () => {
  const f = (await h.get('/api/festival?date=2026-12-31')).body.festival;
  assert.equal(f.dayLook.countdown, true);
  assert.equal(f.countdownStart, istMidnight('2026-12-31') + 6 * 3600_000);
  assert.equal(f.countdownTo, istMidnight('2027-01-01'));
  const ny = (await h.get('/api/festival?date=2027-01-01')).body.festival;
  assert.equal(ny.dayLook.title, 'New Year’s Day');
  assert.equal(ny.countdownTo, null);
});

test('the owner edits a day, switches a festival off, and adds their own', async () => {
  const xmas = await byName('Christmas and New Year');
  const days = xmas.days.map((d: any) => d.countdown ? { ...d, countdownFrom: '18:30', headline: 'Almost there' } : d);
  const put = await h.put(`/api/admin/festivals/${xmas.id}`, { days, offer: 'Free chai at the New Year match' }, owner);
  assert.equal(put.status, 200);
  const eve = (await h.get('/api/festival?date=2026-12-31')).body.festival;
  assert.equal(eve.dayLook.headline, 'Almost there');
  assert.equal(eve.offer, 'Free chai at the New Year match');
  assert.equal(eve.countdownStart, istMidnight('2026-12-31') + (18 * 60 + 30) * 60_000);

  await h.put(`/api/admin/festivals/${xmas.id}`, { enabled: false }, owner);
  assert.equal((await h.get('/api/festival?date=2026-12-25')).body.festival, null);
  // The owner can still preview a festival that is switched off.
  const pv = (await h.get(`/api/festival?preview=${xmas.id}&day=9`)).body.festival;
  assert.equal(pv.dayLook.title, 'New Year’s Day');

  const mine = await h.post('/api/admin/festivals', { name: 'Ground anniversary', look: 'diwali', repeat: '03-15', days: [{ title: 'Anniversary', greeting: 'Thank you for playing with us', headline: 'Five years', headline2: 'of cricket.' }] }, owner);
  assert.equal(mine.status, 201);
  assert.equal((await h.get('/api/festival?date=2028-03-15')).body.festival.name, 'Ground anniversary');
  assert.equal((await h.del(`/api/admin/festivals/${mine.body.id}`, owner)).status, 200);
  assert.equal((await h.get('/api/festival?date=2028-03-15')).body.festival, null);
});

test('bad details are refused field by field, and only the owner can change the calendar', async () => {
  const bad = await h.post('/api/admin/festivals', { name: 'X', look: 'party', repeat: '02-30', starts: ['2027-13-01'], days: [{ title: '', colour: 'red', countdownFrom: '25:00' }] }, owner);
  assert.equal(bad.status, 400);
  const fields = bad.body.error.details.fields.map((f: any) => f.field).sort();
  assert.deepEqual(fields, ['days.0.colour', 'days.0.countdownFrom', 'days.0.title', 'look', 'name', 'repeat', 'starts']);
  assert.equal((await h.get('/api/admin/festivals', await h.login('customer'))).status, 403);
  assert.equal((await h.get('/api/admin/festivals', await h.login('staff1'))).status, 403);
});

test('the calendar warns when next year’s moving dates are missing, and the everyone setting is the owner’s', async () => {
  const cal = (await h.get('/api/admin/festivals', owner)).body;
  const holi = cal.items.find((f: any) => f.name === 'Holi');
  assert.deepEqual(holi.next, { from: '2027-03-21', to: '2027-03-22' });
  assert.equal(holi.warning, null);
  at('2027-04-01');
  owner = await h.login('owner1');
  assert.equal((await byName('Holi')).warning, 'No upcoming dates. Add the dates for 2027 or 2028.');
  assert.equal((await byName('Diwali')).warning, 'The dates for 2028 are not set yet.');
  assert.equal((await byName('Republic Day')).warning, null);
  await h.put(`/api/admin/festivals/${holi.id}`, { starts: ['2027-03-21', '2028-03-10'] }, owner);
  assert.equal((await byName('Holi')).warning, null);
  assert.ok(cal.looks.includes('navratri'));

  assert.equal((await h.put('/api/admin/settings', { festivalForEveryone: false }, owner)).status, 200);
  assert.equal((await h.get('/api/festival')).body.forEveryone, false);
});
