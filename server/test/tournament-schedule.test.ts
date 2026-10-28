// Fixture builder: fixtures go into the days and match times the owner gives; each match's time is held on the ground so customers
// cannot book it; day and night mixing; knockout rounds; all or nothing when a slot is taken or there are too few.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, dayFromNow, bookAndPay, hold, type Harness, type GroundLite } from './helpers.ts';
import { many } from '../src/db.ts';
import { knockoutPairs } from '../src/tournaments.ts';

let h: Harness; let g: GroundLite; let owner: string, owner2: string, cust: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset();
  g = (await grounds(h)).find((x) => x.name === 'Cricket Ground')!; owner = await h.login('owner1'); owner2 = await h.login('owner2'); cust = await h.login('customer');
});

const B = '/api/staff/tournaments';
async function cup(teams: number): Promise<{ t: string; ids: string[] }> {
  const r = await h.post(B, { name: 'Sunday League', startDate: dayFromNow(3), endDate: dayFromNow(60), format: 'round_robin', overs: 20 }, owner);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const ids: string[] = [];
  for (let i = 1; i <= teams; i++) ids.push((await h.post(`${B}/${r.body.id}/teams`, { name: `Team ${i}` }, owner)).body.id);
  return { t: r.body.id, ids };
}
const sched = (t: string, body: Record<string, unknown>, tok = owner) => h.post(`${B}/${t}/fixtures/schedule`, { groundId: g.id, ...body }, tok);
const blocks = () => many<{ note: string }>("SELECT note FROM booking_slots WHERE kind = 'block' AND note LIKE 'Tournament:%'");

