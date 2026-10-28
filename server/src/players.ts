import { many, one, registerSchema, run, tx } from './db.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { HttpError, notFound } from './errors.ts';
import { audit } from './audit.ts';
import { Validator, normalizePhone } from './input.ts';
import { getSettings } from './settings.ts';
import { DAY, MIN, fmtDateTime } from './time.ts';
import { groundRow } from './grounds.ts';
import { hasPermission, scopeOwnerId, type UserRow } from './auth.ts';
import { createHash } from 'node:crypto';
import { checkCameraPhoto, MAX_TASK_PHOTO_BYTES } from './tasks.ts';
import { checkOtp, requestOtp } from './otp.ts';
import { enrollFace, faceMatchReady, forgetFace, verifyFace } from './faceMatch.ts';
import type { Config } from './config.ts';

// The team list and check-in at the ground (owner's rules, 28 Oct 2026). Everyone who plays a game earns it toward the waitlist tiers,
// not just the person who booked, but only when they check in themselves at the ground:
//  - the booker or staff put players on the list: a player with a profile (found by mobile number) or a guest (a name only, so the
//    live score can use it; a guest never earns games);
//  - a player checks in from the Daji app, signed in to their own profile, with the phone at the ground (inside checkInRadiusMeters
//    of the ground's map pin, no fake-location app) and the phone unlocked by its owner (Face ID, fingerprint or passcode, in the app);
//  - one phone belongs to one player: a phone that checked in one profile cannot check in another for PHONE_BOUND_DAYS, so five people
//    cannot be checked in from one app. And one profile has one phone: moving it to a new phone needs a code texted to the profile's own
//    number. Staff can release a phone, and can check someone in by hand or undo a check-in, with a reason;
//  - with the face-recognition service connected (Settings › Connections, face-match; faceMatch.ts): each player agrees once and enrols
//    their face with a selfie (camera only), and every check-in selfie must match it. Daji keeps no face photos: the service keeps a
//    template, each selfie is sent once and dropped, and only the answer is kept. Without the service, check-in works without a face check.
// Games played (waitlist tiers) count checked-in games only. Games played before this existed are kept for the person who booked them.

registerSchema('booking-players-1', `
CREATE TABLE booking_players (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  user_id TEXT REFERENCES users(id),
  name TEXT NOT NULL,
  added_by TEXT,
  checked_in_at INTEGER,
  check_in_via TEXT CHECK (check_in_via IN ('phone','staff','history')),
  check_in_device TEXT,
  check_in_distance_m INTEGER,
  check_in_by TEXT,
  check_in_reason TEXT,
  voided_at INTEGER,
  voided_by TEXT,
  void_reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX uq_booking_players_user ON booking_players(booking_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX uq_booking_players_device ON booking_players(booking_id, check_in_device) WHERE check_in_device IS NOT NULL;
CREATE INDEX ix_booking_players_booking ON booking_players(booking_id, created_at);
CREATE INDEX ix_booking_players_user ON booking_players(user_id, checked_in_at);

CREATE TABLE check_in_phones (
  device_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  bound_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  released_at INTEGER,
  released_by TEXT
);
CREATE INDEX ix_check_in_phones_user ON check_in_phones(user_id);

INSERT INTO booking_players(id, booking_id, owner_id, user_id, name, checked_in_at, check_in_via, created_at)
  SELECT 'bp_' || b.id, b.id, b.owner_id, b.customer_id, u.name, b.end_at, 'history', b.end_at
  FROM bookings b JOIN users u ON u.id = b.customer_id
  WHERE (b.status = 'completed' OR (b.status = 'confirmed' AND b.end_at <= CAST(strftime('%s','now') AS INTEGER) * 1000));
`);

// The owner sent Daji's exact pin on 28 Oct 2026: a ground still on the earlier pin moves to it (nothing else is touched).
registerSchema('daji-pin-2026-10-28', `
UPDATE grounds SET lat = 21.1815, lng = 72.912556, map_url = 'https://maps.app.goo.gl/wGawo7LdNzKT8k4Y9'
  WHERE lat = 21.1818855 AND lng = 72.9134859 AND (map_url IS NULL OR map_url = 'https://maps.app.goo.gl/Qs2Wivwv76jt9zjG7');
`);

registerSchema('check-in-identity-1', `
CREATE TABLE check_in_face_checks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  sha256 TEXT NOT NULL UNIQUE,
  taken_at INTEGER NOT NULL,
  matched INTEGER NOT NULL,
  score REAL NOT NULL,
  face_found INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_check_in_face_checks_booking ON check_in_face_checks(booking_id, user_id);
ALTER TABLE booking_players ADD COLUMN face_check_id TEXT;
CREATE TABLE player_faces (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  template_id TEXT NOT NULL,
  consent_at INTEGER NOT NULL,
  enrolled_at INTEGER NOT NULL,
  forget_requested_at INTEGER
);
`);

