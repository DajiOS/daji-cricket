import { many, one, registerSchema, run, tx } from './db.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { HttpError, bad, conflict, forbidden, notFound } from './errors.ts';
import { Validator } from './input.ts';
import { audit, type Actor } from './audit.ts';
import { hasPermission, type UserRow } from './auth.ts';
import { scorecard, type MatchRow } from './matches.ts';
import { linesOf, type MatchLine } from './playerStats.ts';

// Fantasy cricket for matches scored at the ground (owner, 29 Oct 2026: "Create a fantasy feature"; "No entry fees"). Free to play,
// points only: there is no entry fee, no prize and no money anywhere in it, and nothing here may ever take or pay money.
// The ground opens a contest on a public match that has squads (playerStats.ts). A signed-in player picks a fantasy team from both
// squads, with a captain (double points) and a vice-captain (one and a half), until the contest locks: the lock time the ground set,
// or the first ball, whichever comes first. Points are worked out from the balls each time they are asked for, never typed in or stored
// twice, so an undone ball or a reopened match shows at once. The points table is copied onto the contest when it opens, so a later change
// never rewrites a finished contest. A business sees and runs only its own contests; leaderboards show the team names players chose,
// never their names, numbers or accounts.

registerSchema('fantasy-1', `
CREATE TABLE fantasy_contests (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  match_id TEXT NOT NULL REFERENCES matches(id),
  team_size INTEGER NOT NULL,
  max_from_side INTEGER NOT NULL,
  points_json TEXT NOT NULL,
  locks_at INTEGER,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  cancelled_at INTEGER,
  cancelled_by TEXT,
  cancel_reason TEXT
);
CREATE UNIQUE INDEX uq_fantasy_contest_match ON fantasy_contests(match_id) WHERE cancelled_at IS NULL;
CREATE INDEX ix_fantasy_contests_owner ON fantasy_contests(owner_id, created_at);

CREATE TABLE fantasy_entries (
  id TEXT PRIMARY KEY,
  contest_id TEXT NOT NULL REFERENCES fantasy_contests(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  team_name TEXT NOT NULL,
  picks_json TEXT NOT NULL,
  captain_id TEXT NOT NULL,
  vice_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  withdrawn_at INTEGER,
  withdrawn_by TEXT,
  withdrawn_reason TEXT,
  UNIQUE (contest_id, user_id)
);
CREATE INDEX ix_fantasy_entries_user ON fantasy_entries(user_id);
CREATE INDEX ix_fantasy_entries_owner ON fantasy_entries(owner_id);
`);

/** The points for each thing a player does. The captain's points count twice and the vice-captain's one and a half times. */
export const DEFAULT_POINTS = {
  played: 4, run: 1, four: 1, six: 2, thirty: 4, fifty: 8, hundred: 16, duck: -2,
  wicket: 25, bowledOrLbw: 8, threeWickets: 4, fourWickets: 8, fiveWickets: 16, maiden: 12,
  catch: 8, threeCatches: 4, stumping: 12, runOut: 6,
};
export type Points = typeof DEFAULT_POINTS;
const CAPTAIN = 2, VICE = 1.5;
export const MAX_TEAM = 11;
const POINT_LABELS: Record<keyof Points, string> = {
  played: 'In the squad', run: 'Each run', four: 'Each four (bonus)', six: 'Each six (bonus)', thirty: '30 runs (bonus)', fifty: '50 runs (bonus, instead of 30)', hundred: '100 runs (bonus, instead of 50)',
  duck: 'Out for nought', wicket: 'Each wicket (not run outs)', bowledOrLbw: 'Each bowled or lbw (bonus)', threeWickets: '3 wickets (bonus)', fourWickets: '4 wickets (bonus, instead of 3)',
  fiveWickets: '5 wickets (bonus, instead of 4)', maiden: 'Each maiden over', catch: 'Each catch', threeCatches: '3 catches (bonus)', stumping: 'Each stumping', runOut: 'Each run out',
};

interface ContestRow {
  id: string; owner_id: string; match_id: string; team_size: number; max_from_side: number; points_json: string; locks_at: number | null;
  created_by: string | null; created_at: number; updated_at: number; cancelled_at: number | null; cancelled_by: string | null; cancel_reason: string | null;
}
interface EntryRow {
  id: string; contest_id: string; owner_id: string; user_id: string; team_name: string; picks_json: string; captain_id: string; vice_id: string;
  created_at: number; updated_at: number; withdrawn_at: number | null; withdrawn_by: string | null; withdrawn_reason: string | null;
}
type Squad = { id: string; side: 'a' | 'b'; name: string; name_key: string };
type FullMatch = MatchRow & { ground_name: string | null };
export type State = 'open' | 'locked' | 'live' | 'final' | 'cancelled';

