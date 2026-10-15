import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, type Harness } from './helpers.ts';
import { register } from './register.ts';
import { one } from '../src/db.ts';

let h: Harness;
let owner: string, owner2: string, staff: string, coach: string, cust: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });

beforeEach(async () => {
  h.reset();
  owner = await h.login('owner1'); owner2 = await h.login('owner2'); staff = await h.login('staff1'); cust = await h.login('customer');
  const c = await h.post('/api/staff/team', { name: 'Coach Karan', email: 'karan@daji.test', password: 'Coach@12345', preset: 'coach' }, owner);
  assert.equal(c.status, 201);
  coach = (await h.post('/api/auth/login', { email: 'karan@daji.test', password: 'Coach@12345' })).body.token;
});

const kid = (extra: Record<string, unknown> = {}) => ({ name: 'Aarav Shah', guardianName: 'Neha Shah', guardianEmail: 'neha@example.com', batch: 'U-14', ...extra });
async function addKid(extra: Record<string, unknown> = {}, tok = owner) {
  const r = await h.post('/api/staff/academy/students', kid(extra), tok);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body as { id: string };
}
const RATINGS = { Batting: 4, Bowling: 3, Fielding: 5, Fitness: 4, Discipline: 5 };

test('who may use the academy: owner and coach yes, front-desk staff and customers no', async () => {
  assert.equal((await h.get('/api/staff/academy/students', owner)).status, 200);
  assert.equal((await h.get('/api/staff/academy/students', coach)).status, 200, 'the coach preset includes manage_academy');
  assert.equal((await h.get('/api/staff/academy/students', staff)).status, 403);
  assert.equal((await h.get('/api/staff/academy/students', cust)).status, 403);
  assert.equal((await h.get('/api/staff/academy/students')).status, 401);
});

test('students are created, validated, searched, and kept apart between owners', async () => {
  assert.equal((await h.post('/api/staff/academy/students', { name: 'X' }, owner)).status, 400);
  const a = await addKid();
  await addKid({ name: 'Riya Patel', batch: 'U-16', guardianEmail: 'riya.mum@example.com' });
  assert.equal((await h.get('/api/staff/academy/students', owner)).body.items.length, 2);
  assert.equal((await h.get('/api/staff/academy/students?batch=U-16', owner)).body.items.length, 1);
  assert.equal((await h.get('/api/staff/academy/students?q=aar', owner)).body.items[0].name, 'Aarav Shah');
  assert.equal((await h.get('/api/staff/academy/students', owner2)).body.items.length, 0);
  assert.equal((await h.get(`/api/staff/academy/students/${a.id}`, owner2)).status, 404);
  assert.equal((await h.patch(`/api/staff/academy/students/${a.id}`, { name: 'Hacked' }, owner2)).status, 404);
  const up = await h.patch(`/api/staff/academy/students/${a.id}`, { batch: 'U-16', photoConsent: true }, owner);
  assert.equal(up.body.batch, 'U-16'); assert.equal(up.body.photoConsent, true); assert.equal(up.body.videoConsent, false, 'media consent is off unless given');
});

test('attendance: bulk marks, corrected later, no future days, only this owner\'s students', async () => {
  const a = await addKid(); const b = await addKid({ name: 'Riya Patel' });
  const day = '2026-10-14';
  const r = await h.post('/api/staff/academy/attendance', { date: day, marks: [{ studentId: a.id, present: true }, { studentId: b.id, present: false, note: 'unwell' }] }, coach);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const list = (await h.get(`/api/staff/academy/attendance?date=${day}`, owner)).body.items;
  assert.equal(list.find((x: any) => x.name === 'Riya Patel').present, false);
  await h.post('/api/staff/academy/attendance', { date: day, marks: [{ studentId: b.id, present: true }] }, owner);
  assert.equal((await h.get(`/api/staff/academy/attendance?date=${day}`, owner)).body.items.find((x: any) => x.name === 'Riya Patel').present, true, 'a correction replaces the mark');
  assert.equal((await h.post('/api/staff/academy/attendance', { date: '2030-01-01', marks: [{ studentId: a.id, present: true }] }, owner)).status, 400);
  assert.equal((await h.post('/api/staff/academy/attendance', { date: day, marks: [{ studentId: a.id, present: true }] }, owner2)).status, 404);
  assert.equal((await h.post('/api/staff/academy/attendance', { date: day, marks: [{ studentId: a.id }] }, owner)).status, 400);
});