export const MAX_PLAYERS = 30;
/** A face check must be used for check-in within this long of the selfie. */
export const FACE_CHECK_FRESH_MS = 10 * MIN;
export const PHONE_BOUND_DAYS = 30;
/** A phone whose own location fix is worse than this cannot prove it is at the ground. */
export const MAX_ACCURACY_M = 150;

interface BookingLite { id: string; ref: string; owner_id: string; ground_id: string; customer_id: string; status: string; start_at: number; end_at: number; deleted_at: number | null }
interface PlayerRow {
  id: string; booking_id: string; owner_id: string; user_id: string | null; name: string; added_by: string | null; checked_in_at: number | null;
  check_in_via: 'phone' | 'staff' | 'history' | null; check_in_device: string | null; check_in_distance_m: number | null; check_in_by: string | null;
  check_in_reason: string | null; voided_at: number | null; voided_by: string | null; void_reason: string | null; created_at: number; face_check_id: string | null;
}

/** Games someone played at this owner's grounds in the last 12 months: checked in (not undone), and the game is over and was not a no-show. */
export function gamesPlayed(userId: string, ownerId: string, t = now()): number {
  return one<{ n: number }>(
    `SELECT COUNT(DISTINCT p.booking_id) n FROM booking_players p JOIN bookings b ON b.id = p.booking_id
     WHERE p.user_id = ? AND p.checked_in_at IS NOT NULL AND p.voided_at IS NULL AND b.owner_id = ? AND b.deleted_at IS NULL
       AND b.start_at >= ? AND (b.status = 'completed' OR (b.status = 'confirmed' AND b.end_at <= ?))`,
    userId, ownerId, t - 365 * DAY, t)!.n;
}

/** Straight-line distance in metres between two map points. */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

const bookingRow = (id: string) => one<BookingLite>('SELECT id, ref, owner_id, ground_id, customer_id, status, start_at, end_at, deleted_at FROM bookings WHERE id = ?', id);
const playerRow = (id: string) => one<PlayerRow>('SELECT * FROM booking_players WHERE id = ?', id);
const rowsOf = (bookingId: string) => many<PlayerRow>('SELECT * FROM booking_players WHERE booking_id = ? ORDER BY created_at, id', bookingId);
const isStaffOf = (u: UserRow, ownerId: string) => u.role === 'super_admin' || (scopeOwnerId(u) === ownerId && hasPermission(u, 'manage_bookings'));

/** The booking, if this person may see its team list: the booker, a player on it with a profile, or staff of that business. */
function bookingFor(u: UserRow, bookingId: string): { b: BookingLite; staff: boolean; booker: boolean } {
  const b = bookingRow(bookingId);
  if (!b || b.deleted_at) throw notFound('Booking not found');
  if (u.role === 'customer') {
    const booker = b.customer_id === u.id;
    if (!booker && !one('SELECT 1 FROM booking_players WHERE booking_id = ? AND user_id = ?', bookingId, u.id)) throw notFound('Booking not found');
    return { b, staff: false, booker };
  }
  if (!isStaffOf(u, b.owner_id)) throw notFound('Booking not found');
  return { b, staff: true, booker: false };
}

/** The booker is always on the list; their row is made the first time the list changes or they check in. */
function ensureBooker(b: BookingLite): void {
  if (one('SELECT 1 FROM booking_players WHERE booking_id = ? AND user_id = ?', b.id, b.customer_id)) return;
  const name = one<{ name: string }>('SELECT name FROM users WHERE id = ?', b.customer_id)?.name ?? 'Booked by';
  run('INSERT INTO booking_players(id, booking_id, owner_id, user_id, name, added_by, created_at) VALUES(?,?,?,?,?,?,?)', newId('bp'), b.id, b.owner_id, b.customer_id, name, b.customer_id, now());
}

function window(b: BookingLite): { opensAt: number; closesAt: number } {
  return { opensAt: b.start_at - getSettings().checkInOpensMinutes * MIN, closesAt: b.end_at };
}

export interface PlayerView {
  id: string | null; name: string; hasProfile: boolean; isBooker: boolean; isYou: boolean; avatarUrl: string | null;
  checkedIn: boolean; checkedInAt: number | null; via: 'phone' | 'staff' | 'history' | null; distanceM: number | null;
  undone: boolean; undoReason: string | null; earns: boolean;
  /** Whether the player has a face enrolled; staff also see the face check of this check-in (score 0..100), when the service is on. */
  faceEnrolled: boolean; faceMatched: boolean | null; faceScore: number | null; userId: string | null;
}

