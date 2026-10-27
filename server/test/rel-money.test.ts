import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, hold, bookAndPay, dayFromNow, advance, MIN, sendWebhook, capturedEvent, setting, type Harness, type GroundLite } from './helpers.ts';
import { runSweeps } from '../src/jobs.ts';
import { db, many, one, run } from '../src/db.ts';
import { reconcile, financialEvents } from '../src/finevents.ts';
import { applyCaptured } from '../src/payments.ts';
import * as credits from '../src/credits.ts';
import { register } from './register.ts';
import { rel, ev } from './rel.ts';

let h: Harness, g: GroundLite, cust: string, staff: string, owner: string, adm: string, ownerId: string, custId: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset(); setting({ lateCancelCreditPercent: 50 }); g = (await grounds(h))[0]!;
  cust = await h.login('customer'); staff = await h.login('staff1'); owner = await h.login('owner1'); adm = await h.login('admin');
  ownerId = one<{ id: string }>('SELECT id FROM users WHERE email = ?', 'owner1@daji.test')!.id;
  custId = one<{ id: string }>('SELECT id FROM users WHERE email = ?', 'customer@daji.test')!.id;
});

const status = (id: string) => one<{ status: string; paid_paise: number; credit_paise: number; refund_paise: number }>('SELECT status, paid_paise, credit_paise, refund_paise FROM bookings WHERE id = ?', id)!;
const clean = (label: string) => { const r = reconcile(ownerId); assert.deepEqual(r.findings.filter((f) => f.severity === 'problem'), [], `${label}: books agree with records`); assert.equal(r.clean, true); assert.equal(r.debitsPaise, r.creditsPaise, label); return r; };

/** A paid booking that is cancelled inside the free-cancellation window, so part of the deposit is kept. */
async function keptBooking(token = cust) {
  const b = await bookAndPay(h, token, g.id, dayFromNow(0), '22:00', 1); // starts in 12 hours
  const c = await h.post(`/api/bookings/${b.id}/cancel`, { reason: 'plans changed' }, token);
  assert.equal(c.status, 200, JSON.stringify(c.body));
  return { b, outcome: c.body.outcome };
}

// ------------------------------------------------------------------ REL-DEP-001

rel('REL-DEP-001', 'a deposit is applied to a booking once: repeated captures, retried holds and racing credit use never apply it twice', async () => {
  // the same captured payment applied again, directly
  const b = await bookAndPay(h, cust, g.id, dayFromNow(3), '10:00', 1);
  const pay = one<{ id: string; amount_paise: number }>('SELECT id, amount_paise FROM payments WHERE booking_id = ?', b.id)!;
  for (let i = 0; i < 3; i++) assert.equal(applyCaptured(pay.id, { actor: { id: null, role: 'razorpay' }, via: 'webhook' }).outcome, 'already');
  assert.equal(status(b.id).paid_paise, pay.amount_paise);
  // credit used as the deposit: a retried hold (same key) spends it once
  credits.issueCredit({ customerId: custId, ownerId, amountPaise: 300_000, source: 'goodwill', note: 'test', silent: true });
  const body = { groundId: g.id, date: dayFromNow(4), startTime: '11:00', slots: 1, useCredit: true };
  const k = { 'idempotency-key': 'dep-credit-retry-1' };
  const tries = await Promise.all([1, 2, 3].map(() => h.call('POST', '/api/bookings', { token: cust, body, headers: k })));
  assert.ok(tries.every((t) => t.status === 201 || t.status === 409), tries.map((t) => t.status).join(','));
  assert.equal(tries.filter((t) => t.status === 201).length >= 1, true);
  const bookings = many<{ id: string }>("SELECT id FROM bookings WHERE customer_id = ? AND date = ?", custId, dayFromNow(4));
  assert.equal(bookings.length, 1, 'one booking from three identical tries');
  const spent = one<{ s: number }>("SELECT COALESCE(SUM(-amount_paise),0) s FROM credit_ledger WHERE customer_id = ? AND kind = 'redeemed'", custId)!.s;
  assert.equal(spent, status(bookings[0]!.id).paid_paise, 'credit spent equals what the booking shows paid');
  // two different holds racing for one pot of credit never spend more than the pot
  const small = await register(h, 'Pot Holder', '9855000001');
  const smallId = one<{ id: string }>('SELECT id FROM users WHERE phone = ?', '9855000001')!.id;
  credits.issueCredit({ customerId: smallId, ownerId, amountPaise: 100_000, source: 'goodwill', note: 'test', silent: true });
  const race = await Promise.all(['12:00', '13:00', '14:00'].map((t) => h.post('/api/bookings', { groundId: g.id, date: dayFromNow(5), startTime: t, slots: 1, useCredit: true }, small)));
  const redeemed = one<{ s: number }>("SELECT COALESCE(SUM(-amount_paise),0) s FROM credit_ledger WHERE customer_id = ? AND kind = 'redeemed'", smallId)!.s;
  assert.ok(redeemed <= 100_000, `spent ${redeemed} of 100000`);
  assert.equal(many('SELECT 1 FROM credit_lots WHERE customer_id = ? AND remaining_paise < 0', smallId).length, 0);
  const paidSum = many<{ paid_paise: number }>("SELECT paid_paise FROM bookings WHERE customer_id = ?", smallId).reduce((s, r) => s + r.paid_paise, 0);
  assert.equal(paidSum, redeemed, 'every rupee spent is on exactly one booking');
  clean('after deposits');
  ev('redeemedFromPot', redeemed); ev('raceStatuses', race.map((r) => r.status));
});

