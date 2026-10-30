import { many, one, registerSchema, run, tx } from './db.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { HttpError, conflict, forbidden, notFound } from './errors.ts';
import { Validator, normalizePhone } from './input.ts';
import { audit } from './audit.ts';
import { hasPermission, type UserRow } from './auth.ts';
import { businessName } from './businesses.ts';
import { groundRow, slotStarts } from './grounds.ts';
import { linkedBusy } from './groundLinks.ts';
import { createMatch, nameKey } from './matches.ts';
import { ballsToOvers, oversToBalls, pointsTable, roundRobin } from './tournaments.ts';
import { addDays, istDate, istMidnight, minutesOf, MIN } from './time.ts';
import { childForTeam, consentGiven, isChild, isMember, requireCricketStaff, requireMember, shortName } from './network.ts';

// Network tournaments: one tournament across grounds of different businesses (redesign brief, multi-ground tournament steps 1 to 8).
//  1. A network business organises it (its owner or staff with manage_matches) and invites grounds of network businesses.
//  2. The organiser adds teams, players, the format and the dates.
//  3. The system checks each accepted ground's opening hours, its bookings and blocks, shared space (ground links) and the teams'
//     other matches, and proposes fixtures; matches run in parallel on different grounds.
//  4. Each host ground confirms its own slots: only then is the time held on that ground (a block, no money), by that ground's staff.
//  5. The organiser publishes when every fixture is confirmed.
//  6. The host's scorer scores the match with the ordinary ball-by-ball scorer at that ground (the match belongs to the host business),
//     submits the result, and the organiser verifies it. Nobody verifies their own submission.
//  7. Standings and players' network statistics use verified results only.
//  8. Every proposal, confirmation, move, delay, scorer change and result version is kept (net_fixture_log, net_results).
// Money: fees, ground charges and prizes are explicit settlement lines between named parties, as agreed. Nothing is pooled, nothing is
// posted to any business's books here, and each business sees only the lines it is a party to. Booking architecture is untouched: the hold
// is the same block the single-ground tournament builder writes (tournaments.ts), and it is released only by the code that wrote it.
// Separate from tournaments.ts because those rows belong to one business; a network tournament belongs to its organiser and spans others.

registerSchema('network-tournaments-1', `
CREATE TABLE net_tournaments (
  id TEXT PRIMARY KEY,
  organiser_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('round_robin','double_round_robin')),
  overs INTEGER NOT NULL,
  match_minutes INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  points_win INTEGER NOT NULL DEFAULT 2,
  points_tie INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','completed','cancelled')),
  notes TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  published_at INTEGER,
  closed_at INTEGER,
  closed_by TEXT,
  close_reason TEXT
);
CREATE INDEX ix_net_tournaments_org ON net_tournaments(organiser_id, status);

CREATE TABLE net_grounds (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES net_tournaments(id),
  ground_id TEXT NOT NULL REFERENCES grounds(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','accepted','declined','withdrawn')),
  charge_per_match_paise INTEGER NOT NULL DEFAULT 0 CHECK (charge_per_match_paise >= 0),
  invited_by TEXT,
  invited_at INTEGER NOT NULL,
  answered_by TEXT,
  answered_at INTEGER,
  note TEXT,
  UNIQUE (tournament_id, ground_id)
);
CREATE INDEX ix_net_grounds_owner ON net_grounds(owner_id, status);

CREATE TABLE net_teams (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES net_tournaments(id),
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  captain TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  removed_at INTEGER,
  removed_by TEXT
);
CREATE UNIQUE INDEX uq_net_teams_name ON net_teams(tournament_id, name_key) WHERE removed_at IS NULL;

CREATE TABLE net_team_players (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES net_teams(id),
  tournament_id TEXT NOT NULL REFERENCES net_tournaments(id),
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  user_id TEXT REFERENCES users(id),
  added_by TEXT,
  created_at INTEGER NOT NULL,
  removed_at INTEGER
);
CREATE UNIQUE INDEX uq_net_team_players_name ON net_team_players(team_id, name_key) WHERE removed_at IS NULL;
CREATE UNIQUE INDEX uq_net_team_players_user ON net_team_players(tournament_id, user_id) WHERE user_id IS NOT NULL AND removed_at IS NULL;

CREATE TABLE net_fixtures (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES net_tournaments(id),
  round INTEGER NOT NULL,
  team_a_id TEXT NOT NULL REFERENCES net_teams(id),
  team_b_id TEXT NOT NULL REFERENCES net_teams(id),
  ground_id TEXT REFERENCES grounds(id),
  owner_id TEXT REFERENCES users(id),
  starts_at INTEGER,
  status TEXT NOT NULL DEFAULT 'unscheduled' CHECK (status IN ('unscheduled','proposed','confirmed','declined','cancelled')),
  move_ground_id TEXT,
  move_starts_at INTEGER,
  move_reason TEXT,
  hold_ground_id TEXT,
  hold_from INTEGER,
  hold_until INTEGER,
  hold_note TEXT,
  match_id TEXT REFERENCES matches(id),
  scorer_id TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX ix_net_fixtures_t ON net_fixtures(tournament_id, round);
CREATE INDEX ix_net_fixtures_ground ON net_fixtures(ground_id, starts_at);
CREATE INDEX ix_net_fixtures_match ON net_fixtures(match_id);

CREATE TABLE net_fixture_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fixture_id TEXT NOT NULL REFERENCES net_fixtures(id),
  tournament_id TEXT NOT NULL REFERENCES net_tournaments(id),
  at INTEGER NOT NULL,
  actor_id TEXT,
  owner_id TEXT,
  kind TEXT NOT NULL,
  detail TEXT,
  reason TEXT
);
CREATE INDEX ix_net_fixture_log_f ON net_fixture_log(fixture_id, id);
CREATE TRIGGER trg_ao_net_fixture_log_update BEFORE UPDATE ON net_fixture_log BEGIN SELECT RAISE(ABORT, 'net_fixture_log is append-only: update refused'); END;
CREATE TRIGGER trg_ao_net_fixture_log_delete BEFORE DELETE ON net_fixture_log BEGIN SELECT RAISE(ABORT, 'net_fixture_log is append-only: delete refused'); END;

CREATE TABLE net_results (
  id TEXT PRIMARY KEY,
  fixture_id TEXT NOT NULL REFERENCES net_fixtures(id),
  tournament_id TEXT NOT NULL REFERENCES net_tournaments(id),
  version INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('team_a','team_b','tie','no_result')),
  winner_team_id TEXT,
  a_runs INTEGER,
  a_balls INTEGER,
  b_runs INTEGER,
  b_balls INTEGER,
  result_text TEXT,
  from_match INTEGER NOT NULL DEFAULT 0,
  submitted_by TEXT NOT NULL,
  submitted_owner TEXT NOT NULL,
  submitted_at INTEGER NOT NULL,
  reason TEXT,
  verified_by TEXT,
  verified_at INTEGER,
  rejected_by TEXT,
  rejected_at INTEGER,
  reject_reason TEXT,
  superseded_at INTEGER,
  UNIQUE (fixture_id, version)
);
CREATE INDEX ix_net_results_f ON net_results(fixture_id, version);

CREATE TABLE net_settlements (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES net_tournaments(id),
  fixture_id TEXT REFERENCES net_fixtures(id),
  kind TEXT NOT NULL CHECK (kind IN ('entry_fee','ground_charge','prize','other')),
  payer_kind TEXT NOT NULL CHECK (payer_kind IN ('business','team','other')),
  payer_ref TEXT,
  payer_label TEXT NOT NULL,
  payee_kind TEXT NOT NULL CHECK (payee_kind IN ('business','team','other')),
  payee_ref TEXT,
  payee_label TEXT NOT NULL,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  note TEXT,
  idem_key TEXT UNIQUE,
  created_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_net_settlements_t ON net_settlements(tournament_id);

CREATE TABLE net_settlement_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  settlement_id TEXT NOT NULL REFERENCES net_settlements(id),
  status TEXT NOT NULL CHECK (status IN ('agreed','paid','cancelled')),
  at INTEGER NOT NULL,
  actor_id TEXT,
  owner_id TEXT,
  ref TEXT,
  reason TEXT
);
CREATE INDEX ix_net_settlement_events_s ON net_settlement_events(settlement_id, id);
CREATE TRIGGER trg_ao_net_settlement_events_update BEFORE UPDATE ON net_settlement_events BEGIN SELECT RAISE(ABORT, 'net_settlement_events is append-only: update refused'); END;
CREATE TRIGGER trg_ao_net_settlement_events_delete BEFORE DELETE ON net_settlement_events BEGIN SELECT RAISE(ABORT, 'net_settlement_events is append-only: delete refused'); END;
`);

const FORMATS = ['round_robin', 'double_round_robin'] as const;
const OUTCOMES = ['team_a', 'team_b', 'tie', 'no_result'] as const;
const SETTLEMENT_KINDS = ['entry_fee', 'ground_charge', 'prize', 'other'] as const;
const PARTY_KINDS = ['business', 'team', 'other'] as const;
const MAX_TEAMS = 32, MAX_PLAYERS = 20, MAX_GROUNDS = 12;
/** One settlement line at most ₹1 crore. */
const MAX_AMOUNT_PAISE = 1_000_000_000;
export const BOOKS_NOTE = 'Not posted to any books. Each business records its own side in its own books, and the accountant confirms the entries.';

interface TRow { id: string; organiser_id: string; name: string; format: (typeof FORMATS)[number]; overs: number; match_minutes: number; start_date: string; end_date: string; points_win: number; points_tie: number; status: 'draft' | 'published' | 'completed' | 'cancelled'; notes: string | null; created_at: number; published_at: number | null; closed_at: number | null; close_reason: string | null }
interface GRow { id: string; tournament_id: string; ground_id: string; owner_id: string; status: 'invited' | 'accepted' | 'declined' | 'withdrawn'; charge_per_match_paise: number; invited_at: number; answered_at: number | null; note: string | null }
interface TeamRow { id: string; tournament_id: string; name: string; captain: string | null }
interface PRow { id: string; team_id: string; name: string; user_id: string | null }
interface FRow { id: string; tournament_id: string; round: number; team_a_id: string; team_b_id: string; ground_id: string | null; owner_id: string | null; starts_at: number | null; status: 'unscheduled' | 'proposed' | 'confirmed' | 'declined' | 'cancelled'; move_ground_id: string | null; move_starts_at: number | null; move_reason: string | null; hold_ground_id: string | null; hold_from: number | null; hold_until: number | null; hold_note: string | null; match_id: string | null; scorer_id: string | null }
interface RRow { id: string; fixture_id: string; version: number; outcome: (typeof OUTCOMES)[number]; winner_team_id: string | null; a_runs: number | null; a_balls: number | null; b_runs: number | null; b_balls: number | null; result_text: string | null; from_match: number; submitted_by: string; submitted_owner: string; submitted_at: number; reason: string | null; verified_by: string | null; verified_at: number | null; rejected_by: string | null; rejected_at: number | null; reject_reason: string | null; superseded_at: number | null }
interface SRow { id: string; tournament_id: string; fixture_id: string | null; kind: (typeof SETTLEMENT_KINDS)[number]; payer_kind: (typeof PARTY_KINDS)[number]; payer_ref: string | null; payer_label: string; payee_kind: (typeof PARTY_KINDS)[number]; payee_ref: string | null; payee_label: string; amount_paise: number; note: string | null; created_at: number }