export function teamList(u: UserRow, bookingId: string, faceOn = false) {
  const { b, staff, booker } = bookingFor(u, bookingId);
  const rows = rowsOf(b.id);
  if (!rows.some((r) => r.user_id === b.customer_id)) {
    const name = one<{ name: string }>('SELECT name FROM users WHERE id = ?', b.customer_id)?.name ?? 'Booked by';
    rows.unshift({ id: '', booking_id: b.id, owner_id: b.owner_id, user_id: b.customer_id, name, added_by: null, checked_in_at: null, check_in_via: null, check_in_device: null, check_in_distance_m: null, check_in_by: null, check_in_reason: null, voided_at: null, voided_by: null, void_reason: null, created_at: 0, face_check_id: null });
  }
  const enrolled = new Set(many<{ user_id: string }>(`SELECT user_id FROM player_faces WHERE forget_requested_at IS NULL AND user_id IN (${rows.map(() => '?').join(',') || "''"})`, ...rows.map((r) => r.user_id ?? '')).map((x) => x.user_id));
  const checks = new Map(many<{ id: string; matched: number; score: number }>('SELECT id, matched, score FROM check_in_face_checks WHERE booking_id = ?', b.id).map((x) => [x.id, x]));
  const avatars = new Map(many<{ id: string; avatar_id: string | null }>(`SELECT id, avatar_id FROM users WHERE id IN (${rows.map(() => '?').join(',') || "''"})`, ...rows.map((r) => r.user_id ?? '')).map((x) => [x.id, x.avatar_id]));
  const players: PlayerView[] = rows.map((r) => {
    const av = r.user_id ? avatars.get(r.user_id) : null;
    return {
      id: r.id || null, name: r.name, hasProfile: !!r.user_id, isBooker: r.user_id === b.customer_id, isYou: !!r.user_id && r.user_id === u.id,
      avatarUrl: staff && av ? `/api/avatar/${av}` : null,
      checkedIn: !!r.checked_in_at && !r.voided_at, checkedInAt: r.checked_in_at, via: r.check_in_via,
      distanceM: staff ? r.check_in_distance_m : null, undone: !!r.voided_at, undoReason: staff || r.user_id === u.id ? r.void_reason : null,
      earns: !!r.user_id && !!r.checked_in_at && !r.voided_at,
      faceEnrolled: !!r.user_id && (staff || r.user_id === u.id) && enrolled.has(r.user_id),
      faceMatched: staff && r.face_check_id ? !!checks.get(r.face_check_id)?.matched : null, faceScore: staff && r.face_check_id ? checks.get(r.face_check_id)?.score ?? null : null,
      userId: staff ? r.user_id : null,
    };
  });
  const g = groundRow(b.ground_id);
  const w = window(b); const t = now();
  return {
    booking: { id: b.id, ref: b.ref, status: b.status, startAt: b.start_at, endAt: b.end_at, groundName: g?.name ?? '' },
    players,
    canEdit: (booker || staff) && b.status !== 'cancelled' && b.status !== 'expired' && t < b.end_at,
    checkIn: {
      opensAt: w.opensAt, closesAt: w.closesAt, open: b.status === 'confirmed' && t >= w.opensAt && t <= w.closesAt,
      groundHasLocation: g?.lat != null && g?.lng != null, radiusM: getSettings().checkInRadiusMeters, maxPlayers: MAX_PLAYERS, faceCheck: faceOn,
    },
  };
}

/** Games someone else booked that this person is on the team list for, from yesterday on: so a player can find the game and check in. */
export function myTeamGames(u: UserRow) {
  const rows = many<BookingLite & { ground: string; booker: string; checked_in_at: number | null; voided_at: number | null }>(
    `SELECT b.id, b.ref, b.owner_id, b.ground_id, b.customer_id, b.status, b.start_at, b.end_at, b.deleted_at, g.name ground, bu.name booker, p.checked_in_at, p.voided_at
     FROM booking_players p JOIN bookings b ON b.id = p.booking_id JOIN grounds g ON g.id = b.ground_id JOIN users bu ON bu.id = b.customer_id
     WHERE p.user_id = ? AND b.customer_id <> ? AND b.deleted_at IS NULL AND b.status IN ('confirmed','held','completed') AND b.end_at >= ?
     ORDER BY b.start_at LIMIT 20`, u.id, u.id, now() - DAY);
  return { items: rows.map((r) => ({ id: r.id, ref: r.ref, groundName: r.ground, bookedBy: r.booker, status: r.status, startAt: r.start_at, endAt: r.end_at, checkedIn: !!r.checked_in_at && !r.voided_at, opensAt: window(r).opensAt })) };
}

