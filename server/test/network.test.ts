// The cricket network (redesign brief, multi-ground tournament; addendum section 7). Three businesses with a ground each: Daji Cricket
// Ground (owner1, the organiser), Riverside Sports (owner2) and Sunny's Portfolio (a business in owner1's portfolio, with a ground made for
// these tests). These tests walk the whole tournament and try the walls: another business's ground, its settlement lines, its matches,
// a result verified by the person who sent it, a time held before its ground agreed, and money that is never posted to anyone's books.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, dayFromNow, hold, type Harness } from './helpers.ts';
import { db, many, one } from '../src/db.ts';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });

let n = 0;
const phoneOf = (i: number) => `95${String(10000000 + i).slice(-8)}`;
async function newCustomer(name: string): Promise<{ token: string; id: string; phone: string }> {
  n++;
  const phone = phoneOf(n);
  const r = await h.post('/api/auth/register', { name, email: `net${n}@example.com`, phone, password: 'Cricket@12345' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { token: r.body.token, id: r.body.user.id, phone };
}

interface World { o1: string; o2: string; o1Id: string; o2Id: string; spId: string; daji: string; river: string; spGround: string }
let w: World;
const SP = () => ({ 'x-daji-business': w.spId });
const sp = <T = any>(method: string, path: string, body?: unknown) => h.call<T>(method, path, { token: w.o1, body, headers: SP() });
const ok = async <T = any>(p: Promise<{ status: number; body: T }>, status = 200): Promise<T> => { const r = await p; assert.equal(r.status, status, JSON.stringify(r.body)); return r.body; };

beforeEach(async () => {
  h.reset();
  const o1 = await h.login('owner1'), o2 = await h.login('owner2');
  const o1Id = (await h.get('/api/me', o1)).body.user.id, o2Id = (await h.get('/api/me', o2)).body.user.id;
  const b = await ok(h.post('/api/me/portfolio', { businessName: "Sunny's Portfolio", ownerName: 'Sunny Patel', phone: '9876500011', email: 'portfolio@daji.test' }, o1), 201);
  w = { o1, o2, o1Id, o2Id, spId: b.id } as World;
  const g = await ok(sp('POST', '/api/staff/grounds', { name: 'Portfolio Turf', city: 'Surat', openTime: '06:00', closeTime: '23:00', slotMinutes: 60, pricePaise: 100000, maxSlots: 6 }), 201);
  w.spGround = g.id;
  // the public list is scoped to the main website once a portfolio exists, so the grounds are read straight from the database
  const gid = (name: string) => one<{ id: string }>('SELECT id FROM grounds WHERE name = ?', name)!.id;
  w.daji = gid('Cricket Ground');
  w.river = gid('Riverside Box Cricket');
});

const T = '/api/staff/network/tournaments';
async function joinAll() {
  await ok(h.post('/api/staff/network/join', {}, w.o1));
  await ok(h.post('/api/staff/network/join', {}, w.o2));
  await ok(sp('POST', '/api/staff/network/join', {}));
}

/** A tournament of four teams over three grounds, every invitation accepted. Returns its id and the team ids. */
async function setUp(opts: { riverCharge?: number } = {}) {
  await joinAll();
  const t = await ok(h.post(T, { name: 'Surat Network Cup', startDate: dayFromNow(5), endDate: dayFromNow(7), overs: 1, matchMinutes: 180 }, w.o1), 201);
  const id = t.tournament.id as string;
  await ok(h.post(`${T}/${id}/grounds`, { groundId: w.daji }, w.o1), 201);
  await ok(h.post(`${T}/${id}/grounds`, { groundId: w.river, chargePerMatchPaise: opts.riverCharge ?? 200000 }, w.o1), 201);
  await ok(h.post(`${T}/${id}/grounds`, { groundId: w.spGround, chargePerMatchPaise: 50000 }, w.o1), 201);
  const inv2 = (await ok(h.get(`${T}/${id}`, w.o2))).grounds.find((g: any) => g.isMine);
  assert.equal(inv2.status, 'invited');
  await ok(h.post(`${T}/${id}/grounds/${inv2.id}`, { accept: true }, w.o2));
  const inv3 = (await ok(sp('GET', `${T}/${id}`))).grounds.find((g: any) => g.isMine);
  await ok(sp('POST', `${T}/${id}/grounds/${inv3.id}`, { accept: true }));
  const teams: string[] = [];
  for (const name of ['Daji XI', 'River Kings', 'Surat Strikers', 'Gotri Giants']) teams.push((await ok(h.post(`${T}/${id}/teams`, { name }, w.o1), 201)).id);
  return { id, teams };
}
const hostToken = (f: any) => (f.groundId === w.river ? { token: w.o2, headers: {} } : f.groundId === w.spGround ? { token: w.o1, headers: SP() } : { token: w.o1, headers: {} });
const asHost = (f: any, method: string, path: string, body?: unknown) => { const x = hostToken(f); return h.call<any>(method, path, { token: x.token, headers: x.headers, body }); };

test('joining: only the owner joins; only members organise; a business outside the network cannot be invited', async () => {
  const staff = await h.login('staff1');
  assert.equal((await h.post('/api/staff/network/join', {}, staff)).status, 403);
  assert.equal((await h.post(T, { name: 'Cup', startDate: dayFromNow(5), endDate: dayFromNow(6) }, w.o1)).status, 409, 'not a member yet');
  const s = await ok(h.post('/api/staff/network/join', {}, w.o1));
  assert.equal(s.joined, true);
  assert.ok(s.neverShared.some((x: string) => /payments/i.test(x)));
  const t = await ok(h.post(T, { name: 'Cup', startDate: dayFromNow(5), endDate: dayFromNow(6) }, w.o1), 201);
  assert.equal((await h.post(`${T}/${t.tournament.id}/grounds`, { groundId: w.river }, w.o1)).status, 404, 'Riverside has not joined');
  // the front desk (no manage_matches) cannot run network tournaments, and a customer is refused outright
  assert.equal((await h.get(T, staff)).status, 403);
  const c = await newCustomer('Asha Rao');
  assert.equal((await h.get(T, c.token)).status, 403);
  assert.equal((await h.get(`${T}/${t.tournament.id}`, w.o2)).status, 404, 'a business that is not in it never sees it');
});

test('a tournament across three grounds: proposals checked against bookings, parallel matches, each ground confirms its own time, publish', async () => {
  const cust = await newCustomer('Kiran Desai');
  // a customer already booked Riverside on the first morning: the proposal must not use that time
  const held = await hold(h, cust.token, w.river, dayFromNow(5), '09:00', 3);
  assert.equal(held.status, 201, JSON.stringify(held.body));
  const { id } = await setUp();
  assert.equal((await h.post(`${T}/${id}/fixtures/propose`, { days: [dayFromNow(9)], times: ['09:00'] }, w.o1)).status, 400, 'a day outside the tournament');
  const d = await ok(h.post(`${T}/${id}/fixtures/propose`, { days: [dayFromNow(5), dayFromNow(6)], times: ['09:00', '13:00'] }, w.o1), 201);
  assert.equal(d.fixtures.length, 6, 'four teams, single round robin');
  assert.ok(d.fixtures.every((f: any) => f.status === 'proposed' && !f.timeHeld));
  const r9 = new Date(`${dayFromNow(5)}T09:00:00+05:30`).getTime();
  assert.ok(!d.fixtures.some((f: any) => f.groundId === w.river && f.startsAt === r9), 'the booked time is left alone');
  const byTime = new Map<number, any[]>();
  for (const f of d.fixtures) byTime.set(f.startsAt, [...(byTime.get(f.startsAt) ?? []), f]);
  assert.ok([...byTime.values()].some((fs) => fs.length >= 2 && new Set(fs.map((f) => f.groundId)).size === fs.length), 'matches run in parallel on different grounds');
  for (const fs of byTime.values()) { const teams = fs.flatMap((f) => [f.teamAId, f.teamBId]); assert.equal(new Set(teams).size, teams.length, 'no team plays two matches at once'); }
  // nothing is held until the ground agrees
  assert.equal(many("SELECT 1 FROM booking_slots WHERE note LIKE 'Network tournament:%'").length, 0);
  assert.equal((await h.post(`${T}/${id}/publish`, {}, w.o1)).status, 409, 'not confirmed yet');
  // a ground confirms only its own matches
  const onDaji = d.fixtures.find((f: any) => f.groundId === w.daji);
  const onRiver = d.fixtures.find((f: any) => f.groundId === w.river);
  assert.equal((await h.post(`${T}/${id}/fixtures/${onDaji.id}/confirm`, {}, w.o2)).status, 404);
  for (const f of d.fixtures) assert.equal((await asHost(f, 'POST', `${T}/${id}/fixtures/${f.id}/confirm`, {})).status, 200);
  const blocks = many<{ ground_id: string }>("SELECT ground_id FROM booking_slots WHERE kind = 'block' AND note LIKE 'Network tournament:%'");
  assert.equal(blocks.length, 6 * 3, 'three hours held for each of six matches');
  // the held time cannot be booked by a customer
  const rDay = new Date(onRiver.startsAt).toISOString();
  void rDay;
  const at = new Date(onRiver.startsAt + 5.5 * 3600_000).toISOString();
  const clash = await hold(h, cust.token, w.river, at.slice(0, 10), at.slice(11, 16), 1);
  assert.equal(clash.status, 409, JSON.stringify(clash.body));
  // confirming twice changes nothing
  await ok(asHost(onRiver, 'POST', `${T}/${id}/fixtures/${onRiver.id}/confirm`, {}));
  assert.equal(many("SELECT 1 FROM booking_slots WHERE kind = 'block' AND note LIKE 'Network tournament:%'").length, 18);
  const pub = await ok(h.post(`${T}/${id}/publish`, {}, w.o1));
  assert.equal(pub.tournament.status, 'published');
  // the public page: teams, grounds, fixtures; no players and no money
  const p = await ok(h.get(`/api/public/network/tournaments/${id}`));
  assert.equal(p.fixtures.length, 6);
  assert.ok(!/paise|settle|phone|email/i.test(JSON.stringify(p)), JSON.stringify(p));
  // Riverside cannot leave while it is in a live tournament
  assert.equal((await h.post('/api/staff/network/leave', {}, w.o2)).status, 409);
});

test('moves and declines: a confirmed match keeps its time until the new ground confirms; every change is kept', async () => {
  const { id } = await setUp();
  const d = await ok(h.post(`${T}/${id}/fixtures/propose`, { days: [dayFromNow(5), dayFromNow(6)], times: ['09:00', '13:00'] }, w.o1), 201);
  // Riverside turns one time down: it goes back to the organiser
  const onRiver = d.fixtures.filter((f: any) => f.groundId === w.river);
  assert.equal((await h.post(`${T}/${id}/fixtures/${onRiver[0].id}/decline`, {}, w.o2)).status, 400, 'a reason is needed');
  await ok(h.post(`${T}/${id}/fixtures/${onRiver[0].id}/decline`, { reason: 'Pitch relaying that morning' }, w.o2));
  for (const f of d.fixtures.filter((x: any) => x.id !== onRiver[0].id)) await ok(asHost(f, 'POST', `${T}/${id}/fixtures/${f.id}/confirm`, {}));
  assert.equal((await h.post(`${T}/${id}/publish`, {}, w.o1)).status, 409);
  // the organiser puts the declined match on its own ground on the last day
  await ok(h.post(`${T}/${id}/fixtures/${onRiver[0].id}/move`, { groundId: w.daji, date: dayFromNow(7), time: '09:00' }, w.o1));
  await ok(h.post(`${T}/${id}/fixtures/${onRiver[0].id}/confirm`, {}, w.o1));
  await ok(h.post(`${T}/${id}/publish`, {}, w.o1));
  // after publishing, a move needs a reason; a confirmed Riverside match moves to the Daji ground on the last afternoon
  const mover = onRiver[1];
  const oldHold = () => many("SELECT 1 FROM booking_slots WHERE ground_id = ? AND slot_start = ? AND kind = 'block'", w.river, mover.startsAt).length;
  assert.equal(oldHold(), 1);
  assert.equal((await h.post(`${T}/${id}/fixtures/${mover.id}/move`, { groundId: w.daji, date: dayFromNow(7), time: '13:00' }, w.o1)).status, 400);
  // a time on top of another match on that ground is refused
  assert.equal((await h.post(`${T}/${id}/fixtures/${mover.id}/move`, { groundId: w.daji, date: dayFromNow(7), time: '10:00', reason: 'x' }, w.o1)).status, 409);
  await ok(h.post(`${T}/${id}/fixtures/${mover.id}/move`, { groundId: w.daji, date: dayFromNow(7), time: '13:00', reason: 'Rain forecast at Riverside' }, w.o1));
  assert.equal(oldHold(), 1, 'the old time stays held until the new ground confirms');
  let det = await ok(h.get(`${T}/${id}`, w.o1));
  assert.equal(det.fixtures.find((f: any) => f.id === mover.id).move.ground, 'Cricket Ground');
  await ok(h.post(`${T}/${id}/fixtures/${mover.id}/confirm`, {}, w.o1));
  assert.equal(oldHold(), 0, 'the old time is given back once the new one is held');
  det = await ok(h.get(`${T}/${id}`, w.o1));
  const moved = det.fixtures.find((f: any) => f.id === mover.id);
  assert.equal(moved.groundId, w.daji); assert.equal(moved.move, null);
  // the Riverside charge for that match is cancelled, not deleted
  const lines = det.settlements.filter((s: any) => s.fixtureId === mover.id);
  assert.ok(lines.length >= 1 && lines.every((s: any) => s.status === 'cancelled'), JSON.stringify(lines));
  // a move Riverside declines leaves the match where it was confirmed
  const stay = det.fixtures.find((f: any) => f.groundId === w.spGround);
  await ok(h.post(`${T}/${id}/fixtures/${stay.id}/move`, { groundId: w.river, date: dayFromNow(7), time: '18:00', reason: 'Floodlights' }, w.o1));
  await ok(h.post(`${T}/${id}/fixtures/${stay.id}/decline`, { reason: 'Private event that evening' }, w.o2));
  det = await ok(h.get(`${T}/${id}`, w.o1));
  const kept = det.fixtures.find((f: any) => f.id === stay.id);
  assert.equal(kept.groundId, w.spGround); assert.equal(kept.status, 'confirmed'); assert.equal(kept.move, null);
  const kinds = det.history.map((x: any) => x.kind);
  for (const k of ['proposed', 'declined', 'confirmed', 'move_proposed', 'moved', 'move_declined']) assert.ok(kinds.includes(k), `${k} in ${kinds}`);
  assert.ok(det.history.some((x: any) => x.reason === 'Rain forecast at Riverside'));
  assert.throws(() => db().exec('UPDATE net_fixture_log SET reason = NULL'), /append-only/);
  assert.throws(() => db().exec('DELETE FROM net_fixture_log'), /append-only/);
});

async function confirmAllAndPublish(id: string) {
  const d = await ok(h.post(`${T}/${id}/fixtures/propose`, { days: [dayFromNow(5), dayFromNow(6)], times: ['09:00', '13:00'] }, w.o1), 201);
  for (const f of d.fixtures) await ok(asHost(f, 'POST', `${T}/${id}/fixtures/${f.id}/confirm`, {}));
  return (await ok(h.post(`${T}/${id}/publish`, {}, w.o1))).fixtures as any[];
}

test('scoring and verification: the host scores at its own ground, the organiser verifies, nobody verifies their own; standings and stats use verified results only', async () => {
  const { id, teams } = await setUp();
  const player = await newCustomer('Amit Shah');
  await ok(h.put('/api/me/network/sharing', { visibility: 'network' }, player.token));
  const fx0 = (await ok(h.post(`${T}/${id}/fixtures/propose`, { days: [dayFromNow(5), dayFromNow(6)], times: ['09:00', '13:00'] }, w.o1), 201)).fixtures;
  const onRiver = fx0.find((f: any) => f.groundId === w.river);
  const teamA = onRiver.teamAId as string;
  const otherSide = onRiver.teamBId as string;
  await ok(h.post(`${T}/${id}/teams/${teamA}/players`, { name: 'Amit', phone: player.phone }, w.o1), 201);
  await ok(h.post(`${T}/${id}/teams/${teamA}/players`, { name: 'Ravi' }, w.o1), 201);
  await ok(h.post(`${T}/${id}/teams/${otherSide}/players`, { name: 'Zed' }, w.o1), 201);
  // the same number on a second team is not asked twice (one team per player), and the organiser sees the same answer
  await ok(h.post(`${T}/${id}/teams/${otherSide}/players`, { name: 'Amit again', phone: player.phone }, w.o1), 201);
  void teams;
  // the player agrees to the request; only then is the profile linked
  const asks = (await ok(h.get('/api/me/network/team-invitations', player.token))).items;
  assert.equal(asks.length, 1);
  await ok(h.post(`/api/me/network/team-invitations/${asks[0].id}`, { accept: true }, player.token));
  for (const f of fx0) await ok(asHost(f, 'POST', `${T}/${id}/fixtures/${f.id}/confirm`, {}));
  assert.equal((await h.post(`${T}/${id}/fixtures/${onRiver.id}/scoring`, {}, w.o2)).status, 409, 'not published yet');
  await ok(h.post(`${T}/${id}/publish`, {}, w.o1));

  // only Riverside scores its match; the match belongs to Riverside, so the organiser cannot open it
  assert.equal((await h.post(`${T}/${id}/fixtures/${onRiver.id}/scoring`, {}, w.o1)).status, 403);
  const { matchId } = await ok(h.post(`${T}/${id}/fixtures/${onRiver.id}/scoring`, {}, w.o2), 201);
  assert.equal((await h.get(`/api/staff/matches/${matchId}`, w.o1)).status, 404, 'Daji never opens Riverside\'s match');
  const squads = (await ok(h.get(`/api/staff/matches/${matchId}/players`, w.o2))).items ?? (await ok(h.get(`/api/staff/matches/${matchId}/players`, w.o2)));
  void squads;
  const a = many<{ name: string; user_id: string | null; side: string }>('SELECT name, user_id, side FROM match_players WHERE match_id = ? ORDER BY side, name', matchId);
  assert.deepEqual(a.map((x) => [x.side, x.name, !!x.user_id]), [['a', 'Amit', true], ['a', 'Ravi', false], ['b', 'Amit again', false], ['b', 'Zed', false]]);
  // Amit 1 a ball for six balls; the chase makes nothing: team A wins by 6 runs
  for (let i = 0; i < 6; i++) await ok(h.post(`/api/staff/matches/${matchId}/balls`, { innings: 1, batter: 'Amit', bowler: 'Zed', runsBat: 1 }, w.o2), 201);
  for (let i = 0; i < 6; i++) await ok(h.post(`/api/staff/matches/${matchId}/balls`, { innings: 2, batter: 'Zed', bowler: 'Amit', runsBat: 0 }, w.o2), 201);
  // the player's network profile does not count it yet
  assert.equal((await ok(h.get('/api/me/network', player.token))).career.matches, 0);
  await ok(h.post(`${T}/${id}/fixtures/${onRiver.id}/result`, { fromMatch: true }, w.o2), 201);
  let det = await ok(h.get(`${T}/${id}`, w.o1));
  assert.equal(det.fixtures.find((f: any) => f.id === onRiver.id).waiting.status, 'waiting for verification');
  assert.ok(det.standings.every((r: any) => r.played === 0), 'unverified results do not count');
  assert.equal((await h.post(`${T}/${id}/fixtures/${onRiver.id}/verify`, { approve: true }, w.o2)).status, 403, 'the host is not the organiser');
  await ok(h.post(`${T}/${id}/fixtures/${onRiver.id}/verify`, { approve: true }, w.o1));
  det = await ok(h.get(`${T}/${id}`, w.o1));
  const won = det.standings.find((r: any) => r.teamId === teamA);
  assert.equal(won.won, 1); assert.equal(won.points, 2);
  const prof = await ok(h.get('/api/me/network', player.token));
  assert.equal(prof.career.matches, 1); assert.equal(prof.career.batting.runs, 6);
  assert.equal(prof.byGround[0].label, 'Riverside Box Cricket');
  assert.match(prof.byCompetition[0].label, /Surat Network Cup \(network\)/);

  // a correction to a verified result needs a reason, and the verified one counts until the correction is verified
  assert.equal((await h.post(`${T}/${id}/fixtures/${onRiver.id}/result`, { outcome: 'team_b' }, w.o2)).status, 400);
  await ok(h.post(`${T}/${id}/fixtures/${onRiver.id}/result`, { outcome: 'team_b', reason: 'Scorer entered the wrong side' }, w.o2), 201);
  det = await ok(h.get(`${T}/${id}`, w.o1));
  assert.equal(det.standings.find((r: any) => r.teamId === teamA).won, 1);
  assert.equal((await h.post(`${T}/${id}/fixtures/${onRiver.id}/verify`, { approve: false }, w.o1)).status, 400, 'a rejection needs a reason');
  await ok(h.post(`${T}/${id}/fixtures/${onRiver.id}/verify`, { approve: false, reason: 'The scorecard shows team A won' }, w.o1));
  const versions = (await ok(h.get(`${T}/${id}/fixtures/${onRiver.id}/results`, w.o1))).versions;
  assert.deepEqual(versions.map((v: any) => v.status), ['verified', 'rejected']);

  // a match on the organiser's own ground: the person who sends the result cannot verify it; a colleague can
  const onDaji = det.fixtures.find((f: any) => f.groundId === w.daji);
  await ok(h.post(`${T}/${id}/fixtures/${onDaji.id}/result`, { outcome: 'tie' }, w.o1), 201);
  assert.equal((await h.post(`${T}/${id}/fixtures/${onDaji.id}/verify`, { approve: true }, w.o1)).status, 403);
  const s = await ok(h.post('/api/staff/team', { firstName: 'Mehul', lastName: 'Scorer', email: 'mehul@daji.test', password: 'Scorer-Mehul-2026!', permissions: ['manage_matches'] }, w.o1), 201);
  void s;
  const mehul = (await ok(h.post('/api/auth/login', { email: 'mehul@daji.test', password: 'Scorer-Mehul-2026!' }))).token;
  await ok(h.post(`${T}/${id}/fixtures/${onDaji.id}/verify`, { approve: true }, mehul));
  // the shared profile shows only the shared fields to another network ground
  const seen = await ok(h.get(`/api/staff/network/players/${player.id}`, w.o2));
  assert.equal(seen.career.matches, 1);
  assert.ok(!/phone|email|booking|payment|paise/i.test(JSON.stringify(seen)), JSON.stringify(seen));
});

test('settlements: explicit lines between named parties, seen only by their parties, marked paid by the receiver, never posted to any books', async () => {
  const books = () => ({ t: one<{ n: number }>('SELECT COUNT(*) n FROM acct_transactions')!.n, j: one<{ n: number }>('SELECT COUNT(*) n FROM acct_journals')!.n });
  const before0 = books();
  const { id, teams } = await setUp();
  const fx = await confirmAllAndPublish(id);
  let det = await ok(h.get(`${T}/${id}`, w.o1));
  const riverFx = fx.filter((f: any) => f.groundId === w.river).length, spFx = fx.filter((f: any) => f.groundId === w.spGround).length;
  const charges = det.settlements.filter((s: any) => s.kind === 'ground_charge');
  assert.equal(charges.length, riverFx + spFx, 'one agreed charge per match on a charging ground (the organiser\'s own ground charges nothing)');
  // an entry fee from a team to the organiser, recorded once even when sent twice
  const fee = { kind: 'entry_fee', amountPaise: 150000, payer: { kind: 'team', ref: teams[1] }, payee: { kind: 'business', ref: w.o1Id }, clientKey: 'fee-river-kings' };
  const f1 = await ok(h.post(`${T}/${id}/settlements`, fee, w.o1), 201);
  const f2 = await ok(h.post(`${T}/${id}/settlements`, fee, w.o1), 201);
  assert.equal(f1.id, f2.id);
  assert.equal((await h.post(`${T}/${id}/settlements`, { ...fee, amountPaise: 1 }, w.o1)).status, 409);
  assert.equal((await h.post(`${T}/${id}/settlements`, { ...fee, clientKey: undefined, amountPaise: 0 }, w.o1)).status, 400);
  assert.equal((await h.post(`${T}/${id}/settlements`, { ...fee, clientKey: undefined }, w.o2)).status, 403, 'only the organiser records lines');
  // Riverside sees only its own lines; the portfolio business only its own
  const riv = await ok(h.get(`${T}/${id}`, w.o2));
  assert.ok(riv.settlements.length === riverFx && riv.settlements.every((s: any) => s.iReceive && s.payee === 'Riverside Sports'), JSON.stringify(riv.settlements));
  const mine = await ok(sp('GET', `${T}/${id}`));
  assert.equal(mine.settlements.length, spFx);
  // the receiver marks paid; the payer cannot; the same reference again changes nothing; a different one is refused
  const line = riv.settlements[0];
  assert.equal((await h.post(`${T}/${id}/settlements/${line.id}/paid`, { ref: 'UTR123' }, w.o1)).status, 403);
  const paid = await ok(h.post(`${T}/${id}/settlements/${line.id}/paid`, { ref: 'UTR123' }, w.o2));
  assert.equal(paid.status, 'paid');
  assert.equal((await ok(h.post(`${T}/${id}/settlements/${line.id}/paid`, { ref: 'UTR123' }, w.o2))).history.length, 2);
  assert.equal((await h.post(`${T}/${id}/settlements/${line.id}/paid`, { ref: 'UTR999' }, w.o2)).status, 409);
  assert.equal((await h.post(`${T}/${id}/settlements/${line.id}/cancel`, { reason: 'mistake' }, w.o1)).status, 409, 'a paid line stays');
  assert.equal((await h.post(`${T}/${id}/settlements/${f1.id}/paid`, { ref: 'CASH-1' }, w.o2)).status, 404, 'Riverside never sees the entry fee line');
  await ok(h.post(`${T}/${id}/settlements/${f1.id}/paid`, { ref: 'CASH-1' }, w.o1));
  det = await ok(h.get(`${T}/${id}`, w.o2));
  assert.equal(det.settlementTotals.receivedPaise, 200000);
  assert.equal(det.settlementTotals.toReceivePaise, (riverFx - 1) * 200000);
  assert.throws(() => db().exec('DELETE FROM net_settlement_events'), /append-only/);
  // cancelling the tournament gives the time back and cancels unpaid charges; the paid one stays paid
  await ok(h.post(`${T}/${id}/cancel`, { reason: 'Monsoon' }, w.o1));
  assert.equal(many("SELECT 1 FROM booking_slots WHERE note LIKE 'Network tournament:%'").length, 0);
  det = await ok(h.get(`${T}/${id}`, w.o1));
  assert.equal(det.settlements.find((s: any) => s.id === line.id).status, 'paid');
  assert.ok(det.settlements.filter((s: any) => s.id !== line.id && s.id !== f1.id).every((s: any) => s.status === 'cancelled'));
  assert.deepEqual(books(), before0, 'nothing posted to any business\'s books');
});

test('sharing: private by default; network shares only the shared fields with network grounds; public is for everyone', async () => {
  await joinAll();
  const p = await newCustomer('Neha Joshi');
  const r0 = await ok(h.get('/api/me/network/sharing', p.token));
  assert.equal(r0.visibility, 'private');
  assert.equal((await h.get(`/api/staff/network/players/${p.id}`, w.o2)).status, 404, 'private: another ground does not see it');
  assert.equal((await h.get(`/api/public/network/players/${p.id}`)).status, 404);
  await ok(h.put('/api/me/network/sharing', { visibility: 'network', playingRole: 'Wicket keeper' }, p.token));
  const seen = await ok(h.get(`/api/staff/network/players/${p.id}`, w.o2));
  assert.equal(seen.playingRole, 'Wicket keeper');
  assert.equal((await h.get(`/api/public/network/players/${p.id}`)).status, 404, 'network is not public');
  assert.ok((await ok(h.get('/api/staff/network/players?q=neha', w.o2))).items.some((x: any) => x.id === p.id));
  // a business that left the network no longer sees network profiles
  await ok(h.post('/api/staff/network/leave', {}, w.o2));
  assert.equal((await h.get(`/api/staff/network/players/${p.id}`, w.o2)).status, 404);
  await ok(h.put('/api/me/network/sharing', { visibility: 'public' }, p.token));
  const pub = await ok(h.get(`/api/public/network/players/${p.id}`));
  assert.equal(pub.name, 'Neha Joshi');
  assert.ok(!/phone|email|booking|payment|paise|bornOn/i.test(JSON.stringify(pub)), JSON.stringify(pub));
  assert.equal((await h.put('/api/me/network/sharing', { visibility: 'everyone' }, p.token)).status, 400);
});

test('children: off until the software owner records the legal review; guardian consent gates the record and sharing; withdrawal takes effect at once', async () => {
  await joinAll();
  const parent = await newCustomer('Priya Mehta');
  assert.equal((await h.post('/api/me/network/children', { firstName: 'Aarav', lastName: 'Mehta', bornOn: '2015-06-01', iAmGuardian: true }, parent.token)).status, 503, 'switched off');
  const admin = await h.login('admin');
  assert.equal((await h.put('/api/admin/network/children', { on: true }, admin)).status, 400, 'the legal review must be named');
  assert.equal((await h.put('/api/admin/network/children', { on: true, legalReviewRef: 'x' }, w.o1)).status, 403, 'only the software owner');
  await ok(h.put('/api/admin/network/children', { on: true, legalReviewRef: 'TEST ONLY: no real review recorded' }, admin));
  assert.equal((await h.post('/api/me/network/children', { firstName: 'Old', bornOn: '2000-01-01', iAmGuardian: true }, parent.token)).status, 400, 'an adult makes their own profile');
  assert.equal((await h.post('/api/me/network/children', { firstName: 'Aarav', bornOn: '2015-06-01', iAmGuardian: false }, parent.token)).status, 400);
  const kid = await ok(h.post('/api/me/network/children', { firstName: 'Aarav', lastName: 'Mehta', bornOn: '2015-06-01', iAmGuardian: true }, parent.token), 201);
  assert.match(kid.playerCode, /^KID-[A-Z2-9]{6}$/);
  assert.equal(kid.consent.playRecord.given, false);
  // the child cannot sign in: no email, phone or password
  const row = one<{ email: string | null; phone: string | null; password_hash: string | null }>('SELECT email, phone, password_hash FROM users WHERE id = ?', kid.id)!;
  assert.deepEqual([row.email, row.phone, row.password_hash], [null, null, null]);
  // a team cannot take the child without the guardian's consent
  const t = await ok(h.post(T, { name: 'Junior Cup', startDate: dayFromNow(5), endDate: dayFromNow(6) }, w.o1), 201);
  const team = (await ok(h.post(`${T}/${t.tournament.id}/teams`, { name: 'Juniors' }, w.o1), 201)).id;
  assert.equal((await h.post(`${T}/${t.tournament.id}/teams/${team}/players`, { childCode: kid.playerCode }, w.o1)).status, 409);
  assert.equal((await h.post(`/api/me/network/children/${kid.id}/consent`, { scope: 'network_share', given: true }, parent.token)).status, 409, 'the record comes first');
  await ok(h.post(`/api/me/network/children/${kid.id}/consent`, { scope: 'play_record', given: true }, parent.token));
  const added = await ok(h.post(`${T}/${t.tournament.id}/teams/${team}/players`, { childCode: kid.playerCode }, w.o1), 201);
  assert.equal(added.name, 'Aarav M.', 'outside the family a child is first name and initial');
  // sharing: never public, network only with the sharing consent
  assert.equal((await h.put(`/api/me/network/children/${kid.id}/sharing`, { visibility: 'public' }, parent.token)).status, 400);
  assert.equal((await h.put(`/api/me/network/children/${kid.id}/sharing`, { visibility: 'network' }, parent.token)).status, 409);
  await ok(h.post(`/api/me/network/children/${kid.id}/consent`, { scope: 'network_share', given: true }, parent.token));
  await ok(h.put(`/api/me/network/children/${kid.id}/sharing`, { visibility: 'network' }, parent.token));
  const seen = await ok(h.get(`/api/staff/network/players/${kid.id}`, w.o2));
  assert.equal(seen.name, 'Aarav M.'); assert.equal(seen.isChild, true);
  assert.equal((await h.get(`/api/public/network/players/${kid.id}`)).status, 404);
  // another customer cannot touch the child
  const other = await newCustomer('Someone Else');
  assert.equal((await h.get(`/api/me/network/children/${kid.id}`, other.token)).status, 404);
  assert.equal((await h.post(`/api/me/network/children/${kid.id}/consent`, { scope: 'play_record', given: false }, other.token)).status, 404);
  // withdrawing the record: off the team, sharing back to private, at once
  await ok(h.post(`/api/me/network/children/${kid.id}/consent`, { scope: 'play_record', given: false }, parent.token));
  assert.equal(many('SELECT 1 FROM net_team_players WHERE user_id = ? AND removed_at IS NULL', kid.id).length, 0);
  assert.equal((await h.get(`/api/staff/network/players/${kid.id}`, w.o2)).status, 404);
  const list = await ok(h.get('/api/me/network/children', parent.token));
  assert.equal(list.items[0].consent.playRecord.given, false); assert.equal(list.items[0].consent.networkShare.given, false);
  // every answer is kept with its wording
  const consents = many<{ scope: string; given: number; wording: string }>('SELECT scope, given, wording FROM child_consents WHERE child_id = ? ORDER BY id', kid.id);
  assert.deepEqual(consents.map((c) => `${c.scope}:${c.given}`), ['play_record:1', 'network_share:1', 'play_record:0', 'network_share:0']);
  assert.ok(consents.every((c) => c.wording.startsWith('v1:')));
  assert.throws(() => db().exec('DELETE FROM child_consents'), /append-only/);
  // switching the feature off hides consent again (nothing given counts while it is off)
  await ok(h.post(`/api/me/network/children/${kid.id}/consent`, { scope: 'play_record', given: true }, parent.token));
  await ok(h.put('/api/admin/network/children', { on: false }, admin));
  assert.equal((await h.post(`${T}/${t.tournament.id}/teams/${team}/players`, { childCode: kid.playerCode }, w.o1)).status, 409);
  // the guardian removes the profile
  await ok(h.del(`/api/me/network/children/${kid.id}`, parent.token));
  assert.equal((await ok(h.get('/api/me/network/children', parent.token))).items.length, 0);
});

test('possible duplicates: a guest on a scorecard is linked only when the player and the ground both agree', async () => {
  const p = await newCustomer('Rohan Iyer');
  // Rohan booked at Daji, and played a scored match there as a guest before his profile was linked
  const b = await hold(h, p.token, w.daji, dayFromNow(2), '07:00', 1);
  assert.equal(b.status, 201, JSON.stringify(b.body));
  const m = await ok(h.post('/api/staff/matches', { title: 'Sunday friendly', teamA: 'Blue', teamB: 'Green', overs: 1, playersPerSide: 2 }, w.o1), 201);
  for (const [side, name] of [['a', 'Rohan Iyer'], ['b', 'Zed']]) await ok(h.post(`/api/staff/matches/${m.id}/players`, { side, name }, w.o1), 201);
  await ok(h.post(`/api/staff/matches/${m.id}/balls`, { innings: 1, batter: 'Rohan Iyer', bowler: 'Zed', runsBat: 4, wicket: true, wicketKind: 'bowled' }, w.o1), 201);
  await ok(h.post(`/api/staff/matches/${m.id}/balls`, { innings: 2, batter: 'Zed', bowler: 'Rohan Iyer', wicket: true, wicketKind: 'bowled' }, w.o1), 201);
  const mine = await ok(h.get('/api/me/network/claims', p.token));
  assert.equal(mine.possible.length, 1);
  // someone else with another name cannot claim it, and Riverside sees nothing of it
  const other = await newCustomer('Other Person');
  assert.equal((await h.post('/api/me/network/claims', { matchPlayerId: mine.possible[0].matchPlayerId }, other.token)).status, 404);
  const c = await ok(h.post('/api/me/network/claims', { matchPlayerId: mine.possible[0].matchPlayerId }, p.token), 201);
  assert.equal(c.status, 'open');
  assert.equal((await ok(h.get('/api/me/network', p.token))).career.matches, 0, 'not linked on the player\'s word alone');
  assert.equal((await ok(h.get('/api/staff/network/claims', w.o2))).claims.length, 0);
  assert.equal((await h.post(`/api/staff/network/claims/${c.id}`, { yes: true }, w.o2)).status, 404);
  const staff = await ok(h.get('/api/staff/network/claims', w.o1));
  assert.equal(staff.claims[0].player, 'Rohan Iyer');
  await ok(h.post(`/api/staff/network/claims/${c.id}`, { yes: true }, w.o1));
  const prof = await ok(h.get('/api/me/network', p.token));
  assert.equal(prof.career.matches, 1); assert.equal(prof.career.batting.runs, 4);
  // a staff suggestion waits for the player; a "no" closes it for good
  const m2 = await ok(h.post('/api/staff/matches', { title: 'Second friendly', teamA: 'Blue', teamB: 'Green', overs: 1, playersPerSide: 2 }, w.o1), 201);
  for (const [side, name] of [['a', 'Rohan Iyer'], ['b', 'Zed']]) await ok(h.post(`/api/staff/matches/${m2.id}/players`, { side, name }, w.o1), 201);
  await ok(h.post(`/api/staff/matches/${m2.id}/balls`, { innings: 1, batter: 'Rohan Iyer', bowler: 'Zed', wicket: true, wicketKind: 'bowled' }, w.o1), 201);
  await ok(h.post(`/api/staff/matches/${m2.id}/balls`, { innings: 2, batter: 'Zed', bowler: 'Rohan Iyer', runsBat: 1 }, w.o1), 201);
  const sug = (await ok(h.get('/api/staff/network/claims', w.o1))).suggestions;
  assert.equal(sug.length, 1); assert.equal(sug[0].player, 'Rohan Iyer');
  const s = await ok(h.post('/api/staff/network/claims', { matchPlayerId: sug[0].matchPlayerId, playerId: sug[0].playerId }, w.o1), 201);
  assert.equal((await ok(h.get('/api/me/network', p.token))).career.matches, 1, 'waits for the player');
  await ok(h.post(`/api/me/network/claims/${s.id}`, { yes: false }, p.token));
  assert.equal((await h.post('/api/staff/network/claims', { matchPlayerId: sug[0].matchPlayerId, playerId: sug[0].playerId }, w.o1)).status, 409, 'the player said no');
  assert.equal((await ok(h.get('/api/me/network', p.token))).career.matches, 1);
});

test('Platform AI: staff hear what waits for them in the network, without player names; a player hears who can see their profile', async () => {
  const { id } = await setUp();
  const player = await newCustomer('Amit Shah');
  await ok(h.post(`${T}/${id}/teams/${(await ok(h.get(`${T}/${id}`, w.o1))).teams[0].id}/players`, { name: 'Amit', phone: player.phone }, w.o1), 201);
  await ok(h.post(`${T}/${id}/fixtures/propose`, { days: [dayFromNow(5), dayFromNow(6)], times: ['09:00', '13:00'] }, w.o1), 201);
  const a = await ok(h.post('/api/staff/ask', { question: 'What is waiting for us in the cricket network?' }, w.o2));
  assert.equal(a.intent, 'network', JSON.stringify(a));
  assert.match(a.answer, /match times? waiting for your ground to confirm/);
  assert.ok(!/Amit/.test(JSON.stringify(a)), 'no player names');
  const staff = await h.login('staff1');
  const refused = await ok(h.post('/api/staff/ask', { question: 'cricket network' }, staff));
  assert.match(refused.answer, /manage_matches/);
  const c = await ok(h.post('/api/ask', { question: 'Who can see my cricket profile?' }, player.token));
  assert.equal(c.intent, 'network');
  assert.match(c.answer, /Only me/);
  // a question about a child's sessions is not taken by the network answer; one about their profile is
  assert.notEqual((await ok(h.post('/api/ask', { question: "When is my child's next session?" }, player.token))).intent, 'network');
  assert.equal((await ok(h.post('/api/ask', { question: "Who can see my daughter's cricket profile?" }, player.token))).intent, 'network');
  // the request to put the profile on a team is something the player can ask about
  const req = await ok(h.post('/api/ask', { question: 'Do I have any team requests?' }, player.token));
  assert.equal(req.intent, 'network');
  assert.match(req.answer, /asked to add your profile; nothing is linked until you agree/);
  assert.ok(req.details.some((d: any) => /Surat Network Cup/.test(d.label)), JSON.stringify(req.details));
});

// ------------------------------------------------------------------ review of PR #202 (Sunny, 30 Oct 2026)

test('review: a player added by mobile number is only asked; the organiser cannot tell whether the number has a profile', async () => {
  const { id, teams } = await setUp();
  const neha = await newCustomer('Neha Joshi');
  const add = (team: string, body: unknown) => h.post(`${T}/${id}/teams/${team}/players`, body, w.o1);
  assert.equal((await add(teams[0]!, { phone: neha.phone })).status, 400, 'by mobile number the organiser types the name');
  const withProfile = await ok(add(teams[0]!, { name: 'Neha', phone: neha.phone }), 201);
  const noProfile = await ok(add(teams[0]!, { name: 'Nobody Here', phone: '9111111111' }), 201);
  const same = (x: any) => ({ ...x, id: undefined, name: undefined });
  assert.deepEqual(same(withProfile), same(noProfile), 'the same answer either way');
  assert.deepEqual([withProfile.hasProfile, withProfile.asked], [false, true]);
  const shown = async () => (await ok(h.get(`${T}/${id}`, w.o1))).teams.find((t: any) => t.id === teams[0]).players.map((p: any) => same(p));
  const before0 = await shown();
  assert.deepEqual(before0[0], before0[1], 'the team list shows the same too');
  assert.equal(one<{ user_id: string | null }>('SELECT user_id FROM net_team_players WHERE id = ?', withProfile.id)!.user_id, null, 'nothing linked before the player agrees');
  // the audit names how the player was added, never whether a profile was found
  const audits = many<{ detail: string }>("SELECT detail FROM audit_log WHERE action = 'network.player_add'").map((a) => { const d = JSON.parse(a.detail); delete d.player; return d; });
  assert.deepEqual(audits[0], audits[1]);
  // the player sees the request (their sharing choice is still private: they decide for themselves)
  const mine = (await ok(h.get('/api/me/network/team-invitations', neha.token))).items;
  assert.equal(mine.length, 1);
  assert.deepEqual([mine[0].tournament, mine[0].team, mine[0].nameOnTeam], ['Surat Network Cup', 'Daji XI', 'Neha']);
  const other = await newCustomer('Other Person');
  assert.equal((await ok(h.get('/api/me/network/team-invitations', other.token))).items.length, 0);
  assert.equal((await h.post(`/api/me/network/team-invitations/${mine[0].id}`, { accept: true }, other.token)).status, 404, 'only the person asked answers');
  assert.equal((await h.get('/api/me/network/team-invitations', w.o1)).status, 403);
  // a no: the organiser sees nothing change; the request does not come back
  await ok(h.post(`/api/me/network/team-invitations/${mine[0].id}`, { accept: false }, neha.token));
  assert.deepEqual(await shown(), before0);
  assert.equal((await h.post(`/api/me/network/team-invitations/${mine[0].id}`, { accept: true }, neha.token)).status, 404);
  assert.equal(one<{ user_id: string | null }>('SELECT user_id FROM net_team_players WHERE id = ?', withProfile.id)!.user_id, null);

  // a profile shared with the network, picked from the player search: also asked; linked on yes
  const vik = await newCustomer('Vikram Rao');
  assert.equal((await add(teams[1]!, { playerId: vik.id })).status, 404, 'a private profile cannot be picked');
  await ok(h.put('/api/me/network/sharing', { visibility: 'network' }, vik.token));
  const picked = await ok(add(teams[1]!, { playerId: vik.id }), 201);
  assert.deepEqual([picked.name, picked.hasProfile, picked.asked], ['Vikram Rao', false, true]);
  assert.equal((await add(teams[2]!, { playerId: vik.id })).status, 409, 'asked for one team already');
  const ask = (await ok(h.get('/api/me/network/team-invitations', vik.token))).items[0];
  await ok(h.post(`/api/me/network/team-invitations/${ask.id}`, { accept: true }, vik.token));
  const linked = (await ok(h.get(`${T}/${id}`, w.o1))).teams.find((t: any) => t.id === teams[1]).players[0];
  assert.deepEqual([linked.hasProfile, linked.asked], [true, false]);
  // Neha said no in this tournament: she is not asked again here (the organiser still sees the same answer)
  const again = await ok(add(teams[3]!, { name: 'Neha J', phone: neha.phone }), 201);
  assert.deepEqual(same(again), same(noProfile));
  assert.equal((await ok(h.get('/api/me/network/team-invitations', neha.token))).items.length, 0);
  // a request on a player the organiser took off the team closes with it
  const kabir = await newCustomer('Kabir Shah');
  const k = await ok(add(teams[3]!, { name: 'Kabir', phone: kabir.phone }), 201);
  assert.equal((await ok(h.get('/api/me/network/team-invitations', kabir.token))).items.length, 1);
  await ok(h.del(`${T}/${id}/teams/${teams[3]}/players/${k.id}`, w.o1));
  assert.equal((await ok(h.get('/api/me/network/team-invitations', kabir.token))).items.length, 0);
});

test('review: a child whose consent is withdrawn, or whose profile is removed, leaves the team and unstarted squads; started scorecards keep only the short name, unlinked', async () => {
  const admin = await h.login('admin');
  const { id, teams } = await setUp();
  await ok(h.put('/api/admin/network/children', { on: true, legalReviewRef: 'TEST ONLY: no real review recorded' }, admin));
  const parent = await newCustomer('Priya Mehta');
  const kid = await ok(h.post('/api/me/network/children', { firstName: 'Aarav', lastName: 'Mehta', bornOn: '2015-06-01', iAmGuardian: true }, parent.token), 201);
  await ok(h.post(`/api/me/network/children/${kid.id}/consent`, { scope: 'play_record', given: true }, parent.token));
  // the organiser types the full name: it is stored as first name and initial
  const added = await ok(h.post(`${T}/${id}/teams/${teams[0]}/players`, { childCode: kid.playerCode, name: 'Aarav Mehta' }, w.o1), 201);
  assert.deepEqual([added.name, added.hasProfile, added.asked], ['Aarav M.', true, false]);
  assert.equal(one<{ name: string }>('SELECT name FROM net_team_players WHERE id = ?', added.id)!.name, 'Aarav M.');
  for (const t of teams.slice(1)) await ok(h.post(`${T}/${id}/teams/${t}/players`, { name: 'Zed' }, w.o1), 201);
  const fx = await confirmAllAndPublish(id);
  const kidFx = fx.filter((f: any) => f.teamAId === teams[0] || f.teamBId === teams[0]);
  assert.ok(kidFx.length >= 2);
  // one match has started (balls scored), another is set up but not started
  const started = (await ok(asHost(kidFx[0], 'POST', `${T}/${id}/fixtures/${kidFx[0].id}/scoring`, {}), 201)).matchId as string;
  const waiting = (await ok(asHost(kidFx[1], 'POST', `${T}/${id}/fixtures/${kidFx[1].id}/scoring`, {}), 201)).matchId as string;
  const kidRow = (m: string) => one<{ name: string; user_id: string | null; removed_at: number | null }>("SELECT name, user_id, removed_at FROM match_players WHERE match_id = ? AND name = 'Aarav M.'", m);
  assert.ok(kidRow(started)?.user_id === kid.id && kidRow(waiting)?.user_id === kid.id, 'squads use the short name, linked with consent');
  const x = hostToken(kidFx[0]);
  const kidBats = kidFx[0].teamAId === teams[0];
  await ok(h.call('POST', `/api/staff/matches/${started}/balls`, { token: x.token, headers: x.headers, body: { innings: 1, batter: kidBats ? 'Aarav M.' : 'Zed', bowler: kidBats ? 'Zed' : 'Aarav M.', runsBat: 4 } }), 201);

  // the guardian withdraws the match record
  await ok(h.post(`/api/me/network/children/${kid.id}/consent`, { scope: 'play_record', given: false }, parent.token));
  const team = (await ok(h.get(`${T}/${id}`, w.o1))).teams.find((t: any) => t.id === teams[0]);
  assert.deepEqual([team.players.length, team.playerCount], [0, 0], 'off the team in every team view');
  const closed = one<{ name: string; user_id: string | null; removed_at: number | null; removed_reason: string | null }>('SELECT * FROM net_team_players WHERE id = ?', added.id)!;
  assert.deepEqual([closed.name, closed.user_id, !!closed.removed_at, closed.removed_reason], ['Aarav M.', null, true, 'consent withdrawn']);
  assert.ok(kidRow(waiting)!.removed_at, 'off the squad of the match that has not started');
  const kept = kidRow(started)!;
  assert.deepEqual([kept.name, kept.user_id, kept.removed_at], ['Aarav M.', null, null], 'the started scorecard keeps the short name, unlinked');
  assert.equal(many("SELECT 1 FROM match_balls WHERE match_id = ? AND 'Aarav M.' IN (batter, bowler)", started).length, 1, 'the ball-by-ball record is untouched');
  assert.equal((await ok(h.get(`/api/me/network/children/${kid.id}`, parent.token))).career.matches, 0, 'on nobody\'s record');
  assert.equal(many("SELECT 1 FROM net_team_players WHERE name LIKE '%Mehta%' UNION ALL SELECT 1 FROM match_players WHERE name LIKE '%Mehta%'").length, 0, 'the full name is nowhere outside the family');
  // a new consent does not put the child back by itself; the organiser adds them again with the code
  await ok(h.post(`/api/me/network/children/${kid.id}/consent`, { scope: 'play_record', given: true }, parent.token));
  assert.equal((await ok(h.get(`${T}/${id}`, w.o1))).teams.find((t: any) => t.id === teams[0]).players.length, 0);
  const back = await ok(h.post(`${T}/${id}/teams/${teams[0]}/players`, { childCode: kid.playerCode }, w.o1), 201);
  // removing the child's profile closes the row the same way
  await ok(h.del(`/api/me/network/children/${kid.id}`, parent.token));
  const gone = one<{ user_id: string | null; removed_reason: string | null }>('SELECT * FROM net_team_players WHERE id = ?', back.id)!;
  assert.deepEqual([gone.user_id, gone.removed_reason], [null, 'profile removed']);
  assert.equal((await ok(h.get(`${T}/${id}`, w.o1))).teams.find((t: any) => t.id === teams[0]).playerCount, 0);
});

test('review: a host sees only its own ground\'s charge and answer note; the organiser sees every ground\'s', async () => {
  const { id } = await setUp();
  const charge = (d: any) => Object.fromEntries(d.grounds.map((g: any) => [g.ground, g.chargePerMatchPaise]));
  assert.deepEqual(charge(await ok(h.get(`${T}/${id}`, w.o1))), { 'Cricket Ground': 0, 'Riverside Box Cricket': 200000, 'Portfolio Turf': 50000 });
  assert.deepEqual(charge(await ok(h.get(`${T}/${id}`, w.o2))), { 'Cricket Ground': null, 'Riverside Box Cricket': 200000, 'Portfolio Turf': null });
  assert.deepEqual(charge(await ok(sp('GET', `${T}/${id}`))), { 'Cricket Ground': null, 'Riverside Box Cricket': null, 'Portfolio Turf': 50000 });
  const riv = await ok(h.get(`${T}/${id}`, w.o2));
  assert.ok(riv.grounds.filter((g: any) => !g.isMine).every((g: any) => g.note === null));
  assert.ok(!JSON.stringify(riv).includes('50000'), 'the portfolio\'s charge appears nowhere in Riverside\'s view');
});

test('review: another tournament\'s unconfirmed proposal is advice only; the first ground confirmation wins', async () => {
  await joinAll();
  const cup = async (name: string) => {
    const t = (await ok(h.post(T, { name, startDate: dayFromNow(5), endDate: dayFromNow(6), overs: 1, matchMinutes: 180 }, w.o1), 201)).tournament.id as string;
    await ok(h.post(`${T}/${t}/grounds`, { groundId: w.river, chargePerMatchPaise: 0 }, w.o1), 201);
    const inv = (await ok(h.get(`${T}/${t}`, w.o2))).grounds.find((g: any) => g.isMine);
    await ok(h.post(`${T}/${t}/grounds/${inv.id}`, { accept: true }, w.o2));
    for (const team of ['North', 'South']) await ok(h.post(`${T}/${t}/teams`, { name: team }, w.o1), 201);
    return t;
  };
  const one1 = await cup('First Cup'), two = await cup('Second Cup');
  const plan = { days: [dayFromNow(5)], times: ['09:00'] };
  const a = (await ok(h.post(`${T}/${one1}/fixtures/propose`, plan, w.o1), 201)).fixtures[0];
  // the first cup's draft proposal does not stop the second cup asking for the same time
  const b = (await ok(h.post(`${T}/${two}/fixtures/propose`, plan, w.o1), 201)).fixtures[0];
  assert.deepEqual([a.groundId, a.startsAt], [b.groundId, b.startsAt]);
  // the ground sees that two tournaments want the time; the organiser does not
  const forHost = async (t: string) => (await ok(h.get(`${T}/${t}`, w.o2))).fixtures[0].otherRequests;
  assert.deepEqual([await forHost(one1), await forHost(two)], [1, 1]);
  assert.equal((await ok(h.get(`${T}/${one1}`, w.o1))).fixtures[0].otherRequests, 0);
  // the ground confirms the second cup: it is held; the first cup can no longer have that time
  await ok(h.post(`${T}/${two}/fixtures/${b.id}/confirm`, {}, w.o2));
  const lost = await h.post(`${T}/${one1}/fixtures/${a.id}/confirm`, {}, w.o2);
  assert.equal(lost.status, 409); assert.match(JSON.stringify(lost.body), /already blocked|another network match/);
  assert.equal((await ok(h.get(`${T}/${one1}`, w.o2))).fixtures[0].otherRequests, 0, 'a confirmed match is not a competing request');
  // a fresh proposal for the first cup now leaves the confirmed time alone
  assert.equal((await h.post(`${T}/${one1}/fixtures/propose`, { ...plan, replace: true }, w.o1)).status, 400);
  const moved = (await ok(h.post(`${T}/${one1}/fixtures/propose`, { days: [dayFromNow(5)], times: ['09:00', '13:00'], replace: true }, w.o1), 201)).fixtures[0];
  assert.equal(moved.startsAt, new Date(`${dayFromNow(5)}T13:00:00+05:30`).getTime());
  await ok(h.post(`${T}/${one1}/fixtures/${moved.id}/confirm`, {}, w.o2));
  assert.equal(many("SELECT 1 FROM booking_slots WHERE kind = 'block' AND note LIKE 'Network tournament:%'").length, 6, 'two matches held, three hours each');
});