test('round robin fills the given days and times in order, and holds each match time so customers cannot book it', async () => {
  const { t } = await cup(4); // 6 matches
  const days = [dayFromNow(4), dayFromNow(11)];
  const r = await sched(t, { kind: 'round_robin', days, times: ['09:00', '13:00', '17:00'], matchMinutes: 180 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.created, 6); assert.equal(r.body.held, 6);
  const fx = r.body.fixtures;
  const pairs = new Set(fx.map((f: any) => [f.teamAId, f.teamBId].sort().join('|'))); assert.equal(pairs.size, 6, 'every pair once');
  // no team twice on one day where the slots allow it (2 days x 3 slots, 4 teams: each team plays 3 games, so at most 2 on one day)
  for (const d of days) { const c = new Map<string, number>(); for (const f of fx.filter((f: any) => new Date(f.startsAt + 330 * 60000).toISOString().slice(0, 10) === d)) for (const x of [f.teamAId, f.teamBId]) c.set(x, (c.get(x) ?? 0) + 1); for (const n of c.values()) assert.ok(n <= 2); }
  assert.ok(fx.every((f: any) => f.blockedUntil === f.startsAt + 180 * 60000 && f.groundId === g.id));
  // 3 hours at 60-minute slots: 18 slots blocked, all named for the match
  assert.equal(blocks().length, 18);
  assert.match(blocks()[0]!.note, /^Tournament: Sunday League · Team \d v Team \d$/);
  // a customer cannot book a held time
  const tryBook = await hold(h, cust, g.id, days[0]!, '10:00', 1);
  assert.notEqual(tryBook.status, 201, 'the held time is not bookable');
  // a free time the same day still is
  assert.equal((await hold(h, cust, g.id, days[0]!, '21:00', 1)).status, 201);
});

test('moving or removing a fixture moves or frees its time; rebuilding frees the old times; deleting the tournament frees all', async () => {
  const { t } = await cup(3); // 3 matches
  const d = dayFromNow(5), d2 = dayFromNow(6);
  const r = await sched(t, { kind: 'round_robin', days: [d], times: ['08:00', '12:00', '16:00'], matchMinutes: 120 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(blocks().length, 6);
  const f0 = r.body.fixtures[0];
  const mv = await h.patch(`${B}/${t}/fixtures/${f0.id}`, { date: d2, time: '10:00' }, owner);
  assert.equal(mv.status, 200, JSON.stringify(mv.body)); assert.equal(mv.body.blockedUntil, mv.body.startsAt + 120 * 60000);
  assert.equal(blocks().length, 6, 'the hold moved, nothing extra');
  assert.equal((await h.del(`${B}/${t}/fixtures/${f0.id}`, owner)).status, 200);
  assert.equal(blocks().length, 4);
  const again = await sched(t, { kind: 'round_robin', days: [d2], times: ['08:00', '12:00', '16:00'], matchMinutes: 60, replace: true });
  assert.equal(again.status, 201, JSON.stringify(again.body));
  assert.equal(blocks().length, 3, 'old holds released, new ones written');
  assert.equal((await h.del(`${B}/${t}`, owner)).status, 200);
  assert.equal(blocks().length, 0);
});

test('a taken slot, too few slots, overlapping times or a past day: nothing is written and the reason is given', async () => {
  const { t } = await cup(4);
  const d = dayFromNow(7);
  await bookAndPay(h, cust, g.id, d, '14:00', 1);
  const taken = await sched(t, { kind: 'round_robin', days: [d, dayFromNow(8)], times: ['09:00', '13:00', '17:00'], matchMinutes: 180 });
  assert.equal(taken.status, 409); assert.match(taken.body.error.message, /14:00 .* is already booked/);
  const few = await sched(t, { kind: 'round_robin', days: [dayFromNow(9)], times: ['09:00', '13:00'] });
  assert.equal(few.status, 400); assert.match(few.body.error.message, /6 matches need 6 match times; these days and times give 2\. Add 4 more/);
  const overlap = await sched(t, { kind: 'round_robin', days: [dayFromNow(9), dayFromNow(10), dayFromNow(11)], times: ['09:00', '10:00'], matchMinutes: 180 });
  assert.equal(overlap.status, 400); assert.match(overlap.body.error.message, /less than 180 minutes apart/);
  assert.equal((await sched(t, { kind: 'round_robin', days: [dayFromNow(-2)], times: ['09:00'] })).status, 400);
  assert.equal((await h.get(`${B}/${t}`, owner)).body.fixtures.length, 0); assert.equal(blocks().length, 0);
  // another owner cannot schedule this tournament, nor on another owner's ground
  assert.equal((await sched(t, { kind: 'round_robin', days: [dayFromNow(9)], times: ['09:00'] }, owner2)).status, 404);
});

test('day and night: every team gets at least one day and one night match, or it says which team cannot', async () => {
  const { t, ids } = await cup(4);
  const r = await sched(t, { kind: 'round_robin', days: [dayFromNow(4), dayFromNow(11), dayFromNow(18)], times: ['10:00', '19:00'], matchMinutes: 180, dayNight: true });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const night = (at: number) => new Date(at + 330 * 60000).getUTCHours() >= 18;
  for (const id of ids) {
    const mine = r.body.fixtures.filter((f: any) => f.teamAId === id || f.teamBId === id);
    assert.ok(mine.some((f: any) => night(f.startsAt)) && mine.some((f: any) => !night(f.startsAt)), `team ${id} has both`);
  }
  const { t: t2 } = await cup(4);
  const noNight = await sched(t2, { kind: 'round_robin', days: [dayFromNow(20), dayFromNow(27)], times: ['08:00', '11:00', '14:00'], matchMinutes: 180, dayNight: true });
  assert.equal(noNight.status, 400); assert.match(noNight.body.error.message, /at least one match time at or after 18:00/);
});

test('knockout: byes go to the first teams entered, the next round comes from the winners once every match has one', async () => {
  assert.deepEqual(knockoutPairs(['a', 'b', 'c', 'd', 'e', 'f'], []).pairs, [['c', 'f'], ['d', 'e']], '6 teams: a and b get byes');
  const { t, ids } = await cup(4);
  const r1 = await sched(t, { kind: 'knockout', days: [dayFromNow(4)], times: ['09:00', '13:00'] });
  assert.equal(r1.status, 201, JSON.stringify(r1.body)); assert.equal(r1.body.created, 2);
  const early = await sched(t, { kind: 'knockout', days: [dayFromNow(11)], times: ['09:00'] });
  assert.equal(early.status, 409); assert.match(early.body.error.message, /needs a winner/);
  for (const f of r1.body.fixtures) assert.equal((await h.patch(`${B}/${t}/fixtures/${f.id}`, { outcome: 'team_a' }, owner)).status, 200);
  const r2 = await sched(t, { kind: 'knockout', days: [dayFromNow(11)], times: ['09:00'] });
  assert.equal(r2.status, 201, JSON.stringify(r2.body));
  const final = r2.body.fixtures.find((f: any) => f.round === 2);
  assert.deepEqual([final.teamAId, final.teamBId].sort(), r1.body.fixtures.map((f: any) => f.teamAId).sort());
  assert.equal(r2.body.fixtures.length, 3, 'round 1 kept'); void ids;
});

test('Ask AI answers about the coming fixtures, and only for those who may see tournaments', async () => {
  const { t } = await cup(3);
  assert.equal((await sched(t, { kind: 'round_robin', days: [dayFromNow(4)], times: ['09:00', '13:00', '17:00'] })).status, 201);
  const a = (await h.post('/api/staff/ask', { question: 'What are the next tournament fixtures?' }, owner)).body;
  assert.equal(a.intent, 'fixtures'); assert.match(a.answer, /3 fixtures coming up\. Next: Team \d v Team \d \(Sunday League\)/);
  assert.equal(a.details.length, 3); assert.match(a.details[0].text, /ground blocked/);
  // a money question about tournaments stays a money question
  assert.notEqual((await h.post('/api/staff/ask', { question: 'tournament revenue this month' }, owner)).body.intent, 'fixtures');
  // another business sees none of these
  assert.match((await h.post('/api/staff/ask', { question: 'next fixtures' }, owner2)).body.answer, /No tournament fixtures are coming up/);
});