/** Adds a player: with a mobile number that has a Daji profile they are linked and can earn the game; otherwise a guest (name only). */
export function addPlayer(u: UserRow, bookingId: string, body: unknown) {
  const { b, staff, booker } = bookingFor(u, bookingId);
  if (!booker && !staff) throw new HttpError(403, 'FORBIDDEN', 'Only the person who booked, or the ground staff, can change the team list.');
  const v = new Validator(body ?? {});
  const name = v.str('name', { required: true, min: 2, max: 60 });
  const phone = v.phone('phone');
  v.done();
  const t = now();
  if (b.status === 'cancelled' || b.status === 'expired' || t >= b.end_at) throw new HttpError(409, 'BOOKING_CLOSED', 'This game is over or cancelled, so its team list is closed.');
  const linked = phone ? one<{ id: string }>("SELECT id FROM users WHERE phone = ? AND role = 'customer' AND active = 1 ORDER BY (password_hash IS NOT NULL) DESC, created_at LIMIT 1", normalizePhone(phone)) : undefined;
  const id = newId('bp');
  tx(() => {
    ensureBooker(b);
    if ((one<{ n: number }>('SELECT COUNT(*) n FROM booking_players WHERE booking_id = ?', b.id)!.n) >= MAX_PLAYERS) throw new HttpError(409, 'TEAM_LIST_FULL', `A team list holds at most ${MAX_PLAYERS} players.`);
    if (linked && one('SELECT 1 FROM booking_players WHERE booking_id = ? AND user_id = ?', b.id, linked.id)) throw new HttpError(409, 'PLAYER_ALREADY_ADDED', 'That player is already on the team list.');
    run('INSERT INTO booking_players(id, booking_id, owner_id, user_id, name, added_by, created_at) VALUES(?,?,?,?,?,?,?)', id, b.id, b.owner_id, linked?.id ?? null, name!, u.id, t);
    audit({ id: u.id, role: u.role }, 'team.add', 'booking', b.id, { player: id, profile: !!linked, by: staff ? 'staff' : 'booker' }, b.owner_id);
  });
  return { player: teamList(u, b.id).players.find((p) => p.id === id)!, profile: !!linked, note: linked ? null : 'No Daji profile has that number, so they are on the list as a guest: fine for the live score, but the game will not count for them.' };
}

/** Takes someone off the list (not once they have checked in: staff undo the check-in instead). A player may take themselves off. */
export function removePlayer(u: UserRow, bookingId: string, playerId: string) {
  const { b, staff, booker } = bookingFor(u, bookingId);
  const p = playerRow(playerId);
  if (!p || p.booking_id !== b.id) throw notFound('Player not found');
  const self = !!p.user_id && p.user_id === u.id;
  if (!booker && !staff && !self) throw new HttpError(403, 'FORBIDDEN', 'Only the person who booked, or the ground staff, can change the team list.');
  if (p.user_id === b.customer_id) throw new HttpError(409, 'BOOKER_STAYS', 'The person who booked always stays on the team list.');
  if (p.checked_in_at) throw new HttpError(409, 'ALREADY_CHECKED_IN', 'They have checked in. Ask the ground staff to undo the check-in if it is wrong.');
  tx(() => {
    run('DELETE FROM booking_players WHERE id = ? AND checked_in_at IS NULL', p.id);
    audit({ id: u.id, role: u.role }, 'team.remove', 'booking', b.id, { player: p.id, name: p.name, by: staff ? 'staff' : self ? 'self' : 'booker' }, b.owner_id);
  });
  return { removed: true };
}

export interface CheckInInput { lat: number; lng: number; accuracy: number; deviceId: string; mocked: boolean; unlocked: boolean; faceCheckId: string | null; moveCode: string | null }
export function parseCheckIn(body: unknown): CheckInInput {
  const v = new Validator(body ?? {});
  const lat = v.num('lat', { required: true, min: -90, max: 90 });
  const lng = v.num('lng', { required: true, min: -180, max: 180 });
  const accuracy = v.num('accuracy', { required: true, min: 0, max: 100000 });
  const deviceId = v.str('deviceId', { required: true, min: 16, max: 100 });
  const mocked = v.bool('mocked') ?? false;
  const unlocked = v.bool('unlocked') ?? false;
  const faceCheckId = v.str('faceCheckId', { max: 40 }) ?? null;
  const moveCode = v.str('moveCode', { min: 6, max: 6 }) ?? null;
  v.done();
  return { lat: lat!, lng: lng!, accuracy: accuracy!, deviceId: deviceId!, mocked, unlocked, faceCheckId, moveCode };
}