const matchOf = (id: string): FullMatch => one<FullMatch>('SELECT m.*, g.name ground_name FROM matches m LEFT JOIN grounds g ON g.id = m.ground_id WHERE m.id = ?', id)!;
const squadOf = (matchId: string): Squad[] => many<Squad>('SELECT id, side, name, name_key FROM match_players WHERE match_id = ? AND removed_at IS NULL ORDER BY side, created_at, rowid', matchId);
const ballCount = (matchId: string): number => one<{ n: number }>('SELECT COUNT(*) n FROM match_balls WHERE match_id = ?', matchId)!.n;
const activeEntries = (contestId: string): EntryRow[] => many<EntryRow>('SELECT * FROM fantasy_entries WHERE contest_id = ? AND withdrawn_at IS NULL ORDER BY created_at, rowid', contestId);
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Where a contest stands: open for teams, locked (start time passed, no ball yet), live, final, or cancelled by the ground. */
export function stateOf(c: ContestRow, m: Pick<MatchRow, 'id' | 'status'>): State {
  if (c.cancelled_at) return 'cancelled';
  if (m.status === 'completed') return 'final';
  if (m.status === 'live' || ballCount(m.id) > 0) return 'live';
  if (c.locks_at !== null && now() >= c.locks_at) return 'locked';
  return 'open';
}
const STATE_TEXT: Record<State, string> = { open: 'Open for teams', locked: 'Teams locked, waiting for the first ball', live: 'Live', final: 'Final', cancelled: 'Cancelled by the ground' };

// ------------------------------------------------------------------ points, worked out from the balls

export interface PlayerPoints { id: string; side: 'a' | 'b'; name: string; team: string; points: number; breakdown: { label: string; points: number }[] }

/** What one squad player has earned: nothing before the first ball; then the squad points and everything they did. */
export function pointsFor(l: MatchLine | undefined, p: Points, started: boolean): { points: number; breakdown: { label: string; points: number }[] } {
  const parts: { label: string; points: number }[] = [];
  const add = (label: string, pts: number) => { if (pts) parts.push({ label, points: pts }); };
  if (!started) return { points: 0, breakdown: [] };
  add('In the squad', p.played);
  if (l?.batting) {
    const b = l.batting;
    add(`${b.runs} ${b.runs === 1 ? 'run' : 'runs'}`, b.runs * p.run);
    add(`${b.fours} × 4`, b.fours * p.four);
    add(`${b.sixes} × 6`, b.sixes * p.six);
    add(b.runs >= 100 ? '100 bonus' : b.runs >= 50 ? '50 bonus' : '30 bonus', b.runs >= 100 ? p.hundred : b.runs >= 50 ? p.fifty : b.runs >= 30 ? p.thirty : 0);
    if (b.out && b.runs === 0) add('Duck', p.duck);
  }
  if (l?.bowling) {
    const w = l.bowling;
    add(`${w.wickets} ${w.wickets === 1 ? 'wicket' : 'wickets'}`, w.wickets * p.wicket);
    add(`${w.bowledOrLbw} bowled or lbw`, w.bowledOrLbw * p.bowledOrLbw);
    add(`${w.wickets} wicket bonus`, w.wickets >= 5 ? p.fiveWickets : w.wickets === 4 ? p.fourWickets : w.wickets === 3 ? p.threeWickets : 0);
    add(`${w.maidens} ${w.maidens === 1 ? 'maiden' : 'maidens'}`, w.maidens * p.maiden);
  }
  if (l) {
    const f = l.fielding;
    add(`${f.catches} ${f.catches === 1 ? 'catch' : 'catches'}`, f.catches * p.catch);
    if (f.catches >= 3) add('3 catch bonus', p.threeCatches);
    add(`${f.stumpings} ${f.stumpings === 1 ? 'stumping' : 'stumpings'}`, f.stumpings * p.stumping);
    add(`${f.runOuts} run ${f.runOuts === 1 ? 'out' : 'outs'}`, f.runOuts * p.runOut);
  }
  return { points: parts.reduce((n, x) => n + x.points, 0), breakdown: parts };
}

/** Every squad player's points in this contest, from the balls as they are now. */
function playerPoints(c: ContestRow, m: FullMatch, state: State): PlayerPoints[] {
  const squad = squadOf(m.id);
  const pts = JSON.parse(c.points_json) as Points;
  const started = state === 'live' || state === 'final' || (state === 'cancelled' && ballCount(m.id) > 0);
  const lines = started ? linesOf(m, squad) : new Map<string, MatchLine>();
  return squad.map((r) => ({ id: r.id, side: r.side, name: r.name, team: r.side === 'a' ? m.team_a : m.team_b, ...pointsFor(lines.get(r.id), pts, started) }));
}

interface Scored { entry: EntryRow; points: number; rank: number }
/** The entries of a contest with their points and rank. Equal points share a rank (1, 2, 2, 4). */
function scoreEntries(entries: EntryRow[], players: PlayerPoints[]): Scored[] {
  const by = new Map(players.map((p) => [p.id, p.points]));
  const scored = entries.map((e) => {
    const picks = JSON.parse(e.picks_json) as string[];
    const total = picks.reduce((n, id) => n + (by.get(id) ?? 0) * (id === e.captain_id ? CAPTAIN : id === e.vice_id ? VICE : 1), 0);
    return { entry: e, points: r1(total), rank: 0 };
  }).sort((a, b) => b.points - a.points || a.entry.created_at - b.entry.created_at);
  scored.forEach((s, i) => { s.rank = i > 0 && scored[i - 1]!.points === s.points ? scored[i - 1]!.rank : i + 1; });
  return scored;
}

