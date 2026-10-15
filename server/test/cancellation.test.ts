import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  startHarness, grounds, hold, bookAndPay, dayFromNow, slotStart, setting, setNow, advance, sendWebhook, capturedEvent, HOUR, MIN,
  type Harness, type GroundLite,
} from './helpers.ts';
import { runSweeps } from '../src/jobs.ts';
import { many } from '../src/db.ts';

let h: Harness;
let g: GroundLite;
let cust: string;
let staff: string;

before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset();
  g = (await grounds(h))[0]!;
  cust = await h.login('customer');
  staff = await h.login('staff1');
});

const DATE = () => dayFromNow(3); // Sat 17 Oct 2026
const START = () => slotStart(DATE(), '19:00');

/** A confirmed booking that starts at 19:00 on DATE(), paid with the 50% advance. */
async function paidBooking() {
  return bookAndPay(h, cust, g.id, DATE(), '19:00', 1);
}

// ------------------------------------------------------------------ the 24 hour boundary

test('more than 24 hours before the start: free cancellation, cash refund, no credit', async () => {
  const b = await paidBooking();
  setNow(START() - 24 * HOUR - 1);
  const pv = await h.get(`/api/bookings/${b.id}/cancel-preview`, cust);
  assert.equal(pv.body.kind, 'free');
  assert.equal(pv.body.refundPaise, b.paidPaise / 2); // back to the payment method: 50% of what was paid
  assert.equal(pv.body.creditOptionPaise, b.paidPaise); // or all of it as account credit
  assert.equal(pv.body.retainedPaise, b.paidPaise / 2);
  assert.equal(pv.body.creditPaise, 0);
  const r = await h.post(`/api/bookings/${b.id}/cancel`, { reason: 'plans changed' }, cust);
  assert.equal(r.status, 200);
  assert.equal(r.body.booking.status, 'cancelled');
  assert.equal(r.body.booking.cancelKind, 'free');
  assert.equal(r.body.booking.refundPaise, b.paidPaise / 2);
  assert.equal((await h.get('/api/credits', cust)).body.balancePaise, 0);
});

test('exactly 24 hours before the start counts as within 24 hours: credit, no cash', async () => {
  const b = await paidBooking();
  setNow(START() - 24 * HOUR);
  const r = await h.post(`/api/bookings/${b.id}/cancel`, {}, cust);
  assert.equal(r.status, 200);
  assert.equal(r.body.booking.cancelKind, 'credit');
  assert.equal(r.body.booking.refundPaise, 0);
  assert.equal(r.body.booking.creditPaise, b.paidPaise);
  assert.equal(many('SELECT 1 FROM refunds').length, 0, 'no cash leaves');
  assert.equal((await h.get('/api/credits', cust)).body.balancePaise, b.paidPaise);
});

test('one hour before the start: credit', async () => {
  const b = await paidBooking();
  setNow(START() - HOUR);
  const r = await h.post(`/api/bookings/${b.id}/cancel`, {}, cust);
  assert.equal(r.body.outcome.kind, 'credit');
  assert.equal(r.body.outcome.creditPaise, b.paidPaise);
});

test('the late-cancellation credit percentage is a setting; the rest is retained', async () => {
  setting({ lateCancelCreditPercent: 60 });
  const b = await paidBooking();
  setNow(START() - 2 * HOUR);
  const pv = await h.get(`/api/bookings/${b.id}/cancel-preview`, cust);
  assert.equal(pv.body.creditPaise, Math.floor(b.paidPaise * 0.6));
  assert.equal(pv.body.retainedPaise, b.paidPaise - Math.floor(b.paidPaise * 0.6));
  assert.equal(pv.body.creditPaise + pv.body.retainedPaise, b.paidPaise, 'nothing is lost to rounding');
  await h.post(`/api/bookings/${b.id}/cancel`, {}, cust);
  assert.equal((await h.get('/api/credits', cust)).body.balancePaise, pv.body.creditPaise);
});

test('the free window is a setting too', async () => {
  setting({ freeCancelHours: 48 });
  const b = await paidBooking();
  setNow(START() - 30 * HOUR);
  assert.equal((await h.get(`/api/bookings/${b.id}/cancel-preview`, cust)).body.kind, 'credit');
});

test('cancelling frees the slot for someone else', async () => {
  const b = await paidBooking();
  await h.post(`/api/bookings/${b.id}/cancel`, {}, cust);
  const av = await h.get(`/api/grounds/${g.id}/availability?date=${DATE()}`);
  assert.equal(av.body.slots.find((s: any) => s.time === '19:00').state, 'available');
});

