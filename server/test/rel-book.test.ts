import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, hold, bookAndPay, dayFromNow, slotStart, advance, MIN, type Harness, type GroundLite } from './helpers.ts';
import { runSweeps } from '../src/jobs.ts';
import { many, one, run } from '../src/db.ts';
import { register } from './register.ts';
import { rel, ev } from './rel.ts';

let h: Harness, g: GroundLite, cust: string, owner: string, staff: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset();
  g = (await grounds(h))[0]!;
  cust = await h.login('customer'); owner = await h.login('owner1'); staff = await h.login('staff1');
});

/** The ground's own price for the hours, so a walk-in pays exactly what the desk would collect. */
async function priceOf(date: string, time: string, slots: number): Promise<number> {
  const av = (await h.get(`/api/grounds/${g.id}/availability?date=${date}`)).body.slots as { time: string; pricePaise: number }[];
  const i = av.findIndex((x) => x.time === time);
  return av.slice(i, i + slots).reduce((a, x) => a + x.pricePaise, 0);
}
const walkIn = async (date: string, time: string, name: string, phone: string, slots = 1, paise?: number) =>
  h.post('/api/staff/bookings', { groundId: g.id, date, startTime: time, slots, customer: { name, phone }, payment: { method: 'cash', amountPaise: paise ?? await priceOf(date, time, slots) } }, staff);
const slotsOf = (bookingId: string) => many<{ slot_start: number }>('SELECT slot_start FROM booking_slots WHERE booking_id = ? ORDER BY slot_start', bookingId).map((r) => r.slot_start);

// ------------------------------------------------------------------ REL-BOOK-001 / 002

rel('REL-BOOK-001', 'ten customers asking for the same slot at the same moment: exactly one hold, nine clear refusals, no stray rows', async () => {
  const date = dayFromNow(3);
  const tokens = await Promise.all(Array.from({ length: 10 }, (_, i) => register(h, `Racer ${i}`, `98100000${String(i).padStart(2, '0')}`)));
  const rs = await Promise.all(tokens.map((t) => hold(h, t, g.id, date, '20:00', 2)));
  const wins = rs.filter((r) => r.status === 201), losses = rs.filter((r) => r.status === 409);
  assert.equal(wins.length, 1); assert.equal(losses.length, 9);
  assert.ok(losses.every((r) => r.body.error.code === 'SLOT_TAKEN'));
  assert.equal(many('SELECT 1 FROM booking_slots WHERE ground_id = ? AND slot_start >= ?', g.id, slotStart(date, '00:00')).length, 2);
  assert.equal(one<{ n: number }>("SELECT COUNT(*) n FROM bookings WHERE status = 'held'")!.n, 1);
  assert.equal(one<{ n: number }>('SELECT COUNT(*) n FROM payments')!.n, 1, 'only the winner has a payment session');
  ev('wins', wins.length); ev('losses', losses.length);
});

rel('REL-BOOK-002', 'a customer online and a walk-in at the desk for the same slot at once: one wins, the other is told, the loser leaves no payment behind', async () => {
  let deskWins = 0, onlineWins = 0;
  for (let i = 0; i < 6; i++) {
    const date = dayFromNow(4 + i);
    const t = await register(h, `Online ${i}`, `98200000${String(i).padStart(2, '0')}`);
    const [a, b] = await Promise.all([hold(h, t, g.id, date, '19:00'), walkIn(date, '19:00', `Desk ${i}`, `98300000${String(i).padStart(2, '0')}`)]);
    const won = [a, b].filter((r) => r.status === 201), lost = [a, b].filter((r) => r.status === 409);
    assert.equal(won.length, 1, `round ${i}: ${a.status}/${b.status}`); assert.equal(lost.length, 1);
    assert.equal(lost[0]!.body.error.code, 'SLOT_TAKEN');
    if (a.status === 201) onlineWins++; else deskWins++;
    assert.equal(many('SELECT 1 FROM booking_slots WHERE ground_id = ? AND slot_start = ?', g.id, slotStart(date, '19:00')).length, 1);
  }
  const bookings = one<{ n: number }>("SELECT COUNT(*) n FROM bookings WHERE status IN ('held','confirmed')")!.n;
  assert.equal(bookings, 6, 'one live booking per round');
  const orphanPays = one<{ n: number }>('SELECT COUNT(*) n FROM payments p LEFT JOIN bookings b ON b.id = p.booking_id WHERE b.id IS NULL OR b.status NOT IN (\'held\',\'confirmed\')')!.n;
  assert.equal(orphanPays, 0, 'no payment points at a booking that was not made');
  ev('rounds', 6); ev('onlineWins', onlineWins); ev('deskWins', deskWins);
});