/** One fantasy team as anyone allowed to see it sees it: each pick with its points (doubled for the captain), and players no longer in the squad. */
function teamView(e: EntryRow, players: PlayerPoints[], points: number, rank: number | null) {
  const by = new Map(players.map((p) => [p.id, p]));
  const picks = (JSON.parse(e.picks_json) as string[]).map((id) => {
    const p = by.get(id);
    const role = id === e.captain_id ? 'captain' : id === e.vice_id ? 'vice' : null;
    const mult = role === 'captain' ? CAPTAIN : role === 'vice' ? VICE : 1;
    return p ? { id, name: p.name, side: p.side, team: p.team, role, points: r1(p.points * mult), inSquad: true } : { id, name: 'No longer in the squad', side: null, team: null, role, points: 0, inSquad: false };
  });
  return { entryId: e.id, teamName: e.team_name, points, rank, picks, captainId: e.captain_id, viceCaptainId: e.vice_id, updatedAt: e.updated_at, needsFixing: picks.some((p) => !p.inSquad) };
}

// ------------------------------------------------------------------ the ground: opening and running contests

const ownContest = (ownerId: string, id: string): ContestRow => {
  const c = one<ContestRow>('SELECT * FROM fantasy_contests WHERE id = ? AND owner_id = ?', id, ownerId);
  if (!c) throw notFound('Fantasy contest not found');
  return c;
};

function readPoints(v: Validator): Points | undefined {
  if (!v.has('points')) return undefined;
  const raw = v.src.points;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) { v.fail('points', 'Send the points as an object, like { "wicket": 25 }'); return undefined; }
  const out: Points = { ...DEFAULT_POINTS };
  for (const [k, x] of Object.entries(raw as Record<string, unknown>)) {
    if (!(k in DEFAULT_POINTS)) { v.fail(`points.${k}`, 'Unknown points rule'); continue; }
    if (!Number.isInteger(x) || (x as number) < -50 || (x as number) > 100) { v.fail(`points.${k}`, 'A whole number from -50 to 100'); continue; }
    out[k as keyof Points] = x as number;
  }
  return out;
}

