import { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, hold, bookAndPay, dayFromNow, advance, MIN, setting, type Harness, type GroundLite } from './helpers.ts';
import { many, one } from '../src/db.ts';
import { register } from './register.ts';
import { rel, ev } from './rel.ts';

let h: Harness, g: GroundLite, cust: string, staff: string, owner: string, adm: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => { h.reset(); g = (await grounds(h))[0]!; cust = await h.login('customer'); staff = await h.login('staff1'); owner = await h.login('owner1'); adm = await h.login('admin'); });

const options = (token: string, body: Record<string, unknown>) => h.post('/api/guppi/options', body, token);
const gHold = (token: string, body: Record<string, unknown>, key = body.actionId as string) => h.call('POST', '/api/guppi/hold', { token, body, headers: key ? { 'idempotency-key': key } : {} });
const gMove = (token: string, body: Record<string, unknown>, key = body.actionId as string) => h.call('POST', '/api/guppi/reschedule', { token, body, headers: key ? { 'idempotency-key': key } : {} });
const bookings = () => one<{ n: number }>('SELECT COUNT(*) n FROM bookings')!.n;
const freshOption = async (token: string, date: string, time: string, slots = 1) => {
  const r = await options(token, { groundId: g.id, date, startTime: time, slots });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.exact.optionId as string;
};

// ------------------------------------------------------------------ REL-CH-001

rel('REL-CH-001', 'every way in applies the same booking rules: the website, Guppi and the staff desk refuse the same bad request with the same meaning', async () => {
  const closedDay = dayFromNow(8);
  await h.post('/api/admin/closed-dates', { dates: [closedDay], closed: true, scopes: ['ground'], reason: 'maintenance' }, adm);
  const taker = await register(h, 'Slot Owner', '9866600001');
  await hold(h, taker, g.id, dayFromNow(3), '19:00');
  const cases: [string, Record<string, unknown>, number, string][] = [
    ['a slot someone else holds', { groundId: g.id, date: dayFromNow(3), startTime: '19:00', slots: 1 }, 409, 'SLOT_TAKEN'],
    ['a time outside opening hours', { groundId: g.id, date: dayFromNow(3), startTime: '03:00', slots: 1 }, 400, 'INVALID_SLOT'],
    ['a time already past', { groundId: g.id, date: dayFromNow(0), startTime: '06:00', slots: 1 }, 409, 'SLOT_IN_PAST'],
    ['too many hours at once', { groundId: g.id, date: dayFromNow(3), startTime: '06:00', slots: 24 }, 400, 'TOO_MANY_SLOTS'],
    ['a day switched off for online booking', { groundId: g.id, date: closedDay, startTime: '10:00', slots: 1 }, 409, 'DATE_CLOSED'],
  ];
  const seen: Record<string, string[]> = {};
  for (const [name, body, status, code] of cases) {
    const web = await h.post('/api/bookings', body, cust);
    assert.equal(web.status, status, `${name}: website ${JSON.stringify(web.body)}`); assert.equal(web.body.error.code, code, name);
    // Guppi never refuses with a different meaning: it reports the same reason as "not available" and offers nothing for that slot
    const gup = await options(cust, body);
    assert.equal(gup.status, 200, `${name}: guppi ${JSON.stringify(gup.body)}`);
    assert.equal(gup.body.exact, null, `${name}: guppi offers nothing for it`);
    assert.equal(gup.body.available, false);
    for (const a of gup.body.alternatives) { const t = await h.post('/api/bookings', { groundId: g.id, date: a.date, startTime: a.startTime, slots: a.slots }, cust); assert.ok(t.status === 201 || t.status === 409 && t.body.error.code === 'TOO_MANY_HOLDS', `${name}: every alternative Guppi offers can really be held (${t.status})`); if (t.status === 201) await h.post(`/api/bookings/${t.body.booking.id}/cancel`, {}, cust); }
    seen[name] = [web.body.error.code, gup.body.reason];
  }
  // the staff desk is held to the same slot guard
  const desk = await h.post('/api/staff/bookings', { groundId: g.id, date: dayFromNow(3), startTime: '19:00', slots: 1, customer: { name: 'Desk Person', phone: '9866600002' }, payment: { method: 'cash', amountPaise: 260000 } }, staff);
  assert.equal(desk.status, 409); assert.equal(desk.body.error.code, 'SLOT_TAKEN');
  ev('cases', seen);
});

