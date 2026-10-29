import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, advance, HOUR, type Harness } from './helpers.ts';
import { many, one } from '../src/db.ts';
import { now } from '../src/clock.ts';
import { fantasy as fantasyTool } from '../src/ask/tools.ts';
import { runTool, TOOL_DEFS } from '../src/ask/claude.ts';
import type { UserRow } from '../src/auth.ts';

// Fantasy cricket (free to play, points only): the ground opens a contest on a public match with squads, players pick a team with a captain
// and vice-captain until the lock, points are worked out from the balls, the leaderboard and season table show team names only, and a business
// sees and runs only its own contests. There is no money anywhere in it.

let h: Harness, owner: string, owner2: string, staff: string;
let n = 0;
const phoneOf = (i: number) => `95${String(10000000 + i).slice(-8)}`;
async function newCustomer(name: string): Promise<{ token: string; id: string; phone: string }> {
  n++;
  const phone = phoneOf(n);
  const r = await h.post('/api/auth/register', { name, email: `fan${n}@example.com`, phone, password: 'Cricket@12345' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { token: r.body.token, id: r.body.user.id, phone };
}
const ball = (id: string, innings: number, o: Record<string, unknown>) => h.post(`/api/staff/matches/${id}/balls`, { innings, runsBat: 0, ...o }, owner);
const okBall = async (id: string, innings: number, o: Record<string, unknown>) => { const r = await ball(id, innings, o); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body; };

before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset();
  owner = await h.login('owner1'); owner2 = await h.login('owner2'); staff = await h.login('staff1');
});

/** A public 2-over, 3-a-side match with squads: Daji XI (Amit, Bhavin, guest Ravi) v Surat Strikers (Zed, Yash, guest Kiran). */
async function matchWithSquads(o: { isPublic?: boolean; tok?: string } = {}) {
  const tok = o.tok ?? owner;
  const r = await h.post('/api/staff/matches', { title: 'Sunday friendly', teamA: 'Daji XI', teamB: 'Surat Strikers', overs: 2, playersPerSide: 3, isPublic: o.isPublic ?? true }, tok);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = r.body.id as string;
  const ids: Record<string, string> = {};
  for (const [side, name] of [['a', 'Amit'], ['a', 'Bhavin'], ['a', 'Ravi'], ['b', 'Zed'], ['b', 'Yash'], ['b', 'Kiran']] as const) {
    const p = await h.post(`/api/staff/matches/${id}/players`, { side, name }, tok);
    assert.equal(p.status, 201, JSON.stringify(p.body));
  }
  for (const s of (await h.get(`/api/staff/matches/${id}/players`, tok)).body.sides) for (const p of s.players) ids[p.name] = p.id;
  return { id, ids };
}
async function openOn(matchId: string, extra: Record<string, unknown> = {}, tok = owner) {
  const r = await h.post('/api/staff/fantasy', { matchId, teamSize: 4, maxFromSide: 3, ...extra }, tok);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id as string;
}
const enter = (cid: string, tok: string, teamName: string, players: string[], captain: string, viceCaptain: string) => h.put(`/api/fantasy/${cid}/entry`, { teamName, players, captain, viceCaptain }, tok);

/** The match the player-stats tests play: Daji XI 13/1 (2 ov), Surat Strikers 10/2, Daji XI won by 3 runs. */
async function playOut(id: string) {
  for (const runs of [4, 6, 1]) await okBall(id, 1, { batter: 'Amit', bowler: 'Zed', runsBat: runs });
  await okBall(id, 1, { batter: 'Bhavin', bowler: 'Zed' });
  await okBall(id, 1, { batter: 'Bhavin', bowler: 'Zed', wicket: true, wicketKind: 'caught', fielder: 'Yash' });
  await okBall(id, 1, { batter: 'Ravi', bowler: 'Zed', runsBat: 2 });
  for (let i = 0; i < 6; i++) await okBall(id, 1, { batter: 'Amit', bowler: 'Yash' });
  await okBall(id, 2, { batter: 'Zed', bowler: 'Bhavin', runsBat: 6 });
  await okBall(id, 2, { batter: 'Zed', bowler: 'Bhavin', wicket: true, wicketKind: 'run out', fielder: 'Amit' });
  await okBall(id, 2, { batter: 'Yash', bowler: 'Amit', runsBat: 4 });
  const last = await okBall(id, 2, { batter: 'Yash', bowler: 'Amit', wicket: true, wicketKind: 'stumped', fielder: 'Bhavin' });
  assert.equal(last.match.status, 'completed'); assert.equal(last.match.result, 'Daji XI won by 3 runs');
}

