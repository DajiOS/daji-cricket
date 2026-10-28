import { createHash } from 'node:crypto';
import { many, one, registerSchema, run, tx } from './db.ts';
import { now } from './clock.ts';
import { audit, type Actor } from './audit.ts';
import { HttpError, conflict, forbidden, notFound } from './errors.ts';
import { newId } from './ids.ts';
import { Validator, normalizePhone } from './input.ts';
import { istDate } from './time.ts';
import { getSettings } from './settings.ts';
import { groundRow } from './grounds.ts';
import { pushNotify, pushStaffOf } from './notifications.ts';
import type { UserRow } from './auth.ts';
import { FORMATS, addTeam, generateFixtures, insertTournament, tournamentDetail } from './tournaments.ts';
import { depositSettled, depositState, openDeposit } from './auctionDeposit.ts';
import { DEFAULT_RULES, checkRules, diffRules, draftRuleChange, nextMinimum, rulesInWords, type AuctionRules, type RuleDraft } from './auctionRules.ts';

// Auction tournaments: a customer hosts a tournament whose teams are picked at a live player auction.
// The host sets up teams (each with an owner who bids), players sign up with their own Daji profile, and the host runs
// the bidding: a player comes up, teams bid in points, the host brings the hammer down. When the auction is finished the
// teams go into the normal Tournaments module (tournaments.ts), so fixtures, results and the points table work as for any
// tournament, and the ground's staff see it on the Desk.
// Owner's decisions (28 Oct 2026): the purse and bids are points, never money; a customer's auction opens to players as
// soon as it is made (no approval), and the ground's staff can hide one.
// Every sale, undo, bid and rule change is kept: rows are marked undone or retracted, never deleted.

registerSchema('auction-1', `
CREATE TABLE auctions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  tournament_id TEXT NOT NULL REFERENCES tournaments(id),
  host_id TEXT NOT NULL REFERENCES users(id),
  ground_id TEXT REFERENCES grounds(id),
  mode TEXT NOT NULL DEFAULT 'auction' CHECK (mode IN ('auction','teams')),
  status TEXT NOT NULL DEFAULT 'registration' CHECK (status IN ('registration','live','completed','cancelled')),
  rules TEXT NOT NULL,
  rules_version INTEGER NOT NULL DEFAULT 1,
  round INTEGER NOT NULL DEFAULT 1,
  lot_no INTEGER NOT NULL DEFAULT 0,
  current_player_id TEXT,
  lot_started_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  started_at INTEGER,
  finished_at INTEGER,
  cancelled_reason TEXT,
  hidden_at INTEGER,
  hidden_by TEXT,
  hidden_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX ix_auctions_owner ON auctions(owner_id, status);
CREATE INDEX ix_auctions_host ON auctions(host_id);
CREATE UNIQUE INDEX ux_auctions_tournament ON auctions(tournament_id);

CREATE TABLE auction_teams (
  id TEXT PRIMARY KEY,
  auction_id TEXT NOT NULL REFERENCES auctions(id),
  name TEXT NOT NULL,
  owner_user_id TEXT REFERENCES users(id),
  owner_name TEXT,
  tournament_team_id TEXT REFERENCES tournament_teams(id),
  created_at INTEGER NOT NULL,
  removed_at INTEGER,
  removed_by TEXT
);
CREATE INDEX ix_auction_teams_a ON auction_teams(auction_id);

CREATE TABLE auction_players (
  id TEXT PRIMARY KEY,
  auction_id TEXT NOT NULL REFERENCES auctions(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('batter','bowler','all_rounder','wicket_keeper')),
  batting TEXT,
  bowling TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','withdrawn','removed')),
  removed_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);
CREATE INDEX ix_auction_players_a ON auction_players(auction_id, status);
CREATE UNIQUE INDEX ux_auction_players_user ON auction_players(auction_id, user_id);

CREATE TABLE auction_bids (
  id TEXT PRIMARY KEY,
  auction_id TEXT NOT NULL REFERENCES auctions(id),
  lot_no INTEGER NOT NULL,
  player_id TEXT NOT NULL REFERENCES auction_players(id),
  team_id TEXT NOT NULL REFERENCES auction_teams(id),
  points INTEGER NOT NULL,
  placed_by TEXT NOT NULL,
  placed_at INTEGER NOT NULL,
  via TEXT NOT NULL DEFAULT 'host',
  retracted_at INTEGER,
  retracted_by TEXT
);
CREATE INDEX ix_auction_bids_lot ON auction_bids(auction_id, lot_no);

CREATE TABLE auction_lots (
  id TEXT PRIMARY KEY,
  auction_id TEXT NOT NULL REFERENCES auctions(id),
  lot_no INTEGER NOT NULL,
  round INTEGER NOT NULL,
  player_id TEXT NOT NULL REFERENCES auction_players(id),
  result TEXT NOT NULL CHECK (result IN ('sold','unsold')),
  team_id TEXT REFERENCES auction_teams(id),
  points INTEGER,
  decided_by TEXT NOT NULL,
  decided_at INTEGER NOT NULL,
  undone_at INTEGER,
  undone_by TEXT
);
CREATE INDEX ix_auction_lots_a ON auction_lots(auction_id, player_id);

CREATE TABLE auction_rule_changes (
  id TEXT PRIMARY KEY,
  auction_id TEXT NOT NULL REFERENCES auctions(id),
  version INTEGER NOT NULL,
  before_rules TEXT NOT NULL,
  after_rules TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('form','ai')),
  request TEXT,
  changed_by TEXT NOT NULL,
  changed_at INTEGER NOT NULL
);
CREATE INDEX ix_auction_rule_changes_a ON auction_rule_changes(auction_id, version);
`);

export const ROLES = ['batter', 'bowler', 'all_rounder', 'wicket_keeper'] as const;
export const ROLE_WORDS: Record<string, string> = { batter: 'Batter', bowler: 'Bowler', all_rounder: 'All-rounder', wicket_keeper: 'Wicket keeper' };
const STATUS_WORDS: Record<string, string> = { registration: 'Players signing up', live: 'Auction running', completed: 'Auction finished', cancelled: 'Cancelled' };
const TEAM_STATUS_WORDS: Record<string, string> = { registration: 'Taking team entries', live: 'Taking team entries', completed: 'Teams confirmed', cancelled: 'Cancelled' };
export const MODES = ['auction', 'teams'] as const;
/** What each person reads as the state: hidden, waiting for the hosting deposit, or the stage it is at. */
const statusText = (a: ARow, settled: boolean): string => a.hidden_at ? 'Hidden by the ground' : !settled && a.status === 'registration' ? 'Waiting for the hosting deposit' : (a.mode === 'teams' ? TEAM_STATUS_WORDS : STATUS_WORDS)[a.status]!;
/** A customer can host this many auctions at once that are not finished or cancelled. */
export const MAX_ACTIVE_HOSTED = 3;

