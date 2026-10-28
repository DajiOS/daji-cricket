import { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startHarness, grounds, bookAndPay, hold, checkoutSignature, DEMO, dayFromNow, slotStart, setNow, setting, advance, sendWebhook, capturedEvent, HOUR, MIN, type Harness, type GroundLite } from './helpers.ts';
import { many, one, run } from '../src/db.ts';
import { reconcile } from '../src/finevents.ts';
import { register } from './register.ts';
import { rel, ev } from './rel.ts';

// The fixes for DEF-MAP-001 to DEF-MAP-004 (27 Oct 2026). The service rules were already tested in rel-biz; these cases cover what the screens depend on:
// the read-models the customer and staff screens call (eligibility, preview, deposit view) and the online payment of a dearer move's exact difference through the existing payment path.

let h: Harness, g: GroundLite, cust: string, staff: string, owner: string;
async function setup(): Promise<void> {
  h.reset();
  g = (await grounds(h)).find((x) => x.name === 'Cricket Ground')!;
  cust = await h.login('customer'); staff = await h.login('staff1'); owner = await h.login('owner1');
}
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(setup);

const row = (id: string) => one<any>('SELECT id, status, date, start_at, slot_count, total_paise, advance_paise, paid_paise, reschedule_count FROM bookings WHERE id = ?', id)!;
const slotsOf = (id: string) => many<{ slot_start: number }>("SELECT slot_start FROM booking_slots WHERE booking_id = ? AND kind = 'booking' ORDER BY slot_start", id).map((r) => r.slot_start);
const moves = (id: string) => one<{ n: number }>("SELECT COUNT(*) n FROM booking_reschedules WHERE booking_id = ? AND actor_role = 'customer'", id)!.n;
const counts = () => ({ payments: one<{ n: number }>('SELECT COUNT(*) n FROM payments')!.n, refunds: one<{ n: number }>('SELECT COUNT(*) n FROM refunds')!.n, credits: one<{ n: number }>('SELECT COUNT(*) n FROM credit_lots')!.n, history: one<{ n: number }>('SELECT COUNT(*) n FROM booking_reschedules')!.n });
const audits = (action: string, id: string) => many<{ actor_role: string; detail: string }>('SELECT actor_role, detail FROM audit_log WHERE action = ? AND entity_id = ? ORDER BY rowid', action, id).map((a) => ({ actorRole: a.actor_role, detail: JSON.parse(a.detail) }));
const balancePayments = (id: string) => many<any>("SELECT id, method, status, amount_paise, rp_order_id, refunded_paise FROM payments WHERE booking_id = ? AND purpose = 'balance' ORDER BY created_at, rowid", id);
const status = (token: string, id: string) => h.get(`/api/bookings/${id}/reschedule`, token);
const preview = (token: string, id: string, date: string, startTime: string) => h.post(`/api/bookings/${id}/reschedule-preview`, { date, startTime }, token);
const move = (token: string, id: string, date: string, startTime: string) => h.post(`/api/bookings/${id}/reschedule`, { date, startTime }, token);
const payDiff = (token: string, id: string) => h.post(`/api/bookings/${id}/pay-difference`, {}, token);
const fresh = (date: string, time: string) => bookAndPay(h, cust, g.id, date, time, 1);
/** A booking paid in full online for a cheap morning hour, then moved to the dearer evening hour: the customer owes the exact difference. */
async function dearerMove() {
  const date = dayFromNow(5);
  const b = await fresh(date, '09:00');
  const before = row(b.id);
  const r = await move(cust, b.id, date, '19:00');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  advance(MIN); // the move and the payment of its difference are different moments
  const after = row(b.id);
  return { b, date, before, after, diff: after.total_paise - before.total_paise, paidAfter: after.paid_paise + (after.total_paise - before.total_paise) };
}
const demoPay = async (token: string, orderId: string) => { const p = await h.post('/api/gateway/demo/pay', { orderId }, token); assert.equal(p.status, 200, JSON.stringify(p.body)); return p.body as { paymentId: string; signature: string }; };

// ------------------------------------------------------------------ DEF-MAP-004: online payment of the exact difference