test('who may run contests: scorers of this business only; players only play; signed-out people see nothing', async () => {
  const { id } = await matchWithSquads();
  assert.equal((await h.post('/api/staff/fantasy', { matchId: id }, staff)).status, 403, 'the front desk does not run matches');
  assert.equal((await h.post('/api/staff/fantasy', { matchId: id }, owner2)).status, 404, 'another business never sees the match');
  const cid = await openOn(id);
  assert.equal((await h.get(`/api/staff/fantasy/${cid}`, owner2)).status, 404);
  assert.equal((await h.post(`/api/staff/fantasy/${cid}/cancel`, { reason: 'Not mine' }, owner2)).status, 404);
  assert.equal((await h.get('/api/staff/fantasy', owner2)).body.items.length, 0, "Riverside's list never shows Daji's contest");
  const cust = await newCustomer('Asha Rao');
  assert.equal((await h.get('/api/staff/fantasy', cust.token)).status, 403);
  assert.equal((await h.get('/api/fantasy')).status, 401);
  assert.equal((await h.get(`/api/fantasy/${cid}`)).status, 401);
  assert.equal((await h.get('/api/fantasy', owner)).status, 403, 'staff run contests from the Desk; they do not enter them');
  assert.equal((await enter(cid, owner, 'Owners XI', [], 'x', 'y')).status, 403);
});

test('opening a contest: public, not started, both squads, sensible team size, one per match, points table checked', async () => {
  const priv = await matchWithSquads({ isPublic: false });
  assert.equal((await h.post('/api/staff/fantasy', { matchId: priv.id }, owner)).body.error.code, 'MATCH_PRIVATE');
  const bare = await h.post('/api/staff/matches', { title: 'No squads', teamA: 'A team', teamB: 'B team', overs: 2, playersPerSide: 3 }, owner);
  assert.equal((await h.post('/api/staff/fantasy', { matchId: bare.body.id }, owner)).body.error.code, 'NO_SQUADS');
  const { id } = await matchWithSquads();
  assert.equal((await h.post('/api/staff/fantasy', {}, owner)).status, 400);
  assert.equal((await h.post('/api/staff/fantasy', { matchId: 'mat_nope' }, owner)).status, 404);
  assert.equal((await h.post('/api/staff/fantasy', { matchId: id, teamSize: 7 }, owner)).body.error.code, 'TEAM_TOO_BIG', 'six players in the squads');
  assert.equal((await h.post('/api/staff/fantasy', { matchId: id, teamSize: 12 }, owner)).status, 400);
  assert.equal((await h.post('/api/staff/fantasy', { matchId: id, teamSize: 4, maxFromSide: 4 }, owner)).status, 400, 'a team must have someone from each side');
  assert.equal((await h.post('/api/staff/fantasy', { matchId: id, teamSize: 4, maxFromSide: 1 }, owner)).status, 400);
  assert.equal((await h.post('/api/staff/fantasy', { matchId: id, points: { wicket: 500 } }, owner)).status, 400);
  assert.equal((await h.post('/api/staff/fantasy', { matchId: id, points: { goal: 5 } }, owner)).status, 400);
  assert.equal((await h.post('/api/staff/fantasy', { matchId: id, locksAt: now() - 1000 }, owner)).status, 400);
  const def = await h.post('/api/staff/fantasy', { matchId: id }, owner);
  assert.equal(def.status, 201, JSON.stringify(def.body));
  assert.equal(def.body.teamSize, 3, 'defaults to the players a side'); assert.equal(def.body.maxFromSide, 2); assert.equal(def.body.state, 'open');
  assert.equal(def.body.points.wicket, 25); assert.equal(def.body.captainTimes, 2); assert.equal(def.body.viceCaptainTimes, 1.5);
  assert.equal((await h.post('/api/staff/fantasy', { matchId: id }, owner)).body.error.code, 'CONTEST_EXISTS');
  // a cancelled contest frees the match for a new one
  assert.equal((await h.post(`/api/staff/fantasy/${def.body.id}/cancel`, {}, owner)).status, 400, 'a reason is needed');
  assert.equal((await h.post(`/api/staff/fantasy/${def.body.id}/cancel`, { reason: 'Wrong team size' }, owner)).status, 200);
  assert.equal((await h.post(`/api/staff/fantasy/${def.body.id}/cancel`, { reason: 'Again' }, owner)).body.error.code, 'ALREADY_CANCELLED');
  const again = await openOn(id, { points: { wicket: 30 } });
  assert.equal((await h.get(`/api/staff/fantasy/${again}`, owner)).body.points.wicket, 30);
  // a match that has started cannot get one
  const started = await matchWithSquads();
  await okBall(started.id, 1, { batter: 'Amit', bowler: 'Zed' });
  assert.equal((await h.post('/api/staff/fantasy', { matchId: started.id }, owner)).body.error.code, 'MATCH_STARTED');
  const list = (await h.get('/api/staff/fantasy', owner)).body;
  assert.equal(list.items.length, 2); assert.ok(list.matches.every((m: any) => m.id !== started.id && m.id !== id), 'only matches that can still get a contest are offered');
  assert.ok(list.matches.some((m: any) => m.id === priv.id && !m.canOpen && /website/.test(m.why)));
  const acts = many<{ action: string }>("SELECT action FROM audit_log WHERE action LIKE 'fantasy.%'").map((x) => x.action);
  assert.deepEqual(acts.sort(), ['fantasy.cancel', 'fantasy.open', 'fantasy.open']);
});