test('progress cards use the five skills, are private until published, and can be taken back', async () => {
  const a = await addKid();
  assert.deepEqual((await h.get('/api/staff/academy/skills', owner)).body.skills, ['Batting', 'Bowling', 'Fielding', 'Fitness', 'Discipline']);
  assert.equal((await h.put('/api/staff/academy/skills', { skills: ['Batting', 'Bowling', 'Fielding', 'Fitness', 'Teamwork'] }, owner)).status, 200);
  assert.equal((await h.put('/api/staff/academy/skills', { skills: ['A1', 'B2'] }, owner)).status, 400);
  assert.equal((await h.put('/api/staff/academy/skills', { skills: ['Same', 'same', 'Three', 'Four', 'Five'] }, owner)).status, 400);
  assert.equal((await h.put(`/api/staff/academy/students/${a.id}/progress/2026-10`, { ratings: RATINGS }, coach)).status, 400, 'Discipline is no longer a skill, Teamwork is missing');
  const good = { ...RATINGS, Teamwork: 4 }; delete (good as any).Discipline;
  const saved = await h.put(`/api/staff/academy/students/${a.id}/progress/2026-10`, { ratings: good, comment: 'Great month' }, coach);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.published, false);
  assert.equal((await h.put(`/api/staff/academy/students/${a.id}/progress/2026-10`, { ratings: { ...good, Batting: 9 } }, coach)).status, 400);
  assert.equal((await h.put(`/api/staff/academy/students/${a.id}/progress/2026-13`, { ratings: good }, coach)).status, 400);
  const pub = await h.post(`/api/staff/academy/students/${a.id}/progress/2026-10/publish`, { published: true }, coach);
  assert.equal(pub.body.published, true); assert.ok(pub.body.publishedAt);
  assert.equal((await h.post(`/api/staff/academy/students/${a.id}/progress/2026-09/publish`, { published: true }, coach)).status, 404);
  assert.equal((await h.post(`/api/staff/academy/students/${a.id}/progress/2026-10/publish`, { published: 'yes' }, coach)).status, 400);
});

test('a parent sees a child only after staff link the account, and only published cards', async () => {
  const a = await addKid({ guardianEmail: 'neha@example.com' });
  const parent = await register(h, 'Neha Shah', '9800011122', { email: 'neha@example.com' } as any);
  assert.deepEqual((await h.get('/api/me/children', parent)).body.items, [], 'an email match alone shows nothing');
  const nobody = await h.post(`/api/staff/academy/students/${a.id}/link-guardian`, { email: 'nobody@example.com' }, owner);
  assert.equal(nobody.status, 404); assert.equal(nobody.body.error.code, 'NO_ACCOUNT');
  const parentEmail = one<{ email: string }>("SELECT email FROM users WHERE name = 'Neha Shah'")!.email;
  const link = await h.post(`/api/staff/academy/students/${a.id}/link-guardian`, { email: parentEmail }, owner);
  assert.equal(link.status, 200, JSON.stringify(link.body)); assert.equal(link.body.linked, true);
  await h.put(`/api/staff/academy/students/${a.id}/progress/2026-10`, { ratings: RATINGS, comment: 'Draft' }, coach);
  await h.put(`/api/staff/academy/students/${a.id}/progress/2026-09`, { ratings: RATINGS, comment: 'September' }, coach);
  await h.post(`/api/staff/academy/students/${a.id}/progress/2026-09/publish`, { published: true }, coach);
  await h.post('/api/staff/academy/attendance', { date: '2026-09-10', marks: [{ studentId: a.id, present: true }] }, coach);
  await h.post('/api/staff/academy/attendance', { date: '2026-09-12', marks: [{ studentId: a.id, present: false }] }, coach);
  const mine = (await h.get('/api/me/children', parent)).body.items;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].name, 'Aarav Shah');
  assert.equal(mine[0].cards.length, 1, 'the October draft is not shown');
  assert.equal(mine[0].cards[0].month, '2026-09');
  assert.deepEqual(mine[0].cards[0].attendance, { sessions: 2, present: 1, percent: 50 });
  assert.ok(!JSON.stringify(mine).includes('Draft'));
  // another parent sees nothing; unpublishing hides the card again; changing the guardian email breaks the link
  const other = await register(h, 'Other Parent', '9800011133', {});
  assert.deepEqual((await h.get('/api/me/children', other)).body.items, []);
  await h.post(`/api/staff/academy/students/${a.id}/progress/2026-09/publish`, { published: false }, coach);
  assert.equal((await h.get('/api/me/children', parent)).body.items[0].cards.length, 0);
  await h.patch(`/api/staff/academy/students/${a.id}`, { guardianEmail: 'someoneelse@example.com' }, owner);
  assert.deepEqual((await h.get('/api/me/children', parent)).body.items, []);
  assert.equal((await h.get('/api/me/children', owner)).status, 403, 'children is a customer route');
});

