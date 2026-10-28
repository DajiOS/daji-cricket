import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, bookAndPay, dayFromNow, DEMO_ACCOUNTS, type Harness } from './helpers.ts';
import { one, run } from '../src/db.ts';
import { base32Decode, totp } from '../src/mfa.ts';
import { now } from '../src/clock.ts';

// Team page › Edit: the owner changes a member's name, email and mobile, or sets them a new password.

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); });

const staffId = async (owner: string): Promise<string> => (await h.get('/api/staff/team', owner)).body.items.find((m: any) => m.email === DEMO_ACCOUNTS.staff1.email).id;

test('TE-001 the owner edits a member\'s name, email and mobile; they sign in with the new email', async () => {
  const owner = await h.login('owner1'), staff = await h.login('staff1');
  const id = await staffId(owner);
  const r = await h.patch(`/api/staff/team/${id}`, { firstName: 'apple', lastName: 'review', email: 'apple.review@daji.test', phone: '9800000055' }, owner);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.name, 'Apple Review');
  assert.equal(r.body.firstName, 'Apple'); assert.equal(r.body.lastName, 'Review');
  assert.equal(r.body.email, 'apple.review@daji.test');
  assert.match(r.body.phone, /9800000055$/);
  assert.equal((await h.get('/api/me', staff)).status, 200, 'a name or email change does not sign them out');
  const login = await h.post('/api/auth/login', { email: 'apple.review@daji.test', password: DEMO_ACCOUNTS.staff1.password });
  assert.equal(login.status, 200);
  const old = await h.post('/api/auth/login', { email: DEMO_ACCOUNTS.staff1.email, password: DEMO_ACCOUNTS.staff1.password });
  assert.equal(old.status, 401);
  // a single "name" still works
  assert.equal((await h.patch(`/api/staff/team/${id}`, { name: 'ground staff two' }, owner)).body.name, 'Ground Staff Two');
  const a = one<{ detail: string }>("SELECT detail FROM audit_log WHERE action = 'staff.update' AND entity_id = ? ORDER BY id ASC LIMIT 1", id)!;
  const d = JSON.parse(a.detail);
  assert.equal(d.email, true); assert.equal(d.name.to, 'Apple Review'); assert.equal(d.phone, true);
});

test('TE-002 the owner sets a new password: old sign-ins end, the new password works, the password is never in the audit trail', async () => {
  const owner = await h.login('owner1'), staff = await h.login('staff1');
  const id = await staffId(owner);
  const weak = await h.patch(`/api/staff/team/${id}`, { password: 'short' }, owner);
  assert.equal(weak.status, 400);
  assert.equal((await h.get('/api/me', staff)).status, 200, 'a refused change ends nothing');
  const r = await h.patch(`/api/staff/team/${id}`, { password: 'Fresh@Pass123' }, owner);
  assert.equal(r.status, 200);
  assert.equal((await h.get('/api/me', staff)).status, 401, 'the old sign-in has ended');
  assert.equal((await h.post('/api/auth/login', { email: DEMO_ACCOUNTS.staff1.email, password: DEMO_ACCOUNTS.staff1.password })).status, 401);
  assert.equal((await h.post('/api/auth/login', { email: DEMO_ACCOUNTS.staff1.email, password: 'Fresh@Pass123' })).status, 200);
  const rows = JSON.stringify(one<{ d: string }>("SELECT group_concat(detail) d FROM audit_log WHERE entity_id = ?", id));
  assert.ok(!rows.includes('Fresh@Pass123'));
  assert.match(rows, /passwordReset/);
});

test('TE-003 an email already used by another account is refused and nothing changes', async () => {
  const owner = await h.login('owner1');
  const id = await staffId(owner);
  const r = await h.patch(`/api/staff/team/${id}`, { email: DEMO_ACCOUNTS.customer.email.toUpperCase(), firstName: 'Changed' }, owner);
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'EMAIL_TAKEN');
  const m = (await h.get('/api/staff/team', owner)).body.items.find((x: any) => x.id === id);
  assert.equal(m.email, DEMO_ACCOUNTS.staff1.email); assert.equal(m.name, 'Ground Staff');
  assert.equal((await h.patch(`/api/staff/team/${id}`, { email: 'not-an-email' }, owner)).status, 400);
  // the member's own email again is fine
  assert.equal((await h.patch(`/api/staff/team/${id}`, { email: DEMO_ACCOUNTS.staff1.email }, owner)).status, 200);
});

test('TE-004 only the member\'s own owner (or the software owner) can edit them', async () => {
  const owner = await h.login('owner1');
  const id = await staffId(owner);
  const staff = await h.login('staff1'), other = await h.login('owner2'), cust = await h.login('customer'), admin = await h.login('admin');
  assert.equal((await h.patch(`/api/staff/team/${id}`, { password: 'Hacked@12345' }, staff)).status, 403);
  assert.equal((await h.patch(`/api/staff/team/${id}`, { password: 'Hacked@12345' }, cust)).status, 403);
  assert.equal((await h.patch(`/api/staff/team/${id}`, { password: 'Hacked@12345' }, other)).status, 404);
  assert.equal((await h.patch(`/api/staff/team/${id}`, { email: 'x@daji.test' })).status, 401);
  assert.equal((await h.post('/api/auth/login', { email: DEMO_ACCOUNTS.staff1.email, password: DEMO_ACCOUNTS.staff1.password })).status, 200, 'nothing was changed');
  assert.equal((await h.patch(`/api/staff/team/${id}`, { firstName: 'Platform', lastName: 'Edit' }, admin)).status, 200);
  // an owner or customer account cannot be edited through the team route
  const ownerId = (await h.get('/api/me', owner)).body.user.id;
  assert.equal((await h.patch(`/api/staff/team/${ownerId}`, { password: 'Hacked@12345' }, owner)).status, 404);
});

