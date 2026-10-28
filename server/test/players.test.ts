import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, setNow, slotStart, bookAndPay, dayFromNow, HOUR, MIN, DAY, type Harness, type GroundLite } from './helpers.ts';
import { gamesPlayed, distanceMeters, sweepFaceForgets } from '../src/players.ts';
import { signRekognition } from '../src/faceMatch.ts';
import { createServer, type Server } from 'node:http';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { now } from '../src/clock.ts';
import { DAJI_LOCATION } from '../src/seed.ts';
import { many, one, run } from '../src/db.ts';
import { tierFor } from '../src/waitlist.ts';
import { getSettings } from '../src/settings.ts';

// The team list and check-in at the ground: every player who checks in earns the game, a guest never does, one phone is one player,
// check-in only at the ground and only for yourself, and staff can check in by hand, undo a wrong check-in and release a phone.

let h: Harness, g: GroundLite, owner: string, staff: string;
const DATE = dayFromNow(3);
const START = () => slotStart(DATE, '10:00');
const AT_GROUND = { lat: DAJI_LOCATION.lat + 0.0005, lng: DAJI_LOCATION.lng, accuracy: 12, mocked: false, unlocked: true };
let n = 0;
const phoneOf = (i: number) => `97${String(10000000 + i).slice(-8)}`;
async function newCustomer(): Promise<{ token: string; id: string; phone: string }> {
  n++;
  const phone = phoneOf(n);
  const r = await h.post('/api/auth/register', { name: `Player ${n}`, email: `tl${n}@example.com`, phone, password: 'Cricket@12345' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { token: r.body.token, id: r.body.user.id, phone };
}
const device = (k: string) => `device-${k}-0123456789abcdef`;
let shots = 0;
/** A camera picture taken in the app just now (no EXIF; the app says when it was taken). */
const shot = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]), Buffer.from(`selfie-${++shots}`), Buffer.from([0xff, 0xd9])]);
/** Check-in from the app. With the face service on, a face check (selfie) comes first unless the test passes its own faceCheckId. */
async function faceCheck(token: string, bookingId: string): Promise<string | undefined> {
  const r = await h.call('POST', `/api/bookings/${bookingId}/check-in/face`, { token, raw: shot(), headers: { 'content-type': 'application/octet-stream', 'x-app-shot-at': String(now()) } });
  return r.status === 201 ? r.body.faceCheckId : undefined;
}
async function checkIn(token: string, bookingId: string, extra: Record<string, unknown> = {}) {
  const faceCheckId = 'faceCheckId' in extra ? extra.faceCheckId : h.cfg.faceMatch.keyId ? await faceCheck(token, bookingId) : undefined;
  return h.post(`/api/bookings/${bookingId}/check-in`, { ...AT_GROUND, deviceId: device('a'), ...(faceCheckId ? { faceCheckId } : {}), ...extra }, token);
}
const add = (token: string, bookingId: string, body: Record<string, unknown>) => h.post(`/api/bookings/${bookingId}/players`, body, token);
/** Marks the game played (as staff would at the end of the day). */
const finish = (bookingId: string) => run("UPDATE bookings SET status = 'completed' WHERE id = ?", bookingId);

before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset();
  g = (await grounds(h))[0]!;
  owner = await h.login('owner1'); staff = await h.login('staff1');
});

test('distance is measured in metres; the shipped settings are 150 m (about 500 feet) and 60 minutes; tiers are 25, 50, 75, 100 and 150 games', () => {
  assert.ok(Math.abs(distanceMeters(DAJI_LOCATION.lat, DAJI_LOCATION.lng, DAJI_LOCATION.lat + 0.0005, DAJI_LOCATION.lng) - 56) <= 1);
  assert.equal(getSettings().checkInRadiusMeters, 150); assert.equal(getSettings().checkInOpensMinutes, 60);
  assert.deepEqual(getSettings().waitlistTiers.map((t) => t.minGames), [150, 100, 75, 50, 25]);
  assert.equal(tierFor(24).tier, null); assert.equal(tierFor(25).tier, 'Bronze'); assert.equal(tierFor(149).tier, 'Platinum'); assert.equal(tierFor(150).tier, 'Diamond');
});