// ------------------------------------------------------------------ REL-CH-003

rel('REL-CH-003', 'Guppi acts only on the record the person has selected, with that person\'s own rights; another person\'s record is the same "not found" as anywhere', async () => {
  const date = dayFromNow(5);
  const mine = await bookAndPay(h, cust, g.id, date, '10:00', 1);
  const other = await register(h, 'Other Customer', '9866600003');
  const theirs = await bookAndPay(h, other, g.id, date, '12:00', 1);
  const opt = await freshOption(cust, date, '15:00');
  // the selected booking must be named in the context, and be the one being changed
  const noCtx = await gMove(cust, { bookingId: mine.id, optionId: opt, actionId: 'act-move-0001' });
  assert.equal(noCtx.status, 400); assert.equal(noCtx.body.error.code, 'CONTEXT_MISMATCH');
  const wrongCtx = await gMove(cust, { bookingId: mine.id, optionId: opt, actionId: 'act-move-0002', context: { bookingId: theirs.id } });
  assert.equal(wrongCtx.status, 400); assert.equal(wrongCtx.body.error.code, 'CONTEXT_MISMATCH');
  // another customer's booking, even when it is "selected": the ordinary 404, and it did not move
  const steal = await gMove(cust, { bookingId: theirs.id, optionId: opt, actionId: 'act-move-0003', context: { bookingId: theirs.id } });
  assert.equal(steal.status, 404);
  assert.equal(one<{ start_at: number }>('SELECT start_at FROM bookings WHERE id = ?', theirs.id)!.start_at, theirs.startAt);
  // an option for another ground than the one selected is refused
  const g2 = (await grounds(h))[1];
  if (g2) assert.equal((await gHold(cust, { optionId: opt, actionId: 'act-hold-0001', context: { groundId: g2.id } })).body.error.code, 'CONTEXT_MISMATCH');
  const ctxOk = await options(cust, { groundId: g.id, date, startTime: '16:00', slots: 1, context: { groundId: g2?.id ?? 'grd_other' } });
  assert.equal(ctxOk.status, 400); assert.equal(ctxOk.body.error.code, 'CONTEXT_MISMATCH');
  // the proper move, on the selected record, works and is attributed to Guppi
  const ok = await gMove(cust, { bookingId: mine.id, optionId: opt, actionId: 'act-move-0004', context: { bookingId: mine.id } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const a = one<{ detail: string; actor_id: string }>("SELECT detail, actor_id FROM audit_log WHERE action = 'booking.reschedule' AND entity_id = ?", mine.id)!;
  assert.equal(JSON.parse(a.detail).via, 'guppi'); assert.equal(JSON.parse(a.detail).actionId, 'act-move-0004');
  assert.equal(a.actor_id, one<{ id: string }>('SELECT id FROM users WHERE email = ?', 'customer@daji.test')!.id, 'the signed-in person is the actor, not "guppi"');
  // staff get suggestions only, never an id that can start a hold, and cannot use the customer actions
  const st = await options(staff, { groundId: g.id, date, startTime: '17:00', slots: 1 });
  assert.equal(st.status, 200); assert.equal(st.body.exact.optionId, undefined);
  assert.equal((await gHold(staff, { optionId: opt, actionId: 'act-hold-0002' })).status, 403);
  assert.equal((await gMove(staff, { bookingId: mine.id, optionId: opt, actionId: 'act-move-0005', context: { bookingId: mine.id } })).status, 403);
  // a signed-out caller gets nothing
  assert.equal((await h.call('POST', '/api/guppi/options', { body: { groundId: g.id, date, startTime: '17:00', slots: 1 } })).status, 401);
  assert.equal((await h.call('GET', '/api/guppi/context', {})).status, 401);
  // the context report tells each person what Guppi can do for them, and that it decides nothing
  const c1 = await h.get('/api/guppi/context', cust), c2 = await h.get('/api/guppi/context', staff);
  assert.deepEqual(c1.body.actions, ['options', 'hold', 'reschedule', 'understand']); assert.deepEqual(c2.body.actions, ['options']); assert.equal(c1.body.authoritative, false);
  ev('actor', 'signed-in customer'); ev('staffActions', c2.body.actions);
});

// ------------------------------------------------------------------ REL-CH-004

rel('REL-CH-004', 'an action id makes Guppi\'s action happen once: retries and replays return the first answer, a different request under the same id is refused', async () => {
  const date = dayFromNow(4);
  const opt = await freshOption(cust, date, '18:00');
  const body = { optionId: opt, actionId: 'act-hold-retry-1' };
  assert.equal((await gHold(cust, body, '')).body.error.code, 'IDEMPOTENCY_KEY_REQUIRED');
  assert.equal((await gHold(cust, body, 'a-different-key-1')).body.error.code, 'ACTION_ID_MISMATCH');
  assert.equal(bookings(), 0, 'nothing happened without a matching action id');
  const results = await Promise.all([1, 2, 3, 4].map(() => gHold(cust, body)));
  const created = results.filter((r) => r.status === 201), waiting = results.filter((r) => r.status === 409);
  assert.ok(created.length >= 1 && created.length + waiting.length === 4, results.map((r) => r.status).join(','));
  const later = await gHold(cust, body);
  assert.equal(later.status, 201); assert.equal(later.headers.get('idempotent-replayed'), 'true');
  assert.equal((later.body as any).hold.id, (created[0]!.body as any).hold.id);
  assert.equal(bookings(), 1); assert.equal(one<{ n: number }>('SELECT COUNT(*) n FROM payments')!.n, 1, 'one payment session');
  assert.equal(many("SELECT 1 FROM audit_log WHERE action = 'booking.hold'").length, 1);
  // same action id, different request: refused, runs nothing
  const opt2 = await freshOption(cust, date, '19:00');
  const clash = await gHold(cust, { optionId: opt2, actionId: 'act-hold-retry-1' });
  assert.equal(clash.status, 422); assert.equal(clash.body.error.code, 'IDEMPOTENCY_KEY_REUSED');
  assert.equal(bookings(), 1);
  // a failed action leaves no trace, so the same id can be tried again
  const taker = await register(h, 'Takes It', '9866600004');
  const opt3 = await freshOption(cust, date, '12:00');
  assert.equal((await hold(h, taker, g.id, date, '12:00')).status, 201);
  const lost = await gHold(cust, { optionId: opt3, actionId: 'act-hold-fail-01' });
  assert.equal(lost.status, 409); assert.equal(lost.body.error.code, 'SLOT_TAKEN');
  const again = await gHold(cust, { optionId: opt3, actionId: 'act-hold-fail-01' });
  assert.equal(again.status, 409, 'it runs again and meets the same truth');
  // the same move twice is one move
  const confirmed = await bookAndPay(h, cust, g.id, dayFromNow(6), '10:00', 1);
  const mopt = await freshOption(cust, dayFromNow(6), '11:00');
  const m = { bookingId: confirmed.id, optionId: mopt, actionId: 'act-move-retry-1', context: { bookingId: confirmed.id } };
  const m1 = await gMove(cust, m), m2 = await gMove(cust, m);
  assert.equal(m1.status, 200); assert.equal(m2.status, 200); assert.equal(m2.headers.get('idempotent-replayed'), 'true');
  assert.equal(one<{ n: number }>("SELECT reschedule_count n FROM bookings WHERE id = ?", confirmed.id)!.n, 1);
  ev('createdOnce', bookings() >= 1); ev('replayHeader', later.headers.get('idempotent-replayed'));
});

// ------------------------------------------------------------------ REL-AI-001

rel('REL-AI-001', 'Guppi cannot choose a price, a slot or a deposit: only options the booking system issued to that person, unaltered and unexpired, can start a hold', async () => {
  const date = dayFromNow(4);
  const opt = await freshOption(cust, date, '10:00');
  const base = { optionId: opt, actionId: 'act-price-0001' };
  // no way to send a price or deposit at all
  for (const extra of [{ totalPaise: 1 }, { amountPaise: 1 }, { advancePaise: 1 }, { pricePaise: 1 }, { discountPaise: 99999 }, { startTime: '06:00' }, { groundId: g.id }, { slots: 9 }]) {
    const r = await gHold(cust, { ...base, ...extra, actionId: `act-price-${Object.keys(extra)[0]}` });
    assert.equal(r.status, 400, JSON.stringify(extra)); assert.equal(r.body.error.code, 'UNKNOWN_FIELDS');
  }
  assert.equal(bookings(), 0);
  // an invented, edited, truncated or someone else's option id
  const [b64] = opt.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(b64!, 'base64url').toString()), tp: 1 })).toString('base64url') + '.' + opt.split('.')[1];
  const other = await register(h, 'Borrower', '9866600005');
  for (const bad of [forged, 'abc.def', opt.slice(0, 20), opt + 'x', '']) {
    const r = await gHold(cust, { optionId: bad, actionId: `act-bad-${bad.length}` });
    assert.ok(r.status === 400, `${bad.slice(0, 12)}: ${r.status}`);
  }
  assert.equal((await gHold(other, { optionId: opt, actionId: 'act-borrow-001' })).body.error.code, 'OPTION_INVALID');
  assert.equal(bookings(), 0);
  // the real option books exactly the offered slot at exactly the offered price
  const offered = (await options(cust, { groundId: g.id, date, startTime: '10:00', slots: 1 })).body.exact;
  const ok = await gHold(cust, { optionId: offered.optionId, actionId: 'act-price-good1' });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal((ok.body as any).hold.totalPaise, offered.totalPaise); assert.equal((ok.body as any).hold.advancePaise, offered.advancePaise);
  // expired
  const old = await freshOption(cust, dayFromNow(5), '10:00');
  advance(11 * MIN);
  assert.equal((await gHold(cust, { optionId: old, actionId: 'act-expired-01' })).body.error.code, 'OPTION_EXPIRED');
  // a price change between offer and hold is surfaced, not absorbed
  const fresh = await freshOption(cust, dayFromNow(6), '10:00');
  await h.patch(`/api/staff/grounds/${g.id}`, { pricePaise: 250000, weekendPricePaise: 300000 }, owner);
  const drift = await gHold(cust, { optionId: fresh, actionId: 'act-drift-0001' });
  assert.equal(drift.status, 409); assert.equal(drift.body.error.code, 'OPTION_PRICE_CHANGED');
  ev('rejectedPriceFields', 8); ev('rejectedOptionIds', 6);
});

