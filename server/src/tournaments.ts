import { many, one, registerSchema, run, tx } from './db.ts';
import { now } from './clock.ts';
import { audit, type Actor } from './audit.ts';
import { HttpError, conflict, notFound } from './errors.ts';
import { newId } from './ids.ts';
import { Validator } from './input.ts';
import { addDays, istDate, istMidnight, minutesOf, MIN } from './time.ts';
import { blockRange, groundRow } from './grounds.ts';
import { createMatch } from './matches.ts';
import { blockOf } from './bookings.ts';
import { createStaffBlock, findOrCreateCustomer } from './hold.ts';
import type { UserRow } from './auth.ts';
import { postToLedger, removeFromLedger } from './accounting/autopost.ts';

// Tournaments: teams with entry fees, fixtures (round robin can be generated), results and a points table worked out from the results.
// A fixture can be handed to the match-day scorer (matches.ts): the scorer's finished result is copied back, nothing is typed twice.

registerSchema('tournaments-1', `
CREATE TABLE tournaments (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  format TEXT NOT NULL,
  overs INTEGER NOT NULL DEFAULT 20,
  entry_fee_paise INTEGER NOT NULL DEFAULT 0,
  points_win INTEGER NOT NULL DEFAULT 2,
  points_tie INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
  notes TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  deleted_at INTEGER,
  deleted_by TEXT
);
CREATE INDEX ix_tournaments_owner ON tournaments(owner_id, start_date);

CREATE TABLE tournament_teams (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  captain TEXT,
  phone TEXT,
  fee_paid INTEGER NOT NULL DEFAULT 0,
  payment_ref TEXT,
  paid_at INTEGER,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  deleted_at INTEGER,
  deleted_by TEXT
);
CREATE INDEX ix_tournament_teams_t ON tournament_teams(tournament_id);

CREATE TABLE tournament_fixtures (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  round INTEGER NOT NULL DEFAULT 1,
  team_a_id TEXT NOT NULL REFERENCES tournament_teams(id),
  team_b_id TEXT NOT NULL REFERENCES tournament_teams(id),
  starts_at INTEGER,
  ground_id TEXT REFERENCES grounds(id),
  outcome TEXT,
  winner_team_id TEXT REFERENCES tournament_teams(id),
  result_text TEXT,
  a_runs INTEGER,
  a_balls INTEGER,
  b_runs INTEGER,
  b_balls INTEGER,
  match_id TEXT REFERENCES matches(id),
  created_at INTEGER NOT NULL,
  created_by TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  deleted_at INTEGER,
  deleted_by TEXT
);
CREATE INDEX ix_tournament_fixtures_t ON tournament_fixtures(tournament_id, round);
`);

export const FORMATS = ['round_robin', 'knockout', 'league_knockout', 'other'] as const;
export const STATUSES = ['draft', 'open', 'running', 'completed', 'cancelled'] as const;
registerSchema('tournaments-3', `
ALTER TABLE tournaments ADD COLUMN series_id TEXT;
ALTER TABLE tournaments ADD COLUMN customer_id TEXT;
ALTER TABLE tournaments ADD COLUMN organiser_first TEXT;
ALTER TABLE tournaments ADD COLUMN organiser_last TEXT;
ALTER TABLE tournaments ADD COLUMN organiser_phone TEXT;
ALTER TABLE tournaments ADD COLUMN organiser_email TEXT;
CREATE INDEX ix_tournaments_series ON tournaments(series_id);
`);
registerSchema('tournaments-2', `ALTER TABLE tournament_teams ADD COLUMN ledger_txn_id TEXT;`);
// A scheduled fixture holds its time on the ground as a block (booking_slots kind 'block', no money), so customers cannot book it.
// block_until is the end of that hold and block_note the note it was written with: only those slots are released again.
registerSchema('tournament-fixture-blocks-1', `ALTER TABLE tournament_fixtures ADD COLUMN block_until INTEGER;
ALTER TABLE tournament_fixtures ADD COLUMN block_note TEXT;`);

const OUTCOMES = ['team_a', 'team_b', 'tie', 'no_result'] as const;
const MAX_TEAMS = 32;

interface TRow { id: string; owner_id: string; name: string; start_date: string; end_date: string; format: string; overs: number; entry_fee_paise: number; points_win: number; points_tie: number; status: string; notes: string | null; created_at: number; series_id: string | null; customer_id: string | null; organiser_first: string | null; organiser_last: string | null; organiser_phone: string | null; organiser_email: string | null }
interface TeamRow { id: string; tournament_id: string; name: string; captain: string | null; phone: string | null; fee_paid: number; payment_ref: string | null; paid_at: number | null; ledger_txn_id: string | null }
interface FxRow { id: string; tournament_id: string; round: number; team_a_id: string; team_b_id: string; starts_at: number | null; ground_id: string | null; block_until?: number | null; block_note?: string | null; outcome: string | null; winner_team_id: string | null; result_text: string | null; a_runs: number | null; a_balls: number | null; b_runs: number | null; b_balls: number | null; match_id: string | null }

const bad = (field: string, message: string) => new HttpError(400, 'VALIDATION_FAILED', message, { fields: [{ field, message }] });
const own = (ownerId: string, id: string): TRow => {
  const t = one<TRow>('SELECT * FROM tournaments WHERE id = ? AND owner_id = ? AND deleted_at IS NULL', id, ownerId);
  if (!t) throw notFound('Tournament not found');
  return t;
};
const teamsOf = (tid: string): TeamRow[] => many<TeamRow>('SELECT * FROM tournament_teams WHERE tournament_id = ? AND deleted_at IS NULL ORDER BY created_at, id', tid);
const fixturesOf = (tid: string): FxRow[] => many<FxRow>('SELECT * FROM tournament_fixtures WHERE tournament_id = ? AND deleted_at IS NULL ORDER BY round, COALESCE(starts_at, 9e15), created_at, id', tid);

/** "12.3" overs -> 75 balls. Accepts a number or text; returns null when empty, undefined when it is not valid. */
export function oversToBalls(raw: unknown): number | null | undefined {
  if (raw === null || raw === undefined || raw === '') return null;
  const s = String(raw).trim();
  const m = /^(\d{1,3})(?:\.([0-5]))?$/.exec(s);
  if (!m) return undefined;
  return Number(m[1]) * 6 + Number(m[2] ?? 0);
}
export const ballsToOvers = (b: number | null): string | null => (b === null ? null : `${Math.floor(b / 6)}.${b % 6}`);

// ------------------------------------------------------------------ output

export interface TeamOut { id: string; name: string; captain: string | null; phone: string | null; feePaid: boolean; paymentRef: string | null; paidAt: number | null; ledgerTxnId: string | null }
const toTeam = (r: TeamRow): TeamOut => ({ id: r.id, name: r.name, captain: r.captain, phone: r.phone, feePaid: !!r.fee_paid, paymentRef: r.payment_ref, paidAt: r.paid_at, ledgerTxnId: r.ledger_txn_id });

export interface FixtureOut {
  id: string; round: number; teamAId: string; teamBId: string; teamA: string; teamB: string; startsAt: number | null; groundId: string | null; groundName: string | null;
  played: boolean; outcome: string | null; winnerTeamId: string | null; winner: string | null; resultText: string | null;
  aRuns: number | null; aOvers: string | null; bRuns: number | null; bOvers: string | null; matchId: string | null; matchStatus: string | null;
  /** The end of the time this fixture holds on the ground (customers cannot book it); null when it holds none. */
  blockedUntil: number | null;
}

