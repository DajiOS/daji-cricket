// Business -> Area -> Project (Sunny, 30 Oct 2026). Sunny's Portfolio is a business of its own in his portfolio, kept apart from
// Daji Cricket Ground's books, with branches (areas) Office, House, Personal and Loans. Personal and Loans are restricted: nobody but
// Sunny sees them until he gives access. The supervisor is employed at the ground and is also on Sunny's Portfolio's team, with only
// the permissions given there. These tests try every way round the walls: other branches, other businesses, changed ids.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, type Harness } from './helpers.ts';
import { many } from '../src/db.ts';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });

const SUP_PASSWORD = 'Supervisor-Cash-2026!';
interface World { sunny: string; sunnyId: string; spId: string; sup: string; supId: string; office: string; house: string; personal: string; loans: string }
let w: World;

/** Sunny working in Sunny's Portfolio (the portfolio switch). */
const asSP = (headers: Record<string, string> = {}) => ({ 'x-daji-business': w.spId, ...headers });
const sp = <T = any>(method: string, path: string, token: string, body?: unknown) => h.call<T>(method, path, { token, body, headers: asSP() });

async function login(email: string, password: string): Promise<string> {
  const r = await h.post('/api/auth/login', { email, password });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.token;
}

async function world(): Promise<World> {
  h.reset();
  const sunny = await h.login('owner1');
  const sunnyId = (await h.get('/api/me', sunny)).body.user.id;
  const b = await h.post('/api/me/portfolio', { businessName: "Sunny's Portfolio", ownerName: 'Sunny Patel', phone: '9876500011', email: 'portfolio@daji.test' }, sunny);
  assert.equal(b.status, 201, JSON.stringify(b.body));
  const spId = b.body.id;
  w = { sunny, sunnyId, spId } as World;
  const area = async (name: string, restricted = false) => { const r = await sp('POST', '/api/areas', sunny, { name, restricted }); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.id as string; };
  w.office = await area('Office'); w.house = await area('House'); w.personal = await area('Personal', true); w.loans = await area('Loans', true);
  // the supervisor works at the ground (Daji Cricket Ground's team) with bookings and jobs
  const s = await h.post('/api/staff/team', { firstName: 'Ramesh', lastName: 'Supervisor', email: 'supervisor@daji.test', password: SUP_PASSWORD, permissions: ['manage_bookings', 'manage_tasks'] }, sunny);
  assert.equal(s.status, 201, JSON.stringify(s.body));
  w.supId = s.body.id;
  const m = await sp('POST', '/api/staff/team-memberships', sunny, { email: 'supervisor@daji.test', permissions: ['manage_tasks'] });
  assert.equal(m.status, 201, JSON.stringify(m.body));
  w.sup = await login('supervisor@daji.test', SUP_PASSWORD);
  return w;
}
beforeEach(async () => { await world(); });

test('Sunny\'s Portfolio starts as "support" and Sunny marks it his own; another owner cannot touch his portfolio', async () => {
  let pf = (await h.get('/api/me/portfolio', w.sunny)).body.items;
  assert.deepEqual(pf.map((x: any) => [x.businessName, x.relation]), [['Daji Cricket Ground', 'mine'], ["Sunny's Portfolio", 'support']]);
  const r = await h.patch(`/api/me/portfolio/${w.spId}`, { relation: 'mine' }, w.sunny);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  pf = (await h.get('/api/me/portfolio', w.sunny)).body.items;
  assert.equal(pf[1].relation, 'mine');
  assert.equal((await h.patch(`/api/me/portfolio/${w.spId}`, { relation: 'everything' }, w.sunny)).status, 400);
  const other = await h.login('owner2');
  assert.equal((await h.patch(`/api/me/portfolio/${w.spId}`, { relation: 'mine' }, other)).status, 404);
  const a = many<{ actor_id: string }>("SELECT actor_id FROM audit_log WHERE action = 'portfolio.relation'");
  assert.deepEqual(a.map((x) => x.actor_id), [w.sunnyId]);
});