interface ARow { id: string; mode: 'auction' | 'teams'; owner_id: string; tournament_id: string; host_id: string; ground_id: string | null; status: string; rules: string; rules_version: number; round: number; lot_no: number; current_player_id: string | null; lot_started_at: number | null; version: number; started_at: number | null; finished_at: number | null; cancelled_reason: string | null; hidden_at: number | null; hidden_by: string | null; hidden_reason: string | null; created_at: number; updated_at: number }
interface TeamRow { id: string; auction_id: string; name: string; owner_user_id: string | null; owner_name: string | null; tournament_team_id: string | null; created_at: number }
interface PRow { id: string; auction_id: string; user_id: string; role: string; batting: string | null; bowling: string | null; note: string | null; status: string; removed_reason: string | null; created_at: number; name: string; first_name: string | null; last_name: string | null; avatar_id: string | null; active: number }
interface BidRow { id: string; lot_no: number; player_id: string; team_id: string; points: number; placed_by: string; placed_at: number; via: string }
interface LotRow { id: string; lot_no: number; round: number; player_id: string; result: 'sold' | 'unsold'; team_id: string | null; points: number | null; decided_at: number }
interface TRow { id: string; name: string; start_date: string; end_date: string; format: string; overs: number; status: string }

const bad = (field: string, message: string) => new HttpError(400, 'VALIDATION_FAILED', message, { fields: [{ field, message }] });
const rulesOf = (a: ARow): AuctionRules => checkRules(JSON.parse(a.rules) as Partial<AuctionRules>, DEFAULT_RULES);
const row = (id: string): ARow | undefined => one<ARow>('SELECT * FROM auctions WHERE id = ?', id);
const tourOf = (a: ARow): TRow => one<TRow>('SELECT id, name, start_date, end_date, format, overs, status FROM tournaments WHERE id = ?', a.tournament_id)!;
const teamsOf = (aid: string): TeamRow[] => many<TeamRow>('SELECT * FROM auction_teams WHERE auction_id = ? AND removed_at IS NULL ORDER BY created_at, id', aid);
const playersOf = (aid: string): PRow[] => many<PRow>(`SELECT p.*, u.name, u.first_name, u.last_name, u.avatar_id, u.active FROM auction_players p JOIN users u ON u.id = p.user_id WHERE p.auction_id = ? ORDER BY p.created_at, p.rowid`, aid);
/** The result that stands for each player: the newest lot that was not undone. */
const standingLots = (aid: string): Map<string, LotRow> => {
  const out = new Map<string, LotRow>();
  for (const l of many<LotRow>('SELECT id, lot_no, round, player_id, result, team_id, points, decided_at FROM auction_lots WHERE auction_id = ? AND undone_at IS NULL ORDER BY lot_no', aid)) out.set(l.player_id, l);
  return out;
};
const liveBids = (aid: string, lotNo: number): BidRow[] => many<BidRow>('SELECT id, lot_no, player_id, team_id, points, placed_by, placed_at, via FROM auction_bids WHERE auction_id = ? AND lot_no = ? AND retracted_at IS NULL ORDER BY points DESC, placed_at DESC', aid, lotNo);
const bump = (id: string): void => { run('UPDATE auctions SET version = version + 1, updated_at = ? WHERE id = ?', now(), id); };
/** A person's name from their profile. A deleted account shows only "Deleted user". */
const playerName = (p: Pick<PRow, 'name' | 'first_name' | 'last_name' | 'active'>): string => (!p.active ? 'Deleted user' : [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || p.name);
const fullName = (u: UserRow): string => [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.name;
const actorOf = (u: UserRow): Actor => ({ id: u.id, role: u.role });

export function auctionsOn(): void {
  if (!getSettings().auctionTournamentsEnabled) throw new HttpError(503, 'FEATURE_OFF', 'Auction tournaments are switched off for now. Please call the ground.');
}

// ------------------------------------------------------------------ money in the auction: points only

export interface TeamState { id: string; name: string; ownerName: string | null; ownerIsYou: boolean; hasOwnerAccount: boolean; squad: number; spentPoints: number; pursePointsLeft: number; maxBidPoints: number; full: boolean; players: { playerId: string; name: string; role: string; points: number }[] }

function teamStates(a: ARow, r: AuctionRules, viewer: UserRow | null, players: PRow[], lots: Map<string, LotRow>): TeamState[] {
  const byId = new Map(players.map((p) => [p.id, p]));
  return teamsOf(a.id).map((t) => {
    const mine = [...lots.values()].filter((l) => l.result === 'sold' && l.team_id === t.id);
    const spent = mine.reduce((s, l) => s + (l.points ?? 0), 0);
    const left = r.pursePoints - spent;
    const reserve = r.reserveForSquad ? r.basePoints * Math.max(0, r.squadMin - mine.length - 1) : 0;
    const full = mine.length >= r.squadMax;
    return {
      id: t.id, name: t.name, ownerName: t.owner_name, ownerIsYou: !!viewer && t.owner_user_id === viewer.id, hasOwnerAccount: !!t.owner_user_id,
      squad: mine.length, spentPoints: spent, pursePointsLeft: left, maxBidPoints: full ? 0 : Math.max(0, left - reserve), full,
      players: mine.map((l) => { const p = byId.get(l.player_id); return { playerId: l.player_id, name: p ? playerName(p) : '?', role: p?.role ?? '', points: l.points ?? 0 }; }),
    };
  });
}

// ------------------------------------------------------------------ the order players come up

/** A fair random order that does not change between calls: each player's place comes from a hash of the auction and the player. */
const shuffleKey = (aid: string, pid: string): string => createHash('sha256').update(`${aid}:${pid}`).digest('hex');
const ROLE_ORDER: Record<string, number> = { wicket_keeper: 0, batter: 1, all_rounder: 2, bowler: 3 };

/** Who comes up next in this round (null when nobody is left), and the round they come up in. */
function nextInPool(a: ARow, r: AuctionRules, players: PRow[], lots: Map<string, LotRow>): { player: PRow; round: number } | null {
  const active = players.filter((p) => p.status === 'registered');
  const order = (list: PRow[]): PRow[] => [...list].sort((x, y) =>
    r.playerOrder === 'registration' ? x.created_at - y.created_at
      : r.playerOrder === 'role' ? (ROLE_ORDER[x.role]! - ROLE_ORDER[y.role]!) || x.created_at - y.created_at
        : shuffleKey(a.id, x.id).localeCompare(shuffleKey(a.id, y.id)));
  const fresh = order(active.filter((p) => !lots.has(p.id)));
  if (fresh.length) return { player: fresh[0]!, round: a.round };
  if (r.unsoldRound && a.round === 1) {
    const again = order(active.filter((p) => lots.get(p.id)?.result === 'unsold' && lots.get(p.id)!.round === 1));
    if (again.length) return { player: again[0]!, round: 2 };
  }
  return null;
}

// ------------------------------------------------------------------ what each person sees

export interface AuctionSummary { id: string; mode: 'auction' | 'teams'; depositSettled: boolean; tournamentId: string; name: string; startDate: string; endDate: string; groundName: string | null; status: string; statusText: string; hostName: string; youHost: boolean; youPlay: boolean; teams: number; players: number; sold: number; hidden: boolean; signUpOpen: boolean }

function signUpOpen(a: ARow, r: AuctionRules, playerCount: number): boolean {
  if (a.mode !== 'auction' || a.status !== 'registration' || a.hidden_at || !depositSettled(a.id)) return false;
  if (r.registrationCloses && istDate(now()) > r.registrationCloses) return false;
  if (r.maxPlayers !== null && playerCount >= r.maxPlayers) return false;
  return true;
}

function summary(a: ARow, viewer: UserRow | null): AuctionSummary {
  const t = tourOf(a), r = rulesOf(a);
  const host = one<{ name: string; first_name: string | null; last_name: string | null; active: number }>('SELECT name, first_name, last_name, active FROM users WHERE id = ?', a.host_id)!;
  const players = many<{ user_id: string }>("SELECT user_id FROM auction_players WHERE auction_id = ? AND status = 'registered'", a.id);
  const sold = [...standingLots(a.id).values()].filter((l) => l.result === 'sold').length;
  return {
    id: a.id, mode: a.mode, depositSettled: depositSettled(a.id), tournamentId: a.tournament_id, name: t.name, startDate: t.start_date, endDate: t.end_date, groundName: a.ground_id ? groundRow(a.ground_id)?.name ?? null : null,
    status: a.status, statusText: statusText(a, depositSettled(a.id)), hostName: playerName(host), youHost: !!viewer && viewer.id === a.host_id,
    youPlay: !!viewer && players.some((p) => p.user_id === viewer.id), teams: teamsOf(a.id).length, players: players.length, sold, hidden: !!a.hidden_at, signUpOpen: signUpOpen(a, r, players.length),
  };
}

export interface PlayerOut { id: string; name: string; avatarUrl: string | null; role: string; roleText: string; batting: string | null; bowling: string | null; note: string | null; status: string; isYou: boolean; result: 'sold' | 'unsold' | null; teamId: string | null; teamName: string | null; points: number | null; round: number | null }

/** The whole auction as one person may see it. Phone numbers and email addresses are never in it. */
export function auctionView(viewer: UserRow | null, id: string, staffOwnerId?: string) {
  const a = row(id);
  if (!a || (staffOwnerId !== undefined && a.owner_id !== staffOwnerId)) throw notFound('Auction not found');
  const isHost = !!viewer && viewer.id === a.host_id;
  // hidden by the ground, or the hosting deposit is not settled: only the host (and the ground's staff) can see it
  if ((a.hidden_at || !depositSettled(a.id)) && !isHost && staffOwnerId === undefined) throw notFound('Auction not found');
  const t = tourOf(a), r = rulesOf(a), players = playersOf(a.id), lots = standingLots(a.id);
  const teams = teamStates(a, r, viewer, players, lots);
  const teamName = new Map(teams.map((x) => [x.id, x.name]));
  const pout: PlayerOut[] = players.filter((p) => p.status === 'registered' || isHost || staffOwnerId !== undefined || p.user_id === viewer?.id).map((p) => {
    const l = lots.get(p.id);
    return { id: p.id, name: playerName(p), avatarUrl: p.avatar_id && p.active ? `/api/avatar/${p.avatar_id}` : null, role: p.role, roleText: ROLE_WORDS[p.role]!, batting: p.batting, bowling: p.bowling, note: p.note,
      status: p.status, isYou: p.user_id === viewer?.id, result: l?.result ?? null, teamId: l?.team_id ?? null, teamName: l?.team_id ? teamName.get(l.team_id) ?? null : null, points: l?.points ?? null, round: l?.round ?? null };
  });
  let lot = null as null | { lotNo: number; round: number; player: PlayerOut; bidPoints: number | null; bidTeamId: string | null; bidTeamName: string | null; nextMinimumPoints: number; startedAt: number | null; bids: { teamName: string; points: number; at: number }[] };
  if (a.status === 'live' && a.current_player_id) {
    const bids = liveBids(a.id, a.lot_no);
    const top = bids[0] ?? null;
    lot = { lotNo: a.lot_no, round: a.round, player: pout.find((p) => p.id === a.current_player_id)!, bidPoints: top?.points ?? null, bidTeamId: top?.team_id ?? null, bidTeamName: top ? teamName.get(top.team_id) ?? null : null,
      nextMinimumPoints: nextMinimum(r, top?.points ?? null), startedAt: top?.placed_at ?? a.lot_started_at, bids: bids.slice(0, 10).map((b) => ({ teamName: teamName.get(b.team_id) ?? '?', points: b.points, at: b.placed_at })) };
  }
  const myTeam = teams.find((x) => x.ownerIsYou) ?? null;
  const pending = a.status === 'live' && !a.current_player_id ? nextInPool(a, r, players, lots) : null;
  return {
    auction: summary(a, viewer), version: a.version, rules: r, rulesVersion: a.rules_version, rulesInWords: rulesInWords(r, a.mode), round: a.round,
    deposit: isHost || staffOwnerId !== undefined ? depositState(a.id) : null,
    tournament: { id: t.id, name: t.name, startDate: t.start_date, endDate: t.end_date, format: t.format, overs: t.overs, status: t.status },
    teams, players: pout, lot, myTeamId: myTeam?.id ?? null, isHost, hiddenReason: isHost || staffOwnerId !== undefined ? a.hidden_reason : null, cancelledReason: a.cancelled_reason,
    canEditRules: isHost && a.status === 'registration' && !a.hidden_at,
    depositHowToPay: isHost ? howToPay() : null, morePlayersToCome: a.status === 'live' ? !!(a.current_player_id || pending) : null,
    recent: many<LotRow>('SELECT id, lot_no, round, player_id, result, team_id, points, decided_at FROM auction_lots WHERE auction_id = ? AND undone_at IS NULL ORDER BY lot_no DESC LIMIT 8', a.id)
      .map((l) => ({ lotNo: l.lot_no, player: pout.find((p) => p.id === l.player_id)?.name ?? '?', result: l.result, teamName: l.team_id ? teamName.get(l.team_id) ?? null : null, points: l.points })),
  };
}

/** The auctions page for a customer: those open to everyone, the ones they host, and the ones they play in. */
export function listForCustomer(u: UserRow) {
  const visible = many<ARow>("SELECT * FROM auctions WHERE hidden_at IS NULL AND status IN ('registration','live','completed') ORDER BY created_at DESC LIMIT 100");
  const mine = many<ARow>('SELECT * FROM auctions WHERE host_id = ? ORDER BY created_at DESC', u.id);
  const playing = many<ARow>("SELECT a.* FROM auctions a JOIN auction_players p ON p.auction_id = a.id WHERE p.user_id = ? AND p.status = 'registered' ORDER BY a.created_at DESC", u.id);
  const owning = many<ARow>('SELECT DISTINCT a.* FROM auctions a JOIN auction_teams t ON t.auction_id = a.id WHERE t.owner_user_id = ? AND t.removed_at IS NULL ORDER BY a.created_at DESC', u.id);
  const today = istDate(now());
  return {
    open: visible.filter((a) => (tourOf(a).end_date >= today || a.status !== 'completed') && depositSettled(a.id)).map((a) => summary(a, u)),
    hosting: mine.map((a) => summary(a, u)),
    playing: playing.filter((a) => !a.hidden_at && depositSettled(a.id)).map((a) => summary(a, u)),
    teamsYouOwn: owning.filter((a) => !a.hidden_at && depositSettled(a.id)).map((a) => summary(a, u)),
    depositPaise: getSettings().hostedTournamentDepositPaise, depositHowToPay: howToPay(),
    defaults: DEFAULT_RULES, defaultsInWords: rulesInWords(DEFAULT_RULES),
    grounds: many<{ id: string; name: string }>('SELECT id, name FROM grounds WHERE active = 1 ORDER BY name'),
    roles: ROLES.map((r) => ({ id: r, text: ROLE_WORDS[r] })), formats: FORMATS,
  };
}

/** Every auction tournament at one business, for the Desk. */
export function listForStaff(ownerId: string) {
  return many<ARow>('SELECT * FROM auctions WHERE owner_id = ? ORDER BY created_at DESC', ownerId).map((a) => ({ ...summary(a, null), hiddenReason: a.hidden_reason, hostId: a.host_id, deposit: depositState(a.id) }));
}

// ------------------------------------------------------------------ hosting

function hosted(u: UserRow, id: string): ARow {
  const a = row(id);
  if (!a || (a.hidden_at && a.host_id !== u.id)) throw notFound('Auction not found');
  if (a.host_id !== u.id) throw forbidden('Only the host can do this');
  if (a.hidden_at) throw conflict('AUCTION_HIDDEN', `The ground has hidden this auction${a.hidden_reason ? `: ${a.hidden_reason}` : ''}. Call the ground to sort it out.`);
  return a;
}
const needDeposit = (a: ARow): void => { if (!depositSettled(a.id)) throw conflict('DEPOSIT_DUE', 'Pay the hosting deposit (or ask the ground to waive it) first. Players see the tournament once it is settled.'); };
/** How a host pays the deposit: at the ground, or by UPI to the business with the reference sent from the tournament page. */
function howToPay() { const st = getSettings(); return { upiId: st.upiId || null, payee: st.upiPayee, contactName: st.contactName, contactPhone: st.contactPhone }; }
const needStatus = (a: ARow, ...ok: string[]): void => {
  if (!ok.includes(a.status)) throw conflict('AUCTION_WRONG_STAGE', a.status === 'registration' ? 'The bidding has not started yet.' : a.status === 'live' ? 'The bidding is already running.' : a.status === 'completed' ? 'This auction has finished.' : 'This auction was cancelled.');
};

export function createAuction(u: UserRow, src: unknown) {
  if (u.role !== 'customer') throw forbidden('Tournaments are hosted from a customer account');
  const v = new Validator(src);
  const mode = v.oneOf('mode', MODES) ?? 'auction';
  const name = v.str('name', { required: true, min: 3, max: 100 });
  const groundId = v.str('groundId', { required: true, max: 60 });
  const startDate = v.date('startDate', true), endDate = v.date('endDate', true);
  const format = v.oneOf('format', FORMATS) ?? 'round_robin';
  const overs = v.int('overs', { min: 1, max: 50 }) ?? 20;
  const rulesSrc = v.src.rules;
  v.done();
  const g = groundRow(groundId!);
  if (!g || !g.active) throw bad('groundId', 'Pick one of the grounds');
  const today = istDate(now());
  if (startDate! < today) throw bad('startDate', 'The start date has passed');
  if (endDate! < startDate!) throw bad('endDate', 'The end date cannot be before the start date');
  const rules = checkRules(rulesSrc, DEFAULT_RULES);
  if (rules.registrationCloses && rules.registrationCloses > endDate!) throw bad('rules.registrationCloses', 'Sign-up must close before the tournament ends');
  return tx(() => {
    const active = one<{ n: number }>("SELECT COUNT(*) n FROM auctions WHERE host_id = ? AND status IN ('registration','live')", u.id)!.n;
    if (active >= MAX_ACTIVE_HOSTED) throw conflict('TOO_MANY_AUCTIONS', `You can run ${MAX_ACTIVE_HOSTED} tournaments at a time. Finish or cancel one first.`);
    const actor = actorOf(u);
    const tid = insertTournament(actor, g.owner_id, { name: name!, startDate: startDate!, endDate: endDate!, format, overs, fee: 0, pw: 2, pt: 1, status: 'open', notes: mode === 'auction' ? 'Auction tournament hosted by a customer. Teams are picked at the player auction.' : 'Tournament hosted by a customer. Teams enter directly.',
      org: { first: u.first_name ?? fullName(u), last: u.last_name ?? '', phone: u.phone, email: u.email }, customerId: u.id });
    const id = newId('auc');
    run('INSERT INTO auctions(id, mode, owner_id, tournament_id, host_id, ground_id, rules, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)', id, mode, g.owner_id, tid, u.id, g.id, JSON.stringify(rules), now(), now());
    // the hosting deposit due is fixed now (Settings › hostedTournamentDepositPaise); the tournament stays hidden from players until it is paid or waived
    const deposit = getSettings().hostedTournamentDepositPaise;
    openDeposit(id, g.owner_id, u.id, deposit);
    audit(actor, 'auction.create', 'auction', id, { name, mode, tournamentId: tid, depositPaise: deposit }, g.owner_id);
    if (deposit > 0) pushStaffOf(g.owner_id, 'auction_deposit_due', 'Tournament waiting for its deposit', `${fullName(u)} is hosting "${name}". It opens to players once the hosting deposit is paid or waived.`);
    return auctionView(u, id);
  });
}

export function updateAuction(u: UserRow, id: string, src: unknown) {
  const a = hosted(u, id);
  needStatus(a, 'registration');
  const v = new Validator(src);
  const name = v.str('name', { min: 3, max: 100 });
  const startDate = v.date('startDate'), endDate = v.date('endDate');
  const format = v.oneOf('format', FORMATS);
  const overs = v.int('overs', { min: 1, max: 50 });
  v.done();
  const t = tourOf(a);
  const s = startDate ?? t.start_date, e = endDate ?? t.end_date;
  if (startDate && startDate < istDate(now())) throw bad('startDate', 'The start date has passed');
  if (e < s) throw bad('endDate', 'The end date cannot be before the start date');
  tx(() => {
    run('UPDATE tournaments SET name = ?, start_date = ?, end_date = ?, format = ?, overs = ?, updated_at = ?, updated_by = ? WHERE id = ?', name ?? t.name, s, e, format ?? t.format, overs ?? t.overs, now(), u.id, t.id);
    bump(a.id);
  });
  audit(actorOf(u), 'auction.update', 'auction', a.id, Object.keys(v.src), a.owner_id);
  return auctionView(u, id);
}

/** Saves new rules the host confirmed, from the form or from Platform AI's draft. `expectVersion` stops two edits overwriting each other. */
export function saveRules(u: UserRow, id: string, src: unknown) {
  const a = hosted(u, id);
  needStatus(a, 'registration');
  const v = new Validator(src);
  const expect = v.int('expectVersion', { required: true, min: 1 });
  const source = v.oneOf('source', ['form', 'ai'] as const) ?? 'form';
  const request = v.str('request', { max: 600 });
  const rulesSrc = v.src.rules;
  v.done();
  if (expect !== a.rules_version) throw conflict('RULES_CHANGED', 'The rules were changed since you opened them. Look at the new rules and try again.', { rulesVersion: a.rules_version });
  const before = rulesOf(a);
  const after = checkRules(rulesSrc, before);
  const t = tourOf(a);
  if (after.registrationCloses && after.registrationCloses > t.end_date) throw bad('rules.registrationCloses', 'Sign-up must close before the tournament ends');
  const changes = diffRules(before, after);
  if (!changes.length) return { ...auctionView(u, id), changes };
  tx(() => {
    const cur = row(id)!;
    if (cur.rules_version !== expect) throw conflict('RULES_CHANGED', 'The rules were changed since you opened them. Look at the new rules and try again.', { rulesVersion: cur.rules_version });
    run('UPDATE auctions SET rules = ?, rules_version = rules_version + 1 WHERE id = ?', JSON.stringify(after), id);
    run('INSERT INTO auction_rule_changes(id, auction_id, version, before_rules, after_rules, source, request, changed_by, changed_at) VALUES(?,?,?,?,?,?,?,?,?)',
      newId('arc'), id, expect + 1, JSON.stringify(before), JSON.stringify(after), source, request ?? null, u.id, now());
    bump(id);
  });
  audit(actorOf(u), 'auction.rules', 'auction', id, { source, fields: changes.map((c) => c.field) }, a.owner_id);
  return { ...auctionView(u, id), changes };
}

/** Platform AI's draft of a rule change in plain words. Nothing is saved: the host confirms it with saveRules. */
export function draftRules(u: UserRow, id: string, src: unknown, via: 'typed' | 'voice' = 'typed'): RuleDraft & { rulesVersion: number } {
  const a = hosted(u, id);
  needStatus(a, 'registration');
  const v = new Validator(src);
  const text = v.str('text', { required: true, max: 600 });
  v.done();
  const d = draftRuleChange(rulesOf(a), text, istDate(now()));
  audit(actorOf(u), 'auction.rules_draft', 'auction', id, { request: text!.slice(0, 200), understood: d.understood, refused: d.refused, ...(via === 'voice' ? { via } : {}) }, a.owner_id);
  return { ...d, rulesVersion: a.rules_version };
}

export function ruleHistory(u: UserRow, id: string) {
  hosted(u, id);
  return many<{ version: number; source: string; request: string | null; changed_at: number; before_rules: string; after_rules: string }>('SELECT version, source, request, changed_at, before_rules, after_rules FROM auction_rule_changes WHERE auction_id = ? ORDER BY version DESC', id)
    .map((c) => ({ version: c.version, source: c.source, request: c.request, changedAt: c.changed_at, changes: diffRules(checkRules(JSON.parse(c.before_rules)), checkRules(JSON.parse(c.after_rules))) }));
}

// ------------------------------------------------------------------ teams

/** Finds the customer account a team owner is, by phone or email. A team without one is bid for by the host. */
function ownerAccount(src: Record<string, unknown>): UserRow | null {
  const phone = typeof src.ownerPhone === 'string' && src.ownerPhone.trim() ? normalizePhone(src.ownerPhone) : null;
  const email = typeof src.ownerEmail === 'string' && src.ownerEmail.trim() ? src.ownerEmail.trim().toLowerCase() : null;
  if (!phone && !email) return null;
  const u = one<UserRow>("SELECT * FROM users WHERE role = 'customer' AND active = 1 AND (phone = ? OR lower(email) = ?) LIMIT 1", phone ?? '', email ?? '');
  if (!u) throw bad(phone ? 'ownerPhone' : 'ownerEmail', 'Nobody with a Daji account has that phone or email. They can sign up first, or leave it empty and you bid for the team.');
  return u;
}

export function addAuctionTeam(u: UserRow, id: string, src: unknown) {
  const a = hosted(u, id);
  needStatus(a, 'registration');
  const v = new Validator(src);
  const name = v.str('name', { required: true, min: 2, max: 50 });
  const ownerName = v.str('ownerName', { max: 80 });
  v.str('ownerPhone', { max: 20 }); v.str('ownerEmail', { max: 120 });
  v.done();
  const r = rulesOf(a);
  const owner = ownerAccount(v.src);
  return tx(() => {
    const teams = teamsOf(id);
    if (teams.length >= r.teamCount) throw bad('name', `The rules say ${r.teamCount} teams. Change the number of teams in the rules first.`);
    if (teams.some((t) => t.name.toLowerCase() === name!.toLowerCase())) throw bad('name', 'Another team has that name');
    if (owner && teams.some((t) => t.owner_user_id === owner.id)) throw bad('ownerPhone', 'That person already owns a team in this auction');
    const tid = newId('atm');
    run('INSERT INTO auction_teams(id, auction_id, name, owner_user_id, owner_name, created_at) VALUES(?,?,?,?,?,?)', tid, id, name!, owner?.id ?? null, ownerName ?? (owner ? fullName(owner) : null), now());
    bump(id);
    audit(actorOf(u), 'auction.team_add', 'auction', id, { team: name, ownerAccount: !!owner }, a.owner_id);
    if (owner && owner.id !== u.id) pushNotify(owner.id, 'auction_team_owner', 'You own a team', `You own ${name} in the ${tourOf(a).name} auction. You can bid for players from the app when the auction runs.`);
    return auctionView(u, id);
  });
}

export function updateAuctionTeam(u: UserRow, id: string, teamId: string, src: unknown) {
  const a = hosted(u, id);
  needStatus(a, 'registration');
  const t = teamsOf(id).find((x) => x.id === teamId);
  if (!t) throw notFound('Team not found');
  const v = new Validator(src);
  const name = v.str('name', { min: 2, max: 50 });
  const ownerName = v.has('ownerName') ? v.str('ownerName', { max: 80 }) ?? '' : undefined;
  v.str('ownerPhone', { max: 20 }); v.str('ownerEmail', { max: 120 });
  const clearOwner = v.bool('clearOwner') ?? false;
  v.done();
  const owner = clearOwner ? null : ownerAccount(v.src);
  if (name && teamsOf(id).some((x) => x.id !== teamId && x.name.toLowerCase() === name.toLowerCase())) throw bad('name', 'Another team has that name');
  if (owner && teamsOf(id).some((x) => x.id !== teamId && x.owner_user_id === owner.id)) throw bad('ownerPhone', 'That person already owns a team in this auction');
  const ownerId = clearOwner ? null : owner?.id ?? t.owner_user_id;
  run('UPDATE auction_teams SET name = ?, owner_user_id = ?, owner_name = ? WHERE id = ?', name ?? t.name, ownerId, ownerName === undefined ? (owner ? fullName(owner) : t.owner_name) : ownerName || null, teamId);
  bump(id);
  audit(actorOf(u), 'auction.team_update', 'auction', id, { teamId, fields: Object.keys(v.src) }, a.owner_id);
  return auctionView(u, id);
}

export function removeAuctionTeam(u: UserRow, id: string, teamId: string) {
  const a = hosted(u, id);
  needStatus(a, 'registration');
  if (!teamsOf(id).some((x) => x.id === teamId)) throw notFound('Team not found');
  run('UPDATE auction_teams SET removed_at = ?, removed_by = ? WHERE id = ?', now(), u.id, teamId);
  bump(id);
  audit(actorOf(u), 'auction.team_remove', 'auction', id, { teamId }, a.owner_id);
  return auctionView(u, id);
}

// ------------------------------------------------------------------ players sign up with their own profile

export function joinAuction(u: UserRow, id: string, src: unknown) {
  if (u.role !== 'customer') throw forbidden('Players sign up from a customer account');
  const a = row(id);
  if (!a || a.hidden_at || !depositSettled(a.id)) throw notFound('Auction not found');
  if (a.mode !== 'auction') throw conflict('NOT_AN_AUCTION', 'Teams enter this tournament directly. Ask the host to add your team.');
  const v = new Validator(src);
  const role = v.oneOf('role', ROLES, true);
  const batting = v.oneOf('batting', ['right', 'left'] as const);
  const bowling = v.str('bowling', { max: 40 });
  const note = v.str('note', { max: 200 });
  v.done();
  if (!u.first_name && !u.name) throw bad('profile', 'Add your name to your profile first');
  return tx(() => {
    const cur = row(id)!;
    const r = rulesOf(cur);
    const count = one<{ n: number }>("SELECT COUNT(*) n FROM auction_players WHERE auction_id = ? AND status = 'registered'", id)!.n;
    const had = one<{ id: string; status: string }>('SELECT id, status FROM auction_players WHERE auction_id = ? AND user_id = ?', id, u.id);
    if (had?.status === 'registered') throw conflict('ALREADY_JOINED', 'You have already signed up for this auction');
    if (had?.status === 'removed') throw conflict('REMOVED_BY_HOST', 'The host took you off this auction. Talk to the host if that is a mistake.');
    if (!signUpOpen(cur, r, count)) throw conflict('SIGN_UP_CLOSED', cur.status !== 'registration' ? 'Sign-up has closed: the bidding has started.' : r.maxPlayers !== null && count >= r.maxPlayers ? 'This auction is full.' : 'Sign-up for this auction has closed.');
    if (had) run("UPDATE auction_players SET status = 'registered', role = ?, batting = ?, bowling = ?, note = ?, removed_reason = NULL, updated_at = ?, updated_by = ? WHERE id = ?", role!, batting ?? null, bowling ?? null, note ?? null, now(), u.id, had.id);
    else run('INSERT INTO auction_players(id, auction_id, user_id, role, batting, bowling, note, created_at, updated_at, updated_by) VALUES(?,?,?,?,?,?,?,?,?,?)', newId('apl'), id, u.id, role!, batting ?? null, bowling ?? null, note ?? null, now(), now(), u.id);
    bump(id);
    audit(actorOf(u), 'auction.join', 'auction', id, { role }, cur.owner_id);
    return auctionView(u, id);
  });
}

export function leaveAuction(u: UserRow, id: string) {
  const a = row(id);
  if (!a || a.hidden_at) throw notFound('Auction not found');
  needStatus(a, 'registration');
  const p = one<{ id: string }>("SELECT id FROM auction_players WHERE auction_id = ? AND user_id = ? AND status = 'registered'", id, u.id);
  if (!p) throw notFound('You are not signed up for this auction');
  run("UPDATE auction_players SET status = 'withdrawn', updated_at = ?, updated_by = ? WHERE id = ?", now(), u.id, p.id);
  bump(id);
  audit(actorOf(u), 'auction.leave', 'auction', id, null, a.owner_id);
  return auctionView(u, id);
}

export function removePlayer(u: UserRow, id: string, playerId: string, src: unknown) {
  const a = hosted(u, id);
  needStatus(a, 'registration');
  const v = new Validator(src ?? {});
  const reason = v.str('reason', { required: true, min: 3, max: 200 });
  v.done();
  const p = one<{ id: string; user_id: string }>("SELECT id, user_id FROM auction_players WHERE id = ? AND auction_id = ? AND status = 'registered'", playerId, id);
  if (!p) throw notFound('Player not found');
  run("UPDATE auction_players SET status = 'removed', removed_reason = ?, updated_at = ?, updated_by = ? WHERE id = ?", reason!, now(), u.id, playerId);
  bump(id);
  audit(actorOf(u), 'auction.player_remove', 'auction', id, { playerId, reason }, a.owner_id);
  return auctionView(u, id);
}

// ------------------------------------------------------------------ the bidding

export function startBidding(u: UserRow, id: string) {
  const a = hosted(u, id);
  needStatus(a, 'registration');
  if (a.mode !== 'auction') throw conflict('NOT_AN_AUCTION', 'Teams enter this tournament directly; there is no bidding. Confirm the teams instead.');
  needDeposit(a);
  const r = rulesOf(a), teams = teamsOf(id);
  const players = one<{ n: number }>("SELECT COUNT(*) n FROM auction_players WHERE auction_id = ? AND status = 'registered'", id)!.n;
  if (teams.length < 2) throw conflict('NEED_TEAMS', 'Add at least two teams before the bidding starts');
  if (players < teams.length) throw conflict('NEED_PLAYERS', `At least ${teams.length} players must sign up first (one for each team). ${players} have so far.`);
  run("UPDATE auctions SET status = 'live', started_at = ?, round = 1 WHERE id = ? AND status = 'registration'", now(), id);
  run("UPDATE tournaments SET status = 'running', updated_at = ?, updated_by = ? WHERE id = ?", now(), u.id, a.tournament_id);
  bump(id);
  audit(actorOf(u), 'auction.start', 'auction', id, { teams: teams.length, players, squadMin: r.squadMin }, a.owner_id);
  return auctionView(u, id);
}

/** Brings the next player up (or the one the host names). Only when no player is up. */
export function nextPlayer(u: UserRow, id: string, src: unknown) {
  const a = hosted(u, id);
  needStatus(a, 'live');
  const v = new Validator(src ?? {});
  const pick = v.str('playerId', { max: 60 });
  v.done();
  return tx(() => {
    const cur = row(id)!;
    if (cur.current_player_id) throw conflict('PLAYER_UP', 'A player is already up. Bring the hammer down first.');
    const r = rulesOf(cur), players = playersOf(id), lots = standingLots(id);
    let choice: { player: PRow; round: number } | null;
    if (pick) {
      const p = players.find((x) => x.id === pick && x.status === 'registered');
      if (!p) throw notFound('Player not found');
      const l = lots.get(p.id);
      if (l?.result === 'sold') throw conflict('ALREADY_SOLD', 'That player is already in a team');
      choice = { player: p, round: l ? 2 : cur.round };
    } else choice = nextInPool(cur, r, players, lots);
    if (!choice) throw conflict('POOL_EMPTY', 'Every player has come up. Finish the auction.');
    run('UPDATE auctions SET current_player_id = ?, lot_no = lot_no + 1, round = ?, lot_started_at = ? WHERE id = ?', choice.player.id, Math.max(cur.round, choice.round), now(), id);
    bump(id);
    return auctionView(u, id);
  });
}

/** A bid by the host for any team, or by a team's owner for their own team. Points only. */
export function placeBid(u: UserRow, id: string, src: unknown, via: 'typed' | 'voice' = 'typed') {
  const a0 = row(id);
  if (!a0 || a0.hidden_at) throw notFound('Auction not found');
  const v = new Validator(src);
  const teamId = v.str('teamId', { required: true, max: 60 });
  const points = v.int('points', { required: true, min: 1, max: 100_000_000 });
  const lotNo = v.int('lotNo', { min: 1 });
  v.done();
  return tx(() => {
    const a = row(id)!;
    needStatus(a, 'live');
    if (!a.current_player_id) throw conflict('NO_PLAYER_UP', 'No player is up for bidding right now');
    if (lotNo !== undefined && lotNo !== a.lot_no) throw conflict('LOT_CLOSED', 'The bidding for that player has closed');
    const r = rulesOf(a), players = playersOf(id), lots = standingLots(id);
    const team = teamStates(a, r, u, players, lots).find((t) => t.id === teamId);
    if (!team) throw notFound('Team not found');
    const isHost = u.id === a.host_id;
    if (!isHost && !team.ownerIsYou) throw forbidden('Only the team owner or the host can bid for this team');
    const bids = liveBids(id, a.lot_no), top = bids[0] ?? null;
    if (top?.team_id === teamId) throw conflict('ALREADY_TOP', `${team.name} already has the highest bid`);
    const min = nextMinimum(r, top?.points ?? null);
    if (points! < min) throw conflict('BID_TOO_LOW', `The bid must be at least ${min.toLocaleString('en-IN')} points`, { nextMinimumPoints: min });
    if (team.full) throw conflict('SQUAD_FULL', `${team.name} already has ${r.squadMax} players`);
    if (points! > team.maxBidPoints) throw conflict('OVER_PURSE', r.reserveForSquad
      ? `${team.name} can bid at most ${team.maxBidPoints.toLocaleString('en-IN')} points and still fill its squad`
      : `${team.name} has only ${team.pursePointsLeft.toLocaleString('en-IN')} points left`, { maxBidPoints: team.maxBidPoints });
    run('INSERT INTO auction_bids(id, auction_id, lot_no, player_id, team_id, points, placed_by, placed_at, via) VALUES(?,?,?,?,?,?,?,?,?)', newId('abd'), id, a.lot_no, a.current_player_id, teamId!, points!, u.id, now(), isHost ? 'host' : via === 'voice' ? 'voice' : 'owner');
    bump(id);
    return auctionView(u, id);
  });
}

/** Takes back the highest bid on the player who is up (a mistake in the room). Kept in the record as retracted. */
export function retractBid(u: UserRow, id: string) {
  const a = hosted(u, id);
  needStatus(a, 'live');
  const top = a.current_player_id ? liveBids(id, a.lot_no)[0] : undefined;
  if (!top) throw conflict('NO_BID', 'There is no bid to take back');
  run('UPDATE auction_bids SET retracted_at = ?, retracted_by = ? WHERE id = ?', now(), u.id, top.id);
  bump(id);
  audit(actorOf(u), 'auction.bid_retract', 'auction', id, { lotNo: a.lot_no, points: top.points }, a.owner_id);
  return auctionView(u, id);
}

/** The hammer: the player goes to the highest bid, or is unsold when nobody bid. */
export function hammer(u: UserRow, id: string) {
  const a0 = hosted(u, id);
  needStatus(a0, 'live');
  const out = tx(() => {
    const a = row(id)!;
    if (!a.current_player_id) throw conflict('NO_PLAYER_UP', 'No player is up for bidding right now');
    const top = liveBids(id, a.lot_no)[0] ?? null;
    const p = playersOf(id).find((x) => x.id === a.current_player_id)!;
    const round = standingLots(id).get(p.id) ? 2 : a.round;
    run('INSERT INTO auction_lots(id, auction_id, lot_no, round, player_id, result, team_id, points, decided_by, decided_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
      newId('alt'), id, a.lot_no, round, p.id, top ? 'sold' : 'unsold', top?.team_id ?? null, top?.points ?? null, u.id, now());
    run('UPDATE auctions SET current_player_id = NULL, lot_started_at = NULL WHERE id = ?', id);
    bump(id);
    return { p, top };
  });
  audit(actorOf(u), 'auction.hammer', 'auction', id, { playerId: out.p.id, sold: !!out.top, teamId: out.top?.team_id ?? null, points: out.top?.points ?? null }, a0.owner_id);
  if (out.top) {
    const team = teamsOf(id).find((t) => t.id === out.top!.team_id);
    pushNotify(out.p.user_id, 'auction_sold', 'You were picked', `${team?.name ?? 'A team'} picked you for ${out.top.points.toLocaleString('en-IN')} points in the ${tourOf(a0).name} auction.`);
  }
  return auctionView(u, id);
}

/** Undoes the last result (a sale or unsold) so that player can come up again. The undone result stays in the record. */
export function undoLast(u: UserRow, id: string) {
  const a = hosted(u, id);
  needStatus(a, 'live');
  if (a.current_player_id) throw conflict('PLAYER_UP', 'A player is up. Bring the hammer down before undoing the last result.');
  const last = one<LotRow>('SELECT id, lot_no, round, player_id, result, team_id, points, decided_at FROM auction_lots WHERE auction_id = ? AND undone_at IS NULL ORDER BY lot_no DESC LIMIT 1', id);
  if (!last) throw conflict('NOTHING_TO_UNDO', 'Nothing has been decided yet');
  run('UPDATE auction_lots SET undone_at = ?, undone_by = ? WHERE id = ?', now(), u.id, last.id);
  bump(id);
  audit(actorOf(u), 'auction.undo', 'auction', id, { lotNo: last.lot_no, playerId: last.player_id, result: last.result, points: last.points }, a.owner_id);
  return auctionView(u, id);
}

/** Ends the bidding. The teams go into the tournament, so fixtures and results work as for any tournament. */
export function finishAuction(u: UserRow, id: string) {
  const a = hosted(u, id);
  if (a.mode === 'teams') { needStatus(a, 'registration'); needDeposit(a); if (teamsOf(id).length < 2) throw conflict('NEED_TEAMS', 'Add at least two teams first'); }
  else needStatus(a, 'live');
  if (a.current_player_id) throw conflict('PLAYER_UP', 'A player is up. Bring the hammer down first.');
  const r = rulesOf(a), lots = standingLots(id);
  const states = teamStates(a, r, u, playersOf(id), lots);
  const short = a.mode === 'auction' ? states.filter((t) => t.squad < r.squadMin) : [];
  tx(() => {
    const actor = actorOf(u);
    for (const t of teamsOf(id)) {
      const made = addTeam(actor, a.owner_id, a.tournament_id, { name: t.name, ...(t.owner_name ? { captain: t.owner_name } : {}) });
      run('UPDATE auction_teams SET tournament_team_id = ? WHERE id = ?', made.id, t.id);
    }
    run("UPDATE auctions SET status = 'completed', finished_at = ? WHERE id = ?", now(), id);
    if (a.mode === 'teams') run("UPDATE tournaments SET status = 'running', updated_at = ?, updated_by = ? WHERE id = ?", now(), u.id, a.tournament_id);
    bump(id);
  });
  audit(actorOf(u), 'auction.finish', 'auction', id, { teams: states.length, sold: [...lots.values()].filter((l) => l.result === 'sold').length, shortTeams: short.map((t) => t.name) }, a.owner_id);
  return { ...auctionView(u, id), shortTeams: short.map((t) => ({ name: t.name, squad: t.squad, needed: r.squadMin })) };
}

export function cancelAuction(u: UserRow, id: string, src: unknown) {
  const a = hosted(u, id);
  needStatus(a, 'registration', 'live');
  const v = new Validator(src ?? {});
  const reason = v.str('reason', { required: true, min: 3, max: 200 });
  v.done();
  tx(() => {
    run("UPDATE auctions SET status = 'cancelled', cancelled_reason = ?, current_player_id = NULL WHERE id = ?", reason!, id);
    run("UPDATE tournaments SET status = 'cancelled', updated_at = ?, updated_by = ? WHERE id = ?", now(), u.id, a.tournament_id);
    bump(id);
  });
  audit(actorOf(u), 'auction.cancel', 'auction', id, { reason }, a.owner_id);
  for (const p of many<{ user_id: string }>("SELECT user_id FROM auction_players WHERE auction_id = ? AND status = 'registered'", id)) pushNotify(p.user_id, 'auction_cancelled', 'Auction cancelled', `The ${tourOf(a).name} auction was cancelled by the host.`);
  return auctionView(u, id);
}

/** Round-robin fixtures for the finished auction's teams, through the Tournaments module. The ground is booked the normal way. */
export function auctionFixtures(u: UserRow, id: string, src: unknown) {
  const a = hosted(u, id);
  needStatus(a, 'completed');
  const v = new Validator(src ?? {});
  const startDate = v.date('startDate'), time = v.time('time'), gap = v.int('daysBetweenRounds', { min: 0, max: 60 }), doubleRound = v.bool('doubleRound'), replace = v.bool('replace');
  v.done();
  const out = generateFixtures(actorOf(u), a.owner_id, a.tournament_id, { ...(startDate ? { startDate } : {}), ...(time ? { time } : {}), ...(gap !== undefined ? { daysBetweenRounds: gap } : {}), ...(doubleRound !== undefined ? { doubleRound } : {}), ...(replace !== undefined ? { replace } : {}) });
  bump(id);
  return { ...out, note: 'Book the ground for your match days on the Book page. The fixtures do not reserve the ground by themselves.' };
}

/** The tournament after the auction: teams, fixtures and points table, for anyone who can see the auction. */
export function auctionTournament(viewer: UserRow, id: string) {
  const a = row(id);
  if (!a || (a.hidden_at && a.host_id !== viewer.id)) throw notFound('Auction not found');
  const d = tournamentDetail(a.owner_id, a.tournament_id);
  return { teams: d.teams.map((t) => ({ id: t.id, name: t.name, captain: t.captain })), fixtures: d.fixtures.map((f) => ({ id: f.id, round: f.round, teamA: f.teamA, teamB: f.teamB, startsAt: f.startsAt, played: f.played, winner: f.winner, resultText: f.resultText })), table: d.table };
}

// ------------------------------------------------------------------ the ground's staff

export function hideAuction(actor: Actor, ownerId: string, id: string, src: unknown) {
  const a = row(id);
  if (!a || a.owner_id !== ownerId) throw notFound('Auction not found');
  const v = new Validator(src ?? {});
  const reason = v.str('reason', { required: true, min: 3, max: 200 });
  v.done();
  run('UPDATE auctions SET hidden_at = ?, hidden_by = ?, hidden_reason = ? WHERE id = ?', now(), actor.id, reason!, id);
  bump(id);
  audit(actor, 'auction.hide', 'auction', id, { reason }, ownerId);
  pushNotify(a.host_id, 'auction_hidden', 'Auction hidden', `The ground has hidden your ${tourOf(a).name} auction: ${reason}`);
  return { ...summary(row(id)!, null), hiddenReason: reason };
}
export function unhideAuction(actor: Actor, ownerId: string, id: string) {
  const a = row(id);
  if (!a || a.owner_id !== ownerId) throw notFound('Auction not found');
  run('UPDATE auctions SET hidden_at = NULL, hidden_by = NULL, hidden_reason = NULL WHERE id = ?', id);
  bump(id);
  audit(actor, 'auction.unhide', 'auction', id, null, ownerId);
  return { ...summary(row(id)!, null), hiddenReason: null };
}

// ------------------------------------------------------------------ for Ask AI

/** What Ask AI tells a customer about auctions: the ones they host, play in or own a team in, and the ones open to join. */
export function customerAuctionFacts(u: UserRow) {
  const l = listForCustomer(u);
  const picks = many<{ auction_id: string; name: string; result: string | null; team: string | null; points: number | null; status: string }>(`
    SELECT p.auction_id, tn.name, l.result, t.name team, l.points, a.status FROM auction_players p
    JOIN auctions a ON a.id = p.auction_id JOIN tournaments tn ON tn.id = a.tournament_id
    LEFT JOIN auction_lots l ON l.player_id = p.id AND l.undone_at IS NULL AND l.lot_no = (SELECT MAX(lot_no) FROM auction_lots WHERE player_id = p.id AND undone_at IS NULL)
    LEFT JOIN auction_teams t ON t.id = l.team_id
    WHERE p.user_id = ? AND p.status = 'registered' AND a.hidden_at IS NULL ORDER BY a.created_at DESC`, u.id);
  return { ...l, picks };
}

/** The current rules of the one auction a customer hosts that can still change, for "change the rules" asked through Ask AI. */
export function editableHosted(u: UserRow): { id: string; name: string; rules: AuctionRules }[] {
  return many<ARow>("SELECT * FROM auctions WHERE host_id = ? AND status = 'registration' AND hidden_at IS NULL ORDER BY created_at DESC", u.id).map((a) => ({ id: a.id, name: tourOf(a).name, rules: rulesOf(a) }));
}

/** Auction tournaments at a business, for staff Ask AI: read-only counts, no player contact details. */
export function staffAuctionFacts(ownerId: string) {
  return listForStaff(ownerId).map((s) => ({ name: s.name, kind: s.mode === 'auction' ? 'player auction' : 'teams enter directly', status: s.statusText, host: s.hostName, from: s.startDate, to: s.endDate, teams: s.teams, players: s.players, sold: s.sold, hidden: s.hidden,
    depositDuePaise: s.deposit.settled ? 0 : s.deposit.requiredPaise - s.deposit.collectedPaise, depositHeldPaise: s.deposit.heldPaise, depositWaived: s.deposit.waived, waiverWaiting: s.deposit.waiver?.status === 'pending' }));
}

/** The rules of one auction in words, for Ask AI. */
export function rulesWordsOf(id: string): string[] { const a = row(id); return a ? rulesInWords(rulesOf(a), a.mode) : []; }