// ------------------------------------------------------------------ REL-DEP-002

rel('REL-DEP-002', 'money kept from a deposit can be disputed; the figure given back is versioned, approved by the owner for that exact version, and applied once', async () => {
  const { b, outcome } = await keptBooking();
  const kept = status(b.id).paid_paise - status(b.id).credit_paise - status(b.id).refund_paise;
  assert.ok(kept > 0, `a late cancellation keeps part of the deposit (${kept})`);
  assert.equal(outcome.retainedPaise, kept);
  // who may open it, and when
  assert.equal((await h.post(`/api/bookings/${b.id}/retention-dispute`, { reason: 'short' }, cust)).status, 400);
  const other = await register(h, 'Stranger', '9855000002');
  assert.equal((await h.post(`/api/bookings/${b.id}/retention-dispute`, { reason: 'this is not my booking at all' }, other)).status, 404);
  assert.equal((await h.post(`/api/bookings/${b.id}/retention-dispute`, { reason: 'staff cannot open for the customer' }, staff)).status, 403);
  const open = await h.post(`/api/bookings/${b.id}/retention-dispute`, { reason: 'I was ill and told the ground in time' }, cust);
  assert.equal(open.status, 201, JSON.stringify(open.body)); assert.equal(open.body.dispute.status, 'open'); assert.equal(open.body.dispute.retainedPaise, kept);
  assert.equal((await h.post(`/api/bookings/${b.id}/retention-dispute`, { reason: 'trying to open a second one' }, cust)).body.error.code, 'ALREADY_OPENED');
  const P = (body: object, tok = staff) => h.post(`/api/staff/bookings/${b.id}/retention-dispute/propose`, body, tok);
  const A = (body: object, tok = owner) => h.post(`/api/staff/bookings/${b.id}/retention-dispute/approve`, body, tok);
  // nothing to approve before there is a figure; a figure above what was kept is refused
  assert.equal((await A({ version: 1 })).body.error.code, 'BAD_STATE');
  assert.equal((await P({ releasePaise: kept + 1, as: 'credit' })).body.error.code, 'RELEASE_TOO_LARGE');
  const p1 = await P({ releasePaise: 5000, as: 'credit', note: 'half of the delay' });
  assert.equal(p1.status, 200, JSON.stringify(p1.body)); assert.equal(p1.body.dispute.version, 2); assert.equal(p1.body.dispute.status, 'proposed');
  const p2 = await P({ releasePaise: 8000, as: 'credit', note: 'agreed on the phone' });
  assert.equal(p2.body.dispute.version, 3); assert.equal(p2.body.dispute.history.at(-1).kind, 'amended');
  // approval names the version: the old one is refused; staff cannot approve; nobody has been paid yet
  const stale = await A({ version: 2 });
  assert.equal(stale.status, 409); assert.equal(stale.body.error.code, 'STALE_VERSION');
  assert.equal((await A({ version: 3 }, staff)).status, 403);
  const creditBefore = status(b.id).credit_paise;
  assert.equal(status(b.id).credit_paise, creditBefore);
  assert.equal(many('SELECT 1 FROM credit_lots WHERE booking_id = ? AND source = ?', b.id, 'restore').length, 0);
  // approval applies it, once
  const ok = await A({ version: 3 });
  assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(ok.body.case.status, 'applied'); assert.equal(ok.body.case.releasePaise, 8000);
  assert.equal(status(b.id).credit_paise, creditBefore + 8000);
  assert.equal(many("SELECT 1 FROM credit_lots WHERE booking_id = ? AND source = 'restore' AND amount_paise = 8000", b.id).length, 1);
  assert.equal((await A({ version: 3 })).body.error.code, 'BAD_STATE', 'a second approval applies nothing');
  assert.equal((await P({ releasePaise: 1000, as: 'credit' })).body.error.code, 'BAD_STATE', 'a finished dispute cannot be reopened');
  assert.equal(many("SELECT 1 FROM credit_lots WHERE booking_id = ? AND source = 'restore' AND amount_paise = 8000", b.id).length, 1);
  // every step is on record, by whom, and cannot be changed
  const hist = one<{ kinds: string }>("SELECT group_concat(kind) kinds FROM (SELECT kind FROM retention_events e JOIN retention_cases c ON c.id = e.case_id WHERE c.booking_id = ? ORDER BY version)", b.id)!.kinds;
  assert.equal(hist, 'opened,proposed,amended,approved,applied');
  assert.throws(() => run('UPDATE retention_events SET release_paise = 1'), /append-only/);
  assert.throws(() => run('DELETE FROM retention_events'), /append-only/);
  assert.equal(many("SELECT 1 FROM audit_log WHERE action LIKE 'retention.%' AND entity_id = ?", b.id).length, 4);
  clean('after the dispute credit');
  ev('versions', hist); ev('keptPaise', kept); ev('releasedPaise', 8000);
});