test('picking a team: exact size, no repeats, squad players only, the side limit, captain and vice-captain, a clean team name', async () => {
  const { id, ids } = await matchWithSquads();
  const cid = await openOn(id);
  const a = await newCustomer('Asha Rao');
  const team = [ids.Amit!, ids.Zed!, ids.Yash!, ids.Bhavin!];
  const bad = async (body: [string, string[], string, string], code: string, field?: string) => {
    const r = await enter(cid, a.token, ...body);
    assert.equal(r.status, code === 'VALIDATION_FAILED' || code === 'TEAM_NOT_VALID' ? 400 : 409, JSON.stringify(r.body)); assert.equal(r.body.error.code, code);
    if (field) assert.ok(r.body.error.details.fields.some((f: any) => f.field === field), JSON.stringify(r.body));
  };
  await bad(['Asha XI', team.slice(0, 3), ids.Amit!, ids.Zed!], 'TEAM_NOT_VALID', 'players');
  await bad(['Asha XI', [ids.Amit!, ids.Amit!, ids.Zed!, ids.Yash!], ids.Amit!, ids.Zed!], 'TEAM_NOT_VALID', 'players');
  await bad(['Asha XI', [ids.Amit!, ids.Zed!, ids.Yash!, 'mp_nope'], ids.Amit!, ids.Zed!], 'TEAM_NOT_VALID', 'players');
  await bad(['Asha XI', team, 'mp_other', ids.Zed!], 'TEAM_NOT_VALID', 'captain');
  await bad(['Asha XI', team, ids.Amit!, ids.Kiran!], 'TEAM_NOT_VALID', 'viceCaptain');
  await bad(['Asha XI', team, ids.Amit!, ids.Amit!], 'TEAM_NOT_VALID', 'viceCaptain');
  await bad(['Call 9876543210', team, ids.Amit!, ids.Zed!], 'VALIDATION_FAILED', 'teamName');
  await bad(['www.spam.com', team, ids.Amit!, ids.Zed!], 'VALIDATION_FAILED', 'teamName');
  await bad(['<b>x</b>', team, ids.Amit!, ids.Zed!], 'VALIDATION_FAILED', 'teamName');
  await bad(['A', team, ids.Amit!, ids.Zed!], 'VALIDATION_FAILED', 'teamName');
  // four from one side is over the limit of three
  const four = await newCustomer('Four Side');
  const r4 = await h.post('/api/staff/matches', { title: 'Big squads', teamA: 'Big A', teamB: 'Big B', overs: 2, playersPerSide: 6, isPublic: true }, owner);
  for (const [side, nm] of [['a', 'P1'], ['a', 'P2'], ['a', 'P3'], ['a', 'P4'], ['b', 'Q1']] as const) await h.post(`/api/staff/matches/${r4.body.id}/players`, { side, name: nm }, owner);
  const c4 = await openOn(r4.body.id);
  const sq = (await h.get(`/api/fantasy/${c4}`, four.token)).body.players.filter((p: any) => p.side === 'a').map((p: any) => p.id);
  const over = await enter(c4, four.token, 'All of A', sq, sq[0], sq[1]);
  assert.equal(over.status, 400); assert.match(over.body.error.message, /At most 3 players from one team/);
  // a good team, saved twice: still one team; then changed while open
  const ok1 = await enter(cid, a.token, 'Asha XI', team, ids.Amit!, ids.Zed!);
  assert.equal(ok1.status, 200, JSON.stringify(ok1.body)); assert.equal(ok1.body.created, true);
  assert.equal((await enter(cid, a.token, 'Asha XI', team, ids.Amit!, ids.Zed!)).body.created, false);
  assert.equal(one<{ n: number }>('SELECT COUNT(*) n FROM fantasy_entries WHERE contest_id = ?', cid)!.n, 1);
  const changed = await enter(cid, a.token, 'Asha  XI', team, ids.Zed!, ids.Amit!);
  assert.equal(changed.status, 200); assert.equal(changed.body.contest.mine.captainId, ids.Zed); assert.equal(changed.body.contest.mine.teamName, 'Asha XI');
  // team names are one per contest, whatever the case
  const b = await newCustomer('Bina Shah');
  assert.equal((await enter(cid, b.token, 'asha xi', team, ids.Amit!, ids.Zed!)).body.error.code, 'TEAM_NAME_TAKEN');
  const ent = await enter(cid, b.token, 'Bina Blasters', team, ids.Amit!, ids.Zed!);
  assert.equal(ent.status, 200);
  // while open: the table shows no teams, and another team cannot be opened (nobody copies a team)
  const view = (await h.get(`/api/fantasy/${cid}`, b.token)).body;
  assert.equal(view.state, 'open'); assert.equal(view.entries, 2); assert.deepEqual(view.leaderboard, []); assert.equal(view.mine.rank, null); assert.equal(view.canEdit, true);
  const aEntry = one<{ id: string }>('SELECT id FROM fantasy_entries WHERE user_id = ?', a.id)!.id;
  assert.equal((await h.get(`/api/fantasy/${cid}/entries/${aEntry}`, b.token)).status, 403);
  assert.equal((await h.get(`/api/fantasy/${cid}/entries/${aEntry}`, a.token)).status, 200, 'your own team any time');
  // a team name never shows a phone number; the view never carries a user id or mobile number
  assert.ok(!JSON.stringify(view).includes(a.id) && !JSON.stringify(view).includes(a.phone));
});