// ------------------------------------------------------------------ REL-AI-002

rel('REL-AI-002', 'Guppi has no way to pay, confirm, refund, waive, approve or cancel: no such route exists, and its hold stops at the secure payment hand-off', async () => {
  const date = dayFromNow(4);
  const opt = await freshOption(cust, date, '17:00');
  const r = await gHold(cust, { optionId: opt, actionId: 'act-handoff-01' });
  assert.equal(r.status, 201);
  const body = r.body as any;
  assert.equal(body.hold.status, 'held', 'a Guppi hold is only a hold');
  assert.equal(body.handoff.kind, 'secure_payment'); assert.equal(body.handoff.bookingId, body.hold.id); assert.equal(body.handoff.amountPaise, body.hold.advancePaise);
  const flat = JSON.stringify(body);
  for (const secret of ['orderId', 'keyId', 'razorpay', 'upiId', 'upi://', 'signature']) assert.ok(!flat.includes(secret), `the reply carries no payment detail (${secret})`);
  assert.equal(one<{ paid_paise: number }>('SELECT paid_paise FROM bookings WHERE id = ?', body.hold.id)!.paid_paise, 0);
  // the payment screen reads the payment from the system itself, as the signed-in person, and only for their own booking
  const pay = await h.get(`/api/bookings/${body.hold.id}/payment-instructions`, cust);
  assert.equal(pay.status, 200); assert.equal(pay.body.payment.mode, 'razorpay'); assert.equal(pay.body.payment.amountPaise, body.hold.advancePaise);
  assert.equal(one<{ n: number }>('SELECT COUNT(*) n FROM payments')!.n, 1, 'reading it created no second session');
  const stranger = await register(h, 'Not Mine', '9866600006');
  assert.equal((await h.get(`/api/bookings/${body.hold.id}/payment-instructions`, stranger)).status, 404);
  // there is nothing under /api/guppi that moves money or approves anything
  for (const [m, p] of [['POST', '/api/guppi/pay'], ['POST', '/api/guppi/confirm'], ['POST', '/api/guppi/refund'], ['POST', '/api/guppi/cancel'], ['POST', '/api/guppi/waive'], ['POST', '/api/guppi/approve'], ['POST', '/api/guppi/verify'], ['POST', '/api/guppi/payment'], ['POST', '/api/guppi/credit'], ['PUT', '/api/guppi/hold'], ['GET', '/api/guppi/hold']] as const) {
    const x = await h.call(m, p, { token: cust, body: m === 'GET' ? undefined : { bookingId: body.hold.id, actionId: 'act-nothing-01' }, headers: { 'idempotency-key': 'act-nothing-01' } });
    assert.ok(x.status === 404 || x.status === 405, `${m} ${p} -> ${x.status}`);
  }
  assert.equal(one<{ status: string }>('SELECT status FROM bookings WHERE id = ?', body.hold.id)!.status, 'held');
  // it cannot move a booking onto a payment or approval either: a cheaper move is settled by the approved Daji credit path, never a silent refund (UD-03)
  const paid = await bookAndPay(h, cust, g.id, dayFromNow(7), '19:00', 1);
  await h.post(`/api/staff/bookings/${paid.id}/payments`, { method: 'cash', amountPaise: paid.totalPaise - paid.paidPaise }, staff);
  const cheap = await freshOption(cust, dayFromNow(7), '09:00');
  const mv = await gMove(cust, { bookingId: paid.id, optionId: cheap, actionId: 'act-cheaper-01', context: { bookingId: paid.id } });
  assert.equal(mv.status, 200); assert.equal(mv.body.settlement.treatment, 'credit');
  assert.equal(one<{ n: number }>('SELECT COUNT(*) n FROM refunds')!.n, 0);
  // every Guppi write names Guppi in the audit trail
  assert.equal(JSON.parse(one<{ detail: string }>("SELECT detail FROM audit_log WHERE action = 'booking.hold' AND entity_id = ?", body.hold.id)!.detail).via, 'guppi');
  ev('routesProbed', 11); ev('handoff', body.handoff);
});