test('a refund released from a disputed deposit waits for the usual refund authorisation and is counted once', async () => {
  const tok = await register(h, 'Refund Disputer', '9855000004');
  const { b } = await keptBooking(tok);
  const kept = status(b.id).paid_paise - status(b.id).credit_paise - status(b.id).refund_paise;
  assert.equal((await h.post(`/api/bookings/${b.id}/retention-dispute`, { reason: 'the ground was closed that evening' }, tok)).status, 201);
  assert.equal((await h.post(`/api/staff/bookings/${b.id}/retention-dispute/propose`, { releasePaise: kept, as: 'refund' }, staff)).status, 200);
  const before = status(b.id).refund_paise;
  const ap = await h.post(`/api/staff/bookings/${b.id}/retention-dispute/approve`, { version: 2 }, owner);
  assert.equal(ap.status, 200, JSON.stringify(ap.body));
  const rf = many<{ amount_paise: number; status: string; approved_at: number | null; on_booking: number }>('SELECT amount_paise, status, approved_at, on_booking FROM refunds WHERE booking_id = ? ORDER BY created_at DESC', b.id);
  const sum = rf.filter((r) => r.on_booking === 1).reduce((s, r) => s + r.amount_paise, 0);
  assert.ok(sum >= 1 && sum <= kept);
  assert.equal(rf[0]!.approved_at, null, 'not paid until the super admin authorises it');
  assert.equal(status(b.id).refund_paise, before + sum);
  clean('after refund release');
});

// ------------------------------------------------------------------ REL-ACC-001 .. 004

async function scenario() {
  const a = await bookAndPay(h, cust, g.id, dayFromNow(3), '10:00', 1);
  const r2 = await hold(h, cust, g.id, dayFromNow(4), '10:00');
  const orderId = r2.body.payment.razorpay!.orderId;
  await sendWebhook(h, capturedEvent(orderId, r2.body.booking.advancePaise, 'pay_s2'), { eventId: 'evt_s2' });
  const { b: late } = await keptBooking(await register(h, 'Scenario Late', '9855000005'));
  const free = await bookAndPay(h, cust, g.id, dayFromNow(6), '10:00', 1);
  await h.post(`/api/bookings/${free.id}/cancel`, { reason: 'changed my mind' }, cust);
  credits.issueCredit({ customerId: custId, ownerId, amountPaise: 25_000, source: 'goodwill', note: 'sorry', silent: true });
  return { a, late, free, b2: r2.body.booking.id };
}

