import { many, one, run, tx } from './db.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { HttpError, conflict, notFound } from './errors.ts';
import { Validator, normalizePhone } from './input.ts';
import { audit, type Actor } from './audit.ts';
import { hasPermission, type UserRow } from './auth.ts';
import { ownsCustomer } from './contacts.ts';
import { battingSide, howOut, nameKey, FIELDER_KINDS, type BallRow, type MatchRow } from './matches.ts';

// Player career records, like CricHeroes (owner, 28 Oct 2026). A player is their Daji profile: the customer account, found by mobile
// number, the same profile the booking team list and check-in use (players.ts). Each scored match has two squads (match_players): the
// names the scorer uses, each linked to a profile or a guest (a name only: a guest earns no record, as a guest earns no games).
// Squads are filled from a booking's team list or by mobile number. Career batting, bowling and fielding are worked out from the balls
// of finished matches each time they are asked for, never typed in or stored twice: an undone ball or a corrected link shows at once.
// A player sees their own record everywhere they played; a business sees only the matches scored at its own grounds. A player can say
// a linked match was not them: the link comes off, the same profile cannot be linked to that match again, and the audit keeps it.

export const MAX_SQUAD = 20;
const BALLS_PER_OVER = 6;

interface SquadRow {
  id: string; match_id: string; owner_id: string; side: 'a' | 'b'; name: string; name_key: string; user_id: string | null; linked_via: 'phone' | 'team_list' | null;
  linked_at: number | null; disowned_user_id: string | null; disowned_at: number | null; booking_player_id: string | null; created_at: number;
}

const ownMatch = (ownerId: string, id: string): MatchRow => {
  const m = one<MatchRow>('SELECT * FROM matches WHERE id = ? AND owner_id = ?', id, ownerId);
  if (!m) throw notFound('Match not found');
  return m;
};
const squadOf = (matchId: string): SquadRow[] => many<SquadRow>('SELECT * FROM match_players WHERE match_id = ? AND removed_at IS NULL ORDER BY side, created_at, rowid', matchId);
const profileByPhone = (phone: string) => one<{ id: string; name: string }>("SELECT id, name FROM users WHERE phone = ? AND role = 'customer' AND active = 1 ORDER BY (password_hash IS NOT NULL) DESC, created_at LIMIT 1", normalizePhone(phone));
/** How many balls of the match use this name (as batter, bowler, out or fielder). A name in use cannot be renamed or taken off. */
const ballsNaming = (matchId: string, key: string): number => many<{ batter: string; bowler: string; out_player: string | null; fielder: string | null }>(
  'SELECT batter, bowler, out_player, fielder FROM match_balls WHERE match_id = ?', matchId).filter((b) => [b.batter, b.bowler, b.out_player, b.fielder].some((n) => n && nameKey(n) === key)).length;

export interface SquadPlayer { id: string; side: 'a' | 'b'; name: string; hasProfile: boolean; linkedVia: 'phone' | 'team_list' | null; profileName: string | null; saidNotThem: boolean; inUse: boolean }

/** Both squads of a match, for its scorer. The profile's own name is shown only to someone who may see customers. */
export function squads(u: UserRow, ownerId: string, matchId: string) {
  const m = ownMatch(ownerId, matchId);
  const rows = squadOf(m.id);
  const names = new Map(many<{ id: string; name: string }>(`SELECT id, name FROM users WHERE id IN (${rows.map(() => '?').join(',') || "''"})`, ...rows.map((r) => r.user_id ?? '')).map((x) => [x.id, x.name]));
  const seeNames = hasPermission(u, 'view_customers');
  const balls = many<{ batter: string; bowler: string; out_player: string | null; fielder: string | null }>('SELECT batter, bowler, out_player, fielder FROM match_balls WHERE match_id = ?', m.id);
  const used = new Set(balls.flatMap((b) => [b.batter, b.bowler, b.out_player, b.fielder]).filter((n): n is string => !!n).map(nameKey));
  const view = (r: SquadRow): SquadPlayer => ({
    id: r.id, side: r.side, name: r.name, hasProfile: !!r.user_id, linkedVia: r.linked_via, profileName: seeNames && r.user_id ? names.get(r.user_id) ?? null : null,
    saidNotThem: !!r.disowned_at && !r.user_id, inUse: used.has(r.name_key),
  });
  return {
    matchId: m.id, status: m.status, maxPerSide: MAX_SQUAD,
    sides: (['a', 'b'] as const).map((side) => ({ side, team: side === 'a' ? m.team_a : m.team_b, players: rows.filter((r) => r.side === side).map(view) })),
  };
}

