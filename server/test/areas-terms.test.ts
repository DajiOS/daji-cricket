// Team terms when a person works in two businesses (areas.ts team memberships). Each business has its own terms; accepting the
// ground's does not count in Sunny's Portfolio, and accepting Sunny's Portfolio's terms twice (two devices) never fails.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, type Harness } from './helpers.ts';

let h: Harness;
before(async () => { h = await startHarness({ REQUIRE_STAFF_TERMS: 'on' }); });
after(async () => { await h.close(); });

test('the supervisor accepts each business\'s own terms once, and Sunny sees the acceptance in his report', async () => {
  const sunny = await h.login('owner1');
  const b = await h.post('/api/me/portfolio', { businessName: "Sunny's Portfolio", ownerName: 'Sunny Patel', phone: '9876500011', email: 'portfolio@daji.test' }, sunny);
  assert.equal(b.status, 201, JSON.stringify(b.body));
  const SP = { 'x-daji-business': b.body.id };
  const s = await h.post('/api/staff/team', { firstName: 'Ramesh', lastName: 'Supervisor', email: 'supervisor@daji.test', password: 'Supervisor-Cash-2026!', permissions: ['manage_tasks'] }, sunny);
  assert.equal(s.status, 201, JSON.stringify(s.body));
  assert.equal((await h.call('POST', '/api/staff/team-memberships', { token: sunny, headers: SP, body: { email: 'supervisor@daji.test', permissions: ['manage_tasks'] } })).status, 201);
  const sup = (await h.post('/api/auth/login', { email: 'supervisor@daji.test', password: 'Supervisor-Cash-2026!' })).body.token;

  // the ground's terms first
  const g = await h.get('/api/legal/staff-terms', sup);
  assert.equal((await h.post('/api/legal/staff-terms/accept', { version: g.body.version, sha256: g.body.sha256 }, sup)).status, 200);
  assert.equal((await h.get('/api/tasks', sup)).status, 200);

  // in Sunny's Portfolio the ground's acceptance does not count: its own terms are shown, not yet accepted
  const blocked = await h.call('GET', '/api/tasks', { token: sup, headers: SP });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, 'TERMS_REQUIRED');
  const t = await h.call('GET', '/api/legal/staff-terms', { token: sup, headers: SP });
  assert.match(t.body.body, /Sunny's Portfolio/);
  assert.equal(t.body.accepted, null);
  const accept = () => h.call('POST', '/api/legal/staff-terms/accept', { token: sup, headers: SP, body: { version: t.body.version, sha256: t.body.sha256 } });
  const first = await accept();
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.accepted.sha256, t.body.sha256);
  assert.equal((await accept()).status, 200); // a second device accepting again is fine, not a server error
  assert.equal((await h.call('GET', '/api/tasks', { token: sup, headers: SP })).status, 200);
  assert.equal((await h.get('/api/tasks', sup)).status, 200); // the ground is unaffected

  // Sunny's report for Sunny's Portfolio lists the supervisor he added, with the acceptance
  const rep = await h.call('GET', '/api/legal/staff-terms/report', { token: sunny, headers: SP });
  assert.equal(rep.status, 200, JSON.stringify(rep.body));
  const row = rep.body.items.find((r: any) => r.userId === s.body.id);
  assert.ok(row && row.acceptedAt, JSON.stringify(rep.body.items));
});