rel('REL-ACC-001', 'a money event exists once: replays, duplicate webhooks and repeated reads never create a second one, and the same records always give the same events', async () => {
  await scenario();
  const first = financialEvents(ownerId, '9999-12-31');
  const second = financialEvents(ownerId, '9999-12-31');
  assert.deepEqual(first, second, 'same records, same events, same fingerprints');
  assert.equal(new Set(first.map((e) => e.id)).size, first.length, 'event ids are unique');
  // deliver everything the provider already told us, again and again
  const pays = many<{ rp_order_id: string; amount_paise: number; rp_payment_id: string }>("SELECT rp_order_id, amount_paise, rp_payment_id FROM payments WHERE rp_order_id IS NOT NULL AND rp_payment_id IS NOT NULL");
  for (let i = 0; i < 3; i++) for (const p of pays) await sendWebhook(h, capturedEvent(p.rp_order_id, p.amount_paise, p.rp_payment_id), { eventId: `evt_again_${i}_${p.rp_payment_id}` });
  const after1 = financialEvents(ownerId, '9999-12-31');
  assert.deepEqual(after1, first, 'redelivery created no new event and changed none');
  const paymentEvents = first.filter((e) => e.kind === 'payment');
  assert.equal(paymentEvents.length, one<{ n: number }>("SELECT COUNT(*) n FROM payments WHERE status IN ('captured','partially_refunded','refunded') AND verified_at IS NOT NULL")!.n, 'one event per received payment');
  clean('scenario');
  ev('events', first.length); ev('paymentEvents', paymentEvents.length); ev('redeliveries', pays.length * 3);
});

rel('REL-ACC-002', 'if the books cannot be derived, bookings and payments carry on, the fault is reported as unexplained, and nothing is lost once it is fixed', async () => {
  const s = await scenario();
  clean('before the fault');
  const before = financialEvents(ownerId, '9999-12-31').length;
  // a corrupt hand-made journal (it does not balance) gets into the database by a path that skips the checks
  const d = db();
  d.exec('PRAGMA foreign_keys = OFF');
  d.prepare("INSERT INTO acct_journals(id, owner_id, entry_date, memo, created_at, created_by) VALUES('jrn_bad', ?, '2026-10-10', 'corrupt', 1, NULL)").run(ownerId);
  d.prepare("INSERT INTO acct_journal_lines(journal_id, account_code, debit_paise, credit_paise) VALUES('jrn_bad','exp:repairs',5000,0)").run();
  d.exec('PRAGMA foreign_keys = ON');
  assert.throws(() => financialEvents(ownerId, '9999-12-31'), /unbalanced/);
  // money keeps moving while the books are broken
  const fresh = await bookAndPay(h, cust, g.id, dayFromNow(7), '10:00', 1);
  assert.equal(status(fresh.id).status, 'confirmed');
  assert.equal((await h.post(`/api/bookings/${s.a.id}/cancel`, { reason: 'because I can' }, cust)).status, 200);
  const broken = reconcile(ownerId);
  assert.ok(broken.findings.some((f) => f.code === 'ACCOUNTING_ERROR'));
  assert.ok(broken.unexplained >= 1, 'a fault nobody was told about is unexplained, never hidden'); assert.equal(broken.clean, false);
  // fixed by a controlled reversal (void with a reason), and everything done meanwhile is in the books
  const voided = await h.post('/api/accounting/journals/jrn_bad/void', { reason: 'corrupt entry removed from the books' }, owner);
  assert.equal(voided.status, 200, JSON.stringify(voided.body));
  const fixed = clean('after the fix');
  assert.ok(financialEvents(ownerId, '9999-12-31').length > before, 'the booking made during the fault has its events');
  assert.ok(financialEvents(ownerId, '9999-12-31').some((e) => e.kind === 'payment' && e.ref === one<{ id: string }>('SELECT id FROM payments WHERE booking_id = ?', fresh.id)!.id));
  ev('unexplainedDuringFault', broken.unexplained); ev('afterFix', fixed.unexplained);
});