test('22 players: the booker adds players with a profile and guests; every player who checks in earns the game, guests never do', async () => {
  const booker = await newCustomer();
  const team: Awaited<ReturnType<typeof newCustomer>>[] = [];
  for (let i = 0; i < 20; i++) team.push(await newCustomer());
  const b = await bookAndPay(h, booker.token, g.id, DATE, '10:00');
  for (const p of team) assert.equal((await add(booker.token, b.id, { name: `Team ${p.phone}`, phone: p.phone })).status, 201);
  const guest = await add(booker.token, b.id, { name: 'Uncle Ravi' });
  assert.equal(guest.status, 201); assert.equal(guest.body.profile, false); assert.match(guest.body.note, /guest/);
  const list = (await h.get(`/api/bookings/${b.id}/players`, booker.token)).body;
  assert.equal(list.players.length, 22);
  assert.equal(list.players.filter((p: any) => p.hasProfile).length, 21);
  assert.equal((await add(booker.token, b.id, { name: 'Again', phone: team[0]!.phone })).body.error.code, 'PLAYER_ALREADY_ADDED');
  // nobody can check in before it opens
  setNow(START() - 2 * HOUR);
  assert.equal((await checkIn(booker.token, b.id)).body.error.code, 'TOO_EARLY');
  setNow(START() - 30 * MIN);
  assert.equal((await checkIn(booker.token, b.id, { deviceId: device('booker') })).status, 200);
  for (const [i, p] of team.entries()) assert.equal((await checkIn(p.token, b.id, { deviceId: device(`p${i}`) })).status, 200, `player ${i}`);
  finish(b.id);
  setNow(START() + DAY);
  assert.equal(gamesPlayed(booker.id, g.ownerId), 1);
  for (const p of team) assert.equal(gamesPlayed(p.id, g.ownerId), 1);
  const after = (await h.get(`/api/bookings/${b.id}/players`, team[3]!.token)).body;
  const mine = (await h.get('/api/my/team-games', team[3]!.token)).body.items;
  assert.equal(mine.length, 1); assert.equal(mine[0].id, b.id); assert.equal(mine[0].checkedIn, true); assert.ok(mine[0].bookedBy);
  assert.equal(after.players.filter((p: any) => p.earns).length, 21);
  assert.equal(after.players.find((p: any) => p.name === 'Uncle Ravi').earns, false);
  // a player on the list sees it, but cannot change it
  assert.equal((await add(team[3]!.token, b.id, { name: 'Sneaky' })).status, 403);
});

test('one phone is one player: a second profile on the same phone is refused, for this game and for 30 days', async () => {
  const booker = await newCustomer(), friend = await newCustomer();
  const b = await bookAndPay(h, booker.token, g.id, DATE, '10:00');
  await add(booker.token, b.id, { name: 'Friend', phone: friend.phone });
  setNow(START() - 10 * MIN);
  assert.equal((await checkIn(booker.token, b.id, { deviceId: device('shared') })).status, 200);
  const r = await checkIn(friend.token, b.id, { deviceId: device('shared') });
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'PHONE_BELONGS_TO_ANOTHER_PLAYER');
  // the next game, a week later, the phone still belongs to the booker
  const b2 = await bookAndPay(h, friend.token, g.id, dayFromNow(10), '10:00');
  setNow(slotStart(dayFromNow(10), '10:00') - 10 * MIN);
  assert.equal((await checkIn(friend.token, b2.id, { deviceId: device('shared') })).body.error.code, 'PHONE_BELONGS_TO_ANOTHER_PLAYER');
  // their own phone works
  assert.equal((await checkIn(friend.token, b2.id, { deviceId: device('friend') })).status, 200);
  // staff release the booker's phone (given to the friend): it can now check the friend in
  const b3 = await bookAndPay(h, friend.token, g.id, dayFromNow(12), '10:00');
  setNow(slotStart(dayFromNow(12), '10:00') - 10 * MIN);
  assert.equal((await h.post(`/api/staff/players/${booker.id}/release-phone`, {}, staff)).status, 400, 'a reason is needed');
  assert.equal((await h.post(`/api/staff/players/${booker.id}/release-phone`, { reason: 'Gave the phone to his brother' }, staff)).body.released, 1);
  // the friend's profile is on their own phone, so moving it needs their code too (or staff release that one as well)
  assert.equal((await checkIn(friend.token, b3.id, { deviceId: device('shared') })).body.error.code, 'PROFILE_ON_ANOTHER_PHONE');
  assert.equal((await h.post(`/api/staff/players/${friend.id}/release-phone`, { reason: 'Uses his brother\'s old phone now' }, staff)).body.released, 1);
  assert.equal((await checkIn(friend.token, b3.id, { deviceId: device('shared') })).status, 200);
});

