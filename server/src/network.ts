import { many, one, registerSchema, run, tx } from './db.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { HttpError, conflict, forbidden, notFound } from './errors.ts';
import { Validator } from './input.ts';
import { audit } from './audit.ts';
import { hasPermission, scopeOwnerId, type UserRow } from './auth.ts';
import { businessName } from './businesses.ts';
import { ownsCustomer } from './contacts.ts';
import { forgetPlayerLinks, linesOf, playedAt, sumUp, type Career } from './playerStats.ts';
import { nameKey, type MatchRow } from './matches.ts';
import { istDate } from './time.ts';

// The cricket network (redesign brief, "shared players and tournaments"; addendum section 7). Participating grounds stay separate
// businesses: each keeps its own bookings, payments, staff, private records and books. What they share is explicit:
//  - a business joins the network itself (owner only), and only members can organise or host network tournaments (netTournaments.ts);
//  - a player is still one Daji profile (the customer account) at every ground, as before. What was already shared before this
//    (checked 30 Oct 2026, playerStats.ts): the player sees their own record from every ground; a business sees only the matches scored
//    at its own grounds. Nothing else crossed between businesses, and that stays the default ("private");
//  - a player may choose to share their cricket profile with the network or with everyone. Shared means exactly SHARED_FIELDS: never a
//    phone, email, date of birth, booking, payment, credit, check-in, academy record or anything about money;
//  - possible duplicate profiles are suggested (a guest name on a scorecard that matches a profile) and only linked when the player and
//    the staff of the business that scored the match both say yes. Nothing is merged automatically;
//  - children's profiles are made by a parent or guardian and only exist while the software owner has switched them on. They are a
//    dedicated item for legal and product review (addendum section 7): the switch ships OFF and turning it on asks for a reference to that
//    review. A child is never public; sharing with the network needs the guardian's recorded consent, and withdrawing it takes effect at once.
// Nothing here posts money or reads any business's books.

registerSchema('cricket-network-1', `
CREATE TABLE network_members (
  owner_id TEXT PRIMARY KEY REFERENCES users(id),
  joined_at INTEGER NOT NULL,
  joined_by TEXT,
  left_at INTEGER,
  left_by TEXT
);

CREATE TABLE network_platform (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  child_profiles_on INTEGER NOT NULL DEFAULT 0,
  legal_review_ref TEXT,
  updated_by TEXT,
  updated_at INTEGER
);

CREATE TABLE player_sharing (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','network','public')),
  playing_role TEXT,
  batting_style TEXT,
  bowling_style TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE child_profiles (
  child_id TEXT PRIMARY KEY REFERENCES users(id),
  guardian_id TEXT NOT NULL REFERENCES users(id),
  born_on TEXT NOT NULL,
  player_code TEXT NOT NULL UNIQUE,
  guardian_declared_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  removed_at INTEGER
);
CREATE INDEX ix_child_profiles_guardian ON child_profiles(guardian_id);

CREATE TABLE child_consents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id TEXT NOT NULL REFERENCES users(id),
  guardian_id TEXT NOT NULL REFERENCES users(id),
  scope TEXT NOT NULL CHECK (scope IN ('play_record','network_share')),
  given INTEGER NOT NULL CHECK (given IN (0,1)),
  wording TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX ix_child_consents_child ON child_consents(child_id, scope, id);
CREATE TRIGGER trg_ao_child_consents_update BEFORE UPDATE ON child_consents BEGIN SELECT RAISE(ABORT, 'child_consents is append-only: update refused'); END;
CREATE TRIGGER trg_ao_child_consents_delete BEFORE DELETE ON child_consents BEGIN SELECT RAISE(ABORT, 'child_consents is append-only: delete refused'); END;

CREATE TABLE profile_claims (
  id TEXT PRIMARY KEY,
  match_player_id TEXT NOT NULL REFERENCES match_players(id),
  match_id TEXT NOT NULL REFERENCES matches(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  raised_by TEXT NOT NULL CHECK (raised_by IN ('player','staff')),
  player_ok_at INTEGER,
  staff_ok_at INTEGER,
  staff_ok_by TEXT,
  closed_at INTEGER,
  closed_by TEXT,
  outcome TEXT CHECK (outcome IN ('linked','declined','refused','gone')),
  reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX uq_profile_claims_open ON profile_claims(match_player_id, user_id) WHERE closed_at IS NULL;
CREATE INDEX ix_profile_claims_owner ON profile_claims(owner_id, closed_at);
CREATE INDEX ix_profile_claims_user ON profile_claims(user_id, closed_at);
`);

export const VISIBILITIES = ['private', 'network', 'public'] as const;
export type Visibility = (typeof VISIBILITIES)[number];
/** Exactly what a shared cricket profile shows. Everything else stays with the business that holds it. */
export const SHARED_FIELDS = ['Display name (a child: first name and the first letter of the last name)', 'Playing role, batting style and bowling style, if the player fills them in', 'Career batting, bowling and fielding from eligible matches', 'Each eligible match: date, ground, competition, team, opponent, result and the player\'s own line'];
export const NEVER_SHARED = ['Phone number and email', 'Date of birth', 'Bookings, payments, receipts and credits at any ground', 'Check-ins and where the phone was', 'Academy records, fees and progress', 'Anything a business keeps in its own books'];
/** An eligible match: finished and scored ball by ball, and for a network tournament fixture, its result verified. */
export const ELIGIBLE_RULE = 'A match counts when it is finished and scored ball by ball. A network tournament match counts only after its result is verified.';
/** People under this age are children: their profile is made and run by a parent or guardian. */
export const CHILD_AGE = 18;
/** The words a guardian agrees to. Stored with each consent, so a later change of wording never rewrites what was agreed. */
export const CONSENT_WORDING: Record<'play_record' | 'network_share', string> = {
  play_record: 'v1: I am the parent or legal guardian of this child. I agree that grounds may add my child to match squads and keep my child\'s match record on this profile.',
  network_share: 'v1: I agree that my child\'s cricket profile (first name, last initial and match record only) may be seen by staff of grounds in the cricket network. It is never public.',
};
export const LEGAL_REVIEW_NOTE = 'Children\'s profiles and consent are waiting for legal and product review. They stay switched off until the software owner records that review and switches them on.';

