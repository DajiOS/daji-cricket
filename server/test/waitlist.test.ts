import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, setting, setNow, slotStart, hold, T0, HOUR, MIN, DAY, type Harness, type GroundLite } from './helpers.ts';
import { sweepWaitlist, tierFor, waitlistDayFrom } from '../src/waitlist.ts';
import { sweepHolds } from '../src/jobs.ts';
import { many, one, run } from '../src/db.ts';
import { getSettings } from '../src/settings.ts';
import { istDate, addDays } from '../src/time.ts';
import { now } from '../src/clock.ts';

// The weekly waitlist (Sunday leather ball): waiting, the 72-hour offer, first to accept wins, tiers, rollover, prices on enquiry, access.

let h: Harness, g: GroundLite, owner: string, staff: string;
const R = (rupees: number) => rupees * 100;
const RATES = [
  { id: 'l-wknd', label: 'Weekend day', ball: 'leather', days: [6, 0], from: '07:00', to: '19:00', mode: 'fixed', pricePaise: R(15000) },
  { id: 'l-night', label: 'Evening hours', ball: 'leather', days: [0, 2, 3, 4, 5, 6], from: '19:00', to: '23:00', mode: 'hourly', pricePaise: R(3500) },
  { id: 't-sun', label: 'Sunday tournament', ball: 'tennis', days: [0], from: '07:00', to: '19:00', mode: 'fixed', pricePaise: R(90000) },
];
const SUNDAY = waitlistDayFromT0();
function waitlistDayFromT0(): string { const d = istDate(T0); return addDays(d, (7 - new Date(d + 'T00:00:00Z').getUTCDay()) % 7); }
const start = (date = SUNDAY) => slotStart(date, '07:00');

let n = 0;
async function newCustomer(opts: { whatsapp?: boolean } = {}): Promise<{ token: string; id: string }> {
  n++;
  const r = await h.post('/api/auth/register', { name: `Player ${n}`, email: `player${n}@example.com`, phone: `98${String(10000000 + n).slice(-8)}`, password: 'Cricket@12345', consent: { whatsapp: !!opts.whatsapp } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { token: r.body.token, id: r.body.user.id };
}
const join = (token: string, body: Record<string, unknown> = {}) => h.post('/api/waitlist', { groundId: g.id, ...body }, token);
const mine = async (token: string) => (await h.get('/api/waitlist', token)).body;
const accept = (token: string, offerId: string) => h.post(`/api/waitlist/offers/${offerId}/accept`, {}, token);
const offerOf = () => one<any>("SELECT * FROM waitlist_offers WHERE ground_id = ? AND date = ? ORDER BY created_at DESC LIMIT 1", g.id, SUNDAY);
const sent = (userId: string, template: string) => many<any>('SELECT channel, status, skip_reason FROM notifications WHERE user_id = ? AND template = ?', userId, template);
/** Games played: confirmed sessions already over, written straight into the books for the test. */
function played(customerId: string, count: number): void {
  for (let i = 0; i < count; i++) {
    const at = T0 - (i + 2) * DAY;
    run(`INSERT INTO bookings(id, ref, ground_id, owner_id, customer_id, date, start_at, end_at, slot_count, status, source, total_paise, advance_paise, paid_paise, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?,1,'completed','walk_in',100000,0,100000,?,?)`, `bkg_played_${customerId}_${i}`, `PL${customerId.slice(-4)}${i}`, g.id, g.ownerId, customerId, istDate(at), at, at + HOUR, at, at);
  }
}

before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset();
  g = (await grounds(h))[0]!;
  owner = await h.login('owner1'); staff = await h.login('staff1');
  const r = await h.patch(`/api/staff/grounds/${g.id}`, { slotMinutes: 60, maxSlots: 12, rates: RATES }, owner);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  setting({ waitlistEnabled: true });
});