test('a student who has left is not in the register or the parent view, and other owners cannot link them', async () => {
  const a = await addKid();
  assert.equal((await h.post(`/api/staff/academy/students/${a.id}/link-guardian`, { email: 'customer@daji.test' }, owner2)).status, 404);
  await h.post(`/api/staff/academy/students/${a.id}/link-guardian`, { email: 'customer@daji.test' }, owner);
  assert.equal((await h.get('/api/me/children', cust)).body.items.length, 1);
  await h.patch(`/api/staff/academy/students/${a.id}`, { status: 'left' }, owner);
  assert.equal((await h.get('/api/me/children', cust)).body.items.length, 0);
  assert.equal((await h.get('/api/staff/academy/attendance?date=2026-10-14', owner)).body.items.length, 0);
  assert.ok(one("SELECT 1 x FROM audit_log WHERE action = 'academy.guardian_link'"));
});

test('a student of 16 or over can have a login of their own; younger ones cannot, and other owners cannot link', async () => {
  const young = await addKid({ name: 'Young Kid', bornOn: '2014-03-01' });
  const teen = await addKid({ name: 'Rahul Teen', bornOn: '2009-01-01' });
  const none = await addKid({ name: 'No Birthday', bornOn: undefined } as any);
  const link = (id: string, email: string, tok = owner) => h.post(`/api/staff/academy/students/${id}/link-student`, { email }, tok);
  assert.equal((await link(young.id, 'customer@daji.test')).body.error.code, 'TOO_YOUNG');
  assert.equal((await link(none.id, 'customer@daji.test')).status, 422);
  assert.equal((await link(teen.id, 'customer@daji.test', owner2)).status, 404);
  assert.equal((await link(teen.id, 'nobody@example.com')).body.error.code, 'NO_ACCOUNT');
  const ok = await link(teen.id, 'customer@daji.test');
  assert.equal(ok.status, 200); assert.equal(ok.body.selfLinked, true);
  const cust = await h.login('customer');
  const kids = (await h.get('/api/me/children', cust)).body.items;
  assert.equal(kids.length, 1); assert.equal(kids[0].relation, 'self'); assert.equal(kids[0].name, 'Rahul Teen');
  assert.equal((await h.post(`/api/staff/academy/students/${teen.id}/unlink-student`, {}, owner)).body.selfLinked, false);
  assert.deepEqual((await h.get('/api/me/children', cust)).body.items, []);
});

test('one login can look after several children, and each is linked separately', async () => {
  const a = await addKid({ name: 'Aarav Shah' }); const b = await addKid({ name: 'Anaya Shah' }); const c = await addKid({ name: 'Other Child' });
  for (const k of [a, b]) assert.equal((await h.post(`/api/staff/academy/students/${k.id}/link-guardian`, { email: 'customer@daji.test' }, owner)).status, 200);
  const cust = await h.login('customer');
  const kids = (await h.get('/api/me/children', cust)).body.items;
  assert.deepEqual(kids.map((x: any) => x.name).sort(), ['Aarav Shah', 'Anaya Shah']);
  assert.ok(kids.every((x: any) => x.relation === 'parent'));
  assert.ok(!kids.some((x: any) => x.name === 'Other Child'));
  assert.ok(c.id);
});

test('coaching staff: managed by academy staff, validated, shown on the public config, audited', async () => {
  assert.deepEqual((await h.get('/api/staff/academy/coaches', owner)).body.items, []);
  const items = [{ name: 'Munaf Patel', title: 'Founder, MP13', bio: 'Former India fast bowler.', photo: '' }, { name: 'Rakesh Desai', title: 'Head batting coach', bio: '', photo: 'https://example.com/r.jpg' }];
  assert.equal((await h.put('/api/staff/academy/coaches', { items }, staff)).status, 403);
  assert.equal((await h.put('/api/staff/academy/coaches', { items }, cust)).status, 403);
  const ok = await h.put('/api/staff/academy/coaches', { items }, coach);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const cfg = (await h.get('/api/config')).body;
  assert.deepEqual(cfg.academy.coaches.map((c: { name: string }) => c.name), ['Munaf Patel', 'Rakesh Desai']);
  assert.equal((await h.put('/api/staff/academy/coaches', { items: [{ name: 'X', title: '', bio: '', photo: '' }] }, owner)).status, 400, 'name too short');
  assert.equal((await h.put('/api/staff/academy/coaches', { items: [{ name: 'Okay Name', title: '', bio: '', photo: 'javascript:alert(1)' }] }, owner)).status, 400, 'unsafe photo link');
  assert.equal((await h.put('/api/staff/academy/coaches', { items: Array.from({ length: 13 }, (_, i) => ({ name: 'Coach ' + i, title: '', bio: '', photo: '' })) }, owner)).status, 400, 'more than twelve');
  assert.deepEqual((await h.get('/api/staff/academy/coaches', owner)).body.items.length, 2, 'rejected updates change nothing');
  assert.equal(one<{ n: number }>("SELECT COUNT(*) n FROM audit_log WHERE action = 'academy.coaches.update'")!.n, 1);
});
