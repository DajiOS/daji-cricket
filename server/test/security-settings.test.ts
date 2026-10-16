import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, type Harness } from './helpers.ts';
import { buildScenario } from './scenario.ts';

let h: Harness, owner: string, admin: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => { ({ owner, admin } = await buildScenario(h)); });

test('an owner cannot change where customers pay or the public contact details; the software owner can', async () => {
  for (const patch of [{ upiId: 'attacker@okaxis' }, { razorpayEnabled: false }, { contactPhone: '9999999999' }, { academyCoaches: [] }]) assert.equal((await h.put('/api/admin/settings', patch, owner)).status, 403, JSON.stringify(patch));
  assert.equal((await h.put('/api/admin/settings', { instagramUrl: 'https://instagram.com/daji' }, owner)).status, 200, 'ordinary website settings stay with the owner');
  assert.equal((await h.put('/api/admin/settings', { contactPhone: '7567156000' }, admin)).status, 200);
});