test('branches: the owner sees all four; the supervisor sees only the unrestricted ones; names are unique; only the owner sets them up', async () => {
  const mine = (await sp('GET', '/api/areas', w.sunny)).body.items.map((a: any) => a.name);
  assert.deepEqual(mine, ['House', 'Loans', 'Office', 'Personal']);
  const his = (await sp('GET', '/api/areas', w.sup)).body.items.map((a: any) => a.name);
  assert.deepEqual(his, ['House', 'Office']);
  assert.equal((await sp('POST', '/api/areas', w.sunny, { name: 'office' })).status, 409);
  assert.equal((await sp('POST', '/api/areas', w.sup, { name: 'Garden' })).status, 403);
  assert.equal((await sp('PATCH', `/api/areas/${w.office}`, w.sup, { name: 'Mine now' })).status, 403);
  // the ground has no branches of its own, and never sees Sunny's Portfolio's
  assert.deepEqual((await h.get('/api/areas', w.sunny)).body.items, []);
  assert.equal((await h.patch(`/api/areas/${w.office}`, { name: 'Moved' }, w.sunny)).status, 404);
  // the audit names Sunny, not the business he switched to
  const a = many<{ actor_id: string; owner_id: string }>("SELECT actor_id, owner_id FROM audit_log WHERE action = 'area.create'");
  assert.equal(a.length, 4);
  for (const x of a) { assert.equal(x.actor_id, w.sunnyId); assert.equal(x.owner_id, w.spId); }
});

test('projects and jobs in a restricted branch are not there for the supervisor, by list or by id', async () => {
  const house = await sp('POST', '/api/projects', w.sunny, { name: 'House interior', areaId: w.house });
  const personal = await sp('POST', '/api/projects', w.sunny, { name: 'Personal errands', areaId: w.personal });
  assert.equal(house.status, 201, JSON.stringify(house.body));
  assert.equal(house.body.areaName, 'House');
  const hidden = await sp('POST', '/api/tasks', w.sunny, { title: 'Pay the jeweller', projectId: personal.body.id, photosRequired: 0 });
  const seen = await sp('POST', '/api/tasks', w.sunny, { title: 'Find a poker table', projectId: house.body.id, assignedTo: w.supId, photosRequired: 0 });
  assert.equal(hidden.status, 201, JSON.stringify(hidden.body));
  assert.equal(seen.status, 201, JSON.stringify(seen.body)); // the supervisor can be given a job here: he is on this team

  const projects = (await sp('GET', '/api/projects', w.sup)).body.items.map((p: any) => p.name);
  assert.deepEqual(projects, ['House interior']);
  const tasks = (await sp('GET', '/api/tasks', w.sup)).body.items.map((t: any) => t.title);
  assert.deepEqual(tasks, ['Find a poker table']);
  assert.equal((await sp('GET', `/api/tasks/${hidden.body.id}`, w.sup)).status, 404);
  assert.equal((await sp('PATCH', `/api/tasks/${hidden.body.id}`, w.sup, { title: 'Changed' })).status, 404);
  assert.equal((await sp('PATCH', `/api/projects/${personal.body.id}`, w.sup, { name: 'Changed' })).status, 404);
  assert.equal((await sp('POST', `/api/projects/${personal.body.id}/milestones`, w.sup, { title: 'Peek' })).status, 404);
  assert.equal((await sp('GET', `/api/tasks?projectId=${personal.body.id}`, w.sup)).body.items.length, 0);
  // he cannot file a project into a restricted branch either
  assert.equal((await sp('POST', '/api/projects', w.sup, { name: 'Sneaky', areaId: w.loans })).status, 400);
  // the owner sees both
  assert.equal((await sp('GET', '/api/tasks', w.sunny)).body.items.length, 2);
});