function readSide(v: Validator): 'a' | 'b' | undefined {
  return v.oneOf('side', ['a', 'b'] as const);
}
function checkRoom(matchId: string, side: 'a' | 'b', adding: number): void {
  const n = one<{ n: number }>('SELECT COUNT(*) n FROM match_players WHERE match_id = ? AND side = ? AND removed_at IS NULL', matchId, side)!.n;
  if (n + adding > MAX_SQUAD) throw conflict('SQUAD_FULL', `A squad holds at most ${MAX_SQUAD} players.`);
}
function checkFree(m: MatchRow, key: string | null, userId: string | null, exceptId?: string): void {
  const rows = squadOf(m.id).filter((r) => r.id !== exceptId);
  if (key !== null && rows.some((r) => r.name_key === key)) throw conflict('NAME_TAKEN', 'That name is already in a squad of this match. Use a different name (add a surname or initial).');
  if (userId && rows.some((r) => r.user_id === userId)) throw conflict('PLAYER_ALREADY_ADDED', 'That player is already in a squad of this match.');
  if (userId && one('SELECT 1 FROM match_players WHERE match_id = ? AND disowned_user_id = ?', m.id, userId)) throw conflict('SAID_NOT_THEM', 'That player said they did not play in this match, so their profile cannot be linked to it again.');
}

