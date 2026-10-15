import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { startHarness, grounds, hold, bookAndPay, dayFromNow, type Harness, type GroundLite } from './helpers.ts';
import { register } from './register.ts';

let h: Harness;
let g1: GroundLite;
let g2: GroundLite;

before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset();
  const all = await grounds(h);
  g1 = all.find((x) => x.name === 'Cricket Ground')!;
  g2 = all.find((x) => x.name === 'Riverside Box Cricket')!;
});

// ------------------------------------------------------------------ sign in

test('register, then sign in with the same details', async () => {
  const r = await h.post('/api/auth/register', { name: 'New Player', email: 'New.Player@Example.com', phone: '+91 98765 11111', password: 'Cricket#2026' });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.role, 'customer');
  assert.equal(r.body.user.email, 'new.player@example.com', 'email is stored lower-case');
  assert.equal(r.body.user.phone, '9876511111', 'phone is stored as 10 digits');
  assert.equal(r.body.user.passwordHash, undefined);
  assert.equal(JSON.stringify(r.body).includes('scrypt'), false, 'no hash leaves the server');
  const l = await h.post('/api/auth/login', { email: 'new.player@example.com', password: 'Cricket#2026' });
  assert.equal(l.status, 200);
});

test('registration rejects weak passwords, bad phones, bad emails and duplicates', async () => {
  const bad = await h.post('/api/auth/register', { name: 'A', email: 'nope', phone: '12', password: 'short' });
  assert.equal(bad.status, 400);
  const f = bad.body.error.details.fields.map((x: any) => x.field).sort();
  assert.deepEqual(f, ['email', 'name', 'password', 'phone']);
  const ok = { name: 'Dup Player', email: 'dup@example.com', phone: '9800000011', password: 'Cricket#2026' };
  assert.equal((await h.post('/api/auth/register', ok)).status, 201);
  const again = await h.post('/api/auth/register', { ...ok, phone: '9800000012' });
  assert.equal(again.status, 409);
});

test('phone numbers are not unique (nothing verifies them yet); a walk-in for that number goes to the registered account', async () => {
  const a = await h.post('/api/auth/register', { name: 'Phone Owner', email: 'po1@example.com', phone: '9800000021', password: 'Cricket#2026' });
  const b = await h.post('/api/auth/register', { name: 'Phone Sharer', email: 'po2@example.com', phone: '9800000021', password: 'Cricket#2026' });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201, 'two family members can share a number');
  const g = (await grounds(h))[0]!;
  const walk = await h.post('/api/staff/bookings', { groundId: g.id, date: dayFromNow(2), startTime: '08:00', slots: 1, customer: { name: 'Phone Owner', phone: '9800000021' }, payment: { method: 'cash', amountPaise: 180000 } }, await h.login('staff1'));
  assert.equal(walk.status, 201);
  assert.equal(walk.body.booking.customerId, a.body.user.id, 'the oldest registered account wins, every time');
});

test('wrong password and unknown email give the same answer', async () => {
  const a = await h.post('/api/auth/login', { email: 'customer@daji.test', password: 'Wrong@12345' });
  const b = await h.post('/api/auth/login', { email: 'nobody@daji.test', password: 'Wrong@12345' });
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.deepEqual(a.body, b.body);
});