const bad = (field: string, message: string) => new HttpError(400, 'VALIDATION_FAILED', message, { fields: [{ field, message }] });

// ------------------------------------------------------------------ membership

export const isMember = (ownerId: string): boolean => !!one('SELECT 1 FROM network_members WHERE owner_id = ? AND left_at IS NULL', ownerId);
export function requireMember(ownerId: string): void {
  if (!isMember(ownerId)) throw conflict('NOT_IN_NETWORK', 'This business has not joined the cricket network. The owner can join it in Cricket network.');
}
/** Staff who run cricket at a business: the owner, or a team member with manage_matches. */
export function requireCricketStaff(u: UserRow): void {
  if (!hasPermission(u, 'manage_matches')) throw forbidden('This needs the "manage_matches" permission');
}

export function networkStatus(u: UserRow, ownerId: string) {
  const mine = one<{ joined_at: number }>('SELECT joined_at FROM network_members WHERE owner_id = ? AND left_at IS NULL', ownerId);
  const members = mine ? many<{ owner_id: string; joined_at: number }>('SELECT owner_id, joined_at FROM network_members WHERE left_at IS NULL ORDER BY joined_at').map((m) => ({
    ownerId: m.owner_id, name: businessName(m.owner_id), joinedAt: m.joined_at, isMe: m.owner_id === ownerId,
    grounds: many<{ id: string; name: string; city: string }>('SELECT id, name, city FROM grounds WHERE owner_id = ? AND active = 1 ORDER BY name', m.owner_id),
  })) : [];
  return {
    joined: !!mine, joinedAt: mine?.joined_at ?? null, canChange: u.role === 'owner' || u.role === 'super_admin', members,
    sharedFields: SHARED_FIELDS, neverShared: NEVER_SHARED, eligibleRule: ELIGIBLE_RULE,
    note: 'Each business keeps its own bookings, payments, staff, private records and books. Joining shares nothing about them.',
    childProfiles: platformState(),
  };
}

export function joinNetwork(u: UserRow, ownerId: string) {
  if (u.role !== 'owner' && u.role !== 'super_admin') throw forbidden('Only the owner can join the cricket network');
  if (isMember(ownerId)) return networkStatus(u, ownerId);
  tx(() => {
    run('INSERT INTO network_members(owner_id, joined_at, joined_by) VALUES(?,?,?) ON CONFLICT(owner_id) DO UPDATE SET joined_at = excluded.joined_at, joined_by = excluded.joined_by, left_at = NULL, left_by = NULL', ownerId, now(), u.id);
    audit({ id: u.id, role: u.role }, 'network.join', 'network', ownerId, null, ownerId);
  });
  return networkStatus(u, ownerId);
}

/** Leaving is refused while the business organises or hosts a network tournament that is not over. */
export function leaveNetwork(u: UserRow, ownerId: string) {
  if (u.role !== 'owner' && u.role !== 'super_admin') throw forbidden('Only the owner can leave the cricket network');
  if (!isMember(ownerId)) return networkStatus(u, ownerId);
  const busy = one<{ name: string }>(`SELECT t.name FROM net_tournaments t WHERE t.status IN ('draft','published') AND (t.organiser_id = ?
    OR EXISTS (SELECT 1 FROM net_grounds g WHERE g.tournament_id = t.id AND g.owner_id = ? AND g.status = 'accepted')) LIMIT 1`, ownerId, ownerId);
  if (busy) throw conflict('NETWORK_BUSY', `${busy.name} is still running with this business in it. Finish or cancel it, or withdraw your ground, first.`);
  tx(() => {
    run('UPDATE network_members SET left_at = ?, left_by = ? WHERE owner_id = ?', now(), u.id, ownerId);
    audit({ id: u.id, role: u.role }, 'network.leave', 'network', ownerId, null, ownerId);
  });
  return networkStatus(u, ownerId);
}

// ------------------------------------------------------------------ the software owner's switch for children's profiles

export function platformState() {
  const p = one<{ child_profiles_on: number; legal_review_ref: string | null; updated_at: number | null }>('SELECT child_profiles_on, legal_review_ref, updated_at FROM network_platform WHERE id = 1');
  return { on: !!p?.child_profiles_on, legalReviewRef: p?.legal_review_ref ?? null, changedAt: p?.updated_at ?? null, note: LEGAL_REVIEW_NOTE, consentWording: CONSENT_WORDING };
}
export const childProfilesOn = (): boolean => platformState().on;

/** Software owner only. Switching on needs a reference to the legal and product review (who, when, which document); it is kept as typed. */
export function setChildProfiles(u: UserRow, body: unknown) {
  if (u.role !== 'super_admin') throw forbidden('Only the software owner can switch children\'s profiles on or off');
  const v = new Validator(body ?? {});
  const on = v.bool('on', true);
  const ref = v.str('legalReviewRef', { max: 300 });
  v.done();
  if (on && !ref) throw bad('legalReviewRef', 'Say which legal and product review approved children\'s profiles (who, when, which document) before switching them on');
  tx(() => {
    run('INSERT INTO network_platform(id, child_profiles_on, legal_review_ref, updated_by, updated_at) VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET child_profiles_on = excluded.child_profiles_on, legal_review_ref = COALESCE(excluded.legal_review_ref, network_platform.legal_review_ref), updated_by = excluded.updated_by, updated_at = excluded.updated_at',
      on ? 1 : 0, ref ?? null, u.id, now());
    audit({ id: u.id, role: u.role }, on ? 'network.children_on' : 'network.children_off', 'network', null, { legalReviewRef: ref ?? null });
  });
  return platformState();
}

// ------------------------------------------------------------------ children

interface ChildRow { child_id: string; guardian_id: string; born_on: string; player_code: string; guardian_declared_at: number; created_at: number; removed_at: number | null }
const childRow = (id: string) => one<ChildRow>('SELECT * FROM child_profiles WHERE child_id = ? AND removed_at IS NULL', id);
export const isChild = (userId: string): boolean => !!childRow(userId);
export const childByCode = (code: string) => one<ChildRow>('SELECT * FROM child_profiles WHERE player_code = ? AND removed_at IS NULL', code.trim().toUpperCase());