// ------------------------------------------------------------------ REL-AI-003

rel('REL-AI-003', 'when Guppi is switched off or its model is down, the normal booking, payment and change flows work exactly as before', async () => {
  setting({ guppiAssistEnabled: false });
  const date = dayFromNow(4);
  const o = await options(cust, { groundId: g.id, date, startTime: '10:00', slots: 1 });
  assert.equal(o.status, 503); assert.equal(o.body.error.code, 'FEATURE_OFF');
  assert.equal((await gHold(cust, { optionId: 'x'.repeat(30), actionId: 'act-off-00001' })).body.error.code, 'FEATURE_OFF');
  assert.equal((await h.get('/api/guppi/context', cust)).body.enabled, false);
  // the standard flow, start to finish, with Guppi off
  const b = await bookAndPay(h, cust, g.id, date, '10:00', 1);
  assert.equal(b.status, 'confirmed');
  const std = await h.post('/api/availability/options', { groundId: g.id, date, startTime: '11:00', slots: 1 }, cust);
  assert.equal(std.status, 200, 'the standard options are not Guppi');
  assert.equal((await h.post(`/api/bookings/${b.id}/reschedule`, { optionId: std.body.exact.optionId }, cust)).status, 200);
  assert.equal((await h.post(`/api/bookings/${b.id}/cancel`, { reason: 'plans changed' }, cust)).status, 200);
  assert.equal((await h.get('/api/bookings', cust)).status, 200);
  // the question box keeps working when the AI provider is not configured (built-in answers)
  const ask = await h.post('/api/ask', { question: 'How much credit do I have?' }, cust);
  assert.equal(ask.status, 200); assert.equal(ask.body.source, 'builtin');
  // switch Guppi back on: it works again; switching the reschedule release switch off stops only that
  setting({ guppiAssistEnabled: true });
  assert.equal((await options(cust, { groundId: g.id, date, startTime: '10:00', slots: 1 })).status, 200);
  const b2 = await bookAndPay(h, cust, g.id, dayFromNow(6), '10:00', 1);
  setting({ customerRescheduleEnabled: false });
  const off = await h.post(`/api/bookings/${b2.id}/reschedule`, { date: dayFromNow(6), startTime: '12:00' }, cust);
  assert.equal(off.status, 503); assert.equal(off.body.error.code, 'FEATURE_OFF');
  assert.equal((await h.post(`/api/staff/bookings/${b2.id}/reschedule`, { date: dayFromNow(6), startTime: '12:00', reason: 'Ground maintenance that evening' }, staff)).status, 200, 'the ground can still move it');
  assert.equal((await h.post('/api/bookings', { groundId: g.id, date: dayFromNow(8), startTime: '10:00', slots: 1 }, cust)).status, 201, 'booking itself is untouched');
  ev('guppiOffStatuses', [o.status, ask.status]); ev('standardFlow', 'hold, pay, move, cancel all worked');
});