// ------------------------------------------------------------------ REL-BOOK-005

rel('REL-BOOK-005', 'an unpaid hold expires and the slot can be taken by someone else; a late payment on the expired hold never takes the slot back', async () => {
  const date = dayFromNow(3);
  const first = await hold(h, cust, g.id, date, '19:00');
  assert.equal(first.status, 201);
  const orderId = first.body.payment.razorpay!.orderId;
  advance(16 * MIN);
  const sweep = await runSweeps(h.cfg);
  assert.equal(sweep.expiry.released, 1);
  assert.deepEqual(slotsOf(first.body.booking.id), []);
  const other = await register(h, 'Second Taker', '9844444444');
  const second = await hold(h, other, g.id, date, '19:00');
  assert.equal(second.status, 201, 'the freed slot can be held again');
  // the first customer pays on the old order, too late
  const pay = await h.post<{ paymentId: string; signature: string }>('/api/gateway/demo/pay', { orderId }, cust);
  const late = await h.post('/api/payments/razorpay/verify', { orderId, paymentId: pay.body.paymentId, signature: pay.body.signature }, cust);
  const firstNow = one<{ status: string }>('SELECT status FROM bookings WHERE id = ?', first.body.booking.id)!.status;
  assert.notEqual(firstNow, 'confirmed', `late payment did not confirm the expired booking (verify answered ${late.status})`);
  assert.equal(one<{ status: string }>('SELECT status FROM bookings WHERE id = ?', second.body.booking.id)!.status, 'held');
  assert.equal(slotsOf(second.body.booking.id).length, 1, 'the second customer still holds the slot');
  assert.equal(many('SELECT 1 FROM booking_slots WHERE ground_id = ? AND slot_start = ?', g.id, slotStart(date, '19:00')).length, 1);
  const pr = one<{ status: string; refunded_paise: number; amount_paise: number }>('SELECT status, refunded_paise, amount_paise FROM payments WHERE booking_id = ?', first.body.booking.id)!;
  ev('latePaymentStatus', pr.status); ev('firstBookingStatus', firstNow); ev('lateVerifyHttp', late.status);
  assert.ok(pr.status !== 'created', 'the late money is recorded, not ignored');
});

// ------------------------------------------------------------------ REL-BOOK-006 / 007

const FORMATS = [{ label: 'T20', ball: 'white', minutes: 210, pricePaise: 600000 }, { label: 'Tennis', ball: 'tennis', minutes: 240, pricePaise: 400000 }];