rel('REL-FIX-004-001', 'a customer who moved to a dearer time can pay exactly the difference online through the existing payment path; the confirmed payment settles the balance', async () => {
  const { b, before, after, diff, paidAfter } = await dearerMove();
  assert.ok(diff > 0, 'the amount owed is the exact price difference');
  assert.ok(after.total_paise - after.paid_paise > diff, 'the booking balance (paid at the ground) is larger than the difference the customer pays online');
  const st = await status(cust, b.id);
  assert.equal(st.status, 200); assert.equal(st.body.status.differenceDuePaise, diff);
  assert.equal((await h.get(`/api/bookings/${b.id}`, cust)).body.booking.moveDifferenceDuePaise, diff, 'the booking read-model carries the amount, so no screen calculates it');
  const c0 = counts();
  const started = await payDiff(cust, b.id);
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.differencePaise, diff); assert.equal(started.body.payment.amountPaise, diff); assert.equal(started.body.payment.mode, 'razorpay');
  const orderId = started.body.payment.razorpay.orderId as string;
  assert.equal(counts().payments, c0.payments + 1, 'one new payment row, no second payment system');
  const open = balancePayments(b.id).filter((p) => p.status === 'created');
  assert.equal(open.length, 1); assert.equal(open[0].amount_paise, diff); assert.equal(open[0].rp_order_id, orderId);
  assert.equal(row(b.id).paid_paise, after.paid_paise, 'an unfinished attempt changes no money');
  assert.equal((await h.get(`/api/bookings/${b.id}`, cust)).body.booking.moveDifferenceDuePaise, diff, 'an incomplete attempt stays an outstanding balance');
  const pay = await demoPay(cust, orderId);
  const v = await h.post('/api/payments/razorpay/verify', { orderId, paymentId: pay.paymentId, signature: pay.signature }, cust);
  assert.equal(v.status, 200, JSON.stringify(v.body));
  const done = row(b.id);
  assert.equal(done.paid_paise, paidAfter); assert.equal(done.status, 'confirmed');
  assert.equal(v.body.booking.moveDifferenceDuePaise, 0); assert.equal((await status(cust, b.id)).body.status.differenceDuePaise, 0);
  const rep = reconcile(g.ownerId); assert.equal(rep.unexplained, 0, JSON.stringify(rep.findings)); assert.equal(rep.debitsPaise, rep.creditsPaise);
  assert.equal(many('SELECT 1 FROM refunds WHERE booking_id = ?', b.id).length, 0, 'nothing was refunded');
  ev('before', before); ev('afterMove', after); ev('differencePaise', diff); ev('paymentInstructions', { mode: started.body.payment.mode, amountPaise: started.body.payment.amountPaise });
  ev('payments', balancePayments(b.id)); ev('finalBooking', done); ev('audit', audits('booking.difference_payment_started', b.id)); ev('accountingResult', { debits: rep.debitsPaise, credits: rep.creditsPaise, unexplained: rep.unexplained });
});

rel('REL-FIX-004-002', 'asking to pay twice gives the same open order (one session, no duplicate charge); a new amount closes the old session', async () => {
  const { b, diff } = await dearerMove();
  const a = await payDiff(cust, b.id), a2 = await payDiff(cust, b.id);
  assert.equal(a.status, 200); assert.equal(a2.status, 200);
  assert.equal(a2.body.payment.razorpay.orderId, a.body.payment.razorpay.orderId, 'the same order is returned');
  assert.equal(a2.body.payment.paymentId, a.body.payment.paymentId);
  assert.equal(balancePayments(b.id).length, 1, 'only one payment row exists');
  const pi = await h.get(`/api/bookings/${b.id}/payment-instructions`, cust);
  assert.equal(pi.status, 200); assert.equal(pi.body.payment.amountPaise, diff); assert.equal(pi.body.payment.razorpay.orderId, a.body.payment.razorpay.orderId, 'the existing payment-instructions route returns the same session');
  // the customer moves again (a cheaper hour): the unpaid session does not block the move, and it is closed because the amount owed changed
  const m = await move(cust, b.id, dayFromNow(5), '12:00');
  assert.equal(m.status, 200, JSON.stringify(m.body));
  assert.ok(balancePayments(b.id).every((p) => p.status !== 'created'), 'no stale session stays open after the move');
  ev('sessions', balancePayments(b.id)); ev('orderIds', { first: a.body.payment.razorpay.orderId, second: a2.body.payment.razorpay.orderId });
});

rel('REL-FIX-004-003', 'a declined or abandoned payment leaves the difference outstanding and can be retried; nothing is lost or double counted', async () => {
  const { b, after, diff, paidAfter } = await dearerMove();
  const s1 = await payDiff(cust, b.id); const order1 = s1.body.payment.razorpay.orderId as string;
  const declined = await h.post('/api/gateway/demo/pay', { orderId: order1, outcome: 'failure' }, cust);
  assert.equal(declined.status, 402);
  assert.equal(row(b.id).paid_paise, after.paid_paise); assert.equal(row(b.id).status, 'confirmed', 'a failed attempt never cancels the booking');
  assert.equal((await status(cust, b.id)).body.status.differenceDuePaise, diff, 'still due after the decline');
  const s2 = await payDiff(cust, b.id);
  assert.equal(s2.status, 200); assert.notEqual(s2.body.payment.razorpay.orderId, order1, 'a new order after a failed one'); assert.equal(s2.body.payment.amountPaise, diff);
  const pay = await demoPay(cust, s2.body.payment.razorpay.orderId);
  assert.equal((await h.post('/api/payments/razorpay/verify', { orderId: s2.body.payment.razorpay.orderId, paymentId: pay.paymentId, signature: pay.signature }, cust)).status, 200);
  assert.equal(row(b.id).paid_paise, paidAfter);
  assert.deepEqual(balancePayments(b.id).map((p) => p.status), ['failed', 'captured']);
  const rep = reconcile(g.ownerId); assert.equal(rep.unexplained, 0, JSON.stringify(rep.findings));
  ev('payments', balancePayments(b.id)); ev('finalBooking', row(b.id)); ev('accountingResult', { unexplained: rep.unexplained });
});