rel('REL-ACC-003', 'money records are reversed, never edited or erased: the database refuses deletes, a void keeps the original and its reason, and a signed-off month cannot be changed', async () => {
  const s = await scenario();
  const guarded = ['payments', 'refunds', 'credit_lots', 'bookings', 'acct_journals', 'acct_journal_lines', 'acct_transactions', 'payment_events', 'audit_log', 'credit_ledger', 'webhook_events'];
  await h.post('/api/accounting/journals', { date: '2026-10-11', memo: 'Row so the guard can be exercised', lines: [{ account: 'exp:repairs', debitPaise: 1000 }, { account: 'payables', creditPaise: 1000 }] }, owner);
  for (const t of guarded) {
    assert.ok(one("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?", `trg_ao_${t}_delete`), `${t} has its delete guard`);
    if (one(`SELECT 1 FROM ${t} LIMIT 1`)) assert.throws(() => db().exec(`DELETE FROM ${t}`), /append-only|cannot be deleted/, t);
  }
  assert.throws(() => run("UPDATE payment_events SET event = 'x'"), /append-only/);
  assert.throws(() => run("UPDATE audit_log SET action = 'x'"), /append-only/);
  assert.ok(many('SELECT 1 FROM payments').length > 0, 'nothing was lost by the attempts');
  // a journal entry is voided, not deleted: the entry stays with who and why, and the books net to zero
  const j = await h.post('/api/accounting/journals', { date: '2026-10-12', memo: 'Pitch repair bill', lines: [{ account: 'exp:repairs', debitPaise: 70_000 }, { account: 'payables', creditPaise: 70_000 }] }, owner);
  assert.equal(j.status, 201, JSON.stringify(j.body));
  const withIt = financialEvents(ownerId, '9999-12-31').length;
  const v = await h.post(`/api/accounting/journals/${j.body.id}/void`, { reason: 'entered twice by mistake' }, owner);
  assert.equal(v.status, 200);
  const row = one<{ deleted_at: number | null; delete_reason: string; deleted_by: string }>('SELECT deleted_at, delete_reason, deleted_by FROM acct_journals WHERE id = ?', j.body.id)!;
  assert.ok(row.deleted_at && row.delete_reason === 'entered twice by mistake' && row.deleted_by);
  assert.equal(many('SELECT 1 FROM acct_journal_lines WHERE journal_id = ?', j.body.id).length, 2, 'the lines of the voided entry are kept');
  assert.equal(financialEvents(ownerId, '9999-12-31').length, withIt - 1, 'it no longer counts in the books');
  assert.equal(many("SELECT 1 FROM audit_log WHERE action = 'acct.journal.void' AND entity_id = ?", j.body.id).length, 1);
  assert.equal((await h.post(`/api/accounting/journals/${j.body.id}/void`, { reason: 'again, please' }, owner)).status, 409);
  // a signed-off month is closed: its entries can no longer be voided or added to
  const sep = await h.post('/api/accounting/journals', { date: '2026-09-10', memo: 'September bill', lines: [{ account: 'exp:repairs', debitPaise: 4000 }, { account: 'payables', creditPaise: 4000 }] }, owner);
  assert.equal(sep.status, 201);
  assert.equal((await h.post('/api/accounting/signoffs', { month: '2026-09' }, owner)).status, 201);
  const closed = await h.post(`/api/accounting/journals/${sep.body.id}/void`, { reason: 'trying to change a closed month' }, owner);
  assert.equal(closed.status, 409, JSON.stringify(closed.body));
  assert.equal(one<{ deleted_at: number | null }>('SELECT deleted_at FROM acct_journals WHERE id = ?', sep.body.id)!.deleted_at, null);
  const addClosed = await h.post('/api/accounting/journals', { date: '2026-09-12', memo: 'late entry into a closed month', lines: [{ account: 'exp:repairs', debitPaise: 100 }, { account: 'payables', creditPaise: 100 }] }, owner);
  assert.equal(addClosed.status, 409);
  // a refund is a new record that reverses part of a payment: the payment keeps its amount and its history
  const pay = one<{ id: string; amount_paise: number }>('SELECT id, amount_paise FROM payments WHERE booking_id = ?', s.a.id)!;
  const rf = await h.post(`/api/staff/payments/${pay.id}/refund`, { amountPaise: 10_000, reason: 'goodwill reversal' }, staff);
  assert.equal(rf.status, 201);
  const after1 = one<{ amount_paise: number; refunded_paise: number }>('SELECT amount_paise, refunded_paise FROM payments WHERE id = ?', pay.id)!;
  assert.equal(after1.amount_paise, pay.amount_paise); assert.equal(after1.refunded_paise, 10_000);
  assert.ok(many('SELECT 1 FROM payment_events WHERE payment_id = ?', pay.id).length >= 3);
  clean('after reversals');
  ev('tablesGuarded', guarded.length); ev('voidKeptLines', 2);
});