const codeFor = (secret: string) => totp(base32Decode(secret), Math.floor(now() / 30000));
async function turnOnMfa(token: string): Promise<void> {
  const s = await h.post('/api/me/mfa/setup', {}, token);
  assert.equal((await h.post('/api/me/mfa/enable', { code: codeFor(s.body.secret) }, token)).status, 200);
}

test('TE-005 the owner resets a member\'s two-step sign-in: they sign in with just the password and their old sign-ins end', async () => {
  const owner = await h.login('owner1'), staff = await h.login('staff1');
  const id = await staffId(owner);
  await turnOnMfa(staff);
  const staffAgain = (await h.post('/api/auth/login', { email: DEMO_ACCOUNTS.staff1.email, password: DEMO_ACCOUNTS.staff1.password })).body;
  assert.equal(staffAgain.error?.code, 'MFA_REQUIRED');
  assert.equal((await h.get('/api/staff/team', owner)).body.items.find((m: any) => m.id === id).mfa, true, 'the Team page shows 2FA is on');
  const r = await h.patch(`/api/staff/team/${id}`, { resetMfa: true }, owner);
  assert.equal(r.status, 200);
  assert.equal((await h.get('/api/staff/team', owner)).body.items.find((m: any) => m.id === id).mfa, false);
  const s2 = await h.get('/api/me', staff);
  assert.equal(s2.status, 401, 'old sign-ins end');
  assert.equal((await h.post('/api/auth/login', { email: DEMO_ACCOUNTS.staff1.email, password: DEMO_ACCOUNTS.staff1.password })).status, 200);
  const a = one<{ detail: string }>("SELECT detail FROM audit_log WHERE action = 'staff.update' AND entity_id = ? ORDER BY id DESC LIMIT 1", id)!;
  assert.equal(JSON.parse(a.detail).mfaReset, true);
});

test('TE-006 the owner edits a customer\'s name, email, mobile and password; scoped to their own customers, owner only', async () => {
  const owner = await h.login('owner1'), cust = await h.login('customer'), staff = await h.login('staff1'), other = await h.login('owner2');
  const g = (await h.get('/api/grounds')).body.items[0];
  const custId = (await h.get('/api/me', cust)).body.user.id;
  // not yet their customer: nothing to edit
  assert.equal((await h.patch(`/api/staff/customers/${custId}`, { firstName: 'X' }, owner)).status, 404);
  await bookAndPay(h, cust, g.id, dayFromNow(3), '08:00');
  const det = await h.get(`/api/staff/customers/${custId}`, owner);
  assert.equal(det.status, 200, JSON.stringify(det.body).slice(0, 200));
  assert.equal((await h.patch(`/api/staff/customers/${custId}`, { firstName: 'Hacked' }, staff)).status, 403, 'a team member cannot');
  assert.equal((await h.patch(`/api/staff/customers/${custId}`, { firstName: 'Hacked' }, other)).status, 404, 'another business cannot');
  assert.equal((await h.patch(`/api/staff/customers/${custId}`, { email: DEMO_ACCOUNTS.staff1.email }, owner)).body.error.code, 'EMAIL_TAKEN');
  const r = await h.patch(`/api/staff/customers/${custId}`, { firstName: 'renamed', lastName: 'customer', email: 'renamed@daji.test', phone: '9811111111', password: 'Cust@New12345' }, owner);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.customer.name, 'Renamed Customer'); assert.equal(r.body.customer.email, 'renamed@daji.test');
  assert.equal((await h.get('/api/me', cust)).status, 401, 'old sign-ins end');
  assert.equal((await h.post('/api/auth/login', { email: 'renamed@daji.test', password: 'Cust@New12345' })).status, 200, 'new email and password');
  const a = one<{ detail: string; owner_id: string }>("SELECT detail, owner_id FROM audit_log WHERE action = 'customer.update' AND entity_id = ?", custId)!;
  assert.ok(!a.detail.includes('Cust@New12345') && !a.detail.includes('renamed@daji.test'));
  assert.equal(JSON.parse(a.detail).passwordReset, true);
});

test('TE-007 a customer who also books with another business can only be changed by themselves or the software owner', async () => {
  const owner = await h.login('owner1'), cust = await h.login('customer'), admin = await h.login('admin');
  const custId = (await h.get('/api/me', cust)).body.user.id;
  const mine = (await h.get('/api/grounds')).body.items[0];
  await bookAndPay(h, cust, mine.id, dayFromNow(3), '08:00');
  // the same customer at another owner's ground
  const owner1Id = (await h.get('/api/me', owner)).body.user.id;
  run("UPDATE bookings SET owner_id = (SELECT id FROM users WHERE email = ?) WHERE id = (SELECT id FROM bookings WHERE customer_id = ? LIMIT 1)", DEMO_ACCOUNTS.owner2.email, custId);
  await bookAndPay(h, cust, mine.id, dayFromNow(4), '10:00');
  const r = await h.patch(`/api/staff/customers/${custId}`, { password: 'Taken@12345' }, owner);
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'SHARED_CUSTOMER');
  assert.equal((await h.patch(`/api/staff/customers/${custId}?ownerId=${owner1Id}`, { firstName: 'Fixed' }, admin)).status, 200, 'the software owner can');
});
