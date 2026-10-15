import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, type Harness } from './helpers.ts';
import { base32Decode, base32Encode, totp } from '../src/mfa.ts';
import { one } from '../src/db.ts';
import { now } from '../src/clock.ts';
import { setNow, T0 } from './helpers.ts';
import { ROLE_PRESETS } from '@daji/shared';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); setNow(T0); });

// ---- TOTP against the RFC 6238 test vectors (secret "12345678901234567890", 8 digits) ----
test('TOTP matches the RFC 6238 vectors', () => {
  const k = Buffer.from('12345678901234567890');
  const cases: [number, string][] = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']];
  for (const [t, want] of cases) assert.equal(totp(k, Math.floor(t / 30), 8), want, `t=${t}`);
});
test('base32 round-trips', () => {
  const b = Buffer.from('Daji cricket 2026');
  assert.deepEqual(base32Decode(base32Encode(b)), b);
  assert.equal(base32Encode(Buffer.from('foobar')), 'MZXW6YTBOI');
});

async function setupMfa(token: string): Promise<string> {
  const s = await h.post('/api/me/mfa/setup', {}, token);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.match(s.body.otpauthUrl, /^otpauth:\/\/totp\//);
  return s.body.secret as string;
}
const codeFor = (secret: string, plusSteps = 0) => totp(base32Decode(secret), Math.floor(now() / 30000) + plusSteps);

test('turning two-step sign-in on: setup does not change sign-in until a code is confirmed', async () => {
  const owner = await h.login('owner1');
  const secret = await setupMfa(owner);
  const plain = await h.post('/api/auth/login', { email: 'owner1@daji.test', password: 'Owner@12345' });
  assert.equal(plain.status, 200, 'not enabled yet');
  assert.equal((await h.post('/api/me/mfa/enable', { code: '000000' }, owner)).status, 400);
  const on = await h.post('/api/me/mfa/enable', { code: codeFor(secret) }, owner);
  assert.equal(on.status, 200, JSON.stringify(on.body));
  assert.equal((await h.get('/api/me/mfa', owner)).body.enabled, true);
  assert.ok(one("SELECT 1 x FROM audit_log WHERE action = 'mfa.enable'"));
});

test('with it on, sign-in needs the code, wrong or reused codes fail, and drift of one step is allowed', async () => {
  const owner = await h.login('owner1');
  const secret = await setupMfa(owner);
  await h.post('/api/me/mfa/enable', { code: codeFor(secret) }, owner);
  setNow(T0 + 60_000); // the used step is behind us now
  const creds = { email: 'owner1@daji.test', password: 'Owner@12345' };
  const none = await h.post('/api/auth/login', creds);
  assert.equal(none.status, 401); assert.equal(none.body.error.code, 'MFA_REQUIRED');
  assert.equal((await h.post('/api/auth/login', { ...creds, password: 'Wrong@12345', code: codeFor(secret) })).body.error.code, 'INVALID_LOGIN', 'password is checked first, so the code is not a way to probe');
  const bad = await h.post('/api/auth/login', { ...creds, code: '123456' });
  assert.equal(bad.body.error.code, 'MFA_INVALID');
  const good = await h.post('/api/auth/login', { ...creds, code: codeFor(secret, -1) });
  assert.equal(good.status, 200, JSON.stringify(good.body));
  const again = await h.post('/api/auth/login', { ...creds, code: codeFor(secret, -1) });
  assert.equal(again.body.error.code, 'MFA_INVALID', 'a code works once');
  const next = await h.post('/api/auth/login', { ...creds, code: codeFor(secret, 0) });
  assert.equal(next.status, 200);
});

test('turning it off needs the password and a code; customers cannot use it', async () => {
  const owner = await h.login('owner1');
  const secret = await setupMfa(owner);
  await h.post('/api/me/mfa/enable', { code: codeFor(secret) }, owner);
  setNow(T0 + 60_000);
  assert.equal((await h.post('/api/me/mfa/disable', { password: 'Wrong@12345', code: codeFor(secret) }, owner)).status, 403);
  assert.equal((await h.post('/api/me/mfa/disable', { password: 'Owner@12345', code: '111111' }, owner)).status, 400);
  assert.equal((await h.post('/api/me/mfa/disable', { password: 'Owner@12345', code: codeFor(secret) }, owner)).status, 200);
  assert.equal((await h.post('/api/auth/login', { email: 'owner1@daji.test', password: 'Owner@12345' })).status, 200);
  const cust = await h.login('customer');
  assert.equal((await h.post('/api/me/mfa/setup', {}, cust)).status, 403);
});

// ---- presets ----
test('a team member can be created from a preset, and an explicit list wins', async () => {
  const owner = await h.login('owner1');
  const list = await h.get('/api/staff/team', owner);
  assert.ok(list.body.presets.coach && list.body.allPermissions.includes('manage_academy'));
  const coach = await h.post('/api/staff/team', { name: 'Coach Karan', email: 'karan@daji.test', password: 'Coach@12345', preset: 'coach' }, owner);
  assert.equal(coach.status, 201, JSON.stringify(coach.body));
  assert.deepEqual([...coach.body.permissions].sort(), [...ROLE_PRESETS.coach!.permissions].sort());
  const custom = await h.post('/api/staff/team', { name: 'Desk Anil', email: 'anil@daji.test', password: 'Desk@12345', preset: 'front_desk', permissions: ['view_reports'] }, owner);
  assert.deepEqual(custom.body.permissions, ['view_reports']);
  const bad = await h.post('/api/staff/team', { name: 'X Y', email: 'x@daji.test', password: 'Desk@12345', preset: 'ceo' }, owner);
  assert.equal(bad.status, 400);
});

test('passwords need a capital, a small letter and a number', async () => {
  const owner = await h.login('owner1');
  for (const pw of ['alllowercase1', 'ALLUPPER12345', 'NoNumbersHere', 'Sh0rt']) {
    const r = await h.post('/api/staff/team', { name: 'Pw Test', email: `pw${pw.length}@daji.test`, password: pw }, owner);
    assert.equal(r.status, 400, pw);
  }
  assert.equal((await h.post('/api/staff/team', { name: 'Pw Test', email: 'pwok@daji.test', password: 'Good1234pass' }, owner)).status, 201);
});