/** Opens a fantasy contest on a public match that has not started and has a squad on both sides. One contest per match. */
export function openContest(actor: Actor, ownerId: string, body: unknown) {
  const v = new Validator(body ?? {});
  const matchId = v.str('matchId', { required: true, max: 60 });
  const teamSize = v.int('teamSize', { min: 2, max: MAX_TEAM });
  const maxFromSide = v.int('maxFromSide', { min: 1, max: MAX_TEAM - 1 });
  const locksAt = v.int('locksAt', { min: 0 });
  const points = readPoints(v);
  v.done();
  const m = one<MatchRow>('SELECT * FROM matches WHERE id = ? AND owner_id = ?', matchId!, ownerId);
  if (!m) throw notFound('Match not found');
  if (!m.is_public) throw conflict('MATCH_PRIVATE', 'Show the match on the website first: fantasy players need to see its squads and live score.');
  if (m.status !== 'scheduled' || ballCount(m.id)) throw conflict('MATCH_STARTED', 'This match has started, so teams can no longer be picked fairly. Open fantasy before the first ball.');
  const squad = squadOf(m.id);
  const a = squad.filter((r) => r.side === 'a').length, b = squad.length - a;
  if (!a || !b) throw conflict('NO_SQUADS', 'Add both squads to the match first (in the scorer): fantasy teams are picked from them.');
  const size = teamSize ?? Math.min(MAX_TEAM, m.players_per_side, squad.length);
  if (size > squad.length) throw bad('TEAM_TOO_BIG', `The squads have ${squad.length} players between them, so a fantasy team can have at most ${squad.length}.`, { fields: [{ field: 'teamSize', message: `At most ${squad.length}` }] });
  const most = maxFromSide ?? size - 1;
  if (most >= size || most < Math.ceil(size / 2)) throw bad('VALIDATION_FAILED', `With ${size} players, allow from ${Math.ceil(size / 2)} to ${size - 1} from one team.`, { fields: [{ field: 'maxFromSide', message: `From ${Math.ceil(size / 2)} to ${size - 1}` }] });
  // each side must be able to give what a full team needs from it
  if (size - most > Math.min(a, b)) throw bad('VALIDATION_FAILED', `A team of ${size} with at most ${most} from one side needs at least ${size - most} players in each squad. Add players or allow more from one side.`, { fields: [{ field: 'maxFromSide', message: 'The squads are too small for this' }] });
  const t = now();
  const lock = locksAt ?? (m.scheduled_for && m.scheduled_for > t ? m.scheduled_for : null);
  if (lock !== null && lock <= t) throw bad('VALIDATION_FAILED', 'The lock time has already passed', { fields: [{ field: 'locksAt', message: 'Must be in the future' }] });
  const id = newId('fan');
  tx(() => {
    if (one('SELECT 1 FROM fantasy_contests WHERE match_id = ? AND cancelled_at IS NULL', m.id)) throw conflict('CONTEST_EXISTS', 'This match already has a fantasy contest.');
    run('INSERT INTO fantasy_contests(id, owner_id, match_id, team_size, max_from_side, points_json, locks_at, created_by, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      id, ownerId, m.id, size, most, JSON.stringify(points ?? DEFAULT_POINTS), lock, actor.id, t, t);
    audit(actor, 'fantasy.open', 'fantasy_contest', id, { match: m.id, teamSize: size, maxFromSide: most, locksAt: lock, customPoints: !!points }, ownerId);
  });
  return { id };
}

/** Moves the lock time while the contest is still open (null: lock at the first ball). */
export function updateContest(actor: Actor, ownerId: string, id: string, body: unknown) {
  const c = ownContest(ownerId, id);
  const v = new Validator(body ?? {});
  const clear = 'locksAt' in v.src && v.src.locksAt === null;
  const locksAt = clear ? undefined : v.int('locksAt', { min: 0 });
  v.done();
  if (stateOf(c, matchOf(c.match_id)) !== 'open') throw conflict('CONTEST_LOCKED', 'Teams are locked, so the lock time stays as it is.');
  if (locksAt !== undefined && locksAt <= now()) throw bad('VALIDATION_FAILED', 'The lock time has already passed', { fields: [{ field: 'locksAt', message: 'Must be in the future' }] });
  if (!clear && locksAt === undefined) return { updated: false };
  run('UPDATE fantasy_contests SET locks_at = ?, updated_at = ? WHERE id = ?', clear ? null : locksAt!, now(), c.id);
  audit(actor, 'fantasy.update', 'fantasy_contest', c.id, { locksAt: clear ? null : locksAt }, ownerId);
  return { updated: true };
}

/** Calls a contest off, with a reason. The teams are kept, it leaves the season table, and the players see why. */
export function cancelContest(actor: Actor, ownerId: string, id: string, body: unknown) {
  const c = ownContest(ownerId, id);
  const v = new Validator(body ?? {});
  const reason = v.str('reason', { required: true, min: 3, max: 200 });
  v.done();
  if (c.cancelled_at) throw conflict('ALREADY_CANCELLED', 'This contest is already cancelled.');
  run('UPDATE fantasy_contests SET cancelled_at = ?, cancelled_by = ?, cancel_reason = ?, updated_at = ? WHERE id = ? AND cancelled_at IS NULL', now(), actor.id, reason!, now(), c.id);
  audit(actor, 'fantasy.cancel', 'fantasy_contest', c.id, { reason, entries: activeEntries(c.id).length }, ownerId);
  return { cancelled: true };
}

/** Takes a team out of a contest (a rude team name, say), with a reason. Kept, marked removed; that player cannot enter this contest again. */
export function removeEntry(actor: Actor, ownerId: string, id: string, entryId: string, body: unknown) {
  const c = ownContest(ownerId, id);
  const v = new Validator(body ?? {});
  const reason = v.str('reason', { required: true, min: 3, max: 200 });
  v.done();
  const e = one<EntryRow>('SELECT * FROM fantasy_entries WHERE id = ? AND contest_id = ? AND withdrawn_at IS NULL', entryId, c.id);
  if (!e) throw notFound('Team not found');
  run('UPDATE fantasy_entries SET withdrawn_at = ?, withdrawn_by = ?, withdrawn_reason = ? WHERE id = ?', now(), actor.id, reason!, e.id);
  audit(actor, 'fantasy.entry_remove', 'fantasy_contest', c.id, { entry: e.id, teamName: e.team_name, reason }, ownerId);
  return { removed: true };
}

function contestSummary(c: ContestRow, m: FullMatch) {
  const state = stateOf(c, m);
  let score: string | null = null;
  if (state === 'live' || state === 'final') score = scorecard(m.id, true).innings.filter((i) => i.overs !== '0.0' || i.runs > 0 || i.wickets > 0).map((i) => `${i.team} ${i.runs}/${i.wickets} (${i.overs})`).join('  ·  ') || null;
  return {
    id: c.id, state, stateText: c.cancelled_at ? `Cancelled by the ground: ${c.cancel_reason}` : STATE_TEXT[state], locksAt: c.locks_at, teamSize: c.team_size, maxFromSide: c.max_from_side,
    captainTimes: CAPTAIN, viceCaptainTimes: VICE,
    match: { id: m.id, title: m.title, teamA: m.team_a, teamB: m.team_b, status: m.status, scheduledFor: m.scheduled_for, groundName: m.ground_name, result: m.result, isPublic: !!m.is_public, score },
    entries: activeEntries(c.id).length, createdAt: c.created_at,
  };
}

/** Every contest of this business, newest first, and the public matches that could still get one. */
export function listForStaff(ownerId: string) {
  const rows = many<ContestRow>('SELECT * FROM fantasy_contests WHERE owner_id = ? ORDER BY created_at DESC LIMIT 200', ownerId);
  const taken = new Set(rows.filter((c) => !c.cancelled_at).map((c) => c.match_id));
  const ready = many<MatchRow & { a: number; b: number }>(`SELECT m.*, (SELECT COUNT(*) FROM match_players p WHERE p.match_id = m.id AND p.side = 'a' AND p.removed_at IS NULL) a,
    (SELECT COUNT(*) FROM match_players p WHERE p.match_id = m.id AND p.side = 'b' AND p.removed_at IS NULL) b
    FROM matches m WHERE m.owner_id = ? AND m.status = 'scheduled' AND NOT EXISTS (SELECT 1 FROM match_balls x WHERE x.match_id = m.id) ORDER BY COALESCE(m.scheduled_for, m.created_at) LIMIT 100`, ownerId)
    .filter((m) => !taken.has(m.id))
    .map((m) => ({ id: m.id, title: m.title, teamA: m.team_a, teamB: m.team_b, scheduledFor: m.scheduled_for, playersPerSide: m.players_per_side, isPublic: !!m.is_public, squadA: m.a, squadB: m.b,
      canOpen: !!m.is_public && m.a > 0 && m.b > 0, why: !m.is_public ? 'Private: show it on the website first' : !m.a || !m.b ? 'Add both squads first' : null }));
  return { items: rows.map((c) => contestSummary(c, matchOf(c.match_id))), matches: ready, points: DEFAULT_POINTS, pointLabels: POINT_LABELS };
}

/** One contest for its ground: every team with points and rank, each squad player's points, and the points table. The player's own name only for who may see customers. */
export function contestForStaff(u: UserRow, ownerId: string, id: string) {
  const c = ownContest(ownerId, id);
  const m = matchOf(c.match_id);
  const state = stateOf(c, m);
  const players = playerPoints(c, m, state);
  const scored = scoreEntries(activeEntries(c.id), players);
  const seeNames = u.role === 'owner' || u.role === 'super_admin' || hasPermission(u, 'view_customers');
  const names = seeNames ? new Map(many<{ id: string; name: string }>(`SELECT id, name FROM users WHERE id IN (${scored.map(() => '?').join(',') || "''"})`, ...scored.map((s) => s.entry.user_id)).map((x) => [x.id, x.name])) : new Map<string, string>();
  const removed = many<EntryRow>('SELECT * FROM fantasy_entries WHERE contest_id = ? AND withdrawn_at IS NOT NULL AND withdrawn_by IS NOT NULL AND withdrawn_by <> user_id ORDER BY withdrawn_at', c.id);
  return {
    ...contestSummary(c, m), points: JSON.parse(c.points_json) as Points, pointLabels: POINT_LABELS, players: players.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name)),
    leaderboard: scored.map((s) => ({ ...teamView(s.entry, players, s.points, s.rank), playerName: seeNames ? names.get(s.entry.user_id) ?? null : null })),
    removed: removed.map((e) => ({ entryId: e.id, teamName: e.team_name, reason: e.withdrawn_reason, at: e.withdrawn_at })),
  };
}