test('a tampered or expired token is refused', async () => {
  const tok = await h.login('customer');
  assert.equal((await h.get('/api/me', tok)).status, 200);
  const [hd, pl, sig] = tok.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(pl!, 'base64url').toString()), role: 'super_admin' })).toString('base64url');
  assert.equal((await h.get('/api/me', `${hd}.${forgedPayload}.${sig}`)).status, 401);
  assert.equal((await h.get('/api/me', `${hd}.${pl}.${sig!.slice(0, -2)}xx`)).status, 401);
  // a token signed with another secret
  const fake = (() => {
    const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(pl!, 'base64url').toString()) })).toString('base64url');
    return `${head}.${body}.${createHmac('sha256', 'attacker').update(`${head}.${body}`).digest('base64url')}`;
  })();
  assert.equal((await h.get('/api/me', fake)).status, 401);
  // "alg: none"
  const none = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${pl}.`;
  assert.equal((await h.get('/api/me', none)).status, 401);
  assert.equal((await h.get('/api/me', 'garbage')).status, 401);
});

test('changing a password signs out every older token', async () => {
  const tok = await h.login('customer');
  const r = await h.post('/api/me/password', { currentPassword: 'Customer@12345', newPassword: 'Brand#New2026' }, tok);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await h.get('/api/me', tok)).status, 401, 'the old token stops working');
  assert.equal((await h.post('/api/auth/login', { email: 'customer@daji.test', password: 'Customer@12345' })).status, 401);
  assert.equal((await h.post('/api/auth/login', { email: 'customer@daji.test', password: 'Brand#New2026' })).status, 200);
});

test('changing the password needs the current one', async () => {
  const tok = await h.login('customer');
  const r = await h.post('/api/me/password', { currentPassword: 'not-it', newPassword: 'Brand#New2026' }, tok);
  assert.equal(r.status, 400);
});

test('disabling a staff member kills their sessions straight away', async () => {
  const owner = await h.login('owner1');
  const staff = await h.login('staff1');
  assert.equal((await h.get('/api/staff/today', staff)).status, 200);
  const list = (await h.get('/api/staff/team', owner)).body.items;
  const id = list.find((u: any) => u.email === 'staff1@daji.test').id;
  assert.equal((await h.patch(`/api/staff/team/${id}`, { active: false }, owner)).status, 200);
  assert.equal((await h.get('/api/staff/today', staff)).status, 401);
  const login = await h.post('/api/auth/login', { email: 'staff1@daji.test', password: 'Staff@12345' });
  assert.equal(login.status, 403);
  assert.equal(login.body.error.code, 'ACCOUNT_DISABLED');
});

// ------------------------------------------------------------------ roles

test('customers cannot reach staff or admin endpoints; anonymous callers get 401', async () => {
  const cust = await h.login('customer');
  for (const path of ['/api/staff/bookings', '/api/staff/payments', '/api/staff/grounds', '/api/staff/today', '/api/staff/team', '/api/admin/settings', '/api/admin/users', '/api/admin/audit']) {
    assert.equal((await h.get(path, cust)).status, 403, `customer ${path}`);
    assert.equal((await h.get(path)).status, 401, `anonymous ${path}`);
  }
});

test('the owner and the super admin reach /admin; staff and customers do not', async () => {
  for (const who of ['staff1', 'customer'] as const) {
    const tok = await h.login(who);
    assert.equal((await h.get('/api/admin/settings', tok)).status, 403, who);
    assert.equal((await h.get('/api/admin/users', tok)).status, 403, who);
  }
  assert.equal((await h.get('/api/admin/settings', await h.login('owner1'))).status, 200);
  assert.equal((await h.get('/api/admin/settings', await h.login('admin'))).status, 200);
});

test('only an owner manages a team; staff cannot create staff', async () => {
  const staff = await h.login('staff1');
  const body = { name: 'Sneaky', email: 'sneaky@daji.test', password: 'Sneaky@12345', permissions: ['manage_bookings'] };
  assert.equal((await h.post('/api/staff/team', body, staff)).status, 403);
  assert.equal((await h.post('/api/staff/team', body, await h.login('owner1'))).status, 201);
});

test('permissions are enforced per capability', async () => {
  const owner = await h.login('owner1');
  const mk = async (email: string, permissions: string[]) => {
    const r = await h.post('/api/staff/team', { name: 'Perm Test', email, password: 'PermTest@123', permissions }, owner);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return (await h.post('/api/auth/login', { email, password: 'PermTest@123' })).body.token as string;
  };
  const none = await mk('none@daji.test', []);
  const grounds_ = await mk('grounds@daji.test', ['manage_grounds']);
  assert.equal((await h.get('/api/staff/customers', none)).status, 403);
  assert.equal((await h.get('/api/staff/reports/overview?month=2026-10', none)).status, 403);
  assert.equal((await h.get('/api/staff/enquiries', none)).status, 403);
  assert.equal((await h.get('/api/staff/payments', none)).status, 403);
  const patch = await h.patch(`/api/staff/grounds/${g1.id}`, { pricePaise: 190000 }, grounds_);
  assert.equal(patch.status, 200);
  assert.equal((await h.patch(`/api/staff/grounds/${g1.id}`, { pricePaise: 190000 }, none)).status, 403);
});

// ------------------------------------------------------------------ owner isolation

test('one owner can never see or touch another owner\'s data', async () => {
  const c1 = await h.login('customer');
  const mine = await bookAndPay(h, c1, g1.id, dayFromNow(3), '19:00', 1); // owner 1
  const theirs = await bookAndPay(h, c1, g2.id, dayFromNow(3), '19:00', 1); // owner 2
  const o1 = await h.login('owner1');
  const o2 = await h.login('owner2');

  const l1 = (await h.get('/api/staff/bookings', o1)).body.items.map((b: any) => b.id);
  const l2 = (await h.get('/api/staff/bookings', o2)).body.items.map((b: any) => b.id);
  assert.deepEqual(l1, [mine.id]);
  assert.deepEqual(l2, [theirs.id]);

  assert.equal((await h.get(`/api/staff/bookings/${theirs.id}`, o1)).status, 404);
  assert.equal((await h.get(`/api/staff/bookings/${mine.id}/cancel-preview`, o2)).status, 404);
  assert.equal((await h.post(`/api/staff/bookings/${mine.id}/payments`, { method: 'cash', amountPaise: 100 }, o2)).status, 404);
  assert.equal((await h.post(`/api/staff/bookings/${mine.id}/no-show`, {}, o2)).status, 404);

  const p1 = (await h.get('/api/staff/payments', o1)).body;
  assert.equal(p1.total, 1);
  assert.equal(p1.items[0].bookingId, mine.id);

  assert.equal((await h.get('/api/staff/grounds', o1)).body.items.length, 2);
  assert.equal((await h.get('/api/staff/grounds', o2)).body.items.length, 1);
  assert.equal((await h.patch(`/api/staff/grounds/${g1.id}`, { pricePaise: 1 }, o2)).status, 404);
  assert.equal((await h.post(`/api/staff/grounds/${g1.id}/blocks`, { date: dayFromNow(4), startTime: '10:00', endTime: '12:00' }, o2)).status, 404);

  const sRep = (await h.get('/api/staff/reports/overview?month=2026-10', o1)).body;
  assert.equal(sRep.bookings.byStatus.confirmed.count, 1);
  const all = (await h.get('/api/staff/reports/overview?month=2026-10', await h.login('admin'))).body;
  assert.equal(all.bookings.byStatus.confirmed.count, 2, 'the platform admin sees both');
});

test('the audit log is for the owner and super admin only and records who did what', async () => {
  const cust = await h.login('customer');
  await hold(h, cust, g1.id, dayFromNow(3), '19:00');
  assert.equal((await h.get('/api/admin/audit', await h.login('staff1'))).status, 403);
  const a = (await h.get('/api/admin/audit?limit=10', await h.login('admin'))).body.items;
  const e = a.find((x: any) => x.action === 'booking.hold');
  assert.equal(e.actorRole, 'customer');
  assert.equal(e.entity, 'booking');
});

test('a customer\'s notifications are theirs alone', async () => {
  const c1 = await h.login('customer');
  const c2 = await register(h, 'Second Person', '9890011223');
  await bookAndPay(h, c1, g1.id, dayFromNow(3), '19:00', 1);
  assert.ok((await h.get('/api/notifications', c1)).body.items.length >= 1);
  assert.equal((await h.get('/api/notifications', c2)).body.items.length, 0);
});

// ------------------------------------------------------------------ the HTTP layer

test('errors always have the same JSON shape', async () => {
  const nf = await h.get('/api/nope');
  assert.equal(nf.status, 404);
  assert.equal(nf.body.error.code, 'NOT_FOUND');
  const mna = await h.call('DELETE', '/api/grounds');
  assert.equal(mna.status, 405);
  assert.equal(mna.body.error.code, 'METHOD_NOT_ALLOWED');
  const bad = await h.call('POST', '/api/auth/login', { raw: '{not json', headers: { 'content-type': 'application/json' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'BAD_JSON');
});

test('oversized request bodies are refused', async () => {
  const r = await h.call('POST', '/api/auth/login', { raw: JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(300_000) }), headers: { 'content-type': 'application/json' } });
  assert.equal(r.status, 413);
});

test('security headers are on every response', async () => {
  const r = await h.get('/api/health');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(r.headers.get('referrer-policy'));
  assert.ok(r.headers.get('x-frame-options') || r.headers.get('content-security-policy'));
});

test('CORS preflight is answered; in local mode any origin is allowed', async () => {
  const r = await h.call('OPTIONS', '/api/bookings', { headers: { origin: 'http://localhost:19006', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' } });
  assert.ok(r.status === 204 || r.status === 200);
  assert.ok(r.headers.get('access-control-allow-origin'));
  assert.match(r.headers.get('access-control-allow-headers') ?? '', /authorization/i);
});

test('public config never leaks secrets', async () => {
  const r = await h.get('/api/config');
  const text = JSON.stringify(r.body);
  assert.equal(/secret|password|jwt|private/i.test(text), false);
  assert.equal(r.body.razorpayKeyId, null, 'demo gateway has no real key id');
});

test('SQL metacharacters in search boxes are treated as plain text', async () => {
  const owner = await h.login('owner1');
  const r = await h.get(`/api/staff/bookings?q=${encodeURIComponent("' OR 1=1 --")}`, owner);
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 0);
  const g = await h.get(`/api/grounds?q=${encodeURIComponent("%' UNION SELECT * FROM users --")}`);
  assert.equal(g.status, 200);
  assert.equal(g.body.items.length, 0);
});

test('owners and staff sign in with a mobile number as well as an email', async () => {
  for (const [id, who] of [['9000000002', 'owner'], ['+91 90000 00002', 'owner'], ['09000000004', 'staff'], ['9000000001', 'super_admin']] as const) {
    const pw = who === 'owner' ? 'Owner@12345' : who === 'staff' ? 'Staff@12345' : 'Admin@12345';
    const r = await h.post('/api/auth/login', { identifier: id, password: pw });
    assert.equal(r.status, 200, `${id}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.user.role, who);
  }
  assert.equal((await h.post('/api/auth/login', { identifier: '9000000002', password: 'Nope@12345' })).status, 401);
  assert.equal((await h.post('/api/auth/login', { identifier: '1234', password: 'Owner@12345' })).status, 401);
  assert.equal((await h.post('/api/auth/login', { identifier: 'owner1@daji.test', password: 'Owner@12345' })).status, 200);
  assert.equal((await h.post('/api/auth/login', { email: 'owner1@daji.test', password: 'Owner@12345' })).status, 200); // the old field still works
});