test('only at the ground, only for yourself, phone unlocked, no fake location, precise enough', async () => {
  const booker = await newCustomer(), stranger = await newCustomer();
  const b = await bookAndPay(h, booker.token, g.id, DATE, '10:00');
  setNow(START() - 10 * MIN);
  const far = await checkIn(booker.token, b.id, { lat: DAJI_LOCATION.lat + 0.02 });
  assert.equal(far.status, 403); assert.equal(far.body.error.code, 'NOT_AT_GROUND'); assert.match(far.body.error.message, /2\.2 km away/);
  assert.equal((await checkIn(booker.token, b.id, { mocked: true })).body.error.code, 'LOCATION_MOCKED');
  assert.equal((await checkIn(booker.token, b.id, { unlocked: false })).body.error.code, 'PHONE_NOT_UNLOCKED');
  assert.equal((await checkIn(booker.token, b.id, { accuracy: 900 })).body.error.code, 'LOCATION_NOT_PRECISE');
  assert.equal((await checkIn(booker.token, b.id, { deviceId: 'short' })).status, 400);
  // someone not on the list cannot even see the game
  assert.equal((await checkIn(stranger.token, b.id, { deviceId: device('x') })).status, 404);
  assert.equal((await h.get(`/api/bookings/${b.id}/players`, stranger.token)).status, 404);
  // staff cannot check in through the player route
  assert.equal((await h.post(`/api/bookings/${b.id}/check-in`, { ...AT_GROUND, deviceId: device('s') }, staff)).status, 403);
  // all good: checked in once, a repeat is harmless
  assert.equal((await checkIn(booker.token, b.id)).status, 200);
  const again = await checkIn(booker.token, b.id);
  assert.equal(again.status, 200); assert.equal(again.body.already, true);
  // after the game, check-in is closed
  const b2 = await bookAndPay(h, booker.token, g.id, dayFromNow(5), '10:00');
  setNow(slotStart(dayFromNow(5), '10:00') + 2 * HOUR);
  assert.equal((await checkIn(booker.token, b2.id, { deviceId: device('a') })).body.error.code, 'TOO_LATE');
});

test('staff: see the list with photos and distance, check a guest or a player in by hand, undo a wrong check-in (it stops counting)', async () => {
  const booker = await newCustomer(), p = await newCustomer();
  const b = await bookAndPay(h, booker.token, g.id, DATE, '10:00');
  const added = await h.post(`/api/staff/bookings/${b.id}/players`, { name: 'Walk-in Player', phone: p.phone }, staff);
  assert.equal(added.status, 201); assert.equal(added.body.profile, true);
  setNow(START() - 10 * MIN);
  assert.equal((await checkIn(p.token, b.id, { deviceId: device('p') })).status, 200);
  const list = (await h.get(`/api/staff/bookings/${b.id}/players`, staff)).body;
  const pl = list.players.find((x: any) => x.name === 'Walk-in Player');
  assert.equal(pl.checkedIn, true); assert.equal(pl.via, 'phone'); assert.ok(pl.distanceM <= 60);
  assert.ok(list.players.find((x: any) => x.isBooker).id, 'adding the first player puts the booker on the list too');
  // undo: someone else played on that profile
  assert.equal((await h.post(`/api/staff/bookings/${b.id}/players/${pl.id}/undo-check-in`, {}, staff)).status, 400);
  const u = await h.post(`/api/staff/bookings/${b.id}/players/${pl.id}/undo-check-in`, { reason: 'Not the person on the profile' }, staff);
  assert.equal(u.status, 200);
  assert.equal((await checkIn(p.token, b.id, { deviceId: device('p') })).body.error.code, 'CHECK_IN_UNDONE');
  // the player cannot be removed once checked in, even after undo; history is kept
  assert.equal((await h.post(`/api/staff/bookings/${b.id}/players/${pl.id}/remove`, {}, staff)).body.error.code, 'ALREADY_CHECKED_IN');
  // the booker's phone failed: staff check them in by hand (their row is made first by adding a guest)
  const gst = await h.post(`/api/staff/bookings/${b.id}/players`, { name: 'Guest Scorer' }, staff);
  const rows = (await h.get(`/api/staff/bookings/${b.id}/players`, staff)).body.players;
  const bookerRow = rows.find((x: any) => x.isBooker);
  assert.equal((await h.post(`/api/staff/bookings/${b.id}/players/${bookerRow.id}/check-in`, { reason: 'Phone battery dead' }, staff)).status, 200);
  assert.equal((await h.post(`/api/staff/bookings/${b.id}/players/${gst.body.player.id}/check-in`, { reason: 'Scorer for the live score' }, staff)).status, 200);
  finish(b.id);
  setNow(START() + DAY);
  assert.equal(gamesPlayed(booker.id, g.ownerId), 1);
  assert.equal(gamesPlayed(p.id, g.ownerId), 0, 'an undone check-in does not count');
  const log = many<any>("SELECT action FROM audit_log WHERE entity_id = ? AND action LIKE 'team.%'", b.id).map((r) => r.action);
  for (const a of ['team.add', 'team.check_in', 'team.check_in_undone']) assert.ok(log.includes(a), a);
});