export interface TableRow { teamId: string; team: string; played: number; won: number; lost: number; tied: number; noResult: number; points: number; nrr: number | null }

export interface FeeStats { teams: number; paidTeams: number; unpaidTeams: number; expectedPaise: number; collectedPaise: number; pendingPaise: number }

function toFixtures(rows: FxRow[], teams: TeamRow[], ownerId: string): FixtureOut[] {
  const name = new Map(teams.map((t) => [t.id, t.name]));
  const grounds = new Map(many<{ id: string; name: string }>('SELECT id, name FROM grounds WHERE owner_id = ?', ownerId).map((g) => [g.id, g.name]));
  const mstat = new Map(many<{ id: string; status: string }>('SELECT id, status FROM matches WHERE owner_id = ?', ownerId).map((m) => [m.id, m.status]));
  return rows.map((f) => ({
    id: f.id, round: f.round, teamAId: f.team_a_id, teamBId: f.team_b_id, teamA: name.get(f.team_a_id) ?? '?', teamB: name.get(f.team_b_id) ?? '?',
    startsAt: f.starts_at, groundId: f.ground_id, groundName: f.ground_id ? grounds.get(f.ground_id) ?? null : null,
    played: f.outcome !== null, outcome: f.outcome, winnerTeamId: f.winner_team_id, winner: f.winner_team_id ? name.get(f.winner_team_id) ?? null : null, resultText: f.result_text,
    aRuns: f.a_runs, aOvers: ballsToOvers(f.a_balls), bRuns: f.b_runs, bOvers: ballsToOvers(f.b_balls), matchId: f.match_id, matchStatus: f.match_id ? mstat.get(f.match_id) ?? null : null,
    blockedUntil: f.block_until ?? null,
  }));
}

/** Points table from the results. NRR is only worked out for teams whose played fixtures all carry runs and overs. */
export function pointsTable(t: Pick<TRow, 'points_win' | 'points_tie'>, teams: TeamRow[], fixtures: FxRow[]): TableRow[] {
  const acc = new Map(teams.map((x) => [x.id, { teamId: x.id, team: x.name, played: 0, won: 0, lost: 0, tied: 0, noResult: 0, points: 0, runsFor: 0, ballsFor: 0, runsAgainst: 0, ballsAgainst: 0, nrrOk: true }]));
  for (const f of fixtures) {
    if (!f.outcome) continue;
    const a = acc.get(f.team_a_id), b = acc.get(f.team_b_id);
    if (!a || !b) continue;
    a.played++; b.played++;
    if (f.outcome === 'no_result') { a.noResult++; b.noResult++; a.points += t.points_tie; b.points += t.points_tie; continue; }
    if (f.outcome === 'tie') { a.tied++; b.tied++; a.points += t.points_tie; b.points += t.points_tie; }
    else { const w = f.outcome === 'team_a' ? a : b, l = f.outcome === 'team_a' ? b : a; w.won++; l.lost++; w.points += t.points_win; }
    if (f.a_runs !== null && f.a_balls && f.b_runs !== null && f.b_balls) {
      a.runsFor += f.a_runs; a.ballsFor += f.a_balls; a.runsAgainst += f.b_runs; a.ballsAgainst += f.b_balls;
      b.runsFor += f.b_runs; b.ballsFor += f.b_balls; b.runsAgainst += f.a_runs; b.ballsAgainst += f.a_balls;
    } else { a.nrrOk = false; b.nrrOk = false; }
  }
  const rows: TableRow[] = [...acc.values()].map((x) => ({
    teamId: x.teamId, team: x.team, played: x.played, won: x.won, lost: x.lost, tied: x.tied, noResult: x.noResult, points: x.points,
    nrr: x.nrrOk && x.ballsFor > 0 && x.ballsAgainst > 0 ? Math.round(((x.runsFor / (x.ballsFor / 6)) - (x.runsAgainst / (x.ballsAgainst / 6))) * 1000) / 1000 : null,
  }));
  rows.sort((p, q) => q.points - p.points || q.won - p.won || (q.nrr ?? -99) - (p.nrr ?? -99) || p.team.localeCompare(q.team));
  return rows;
}

export function feeStats(t: Pick<TRow, 'entry_fee_paise'>, teams: TeamRow[]): FeeStats {
  const paid = teams.filter((x) => x.fee_paid).length;
  const expected = teams.length * t.entry_fee_paise, collected = paid * t.entry_fee_paise;
  return { teams: teams.length, paidTeams: paid, unpaidTeams: teams.length - paid, expectedPaise: expected, collectedPaise: collected, pendingPaise: expected - collected };
}

export interface TournamentOut { id: string; name: string; startDate: string; endDate: string; format: string; overs: number; entryFeePaise: number; pointsWin: number; pointsTie: number; status: string; notes: string | null; teamCount: number; fixtureCount: number; playedCount: number; fees: FeeStats;
  /** Who runs it. Matched to a customer, so their bookings and the tournament are linked. */
  organiser: { firstName: string; lastName: string; phone: string | null; email: string | null; customerId: string | null };
  /** The ground booking made for it (a multi-day booking), if there is one. */
  booking: { seriesId: string; firstBookingId: string | null; groundName: string | null; fromDate: string; toDate: string; totalPaise: number; paidPaise: number; balancePaise: number; cancelled: boolean } | null }
function bookingOf(t: TRow): TournamentOut['booking'] {
  if (!t.series_id) return null;
  const k = blockOf(t.series_id, false);
  if (!k) return null;
  const s = one<{ first_booking_id: string | null; name: string | null }>('SELECT s.first_booking_id, g.name FROM booking_series s LEFT JOIN grounds g ON g.id = s.ground_id WHERE s.id = ?', t.series_id);
  return { seriesId: t.series_id, firstBookingId: s?.first_booking_id ?? null, groundName: s?.name ?? null, fromDate: k.fromDate, toDate: k.toDate, totalPaise: k.totalPaise, paidPaise: k.paidPaise, balancePaise: k.balancePaise, cancelled: k.cancelled };
}
function toTournament(t: TRow): TournamentOut {
  const teams = teamsOf(t.id), fx = fixturesOf(t.id);
  return { id: t.id, name: t.name, startDate: t.start_date, endDate: t.end_date, format: t.format, overs: t.overs, entryFeePaise: t.entry_fee_paise, pointsWin: t.points_win, pointsTie: t.points_tie, status: t.status, notes: t.notes,
    teamCount: teams.length, fixtureCount: fx.length, playedCount: fx.filter((f) => f.outcome).length, fees: feeStats(t, teams),
    organiser: { firstName: t.organiser_first ?? '', lastName: t.organiser_last ?? '', phone: t.organiser_phone, email: t.organiser_email, customerId: t.customer_id }, booking: bookingOf(t) };
}

export function listTournaments(ownerId: string): { items: TournamentOut[]; grounds: { id: string; name: string }[] } {
  const items = many<TRow>('SELECT * FROM tournaments WHERE owner_id = ? AND deleted_at IS NULL ORDER BY start_date DESC, created_at DESC', ownerId).map(toTournament);
  return { items, grounds: many<{ id: string; name: string }>('SELECT id, name FROM grounds WHERE owner_id = ? ORDER BY name', ownerId) };
}