test('a project can only use a branch of its own business', async () => {
  const r = await h.post('/api/projects', { name: 'Ground roller', areaId: w.office }, w.sunny); // Daji Cricket Ground, Sunny's Portfolio's branch
  assert.equal(r.status, 400, JSON.stringify(r.body));
  const ok = await h.post('/api/projects', { name: 'Ground roller' }, w.sunny);
  assert.equal(ok.status, 201);
  assert.equal(ok.body.areaId, null);
  assert.equal((await h.patch(`/api/projects/${ok.body.id}`, { areaId: w.house }, w.sunny)).status, 400);
});

test('Sunny gives the supervisor a restricted branch, then takes it back', async () => {
  const set = await sp('PUT', `/api/staff/team/${w.supId}/areas`, w.sunny, { areaIds: [w.house, w.personal] });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  w.sup = await login('supervisor@daji.test', SUP_PASSWORD); // the change signs him out so his screens reload
  assert.deepEqual((await sp('GET', '/api/areas', w.sup)).body.items.map((a: any) => a.name), ['House', 'Personal']);
  const all = await sp('PUT', `/api/staff/team/${w.supId}/areas`, w.sunny, { all: true });
  assert.equal(all.status, 200);
  assert.equal(all.body.all, true);
  w.sup = await login('supervisor@daji.test', SUP_PASSWORD);
  assert.deepEqual((await sp('GET', '/api/areas', w.sup)).body.items.map((a: any) => a.name), ['House', 'Office']);
  // a branch of another business, or a person not on this team, is refused
  assert.equal((await sp('PUT', `/api/staff/team/${w.supId}/areas`, w.sunny, { areaIds: ['area_nothere'] })).status, 400);
  const other = await h.login('owner2');
  assert.equal((await h.put(`/api/staff/team/${w.supId}/areas`, { all: true }, other)).status, 404);
  assert.equal((await sp('PUT', `/api/staff/team/${w.supId}/areas`, w.sup, { all: true })).status, 403);
});

test('the supervisor works in the ground and in Sunny\'s Portfolio, with each business\'s own permissions, and nowhere else', async () => {
  const list = (await h.get('/api/me/businesses', w.sup)).body.items;
  assert.deepEqual(list.map((b: any) => [b.businessName, b.own]), [['Daji Cricket Ground', true], ["Sunny's Portfolio", false]]);
  // at the ground he sees bookings; in Sunny's Portfolio he was given jobs only
  assert.equal((await h.get('/api/staff/bookings', w.sup)).status, 200);
  assert.equal((await sp('GET', '/api/staff/bookings', w.sup)).status, 403);
  // jobs he adds in Sunny's Portfolio belong to Sunny's Portfolio, and the audit names him
  const t = await sp('POST', '/api/tasks', w.sup, { title: 'Office printer ink', photosRequired: 0 });
  assert.equal(t.status, 201, JSON.stringify(t.body));
  assert.equal((await h.get(`/api/tasks/${t.body.id}`, w.sup)).status, 404); // not a ground job
  const a = many<{ actor_id: string; actor_role: string; owner_id: string }>("SELECT actor_id, actor_role, owner_id FROM audit_log WHERE action = 'task.create' AND entity_id = ?", t.body.id);
  assert.deepEqual(a.map((x) => ({ ...x })), [{ actor_id: w.supId, actor_role: 'staff', owner_id: w.spId }]);
  // a business he is not on: refused, never answered as his own
  const other = (await h.get('/api/me', await h.login('owner2'))).body.user.id;
  const r = await h.call('GET', '/api/tasks', { token: w.sup, headers: { 'x-daji-business': other } });
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, 'NOT_ON_TEAM');
});