test('no-shows, cancellations and games over a year old do not count; one person cannot be checked in to two games at once', async () => {
  const a = await newCustomer();
  const b1 = await bookAndPay(h, a.token, g.id, DATE, '10:00');
  setNow(START() - 10 * MIN);
  assert.equal((await checkIn(a.token, b1.id, { deviceId: device('a1') })).status, 200);
  run("UPDATE bookings SET status = 'no_show' WHERE id = ?", b1.id);
  setNow(START() + DAY);
  assert.equal(gamesPlayed(a.id, g.ownerId), 0);
  run("UPDATE bookings SET status = 'completed' WHERE id = ?", b1.id);
  assert.equal(gamesPlayed(a.id, g.ownerId), 1);
  assert.equal(gamesPlayed(a.id, g.ownerId, START() + 366 * DAY), 0);
  // two grounds at the same time
  const g2 = (await grounds(h)).find((x) => x.ownerId === g.ownerId && x.id !== g.id);
  if (g2) {
    run('UPDATE grounds SET lat = ?, lng = ? WHERE id = ?', DAJI_LOCATION.lat, DAJI_LOCATION.lng, g2.id);
    const d = dayFromNow(8);
    const x1 = await bookAndPay(h, a.token, g.id, d, '10:00');
    const x2 = await bookAndPay(h, a.token, g2.id, d, '10:00');
    setNow(slotStart(d, '10:00') - 5 * MIN);
    assert.equal((await checkIn(a.token, x1.id, { deviceId: device('a1') })).status, 200);
    assert.equal((await checkIn(a.token, x2.id, { deviceId: device('a1') })).body.error.code, 'CHECKED_IN_ELSEWHERE');
  }
});

test('a ground with no map pin: phone check-in says so; the list closes when the game is over; another business sees nothing', async () => {
  const booker = await newCustomer();
  const b = await bookAndPay(h, booker.token, g.id, DATE, '10:00');
  run('UPDATE grounds SET lat = NULL, lng = NULL WHERE id = ?', g.id);
  const before = (await h.get(`/api/bookings/${b.id}/players`, booker.token)).body.players;
  assert.equal(before.length, 1); assert.equal(before[0].isBooker, true); assert.equal(before[0].isYou, true); assert.equal(before[0].id, null);
  setNow(START() - 5 * MIN);
  assert.equal((await checkIn(booker.token, b.id)).body.error.code, 'GROUND_LOCATION_MISSING');
  assert.equal((await h.get(`/api/bookings/${b.id}/players`, booker.token)).body.checkIn.groundHasLocation, false);
  const owner2 = await h.login('owner2');
  assert.equal((await h.get(`/api/staff/bookings/${b.id}/players`, owner2)).status, 404);
  setNow(START() + 3 * HOUR);
  assert.equal((await add(booker.token, b.id, { name: 'Late' })).body.error.code, 'BOOKING_CLOSED');
  assert.equal((await h.get(`/api/bookings/${b.id}/players`, booker.token)).body.canEdit, false);
});