export function tournamentDetail(ownerId: string, id: string) {
  const t = own(ownerId, id); const teams = teamsOf(id), fx = fixturesOf(id);
  return { tournament: toTournament(t), teams: teams.map(toTeam), fixtures: toFixtures(fx, teams, ownerId), table: pointsTable(t, teams, fx), fees: feeStats(t, teams), grounds: many<{ id: string; name: string }>('SELECT id, name FROM grounds WHERE owner_id = ? ORDER BY name', ownerId) };
}

// ------------------------------------------------------------------ tournaments

export interface Organiser { first: string; last: string; phone: string | null; email: string | null }
function parseOrganiser(src: any, required: boolean): Organiser | null {
  const o = src?.organiser;
  if (!o || typeof o !== 'object') { if (required) throw bad('organiser', 'Enter the organiser\'s first and last name and phone'); return null; }
  const v = new Validator(o);
  const first = v.str('firstName', { required, min: 1, max: 40 }), last = v.str('lastName', { max: 40 }), phone = v.phone('phone', required), email = v.email('email');
  for (const f of v.fields) throw new HttpError(400, 'VALIDATION_FAILED', f.message, { fields: [{ field: `organiser.${f.field}`, message: f.message }] });
  if (!first && !phone && !email && !last) return null;
  return { first: first ?? '', last: last ?? '', phone: phone ?? null, email: email ?? null };
}

/** The tournament row, with its organiser matched to (or made as) a customer so both sides point at the same person. */
export function insertTournament(actor: Actor, ownerId: string, f: { name: string; startDate: string; endDate: string; format: string; overs: number; fee: number; pw: number; pt: number; status: string; notes: string | null; seriesId?: string | null; org: Organiser | null; customerId?: string | null }): string {
  const id = newId('trn');
  let customerId = f.customerId ?? null;
  if (!customerId && f.org?.phone && f.org.first) customerId = findOrCreateCustomer({ name: `${f.org.first} ${f.org.last}`.trim(), firstName: f.org.first, lastName: f.org.last, phone: f.org.phone, email: f.org.email ?? undefined }).id;
  run(`INSERT INTO tournaments(id, owner_id, name, start_date, end_date, format, overs, entry_fee_paise, points_win, points_tie, status, notes, series_id, customer_id, organiser_first, organiser_last, organiser_phone, organiser_email, created_at, created_by, updated_at, updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, ownerId, f.name, f.startDate, f.endDate, f.format, f.overs, f.fee, f.pw, f.pt, f.status, f.notes, f.seriesId ?? null, customerId, f.org?.first ?? null, f.org?.last ?? null, f.org?.phone ?? null, f.org?.email ?? null, now(), actor.id, now(), actor.id);
  audit(actor, 'tournament.create', 'tournament', id, { name: f.name, seriesId: f.seriesId ?? null }, ownerId);
  return id;
}

/**
 * Creates a tournament. With a `booking` the ground is reserved at the same time as a multi-day booking for the tournament's dates,
 * and the two are linked: the tournament shows the booking and the booking shows the tournament.
 */
export function createTournament(actor: Actor, ownerId: string, src: unknown, staff?: UserRow): TournamentOut {
  return tx(() => createTournamentIn(actor, ownerId, src, staff));
}
function createTournamentIn(actor: Actor, ownerId: string, src: unknown, staff?: UserRow): TournamentOut {
  const v = new Validator(src);
  const name = v.str('name', { required: true, min: 3, max: 100 });
  const startDate = v.date('startDate', true), endDate = v.date('endDate', true);
  const format = v.oneOf('format', FORMATS) ?? 'round_robin';
  const overs = v.int('overs', { min: 1, max: 50 }) ?? 20;
  const fee = v.int('entryFeePaise', { min: 0, max: 100_000_000 }) ?? 0;
  const pw = v.int('pointsWin', { min: 0, max: 10 }) ?? 2, pt = v.int('pointsTie', { min: 0, max: 10 }) ?? 1;
  const status = v.oneOf('status', STATUSES) ?? 'draft';
  const notes = v.str('notes', { max: 1000 });
  v.done();
  if (endDate! < startDate!) throw bad('endDate', 'The end date cannot be before the start date');
  const bk = (src as any)?.booking;
  const org = parseOrganiser(src, !!bk);
  let seriesId: string | null = null, customerId: string | null = null;
  if (bk && typeof bk === 'object') {
    if (!staff) throw new HttpError(403, 'FORBIDDEN', 'Not allowed');
    const bv = new Validator(bk);
    const groundId = bv.str('groundId', { required: true }), startTime = bv.time('startTime', true), endTime = bv.time('endTime', true);
    const totalPaise = bv.int('totalPaise', { required: true, min: 100, max: 100_000_000_00 });
    const pay = bk.payment, pv = new Validator(pay && typeof pay === 'object' ? pay : {});
    const method = pv.oneOf('method', ['cash', 'card', 'upi', 'bank_transfer'] as const, true), amountPaise = pv.int('amountPaise', { required: true, min: 0 }), reference = pv.str('reference', { max: 60 });
    for (const f of [...bv.fields, ...pv.fields.map((x) => ({ ...x, field: `payment.${x.field}` }))]) throw new HttpError(400, 'VALIDATION_FAILED', f.message, { fields: [{ field: `booking.${f.field}`, message: f.message }] });
    const out = createStaffBlock(staff, {
      groundId: groundId!, fromDate: startDate!, toDate: endDate!, startTime: startTime!, endTime: endTime!, totalPaise: totalPaise!,
      customer: { name: `${org!.first} ${org!.last}`.trim(), firstName: org!.first, lastName: org!.last, phone: org!.phone!, ...(org!.email ? { email: org!.email } : {}) },
      payment: { method: method!, amountPaise: amountPaise!, reference }, notes: `Tournament: ${name}`,
    });
    seriesId = out.series.id;
    customerId = out.bookings[0]!.customerId ?? null;
  }
  const id = insertTournament(actor, ownerId, { name: name!, startDate: startDate!, endDate: endDate!, format, overs, fee, pw, pt, status, notes: notes ?? null, seriesId, org, customerId });
  return toTournament(own(ownerId, id));
}

/** A multi-day booking that was made first and is now marked as a tournament: the tournament is created and linked to it. */
export function tournamentForBlock(actor: Actor, ownerId: string, seriesId: string, src: unknown, org: Organiser | null, customerId: string | null): TournamentOut {
  const v = new Validator(src);
  const name = v.str('name', { required: true, min: 3, max: 100 });
  const format = v.oneOf('format', FORMATS) ?? 'round_robin';
  const overs = v.int('overs', { min: 1, max: 50 }) ?? 20;
  const fee = v.int('entryFeePaise', { min: 0, max: 100_000_000 }) ?? 0;
  v.done();
  const k = blockOf(seriesId, false);
  if (!k) throw notFound('Multi-day booking not found');
  const id = insertTournament(actor, ownerId, { name: name!, startDate: k.fromDate, endDate: k.toDate, format, overs, fee, pw: 2, pt: 1, status: 'open', notes: null, seriesId, org, customerId });
  return toTournament(own(ownerId, id));
}

export function updateTournament(actor: Actor, ownerId: string, id: string, src: unknown): TournamentOut {
  const cur = own(ownerId, id);
  const v = new Validator(src);
  const name = v.str('name', { min: 3, max: 100 });
  const startDate = v.date('startDate'), endDate = v.date('endDate');
  const format = v.oneOf('format', FORMATS);
  const overs = v.int('overs', { min: 1, max: 50 });
  const fee = v.int('entryFeePaise', { min: 0, max: 100_000_000 });
  const pw = v.int('pointsWin', { min: 0, max: 10 }), pt = v.int('pointsTie', { min: 0, max: 10 });
  const status = v.oneOf('status', STATUSES);
  const notes = v.has('notes') ? v.str('notes', { max: 1000 }) ?? '' : v.src.notes === null ? '' : undefined;
  v.done();
  const org = parseOrganiser(src, false);
  if (org) run('UPDATE tournaments SET organiser_first = ?, organiser_last = ?, organiser_phone = ?, organiser_email = ? WHERE id = ?', org.first, org.last, org.phone, org.email, id);
  const s = startDate ?? cur.start_date, e = endDate ?? cur.end_date;
  if (e < s) throw bad('endDate', 'The end date cannot be before the start date');
  run('UPDATE tournaments SET name = ?, start_date = ?, end_date = ?, format = ?, overs = ?, entry_fee_paise = ?, points_win = ?, points_tie = ?, status = ?, notes = ?, updated_at = ?, updated_by = ? WHERE id = ?',
    name ?? cur.name, s, e, format ?? cur.format, overs ?? cur.overs, fee ?? cur.entry_fee_paise, pw ?? cur.points_win, pt ?? cur.points_tie, status ?? cur.status, notes === undefined ? cur.notes : notes || null, now(), actor.id, id);
  audit(actor, 'tournament.update', 'tournament', id, Object.keys(v.src), ownerId);
  return toTournament(own(ownerId, id));
}

export function deleteTournament(actor: Actor, ownerId: string, id: string): void {
  own(ownerId, id);
  if (one('SELECT 1 FROM tournament_teams WHERE tournament_id = ? AND deleted_at IS NULL AND fee_paid = 1', id)) throw conflict('HAS_PAID_TEAMS', 'Teams have paid their entry fee. Mark the tournament cancelled instead of deleting it.');
  tx(() => {
    for (const f of fixturesOf(id)) releaseHold(f);
    for (const t of ['tournaments', 'tournament_teams', 'tournament_fixtures']) run(`UPDATE ${t} SET deleted_at = ?, deleted_by = ? WHERE ${t === 'tournaments' ? 'id' : 'tournament_id'} = ? AND deleted_at IS NULL`, now(), actor.id, id);
  });
  audit(actor, 'tournament.delete', 'tournament', id, null, ownerId);
}

// ------------------------------------------------------------------ teams

function teamOr404(tid: string, teamId: string): TeamRow {
  const t = one<TeamRow>('SELECT * FROM tournament_teams WHERE id = ? AND tournament_id = ? AND deleted_at IS NULL', teamId, tid);
  if (!t) throw notFound('Team not found');
  return t;
}
const nameTaken = (tid: string, name: string, except?: string): boolean =>
  !!one('SELECT 1 FROM tournament_teams WHERE tournament_id = ? AND deleted_at IS NULL AND lower(name) = lower(?) AND id <> ?', tid, name, except ?? '');

/** Books the entry fee as income in 'tournament_fees' and remembers the transaction on the team. Does nothing when the fee is 0 or the owner has no account; 409 PERIOD_LOCKED in a signed-off month. */
function postFee(actor: Actor, ownerId: string, teamId: string, t: TRow, teamName: string, ref: string | null | undefined): void {
  const posted = postToLedger(ownerId, actor, { date: istDate(now()), amountPaise: t.entry_fee_paise, description: `Tournament fee ${t.name} ${teamName}`, categoryCode: 'tournament_fees', method: 'bank', reference: ref });
  if (posted) run('UPDATE tournament_teams SET ledger_txn_id = ? WHERE id = ?', posted.transactionId, teamId);
}

export function addTeam(actor: Actor, ownerId: string, tid: string, src: unknown): TeamOut {
  const t0 = own(ownerId, tid);
  const v = new Validator(src);
  const name = v.str('name', { required: true, min: 2, max: 50 });
  const captain = v.str('captain', { max: 80 });
  const phone = v.phone('phone');
  const feePaid = v.bool('feePaid') ?? false;
  const ref = v.str('paymentRef', { max: 60 });
  v.done();
  if (nameTaken(tid, name!)) throw bad('name', 'Another team in this tournament has that name');
  if (teamsOf(tid).length >= MAX_TEAMS) throw bad('name', `A tournament can have at most ${MAX_TEAMS} teams`);
  const id = newId('trt');
  tx(() => {
    run(`INSERT INTO tournament_teams(id, tournament_id, owner_id, name, captain, phone, fee_paid, payment_ref, paid_at, created_at, created_by, updated_at, updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, tid, ownerId, name!, captain ?? null, phone ?? null, feePaid ? 1 : 0, ref ?? null, feePaid ? now() : null, now(), actor.id, now(), actor.id);
    if (feePaid) postFee(actor, ownerId, id, t0, name!, ref);
  });
  audit(actor, 'tournament.team_add', 'tournament', tid, { team: name, feePaid }, ownerId);
  return toTeam(teamOr404(tid, id));
}