test('the lock: the start time passing or the first ball locks teams; withdrawing and re-entering only while open', async () => {
  const { id, ids } = await matchWithSquads();
  const cid = await openOn(id, { locksAt: now() + HOUR });
  const a = await newCustomer('Asha Rao');
  const team = [ids.Amit!, ids.Zed!, ids.Yash!, ids.Bhavin!];
  assert.equal((await enter(cid, a.token, 'Asha XI', team, ids.Amit!, ids.Zed!)).status, 200);
  assert.equal((await h.del(`/api/fantasy/${cid}/entry`, a.token)).status, 200);
  assert.equal((await h.get(`/api/fantasy/${cid}`, a.token)).body.mine, null);
  assert.equal((await h.del(`/api/fantasy/${cid}/entry`, a.token)).status, 404);
  assert.equal((await enter(cid, a.token, 'Asha XI', team, ids.Amit!, ids.Zed!)).status, 200, 'entering again before the lock');
  // the ground moves the lock, while open
  assert.equal((await h.patch(`/api/staff/fantasy/${cid}`, { locksAt: now() + 2 * HOUR }, owner)).status, 200);
  advance(3 * HOUR);
  const late = await newCustomer('Late Comer');
  const r = await enter(cid, late.token, 'Late XI', team, ids.Amit!, ids.Zed!);
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'CONTEST_LOCKED');
  assert.equal((await enter(cid, a.token, 'Asha XI', team, ids.Zed!, ids.Amit!)).body.error.code, 'CONTEST_LOCKED', 'no changes after the lock');
  assert.equal((await h.del(`/api/fantasy/${cid}/entry`, a.token)).body.error.code, 'CONTEST_LOCKED');
  assert.equal((await h.patch(`/api/staff/fantasy/${cid}`, { locksAt: now() + HOUR }, owner)).body.error.code, 'CONTEST_LOCKED');
  assert.equal((await h.get(`/api/fantasy/${cid}`, a.token)).body.state, 'locked');
  // no lock time: the first ball locks
  const m2 = await matchWithSquads();
  const c2 = await openOn(m2.id);
  assert.equal((await h.get(`/api/staff/fantasy/${c2}`, owner)).body.locksAt, null);
  await okBall(m2.id, 1, { batter: 'Amit', bowler: 'Zed', runsBat: 4 });
  const t2 = [m2.ids.Amit!, m2.ids.Zed!, m2.ids.Yash!, m2.ids.Bhavin!];
  assert.equal((await enter(c2, late.token, 'Late XI', t2, m2.ids.Amit!, m2.ids.Zed!)).body.error.code, 'CONTEST_LOCKED');
  const live = (await h.get(`/api/fantasy/${c2}`, late.token)).body;
  assert.equal(live.state, 'live'); assert.equal(live.players.find((p: any) => p.name === 'Amit').points, 9, 'in the squad 4 + 4 runs + four bonus 1');
  assert.equal(live.players.find((p: any) => p.name === 'Kiran').points, 4);
});