/** A player checks themselves in from the app, at the ground. Only for the profile signed in on this phone. */
export function checkIn(cfg: Config, u: UserRow, bookingId: string, input: CheckInInput) {
  const faceOn = faceMatchReady(cfg);
  if (u.role !== 'customer') throw new HttpError(403, 'FORBIDDEN', 'Players check in from the Daji app on their own phone. Staff can check someone in from the desk.');
  const { b } = bookingFor(u, bookingId);
  const t = now(); const w = window(b);
  const mineRow = () => one<PlayerRow>('SELECT * FROM booking_players WHERE booking_id = ? AND user_id = ?', b.id, u.id);
  const already = mineRow();
  if (already?.voided_at) throw new HttpError(409, 'CHECK_IN_UNDONE', 'The ground staff undid your check-in for this game. Please speak to them.');
  if (already?.checked_in_at) return { already: true, player: teamList(u, b.id, faceOn).players.find((p) => p.isYou)! };
  if (b.status !== 'confirmed') throw new HttpError(409, 'NOT_CONFIRMED', 'Check-in opens once the booking is confirmed.');
  if (t < w.opensAt) throw new HttpError(409, 'TOO_EARLY', `Check-in opens at ${fmtDateTime(w.opensAt)}.`, { opensAt: w.opensAt });
  if (t > w.closesAt) throw new HttpError(409, 'TOO_LATE', 'This game is over, so check-in has closed.');
  if (!input.unlocked) throw new HttpError(403, 'PHONE_NOT_UNLOCKED', 'Unlock with your Face ID, fingerprint or phone passcode to check in.');
  if (input.mocked) throw new HttpError(403, 'LOCATION_MOCKED', 'This phone is using a fake-location app. Turn it off to check in.');
  const g = groundRow(b.ground_id);
  if (g?.lat == null || g?.lng == null) throw new HttpError(409, 'GROUND_LOCATION_MISSING', 'This ground has no map pin yet, so check-in by phone is not possible. The ground staff can check you in.');
  if (input.accuracy > MAX_ACCURACY_M) throw new HttpError(422, 'LOCATION_NOT_PRECISE', 'Your phone\'s location is not precise enough. Turn on precise location, step outside if you can, and try again.');
  const dist = distanceMeters(input.lat, input.lng, g.lat, g.lng);
  const radius = getSettings().checkInRadiusMeters;
  if (dist > radius) throw new HttpError(403, 'NOT_AT_GROUND', `You need to be at ${g.name} to check in (you are about ${dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${dist} m`} away).`, { distanceM: dist, radiusM: radius });
  tx(() => {
    const phone = one<{ user_id: string; bound_at: number; released_at: number | null }>('SELECT user_id, bound_at, released_at FROM check_in_phones WHERE device_id = ?', input.deviceId);
    if (phone && phone.user_id !== u.id && !phone.released_at && t - phone.bound_at < PHONE_BOUND_DAYS * DAY) {
      throw new HttpError(409, 'PHONE_BELONGS_TO_ANOTHER_PLAYER', 'This phone is already used to check in another player. Each player checks in on their own phone, signed in to their own profile. If this is your phone now, ask the ground staff to release it.');
    }
    if (one("SELECT 1 FROM booking_players WHERE booking_id = ? AND check_in_device = ? AND (user_id IS NULL OR user_id <> ?)", b.id, input.deviceId, u.id)) {
      throw new HttpError(409, 'PHONE_BELONGS_TO_ANOTHER_PLAYER', 'This phone has already checked someone else in for this game. Each player checks in on their own phone.');
    }
    // one profile, one phone: a different phone needs a code sent to the profile's own number (or staff release the old phone)
    const other = one<{ device_id: string }>('SELECT device_id FROM check_in_phones WHERE user_id = ? AND device_id <> ? AND released_at IS NULL ORDER BY last_used_at DESC LIMIT 1', u.id, input.deviceId);
    let moved = false;
    if (other) {
      if (!input.moveCode) throw new HttpError(409, 'PROFILE_ON_ANOTHER_PHONE', `Your profile checks in on another phone. To use this phone instead, we will text a code to your number ending ${String(u.phone ?? '').slice(-4) || '…'}.`, { needsCode: true });
      if (!u.phone) throw new HttpError(409, 'NO_PHONE_ON_PROFILE', 'Your profile has no mobile number, so the ground staff need to move your check-in phone.');
      checkOtp(cfg, u.phone, input.moveCode).consume();
      run('UPDATE check_in_phones SET released_at = ?, released_by = ? WHERE user_id = ? AND device_id <> ? AND released_at IS NULL', t, u.id, u.id, input.deviceId);
      moved = true;
    }
    // with the face service on: a matching face check from the last few minutes, for this player and this game, used once
    let face: { id: string } | undefined;
    if (faceOn) {
      if (!one('SELECT 1 FROM player_faces WHERE user_id = ? AND forget_requested_at IS NULL', u.id)) throw new HttpError(409, 'FACE_NOT_ENROLLED', 'Add your face for check-in first (once). It is used only to confirm it is you.');
      face = one<{ id: string }>('SELECT id FROM check_in_face_checks WHERE id = ? AND user_id = ? AND booking_id = ? AND matched = 1 AND used_at IS NULL AND created_at >= ?', input.faceCheckId ?? '', u.id, b.id, t - FACE_CHECK_FRESH_MS);
      if (!face) throw new HttpError(422, 'FACE_CHECK_NEEDED', 'Take a selfie with the camera to check in.');
    }
    const elsewhere = one<{ ref: string }>(
      `SELECT b.ref FROM booking_players p JOIN bookings b ON b.id = p.booking_id
       WHERE p.user_id = ? AND p.checked_in_at IS NOT NULL AND p.voided_at IS NULL AND p.booking_id <> ? AND b.start_at < ? AND b.end_at > ?`, u.id, b.id, b.end_at, b.start_at);
    if (elsewhere) throw new HttpError(409, 'CHECKED_IN_ELSEWHERE', `You are already checked in to another game at this time (${elsewhere.ref}).`);
    const mine = mineRow();
    if (!mine) {
      if (b.customer_id !== u.id) throw new HttpError(403, 'NOT_ON_TEAM_LIST', 'You are not on the team list for this game. Ask the person who booked to add you with your mobile number.');
      ensureBooker(b);
    }
    run(`UPDATE booking_players SET checked_in_at = ?, check_in_via = 'phone', check_in_device = ?, check_in_distance_m = ?, check_in_by = ?, face_check_id = ?
         WHERE booking_id = ? AND user_id = ? AND checked_in_at IS NULL`, t, input.deviceId, dist, u.id, face?.id ?? null, b.id, u.id);
    if (face) run('UPDATE check_in_face_checks SET used_at = ? WHERE id = ?', t, face.id);
    if (phone && phone.user_id === u.id) run('UPDATE check_in_phones SET last_used_at = ? WHERE device_id = ?', t, input.deviceId);
    else if (phone) run('UPDATE check_in_phones SET user_id = ?, bound_at = ?, last_used_at = ?, released_at = NULL, released_by = NULL WHERE device_id = ?', u.id, t, t, input.deviceId);
    else run('INSERT INTO check_in_phones(device_id, user_id, bound_at, last_used_at) VALUES(?,?,?,?)', input.deviceId, u.id, t, t);
    audit({ id: u.id, role: u.role }, 'team.check_in', 'booking', b.id, { via: 'phone', distanceM: dist, accuracyM: Math.round(input.accuracy), faceCheck: face?.id ?? null, movedPhone: moved }, b.owner_id);
  });
  return { already: false, player: teamList(u, b.id, faceOn).players.find((p) => p.isYou)! };
}

function staffReason(body: unknown, what: string): string {
  const v = new Validator(body ?? {});
  const reason = v.str('reason', { max: 200 });
  v.done();
  if (!reason || reason.length < 3) throw new HttpError(400, 'VALIDATION_FAILED', `Say why you are ${what}`, { fields: [{ field: 'reason', message: 'At least 3 characters' }] });
  return reason;
}

/** Staff check a player in by hand (their phone would not work, no map pin, a guest). Counts like a phone check-in. */
export function staffCheckIn(u: UserRow, bookingId: string, playerId: string, body: unknown) {
  const { b, staff } = bookingFor(u, bookingId);
  if (!staff) throw new HttpError(403, 'FORBIDDEN', 'Only the ground staff can check someone in by hand.');
  const reason = staffReason(body, 'checking them in by hand');
  const p = playerRow(playerId);
  if (!p || p.booking_id !== b.id) throw notFound('Player not found');
  if (b.status !== 'confirmed' && b.status !== 'completed') throw new HttpError(409, 'NOT_CONFIRMED', 'Only a confirmed game can be checked in.');
  if (p.user_id && one(
    `SELECT 1 FROM booking_players x JOIN bookings y ON y.id = x.booking_id WHERE x.user_id = ? AND x.checked_in_at IS NOT NULL AND x.voided_at IS NULL
       AND x.booking_id <> ? AND y.start_at < ? AND y.end_at > ?`, p.user_id, b.id, b.end_at, b.start_at)) throw new HttpError(409, 'CHECKED_IN_ELSEWHERE', 'They are already checked in to another game at this time.');
  tx(() => {
    run(`UPDATE booking_players SET checked_in_at = ?, check_in_via = 'staff', check_in_by = ?, check_in_reason = ?, voided_at = NULL, voided_by = NULL, void_reason = NULL WHERE id = ?`, now(), u.id, reason, p.id);
    audit({ id: u.id, role: u.role }, 'team.check_in', 'booking', b.id, { via: 'staff', player: p.id, reason }, b.owner_id);
  });
  return teamList(u, b.id);
}

/** Staff undo a check-in that looks wrong (someone else played on that profile). The row stays, so the history is kept; it no longer counts. */
export function undoCheckIn(u: UserRow, bookingId: string, playerId: string, body: unknown) {
  const { b, staff } = bookingFor(u, bookingId);
  if (!staff) throw new HttpError(403, 'FORBIDDEN', 'Only the ground staff can undo a check-in.');
  const reason = staffReason(body, 'undoing this check-in');
  const p = playerRow(playerId);
  if (!p || p.booking_id !== b.id) throw notFound('Player not found');
  if (!p.checked_in_at || p.voided_at) throw new HttpError(409, 'NOT_CHECKED_IN', 'They are not checked in.');
  tx(() => {
    run('UPDATE booking_players SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ?', now(), u.id, reason, p.id);
    audit({ id: u.id, role: u.role }, 'team.check_in_undone', 'booking', b.id, { player: p.id, reason }, b.owner_id);
  });
  return teamList(u, b.id);
}

/** Staff release a phone so it can check in a different player (a phone given to a family member, a second-hand phone). */
export function releasePhones(u: UserRow, ownerId: string, userId: string, body: unknown) {
  if (!isStaffOf(u, ownerId)) throw new HttpError(403, 'FORBIDDEN', 'This needs the "manage_bookings" permission');
  const reason = staffReason(body, 'releasing their phone');
  if (!one('SELECT 1 FROM booking_players WHERE user_id = ? AND owner_id = ?', userId, ownerId)) throw notFound('Player not found');
  let n = 0;
  tx(() => {
    n = run('UPDATE check_in_phones SET released_at = ?, released_by = ? WHERE user_id = ? AND released_at IS NULL', now(), u.id, userId).changes;
    audit({ id: u.id, role: u.role }, 'team.phone_released', 'user', userId, { phones: n, reason }, ownerId);
  });
  return { released: n };
}

/** Today's check-ins for a business, for the desk and Ask AI. Names only when asked for (staff with the permission). */
export function checkInsOn(ownerId: string, from: number, to: number, names: boolean) {
  const rows = many<{ ref: string; ground: string; start_at: number; name: string; user_id: string | null; via: string | null; at: number | null; voided_at: number | null }>(
    `SELECT b.ref, g.name ground, b.start_at, p.name, p.user_id, p.check_in_via via, p.checked_in_at at, p.voided_at
     FROM booking_players p JOIN bookings b ON b.id = p.booking_id JOIN grounds g ON g.id = b.ground_id
     WHERE b.owner_id = ? AND b.deleted_at IS NULL AND b.start_at >= ? AND b.start_at < ? ORDER BY b.start_at, p.created_at`, ownerId, from, to);
  const games = new Set(rows.map((r) => r.ref)).size;
  const checkedIn = rows.filter((r) => r.at && !r.voided_at);
  return {
    games, players: rows.length, checkedIn: checkedIn.length, guests: rows.filter((r) => !r.user_id).length,
    byStaff: checkedIn.filter((r) => r.via === 'staff').length, undone: rows.filter((r) => r.voided_at).length,
    ...(names ? { list: rows.map((r) => ({ ref: r.ref, ground: r.ground, startAt: r.start_at, name: r.name, guest: !r.user_id, checkedIn: !!r.at && !r.voided_at, via: r.via, undone: !!r.voided_at })) } : {}),
  };
}

/** A camera picture taken in the app moments ago (the same camera-only rules as task photos), never seen twice. */
function freshCameraShot(data: Buffer, t: number, appShotAt: number | undefined, table: 'check_in_face_checks'): { takenAt: number; sha: string } {
  if (data.length > MAX_TASK_PHOTO_BYTES) throw new HttpError(413, 'FILE_TOO_LARGE', 'That photo is too large.');
  const { takenAt } = checkCameraPhoto(data, t, appShotAt);
  const sha = createHash('sha256').update(data).digest('hex');
  if (one(`SELECT 1 FROM ${table} WHERE sha256 = ?`, sha)) throw new HttpError(409, 'PHOTO_ALREADY_USED', 'This photo has already been used. Take a new selfie.');
  return { takenAt, sha };
}

/** Check-in selfie: sent once to the face service and compared with the player's enrolled face. The photo itself is not kept. */
export async function faceCheck(cfg: Config, u: UserRow, bookingId: string, data: Buffer, appShotAt?: number): Promise<{ faceCheckId: string; matched: true }> {
  if (u.role !== 'customer') throw new HttpError(403, 'FORBIDDEN', 'Players take their own check-in selfie in the Daji app.');
  if (!faceMatchReady(cfg)) throw new HttpError(409, 'FACE_SERVICE_OFF', 'Face checks are not switched on for this ground, so no selfie is needed.');
  const { b } = bookingFor(u, bookingId);
  const t = now(); const w = window(b);
  if (b.status !== 'confirmed' || t < w.opensAt || t > w.closesAt) throw new HttpError(409, 'CHECK_IN_CLOSED', 'Check-in is not open for this game right now.');
  const f = one<{ template_id: string }>('SELECT template_id FROM player_faces WHERE user_id = ? AND forget_requested_at IS NULL', u.id);
  if (!f) throw new HttpError(409, 'FACE_NOT_ENROLLED', 'Add your face for check-in first (once). It is used only to confirm it is you.');
  const { takenAt, sha } = freshCameraShot(data, t, appShotAt, 'check_in_face_checks');
  const r = await verifyFace(cfg, f.template_id, data);
  const id = newId('fck');
  const matched = r.match && r.faceFound;
  tx(() => {
    run('INSERT INTO check_in_face_checks(id, user_id, booking_id, owner_id, sha256, taken_at, matched, score, face_found, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)', id, u.id, b.id, b.owner_id, sha, takenAt, matched ? 1 : 0, r.score, r.faceFound ? 1 : 0, now());
    audit({ id: u.id, role: u.role }, 'team.face_check', 'booking', b.id, { faceCheck: id, matched, score: r.score, faceFound: r.faceFound }, b.owner_id);
  });
  if (!r.faceFound) throw new HttpError(422, 'FACE_NOT_FOUND', 'We could not see one clear face. Only you in the photo, facing the camera in good light, then try again.');
  if (!matched) throw new HttpError(403, 'FACE_MISMATCH', 'This selfie does not match the face enrolled on this profile. Each player checks in for themselves. If this is wrong, the ground staff can check you in.');
  return { faceCheckId: id, matched: true };
}

/** A player agrees and enrols their face (once), with a selfie from the camera. The face service keeps a template; Daji keeps no photo. */
export async function enrollMyFace(cfg: Config, u: UserRow, data: Buffer, consent: boolean, appShotAt?: number) {
  if (u.role !== 'customer') throw new HttpError(403, 'FORBIDDEN', 'Only players enrol a face for check-in.');
  if (!faceMatchReady(cfg)) throw new HttpError(409, 'FACE_SERVICE_OFF', 'Face checks are not switched on, so there is nothing to enrol.');
  if (!consent) throw new HttpError(400, 'CONSENT_NEEDED', 'Agree to the face check first. It is used only to confirm it is you when you check in.');
  if (one('SELECT 1 FROM player_faces WHERE user_id = ?', u.id)) throw new HttpError(409, 'FACE_ALREADY_ENROLLED', 'Your face is already enrolled. To change it, remove it first, or ask the ground staff.');
  if (data.length > MAX_TASK_PHOTO_BYTES) throw new HttpError(413, 'FILE_TOO_LARGE', 'That photo is too large.');
  checkCameraPhoto(data, now(), appShotAt);
  const r = await enrollFace(cfg, data, u.id);
  const t = now();
  tx(() => {
    run('INSERT INTO player_faces(user_id, template_id, consent_at, enrolled_at) VALUES(?,?,?,?)', u.id, r.templateId, t, t);
    audit({ id: u.id, role: u.role }, 'team.face_enrolled', 'user', u.id, {}, null);
  });
  return { faceEnrolled: true };
}

/** Whether this player has a face enrolled, and whether face checks are on. */
export function myFace(cfg: Config, u: UserRow) {
  return { faceCheck: faceMatchReady(cfg), enrolled: !!one('SELECT 1 FROM player_faces WHERE user_id = ? AND forget_requested_at IS NULL', u.id) };
}

/** The player takes their face back (withdraws consent). The service is asked to delete the template on the next sweep. */
export function removeMyFace(u: UserRow) {
  const n = run('UPDATE player_faces SET forget_requested_at = ? WHERE user_id = ? AND forget_requested_at IS NULL', now(), u.id).changes;
  if (n) audit({ id: u.id, role: u.role }, 'team.face_removed', 'user', u.id, { by: 'self' }, null);
  return { removed: n > 0 };
}

/** Sends the code that lets a profile move to a new check-in phone, to the profile's own mobile number. */
export async function moveCode(cfg: Config, u: UserRow) {
  if (u.role !== 'customer') throw new HttpError(403, 'FORBIDDEN', 'Only players have a check-in phone.');
  if (!u.phone) throw new HttpError(409, 'NO_PHONE_ON_PROFILE', 'Your profile has no mobile number, so the ground staff need to move your check-in phone.');
  const r = await requestOtp(cfg, u.phone);
  audit({ id: u.id, role: u.role }, 'team.phone_move_code', 'user', u.id, {});
  return { ...r, to: `…${u.phone.slice(-4)}` };
}

/** Staff remove an enrolled face that is wrong (someone else enrolled on this profile). The player enrols again. */
export function resetFace(u: UserRow, ownerId: string, userId: string, body: unknown) {
  if (!isStaffOf(u, ownerId)) throw new HttpError(403, 'FORBIDDEN', 'This needs the "manage_bookings" permission');
  const reason = staffReason(body, 'resetting their face');
  if (!one('SELECT 1 FROM booking_players WHERE user_id = ? AND owner_id = ?', userId, ownerId)) throw notFound('Player not found');
  const n = run('UPDATE player_faces SET forget_requested_at = ? WHERE user_id = ? AND forget_requested_at IS NULL', now(), userId).changes;
  if (!n) throw new HttpError(409, 'NO_FACE_ENROLLED', 'This player has no face enrolled.');
  audit({ id: u.id, role: u.role }, 'team.face_reset', 'user', userId, { reason }, ownerId);
  return { reset: true };
}

/** Account deletion: the enrolled face goes with the account (the check-in records stay). */
export function forgetFaces(userId: string): void {
  run('UPDATE player_faces SET forget_requested_at = ? WHERE user_id = ? AND forget_requested_at IS NULL', now(), userId);
}

/** Asks the face service to delete templates that players removed, staff reset or that went with a deleted account, then drops the rows. */
export async function sweepFaceForgets(cfg: Config): Promise<number> {
  const rows = many<{ user_id: string; template_id: string }>('SELECT user_id, template_id FROM player_faces WHERE forget_requested_at IS NOT NULL LIMIT 50');
  let n = 0;
  for (const r of rows) {
    if (faceMatchReady(cfg) && !(await forgetFace(cfg, r.template_id))) continue;
    run('DELETE FROM player_faces WHERE user_id = ? AND forget_requested_at IS NOT NULL', r.user_id); n++;
  }
  return n;
}