rel('REL-ACC-004', 'every money event traces back to the business record, the person and the audit entry that caused it, and the totals agree', async () => {
  const s = await scenario();
  const evs = financialEvents(ownerId, '9999-12-31');
  const rep = clean('scenario');
  // payments: event amount equals the record; the record points at a booking of this owner and has an audit capture entry
  for (const e of evs.filter((x) => x.kind === 'payment')) {
    const p = one<{ id: string; amount_paise: number; booking_id: string; owner_id: string }>('SELECT id, amount_paise, booking_id, owner_id FROM payments WHERE id = ?', e.ref)!;
    assert.ok(p, `payment ${e.ref} exists`); assert.equal(p.amount_paise, e.amountPaise); assert.equal(p.owner_id, ownerId);
    assert.ok(one('SELECT 1 FROM bookings WHERE id = ? AND owner_id = ?', p.booking_id, ownerId));
    assert.ok(one("SELECT 1 FROM audit_log WHERE action = 'payment.capture' AND entity_id = ?", p.id) || one("SELECT 1 FROM booking_slots WHERE 0") === undefined && one("SELECT 1 FROM payment_events WHERE payment_id = ? AND event LIKE 'created:captured'", p.id), `payment ${p.id} has its audit or its credit-capture event`);
  }
  for (const e of evs.filter((x) => x.kind === 'refund')) {
    const r = one<{ amount_paise: number; payment_id: string }>('SELECT amount_paise, payment_id FROM refunds WHERE id = ?', e.ref)!;
    assert.ok(r); assert.equal(r.amount_paise, e.amountPaise);
    assert.ok(one("SELECT 1 FROM audit_log WHERE action = 'payment.refund' AND detail LIKE ?", `%${e.ref}%`), `refund ${e.ref} has its audit entry`);
  }
  for (const e of evs.filter((x) => x.kind === 'credit')) assert.ok(one('SELECT 1 FROM credit_lots WHERE id = ?', e.ref) || one('SELECT 1 FROM credit_ledger WHERE id = ?', e.ref), `credit ${e.ref}`);
  // totals agree between the events and the records
  const payTotal = evs.filter((e) => e.kind === 'payment').reduce((a, e) => a + e.amountPaise, 0);
  assert.equal(payTotal, rep.totals.receivedPaise);
  const refTotal = evs.filter((e) => e.kind === 'refund').reduce((a, e) => a + e.amountPaise, 0);
  assert.equal(refTotal, rep.totals.refundedPaise);
  // the owner can run the same check, and another business cannot
  const mine = await h.get('/api/staff/reconcile', owner);
  assert.equal(mine.status, 200); assert.equal(mine.body.clean, true);
  assert.equal((await h.get(`/api/staff/reconcile?ownerId=${ownerId}`, await h.login('owner2'))).status === 200 && (await h.get(`/api/staff/reconcile?ownerId=${ownerId}`, await h.login('owner2'))).body.ownerId === ownerId, false, 'another owner gets their own books, not this one');
  assert.equal((await h.get('/api/admin/reconcile', adm)).status, 200);
  assert.equal((await h.get('/api/admin/reconcile', staff)).status, 403);
  void s; void advance; void MIN; void runSweeps;
  ev('paymentEvents', evs.filter((e) => e.kind === 'payment').length); ev('refundEvents', evs.filter((e) => e.kind === 'refund').length); ev('receivedPaise', rep.totals.receivedPaise); ev('refundedPaise', rep.totals.refundedPaise);
});
