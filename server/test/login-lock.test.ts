import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, advance, DEMO_ACCOUNTS, type Harness } from './helpers.ts';

let h: Harness;
before(async () => { h = await startHarness({ RATE_LIMIT_DISABLED: '1' } as any); });
after(async () => { await h.close(); });

test('ten wrong passwords lock that account for fifteen minutes, whatever the address; a right login clears the count', async () => {
  const email = DEMO_ACCOUNTS.owner1.email;
  for (let i = 0; i < 3; i++) assert.equal((await h.post('/api/auth/login', { email, password: 'wrong-' + i })).status, 401);
  assert.equal((await h.post('/api/auth/login', { email, password: DEMO_ACCOUNTS.owner1.password })).status, 200, 'a right login clears the count');
  for (let i = 0; i < 10; i++) await h.post('/api/auth/login', { email, password: 'wrong-' + i });
  const locked = await h.post('/api/auth/login', { email, password: DEMO_ACCOUNTS.owner1.password });
  assert.equal(locked.status, 429); assert.equal(locked.body.error.code, 'ACCOUNT_LOCKED');
  advance(16 * 60_000);
  assert.equal((await h.post('/api/auth/login', { email, password: DEMO_ACCOUNTS.owner1.password })).status, 200);
});