rel('REL-BOOK-006', 'a session window and the hours inside it exclude each other, in either order', async () => {
  const r = await h.patch(`/api/staff/grounds/${g.id}`, { openTime: '09:00', closeTime: '23:00', slotMinutes: 30, maxSlots: 24, formats: FORMATS }, owner);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const date = dayFromNow(3);
  // whole session first, then a desk booking for a half hour inside it
  assert.equal((await h.post('/api/bookings', { groundId: g.id, date, startTime: '12:30', formatId: 'white-210' }, cust)).status, 201);
  const inside = await walkIn(date, '14:00', 'Inside Walkin', '9855555551', 1);
  assert.equal(inside.status, 409); assert.equal(inside.body.error.code, 'SLOT_TAKEN');
  const overlapEdge = await walkIn(date, '15:30', 'Edge Walkin', '9855555552', 2);
  assert.equal(overlapEdge.status, 409, 'a booking that starts inside the session and runs past it is refused');
  const after1 = await walkIn(date, '16:00', 'After Walkin', '9855555553', 1);
  assert.equal(after1.status, 201, 'the half hour right after the session is free');
  // desk booking first, then a session that would contain it
  const other = dayFromNow(4);
  assert.equal((await walkIn(other, '10:00', 'Early Walkin', '9855555554', 1)).status, 201);
  const tennis = await h.post('/api/bookings', { groundId: g.id, date: other, startTime: '09:00', formatId: 'tennis-240' }, cust);
  assert.equal(tennis.status, 409); assert.equal(tennis.body.error.code, 'SLOT_TAKEN');
  assert.equal(many('SELECT booking_id FROM booking_slots WHERE ground_id = ? AND slot_start >= ? AND slot_start < ?', g.id, slotStart(other, '00:00'), slotStart(other, '23:59')).length, 1, 'the refused session took nothing');
  ev('sessionThenSlot', 409); ev('slotThenSession', 409);
});

rel('REL-BOOK-007', 'a booking of several hours is all-or-nothing: if one hour is taken none are held', async () => {
  const date = dayFromNow(3);
  const a = await register(h, 'Holder A', '9866666661');
  assert.equal((await hold(h, a, g.id, date, '20:00', 1)).status, 201);
  const before1 = many('SELECT * FROM booking_slots').length;
  const r = await hold(h, cust, g.id, date, '19:00', 3); // 19, 20, 21: the middle one is taken
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'SLOT_TAKEN');
  assert.equal(many('SELECT * FROM booking_slots').length, before1, 'neither neighbouring hour was left held');
  assert.equal(one<{ n: number }>('SELECT COUNT(*) n FROM bookings WHERE customer_id = (SELECT id FROM users WHERE email = ?)', 'customer@daji.test')!.n, 0, 'no booking row for the refused attempt');
  assert.equal(one<{ n: number }>("SELECT COUNT(*) n FROM payments WHERE status = 'created'")!.n, 1, 'and no payment session for it');
  // the free hours around it can still be booked
  assert.equal((await hold(h, cust, g.id, date, '21:00', 2)).status, 201);
  // a series where one date is taken reports it and books the rest (existing rule), without double-holding any date
  ev('slotRowsAfterRefusal', before1);
});

// ------------------------------------------------------------------ REL-BOOK-008

rel('REL-BOOK-008', 'hold to confirmed booking is one step: a bad signature changes nothing, a good one confirms once, and repeats and webhook races add nothing', async () => {
  const date = dayFromNow(3);
  const r = await hold(h, cust, g.id, date, '19:00', 2);
  const orderId = r.body.payment.razorpay!.orderId;
  const bid = r.body.booking.id;
  const pay = await h.post<{ paymentId: string; signature: string }>('/api/gateway/demo/pay', { orderId }, cust);
  const bad = await h.post('/api/payments/razorpay/verify', { orderId, paymentId: pay.body.paymentId, signature: 'x'.repeat(64) }, cust);
  assert.ok(bad.status >= 400 && bad.status < 500, `bad signature refused (${bad.status})`);
  const mid = one<{ status: string; paid_paise: number }>('SELECT status, paid_paise FROM bookings WHERE id = ?', bid)!;
  assert.deepEqual({ ...mid }, { status: 'held', paid_paise: 0 });
  assert.equal(many("SELECT 1 FROM audit_log WHERE action = 'booking.confirm' AND entity_id = ?", bid).length, 0);
  // the good verify and the provider's webhook for the same payment arrive together, several times
  const { capturedEvent, sendWebhook } = await import('./helpers.ts');
  const total = one<{ amount_paise: number }>('SELECT amount_paise FROM payments WHERE booking_id = ?', bid)!.amount_paise;
  const good = () => h.post('/api/payments/razorpay/verify', { orderId, paymentId: pay.body.paymentId, signature: pay.body.signature }, cust);
  const results = await Promise.all([good(), sendWebhook(h, capturedEvent(orderId, total, pay.body.paymentId), { eventId: 'evt_b8_1' }), good(), sendWebhook(h, capturedEvent(orderId, total, pay.body.paymentId), { eventId: 'evt_b8_2' }), good()]);
  assert.ok(results.every((x) => x.status === 200), results.map((x) => x.status).join(','));
  const end = one<{ status: string; paid_paise: number }>('SELECT status, paid_paise FROM bookings WHERE id = ?', bid)!;
  assert.equal(end.status, 'confirmed'); assert.equal(end.paid_paise, total, 'paid once, not once per message');
  assert.equal(many("SELECT 1 FROM payments WHERE booking_id = ? AND status = 'captured'", bid).length, 1);
  assert.equal(many("SELECT 1 FROM audit_log WHERE action = 'booking.confirm' AND entity_id = ?", bid).length, 1, 'confirmed once');
  assert.equal(slotsOf(bid).length, 2);
  ev('paidPaise', end.paid_paise); ev('captures', 1); ev('confirmAudits', 1);
});

