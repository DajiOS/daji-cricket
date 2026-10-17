import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, type Harness } from './helpers.ts';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); });

test('signing out kills that token on the server, not just in the browser', async () => {
  const a = await h.login('owner1'), b = await h.login('owner1');
  assert.equal((await h.get('/api/me', a)).status, 200);
  assert.equal((await h.post('/api/auth/logout', {}, a)).status, 200);
  assert.equal((await h.get('/api/me', a)).status, 401);   // the copy of that token is dead
  assert.equal((await h.get('/api/me', b)).status, 200);   // the other device is untouched
  assert.equal((await h.post('/api/auth/logout', {}, a)).status, 200); // repeating is harmless
});

test('sign out everywhere ends every token', async () => {
  const a = await h.login('owner1'), b = await h.login('owner1');
  assert.equal((await h.post('/api/auth/logout-all', {}, a)).status, 200);
  assert.equal((await h.get('/api/me', a)).status, 401);
  assert.equal((await h.get('/api/me', b)).status, 401);
  assert.equal((await h.post('/api/auth/logout-all', {})).status, 401);
});
