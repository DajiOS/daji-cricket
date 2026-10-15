import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, type Harness } from './helpers.ts';

let h: Harness, cust: string, owner: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => { h.reset(); cust = await h.login('customer'); owner = await h.login('owner1'); });

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082', 'hex');
const upload = (token: string, body: Buffer) => fetch(`${h.url}/api/me/avatar`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' }, body });

test('a person can set, see and remove their own profile picture', async () => {
  assert.equal((await h.get('/api/me', owner)).body.user.avatarUrl, null);
  const r = await upload(owner, PNG);
  assert.equal(r.status, 200);
  const out = await r.json() as any;
  assert.match(out.avatarUrl, /^\/api\/avatar\/[0-9a-f]{24}$/);
  assert.equal(out.user.avatarUrl, out.avatarUrl);
  const img = await fetch(h.url + out.avatarUrl);
  assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal(Buffer.from(await img.arrayBuffer()).equals(PNG), true);
  // a new picture replaces the old one and the old address stops working
  const r2 = await (await upload(owner, Buffer.concat([PNG, Buffer.from([0])]))).json() as any;
  assert.notEqual(r2.avatarUrl, out.avatarUrl);
  assert.equal((await fetch(h.url + out.avatarUrl)).status, 404);
  assert.equal((await h.call('DELETE', '/api/me/avatar', { token: owner })).status, 200);
  assert.equal((await fetch(h.url + r2.avatarUrl)).status, 404);
  assert.equal((await h.get('/api/me', owner)).body.user.avatarUrl, null);
});

test('only real pictures are accepted, and you must be signed in', async () => {
  assert.equal((await upload(cust, Buffer.from('<svg onload=alert(1)></svg>'))).status, 415);
  assert.equal((await upload(cust, Buffer.alloc(0))).status, 400);
  assert.equal((await fetch(`${h.url}/api/me/avatar`, { method: 'POST', body: PNG })).status, 401);
});

test('a person can change their own name, mobile number and email', async () => {
  const r = await h.call('PATCH', '/api/me', { token: cust, body: { name: 'Demo Player', phone: '9811122233', email: 'player.new@example.com' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.user.email, 'player.new@example.com'); assert.equal(r.body.user.phone, '9811122233'); assert.equal(r.body.user.name, 'Demo Player');
  const clash = await h.call('PATCH', '/api/me', { token: cust, body: { email: 'owner1@daji.test' } });
  assert.equal(clash.status, 409);
});

test('an Admin made from the preset has fewer rights than the owner', async () => {
  const r = await h.post('/api/staff/team', { name: 'Floor Admin', email: 'floor.admin@example.com', phone: '9822200011', password: 'Admin#2026x', preset: 'admin' }, owner);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const perms: string[] = r.body.permissions;
  assert.ok(perms.includes('manage_bookings') && perms.includes('view_reports'));
  assert.ok(!perms.includes('manage_accounting') && !perms.includes('manage_grounds') && !perms.includes('send_broadcasts'));
  const adm = await h.post('/api/auth/login', { identifier: '9822200011', password: 'Admin#2026x' });
  assert.equal(adm.status, 200);
  const t = adm.body.token;
  assert.equal((await h.post('/api/staff/promos', { code: 'NOPE10', kind: 'flat', value: 100 }, t)).status, 403); // promo codes stay with the owner
  assert.equal((await h.get('/api/staff/team', t)).status, 403); // so does the team
  assert.equal((await h.get('/api/accounting/reports/pnl?month=2026-10', t)).status, 200); // reading reports is allowed
  assert.equal((await h.post('/api/accounting/journals', { date: '2026-10-01', memo: 'x', lines: [] }, t)).status, 403); // changing the books is not
});