rel('REL-FIX-004-004', 'duplicate and out-of-order confirmations (webhook first, late verify, repeated webhook) credit the difference exactly once; a second provider payment on the same order is refunded as a duplicate', async () => {
  const { b, diff, paidAfter } = await dearerMove();
  // webhook first (the customer closed the page), then the browser's verify arrives late, then the provider repeats the webhook
  const s = await payDiff(cust, b.id); const orderId = s.body.payment.razorpay.orderId as string;
  const w1 = await sendWebhook(h, capturedEvent(orderId, diff, 'pay_fix_1'), { eventId: 'evt_fix_1' });
  assert.equal(w1.status, 200); assert.equal(row(b.id).paid_paise, paidAfter, 'the provider-confirmed state is authoritative');
  const v = await h.post('/api/payments/razorpay/verify', { orderId, paymentId: 'pay_fix_1', signature: checkoutSignature(DEMO.keySecret, orderId, 'pay_fix_1') }, cust);
  assert.equal(v.status, 200, JSON.stringify(v.body));
  const w2 = await sendWebhook(h, capturedEvent(orderId, diff, 'pay_fix_1'), { eventId: 'evt_fix_2' });
  assert.equal(w2.status, 200);
  assert.equal(row(b.id).paid_paise, paidAfter, 'paid exactly once');
  assert.equal(balancePayments(b.id).length, 1); assert.equal(balancePayments(b.id)[0].refunded_paise, 0);
  assert.equal(many('SELECT 1 FROM refunds WHERE booking_id = ?', b.id).length, 0);
  assert.equal((await payDiff(cust, b.id)).body.error.code, 'NOTHING_DUE', 'nothing left to pay');
  // a different provider payment on the same order is a double charge: the existing duplicate protection refunds it and the booking is not credited twice
  const w3 = await sendWebhook(h, capturedEvent(orderId, diff, 'pay_fix_2'), { eventId: 'evt_fix_3' });
  assert.equal(w3.status, 200); assert.equal(row(b.id).paid_paise, paidAfter, 'not credited twice');
  const dup = balancePayments(b.id).filter((p) => p.status === 'refunded');
  assert.equal(dup.length, 1); assert.equal(dup[0].refunded_paise, diff);
  const rep = reconcile(g.ownerId); assert.equal(rep.unexplained, 0, JSON.stringify(rep.findings));
  ev('paid', row(b.id).paid_paise); ev('payments', balancePayments(b.id)); ev('accountingResult', { unexplained: rep.unexplained });
});

rel('REL-FIX-004-005', 'only the booking\'s customer can pay it online; staff, Guppi and other customers cannot, and an unmoved booking has nothing to pay', async () => {
  const { b } = await dearerMove();
  const stranger = await register(h, 'Not The Customer', '9866600321');
  const c0 = counts();
  assert.equal((await payDiff(stranger, b.id)).status, 404);
  assert.equal((await payDiff(staff, b.id)).status, 403);
  assert.equal((await payDiff(owner, b.id)).status, 403);
  assert.equal((await h.post(`/api/bookings/${b.id}/pay-difference`, {}, null)).status, 401);
  assert.equal((await h.post('/api/guppi/understand', { text: 'pay my difference for booking ' + b.id }, cust)).status < 500, true);
  assert.deepEqual(counts(), c0, 'nothing was created by the refused calls');
  assert.equal((await status(stranger, b.id)).status, 404, 'eligibility of someone else\'s booking is not visible either');
  const plain = await fresh(dayFromNow(6), '10:00');
  assert.equal((await payDiff(cust, plain.id)).body.error.code, 'NOTHING_DUE');
  ev('refusals', { stranger: 404, staff: 403, owner: 403, anonymous: 401, nothingDue: 409 });
});

rel('REL-FIX-004-006', 'when UPI is the payment method the difference is paid by UPI reference and verified by staff, through the same existing path', async () => {
  const { b, after, diff, paidAfter } = await dearerMove();
  setting({ razorpayEnabled: false });
  const s = await payDiff(cust, b.id);
  assert.equal(s.status, 200, JSON.stringify(s.body)); assert.equal(s.body.payment.mode, 'upi'); assert.equal(s.body.payment.amountPaise, diff);
  assert.match(s.body.payment.upi.uri, new RegExp(`am=${diff / 100}`));
  const sub = await h.post(`/api/bookings/${b.id}/upi-reference`, { utr: '300000000123' }, cust);
  assert.equal(sub.status, 200, JSON.stringify(sub.body)); assert.equal(sub.body.payment.status, 'submitted');
  assert.equal((await payDiff(cust, b.id)).body.error.code, 'ALREADY_SUBMITTED', 'a reference waiting for the ground is not paid twice');
  assert.equal(row(b.id).paid_paise, after.paid_paise, 'not paid until staff confirm');
  const rej = await h.post(`/api/staff/payments/${sub.body.payment.id}/verify`, { approve: false, reason: 'not received' }, staff);
  assert.equal(rej.status, 200, JSON.stringify(rej.body)); assert.equal(row(b.id).paid_paise, after.paid_paise); assert.equal(row(b.id).status, 'confirmed', 'a rejected reference never cancels a confirmed booking');
  assert.equal((await status(cust, b.id)).body.status.differenceDuePaise, diff, 'still outstanding after a rejection');
  const s2 = await payDiff(cust, b.id); assert.equal(s2.status, 200, JSON.stringify(s2.body));
  const sub2 = await h.post(`/api/bookings/${b.id}/upi-reference`, { utr: '300000000124' }, cust); assert.equal(sub2.status, 200, JSON.stringify(sub2.body));
  const ok = await h.post(`/api/staff/payments/${sub2.body.payment.id}/verify`, { approve: true }, staff);
  assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(row(b.id).paid_paise, paidAfter);
  const rep = reconcile(g.ownerId); assert.equal(rep.unexplained, 0, JSON.stringify(rep.findings));
  ev('payments', balancePayments(b.id)); ev('finalBooking', row(b.id)); ev('accountingResult', { unexplained: rep.unexplained });
});