test('the shipped defaults: off, Sunday leather ball, 72 hours, tiers off', async () => {
  const { DEFAULT_SETTINGS } = await import('../src/settings.ts');
  assert.equal(DEFAULT_SETTINGS.waitlistEnabled, false);
  assert.equal(DEFAULT_SETTINGS.waitlistDay, 0); assert.equal(DEFAULT_SETTINGS.waitlistBall, 'leather');
  assert.equal(DEFAULT_SETTINGS.waitlistConfirmHours, 72); assert.equal(DEFAULT_SETTINGS.waitlistTierPriority, false);
  assert.equal(new Date(SUNDAY + 'T00:00:00Z').getUTCDay(), 0);
  assert.equal(waitlistDayFrom(istDate(T0)), SUNDAY);
});

test('switched off, the waitlist refuses and the site is told', async () => {
  setting({ waitlistEnabled: false });
  const c = await newCustomer();
  const r = await join(c.token);
  assert.equal(r.status, 503); assert.equal(r.body.error.code, 'FEATURE_OFF');
  assert.equal((await h.get('/api/config')).body.waitlistEnabled, false);
  setting({ waitlistEnabled: true });
  assert.equal((await h.get('/api/config')).body.waitlistEnabled, true);
});

test('joining: the coming Sunday for a year; a second tap gives the same request; bad input is refused', async () => {
  const c = await newCustomer();
  const a = await join(c.token, { everyWeek: true, players: 22 });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(a.body.entry.nextDate, SUNDAY); assert.equal(a.body.entry.untilDate, addDays(SUNDAY, 7 * 51));
  assert.equal(a.body.entry.status, 'waiting'); assert.equal(a.body.entry.everyWeek, true);
  const b = await join(c.token, { everyWeek: true, players: 22 });
  assert.equal(b.status, 200); assert.equal(b.body.entry.id, a.body.entry.id); assert.equal(b.body.created, false);
  assert.equal(one<any>('SELECT COUNT(*) n FROM waitlist_entries')!.n, 1);
  assert.equal((await join(c.token, { ruleId: 't-sun' })).status, 400, 'a tennis session is not on the leather waitlist');
  assert.equal((await join(c.token, { ruleId: 'l-night' })).status, 400, 'hourly lines are not whole sessions');
  assert.equal((await join(c.token, { groundId: 'grd_nope' })).status, 404);
  assert.equal((await join(c.token, { everyWeek: 'yes' })).status, 400);
  assert.equal((await join(c.token, { players: 0 })).status, 400);
  assert.ok(sent(c.id, 'waitlist_joined').length >= 1, 'told they are on the list');
  assert.equal((await h.post('/api/waitlist', { groundId: g.id }, null)).status, 401);
  assert.equal((await h.post('/api/waitlist', { groundId: g.id }, owner)).status, 403, 'staff use the desk route');
});

test('a ground with no Sunday leather session has nothing to wait for; at most three requests at once', async () => {
  const c = await newCustomer();
  const gs = await grounds(h);
  const other = gs.find((x) => x.id !== g.id && x.ownerId === g.ownerId) ?? gs.find((x) => x.id !== g.id)!;
  const r = await h.post('/api/waitlist', { groundId: other.id }, c.token);
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'NO_WAITLIST_SESSIONS');
  run("INSERT INTO waitlist_entries(id, owner_id, customer_id, ground_id, rule_id, status, next_date, until_date, created_at, updated_at) VALUES('wle_a',?,?,?,'x1','waiting',?,?,1,1),('wle_b',?,?,?,'x2','waiting',?,?,1,1),('wle_c',?,?,?,'x3','waiting',?,?,1,1)",
    g.ownerId, c.id, g.id, SUNDAY, SUNDAY, g.ownerId, c.id, g.id, SUNDAY, SUNDAY, g.ownerId, c.id, g.id, SUNDAY, SUNDAY);
  const full = await join(c.token);
  assert.equal(full.status, 409); assert.equal(full.body.error.code, 'TOO_MANY_WAITLIST');
});

