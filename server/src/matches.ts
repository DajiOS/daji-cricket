import { many, one, registerSchema, run, tx } from './db.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { HttpError, notFound } from './errors.ts';
import { Validator } from './input.ts';
import { audit, type Actor } from './audit.ts';

// Match day: ball by ball scoring for matches played at an owner's ground, a scorecard that is built from the balls (never typed in twice),
// and a public page that can show a YouTube Live stream. Players are plain names typed by the scorer.

registerSchema('matches-1', `
CREATE TABLE matches (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  ground_id TEXT REFERENCES grounds(id),
  title TEXT NOT NULL,
  team_a TEXT NOT NULL,
  team_b TEXT NOT NULL,
  overs INTEGER NOT NULL,
  players_per_side INTEGER NOT NULL DEFAULT 11,
  batting_first TEXT NOT NULL CHECK (batting_first IN ('a','b')),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','live','completed')),
  youtube_id TEXT,
  is_public INTEGER NOT NULL DEFAULT 1,
  scheduled_for INTEGER,
  result TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX ix_matches_owner ON matches(owner_id, created_at);

CREATE TABLE match_balls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id TEXT NOT NULL REFERENCES matches(id),
  innings INTEGER NOT NULL CHECK (innings IN (1,2)),
  seq INTEGER NOT NULL,
  batter TEXT NOT NULL,
  bowler TEXT NOT NULL,
  runs_bat INTEGER NOT NULL DEFAULT 0,
  extra_type TEXT CHECK (extra_type IN ('wide','noball','bye','legbye')),
  extra_runs INTEGER NOT NULL DEFAULT 0,
  wicket INTEGER NOT NULL DEFAULT 0,
  wicket_kind TEXT,
  out_player TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (match_id, innings, seq)
);
`);