type Role = 'organiser' | 'host';
const bad = (field: string, message: string) => new HttpError(400, 'VALIDATION_FAILED', message, { fields: [{ field, message }] });
const actorOf = (u: UserRow) => ({ id: u.id, role: u.role });
const hhmm = (ms: number) => { const m = (ms - istMidnight(istDate(ms))) / MIN; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const when = (ms: number) => `${istDate(ms)} ${hhmm(ms)}`;

const tRow = (id: string) => one<TRow>('SELECT * FROM net_tournaments WHERE id = ?', id);
const teamsOf = (tid: string) => many<TeamRow>('SELECT * FROM net_teams WHERE tournament_id = ? AND removed_at IS NULL ORDER BY created_at, id', tid);
const playersOf = (teamId: string) => many<PRow>('SELECT * FROM net_team_players WHERE team_id = ? AND removed_at IS NULL ORDER BY created_at, id', teamId);
const groundsOf = (tid: string) => many<GRow>('SELECT * FROM net_grounds WHERE tournament_id = ? ORDER BY invited_at, id', tid);
const fixturesOf = (tid: string) => many<FRow>("SELECT * FROM net_fixtures WHERE tournament_id = ? ORDER BY round, COALESCE(starts_at, 9e15), created_at, id", tid);
const liveFixtures = (tid: string) => fixturesOf(tid).filter((f) => f.status !== 'cancelled');
const fxOf = (tid: string, fid: string) => { const f = one<FRow>('SELECT * FROM net_fixtures WHERE id = ? AND tournament_id = ?', fid, tid); if (!f) throw notFound('Fixture not found'); return f; };
const resultsOf = (fid: string) => many<RRow>('SELECT * FROM net_results WHERE fixture_id = ? ORDER BY version', fid);
/** The result that counts: verified and not replaced by a later verified version. */
const verifiedOf = (fid: string) => one<RRow>('SELECT * FROM net_results WHERE fixture_id = ? AND verified_at IS NOT NULL AND superseded_at IS NULL ORDER BY version DESC LIMIT 1', fid);
const pendingOf = (fid: string) => one<RRow>('SELECT * FROM net_results WHERE fixture_id = ? AND verified_at IS NULL AND rejected_at IS NULL AND superseded_at IS NULL ORDER BY version DESC LIMIT 1', fid);

function log(f: Pick<FRow, 'id' | 'tournament_id'>, u: UserRow | null, ownerId: string | null, kind: string, detail: unknown = null, reason: string | null = null): void {
  run('INSERT INTO net_fixture_log(fixture_id, tournament_id, at, actor_id, owner_id, kind, detail, reason) VALUES(?,?,?,?,?,?,?,?)', f.id, f.tournament_id, now(), u?.id ?? null, ownerId, kind, detail === null ? null : JSON.stringify(detail), reason);
}

/** The tournament and how this business is in it. A business that is neither organiser nor an invited ground gets 404. */
function access(ownerId: string, tid: string): { t: TRow; role: Role } {
  const t = tRow(tid);
  if (!t) throw notFound('Tournament not found');
  if (t.organiser_id === ownerId) return { t, role: 'organiser' };
  if (one('SELECT 1 FROM net_grounds WHERE tournament_id = ? AND owner_id = ?', tid, ownerId)) return { t, role: 'host' };
  throw notFound('Tournament not found');
}
function organiser(u: UserRow, ownerId: string, tid: string, open = true): TRow {
  requireCricketStaff(u);
  const { t, role } = access(ownerId, tid);
  if (role !== 'organiser') throw forbidden('Only the organiser can do this');
  if (open && (t.status === 'completed' || t.status === 'cancelled')) throw conflict('TOURNAMENT_CLOSED', `This tournament is ${t.status}`);
  return t;
}
const touch = (tid: string) => run('UPDATE net_tournaments SET updated_at = ? WHERE id = ?', now(), tid);

// ------------------------------------------------------------------ slots: opening hours, bookings, blocks, shared space, other network fixtures

/** Why this time does not work on this ground, or null when it is free. `fixtureId` is the fixture asking (its own hold and proposal do not count). */
export function slotProblem(groundId: string, startsAt: number, minutes: number, fixtureId?: string): string | null {
  const g = groundRow(groundId);
  if (!g || !g.active) return 'The ground is not open for bookings';
  const date = istDate(startsAt), end = startsAt + minutes * MIN;
  const starts = slotStarts(g, date).filter((s) => s >= startsAt && s < end);
  const need = Math.ceil(minutes / g.slot_minutes);
  if (starts[0] !== startsAt || starts.length < need || starts.some((s, i) => s !== startsAt + i * g.slot_minutes * MIN)) return `${g.name} is not open for the whole match (${date} ${hhmm(startsAt)}, ${minutes} minutes)`;
  const own = fixtureId ? one<FRow>('SELECT * FROM net_fixtures WHERE id = ?', fixtureId) : undefined;
  const taken = one<{ kind: string; note: string | null }>('SELECT kind, note FROM booking_slots WHERE ground_id = ? AND slot_start >= ? AND slot_start < ? AND NOT (kind = \'block\' AND ? IS NOT NULL AND note IS ? AND ground_id = ?) LIMIT 1',
    g.id, startsAt, end, own?.hold_note ?? null, own?.hold_note ?? null, own?.hold_ground_id ?? '');
  if (taken) return `${g.name} is already ${taken.kind === 'block' ? 'blocked' : 'booked'} at ${date} ${hhmm(startsAt)}`;
  const linked = linkedBusy(g, starts);
  if (linked.size) return `${[...linked.values()][0]} (shares space with ${g.name}) is booked then`;
  const other = many<{ id: string; at: number; until: number }>(`SELECT f.id, COALESCE(f.move_starts_at, f.starts_at) at, COALESCE(f.move_starts_at, f.starts_at) + t.match_minutes * 60000 until FROM net_fixtures f JOIN net_tournaments t ON t.id = f.tournament_id
    WHERE f.status IN ('proposed','confirmed') AND t.status IN ('draft','published') AND COALESCE(f.move_ground_id, f.ground_id) = ? AND f.id <> ?`, g.id, fixtureId ?? '')
    .concat(many<{ id: string; at: number; until: number }>(`SELECT f.id, f.starts_at at, f.starts_at + t.match_minutes * 60000 until FROM net_fixtures f JOIN net_tournaments t ON t.id = f.tournament_id
    WHERE f.status IN ('proposed','confirmed') AND t.status IN ('draft','published') AND f.move_ground_id IS NOT NULL AND f.ground_id = ? AND f.id <> ?`, g.id, fixtureId ?? ''))
    .find((x) => x.at < end && x.until > startsAt);
  if (other) return `${g.name} already has another network match at ${when(other.at)}`;
  return null;
}

/** A team plays one match at a time: another live fixture of the tournament overlapping this time. */
function teamBusy(t: TRow, teamIds: string[], startsAt: number, fixtureId?: string): boolean {
  const end = startsAt + t.match_minutes * MIN;
  return liveFixtures(t.id).some((f) => f.id !== fixtureId && (teamIds.includes(f.team_a_id) || teamIds.includes(f.team_b_id))
    && [f.starts_at, f.move_starts_at].some((at) => at !== null && at < end && at + t.match_minutes * MIN > startsAt));
}

function holdTime(t: TRow, f: FRow, groundId: string, startsAt: number): void {
  const g = groundRow(groundId)!;
  const names = new Map(teamsOf(t.id).map((x) => [x.id, x.name]));
  const note = `Network tournament: ${t.name} · ${names.get(f.team_a_id) ?? 'Team'} v ${names.get(f.team_b_id) ?? 'Team'} · ${f.id}`.slice(0, 200);
  const end = startsAt + t.match_minutes * MIN;
  for (const s of slotStarts(g, istDate(startsAt)).filter((x) => x >= startsAt && x < end)) run("INSERT INTO booking_slots(ground_id, slot_start, kind, note) VALUES(?,?,'block',?)", g.id, s, note);
  run('UPDATE net_fixtures SET hold_ground_id = ?, hold_from = ?, hold_until = ?, hold_note = ? WHERE id = ?', g.id, startsAt, end, note, f.id);
}
/** Gives the time back: only the block rows this fixture wrote (same ground, its time, its note), never a booking or anyone else's block. */
function releaseHold(f: FRow): void {
  if (!f.hold_ground_id || !f.hold_from || !f.hold_until) return;
  run("DELETE FROM booking_slots WHERE ground_id = ? AND kind = 'block' AND note IS ? AND slot_start >= ? AND slot_start < ?", f.hold_ground_id, f.hold_note, f.hold_from, f.hold_until);
  run('UPDATE net_fixtures SET hold_ground_id = NULL, hold_from = NULL, hold_until = NULL, hold_note = NULL WHERE id = ?', f.id);
}

// ------------------------------------------------------------------ output

const userName = (id: string | null) => (id ? one<{ name: string }>('SELECT name FROM users WHERE id = ?', id)?.name ?? null : null);
const groundName = (id: string | null) => (id ? groundRow(id)?.name ?? null : null);

function resultOut(r: RRow, names: Map<string, string>) {
  return {
    id: r.id, version: r.version, outcome: r.outcome, winner: r.winner_team_id ? names.get(r.winner_team_id) ?? null : null, resultText: r.result_text,
    aRuns: r.a_runs, aOvers: ballsToOvers(r.a_balls), bRuns: r.b_runs, bOvers: ballsToOvers(r.b_balls), fromScorer: !!r.from_match,
    submittedBy: userName(r.submitted_by), submittedAt: r.submitted_at, reason: r.reason,
    status: r.superseded_at ? 'replaced' : r.verified_at ? 'verified' : r.rejected_at ? 'rejected' : 'waiting for verification',
    verifiedBy: userName(r.verified_by), verifiedAt: r.verified_at, rejectReason: r.reject_reason,
  };
}

function fixtureOut(t: TRow, f: FRow, names: Map<string, string>, me: string | null) {
  const v = verifiedOf(f.id), p = pendingOf(f.id);
  const host = f.owner_id, moveOwner = f.move_ground_id ? groundRow(f.move_ground_id)?.owner_id ?? null : null;
  return {
    id: f.id, round: f.round, teamAId: f.team_a_id, teamBId: f.team_b_id, teamA: names.get(f.team_a_id) ?? '?', teamB: names.get(f.team_b_id) ?? '?',
    groundId: f.ground_id, ground: groundName(f.ground_id), host: host ? businessName(host) : null, hostIsMe: !!me && host === me, startsAt: f.starts_at, endsAt: f.starts_at ? f.starts_at + t.match_minutes * MIN : null,
    status: f.status, timeHeld: !!f.hold_ground_id,
    move: f.move_ground_id ? { groundId: f.move_ground_id, ground: groundName(f.move_ground_id), startsAt: f.move_starts_at, reason: f.move_reason, hostIsMe: !!me && moveOwner === me } : null,
    matchId: f.match_id, scorer: userName(f.scorer_id), scorerId: f.scorer_id,
    result: v ? resultOut(v, names) : null, waiting: p ? resultOut(p, names) : null,
  };
}

function standings(t: TRow) {
  const teams = teamsOf(t.id);
  const fx = liveFixtures(t.id).map((f) => { const r = verifiedOf(f.id); return { team_a_id: f.team_a_id, team_b_id: f.team_b_id, outcome: r?.outcome ?? null, a_runs: r?.a_runs ?? null, a_balls: r?.a_balls ?? null, b_runs: r?.b_runs ?? null, b_balls: r?.b_balls ?? null }; });
  return pointsTable(t, teams as Parameters<typeof pointsTable>[1], fx as Parameters<typeof pointsTable>[2]);
}

function settlementStatus(s: SRow) {
  const evs = many<{ status: string; at: number; actor_id: string | null; ref: string | null; reason: string | null }>('SELECT status, at, actor_id, ref, reason FROM net_settlement_events WHERE settlement_id = ? ORDER BY id', s.id);
  const last = evs[evs.length - 1];
  return { status: (last?.status ?? 'agreed') as 'agreed' | 'paid' | 'cancelled', history: evs.map((e) => ({ status: e.status, at: e.at, by: userName(e.actor_id), ref: e.ref, reason: e.reason })) };
}
const partyIs = (kind: string, ref: string | null, ownerId: string) => kind === 'business' && ref === ownerId;
function visibleSettlements(t: TRow, ownerId: string): SRow[] {
  const all = many<SRow>('SELECT * FROM net_settlements WHERE tournament_id = ? ORDER BY created_at, id', t.id);
  return t.organiser_id === ownerId ? all : all.filter((s) => partyIs(s.payer_kind, s.payer_ref, ownerId) || partyIs(s.payee_kind, s.payee_ref, ownerId));
}
function settlementOut(s: SRow, ownerId: string, names: Map<string, string>) {
  const st = settlementStatus(s);
  return {
    id: s.id, kind: s.kind, amountPaise: s.amount_paise, payer: s.payer_label, payee: s.payee_label, note: s.note, fixtureId: s.fixture_id,
    iPay: partyIs(s.payer_kind, s.payer_ref, ownerId), iReceive: partyIs(s.payee_kind, s.payee_ref, ownerId), ...st,
    fixture: s.fixture_id ? (() => { const f = one<FRow>('SELECT * FROM net_fixtures WHERE id = ?', s.fixture_id); return f ? `${names.get(f.team_a_id) ?? '?'} v ${names.get(f.team_b_id) ?? '?'}` : null; })() : null,
    books: BOOKS_NOTE,
  };
}
function settlementTotals(rows: ReturnType<typeof settlementOut>[]) {
  const sum = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).reduce((n, r) => n + r.amountPaise, 0);
  return { toReceivePaise: sum((r) => r.iReceive && r.status === 'agreed'), receivedPaise: sum((r) => r.iReceive && r.status === 'paid'), toPayPaise: sum((r) => r.iPay && r.status === 'agreed'), paidPaise: sum((r) => r.iPay && r.status === 'paid') };
}