// ------------------------------------------------------------------ the season table

/** The season table of one business: every finished contest's points added up per player, under the team name they used last. */
export function seasonTable(ownerId: string, o: { tournamentId?: string | null; forUser?: string | null; limit?: number } = {}) {
  const args: string[] = [ownerId];
  let extra = '';
  if (o.tournamentId) { extra = ' AND c.match_id IN (SELECT match_id FROM tournament_fixtures WHERE tournament_id = ? AND match_id IS NOT NULL)'; args.push(o.tournamentId); }
  const contests = many<ContestRow>(`SELECT c.* FROM fantasy_contests c JOIN matches m ON m.id = c.match_id WHERE c.owner_id = ? AND c.cancelled_at IS NULL AND m.status = 'completed'${extra}`, ...args);
  const totals = new Map<string, { points: number; contests: number; wins: number; teamName: string; last: number }>();
  for (const c of contests) {
    const m = matchOf(c.match_id);
    for (const s of scoreEntries(activeEntries(c.id), playerPoints(c, m, 'final'))) {
      const t = totals.get(s.entry.user_id) ?? { points: 0, contests: 0, wins: 0, teamName: s.entry.team_name, last: 0 };
      t.points = r1(t.points + s.points); t.contests++; if (s.rank === 1) t.wins++;
      if (s.entry.updated_at >= t.last) { t.last = s.entry.updated_at; t.teamName = s.entry.team_name; }
      totals.set(s.entry.user_id, t);
    }
  }
  const rows = [...totals].map(([userId, t]) => ({ userId, ...t })).sort((a, b) => b.points - a.points || b.wins - a.wins || a.teamName.localeCompare(b.teamName));
  const ranked = rows.map((r, i) => ({ ...r, rank: 0, i }));
  ranked.forEach((r, i) => { r.rank = i > 0 && ranked[i - 1]!.points === r.points ? ranked[i - 1]!.rank : i + 1; });
  const view = (r: (typeof ranked)[number]) => ({ rank: r.rank, teamName: r.teamName, points: r.points, contests: r.contests, wins: r.wins, you: !!o.forUser && r.userId === o.forUser });
  const top = ranked.slice(0, o.limit ?? 50);
  const mine = o.forUser ? ranked.find((r) => r.userId === o.forUser) : undefined;
  return { contests: contests.length, players: ranked.length, table: top.map(view), you: mine ? view(mine) : null };
}

