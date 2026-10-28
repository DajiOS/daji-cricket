import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, dayFromNow, type Harness } from './helpers.ts';
import { DEFAULT_RULES, checkRules, draftRuleChange, nextMinimum } from '../src/auctionRules.ts';
import { one, run } from '../src/db.ts';

// Auction tournaments (auction.ts): a customer hosts, players sign up with their own profile, team owners bid in points,
// the host runs the hammer, and the teams go into the normal Tournaments module.

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(() => h.reset());

let n = 0;
async function customer(first: string): Promise<{ token: string; id: string; phone: string }> {
  n++;
  const phone = `98${String(70000000 + n).padStart(8, '0')}`;
  const r = await h.post('/api/auth/register', { firstName: first, lastName: 'Player', email: `${first.toLowerCase()}${n}@x.in`, phone, password: 'Cricket#2026' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { token: r.body.token, id: r.body.user.id, phone };
}
/** Hosts an auction and, unless told not to, has the owner record the hosting deposit as paid at the ground so players can see it. */
async function hostAuction(token: string, rules: Record<string, unknown> = {}, opts: { pay?: boolean; mode?: 'auction' | 'teams' } = {}) {
  const g = (await grounds(h))[0]!;
  const r = await h.post('/api/auctions', { name: 'Gully Premier League', groundId: g.id, startDate: dayFromNow(20), endDate: dayFromNow(22), overs: 10, rules, ...(opts.mode ? { mode: opts.mode } : {}) }, token);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  if (opts.pay === false) return r.body;
  const paid = await h.post(`/api/staff/auctions/${r.body.auction.id}/deposit/collect`, { method: 'cash' }, await h.login('owner1'));
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  return (await h.get(`/api/auctions/${r.body.auction.id}`, token)).body;
}

test('generic rules: defaults hold together, bid steps rise with the bidding, bad rules are refused by field', () => {
  const r = checkRules(undefined);
  assert.deepEqual(r, DEFAULT_RULES);
  assert.equal(nextMinimum(r, null), 100);
  assert.equal(nextMinimum(r, 950), 1000);
  assert.equal(nextMinimum(r, 1000), 1100);
  assert.equal(nextMinimum(r, 5000), 5250);
  assert.throws(() => checkRules({ squadMin: 16, squadMax: 12 }), /largest squad/);
  assert.throws(() => checkRules({ pursePoints: 500, basePoints: 100 }), /cover the smallest squad/);
  assert.throws(() => checkRules({ walletRupees: 5 }), /Not an auction rule/);
  assert.throws(() => checkRules({ increments: [] }), /1 to 8/);
});

test('Platform AI drafts rule changes from plain words, and refuses anything about money in any language', () => {
  const today = dayFromNow(0);
  const d = draftRuleChange(DEFAULT_RULES, 'make the purse 20,000 points, base price 200 and squads of 12 to 16 players', today);
  assert.equal(d.refused, false);
  assert.equal(d.rules!.pursePoints, 20000); assert.equal(d.rules!.basePoints, 200); assert.equal(d.rules!.squadMin, 12); assert.equal(d.rules!.squadMax, 16);
  assert.deepEqual(d.changes.map((c) => c.field).sort(), ['basePoints', 'pursePoints', 'squadMax', 'squadMin']);
  const k = draftRuleChange(DEFAULT_RULES, '1 lakh purse, 6 teams, 45 second clock, unsold players do not come back', today);
  assert.equal(k.rules!.pursePoints, 100000); assert.equal(k.rules!.teamCount, 6); assert.equal(k.rules!.bidTimerSeconds, 45); assert.equal(k.rules!.unsoldRound, false);
  const s = draftRuleChange(DEFAULT_RULES, 'bids go up by 500 after 3000', today);
  assert.deepEqual(s.rules!.increments.find((i) => i.fromPoints === 3000), { fromPoints: 3000, step: 500 });
  const hr = draftRuleChange(DEFAULT_RULES, 'add rule: each team plays one under-16 player', today);
  assert.match(hr.rules!.houseRules, /under-16/);
  const o = draftRuleChange(DEFAULT_RULES, 'players come up by role, keepers first', today);
  assert.equal(o.rules!.playerOrder, 'role');
  for (const q of ['make the purse 50,000 rupees', 'entry fee ₹500 per team', 'पर्स 5000 रुपये कर दो', 'પર્સ 5000 રૂપિયા', 'collect money by UPI from each team owner']) {
    const m = draftRuleChange(DEFAULT_RULES, q, today);
    assert.equal(m.refused, true, q); assert.equal(m.rules, null, q); assert.match(m.message!, /points, not money/);
  }
  const bad = draftRuleChange(DEFAULT_RULES, 'squads of 16 to 12', today);
  assert.equal(bad.rules, null); assert.match(bad.message!, /does not work/);
  assert.match(draftRuleChange(DEFAULT_RULES, 'hello there', today).message!, /could not find a rule/);
});

test('a customer hosts; it opens to players (no approval) once the deposit is settled and shows on the Desk; the AI draft only applies when the host confirms it', async () => {
  const host = await customer('Hira');
  const a = await hostAuction(host.token);
  assert.equal(a.auction.status, 'registration'); assert.equal(a.auction.signUpOpen, true); assert.equal(a.isHost, true);
  assert.equal(a.rules.pursePoints, 10000);
  const id = a.auction.id;

  const other = await customer('Ojas');
  const list = await h.get('/api/auctions', other.token);
  assert.ok(list.body.open.some((x: any) => x.id === id), 'open to other customers without approval');

  const owner = await h.login('owner1');
  const desk = await h.get('/api/staff/auctions', owner);
  assert.equal(desk.status, 200);
  assert.ok(desk.body.items.some((x: any) => x.id === id));
  const tours = await h.get('/api/staff/tournaments', owner);
  const t = tours.body.items.find((x: any) => x.id === a.tournament.id);
  assert.equal(t.organiser.customerId, host.id); assert.equal(t.entryFeePaise, 0);

  // draft: nothing changes until confirmed
  const d = await h.post(`/api/auctions/${id}/rules/draft`, { text: 'purse 15000 and 30 second clock' }, host.token);
  assert.equal(d.status, 200); assert.equal(d.body.rules.pursePoints, 15000);
  assert.equal((await h.get(`/api/auctions/${id}`, host.token)).body.rules.pursePoints, 10000);
  const notHost = await h.post(`/api/auctions/${id}/rules/draft`, { text: 'purse 15000' }, other.token);
  assert.equal(notHost.status, 403);
  const money = await h.post(`/api/auctions/${id}/rules/draft`, { text: 'purse 15000 rupees' }, host.token);
  assert.equal(money.body.refused, true); assert.equal(money.body.rules, null);

  const saved = await h.post(`/api/auctions/${id}/rules`, { rules: d.body.rules, expectVersion: d.body.rulesVersion, source: 'ai', request: 'purse 15000 and 30 second clock' }, host.token);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.rules.pursePoints, 15000); assert.equal(saved.body.rulesVersion, 2);
  assert.deepEqual(saved.body.changes.map((c: any) => c.field), ['pursePoints']);
  // a second save from the stale draft is refused rather than overwriting
  const stale = await h.post(`/api/auctions/${id}/rules`, { rules: { pursePoints: 12000 }, expectVersion: 1 }, host.token);
  assert.equal(stale.status, 409); assert.equal(stale.body.error.code, 'RULES_CHANGED');
  const hist = await h.get(`/api/auctions/${id}/rules/history`, host.token);
  assert.equal(hist.body.items[0].source, 'ai'); assert.equal(hist.body.items[0].request, 'purse 15000 and 30 second clock');

  // staff cannot host from the customer screens, and a customer can only run three at once
  assert.equal((await h.post('/api/auctions', { name: 'Staff cup', groundId: (await grounds(h))[0]!.id, startDate: dayFromNow(5), endDate: dayFromNow(6) }, owner)).status, 403);
  await hostAuction(host.token); await hostAuction(host.token);
  const fourth = await h.post('/api/auctions', { name: 'Too many', groundId: (await grounds(h))[0]!.id, startDate: dayFromNow(5), endDate: dayFromNow(6) }, host.token);
  assert.equal(fourth.status, 409); assert.equal(fourth.body.error.code, 'TOO_MANY_AUCTIONS');
});

test('players join with their own profile; no phone or email is shown; sign-up closes when full or when bidding starts', async () => {
  const host = await customer('Hema');
  const a = await hostAuction(host.token, { teamCount: 2, squadMin: 1, squadMax: 2, maxPlayers: 3 });
  const id = a.auction.id;
  const ps = [await customer('Arjun'), await customer('Bhavin'), await customer('Chirag'), await customer('Dev')];
  const j = await h.post(`/api/auctions/${id}/join`, { role: 'batter', batting: 'left', bowling: 'Off spin' }, ps[0]!.token);
  assert.equal(j.status, 200, JSON.stringify(j.body));
  const me = j.body.players.find((p: any) => p.isYou);
  assert.equal(me.name, 'Arjun Player'); assert.equal(me.roleText, 'Batter');
  assert.ok(!JSON.stringify(j.body).includes(ps[0]!.phone), 'no phone numbers in the auction');
  assert.equal((await h.post(`/api/auctions/${id}/join`, { role: 'batter' }, ps[0]!.token)).body.error.code, 'ALREADY_JOINED');
  assert.equal((await h.post(`/api/auctions/${id}/join`, { role: 'captain' }, ps[1]!.token)).status, 400);
  await h.post(`/api/auctions/${id}/join`, { role: 'bowler' }, ps[1]!.token);
  await h.post(`/api/auctions/${id}/join`, { role: 'wicket_keeper' }, ps[2]!.token);
  const full = await h.post(`/api/auctions/${id}/join`, { role: 'all_rounder' }, ps[3]!.token);
  assert.equal(full.status, 409); assert.equal(full.body.error.code, 'SIGN_UP_CLOSED'); assert.match(full.body.error.message, /full/);
  // leave and re-join
  assert.equal((await h.post(`/api/auctions/${id}/leave`, {}, ps[2]!.token)).status, 200);
  assert.equal((await h.post(`/api/auctions/${id}/join`, { role: 'all_rounder' }, ps[3]!.token)).status, 200);
  // host removes one with a reason; they cannot re-join
  const view = (await h.get(`/api/auctions/${id}`, host.token)).body;
  const dev = view.players.find((p: any) => p.name === 'Dev Player');
  assert.equal((await h.post(`/api/auctions/${id}/players/${dev.id}/remove`, {}, host.token)).status, 400);
  assert.equal((await h.post(`/api/auctions/${id}/players/${dev.id}/remove`, { reason: 'Not a club member' }, host.token)).status, 200);
  assert.equal((await h.post(`/api/auctions/${id}/join`, { role: 'batter' }, ps[3]!.token)).body.error.code, 'REMOVED_BY_HOST');
  // staff and owners do not sign up as players
  assert.equal((await h.post(`/api/auctions/${id}/join`, { role: 'batter' }, await h.login('owner1'))).status, 403);
});

test('the full auction: owners bid for their own teams, purse and squad rules hold, hammer, undo, unsold round, finish into Tournaments', async () => {
  const host = await customer('Harsh');
  const o1 = await customer('Kiran'), o2 = await customer('Lalit');
  let a = await hostAuction(host.token, { teamCount: 2, squadMin: 2, squadMax: 2, pursePoints: 1000, basePoints: 100, increments: [{ fromPoints: 0, step: 100 }], playerOrder: 'registration' });
  const id = a.auction.id;
  const t1 = await h.post(`/api/auctions/${id}/teams`, { name: 'Royal Strikers', ownerPhone: o1.phone }, host.token);
  assert.equal(t1.status, 201, JSON.stringify(t1.body));
  await h.post(`/api/auctions/${id}/teams`, { name: 'Night Riders', ownerPhone: o2.phone }, host.token);
  assert.equal((await h.post(`/api/auctions/${id}/teams`, { name: 'Third' }, host.token)).status, 400, 'the rules say two teams');
  assert.equal((await h.post(`/api/auctions/${id}/teams`, { name: 'Ghost', ownerPhone: '9999999999' }, host.token)).status, 400);

  // too few players to start
  assert.equal((await h.post(`/api/auctions/${id}/start`, {}, host.token)).body.error.code, 'NEED_PLAYERS');
  const players = [await customer('Pa'), await customer('Pb'), await customer('Pc'), await customer('Pd'), await customer('Pe')];
  for (const p of players) assert.equal((await h.post(`/api/auctions/${id}/join`, { role: 'batter' }, p.token)).status, 200);
  assert.equal((await h.post(`/api/auctions/${id}/start`, {}, o1.token)).status, 403, 'only the host starts');
  a = (await h.post(`/api/auctions/${id}/start`, {}, host.token)).body;
  assert.equal(a.auction.status, 'live');
  assert.equal((await h.post(`/api/auctions/${id}/join`, { role: 'batter' }, (await customer('Late')).token)).body.error.code, 'SIGN_UP_CLOSED');
  assert.equal((await h.post(`/api/auctions/${id}/rules/draft`, { text: 'purse 2000' }, host.token)).status, 409, 'rules are locked once bidding starts');

  const teams = a.teams as any[];
  const [rs, nr] = [teams.find((t) => t.name === 'Royal Strikers'), teams.find((t) => t.name === 'Night Riders')];
  assert.equal(rs.maxBidPoints, 900, 'keeps 100 for the second player');

  // lot 1: Pa
  a = (await h.post(`/api/auctions/${id}/next`, {}, host.token)).body;
  assert.equal(a.lot.player.name, 'Pa Player'); assert.equal(a.lot.nextMinimumPoints, 100);
  assert.equal((await h.post(`/api/auctions/${id}/bid`, { teamId: nr.id, points: 100 }, o1.token)).status, 403, 'cannot bid for another owner\'s team');
  assert.equal((await h.post(`/api/auctions/${id}/bid`, { teamId: rs.id, points: 50 }, o1.token)).body.error.code, 'BID_TOO_LOW');
  assert.equal((await h.post(`/api/auctions/${id}/bid`, { teamId: rs.id, points: 100, lotNo: a.lot.lotNo }, o1.token)).status, 200);
  assert.equal((await h.post(`/api/auctions/${id}/bid`, { teamId: rs.id, points: 200 }, o1.token)).body.error.code, 'ALREADY_TOP');
  // two owners tap the same amount: only one bid can stand
  const [x, y] = await Promise.all([
    h.post(`/api/auctions/${id}/bid`, { teamId: nr.id, points: 200 }, o2.token),
    h.post(`/api/auctions/${id}/bid`, { teamId: nr.id, points: 200 }, host.token),
  ]);
  assert.deepEqual([x.status, y.status].sort(), [200, 409]);
  const over = await h.post(`/api/auctions/${id}/bid`, { teamId: rs.id, points: 1000 }, o1.token);
  assert.equal(over.body.error.code, 'OVER_PURSE'); assert.equal(over.body.error.details.maxBidPoints, 900);
  assert.equal((await h.post(`/api/auctions/${id}/bid`, { teamId: rs.id, points: 900 }, o1.token)).status, 200);
  // a mistake in the room: the host takes the top bid back, then it is placed again
  a = (await h.post(`/api/auctions/${id}/bid/retract`, {}, host.token)).body;
  assert.equal(a.lot.bidPoints, 200); assert.equal(a.lot.bidTeamName, 'Night Riders');
  await h.post(`/api/auctions/${id}/bid`, { teamId: rs.id, points: 800 }, o1.token);
  assert.equal((await h.post(`/api/auctions/${id}/next`, {}, host.token)).body.error.code, 'PLAYER_UP');
  a = (await h.post(`/api/auctions/${id}/hammer`, {}, host.token)).body;
  assert.equal(a.lot, null);
  const rs1 = a.teams.find((t: any) => t.id === rs.id);
  assert.equal(rs1.squad, 1); assert.equal(rs1.pursePointsLeft, 200); assert.equal(rs1.maxBidPoints, 200);
  assert.equal(a.players.find((p: any) => p.name === 'Pa Player').teamName, 'Royal Strikers');

  // undo the sale and sell again lower
  a = (await h.post(`/api/auctions/${id}/undo`, {}, host.token)).body;
  assert.equal(a.teams.find((t: any) => t.id === rs.id).pursePointsLeft, 1000);
  a = (await h.post(`/api/auctions/${id}/next`, {}, host.token)).body;
  assert.equal(a.lot.player.name, 'Pa Player');
  await h.post(`/api/auctions/${id}/bid`, { teamId: rs.id, points: 300 }, o1.token);
  await h.post(`/api/auctions/${id}/hammer`, {}, host.token);
  const lots = one<{ n: number; u: number }>('SELECT COUNT(*) n, SUM(undone_at IS NOT NULL) u FROM auction_lots WHERE auction_id = ?', id)!;
  assert.equal(lots.n, 2); assert.equal(lots.u, 1, 'the undone sale is kept, marked undone');

  // Pb unsold, Pc to NR, Pd to RS, Pe to NR: both squads full
  await h.post(`/api/auctions/${id}/next`, {}, host.token);
  a = (await h.post(`/api/auctions/${id}/hammer`, {}, host.token)).body;
  assert.equal(a.players.find((p: any) => p.name === 'Pb Player').result, 'unsold');
  for (const [team, tok] of [[nr, o2], [rs, o1], [nr, o2]] as const) {
    a = (await h.post(`/api/auctions/${id}/next`, {}, host.token)).body;
    assert.equal((await h.post(`/api/auctions/${id}/bid`, { teamId: team.id, points: 100 }, tok.token)).status, 200);
    a = (await h.post(`/api/auctions/${id}/hammer`, {}, host.token)).body;
  }
  // the unsold round brings Pb back; both squads are full, so nobody can bid
  a = (await h.post(`/api/auctions/${id}/next`, {}, host.token)).body;
  assert.equal(a.lot.player.name, 'Pb Player'); assert.equal(a.lot.round, 2);
  assert.equal((await h.post(`/api/auctions/${id}/bid`, { teamId: nr.id, points: 100 }, o2.token)).body.error.code, 'SQUAD_FULL');
  await h.post(`/api/auctions/${id}/hammer`, {}, host.token);
  assert.equal((await h.post(`/api/auctions/${id}/next`, {}, host.token)).body.error.code, 'POOL_EMPTY');

  const fin = await h.post(`/api/auctions/${id}/finish`, {}, host.token);
  assert.equal(fin.status, 200, JSON.stringify(fin.body));
  assert.equal(fin.body.auction.status, 'completed'); assert.deepEqual(fin.body.shortTeams, []);
  const owner = await h.login('owner1');
  const td = await h.get(`/api/staff/tournaments/${fin.body.tournament.id}`, owner);
  assert.deepEqual(td.body.teams.map((t: any) => t.name).sort(), ['Night Riders', 'Royal Strikers']);
  const fx = await h.post(`/api/auctions/${id}/fixtures`, { startDate: dayFromNow(20) }, host.token);
  assert.equal(fx.status, 201, JSON.stringify(fx.body)); assert.equal(fx.body.created, 1);
  const tv = await h.get(`/api/auctions/${id}/tournament`, players[0]!.token);
  assert.equal(tv.body.fixtures.length, 1);

  // polling: nothing changed gives a short answer
  const v = (await h.get(`/api/auctions/${id}`, o1.token)).body;
  assert.deepEqual((await h.get(`/api/auctions/${id}?since=${v.version}`, o1.token)).body, { changed: false, version: v.version });
  // the picked player can see their team
  const mine = (await h.get(`/api/auctions/${id}`, players[0]!.token)).body.players.find((p: any) => p.isYou);
  assert.equal(mine.teamName, 'Royal Strikers'); assert.equal(mine.points, 300);
});

test('staff can hide an auction (players no longer see it, the host sees why) and show it again; the switch turns the feature off', async () => {
  const host = await customer('Ishan');
  const a = await hostAuction(host.token);
  const id = a.auction.id;
  const p = await customer('Jay');
  const staff = await h.login('staff1');
  assert.equal((await h.get('/api/staff/auctions', staff)).status, 403, 'needs manage_matches');
  const owner = await h.login('owner1');
  assert.equal((await h.post(`/api/staff/auctions/${id}/hide`, {}, owner)).status, 400, 'a reason is required');
  assert.equal((await h.post(`/api/staff/auctions/${id}/hide`, { reason: 'Offensive team names' }, owner)).status, 200);
  assert.equal((await h.get(`/api/auctions/${id}`, p.token)).status, 404);
  assert.ok(!(await h.get('/api/auctions', p.token)).body.open.some((x: any) => x.id === id));
  const hv = await h.get(`/api/auctions/${id}`, host.token);
  assert.equal(hv.status, 200); assert.equal(hv.body.hiddenReason, 'Offensive team names'); assert.equal(hv.body.canEditRules, false);
  assert.equal((await h.post(`/api/auctions/${id}/teams`, { name: 'A team' }, host.token)).body.error.code, 'AUCTION_HIDDEN');
  // another business cannot see or hide it
  assert.equal((await h.post(`/api/staff/auctions/${id}/hide`, { reason: 'not mine' }, await h.login('owner2'))).status, 404);
  assert.equal((await h.post(`/api/staff/auctions/${id}/unhide`, {}, owner)).status, 200);
  assert.equal((await h.get(`/api/auctions/${id}`, p.token)).status, 200);

  assert.equal((await h.put('/api/admin/settings', { auctionTournamentsEnabled: false }, await h.login('admin'))).status, 200);
  const off = await h.get('/api/auctions', p.token);
  assert.equal(off.status, 503); assert.equal(off.body.error.code, 'FEATURE_OFF');
  assert.equal((await h.get('/api/config')).body.auctionsEnabled, false);
});

test('host cancels with a reason; a host cannot delete their account while an auction runs', async () => {
  const host = await customer('Neel');
  const a = await hostAuction(host.token);
  const del = await h.post('/api/me/delete', { confirm: 'DELETE', password: 'Cricket#2026' }, host.token);
  assert.equal(del.status, 409, JSON.stringify(del.body)); assert.equal(del.body.error.code, 'HOSTS_AUCTION');
  assert.equal((await h.post(`/api/auctions/${a.auction.id}/cancel`, {}, host.token)).status, 400);
  const c = await h.post(`/api/auctions/${a.auction.id}/cancel`, { reason: 'Rain all week' }, host.token);
  assert.equal(c.body.auction.status, 'cancelled'); assert.equal(c.body.tournament.status, 'cancelled');
});

test('Ask AI finds what auctions store: a player asks if they were picked, a host drafts a rule change (not saved), staff ask what is running', async () => {
  const host = await customer('Ravi');
  const owner1 = await customer('Sam');
  const a = await hostAuction(host.token, { teamCount: 2, squadMin: 1, squadMax: 2 });
  const id = a.auction.id;
  const p1 = await customer('Tara'), p2 = await customer('Uma');
  const before = await h.post('/api/ask', { question: 'Is there an auction I can join?' }, p1.token);
  assert.equal(before.body.intent, 'auction'); assert.match(before.body.answer, /open for players to sign up: Gully Premier League/);
  // the host asks for a rule change: a draft only
  const d = await h.post('/api/ask', { question: 'change the auction purse to 20,000 points' }, host.token);
  assert.equal(d.body.intent, 'auction_rules_draft'); assert.equal(d.body.open, 'auction'); assert.equal(d.body.auctionId, id);
  assert.match(d.body.answer, /Nothing is saved yet/); assert.equal(d.body.details[0].label, 'Purse per team');
  assert.equal((await h.get(`/api/auctions/${id}`, host.token)).body.rules.pursePoints, 10000);
  const m = await h.post('/api/ask', { question: 'make the auction purse 20000 rupees' }, host.token);
  assert.equal(m.body.intent, 'payment_boundary'); assert.match(m.body.answer, /points, not money/);
  // a player asking to change the rules only gets the rules read back
  const pr = await h.post('/api/ask', { question: 'what are the auction rules?' }, p1.token);
  assert.equal(pr.body.intent, 'auction_rules'); assert.ok(pr.body.details.some((x: any) => /10,000 points/.test(x.text)));

  await h.post(`/api/auctions/${id}/teams`, { name: 'Lions', ownerPhone: owner1.phone }, host.token);
  await h.post(`/api/auctions/${id}/teams`, { name: 'Tigers' }, host.token);
  await h.post(`/api/auctions/${id}/join`, { role: 'batter' }, p1.token);
  await h.post(`/api/auctions/${id}/join`, { role: 'bowler' }, p2.token);
  await h.post(`/api/auctions/${id}/start`, {}, host.token);
  const v = (await h.post(`/api/auctions/${id}/next`, { }, host.token)).body;
  const lions = v.teams.find((t: any) => t.name === 'Lions');
  await h.post(`/api/auctions/${id}/bid`, { teamId: lions.id, points: 400 }, owner1.token);
  await h.post(`/api/auctions/${id}/hammer`, {}, host.token);
  const picked = v.lot.player.name === 'Tara Player' ? p1 : p2;
  const ans = await h.post('/api/ask', { question: 'Was I picked?' }, picked.token);
  assert.match(ans.body.answer, /picked by Lions for 400 points/);

  const owner = await h.login('owner1');
  const s = await h.post('/api/staff/ask', { question: 'Which auction tournaments are running?' }, owner);
  assert.equal(s.body.intent, 'auctions', JSON.stringify(s.body)); assert.match(s.body.answer, /1 auction is running now/);
  assert.ok(s.body.details[0].text.includes('host Ravi Player'));
  assert.ok(!JSON.stringify(s.body).includes(picked.phone));
  const staff = await h.login('staff1');
  const no = await h.post('/api/staff/ask', { question: 'Which auctions are running?' }, staff);
  assert.match(no.body.answer, /manage_matches/);
});

test('hosting deposit: hidden from players until paid; the host can send a UPI reference; staff record it; refunded at the end; kept only by the owner with a reason; in the books as a liability', async () => {
  const host = await customer('Varun'), p = await customer('Wasim');
  const a = await hostAuction(host.token, { teamCount: 2, squadMin: 1, squadMax: 1 }, { pay: false });
  const id = a.auction.id;
  assert.equal(a.deposit.requiredPaise, 500000); assert.equal(a.deposit.settled, false); assert.equal(a.auction.statusText, 'Waiting for the hosting deposit');
  assert.ok(a.depositHowToPay.contactPhone);
  // players cannot see or join it yet
  assert.ok(!(await h.get('/api/auctions', p.token)).body.open.some((x: any) => x.id === id));
  assert.equal((await h.get(`/api/auctions/${id}`, p.token)).status, 404);
  assert.equal((await h.post(`/api/auctions/${id}/join`, { role: 'batter' }, p.token)).status, 404);
  // the host says they paid by UPI; nothing is marked paid until staff record it
  const claim = await h.post(`/api/auctions/${id}/deposit/paid`, { reference: 'UTR123456789' }, host.token);
  assert.equal(claim.body.claimReference, 'UTR123456789'); assert.equal(claim.body.settled, false);
  const owner = await h.login('owner1'), staff = await h.login('staff1');
  const desk = (await h.get(`/api/staff/auctions/${id}`, owner)).body;
  assert.equal(desk.deposit.claimReference, 'UTR123456789');
  // the staff login has no manage_matches, so cannot reach it; the owner records it
  assert.equal((await h.post(`/api/staff/auctions/${id}/deposit/collect`, { method: 'upi' }, staff)).status, 403);
  assert.equal((await h.post(`/api/staff/auctions/${id}/deposit/collect`, { method: 'upi', amountPaise: 600000 }, owner)).body.error.code, 'DEPOSIT_TOO_MUCH');
  const paid = await h.post(`/api/staff/auctions/${id}/deposit/collect`, { method: 'upi', reference: 'UTR123456789' }, owner);
  assert.equal(paid.body.settled, true); assert.equal(paid.body.heldPaise, 500000);
  assert.equal((await h.post(`/api/staff/auctions/${id}/deposit/collect`, { method: 'cash' }, owner)).body.error.code, 'DEPOSIT_SETTLED');
  assert.ok((await h.get('/api/auctions', p.token)).body.open.some((x: any) => x.id === id), 'open to players once paid');
  // the money is in the books as a refundable liability, not income
  const { ledgerLines } = await import('../src/accounting/ledger.ts');
  const lines = ledgerLines((await h.get('/api/me', owner)).body.user.id, dayFromNow(400)).filter((l) => l.src === 'tdeposit');
  assert.ok(lines.some((l) => l.account === 'tournament_deposits_held' && l.credit === 500000), JSON.stringify(lines));
  assert.ok(!lines.some((l) => l.account === 'booking_income'), 'never booking income');
  // keeping is the owner's decision, only after the tournament is over, with a reason
  assert.equal((await h.post(`/api/staff/auctions/${id}/deposit/keep`, { reason: 'Matches were played at another ground' }, owner)).body.error.code, 'TOURNAMENT_NOT_OVER');
  await h.post(`/api/auctions/${id}/cancel`, { reason: 'Moved elsewhere' }, host.token);
  assert.equal((await h.post(`/api/staff/auctions/${id}/deposit/keep`, { reason: 'short' }, owner)).body.error.code, 'REASON_REQUIRED');
  const kept = await h.post(`/api/staff/auctions/${id}/deposit/keep`, { amountPaise: 200000, reason: 'Matches were played at another ground' }, owner);
  assert.equal(kept.body.keptPaise, 200000); assert.equal(kept.body.heldPaise, 300000);
  assert.equal((await h.post(`/api/staff/auctions/${id}/deposit/refund`, { method: 'upi', amountPaise: 400000 }, owner)).body.error.code, 'DEPOSIT_TOO_SMALL');
  const back = await h.post(`/api/staff/auctions/${id}/deposit/refund`, { method: 'upi', reference: 'RFND1' }, owner);
  assert.equal(back.body.heldPaise, 0); assert.equal(back.body.refundedPaise, 300000);
  // entries are never changed or deleted
  assert.throws(() => run("UPDATE auction_deposit_entries SET amount_paise = 1"), /append-only/);
  assert.throws(() => run('DELETE FROM auction_deposit_entries'), /append-only/);
  const hv = (await h.get(`/api/auctions/${id}`, host.token)).body;
  assert.equal(hv.deposit.entries.find((e: any) => e.kind === 'keep').reason, 'Matches were played at another ground');
});

test('deposit waiver: the host asks, only an admin decides; a declined host can ask once more; a host cannot delete their account while a deposit is held', async () => {
  const host = await customer('Yash');
  const a = await hostAuction(host.token, {}, { pay: false });
  const id = a.auction.id;
  assert.equal((await h.post(`/api/auctions/${id}/deposit/waiver`, { reason: 'short' }, host.token)).status, 400);
  const w = await h.post(`/api/auctions/${id}/deposit/waiver`, { reason: 'Charity tournament for the village school' }, host.token);
  assert.equal(w.body.waiver.status, 'pending');
  assert.equal((await h.post(`/api/auctions/${id}/deposit/waiver`, { reason: 'Charity tournament for the village school' }, host.token)).body.error.code, 'WAIVER_PENDING');
  const owner = await h.login('owner1');
  assert.equal((await h.post(`/api/staff/auctions/${id}/deposit/waiver`, { approve: false }, owner)).status, 400, 'a refusal needs a note');
  const no = await h.post(`/api/staff/auctions/${id}/deposit/waiver`, { approve: false, note: 'Please pay; it is refunded at the end' }, owner);
  assert.equal(no.body.waiver.status, 'declined'); assert.equal(no.body.settled, false);
  await h.post(`/api/auctions/${id}/deposit/waiver`, { reason: 'We are a registered charity, letter attached at the desk' }, host.token);
  const yes = await h.post(`/api/staff/auctions/${id}/deposit/waiver`, { approve: true }, owner);
  assert.equal(yes.body.waived, true); assert.equal(yes.body.settled, true);
  const p = await customer('Zoya');
  assert.ok((await h.get('/api/auctions', p.token)).body.open.some((x: any) => x.id === id));

  // a held deposit blocks deleting the account
  const host2 = await customer('Abhay');
  const b = await hostAuction(host2.token);
  await h.post(`/api/auctions/${b.auction.id}/cancel`, { reason: 'Changed plans' }, host2.token);
  const del = await h.post('/api/me/delete', { confirm: 'DELETE', password: 'Cricket#2026' }, host2.token);
  assert.equal(del.body.error.code, 'DEPOSIT_HELD');
  // the deposit amount is a setting; 0 means no deposit
  assert.equal((await h.put('/api/admin/settings', { hostedTournamentDepositPaise: 0 }, await h.login('admin'))).status, 200);
  const c = await hostAuction(host.token, {}, { pay: false });
  assert.equal(c.deposit.settled, true); assert.equal(c.auction.statusText, 'Players signing up');
});

test('a customer hosts a round robin with teams entering directly: same deposit rule, no player auction, teams go into the tournament', async () => {
  const host = await customer('Bina');
  const a = await hostAuction(host.token, { teamCount: 4 }, { mode: 'teams', pay: false });
  const id = a.auction.id;
  assert.equal(a.auction.mode, 'teams'); assert.equal(a.auction.statusText, 'Waiting for the hosting deposit');
  assert.match(a.rulesInWords[0], /Up to 4 teams/);
  for (const n of ['Aces', 'Bulls', 'Comets']) assert.equal((await h.post(`/api/auctions/${id}/teams`, { name: n }, host.token)).status, 201);
  assert.equal((await h.post(`/api/auctions/${id}/finish`, {}, host.token)).body.error.code, 'DEPOSIT_DUE');
  await h.post(`/api/staff/auctions/${id}/deposit/collect`, { method: 'cash' }, await h.login('owner1'));
  const p = await customer('Chetan');
  assert.equal((await h.post(`/api/auctions/${id}/join`, { role: 'batter' }, p.token)).body.error.code, 'NOT_AN_AUCTION');
  assert.equal((await h.post(`/api/auctions/${id}/start`, {}, host.token)).body.error.code, 'NOT_AN_AUCTION');
  const fin = await h.post(`/api/auctions/${id}/finish`, {}, host.token);
  assert.equal(fin.status, 200, JSON.stringify(fin.body)); assert.equal(fin.body.auction.statusText, 'Teams confirmed'); assert.deepEqual(fin.body.shortTeams, []);
  const fx = await h.post(`/api/auctions/${id}/fixtures`, { startDate: dayFromNow(20) }, host.token);
  assert.equal(fx.body.created, 3);
  const owner = await h.login('owner1');
  const s = await h.post('/api/staff/ask', { question: 'How much hosting deposit is held?' }, owner);
  assert.equal(s.body.intent, 'auctions'); assert.match(s.body.answer, /₹5,000 in hosting deposits is held/);
});
