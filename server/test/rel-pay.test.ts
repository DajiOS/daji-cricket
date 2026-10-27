import { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, hold, bookAndPay, dayFromNow, advance, MIN, sendWebhook, capturedEvent, setting, DEMO, webhookSignature, type Harness, type GroundLite } from './helpers.ts';
import { runSweeps } from '../src/jobs.ts';
import { many, one, run } from '../src/db.ts';
import { register } from './register.ts';
import { rel, ev } from './rel.ts';

let h: Harness, g: GroundLite, cust: string, staff: string, owner: string, adm: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => { h.reset(); g = (await grounds(h))[0]!; cust = await h.login('customer'); staff = await h.login('staff1'); owner = await h.login('owner1'); adm = await h.login('admin'); });

const UTR = (n: number) => String(100000000000 + n);
const bookingRow = (id: string) => one<{ status: string; paid_paise: number; needs_review: number; total_paise: number }>('SELECT status, paid_paise, needs_review, total_paise FROM bookings WHERE id = ?', id)!;
const captured = (bookingId: string) => many("SELECT 1 FROM payments WHERE booking_id = ? AND status IN ('captured','partially_refunded','refunded')", bookingId).length;

// ------------------------------------------------------------------ REL-PAY-001

rel('REL-PAY-001', 'a browser saying "paid" is not proof: forged or missing proof, a customer\'s own claim and timeouts confirm nothing', async () => {
  const date = dayFromNow(3);
  const r = await hold(h, cust, g.id, date, '19:00');
  const bid = r.body.booking.id, orderId = r.body.payment.razorpay!.orderId;
  const pay = await h.post<{ paymentId: string; signature: string }>('/api/gateway/demo/pay', { orderId }, cust);
  // a forged signature, a signature for another payment id, and one made with the wrong secret
  assert.equal((await h.post('/api/payments/razorpay/verify', { orderId, paymentId: pay.body.paymentId, signature: '0'.repeat(64) }, cust)).status, 400);
  assert.equal((await h.post('/api/payments/razorpay/verify', { orderId, paymentId: 'pay_other', signature: pay.body.signature }, cust)).status, 400);
  assert.equal((await h.post('/api/payments/razorpay/verify', { orderId, paymentId: pay.body.paymentId }, cust)).status, 400, 'no signature at all');
  // someone else cannot confirm it with a valid proof either
  const other = await register(h, 'Not The Payer', '9811111111');
  assert.equal((await h.post('/api/payments/razorpay/verify', { orderId, paymentId: pay.body.paymentId, signature: pay.body.signature }, other)).status, 404);
  // a customer cannot mark a UPI payment verified, or approve their own refund
  assert.equal((await h.post('/api/staff/payments/anything/verify', { approve: true }, cust)).status, 403);
  assert.equal(bookingRow(bid).status, 'held'); assert.equal(bookingRow(bid).paid_paise, 0); assert.equal(captured(bid), 0);
  // time passing does not confirm it either: the hold ends
  advance(16 * MIN); await runSweeps(h.cfg);
  assert.equal(bookingRow(bid).status, 'expired');
  ev('forgedAttempts', 4); ev('finalStatus', 'expired');
});

// ------------------------------------------------------------------ REL-PAY-002

rel('REL-PAY-002', 'a webhook with a wrong, missing or re-serialised signature is refused and changes nothing, even with a perfect payload', async () => {
  const r = await hold(h, cust, g.id, dayFromNow(3), '19:00');
  const orderId = r.body.payment.razorpay!.orderId, amt = r.body.booking.advancePaise;
  const body = capturedEvent(orderId, amt);
  const results = [
    await sendWebhook(h, body, { secret: 'wrong-secret' }),
    await sendWebhook(h, body, { signature: '' }),
    await h.call('POST', '/api/webhooks/razorpay', { raw: Buffer.from(JSON.stringify(body)), headers: { 'content-type': 'application/json' } }),
    await h.call('POST', '/api/webhooks/razorpay', { raw: Buffer.from(JSON.stringify(body, null, 2)), headers: { 'x-razorpay-signature': webhookSignature(DEMO.webhookSecret, Buffer.from(JSON.stringify(body))) } }),
    await h.call('POST', '/api/webhooks/razorpay', { raw: Buffer.from('not json'), headers: { 'x-razorpay-signature': webhookSignature(DEMO.webhookSecret, Buffer.from('not json')) } }),
  ];
  assert.deepEqual(results.map((x) => x.status), [400, 400, 400, 400, 400]);
  assert.equal(bookingRow(r.body.booking.id).status, 'held'); assert.equal(captured(r.body.booking.id), 0);
  assert.equal(many('SELECT 1 FROM webhook_events').length, 0, 'refused events are not remembered as processed');
  ev('statuses', results.map((x) => x.status));
});