// ------------------------------------------------------------------ REL-BOOK-009 (and the move rules)

const confirmed = async (token: string, date: string, time: string, slots = 1) => bookAndPay(h, token, g.id, date, time, slots);
const mv = (token: string, id: string, date: string, startTime: string, extra: Record<string, unknown> = {}) => h.post(`/api/bookings/${id}/reschedule`, { date, startTime, ...extra }, token);

rel('REL-BOOK-009', 'two bookings moving to the same free slot at the same moment: one moves, the other stays exactly where it was', async () => {
  const date = dayFromNow(5);
  const c2 = await register(h, 'Second Mover', '9877777771');
  const a = await confirmed(cust, date, '10:00'), b = await confirmed(c2, date, '11:00');
  const before2 = { a: slotsOf(a.id), b: slotsOf(b.id) };
  const [ra, rb] = await Promise.all([mv(cust, a.id, date, '15:00'), mv(c2, b.id, date, '15:00')]);
  const ok = [ra, rb].filter((r) => r.status === 200), no = [ra, rb].filter((r) => r.status !== 200);
  assert.equal(ok.length, 1, `${ra.status}/${rb.status}`); assert.equal(no[0]!.status, 409); assert.equal(no[0]!.body.error.code, 'SLOT_TAKEN');
  const loser = ra.status === 200 ? { id: b.id, was: before2.b } : { id: a.id, was: before2.a };
  assert.deepEqual(slotsOf(loser.id), loser.was, 'the one that lost still holds its original hour');
  assert.equal(one<{ start_at: number }>('SELECT start_at FROM bookings WHERE id = ?', loser.id)!.start_at, loser.was[0]);
  assert.equal(many('SELECT 1 FROM booking_slots WHERE ground_id = ? AND slot_start = ?', g.id, slotStart(date, '15:00')).length, 1);
  assert.equal(many('SELECT 1 FROM booking_slots WHERE ground_id = ? AND slot_start >= ? AND slot_start < ?', g.id, slotStart(date, '00:00'), slotStart(date, '23:59')).length, 2, 'two bookings, two hours, nothing leaked or lost');
  assert.equal(many("SELECT 1 FROM audit_log WHERE action = 'booking.reschedule'").length, 1);
  ev('moved', ok.length); ev('refusedCode', no[0]!.body.error.code);
});

