import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, bookAndPay, dayFromNow, type Harness } from './helpers.ts';
import { many, one } from '../src/db.ts';
import { playerRecords } from '../src/ask/tools.ts';
import type { UserRow } from '../src/auth.ts';

// Player career records like CricHeroes: squads linked to players' Daji profiles (by mobile number or a booking's team list), the
// scorer uses the squad's names and names the fielder, and batting, bowling and fielding records are worked out from finished matches.
// Guests earn nothing; a player sees their own record and can say a match was not them; a business sees only its own matches.

let h: Harness, owner: string, owner2: string, staff: string;
let n = 0;
const phoneOf = (i: number) => `96${String(10000000 + i).slice(-8)}`;
async function newCustomer(name: string): Promise<{ token: string; id: string; phone: string }> {
  n++;
  const phone = phoneOf(n);
  const r = await h.post('/api/auth/register', { name, email: `ps${n}@example.com`, phone, password: 'Cricket@12345' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { token: r.body.token, id: r.body.user.id, phone };
}
async function mk(tok = owner) {
  const r = await h.post('/api/staff/matches', { title: 'Sunday friendly', teamA: 'Daji XI', teamB: 'Surat Strikers', overs: 2, playersPerSide: 3 }, tok);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id as string;
}
const addP = (id: string, body: Record<string, unknown>, tok = owner) => h.post(`/api/staff/matches/${id}/players`, body, tok);
const ball = (id: string, innings: number, o: Record<string, unknown>) => h.post(`/api/staff/matches/${id}/balls`, { innings, runsBat: 0, ...o }, owner);

before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset();
  owner = await h.login('owner1'); owner2 = await h.login('owner2'); staff = await h.login('staff1');
});

/** A full match with two linked players a side and a guest each. Daji XI 13/2 (2 ov), Surat Strikers 10/2: Daji XI won by 3 runs. */
async function playMatch() {
  const amit = await newCustomer('Amit Shah'), bhavin = await newCustomer('Bhavin Patel'), zed = await newCustomer('Zed Khan'), yash = await newCustomer('Yash Mehta');
  const id = await mk();
  for (const [side, name, p] of [['a', 'Amit', amit], ['a', 'Bhavin', bhavin], ['b', 'Zed', zed], ['b', 'Yash', yash]] as const) {
    const r = await addP(id, { side, name, phone: p.phone });
    assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.profile, true);
  }
  const g1 = await addP(id, { side: 'a', name: 'Ravi' }); assert.equal(g1.body.profile, false); assert.match(g1.body.note, /guest/);
  assert.equal((await addP(id, { side: 'b', name: 'Kiran', phone: '9000000001' })).body.profile, false);
  const ok = async (r: Promise<{ status: number; body: any }>) => { const x = await r; assert.equal(x.status, 201, JSON.stringify(x.body)); return x.body; };
  // first innings, Daji XI: Zed bowls 4, 6, 1, 0, Bhavin caught by Yash, 2 to the guest; Yash bowls a maiden to Amit
  for (const runs of [4, 6, 1]) await ok(ball(id, 1, { batter: 'amit', bowler: 'Zed', runsBat: runs }));
  await ok(ball(id, 1, { batter: 'Bhavin', bowler: 'Zed' }));
  await ok(ball(id, 1, { batter: 'Bhavin', bowler: 'Zed', wicket: true, wicketKind: 'caught', fielder: 'Yash' }));
  await ok(ball(id, 1, { batter: 'Ravi', bowler: 'Zed', runsBat: 2 }));
  for (let i = 0; i < 6; i++) await ok(ball(id, 1, { batter: 'Amit', bowler: 'Yash' }));
  // second innings, Surat Strikers: Zed hits 6 off Bhavin, is run out by Amit; Yash hits 4 off Amit and is stumped by Bhavin
  await ok(ball(id, 2, { batter: 'Zed', bowler: 'Bhavin', runsBat: 6 }));
  await ok(ball(id, 2, { batter: 'Zed', bowler: 'Bhavin', wicket: true, wicketKind: 'run out', fielder: 'Amit' }));
  await ok(ball(id, 2, { batter: 'Yash', bowler: 'Amit', runsBat: 4 }));
  const last = await ok(ball(id, 2, { batter: 'Yash', bowler: 'Amit', wicket: true, wicketKind: 'stumped', fielder: 'Bhavin' }));
  assert.equal(last.match.status, 'completed'); assert.equal(last.match.result, 'Daji XI won by 3 runs');
  return { id, amit, bhavin, zed, yash, last };
}

