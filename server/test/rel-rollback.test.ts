import { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { startHarness, grounds, bookAndPay, dayFromNow, setting, type Harness, type GroundLite } from './helpers.ts';
import { many, one } from '../src/db.ts';
import { reconcile, financialEvents } from '../src/finevents.ts';
import { rel, ev } from './rel.ts';

let h: Harness, g: GroundLite, cust: string, staff: string, owner: string, ownerId: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset(); setting({ lateCancelCreditPercent: 50 }); g = (await grounds(h))[0]!;
  cust = await h.login('customer'); staff = await h.login('staff1'); owner = await h.login('owner1');
  ownerId = one<{ id: string }>('SELECT id FROM users WHERE email = ?', 'owner1@daji.test')!.id;
});

const moneyHash = () => createHash('sha256').update(JSON.stringify(['payments', 'refunds', 'credit_lots', 'credit_ledger'].map((t) => many(`SELECT * FROM ${t} ORDER BY id`)))).digest('hex').slice(0, 16);
const events = () => financialEvents(ownerId, '9999-12-31');
const startOf = (id: string) => one<{ s: number }>('SELECT MIN(slot_start) s FROM booking_slots WHERE booking_id = ?', id)!.s;

rel('REL-REC-002', 'feature rollback: switching the new features off keeps everything they created, moves no money, refuses only the new customer actions, and leaves the standard flow working', async () => {
  // things made with the new features
  const moved = await bookAndPay(h, cust, g.id, dayFromNow(5), '19:00');
  const was = startOf(moved.id);
  const mv = await h.post(`/api/bookings/${moved.id}/reschedule`, { date: dayFromNow(6), startTime: '19:00' }, cust);
  assert.equal(mv.status, 200, JSON.stringify(mv.body));
  const nowAt = startOf(moved.id); assert.notEqual(nowAt, was);
  const kept = await bookAndPay(h, cust, g.id, dayFromNow(0), '22:00');
  assert.equal((await h.post(`/api/bookings/${kept.id}/cancel`, { reason: 'plans changed' }, cust)).status, 200);
  assert.equal((await h.post(`/api/bookings/${kept.id}/retention-dispute`, { reason: 'I was ill and told the ground in time' }, cust)).status, 201);
  assert.equal((await h.post(`/api/staff/bookings/${kept.id}/retention-dispute/propose`, { releasePaise: 5000, as: 'credit', note: 'agreed' }, staff)).status, 200);
  const opt = await h.post('/api/guppi/options', { groundId: g.id, date: dayFromNow(8), startTime: '10:00', slots: 1 }, cust);
  assert.equal(opt.status, 200);
  const gh = await h.call('POST', '/api/guppi/hold', { token: cust, body: { actionId: 'rollback-hold-1', optionId: opt.body.exact.optionId }, headers: { 'idempotency-key': 'rollback-hold-1' } });
  assert.equal(gh.status, 201, JSON.stringify(gh.body));
  const heldByGuppi = gh.body.handoff.bookingId as string; assert.ok(heldByGuppi);

  const before = { money: moneyHash(), events: events().map((e) => `${e.id}:${e.fingerprint}`), moves: one<{ n: number }>('SELECT COUNT(*) n FROM booking_reschedules')!.n, cases: one<{ n: number }>('SELECT COUNT(*) n FROM retention_cases')!.n };
  assert.equal(before.moves, 1); assert.equal(before.cases, 1);

  // ROLL BACK: all three switches off
  setting({ guppiAssistEnabled: false, customerRescheduleEnabled: false, retentionDisputesEnabled: false });
  const refusals = {
    guppiOptions: (await h.post('/api/guppi/options', { groundId: g.id, date: dayFromNow(8), startTime: '11:00', slots: 1 }, cust)).status,
    guppiHold: (await h.call('POST', '/api/guppi/hold', { token: cust, body: { actionId: 'rollback-hold-2', optionId: opt.body.exact.optionId }, headers: { 'idempotency-key': 'rollback-hold-2' } })).status,
    customerMove: (await h.post(`/api/bookings/${moved.id}/reschedule`, { date: dayFromNow(7), startTime: '19:00' }, cust)).status,
    newDispute: (await h.post(`/api/bookings/${moved.id}/retention-dispute`, { reason: 'a brand new dispute to open now' }, cust)).status,
  };
  assert.deepEqual(Object.values(refusals), [503, 503, 503, 503], JSON.stringify(refusals));
  // nothing the features made was lost or changed, and no money moved
  assert.equal(startOf(moved.id), nowAt, 'the moved booking stays where it was moved');
  assert.equal(one<{ n: number }>('SELECT COUNT(*) n FROM booking_reschedules')!.n, before.moves);
  assert.equal(one<{ n: number }>('SELECT COUNT(*) n FROM retention_cases')!.n, before.cases);
  assert.equal(one<{ status: string }>('SELECT status FROM bookings WHERE id = ?', heldByGuppi)!.status, 'held', 'the hold Guppi made is still a normal hold');
  assert.equal(moneyHash(), before.money, 'switching features off moves no money');
  assert.deepEqual(events().map((e) => `${e.id}:${e.fingerprint}`), before.events);
  // the standard flow does not depend on them
  const plain = await bookAndPay(h, cust, g.id, dayFromNow(9), '10:00');
  assert.equal(plain.status, 'confirmed');
  assert.equal((await h.post('/api/availability/options', { groundId: g.id, date: dayFromNow(10), startTime: '10:00', slots: 1 }, cust)).status, 200);
  // the desk can still move a booking, and the owner can still settle a case that was already open
  const desk = await h.post(`/api/staff/bookings/${plain.id}/reschedule`, { date: dayFromNow(11), startTime: '10:00', reason: 'ground maintenance moved the fixture' }, staff);
  assert.equal(desk.status, 200, JSON.stringify(desk.body));
  const settle = await h.post(`/api/staff/bookings/${kept.id}/retention-dispute/approve`, { version: 2 }, owner);
  assert.equal(settle.status, 200, JSON.stringify(settle.body));
  const r = reconcile(ownerId); assert.equal(r.unexplained, 0); assert.equal(r.debitsPaise, r.creditsPaise);

  // ROLL FORWARD: switch them back on, everything resumes
  setting({ guppiAssistEnabled: true, customerRescheduleEnabled: true, retentionDisputesEnabled: true });
  assert.equal((await h.post('/api/guppi/options', { groundId: g.id, date: dayFromNow(8), startTime: '11:00', slots: 1 }, cust)).status, 200);
  const again = await h.post(`/api/bookings/${moved.id}/reschedule`, { date: dayFromNow(7), startTime: '19:00' }, cust);
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(one<{ reschedule_count: number }>('SELECT reschedule_count FROM bookings WHERE id = ?', moved.id)!.reschedule_count, 2, 'the move count carried through the switch-off');
  ev('refusalsWhileOff', refusals); ev('moneyUnchangedWhileOff', true); ev('eventsBefore', before.events.length);
  ev('stillWorkingWhileOff', ['plain booking and payment', 'availability options', 'desk reschedule', 'owner settles an open retention case']);
  ev('writePathRollback', 'REL-REC-002 in test/rel-migration.test.ts runs the previous release code against the migrated database');
});
