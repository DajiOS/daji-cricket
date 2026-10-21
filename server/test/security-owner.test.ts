import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, type Harness } from './helpers.ts';
import { buildScenario } from './scenario.ts';

let h: Harness, owner: string, admin: string, staff: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => { ({ owner, admin, staff } = await buildScenario(h)); });

test('an owner cannot reach the platform: people, passwords, audit log, backups, services', async () => {
  const body = { role: 'super_admin', name: 'Evil Admin', email: 'evil@x.test', password: 'Evil@12345' };
  assert.equal((await h.post('/api/admin/users', body, owner)).status, 403);
  assert.equal((await h.post('/api/admin/users/anything/password', { password: 'Pwned@12345' }, owner)).status, 403);
  for (const p of ['/api/admin/users', '/api/admin/audit', '/api/admin/backups', '/api/admin/services']) assert.equal((await h.get(p, owner)).status, 403, p);
  assert.equal((await h.patch('/api/admin/users/anything', { active: false }, owner)).status, 403);
  assert.equal((await h.post('/api/admin/users', body, admin)).status, 201, 'the software owner still can');
});

test('an owner sees which services are connected and can test them, but never the keys', async () => {
  const r = await h.get('/api/admin/integrations', owner);
  assert.equal(r.status, 200);
  assert.ok(r.body.items.some((i: { id: string }) => i.id === 'email'));
  assert.ok(!JSON.stringify(r.body).includes(h.cfg.jwtSecret));
  const t = await h.post('/api/admin/integrations/email/test', {}, owner);
  assert.equal(t.status, 200);
  assert.equal(typeof t.body.ok, 'boolean');
  assert.equal((await h.get('/api/admin/integrations', staff)).status, 403);
});

test('each service keeps the owner\'s account notes, starting from what is known, and refuses keys and passwords', async () => {
  const items = (await h.get('/api/admin/integrations', owner)).body.items as { id: string; notes: string }[];
  assert.equal(items.find((i) => i.id === 'razorpay')!.notes, 'Signed up with Google. Account name: Sqinch.');
  assert.match(items.find((i) => i.id === 'whatsapp')!.notes, /Phone number ID: 1360655880469676/);
  assert.equal(items.find((i) => i.id === 'email')!.notes, 'Sending address: dajicricket@gmail.com.');
  const ok = await h.put('/api/admin/integrations/razorpay/notes', { notes: 'Signed up with Google (sqinchmoney). Account name: Sqinch. KYC pending.' }, owner);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.match(ok.body.notes, /KYC pending/);
  assert.match((await h.get('/api/admin/integrations', owner)).body.items.find((i: { id: string }) => i.id === 'razorpay').notes, /KYC pending/);
  for (const bad of ['Key secret: abcd1234', 'password = Hunter2!', 'key rzp_live_AbCdEf123456', 'token EAAG' + 'x'.repeat(30), 'app password abcd efgh ijkl mnop', 'xY7' + 'q'.repeat(30) + '9', '-----BEGIN PRIVATE KEY-----']) {
    const r = await h.put('/api/admin/integrations/razorpay/notes', { notes: bad }, owner);
    assert.equal(r.status, 400, bad);
    assert.equal(r.body.error.details.fields[0].field, 'notes');
  }
  assert.equal((await h.put('/api/admin/integrations/nope/notes', { notes: 'x' }, owner)).status, 404);
  assert.equal((await h.put('/api/admin/integrations/razorpay/notes', { notes: 'x' }, staff)).status, 403);
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