test('nothing is offered before 72 hours; at 72 hours a free session goes to everyone waiting, by app, email and WhatsApp only with consent', async () => {
  const a = await newCustomer({ whatsapp: true }), b = await newCustomer(), c = await newCustomer();
  for (const x of [a, b, c]) assert.equal((await join(x.token)).status, 201);
  setNow(start() - 72 * HOUR - MIN);
  assert.equal(sweepWaitlist().offered, 0);
  assert.equal((await mine(a.token)).offers.length, 0);
  setNow(start() - 72 * HOUR);
  const s = sweepWaitlist();
  assert.equal(s.offered, 1);
  const o = offerOf();
  assert.equal(o.status, 'open'); assert.equal(o.rule_id, 'l-wknd'); assert.equal(o.start_at, start());
  for (const x of [a, b, c]) {
    const m = await mine(x.token);
    assert.equal(m.offers.length, 1); assert.equal(m.offers[0].id, o.id); assert.equal(m.offers[0].time, '07:00');
    assert.ok(sent(x.id, 'waitlist_offer').some((r) => r.channel === 'email'), 'email');
  }
  assert.deepEqual(sent(a.id, 'waitlist_offer').filter((r) => r.channel === 'whatsapp').map((r) => r.status), ['queued'], 'agreed to WhatsApp: queued until WhatsApp is connected');
  assert.deepEqual(sent(b.id, 'waitlist_offer').filter((r) => r.channel === 'whatsapp').map((r) => r.skip_reason), ['no WhatsApp consent']);
  // running again changes nothing and tells nobody twice
  sweepWaitlist();
  assert.equal(many('SELECT 1 FROM waitlist_offers').length, 1);
  assert.equal(sent(a.id, 'waitlist_offer').filter((r) => r.channel === 'email').length, 1);
});

test('a Sunday already booked is not offered, and everyone rolls to the next Sunday when it is over', async () => {
  const a = await newCustomer({ whatsapp: true });
  assert.equal((await join(a.token)).status, 201);
  const other = await newCustomer();
  const booked = await hold(h, other.token, g.id, SUNDAY, '07:00', undefined, { ruleId: 'l-wknd' });
  assert.equal(booked.status, 201, JSON.stringify(booked.body));
  setNow(start() - 10 * HOUR);
  assert.equal(sweepWaitlist().offered, 0);
  setNow(start() + DAY);
  const s = sweepWaitlist();
  assert.equal(s.rolled, 1);
  const e = (await mine(a.token)).entries[0];
  assert.equal(e.nextDate, addDays(SUNDAY, 7)); assert.equal(e.rollovers, 1); assert.equal(e.status, 'waiting');
  sweepWaitlist();
  assert.equal((await mine(a.token)).entries[0].rollovers, 1, 'rolls once per Sunday');
});

test('three people accept at once: exactly one wins, through the normal hold and price', async () => {
  const people = [await newCustomer(), await newCustomer(), await newCustomer()];
  for (const x of people) assert.equal((await join(x.token)).status, 201);
  setNow(start() - 70 * HOUR);
  sweepWaitlist();
  const o = offerOf();
  const replies = await Promise.all(people.map((x) => accept(x.token, o.id)));
  const wins = replies.filter((r) => r.status === 200);
  assert.equal(wins.length, 1, JSON.stringify(replies.map((r) => [r.status, r.body?.error?.code])));
  for (const r of replies.filter((x) => x.status !== 200)) { assert.equal(r.status, 409); assert.equal(r.body.error.code, 'OFFER_GONE'); }
  const w = wins[0]!.body;
  assert.equal(w.via, 'booking'); assert.equal(w.hold.booking.status, 'held');
  assert.equal(w.hold.booking.totalPaise, R(15000), 'the price list price');
  assert.equal(w.hold.payment.mode, 'razorpay');
  assert.equal(many("SELECT 1 FROM bookings WHERE date = ? AND status IN ('held','confirmed')", SUNDAY).length, 1);
  assert.equal(offerOf().status, 'taken');
  // a second accept by the winner hands back the same booking
  const winner = people[replies.indexOf(wins[0]!)]!;
  const again = await accept(winner.token, o.id);
  assert.equal(again.status, 200); assert.equal(again.body.already, true); assert.equal(again.body.hold.booking.id, w.hold.booking.id);
  assert.equal(many("SELECT 1 FROM bookings WHERE date = ? AND status IN ('held','confirmed')", SUNDAY).length, 1);
  // the others were told it has gone (app)
  const loser = people.find((x) => x !== winner)!;
  assert.equal((await mine(loser.token)).offers.length, 0);
});