test('at most 30 on a list; the booker stays; a player can take themselves off', async () => {
  const booker = await newCustomer(), p = await newCustomer();
  const b = await bookAndPay(h, booker.token, g.id, DATE, '10:00');
  const mine = await add(booker.token, b.id, { name: 'Me', phone: p.phone });
  assert.equal((await h.post(`/api/bookings/${b.id}/players/${mine.body.player.id}/remove`, {}, p.token)).status, 200);
  for (let i = 0; i < 29; i++) assert.equal((await add(booker.token, b.id, { name: `Guest ${i}` })).status, 201);
  assert.equal((await add(booker.token, b.id, { name: 'One too many' })).body.error.code, 'TEAM_LIST_FULL');
  const bk = one<any>('SELECT id FROM booking_players WHERE booking_id = ? AND user_id = ?', b.id, booker.id);
  assert.equal((await h.post(`/api/bookings/${b.id}/players/${bk.id}/remove`, {}, booker.token)).body.error.code, 'BOOKER_STAYS');
});

test('Ask AI: staff can ask who checked in today; Claude mode gets counts, no names', async () => {
  const booker = await newCustomer();
  const b = await bookAndPay(h, booker.token, g.id, dayFromNow(0) === DATE ? DATE : dayFromNow(0), '20:00');
  setNow(slotStart(dayFromNow(0), '20:00') - 10 * MIN);
  assert.equal((await checkIn(booker.token, b.id)).status, 200);
  const r = await h.post('/api/staff/ask', { question: 'Who checked in today?' }, owner);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.intent, 'checkins');
  assert.match(r.body.answer, /1 of 1 player checked in today across 1 game/);
  assert.ok(r.body.details.some((d: any) => d.label.startsWith('Player')), 'names for the owner');
  assert.notEqual((await h.post('/api/staff/ask', { question: 'Which staff checked in today?' }, owner)).body.intent, 'checkins', 'staff attendance is a different question');
  const { checkIns } = await import('../src/ask/tools.ts');
  const { userRow } = await import('../src/auth.ts');
  const forClaude = checkIns({ ownerId: g.ownerId, user: userRow(g.ownerId)! }, false);
  assert.equal(forClaude.checkedIn, 1); assert.ok(!JSON.stringify(forClaude).includes('Player'), 'no names for Claude mode');
  const { TOOL_DEFS } = await import('../src/ask/claude.ts');
  assert.ok(TOOL_DEFS.some((t) => t.name === 'get_check_ins'));
  // a team member without manage_bookings is refused
  const games = await h.post('/api/ask', { question: 'How many games have I played?' }, booker.token);
  assert.equal(games.status, 200); assert.equal(games.body.intent, 'games');
  assert.match(games.body.answer, /played 0 games here in the last 12 months/); assert.match(games.body.answer, /25 more to reach Bronze/);
  const cust = await h.post('/api/ask', { question: 'Who checked in today?' }, booker.token);
  assert.equal(cust.status, 200); assert.ok(!/1 of 1/.test(cust.body.answer), 'customers never get the business list');
});

test('identity: one profile, one phone; moving to a new phone needs the code sent to the profile\'s own number', async () => {
  const p = await newCustomer();
  const b1 = await bookAndPay(h, p.token, g.id, DATE, '10:00');
  setNow(START() - 10 * MIN);
  assert.equal((await checkIn(p.token, b1.id, { deviceId: device('mine') })).status, 200);
  const d2 = dayFromNow(9);
  const b2 = await bookAndPay(h, p.token, g.id, d2, '10:00');
  setNow(slotStart(d2, '10:00') - 10 * MIN);
  const other = await checkIn(p.token, b2.id, { deviceId: device('friends') });
  assert.equal(other.status, 409); assert.equal(other.body.error.code, 'PROFILE_ON_ANOTHER_PHONE'); assert.match(other.body.error.message, new RegExp(p.phone.slice(-4)));
  const code = await h.post('/api/me/check-in-phone/code', {}, p.token);
  assert.equal(code.status, 200, JSON.stringify(code.body));
  assert.ok(code.body.devCode, 'demo mode shows the code instead of texting it');
  {
    assert.equal((await checkIn(p.token, b2.id, { deviceId: device('friends'), moveCode: code.body.devCode === '000000' ? '111111' : '000000' })).body.error.code, 'OTP_INVALID');
    assert.equal((await checkIn(p.token, b2.id, { deviceId: device('friends'), moveCode: code.body.devCode })).status, 200);
    // the old phone is now free of this profile, and the new one is theirs
    assert.ok(one('SELECT 1 FROM check_in_phones WHERE device_id = ? AND released_at IS NOT NULL', device('mine')));
  }
  const log = many<any>("SELECT action FROM audit_log WHERE action = 'team.phone_move_code' AND actor_id = ?", p.id);
  assert.equal(log.length, 1);
});