test('points from the ball by ball score: captain double, vice one and a half, shared ranks, live changes, the season table', async () => {
  const { id, ids } = await matchWithSquads();
  const cid = await openOn(id);
  const [p1, p2, p3, p4] = [await newCustomer('Pooja One'), await newCustomer('Pranav Two'), await newCustomer('Priya Three'), await newCustomer('Paresh Four')];
  assert.equal((await enter(cid, p1.token, 'Strikers Fan', [ids.Amit!, ids.Zed!, ids.Yash!, ids.Bhavin!], ids.Amit!, ids.Zed!)).status, 200);
  assert.equal((await enter(cid, p2.token, 'Zed Army', [ids.Zed!, ids.Amit!, ids.Yash!, ids.Ravi!], ids.Zed!, ids.Amit!)).status, 200);
  assert.equal((await enter(cid, p3.token, 'Long Shots', [ids.Yash!, ids.Bhavin!, ids.Kiran!, ids.Ravi!], ids.Yash!, ids.Bhavin!)).status, 200);
  assert.equal((await enter(cid, p4.token, 'Copy Cats', [ids.Yash!, ids.Bhavin!, ids.Kiran!, ids.Ravi!], ids.Yash!, ids.Bhavin!)).status, 200);
  await playOut(id);
  const view = (await h.get(`/api/fantasy/${cid}`, p1.token)).body;
  assert.equal(view.state, 'final');
  const pts = Object.fromEntries(view.players.map((p: any) => [p.name, p.points]));
  // Amit 4 + 11 runs + 1 (four) + 2 (six) + 25 (stumping wicket) + 6 (run out) = 49; Bhavin 4 - 2 (duck) + 12 (stumping) = 14; Ravi 4 + 2 = 6
  // Zed 4 + 6 + 2 (six) + 25 (wicket) = 37; Yash 4 + 4 + 1 (four) + 12 (maiden) + 8 (catch) = 29; Kiran 4 (in the squad only)
  assert.deepEqual(pts, { Amit: 49, Bhavin: 14, Ravi: 6, Zed: 37, Yash: 29, Kiran: 4 });
  const amit = view.players.find((p: any) => p.name === 'Amit');
  assert.ok(amit.breakdown.some((b: any) => b.label === '1 run out' && b.points === 6), JSON.stringify(amit.breakdown));
  // 49×2 + 37×1.5 + 29 + 14 = 196.5; 37×2 + 49×1.5 + 29 + 6 = 182.5; 29×2 + 14×1.5 + 4 + 6 = 89 (twice)
  assert.deepEqual(view.leaderboard.map((r: any) => [r.rank, r.teamName, r.points, r.you]), [[1, 'Strikers Fan', 196.5, true], [2, 'Zed Army', 182.5, false], [3, 'Long Shots', 89, false], [3, 'Copy Cats', 89, false]]);
  assert.equal(view.mine.picks.find((p: any) => p.role === 'captain').points, 98);
  assert.ok(!JSON.stringify(view.leaderboard).match(/Pooja|Pranav|Priya|Paresh|userId/), 'team names only');
  // after the lock, any team in the contest can be opened
  const other = await h.get(`/api/fantasy/${cid}/entries/${view.leaderboard[1].entryId}`, p1.token);
  assert.equal(other.status, 200); assert.equal(other.body.points, 182.5); assert.equal(other.body.you, false);
  // staff see the same table; the owner sees who each team belongs to
  const st = (await h.get(`/api/staff/fantasy/${cid}`, owner)).body;
  assert.equal(st.leaderboard[0].points, 196.5); assert.equal(st.leaderboard[0].playerName, 'Pooja One');
  // undoing a ball changes the points at once (nothing is stored twice)
  assert.equal((await h.post(`/api/staff/matches/${id}/undo`, { innings: 2 }, owner)).status, 200);
  const after = (await h.get(`/api/fantasy/${cid}`, p1.token)).body;
  assert.equal(after.state, 'live'); assert.equal(after.players.find((p: any) => p.name === 'Amit').points, 24, 'the stumping wicket is gone: 49 - 25');
  assert.equal(after.players.find((p: any) => p.name === 'Bhavin').points, 2, 'and the stumping: 14 - 12');
  await okBall(id, 2, { batter: 'Yash', bowler: 'Amit', wicket: true, wicketKind: 'stumped', fielder: 'Bhavin' });
  // my fantasy and the season table (finished, not cancelled contests of this business)
  const mine = (await h.get('/api/my/fantasy', p1.token)).body;
  assert.equal(mine.items[0].points, 196.5); assert.equal(mine.items[0].rank, 1); assert.equal(mine.totalPoints, 196.5); assert.equal(mine.wins, 1);
  const season = (await h.get(`/api/fantasy/${cid}/season`, p3.token)).body;
  assert.equal(season.business, 'Daji Cricket Ground'); assert.equal(season.contests, 1); assert.equal(season.players, 4);
  assert.deepEqual(season.table.map((r: any) => [r.rank, r.teamName, r.points]), [[1, 'Strikers Fan', 196.5], [2, 'Zed Army', 182.5], [3, 'Copy Cats', 89], [3, 'Long Shots', 89]]);
  assert.equal(season.you.teamName, 'Long Shots'); assert.equal(season.you.you, true);
  assert.equal((await h.get('/api/staff/fantasy/season', owner)).body.table.length, 4);
  assert.equal((await h.get('/api/staff/fantasy/season', owner2)).body.table.length, 0, 'Riverside has its own season');
  // a tournament filter leaves out a match that is no fixture of it
  assert.equal((await h.get('/api/staff/fantasy/season?tournamentId=trn_none', owner)).body.contests, 0);
  // a cancelled contest leaves the season table; the players still see it, with the reason
  await h.post(`/api/staff/fantasy/${cid}/cancel`, { reason: 'Scorer mixed up the squads' }, owner);
  assert.equal((await h.get(`/api/fantasy/${cid}/season`, p3.token)).body.contests, 0);
  const gone = (await h.get('/api/fantasy', p1.token)).body.items.find((x: any) => x.id === cid);
  assert.equal(gone.state, 'cancelled'); assert.match(gone.stateText, /Scorer mixed up the squads/);
  assert.equal((await h.get('/api/fantasy', (await newCustomer('Never Played')).token)).body.items.some((x: any) => x.id === cid), false, 'a cancelled contest shows only to those who played it');
});