/** Adds a player to a squad: with a mobile number that has a Daji profile they are linked and earn the record; otherwise a guest. */
export function addSquadPlayer(actor: Actor, ownerId: string, matchId: string, body: unknown) {
  const m = ownMatch(ownerId, matchId);
  const v = new Validator(body ?? {});
  const side = readSide(v);
  const name = v.str('name', { required: true, min: 1, max: 40 });
  const phone = v.phone('phone');
  if (!side) v.fail('side', 'Pick the team (a or b)');
  v.done();
  const prof = phone ? profileByPhone(phone) : undefined;
  const id = newId('mp');
  tx(() => {
    checkRoom(m.id, side!, 1);
    checkFree(m, nameKey(name!), prof?.id ?? null);
    const t = now();
    run('INSERT INTO match_players(id, match_id, owner_id, side, name, name_key, user_id, linked_via, linked_by, linked_at, added_by, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      id, m.id, ownerId, side!, name!.trim().replace(/\s+/g, ' '), nameKey(name!), prof?.id ?? null, prof ? 'phone' : null, prof ? actor.id : null, prof ? t : null, actor.id, t);
    audit(actor, 'match.squad_add', 'match', m.id, { player: id, side, profile: !!prof }, ownerId);
  });
  return { player: id, profile: !!prof, note: prof ? null : phone ? 'No Daji profile has that number, so they are in the squad as a guest: their runs and wickets will not go on a record.' : 'Added as a guest (no mobile number): their runs and wickets will not go on a record.' };
}

/** Brings a booking's team list into a squad: players with a profile come in linked, guests as guests. Anyone already in the match is skipped. */
export function importTeamList(actor: Actor, ownerId: string, matchId: string, body: unknown) {
  const m = ownMatch(ownerId, matchId);
  const v = new Validator(body ?? {});
  const side = readSide(v);
  const ref = v.str('bookingRef', { required: true, min: 2, max: 40 });
  if (!side) v.fail('side', 'Pick the team (a or b)');
  v.done();
  const b = one<{ id: string; customer_id: string }>('SELECT id, customer_id FROM bookings WHERE owner_id = ? AND UPPER(ref) = UPPER(?) AND deleted_at IS NULL', ownerId, ref!.trim());
  if (!b) throw notFound('No booking at your grounds has that reference');
  const list = many<{ id: string; user_id: string | null; name: string }>('SELECT id, user_id, name FROM booking_players WHERE booking_id = ? AND voided_at IS NULL ORDER BY created_at, rowid', b.id);
  // the booker is always on a team list, even before its first change (players.ts)
  if (!list.some((p) => p.user_id === b.customer_id)) {
    const booker = one<{ name: string }>('SELECT name FROM users WHERE id = ?', b.customer_id);
    if (booker) list.unshift({ id: '', user_id: b.customer_id, name: booker.name });
  }
  const added: string[] = [], skipped: { name: string; why: string }[] = [];
  tx(() => {
    for (const p of list) {
      const name = p.name.trim().replace(/\s+/g, ' ').slice(0, 40);
      try { checkFree(m, nameKey(name), p.user_id); checkRoom(m.id, side!, 1); } catch (e) { skipped.push({ name, why: (e as HttpError).message }); continue; }
      const id = newId('mp'); const t = now();
      run('INSERT INTO match_players(id, match_id, owner_id, side, name, name_key, user_id, linked_via, linked_by, linked_at, booking_player_id, added_by, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
        id, m.id, ownerId, side!, name, nameKey(name), p.user_id, p.user_id ? 'team_list' : null, p.user_id ? actor.id : null, p.user_id ? t : null, p.id || null, actor.id, t);
      added.push(name);
    }
    audit(actor, 'match.squad_import', 'match', m.id, { booking: b.id, side, added: added.length, skipped: skipped.length }, ownerId);
  });
  return { added: added.length, skipped };
}

/** Renames a squad player (only while no ball uses the name), or links or unlinks their profile by mobile number (phone null unlinks). */
export function updateSquadPlayer(actor: Actor, ownerId: string, matchId: string, playerId: string, body: unknown) {
  const m = ownMatch(ownerId, matchId);
  const p = squadOf(m.id).find((r) => r.id === playerId);
  if (!p) throw notFound('Player not found');
  const v = new Validator(body ?? {});
  const name = v.str('name', { min: 1, max: 40 });
  const unlink = 'phone' in v.src && v.src.phone === null;
  const phone = unlink ? undefined : v.phone('phone');
  v.done();
  tx(() => {
    if (name !== undefined && nameKey(name) !== p.name_key) {
      if (ballsNaming(m.id, p.name_key)) throw conflict('NAME_IN_USE', 'The scorer has already used this name, so it stays as it is. You can still link or unlink the profile.');
      checkFree(m, nameKey(name), null, p.id);
      run('UPDATE match_players SET name = ?, name_key = ? WHERE id = ?', name.trim().replace(/\s+/g, ' '), nameKey(name), p.id);
    }
    if (unlink && p.user_id) run('UPDATE match_players SET user_id = NULL, linked_via = NULL, linked_by = ?, linked_at = ? WHERE id = ?', actor.id, now(), p.id);
    if (phone) {
      const prof = profileByPhone(phone);
      if (!prof) throw notFound('No Daji profile has that mobile number. They stay a guest.');
      if (prof.id !== p.user_id) {
        checkFree(m, null, prof.id, p.id);
        run("UPDATE match_players SET user_id = ?, linked_via = 'phone', linked_by = ?, linked_at = ? WHERE id = ?", prof.id, actor.id, now(), p.id);
      }
    }
    audit(actor, 'match.squad_update', 'match', m.id, { player: p.id, renamed: name !== undefined, linked: !!phone, unlinked: unlink }, ownerId);
  });
  return { updated: true };
}

/** Takes a player out of a squad, only while no ball uses their name (the scorecard needs it). Kept, marked removed. */
export function removeSquadPlayer(actor: Actor, ownerId: string, matchId: string, playerId: string) {
  const m = ownMatch(ownerId, matchId);
  const p = squadOf(m.id).find((r) => r.id === playerId);
  if (!p) throw notFound('Player not found');
  if (ballsNaming(m.id, p.name_key)) throw conflict('NAME_IN_USE', 'The scorer has already used this name, so the player stays in the squad. Unlink the profile instead if it is the wrong person.');
  run('UPDATE match_players SET removed_at = ?, removed_by = ? WHERE id = ?', now(), actor.id, p.id);
  audit(actor, 'match.squad_remove', 'match', m.id, { player: p.id, name: p.name }, ownerId);
  return { removed: true };
}

// ------------------------------------------------------------------ the record, worked out from the balls

interface BatLine { runs: number; balls: number; fours: number; sixes: number; out: boolean; how: string | null }
interface BowlLine { balls: number; runs: number; wickets: number; maidens: number; bowledOrLbw: number }
interface FieldLine { catches: number; runOuts: number; stumpings: number }
export interface MatchLine {
  matchId: string; title: string; date: number; groundName: string | null; team: string; opponent: string; result: string | null;
  batting: BatLine | null; bowling: BowlLine | null; fielding: FieldLine; name: string;
}

/**
 * One match, for every squad player given: what they made with the bat, the ball and in the field, keyed by the squad row's id.
 * The career record gives it the linked players of finished matches; fantasy points (fantasy.ts) give it the whole squad, live or finished.
 */
export function linesOf(m: MatchRow & { ground_name: string | null }, linked: Pick<SquadRow, 'id' | 'side' | 'name' | 'name_key'>[]): Map<string, MatchLine> {
  const out = new Map<string, MatchLine>();
  const balls = many<BallRow>('SELECT * FROM match_balls WHERE match_id = ? ORDER BY innings, seq', m.id);
  const bySideKey = new Map(linked.map((r) => [`${r.side}|${r.name_key}`, r]));
  const line = (r: Pick<SquadRow, 'id' | 'side' | 'name'>): MatchLine => {
    let l = out.get(r.id);
    if (!l) {
      l = { matchId: m.id, title: m.title, date: m.scheduled_for ?? m.created_at, groundName: m.ground_name, team: r.side === 'a' ? m.team_a : m.team_b, opponent: r.side === 'a' ? m.team_b : m.team_a,
        result: m.result, batting: null, bowling: null, fielding: { catches: 0, runOuts: 0, stumpings: 0 }, name: r.name };
      out.set(r.id, l);
    }
    return l;
  };
  for (const r of linked) line(r);
  for (const inn of [1, 2] as const) {
    const bat = battingSide(m, inn), field = bat === 'a' ? 'b' : 'a';
    const who = (side: 'a' | 'b', n: string | null) => (n ? bySideKey.get(`${side}|${nameKey(n)}`) : undefined);
    const batting = (r: Pick<SquadRow, 'id' | 'side' | 'name'>) => { const l = line(r); return (l.batting ??= { runs: 0, balls: 0, fours: 0, sixes: 0, out: false, how: null }); };
    const bowling = (r: Pick<SquadRow, 'id' | 'side' | 'name'>) => { const l = line(r); return (l.bowling ??= { balls: 0, runs: 0, wickets: 0, maidens: 0, bowledOrLbw: 0 }); };
    // overs, for maidens: six legal balls by one bowler with nothing charged to him
    const overs = new Map<number, { bowlers: Set<string>; legal: number; charged: number }>();
    let legal = 0;
    for (const b of balls.filter((x) => x.innings === inn)) {
      const isLegal = b.extra_type !== 'wide' && b.extra_type !== 'noball';
      const charged = b.runs_bat + (b.extra_type === 'wide' || b.extra_type === 'noball' ? b.extra_runs : 0);
      const o = overs.get(Math.floor(legal / BALLS_PER_OVER)) ?? { bowlers: new Set<string>(), legal: 0, charged: 0 };
      overs.set(Math.floor(legal / BALLS_PER_OVER), o);
      o.bowlers.add(nameKey(b.bowler)); o.charged += charged; if (isLegal) { o.legal++; legal++; }
      const striker = who(bat, b.batter);
      if (striker) {
        const s = batting(striker);
        s.runs += b.runs_bat;
        if (b.extra_type !== 'wide') s.balls++;
        if (b.runs_bat === 4) s.fours++;
        if (b.runs_bat === 6) s.sixes++;
      }
      const bowler = who(field, b.bowler);
      if (bowler) {
        const w = bowling(bowler);
        if (isLegal) w.balls++;
        w.runs += charged;
        if (b.wicket && !['run out', 'retired'].includes(b.wicket_kind ?? '')) w.wickets++;
        if (b.wicket && (b.wicket_kind === 'bowled' || b.wicket_kind === 'lbw')) w.bowledOrLbw++;
      }
      if (b.wicket) {
        const outP = who(bat, b.out_player ?? b.batter);
        if (outP) { const s = batting(outP); if (b.wicket_kind !== 'retired') { s.out = true; s.how = howOut(b); } }
        const f = who(field, b.fielder);
        if (f && FIELDER_KINDS.includes(b.wicket_kind ?? '')) {
          const fl = line(f).fielding;
          if (b.wicket_kind === 'caught') fl.catches++; else if (b.wicket_kind === 'run out') fl.runOuts++; else fl.stumpings++;
        }
      }
    }
    for (const o of overs.values()) {
      if (o.legal !== BALLS_PER_OVER || o.charged !== 0 || o.bowlers.size !== 1) continue;
      const r = who(field, [...o.bowlers][0]!);
      if (r) bowling(r).maidens++;
    }
  }
  return out;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const oversText = (balls: number) => `${Math.floor(balls / BALLS_PER_OVER)}.${balls % BALLS_PER_OVER}`;

export interface Career {
  matches: number;
  batting: { innings: number; notOuts: number; runs: number; balls: number; fours: number; sixes: number; highest: string | null; average: number | null; strikeRate: number | null; fifties: number; hundreds: number; ducks: number };
  bowling: { innings: number; balls: number; overs: string; maidens: number; runs: number; wickets: number; best: string | null; average: number | null; economy: number | null; strikeRate: number | null; threeWickets: number; fiveWickets: number };
  fielding: { catches: number; runOuts: number; stumpings: number };
}

export function sumUp(lines: MatchLine[]): Career {
  const bat = lines.map((l) => l.batting).filter((x): x is BatLine => !!x);
  const bowl = lines.map((l) => l.bowling).filter((x): x is BowlLine => !!x);
  const runs = bat.reduce((n, b) => n + b.runs, 0), balls = bat.reduce((n, b) => n + b.balls, 0), outs = bat.filter((b) => b.out).length;
  const top = [...bat].sort((x, y) => y.runs - x.runs || Number(x.out) - Number(y.out))[0];
  const bBalls = bowl.reduce((n, b) => n + b.balls, 0), bRuns = bowl.reduce((n, b) => n + b.runs, 0), wkts = bowl.reduce((n, b) => n + b.wickets, 0);
  const best = [...bowl].sort((x, y) => y.wickets - x.wickets || x.runs - y.runs)[0];
  return {
    matches: lines.length,
    batting: {
      innings: bat.length, notOuts: bat.length - outs, runs, balls, fours: bat.reduce((n, b) => n + b.fours, 0), sixes: bat.reduce((n, b) => n + b.sixes, 0),
      highest: top ? `${top.runs}${top.out ? '' : '*'}` : null, average: outs ? r2(runs / outs) : null, strikeRate: balls ? r2((runs * 100) / balls) : null,
      fifties: bat.filter((b) => b.runs >= 50 && b.runs < 100).length, hundreds: bat.filter((b) => b.runs >= 100).length, ducks: bat.filter((b) => b.out && b.runs === 0).length,
    },
    bowling: {
      innings: bowl.length, balls: bBalls, overs: oversText(bBalls), maidens: bowl.reduce((n, b) => n + b.maidens, 0), runs: bRuns, wickets: wkts,
      best: best ? `${best.wickets}/${best.runs}` : null, average: wkts ? r2(bRuns / wkts) : null, economy: bBalls ? r2(bRuns / (bBalls / BALLS_PER_OVER)) : null,
      strikeRate: wkts ? r2(bBalls / wkts) : null, threeWickets: bowl.filter((b) => b.wickets >= 3 && b.wickets < 5).length, fiveWickets: bowl.filter((b) => b.wickets >= 5).length,
    },
    fielding: { catches: lines.reduce((n, l) => n + l.fielding.catches, 0), runOuts: lines.reduce((n, l) => n + l.fielding.runOuts, 0), stumpings: lines.reduce((n, l) => n + l.fielding.stumpings, 0) },
  };
}

/** Every finished match line of linked players: one person (userId), or everyone, at one business (ownerId) or everywhere (null). */
function matchLines(o: { userId?: string; ownerId: string | null }): (MatchLine & { userId: string })[] {
  const where = [`p.removed_at IS NULL`, `p.user_id IS NOT NULL`, `m.status = 'completed'`];
  const args: string[] = [];
  if (o.userId) { where.push('p.user_id = ?'); args.push(o.userId); }
  if (o.ownerId) { where.push('m.owner_id = ?'); args.push(o.ownerId); }
  const rows = many<SquadRow>(`SELECT p.* FROM match_players p JOIN matches m ON m.id = p.match_id WHERE ${where.join(' AND ')}`, ...args);
  const byMatch = new Map<string, SquadRow[]>();
  for (const r of rows) byMatch.set(r.match_id, [...(byMatch.get(r.match_id) ?? []), r]);
  const out: (MatchLine & { userId: string })[] = [];
  for (const [mid, linked] of byMatch) {
    const m = one<MatchRow & { ground_name: string | null }>('SELECT m.*, g.name ground_name FROM matches m LEFT JOIN grounds g ON g.id = m.ground_id WHERE m.id = ?', mid)!;
    const userOf = new Map(linked.map((r) => [r.id, r.user_id!]));
    for (const [rowId, l] of linesOf(m, linked)) { const userId = userOf.get(rowId)!; if (!o.userId || userId === o.userId) out.push({ ...l, userId }); }
  }
  return out.sort((a, b) => b.date - a.date);
}

const shortLine = (l: MatchLine): string => {
  const bits: string[] = [];
  if (l.batting) bits.push(`${l.batting.runs}${l.batting.out ? '' : '*'} (${l.batting.balls})`);
  if (l.bowling) bits.push(`${l.bowling.wickets}/${l.bowling.runs} in ${oversText(l.bowling.balls)} ov`);
  const f = l.fielding;
  if (f.catches) bits.push(`${f.catches} ${f.catches === 1 ? 'catch' : 'catches'}`);
  if (f.runOuts) bits.push(`${f.runOuts} run out${f.runOuts === 1 ? '' : 's'}`);
  if (f.stumpings) bits.push(`${f.stumpings} stumping${f.stumpings === 1 ? '' : 's'}`);
  return bits.length ? bits.join(', ') : 'Did not bat or bowl';
};

/** A career record: the totals and every finished match, newest first. */
export function careerOf(userId: string, ownerId: string | null) {
  const lines = matchLines({ userId, ownerId });
  return {
    career: sumUp(lines),
    matches: lines.map(({ userId: _u, ...l }) => ({ ...l, summary: shortLine(l) })),
    note: 'Built from the ball by ball score of finished matches where you are in a squad linked to your profile. A guest (no profile) earns no record.',
  };
}

/** The signed-in player's own record, at every ground. */
export function myCricket(u: UserRow) {
  if (u.role !== 'customer') throw new HttpError(403, 'FORBIDDEN', 'Career records are for players');
  return careerOf(u.id, null);
}

/** "This was not me": takes the player's profile off a match they were linked to by mistake. Kept in the audit; the profile cannot be linked to it again. */
export function notMe(u: UserRow, matchId: string, body: unknown) {
  if (u.role !== 'customer') throw new HttpError(403, 'FORBIDDEN', 'Only the player can do this');
  const v = new Validator(body ?? {});
  const reason = v.str('reason', { max: 200 });
  v.done();
  const p = one<SquadRow>('SELECT * FROM match_players WHERE match_id = ? AND user_id = ? AND removed_at IS NULL', matchId, u.id);
  if (!p) throw notFound('You are not linked to that match');
  tx(() => {
    run('UPDATE match_players SET user_id = NULL, linked_via = NULL, disowned_user_id = ?, disowned_at = ? WHERE id = ?', u.id, now(), p.id);
    audit({ id: u.id, role: u.role }, 'match.not_me', 'match', matchId, { player: p.id, name: p.name, reason: reason ?? null }, p.owner_id);
  });
  return { removed: true };
}

/** Whether this profile is in a squad of a match scored at this business (so its staff may open the customer page). */
export const playedAt = (ownerId: string, userId: string): boolean => !!one('SELECT 1 FROM match_players p JOIN matches m ON m.id = p.match_id WHERE p.user_id = ? AND m.owner_id = ? AND p.removed_at IS NULL', userId, ownerId);

/** A customer's record at this business only, for its staff (the customer page in the Desk). */
export function customerCricket(ownerId: string, customerId: string) {
  const known = ownsCustomer(ownerId, customerId) || playedAt(ownerId, customerId);
  if (!known || !one("SELECT 1 FROM users WHERE id = ? AND role = 'customer'", customerId)) throw notFound('Customer not found');
  return careerOf(customerId, ownerId);
}

export interface Leader { userId: string; name: string; matches: number; runs: number; highest: string | null; average: number | null; strikeRate: number | null; wickets: number; best: string | null; economy: number | null; catches: number; dismissals: number }

/** The business's leaders: most runs, most wickets, most dismissals in the field, from finished matches at its grounds. Names as the scorecard shows them. */
export function leaders(ownerId: string, limit = 10) {
  const lines = matchLines({ ownerId });
  const byUser = new Map<string, (MatchLine & { userId: string })[]>();
  for (const l of lines) byUser.set(l.userId, [...(byUser.get(l.userId) ?? []), l]);
  const all: Leader[] = [...byUser].map(([userId, ls]) => {
    const c = sumUp(ls);
    return { userId, name: ls[0]!.name, matches: c.matches, runs: c.batting.runs, highest: c.batting.highest, average: c.batting.average, strikeRate: c.batting.strikeRate, wickets: c.bowling.wickets, best: c.bowling.best, economy: c.bowling.economy, catches: c.fielding.catches, dismissals: c.fielding.catches + c.fielding.runOuts + c.fielding.stumpings };
  });
  const top = (k: 'runs' | 'wickets' | 'dismissals') => all.filter((x) => x[k] > 0).sort((a, b) => b[k] - a[k] || a.name.localeCompare(b.name)).slice(0, limit);
  return {
    players: all.length, matches: new Set(lines.map((l) => l.matchId)).size,
    runs: top('runs'), wickets: top('wickets'), fielding: top('dismissals'),
  };
}

/** Clears a deleted account's links (accountDeletion.ts). The scorecards keep the names the scorer used, as before squads. */
export function forgetPlayerLinks(userId: string): void {
  run('UPDATE match_players SET user_id = NULL, linked_via = NULL WHERE user_id = ?', userId);
  run('UPDATE match_players SET disowned_user_id = NULL WHERE disowned_user_id = ?', userId);
}
