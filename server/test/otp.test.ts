import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, advance, type Harness } from './helpers.ts';

let h: Harness;
before(async () => { h = await startHarness({ OTP_SIGNIN: 'on' }); });
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); });

const ask = async (phone: string) => { const r = await h.post('/api/auth/otp/request', { phone }); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.devCode as string; };

test('a phone number and a code create an account, with names starting in capitals', async () => {
  const code = await ask('9811122233');
  assert.match(code, /^\d{6}$/);
  const r = await h.post('/api/auth/otp/verify', { phone: '9811122233', code, firstName: 'ravi', lastName: 'patel' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.user.name, 'Ravi Patel'); assert.equal(r.body.user.firstName, 'Ravi'); assert.equal(r.body.user.lastName, 'Patel');
  assert.equal(r.body.user.phone, '9811122233'); assert.equal(r.body.user.role, 'customer');
  assert.equal((await h.get('/api/me', r.body.token)).status, 200);
});

test('the same number signs in again to the same account, and a code works once', async () => {
  const c1 = await ask('9811122233');
  const a = await h.post('/api/auth/otp/verify', { phone: '9811122233', code: c1, firstName: 'Ravi', lastName: 'Patel' });
  advance(31_000);
  const c2 = await ask('9811122233');
  const b = await h.post('/api/auth/otp/verify', { phone: '9811122233', code: c2 });
  assert.equal(b.status, 200, JSON.stringify(b.body)); assert.equal(b.body.created, false); assert.equal(b.body.user.id, a.body.user.id);
  assert.equal((await h.post('/api/auth/otp/verify', { phone: '9811122233', code: c2 })).status, 400, 'used code');
});

test('a wrong code is refused and five wrong tries lock the code', async () => {
  const code = await ask('9811122233');
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) assert.equal((await h.post('/api/auth/otp/verify', { phone: '9811122233', code: wrong, firstName: 'A', lastName: 'B' })).status, 400);
  const r = await h.post('/api/auth/otp/verify', { phone: '9811122233', code, firstName: 'A', lastName: 'B' });
  assert.equal(r.status, 429); assert.equal(r.body.error.code, 'OTP_LOCKED');
});

test('an unknown number needs a name, and the code is kept for the retry', async () => {
  const code = await ask('9811122233');
  const r = await h.post('/api/auth/otp/verify', { phone: '9811122233', code });
  assert.equal(r.status, 400); assert.equal(r.body.error.code, 'NAME_REQUIRED');
  assert.equal((await h.post('/api/auth/otp/verify', { phone: '9811122233', code, firstName: 'Asha', lastName: 'Shah' })).status, 201);
});

test('codes cannot be asked for too fast, and bad numbers are refused', async () => {
  await ask('9811122233');
  const again = await h.post('/api/auth/otp/request', { phone: '9811122233' });
  assert.equal(again.status, 429); assert.equal(again.body.error.code, 'OTP_WAIT');
  assert.equal((await h.post('/api/auth/otp/request', { phone: '12345' })).status, 400);
});

test('owners and staff cannot be taken over by code; they use their password', async () => {
  // the demo owner's phone is 9000000002; no customer owns it, so a code would only make a new customer, never sign in as the owner
  const code = await ask('9000000002');
  const r = await h.post('/api/auth/otp/verify', { phone: '9000000002', code, firstName: 'Some', lastName: 'One' });
  assert.equal(r.status, 201); assert.equal(r.body.user.role, 'customer');
});

test('password sign-up also capitalises first and last name', async () => {
  const r = await h.post('/api/auth/register', { firstName: 'neha', lastName: 'shah', email: 'neha2@example.com', phone: '9800011199', password: 'Passw0rdXyz' });
  assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.user.name, 'Neha Shah');
});

test('the admin can edit first and last name; capitals are kept', async () => {
  const code = await ask('9811122233');
  const a = await h.post('/api/auth/otp/verify', { phone: '9811122233', code, firstName: 'Ravi', lastName: 'Patel' });
  const admin = await h.login('admin');
  const r = await h.patch(`/api/admin/users/${a.body.user.id}`, { firstName: 'ravindra', lastName: 'patel' }, admin);
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.name, 'Ravindra Patel'); assert.equal(r.body.firstName, 'Ravindra');
  const list = await h.get('/api/admin/users?q=ravindra', admin);
  assert.equal(list.body.items[0].lastName, 'Patel');
  assert.equal((await h.patch(`/api/admin/users/${a.body.user.id}`, { firstName: 'ravi' }, a.body.token)).status, 403);
});

test('an account can be made with just an email and a password', async () => {
  const r = await h.post('/api/auth/register', { firstName: 'asha', lastName: 'shah', email: 'asha@example.com', password: 'Passw0rdXyz' });
  assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.user.name, 'Asha Shah'); assert.equal(r.body.user.phone, null);
  assert.equal((await h.post('/api/auth/login', { email: 'asha@example.com', password: 'Passw0rdXyz' })).status, 200);
});