export function updateTeam(actor: Actor, ownerId: string, tid: string, teamId: string, src: unknown): TeamOut {
  const t0 = own(ownerId, tid);
  const cur = teamOr404(tid, teamId);
  const v = new Validator(src);
  const name = v.str('name', { min: 2, max: 50 });
  const captain = v.has('captain') ? v.str('captain', { max: 80 }) ?? '' : undefined;
  const phone = v.src.phone === null || v.src.phone === '' ? '' : v.has('phone') ? v.phone('phone') : undefined;
  const feePaid = v.bool('feePaid');
  const ref = v.has('paymentRef') ? v.str('paymentRef', { max: 60 }) ?? '' : v.src.paymentRef === null ? '' : undefined;
  v.done();
  if (name && nameTaken(tid, name, teamId)) throw bad('name', 'Another team in this tournament has that name');
  const paid = feePaid === undefined ? !!cur.fee_paid : feePaid;
  const paidAt = paid ? (cur.fee_paid ? cur.paid_at : now()) : null;
  const newRef = !paid ? null : ref === undefined ? cur.payment_ref : ref || null;
  tx(() => {
    if (cur.fee_paid && !paid) removeFromLedger(ownerId, actor, cur.ledger_txn_id); // 409 PERIOD_LOCKED if that month is signed off
    run('UPDATE tournament_teams SET name = ?, captain = ?, phone = ?, fee_paid = ?, payment_ref = ?, paid_at = ?, ledger_txn_id = ?, updated_at = ?, updated_by = ? WHERE id = ?',
      name ?? cur.name, captain === undefined ? cur.captain : captain || null, phone === undefined ? cur.phone : phone || null, paid ? 1 : 0, newRef, paidAt, paid ? cur.ledger_txn_id : null, now(), actor.id, teamId);
    if (!cur.fee_paid && paid) postFee(actor, ownerId, teamId, t0, name ?? cur.name, newRef);
  });
  if (feePaid !== undefined && feePaid !== !!cur.fee_paid) audit(actor, feePaid ? 'tournament.fee_paid' : 'tournament.fee_unpaid', 'tournament', tid, { team: cur.name, ref: newRef }, ownerId);
  else audit(actor, 'tournament.team_update', 'tournament', tid, { team: cur.name }, ownerId);
  return toTeam(teamOr404(tid, teamId));
}