rel('REL-FIX-004-008', 'another unfinished balance payment (an auto-debit order) is never closed or doubled: paying the difference waits for it, and the guard lifts once it settles', async () => {
  const { b, diff, after } = await dearerMove();
  const t = Date.now();
  one("INSERT INTO payments(id, booking_id, customer_id, owner_id, method, status, purpose, amount_paise, rp_order_id, created_at, updated_at) SELECT 'pay_autodebit_x', id, customer_id, owner_id, 'razorpay', 'created', 'balance', total_paise - paid_paise, 'order_autodebit_x', ?, ? FROM bookings WHERE id = ?", t, t, b.id);
  const c0 = counts();
  const blocked = await payDiff(cust, b.id);
  assert.equal(blocked.status, 409); assert.equal(blocked.body.error.code, 'PAYMENT_IN_FLIGHT');
  assert.deepEqual(counts(), c0, 'nothing was opened or closed');
  assert.equal(balancePayments(b.id).find((p) => p.id === 'pay_autodebit_x')!.status, 'created', 'the other order is untouched');
  one("UPDATE payments SET status = 'failed' WHERE id = 'pay_autodebit_x'");
  const ok = await payDiff(cust, b.id);
  assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(ok.body.differencePaise, diff);
  assert.equal(row(b.id).paid_paise, after.paid_paise);
  ev('blocked', blocked.body.error.code); ev('afterSettled', ok.status);
});

rel('REL-FIX-004-007', 'a cheaper move after a dearer one never leaves the customer owing; the amount due is capped by the booking\'s actual balance', async () => {
  const { b, before } = await dearerMove();
  const m = await move(cust, b.id, dayFromNow(5), '09:00'); // back to the cheap hour
  assert.equal(m.status, 200, JSON.stringify(m.body));
  const r = row(b.id);
  assert.equal(r.total_paise, before.total_paise, 'back at the original price');
  assert.equal((await status(cust, b.id)).body.status.differenceDuePaise, 0);
  assert.equal((await payDiff(cust, b.id)).body.error.code, 'NOTHING_DUE');
  ev('finalBooking', r);
});

// ------------------------------------------------------------------ DEF-MAP-002: what the customer screen reads

rel('REL-FIX-002-001', 'the reschedule status tells the customer whether, why, how many moves are left and the cut-off, exactly as the move enforces it (24 hours: blocked; +1 second: allowed; -1 second: blocked)', async () => {
  const date = dayFromNow(5);
  const b = await fresh(date, '10:00');
  const start = row(b.id).start_at;
  const s0 = (await status(cust, b.id)).body.status;
  assert.deepEqual({ enabled: s0.enabled, allowed: s0.allowed, left: s0.movesLeft, max: s0.maxMoves, cutoff: s0.cutoffHours, treatment: s0.cheaperTreatment }, { enabled: true, allowed: true, left: 2, max: 2, cutoff: 24, treatment: 'credit' });
  const probe = async (t: number) => { setNow(t); const tok = await h.login('customer'); const st = (await status(tok, b.id)).body.status; const mv = await move(tok, b.id, date, '12:00'); return { st, mv }; };
  const exact = await probe(start - 24 * HOUR);
  assert.equal(exact.st.allowed, false); assert.equal(exact.st.code, 'RESCHEDULE_TOO_LATE'); assert.equal(exact.mv.body.error.code, 'RESCHEDULE_TOO_LATE', 'exactly 24 hours is blocked');
  const minus = await probe(start - 24 * HOUR + 1000);
  assert.equal(minus.st.allowed, false); assert.equal(minus.mv.status, 409, '24 hours minus a second is blocked');
  const plus = await probe(start - 24 * HOUR - 1000);
  assert.equal(plus.st.allowed, true); assert.equal(plus.st.code, null);
  assert.equal(plus.mv.status, 200, 'a second more than 24 hours is allowed');
  ev('startAt', start); ev('exact24h', exact.st.code); ev('minus1s', minus.st.code); ev('plus1s', plus.st.allowed);
});