test('the ground removes a team with a reason; that player cannot enter that contest again', async () => {
  const { id, ids } = await matchWithSquads();
  const cid = await openOn(id);
  const a = await newCustomer('Rude Name');
  const team = [ids.Amit!, ids.Zed!, ids.Yash!, ids.Bhavin!];
  assert.equal((await enter(cid, a.token, 'Silly Name', team, ids.Amit!, ids.Zed!)).status, 200);
  const eid = one<{ id: string }>('SELECT id FROM fantasy_entries WHERE user_id = ?', a.id)!.id;
  assert.equal((await h.post(`/api/staff/fantasy/${cid}/entries/${eid}/remove`, {}, owner)).status, 400);
  assert.equal((await h.post(`/api/staff/fantasy/${cid}/entries/${eid}/remove`, { reason: 'Team name not allowed' }, owner2)).status, 404);
  const r = await h.post(`/api/staff/fantasy/${cid}/entries/${eid}/remove`, { reason: 'Team name not allowed' }, owner);
  assert.equal(r.status, 200); assert.equal(r.body.entries, 0); assert.equal(r.body.removed[0].reason, 'Team name not allowed');
  const again = await enter(cid, a.token, 'Nice Name', team, ids.Amit!, ids.Zed!);
  assert.equal(again.status, 409); assert.equal(again.body.error.code, 'ENTRY_REMOVED'); assert.match(again.body.error.message, /Team name not allowed/);
  const v = (await h.get(`/api/fantasy/${cid}`, a.token)).body;
  assert.equal(v.canEdit, false); assert.equal(v.removedByGround.reason, 'Team name not allowed');
  assert.equal(one<{ n: number }>('SELECT COUNT(*) n FROM fantasy_entries WHERE id = ?', eid)!.n, 1, 'the team is kept, marked removed');
  assert.ok(one("SELECT 1 FROM audit_log WHERE action = 'fantasy.entry_remove'"));
});

