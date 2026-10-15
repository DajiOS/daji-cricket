import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, type Harness } from './helpers.ts';
import { youtubeId } from '../src/matches.ts';

let h: Harness;
let owner: string, owner2: string, staff: string, cust: string, coach: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset();
  owner = await h.login('owner1'); owner2 = await h.login('owner2'); staff = await h.login('staff1'); cust = await h.login('customer');
  await h.post('/api/staff/team', { name: 'Coach Karan', email: 'karan@daji.test', password: 'Coach@12345', preset: 'coach' }, owner);
  coach = (await h.post('/api/auth/login', { email: 'karan@daji.test', password: 'Coach@12345' })).body.token;
});

async function mk(extra: Record<string, unknown> = {}, tok = owner) {
  const r = await h.post('/api/staff/matches', { title: 'Sunday friendly', teamA: 'Daji XI', teamB: 'Surat Strikers', overs: 2, playersPerSide: 3, ...extra }, tok);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body as { id: string };
}
const ball = (id: string, innings: number, o: Record<string, unknown> = {}, tok = owner) =>
  h.post(`/api/staff/matches/${id}/balls`, { innings, batter: 'Amit', bowler: 'Zed', runsBat: 0, ...o }, tok);

test('YouTube links: only real https youtube links give an id', () => {
  assert.equal(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('https://www.youtube.com/live/dQw4w9WgXcQ?feature=share'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('http://www.youtube.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(youtubeId('https://evil.example/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(youtubeId('javascript:alert(1)'), null);
});

test('who may score: owner and coach yes, front desk and customers no', async () => {
  assert.equal((await h.get('/api/staff/matches', owner)).status, 200);
  assert.equal((await h.get('/api/staff/matches', coach)).status, 200);
  assert.equal((await h.get('/api/staff/matches', staff)).status, 403);
  assert.equal((await h.get('/api/staff/matches', cust)).status, 403);
  assert.equal((await h.get('/api/staff/matches')).status, 401);
});

test('creating a match validates teams and the video link, and embeds only the nocookie host', async () => {
  assert.equal((await h.post('/api/staff/matches', { title: 'abc', teamA: 'A1', teamB: 'a1', overs: 5 }, owner)).status, 400);
  assert.equal((await h.post('/api/staff/matches', { title: 'abc', teamA: 'Aa', teamB: 'Bb', overs: 5, youtubeUrl: 'https://evil.example/x' }, owner)).status, 400);
  const m = await h.post('/api/staff/matches', { title: 'Final', teamA: 'Aa', teamB: 'Bb', overs: 5, youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ' }, owner);
  assert.equal(m.status, 201);
  assert.equal(m.body.embedUrl, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
});

test('runs, wides, no balls and overs add up', async () => {
  const { id } = await mk({ overs: 5, playersPerSide: 11 });
  await ball(id, 1, { runsBat: 4 });
  await ball(id, 1, { runsBat: 6 });
  await ball(id, 1, { extraType: 'wide' });
  await ball(id, 1, { extraType: 'noball', runsBat: 2 });
  await ball(id, 1, { extraType: 'bye', extraRuns: 2 });
  const sc = (await h.get(`/api/staff/matches/${id}`, owner)).body;
  const i = sc.innings[0];
  assert.equal(i.runs, 4 + 6 + 1 + (1 + 2) + 2);
  assert.equal(i.overs, '0.3', 'wide and no ball are not legal balls');
  assert.equal(i.extras.wides, 1);
  assert.equal(i.extras.noBalls, 1);
  assert.equal(i.extras.byes, 2);
  assert.equal(sc.match.status, 'live');
  assert.equal(i.batting[0].fours, 1);
  assert.equal(i.batting[0].sixes, 1);
});

test('bad balls are refused', async () => {
  const { id } = await mk();
  assert.equal((await ball(id, 1, { wicket: true })).status, 400, 'a wicket needs a kind');
  assert.equal((await ball(id, 1, { extraType: 'wide', runsBat: 2 })).status, 400);
  assert.equal((await ball(id, 1, { extraType: 'bye', runsBat: 1 })).status, 400);
  assert.equal((await ball(id, 2)).status, 409, 'second innings cannot start first');
  assert.equal((await ball(id, 1, { runsBat: 9 })).status, 400);
});

test('an innings ends when the overs run out or the side is all out, and the chase decides the match', async () => {
  const { id } = await mk(); // 2 overs, 3 players: all out after 2 wickets
  for (let k = 0; k < 12; k++) assert.equal((await ball(id, 1, { runsBat: 1 })).status, 201);
  assert.equal((await ball(id, 1)).status, 409, 'overs are finished');
  // chase: 12 scored so target is 13; lose both wickets quickly
  assert.equal((await ball(id, 2, { wicket: true, wicketKind: 'bowled' })).status, 201);
  assert.equal((await ball(id, 2, { wicket: true, wicketKind: 'caught' })).status, 201);
  assert.equal((await ball(id, 2)).status, 409, 'all out');
  const sc = (await h.get(`/api/staff/matches/${id}`, owner)).body;
  assert.equal(sc.match.status, 'completed');
  assert.equal(sc.match.result, 'Daji XI won by 12 runs');
  assert.equal(sc.innings[1].target, 13);
  assert.equal((await ball(id, 2)).status, 409, 'finished match is locked');
});

test('chasing side wins by wickets when the target is reached, and a tie is a tie', async () => {
  const a = await mk({ overs: 1 });
  for (let k = 0; k < 6; k++) await ball(a.id, 1, { runsBat: 1 });
  for (let k = 0; k < 6; k++) await ball(a.id, 2, { runsBat: 2 });
  let sc = (await h.get(`/api/staff/matches/${a.id}`, owner)).body;
  assert.equal(sc.match.result, 'Surat Strikers won by 2 wickets');
  const b = await mk({ overs: 1 });
  for (let k = 0; k < 6; k++) await ball(b.id, 1, { runsBat: 1 });
  for (let k = 0; k < 6; k++) await ball(b.id, 2, { runsBat: 1 });
  sc = (await h.get(`/api/staff/matches/${b.id}`, owner)).body;
  assert.equal(sc.match.result, 'Match tied');
});

test('undo removes the last ball and reopens a finished match', async () => {
  const { id } = await mk({ overs: 1 });
  for (let k = 0; k < 6; k++) await ball(id, 1, { runsBat: 1 });
  for (let k = 0; k < 6; k++) await ball(id, 2, { runsBat: 2 });
  assert.equal((await h.post(`/api/staff/matches/${id}/undo`, { innings: 1 }, owner)).status, 409, 'undo second innings first');
  const r = await h.post(`/api/staff/matches/${id}/undo`, { innings: 2 }, owner);
  assert.equal(r.status, 200);
  assert.equal(r.body.match.status, 'live');
  assert.equal(r.body.match.result, null);
  assert.equal(r.body.innings[1].runs, 6, 'the chase stopped on the 4th ball once the target was passed');
  assert.equal((await h.post(`/api/staff/matches/${id}/undo`, { innings: 3 }, owner)).status, 400);
});

test('public pages show only public live or finished matches, and other owners cannot touch yours', async () => {
  const pub = await mk({ title: 'Public one' });
  const priv = await mk({ title: 'Private one', isPublic: false });
  const sched = await mk({ title: 'Not started' });
  await ball(pub.id, 1, { runsBat: 3 });
  await ball(priv.id, 1, { runsBat: 3 });
  const list = (await h.get('/api/matches')).body.items;
  assert.deepEqual(list.map((m: { title: string }) => m.title), ['Public one']);
  assert.match(list[0].summary, /Daji XI 3\/0 \(0\.1\)/);
  assert.equal((await h.get(`/api/matches/${pub.id}`)).status, 200);
  assert.equal((await h.get(`/api/matches/${priv.id}`)).status, 404);
  assert.equal((await h.get(`/api/matches/${sched.id}`)).status, 200, 'detail of a public scheduled match is fine, it just is not listed');
  assert.equal((await h.get(`/api/staff/matches/${pub.id}`, owner2)).status, 404);
  assert.equal((await ball(pub.id, 1, {}, owner2)).status, 404);
  assert.equal((await h.patch(`/api/staff/matches/${pub.id}`, { isPublic: false }, owner)).status, 200);
  assert.equal((await h.get(`/api/matches/${pub.id}`)).status, 404);
});
