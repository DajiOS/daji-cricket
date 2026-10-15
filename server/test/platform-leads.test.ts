import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, type Harness } from './helpers.ts';
import { many } from '../src/db.ts';

let h: Harness; let admin: string, owner: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => { h.reset(); admin = await h.login('admin'); owner = await h.login('owner1'); });

const lead = (x: Record<string, unknown> = {}) => ({ name: 'Ravi Mehta', email: 'ravi@example.com', phone: '9876543210', business: 'Mehta Turf', city: 'Vadodara', grounds: 2, message: 'Want to try it', ...x });

test('anyone can ask for access; only the super admin sees and works the list', async () => {
  const r = await h.post('/api/platform/leads', lead());
  assert.equal(r.status, 201);
  assert.equal((await h.get('/api/admin/leads')).status, 401);
  assert.equal((await h.get('/api/admin/leads', owner)).status, 403);
  const list = await h.get('/api/admin/leads', admin);
  assert.equal(list.body.items.length, 1);
  assert.equal(list.body.items[0].status, 'new');
  const up = await h.patch(`/api/admin/leads/${list.body.items[0].id}`, { status: 'demo', note: 'Demo on Friday' }, admin);
  assert.equal(up.status, 200); assert.equal(up.body.status, 'demo');
  assert.equal((await h.patch(`/api/admin/leads/${list.body.items[0].id}`, { status: 'nonsense' }, admin)).status, 400);
  assert.equal((await h.patch('/api/admin/leads/nope', { status: 'won' }, admin)).status, 404);
  assert.equal((await h.patch(`/api/admin/leads/${list.body.items[0].id}`, { status: 'won' }, owner)).status, 403);
});

test('the form is validated, bots are ignored, and one email cannot flood the list', async () => {
  assert.equal((await h.post('/api/platform/leads', lead({ email: 'nope' }))).status, 400);
  assert.equal((await h.post('/api/platform/leads', lead({ phone: '12' }))).status, 400);
  assert.equal((await h.post('/api/platform/leads', lead({ business: '' }))).status, 400);
  assert.equal((await h.post('/api/platform/leads', lead({ website: 'http://spam.example' }))).status, 201);
  assert.equal(many('SELECT 1 FROM platform_leads').length, 0, 'the hidden field catches a bot without telling it');
  for (let i = 0; i < 3; i++) assert.equal((await h.post('/api/platform/leads', lead())).status, 201);
  assert.equal((await h.post('/api/platform/leads', lead())).status, 429);
  assert.equal((await h.post('/api/platform/leads', lead({ name: '<script>alert(1)</script>', email: 'other@example.com' }))).status, 201, 'text is stored as text; the screens never render it as markup');
});
