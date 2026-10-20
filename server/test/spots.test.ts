import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, type Harness } from './helpers.ts';

let h: Harness; let owner: string, owner2: string, cust: string, staff: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => { h.reset(); owner = await h.login('owner1'); owner2 = await h.login('owner2'); cust = await h.login('customer'); staff = await h.login('staff1'); });
type Spot = { id: string; name: string; status: string; groundId: string | null };

test('the board opens with one spot per ground, all ready', async () => {
  const r = await h.get('/api/desk/spots', owner);
  assert.equal(r.status, 200);
  const b = r.body as { items: Spot[]; counts: Record<string, number> };
  assert.ok(b.items.length >= 1);
  assert.ok(b.items.every((i) => i.status === 'ready' && i.groundId));
  assert.equal(b.counts.ready, b.items.length);
  // opening it again does not add more
  const again = (await h.get('/api/desk/spots', owner)).body as { items: Spot[] };
  assert.equal(again.items.length, b.items.length);
});

test('add a net, change its status, move it and remove it', async () => {
  const c = await h.post('/api/desk/spots', { name: 'Net 3', kind: 'net' }, owner);
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const id = (c.body as Spot).id;
  const u = await h.patch(`/api/desk/spots/${id}`, { status: 'out_of_order', note: 'Net torn', x: 10, y: 20 }, owner);
  assert.equal(u.status, 200);
  assert.equal((u.body as Spot).status, 'out_of_order');
  assert.equal(((await h.get('/api/desk/spots', owner)).body as { counts: Record<string, number> }).counts.out_of_order, 1);
  assert.equal((await h.patch(`/api/desk/spots/${id}`, { status: 'broken' }, owner)).status, 400);
  assert.equal((await h.del(`/api/desk/spots/${id}`, owner)).status, 200);
  assert.ok(!((await h.get('/api/desk/spots', owner)).body as { items: Spot[] }).items.some((i) => i.id === id));
});

test('one business never sees or edits another\'s spots; customers are refused', async () => {
  const c = await h.post('/api/desk/spots', { name: 'Net 9' }, owner);
  const id = (c.body as Spot).id;
  const other = (await h.get('/api/desk/spots', owner2)).body as { items: Spot[] };
  assert.ok(!other.items.some((i) => i.id === id));
  assert.equal((await h.patch(`/api/desk/spots/${id}`, { status: 'attention' }, owner2)).status, 404);
  assert.ok([401, 403].includes((await h.get('/api/desk/spots', cust)).status));
  void staff;
});