test('an unpaid hold can always be cancelled for free and nothing is refunded', async () => {
  setNow(START() - HOUR);
  const r = await hold(h, cust, g.id, DATE(), '20:00');
  assert.equal(r.status, 201);
  const c = await h.post(`/api/bookings/${r.body.booking.id}/cancel`, {}, cust);
  assert.equal(c.body.outcome.kind, 'free');
  assert.equal(c.body.outcome.refundPaise, 0);
  assert.equal(many('SELECT 1 FROM refunds').length, 0);
});

test('a cancelled booking cannot be cancelled again; a started one cannot be cancelled by the customer', async () => {
  const b = await paidBooking();
  assert.equal((await h.post(`/api/bookings/${b.id}/cancel`, {}, cust)).status, 200);
  const twice = await h.post(`/api/bookings/${b.id}/cancel`, {}, cust);
  assert.equal(twice.status, 409);
  assert.equal(twice.body.error.code, 'BAD_STATE');

  const b2 = await bookAndPay(h, cust, g.id, DATE(), '20:00', 1);
  setNow(slotStart(DATE(), '20:00') + 5 * MIN);
  const late = await h.post(`/api/bookings/${b2.id}/cancel`, {}, cust);
  assert.equal(late.status, 409);
  assert.equal(late.body.error.code, 'ALREADY_STARTED');
});

test('the customer can choose credit instead of a refund on a free cancellation', async () => {
  const b = await paidBooking();
  const r = await h.post(`/api/bookings/${b.id}/cancel`, { prefer: 'credit' }, cust);
  assert.equal(r.body.outcome.refundPaise, 0);
  assert.equal(r.body.outcome.creditPaise, b.paidPaise);
  assert.equal(many('SELECT 1 FROM refunds').length, 0);
});

// ------------------------------------------------------------------ staff

test('the owner chooses which options the customer is offered, and only those can be taken', async () => {
  const b = await paidBooking();
  const bad = await h.post(`/api/staff/bookings/${b.id}/cancel`, { reason: 'customer broke the ground rules', offers: ['half', 'bogus'] }, staff);
  assert.equal(bad.status, 400);
  const r = await h.post(`/api/staff/bookings/${b.id}/cancel`, { reason: 'customer broke the ground rules', offers: ['half'] }, staff);
  assert.equal(r.status, 200);
  const mine = (await h.get('/api/bookings', cust)).body.items.find((x: any) => x.id === b.id);
  assert.deepEqual(mine.cancelOffers, ['half']);
  assert.equal((await h.post(`/api/bookings/${b.id}/resolve`, { choice: 'refund' }, cust)).status, 409);
  assert.equal((await h.post(`/api/bookings/${b.id}/resolve`, { choice: 'credit' }, cust)).status, 409);
  const pick = await h.post(`/api/bookings/${b.id}/resolve`, { choice: 'half' }, cust);
  assert.equal(pick.status, 200, JSON.stringify(pick.body));
  assert.equal(pick.body.refundPaise, Math.round(b.paidPaise / 2)); assert.equal(pick.body.creditPaise, 0); assert.equal(pick.body.booking.resolution, 'half');
});

test('the ground cancels with an explanation; the customer then chooses a full refund, credit or another slot', async () => {
  const b = await paidBooking();
  setNow(START() - 3 * HOUR);
  assert.equal((await h.post(`/api/staff/bookings/${b.id}/cancel`, { reason: 'ground flooded, sorry' }, cust)).status, 403);
  const noWhy = await h.post(`/api/staff/bookings/${b.id}/cancel`, {}, staff);
  assert.equal(noWhy.status, 400); assert.equal(noWhy.body.error.code, 'REASON_REQUIRED');
  const r = await h.post(`/api/staff/bookings/${b.id}/cancel`, { reason: 'ground flooded, sorry' }, staff);
  assert.equal(r.status, 200); assert.equal(r.body.outcome.kind, 'owner');
  const mine = (await h.get(`/api/bookings/${b.id}`, cust)).body.booking ?? (await h.get('/api/bookings', cust)).body.items.find((x: any) => x.id === b.id);
  assert.equal(mine.status, 'cancelled'); assert.equal(mine.cancelledByOwner, true); assert.equal(mine.resolution, 'awaiting'); assert.equal(mine.cancelReason, 'ground flooded, sorry');
  assert.equal(mine.refundPaise, 0); assert.equal((await h.get('/api/credits', cust)).body.balancePaise, 0); // nothing moves until the customer chooses
  const pick = await h.post(`/api/bookings/${b.id}/resolve`, { choice: 'refund' }, cust);
  assert.equal(pick.status, 200); assert.equal(pick.body.refundPaise, b.paidPaise); assert.equal(pick.body.booking.resolution, 'refund');
  assert.equal((await h.post(`/api/bookings/${b.id}/resolve`, { choice: 'credit' }, cust)).status, 409); // only one choice
  const audit = await h.get('/api/admin/audit?limit=8', await h.login('admin'));
  assert.ok(audit.body.items.some((a: any) => a.action === 'booking.cancel_by_owner' && a.detail.reason === 'ground flooded, sorry'));
});

