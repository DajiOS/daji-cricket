import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, setNow, type Harness } from './helpers.ts';
import { istMidnight } from '../src/time.ts';
import { PACKS, nextQuarter, quarterLabel, quarterOf } from '../src/packs.ts';
import { rotatingDesign } from '../src/design.ts';

let h: Harness;
let owner: string;

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

test('this quarter’s pack is live with next quarter’s waiting, and a reminder shows a month before a quarter ends with nothing to follow', async () => {
  await at('2026-10-21');
  let c = await cal();
  assert.equal(c.live.id, '2026-q4');
  assert.equal(c.live.quarter, 'Oct to Dec 2026');
  assert.equal(c.live.designs.length, 10);
  assert.equal(c.reminder, null);
  assert.equal(c.next.id, '2027-q1');
  assert.equal(c.next.designs.length, 10);
  assert.equal((await site()).pack.id, '2026-q4');
  await at('2027-03-05');
  c = await cal();
  assert.equal(c.live.id, '2027-q1');
  assert.equal(c.reminder, null, 'the Apr to Jun pack is built');
  assert.equal(c.next.id, '2027-q2');
  assert.deepEqual(c.next.designs, ['kulfi', 'camp', 'neem', 'heatwave', 'gola', 'khus', 'powerplay', 'thunder', 'firefly', 'jamun']);
  // the summer pack goes live by itself on 1 April
  await at('2027-04-01', 9);
  assert.equal((await cal()).live.id, '2027-q2');
  assert.ok(['kulfi', 'camp', 'neem'].includes((await site()).design));
  // a month before June ends with no Jul to Sep pack, the reminder shows; with nothing new, the pack simply carries on
  await at('2027-06-05');
  assert.equal((await cal()).reminder, 'The Jul to Sep 2027 pack is not built yet. This quarter’s designs carry on until it is.');
  await at('2027-07-10');
  assert.equal((await cal()).live.id, '2027-q2');
  assert.equal((await h.get('/api/admin/design-packs', await h.login('staff1'))).status, 403);
});

test('the next pack goes live by itself on its day; nothing needs approving; the owner can delay or switch it', async () => {
  const q1 = PACKS.find((p) => p.id === '2027-q1')!;
  {
    await at('2026-12-20');
    let c = await cal();
    assert.equal(c.next.id, '2027-q1');
    assert.equal(c.reminder, null, 'no approval is asked for');
    assert.equal(c.next.approved, null);
    // the owner can try the pack on the website before it goes live
    assert.equal((await site('?pack=2027-q1')).pack.id, '2027-q1');
    assert.equal((await site('?pack=2027-q1')).design, rotatingDesign(Date.parse('2026-12-20T06:30:00Z'), q1.bands).design);
    assert.equal((await site()).pack.id, '2026-q4');

    // never approved, it still goes live on its day
    await at('2027-01-01', 9);
    c = await cal();
    assert.equal(c.live.id, '2027-q1');
    assert.equal(c.packs.find((p: any) => p.id === '2026-q4').state, 'archived');
    assert.ok(['mist', 'sunrise', 'scorebook'].includes((await site()).design));

    // delayed to the 15th: the old pack stays on until then
    await at('2026-12-28');
    const bad = await h.put('/api/admin/design-packs/2027-q1', { startsOn: '2027-04-02' }, owner);
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.details.fields[0].field, 'startsOn');
    c = (await h.put('/api/admin/design-packs/2027-q1', { startsOn: '2027-01-15' }, owner)).body;
    assert.equal(c.next.startsOn, '2027-01-15');
    assert.equal(c.next.delayed, true);
    await at('2027-01-10');
    assert.equal((await cal()).live.id, '2026-q4');
    await at('2027-01-15');
    assert.equal((await cal()).live.id, '2027-q1');

    // switch the archived pack back on: it holds until another pack's day comes
    c = (await h.put('/api/admin/design-packs/2026-q4', { switchOn: true }, owner)).body;
    assert.equal(c.live.id, '2026-q4');
    assert.equal(c.live.switchedOn, true);
    c = (await h.put('/api/admin/design-packs/2026-q4', { switchOn: false }, owner)).body;
    assert.equal(c.live.id, '2027-q1');
    assert.equal((await h.put('/api/admin/design-packs/nope', { approve: true }, owner)).status, 404);
  }
});