// ------------------------------------------------------------------ REL-PAY-003

rel('REL-PAY-003', 'the same payment announced many times, at once or later, under one event id or many, is applied once', async () => {
  const r = await hold(h, cust, g.id, dayFromNow(3), '19:00');
  const orderId = r.body.payment.razorpay!.orderId, amt = r.body.booking.advancePaise, bid = r.body.booking.id;
  const same = await Promise.all(Array.from({ length: 6 }, () => sendWebhook(h, capturedEvent(orderId, amt, 'pay_dup'), { eventId: 'evt_same_id' })));
  assert.ok(same.every((x) => x.status === 200));
  assert.equal(same.filter((x) => x.body.outcome === 'confirmed').length, 1);
  // the provider re-sends the same payment under new event ids (its retries do that)
  const again = await Promise.all(['evt_r1', 'evt_r2', 'evt_r3'].map((id) => sendWebhook(h, capturedEvent(orderId, amt, 'pay_dup'), { eventId: id })));
  assert.ok(again.every((x) => x.body.outcome === 'already'));
  // and the order.paid companion event
  const orderPaid = await sendWebhook(h, { event: 'order.paid', payload: { payment: { entity: { id: 'pay_dup', order_id: orderId, amount: amt, currency: 'INR' } }, order: { entity: { id: orderId } } } }, { eventId: 'evt_op' });
  assert.equal(orderPaid.body.outcome, 'already');
  const b = bookingRow(bid);
  assert.equal(b.paid_paise, amt); assert.equal(captured(bid), 1);
  assert.equal(many("SELECT 1 FROM audit_log WHERE action = 'booking.confirm' AND entity_id = ?", bid).length, 1);
  assert.equal(many("SELECT 1 FROM audit_log WHERE action = 'payment.capture' AND entity_id IN (SELECT id FROM payments WHERE booking_id = ?)", bid).length, 1);
  assert.equal(many('SELECT 1 FROM refunds WHERE booking_id = ?', bid).length, 0, 'nothing was refunded: it was one payment');
  ev('sameIdDeliveries', 6); ev('newIdDeliveries', 4); ev('paidPaise', b.paid_paise);
});

// ------------------------------------------------------------------ REL-PAY-004