export function removeTeam(actor: Actor, ownerId: string, tid: string, teamId: string): void {
  own(ownerId, tid);
  const t = teamOr404(tid, teamId);
  if (one('SELECT 1 FROM tournament_fixtures WHERE tournament_id = ? AND deleted_at IS NULL AND (team_a_id = ? OR team_b_id = ?)', tid, teamId, teamId)) throw conflict('TEAM_HAS_FIXTURES', 'This team is in fixtures. Remove those fixtures first.');
  if (t.fee_paid) throw conflict('TEAM_PAID', 'This team has paid its entry fee. Mark it as unpaid first if the fee was refunded.');
  run('UPDATE tournament_teams SET deleted_at = ?, deleted_by = ? WHERE id = ?', now(), actor.id, teamId);
  audit(actor, 'tournament.team_remove', 'tournament', tid, { team: t.name }, ownerId);
}

// ------------------------------------------------------------------ fixtures

function startsAtFrom(v: Validator, key = 'date', timeKey = 'time'): number | null | undefined {
  const has = v.src[key] !== undefined, hasT = v.src[timeKey] !== undefined;
  if (!has && !hasT) return undefined;
  if (v.src[key] === null || v.src[key] === '') return null;
  const d = v.date(key, true);
  const t = v.time(timeKey) ?? '09:00';
  if (!d) return undefined;
  return istMidnight(d) + minutesOf(t)! * MIN;
}

function groundOk(ownerId: string, groundId: string | undefined | null): void {
  if (groundId && !one('SELECT 1 FROM grounds WHERE id = ? AND owner_id = ?', groundId, ownerId)) throw notFound('Ground not found');
}
function fxOr404(tid: string, id: string): FxRow {
  const f = one<FxRow>('SELECT * FROM tournament_fixtures WHERE id = ? AND tournament_id = ? AND deleted_at IS NULL', id, tid);
  if (!f) throw notFound('Fixture not found');
  return f;
}
const fxOut = (ownerId: string, tid: string, id: string): FixtureOut => toFixtures([fxOr404(tid, id)], teamsOf(tid), ownerId)[0]!;

export function addFixture(actor: Actor, ownerId: string, tid: string, src: unknown): FixtureOut {
  own(ownerId, tid);
  const v = new Validator(src);
  const round = v.int('round', { min: 1, max: 99 }) ?? 1;
  const a = v.str('teamAId', { required: true, max: 60 }), b = v.str('teamBId', { required: true, max: 60 });
  const groundId = v.str('groundId', { max: 60 });
  const startsAt = startsAtFrom(v);
  v.done();
  if (a === b) throw bad('teamBId', 'A team cannot play itself');
  teamOr404(tid, a!); teamOr404(tid, b!); groundOk(ownerId, groundId);
  const id = newId('trf');
  run(`INSERT INTO tournament_fixtures(id, tournament_id, owner_id, round, team_a_id, team_b_id, starts_at, ground_id, created_at, created_by, updated_at, updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, tid, ownerId, round, a!, b!, startsAt ?? null, groundId ?? null, now(), actor.id, now(), actor.id);
  audit(actor, 'tournament.fixture_add', 'tournament', tid, { id }, ownerId);
  return fxOut(ownerId, tid, id);
}

export function updateFixture(actor: Actor, ownerId: string, tid: string, id: string, src: unknown): FixtureOut {
  own(ownerId, tid);
  const cur = fxOr404(tid, id);
  const v = new Validator(src);
  const round = v.int('round', { min: 1, max: 99 });
  const a = v.str('teamAId', { max: 60 }), b = v.str('teamBId', { max: 60 });
  const groundId = v.src.groundId === null || v.src.groundId === '' ? null : v.has('groundId') ? v.str('groundId', { max: 60 }) : undefined;
  const startsAt = startsAtFrom(v);
  const clear = v.bool('clearResult');
  const outcome = v.oneOf('outcome', OUTCOMES);
  const resultText = v.has('resultText') ? v.str('resultText', { max: 200 }) ?? '' : undefined;
  const nrrKeys = ['aRuns', 'aOvers', 'bRuns', 'bOvers'] as const;
  const aRuns = v.int('aRuns', { min: 0, max: 5000 }), bRuns = v.int('bRuns', { min: 0, max: 5000 });
  const aBalls = oversToBalls(v.src.aOvers), bBalls = oversToBalls(v.src.bOvers);
  if (aBalls === undefined) v.fail('aOvers', 'Use overs like 12.3');
  if (bBalls === undefined) v.fail('bOvers', 'Use overs like 12.3');
  v.done();
  const teamA = a ?? cur.team_a_id, teamB = b ?? cur.team_b_id;
  if (teamA === teamB) throw bad('teamBId', 'A team cannot play itself');
  if (a) teamOr404(tid, a);
  if (b) teamOr404(tid, b);
  if (groundId) groundOk(ownerId, groundId);
  if (cur.outcome && (teamA !== cur.team_a_id || teamB !== cur.team_b_id) && !clear) throw conflict('FIXTURE_PLAYED', 'This fixture has a result. Clear the result before changing the teams.');

  let o: string | null = cur.outcome, winner = cur.winner_team_id, text = cur.result_text;
  let ar = cur.a_runs, ab = cur.a_balls, br = cur.b_runs, bb = cur.b_balls;
  if (clear) { o = null; winner = null; text = null; ar = ab = br = bb = null; }
  if (outcome) {
    o = outcome;
    winner = outcome === 'team_a' ? teamA : outcome === 'team_b' ? teamB : null;
    const nm = (x: string) => teamsOf(tid).find((q) => q.id === x)?.name ?? 'Team';
    text = resultText || (outcome === 'tie' ? 'Match tied' : outcome === 'no_result' ? 'No result' : `${nm(winner!)} won`);
  } else if (resultText !== undefined && o) text = resultText || text;
  if (o === 'no_result') { ar = ab = br = bb = null; }
  else if (o) {
    const given = (k: (typeof nrrKeys)[number]) => v.src[k] !== undefined;
    if (given('aRuns')) ar = aRuns ?? null;
    if (given('aOvers')) ab = aBalls ?? null;
    if (given('bRuns')) br = bRuns ?? null;
    if (given('bOvers')) bb = bBalls ?? null;
  }
  const at = startsAt === undefined ? cur.starts_at : startsAt, gid = groundId === undefined ? cur.ground_id : groundId;
  tx(() => {
    run(`UPDATE tournament_fixtures SET round = ?, team_a_id = ?, team_b_id = ?, starts_at = ?, ground_id = ?, outcome = ?, winner_team_id = ?, result_text = ?, a_runs = ?, a_balls = ?, b_runs = ?, b_balls = ?, updated_at = ?, updated_by = ? WHERE id = ?`,
      round ?? cur.round, teamA, teamB, at, gid, o, winner, text, ar, ab, br, bb, now(), actor.id, id);
    // a fixture that holds its time on the ground moves its hold with it (or gives it up when it no longer has a time and a ground)
    if (cur.block_until && cur.starts_at && (at !== cur.starts_at || gid !== cur.ground_id || teamA !== cur.team_a_id || teamB !== cur.team_b_id)) {
      releaseHold(cur);
      if (at && gid) holdFixture(own(ownerId, tid), { ...cur, team_a_id: teamA, team_b_id: teamB, starts_at: at, ground_id: gid }, (cur.block_until - cur.starts_at) / MIN);
    }
  });
  audit(actor, o && o !== cur.outcome ? 'tournament.result' : 'tournament.fixture_update', 'tournament', tid, { fixture: id, outcome: o }, ownerId);
  return fxOut(ownerId, tid, id);
}

export function removeFixture(actor: Actor, ownerId: string, tid: string, id: string): void {
  own(ownerId, tid);
  const f = fxOr404(tid, id);
  if (f.outcome) throw conflict('FIXTURE_PLAYED', 'This fixture has a result. Clear the result first.');
  tx(() => { releaseHold(f); run('UPDATE tournament_fixtures SET deleted_at = ?, deleted_by = ? WHERE id = ?', now(), actor.id, id); });
  audit(actor, 'tournament.fixture_remove', 'tournament', tid, { fixture: id }, ownerId);
}

/** Circle method. Returns rounds of [teamA, teamB] pairs; an odd number of teams gives one bye per round (not listed). */
export function roundRobin(ids: string[], double = false): [string, string][][] {
  const list: (string | null)[] = [...ids];
  if (list.length % 2) list.push(null);
  const n = list.length, rounds: [string, string][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const round: [string, string][] = [];
    for (let i = 0; i < n / 2; i++) {
      const x = list[i]!, y = list[n - 1 - i];
      if (x === null || y === null || y === undefined) continue;
      round.push(r % 2 === 0 ? [x, y] : [y, x]);
    }
    rounds.push(round);
    list.splice(1, 0, list.pop()!); // keep the first team fixed, rotate the rest
  }
  if (double) { const len = rounds.length; for (let r = 0; r < len; r++) rounds.push(rounds[r]!.map(([x, y]) => [y, x] as [string, string])); }
  return rounds;
}

export function generateFixtures(actor: Actor, ownerId: string, tid: string, src: unknown): { created: number; rounds: number; fixtures: FixtureOut[] } {
  own(ownerId, tid);
  const v = new Validator(src);
  const double = v.bool('doubleRound') ?? false;
  const replace = v.bool('replace') ?? false;
  const startDate = v.date('startDate'), time = v.time('time') ?? '09:00', gap = v.int('daysBetweenRounds', { min: 0, max: 60 }) ?? 7;
  const groundId = v.str('groundId', { max: 60 });
  v.done();
  groundOk(ownerId, groundId);
  const teams = teamsOf(tid);
  if (teams.length < 2) throw bad('teams', 'Add at least two teams first');
  const existing = fixturesOf(tid);
  if (existing.length) {
    if (!replace) throw conflict('FIXTURES_EXIST', 'This tournament already has fixtures. Generate again with replace to start over.');
    if (existing.some((f) => f.outcome)) throw conflict('FIXTURES_PLAYED', 'Some fixtures already have results, so they cannot be replaced.');
  }
  const rounds = roundRobin(teams.map((t) => t.id), double);
  tx(() => {
    for (const f of existing) { releaseHold(f); run('UPDATE tournament_fixtures SET deleted_at = ?, deleted_by = ? WHERE id = ?', now(), actor.id, f.id); }
    rounds.forEach((pairs, r) => {
      const at = startDate ? istMidnight(addDays(startDate, r * gap)) + minutesOf(time)! * MIN : null;
      for (const [a, b] of pairs) run(`INSERT INTO tournament_fixtures(id, tournament_id, owner_id, round, team_a_id, team_b_id, starts_at, ground_id, created_at, created_by, updated_at, updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
        newId('trf'), tid, ownerId, r + 1, a, b, at, groundId ?? null, now(), actor.id, now(), actor.id);
    });
  });
  const created = rounds.reduce((s, p) => s + p.length, 0);
  audit(actor, 'tournament.generate', 'tournament', tid, { created, rounds: rounds.length, double, replaced: existing.length }, ownerId);
  return { created, rounds: rounds.length, fixtures: toFixtures(fixturesOf(tid), teams, ownerId) };
}