test('after the ground cancels, the customer can take the whole amount as credit or as credit to rebook', async () => {
  const b = await paidBooking();
  await h.post(`/api/staff/bookings/${b.id}/cancel`, { reason: 'tournament is not going ahead' }, staff);
  const pick = await h.post(`/api/bookings/${b.id}/resolve`, { choice: 'rebook' }, cust);
  assert.equal(pick.status, 200); assert.equal(pick.body.rebook, true); assert.equal(pick.body.creditPaise, b.paidPaise); assert.equal(pick.body.refundPaise, 0);
  assert.equal((await h.get('/api/credits', cust)).body.balancePaise, b.paidPaise);
});

test('another owner\'s staff cannot see or cancel the booking (404, not 403)', async () => {
  const b = await paidBooking();
  const owner2 = await h.login('owner2');
  assert.equal((await h.post(`/api/staff/bookings/${b.id}/cancel`, {}, owner2)).status, 404);
  assert.equal((await h.get(`/api/staff/bookings/${b.id}`, owner2)).status, 404);
});

// ------------------------------------------------------------------ no-show

test('no-show: only after the grace period, and neither refund nor credit is given', async () => {
  const b = await paidBooking();
  setNow(START() + 10 * MIN);
  const early = await h.post(`/api/staff/bookings/${b.id}/no-show`, {}, staff);
  assert.equal(early.status, 409);
  assert.equal(early.body.error.code, 'TOO_EARLY');
  setNow(START() + 31 * MIN);
  const r = await h.post(`/api/staff/bookings/${b.id}/no-show`, {}, staff);
  assert.equal(r.status, 200);
  assert.equal(r.body.booking.status, 'no_show');
  assert.equal(r.body.booking.refundPaise, 0);
  assert.equal(r.body.booking.creditPaise, 0);
  assert.equal(many('SELECT 1 FROM refunds').length, 0);
  assert.equal((await h.get('/api/credits', cust)).body.balancePaise, 0);
  assert.equal((await h.post(`/api/bookings/${b.id}/cancel`, {}, cust)).status, 409);
});

test('a held (unpaid) booking cannot be a no-show', async () => {
  const r = await hold(h, cust, g.id, DATE(), '19:00');
  setNow(START() + HOUR);
  assert.equal((await h.post(`/api/staff/bookings/${r.body.booking.id}/no-show`, {}, staff)).status, 409);
});

// ------------------------------------------------------------------ money in flight

test('a payment that lands after the booking was cancelled is refunded automatically', async () => {
  const r = await hold(h, cust, g.id, DATE(), '19:00');
  const orderId = r.body.payment.razorpay!.orderId;
  assert.equal((await h.post(`/api/bookings/${r.body.booking.id}/cancel`, {}, cust)).status, 200);
  const w = await sendWebhook(h, capturedEvent(orderId, r.body.booking.advancePaise), { eventId: 'evt_after_cancel' });
  assert.equal(w.body.outcome, 'cancelled_refunded');
  const rf = many<{ amount_paise: number }>('SELECT * FROM refunds WHERE booking_id = ?', r.body.booking.id);
  assert.equal(rf.length, 1);
  assert.equal(rf[0]!.amount_paise, r.body.booking.advancePaise);
  assert.equal((await h.get(`/api/bookings/${r.body.booking.id}`, cust)).body.booking.status, 'cancelled');
});

test('completed bookings: the sweep marks them completed a day after they end', async () => {
  const b = await paidBooking();
  setNow(START() + 2 * HOUR);
  assert.equal((await runSweeps(h.cfg)).completed, 0);
  advance(24 * HOUR);
  assert.equal((await runSweeps(h.cfg)).completed, 1);
  assert.equal((await h.get(`/api/bookings/${b.id}`, cust)).body.booking.status, 'completed');
});

test('a reminder goes out once, 24 hours before the start', async () => {
  const b = await paidBooking();
  setNow(START() - 25 * HOUR);
  assert.equal((await runSweeps(h.cfg)).reminders, 0);
  setNow(START() - 23 * HOUR);
  assert.equal((await runSweeps(h.cfg)).reminders, 1);
  assert.equal((await runSweeps(h.cfg)).reminders, 0, 'only once');
  const n = many<{ template: string }>("SELECT template FROM notifications WHERE booking_id = ? AND template = 'booking_reminder'", b.id);
  assert.ok(n.length >= 1);
});