rel('REL-PAY-004', 'a payment whose amount or currency differs from the order, or has none, is not taken in; it is flagged, and the right payment still works', async () => {
  const r = await hold(h, cust, g.id, dayFromNow(3), '19:00');
  const orderId = r.body.payment.razorpay!.orderId, amt = r.body.booking.advancePaise, bid = r.body.booking.id;
  const mk = (amount: unknown, currency: unknown) => ({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_x', order_id: orderId, ...(amount === undefined ? {} : { amount }), ...(currency === undefined ? {} : { currency }) } } } });
  const cases: [string, unknown, unknown][] = [['too little', amt - 100, 'INR'], ['too much', amt + 100, 'INR'], ['no amount', undefined, 'INR'], ['text amount', 'lots', 'INR'], ['fraction', amt + 0.5, 'INR'], ['other currency', amt, 'USD'], ['no currency', amt, undefined]];
  const outcomes: Record<string, string> = {};
  for (const [name, a, c] of cases) {
    const w = await sendWebhook(h, mk(a, c), { eventId: `evt_${name}` });
    outcomes[name] = w.body.outcome;
    assert.equal(w.body.outcome, 'amount_mismatch', name);
    assert.equal(bookingRow(bid).status, 'held', name); assert.equal(bookingRow(bid).paid_paise, 0, name); assert.equal(captured(bid), 0, name);
  }
  assert.equal(bookingRow(bid).needs_review, 1, 'staff are told');
  assert.equal(many("SELECT 1 FROM audit_log WHERE action = 'payment.amount_mismatch'").length, cases.length);
  // the correct one still goes through
  assert.equal((await sendWebhook(h, capturedEvent(orderId, amt), { eventId: 'evt_good' })).body.outcome, 'confirmed');
  assert.equal(bookingRow(bid).paid_paise, amt);
  ev('outcomes', outcomes);
});

// ------------------------------------------------------------------ REL-PAY-005

rel('REL-PAY-005', 'money arriving after the slot was lost is returned automatically, never double-books, and the new holder is untouched', async () => {
  const date = dayFromNow(3);
  const r = await hold(h, cust, g.id, date, '19:00');
  const orderId = r.body.payment.razorpay!.orderId, amt = r.body.booking.advancePaise, bid = r.body.booking.id;
  advance(16 * MIN); await runSweeps(h.cfg);
  const other = await register(h, 'New Holder', '9822222222');
  const second = await hold(h, other, g.id, date, '19:00');
  assert.equal(second.status, 201);
  const w = await sendWebhook(h, capturedEvent(orderId, amt, 'pay_late'), { eventId: 'evt_late_lost' });
  assert.equal(w.body.outcome, 'late_refunded');
  assert.equal(bookingRow(bid).status, 'expired'); assert.equal(bookingRow(second.body.booking.id).status, 'held');
  assert.equal(many('SELECT 1 FROM booking_slots WHERE ground_id = ? AND booking_id = ?', g.id, second.body.booking.id).length, 1);
  assert.equal(many('SELECT 1 FROM booking_slots WHERE booking_id = ?', bid).length, 0);
  const rf = one<{ amount_paise: number; status: string }>('SELECT amount_paise, status FROM refunds WHERE booking_id = ?', bid)!;
  assert.equal(rf.amount_paise, amt);
  const pay = one<{ refunded_paise: number; amount_paise: number; late: number }>('SELECT refunded_paise, amount_paise, late FROM payments WHERE booking_id = ?', bid)!;
  assert.equal(pay.refunded_paise, pay.amount_paise); assert.equal(pay.late, 1);
  // when the slot is still free the same late payment re-confirms instead, and staff are asked to look
  const r2 = await hold(h, cust, g.id, dayFromNow(4), '19:00');
  advance(16 * MIN); await runSweeps(h.cfg);
  const w2 = await sendWebhook(h, capturedEvent(r2.body.payment.razorpay!.orderId, r2.body.booking.advancePaise, 'pay_late2'), { eventId: 'evt_late_free' });
  assert.equal(w2.body.outcome, 'late_reconfirmed'); assert.equal(bookingRow(r2.body.booking.id).needs_review, 1);
  ev('lostSlotOutcome', w.body.outcome); ev('freeSlotOutcome', w2.body.outcome); ev('refundedPaise', rf.amount_paise);
});

// ------------------------------------------------------------------ REL-PAY-006

rel('REL-PAY-006', 'direct UPI: nothing is confirmed until the ground\'s own staff match the bank credit; a reference is used once; the wrong people cannot verify', async () => {
  setting({ razorpayEnabled: false });
  const r = await hold(h, cust, g.id, dayFromNow(3), '19:00');
  const bid = r.body.booking.id;
  assert.equal(r.body.payment.mode, 'upi');
  const bad = await h.post(`/api/bookings/${bid}/upi-reference`, { utr: '12345' }, cust);
  assert.equal(bad.status, 400);
  const sub = await h.post(`/api/bookings/${bid}/upi-reference`, { utr: UTR(1) }, cust);
  assert.equal(sub.status, 200, JSON.stringify(sub.body));
  assert.equal(bookingRow(bid).status, 'held', 'a customer-typed reference confirms nothing');
  // a second booking cannot reuse the same reference
  const c2 = await register(h, 'Reuser', '9833333333');
  const r2 = await hold(h, c2, g.id, dayFromNow(4), '19:00');
  const reuse = await h.post(`/api/bookings/${r2.body.booking.id}/upi-reference`, { utr: UTR(1) }, c2);
  assert.equal(reuse.status, 409); assert.equal(reuse.body.error.code, 'UTR_ALREADY_USED');
  // the customer, staff of another business, and staff without the permission cannot verify
  const payId = sub.body.payment.id;
  assert.equal((await h.post(`/api/staff/payments/${payId}/verify`, { approve: true }, cust)).status, 403);
  assert.equal((await h.post(`/api/staff/payments/${payId}/verify`, { approve: true }, await h.login('owner2'))).status, 404);
  const noPerm = await h.post('/api/staff/team', { name: 'No Verify', email: 'noverify@x.test', password: 'Member@12345', permissions: ['manage_bookings'] }, owner);
  assert.equal(noPerm.status, 201);
  const npTok = (await h.post('/api/auth/login', { email: 'noverify@x.test', password: 'Member@12345' })).body.token;
  assert.equal((await h.post(`/api/staff/payments/${payId}/verify`, { approve: true }, npTok)).status, 403);
  assert.equal(bookingRow(bid).status, 'held');
  // a rejection needs a reason and leaves the booking unconfirmed; an amount larger than expected is refused
  assert.equal((await h.post(`/api/staff/payments/${payId}/verify`, { approve: false }, staff)).status, 400);
  assert.equal((await h.post(`/api/staff/payments/${payId}/verify`, { approve: true, receivedPaise: r.body.booking.advancePaise + 1 }, staff)).status, 400);
  // the real verification
  const ok = await h.post(`/api/staff/payments/${payId}/verify`, { approve: true }, staff);
  assert.equal(ok.status, 200); assert.equal(ok.body.outcome, 'confirmed');
  assert.equal(bookingRow(bid).status, 'confirmed');
  assert.equal((await h.post(`/api/staff/payments/${payId}/verify`, { approve: true }, staff)).status, 409, 'verifying twice is refused');
  const who = one<{ actor_id: string }>("SELECT actor_id FROM audit_log WHERE action = 'payment.capture' AND entity_id = ?", payId)!;
  assert.equal(who.actor_id, one<{ id: string }>('SELECT id FROM users WHERE email = ?', 'staff1@daji.test')!.id, 'the audit names the person who verified');
  ev('verifiedBy', 'staff1');
});

// ------------------------------------------------------------------ REL-PAY-007

rel('REL-PAY-007', 'a refund moves pending, approved at the ground, authorised by the super admin, paid, and cannot skip a step or exceed the payment', async () => {
  const b = await bookAndPay(h, cust, g.id, dayFromNow(4), '19:00', 1);
  const payId = one<{ id: string }>('SELECT id FROM payments WHERE booking_id = ?', b.id)!.id;
  const ask = await h.post(`/api/staff/payments/${payId}/refund`, { amountPaise: 50000, reason: 'customer overpaid on site' }, staff);
  assert.equal(ask.status, 201, JSON.stringify(ask.body));
  const rid = ask.body.id;
  assert.equal(ask.body.status, 'pending'); assert.equal(ask.body.approvedAt, null);
  assert.equal((await runSweeps(h.cfg)).refundsProcessed, 0, 'nothing moves before approval');
  assert.equal((await h.post(`/api/admin/refunds/${rid}/approve`, {}, adm)).status, 409, 'the super admin cannot skip the ground\'s step');
  const item = (await h.get('/api/accounting/approvals/requests', owner)).body.items.find((x: any) => x.kind === 'refund' && x.entityId === rid);
  assert.ok(item);
  assert.equal((await h.post(`/api/accounting/approvals/requests/${item.id}/approve`, {}, owner)).status, 200);
  assert.equal((await h.post(`/api/admin/refunds/${rid}/approve`, {}, staff)).status, 403);
  assert.equal((await h.post(`/api/admin/refunds/${rid}/approve`, {}, adm)).status, 200);
  assert.equal((await h.post(`/api/admin/refunds/${rid}/approve`, {}, adm)).status, 409, 'approving twice is refused');
  assert.equal((await runSweeps(h.cfg)).refundsProcessed, 1);
  const done = one<{ status: string; amount_paise: number; approved_by: string; rp_refund_id: string }>('SELECT status, amount_paise, approved_by, rp_refund_id FROM refunds WHERE id = ?', rid)!;
  assert.equal(done.status, 'done'); assert.equal(done.amount_paise, 50000); assert.ok(done.rp_refund_id);
  assert.equal(one<{ refunded_paise: number }>('SELECT refunded_paise FROM payments WHERE id = ?', payId)!.refunded_paise, 50000);
  // the provider's own "processed" message afterwards changes nothing
  const wh = await sendWebhook(h, { event: 'refund.processed', payload: { refund: { entity: { id: done.rp_refund_id, payment_id: 'x', amount: 50000 } } } }, { eventId: 'evt_rp1' });
  assert.equal(wh.body.outcome, 'refund_done');
  assert.equal(one<{ n: number }>('SELECT COUNT(*) n FROM refunds')!.n, 1);
  // a refund beyond what is left on the payment is refused, and refunds cannot be asked twice for the same money
  const paid = one<{ amount_paise: number; refunded_paise: number }>('SELECT amount_paise, refunded_paise FROM payments WHERE id = ?', payId)!;
  const tooMuch = await h.post(`/api/staff/payments/${payId}/refund`, { amountPaise: paid.amount_paise - paid.refunded_paise + 100, reason: 'more than there is' }, staff);
  assert.equal(tooMuch.status, 409); assert.equal(tooMuch.body.error.code, 'REFUND_TOO_LARGE');
  // refunding without permission
  const noRef = await h.post('/api/staff/team', { name: 'No Refund', email: 'norefund@x.test', password: 'Member@12345', permissions: ['manage_bookings'] }, owner);
  assert.equal(noRef.status, 201);
  const nrTok = (await h.post('/api/auth/login', { email: 'norefund@x.test', password: 'Member@12345' })).body.token;
  assert.equal((await h.post(`/api/staff/payments/${payId}/refund`, { amountPaise: 100, reason: 'no right to ask' }, nrTok)).status, 403);
  ev('refundId', rid); ev('finalStatus', done.status); ev('refundedPaise', 50000);
});

// ------------------------------------------------------------------ REL-PAY-008 lives in rel-audit-idem.test.ts

// ------------------------------------------------------------------ REL-PAY-009

rel('REL-PAY-009', 'a part payment does not confirm the booking; the rest does, and the total is never counted twice', async () => {
  setting({ razorpayEnabled: false });
  const r = await hold(h, cust, g.id, dayFromNow(3), '19:00');
  const bid = r.body.booking.id, adv = r.body.booking.advancePaise;
  const sub = await h.post(`/api/bookings/${bid}/upi-reference`, { utr: UTR(9) }, cust);
  const half = Math.floor(adv / 2);
  const v = await h.post(`/api/staff/payments/${sub.body.payment.id}/verify`, { approve: true, receivedPaise: half }, staff);
  assert.equal(v.status, 200); assert.equal(v.body.outcome, 'partial');
  assert.deepEqual({ ...bookingRow(bid) }, { status: 'held', paid_paise: half, needs_review: 0, total_paise: r.body.booking.totalPaise });
  const rest = await h.post(`/api/staff/bookings/${bid}/payments`, { method: 'cash', amountPaise: adv - half }, staff);
  assert.equal(rest.status, 201, JSON.stringify(rest.body));
  assert.equal(bookingRow(bid).status, 'confirmed'); assert.equal(bookingRow(bid).paid_paise, adv);
  // the balance is paid later, in two parts; the booking never shows more paid than its total
  const bal = r.body.booking.totalPaise - adv;
  assert.equal((await h.post(`/api/staff/bookings/${bid}/payments`, { method: 'cash', amountPaise: Math.floor(bal / 2) }, staff)).status, 201);
  assert.equal((await h.post(`/api/staff/bookings/${bid}/payments`, { method: 'cash', amountPaise: bal - Math.floor(bal / 2) }, staff)).status, 201);
  const end = bookingRow(bid);
  assert.equal(end.paid_paise, end.total_paise);
  const sum = one<{ s: number }>("SELECT COALESCE(SUM(amount_paise),0) s FROM payments WHERE booking_id = ? AND status = 'captured'", bid)!.s;
  assert.equal(sum, end.paid_paise, 'the payments add up to what the booking shows');
  ev('partialOutcome', v.body.outcome); ev('totalPaise', end.total_paise);
});

// ------------------------------------------------------------------ REL-PAY-010

rel('REL-PAY-010', 'money beyond what is owed is refused at the desk, and returned when it arrives online after the booking was already paid; nothing sits unapplied', async () => {
  const r = await hold(h, cust, g.id, dayFromNow(3), '19:00');
  const bid = r.body.booking.id, orderId = r.body.payment.razorpay!.orderId, total = r.body.booking.totalPaise;
  assert.equal((await h.post(`/api/staff/bookings/${bid}/payments`, { method: 'cash', amountPaise: total + 1 }, staff)).body.error.code, 'OVERPAYMENT');
  assert.equal((await h.post(`/api/staff/bookings/${bid}/payments`, { method: 'cash', amountPaise: total }, staff)).status, 201);
  assert.equal(bookingRow(bid).status, 'confirmed');
  // the customer\'s online payment for the same hold lands afterwards
  const w = await sendWebhook(h, capturedEvent(orderId, r.body.booking.advancePaise, 'pay_over'), { eventId: 'evt_over' });
  assert.ok(['extra_refunded', 'paid_extra'].includes(w.body.outcome), w.body.outcome);
  const end = bookingRow(bid);
  assert.equal(end.paid_paise, total, 'the booking is not over-paid');
  const refunded = one<{ s: number }>('SELECT COALESCE(SUM(amount_paise),0) s FROM refunds WHERE booking_id = ?', bid)!.s;
  assert.equal(refunded, r.body.booking.advancePaise, 'the whole extra payment goes back');
  const received = one<{ s: number }>("SELECT COALESCE(SUM(amount_paise),0) s FROM payments WHERE booking_id = ? AND status IN ('captured','partially_refunded','refunded')", bid)!.s;
  assert.equal(received - refunded, total, 'received minus returned equals what the booking is worth');
  ev('receivedPaise', received); ev('returnedPaise', refunded); ev('keptPaise', received - refunded);
});

// ------------------------------------------------------------------ REL-PAY-011

rel('REL-PAY-011', 'the provider reversing money after confirmation (a refund made in its dashboard, a lost dispute) reaches the books as a controlled reversal and flags the booking', async () => {
  const b = await bookAndPay(h, cust, g.id, dayFromNow(4), '19:00', 1);
  const p = one<{ id: string; rp_payment_id: string; amount_paise: number }>('SELECT id, rp_payment_id, amount_paise FROM payments WHERE booking_id = ?', b.id)!;
  assert.ok(p.rp_payment_id);
  const before = one<{ status: string }>('SELECT status FROM payments WHERE id = ?', p.id)!;
  assert.equal(before.status, 'captured');
  // a refund made at the provider that Daji never started
  const first = await sendWebhook(h, { event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_dash_1', payment_id: p.rp_payment_id, amount: 30000 } } } }, { eventId: 'evt_dash_1' });
  assert.equal(first.status, 200); assert.equal(first.body.outcome, 'provider_refund_recorded');
  const rf = one<{ amount_paise: number; status: string; on_booking: number; approved_by: string }>("SELECT amount_paise, status, on_booking, approved_by FROM refunds WHERE rp_refund_id = 'rfnd_dash_1'")!;
  assert.deepEqual({ ...rf }, { amount_paise: 30000, status: 'done', on_booking: 0, approved_by: 'provider' });
  assert.equal(bookingRow(b.id).needs_review, 1, 'staff are told');
  assert.equal(one<{ refunded_paise: number; status: string }>('SELECT refunded_paise, status FROM payments WHERE id = ?', p.id)!.refunded_paise, 30000);
  // the same message again (new event id) changes nothing
  const again = await sendWebhook(h, { event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_dash_1', payment_id: p.rp_payment_id, amount: 30000 } } } }, { eventId: 'evt_dash_1b' });
  assert.equal(again.body.outcome, 'refund_done');
  assert.equal(one<{ n: number }>("SELECT COUNT(*) n FROM refunds WHERE rp_refund_id = 'rfnd_dash_1'")!.n, 1);
  // a refund Daji itself started, whose provider id is not saved yet, is NOT mistaken for a dashboard refund
  const own = await h.post(`/api/staff/payments/${p.id}/refund`, { amountPaise: 10000, reason: 'our own pending refund' }, staff);
  assert.equal(own.status, 201);
  const race = await sendWebhook(h, { event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_ours', payment_id: p.rp_payment_id, amount: 10000 } } } }, { eventId: 'evt_race' });
  assert.equal(race.status, 404, 'asked to deliver again');
  // a dispute: noted and flagged while open, reversed in the books only when lost
  const d1 = await sendWebhook(h, { event: 'payment.dispute.created', payload: { dispute: { entity: { id: 'disp_1', payment_id: p.rp_payment_id, amount: 20000, reason_code: 'fraudulent' } } } }, { eventId: 'evt_d1' });
  assert.equal(d1.body.outcome, 'dispute_created');
  assert.equal(one<{ refunded_paise: number }>('SELECT refunded_paise FROM payments WHERE id = ?', p.id)!.refunded_paise, 40000, 'nothing reversed yet (30,000 from the provider refund and 10,000 pending of ours)');
  const lost = await sendWebhook(h, { event: 'payment.dispute.lost', payload: { dispute: { entity: { id: 'disp_1', payment_id: p.rp_payment_id, amount: 20000 } } } }, { eventId: 'evt_d2' });
  assert.equal(lost.body.outcome, 'dispute_lost');
  assert.equal(one<{ refunded_paise: number }>('SELECT refunded_paise FROM payments WHERE id = ?', p.id)!.refunded_paise, 60000);
  const lostAgain = await sendWebhook(h, { event: 'payment.dispute.lost', payload: { dispute: { entity: { id: 'disp_1', payment_id: p.rp_payment_id, amount: 20000 } } } }, { eventId: 'evt_d3' });
  assert.equal(lostAgain.body.outcome, 'dispute_lost');
  assert.equal(one<{ refunded_paise: number }>('SELECT refunded_paise FROM payments WHERE id = ?', p.id)!.refunded_paise, 60000, 'a repeated message reverses once');
  // history stays whole: the original capture event is still there, and it cannot be edited
  const events = many<{ event: string }>('SELECT event FROM payment_events WHERE payment_id = ? ORDER BY at, rowid', p.id).map((e) => e.event);
  assert.ok(events.some((e) => e.startsWith('captured')), events.join(','));
  assert.ok(events.includes('dispute.created') && events.includes('dispute.lost') && events.includes('refund.provider_initiated'));
  assert.throws(() => run('DELETE FROM payment_events WHERE payment_id = ?', p.id), /append-only/);
  // events that are not ours at all are acknowledged without effect
  const stranger = await sendWebhook(h, { event: 'payment.dispute.created', payload: { dispute: { entity: { id: 'disp_x', payment_id: 'pay_not_ours', amount: 1 } } } }, { eventId: 'evt_d4' });
  assert.equal(stranger.status, 404);
  ev('providerRefundPaise', 30000); ev('disputeLostPaise', 20000); ev('paymentEvents', events);
});