// ------------------------------------------------------------------ match-day scorer link

/** Hands a fixture to the ball by ball scorer: creates a match from the fixture's teams, overs, date and ground. */
export function createFixtureMatch(actor: Actor, ownerId: string, tid: string, id: string): FixtureOut {
  const t = own(ownerId, tid);
  const f = fxOr404(tid, id);
  if (f.match_id) throw conflict('MATCH_EXISTS', 'This fixture already has a scored match');
  if (f.outcome) throw conflict('FIXTURE_PLAYED', 'This fixture already has a result');
  const teams = teamsOf(tid);
  const a = teams.find((x) => x.id === f.team_a_id)!, b = teams.find((x) => x.id === f.team_b_id)!;
  const m = createMatch(actor, ownerId, { title: `${t.name}: ${a.name} v ${b.name}`.slice(0, 100), teamA: a.name, teamB: b.name, overs: t.overs, groundId: f.ground_id ?? undefined, scheduledFor: f.starts_at ?? undefined });
  run('UPDATE tournament_fixtures SET match_id = ?, updated_at = ?, updated_by = ? WHERE id = ?', m.id, now(), actor.id, id);
  audit(actor, 'tournament.match_link', 'tournament', tid, { fixture: id, match: m.id }, ownerId);
  return fxOut(ownerId, tid, id);
}

/** Copies the scorer's finished result (winner, runs, overs faced) onto the fixture. */
export function syncFixtureResult(actor: Actor, ownerId: string, tid: string, id: string): FixtureOut {
  own(ownerId, tid);
  const f = fxOr404(tid, id);
  if (!f.match_id) throw conflict('NO_MATCH', 'This fixture has no scored match');
  const m = one<{ status: string; result: string | null; overs: number; players_per_side: number; batting_first: 'a' | 'b'; team_a: string; team_b: string }>('SELECT status, result, overs, players_per_side, batting_first, team_a, team_b FROM matches WHERE id = ? AND owner_id = ?', f.match_id, ownerId);
  if (!m) throw notFound('Match not found');
  if (m.status !== 'completed') throw conflict('MATCH_NOT_FINISHED', 'The scorer has not finished this match yet');
  const result = m.result ?? '';
  const outcome = /tied/i.test(result) ? 'tie' : result.startsWith(`${m.team_a} won`) ? 'team_a' : result.startsWith(`${m.team_b} won`) ? 'team_b' : 'no_result';
  const side = (innings: number) => {
    const balls = many<{ runs_bat: number; extra_runs: number; extra_type: string | null; wicket: number; wicket_kind: string | null }>('SELECT runs_bat, extra_runs, extra_type, wicket, wicket_kind FROM match_balls WHERE match_id = ? AND innings = ?', f.match_id!, innings);
    let runs = 0, legal = 0, wk = 0;
    for (const b of balls) { runs += b.runs_bat + b.extra_runs; if (b.extra_type !== 'wide' && b.extra_type !== 'noball') legal++; if (b.wicket && b.wicket_kind !== 'retired') wk++; }
    return { runs, balls: wk >= m.players_per_side - 1 ? m.overs * 6 : legal }; // all out counts as the full quota of overs
  };
  const first = side(1), second = side(2);
  const [aInn, bInn] = m.batting_first === 'a' ? [first, second] : [second, first];
  run(`UPDATE tournament_fixtures SET outcome = ?, winner_team_id = ?, result_text = ?, a_runs = ?, a_balls = ?, b_runs = ?, b_balls = ?, updated_at = ?, updated_by = ? WHERE id = ?`,
    outcome, outcome === 'team_a' ? f.team_a_id : outcome === 'team_b' ? f.team_b_id : null, result || null,
    outcome === 'no_result' ? null : aInn.runs, outcome === 'no_result' ? null : aInn.balls, outcome === 'no_result' ? null : bInn.runs, outcome === 'no_result' ? null : bInn.balls, now(), actor.id, id);
  audit(actor, 'tournament.result', 'tournament', tid, { fixture: id, outcome, from: 'scorer' }, ownerId);
  return fxOut(ownerId, tid, id);
}