rel('REL-FIX-002-002', 'the status reports moves used, the limit, a feature that is switched off, and a booking that cannot be moved at all', async () => {
  const date = dayFromNow(5);
  const b = await fresh(date, '10:00');
  assert.equal((await move(cust, b.id, date, '11:00')).status, 200);
  assert.equal((await status(cust, b.id)).body.status.movesLeft, 1);
  assert.equal((await move(cust, b.id, date, '12:00')).status, 200);
  const s = (await status(cust, b.id)).body.status;
  assert.deepEqual({ done: s.movesDone, left: s.movesLeft, allowed: s.allowed, code: s.code }, { done: 2, left: 0, allowed: false, code: 'RESCHEDULE_LIMIT' });
  setting({ customerRescheduleEnabled: false });
  const off = (await status(cust, b.id)).body.status;
  assert.deepEqual({ enabled: off.enabled, allowed: off.allowed, code: off.code }, { enabled: false, allowed: false, code: 'FEATURE_DISABLED' });
  assert.equal((await preview(cust, b.id, date, '14:00')).status, 503, 'the preview is off with the feature');
  const cfg = await h.get('/api/config'); assert.equal(cfg.body.customerRescheduleEnabled, false);
  setting({ customerRescheduleEnabled: true });
  assert.equal((await h.get('/api/config')).body.customerRescheduleEnabled, true);
  assert.equal(typeof (await h.get('/api/config')).body.securityDepositEnabled, 'boolean');
  const cancelled = await fresh(dayFromNow(7), '10:00');
  assert.equal((await h.post(`/api/bookings/${cancelled.id}/cancel`, {}, cust)).status, 200);
  assert.equal((await status(cust, cancelled.id)).body.status.code, 'BAD_STATE');
  ev('afterTwoMoves', s); ev('featureOff', off);
});

rel('REL-FIX-002-003', 'the preview shows the old and new time, the price change and the settlement, without changing anything or using one of the customer\'s moves', async () => {
  const date = dayFromNow(5);
  const dear = await fresh(date, '09:00');
  const c0 = counts(), s0 = { booking: row(dear.id), slots: slotsOf(dear.id), moves: moves(dear.id) };
  const p = await preview(cust, dear.id, date, '19:00');
  assert.equal(p.status, 200, JSON.stringify(p.body));
  const pv = p.body.preview;
  assert.equal(pv.direction, 'dearer'); assert.equal(pv.differencePaise, pv.toTotalPaise - pv.fromTotalPaise); assert.ok(pv.differencePaise > 0);
  assert.equal(pv.balanceAfterPaise, pv.toTotalPaise - s0.booking.paid_paise); assert.equal(pv.movesLeftAfter, 1); assert.equal(pv.settlement, null);
  assert.deepEqual({ booking: row(dear.id), slots: slotsOf(dear.id), moves: moves(dear.id) }, s0, 'nothing changed'); assert.deepEqual(counts(), c0);
  const real = await move(cust, dear.id, date, '19:00');
  assert.equal(real.body.balancePaise, pv.balanceAfterPaise, 'the move does what the preview said');
  // cheaper
  const cheap = await fresh(dayFromNow(6), '19:00');
  await h.post(`/api/staff/bookings/${cheap.id}/payments`, { method: 'cash', amountPaise: cheap.totalPaise - cheap.paidPaise }, staff);
  const cp = (await preview(cust, cheap.id, dayFromNow(6), '09:00')).body.preview;
  assert.equal(cp.direction, 'cheaper'); assert.equal(cp.settlement.treatment, 'credit'); assert.equal(cp.settlement.paiseSettled, cp.fromTotalPaise - cp.toTotalPaise); assert.equal(cp.balanceAfterPaise, 0);
  const cheapReal = await move(cust, cheap.id, dayFromNow(6), '09:00');
  assert.equal(cheapReal.body.settlement.creditPaise, cp.settlement.paiseSettled, 'the preview and the settlement agree');
  // refusals of the preview are the same as the move's
  assert.equal((await preview(cust, dear.id, date, '19:00')).body.error.code, 'NO_CHANGE');
  const stranger = await register(h, 'Previewer', '9866600322');
  assert.equal((await preview(stranger, dear.id, date, '20:00')).status, 404);
  ev('dearerPreview', pv); ev('cheaperPreview', cp); ev('unchanged', 'booking, allocation, counts and moves identical before and after the preview');
});

rel('REL-FIX-002-004', 'the preview of a taken replacement is refused with the same code as the move, and leaves the original untouched', async () => {
  const date = dayFromNow(5);
  const b = await fresh(date, '10:00');
  const other = await register(h, 'Holder 2', '9866600323');
  assert.equal((await h.post('/api/bookings', { groundId: g.id, date, startTime: '14:00', slots: 1 }, other)).status, 201);
  const before = { booking: row(b.id), slots: slotsOf(b.id) };
  const p = await preview(cust, b.id, date, '14:00'), m = await move(cust, b.id, date, '14:00');
  assert.equal(m.body.error.code, 'SLOT_TAKEN');
  assert.equal(p.status, 409); assert.equal(p.body.error.code, 'SLOT_TAKEN', 'the preview says the same as the move would');
  assert.deepEqual({ booking: row(b.id), slots: slotsOf(b.id) }, before);
  ev('previewCode', p.body.error.code); ev('moveCode', m.body.error.code);
});

// ------------------------------------------------------------------ DEF-MAP-003: what the staff Move Booking control reads and enforces