// ------------------------------------------------------------------ players: picking a team

const customerOnly = (u: UserRow) => { if (u.role !== 'customer') throw forbidden('Fantasy teams are for players. Staff run contests from the Desk.'); };
/** A contest a player may see: open on a public match, not someone's private fixture. */
function visibleContest(id: string): { c: ContestRow; m: FullMatch } {
  const c = one<ContestRow>('SELECT * FROM fantasy_contests WHERE id = ?', id);
  const m = c ? matchOf(c.match_id) : undefined;
  if (!c || !m || !m.is_public) throw notFound('Fantasy contest not found');
  return { c, m };
}

/** Contests a player can join or follow: open first, then live, then the last finished ones, with their own team's place. */
export function listForPlayer(u: UserRow) {
  customerOnly(u);
  const rows = many<ContestRow>(`SELECT c.* FROM fantasy_contests c JOIN matches m ON m.id = c.match_id WHERE m.is_public = 1
    AND (c.cancelled_at IS NULL OR EXISTS (SELECT 1 FROM fantasy_entries e WHERE e.contest_id = c.id AND e.user_id = ?)) ORDER BY c.created_at DESC LIMIT 60`, u.id);
  const order: Record<State, number> = { open: 0, locked: 1, live: 1, final: 2, cancelled: 3 };
  const items = rows.map((c) => {
    const m = matchOf(c.match_id);
    const sum = contestSummary(c, m);
    const mineRow = one<EntryRow>('SELECT * FROM fantasy_entries WHERE contest_id = ? AND user_id = ?', c.id, u.id);
    let mine: { teamName: string; points: number; rank: number | null; removed: boolean } | null = null;
    if (mineRow) {
      if (mineRow.withdrawn_at && mineRow.withdrawn_by === u.id) mine = null;
      else if (mineRow.withdrawn_at) mine = { teamName: mineRow.team_name, points: 0, rank: null, removed: true };
      else { const s = scoreEntries(activeEntries(c.id), playerPoints(c, m, sum.state)).find((x) => x.entry.id === mineRow.id)!; mine = { teamName: mineRow.team_name, points: s.points, rank: s.rank, removed: false }; }
    }
    return { ...sum, mine };
  }).filter((x) => x.state !== 'cancelled' || x.mine).sort((a, b) => order[a.state] - order[b.state] || (a.match.scheduledFor ?? a.createdAt) - (b.match.scheduledFor ?? b.createdAt));
  return { items, note: 'Free to play: points only. There is no entry fee and no prize.' };
}

/** One contest for a player: the squads with points, the points table, their own team, and the leaderboard (team names only). */
export function contestForPlayer(u: UserRow, id: string, limit = 50) {
  customerOnly(u);
  const { c, m } = visibleContest(id);
  const sum = contestSummary(c, m);
  const players = playerPoints(c, m, sum.state);
  const scored = scoreEntries(activeEntries(c.id), players);
  const mineRow = one<EntryRow>('SELECT * FROM fantasy_entries WHERE contest_id = ? AND user_id = ?', c.id, u.id);
  const mineScored = mineRow ? scored.find((s) => s.entry.id === mineRow.id) : undefined;
  const removedByGround = !!mineRow?.withdrawn_at && mineRow.withdrawn_by !== u.id;
  const row = (s: Scored) => ({ rank: s.rank, entryId: s.entry.id, teamName: s.entry.team_name, points: s.points, you: s.entry.user_id === u.id });
  return {
    ...sum, points: JSON.parse(c.points_json) as Points, pointLabels: POINT_LABELS,
    players: players.map((p) => ({ ...p, breakdown: sum.state === 'open' ? [] : p.breakdown })),
    mine: mineScored ? teamView(mineScored.entry, players, mineScored.points, sum.state === 'open' ? null : mineScored.rank) : null,
    removedByGround: removedByGround ? { reason: mineRow!.withdrawn_reason } : null,
    // before the lock the table shows only how many teams are in, so nobody copies a team or a captain
    leaderboard: sum.state === 'open' ? [] : scored.slice(0, limit).map(row),
    you: sum.state === 'open' || !mineScored ? null : row(mineScored),
    canEdit: sum.state === 'open' && !removedByGround,
    note: 'Free to play: points only. There is no entry fee and no prize.',
  };
}