// ------------------------------------------------------------------ fixture builder: the days and match times you give, held on the ground

export const SCHEDULE_KINDS = ['round_robin', 'double_round_robin', 'knockout'] as const;
const MAX_DAYS = 120, MAX_TIMES = 12;

/** Releases the ground time a fixture holds: only the block slots written for it (same ground, its time, its note), never a booking or another block. */
function releaseHold(f: FxRow): void {
  if (!f.block_until || !f.starts_at || !f.ground_id) return;
  run("DELETE FROM booking_slots WHERE ground_id = ? AND kind = 'block' AND note IS ? AND slot_start >= ? AND slot_start < ?", f.ground_id, f.block_note ?? null, f.starts_at, f.block_until);
  run('UPDATE tournament_fixtures SET block_until = NULL, block_note = NULL WHERE id = ?', f.id);
}

const hhmm = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Holds a fixture's time on its ground as a block so it cannot be booked. All or nothing, with the reason when a slot is taken. */
function holdFixture(t: TRow, f: Pick<FxRow, 'id' | 'team_a_id' | 'team_b_id' | 'starts_at' | 'ground_id'>, minutes: number): void {
  const g = groundRow(f.ground_id!);
  if (!g) throw notFound('Ground not found');
  const names = new Map(teamsOf(t.id).map((x) => [x.id, x.name]));
  const note = `Tournament: ${t.name} · ${names.get(f.team_a_id) ?? 'Team'} v ${names.get(f.team_b_id) ?? 'Team'}`.slice(0, 200);
  const date = istDate(f.starts_at!), from = (f.starts_at! - istMidnight(date)) / MIN, to = from + minutes;
  if (to > 24 * 60) throw bad('times', `The match at ${hhmm(from)} on ${date} would run past midnight`);
  const clash = one<{ kind: string; note: string | null; slot_start: number }>("SELECT kind, note, slot_start FROM booking_slots WHERE ground_id = ? AND slot_start >= ? AND slot_start < ? ORDER BY slot_start LIMIT 1", g.id, f.starts_at!, f.starts_at! + minutes * MIN);
  if (clash) throw conflict('SLOT_TAKEN', `${date} at ${hhmm((clash.slot_start - istMidnight(date)) / MIN)} on ${g.name} is already ${clash.kind === 'block' ? `blocked${clash.note ? ` (${clash.note})` : ''}` : 'booked'}. Pick another time or day.`);
  try { blockRange(g, date, hhmm(from), hhmm(to), note); }
  catch (e) { if (e instanceof HttpError && e.code === 'NO_SLOTS') throw bad('days', `${g.name} has no bookable slots on ${date} between ${hhmm(from)} and ${hhmm(to)} (closed, or outside its hours)`); throw e; }
  run('UPDATE tournament_fixtures SET block_until = ?, block_note = ? WHERE id = ?', f.starts_at! + minutes * MIN, note, f.id);
}

/** Knockout: the first round from the teams (the first ones entered get the byes, so the next round is a power of two), or, once every
 *  match of the last knockout round has a winner, the next round from the winners and the teams that had a bye. */
export function knockoutPairs(teamIds: string[], fixtures: Pick<FxRow, 'round' | 'team_a_id' | 'team_b_id' | 'winner_team_id' | 'outcome'>[]): { round: number; pairs: [string, string][] } {
  if (!fixtures.length) {
    let p = 1; while (p < teamIds.length) p *= 2;
    const byes = p - teamIds.length, rest = teamIds.slice(byes), pairs: [string, string][] = [];
    for (let i = 0; i < rest.length / 2; i++) pairs.push([rest[i]!, rest[rest.length - 1 - i]!]);
    return { round: 1, pairs };
  }
  const last = Math.max(...fixtures.map((f) => f.round));
  const cur = fixtures.filter((f) => f.round === last);
  if (cur.some((f) => !f.winner_team_id)) throw conflict('ROUND_NOT_FINISHED', `Every match of round ${last} needs a winner before the next knockout round can be made.`);
  const out = new Set(fixtures.filter((f) => f.winner_team_id).map((f) => (f.winner_team_id === f.team_a_id ? f.team_b_id : f.team_a_id)));
  const alive = teamIds.filter((id) => !out.has(id));
  if (alive.length < 2) throw conflict('KNOCKOUT_DONE', 'The knockout is finished: there is a winner.');
  const pairs: [string, string][] = [];
  for (let i = 0; i + 1 < alive.length; i += 2) pairs.push([alive[i]!, alive[i + 1]!]);
  return { round: last + 1, pairs };
}

/**
 * Builds fixtures into the days and match times given: round robin (once or home and away) or knockout. Matches fill the slots in order,
 * a team plays at most once a day where the slots allow it, and with `holdGround` (the default) each match's time is blocked on the ground
 * so customers cannot book it. All or nothing: if a slot is taken or there are not enough slots, nothing is written and the reason is given.
 */