rel('REL-FIX-003-001', 'staff Move Booking: preview needs manage_bookings, the move needs a reason of at least 10 characters, server errors reach the screen, and the customer\'s allowance is not used', async () => {
  const date = dayFromNow(2);
  const b = await fresh(date, '10:00');
  setNow(b.startAt - 5 * HOUR); const st = await h.login('staff1'), ct = await h.login('customer');
  assert.equal((await move(ct, b.id, date, '12:00')).body.error.code, 'RESCHEDULE_TOO_LATE');
  const p = await h.post(`/api/staff/bookings/${b.id}/reschedule-preview`, { date, startTime: '12:00' }, st);
  assert.equal(p.status, 200, JSON.stringify(p.body)); assert.equal(p.body.preview.movesLeftAfter, null, 'staff moves have no customer allowance');
  assert.equal((await h.post(`/api/staff/bookings/${b.id}/reschedule-preview`, { date, startTime: '12:00' }, ct)).status, 403, 'a customer cannot use the staff preview');
  const short = await h.post(`/api/staff/bookings/${b.id}/reschedule`, { date, startTime: '12:00', reason: 'too short' }, st);
  assert.equal(short.status, 400); assert.equal(short.body.error.code, 'REASON_REQUIRED');
  const noop = await h.post(`/api/staff/bookings/${b.id}/reschedule`, { date, startTime: '10:00', reason: 'Customer phoned to confirm' }, st);
  assert.equal(noop.status, 409); assert.equal(noop.body.error.code, 'NO_CHANGE');
  const ok = await h.post(`/api/staff/bookings/${b.id}/reschedule`, { date, startTime: '12:00', reason: 'Customer phoned: team arrives late' }, st);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(moves(b.id), 0, 'the customer\'s moves are untouched'); assert.equal(row(b.id).reschedule_count, 0);
  assert.equal(audits('booking.reschedule', b.id).at(-1)!.actorRole, 'staff');
  ev('previewMovesLeftAfter', p.body.preview.movesLeftAfter); ev('errorsShown', [short.body.error.code, noop.body.error.code]); ev('audit', audits('booking.reschedule', b.id));
});

// ------------------------------------------------------------------ DEF-MAP-001: what the deposit screens read

rel('REL-FIX-001-001', 'the customer deposit view is read-only and separate from the advance; staff panel actions are permission-checked; the flag is exposed to clients', async () => {
  const b = await fresh(dayFromNow(5), '19:00');
  const before = row(b.id);
  assert.equal((await h.get(`/api/bookings/${b.id}/security-deposit`, cust)).body.deposit.heldPaise, 0);
  const collect = await h.call('POST', `/api/staff/bookings/${b.id}/security-deposit/collect`, { token: staff, body: { amountPaise: 50000, method: 'cash', reference: 'receipt-fix-1' }, headers: { 'idempotency-key': 'fix-dep-1' } });
  assert.equal(collect.status, 201, JSON.stringify(collect.body));
  const cv = (await h.get(`/api/bookings/${b.id}/security-deposit`, cust)).body.deposit;
  assert.equal(cv.heldPaise, 50000); assert.equal(cv.keptPaise, 0); assert.ok(Array.isArray(cv.entries) || cv.entries === undefined);
  assert.deepEqual(row(b.id), before, 'advance, total and paid are unchanged by the deposit');
  for (const kind of ['collect', 'refund', 'deduct', 'reverse']) {
    const r = await h.call('POST', `/api/bookings/${b.id}/security-deposit/${kind}`, { token: cust, body: { amountPaise: 100, method: 'cash' } });
    assert.equal(r.status, 404, `a customer cannot ${kind}: the route does not exist for them`);
  }
  const stranger = await register(h, 'Deposit Peeker', '9866600324');
  assert.equal((await h.get(`/api/bookings/${b.id}/security-deposit`, stranger)).status, 404);
  const cfg = (await h.get('/api/config')).body;
  assert.equal(cfg.securityDepositEnabled, true);
  setting({ securityDepositEnabled: false });
  assert.equal((await h.get('/api/config')).body.securityDepositEnabled, false);
  ev('customerView', cv); ev('bookingUnchanged', before);
});

