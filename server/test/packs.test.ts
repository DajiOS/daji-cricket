import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, setNow, type Harness } from './helpers.ts';
import { istMidnight } from '../src/time.ts';
import { PACKS, nextQuarter, quarterLabel, quarterOf } from '../src/packs.ts';

let h: Harness;
let owner: string;
// a second pack for next quarter, so the schedule has something to switch to
const NEXT = { id: 'test-q1', name: 'Test', note: 'For the tests', from: '2027-01-01', bands: [{ from: 6, name: 'Day', designs: ['whites'] }, { from: 18, name: 'Night', designs: ['noir'] }] };

before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => { h.reset(); owner = await h.login('owner1'); });

const at = async (date: string, hh = 12) => { setNow(istMidnight(date) + hh * 3600_000); owner = await h.login('owner1'); };
const site = async (q = '') => (await h.get('/api/festival' + q)).body.site;
const cal = async () => (await h.get('/api/admin/design-packs', owner)).body;

test('quarters are named and counted the way people say them', () => {
  assert.equal(quarterOf('2026-11-15'), '2026-10-01');
  assert.equal(nextQuarter('2026-10-01'), '2027-01-01');
  assert.equal(quarterLabel('2027-01-01'), 'Jan to Mar 2027');
});

test('this quarter’s pack is live, and a reminder shows a month before the quarter ends with nothing to follow', async () => {
  await at('2026-10-21');
  let c = await cal();
  assert.equal(c.live.id, '2026-q4');
  assert.equal(c.live.quarter, 'Oct to Dec 2026');
  assert.equal(c.live.designs.length, 10);
  assert.equal(c.reminder, null);
  assert.equal((await site()).pack.id, '2026-q4');
  await at('2026-12-05');
  c = await cal();
  assert.equal(c.reminder, 'The Jan to Mar 2027 pack is not built yet. This quarter’s designs carry on until it is.');
  // with nothing new, the old pack simply carries on
  await at('2027-01-10');
  assert.equal((await cal()).live.id, '2026-q4');
  assert.equal((await h.get('/api/admin/design-packs', await h.login('staff1'))).status, 403);
});

test('the next pack goes live by itself on its day; the owner approves, delays and switches it', async () => {
  PACKS.push(NEXT);
  try {
    await at('2026-12-20');
    let c = await cal();
    assert.equal(c.next.id, 'test-q1');
    assert.equal(c.reminder, 'Have a look at the Test pack before 2027-01-01. It goes live by itself that day.');
    // the owner can try the pack on the website before it goes live
    assert.equal((await site('?pack=test-q1')).pack.id, 'test-q1');
    assert.equal((await site('?pack=test-q1')).design, 'whites');
    assert.equal((await site()).pack.id, '2026-q4');

    c = (await h.put('/api/admin/design-packs/test-q1', { approve: true }, owner)).body;
    assert.ok(c.next.approved);
    assert.equal(c.reminder, null);

    await at('2027-01-01', 9);
    c = await cal();
    assert.equal(c.live.id, 'test-q1');
    assert.equal(c.packs.find((p: any) => p.id === '2026-q4').state, 'archived');
    assert.equal((await site()).design, 'whites');

    // delayed to the 15th: the old pack stays on until then
    await at('2026-12-28');
    const bad = await h.put('/api/admin/design-packs/test-q1', { startsOn: '2027-04-02' }, owner);
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.details.fields[0].field, 'startsOn');
    c = (await h.put('/api/admin/design-packs/test-q1', { startsOn: '2027-01-15' }, owner)).body;
    assert.equal(c.next.startsOn, '2027-01-15');
    assert.equal(c.next.delayed, true);
    await at('2027-01-10');
    assert.equal((await cal()).live.id, '2026-q4');
    await at('2027-01-15');
    assert.equal((await cal()).live.id, 'test-q1');

    // switch the archived pack back on: it holds until another pack's day comes
    c = (await h.put('/api/admin/design-packs/2026-q4', { switchOn: true }, owner)).body;
    assert.equal(c.live.id, '2026-q4');
    assert.equal(c.live.switchedOn, true);
    c = (await h.put('/api/admin/design-packs/2026-q4', { switchOn: false }, owner)).body;
    assert.equal(c.live.id, 'test-q1');
    assert.equal((await h.put('/api/admin/design-packs/nope', { approve: true }, owner)).status, 404);
  } finally { PACKS.pop(); }
});