/** Accepts the usual YouTube links and keeps only the video id, so the page never embeds anything else. */
export function youtubeId(url: string): string | null {
  let u: URL;
  try { u = new URL(url.trim()); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^www\.|^m\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0] ?? null;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else { const m = /^\/(live|embed|shorts)\/([^/]+)/.exec(u.pathname); id = m ? m[2]! : null; }
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

const DISMISSALS = ['bowled', 'caught', 'lbw', 'run out', 'stumped', 'hit wicket', 'retired'] as const;

interface MatchRow { id: string; owner_id: string; ground_id: string | null; title: string; team_a: string; team_b: string; overs: number; players_per_side: number; batting_first: 'a' | 'b'; status: 'scheduled' | 'live' | 'completed'; youtube_id: string | null; is_public: number; scheduled_for: number | null; result: string | null; created_at: number }
interface BallRow { id: number; innings: 1 | 2; seq: number; batter: string; bowler: string; runs_bat: number; extra_type: string | null; extra_runs: number; wicket: number; wicket_kind: string | null; out_player: string | null }

export interface Match { id: string; title: string; teamA: string; teamB: string; overs: number; playersPerSide: number; battingFirst: 'a' | 'b'; status: string; youtubeId: string | null; embedUrl: string | null; isPublic: boolean; scheduledFor: number | null; result: string | null; groundId: string | null }
const toMatch = (r: MatchRow): Match => ({
  id: r.id, title: r.title, teamA: r.team_a, teamB: r.team_b, overs: r.overs, playersPerSide: r.players_per_side, battingFirst: r.batting_first, status: r.status,
  youtubeId: r.youtube_id, embedUrl: r.youtube_id ? `https://www.youtube-nocookie.com/embed/${r.youtube_id}` : null, isPublic: !!r.is_public, scheduledFor: r.scheduled_for, result: r.result, groundId: r.ground_id,
});

function ownMatch(ownerId: string, id: string): MatchRow {
  const m = one<MatchRow>('SELECT * FROM matches WHERE id = ? AND owner_id = ?', id, ownerId);
  if (!m) throw notFound('Match not found');
  return m;
}

export function createMatch(actor: Actor, ownerId: string, src: unknown): Match {
  const v = new Validator(src);
  const title = v.str('title', { required: true, min: 3, max: 100 });
  const teamA = v.str('teamA', { required: true, min: 2, max: 50 });
  const teamB = v.str('teamB', { required: true, min: 2, max: 50 });
  const overs = v.int('overs', { required: true, min: 1, max: 50 });
  const players = v.int('playersPerSide', { min: 2, max: 11 });
  const battingFirst = v.oneOf('battingFirst', ['a', 'b'] as const);
  const groundId = v.str('groundId', { max: 60 });
  const youtube = v.str('youtubeUrl', { max: 300 });
  const isPublic = v.bool('isPublic');
  const scheduledFor = v.int('scheduledFor', { min: 0 });
  v.done();
  if (teamA!.toLowerCase() === teamB!.toLowerCase()) throw new HttpError(400, 'VALIDATION_FAILED', 'The two teams need different names', { fields: [{ field: 'teamB', message: 'Must differ from team A' }] });
  const yt = youtube ? youtubeId(youtube) : null;
  if (youtube && !yt) throw new HttpError(400, 'VALIDATION_FAILED', 'That is not a YouTube link', { fields: [{ field: 'youtubeUrl', message: 'Use a https://www.youtube.com/watch?v=... , /live/... or youtu.be link' }] });
  if (groundId && !one('SELECT 1 FROM grounds WHERE id = ? AND owner_id = ?', groundId, ownerId)) throw notFound('Ground not found');
  const id = newId('mat');
  run(`INSERT INTO matches(id, owner_id, ground_id, title, team_a, team_b, overs, players_per_side, batting_first, youtube_id, is_public, scheduled_for, created_by, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, ownerId, groundId ?? null, title!, teamA!, teamB!, overs!, players ?? 11, battingFirst ?? 'a', yt, isPublic === false ? 0 : 1, scheduledFor ?? null, actor.id, now(), now());
  audit(actor, 'match.create', 'match', id, { title }, ownerId);
  return toMatch(ownMatch(ownerId, id));
}

export function updateMatch(actor: Actor, ownerId: string, id: string, src: unknown): Match {
  const cur = ownMatch(ownerId, id);
  const v = new Validator(src);
  const title = v.str('title', { min: 3, max: 100 });
  const youtube = v.has('youtubeUrl') ? (v.src.youtubeUrl === null ? '' : v.str('youtubeUrl', { max: 300 })) : undefined;
  const isPublic = v.bool('isPublic');
  const status = v.oneOf('status', ['scheduled', 'live', 'completed'] as const);
  v.done();
  let yt: string | null | undefined;
  if (youtube !== undefined) {
    yt = youtube === '' ? null : youtubeId(youtube);
    if (youtube !== '' && !yt) throw new HttpError(400, 'VALIDATION_FAILED', 'That is not a YouTube link', { fields: [{ field: 'youtubeUrl', message: 'Use a https://www.youtube.com/watch?v=... , /live/... or youtu.be link' }] });
  }
  run('UPDATE matches SET title = ?, youtube_id = ?, is_public = ?, status = ?, updated_at = ? WHERE id = ?',
    title ?? cur.title, yt === undefined ? cur.youtube_id : yt, isPublic === undefined ? cur.is_public : isPublic ? 1 : 0, status ?? cur.status, now(), id);
  audit(actor, 'match.update', 'match', id, { status, isPublic, youtube: youtube !== undefined }, ownerId);
  return toMatch(ownMatch(ownerId, id));
}

export function listMatches(ownerId: string): Match[] {
  return many<MatchRow>('SELECT * FROM matches WHERE owner_id = ? ORDER BY created_at DESC', ownerId).map(toMatch);
}

// ---- scoring ----

interface Totals { runs: number; wickets: number; legalBalls: number }
const BALLS_PER_OVER = 6;

function tally(balls: BallRow[]): Totals {
  let runs = 0, wickets = 0, legal = 0;
  for (const b of balls) {
    runs += b.runs_bat + b.extra_runs;
    if (b.wicket && b.wicket_kind !== 'retired') wickets++;
    if (b.extra_type !== 'wide' && b.extra_type !== 'noball') legal++;
  }
  return { runs, wickets, legalBalls: legal };
}
const oversText = (legal: number) => `${Math.floor(legal / BALLS_PER_OVER)}.${legal % BALLS_PER_OVER}`;

function inningsState(m: MatchRow, balls: BallRow[], innings: 1 | 2): { closed: boolean; why: string | null } {
  const t = tally(balls);
  if (t.wickets >= m.players_per_side - 1) return { closed: true, why: 'all out' };
  if (t.legalBalls >= m.overs * BALLS_PER_OVER) return { closed: true, why: 'overs complete' };
  if (innings === 2) {
    const first = tally(ballsOf(m.id, 1));
    if (t.runs > first.runs) return { closed: true, why: 'target reached' };
  }
  return { closed: false, why: null };
}

const ballsOf = (matchId: string, innings: 1 | 2): BallRow[] => many<BallRow>('SELECT * FROM match_balls WHERE match_id = ? AND innings = ? ORDER BY seq', matchId, innings);

function battingTeam(m: MatchRow, innings: 1 | 2): string {
  const firstIsA = m.batting_first === 'a';
  return (innings === 1) === firstIsA ? m.team_a : m.team_b;
}

export interface BallInput { batter: string; bowler: string; runsBat: number; extraType: string | null; extraRuns: number; wicket: boolean; wicketKind: string | null; outPlayer: string | null }

export function addBall(actor: Actor, ownerId: string, matchId: string, src: unknown): Scorecard {
  const m = ownMatch(ownerId, matchId);
  if (m.status === 'completed') throw new HttpError(409, 'MATCH_COMPLETED', 'This match is finished. Reopen it to change the score.');
  const v = new Validator(src);
  const innings = v.int('innings', { required: true, min: 1, max: 2 }) as 1 | 2 | undefined;
  const batter = v.str('batter', { required: true, min: 1, max: 40 });
  const bowler = v.str('bowler', { required: true, min: 1, max: 40 });
  const runsBat = v.int('runsBat', { min: 0, max: 7 }) ?? 0;
  const extraType = v.oneOf('extraType', ['wide', 'noball', 'bye', 'legbye'] as const);
  let extraRuns = v.int('extraRuns', { min: 0, max: 7 });
  const wicket = v.bool('wicket') ?? false;
  const wicketKind = v.oneOf('wicketKind', DISMISSALS);
  const outPlayer = v.str('outPlayer', { max: 40 });
  if (wicket && !wicketKind) v.fail('wicketKind', 'Say how the batter was out');
  if (!wicket && wicketKind) v.fail('wicket', 'Set wicket to true when giving a dismissal');
  if (extraType && (extraType === 'bye' || extraType === 'legbye') && runsBat > 0) v.fail('runsBat', 'Byes and leg byes are not scored off the bat');
  if (extraType === 'wide' && runsBat > 0) v.fail('runsBat', 'No runs off the bat on a wide');
  if (wicket && (extraType === 'wide' || extraType === 'noball') && wicketKind && !['run out', 'stumped', 'hit wicket', 'retired'].includes(wicketKind)) v.fail('wicketKind', 'Only a run out, stumping (wide), hit wicket or retirement is possible on this ball');
  v.done();
  // a wide or no ball always costs at least one run to the batting side
  if (extraType === 'wide' || extraType === 'noball') extraRuns = Math.max(extraRuns ?? 1, 1);
  else if (extraType) extraRuns = extraRuns ?? 1;
  else extraRuns = 0;
  if (!extraType && src && (src as { extraRuns?: unknown }).extraRuns) throw new HttpError(400, 'VALIDATION_FAILED', 'extraRuns needs an extraType', { fields: [{ field: 'extraType', message: 'Required with extraRuns' }] });

  if (innings === 2 && !ballsOf(matchId, 1).length) throw new HttpError(409, 'INNINGS_ORDER', 'Score the first innings first');
  if (innings === 2 && !inningsState(m, ballsOf(matchId, 1), 1).closed) throw new HttpError(409, 'INNINGS_OPEN', 'The first innings is not over yet');
  const balls = ballsOf(matchId, innings!);
  const st = inningsState(m, balls, innings!);
  if (st.closed) throw new HttpError(409, 'INNINGS_CLOSED', `This innings is over (${st.why}).`);
  const seq = (balls[balls.length - 1]?.seq ?? 0) + 1;
  tx(() => {
    run('INSERT INTO match_balls(match_id, innings, seq, batter, bowler, runs_bat, extra_type, extra_runs, wicket, wicket_kind, out_player, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      matchId, innings!, seq, batter!, bowler!, runsBat, extraType ?? null, extraRuns ?? 0, wicket ? 1 : 0, wicket ? wicketKind! : null, wicket ? (outPlayer ?? batter!) : null, now());
    if (m.status === 'scheduled') run("UPDATE matches SET status = 'live', updated_at = ? WHERE id = ?", now(), matchId);
  });
  settle(ownerId, matchId, actor);
  return scorecard(matchId, true);
}

/** Removes the last ball of an innings (a scorer's mistake). Reopens a finished match. */
export function undoBall(actor: Actor, ownerId: string, matchId: string, innings: unknown): Scorecard {
  ownMatch(ownerId, matchId);
  if (innings !== 1 && innings !== 2) throw new HttpError(400, 'VALIDATION_FAILED', 'innings must be 1 or 2');
  const last = one<{ id: number }>('SELECT id FROM match_balls WHERE match_id = ? AND innings = ? ORDER BY seq DESC LIMIT 1', matchId, innings);
  if (!last) throw notFound('No balls to undo in that innings');
  if (innings === 1 && ballsOf(matchId, 2).length) throw new HttpError(409, 'INNINGS_ORDER', 'Undo the second innings balls first');
  run('DELETE FROM match_balls WHERE id = ?', last.id);
  run("UPDATE matches SET status = 'live', result = NULL, updated_at = ? WHERE id = ?", now(), matchId);
  audit(actor, 'match.undo_ball', 'match', matchId, { innings }, ownerId);
  return scorecard(matchId, true);
}

/** Works out whether the match has finished and writes the result line. */
function settle(ownerId: string, matchId: string, actor: Actor): void {
  const m = ownMatch(ownerId, matchId);
  const b1 = ballsOf(matchId, 1), b2 = ballsOf(matchId, 2);
  if (!b2.length || !inningsState(m, b2, 2).closed) return;
  const t1 = tally(b1), t2 = tally(b2);
  const chasing = battingTeam(m, 2), setting = battingTeam(m, 1);
  const left = m.players_per_side - 1 - t2.wickets;
  const result = t2.runs > t1.runs ? `${chasing} won by ${left} wicket${left === 1 ? '' : 's'}` : t2.runs === t1.runs ? 'Match tied' : `${setting} won by ${t1.runs - t2.runs} run${t1.runs - t2.runs === 1 ? '' : 's'}`;
  run("UPDATE matches SET status = 'completed', result = ?, updated_at = ? WHERE id = ?", result, now(), matchId);
  audit(actor, 'match.complete', 'match', matchId, { result }, ownerId);
}

export interface Scorecard {
  match: Match;
  innings: {
    number: 1 | 2; team: string; runs: number; wickets: number; overs: string; runRate: number | null; closed: boolean; target: number | null;
    batting: { name: string; runs: number; balls: number; fours: number; sixes: number; out: string | null }[];
    bowling: { name: string; overs: string; runs: number; wickets: number; economy: number | null }[];
    extras: { wides: number; noBalls: number; byes: number; legByes: number; total: number };
    recent: string[];
  }[];
}

function ballLabel(b: BallRow): string {
  if (b.wicket) return 'W';
  if (b.extra_type === 'wide') return b.extra_runs > 1 ? `${b.extra_runs}wd` : 'wd';
  if (b.extra_type === 'noball') return b.runs_bat ? `${b.runs_bat}nb` : 'nb';
  if (b.extra_type === 'bye') return `${b.extra_runs}b`;
  if (b.extra_type === 'legbye') return `${b.extra_runs}lb`;
  return String(b.runs_bat);
}

export function scorecard(matchId: string, includePrivate: boolean, ownerId?: string): Scorecard {
  const m = ownerId ? ownMatch(ownerId, matchId) : one<MatchRow>('SELECT * FROM matches WHERE id = ?', matchId);
  if (!m || (!includePrivate && !m.is_public)) throw notFound('Match not found');
  const first = ballsOf(m.id, 1);
  const innings = ([1, 2] as const).map((n) => {
    const balls = n === 1 ? first : ballsOf(m.id, 2);
    const t = tally(balls);
    const bat = new Map<string, { runs: number; balls: number; fours: number; sixes: number; out: string | null }>();
    const bowl = new Map<string, { legal: number; runs: number; wickets: number }>();
    const extras = { wides: 0, noBalls: 0, byes: 0, legByes: 0, total: 0 };
    for (const b of balls) {
      const s = bat.get(b.batter) ?? { runs: 0, balls: 0, fours: 0, sixes: 0, out: null }; bat.set(b.batter, s);
      if (b.extra_type !== 'wide') s.balls++;
      s.runs += b.runs_bat;
      if (b.runs_bat === 4) s.fours++;
      if (b.runs_bat === 6) s.sixes++;
      if (b.wicket) {
        const who = b.out_player ?? b.batter;
        const o = bat.get(who) ?? { runs: 0, balls: 0, fours: 0, sixes: 0, out: null }; bat.set(who, o);
        o.out = b.wicket_kind === 'run out' || b.wicket_kind === 'retired' ? b.wicket_kind : `${b.wicket_kind} b ${b.bowler}`;
      }
      const w = bowl.get(b.bowler) ?? { legal: 0, runs: 0, wickets: 0 }; bowl.set(b.bowler, w);
      if (b.extra_type !== 'wide' && b.extra_type !== 'noball') w.legal++;
      // byes and leg byes are not charged to the bowler
      w.runs += b.runs_bat + (b.extra_type === 'wide' || b.extra_type === 'noball' ? b.extra_runs : 0);
      if (b.wicket && !['run out', 'retired'].includes(b.wicket_kind ?? '')) w.wickets++;
      if (b.extra_type === 'wide') extras.wides += b.extra_runs; else if (b.extra_type === 'noball') extras.noBalls += b.extra_runs;
      else if (b.extra_type === 'bye') extras.byes += b.extra_runs; else if (b.extra_type === 'legbye') extras.legByes += b.extra_runs;
    }
    extras.total = extras.wides + extras.noBalls + extras.byes + extras.legByes;
    const st = inningsState(m, balls, n);
    return {
      number: n, team: battingTeam(m, n), runs: t.runs, wickets: t.wickets, overs: oversText(t.legalBalls),
      runRate: t.legalBalls ? Math.round((t.runs / (t.legalBalls / BALLS_PER_OVER)) * 100) / 100 : null,
      closed: st.closed, target: n === 2 && first.length ? tally(first).runs + 1 : null,
      batting: [...bat].map(([name, s]) => ({ name, ...s })),
      bowling: [...bowl].map(([name, w]) => ({ name, overs: oversText(w.legal), runs: w.runs, wickets: w.wickets, economy: w.legal ? Math.round((w.runs / (w.legal / BALLS_PER_OVER)) * 100) / 100 : null })),
      extras, recent: balls.slice(-12).map(ballLabel),
    };
  }).filter((i) => i.number === 1 || ballsOf(m.id, 1).length > 0);
  return { match: toMatch(m), innings };
}

/** What anyone may see: public matches that are live or finished, newest first. */
export function publicMatches(limit = 30): (Match & { summary: string })[] {
  return many<MatchRow>("SELECT * FROM matches WHERE is_public = 1 AND status IN ('live','completed') ORDER BY CASE status WHEN 'live' THEN 0 ELSE 1 END, updated_at DESC LIMIT ?", limit).map((r) => {
    const sc = scorecard(r.id, false);
    const summary = sc.innings.map((i) => `${i.team} ${i.runs}/${i.wickets} (${i.overs})`).join('  ·  ');
    return { ...toMatch(r), summary };
  });
}