test('a winner who does not pay: the slot goes back to the others, and the winner cannot take it again', async () => {
  const a = await newCustomer(), b = await newCustomer();
  for (const x of [a, b]) assert.equal((await join(x.token)).status, 201);
  setNow(start() - 70 * HOUR);
  sweepWaitlist();
  const o = offerOf();
  const w = await accept(a.token, o.id);
  assert.equal(w.status, 200);
  setNow(now() + 2 * HOUR);
  sweepHolds();
  const s = sweepWaitlist();
  assert.equal(s.reopened, 1);
  assert.equal(offerOf().status, 'open'); assert.equal(offerOf().id, o.id);
  assert.ok(sent(b.id, 'waitlist_free_again').length >= 1);
  const again = await accept(a.token, o.id);
  assert.equal(again.status, 409); assert.equal(again.body.error.code, 'OFFER_NOT_FOR_YOU');
  assert.equal((await mine(a.token)).entries[0].status, 'waiting', 'still on the waitlist');
  const bw = await accept(b.token, o.id);
  assert.equal(bw.status, 200, JSON.stringify(bw.body));
});

test('a paid win is played: a one-off request is done, an every-week request carries on to the next Sunday', async () => {
  const once = await newCustomer(), weekly = await newCustomer();
  assert.equal((await join(once.token)).status, 201);
  setNow(start() - 70 * HOUR);
  sweepWaitlist();
  const w = await accept(once.token, offerOf().id);
  const orderId = w.body.hold.payment.razorpay.orderId;
  const p = await h.post('/api/gateway/demo/pay', { orderId }, once.token);
  const v = await h.post('/api/payments/razorpay/verify', { orderId, paymentId: p.body.paymentId, signature: p.body.signature }, once.token);
  assert.equal(v.status, 200); assert.equal(v.body.booking.status, 'confirmed');
  setNow(start() + DAY);
  const s = sweepWaitlist();
  assert.equal(s.played, 1);
  const e = (await mine(once.token)).entries[0];
  assert.equal(e.status, 'booked'); assert.equal(e.gamesBooked, 1);
  // every week: the same flow keeps the request going
  assert.equal((await join(weekly.token, { everyWeek: true })).status, 201);
  const next = addDays(SUNDAY, 7);
  assert.equal((await mine(weekly.token)).entries[0].nextDate, next);
  setNow(start(next) - 70 * HOUR);
  sweepWaitlist();
  const wo = one<any>('SELECT * FROM waitlist_offers WHERE date = ?', next);
  const ww = await accept(weekly.token, wo.id);
  const o2 = ww.body.hold.payment.razorpay.orderId;
  const p2 = await h.post('/api/gateway/demo/pay', { orderId: o2 }, weekly.token);
  assert.equal((await h.post('/api/payments/razorpay/verify', { orderId: o2, paymentId: p2.body.paymentId, signature: p2.body.signature }, weekly.token)).status, 200);
  setNow(start(next) + DAY);
  sweepWaitlist();
  const we = (await mine(weekly.token)).entries[0];
  assert.equal(we.status, 'waiting'); assert.equal(we.nextDate, addDays(next, 7)); assert.equal(we.gamesBooked, 1); assert.equal(we.rollovers, 0);
});