function summary(t: TRow, ownerId: string) {
  const fx = liveFixtures(t.id);
  const role: Role = t.organiser_id === ownerId ? 'organiser' : 'host';
  const myGrounds = groundsOf(t.id).filter((g) => g.owner_id === ownerId);
  return {
    id: t.id, name: t.name, organiser: businessName(t.organiser_id), myRole: role, status: t.status, format: t.format, overs: t.overs, matchMinutes: t.match_minutes, startDate: t.start_date, endDate: t.end_date,
    teams: teamsOf(t.id).length, grounds: groundsOf(t.id).filter((g) => g.status === 'accepted').length, fixtures: fx.length,
    confirmed: fx.filter((f) => f.status === 'confirmed' && !f.move_ground_id).length, verified: fx.filter((f) => verifiedOf(f.id)).length,
    invitationsForMe: myGrounds.filter((g) => g.status === 'invited').length,
    slotsForMe: fx.filter((f) => (f.status === 'proposed' && f.owner_id === ownerId) || (f.move_ground_id && groundRow(f.move_ground_id)?.owner_id === ownerId)).length,
    resultsToVerify: role === 'organiser' ? fx.filter((f) => pendingOf(f.id)).length : 0,
  };
}

/** The network tournaments this business organises or has a ground invited to. */
export function listNetTournaments(u: UserRow, ownerId: string) {
  requireCricketStaff(u);
  const rows = many<TRow>(`SELECT * FROM net_tournaments t WHERE t.organiser_id = ? OR EXISTS (SELECT 1 FROM net_grounds g WHERE g.tournament_id = t.id AND g.owner_id = ?)
    ORDER BY CASE t.status WHEN 'published' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, t.start_date, t.created_at`, ownerId, ownerId);
  return { member: isMember(ownerId), items: rows.map((t) => summary(t, ownerId)) };
}

export function netTournamentDetail(u: UserRow, ownerId: string, tid: string) {
  requireCricketStaff(u);
  const { t, role } = access(ownerId, tid);
  const teams = teamsOf(tid), names = new Map(teams.map((x) => [x.id, x.name]));
  const settlements = visibleSettlements(t, ownerId).map((s) => settlementOut(s, ownerId, names));
  const ownGrounds = many<{ id: string; name: string }>('SELECT id, name FROM grounds WHERE owner_id = ? AND active = 1 ORDER BY name', ownerId);
  return {
    tournament: { ...summary(t, ownerId), pointsWin: t.points_win, pointsTie: t.points_tie, notes: t.notes, publishedAt: t.published_at, closedAt: t.closed_at, closeReason: t.close_reason },
    myRole: role,
    grounds: groundsOf(tid).map((g) => ({ id: g.id, groundId: g.ground_id, ground: groundName(g.ground_id), business: businessName(g.owner_id), isMine: g.owner_id === ownerId, status: g.status, chargePerMatchPaise: g.charge_per_match_paise, invitedAt: g.invited_at, answeredAt: g.answered_at, note: g.note })),
    // a host sees team names and squad sizes; player names are for the organiser and for the host that scores the match
    teams: teams.map((x) => ({ id: x.id, name: x.name, captain: x.captain, players: role === 'organiser' ? playersOf(x.id).map((p) => ({ id: p.id, name: p.user_id && isChild(p.user_id) ? shortName(p.name) : p.name, hasProfile: !!p.user_id })) : undefined, playerCount: playersOf(x.id).length })),
    fixtures: liveFixtures(tid).map((f) => fixtureOut(t, f, names, ownerId)),
    standings: standings(t), standingsNote: 'Only verified results count.',
    settlements, settlementTotals: settlementTotals(settlements), booksNote: BOOKS_NOTE,
    history: many<{ fixture_id: string; at: number; actor_id: string | null; owner_id: string | null; kind: string; detail: string | null; reason: string | null }>('SELECT * FROM net_fixture_log WHERE tournament_id = ? ORDER BY id DESC LIMIT 200', tid)
      .map((h) => ({ fixtureId: h.fixture_id, at: h.at, by: userName(h.actor_id), business: h.owner_id ? businessName(h.owner_id) : null, kind: h.kind, detail: h.detail ? JSON.parse(h.detail) : null, reason: h.reason })),
    // grounds of network businesses the organiser can invite
    networkGrounds: role === 'organiser' ? many<{ id: string; name: string; city: string; owner_id: string }>("SELECT g.id, g.name, g.city, g.owner_id FROM grounds g JOIN network_members m ON m.owner_id = g.owner_id AND m.left_at IS NULL WHERE g.active = 1 ORDER BY g.name")
      .map((g) => ({ id: g.id, name: g.name, city: g.city, business: businessName(g.owner_id) })) : [],
    myGrounds: ownGrounds,
    // the businesses a settlement line can name: the organiser and each invited or accepted ground's business
    businessOwners: [...new Set([t.organiser_id, ...groundsOf(tid).filter((g) => g.status === 'accepted' || g.status === 'invited').map((g) => g.owner_id)])].map((id) => ({ ownerId: id, name: businessName(id) })),
    scorers: many<{ id: string; name: string }>("SELECT id, name FROM users WHERE ((role = 'staff' AND owner_id = ?) OR id = ?) AND active = 1 ORDER BY name", ownerId, ownerId)
      .filter((p) => { const x = one<UserRow>('SELECT * FROM users WHERE id = ?', p.id)!; return hasPermission(x, 'manage_matches'); }),
  };
}

/** The public view of a published tournament: teams, grounds, fixtures, verified results and standings. No players, money or contact details. */
export function publicNetTournament(tid: string) {
  const t = tRow(tid);
  if (!t || t.status === 'draft') throw notFound('Tournament not found');
  const teams = teamsOf(tid), names = new Map(teams.map((x) => [x.id, x.name]));
  return {
    id: t.id, name: t.name, organiser: businessName(t.organiser_id), status: t.status, startDate: t.start_date, endDate: t.end_date, overs: t.overs,
    teams: teams.map((x) => x.name), grounds: groundsOf(tid).filter((g) => g.status === 'accepted').map((g) => groundName(g.ground_id)),
    fixtures: liveFixtures(tid).map((f) => { const r = verifiedOf(f.id); return { round: f.round, teamA: names.get(f.team_a_id), teamB: names.get(f.team_b_id), ground: groundName(f.ground_id), startsAt: f.starts_at, result: r ? (r.result_text ?? null) : null, verified: !!r }; }),
    standings: standings(t),
  };
}