test('the face-match connection is listed and off; check-in works without it', async () => {
  const { integrationStatuses } = await import('../src/integrations.ts');
  const fm: any = integrationStatuses(h.cfg).find((x) => x.id === 'face-match');
  assert.ok(fm, 'listed in Settings, Connections');
  assert.equal(fm.status, 'missing');
});

test('Rekognition calls are signed exactly as AWS signs them (same answer as botocore, AWS\'s own Python signer)', () => {
  // Expected value computed with botocore 1.x SigV4Auth for the same request, keys (AWS's documented example keys) and time.
  const h = signRekognition({ host: 'rekognition.ap-south-1.amazonaws.com', region: 'ap-south-1', target: 'DeleteFaces', body: '{"CollectionId":"daji-players","FaceIds":["abc"]}',
    keyId: 'AKIDEXAMPLE', secret: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', amzDate: '20261028T120000Z' });
  assert.equal(h.authorization, 'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20261028/ap-south-1/rekognition/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-target, Signature=44124c0ecf3272af09553ba37d4c2a3a0ab9dbd318873c09b08c4366ec84e03b');
  assert.equal(h['x-amz-target'], 'RekognitionService.DeleteFaces');
});

/** A stand-in for Amazon Rekognition on this machine, speaking its JSON API (CreateCollection, IndexFaces, SearchFacesByImage, DeleteFaces).
 *  It checks every call's signature. In a selfie's bytes, "stranger" matches nobody, "nobody" has no face, "crowd" has two faces.
 *  Records every call, so the test can see what was sent and that nothing else was. */
async function stubRekognition(): Promise<{ url: string; calls: { path: string; body: any }[]; faces: Map<string, string>; close: () => Promise<void> }> {
  const calls: { path: string; body: any }[] = [];
  const faces = new Map<string, string>(); let made = false; let nextFace = 0;
  const fail = (res: any, type: string) => res.writeHead(400, { 'content-type': 'application/x-amz-json-1.1' }).end(JSON.stringify({ __type: `com.amazonaws.rekognition#${type}`, message: type }));
  const srv: Server = createServer((req, res) => {
    let raw = ''; req.on('data', (d) => (raw += d)); req.on('end', () => {
      const target = String(req.headers['x-amz-target'] ?? '').replace('RekognitionService.', '');
      const body = JSON.parse(raw || '{}'); calls.push({ path: target, body });
      const want = signRekognition({ host: String(req.headers.host), region: 'ap-south-1', target, body: raw, keyId: 'test-id', secret: 'test-secret', amzDate: String(req.headers['x-amz-date']) });
      if (req.headers.authorization !== want.authorization) { res.writeHead(403).end(JSON.stringify({ __type: 'InvalidSignatureException' })); return; }
      const img = body.Image?.Bytes ? Buffer.from(body.Image.Bytes, 'base64').toString('latin1') : '';
      let out: unknown = {};
      if (target === 'CreateCollection') { if (made) return fail(res, 'ResourceAlreadyExistsException'); made = true; out = { StatusCode: 200 }; }
      else if (target === 'IndexFaces') {
        if (img.includes('nobody')) out = { FaceRecords: [], UnindexedFaces: [] };
        else { const id = `face-${++nextFace}`; faces.set(id, body.ExternalImageId); out = { FaceRecords: [{ Face: { FaceId: id } }], UnindexedFaces: img.includes('crowd') ? [{ Reasons: ['EXCEEDS_MAX_FACES'] }] : [] }; }
      } else if (target === 'SearchFacesByImage') {
        if (img.includes('nobody')) return fail(res, 'InvalidParameterException');
        out = { FaceMatches: img.includes('stranger') ? [] : [...faces.keys()].map((id) => ({ Similarity: 98.2, Face: { FaceId: id } })) };
      } else if (target === 'DeleteFaces') { for (const id of body.FaceIds) faces.delete(id); out = { DeletedFaces: body.FaceIds }; }
      res.writeHead(200, { 'content-type': 'application/x-amz-json-1.1' }).end(JSON.stringify(out));
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const port = (srv.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}/`, calls, faces, close: () => new Promise<void>((r) => srv.close(() => r())) };
}
const allFiles = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir, { recursive: true, withFileTypes: true }) : []).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name));
const shotWith = (word: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]), Buffer.from(`${word}-${++shots}`), Buffer.from([0xff, 0xd9])]);
const sendShot = (path: string, token: string, body: Buffer, headers: Record<string, string> = {}) => h.call('POST', path, { token, raw: body, headers: { 'content-type': 'application/octet-stream', 'x-app-shot-at': String(now()), ...headers } });

test('face check on: enrol once with consent, every check-in selfie must match, nothing is kept but the answer', async () => {
  const svc = await stubRekognition();
  const filesBefore = new Set(allFiles(h.cfg.dataDir));
  Object.assign(h.cfg.faceMatch, { endpoint: svc.url, keyId: 'test-id', secret: 'test-secret' });
  try {
    assert.equal((await h.get('/api/config')).body.faceCheckIn, true);
    const p = await newCustomer(), friend = await newCustomer();
    const b = await bookAndPay(h, p.token, g.id, DATE, '10:00');
    await add(p.token, b.id, { name: 'Friend', phone: friend.phone });
    setNow(START() - 10 * MIN);
    // not enrolled yet
    assert.equal((await checkIn(p.token, b.id, { faceCheckId: undefined })).body.error.code, 'FACE_NOT_ENROLLED');
    assert.equal((await sendShot(`/api/bookings/${b.id}/check-in/face`, p.token, shot())).body.error.code, 'FACE_NOT_ENROLLED');
    // enrolment needs consent, one clear face and the camera
    assert.equal((await sendShot('/api/me/face', p.token, shot())).body.error.code, 'CONSENT_NEEDED');
    assert.equal((await sendShot('/api/me/face', p.token, shotWith('nobody'), { 'x-face-consent': 'yes' })).body.error.code, 'FACE_NOT_FOUND');
    assert.equal((await sendShot('/api/me/face', p.token, shotWith('crowd'), { 'x-face-consent': 'yes' })).body.error.code, 'MORE_THAN_ONE_FACE');
    assert.equal(svc.faces.size, 0, 'the two-face enrolment was deleted at Rekognition again');
    assert.equal((await h.call('POST', '/api/me/face', { token: p.token, raw: shot(), headers: { 'content-type': 'application/octet-stream', 'x-face-consent': 'yes' } })).body.error.code, 'NO_CAMERA_DATA');
    assert.equal((await sendShot('/api/me/face', p.token, shot(), { 'x-face-consent': 'yes' })).status, 201);
    assert.equal((await sendShot('/api/me/face', p.token, shot(), { 'x-face-consent': 'yes' })).body.error.code, 'FACE_ALREADY_ENROLLED');
    assert.deepEqual((await h.get('/api/me/face', p.token)).body, { faceCheck: true, enrolled: true });
    assert.equal([...svc.faces.values()][0], p.id, 'the face is tagged with the player id, nothing else');
    // someone else's face on this profile is refused, and so is a selfie with no face in it
    const wrong = await sendShot(`/api/bookings/${b.id}/check-in/face`, p.token, shotWith('stranger'));
    assert.equal(wrong.status, 403); assert.equal(wrong.body.error.code, 'FACE_MISMATCH');
    assert.equal((await sendShot(`/api/bookings/${b.id}/check-in/face`, p.token, shotWith('nobody'))).body.error.code, 'FACE_NOT_FOUND');
    // a failed face check cannot be used to check in
    const failedId = one<any>('SELECT id FROM check_in_face_checks WHERE user_id = ? AND matched = 0 LIMIT 1', p.id).id;
    assert.equal((await checkIn(p.token, b.id, { faceCheckId: failedId })).body.error.code, 'FACE_CHECK_NEEDED');
    // the real player
    const ok = await checkIn(p.token, b.id);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const staffView = (await h.get(`/api/staff/bookings/${b.id}/players`, staff)).body;
    const me = staffView.players.find((x: any) => x.isBooker);
    assert.equal(me.faceEnrolled, true); assert.equal(me.faceMatched, true); assert.equal(me.faceScore, 98.2);
    assert.equal(staffView.checkIn.faceCheck, true);
    // the selfie was sent to the service and not kept here: no image anywhere in the data folder, only the answer in the database
    assert.ok(svc.calls.some((c) => c.path === 'SearchFacesByImage' && c.body.CollectionId === 'daji-players' && c.body.Image.Bytes));
    assert.equal(svc.calls.filter((c) => c.path === 'CreateCollection').length, 1);
    const newFiles = allFiles(h.cfg.dataDir).filter((f) => !filesBefore.has(f) && !/\.db(-wal|-shm|-journal)?$/.test(f));
    assert.deepEqual(newFiles, [], 'no file was written for any selfie');
    const rows = many<any>('SELECT * FROM check_in_face_checks WHERE user_id = ?', p.id);
    assert.ok(rows.length >= 3); assert.ok(rows.every((r) => !('image' in r)));
    // the friend has not enrolled, so cannot check in on their own profile either until they do
    assert.equal((await checkIn(friend.token, b.id, { deviceId: device('friend'), faceCheckId: undefined })).body.error.code, 'FACE_NOT_ENROLLED');
    // staff reset a wrong enrolment; the player removes their own face; the service is asked to forget both
    assert.equal((await h.post(`/api/staff/players/${p.id}/face-reset`, {}, staff)).status, 400);
    assert.equal((await h.post(`/api/staff/players/${p.id}/face-reset`, { reason: 'Brother enrolled on his profile' }, staff)).status, 200);
    assert.deepEqual((await h.get('/api/me/face', p.token)).body, { faceCheck: true, enrolled: false });
    assert.equal(await sweepFaceForgets(h.cfg), 1);
    assert.ok(svc.calls.some((c) => c.path === 'DeleteFaces' && c.body.FaceIds.length === 1));
    assert.equal(one('SELECT 1 FROM player_faces WHERE user_id = ?', p.id), undefined);
    assert.equal((await sendShot('/api/me/face', p.token, shot(), { 'x-face-consent': 'yes' })).status, 201, 'enrol again');
    assert.equal((await h.post('/api/me/face/remove', {}, p.token)).body.removed, true);
    assert.equal(await sweepFaceForgets(h.cfg), 1);
    // the game still counts: the check-in record stays
    finish(b.id);
    assert.equal(gamesPlayed(p.id, g.ownerId, START() + DAY), 1);
    assert.equal(svc.faces.size, 0, 'nothing left at Rekognition');
  } finally { Object.assign(h.cfg.faceMatch, { endpoint: '', keyId: '', secret: '' }); await svc.close(); }
});

test('face check off: no selfie is asked for or accepted, and the face service is never called', async () => {
  const p = await newCustomer();
  const b = await bookAndPay(h, p.token, g.id, DATE, '10:00');
  setNow(START() - 10 * MIN);
  assert.equal((await h.get('/api/config')).body.faceCheckIn, false);
  assert.equal((await sendShot(`/api/bookings/${b.id}/check-in/face`, p.token, shot())).body.error.code, 'FACE_SERVICE_OFF');
  assert.equal((await sendShot('/api/me/face', p.token, shot(), { 'x-face-consent': 'yes' })).body.error.code, 'FACE_SERVICE_OFF');
  assert.equal((await checkIn(p.token, b.id)).status, 200);
  assert.equal((await h.get(`/api/staff/bookings/${b.id}/players`, staff)).body.players.find((x: any) => x.isBooker).faceMatched, null);
  // account deletion asks for the face to be forgotten (nothing to forget here, and nothing breaks)
  const { forgetFaces } = await import('../src/players.ts');
  forgetFaces(p.id);
  assert.equal(await sweepFaceForgets(h.cfg), 0);
});