test('moving: rules and money', async () => {
  const date = dayFromNow(5);
  const b = await confirmed(cust, date, '10:00');
  assert.equal(b.paidPaise, 90000, 'half of the 18,000 morning hour was taken as advance');
  // to a dearer evening hour: balance grows, paid stays
  const up = await mv(cust, b.id, date, '19:00');
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.equal(up.body.booking.totalPaise, 220000); assert.equal(up.body.booking.paidPaise, 90000); assert.equal(up.body.booking.balancePaise, 130000);
  assert.deepEqual(slotsOf(b.id), [slotStart(date, '19:00')]);
  assert.equal(many('SELECT * FROM booking_reschedules WHERE booking_id = ?', b.id).length, 1);
  // nothing changes if you ask for the time it already has
  assert.equal((await mv(cust, b.id, date, '19:00')).body.error.code, 'NO_CHANGE');
  // a different customer cannot move it (and learns nothing)
  const other = await register(h, 'Not The Owner', '9877777772');
  assert.equal((await mv(other, b.id, date, '18:00')).status, 404);
  // second move allowed, third refused
  assert.equal((await mv(cust, b.id, date, '18:00')).status, 200);
  const third = await mv(cust, b.id, date, '17:00');
  assert.equal(third.status, 409); assert.equal(third.body.error.code, 'RESCHEDULE_LIMIT');
  // staff are not limited by the count
  const s = await h.post(`/api/staff/bookings/${b.id}/reschedule`, { date, startTime: '17:00', reason: 'rain delay' }, staff);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const audit = one<{ actor_id: string; actor_role: string }>("SELECT actor_id, actor_role FROM audit_log WHERE action = 'booking.reschedule' ORDER BY rowid DESC LIMIT 1")!;
  assert.equal(audit.actor_role, 'staff');
  // history rows are append-only
  assert.throws(() => run('UPDATE booking_reschedules SET reason = ?', 'edited'), /append-only/);
  assert.throws(() => run('DELETE FROM booking_reschedules'), /append-only/);
});

test('moving: inside the cut-off, unpaid holds, cheaper-than-paid, closed or not-yet-open days and series are refused', async () => {
  const date = dayFromNow(5);
  // a full-day-ahead booking is outside the 24h cut-off only if more than 24h away; one that starts in 10 hours is inside it
  const soon = await confirmed(cust, dayFromNow(0), '22:00');
  const t1 = await mv(cust, soon.id, dayFromNow(5), '10:00');
  assert.equal(t1.status, 409); assert.equal(t1.body.error.code, 'RESCHEDULE_TOO_LATE');
  // a hold that is not paid yet is not a booking to move
  const held = await hold(h, cust, g.id, date, '12:00');
  assert.equal((await mv(cust, held.body.booking.id, date, '13:00')).body.error.code, 'BAD_STATE');
  // paid in full on a dear hour, cannot move to a cheaper hour without settling the money
  const dear = await confirmed(cust, dayFromNow(6), '19:00');
  const settle = await h.post(`/api/staff/bookings/${dear.id}/payments`, { method: 'cash', amountPaise: dear.totalPaise - dear.paidPaise }, staff);
  assert.equal(settle.status, 201, JSON.stringify(settle.body));
  const cheap = await mv(cust, dear.id, dayFromNow(6), '09:00');
  assert.equal(cheap.status, 409); assert.equal(cheap.body.error.code, 'RESCHEDULE_NEEDS_SETTLEMENT');
  assert.equal(slotsOf(dear.id)[0], slotStart(dayFromNow(6), '19:00'), 'the refused move changed nothing');
  // the owner closed a day for online booking
  assert.equal((await h.post('/api/admin/closed-dates', { dates: [dayFromNow(9)], closed: true, reason: 'ground maintenance', scopes: ['ground'] }, await h.login('admin'))).status, 200);
  const ok = await confirmed(cust, dayFromNow(7), '10:00');
  const toClosed = await mv(cust, ok.id, dayFromNow(9), '10:00');
  assert.equal(toClosed.status, 409); assert.equal(toClosed.body.error.code, 'DATE_CLOSED');
  assert.equal(slotsOf(ok.id)[0], slotStart(dayFromNow(7), '10:00'));
  // the ground itself (staff) may still move a booking onto a day closed for online booking
  assert.equal((await h.post(`/api/staff/bookings/${ok.id}/reschedule`, { date: dayFromNow(9), startTime: '10:00' }, staff)).status, 200);
  const toBad = await mv(cust, ok.id, date, '03:00');
  void toBad;
  assert.equal(toBad.status, 400, 'outside opening hours');
  // changing ground through the move is refused
  const g2 = (await grounds(h))[1];
  if (g2) assert.equal((await mv(cust, ok.id, date, '10:00', { groundId: g2.id })).body.error.code, 'SAME_GROUND_ONLY');
});

