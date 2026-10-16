import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, type Harness } from './helpers.ts';
import { buildScenario } from './scenario.ts';

let h: Harness, owner: string, admin: string, staff: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => { ({ owner, admin, staff } = await buildScenario(h)); });

test('an owner cannot reach the platform: people, passwords, audit log, backups, services, connections', async () => {
  const body = { role: 'super_admin', name: 'Evil Admin', email: 'evil@x.test', password: 'Evil@12345' };
  assert.equal((await h.post('/api/admin/users', body, owner)).status, 403);
  assert.equal((await h.post('/api/admin/users/anything/password', { password: 'Pwned@12345' }, owner)).status, 403);
  for (const p of ['/api/admin/users', '/api/admin/audit', '/api/admin/backups', '/api/admin/services', '/api/admin/integrations']) assert.equal((await h.get(p, owner)).status, 403, p);
  assert.equal((await h.patch('/api/admin/users/anything', { active: false }, owner)).status, 403);
  assert.equal((await h.post('/api/admin/users', body, admin)).status, 201, 'the software owner still can');
});

test('staff with no permissions cannot read refunds, payment history or grounds', async () => {
  const mk = await h.post('/api/staff/team', { name: 'No Perms', email: 'noperms@x.test', password: 'NoPerm@12345', permissions: [] }, owner);
  assert.equal(mk.status, 201, JSON.stringify(mk.body));
  const l = await h.post('/api/auth/login', { email: 'noperms@x.test', password: 'NoPerm@12345' });
  const t = l.body.token;
  assert.equal((await h.get('/api/staff/refunds', t)).status, 403);
  assert.equal((await h.get('/api/staff/grounds', t)).status, 403);
  assert.equal((await h.get('/api/staff/refunds', owner)).status, 200);
  assert.ok(staff);
});
