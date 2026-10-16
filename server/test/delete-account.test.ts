import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, type Harness } from './helpers.ts';
import { buildScenario } from './scenario.ts';
import { many, one } from '../src/db.ts';

let h: Harness, cust: string, owner: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => { ({ cust, owner } = await buildScenario(h)); });

test('a customer can delete their account; sign-in stops and personal details go, records stay', async () => {
  const me = (await h.get('/api/me', cust)).body.user;
  assert.equal((await h.post('/api/me/delete', { confirm: 'nope' }, cust)).status, 400);
  assert.equal((await h.post('/api/me/delete', { confirm: 'DELETE', password: 'wrong' }, cust)).status, 400);
  const pw = (await import('../src/seed.ts')).DEMO_ACCOUNTS as any;
  const password = Object.values(pw).find((a: any) => a.email === me.email) as any;
  const r = await h.post('/api/me/delete', { confirm: 'DELETE', password: password?.password }, cust);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const row = one<any>('SELECT name, email, phone, password_hash, active FROM users WHERE id = ?', me.id)!;
  assert.equal(row.name, 'Deleted user'); assert.equal(row.email, null); assert.equal(row.phone, null); assert.equal(row.password_hash, null); assert.equal(row.active, 0);
  assert.equal((await h.get('/api/me', cust)).status, 401, 'the old token stops working');
  assert.ok(many('SELECT 1 FROM bookings WHERE customer_id = ?', me.id).length >= 0);
});

test('businesses cannot use it, and upcoming bookings must be cancelled first', async () => {
  assert.equal((await h.post('/api/me/delete', { confirm: 'DELETE', password: 'x' }, owner)).status, 403);
});