test('who may build squads: scorers of this business only', async () => {
  const id = await mk();
  assert.equal((await h.get(`/api/staff/matches/${id}/players`, owner)).status, 200);
  assert.equal((await h.get(`/api/staff/matches/${id}/players`, staff)).status, 403, 'the front desk does not score matches');
  assert.equal((await h.get(`/api/staff/matches/${id}/players`, owner2)).status, 404, 'another business never sees the match');
  assert.equal((await addP(id, { side: 'a', name: 'X' }, owner2)).status, 404);
  const cust = await newCustomer('Some One');
  assert.equal((await h.get(`/api/staff/matches/${id}/players`, cust.token)).status, 403);
  assert.equal((await h.get(`/api/staff/matches/${id}/players`)).status, 401);
});

test('squads: validation, one name and one profile per match, a full squad, guests', async () => {
  const id = await mk();
  const p = await newCustomer('Amit Shah');
  assert.equal((await addP(id, { name: 'Amit' })).status, 400, 'the team is needed');
  assert.equal((await addP(id, { side: 'c', name: 'Amit' })).status, 400);
  assert.equal((await addP(id, { side: 'a', name: '' })).status, 400);
  assert.equal((await addP(id, { side: 'a', name: 'x'.repeat(41) })).status, 400);
  assert.equal((await addP(id, { side: 'a', name: 'Amit', phone: p.phone })).status, 201);
  assert.equal((await addP(id, { side: 'b', name: ' amit ' })).body.error.code, 'NAME_TAKEN', 'names are compared without case or spaces');
  assert.equal((await addP(id, { side: 'b', name: 'A Shah', phone: p.phone })).body.error.code, 'PLAYER_ALREADY_ADDED', 'one profile plays for one side');
  for (let i = 1; i < 20; i++) assert.equal((await addP(id, { side: 'a', name: `Guest ${i}` })).status, 201);
  assert.equal((await addP(id, { side: 'a', name: 'One too many' })).body.error.code, 'SQUAD_FULL');
  const sq = (await h.get(`/api/staff/matches/${id}/players`, owner)).body;
  assert.equal(sq.sides[0].players.length, 20); assert.equal(sq.sides[0].players.filter((x: any) => x.hasProfile).length, 1);
  assert.equal(sq.sides[0].players.find((x: any) => x.hasProfile).profileName, 'Amit Shah', 'the owner may see customers, so sees the profile name');
});

test('with squads the scorer must use their names, from the right side; the fielder only for a catch, run out or stumping', async () => {
  const id = await mk();
  // no squads yet: any names, as before
  assert.equal((await ball(id, 1, { batter: 'Anyone', bowler: 'Someone' })).status, 201);
  await h.post(`/api/staff/matches/${id}/undo`, { innings: 1 }, owner);
  await addP(id, { side: 'a', name: 'Amit' }); await addP(id, { side: 'b', name: 'Zed' });
  assert.equal((await ball(id, 1, { batter: 'Nobody', bowler: 'Zed' })).body.error.code, 'NOT_IN_SQUAD');
  assert.equal((await ball(id, 1, { batter: 'Zed', bowler: 'Amit' })).body.error.code, 'NOT_IN_SQUAD', 'team B does not bat first');
  assert.equal((await ball(id, 1, { batter: 'Amit', bowler: 'Zed', wicket: true, wicketKind: 'bowled', fielder: 'Zed' })).status, 400);
  assert.equal((await ball(id, 1, { batter: 'Amit', bowler: 'Zed', fielder: 'Zed' })).status, 400, 'no fielder without a wicket');
  assert.equal((await ball(id, 1, { batter: 'Amit', bowler: 'Zed', wicket: true, wicketKind: 'caught', fielder: 'Amit' })).body.error.code, 'NOT_IN_SQUAD', 'the fielder is from the fielding side');
  const r = await ball(id, 1, { batter: '  AMIT ', bowler: 'zed', wicket: true, wicketKind: 'caught', fielder: 'ZED' });
  assert.equal(r.status, 201);
  assert.equal(r.body.innings[0].batting[0].name, 'Amit', 'kept as the squad spells it');
  assert.equal(r.body.innings[0].batting[0].out, 'c & b Zed');
});