test('tier priority: the top tier is told first, the next wave after the set minutes, and nobody can jump the queue', async () => {
  setting({ waitlistTierPriority: true, waitlistWaveMinutes: 60, waitlistTiers: [{ name: 'Gold', minGames: 5 }, { name: 'Silver', minGames: 2 }] });
  const gold = await newCustomer(), silver = await newCustomer(), rest = await newCustomer();
  played(gold.id, 6); played(silver.id, 3); played(rest.id, 1);
  for (const x of [gold, silver, rest]) assert.equal((await join(x.token)).status, 201);
  assert.equal((await mine(gold.token)).tier, 'Gold'); assert.equal((await mine(silver.token)).tier, 'Silver'); assert.equal((await mine(rest.token)).tier, null);
  setNow(start() - 70 * HOUR);
  sweepWaitlist();
  const o = offerOf();
  assert.equal((await mine(gold.token)).offers.length, 1);
  assert.equal((await mine(silver.token)).offers.length, 0);
  const early = await accept(silver.token, o.id);
  assert.equal(early.status, 409); assert.equal(early.body.error.code, 'NOT_YOUR_WAVE_YET');
  setNow(start() - 70 * HOUR + 59 * MIN); sweepWaitlist();
  assert.equal((await mine(silver.token)).offers.length, 0);
  setNow(start() - 70 * HOUR + 60 * MIN); sweepWaitlist();
  assert.equal((await mine(silver.token)).offers.length, 1);
  assert.equal((await mine(rest.token)).offers.length, 0);
  setNow(start() - 70 * HOUR + 120 * MIN); sweepWaitlist();
  assert.equal((await mine(rest.token)).offers.length, 1);
  assert.equal((await accept(rest.token, o.id)).status, 200, 'anyone told may take it: first to accept');
  // no-shows and cancellations do not earn status
  run("UPDATE bookings SET status = 'no_show' WHERE customer_id = ?", gold.id);
  assert.equal(tierFor(0).tier, null);
  assert.equal((await mine(gold.token)).games, 0);
});

test('waves are squeezed when the session is close, so every wave hears before it starts', async () => {
  setting({ waitlistTierPriority: true, waitlistWaveMinutes: 600, waitlistTiers: [{ name: 'Gold', minGames: 1 }] });
  const gold = await newCustomer(), rest = await newCustomer();
  played(gold.id, 1);
  for (const x of [gold, rest]) await join(x.token);
  setNow(start() - 4 * HOUR); // a late cancellation: only four hours left
  sweepWaitlist();
  const o = offerOf();
  assert.ok(o.wave_ms <= 2 * HOUR, String(o.wave_ms));
  setNow(start() - 2 * HOUR); sweepWaitlist();
  assert.equal((await mine(rest.token)).offers.length, 1);
});

test('someone books the session the normal way while it is offered: the offer closes and accepting is refused', async () => {
  const a = await newCustomer();
  await join(a.token);
  setNow(start() - 70 * HOUR);
  sweepWaitlist();
  const o = offerOf();
  const other = await newCustomer();
  assert.equal((await hold(h, other.token, g.id, SUNDAY, '07:00', undefined, { ruleId: 'l-wknd' })).status, 201, 'Daji\'s normal booking stays first');
  const r = await accept(a.token, o.id);
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'OFFER_GONE');
  assert.equal(offerOf().status, 'closed');
  assert.equal((await mine(a.token)).entries[0].status, 'waiting');
});

test('a ground block (for example a tournament fixture) is not free', async () => {
  const a = await newCustomer();
  await join(a.token);
  assert.equal((await h.post(`/api/staff/grounds/${g.id}/blocks`, { date: SUNDAY, startTime: '09:00', endTime: '10:00', note: 'Tournament: test' }, owner)).status, 201);
  setNow(start() - 70 * HOUR);
  assert.equal(sweepWaitlist().offered, 0);
});

test('prices on enquiry: accepting sends the ground a pricing enquiry for that slot; closing it gives the slot back, converting it books it', async () => {
  setting({ pricesOnEnquiry: true });
  const a = await newCustomer(), b = await newCustomer();
  for (const x of [a, b]) await join(x.token);
  assert.equal((await mine(a.token)).sessions[0].pricePaise, null, 'no prices shown');
  setNow(start() - 70 * HOUR);
  sweepWaitlist();
  const o = offerOf();
  const r = await accept(a.token, o.id);
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.via, 'enquiry');
  const q = one<any>('SELECT * FROM enquiries WHERE id = ?', r.body.enquiryId);
  assert.equal(q.preferred_date, SUNDAY); assert.equal(q.preferred_time, '07:00'); assert.equal(q.preferred_label, 'Weekend day');
  assert.equal((await accept(b.token, o.id)).status, 409, 'kept for the first to accept');
  // staff close the enquiry: the slot goes back to the others
  assert.equal((await h.post(`/api/staff/enquiries/${q.id}/close`, { reason: 'could not agree a price' }, staff)).status, 200);
  assert.equal(sweepWaitlist().reopened, 1);
  const rb = await accept(b.token, o.id);
  assert.equal(rb.status, 200);
  // staff convert it: a normal confirmed booking, linked back
  const conv = await h.post(`/api/staff/enquiries/${rb.body.enquiryId}/convert`, { ruleId: 'l-wknd', payment: { method: 'cash', amountPaise: R(7500) } }, staff);
  assert.equal(conv.status, 201, JSON.stringify(conv.body));
  sweepWaitlist();
  assert.ok(offerOf().booking_id, 'linked to the booking');
  assert.equal(offerOf().status, 'taken');
});

