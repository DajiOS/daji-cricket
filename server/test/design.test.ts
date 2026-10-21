import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, setNow, type Harness } from './helpers.ts';
import { istMidnight } from '../src/time.ts';
import { DESIGNS, DESIGN_BANDS, rotatingDesign } from '../src/design.ts';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); });

const at = (date: string, hh: number, mm = 0) => istMidnight(date) + (hh * 60 + mm) * 60_000;

test('the design follows the part of the day, India time, and moves on each day', () => {
  assert.equal(rotatingDesign(at('2026-10-21', 7)).band, 'Morning');
  assert.equal(rotatingDesign(at('2026-10-21', 13)).band, 'Afternoon');
  assert.equal(rotatingDesign(at('2026-10-21', 18, 30)).band, 'Evening');
  assert.equal(rotatingDesign(at('2026-10-21', 22)).band, 'Night');
  // after midnight is still the same night as the evening before, and it changes at 6 am
  assert.deepEqual(rotatingDesign(at('2026-10-22', 2)).design, rotatingDesign(at('2026-10-21', 23)).design);
  assert.equal(rotatingDesign(at('2026-10-22', 2)).until, at('2026-10-22', 6));
  assert.equal(rotatingDesign(at('2026-10-21', 13)).until, at('2026-10-21', 17));
  // the morning design changes from one day to the next, and over three mornings all three appear
  const mornings = new Set([21, 22, 23].map((d) => rotatingDesign(at(`2026-10-${d}`, 8)).design));
  assert.equal(mornings.size, 3);
  // every one of the ten designs is used, each in one part of the day
  assert.deepEqual(DESIGN_BANDS.flatMap((b) => b.designs).sort(), [...DESIGNS].sort());
});

test('the website gets the rotating design by default, or the owner’s fixed one', async () => {
  setNow(at('2026-10-21', 21));
  let r = await h.get('/api/festival');
  assert.equal(r.body.site.rotating, true);
  assert.ok(['noir', 'pinkball'].includes(r.body.site.design));
  assert.equal(r.body.site.band, 'Night');
  const owner = await h.login('owner1');
  assert.equal((await h.put('/api/admin/settings', { siteDesign: 'stadium' }, owner)).status, 200);
  r = await h.get('/api/festival');
  assert.deepEqual(r.body.site, { design: 'stadium', rotating: false, band: null, until: null });
  const bad = await h.put('/api/admin/settings', { siteDesign: 'neon' }, owner);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.details.fields[0].field, 'siteDesign');
});
