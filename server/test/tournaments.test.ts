import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, dayFromNow, type Harness, type GroundLite } from './helpers.ts';
import { many } from '../src/db.ts';
import { roundRobin, oversToBalls } from '../src/tournaments.ts';

let h: Harness; let g: GroundLite; let owner: string, owner2: string, cust: string, staff: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset();
  g = (await grounds(h))[0]!; owner = await h.login('owner1'); owner2 = await h.login('owner2'); cust = await h.login('customer'); staff = await h.login('staff1');
});

const B = '/api/staff/tournaments';
async function make(extra: Record<string, unknown> = {}): Promise<string> {
  const r = await h.post(B, { name: 'Diwali Cup', startDate: dayFromNow(5), endDate: dayFromNow(12), format: 'round_robin', overs: 10, entryFeePaise: 500000, ...extra }, owner);
  assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.id;
}
async function team(t: string, name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await h.post(`${B}/${t}/teams`, { name, captain: `${name} captain`, phone: '9876543210', ...extra }, owner);
  assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.id;
}

test('round robin pairs every team once per cycle, nobody twice in a round', () => {
  for (const n of [2, 3, 4, 5, 8]) {
    const ids = Array.from({ length: n }, (_, i) => `t${i}`);
    const rounds = roundRobin(ids);
    const seen = new Set<string>();
    for (const r of rounds) { const inRound = new Set<string>(); for (const [a, b] of r) { assert.notEqual(a, b); assert.ok(!inRound.has(a) && !inRound.has(b)); inRound.add(a); inRound.add(b); seen.add([a, b].sort().join('|')); } }
    assert.equal(seen.size, n * (n - 1) / 2, `n=${n}`);
    assert.equal(roundRobin(ids, true).flat().length, n * (n - 1));
  }
  assert.equal(oversToBalls('12.3'), 75); assert.equal(oversToBalls('10'), 60); assert.equal(oversToBalls('3.7'), undefined); assert.equal(oversToBalls(''), null);
});

test('permission and owner scope', async () => {
  assert.equal((await h.get(B, cust)).status, 403);
  assert.equal((await h.get(B, null)).status, 401);
  const t = await make();
  assert.equal((await h.get(B, staff)).status, 403); // seeded staff do not hold manage_matches
  assert.equal((await h.get(`${B}/${t}`, owner2)).status, 404);
  assert.equal((await h.patch(`${B}/${t}`, { name: 'Hijack' }, owner2)).status, 404);
  const bad = await h.post(B, { name: 'X', startDate: dayFromNow(5), endDate: dayFromNow(1) }, owner);
  assert.equal(bad.status, 400);
});

test('teams, fees and the fee statistics', async () => {
  const t = await make();
  const a = await team(t, 'Lions'); await team(t, 'Tigers'); await team(t, 'Bulls');
  assert.equal((await h.post(`${B}/${t}/teams`, { name: 'lions' }, owner)).status, 400);
  assert.equal((await h.post(`${B}/${t}/teams`, { name: 'Bad Phone', phone: '123' }, owner)).status, 400);
  const p = await h.patch(`${B}/${t}/teams/${a}`, { feePaid: true, paymentRef: 'UPI123456789012' }, owner);
  assert.equal(p.status, 200); assert.equal(p.body.feePaid, true); assert.equal(p.body.paymentRef, 'UPI123456789012'); assert.ok(p.body.paidAt);
  const d = await h.get(`${B}/${t}`, owner);
  assert.deepEqual({ ...d.body.fees }, { teams: 3, paidTeams: 1, unpaidTeams: 2, expectedPaise: 1500000, collectedPaise: 500000, pendingPaise: 1000000 });
  assert.equal((await h.del(`${B}/${t}/teams/${a}`, owner)).status, 409); // paid
  const un = await h.patch(`${B}/${t}/teams/${a}`, { feePaid: false }, owner);
  assert.equal(un.body.feePaid, false); assert.equal(un.body.paymentRef, null);
  assert.equal((await h.del(`${B}/${t}/teams/${a}`, owner)).status, 200);
  assert.equal((await h.get(`${B}/${t}`, owner)).body.teams.length, 2);
  assert.ok(many("SELECT 1 FROM audit_log WHERE action = 'tournament.fee_paid'").length === 1);
});