test('a full match builds exact batting, bowling and fielding records; guests earn nothing', async () => {
  const { amit, bhavin, zed, yash, last } = await playMatch();
  const out = Object.fromEntries(last.innings.flatMap((i: any) => i.batting.map((b: any) => [b.name, b.out])));
  assert.equal(out.Bhavin, 'c Yash b Zed'); assert.equal(out.Zed, 'run out (Amit)'); assert.equal(out.Yash, 'st Bhavin b Amit'); assert.equal(out.Amit, null);
  const rec = async (p: { token: string }) => (await h.get('/api/my/cricket', p.token)).body;
  const a = await rec(amit);
  assert.equal(a.career.matches, 1);
  assert.deepEqual(a.career.batting, { innings: 1, notOuts: 1, runs: 11, balls: 9, fours: 1, sixes: 1, highest: '11*', average: null, strikeRate: 122.22, fifties: 0, hundreds: 0, ducks: 0 });
  assert.deepEqual(a.career.bowling, { innings: 1, balls: 2, overs: '0.2', maidens: 0, runs: 4, wickets: 1, best: '1/4', average: 4, economy: 12, strikeRate: 2, threeWickets: 0, fiveWickets: 0 });
  assert.deepEqual(a.career.fielding, { catches: 0, runOuts: 1, stumpings: 0 });
  assert.equal(a.matches[0].summary, '11* (9), 1/4 in 0.2 ov, 1 run out');
  assert.equal(a.matches[0].opponent, 'Surat Strikers');
  const b = await rec(bhavin);
  assert.equal(b.career.batting.ducks, 1); assert.equal(b.career.batting.average, 0); assert.equal(b.career.batting.highest, '0');
  assert.equal(b.career.bowling.best, '0/6', 'a run out is not the bowler\'s wicket'); assert.equal(b.career.fielding.stumpings, 1);
  const z = await rec(zed);
  assert.equal(z.career.batting.runs, 6); assert.equal(z.career.batting.strikeRate, 300); assert.equal(z.career.batting.average, 6);
  assert.equal(z.career.bowling.best, '1/13'); assert.equal(z.career.bowling.economy, 13); assert.equal(z.career.bowling.maidens, 0);
  const y = await rec(yash);
  assert.equal(y.career.bowling.maidens, 1); assert.equal(y.career.bowling.economy, 0); assert.equal(y.career.bowling.best, '0/0');
  assert.equal(y.career.fielding.catches, 1);
  // leaders: the four linked players only (the guests Ravi and Kiran have no record)
  const l = (await h.get('/api/staff/cricket/leaders', owner)).body;
  assert.equal(l.players, 4); assert.equal(l.matches, 1);
  assert.deepEqual(l.runs.map((x: any) => [x.name, x.runs]), [['Amit', 11], ['Zed', 6], ['Yash', 4]]);
  assert.deepEqual(l.wickets.map((x: any) => x.name).sort(), ['Amit', 'Zed']);
  assert.ok(!JSON.stringify(l).includes('Ravi'));
  // another business sees none of it
  const l2 = (await h.get('/api/staff/cricket/leaders', owner2)).body;
  assert.equal(l2.players, 0);
});

test('a match counts only once finished: an undone ball takes the record away until it is finished again', async () => {
  const { id, amit } = await playMatch();
  assert.equal((await h.get('/api/my/cricket', amit.token)).body.career.matches, 1);
  assert.equal((await h.post(`/api/staff/matches/${id}/undo`, { innings: 2 }, owner)).status, 200);
  assert.equal((await h.get('/api/my/cricket', amit.token)).body.career.matches, 0);
  assert.equal((await ball(id, 2, { batter: 'Yash', bowler: 'Amit', wicket: true, wicketKind: 'stumped', fielder: 'Bhavin' })).status, 201);
  assert.equal((await h.get('/api/my/cricket', amit.token)).body.career.matches, 1);
});