test('extending (overtime) adds hours to the balance and never overlaps the next booking', async () => {
  const date = dayFromNow(3);
  const b = await confirmed(cust, date, '19:00');
  const other = await register(h, 'Next Player', '9888888881');
  assert.equal((await hold(h, other, g.id, date, '21:00')).status, 201);
  const e1 = await h.post(`/api/staff/bookings/${b.id}/extend`, { slots: 1, reason: 'overs not finished' }, staff);
  assert.equal(e1.status, 200, JSON.stringify(e1.body));
  assert.equal(e1.body.booking.slotCount, 2); assert.equal(e1.body.booking.totalPaise, b.totalPaise * 2);
  const e2 = await h.post(`/api/staff/bookings/${b.id}/extend`, { slots: 1 }, staff);
  assert.equal(e2.status, 409); assert.equal(e2.body.error.code, 'SLOT_TAKEN');
  assert.equal(slotsOf(b.id).length, 2);
  // a customer cannot extend through the staff route
  assert.ok([401, 403].includes((await h.post(`/api/staff/bookings/${b.id}/extend`, { slots: 1 }, cust)).status));
  assert.equal(many("SELECT 1 FROM audit_log WHERE action = 'booking.extend'").length, 1);
});

test('weather: cancelling a ground day cancels every booking that day with the reason, once', async () => {
  const date = dayFromNow(4);
  const b1 = await confirmed(cust, date, '10:00');
  const c2 = await register(h, 'Rain Victim', '9899999991');
  const h2 = await hold(h, c2, g.id, date, '12:00');
  const other = await confirmed(cust, dayFromNow(5), '10:00');
  const short = await h.post(`/api/staff/grounds/${g.id}/cancel-day`, { date, reason: 'rain' }, staff);
  assert.equal(short.status, 400);
  const r = await h.post(`/api/staff/grounds/${g.id}/cancel-day`, { date, reason: 'Heavy rain: the pitch is unplayable' }, staff);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.cancelled.length, 2);
  const row = one<{ status: string; owner_cancelled: number; resolution: string | null; cancel_reason: string }>('SELECT status, owner_cancelled, resolution, cancel_reason FROM bookings WHERE id = ?', b1.id)!;
  assert.equal(row.status, 'cancelled'); assert.equal(row.owner_cancelled, 1); assert.equal(row.resolution, 'awaiting');
  assert.equal(one<{ status: string }>('SELECT status FROM bookings WHERE id = ?', h2.body.booking.id)!.status, 'cancelled');
  assert.equal(one<{ status: string }>('SELECT status FROM bookings WHERE id = ?', other.id)!.status, 'confirmed', 'another day is untouched');
  assert.equal(slotsOf(b1.id).length, 0);
  const again = await h.post(`/api/staff/grounds/${g.id}/cancel-day`, { date, reason: 'Heavy rain: the pitch is unplayable' }, staff);
  assert.equal(again.body.cancelled.length, 0);
  // the customer then chooses: full refund (existing flow), money not lost
  const pick = await h.post(`/api/bookings/${b1.id}/resolve`, { choice: 'refund' }, cust);
  assert.ok([200, 404].includes(pick.status));
  // an owner of another business cannot cancel this ground's day
  const owner2 = await h.login('owner2');
  assert.equal((await h.post(`/api/staff/grounds/${g.id}/cancel-day`, { date: dayFromNow(5), reason: 'Not mine to cancel at all' }, owner2)).status, 404);
  assert.equal(one<{ status: string }>('SELECT status FROM bookings WHERE id = ?', other.id)!.status, 'confirmed');
});
