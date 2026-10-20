import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, advance, DEMO_ACCOUNTS, type Harness } from './helpers.ts';
import { registerProvider, type Outgoing } from '../src/notifications.ts';
import { createUser } from '../src/auth.ts';
import { one, run } from '../src/db.ts';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { registerProvider('email', null); await h.close(); });
beforeEach(() => { registerProvider('email', null); h.reset(); });

const email = DEMO_ACCOUNTS.customer.email;
const NEW_PW = 'NewPassw0rd';
const ask = async (to: string) => { const r = await h.post('/api/auth/password/forgot', { email: to }); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.devCode as string | undefined; };
const settle = () => new Promise((r) => setImmediate(r));

test('a code from the email and a new password set the password; the old one stops working', async () => {
  const code = (await ask(email))!;
  assert.match(code, /^\d{6}$/);
  const r = await h.post('/api/auth/password/reset', { email, code, password: NEW_PW });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await h.post('/api/auth/login', { email, password: DEMO_ACCOUNTS.customer.password })).status, 401);
  assert.equal((await h.post('/api/auth/login', { email, password: NEW_PW })).status, 200);
  assert.equal((await h.post('/api/auth/password/reset', { email, code, password: 'Another1Pw' })).status, 400, 'a code works once');
});

test('a reset signs out every device', async () => {
  const token = await h.login('customer');
  assert.equal((await h.get('/api/me', token)).status, 200);
  const code = (await ask(email))!;
  assert.equal((await h.post('/api/auth/password/reset', { email, code, password: NEW_PW })).status, 200);
  assert.equal((await h.get('/api/me', token)).status, 401);
});

test('the email is matched without caring about capitals or spaces', async () => {
  const code = (await ask('  ' + email.toUpperCase()))!;
  assert.equal((await h.post('/api/auth/password/reset', { email, code, password: NEW_PW })).status, 200);
});

test('five wrong codes lock the code', async () => {
  const code = (await ask(email))!;
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) assert.equal((await h.post('/api/auth/password/reset', { email, code: wrong, password: NEW_PW })).status, 400);
  const r = await h.post('/api/auth/password/reset', { email, code, password: NEW_PW });
  assert.equal(r.status, 429); assert.equal(r.body.error.code, 'RESET_LOCKED');
});

test('the code expires after fifteen minutes', async () => {
  const code = (await ask(email))!;
  advance(15 * 60_000 + 1);
  const r = await h.post('/api/auth/password/reset', { email, code, password: NEW_PW });
  assert.equal(r.status, 400); assert.equal(r.body.error.code, 'RESET_INVALID');
});

test('a weak password is refused and does not use up the code', async () => {
  const code = (await ask(email))!;
  const weak = await h.post('/api/auth/password/reset', { email, code, password: 'short' });
  assert.equal(weak.status, 400); assert.equal(weak.body.error.details.fields[0].field, 'password');
  assert.equal((await h.post('/api/auth/password/reset', { email, code, password: NEW_PW })).status, 200);
});

test('codes cannot be asked for too fast or too often', async () => {
  await ask(email);
  const again = await h.post('/api/auth/password/forgot', { email });
  assert.equal(again.status, 429); assert.equal(again.body.error.code, 'RESET_WAIT');
  for (let i = 0; i < 4; i++) { advance(61_000); await ask(email); }
  advance(61_000);
  const r = await h.post('/api/auth/password/forgot', { email });
  assert.equal(r.status, 429); assert.equal(r.body.error.code, 'RESET_LIMIT');
});

test('only the newest code works', async () => {
  const first = (await ask(email))!;
  advance(61_000);
  const second = (await ask(email))!;
  if (first !== second) assert.equal((await h.post('/api/auth/password/reset', { email, code: first, password: NEW_PW })).status, 400);
  assert.equal((await h.post('/api/auth/password/reset', { email, code: second, password: NEW_PW })).status, 200);
});

test('with email set up: the code goes by email, and an unknown email gets the same answer with nothing sent', async () => {
  const sent: Outgoing[] = [];
  registerProvider('email', (m) => { sent.push(m); return { ok: true }; });
  const known = await h.post('/api/auth/password/forgot', { email });
  const unknown = await h.post('/api/auth/password/forgot', { email: 'nobody@example.com' });
  await settle();
  assert.equal(known.status, 200); assert.equal(unknown.status, 200);
  assert.deepEqual(known.body, unknown.body, 'the reply does not show whether the account exists');
  assert.equal(known.body.devCode, undefined);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.to, email); assert.equal(sent[0]!.subject, 'Your password reset code');
  const code = sent[0]!.body.match(/\b(\d{6})\b/)![1]!;
  assert.equal((await h.post('/api/auth/password/reset', { email, code, password: NEW_PW })).status, 200);
  const r = await h.post('/api/auth/password/reset', { email: 'nobody@example.com', code: '123456', password: NEW_PW });
  assert.equal(r.status, 400); assert.equal(r.body.error.code, 'RESET_INVALID');
  assert.equal(one<{ n: number }>('SELECT COUNT(*) n FROM password_resets WHERE code_hash = ?', code)!.n, 0, 'the code is stored only as a hash');
});

test('an unknown email is limited the same way as a real one', async () => {
  registerProvider('email', () => ({ ok: true }));
  await h.post('/api/auth/password/forgot', { email: 'nobody@example.com' });
  const r = await h.post('/api/auth/password/forgot', { email: 'nobody@example.com' });
  assert.equal(r.status, 429); assert.equal(r.body.error.code, 'RESET_WAIT');
});

test('someone added at the desk or by phone code with no password can set one', async () => {
  createUser({ role: 'customer', name: 'Desk Person', email: 'desk@example.com', phone: '9811100000' });
  const code = (await ask('desk@example.com'))!;
  assert.ok(code, 'a code is made for an account with no password');
  assert.equal((await h.post('/api/auth/password/reset', { email: 'desk@example.com', code, password: NEW_PW })).status, 200);
  assert.equal((await h.post('/api/auth/login', { email: 'desk@example.com', password: NEW_PW })).status, 200);
});

test('a disabled account gets no code', async () => {
  createUser({ role: 'customer', name: 'Off Person', email: 'off@example.com', password: 'Passw0rdXyz' });
  run("UPDATE users SET active = 0 WHERE email = 'off@example.com'");
  assert.equal(await ask('off@example.com'), undefined);
});

test('a reset clears a sign-in lock from wrong passwords', async () => {
  for (let i = 0; i < 10; i++) await h.post('/api/auth/login', { email, password: 'wrong-' + i });
  assert.equal((await h.post('/api/auth/login', { email, password: DEMO_ACCOUNTS.customer.password })).status, 429);
  const code = (await ask(email))!;
  assert.equal((await h.post('/api/auth/password/reset', { email, code, password: NEW_PW })).status, 200);
  assert.equal((await h.post('/api/auth/login', { email, password: NEW_PW })).status, 200);
});

test('without email set up and outside demo mode, the reset says so plainly', async () => {
  h.cfg.demoMode = false;
  try {
    const r = await h.post('/api/auth/password/forgot', { email });
    assert.equal(r.status, 503); assert.equal(r.body.error.code, 'EMAIL_NOT_CONFIGURED');
  } finally { h.cfg.demoMode = true; }
});