test('a name the scorer used cannot be renamed or taken off; the profile can still be unlinked and linked', async () => {
  const { id, amit } = await playMatch();
  const sq = (await h.get(`/api/staff/matches/${id}/players`, owner)).body;
  const am = sq.sides[0].players.find((p: any) => p.name === 'Amit');
  assert.equal(am.inUse, true);
  assert.equal((await h.patch(`/api/staff/matches/${id}/players/${am.id}`, { name: 'Amitbhai' }, owner)).body.error.code, 'NAME_IN_USE');
  assert.equal((await h.del(`/api/staff/matches/${id}/players/${am.id}`, owner)).body.error.code, 'NAME_IN_USE');
  assert.equal((await h.patch(`/api/staff/matches/${id}/players/${am.id}`, { phone: null }, owner)).status, 200);
  assert.equal((await h.get('/api/my/cricket', amit.token)).body.career.matches, 0, 'unlinked: off the record');
  assert.equal((await h.patch(`/api/staff/matches/${id}/players/${am.id}`, { phone: '9000000099' }, owner)).status, 404, 'no profile has that number');
  assert.equal((await h.patch(`/api/staff/matches/${id}/players/${am.id}`, { phone: amit.phone }, owner)).status, 200);
  assert.equal((await h.get('/api/my/cricket', amit.token)).body.career.batting.runs, 11);
  // an unused name can be renamed and taken off (kept, marked removed)
  const kiran = sq.sides[1].players.find((p: any) => p.name === 'Kiran');
  assert.equal(kiran.inUse, false);
  assert.equal((await h.patch(`/api/staff/matches/${id}/players/${kiran.id}`, { name: 'Kiran B' }, owner)).status, 200);
  assert.equal((await h.del(`/api/staff/matches/${id}/players/${kiran.id}`, owner)).status, 200);
  assert.equal(one<{ n: number }>('SELECT COUNT(*) n FROM match_players WHERE id = ? AND removed_at IS NOT NULL', kiran.id)!.n, 1);
});

test('"this was not me": the player takes a wrong match off their record, it cannot be linked to them again, and the audit keeps it', async () => {
  const { id, zed, yash } = await playMatch();
  assert.equal((await h.post(`/api/my/cricket/matches/${id}/not-me`, {}, owner)).status, 403);
  const other = await newCustomer('Not Linked');
  assert.equal((await h.post(`/api/my/cricket/matches/${id}/not-me`, {}, other.token)).status, 404, 'only a linked player');
  assert.equal((await h.post(`/api/my/cricket/matches/${id}/not-me`, { reason: 'I was not there' }, zed.token)).status, 200);
  assert.equal((await h.get('/api/my/cricket', zed.token)).body.career.matches, 0);
  assert.equal((await h.get('/api/my/cricket', yash.token)).body.career.matches, 1, 'nobody else changes');
  const sq = (await h.get(`/api/staff/matches/${id}/players`, owner)).body;
  const z = sq.sides[1].players.find((p: any) => p.name === 'Zed');
  assert.equal(z.hasProfile, false); assert.equal(z.saidNotThem, true);
  assert.equal((await h.patch(`/api/staff/matches/${id}/players/${z.id}`, { phone: zed.phone }, owner)).body.error.code, 'SAID_NOT_THEM');
  const a = one<{ detail: string }>("SELECT detail FROM audit_log WHERE action = 'match.not_me'");
  assert.match(a!.detail, /I was not there/);
});

