import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, type Harness } from './helpers.ts';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });

test('phone code sign-in is off unless OTP_SIGNIN is on, and password sign-up still works', async () => {
  assert.equal((await h.get('/api/config')).body.codesEnabled, false);
  const r = await h.post('/api/auth/otp/request', { phone: '9811122233' });
  assert.equal(r.status, 404);
  assert.equal(r.body.error?.code ?? r.body.code, 'OTP_OFF');
  assert.equal((await h.post('/api/auth/otp/verify', { phone: '9811122233', code: '123456' })).status, 404);
  const reg = await h.post('/api/auth/register', { firstName: 'Ravi', lastName: 'Patel', email: 'ravi.otpoff@example.com', password: 'Cricket@123' });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  assert.ok(reg.body.token);
});