test('only an owner who holds the person\'s business can add them; taking them off closes the door at once', async () => {
  const other = await h.login('owner2');
  const r = await h.post('/api/staff/team-memberships', { email: 'supervisor@daji.test', permissions: [] }, other);
  assert.equal(r.status, 404, JSON.stringify(r.body));
  assert.equal((await sp('POST', '/api/staff/team-memberships', w.sunny, { email: 'staff1@daji.test', permissions: ['launch_rockets'] })).status, 400);
  const team = (await sp('GET', '/api/staff/team-memberships', w.sunny)).body.items;
  assert.deepEqual(team.map((m: any) => [m.name, m.homeBusiness, m.permissions]), [['Ramesh Supervisor', 'Daji Cricket Ground', ['manage_tasks']]]);
  const off = await sp('DELETE', `/api/staff/team-memberships/${w.supId}`, w.sunny);
  assert.equal(off.status, 200);
  assert.equal(off.body.removed, true);
  const sup = await login('supervisor@daji.test', SUP_PASSWORD);
  assert.equal((await sp('GET', '/api/tasks', sup)).status, 403);
  assert.deepEqual((await h.get('/api/me/businesses', sup)).body.items.map((b: any) => b.businessName), ['Daji Cricket Ground']);
  // his own job at the ground is untouched
  assert.equal((await h.get('/api/staff/bookings', sup)).status, 200);
});

test('a business switched off closes it to its added team members too', async () => {
  const admin = await h.login('admin');
  const off = await h.patch(`/api/admin/users/${w.spId}`, { active: false }, admin);
  assert.ok(off.status === 200, JSON.stringify(off.body));
  assert.equal((await sp('GET', '/api/tasks', w.sup)).status, 403);
  assert.deepEqual((await h.get('/api/me/businesses', w.sup)).body.items.map((b: any) => b.businessName), ['Daji Cricket Ground']);
});

test('Ask AI answers about branches and jobs within what the asker may see, never naming a restricted branch or its jobs', async () => {
  const house = await sp('POST', '/api/projects', w.sunny, { name: 'House interior', areaId: w.house });
  const loans = await sp('POST', '/api/projects', w.sunny, { name: 'Loan to Mahesh', areaId: w.loans });
  await sp('POST', '/api/tasks', w.sunny, { title: 'Pick tiles', projectId: house.body.id, dueDate: '2020-01-01', photosRequired: 0 });
  await sp('POST', '/api/tasks', w.sunny, { title: 'Collect repayment from Mahesh', projectId: loans.body.id, dueDate: '2020-01-01', photosRequired: 0 });
  const askAs = (token: string, question: string) => sp('POST', '/api/staff/ask', token, { question });

  const mine = await askAs(w.sunny, 'Which branches and projects do we have?');
  assert.equal(mine.status, 200, JSON.stringify(mine.body));
  const mineText = JSON.stringify(mine.body);
  assert.match(mineText, /Loans/);
  assert.match(mineText, /Loan to Mahesh/);

  const his = await askAs(w.sup, 'Which branches and projects do we have?');
  assert.equal(his.status, 200, JSON.stringify(his.body));
  const hisText = JSON.stringify(his.body);
  assert.match(hisText, /House interior/);
  for (const secret of ['Loans', 'Loan to Mahesh', 'Personal', 'Mahesh']) assert.doesNotMatch(hisText, new RegExp(secret), `leaked ${secret}`);

  // the jobs figures leave out the restricted branch's jobs too (the AI tool behind "how many jobs are overdue")
  const { jobs } = await import('../src/ask/tools.ts');
  const { userRow } = await import('../src/auth.ts');
  const { staffSwitchTo } = await import('../src/areas.ts');
  const supUser = staffSwitchTo(userRow(w.supId)!, w.spId);
  const j = jobs({ ownerId: w.spId, user: supUser }, { from: '2019-01-01', to: '2030-12-31' });
  assert.equal(j.overdue, 1);
  assert.deepEqual(j.overdueJobs.map((x) => x.title), ['Pick tiles']);
  const k = jobs({ ownerId: w.spId, user: userRow(w.spId)! }, { from: '2019-01-01', to: '2030-12-31' });
  assert.equal(k.overdue, 2);
});