test('a private match hides its contest from players; a player removed from the squad must be replaced', async () => {
  const { id, ids } = await matchWithSquads();
  const cid = await openOn(id);
  const a = await newCustomer('Asha Rao');
  assert.equal((await enter(cid, a.token, 'Asha XI', [ids.Amit!, ids.Zed!, ids.Yash!, ids.Bhavin!], ids.Amit!, ids.Zed!)).status, 200);
  // the scorer takes Bhavin out of the squad before the first ball
  assert.equal((await h.del(`/api/staff/matches/${id}/players/${ids.Bhavin}`, owner)).status, 200);
  const v = (await h.get(`/api/fantasy/${cid}`, a.token)).body;
  assert.equal(v.mine.needsFixing, true); assert.ok(v.mine.picks.some((p: any) => !p.inSquad));
  assert.equal((await enter(cid, a.token, 'Asha XI', [ids.Amit!, ids.Zed!, ids.Yash!, ids.Bhavin!], ids.Amit!, ids.Zed!)).status, 400);
  assert.equal((await enter(cid, a.token, 'Asha XI', [ids.Amit!, ids.Zed!, ids.Yash!, ids.Ravi!], ids.Amit!, ids.Zed!)).status, 200);
  // hiding the match from the website hides the contest from players, not from the ground
  assert.equal((await h.patch(`/api/staff/matches/${id}`, { isPublic: false }, owner)).status, 200);
  assert.equal((await h.get(`/api/fantasy/${cid}`, a.token)).status, 404);
  assert.equal((await h.get('/api/fantasy', a.token)).body.items.length, 0);
  assert.equal((await enter(cid, a.token, 'Asha XI', [ids.Amit!, ids.Zed!, ids.Yash!, ids.Ravi!], ids.Amit!, ids.Zed!)).status, 404);
  assert.equal((await h.get(`/api/staff/fantasy/${cid}`, owner)).status, 200);
});

test('two businesses: Riverside runs its own contest; each sees only its own; a player can play both', async () => {
  const daji = await matchWithSquads();
  const river = await matchWithSquads({ tok: owner2 });
  const dc = await openOn(daji.id);
  const rc = await openOn(river.id, {}, owner2);
  const a = await newCustomer('Both Grounds');
  assert.equal((await enter(dc, a.token, 'Asha XI', [daji.ids.Amit!, daji.ids.Zed!, daji.ids.Yash!, daji.ids.Bhavin!], daji.ids.Amit!, daji.ids.Zed!)).status, 200);
  // a Daji squad id never fits Riverside's contest
  assert.equal((await enter(rc, a.token, 'Asha XI', [daji.ids.Amit!, daji.ids.Zed!, daji.ids.Yash!, daji.ids.Bhavin!], daji.ids.Amit!, daji.ids.Zed!)).status, 400);
  assert.equal((await enter(rc, a.token, 'Asha XI', [river.ids.Amit!, river.ids.Zed!, river.ids.Yash!, river.ids.Bhavin!], river.ids.Amit!, river.ids.Zed!)).status, 200);
  assert.equal((await h.get('/api/fantasy', a.token)).body.items.length, 2);
  assert.deepEqual((await h.get('/api/staff/fantasy', owner)).body.items.map((x: any) => x.id), [dc]);
  assert.deepEqual((await h.get('/api/staff/fantasy', owner2)).body.items.map((x: any) => x.id), [rc]);
  assert.equal((await h.get(`/api/staff/fantasy/${rc}`, owner)).status, 404);
  assert.equal(one<{ owner_id: string }>('SELECT owner_id FROM fantasy_entries WHERE contest_id = ?', rc)!.owner_id, one<{ id: string }>("SELECT id FROM users WHERE email = 'owner2@daji.test'")!.id);
});