// ------------------------------------------------------------------ setting up

export function createNetTournament(u: UserRow, ownerId: string, body: unknown) {
  requireCricketStaff(u); requireMember(ownerId);
  const v = new Validator(body ?? {});
  const name = v.str('name', { required: true, min: 3, max: 80 });
  const format = v.oneOf('format', FORMATS) ?? 'round_robin';
  const overs = v.int('overs', { min: 1, max: 50 }) ?? 20;
  const minutes = v.int('matchMinutes', { min: 30, max: 720 }) ?? 180;
  const start = v.date('startDate', true), end = v.date('endDate', true);
  const pw = v.int('pointsWin', { min: 0, max: 10 }) ?? 2, pt = v.int('pointsTie', { min: 0, max: 10 }) ?? 1;
  const notes = v.str('notes', { max: 1000 });
  v.done();
  if (end! < start!) throw bad('endDate', 'The last day is before the first day');
  if (start! < istDate(now())) throw bad('startDate', 'The first day has already passed');
  if (addDays(start!, 120) < end!) throw bad('endDate', 'At most 120 days');
  const id = newId('ntr');
  tx(() => {
    run(`INSERT INTO net_tournaments(id, organiser_id, name, format, overs, match_minutes, start_date, end_date, points_win, points_tie, notes, created_by, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, ownerId, name!, format, overs, minutes, start!, end!, pw, pt, notes ?? null, u.id, now(), now());
    audit(actorOf(u), 'network.tournament_create', 'net_tournament', id, { name }, ownerId);
  });
  return netTournamentDetail(u, ownerId, id);
}

/** The organiser invites a ground of a network business, with the charge per match it is offered (0 when nothing is charged). */
export function inviteGround(u: UserRow, ownerId: string, tid: string, body: unknown) {
  const t = organiser(u, ownerId, tid);
  const v = new Validator(body ?? {});
  const groundId = v.str('groundId', { required: true, max: 60 });
  const charge = v.int('chargePerMatchPaise', { min: 0, max: MAX_AMOUNT_PAISE }) ?? 0;
  v.done();
  const g = groundRow(groundId!);
  if (!g || !g.active || !isMember(g.owner_id)) throw notFound('That ground is not in the cricket network');
  if (groundsOf(tid).length >= MAX_GROUNDS) throw conflict('TOO_MANY', `At most ${MAX_GROUNDS} grounds`);
  const cur = one<GRow>('SELECT * FROM net_grounds WHERE tournament_id = ? AND ground_id = ?', tid, g.id);
  if (cur && (cur.status === 'invited' || cur.status === 'accepted')) throw conflict('ALREADY_INVITED', `${g.name} is already ${cur.status}`);
  // the organiser's own ground is accepted at once: there is nobody else to ask
  const self = g.owner_id === ownerId;
  tx(() => {
    if (cur) run("UPDATE net_grounds SET status = ?, charge_per_match_paise = ?, invited_by = ?, invited_at = ?, answered_by = ?, answered_at = ?, note = NULL WHERE id = ?", self ? 'accepted' : 'invited', charge, u.id, now(), self ? u.id : null, self ? now() : null, cur.id);
    else run('INSERT INTO net_grounds(id, tournament_id, ground_id, owner_id, status, charge_per_match_paise, invited_by, invited_at, answered_by, answered_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      newId('ngi'), tid, g.id, g.owner_id, self ? 'accepted' : 'invited', charge, u.id, now(), self ? u.id : null, self ? now() : null);
    touch(tid);
    audit(actorOf(u), 'network.ground_invite', 'net_tournament', tid, { ground: g.id, chargePerMatchPaise: charge }, ownerId);
  });
  return netTournamentDetail(u, ownerId, t.id);
}

/** The invited ground's business accepts (agreeing the charge per match) or declines, with a note. */
export function answerInvitation(u: UserRow, ownerId: string, tid: string, inviteId: string, body: unknown) {
  requireCricketStaff(u); requireMember(ownerId);
  access(ownerId, tid);
  const v = new Validator(body ?? {});
  const accept = v.bool('accept', true);
  const note = v.str('note', { max: 300 });
  v.done();
  const g = one<GRow>('SELECT * FROM net_grounds WHERE id = ? AND tournament_id = ? AND owner_id = ?', inviteId, tid, ownerId);
  if (!g) throw notFound('Invitation not found');
  const t = tRow(tid)!;
  if (t.status === 'completed' || t.status === 'cancelled') throw conflict('TOURNAMENT_CLOSED', `This tournament is ${t.status}`);
  if (g.status === (accept ? 'accepted' : 'declined')) return netTournamentDetail(u, ownerId, tid);
  if (!accept && liveFixtures(tid).some((f) => f.ground_id === g.ground_id && f.status === 'confirmed')) throw conflict('GROUND_IN_USE', 'Matches are already confirmed on this ground. Ask the organiser to move them first.');
  if (!accept && !note) throw bad('note', 'Say why, so the organiser can plan');
  tx(() => {
    run('UPDATE net_grounds SET status = ?, answered_by = ?, answered_at = ?, note = ? WHERE id = ?', accept ? 'accepted' : (g.status === 'accepted' ? 'withdrawn' : 'declined'), u.id, now(), note ?? null, g.id);
    if (!accept) for (const f of liveFixtures(tid).filter((x) => x.ground_id === g.ground_id && x.status === 'proposed')) {
      run("UPDATE net_fixtures SET status = 'declined', updated_at = ? WHERE id = ?", now(), f.id);
      log(f, u, ownerId, 'declined', { ground: g.ground_id }, 'The ground declined the invitation');
    }
    touch(tid);
    audit(actorOf(u), accept ? 'network.invite_accept' : 'network.invite_decline', 'net_tournament', tid, { ground: g.ground_id, note: note ?? null }, ownerId);
  });
  return netTournamentDetail(u, ownerId, tid);
}

export function addNetTeam(u: UserRow, ownerId: string, tid: string, body: unknown) {
  organiser(u, ownerId, tid);
  const v = new Validator(body ?? {});
  const name = v.str('name', { required: true, min: 2, max: 50 });
  const captain = v.str('captain', { max: 60 });
  v.done();
  if (teamsOf(tid).length >= MAX_TEAMS) throw conflict('TOO_MANY', `At most ${MAX_TEAMS} teams`);
  if (one('SELECT 1 FROM net_teams WHERE tournament_id = ? AND name_key = ? AND removed_at IS NULL', tid, nameKey(name!))) throw conflict('DUPLICATE', 'A team with this name is already in the tournament');
  const id = newId('ntm');
  tx(() => {
    run('INSERT INTO net_teams(id, tournament_id, name, name_key, captain, created_by, created_at) VALUES(?,?,?,?,?,?,?)', id, tid, name!, nameKey(name!), captain ?? null, u.id, now());
    touch(tid);
    audit(actorOf(u), 'network.team_add', 'net_tournament', tid, { team: id, name }, ownerId);
  });
  return { id, name: name!, captain: captain ?? null };
}

export function removeNetTeam(u: UserRow, ownerId: string, tid: string, teamId: string) {
  organiser(u, ownerId, tid);
  const team = one<TeamRow>('SELECT * FROM net_teams WHERE id = ? AND tournament_id = ? AND removed_at IS NULL', teamId, tid);
  if (!team) throw notFound('Team not found');
  if (liveFixtures(tid).some((f) => f.team_a_id === teamId || f.team_b_id === teamId)) throw conflict('TEAM_HAS_FIXTURES', 'This team has fixtures. Cancel them or propose the fixtures again first.');
  tx(() => {
    run('UPDATE net_teams SET removed_at = ?, removed_by = ? WHERE id = ?', now(), u.id, teamId);
    run('UPDATE net_team_players SET removed_at = ? WHERE team_id = ? AND removed_at IS NULL', now(), teamId);
    audit(actorOf(u), 'network.team_remove', 'net_tournament', tid, { team: teamId }, ownerId);
  });
  return { removed: true };
}

/**
 * A player on a team: a profile found by mobile number, a shared network profile by id, a child by the player code their guardian gives
 * (only with the guardian's consent to a match record), or a guest (a name only; a guest earns no record). One profile plays for one team.
 */
export function addNetPlayer(u: UserRow, ownerId: string, tid: string, teamId: string, body: unknown) {
  organiser(u, ownerId, tid);
  const team = one<TeamRow>('SELECT * FROM net_teams WHERE id = ? AND tournament_id = ? AND removed_at IS NULL', teamId, tid);
  if (!team) throw notFound('Team not found');
  const v = new Validator(body ?? {});
  const name = v.str('name', { max: 60 });
  const phone = v.phone('phone');
  const code = v.str('childCode', { max: 20 });
  const profileId = v.str('playerId', { max: 60 });
  v.done();
  if ([phone, code, profileId].filter(Boolean).length > 1) throw bad('phone', 'Use one of: mobile number, player code or network profile');
  let userId: string | null = null, shown = name ?? null;
  if (phone) {
    const p = one<{ id: string; name: string }>("SELECT id, name FROM users WHERE phone = ? AND role = 'customer' AND active = 1 ORDER BY (password_hash IS NOT NULL) DESC, created_at LIMIT 1", normalizePhone(phone));
    if (!p) throw notFound('No player profile has that mobile number. Add them as a guest with a name instead.');
    userId = p.id; shown = shown ?? p.name;
  } else if (code) {
    const c = childForTeam(code);
    userId = c.id; shown = shown ?? c.name;
  } else if (profileId) {
    const p = one<{ id: string; name: string }>("SELECT u.id, u.name FROM users u JOIN player_sharing s ON s.user_id = u.id WHERE u.id = ? AND u.role = 'customer' AND u.active = 1 AND s.visibility IN ('network','public')", profileId);
    if (!p || isChild(p.id)) throw notFound('Player not found');
    userId = p.id; shown = shown ?? p.name;
  }
  if (!shown) throw bad('name', 'Give the player\'s name');
  if (playersOf(teamId).length >= MAX_PLAYERS) throw conflict('TOO_MANY', `At most ${MAX_PLAYERS} players in a team`);
  if (one('SELECT 1 FROM net_team_players WHERE team_id = ? AND name_key = ? AND removed_at IS NULL', teamId, nameKey(shown))) throw conflict('DUPLICATE', 'A player with this name is already in the team');
  if (userId && one('SELECT 1 FROM net_team_players WHERE tournament_id = ? AND user_id = ? AND removed_at IS NULL', tid, userId)) throw conflict('ALREADY_IN_TEAM', 'This player is already in a team in this tournament');
  const id = newId('ntp');
  tx(() => {
    run('INSERT INTO net_team_players(id, team_id, tournament_id, name, name_key, user_id, added_by, created_at) VALUES(?,?,?,?,?,?,?,?)', id, teamId, tid, shown!, nameKey(shown!), userId, u.id, now());
    audit(actorOf(u), 'network.player_add', 'net_tournament', tid, { team: teamId, player: id, profile: !!userId, child: !!code }, ownerId);
  });
  return { id, name: userId && isChild(userId) ? shortName(shown) : shown, hasProfile: !!userId };
}

export function removeNetPlayer(u: UserRow, ownerId: string, tid: string, teamId: string, playerId: string) {
  organiser(u, ownerId, tid);
  const p = one<PRow>('SELECT * FROM net_team_players WHERE id = ? AND team_id = ? AND removed_at IS NULL', playerId, teamId);
  if (!p) throw notFound('Player not found');
  tx(() => {
    run('UPDATE net_team_players SET removed_at = ? WHERE id = ?', now(), playerId);
    audit(actorOf(u), 'network.player_remove', 'net_tournament', tid, { team: teamId, player: playerId }, ownerId);
  });
  return { removed: true };
}

// ------------------------------------------------------------------ fixtures

/**
 * Proposes every fixture of the format onto the accepted grounds at the days and match times given. Each time on each ground is
 * checked (hours, bookings, blocks, shared space, other network matches); a team never plays two overlapping matches, and is kept to one
 * match a day when that is possible. Matches run in parallel on different grounds. Nothing is held until each ground confirms.
 */
export function proposeFixtures(u: UserRow, ownerId: string, tid: string, body: unknown) {
  const t = organiser(u, ownerId, tid);
  const v = new Validator(body ?? {});
  const replace = v.bool('replace') ?? false;
  const rawDays = Array.isArray(v.src.days) ? v.src.days.map(String) : null, rawTimes = Array.isArray(v.src.times) ? v.src.times.map(String) : null;
  if (!rawDays?.length) v.fail('days', 'Pick at least one day');
  if (!rawTimes?.length) v.fail('times', 'Give at least one match time, like 09:00');
  v.done();
  const days = [...new Set(rawDays!)].sort(), times = [...new Set(rawTimes!)];
  for (const d of days) if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < t.start_date || d > t.end_date) throw bad('days', `${d} is not a day of the tournament (${t.start_date} to ${t.end_date})`);
  for (const x of times) if (minutesOf(x) === null) throw bad('times', `${x} is not a time like 09:00`);
  const teams = teamsOf(tid);
  if (teams.length < 2) throw bad('teams', 'Add at least two teams first');
  const grounds = groundsOf(tid).filter((g) => g.status === 'accepted');
  if (!grounds.length) throw bad('grounds', 'No ground has accepted yet');
  const existing = liveFixtures(tid);
  if (existing.length && !replace) throw conflict('FIXTURES_EXIST', 'This tournament already has fixtures. Propose again with replace to start over.');
  if (existing.some((f) => f.status === 'confirmed' || resultsOf(f.id).length)) throw conflict('FIXTURES_CONFIRMED', 'Some fixtures are already confirmed by their ground. Move or cancel those one by one instead.');

  const matches = roundRobin(teams.map((x) => x.id), t.format === 'double_round_robin').flatMap((pairs, r) => pairs.map(([a, b]) => ({ a, b, round: r + 1 })));
  const slots: { groundId: string; ownerId: string; at: number; gname: string }[] = [];
  let checked = 0;
  for (const d of days) for (const x of times) for (const g of grounds) {
    const at = istMidnight(d) + minutesOf(x)! * MIN;
    if (at <= now()) continue;
    checked++;
    if (!slotProblem(g.ground_id, at, t.match_minutes)) slots.push({ groundId: g.ground_id, ownerId: g.owner_id, at, gname: groundName(g.ground_id) ?? '' });
  }
  slots.sort((p, q) => p.at - q.at || p.gname.localeCompare(q.gname));
  const left = [...matches], placed: { a: string; b: string; round: number; at: number; groundId: string; ownerId: string }[] = [];
  const end = (at: number) => at + t.match_minutes * MIN;
  // at each time, the ground with the fewest matches so far goes first, so the work is shared between the hosts
  const load = (gid: string) => placed.filter((p) => p.groundId === gid).length;
  for (let k = 0; k < slots.length; k++) {
    if (!left.length) break;
    const sameAt = slots.slice(k).filter((x) => x.at === slots[k]!.at);
    sameAt.sort((p, q) => load(p.groundId) - load(q.groundId) || p.gname.localeCompare(q.gname));
    slots.splice(k, sameAt.length, ...sameAt);
    const s = slots[k]!;
    // the same ground cannot hold two of these matches at overlapping times (the slots may overlap when match times are close)
    if (placed.some((p) => p.groundId === s.groundId && p.at < end(s.at) && end(p.at) > s.at)) continue;
    const busy = (team: string) => placed.some((p) => (p.a === team || p.b === team) && p.at < end(s.at) && end(p.at) > s.at);
    const sameDay = (team: string) => placed.some((p) => (p.a === team || p.b === team) && istDate(p.at) === istDate(s.at));
    const free = left.map((m, i) => ({ m, i })).filter(({ m }) => !busy(m.a) && !busy(m.b));
    if (!free.length) continue;
    const rested = free.filter(({ m }) => !sameDay(m.a) && !sameDay(m.b));
    const pool = rested.length ? rested : free;
    const minRound = Math.min(...pool.map(({ m }) => m.round));
    const pick = pool.find(({ m }) => m.round === minRound)!;
    left.splice(pick.i, 1);
    placed.push({ ...pick.m, at: s.at, groundId: s.groundId, ownerId: s.ownerId });
  }
  if (left.length) throw bad('days', `${matches.length} matches need ${matches.length} free match times; ${checked} were checked and only ${placed.length} could be used (the rest are booked, blocked, closed or would make a team play twice at once). Add more days, times or grounds.`);
  tx(() => {
    for (const f of existing) { run("UPDATE net_fixtures SET status = 'cancelled', updated_at = ? WHERE id = ?", now(), f.id); log(f, u, ownerId, 'cancelled', null, 'Fixtures proposed again'); }
    for (const p of placed) {
      const id = newId('nfx');
      run(`INSERT INTO net_fixtures(id, tournament_id, round, team_a_id, team_b_id, ground_id, owner_id, starts_at, status, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,'proposed',?,?)`,
        id, tid, p.round, p.a, p.b, p.groundId, p.ownerId, p.at, now(), now());
      log({ id, tournament_id: tid }, u, ownerId, 'proposed', { ground: p.groundId, startsAt: p.at });
    }
    touch(tid);
    audit(actorOf(u), 'network.fixtures_propose', 'net_tournament', tid, { fixtures: placed.length, grounds: new Set(placed.map((p) => p.groundId)).size, replaced: existing.length }, ownerId);
  });
  return netTournamentDetail(u, ownerId, tid);
}

/**
 * The organiser puts a fixture on a ground and time (a delay or a move). A confirmed fixture keeps its confirmed time and hold until the
 * new ground confirms the new time; a published one needs a reason. The new time is checked the same way as a proposal.
 */
export function moveFixture(u: UserRow, ownerId: string, tid: string, fid: string, body: unknown) {
  const t = organiser(u, ownerId, tid);
  const f = fxOf(tid, fid);
  if (f.status === 'cancelled') throw conflict('FIXTURE_CANCELLED', 'This fixture is cancelled');
  if (verifiedOf(f.id) || pendingOf(f.id)) throw conflict('FIXTURE_PLAYED', 'This fixture has a result');
  const v = new Validator(body ?? {});
  const groundId = v.str('groundId', { required: true, max: 60 });
  const date = v.date('date', true), time = v.time('time', true);
  const reason = v.str('reason', { max: 300 });
  v.done();
  const at = istMidnight(date!) + minutesOf(time!)! * MIN;
  if (at <= now()) throw bad('date', 'That time has already passed');
  if (date! < t.start_date || date! > t.end_date) throw bad('date', `Pick a day from ${t.start_date} to ${t.end_date}`);
  const g = one<GRow>("SELECT * FROM net_grounds WHERE tournament_id = ? AND ground_id = ? AND status = 'accepted'", tid, groundId!);
  if (!g) throw bad('groundId', 'That ground has not accepted this tournament');
  if (t.status === 'published' && !reason) throw bad('reason', 'Say why the match moves (everyone can see the change)');
  const problem = slotProblem(g.ground_id, at, t.match_minutes, f.id);
  if (problem) throw conflict('SLOT_TAKEN', problem);
  if (teamBusy(t, [f.team_a_id, f.team_b_id], at, f.id)) throw conflict('TEAM_BUSY', 'One of the teams has another match at that time');
  tx(() => {
    if (f.status === 'confirmed') run('UPDATE net_fixtures SET move_ground_id = ?, move_starts_at = ?, move_reason = ?, updated_at = ? WHERE id = ?', g.ground_id, at, reason ?? null, now(), f.id);
    else run("UPDATE net_fixtures SET ground_id = ?, owner_id = ?, starts_at = ?, status = 'proposed', updated_at = ? WHERE id = ?", g.ground_id, g.owner_id, at, now(), f.id);
    log(f, u, ownerId, f.status === 'confirmed' ? 'move_proposed' : 'proposed', { from: f.starts_at ? { ground: f.ground_id, startsAt: f.starts_at } : null, to: { ground: g.ground_id, startsAt: at } }, reason ?? null);
    touch(tid);
  });
  return netTournamentDetail(u, ownerId, tid);
}

/** The ground's own staff confirm the time: it is checked again and held on their ground (a block, no money). A move gives back the old time only now. */
export function confirmSlot(u: UserRow, ownerId: string, tid: string, fid: string) {
  requireCricketStaff(u);
  const { t } = access(ownerId, tid);
  if (t.status === 'completed' || t.status === 'cancelled') throw conflict('TOURNAMENT_CLOSED', `This tournament is ${t.status}`);
  const f = fxOf(tid, fid);
  const moving = !!f.move_ground_id;
  const groundId = moving ? f.move_ground_id! : f.ground_id, at = moving ? f.move_starts_at! : f.starts_at;
  if (!moving && f.status === 'confirmed') return netTournamentDetail(u, ownerId, tid);
  if (!moving && f.status !== 'proposed') throw conflict('NOTHING_TO_CONFIRM', 'This fixture has no proposed time');
  const g = groundId ? groundRow(groundId) : undefined;
  if (!g || g.owner_id !== ownerId || at === null) throw notFound('Fixture not found');
  if (!one("SELECT 1 FROM net_grounds WHERE tournament_id = ? AND ground_id = ? AND status = 'accepted'", tid, g.id)) throw conflict('NOT_ACCEPTED', 'Accept the invitation for this ground first');
  if (at <= now()) throw conflict('TIME_PASSED', 'That time has already passed. Ask the organiser for a new time.');
  if (f.match_id && moving && g.owner_id !== f.owner_id && one('SELECT 1 FROM match_balls WHERE match_id = ?', f.match_id)) throw conflict('SCORING_STARTED', 'Scoring has started at the other ground');
  tx(() => {
    const problem = slotProblem(g.id, at, t.match_minutes, f.id);
    if (problem) throw conflict('SLOT_TAKEN', problem);
    if (moving) releaseHold(f);
    holdTime(t, { ...f, ground_id: g.id }, g.id, at);
    run("UPDATE net_fixtures SET ground_id = ?, owner_id = ?, starts_at = ?, status = 'confirmed', move_ground_id = NULL, move_starts_at = NULL, move_reason = NULL, updated_at = ? WHERE id = ?", g.id, g.owner_id, at, now(), f.id);
    if (f.match_id) {
      if (moving && g.owner_id !== f.owner_id) run('UPDATE net_fixtures SET match_id = NULL, scorer_id = NULL WHERE id = ?', f.id);
      else run('UPDATE matches SET ground_id = ?, scheduled_for = ?, updated_at = ? WHERE id = ?', g.id, at, now(), f.match_id);
    }
    groundCharge(u, t, { ...f, ground_id: g.id, owner_id: g.owner_id }, moving && f.ground_id !== g.id);
    log(f, u, ownerId, moving ? 'moved' : 'confirmed', { ground: g.id, startsAt: at, from: moving ? { ground: f.ground_id, startsAt: f.starts_at } : undefined }, moving ? f.move_reason : null);
    touch(tid);
    audit(actorOf(u), moving ? 'network.slot_move' : 'network.slot_confirm', 'net_tournament', tid, { fixture: f.id, ground: g.id, startsAt: at }, ownerId);
  });
  return netTournamentDetail(u, ownerId, tid);
}

/** The ground turns a proposed time down (with a reason). A declined move leaves the fixture where it was confirmed. */
export function declineSlot(u: UserRow, ownerId: string, tid: string, fid: string, body: unknown) {
  requireCricketStaff(u);
  access(ownerId, tid);
  const f = fxOf(tid, fid);
  const v = new Validator(body ?? {});
  const reason = v.str('reason', { required: true, max: 300 });
  v.done();
  const moving = !!f.move_ground_id;
  const gid = moving ? f.move_ground_id : f.ground_id;
  if (!gid || groundRow(gid)?.owner_id !== ownerId || (!moving && f.status !== 'proposed')) throw notFound('Fixture not found');
  tx(() => {
    if (moving) run('UPDATE net_fixtures SET move_ground_id = NULL, move_starts_at = NULL, move_reason = NULL, updated_at = ? WHERE id = ?', now(), f.id);
    else run("UPDATE net_fixtures SET status = 'declined', updated_at = ? WHERE id = ?", now(), f.id);
    log(f, u, ownerId, moving ? 'move_declined' : 'declined', { ground: gid }, reason!);
    touch(tid);
    audit(actorOf(u), 'network.slot_decline', 'net_tournament', tid, { fixture: f.id, reason }, ownerId);
  });
  return netTournamentDetail(u, ownerId, tid);
}

/** The agreed charge for a confirmed match on a ground, as a settlement line from the organiser to the host. Recorded once per fixture and ground. */
function groundCharge(u: UserRow, t: TRow, f: FRow, moved: boolean): void {
  const ng = one<GRow>("SELECT * FROM net_grounds WHERE tournament_id = ? AND ground_id = ?", t.id, f.ground_id!);
  const open = many<SRow>("SELECT * FROM net_settlements WHERE fixture_id = ? AND kind = 'ground_charge'", f.id).filter((s) => settlementStatus(s).status === 'agreed');
  if (moved) for (const s of open) run("INSERT INTO net_settlement_events(settlement_id, status, at, actor_id, owner_id, reason) VALUES(?,'cancelled',?,?,?,?)", s.id, now(), u.id, f.owner_id, 'The match moved to another ground');
  if (!ng || ng.charge_per_match_paise <= 0 || f.owner_id === t.organiser_id) return;
  const key = `gc:${f.id}:${f.ground_id}`;
  const existing = one<SRow>('SELECT * FROM net_settlements WHERE idem_key = ?', key);
  if (existing && settlementStatus(existing).status !== 'cancelled') return;
  const id = newId('nst');
  run(`INSERT INTO net_settlements(id, tournament_id, fixture_id, kind, payer_kind, payer_ref, payer_label, payee_kind, payee_ref, payee_label, amount_paise, note, idem_key, created_by, created_at) VALUES(?,?,?,'ground_charge','business',?,?,'business',?,?,?,?,?,?,?)`,
    id, t.id, f.id, t.organiser_id, businessName(t.organiser_id), f.owner_id, businessName(f.owner_id!), ng.charge_per_match_paise, `${groundName(f.ground_id)} for one match, as agreed when the ground accepted`, existing ? `${key}:${now()}` : key, u.id, now());
  run("INSERT INTO net_settlement_events(settlement_id, status, at, actor_id, owner_id) VALUES(?,'agreed',?,?,?)", id, now(), u.id, f.owner_id);
}

export function cancelFixture(u: UserRow, ownerId: string, tid: string, fid: string, body: unknown) {
  organiser(u, ownerId, tid);
  const f = fxOf(tid, fid);
  const v = new Validator(body ?? {});
  const reason = v.str('reason', { required: true, max: 300 });
  v.done();
  if (f.status === 'cancelled') return netTournamentDetail(u, ownerId, tid);
  if (verifiedOf(f.id)) throw conflict('FIXTURE_PLAYED', 'This fixture has a verified result');
  tx(() => {
    releaseHold(f);
    run("UPDATE net_fixtures SET status = 'cancelled', move_ground_id = NULL, move_starts_at = NULL, updated_at = ? WHERE id = ?", now(), f.id);
    for (const s of many<SRow>('SELECT * FROM net_settlements WHERE fixture_id = ?', f.id)) if (settlementStatus(s).status === 'agreed') run("INSERT INTO net_settlement_events(settlement_id, status, at, actor_id, owner_id, reason) VALUES(?,'cancelled',?,?,?,?)", s.id, now(), u.id, ownerId, `Match cancelled: ${reason}`);
    log(f, u, ownerId, 'cancelled', null, reason!);
    touch(tid);
    audit(actorOf(u), 'network.fixture_cancel', 'net_tournament', tid, { fixture: f.id, reason }, ownerId);
  });
  return netTournamentDetail(u, ownerId, tid);
}

export function publishNetTournament(u: UserRow, ownerId: string, tid: string) {
  const t = organiser(u, ownerId, tid);
  if (t.status === 'published') return netTournamentDetail(u, ownerId, tid);
  const fx = liveFixtures(tid);
  if (teamsOf(tid).length < 2 || !fx.length) throw conflict('NOT_READY', 'Add teams and fixtures first');
  const waiting = fx.filter((f) => f.status !== 'confirmed' || f.move_ground_id);
  if (waiting.length) throw conflict('NOT_CONFIRMED', `${waiting.length} fixture${waiting.length === 1 ? ' is' : 's are'} not confirmed by their ground yet`);
  tx(() => {
    run("UPDATE net_tournaments SET status = 'published', published_at = ?, updated_at = ? WHERE id = ?", now(), now(), tid);
    audit(actorOf(u), 'network.tournament_publish', 'net_tournament', tid, { fixtures: fx.length }, ownerId);
  });
  return netTournamentDetail(u, ownerId, tid);
}

/** The organiser cancels the whole tournament: unplayed matches give their time back and unpaid ground charges are cancelled. Paid lines stay as they are. */
export function cancelNetTournament(u: UserRow, ownerId: string, tid: string, body: unknown) {
  const t = organiser(u, ownerId, tid);
  const v = new Validator(body ?? {});
  const reason = v.str('reason', { required: true, max: 300 });
  v.done();
  tx(() => {
    for (const f of liveFixtures(tid)) {
      if (verifiedOf(f.id)) continue;
      releaseHold(f);
      run("UPDATE net_fixtures SET status = 'cancelled', updated_at = ? WHERE id = ?", now(), f.id);
      log(f, u, ownerId, 'cancelled', null, `Tournament cancelled: ${reason}`);
    }
    for (const s of many<SRow>('SELECT * FROM net_settlements WHERE tournament_id = ?', tid)) if (settlementStatus(s).status === 'agreed') run("INSERT INTO net_settlement_events(settlement_id, status, at, actor_id, owner_id, reason) VALUES(?,'cancelled',?,?,?,?)", s.id, now(), u.id, ownerId, `Tournament cancelled: ${reason}`);
    run("UPDATE net_tournaments SET status = 'cancelled', closed_at = ?, closed_by = ?, close_reason = ?, updated_at = ? WHERE id = ?", now(), u.id, reason!, now(), tid);
    audit(actorOf(u), 'network.tournament_cancel', 'net_tournament', tid, { reason }, ownerId);
  });
  return netTournamentDetail(u, ownerId, t.id);
}

export function completeNetTournament(u: UserRow, ownerId: string, tid: string) {
  const t = organiser(u, ownerId, tid);
  if (t.status !== 'published') throw conflict('NOT_PUBLISHED', 'Publish the tournament first');
  const open = liveFixtures(tid).filter((f) => !verifiedOf(f.id));
  if (open.length) throw conflict('RESULTS_OPEN', `${open.length} match${open.length === 1 ? ' has' : 'es have'} no verified result. Verify or cancel ${open.length === 1 ? 'it' : 'them'} first.`);
  tx(() => {
    run("UPDATE net_tournaments SET status = 'completed', closed_at = ?, closed_by = ?, updated_at = ? WHERE id = ?", now(), u.id, now(), tid);
    audit(actorOf(u), 'network.tournament_complete', 'net_tournament', tid, null, ownerId);
  });
  return netTournamentDetail(u, ownerId, tid);
}

// ------------------------------------------------------------------ scoring and results

/** The host ground (or the organiser) names who scores a confirmed match: someone at the host business who can score. */
export function assignScorer(u: UserRow, ownerId: string, tid: string, fid: string, body: unknown) {
  requireCricketStaff(u);
  const { t, role } = access(ownerId, tid);
  const f = fxOf(tid, fid);
  if (f.status !== 'confirmed') throw conflict('NOT_CONFIRMED', 'The ground has not confirmed this match yet');
  if (role !== 'organiser' && f.owner_id !== ownerId) throw notFound('Fixture not found');
  const v = new Validator(body ?? {});
  const scorerId = v.str('scorerId', { required: true, max: 60 });
  v.done();
  const s = one<UserRow>("SELECT * FROM users WHERE id = ? AND active = 1 AND ((role = 'staff' AND owner_id = ?) OR (role = 'owner' AND id = ?))", scorerId!, f.owner_id!, f.owner_id!);
  if (!s || !hasPermission(s, 'manage_matches')) throw bad('scorerId', 'Pick someone at the host ground who can score matches');
  tx(() => {
    run('UPDATE net_fixtures SET scorer_id = ?, updated_at = ? WHERE id = ?', s.id, now(), f.id);
    log(f, u, ownerId, 'scorer', { scorer: s.id });
    audit(actorOf(u), 'network.scorer', 'net_tournament', t.id, { fixture: f.id, scorer: s.id }, ownerId);
  });
  return netTournamentDetail(u, ownerId, tid);
}

const canScore = (u: UserRow, ownerId: string, f: FRow) => f.owner_id === ownerId && (f.scorer_id ? f.scorer_id === u.id || u.role === 'owner' : hasPermission(u, 'manage_matches'));

/** The host opens the ball-by-ball scorer: a match at the host's ground, its squads filled from the teams (profiles linked; children only with consent). */
export function openScoring(u: UserRow, ownerId: string, tid: string, fid: string) {
  requireCricketStaff(u);
  const { t } = access(ownerId, tid);
  const f = fxOf(tid, fid);
  if (!canScore(u, ownerId, f)) throw forbidden('Only the host ground\'s scorer can score this match');
  if (f.status !== 'confirmed' || f.move_ground_id) throw conflict('NOT_CONFIRMED', 'The match time is not confirmed');
  if (t.status !== 'published') throw conflict('NOT_PUBLISHED', 'The organiser has not published the fixtures yet');
  if (f.match_id) return { matchId: f.match_id };
  const teams = new Map(teamsOf(tid).map((x) => [x.id, x]));
  const a = teams.get(f.team_a_id)!, b = teams.get(f.team_b_id)!;
  const id = tx(() => {
    const m = createMatch(actorOf(u), ownerId, { title: `${t.name}: ${a.name} v ${b.name}`.slice(0, 100), teamA: a.name.slice(0, 50), teamB: b.name.slice(0, 50), overs: t.overs, groundId: f.ground_id ?? undefined, scheduledFor: f.starts_at ?? undefined });
    const used = new Set<string>();
    for (const [side, team] of [['a', a], ['b', b]] as const) for (const p of playersOf(team.id)) {
      let shown = p.name;
      if (used.has(nameKey(shown))) shown = `${p.name} (${team.name})`.slice(0, 60);
      used.add(nameKey(shown));
      const link = p.user_id && (!isChild(p.user_id) || consentGiven(p.user_id, 'play_record')) ? p.user_id : null;
      run('INSERT INTO match_players(id, match_id, owner_id, side, name, name_key, user_id, linked_via, linked_by, linked_at, added_by, created_at) VALUES(?,?,?,?,?,?,?,NULL,?,?,?,?)',
        newId('mp'), m.id, ownerId, side, shown, nameKey(shown), link, link ? u.id : null, link ? now() : null, u.id, now());
    }
    run('UPDATE net_fixtures SET match_id = ?, updated_at = ? WHERE id = ?', m.id, now(), f.id);
    log(f, u, ownerId, 'scoring_opened', { match: m.id });
    return m.id;
  });
  return { matchId: id };
}

/** The finished scorer's result (winner, runs, overs faced), worked out the same way as the single-ground tournaments. */
function resultFromMatch(f: FRow) {
  const m = one<{ status: string; result: string | null; overs: number; players_per_side: number; batting_first: 'a' | 'b'; team_a: string; team_b: string }>('SELECT status, result, overs, players_per_side, batting_first, team_a, team_b FROM matches WHERE id = ?', f.match_id!);
  if (!m) throw notFound('Match not found');
  if (m.status !== 'completed') throw conflict('MATCH_NOT_FINISHED', 'The scorer has not finished this match yet');
  const result = m.result ?? '';
  const outcome = (/tied/i.test(result) ? 'tie' : result.startsWith(`${m.team_a} won`) ? 'team_a' : result.startsWith(`${m.team_b} won`) ? 'team_b' : 'no_result') as RRow['outcome'];
  const side = (innings: number) => {
    const balls = many<{ runs_bat: number; extra_runs: number; extra_type: string | null; wicket: number; wicket_kind: string | null }>('SELECT runs_bat, extra_runs, extra_type, wicket, wicket_kind FROM match_balls WHERE match_id = ? AND innings = ?', f.match_id!, innings);
    let runs = 0, legal = 0, wk = 0;
    for (const x of balls) { runs += x.runs_bat + x.extra_runs; if (x.extra_type !== 'wide' && x.extra_type !== 'noball') legal++; if (x.wicket && x.wicket_kind !== 'retired') wk++; }
    return { runs, balls: wk >= m.players_per_side - 1 ? m.overs * 6 : legal };
  };
  const first = side(1), second = side(2);
  const [aI, bI] = m.batting_first === 'a' ? [first, second] : [second, first];
  return outcome === 'no_result' ? { outcome, text: result || 'No result', ar: null, ab: null, br: null, bb: null } : { outcome, text: result || null, ar: aI.runs, ab: aI.balls, br: bI.runs, bb: bI.balls };
}

/** The scorer sends the result for verification (from the scored match, or typed). A change after a verified result is a correction and needs a reason. */
export function submitResult(u: UserRow, ownerId: string, tid: string, fid: string, body: unknown) {
  requireCricketStaff(u);
  const { t } = access(ownerId, tid);
  if (t.status !== 'published') throw conflict('NOT_PUBLISHED', 'Results can be sent once the fixtures are published');
  const f = fxOf(tid, fid);
  if (!canScore(u, ownerId, f)) throw forbidden('Only the host ground\'s scorer can send this result');
  if (f.status !== 'confirmed') throw conflict('NOT_CONFIRMED', 'This match is not confirmed');
  const v = new Validator(body ?? {});
  const fromMatch = v.bool('fromMatch') ?? false;
  const outcomeIn = v.oneOf('outcome', OUTCOMES);
  const text = v.str('resultText', { max: 200 });
  const aRuns = v.int('aRuns', { min: 0, max: 5000 }), bRuns = v.int('bRuns', { min: 0, max: 5000 });
  const aBalls = oversToBalls(v.src.aOvers), bBalls = oversToBalls(v.src.bOvers);
  if (aBalls === undefined) v.fail('aOvers', 'Use overs like 12.3');
  if (bBalls === undefined) v.fail('bOvers', 'Use overs like 12.3');
  const reason = v.str('reason', { max: 300 });
  v.done();
  let r: { outcome: RRow['outcome']; text: string | null; ar: number | null; ab: number | null; br: number | null; bb: number | null };
  if (fromMatch) { if (!f.match_id) throw conflict('NO_MATCH', 'Open the scorer for this match first'); r = resultFromMatch(f); }
  else {
    if (!outcomeIn) throw bad('outcome', 'Pick the result');
    r = { outcome: outcomeIn, text: text ?? null, ar: aRuns ?? null, ab: aBalls ?? null, br: bRuns ?? null, bb: bBalls ?? null };
    if (r.outcome === 'no_result') r.ar = r.ab = r.br = r.bb = null;
  }
  const names = new Map(teamsOf(tid).map((x) => [x.id, x.name]));
  const winner = r.outcome === 'team_a' ? f.team_a_id : r.outcome === 'team_b' ? f.team_b_id : null;
  r.text = r.text || (r.outcome === 'tie' ? 'Match tied' : r.outcome === 'no_result' ? 'No result' : `${names.get(winner!)} won`);
  const verified = verifiedOf(f.id);
  if (verified && !reason) throw bad('reason', 'This match already has a verified result. Say why it is being corrected.');
  const version = (one<{ v: number | null }>('SELECT MAX(version) v FROM net_results WHERE fixture_id = ?', f.id)!.v ?? 0) + 1;
  const id = newId('nrs');
  tx(() => {
    run('UPDATE net_results SET superseded_at = ? WHERE fixture_id = ? AND verified_at IS NULL AND rejected_at IS NULL AND superseded_at IS NULL', now(), f.id);
    run(`INSERT INTO net_results(id, fixture_id, tournament_id, version, outcome, winner_team_id, a_runs, a_balls, b_runs, b_balls, result_text, from_match, submitted_by, submitted_owner, submitted_at, reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, f.id, tid, version, r.outcome, winner, r.ar, r.ab, r.br, r.bb, r.text, fromMatch ? 1 : 0, u.id, ownerId, now(), reason ?? null);
    log(f, u, ownerId, verified ? 'correction_sent' : 'result_sent', { version, outcome: r.outcome }, reason ?? null);
    audit(actorOf(u), 'network.result_submit', 'net_tournament', tid, { fixture: f.id, version, correction: !!verified }, ownerId);
  });
  return netTournamentDetail(u, ownerId, tid);
}

/** The organiser verifies (or rejects, with a reason) the waiting result. Nobody verifies a result they sent themselves. */
export function verifyResult(u: UserRow, ownerId: string, tid: string, fid: string, body: unknown) {
  organiser(u, ownerId, tid);
  const f = fxOf(tid, fid);
  const v = new Validator(body ?? {});
  const approve = v.bool('approve', true);
  const reason = v.str('reason', { max: 300 });
  v.done();
  const p = pendingOf(f.id);
  if (!p) throw conflict('NOTHING_TO_VERIFY', 'No result is waiting for this match');
  if (p.submitted_by === u.id) throw forbidden('Someone else must verify a result you sent');
  if (!approve && !reason) throw bad('reason', 'Say what is wrong, so the scorer can correct it');
  tx(() => {
    if (approve) {
      run('UPDATE net_results SET superseded_at = ? WHERE fixture_id = ? AND verified_at IS NOT NULL AND superseded_at IS NULL', now(), f.id);
      run('UPDATE net_results SET verified_by = ?, verified_at = ? WHERE id = ?', u.id, now(), p.id);
    } else run('UPDATE net_results SET rejected_by = ?, rejected_at = ?, reject_reason = ? WHERE id = ?', u.id, now(), reason!, p.id);
    log(f, u, ownerId, approve ? 'result_verified' : 'result_rejected', { version: p.version }, reason ?? null);
    audit(actorOf(u), approve ? 'network.result_verify' : 'network.result_reject', 'net_tournament', tid, { fixture: f.id, version: p.version }, ownerId);
  });
  return netTournamentDetail(u, ownerId, tid);
}

export function fixtureResults(u: UserRow, ownerId: string, tid: string, fid: string) {
  requireCricketStaff(u);
  access(ownerId, tid);
  const f = fxOf(tid, fid);
  const names = new Map(teamsOf(tid).map((x) => [x.id, x.name]));
  return { versions: resultsOf(f.id).map((r) => resultOut(r, names)), history: many<any>('SELECT * FROM net_fixture_log WHERE fixture_id = ? ORDER BY id', f.id).map((h) => ({ at: h.at, by: userName(h.actor_id), kind: h.kind, detail: h.detail ? JSON.parse(h.detail) : null, reason: h.reason })) };
}

// ------------------------------------------------------------------ settlements

function party(t: TRow, src: unknown, field: string): { kind: (typeof PARTY_KINDS)[number]; ref: string | null; label: string } {
  if (!src || typeof src !== 'object') throw bad(field, 'Say who');
  const v = new Validator(src);
  const kind = v.oneOf('kind', PARTY_KINDS, true);
  const ref = v.str('ref', { max: 60 }), label = v.str('label', { max: 80 });
  for (const x of v.fields) throw bad(`${field}.${x.field}`, x.message);
  if (kind === 'business') {
    const ok = ref === t.organiser_id || !!one("SELECT 1 FROM net_grounds WHERE tournament_id = ? AND owner_id = ? AND status IN ('accepted','invited')", t.id, ref ?? '');
    if (!ok) throw bad(`${field}.ref`, 'Pick the organiser or a business whose ground is in this tournament');
    return { kind, ref: ref!, label: businessName(ref!) };
  }
  if (kind === 'team') {
    const team = one<TeamRow>('SELECT * FROM net_teams WHERE id = ? AND tournament_id = ? AND removed_at IS NULL', ref ?? '', t.id);
    if (!team) throw bad(`${field}.ref`, 'Pick a team of this tournament');
    return { kind, ref: team.id, label: team.name };
  }
  if (!label) throw bad(`${field}.label`, 'Name who it is');
  return { kind: 'other', ref: null, label };
}

/** The organiser records an agreed amount between two named parties (an entry fee, a prize, a charge). A retry with the same key adds nothing. */
export function addSettlement(u: UserRow, ownerId: string, tid: string, body: unknown) {
  const t = organiser(u, ownerId, tid, false);
  const v = new Validator(body ?? {});
  const kind = v.oneOf('kind', SETTLEMENT_KINDS, true);
  const amount = v.int('amountPaise', { required: true, min: 1, max: MAX_AMOUNT_PAISE });
  const note = v.str('note', { max: 300 });
  const key = v.str('clientKey', { max: 80 });
  const fixtureId = v.str('fixtureId', { max: 60 });
  v.done();
  const payer = party(t, v.src.payer, 'payer'), payee = party(t, v.src.payee, 'payee');
  if (payer.kind === payee.kind && payer.ref === payee.ref && payer.label === payee.label) throw bad('payee', 'The payer and the payee are the same');
  if (fixtureId) fxOf(tid, fixtureId);
  const idem = key ? `ck:${tid}:${key}` : null;
  const again = idem ? one<SRow>('SELECT * FROM net_settlements WHERE idem_key = ?', idem) : undefined;
  if (again) {
    if (again.amount_paise !== amount || again.kind !== kind || again.payer_label !== payer.label || again.payee_label !== payee.label) throw conflict('IDEMPOTENCY_MISMATCH', 'This key was already used for a different line');
    return settlementOut(again, ownerId, new Map(teamsOf(tid).map((x) => [x.id, x.name])));
  }
  const id = newId('nst');
  tx(() => {
    run(`INSERT INTO net_settlements(id, tournament_id, fixture_id, kind, payer_kind, payer_ref, payer_label, payee_kind, payee_ref, payee_label, amount_paise, note, idem_key, created_by, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, tid, fixtureId ?? null, kind!, payer.kind, payer.ref, payer.label, payee.kind, payee.ref, payee.label, amount!, note ?? null, idem, u.id, now());
    run("INSERT INTO net_settlement_events(settlement_id, status, at, actor_id, owner_id) VALUES(?,'agreed',?,?,?)", id, now(), u.id, ownerId);
    audit(actorOf(u), 'network.settlement_add', 'net_tournament', tid, { settlement: id, kind, amountPaise: amount }, ownerId);
  });
  return settlementOut(one<SRow>('SELECT * FROM net_settlements WHERE id = ?', id)!, ownerId, new Map(teamsOf(tid).map((x) => [x.id, x.name])));
}

/**
 * Marks a line paid, with the payment reference. The business that receives the money says so; for a team or an outside party it is
 * the organiser. Saying it again with the same reference changes nothing; a different reference is refused.
 */
export function markSettlementPaid(u: UserRow, ownerId: string, tid: string, sid: string, body: unknown) {
  requireCricketStaff(u);
  const { t } = access(ownerId, tid);
  const s = one<SRow>('SELECT * FROM net_settlements WHERE id = ? AND tournament_id = ?', sid, tid);
  if (!s || !visibleSettlements(t, ownerId).some((x) => x.id === s.id)) throw notFound('Settlement not found');
  const v = new Validator(body ?? {});
  const ref = v.str('ref', { required: true, max: 120 });
  v.done();
  const receiver = s.payee_kind === 'business' ? s.payee_ref : t.organiser_id;
  if (receiver !== ownerId) throw forbidden('The one who receives the money marks it paid');
  const st = settlementStatus(s);
  if (st.status === 'cancelled') throw conflict('CANCELLED', 'This line is cancelled');
  if (st.status === 'paid') {
    const last = st.history[st.history.length - 1]!;
    if (last.ref !== ref) throw conflict('ALREADY_PAID', `Already marked paid with reference ${last.ref}`);
    return settlementOut(s, ownerId, new Map(teamsOf(tid).map((x) => [x.id, x.name])));
  }
  tx(() => {
    run("INSERT INTO net_settlement_events(settlement_id, status, at, actor_id, owner_id, ref) VALUES(?,'paid',?,?,?,?)", s.id, now(), u.id, ownerId, ref!);
    audit(actorOf(u), 'network.settlement_paid', 'net_tournament', tid, { settlement: s.id, amountPaise: s.amount_paise }, ownerId);
  });
  return settlementOut(s, ownerId, new Map(teamsOf(tid).map((x) => [x.id, x.name])));
}

/** The organiser cancels an unpaid line, with a reason. The line and its history stay. */
export function cancelSettlement(u: UserRow, ownerId: string, tid: string, sid: string, body: unknown) {
  organiser(u, ownerId, tid, false);
  const s = one<SRow>('SELECT * FROM net_settlements WHERE id = ? AND tournament_id = ?', sid, tid);
  if (!s) throw notFound('Settlement not found');
  const v = new Validator(body ?? {});
  const reason = v.str('reason', { required: true, max: 300 });
  v.done();
  const st = settlementStatus(s);
  if (st.status === 'paid') throw conflict('ALREADY_PAID', 'This line is paid. Record a new line the other way if money goes back.');
  if (st.status === 'agreed') tx(() => {
    run("INSERT INTO net_settlement_events(settlement_id, status, at, actor_id, owner_id, reason) VALUES(?,'cancelled',?,?,?,?)", s.id, now(), u.id, ownerId, reason!);
    audit(actorOf(u), 'network.settlement_cancel', 'net_tournament', tid, { settlement: s.id, reason }, ownerId);
  });
  return settlementOut(s, ownerId, new Map(teamsOf(tid).map((x) => [x.id, x.name])));
}

// ------------------------------------------------------------------ for Platform AI

/** The facts Platform AI may give staff about the network: counts, names of tournaments and grounds, money owed by and to this business. No players or contact details. */
export function networkFacts(u: UserRow, ownerId: string) {
  requireCricketStaff(u);
  const list = listNetTournaments(u, ownerId).items;
  let toReceive = 0, toPay = 0, received = 0, paid = 0;
  for (const s of list) {
    const t = tRow(s.id)!;
    const rows = visibleSettlements(t, ownerId).map((x) => settlementOut(x, ownerId, new Map()));
    const tot = settlementTotals(rows);
    toReceive += tot.toReceivePaise; toPay += tot.toPayPaise; received += tot.receivedPaise; paid += tot.paidPaise;
  }
  const claims = one<{ n: number }>("SELECT COUNT(*) n FROM profile_claims WHERE owner_id = ? AND closed_at IS NULL AND staff_ok_at IS NULL", ownerId)!.n;
  return {
    member: isMember(ownerId), members: one<{ n: number }>('SELECT COUNT(*) n FROM network_members WHERE left_at IS NULL')!.n,
    tournaments: list.map((x) => ({ name: x.name, organiser: x.organiser, myRole: x.myRole, status: x.status, from: x.startDate, to: x.endDate, teams: x.teams, grounds: x.grounds, fixtures: x.fixtures, confirmed: x.confirmed, verified: x.verified, invitationsForMe: x.invitationsForMe, slotsWaitingForMe: x.slotsForMe, resultsToVerify: x.resultsToVerify })),
    invitationsWaiting: list.reduce((n, x) => n + x.invitationsForMe, 0), slotsWaiting: list.reduce((n, x) => n + x.slotsForMe, 0), resultsToVerify: list.reduce((n, x) => n + x.resultsToVerify, 0),
    settlements: { toReceivePaise: toReceive, receivedPaise: received, toPayPaise: toPay, paidPaise: paid, note: BOOKS_NOTE },
    profileClaimsWaiting: claims,
  };
}