test('access: another customer cannot see, leave or accept for someone else; another business cannot see the list', async () => {
  const a = await newCustomer(), b = await newCustomer();
  const ja = await join(a.token);
  setNow(start() - 70 * HOUR);
  sweepWaitlist();
  const o = offerOf();
  assert.equal((await h.post(`/api/waitlist/${ja.body.entry.id}/withdraw`, {}, b.token)).status, 404);
  assert.equal((await accept(b.token, o.id)).status, 404, 'not on that offer');
  assert.equal((await mine(b.token)).entries.length, 0);
  const own = await h.get('/api/staff/waitlist', owner);
  assert.equal(own.status, 200); assert.equal(own.body.waiting, 1); assert.equal(own.body.entries[0].customerName, 'Player ' + (n - 1));
  const o2 = await h.get('/api/staff/waitlist', await h.login('owner2'));
  assert.equal(o2.status, 200); assert.equal(o2.body.entries.length, 0, 'another business sees nothing');
  assert.equal((await h.post(`/api/staff/waitlist/${ja.body.entry.id}/withdraw`, { reason: 'test' }, await h.login('owner2'))).status, 404);
  assert.equal((await h.get('/api/staff/waitlist', a.token)).status, 403);
  // staff take someone off only with a reason, and it is recorded
  assert.equal((await h.post(`/api/staff/waitlist/${ja.body.entry.id}/withdraw`, {}, staff)).status, 400);
  const off = await h.post(`/api/staff/waitlist/${ja.body.entry.id}/withdraw`, { reason: 'asked by phone' }, staff);
  assert.equal(off.status, 200); assert.equal(off.body.entry.status, 'withdrawn');
  assert.ok(one("SELECT 1 FROM audit_log WHERE action = 'waitlist.withdraw' AND entity_id = ?", ja.body.entry.id));
  assert.equal((await accept(a.token, o.id)).status, 409, 'a withdrawn request cannot accept');
});

test('staff add a customer by phone; the customer leaves by themselves', async () => {
  const r = await h.post('/api/staff/waitlist', { groundId: g.id, ruleId: 'l-wknd', customer: { name: 'Walk In Player', phone: '9811122233' } }, staff);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.entry.session, 'Weekend day');
  const again = await h.post('/api/staff/waitlist', { groundId: g.id, ruleId: 'l-wknd', customer: { name: 'Walk In Player', phone: '9811122233' } }, staff);
  assert.equal(again.status, 200); assert.equal(again.body.entry.id, r.body.entry.id);
  const c = await newCustomer();
  const j = await join(c.token);
  const left = await h.post(`/api/waitlist/${j.body.entry.id}/withdraw`, {}, c.token);
  assert.equal(left.status, 200); assert.equal(left.body.entry.status, 'withdrawn');
  assert.equal((await join(c.token)).status, 201, 'can join again');
});

test('a request ends after a year of Sundays', async () => {
  const c = await newCustomer();
  const j = await join(c.token);
  run('UPDATE waitlist_entries SET until_date = next_date WHERE id = ?', j.body.entry.id);
  setNow(start() + DAY);
  const s = sweepWaitlist();
  assert.equal(s.ended, 1);
  assert.equal((await mine(c.token)).entries[0].status, 'ended');
  assert.ok(sent(c.id, 'waitlist_ended').length >= 1);
});