rel('REL-FIX-002-005', 'on a ground with a price list the status gives the exact kind of session to ask options for; the customer moves through a server-made option, and an unmatched session is "call the ground"', async () => {
  const owner1 = await h.login('owner1');
  const R = (n: number) => n * 100;
  const rates = [
    { id: 'l-night', label: 'Evening hours', ball: 'leather', days: [2, 3, 4, 5, 6, 0], from: '19:00', to: '27:00', mode: 'hourly', pricePaise: R(3500) },
    { id: 'l-day', label: 'Day session', ball: 'leather', days: [2, 3, 4, 5], from: '10:00', to: '18:00', mode: 'fixed', pricePaise: R(6000) },
    { id: 'l-morn', label: 'Morning session', ball: 'leather', days: [2, 3, 4, 5], from: '07:00', to: '10:00', mode: 'fixed', pricePaise: R(4000) },
  ];
  assert.equal((await h.patch(`/api/staff/grounds/${g.id}`, { slotMinutes: 60, maxSlots: 8, closedDays: [1], rates }, owner1)).status, 200);
  let tue = ''; for (let n = 4; n < 30; n++) { const d = dayFromNow(n); if (new Date(d + 'T00:00:00Z').getUTCDay() === 3) { tue = d; break; } }
  const held = await h.post('/api/bookings', { groundId: g.id, date: tue, startTime: '07:00', ruleId: 'l-morn' }, cust);
  assert.equal(held.status, 201, JSON.stringify(held.body));
  const orderId = held.body.payment.razorpay.orderId as string; const pay = await demoPay(cust, orderId);
  const confirmed = await h.post('/api/payments/razorpay/verify', { orderId, paymentId: pay.paymentId, signature: pay.signature }, cust);
  const id = confirmed.body.booking.id as string;
  const st = (await status(cust, id)).body.status;
  assert.equal(st.allowed, true, JSON.stringify(st)); assert.deepEqual(st.optionsRequest, { groundId: g.id, ruleId: 'l-morn' });
  const next = dayFromNow(Math.round((slotStart(tue, '00:00') - slotStart(dayFromNow(0), '00:00')) / (24 * HOUR)) + 1);
  const opts = await h.post('/api/availability/options', { ...st.optionsRequest, date: next, startTime: '07:00' }, cust);
  assert.equal(opts.status, 200, JSON.stringify(opts.body)); assert.ok(opts.body.exact, JSON.stringify(opts.body));
  const pv = await h.post(`/api/bookings/${id}/reschedule-preview`, { optionId: opts.body.exact.optionId }, cust);
  assert.equal(pv.status, 200, JSON.stringify(pv.body)); assert.equal(pv.body.preview.direction, 'same_price'); assert.equal(pv.body.preview.differencePaise, 0);
  const mv = await h.post(`/api/bookings/${id}/reschedule`, { optionId: opts.body.exact.optionId }, cust);
  assert.equal(mv.status, 200, JSON.stringify(mv.body));
  assert.equal(row(id).total_paise, R(4000)); assert.equal(row(id).date, next); assert.equal((await status(cust, id)).body.status.differenceDuePaise, 0);
  // a session whose label is no longer on the price list cannot be moved by the customer
  assert.equal((await h.patch(`/api/staff/grounds/${g.id}`, { rates: rates.filter((x) => x.id !== 'l-morn') }, owner1)).status, 200);
  const lost = (await status(cust, id)).body.status;
  assert.equal(lost.allowed, false); assert.equal(lost.code, 'NOT_SELF_SERVICE'); assert.equal(lost.optionsRequest, null);
  ev('optionsRequest', st.optionsRequest); ev('preview', pv.body.preview); ev('unmatched', lost.code);
});

rel('REL-FIX-002-006', 'a replacement time that is free on the ground but taken on a linked net is refused by the preview and by the move, and nothing changes', async () => {
  const nets = (await grounds(h)).find((x) => x.name === 'Practice Nets')!;
  const owner1 = await h.login('owner1');
  const linked = await h.call('PUT', `/api/staff/grounds/${g.id}/links`, { token: owner1, body: { includes: [{ groundId: nets.id, conflicts: true }] } });
  assert.equal(linked.status, 200, JSON.stringify(linked.body));
  const date = dayFromNow(5);
  const b = await fresh(date, '10:00');
  const other = await register(h, 'Net Customer', '9866600321');
  const net = await hold(h, other, nets.id, date, '12:00', 1);
  assert.equal(net.status, 201, JSON.stringify(net.body));
  const before = { booking: row(b.id), slots: slotsOf(b.id), counts: counts() };
  const p = await preview(cust, b.id, date, '12:00');
  assert.equal(p.status, 409, JSON.stringify(p.body)); assert.equal(p.body.error.code, 'SLOT_TAKEN');
  const m = await move(cust, b.id, date, '12:00');
  assert.equal(m.status, 409); assert.equal(m.body.error.code, 'SLOT_TAKEN');
  assert.deepEqual({ booking: row(b.id), slots: slotsOf(b.id), counts: counts() }, before, 'the original booking, its slots and the money records are untouched');
  ev('refused', { preview: p.body.error.code, move: m.body.error.code });
});

// ------------------------------------------------------------------ boundaries of the move and deposit calls

rel('REL-FIX-006-001', 'another customer, another business, a staff member without the booking permission and an anonymous caller are refused on the status, preview, move and deposit calls with no change of state', async () => {
  const date = dayFromNow(4);
  const b = await fresh(date, '10:00');
  const stranger = await register(h, 'Other Customer', '9866600654');
  const owner2 = await h.login('owner2');
  const snap = () => ({ booking: row(b.id), slots: slotsOf(b.id), counts: counts(), dep: one<{ n: number }>('SELECT COUNT(*) n FROM security_deposit_entries')!.n });
  const before = snap();
  const refused: Record<string, number> = {};
  const note = (k: string, r: { status: number }, ...want: number[]) => { refused[k] = r.status; assert.ok(want.includes(r.status), `${k} gave ${r.status}`); };
  note('strangerStatus', await status(stranger, b.id), 404);
  note('strangerPreview', await preview(stranger, b.id, date, '12:00'), 404);
  note('strangerMove', await move(stranger, b.id, date, '12:00'), 404);
  note('strangerDeposit', await h.get(`/api/bookings/${b.id}/security-deposit`, stranger), 404);
  note('otherBusinessPreview', await h.post(`/api/staff/bookings/${b.id}/reschedule-preview`, { date, startTime: '12:00' }, owner2), 403, 404);
  note('otherBusinessMove', await h.post(`/api/staff/bookings/${b.id}/reschedule`, { date, startTime: '12:00', reason: 'Trying another business booking' }, owner2), 403, 404);
  note('otherBusinessDeposit', await h.call('POST', `/api/staff/bookings/${b.id}/security-deposit/collect`, { token: owner2, body: { amountPaise: 10000, method: 'cash' } }), 403, 404);
  note('anonymousStatus', await status(null as any, b.id), 401);
  note('anonymousMove', await h.post(`/api/staff/bookings/${b.id}/reschedule`, { date, startTime: '12:00', reason: 'Nobody is signed in here' }, null), 401);
  const staffRow = one<{ id: string; permissions: string }>("SELECT id, permissions FROM users WHERE email = 'staff1@daji.test' OR role = 'staff' ORDER BY rowid LIMIT 1")!;
  try {
    run('UPDATE users SET permissions = ? WHERE id = ?', JSON.stringify(['view_customers']), staffRow.id);
    const noPerm = await h.login('staff1');
    note('noPermissionPreview', await h.post(`/api/staff/bookings/${b.id}/reschedule-preview`, { date, startTime: '12:00' }, noPerm), 403);
    note('noPermissionMove', await h.post(`/api/staff/bookings/${b.id}/reschedule`, { date, startTime: '12:00', reason: 'Staff without the permission' }, noPerm), 403);
    note('noPermissionDeposit', await h.call('POST', `/api/staff/bookings/${b.id}/security-deposit/collect`, { token: noPerm, body: { amountPaise: 10000, method: 'cash' } }), 403);
  } finally { run('UPDATE users SET permissions = ? WHERE id = ?', staffRow.permissions, staffRow.id); }
  assert.deepEqual(snap(), before, 'none of the refused calls changed the booking, its slots, any money record or the deposit ledger');
  ev('refusals', refused);
});