test('Ask AI: players ask about their fantasy team; the ground asks how contests are going; the outside AI tool gets no names', async () => {
  const { id, ids } = await matchWithSquads();
  const cid = await openOn(id);
  const a = await newCustomer('Asha Rao');
  const none = await h.post('/api/ask', { question: 'How is my fantasy team doing?' }, a.token);
  assert.equal(none.status, 200); assert.equal(none.body.intent, 'fantasy'); assert.equal(none.body.open, 'fantasy');
  assert.match(none.body.answer, /not picked a fantasy team yet/); assert.match(none.body.answer, /1 contest is open to join/); assert.match(none.body.answer, /no entry fee/);
  await enter(cid, a.token, 'Asha XI', [ids.Amit!, ids.Zed!, ids.Yash!, ids.Bhavin!], ids.Amit!, ids.Zed!);
  await playOut(id);
  const mine = await h.post('/api/ask', { question: 'fantasy points?' }, a.token);
  assert.match(mine.body.answer, /Your team Asha XI in Daji XI v Surat Strikers has 196.5 points, 1 of 1/);
  const staffAsk = await h.post('/api/staff/ask', { question: 'How is the fantasy contest going?' }, owner);
  assert.equal(staffAsk.body.intent, 'fantasy'); assert.match(staffAsk.body.answer, /1 contest: 0 open, 0 under way and 1 finished, with 1 team entered/);
  assert.ok(staffAsk.body.details.some((d: any) => /Asha XI 196.5/.test(d.text)));
  assert.equal((await h.post('/api/staff/ask', { question: 'fantasy leaderboard' }, staff)).body.answer.includes('manage_matches'), true, 'no access without manage_matches');
  assert.match((await h.post('/api/staff/ask', { question: 'fantasy leaderboard' }, owner2)).body.answer, /No fantasy contests yet/);
  const ownerRow = one<UserRow>("SELECT * FROM users WHERE email = 'owner1@daji.test'")!;
  const t = JSON.stringify(fantasyTool({ ownerId: ownerRow.id, user: ownerRow }));
  assert.ok(!/Asha|teamName/.test(t), t); assert.match(t, /"points":196.5/);
  assert.ok(TOOL_DEFS.some((d) => d.name === 'get_fantasy'));
  assert.deepEqual(runTool({ ownerId: ownerRow.id, user: ownerRow }, 'get_fantasy', {}), fantasyTool({ ownerId: ownerRow.id, user: ownerRow }));
});

test('deleting an account keeps its team on the table under no name of theirs', async () => {
  const { id, ids } = await matchWithSquads();
  const cid = await openOn(id);
  const a = await newCustomer('Leaving Soon');
  await enter(cid, a.token, 'Leaving XI', [ids.Amit!, ids.Zed!, ids.Yash!, ids.Bhavin!], ids.Amit!, ids.Zed!);
  assert.equal((await h.post('/api/me/delete', { confirm: 'DELETE', password: 'Cricket@12345' }, a.token)).status, 200);
  assert.equal(one<{ team_name: string }>('SELECT team_name FROM fantasy_entries WHERE user_id = ?', a.id)!.team_name, 'Deleted player');
  assert.equal((await h.get(`/api/staff/fantasy/${cid}`, owner)).body.leaderboard[0].teamName, 'Deleted player');
});

test('no money anywhere: no fee, prize or payment field is stored or accepted', async () => {
  const cols = [...many<{ name: string }>("SELECT name FROM pragma_table_info('fantasy_contests')"), ...many<{ name: string }>("SELECT name FROM pragma_table_info('fantasy_entries')")].map((c) => c.name).join(' ');
  assert.ok(!/fee|prize|paise|amount|payment/.test(cols), cols);
  const { id } = await matchWithSquads();
  const r = await h.post('/api/staff/fantasy', { matchId: id, entryFeePaise: 5000 }, owner);
  assert.equal(r.status, 201, 'unknown fields are ignored, never stored'); assert.ok(!/fee|prize/i.test(JSON.stringify(r.body)), JSON.stringify(r.body));
  const a = await newCustomer('Asha Rao');
  assert.match((await h.get('/api/fantasy', a.token)).body.note, /no entry fee and no prize/);
});