test('generate fixtures, enter results, points table with NRR', async () => {
  const t = await make();
  const ids: Record<string, string> = {};
  for (const n of ['Lions', 'Tigers', 'Bulls']) ids[n] = await team(t, n);
  assert.equal((await h.post(`${B}/${t}/fixtures/generate`, {}, owner)).status, 201);
  const d = await h.get(`${B}/${t}`, owner);
  assert.equal(d.body.fixtures.length, 3);
  assert.equal(d.body.tournament.fixtureCount, 3);
  assert.equal((await h.post(`${B}/${t}/fixtures/generate`, {}, owner)).status, 409);
  const f = (a: string, b: string) => d.body.fixtures.find((x: any) => [x.teamA, x.teamB].sort().join() === [a, b].sort().join());
  const lt = f('Lions', 'Tigers'); const lb = f('Lions', 'Bulls'); const tb = f('Tigers', 'Bulls');
  // Lions beat Tigers: Lions 100 off 10 overs, Tigers 80 off 10
  const win = (fx: any, who: string) => (fx.teamA === who ? 'team_a' : 'team_b');
  const r1 = await h.patch(`${B}/${t}/fixtures/${lt.id}`, { outcome: win(lt, 'Lions'), ...(lt.teamA === 'Lions' ? { aRuns: 100, aOvers: '10', bRuns: 80, bOvers: '10' } : { bRuns: 100, bOvers: '10', aRuns: 80, aOvers: '10' }) }, owner);
  assert.equal(r1.status, 200, JSON.stringify(r1.body)); assert.equal(r1.body.winner, 'Lions'); assert.match(r1.body.resultText, /Lions won/);
  // Lions v Bulls tied; Tigers v Bulls no result
  assert.equal((await h.patch(`${B}/${t}/fixtures/${lb.id}`, { outcome: 'tie', resultText: 'Tied, Bulls won the super over' }, owner)).status, 200);
  assert.equal((await h.patch(`${B}/${t}/fixtures/${tb.id}`, { outcome: 'no_result' }, owner)).status, 200);
  const tbl = (await h.get(`${B}/${t}`, owner)).body.table;
  const row = (n: string) => tbl.find((x: any) => x.team === n);
  assert.equal(tbl[0].team, 'Lions');
  assert.deepEqual([row('Lions').played, row('Lions').won, row('Lions').tied, row('Lions').points], [2, 1, 1, 3]);
  assert.deepEqual([row('Tigers').played, row('Tigers').lost, row('Tigers').noResult, row('Tigers').points], [2, 1, 1, 1]);
  assert.deepEqual([row('Bulls').won, row('Bulls').tied, row('Bulls').noResult, row('Bulls').points], [0, 1, 1, 2]);
  assert.equal(row('Lions').nrr, null); // the tied game has no runs/overs, so NRR is not claimed
  // clearing a result takes the points away; played fixtures cannot be deleted or regenerated
  assert.equal((await h.del(`${B}/${t}/fixtures/${lt.id}`, owner)).status, 409);
  assert.equal((await h.post(`${B}/${t}/fixtures/generate`, { replace: true }, owner)).status, 409);
  assert.equal((await h.patch(`${B}/${t}/fixtures/${lt.id}`, { clearResult: true }, owner)).body.played, false);
  assert.equal((await h.get(`${B}/${t}`, owner)).body.table.find((x: any) => x.team === 'Lions').points, 1);
  assert.equal((await h.del(`${B}/${t}/teams/${ids.Lions}`, owner)).status, 409); // in fixtures
});

test('NRR is worked out when every played game has runs and overs', async () => {
  const t = await make();
  const a = await team(t, 'Lions'), b = await team(t, 'Tigers');
  const fx = await h.post(`${B}/${t}/fixtures`, { teamAId: a, teamBId: b, round: 1, date: dayFromNow(6), time: '15:30', groundId: g.id }, owner);
  assert.equal(fx.status, 201, JSON.stringify(fx.body)); assert.equal(fx.body.groundName.length > 0, true); assert.ok(fx.body.startsAt);
  assert.equal((await h.post(`${B}/${t}/fixtures`, { teamAId: a, teamBId: a }, owner)).status, 400);
  const r = await h.patch(`${B}/${t}/fixtures/${fx.body.id}`, { outcome: 'team_a', aRuns: 120, aOvers: '10', bRuns: 90, bOvers: '10' }, owner);
  assert.equal(r.status, 200);
  const tbl = (await h.get(`${B}/${t}`, owner)).body.table;
  assert.equal(tbl[0].team, 'Lions'); assert.equal(tbl[0].nrr, 3); assert.equal(tbl[1].nrr, -3);
});

test('a fixture can be scored in the match-day scorer and the result copied back', async () => {
  const t = await make({ overs: 1 });
  const a = await team(t, 'Lions'), b = await team(t, 'Tigers');
  const fx = (await h.post(`${B}/${t}/fixtures`, { teamAId: a, teamBId: b, date: dayFromNow(6), time: '10:00' }, owner)).body;
  assert.equal((await h.post(`${B}/${t}/fixtures/${fx.id}/sync`, {}, owner)).status, 409);
  const m = await h.post(`${B}/${t}/fixtures/${fx.id}/match`, {}, owner);
  assert.equal(m.status, 201, JSON.stringify(m.body)); assert.ok(m.body.matchId);
  assert.equal((await h.post(`${B}/${t}/fixtures/${fx.id}/match`, {}, owner)).status, 409);
  assert.equal((await h.post(`${B}/${t}/fixtures/${fx.id}/sync`, {}, owner)).status, 409); // not finished
  const mid = m.body.matchId;
  const ball = (innings: number, runs: number) => h.post(`/api/staff/matches/${mid}/balls`, { innings, batter: 'P1', bowler: 'Q1', runsBat: runs }, owner);
  for (let i = 0; i < 6; i++) assert.equal((await ball(1, 2)).status, 201); // Lions 12 off 1 over
  for (let i = 0; i < 6; i++) assert.equal((await ball(2, 1)).status, 201); // Tigers 6
  const s = await h.post(`${B}/${t}/fixtures/${fx.id}/sync`, {}, owner);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal(s.body.outcome, 'team_a'); assert.equal(s.body.winner, 'Lions'); assert.equal(s.body.aRuns, 12); assert.equal(s.body.bRuns, 6); assert.equal(s.body.aOvers, '1.0');
  assert.equal((await h.get(`${B}/${t}`, owner)).body.table[0].points, 2);
});

test('deleting: tournaments with paid teams are kept, others are soft deleted', async () => {
  const t = await make(); const a = await team(t, 'Lions');
  await h.patch(`${B}/${t}/teams/${a}`, { feePaid: true }, owner);
  assert.equal((await h.del(`${B}/${t}`, owner)).status, 409);
  await h.patch(`${B}/${t}/teams/${a}`, { feePaid: false }, owner);
  assert.equal((await h.del(`${B}/${t}`, owner)).status, 200);
  assert.equal((await h.get(B, owner)).body.items.length, 0);
  assert.equal(many('SELECT 1 FROM tournaments WHERE deleted_at IS NOT NULL').length, 1);
});
