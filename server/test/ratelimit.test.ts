import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, type Harness } from './helpers.ts';
import { resetRateLimits } from '../src/http.ts';

let h: Harness;

// This file turns rate limiting ON (every other file runs with it off so they can hammer the API).
before(async () => { h = await startHarness({ RATE_LIMIT: 'on' }); });
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); resetRateLimits(); });

test('sign-in attempts are limited to 20 a minute per address', async () => {
  const attempt = () => h.post('/api/auth/login', { email: 'customer@daji.test', password: 'Wrong@12345' });
  for (let i = 0; i < 20; i++) assert.equal((await attempt()).status, 401);
  const blocked = await attempt();
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error.code, 'RATE_LIMITED');
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  // even the right password is refused while limited: guessing gets no feedback
  assert.equal((await h.post('/api/auth/login', { email: 'customer@daji.test', password: 'Customer@12345' })).status, 429);
});

test('the limit resets after the window', async () => {
  const { advance } = await import('./helpers.ts');
  for (let i = 0; i < 21; i++) await h.post('/api/auth/login', { email: 'x@y.co', password: 'nope1234' });
  assert.equal((await h.post('/api/auth/login', { email: 'customer@daji.test', password: 'Customer@12345' })).status, 429);
  advance(61_000);
  assert.equal((await h.post('/api/auth/login', { email: 'customer@daji.test', password: 'Customer@12345' })).status, 200);
});

test('the health check and payment webhooks are never rate limited', async () => {
  for (let i = 0; i < 650; i++) {
    const r = await h.get('/api/health');
    if (r.status !== 200) assert.fail(`health check limited at request ${i}`);
  }
});

test('ordinary API calls have a much higher ceiling than sign-in', async () => {
  for (let i = 0; i < 100; i++) assert.equal((await h.get('/api/grounds')).status, 200);
});