test('a booking\'s team list fills a squad: profiles come in linked, guests as guests, nobody twice', async () => {
  const g = (await grounds(h))[0]!;
  const booker = await newCustomer('Booker Bhai'), mate = await newCustomer('Team Mate');
  const b = await bookAndPay(h, booker.token, g.id, dayFromNow(3), '10:00');
  assert.equal((await h.post(`/api/bookings/${b.id}/players`, { name: 'Team Mate', phone: mate.phone }, booker.token)).status, 201);
  assert.equal((await h.post(`/api/bookings/${b.id}/players`, { name: 'Uncle Ravi' }, booker.token)).status, 201);
  const id = await mk();
  assert.equal((await h.post(`/api/staff/matches/${id}/players/import`, { side: 'a', bookingRef: 'NOPE-1' }, owner)).status, 404);
  assert.equal((await h.post(`/api/staff/matches/${id}/players/import`, { side: 'a', bookingRef: b.ref }, owner2)).status, 404, 'another business cannot read the team list');
  const r = await h.post(`/api/staff/matches/${id}/players/import`, { side: 'a', bookingRef: b.ref.toLowerCase() }, owner);
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.added, 3);
  const a = r.body.squads.sides[0].players;
  assert.deepEqual(a.map((p: any) => [p.name, p.hasProfile, p.linkedVia]), [['Booker Bhai', true, 'team_list'], ['Team Mate', true, 'team_list'], ['Uncle Ravi', false, null]]);
  const again = await h.post(`/api/staff/matches/${id}/players/import`, { side: 'b', bookingRef: b.ref }, owner);
  assert.equal(again.body.added, 0); assert.equal(again.body.skipped.length, 3);
});

test('the Desk customer page shows the record at this business only; another business cannot see it', async () => {
  const { amit } = await playMatch();
  const r = await h.get(`/api/staff/customers/${amit.id}/cricket`, owner);
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.career.batting.runs, 11);
  assert.equal((await h.get(`/api/staff/customers/${amit.id}/cricket`, owner2)).status, 404);
  assert.equal((await h.get(`/api/staff/customers/${amit.id}/cricket`, amit.token)).status, 403);
  // a player who has only played in a match scored here (never booked) opens on this business's customer page, and on no other
  assert.equal((await h.get(`/api/staff/customers/${amit.id}`, owner)).status, 200);
  assert.equal((await h.get(`/api/staff/customers/${amit.id}`, owner2)).status, 404);
});

test('Ask AI: a player asks about their own record; staff ask for leaders and for one player; the outside AI tool gets no names', async () => {
  const { amit } = await playMatch();
  const mine = await h.post('/api/ask', { question: 'What is my batting average?' }, amit.token);
  assert.equal(mine.status, 200); assert.equal(mine.body.intent, 'cricket');
  assert.match(mine.body.answer, /11 runs in 1 innings \(highest 11\*/); assert.match(mine.body.answer, /1 wicket \(best 1\/4/);
  const fresh = await newCustomer('New Player');
  assert.match((await h.post('/api/ask', { question: 'how many runs have I scored' }, fresh.token)).body.answer, /no scored matches/);
  assert.equal((await h.post('/api/ask', { question: 'How many games have I played?' }, amit.token)).body.intent, 'games', 'games played still answers the waitlist count');
  const top = await h.post('/api/staff/ask', { question: 'Who has the most runs?' }, owner);
  assert.equal(top.body.intent, 'player_stats'); assert.match(top.body.answer, /Most runs: Amit, 11 runs/);
  const one_ = await h.post('/api/staff/ask', { question: 'Stats for Yash' }, owner);
  assert.match(one_.body.answer, /^Yash: 1 match, 4 runs/); assert.match(one_.body.answer, /1 catch/);
  assert.match((await h.post('/api/staff/ask', { question: 'Who has the most runs?' }, owner2)).body.answer, /No player records yet/);
  const ownerRow = one<UserRow>("SELECT * FROM users WHERE email = 'owner1@daji.test'")!;
  const t = JSON.stringify(playerRecords({ ownerId: ownerRow.id, user: ownerRow }));
  assert.ok(!/Amit|Zed|Yash|Bhavin/.test(t)); assert.match(t, /"runs":11/);
});

test('deleting an account takes the profile off every squad; the scorecard keeps the name the scorer used', async () => {
  const { id, amit } = await playMatch();
  assert.equal((await h.post('/api/me/delete', { confirm: 'DELETE', password: 'Cricket@12345' }, amit.token)).status, 200);
  assert.equal(many('SELECT 1 FROM match_players WHERE user_id = ?', amit.id).length, 0);
  const sc = (await h.get(`/api/staff/matches/${id}`, owner)).body;
  assert.ok(sc.innings[0].batting.some((b: any) => b.name === 'Amit'));
});