/** Whether the guardian's latest word on this scope is yes (and children's profiles are switched on). */
export function consentGiven(childId: string, scope: 'play_record' | 'network_share'): boolean {
  if (!childProfilesOn()) return false;
  const c = one<{ given: number }>('SELECT given FROM child_consents WHERE child_id = ? AND scope = ? ORDER BY id DESC LIMIT 1', childId, scope);
  return c?.given === 1;
}

/** Age in whole years on a date. */
export function ageOn(bornOn: string, date: string): number {
  const [by, bm, bd] = bornOn.split('-').map(Number) as [number, number, number];
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newPlayerCode(): string {
  for (;;) {
    let s = 'KID-';
    for (let i = 0; i < 6; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    if (!one('SELECT 1 FROM child_profiles WHERE player_code = ?', s)) return s;
  }
}

const shortName = (full: string): string => {
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]![0]!.toUpperCase()}.` : parts[0] ?? '';
};

function childOut(c: ChildRow) {
  const u = one<{ name: string }>('SELECT name FROM users WHERE id = ?', c.child_id)!;
  const last = (scope: 'play_record' | 'network_share') => one<{ given: number; at: number; wording: string }>('SELECT given, at, wording FROM child_consents WHERE child_id = ? AND scope = ? ORDER BY id DESC LIMIT 1', c.child_id, scope);
  const pr = last('play_record'), ns = last('network_share');
  return {
    id: c.child_id, name: u.name, bornOn: c.born_on, age: ageOn(c.born_on, istDate(now())), playerCode: c.player_code,
    consent: {
      playRecord: { given: pr?.given === 1, at: pr?.at ?? null, wording: pr?.wording ?? CONSENT_WORDING.play_record },
      networkShare: { given: ns?.given === 1, at: ns?.at ?? null, wording: ns?.wording ?? CONSENT_WORDING.network_share },
    },
    visibility: effectiveVisibility(c.child_id),
    matches: one<{ n: number }>("SELECT COUNT(*) n FROM match_players p JOIN matches m ON m.id = p.match_id WHERE p.user_id = ? AND p.removed_at IS NULL AND m.status = 'completed'", c.child_id)!.n,
    turnsAdultOn: addYears(c.born_on, CHILD_AGE),
  };
}
const addYears = (d: string, n: number) => `${Number(d.slice(0, 4)) + n}${d.slice(4)}`;

function needChildrenOn(): void {
  if (!childProfilesOn()) throw new HttpError(503, 'FEATURE_OFF', LEGAL_REVIEW_NOTE);
}
function guardianOf(u: UserRow, childId: string): ChildRow {
  if (u.role !== 'customer') throw forbidden('Only a parent or guardian can do this');
  const c = childRow(childId);
  if (!c || c.guardian_id !== u.id) throw notFound('Child not found');
  return c;
}

export function myChildren(u: UserRow) {
  if (u.role !== 'customer') throw forbidden('Children\'s profiles are made by a parent or guardian');
  return { switchedOn: childProfilesOn(), note: LEGAL_REVIEW_NOTE, items: many<ChildRow>('SELECT * FROM child_profiles WHERE guardian_id = ? AND removed_at IS NULL ORDER BY created_at', u.id).map(childOut) };
}

/** A parent or guardian adds a child (under 18). The child has no sign-in of their own; consent starts as not given. */
export function addChild(u: UserRow, body: unknown) {
  if (u.role !== 'customer') throw forbidden('Children\'s profiles are made by a parent or guardian');
  needChildrenOn();
  if (isChild(u.id)) throw forbidden('A child\'s profile cannot add children');
  const v = new Validator(body ?? {});
  const first = v.str('firstName', { required: true, min: 1, max: 40 });
  const last = v.str('lastName', { max: 40 });
  const bornOn = v.date('bornOn', true);
  const declared = v.bool('iAmGuardian', true);
  v.done();
  if (!declared) throw bad('iAmGuardian', 'Only a parent or legal guardian can add a child');
  const today = istDate(now());
  if (bornOn! > today) throw bad('bornOn', 'The date of birth is in the future');
  if (ageOn(bornOn!, today) >= CHILD_AGE) throw bad('bornOn', `A player who is ${CHILD_AGE} or older makes their own profile`);
  if (many('SELECT 1 FROM child_profiles WHERE guardian_id = ? AND removed_at IS NULL', u.id).length >= 10) throw conflict('TOO_MANY', 'At most 10 children on one guardian\'s profile');
  const id = newId('usr'), t = now(), name = [first, last].filter(Boolean).join(' ');
  tx(() => {
    // a profile with no email, phone or password: nobody can sign in to it; the guardian runs it
    run(`INSERT INTO users(id, role, name, first_name, last_name, created_at, updated_at) VALUES(?, 'customer', ?, ?, ?, ?, ?)`, id, name, first!, last ?? '', t, t);
    run('INSERT INTO child_profiles(child_id, guardian_id, born_on, player_code, guardian_declared_at, created_at) VALUES(?,?,?,?,?,?)', id, u.id, bornOn!, newPlayerCode(), t, t);
    audit({ id: u.id, role: u.role }, 'network.child_add', 'user', id, { bornOn });
  });
  return childOut(childRow(id)!);
}

/** The guardian gives or withdraws one consent. Each answer is a new record; withdrawing play_record also takes the child off squads and teams. */
export function setChildConsent(u: UserRow, childId: string, body: unknown) {
  const c = guardianOf(u, childId);
  const v = new Validator(body ?? {});
  const scope = v.oneOf('scope', ['play_record', 'network_share'] as const, true);
  const given = v.bool('given', true);
  v.done();
  if (given) needChildrenOn();
  if (given && scope === 'network_share' && !consentGiven(childId, 'play_record')) throw conflict('CONSENT_ORDER', 'Agree to the match record first: there is nothing to share without it');
  tx(() => {
    run('INSERT INTO child_consents(child_id, guardian_id, scope, given, wording, at) VALUES(?,?,?,?,?,?)', childId, u.id, scope!, given ? 1 : 0, CONSENT_WORDING[scope!], now());
    if (!given && scope === 'play_record') {
      run('INSERT INTO child_consents(child_id, guardian_id, scope, given, wording, at) VALUES(?,?,?,?,?,?)', childId, u.id, 'network_share', 0, CONSENT_WORDING.network_share, now());
      takeOffEverything(childId, 'consent withdrawn');
    }
    if (!given && scope === 'network_share') run("UPDATE player_sharing SET visibility = 'private', updated_at = ? WHERE user_id = ?", now(), childId);
    audit({ id: u.id, role: u.role }, given ? 'network.consent_give' : 'network.consent_withdraw', 'user', childId, { scope });
  });
  return childOut(c);
}

/**
 * A withdrawn consent, a removed child or a deleted account, at once (review of PR #202):
 *  - network tournament teams: the player leaves the team (the row is closed, not just unlinked), and open requests to them close;
 *  - squads of matches that have not started: the player comes off;
 *  - matches that started or finished: the scorecard keeps the name the ball-by-ball record uses (for a child from a network team that is
 *    the first name and initial), no longer linked to the profile, so it is on nobody's record;
 *  - open claims close.
 */
function takeOffEverything(userId: string, reason: string): void {
  const t = now(), child = isChild(userId);
  run(`UPDATE match_players SET removed_at = ? WHERE user_id = ? AND removed_at IS NULL
    AND match_id IN (SELECT m.id FROM matches m WHERE m.status = 'scheduled' AND NOT EXISTS (SELECT 1 FROM match_balls b WHERE b.match_id = m.id))`, t, userId);
  forgetPlayerLinks(userId);
  for (const p of many<{ id: string; name: string }>('SELECT id, name FROM net_team_players WHERE user_id = ? OR invited_user_id = ?', userId, userId)) {
    // a child's name is not kept in full even on a closed row
    run('UPDATE net_team_players SET user_id = NULL, invited_user_id = NULL, name = ?, removed_at = COALESCE(removed_at, ?), removed_reason = COALESCE(removed_reason, ?) WHERE id = ?',
      child ? shortName(p.name) : p.name, t, reason, p.id);
  }
  run("UPDATE profile_claims SET closed_at = ?, outcome = 'gone', reason = ? WHERE user_id = ? AND closed_at IS NULL", t, reason, userId);
}

/** The guardian removes the child's profile: consent withdrawn, links off, the profile closed. Scorecards keep the names the scorer used. */
export function removeChild(u: UserRow, childId: string) {
  guardianOf(u, childId);
  tx(() => {
    for (const scope of ['play_record', 'network_share'] as const) run('INSERT INTO child_consents(child_id, guardian_id, scope, given, wording, at) VALUES(?,?,?,?,?,?)', childId, u.id, scope, 0, CONSENT_WORDING[scope], now());
    takeOffEverything(childId, 'profile removed');
    run('DELETE FROM player_sharing WHERE user_id = ?', childId);
    run('UPDATE child_profiles SET removed_at = ? WHERE child_id = ?', now(), childId);
    run('UPDATE users SET active = 0, updated_at = ? WHERE id = ?', now(), childId);
    audit({ id: u.id, role: u.role }, 'network.child_remove', 'user', childId, null);
  });
  return { removed: true };
}

/** A deleted account (accountDeletion.ts): its sharing choice and open claims go, it leaves tournament teams, and the children it looked after are removed the same way a guardian removes them. */
export function forgetNetwork(userId: string): void {
  for (const c of many<{ child_id: string }>('SELECT child_id FROM child_profiles WHERE guardian_id = ? AND removed_at IS NULL', userId)) {
    for (const scope of ['play_record', 'network_share'] as const) run('INSERT INTO child_consents(child_id, guardian_id, scope, given, wording, at) VALUES(?,?,?,?,?,?)', c.child_id, userId, scope, 0, CONSENT_WORDING[scope], now());
    takeOffEverything(c.child_id, 'account deleted');
    run('DELETE FROM player_sharing WHERE user_id = ?', c.child_id);
    run('UPDATE child_profiles SET removed_at = ? WHERE child_id = ?', now(), c.child_id);
    run("UPDATE users SET name = 'Deleted user', active = 0, updated_at = ? WHERE id = ?", now(), c.child_id);
  }
  takeOffEverything(userId, 'account deleted');
  run('DELETE FROM player_sharing WHERE user_id = ?', userId);
}

export function childRecord(u: UserRow, childId: string) {
  guardianOf(u, childId);
  return { ...cricketProfileCore(childId, true), name: one<{ name: string }>('SELECT name FROM users WHERE id = ?', childId)!.name };
}

// ------------------------------------------------------------------ sharing

/** What the player chose, held back by the rules: a child is never public, and is private without the guardian's sharing consent. */
export function effectiveVisibility(userId: string): Visibility {
  const s = one<{ visibility: Visibility }>('SELECT visibility FROM player_sharing WHERE user_id = ?', userId);
  const want = s?.visibility ?? 'private';
  if (isChild(userId)) return consentGiven(userId, 'network_share') && want !== 'private' ? 'network' : 'private';
  return want;
}

function sharingOut(userId: string) {
  const s = one<{ visibility: Visibility; playing_role: string | null; batting_style: string | null; bowling_style: string | null; updated_at: number }>('SELECT * FROM player_sharing WHERE user_id = ?', userId);
  return {
    visibility: effectiveVisibility(userId), chosen: s?.visibility ?? 'private', playingRole: s?.playing_role ?? null, battingStyle: s?.batting_style ?? null, bowlingStyle: s?.bowling_style ?? null,
    choices: [
      { value: 'private', label: 'Only me', text: 'Each ground sees only the matches you played there (as before). Nobody else sees your profile.' },
      { value: 'network', label: 'Grounds in the cricket network', text: 'Staff of grounds in the network can see your shared cricket profile.' },
      { value: 'public', label: 'Everyone', text: 'Anyone with the link can see your shared cricket profile.' },
    ],
    sharedFields: SHARED_FIELDS, neverShared: NEVER_SHARED, eligibleRule: ELIGIBLE_RULE,
  };
}

export function mySharing(u: UserRow) {
  if (u.role !== 'customer') throw forbidden('Sharing choices are for players');
  return sharingOut(u.id);
}

function saveSharing(actor: UserRow, userId: string, body: unknown, child: boolean) {
  const v = new Validator(body ?? {});
  const vis = v.oneOf('visibility', VISIBILITIES);
  const role = v.has('playingRole') ? v.str('playingRole', { max: 40 }) ?? null : undefined;
  const bat = v.has('battingStyle') ? v.str('battingStyle', { max: 40 }) ?? null : undefined;
  const bowl = v.has('bowlingStyle') ? v.str('bowlingStyle', { max: 40 }) ?? null : undefined;
  v.done();
  if (child && vis === 'public') throw bad('visibility', 'A child\'s profile is never public');
  if (child && vis === 'network' && !consentGiven(userId, 'network_share')) throw conflict('CONSENT_NEEDED', 'Give the sharing consent first');
  const cur = one<{ visibility: string; playing_role: string | null; batting_style: string | null; bowling_style: string | null }>('SELECT * FROM player_sharing WHERE user_id = ?', userId);
  tx(() => {
    run(`INSERT INTO player_sharing(user_id, visibility, playing_role, batting_style, bowling_style, updated_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET visibility = excluded.visibility, playing_role = excluded.playing_role, batting_style = excluded.batting_style, bowling_style = excluded.bowling_style, updated_at = excluded.updated_at`,
      userId, vis ?? cur?.visibility ?? 'private', role === undefined ? cur?.playing_role ?? null : role, bat === undefined ? cur?.batting_style ?? null : bat, bowl === undefined ? cur?.bowling_style ?? null : bowl, now());
    audit({ id: actor.id, role: actor.role }, 'network.sharing', 'user', userId, { visibility: vis ?? cur?.visibility ?? 'private' });
  });
  return sharingOut(userId);
}

export function setMySharing(u: UserRow, body: unknown) {
  if (u.role !== 'customer') throw forbidden('Sharing choices are for players');
  return saveSharing(u, u.id, body, false);
}
export function setChildSharing(u: UserRow, childId: string, body: unknown) {
  guardianOf(u, childId);
  return saveSharing(u, childId, body, true);
}

// ------------------------------------------------------------------ the shared cricket profile

interface Line { matchId: string; date: number; title: string; ground: string | null; business: string; competition: string; team: string; opponent: string; result: string | null; summary: string; batting: unknown; bowling: unknown; fielding: unknown }

/** Network fixtures whose result is not verified yet (their matches do not count). netTournaments.ts owns the tables. */
const unverifiedMatchIds = (): Set<string> => new Set(many<{ match_id: string }>(`SELECT f.match_id FROM net_fixtures f WHERE f.match_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM net_results r WHERE r.fixture_id = f.id AND r.verified_at IS NOT NULL AND r.superseded_at IS NULL)`).map((r) => r.match_id));

function competitionOf(matchId: string): string {
  const n = one<{ name: string }>('SELECT t.name FROM net_fixtures f JOIN net_tournaments t ON t.id = f.tournament_id WHERE f.match_id = ?', matchId);
  if (n) return `${n.name} (network)`;
  const t = one<{ name: string }>('SELECT t.name FROM tournament_fixtures f JOIN tournaments t ON t.id = f.tournament_id WHERE f.match_id = ? AND f.deleted_at IS NULL', matchId);
  return t?.name ?? 'Other matches';
}

const lineText = (l: { batting: any; bowling: any; fielding: any }): string => {
  const bits: string[] = [];
  if (l.batting) bits.push(`${l.batting.runs}${l.batting.out ? '' : '*'} (${l.batting.balls})`);
  if (l.bowling) bits.push(`${l.bowling.wickets}/${l.bowling.runs}`);
  if (l.fielding.catches) bits.push(`${l.fielding.catches} ct`);
  return bits.join(', ') || 'Did not bat or bowl';
};

/** The player's eligible lines, everywhere they played, labelled by ground, business and competition. */
export function eligibleLines(userId: string): Line[] {
  const skip = unverifiedMatchIds();
  const rows = many<{ id: string; match_id: string; side: 'a' | 'b'; name: string; name_key: string }>(
    "SELECT p.id, p.match_id, p.side, p.name, p.name_key FROM match_players p JOIN matches m ON m.id = p.match_id WHERE p.user_id = ? AND p.removed_at IS NULL AND m.status = 'completed'", userId);
  const out: Line[] = [];
  for (const r of rows) {
    if (skip.has(r.match_id)) continue;
    const m = one<MatchRow & { ground_name: string | null }>('SELECT m.*, g.name ground_name FROM matches m LEFT JOIN grounds g ON g.id = m.ground_id WHERE m.id = ?', r.match_id)!;
    const l = linesOf(m, [r]).get(r.id);
    if (!l) continue;
    out.push({ matchId: m.id, date: l.date, title: l.title, ground: l.groundName, business: businessName(m.owner_id), competition: competitionOf(m.id), team: l.team, opponent: l.opponent, result: l.result, summary: lineText(l), batting: l.batting, bowling: l.bowling, fielding: l.fielding });
  }
  return out.sort((a, b) => b.date - a.date);
}

function cricketProfileCore(userId: string, full: boolean) {
  const lines = eligibleLines(userId);
  const group = (key: (l: Line) => string) => {
    const m = new Map<string, Line[]>();
    for (const l of lines) m.set(key(l), [...(m.get(key(l)) ?? []), l]);
    return [...m].map(([label, ls]) => ({ label, ...brief(sumUp(ls as never)) })).sort((a, b) => b.matches - a.matches || a.label.localeCompare(b.label));
  };
  const s = one<{ playing_role: string | null; batting_style: string | null; bowling_style: string | null }>('SELECT * FROM player_sharing WHERE user_id = ?', userId);
  return {
    playingRole: s?.playing_role ?? null, battingStyle: s?.batting_style ?? null, bowlingStyle: s?.bowling_style ?? null,
    career: sumUp(lines as never), byGround: group((l) => l.ground ?? l.business), byCompetition: group((l) => l.competition),
    matches: lines.slice(0, full ? 200 : 50).map(({ batting: _b, bowling: _w, fielding: _f, ...l }) => l), eligibleRule: ELIGIBLE_RULE,
  };
}
const brief = (c: Career) => ({ matches: c.matches, runs: c.batting.runs, highest: c.batting.highest, average: c.batting.average, strikeRate: c.batting.strikeRate, wickets: c.bowling.wickets, best: c.bowling.best, economy: c.bowling.economy, catches: c.fielding.catches });

/** The player's own view: their choices and their combined record, with the breakdown by ground and competition. */
export function myNetworkProfile(u: UserRow) {
  if (u.role !== 'customer') throw forbidden('Cricket profiles are for players');
  return { name: u.name, sharing: sharingOut(u.id), ...cricketProfileCore(u.id, true) };
}

/**
 * Someone else's view of a profile. Public: anyone. Network: the owner or cricket staff of a network business. Private: nobody here
 * (a business still sees its own matches on its customer page, as before). A profile that may not be seen answers 404, so its existence is not revealed.
 */
export function viewProfile(viewer: UserRow | null, userId: string) {
  const p = one<{ id: string; name: string; role: string; active: number }>('SELECT id, name, role, active FROM users WHERE id = ?', userId);
  if (!p || p.role !== 'customer' || !p.active) throw notFound('Player not found');
  const vis = effectiveVisibility(userId);
  const own = viewer && viewer.id === userId;
  const scope = viewer ? scopeOwnerId(viewer) : null;
  const networkViewer = !!viewer && !!scope && isMember(scope) && (hasPermission(viewer, 'manage_matches') || hasPermission(viewer, 'view_customers'));
  if (!own && !(vis === 'public' || (vis === 'network' && networkViewer))) throw notFound('Player not found');
  const child = isChild(userId);
  return { id: userId, name: child ? shortName(p.name) : p.name, isChild: child, visibility: vis, ...cricketProfileCore(userId, false) };
}

/** Network players a member business may look up by name (to add to a tournament team, say): shared profiles only, no contact details. */
export function searchPlayers(u: UserRow, ownerId: string, q: string) {
  requireCricketStaff(u); requireMember(ownerId);
  const k = nameKey(q ?? '');
  if (k.length < 2) return { items: [] };
  const rows = many<{ id: string; name: string }>(`SELECT u.id, u.name FROM users u JOIN player_sharing s ON s.user_id = u.id WHERE u.role = 'customer' AND u.active = 1
    AND s.visibility IN ('network','public') AND lower(u.name) LIKE ? ORDER BY u.name LIMIT 40`, `%${k.replace(/[%_]/g, '')}%`);
  return { items: rows.filter((r) => effectiveVisibility(r.id) !== 'private').slice(0, 20).map((r) => ({ id: r.id, name: isChild(r.id) ? shortName(r.name) : r.name, isChild: isChild(r.id), matches: eligibleLines(r.id).length })) };
}

// ------------------------------------------------------------------ possible duplicates: a guest name on a scorecard that may be a profile

interface GuestRow { id: string; match_id: string; owner_id: string; name: string; title: string; scheduled_for: number | null; created_at: number; ground: string | null }
const guestRowsNamed = (key: string, ownerId?: string) => many<GuestRow>(`SELECT p.id, p.match_id, p.owner_id, p.name, m.title, m.scheduled_for, m.created_at, g.name ground FROM match_players p
  JOIN matches m ON m.id = p.match_id LEFT JOIN grounds g ON g.id = m.ground_id
  WHERE p.user_id IS NULL AND p.removed_at IS NULL AND p.name_key = ? AND m.status = 'completed' ${ownerId ? 'AND m.owner_id = ?' : ''} ORDER BY COALESCE(m.scheduled_for, m.created_at) DESC LIMIT 50`, key, ...(ownerId ? [ownerId] : []));
const knownAt = (ownerId: string, userId: string) => ownsCustomer(ownerId, userId) || playedAt(ownerId, userId)
  || !!one('SELECT 1 FROM booking_players p JOIN bookings b ON b.id = p.booking_id WHERE p.user_id = ? AND b.owner_id = ?', userId, ownerId);
const disowned = (mpId: string, userId: string) => !!one('SELECT 1 FROM match_players WHERE id = ? AND disowned_user_id = ?', mpId, userId)
  || !!one("SELECT 1 FROM profile_claims WHERE match_player_id = ? AND user_id = ? AND outcome IN ('declined','refused')", mpId, userId);

function claimOut(c: { id: string; match_player_id: string; match_id: string; owner_id: string; user_id: string; raised_by: string; player_ok_at: number | null; staff_ok_at: number | null; closed_at: number | null; outcome: string | null; reason: string | null; created_at: number }, forStaff: boolean) {
  const g = one<{ name: string; title: string; ground: string | null; at: number }>('SELECT p.name, m.title, g.name ground, COALESCE(m.scheduled_for, m.created_at) at FROM match_players p JOIN matches m ON m.id = p.match_id LEFT JOIN grounds g ON g.id = m.ground_id WHERE p.id = ?', c.match_player_id);
  return {
    id: c.id, scorecardName: g?.name ?? null, match: g?.title ?? null, ground: g?.ground ?? null, date: g?.at ?? null, business: businessName(c.owner_id), raisedBy: c.raised_by,
    playerSaidYes: !!c.player_ok_at, staffSaidYes: !!c.staff_ok_at, status: c.closed_at ? c.outcome : 'open', reason: c.reason, createdAt: c.created_at,
    ...(forStaff ? { player: one<{ name: string }>('SELECT name FROM users WHERE id = ?', c.user_id)?.name ?? null, playerId: c.user_id } : {}),
  };
}

/** The signed-in player's possible guest entries (same name, at a business that knows them), and their open and recent claims. */
export function myClaims(u: UserRow) {
  if (u.role !== 'customer') throw forbidden('This is for players');
  const open = new Set(many<{ match_player_id: string }>('SELECT match_player_id FROM profile_claims WHERE user_id = ? AND closed_at IS NULL', u.id).map((r) => r.match_player_id));
  const already = new Set(many<{ match_id: string }>('SELECT match_id FROM match_players WHERE user_id = ? AND removed_at IS NULL', u.id).map((r) => r.match_id));
  const possible = guestRowsNamed(nameKey(u.name)).filter((g) => !open.has(g.id) && !already.has(g.match_id) && !disowned(g.id, u.id) && knownAt(g.owner_id, u.id))
    .map((g) => ({ matchPlayerId: g.id, scorecardName: g.name, match: g.title, ground: g.ground, date: g.scheduled_for ?? g.created_at, business: businessName(g.owner_id) }));
  const claims = many<any>('SELECT * FROM profile_claims WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', u.id).map((c) => claimOut(c, false));
  return { possible, claims, note: 'A match is added to your record only after the ground that scored it agrees. Nothing is merged automatically.' };
}

function linkIfAgreed(claimId: string, actorId: string): void {
  const c = one<{ id: string; match_player_id: string; match_id: string; owner_id: string; user_id: string; player_ok_at: number | null; staff_ok_at: number | null }>('SELECT * FROM profile_claims WHERE id = ? AND closed_at IS NULL', claimId);
  if (!c || !c.player_ok_at || !c.staff_ok_at) return;
  const mp = one<{ user_id: string | null; removed_at: number | null }>('SELECT user_id, removed_at FROM match_players WHERE id = ?', c.match_player_id);
  const taken = one('SELECT 1 FROM match_players WHERE match_id = ? AND user_id = ? AND removed_at IS NULL', c.match_id, c.user_id);
  if (!mp || mp.removed_at || mp.user_id || taken) {
    run("UPDATE profile_claims SET closed_at = ?, closed_by = ?, outcome = 'gone', reason = 'The scorecard entry changed or is already linked' WHERE id = ?", now(), actorId, c.id);
    return;
  }
  if (isChild(c.user_id) && !consentGiven(c.user_id, 'play_record')) throw conflict('CONSENT_NEEDED', 'The guardian has not agreed to a match record for this child');
  // linked_via stays empty: neither a phone match nor a team list, but the two-sided agreement recorded in profile_claims
  run('UPDATE match_players SET user_id = ?, linked_via = NULL, linked_by = ?, linked_at = ? WHERE id = ?', c.user_id, actorId, now(), c.match_player_id);
  run("UPDATE profile_claims SET closed_at = ?, closed_by = ?, outcome = 'linked' WHERE id = ?", now(), actorId, c.id);
  audit({ id: actorId, role: null }, 'network.claim_linked', 'match', c.match_id, { claim: c.id, matchPlayer: c.match_player_id }, c.owner_id);
}

/** The player says a guest entry is them. It waits for the business that scored the match. */
export function claimMatch(u: UserRow, body: unknown) {
  if (u.role !== 'customer') throw forbidden('This is for players');
  const v = new Validator(body ?? {});
  const mpId = v.str('matchPlayerId', { required: true, max: 60 });
  v.done();
  const g = one<GuestRow & { name_key: string }>("SELECT p.id, p.match_id, p.owner_id, p.name, p.name_key FROM match_players p JOIN matches m ON m.id = p.match_id WHERE p.id = ? AND p.user_id IS NULL AND p.removed_at IS NULL AND m.status = 'completed'", mpId!);
  if (!g || g.name_key !== nameKey(u.name) || !knownAt(g.owner_id, u.id)) throw notFound('That scorecard entry is not one you can claim');
  if (disowned(g.id, u.id)) throw conflict('CLAIM_CLOSED', 'This entry was already turned down for your profile');
  if (one('SELECT 1 FROM match_players WHERE match_id = ? AND user_id = ? AND removed_at IS NULL', g.match_id, u.id)) throw conflict('ALREADY_LINKED', 'You are already linked to that match');
  const existing = one<{ id: string }>('SELECT id FROM profile_claims WHERE match_player_id = ? AND user_id = ? AND closed_at IS NULL', g.id, u.id);
  const id = existing?.id ?? newId('clm');
  tx(() => {
    if (existing) run('UPDATE profile_claims SET player_ok_at = COALESCE(player_ok_at, ?) WHERE id = ?', now(), id);
    else run("INSERT INTO profile_claims(id, match_player_id, match_id, owner_id, user_id, raised_by, player_ok_at, created_at) VALUES(?,?,?,?,?,'player',?,?)", id, g.id, g.match_id, g.owner_id, u.id, now(), now());
    audit({ id: u.id, role: u.role }, 'network.claim', 'match', g.match_id, { claim: id }, g.owner_id);
    linkIfAgreed(id, u.id);
  });
  return claimOut(one<any>('SELECT * FROM profile_claims WHERE id = ?', id), false);
}

/** The player answers a suggestion the ground made (yes links it, no closes it for good). */
export function answerClaim(u: UserRow, id: string, body: unknown) {
  if (u.role !== 'customer') throw forbidden('This is for players');
  const v = new Validator(body ?? {});
  const yes = v.bool('yes', true);
  v.done();
  const c = one<any>('SELECT * FROM profile_claims WHERE id = ? AND user_id = ?', id, u.id);
  if (!c) throw notFound('Claim not found');
  if (c.closed_at) return claimOut(c, false);
  tx(() => {
    if (yes) { run('UPDATE profile_claims SET player_ok_at = COALESCE(player_ok_at, ?) WHERE id = ?', now(), id); linkIfAgreed(id, u.id); }
    else run("UPDATE profile_claims SET closed_at = ?, closed_by = ?, outcome = 'declined', reason = 'The player said it was not them' WHERE id = ?", now(), u.id, id);
    audit({ id: u.id, role: u.role }, yes ? 'network.claim_yes' : 'network.claim_no', 'match', c.match_id, { claim: id }, c.owner_id);
  });
  return claimOut(one<any>('SELECT * FROM profile_claims WHERE id = ?', id), false);
}

/** Staff: the claims at this business, and suggestions (a guest name on its own scorecards that is the name of one of its customers). */
export function staffClaims(u: UserRow, ownerId: string) {
  requireCricketStaff(u);
  const claims = many<any>('SELECT * FROM profile_claims WHERE owner_id = ? ORDER BY closed_at IS NOT NULL, created_at DESC LIMIT 100', ownerId).map((c) => claimOut(c, true));
  const customers = many<{ id: string; name: string }>("SELECT DISTINCT u.id, u.name FROM users u JOIN bookings b ON b.customer_id = u.id WHERE b.owner_id = ? AND u.role = 'customer' AND u.active = 1", ownerId);
  const byKey = new Map<string, { id: string; name: string }[]>();
  for (const c of customers) byKey.set(nameKey(c.name), [...(byKey.get(nameKey(c.name)) ?? []), c]);
  const openPairs = new Set(many<{ match_player_id: string; user_id: string }>('SELECT match_player_id, user_id FROM profile_claims WHERE owner_id = ? AND closed_at IS NULL', ownerId).map((r) => `${r.match_player_id}|${r.user_id}`));
  const suggestions: { matchPlayerId: string; scorecardName: string; match: string; date: number; playerId: string; player: string; sameNameProfiles: number }[] = [];
  for (const [key, people] of byKey) {
    for (const g of guestRowsNamed(key, ownerId)) for (const p of people) {
      if (openPairs.has(`${g.id}|${p.id}`) || disowned(g.id, p.id) || one('SELECT 1 FROM match_players WHERE match_id = ? AND user_id = ? AND removed_at IS NULL', g.match_id, p.id)) continue;
      suggestions.push({ matchPlayerId: g.id, scorecardName: g.name, match: g.title, date: g.scheduled_for ?? g.created_at, playerId: p.id, player: p.name, sameNameProfiles: people.length });
    }
  }
  return { claims, suggestions: suggestions.slice(0, 100), note: 'A suggestion is only a name match. Linking needs the player to agree as well; nothing is merged automatically.' };
}

/** Staff suggest a link (the player must still agree), or agree to / refuse a player's claim. */
export function staffSuggest(u: UserRow, ownerId: string, body: unknown) {
  requireCricketStaff(u);
  const v = new Validator(body ?? {});
  const mpId = v.str('matchPlayerId', { required: true, max: 60 }), userId = v.str('playerId', { required: true, max: 60 });
  v.done();
  const g = one<{ id: string; match_id: string }>("SELECT p.id, p.match_id FROM match_players p JOIN matches m ON m.id = p.match_id WHERE p.id = ? AND m.owner_id = ? AND p.user_id IS NULL AND p.removed_at IS NULL", mpId!, ownerId);
  if (!g) throw notFound('Scorecard entry not found');
  if (!one("SELECT 1 FROM users WHERE id = ? AND role = 'customer' AND active = 1", userId!) || !knownAt(ownerId, userId!)) throw notFound('Player not found');
  if (disowned(g.id, userId!)) throw conflict('CLAIM_CLOSED', 'The player already said this is not them');
  const existing = one<{ id: string }>('SELECT id FROM profile_claims WHERE match_player_id = ? AND user_id = ? AND closed_at IS NULL', g.id, userId!);
  const id = existing?.id ?? newId('clm');
  tx(() => {
    if (existing) run('UPDATE profile_claims SET staff_ok_at = COALESCE(staff_ok_at, ?), staff_ok_by = COALESCE(staff_ok_by, ?) WHERE id = ?', now(), u.id, id);
    else run("INSERT INTO profile_claims(id, match_player_id, match_id, owner_id, user_id, raised_by, staff_ok_at, staff_ok_by, created_at) VALUES(?,?,?,?,?,'staff',?,?,?)", id, g.id, g.match_id, ownerId, userId!, now(), u.id, now());
    audit({ id: u.id, role: u.role }, 'network.claim_suggest', 'match', g.match_id, { claim: id }, ownerId);
    linkIfAgreed(id, u.id);
  });
  return claimOut(one<any>('SELECT * FROM profile_claims WHERE id = ?', id), true);
}

export function staffDecideClaim(u: UserRow, ownerId: string, id: string, body: unknown) {
  requireCricketStaff(u);
  const v = new Validator(body ?? {});
  const yes = v.bool('yes', true);
  const reason = v.str('reason', { max: 200 });
  v.done();
  const c = one<any>('SELECT * FROM profile_claims WHERE id = ? AND owner_id = ?', id, ownerId);
  if (!c) throw notFound('Claim not found');
  if (c.closed_at) return claimOut(c, true);
  if (!yes && !reason) throw bad('reason', 'Say why it is not them');
  tx(() => {
    if (yes) { run('UPDATE profile_claims SET staff_ok_at = COALESCE(staff_ok_at, ?), staff_ok_by = COALESCE(staff_ok_by, ?) WHERE id = ?', now(), u.id, id); linkIfAgreed(id, u.id); }
    else run("UPDATE profile_claims SET closed_at = ?, closed_by = ?, outcome = 'refused', reason = ? WHERE id = ?", now(), u.id, reason!, id);
    audit({ id: u.id, role: u.role }, yes ? 'network.claim_agree' : 'network.claim_refuse', 'match', c.match_id, { claim: id, reason: reason ?? null }, ownerId);
  });
  return claimOut(one<any>('SELECT * FROM profile_claims WHERE id = ?', id), true);
}

/** A guardian's children, for netTournaments.ts: a child may be put on a team only by their player code, with play consent. */
export function childForTeam(code: string): { id: string; name: string } {
  const c = childByCode(code);
  if (!c) throw notFound('No child has that player code');
  if (!consentGiven(c.child_id, 'play_record')) throw conflict('CONSENT_NEEDED', 'The child\'s parent or guardian has not agreed to a match record. Ask them to agree in their profile first.');
  return { id: c.child_id, name: one<{ name: string }>('SELECT name FROM users WHERE id = ?', c.child_id)!.name };
}

export { shortName };
