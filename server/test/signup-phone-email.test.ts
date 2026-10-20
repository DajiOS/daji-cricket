import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, type Harness } from './helpers.ts';
import { normalizeIntlPhone } from '../src/input.ts';

let h: Harness;
before(async () => { h = await startHarness({ OTP_SIGNIN: 'on', RATE_LIMIT_DISABLED: '1' } as any); });
after(async () => { await h.close(); });

const signIn = (identifier: string, password: string, countryCode?: string) =>
  h.post('/api/auth/login', { identifier, password, ...(countryCode ? { countryCode } : {}) });

test('phone numbers are cleaned up with their country code', () => {
  assert.equal(normalizeIntlPhone('98765 43210'), '9876543210', 'India is the default, kept as 10 digits');
  assert.equal(normalizeIntlPhone('+91 98765-43210', '+44'), '9876543210', 'a +code written in the number wins');
  assert.equal(normalizeIntlPhone('09876543210', '+91'), '9876543210');
  assert.equal(normalizeIntlPhone('07911 123456', '+44'), '+447911123456', 'the trunk 0 is dropped');
  assert.equal(normalizeIntlPhone('+44 7911 123456'), '+447911123456');
  assert.equal(normalizeIntlPhone('0044 7911 123456'), '+447911123456');
  assert.equal(normalizeIntlPhone('(415) 555-0132', '1'), '+14155550132');
  assert.equal(normalizeIntlPhone('12345'), null);
  assert.equal(normalizeIntlPhone('+91 12345 67890'), null, 'an Indian mobile starts with 6 to 9');
  assert.equal(normalizeIntlPhone('123', '+44'), null);
  assert.equal(normalizeIntlPhone('7911123456', '+abc'), null);
});

test('sign-up needs both a mobile number and an email', async () => {
  const base = { firstName: 'Kiran', lastName: 'Rao', password: 'Cricket@123' };
  const noPhone = await h.post('/api/auth/register', { ...base, email: 'kiran@example.com' });
  assert.equal(noPhone.status, 400); assert.deepEqual(noPhone.body.error.details.fields.map((f: any) => f.field), ['phone']);
  const noEmail = await h.post('/api/auth/register', { ...base, phone: '9811000001' });
  assert.equal(noEmail.status, 400); assert.deepEqual(noEmail.body.error.details.fields.map((f: any) => f.field), ['email']);
  const badCode = await h.post('/api/auth/register', { ...base, email: 'kiran@example.com', phone: '9811000001', countryCode: 'India' });
  assert.equal(badCode.status, 400); assert.deepEqual(badCode.body.error.details.fields.map((f: any) => f.field), ['countryCode']);
});

test('after signing up with both, either the email or the mobile number signs in', async () => {
  const r = await h.post('/api/auth/register', { firstName: 'Kiran', lastName: 'Rao', email: 'Kiran.Rao@Example.com', countryCode: '+91', phone: '98110 00002', password: 'Cricket@123' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.user.phone, '9811000002');
  assert.equal(r.body.user.email, 'kiran.rao@example.com');
  for (const id of ['kiran.rao@example.com', '9811000002', '+91 98110 00002']) {
    const l = await signIn(id, 'Cricket@123');
    assert.equal(l.status, 200, `${id}: ${JSON.stringify(l.body)}`); assert.equal(l.body.user.id, r.body.user.id);
  }
  assert.equal((await signIn('9811000002', 'Wrong@12345')).status, 401);
});

test('a number from another country is stored in +E.164 form and signs in with its country code', async () => {
  const r = await h.post('/api/auth/register', { firstName: 'Tom', lastName: 'Hale', email: 'tom@example.co.uk', countryCode: '+44', phone: '07911 123456', password: 'Cricket@123' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.user.phone, '+447911123456');
  assert.equal((await signIn('+44 7911 123456', 'Cricket@123')).status, 200);
  assert.equal((await signIn('07911123456', 'Cricket@123', '+44')).status, 200);
  assert.equal((await signIn('7911123456', 'Cricket@123')).status, 401, 'without the code it is read as an Indian number');
  const bad = await h.post('/api/auth/register', { firstName: 'Tom', lastName: 'Hale', email: 'tom2@example.co.uk', countryCode: '+44', phone: '123', password: 'Cricket@123' });
  assert.equal(bad.status, 400); assert.deepEqual(bad.body.error.details.fields.map((f: any) => f.field), ['phone']);
});

test('an older account made with only a phone code can add an email and a password, then sign in with either', async () => {
  const code = (await h.post('/api/auth/otp/request', { phone: '9811000003' })).body.devCode as string;
  const a = await h.post('/api/auth/otp/verify', { phone: '9811000003', code, firstName: 'Old', lastName: 'Timer' });
  assert.equal(a.status, 201, JSON.stringify(a.body)); assert.equal(a.body.user.email, null);
  const me = await h.patch('/api/me', { email: 'old.timer@example.com' }, a.body.token);
  assert.equal(me.status, 200, JSON.stringify(me.body)); assert.equal(me.body.user.email, 'old.timer@example.com');
  const weak = await h.post('/api/me/password', { newPassword: 'short' }, a.body.token);
  assert.equal(weak.status, 400);
  const set = await h.post('/api/me/password', { newPassword: 'Cricket@123' }, a.body.token);
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal((await signIn('old.timer@example.com', 'Cricket@123')).status, 200);
  assert.equal((await signIn('9811000003', 'Cricket@123')).status, 200);
  // once there is a password, changing it needs the current one again
  const again = await h.post('/api/me/password', { newPassword: 'Cricket@456' }, set.body.token);
  assert.equal(again.status, 400);
});

test('the profile takes a mobile number with a country code', async () => {
  const r = await h.post('/api/auth/register', { firstName: 'Mia', lastName: 'Lee', email: 'mia@example.com', phone: '9811000004', password: 'Cricket@123' });
  const p = await h.patch('/api/me', { countryCode: '+971', phone: '050 123 4567' }, r.body.token);
  assert.equal(p.status, 200, JSON.stringify(p.body)); assert.equal(p.body.user.phone, '+971501234567');
  assert.equal((await signIn('+971 50 123 4567', 'Cricket@123')).status, 200);
});
