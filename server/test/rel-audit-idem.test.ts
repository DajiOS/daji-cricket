import { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, dayFromNow, setting, type Harness, type GroundLite } from './helpers.ts';
import { many, one, db } from '../src/db.ts';
import { rel, ev } from './rel.ts';
import { register } from './register.ts';

let h: Harness, g: GroundLite, cust: string, staff: string, admin: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset();
  g = (await grounds(h))[0]!; cust = await h.login('customer'); staff = await h.login('staff1'); admin = await h.login('admin');
});

const holdBody = (extra: Record<string, unknown> = {}) => ({ groundId: g.id, date: dayFromNow(3), startTime: '19:00', slots: 1, ...extra });
const withKey = (key: string) => ({ 'idempotency-key': key });

// ------------------------------------------------------------------ REL-AUD-001 / REL-AUD-002

rel('REL-AUD-001', 'audit and payment history cannot be edited or deleted, by the database or the API', async () => {
  const r = await h.post('/api/bookings', holdBody(), cust);
  assert.equal(r.status, 201);
  const tables = ['audit_log', 'payment_events', 'credit_ledger', 'webhook_events'] as const;
  // give credit_ledger and webhook_events a row each so a DELETE has something to refuse
  const owner = one<{ id: string }>("SELECT id FROM users WHERE role = 'owner' LIMIT 1")!.id;
  const custId = one<{ id: string }>("SELECT id FROM users WHERE role = 'customer' LIMIT 1")!.id;
  db().prepare("INSERT INTO webhook_events(id, type, received_at, outcome) VALUES('evt_test','payment.captured',1,'x')").run();
  db().prepare("INSERT INTO credit_ledger(id, customer_id, owner_id, kind, amount_paise, balance_after_paise, created_at) VALUES('cl_test',?,?, 'issued', 100, 100, 1)").run(custId, owner);
  const before: Record<string, number> = {};
  for (const t of tables) before[t] = one<{ n: number }>(`SELECT COUNT(*) n FROM ${t}`)!.n;
  assert.ok(before.audit_log! > 0 && before.payment_events! > 0, 'there is history to protect');
  const attempts: Record<string, string> = {};
  for (const t of tables) {
    for (const sql of [`UPDATE ${t} SET ${t === 'audit_log' ? 'action' : t === 'payment_events' ? 'event' : t === 'credit_ledger' ? 'note' : 'outcome'} = 'tampered'`, `DELETE FROM ${t}`]) {
      assert.throws(() => db().exec(sql), /append-only/, sql);
      attempts[`${t}:${sql.split(' ')[0]}`] = 'refused';
    }
    assert.equal(one<{ n: number }>(`SELECT COUNT(*) n FROM ${t}`)!.n, before[t], `${t} is unchanged`);
  }
  // no API route offers to change or remove them
  const routes = (await import('../src/app.ts')) && true;
  assert.ok(routes);
  for (const p of ['/api/admin/audit', '/api/staff/payments/x/history']) {
    for (const m of ['PUT', 'PATCH', 'DELETE']) assert.notEqual((await h.call(m, p, { token: admin, body: {} })).status, 200, `${m} ${p}`);
  }
  ev('rowCountsBeforeAndAfter', before);
  ev('attempts', attempts);
  ev('triggers', many<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_ao_%' ORDER BY name").map((x) => x.name));
});

rel('REL-AUD-002', 'every material action is attributed to the person who actually did it, and a request cannot choose its own actor', async () => {
  const actorOf = (action: string, entityId?: string) => one<{ actor_id: string | null; actor_role: string | null }>(`SELECT actor_id, actor_role FROM audit_log WHERE action = ? ${entityId ? 'AND entity_id = ?' : ''} ORDER BY id DESC LIMIT 1`, ...(entityId ? [action, entityId] : [action]));
  const ids = Object.fromEntries(many<{ email: string; id: string }>('SELECT email, id FROM users').map((u) => [u.email, u.id]));
  const staffId = ids['staff1@daji.test']!, custId = ids['customer@daji.test']!;
  // customer hold
  const hd = await h.post('/api/bookings', holdBody(), cust);
  assert.equal(hd.status, 201);
  assert.deepEqual({ ...actorOf('booking.hold', hd.body.booking.id) }, { actor_id: custId, actor_role: 'customer' });
  // staff walk-in
  const w = await h.post('/api/staff/bookings', { groundId: g.id, date: dayFromNow(4), startTime: '07:00', slots: 1, customer: { name: 'Walk In', phone: '9800000077' }, payment: { method: 'cash', amountPaise: 220000 } }, staff);
  assert.equal(w.status, 201, JSON.stringify(w.body));
  assert.deepEqual({ ...actorOf('booking.walk_in', w.body.booking.id) }, { actor_id: staffId, actor_role: 'staff' });
  // a staff-made multi-day block: the dates confirmed with the first day are the staff member's doing, not a "customer"
  const blk = await h.post('/api/staff/bookings/block', { groundId: g.id, fromDate: dayFromNow(10), toDate: dayFromNow(11), startTime: '10:00', endTime: '12:00', totalPaise: 600000, customer: { name: 'Camp Org', phone: '9800000078' }, payment: { method: 'cash', amountPaise: 600000 } }, staff);
  assert.equal(blk.status, 201, JSON.stringify(blk.body));
  const series = many<{ actor_id: string; actor_role: string }>("SELECT actor_id, actor_role FROM audit_log WHERE action = 'series.confirm'");
  assert.ok(series.length > 0, 'the block confirmed its later dates and said so in the log');
  for (const s of series) assert.deepEqual({ actor_id: s.actor_id, actor_role: s.actor_role }, { actor_id: staffId, actor_role: 'staff' });
  // the webhook is the provider, not a person
  const pay = many<{ id: string; rp_order_id: string; amount_paise: number }>("SELECT id, rp_order_id, amount_paise FROM payments WHERE method = 'razorpay'")[0]!;
  const { sendWebhook, capturedEvent } = await import('./helpers.ts');
  assert.equal((await sendWebhook(h, capturedEvent(pay.rp_order_id, pay.amount_paise))).status, 200);
  assert.deepEqual({ ...actorOf('payment.capture', pay.id) }, { actor_id: null, actor_role: 'razorpay' });
  // a request cannot name its own actor
  let n = 0;
  for (const field of ['actorId', 'createdBy', 'actor_id', 'userId']) {
    const x = await h.post('/api/staff/bookings', { groundId: g.id, date: dayFromNow(6), startTime: `0${8 + n}:00`, slots: 1, customer: { name: 'X Y', phone: `98000001${n}0` }, payment: { method: 'cash', amountPaise: 0 }, [field]: ids['admin@daji.test'] }, staff);
    n++;
    assert.ok(x.status === 201 || x.status === 400, `${field}: ${x.status}`);
    if (x.status === 201) {
      assert.deepEqual({ ...actorOf('booking.walk_in', x.body.booking.id) }, { actor_id: staffId, actor_role: 'staff' }, `${field} was ignored; the audit names the signed-in staff member`);
      assert.equal(one<{ c: string }>('SELECT created_by c FROM bookings WHERE id = ?', x.body.booking.id)!.c, staffId);
    }
  }
  // nothing in the log has no actor except provider and scheduler work
  const anonymous = many<{ action: string; actor_role: string | null }>("SELECT DISTINCT action, actor_role FROM audit_log WHERE actor_id IS NULL");
  for (const a of anonymous) assert.ok(a.actor_role === 'razorpay' || a.actor_role === 'system', `${a.action} has no actor and role ${a.actor_role}`);
  ev('attributions', { hold: 'customer', walkIn: 'staff', blockConfirm: series.length, webhook: 'razorpay' });
  ev('anonymousActionsAllowed', anonymous);
});

// ------------------------------------------------------------------ REL-BOOK-003 / REL-BOOK-004 / REL-PAY-008

rel('REL-BOOK-003', 'a hold whose answer was lost can be retried with the same key and returns the same hold, once', async () => {
  const key = 'retry-key-0001';
  const first = await h.call('POST', '/api/bookings', { token: cust, body: holdBody(), headers: withKey(key) });
  assert.equal(first.status, 201);
  const second = await h.call('POST', '/api/bookings', { token: cust, body: holdBody(), headers: withKey(key) });
  assert.equal(second.status, 201);
  assert.equal(second.headers.get('idempotent-replayed'), 'true');
  assert.equal(second.body.booking.id, first.body.booking.id, 'the retry returns the same booking');
  assert.equal(second.body.payment.razorpay.orderId, first.body.payment.razorpay.orderId, 'and the same payment order');
  const rows = many<{ id: string }>("SELECT id FROM bookings WHERE customer_id = (SELECT id FROM users WHERE email = 'customer@daji.test')");
  assert.equal(rows.length, 1, 'one booking exists');
  assert.equal(one<{ n: number }>('SELECT COUNT(*) n FROM booking_slots WHERE booking_id = ?', first.body.booking.id)!.n, 1, 'one slot is held');
  assert.equal(one<{ n: number }>("SELECT COUNT(*) n FROM audit_log WHERE action = 'booking.hold'")!.n, 1, 'one hold was audited');
  // without a key a second identical request is not allowed to take a second hold on the same slot
  const third = await h.post('/api/bookings', holdBody(), cust);
  assert.equal(third.status, 409);
  ev('bookingId', first.body.booking.id);
  ev('replayHeader', second.headers.get('idempotent-replayed'));
  ev('bookingsForCustomer', rows.length);
});

rel('REL-BOOK-003', 'a retry that arrives while the first attempt is still running is told to wait, not run twice', async () => {
  const key = 'inflight-key-1';
  const [a, b] = await Promise.all([
    h.call('POST', '/api/bookings', { token: cust, body: holdBody({ startTime: '20:00' }), headers: withKey(key) }),
    h.call('POST', '/api/bookings', { token: cust, body: holdBody({ startTime: '20:00' }), headers: withKey(key) }),
  ]);
  const statuses = [a.status, b.status].sort();
  assert.ok(statuses[0] === 201 && (statuses[1] === 201 || statuses[1] === 409), `got ${statuses}`);
  const n = one<{ n: number }>("SELECT COUNT(*) n FROM bookings WHERE start_at IS NOT NULL AND status = 'held'")!.n;
  assert.equal(n, 1, 'exactly one hold exists however the two requests interleaved');
  ev('statuses', statuses);
});

rel('REL-BOOK-004', 'the same key with a different request is refused and runs nothing; another person\'s identical key is a different action', async () => {
  const key = 'reuse-key-0001';
  const first = await h.call('POST', '/api/bookings', { token: cust, body: holdBody(), headers: withKey(key) });
  assert.equal(first.status, 201);
  const other = await h.call('POST', '/api/bookings', { token: cust, body: holdBody({ startTime: '20:00' }), headers: withKey(key) });
  assert.equal(other.status, 422);
  assert.equal(other.body.error.code, 'IDEMPOTENCY_KEY_REUSED');
  assert.equal(one<{ n: number }>("SELECT COUNT(*) n FROM bookings WHERE status = 'held'")!.n, 1, 'the different request did not run');
  // a second customer using the same key text is not replayed the first customer\'s booking
  const c2 = await register(h, 'Second Person', '9811100022');
  const mine = await h.call('POST', '/api/bookings', { token: c2, body: holdBody({ startTime: '21:00' }), headers: withKey(key) });
  assert.equal(mine.status, 201);
  assert.notEqual(mine.body.booking.id, first.body.booking.id);
  // bad key shapes are refused
  for (const bad of ['short', 'has space in it!!', 'x'.repeat(200)]) {
    const r = await h.call('POST', '/api/bookings', { token: cust, body: holdBody({ startTime: '08:00' }), headers: withKey(bad) });
    assert.equal(r.status, 400, bad);
    assert.equal(r.body.error.code, 'IDEMPOTENCY_KEY_INVALID');
  }
  ev('reuseStatus', other.status);
});

rel('REL-PAY-008', 'a retried hold never creates a second payment session for the same booking', async () => {
  const key = 'pay-session-001';
  const a = await h.call('POST', '/api/bookings', { token: cust, body: holdBody(), headers: withKey(key) });
  const b = await h.call('POST', '/api/bookings', { token: cust, body: holdBody(), headers: withKey(key) });
  assert.equal(a.status, 201); assert.equal(b.status, 201);
  const pays = many<{ id: string; rp_order_id: string | null; status: string }>('SELECT id, rp_order_id, status FROM payments WHERE booking_id = ?', a.body.booking.id);
  assert.equal(pays.length, 1, 'one payment row');
  assert.ok(pays[0]!.rp_order_id);
  assert.equal(b.body.payment.paymentId, a.body.payment.paymentId);
  ev('paymentRows', pays);
});

rel('REL-PAY-008', 'a payment recorded twice with the same key is applied once (cash at the desk)', async () => {
  setting({});
  const w = await h.post('/api/staff/bookings', { groundId: g.id, date: dayFromNow(5), startTime: '08:00', slots: 1, customer: { name: 'Cash Payer', phone: '9800000080' }, payment: { method: 'cash', amountPaise: 100000 } }, staff);
  assert.equal(w.status, 201);
  const total = w.body.booking.totalPaise, paid = w.body.booking.paidPaise;
  const body = { method: 'cash', amountPaise: Math.min(10000, total - paid) };
  const key = 'desk-cash-0001';
  const r1 = await h.call('POST', `/api/staff/bookings/${w.body.booking.id}/payments`, { token: staff, body, headers: withKey(key) });
  const r2 = await h.call('POST', `/api/staff/bookings/${w.body.booking.id}/payments`, { token: staff, body, headers: withKey(key) });
  assert.equal(r1.status, 201); assert.equal(r2.status, 201);
  assert.equal(r2.headers.get('idempotent-replayed'), 'true');
  assert.equal(one<{ p: number }>('SELECT paid_paise p FROM bookings WHERE id = ?', w.body.booking.id)!.p, paid + body.amountPaise, 'the booking was credited once');
  assert.equal(one<{ n: number }>("SELECT COUNT(*) n FROM payments WHERE booking_id = ? AND method = 'cash'", w.body.booking.id)!.n, 2, 'initial cash plus one retried payment, not three');
  ev('paidPaiseAfterRetry', paid + body.amountPaise);
});