/** Another team in the same contest, after the lock (so nobody copies a team before it). Your own team any time. */
export function teamForPlayer(u: UserRow, id: string, entryId: string) {
  customerOnly(u);
  const { c, m } = visibleContest(id);
  const e = one<EntryRow>('SELECT * FROM fantasy_entries WHERE id = ? AND contest_id = ? AND withdrawn_at IS NULL', entryId, c.id);
  if (!e) throw notFound('Team not found');
  const state = stateOf(c, m);
  if (e.user_id !== u.id && state === 'open') throw forbidden('Other teams show once the contest locks.');
  const players = playerPoints(c, m, state);
  const s = scoreEntries(activeEntries(c.id), players).find((x) => x.entry.id === e.id)!;
  return { ...teamView(e, players, s.points, state === 'open' ? null : s.rank), you: e.user_id === u.id };
}

const TEAM_NAME = /^[\p{L}\p{N}][\p{L}\p{N} .'&_-]*$/u;
function checkTeamName(v: Validator, name: string | undefined): void {
  if (name === undefined) return;
  if (!TEAM_NAME.test(name)) v.fail('teamName', 'Use letters, numbers, spaces and . \' & _ - only');
  // a team name is shown to everyone in the contest, so it may not carry a phone number, an email or a link
  else if (/\d{6,}/.test(name.replace(/[\s.-]/g, '')) || /www|http|\.com\b/i.test(name)) v.fail('teamName', 'A team name cannot hold a phone number or a link');
}

/** Saves the player's team for a contest (a new one, or a change while it is open). Saving the same team again changes nothing. */
export function saveEntry(u: UserRow, id: string, body: unknown) {
  customerOnly(u);
  const { c, m } = visibleContest(id);
  const v = new Validator(body ?? {});
  const teamName = v.str('teamName', { required: true, min: 3, max: 24 })?.replace(/\s+/g, ' ');
  checkTeamName(v, teamName);
  const picks = v.strArray('players', { max: MAX_TEAM, itemMax: 60 });
  const captain = v.str('captain', { required: true, max: 60 });
  const vice = v.str('viceCaptain', { required: true, max: 60 });
  if (!picks) v.fail('players', 'Pick your players');
  v.done();
  const squad = new Map(squadOf(m.id).map((r) => [r.id, r]));
  const fail = (field: string, message: string): never => { throw new HttpError(400, 'TEAM_NOT_VALID', message, { fields: [{ field, message }] }); };
  if (new Set(picks).size !== picks!.length) fail('players', 'The same player is picked twice');
  if (picks!.length !== c.team_size) fail('players', `Pick exactly ${c.team_size} players (you picked ${picks!.length})`);
  const gone = picks!.filter((p) => !squad.has(p));
  if (gone.length) fail('players', 'One of your players is no longer in the squad. Pick someone else.');
  const fromA = picks!.filter((p) => squad.get(p)!.side === 'a').length, fromB = picks!.length - fromA;
  if (Math.max(fromA, fromB) > c.max_from_side) fail('players', `At most ${c.max_from_side} players from one team (you have ${Math.max(fromA, fromB)} from ${fromA > fromB ? m.team_a : m.team_b})`);
  if (!picks!.includes(captain!)) fail('captain', 'Your captain must be one of your players');
  if (!picks!.includes(vice!)) fail('viceCaptain', 'Your vice-captain must be one of your players');
  if (captain === vice) fail('viceCaptain', 'The captain and vice-captain must be different players');
  const t = now();
  let created = false;
  tx(() => {
    // checked again inside the write, so a team saved as the first ball goes in is refused, not slipped in
    const st = stateOf(one<ContestRow>('SELECT * FROM fantasy_contests WHERE id = ?', c.id)!, one<MatchRow>('SELECT * FROM matches WHERE id = ?', m.id)!);
    if (st !== 'open') throw conflict('CONTEST_LOCKED', st === 'cancelled' ? 'The ground has cancelled this contest.' : 'Teams are locked for this contest: the match has started or its start time has passed.');
    const cur = one<EntryRow>('SELECT * FROM fantasy_entries WHERE contest_id = ? AND user_id = ?', c.id, u.id);
    if (cur?.withdrawn_at && cur.withdrawn_by !== u.id) throw conflict('ENTRY_REMOVED', `The ground removed your team from this contest${cur.withdrawn_reason ? `: ${cur.withdrawn_reason}` : ''}.`);
    if (one('SELECT 1 FROM fantasy_entries WHERE contest_id = ? AND user_id <> ? AND withdrawn_at IS NULL AND LOWER(team_name) = LOWER(?)', c.id, u.id, teamName!)) throw conflict('TEAM_NAME_TAKEN', 'Another team in this contest has that name. Pick a different one.');
    const json = JSON.stringify(picks);
    if (cur && !cur.withdrawn_at && cur.team_name === teamName && cur.picks_json === json && cur.captain_id === captain && cur.vice_id === vice) return;
    if (cur) run('UPDATE fantasy_entries SET team_name = ?, picks_json = ?, captain_id = ?, vice_id = ?, updated_at = ?, withdrawn_at = NULL, withdrawn_by = NULL, withdrawn_reason = NULL WHERE id = ?', teamName!, json, captain!, vice!, t, cur.id);
    else { run('INSERT INTO fantasy_entries(id, contest_id, owner_id, user_id, team_name, picks_json, captain_id, vice_id, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)', newId('fte'), c.id, c.owner_id, u.id, teamName!, json, captain!, vice!, t, t); created = true; }
    audit({ id: u.id, role: u.role }, created ? 'fantasy.entry_create' : 'fantasy.entry_change', 'fantasy_contest', c.id, { teamName, players: picks!.length }, c.owner_id);
  });
  return { saved: true, created, contest: contestForPlayer(u, c.id) };
}

/** Takes the player's own team out while the contest is open. They can enter again before it locks. */
export function withdrawEntry(u: UserRow, id: string) {
  customerOnly(u);
  const { c, m } = visibleContest(id);
  const e = one<EntryRow>('SELECT * FROM fantasy_entries WHERE contest_id = ? AND user_id = ? AND withdrawn_at IS NULL', c.id, u.id);
  if (!e) throw notFound('You have no team in this contest');
  if (stateOf(c, m) !== 'open') throw conflict('CONTEST_LOCKED', 'Teams are locked for this contest, so your team stays in.');
  run('UPDATE fantasy_entries SET withdrawn_at = ?, withdrawn_by = ? WHERE id = ?', now(), u.id, e.id);
  audit({ id: u.id, role: u.role }, 'fantasy.entry_withdraw', 'fantasy_contest', c.id, { entry: e.id }, c.owner_id);
  return { withdrawn: true };
}

/** The season table of the business that runs this contest, for a player: team names only, their own row marked. */
export function seasonForPlayer(u: UserRow, id: string) {
  customerOnly(u);
  const { c } = visibleContest(id);
  const business = one<{ business_name: string | null; name: string }>('SELECT business_name, name FROM users WHERE id = ?', c.owner_id);
  return { business: business?.business_name ?? business?.name ?? null, ...seasonTable(c.owner_id, { forUser: u.id }) };
}

/** Every team the player has entered, newest first, with points and place. Used by the app's My fantasy and by Ask AI. */
export function myFantasy(u: UserRow) {
  customerOnly(u);
  const rows = many<EntryRow>('SELECT e.* FROM fantasy_entries e WHERE e.user_id = ? AND (e.withdrawn_at IS NULL OR e.withdrawn_by <> e.user_id) ORDER BY e.created_at DESC LIMIT 50', u.id);
  const items = rows.map((e) => {
    const c = one<ContestRow>('SELECT * FROM fantasy_contests WHERE id = ?', e.contest_id)!;
    const m = matchOf(c.match_id);
    const state = stateOf(c, m);
    const all = activeEntries(c.id);
    const s = e.withdrawn_at ? undefined : scoreEntries(all, playerPoints(c, m, state)).find((x) => x.entry.id === e.id);
    return { contestId: c.id, state, match: `${m.team_a} v ${m.team_b}`, title: m.title, date: m.scheduled_for ?? c.created_at, teamName: e.team_name, points: s?.points ?? 0, rank: state === 'open' || !s ? null : s.rank, teams: all.length, removed: !!e.withdrawn_at };
  });
  return { items, totalPoints: r1(items.filter((x) => x.state === 'final' && !x.removed).reduce((n, x) => n + x.points, 0)), wins: items.filter((x) => x.state === 'final' && x.rank === 1).length };
}

/** For Ask AI and its outside tool: this business's contests in numbers. Team names only when `names`; never a player's name. */
export function fantasyOverview(ownerId: string, names: boolean) {
  const list = listForStaff(ownerId).items;
  const latest = list.find((x) => x.state === 'live') ?? list.find((x) => x.state === 'final') ?? null;
  let top: { rank: number; teamName?: string; points: number }[] = [];
  if (latest) {
    const c = ownContest(ownerId, latest.id), m = matchOf(c.match_id);
    top = scoreEntries(activeEntries(c.id), playerPoints(c, m, stateOf(c, m))).slice(0, 5).map((x) => ({ rank: x.rank, ...(names ? { teamName: x.entry.team_name } : {}), points: x.points }));
  }
  const season = seasonTable(ownerId, { limit: 5 });
  return {
    contests: list.length, open: list.filter((x) => x.state === 'open').length, live: list.filter((x) => x.state === 'live' || x.state === 'locked').length, finished: list.filter((x) => x.state === 'final').length,
    teamsEntered: list.reduce((n, x) => n + x.entries, 0),
    latest: latest ? { match: `${latest.match.teamA} v ${latest.match.teamB}`, state: latest.state, teams: latest.entries, top } : null,
    season: { finishedContests: season.contests, players: season.players, top: season.table.map((r) => ({ rank: r.rank, ...(names ? { teamName: r.teamName } : {}), points: r.points, contests: r.contests, wins: r.wins })) },
    note: 'Free to play: points only, no entry fee and no prize.',
  };
}

/** A deleted account's teams keep their points for the other players' tables, under no name of theirs (accountDeletion.ts). */
export function forgetFantasy(userId: string): void {
  run("UPDATE fantasy_entries SET team_name = 'Deleted player' WHERE user_id = ?", userId);
}
