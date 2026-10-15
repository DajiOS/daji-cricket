import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, type Harness } from './helpers.ts';

let h: Harness; let owner: string, coach: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset(); owner = await h.login('owner1');
  assert.equal((await h.post('/api/staff/team', { name: 'Coach Karan', email: 'karan@daji.test', password: 'Coach@12345', preset: 'coach' }, owner)).status, 201);
  coach = (await h.post('/api/auth/login', { email: 'karan@daji.test', password: 'Coach@12345' })).body.token;
});
const kid = (n: string) => h.post('/api/staff/academy/students', { name: n, guardianName: 'Parent', guardianEmail: `${n.toLowerCase()}@example.com` }, owner);

test('fees are raised per active student, paid in parts, and cannot be overpaid', async () => {
  await kid('Aarav'); await kid('Veer');
  const r = await h.post('/api/staff/academy/fees', { month: '2026-10', amountPaise: 300000 }, owner);
  assert.equal(r.status, 201); assert.equal(r.body.created, 2);
  assert.equal((await h.post('/api/staff/academy/fees', { month: '2026-10', amountPaise: 300000 }, owner)).body.created, 0, 'no duplicates');
  const l = await h.get('/api/staff/academy/fees?month=2026-10', owner);
  assert.equal(l.body.billedPaise, 600000); assert.equal(l.body.outstandingPaise, 600000);
  const id = l.body.items[0].id;
  assert.equal((await h.post(`/api/staff/academy/fees/${id}/payments`, { amountPaise: 100000, mode: 'upi', receivedOn: '2026-10-05' }, owner)).body.status, 'part');
  assert.equal((await h.post(`/api/staff/academy/fees/${id}/payments`, { amountPaise: 250000 }, owner)).status, 409);
  assert.equal((await h.post(`/api/staff/academy/fees/${id}/payments`, { amountPaise: 200000, receivedOn: '2026-10-07' }, owner)).body.status, 'paid');
});

test('the coach share is not assumed: no split until the owner records agreed terms', async () => {
  await kid('Aarav'); await h.post('/api/staff/academy/fees', { month: '2026-10', amountPaise: 300000 }, owner);
  const id = (await h.get('/api/staff/academy/fees?month=2026-10', owner)).body.items[0].id;
  await h.post(`/api/staff/academy/fees/${id}/payments`, { amountPaise: 300000, receivedOn: '2026-10-05' }, owner);
  let s = (await h.get('/api/staff/academy/share/statement?month=2026-10', owner)).body;
  assert.equal(s.collectedPaise, 300000); assert.equal(s.coachSharePaise, null); assert.equal(s.share.agreed, false);
  assert.equal((await h.put('/api/staff/academy/share', { percent: 30 }, coach)).status, 403, 'only the owner sets the terms');
});

test('once terms are recorded the statement splits the month, and clearing returns to not agreed', async () => {
  await kid('Aarav'); await h.post('/api/staff/academy/fees', { month: '2026-10', amountPaise: 300000 }, owner);
  const id = (await h.get('/api/staff/academy/fees?month=2026-10', owner)).body.items[0].id;
  await h.post(`/api/staff/academy/fees/${id}/payments`, { amountPaise: 300000, receivedOn: '2026-10-05' }, owner);
  assert.equal((await h.put('/api/staff/academy/share', { partyName: 'Munaf Patel', percent: 40 }, owner)).status, 200);
  const s = (await h.get('/api/staff/academy/share/statement?month=2026-10', owner)).body;
  assert.equal(s.coachSharePaise, 120000); assert.equal(s.academyKeepsPaise, 180000);
  await h.put('/api/staff/academy/share', { percent: null }, owner);
  assert.equal((await h.get('/api/staff/academy/share/statement?month=2026-10', owner)).body.coachSharePaise, null);
});