// ------------------------------------------------------------------ the three clients read the server, they do not decide

rel('REL-FIX-007-001', 'web, iPad web, iOS/Android and the staff desk all call the same server endpoints for the move, the difference payment and the deposit, and none of them works out a price, a cut-off or a deposit balance itself', () => {
  const ROOT = new URL('../../', import.meta.url).pathname;
  const read = (f: string) => readFileSync(ROOT + f, 'utf8');
  const web = read('web/public/app.js');
  const mobile = ['mobile/src/ManageBooking.tsx', 'mobile/src/MeScreen.tsx'].map(read).join('\n');
  const desk = ['desk/src/parts/dash/Deposit.tsx', 'desk/src/parts/dash/MoveBooking.tsx'].map(read).join('\n');
  const calls: Record<string, Record<string, boolean>> = {
    web: { reschedule: /\/reschedule-preview/.test(web) && /\/reschedule`/.test(web), difference: /\/pay-difference/.test(web), deposit: /\/security-deposit/.test(web) },
    mobile: { reschedule: /\/reschedule-preview/.test(mobile) && /\/reschedule`/.test(mobile), difference: /\/pay-difference/.test(mobile), deposit: /\/security-deposit/.test(mobile) },
    desk: { reschedule: /reschedule-preview|\$\{path\}-preview/.test(desk) && /\/reschedule`/.test(desk), deposit: /security-deposit/.test(desk) },
  };
  for (const [client, c] of Object.entries(calls)) for (const [what, yes] of Object.entries(c)) assert.ok(yes, `${client} does not call the ${what} endpoint`);
  // the amounts shown come from the server's read-models; there is no cut-off or price arithmetic in the new screens
  const newWeb = web.slice(web.indexOf('const DEPOSIT_KINDS'), web.indexOf('async function loadBookings') > 0 ? web.indexOf('async function loadBookings') : undefined);
  assert.ok(newWeb.length > 500, 'the manage-booking block was found in app.js');
  for (const [name, src] of [['web', newWeb], ['mobile', mobile.slice(mobile.indexOf('DepositScreen'))], ['desk', desk]] as const) {
    assert.ok(!/cutoffHours\s*\*|24\s*\*\s*(60|3600)|\bHOUR\b/.test(src), `${name} computes a cut-off`);
    assert.ok(!/totalPaise\s*-\s*(paidPaise|b\.paidPaise)|moveDifferenceDuePaise\s*[-+*]|deductedPaise\s*-\s*reversedPaise|collectedPaise\s*-/.test(src), `${name} computes an amount the server already provides`);
  }
  ev('clientsChecked', Object.keys(calls));
});

rel('REL-FIX-008-001', 'the booking advance is never called a "deposit" on the website, the app, the staff desk or in the messages the server sends; "security deposit" is only the separate refundable amount', () => {
  const ROOT = new URL('../../', import.meta.url).pathname;
  const read = (f: string) => readFileSync(ROOT + f, 'utf8');
  const wrong = /your deposit of|deposit is holding|pays the deposit|its deposit paid|· deposit \$|· deposit \{|head: 'Deposit'/i;
  const files = ['server/src/notifications.ts', 'server/src/bookings.ts', 'web/public/app.js', 'desk/src/pages/Approvals.tsx', 'desk/src/pages/Bookings.tsx', 'desk/src/parts/dash/Queues.tsx', 'desk/src/parts/dash/Today.tsx', 'mobile/src/MeScreen.tsx', 'mobile/src/PayScreen.tsx', 'mobile/src/ManageBooking.tsx'];
  const hits = files.flatMap((f) => read(f).split('\n').map((l, i) => (wrong.test(l) ? `${f}:${i + 1}` : '')).filter(Boolean));
  assert.deepEqual(hits, [], 'these lines call the booking advance a deposit');
  assert.match(read('mobile/src/ManageBooking.tsx'), /Booking advance/, 'the app screen labels the advance as the advance');
  ev('filesChecked', files.length);
});