export function scheduleFixtures(actor: Actor, ownerId: string, tid: string, src: unknown): { created: number; rounds: number; held: number; fixtures: FixtureOut[] } {
  const t = own(ownerId, tid);
  const v = new Validator(src);
  const kind = v.oneOf('kind', SCHEDULE_KINDS, true);
  const groundId = v.str('groundId', { required: true, max: 60 });
  const minutes = v.int('matchMinutes', { min: 30, max: 720 }) ?? 180;
  const hold = v.bool('holdGround') ?? true;
  const replace = v.bool('replace') ?? false;
  // day and night: every team plays at least one match in the day and one at night (a match starting at or after nightFrom is a night match)
  const dayNight = v.bool('dayNight') ?? false;
  const nightFromIn = v.time('nightFrom');
  const rawDays = Array.isArray(v.src.days) ? v.src.days : null, rawTimes = Array.isArray(v.src.times) ? v.src.times : null;
  if (!rawDays || !rawDays.length) v.fail('days', 'Pick at least one day');
  else if (rawDays.length > MAX_DAYS) v.fail('days', `At most ${MAX_DAYS} days at once`);
  if (!rawTimes || !rawTimes.length) v.fail('times', 'Give at least one match time, like 09:00');
  else if (rawTimes.length > MAX_TIMES) v.fail('times', `At most ${MAX_TIMES} match times a day`);
  const days = [...new Set((rawDays ?? []).map(String))].sort(), times = [...new Set((rawTimes ?? []).map(String))].map((x) => ({ x, m: minutesOf(x) }));
  for (const d of days) if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || istDate(istMidnight(d)) !== d) { v.fail('days', `${d} is not a date like 2026-11-08`); break; }
  for (const { x, m } of times) if (m === null) { v.fail('times', `${x} is not a time like 09:00`); break; }
  v.done();
  groundOk(ownerId, groundId);
  const today = istDate(now());
  if (days[0]! < today) throw bad('days', `${days[0]} has already passed`);
  const mins = times.map((x) => x.m!).sort((a, b) => a - b);
  for (let i = 1; i < mins.length; i++) if (mins[i]! - mins[i - 1]! < minutes) throw bad('times', `${hhmm(mins[i - 1]!)} and ${hhmm(mins[i]!)} are less than ${minutes} minutes apart, so the matches would overlap on one ground`);

  const teams = teamsOf(tid);
  if (teams.length < 2) throw bad('teams', 'Add at least two teams first');
  const existing = fixturesOf(tid);
  let rounds: [string, string][][]; let firstRound = 1; let clear: FxRow[] = [];
  if (kind === 'knockout') {
    const k = knockoutPairs(teams.map((x) => x.id), replace ? [] : existing);
    if (replace && existing.some((f) => f.outcome)) throw conflict('FIXTURES_PLAYED', 'Some fixtures already have results, so they cannot be replaced.');
    rounds = [k.pairs]; firstRound = k.round; clear = replace ? existing : [];
  } else {
    if (existing.length && !replace) throw conflict('FIXTURES_EXIST', 'This tournament already has fixtures. Build again with replace to start over.');
    if (existing.some((f) => f.outcome)) throw conflict('FIXTURES_PLAYED', 'Some fixtures already have results, so they cannot be replaced.');
    rounds = roundRobin(teams.map((x) => x.id), kind === 'double_round_robin'); clear = existing;
  }
  const matches = rounds.flatMap((pairs, r) => pairs.map(([a, b]) => ({ a, b, round: firstRound + r })));
  const slots = days.flatMap((d) => mins.map((m) => ({ d, at: istMidnight(d) + m * MIN }))).filter((x) => x.at > now());
  if (slots.length < matches.length) throw bad('days', `${matches.length} matches need ${matches.length} match times; these days and times give ${slots.length}. Add ${matches.length - slots.length} more (another day or another time).`);

  const nightFrom = minutesOf(nightFromIn ?? groundRow(groundId!)!.evening_from ?? '18:00') ?? 18 * 60;
  const isNight = (at: number) => (at - istMidnight(istDate(at))) / MIN >= nightFrom;
  if (dayNight) {
    if (!mins.some((m) => m >= nightFrom)) throw bad('times', `Day and night needs at least one match time at or after ${hhmm(nightFrom)} (night)`);
    if (!mins.some((m) => m < nightFrom)) throw bad('times', `Day and night needs at least one match time before ${hhmm(nightFrom)} (day)`);
  }
  // fill the slots in order: the earliest-round match whose teams have not played that day, else the earliest-round match left.
  // With day and night, a match that gives a team its first game of that kind (day or night) goes first.
  const left = [...matches], placed: { a: string; b: string; round: number; at: number }[] = [];
  const had = { day: new Set<string>(), night: new Set<string>() };
  for (const sl of slots) {
    if (!left.length) break;
    const busy = new Set(placed.filter((p) => istDate(p.at) === sl.d).flatMap((p) => [p.a, p.b]));
    const free = (m: (typeof left)[number]) => !busy.has(m.a) && !busy.has(m.b);
    const kindOf = isNight(sl.at) ? 'night' : 'day';
    const need = (m: (typeof left)[number]) => (dayNight ? Number(!had[kindOf].has(m.a)) + Number(!had[kindOf].has(m.b)) : 0);
    const minRound = Math.min(...left.map((m) => m.round));
    const best = (pool: number[]) => pool.length ? pool.reduce((x, y) => (need(left[y]!) > need(left[x]!) ? y : x)) : -1;
    const idx = left.map((_, k) => k);
    let i = best(idx.filter((k) => left[k]!.round === minRound && free(left[k]!)));
    if (dayNight && (i < 0 || need(left[i]!) === 0)) { const j = best(idx.filter((k) => free(left[k]!))); if (j >= 0 && (i < 0 || need(left[j]!) > need(left[i]!))) i = j; }
    if (i < 0) i = best(idx.filter((k) => free(left[k]!)));
    if (i < 0) i = 0;
    const m = left.splice(i, 1)[0]!;
    had[kindOf].add(m.a); had[kindOf].add(m.b);
    placed.push({ ...m, at: sl.at });
  }
  if (dayNight) {
    const games = new Map<string, number>(); for (const p of placed) for (const x of [p.a, p.b]) games.set(x, (games.get(x) ?? 0) + 1);
    const kinds = () => { had.day.clear(); had.night.clear(); for (const p of placed) for (const x of [p.a, p.b]) had[isNight(p.at) ? 'night' : 'day'].add(x); };
    const shortCount = () => { kinds(); return teams.filter((x) => (games.get(x.id) ?? 0) >= 2 && (!had.day.has(x.id) || !had.night.has(x.id))).length; };
    // the in-order fill can leave a team without one kind: swap a day match with a night match while that helps
    let cur = shortCount();
    for (let pass = 0; cur > 0 && pass < 20; pass++) {
      let improved = false;
      for (let i = 0; i < placed.length && cur > 0; i++) for (let j = i + 1; j < placed.length && cur > 0; j++) {
        const x = placed[i]!, y = placed[j]!;
        if (isNight(x.at) === isNight(y.at)) continue;
        [x.at, y.at] = [y.at, x.at];
        const n = shortCount();
        if (n < cur) { cur = n; improved = true; } else [x.at, y.at] = [y.at, x.at];
      }
      if (!improved) break;
    }
    kinds();
    const short = teams.filter((x) => (games.get(x.id) ?? 0) >= 2 && (!had.day.has(x.id) || !had.night.has(x.id)));
    if (short.length) throw conflict('DAY_NIGHT', `These teams would not get both a day and a night match: ${short.map((x) => `${x.name} (no ${had.day.has(x.id) ? 'night' : 'day'} match)`).join(', ')}. Add more ${short.some((x) => !had.night.has(x.id)) ? 'night' : 'day'} match times or days.`);
  }

  let held = 0;
  tx(() => {
    for (const f of clear) { releaseHold(f); run('UPDATE tournament_fixtures SET deleted_at = ?, deleted_by = ? WHERE id = ?', now(), actor.id, f.id); }
    for (const p of placed) {
      const id = newId('trf');
      run(`INSERT INTO tournament_fixtures(id, tournament_id, owner_id, round, team_a_id, team_b_id, starts_at, ground_id, created_at, created_by, updated_at, updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, tid, ownerId, p.round, p.a, p.b, p.at, groundId!, now(), actor.id, now(), actor.id);
      if (hold) { holdFixture(t, { id, team_a_id: p.a, team_b_id: p.b, starts_at: p.at, ground_id: groundId! }, minutes); held++; }
    }
  });
  const nRounds = new Set(placed.map((p) => p.round)).size;
  audit(actor, 'tournament.schedule', 'tournament', tid, { kind, dayNight, nightFrom: hhmm(nightFrom), created: placed.length, rounds: nRounds, held, days: days.length, times: mins.map(hhmm), matchMinutes: minutes, replaced: clear.length }, ownerId);
  return { created: placed.length, rounds: nRounds, held, fixtures: toFixtures(fixturesOf(tid), teams, ownerId) };
}