test('settings: the details are checked and only the owner side can change them', async () => {
  const bad = await h.put('/api/admin/settings', { waitlistTiers: [{ name: 'A', minGames: 5 }, { name: 'B', minGames: 5 }] }, await h.login('admin'));
  assert.equal(bad.status, 400);
  assert.equal((await h.put('/api/admin/settings', { waitlistConfirmHours: 0 }, await h.login('admin'))).status, 400);
  assert.equal((await h.put('/api/admin/settings', { waitlistBall: 'practice' }, await h.login('admin'))).status, 400);
  const ok = await h.put('/api/admin/settings', { waitlistConfirmHours: 48, waitlistTiers: [{ name: 'Silver', minGames: 3 }, { name: 'Gold', minGames: 9 }] }, await h.login('admin'));
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(getSettings().waitlistTiers.map((t) => t.name), ['Gold', 'Silver'], 'kept highest first');
  // 48 hours: nothing at 50 hours, an offer at 48
  const c = await newCustomer(); await join(c.token);
  setNow(start() - 50 * HOUR); assert.equal(sweepWaitlist().offered, 0);
  setNow(start() - 48 * HOUR); assert.equal(sweepWaitlist().offered, 1);
  assert.equal((await h.put('/api/admin/settings', { waitlistConfirmHours: 72 }, staff)).status, 403);
});

test('Ask AI: staff and customers can ask about the waitlist; Claude mode gets no names; nobody can accept through it', async () => {
  const a = await newCustomer(), b = await newCustomer();
  await join(a.token, { everyWeek: true }); await join(b.token);
  setNow(start() - 70 * HOUR);
  sweepWaitlist();
  const staffAns = await h.post('/api/staff/ask', { question: 'Who is on the Sunday waitlist?' }, owner);
  assert.equal(staffAns.status, 200, JSON.stringify(staffAns.body));
  assert.equal(staffAns.body.intent, 'waitlist');
  assert.match(staffAns.body.answer, /2 people are on the Sunday leather ball waitlist/);
  assert.match(staffAns.body.answer, /offered to them now/);
  assert.ok(staffAns.body.details.some((d: any) => d.label.startsWith('Player')), 'names for someone who may see customers');
  const { waitlist } = await import('../src/ask/tools.ts');
  const { userRow } = await import('../src/auth.ts');
  const ownerRow = userRow(g.ownerId)!;
  const forClaude = waitlist({ ownerId: g.ownerId, user: ownerRow }, false);
  assert.equal(forClaude.waiting, 2);
  assert.ok(!JSON.stringify(forClaude).includes('Player'), 'no customer names for Claude mode');
  const { TOOL_DEFS } = await import('../src/ask/claude.ts');
  assert.ok(TOOL_DEFS.some((t) => t.name === 'get_waitlist'));
  // customers: their own requests and the offer open to them, in English, Hindi and Gujarati words
  for (const q of ['Am I on the waitlist?', 'mera waiting list status kya hai', 'वेटिंग लिस्ट में मेरा नंबर', 'મારું વેઇટિંગ લિસ્ટ']) {
    const r = await h.post('/api/ask', { question: q }, a.token);
    assert.equal(r.status, 200, q); assert.equal(r.body.intent, 'waitlist', q);
    assert.match(r.body.answer, /is free for you now/, q);
    assert.ok(!r.body.answer.includes('Player'), 'never another customer');
  }
  const other = await newCustomer();
  const none = await h.post('/api/ask', { question: 'Am I on the waitlist?' }, other.token);
  assert.match(none.body.answer, /You are not on the Sunday leather ball waitlist/);
  // asked to accept it, the assistant only reads: nothing is booked
  const pay = await h.post('/api/ask', { question: 'accept the waitlist slot and pay for it' }, a.token);
  assert.equal(pay.status, 200);
  assert.equal(offerOf().status, 'open');
  assert.equal(many("SELECT 1 FROM bookings WHERE date = ? AND status IN ('held','confirmed')", SUNDAY).length, 0);
  // a staff member without the bookings permission is told so
  run("UPDATE users SET permissions = '[\"view_reports\",\"view_revenue\"]' WHERE email = 'staff1@daji.test'");
  const noPerm = await h.post('/api/staff/ask', { question: 'Who is on the Sunday waitlist?' }, staff);
  assert.match(noPerm.body.answer ?? JSON.stringify(noPerm.body), /do not have access to the waitlist|manage_bookings/);
});
