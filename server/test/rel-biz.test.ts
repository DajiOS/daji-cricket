import { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, hold, bookAndPay, dayFromNow, slotStart, setNow, setting, advance, HOUR, MIN, type Harness, type GroundLite } from './helpers.ts';
import { many, one } from '../src/db.ts';
import { runSweeps } from '../src/jobs.ts';
import { createUser } from '../src/auth.ts';
import { reconcile } from '../src/finevents.ts';
import { ledgerLines, sumBy } from '../src/accounting/ledger.ts';
import { readFileSync } from 'node:fs';
import { say } from '../src/guppiText.ts';
import { register } from './register.ts';
import { rel, ev } from './rel.ts';

// The owner's decisions of 27 Oct 2026: UD-01 (booking advance is not the security deposit), UD-02 (a whole ground and the nets/pitches inside it block each other),
// UD-03 (customer rescheduling: 24 hours, two completed moves, replacement first, dearer pays, cheaper settles as credit, history kept, staff override with reason).
// Each case records before / action / after, the allocation, the money and the audit record, so the evidence file shows the rule held and why.

let h: Harness, g: GroundLite, nets: GroundLite, river: GroundLite, cust: string, owner: string, staff: string;
async function setup(): Promise<void> {
  h.reset();
  const gs = await grounds(h);
  g = gs.find((x) => x.name === 'Cricket Ground')!; nets = gs.find((x) => x.name === 'Practice Nets')!; river = gs.find((x) => x.name === 'Riverside Box Cricket')!;
  cust = await h.login('customer'); owner = await h.login('owner1'); staff = await h.login('staff1');
}
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(setup);

const ownerId = () => g.ownerId;
const bookingRow = (id: string) => one<any>('SELECT id, status, date, start_at, end_at, slot_count, total_paise, advance_paise, paid_paise, reschedule_count FROM bookings WHERE id = ?', id)!;
const slotsOf = (id: string) => many<{ ground_id: string; slot_start: number }>("SELECT ground_id, slot_start FROM booking_slots WHERE booking_id = ? AND kind = 'booking' ORDER BY slot_start", id).map((r) => r.slot_start);
const history = (id: string) => many<any>('SELECT kind, from_start_at, to_start_at, from_total_paise, to_total_paise, actor_role, reason FROM booking_reschedules WHERE booking_id = ? ORDER BY created_at, rowid', id);
const customerMoves = (id: string) => one<{ n: number }>("SELECT COUNT(*) n FROM booking_reschedules WHERE booking_id = ? AND kind = 'move' AND actor_role = 'customer'", id)!.n;
const audits = (action: string, id: string) => many<{ action: string; actor_role: string; detail: string }>('SELECT action, actor_role, detail FROM audit_log WHERE action = ? AND entity_id = ? ORDER BY rowid', action, id).map((a) => ({ action: a.action, actorRole: a.actor_role, detail: JSON.parse(a.detail) }));
const counts = () => ({ payments: one<{ n: number }>('SELECT COUNT(*) n FROM payments')!.n, refunds: one<{ n: number }>('SELECT COUNT(*) n FROM refunds')!.n, credits: one<{ n: number }>('SELECT COUNT(*) n FROM credit_lots')!.n, bookings: one<{ n: number }>('SELECT COUNT(*) n FROM bookings')!.n });
const books = () => { const m = sumBy(ledgerLines(ownerId(), '9999-12-31')); const o: Record<string, number> = {}; for (const [k, v] of m) o[k] = v.debit - v.credit; return o; };
const money = (id: string) => { const b = bookingRow(id); return { totalPaise: b.total_paise, advancePaise: b.advance_paise, paidPaise: b.paid_paise, balancePaise: Math.max(b.total_paise - b.paid_paise, 0) }; };
const finEventIds = (id: string) => ({ payments: many<{ id: string }>('SELECT id FROM payments WHERE booking_id = ? ORDER BY created_at, rowid', id).map((r) => r.id), refunds: many<{ id: string }>('SELECT id FROM refunds WHERE booking_id = ? ORDER BY created_at, rowid', id).map((r) => r.id), depositEntries: many<{ id: string }>('SELECT id FROM security_deposit_entries WHERE booking_id = ? ORDER BY created_at, rowid', id).map((r) => r.id) });
const move = (token: string, id: string, date: string, startTime: string, extra: Record<string, unknown> = {}) => h.post(`/api/bookings/${id}/reschedule`, { date, startTime, ...extra }, token);
const staffMove = (token: string, id: string, date: string, startTime: string, reason?: string) => h.post(`/api/staff/bookings/${id}/reschedule`, { date, startTime, ...(reason ? { reason } : {}) }, token);
const dep = (token: string, id: string, kind: string, body: Record<string, unknown>) => h.call('POST', `/api/staff/bookings/${id}/security-deposit/${kind}`, { token, body, headers: { 'idempotency-key': `dep-${kind}-${Math.random().toString(36).slice(2, 12)}` } });
const payBalance = async (token: string, b: { id: string; totalPaise: number; paidPaise: number }) => h.post(`/api/staff/bookings/${b.id}/payments`, { method: 'cash', amountPaise: b.totalPaise - b.paidPaise }, token);
const link = (token: string, parent: GroundLite, items: { groundId: string; conflicts: boolean }[]) => h.call('PUT', `/api/staff/grounds/${parent.id}/links`, { token, body: { includes: items } });
const tryHold = (token: string, ground: GroundLite, date: string, time: string, slots = 1) => hold(h, token, ground.id, date, time, slots);
const priceOf = async (ground: GroundLite, date: string, time: string) => ((await h.get(`/api/grounds/${ground.id}/availability?date=${date}`)).body.slots as { time: string; pricePaise: number }[]).find((x) => x.time === time)!.pricePaise;
const deskBook = async (ground: GroundLite, date: string, time: string) => h.post('/api/staff/bookings', { groundId: ground.id, date, startTime: time, slots: 1, customer: { name: 'Desk Person', phone: '9866600777' }, payment: { method: 'cash', amountPaise: await priceOf(ground, date, time) } }, staff);
const guppiOptions = (token: string, ground: GroundLite, date: string, time: string) => h.post('/api/guppi/options', { groundId: ground.id, date, startTime: time, slots: 1 }, token);
const stateOf = (id: string) => ({ ...bookingRow(id), slots: slotsOf(id), history: history(id), customerMoves: customerMoves(id) });

// ------------------------------------------------------------------ UD-01: booking advance vs security deposit

rel('REL-BIZ-UD01-001', 'the booking advance is part of the booking price and reduces the booking balance only; the security deposit never touches it', async () => {
  const date = dayFromNow(5);
  const b = await bookAndPay(h, cust, g.id, date, '19:00', 1);
  const before = money(b.id), booksBefore = books(), idsBefore = finEventIds(b.id);
  assert.equal(before.paidPaise, before.advancePaise, 'the online payment was exactly the advance');
  assert.ok(before.advancePaise > 0 && before.advancePaise < before.totalPaise);
  assert.equal(before.balancePaise, before.totalPaise - before.advancePaise, 'advance reduces the booking balance');
  const d = await dep(staff, b.id, 'collect', { amountPaise: 100000, method: 'cash', reference: 'receipt-demo-1' });
  assert.equal(d.status, 201, JSON.stringify(d.body));
  const after = money(b.id);
  assert.deepEqual(after, before, 'collecting a security deposit changes no booking figure');
  assert.equal(d.body.deposit.heldPaise, 100000); assert.equal(d.body.deposit.collectedPaise, 100000);
  assert.deepEqual(finEventIds(b.id).payments, idsBefore.payments, 'no payment row was created for the deposit');
  const booksAfter = books();
  for (const a of ['customer_advances', 'booking_income', 'forfeited_income', 'customer_credits']) assert.equal(booksAfter[a] ?? 0, booksBefore[a] ?? 0, `${a} unchanged`);
  assert.equal((booksAfter['security_deposits_held'] ?? 0), -100000, 'the deposit is a liability of its own');
  // the deposit is not the advance: paying the balance later is a booking payment, and the deposit stays put
  assert.equal((await payBalance(staff, { id: b.id, totalPaise: before.totalPaise, paidPaise: before.paidPaise })).status, 201);
  assert.equal(bookingRow(b.id).paid_paise, before.totalPaise);
  assert.equal(depositHeld(b.id), 100000);
  ev('before', { booking: before, books: booksBefore }); ev('action', 'staff collects a 1,000.00 cash security deposit'); ev('after', { booking: after, deposit: d.body.deposit, books: booksAfter });
  ev('financialEventIds', finEventIds(b.id)); ev('audit', audits('deposit.collect', b.id)); ev('accountingResult', 'booking figures and booking accounts unchanged; security_deposits_held credited 100000');
});
const depositHeld = (id: string) => one<{ s: number }>("SELECT COALESCE(SUM(CASE kind WHEN 'collect' THEN amount_paise WHEN 'reverse' THEN amount_paise ELSE -amount_paise END),0) s FROM security_deposit_entries WHERE booking_id = ?", id)!.s;

rel('REL-BIZ-UD01-002', 'the security deposit has its own balance and is independently refundable, deductible only with a reason by the owner, and cannot be refunded past what is held', async () => {
  const b = await bookAndPay(h, cust, g.id, dayFromNow(6), '10:00', 1);
  const stranger = await register(h, 'Not The Customer', '9866600555');
  const booking0 = money(b.id), c0 = counts();
  assert.equal((await dep(staff, b.id, 'collect', { amountPaise: 200000, method: 'upi', reference: 'upi-demo-1' })).status, 201);
  assert.equal((await dep(cust, b.id, 'collect', { amountPaise: 5, method: 'cash' })).status, 403, 'a customer cannot create a deposit');
  assert.equal((await dep(staff, b.id, 'deduct', { amountPaise: 50000, reason: 'Broken net post at the pitch' })).status, 403, 'keeping money is the owner\'s decision, not any staff member\'s');
  assert.equal((await dep(owner, b.id, 'deduct', { amountPaise: 50000, reason: 'x' })).status, 400, 'a deduction needs a reason of ten characters or more');
  const ded = await dep(owner, b.id, 'deduct', { amountPaise: 50000, reason: 'Broken net post at the pitch' });
  assert.equal(ded.status, 201, JSON.stringify(ded.body)); assert.equal(ded.body.deposit.heldPaise, 150000);
  const ref = await dep(staff, b.id, 'refund', { amountPaise: 100000, method: 'upi', reference: 'upi-refund-demo-1' });
  assert.equal(ref.status, 201); assert.equal(ref.body.deposit.heldPaise, 50000);
  const tooMuch = await dep(staff, b.id, 'refund', { amountPaise: 60000, method: 'cash' });
  assert.equal(tooMuch.status, 409); assert.equal(tooMuch.body.error.code, 'DEPOSIT_TOO_SMALL');
  const rev = await dep(owner, b.id, 'reverse', { reversesId: ded.body.deposit.entries.find((e: any) => e.kind === 'deduct').id, amountPaise: 20000, reason: 'Post repaired by the customer' });
  assert.equal(rev.status, 201); assert.equal(rev.body.deposit.heldPaise, 70000);
  const view = (await h.get(`/api/bookings/${b.id}/security-deposit`, cust)).body.deposit;
  assert.equal(view.heldPaise, 70000, 'the customer sees their own deposit');
  assert.equal((await h.get(`/api/bookings/${b.id}/security-deposit`, stranger)).status, 404, 'another customer sees nothing');
  assert.deepEqual(money(b.id), booking0, 'no deposit step changed the booking');
  assert.deepEqual(counts(), { ...c0 }, 'no payment, refund or credit row was made: the deposit has its own records');
  assert.throws(() => one('UPDATE security_deposit_entries SET amount_paise = 1'), /append-only/);
  ev('before', { booking: booking0, counts: c0 }); ev('action', 'collect 2,000 -> owner deducts 500 with a reason -> refund 1,000 -> over-refund refused -> owner reverses 200');
  ev('after', { deposit: view, booking: money(b.id), counts: counts() }); ev('financialEventIds', finEventIds(b.id));
  ev('audit', { collect: audits('deposit.collect', b.id).length, deduct: audits('deposit.deduct', b.id).length, refund: audits('deposit.refund', b.id).length, reverse: audits('deposit.reverse', b.id).length });
});

rel('REL-BIZ-UD01-003', 'settling a security deposit (refund, deduction, reversal) never changes booking revenue or the advance', async () => {
  const date = dayFromNow(1);
  const b = await bookAndPay(h, cust, g.id, date, '10:00', 1);
  await payBalance(staff, { id: b.id, totalPaise: b.totalPaise, paidPaise: b.paidPaise });
  await dep(staff, b.id, 'collect', { amountPaise: 150000, method: 'cash' });
  const m0 = money(b.id);
  setNow(slotStart(date, '10:00') + 27 * HOUR); // the session has been played and the day-after sweep has run
  await runSweeps(h.cfg);
  assert.equal(bookingRow(b.id).status, 'completed');
  const owned = await h.login('owner1');
  const booksPlayed = books();
  assert.equal(booksPlayed['booking_income'] !== undefined && booksPlayed['booking_income'] < 0, true, 'the played session is booking income');
  const ded = await dep(owned, b.id, 'deduct', { amountPaise: 30000, reason: 'Two broken stumps and a torn net' });
  assert.equal(ded.status, 201, JSON.stringify(ded.body));
  const ref = await dep(await h.login('staff1'), b.id, 'refund', { amountPaise: 120000, method: 'cash' });
  assert.equal(ref.status, 201, JSON.stringify(ref.body));
  const rev = await dep(owned, b.id, 'reverse', { reversesId: ded.body.deposit.entries.find((e: any) => e.kind === 'deduct').id, amountPaise: 10000, reason: 'Net was already torn before' });
  assert.equal(rev.status, 201, JSON.stringify(rev.body));
  const booksAfter = books();
  for (const a of ['booking_income', 'customer_advances', 'forfeited_income', 'customer_credits', 'refunds_payable', 'gateway_clearing']) assert.equal(booksAfter[a] ?? 0, booksPlayed[a] ?? 0, `${a} is unchanged by deposit settlement`);
  assert.deepEqual(money(b.id), m0);
  assert.equal(booksAfter['security_deposits_held'], -(150000 - 30000 - 120000 + 10000), 'deposit liability = collected - deducted - refunded + reversed');
  assert.equal(booksAfter['deposit_deductions'], -(30000 - 10000), 'what the ground kept is its own income line, not booking income');
  const rep = reconcile(ownerId());
  assert.equal(rep.unexplained, 0, JSON.stringify(rep.findings)); assert.equal(rep.debitsPaise, rep.creditsPaise);
  ev('before', { booking: m0, books: booksPlayed }); ev('action', 'collect 1,500 -> session played -> deduct 300 -> refund 1,200 -> reverse 100');
  ev('after', { booking: money(b.id), books: booksAfter, depositHeld: depositHeld(b.id) }); ev('financialEventIds', finEventIds(b.id)); ev('accountingResult', { debits: rep.debitsPaise, credits: rep.creditsPaise, unexplained: rep.unexplained });
});

// ------------------------------------------------------------------ UD-02: whole ground vs nets/pitches

rel('REL-BIZ-UD02-001', 'booking the whole ground first blocks every net or pitch configured as included in it, through every booking channel', async () => {
  const date = dayFromNow(4);
  assert.equal((await link(owner, g, [{ groundId: nets.id, conflicts: true }])).status, 200);
  const before = { allocations: many<any>('SELECT ground_id, slot_start FROM booking_slots').length };
  const whole = await tryHold(cust, g, date, '19:00');
  assert.equal(whole.status, 201, JSON.stringify(whole.body));
  const other = await register(h, 'Net Customer', '9866600321');
  const web = await tryHold(other, nets, date, '19:00');
  assert.equal(web.status, 409); assert.equal(web.body.error.code, 'SLOT_TAKEN');
  const desk = await deskBook(nets, date, '19:00'); assert.equal(desk.status, 409); assert.equal(desk.body.error.code, 'SLOT_TAKEN');
  const gup = await guppiOptions(other, nets, date, '19:00'); assert.equal(gup.status, 200); assert.equal(gup.body.exact, null); assert.equal(gup.body.available, false);
  const std = await h.post('/api/availability/options', { groundId: nets.id, date, startTime: '19:00', slots: 1 }, other); assert.equal(std.status, 200); assert.equal(std.body.exact, null);
  const av = (await h.get(`/api/grounds/${nets.id}/availability?date=${date}`)).body.slots as { time: string; state: string }[];
  const at = av.find((s) => s.time === '19:00')!;
  assert.equal(at.state, 'booked', 'the grid shows 19:00 as taken');
  const free = await tryHold(other, nets, date, '21:00'); assert.equal(free.status, 201, 'a different time on the net is untouched');
  ev('configuration', { wholeGround: g.name, includedResources: [nets.name], conflicts: true });
  ev('allocationsBefore', before.allocations); ev('attempted', 'net 19:00 by website, staff desk, Guppi options, standard options');
  ev('conflictResponse', { web: web.body.error.code, desk: desk.body.error.code, guppiExact: gup.body.exact, standardExact: std.body.exact }); ev('allocationsAfter', many<any>('SELECT ground_id, slot_start FROM booking_slots').length);
  ev('audit', audits('ground.links', g.id).length);
});

rel('REL-BIZ-UD02-002', 'an existing net or pitch booking blocks the whole ground for the same time', async () => {
  const date = dayFromNow(4);
  await link(owner, g, [{ groundId: nets.id, conflicts: true }]);
  const net = await tryHold(cust, nets, date, '19:00'); assert.equal(net.status, 201);
  const other = await register(h, 'Whole Customer', '9866600322');
  const web = await tryHold(other, g, date, '19:00'); assert.equal(web.status, 409); assert.equal(web.body.error.code, 'SLOT_TAKEN');
  const desk = await deskBook(g, date, '19:00'); assert.equal(desk.status, 409);
  const gup = await guppiOptions(other, g, date, '19:00'); assert.equal(gup.body.exact, null); assert.equal(gup.body.available, false);
  assert.equal((await tryHold(other, g, date, '12:00')).status, 201, 'the whole ground is free where the net is not booked');
  // the guard is in the slot-taking function itself: a second call that skips the options step is refused the same way
  const rows = many<{ ground_id: string }>("SELECT ground_id FROM booking_slots WHERE kind = 'booking' AND slot_start = ?", slotStart(date, '19:00'));
  assert.deepEqual(rows.map((r) => r.ground_id), [nets.id], 'only the net holds 19:00');
  ev('configuration', { wholeGround: g.name, includedResources: [nets.name], conflicts: true }); ev('allocationsBefore', 1);
  ev('attempted', 'whole ground 19:00 by website, staff desk, Guppi'); ev('conflictResponse', { web: web.body.error.code, desk: desk.body.error.code, guppiExact: gup.body.exact }); ev('allocationsAfter', rows.length + 1 /* + the 12:00 hold */);
});

rel('REL-BIZ-UD02-003', 'a resource explicitly configured as non-conflicting, or one that is not linked at all, stays bookable while the whole ground is booked', async () => {
  const date = dayFromNow(4);
  assert.equal((await link(owner, g, [{ groundId: nets.id, conflicts: false }])).status, 200);
  assert.equal((await tryHold(cust, g, date, '19:00')).status, 201);
  const other = await register(h, 'Independent Net', '9866600323');
  assert.equal((await tryHold(other, nets, date, '19:00')).status, 201, 'configured non-conflicting: both can run');
  assert.equal((await tryHold(other, river, date, '19:00')).status, 201, 'a ground that is not linked is independent');
  // cross-business links and nesting are refused rather than guessed
  const x = await link(owner, g, [{ groundId: river.id, conflicts: true }]); assert.equal(x.status, 404);
  // a net inside two wholes, or a whole inside a whole, is refused (one level only)
  const n = await link(owner, nets, [{ groundId: g.id, conflicts: true }]); assert.equal(n.status, 409);
  const rows = many<{ ground_id: string }>("SELECT ground_id FROM booking_slots WHERE kind = 'booking' AND slot_start = ? ORDER BY ground_id", slotStart(date, '19:00'));
  assert.equal(rows.length, 3);
  ev('configuration', { wholeGround: g.name, includedResources: [{ name: nets.name, conflicts: false }], unlinked: river.name });
  ev('allocationsBefore', 0); ev('attempted', 'net and unlinked ground at the same time as the whole ground'); ev('conflictResponse', 'none: both held'); ev('allocationsAfter', rows.length);
  ev('refusals', { crossBusiness: x.body.error.code, nested: n.body.error.code });
});

// ------------------------------------------------------------------ UD-03: customer rescheduling

async function fresh(date = dayFromNow(5), time = '10:00') { return bookAndPay(h, cust, g.id, date, time, 1); }

rel('REL-BIZ-UD03-001', 'a customer can move a booking when more than 24 hours remain before it starts', async () => {
  const date = dayFromNow(5);
  const b = await fresh(date, '10:00');
  const before = stateOf(b.id), startAt = before.start_at;
  assert.ok(startAt - 0 > 24 * HOUR);
  const r = await move(cust, b.id, date, '12:00');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const after = stateOf(b.id);
  assert.equal(after.start_at, slotStart(date, '12:00')); assert.deepEqual(after.slots, [slotStart(date, '12:00')]); assert.equal(after.customerMoves, 1); assert.equal(after.reschedule_count, 1);
  ev('originalBooking', before); ev('testClock', 'T0 (frozen)'); ev('timeRemainingHours', (startAt - slotStart(dayFromNow(0), '10:00')) / HOUR); ev('previousMoveCount', 0);
  ev('replacement', { date, startTime: '12:00', available: true }); ev('finalAllocation', after.slots); ev('finalBooking', after); ev('finalMoveCount', after.customerMoves); ev('audit', audits('booking.reschedule', b.id)); ev('history', after.history);
});

rel('REL-BIZ-UD03-002', 'a customer cannot move a booking when 24 hours or fewer remain; nothing changes', async () => {
  const date = dayFromNow(2);
  const b = await fresh(date, '10:00');
  setNow(b.startAt - 23 * HOUR); const tok = await h.login('customer');
  const before = stateOf(b.id), c0 = counts();
  const r = await move(tok, b.id, date, '12:00');
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'RESCHEDULE_TOO_LATE');
  assert.deepEqual(stateOf(b.id), before); assert.deepEqual(counts(), c0); assert.equal(audits('booking.reschedule', b.id).length, 0);
  ev('originalBooking', before); ev('timeRemaining', '23h'); ev('previousMoveCount', 0); ev('response', r.body.error.code); ev('finalMoveCount', customerMoves(b.id)); ev('finalAllocation', slotsOf(b.id));
});

rel('REL-BIZ-UD03-003', 'a third completed customer move is refused; two are allowed', async () => {
  const date = dayFromNow(5);
  const b = await fresh(date, '10:00');
  assert.equal((await move(cust, b.id, date, '11:00')).status, 200); assert.equal((await move(cust, b.id, date, '12:00')).status, 200);
  const before = stateOf(b.id); assert.equal(before.customerMoves, 2);
  const third = await move(cust, b.id, date, '13:00');
  assert.equal(third.status, 409); assert.equal(third.body.error.code, 'RESCHEDULE_LIMIT');
  assert.deepEqual(stateOf(b.id), before, 'the refused third attempt changed nothing');
  ev('previousMoveCount', 2); ev('response', third.body.error.code); ev('finalMoveCount', customerMoves(b.id)); ev('finalAllocation', slotsOf(b.id)); ev('history', before.history);
});

rel('REL-BIZ-UD03-004', 'when the replacement is unavailable the original booking stays exactly as it was', async () => {
  const date = dayFromNow(5);
  const b = await fresh(date, '10:00');
  const other = await register(h, 'Holder', '9866600444');
  assert.equal((await tryHold(other, g, date, '14:00')).status, 201);
  const before = stateOf(b.id), c0 = counts();
  const r = await move(cust, b.id, date, '14:00');
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'SLOT_TAKEN');
  assert.deepEqual(stateOf(b.id), before); assert.deepEqual(counts(), c0); assert.equal(audits('booking.reschedule', b.id).length, 0);
  assert.equal(one<{ n: number }>('SELECT COUNT(*) n FROM booking_slots WHERE ground_id = ? AND slot_start = ?', g.id, slotStart(date, '14:00'))!.n, 1, 'the other person still holds their slot');
  // a replacement partly held by someone else: a two-hour booking asked to move to a window that overlaps a held hour
  const two = await bookAndPay(h, cust, g.id, dayFromNow(6), '10:00', 2);
  await tryHold(other, g, dayFromNow(6), '13:00');
  const b2 = stateOf(two.id); const r2 = await move(cust, two.id, dayFromNow(6), '12:00');
  assert.equal(r2.status, 409); assert.deepEqual(stateOf(two.id), b2, 'a partly held replacement leaves the original whole');
  ev('originalBooking', before); ev('replacement', { date, startTime: '14:00', available: false }); ev('response', r.body.error.code); ev('finalAllocation', slotsOf(b.id)); ev('finalBooking', stateOf(b.id));
  ev('finalMoveCount', customerMoves(b.id)); ev('multiSlotCase', { original: b2.slots, afterRefusedMove: slotsOf(two.id) });
});

rel('REL-BIZ-UD03-005', 'a more expensive replacement raises the balance by exactly the difference, which the customer pays; the booking is not silently refunded or re-priced', async () => {
  const date = dayFromNow(5);
  const b = await fresh(date, '09:00'); // a morning hour is cheaper than an evening one
  const before = money(b.id), c0 = counts();
  const r = await move(cust, b.id, date, '19:00');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const after = money(b.id);
  assert.ok(after.totalPaise > before.totalPaise);
  assert.equal(after.paidPaise, before.paidPaise, 'what was paid stays on the booking');
  assert.equal(r.body.balancePaise, after.totalPaise - before.paidPaise);
  assert.equal(after.balancePaise - before.balancePaise, after.totalPaise - before.totalPaise, 'the balance rose by exactly the price difference');
  assert.deepEqual(counts(), c0, 'no refund, credit or payment was made by the move itself');
  const pay = await payBalance(staff, { id: b.id, totalPaise: after.totalPaise, paidPaise: after.paidPaise });
  assert.equal(pay.status, 201); assert.equal(money(b.id).balancePaise, 0, 'the difference is settled through the normal balance payment');
  assert.equal(reconcile(ownerId()).unexplained, 0);
  ev('oldPricePaise', before.totalPaise); ev('newPricePaise', after.totalPaise); ev('differencePaise', after.totalPaise - before.totalPaise); ev('settlementResult', 'balance due raised; difference paid via the normal balance payment');
  ev('before', before); ev('after', after); ev('financialEventIds', finEventIds(b.id)); ev('audit', audits('booking.reschedule', b.id));
});

rel('REL-BIZ-UD03-006', 'a cheaper replacement is settled by the approved credit (or a refund request through the approval chain), never silently refunded', async () => {
  const date = dayFromNow(5);
  const b = await fresh(date, '19:00');
  await payBalance(staff, { id: b.id, totalPaise: b.totalPaise, paidPaise: b.paidPaise });
  const before = money(b.id), c0 = counts();
  const r = await move(cust, b.id, date, '09:00');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const s = r.body.settlement; const after = money(b.id);
  assert.equal(s.treatment, 'credit'); assert.equal(s.creditPaise, before.totalPaise - after.totalPaise);
  assert.equal(after.paidPaise, after.totalPaise); assert.equal(after.balancePaise, 0);
  assert.deepEqual({ ...counts(), credits: counts().credits - 1 }, c0, 'one credit lot, no refund');
  const lot = one<any>('SELECT amount_paise, remaining_paise, source, booking_id FROM credit_lots WHERE booking_id = ?', b.id)!;
  assert.equal(lot.amount_paise, s.creditPaise); assert.equal(lot.source, 'restore');
  const rep = reconcile(ownerId()); assert.equal(rep.unexplained, 0, JSON.stringify(rep.findings)); assert.equal(rep.debitsPaise, rep.creditsPaise);
  // the other approved treatment: a refund request that goes through the existing refund path
  setting({ rescheduleCheaperTreatment: 'refund_request' });
  const b2 = await bookAndPay(h, cust, g.id, dayFromNow(6), '19:00', 1);
  await payBalance(staff, { id: b2.id, totalPaise: b2.totalPaise, paidPaise: b2.paidPaise });
  const r2 = await move(cust, b2.id, dayFromNow(6), '09:00'); assert.equal(r2.status, 200, JSON.stringify(r2.body));
  const refund = many<any>('SELECT amount_paise, status, mode FROM refunds WHERE booking_id = ?', b2.id);
  assert.ok(refund.length >= 1 && refund.every((x) => x.status !== 'processed' || x.mode), JSON.stringify(refund));
  const rep2 = reconcile(ownerId()); assert.equal(rep2.unexplained, 0, JSON.stringify(rep2.findings));
  ev('oldPricePaise', before.totalPaise); ev('newPricePaise', after.totalPaise); ev('differencePaise', s.paiseSettled); ev('settlementResult', s); ev('creditLot', { amountPaise: lot.amount_paise, source: lot.source });
  ev('refundRequestCase', { treatment: r2.body.settlement.treatment, refunds: refund }); ev('before', before); ev('after', after); ev('financialEventIds', finEventIds(b.id)); ev('audit', audits('booking.reschedule', b.id));
  ev('accountingResult', { debits: rep.debitsPaise, credits: rep.creditsPaise, unexplained: rep.unexplained + rep2.unexplained });
});

rel('REL-BIZ-UD03-007', 'rescheduling keeps the full history: every move is an append-only record linking the earlier time to the new one, and cannot be edited or deleted', async () => {
  const date = dayFromNow(5);
  const b = await fresh(date, '10:00');
  const first = bookingRow(b.id).start_at;
  await move(cust, b.id, date, '11:00'); await move(cust, b.id, date, '12:00');
  const hist = history(b.id);
  assert.equal(hist.length, 2);
  assert.equal(hist[0].from_start_at, first); assert.equal(hist[0].to_start_at, slotStart(date, '11:00'));
  assert.equal(hist[1].from_start_at, hist[0].to_start_at, 'each record starts where the last ended'); assert.equal(hist[1].to_start_at, slotStart(date, '12:00'));
  assert.ok(hist.every((x) => x.actor_role === 'customer'));
  assert.throws(() => one('UPDATE booking_reschedules SET to_start_at = 1'), /append-only/); assert.throws(() => one('DELETE FROM booking_reschedules'), /append-only/);
  assert.equal(audits('booking.reschedule', b.id).length, 2);
  assert.equal(many('SELECT 1 FROM booking_slots WHERE booking_id = ? AND slot_start = ?', b.id, first).length, 0, 'the old time is released, but remembered in the history');
  ev('originalBooking', { startAt: first }); ev('history', hist); ev('audit', audits('booking.reschedule', b.id).map((a) => ({ from: a.detail.fromStartAt, to: a.detail.toStartAt, by: a.detail.movedBy }))); ev('finalMoveCount', customerMoves(b.id));
});

rel('REL-BIZ-UD03-008', 'an authorized staff member can move a booking inside the cutoff or after the limit, with a reason, and it is audited and does not use the customer\'s moves', async () => {
  const date = dayFromNow(2);
  const b = await fresh(date, '10:00');
  setNow(b.startAt - 5 * HOUR); const tok = await h.login('staff1'); const ctok = await h.login('customer');
  assert.equal((await move(ctok, b.id, date, '12:00')).body.error.code, 'RESCHEDULE_TOO_LATE', 'the customer is inside the cutoff');
  const before = stateOf(b.id);
  const noReason = await staffMove(tok, b.id, date, '12:00'); assert.equal(noReason.status, 400); assert.equal(noReason.body.error.code, 'REASON_REQUIRED');
  const r = await staffMove(tok, b.id, date, '12:00', 'Customer phoned: team arrives late');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const after = stateOf(b.id);
  assert.equal(after.customerMoves, 0, 'a staff move is not one of the customer\'s'); assert.equal(after.reschedule_count, 0);
  assert.equal(after.history.at(-1).actor_role, 'staff'); assert.equal(after.history.at(-1).reason, 'Customer phoned: team arrives late');
  const a = audits('booking.reschedule', b.id).at(-1)!; assert.equal(a.detail.movedBy, 'staff'); assert.equal(a.actorRole, 'staff');
  ev('originalBooking', before); ev('permission', 'manage_bookings'); ev('reason', after.history.at(-1).reason); ev('previousMoveCount', 0); ev('finalMoveCount', after.customerMoves); ev('finalAllocation', after.slots); ev('audit', a);
});

rel('REL-BIZ-UD03-009', 'staff without the booking permission cannot move a booking, and a customer cannot use the staff route', async () => {
  const date = dayFromNow(5);
  const b = await fresh(date, '10:00');
  const o = one<{ id: string }>("SELECT id FROM users WHERE role = 'owner' AND email = ?", 'owner1@daji.test') ?? one<{ id: string }>("SELECT id FROM users WHERE role = 'owner' ORDER BY rowid LIMIT 1")!;
  createUser({ role: 'staff', name: 'Viewer Only', email: 'viewer.only@daji.test', phone: '9000000099', password: 'Viewer-Only-demo-1', ownerId: o.id, permissions: ['view_customers'] });
  const lg = await h.call('POST', '/api/auth/login', { body: { email: 'viewer.only@daji.test', password: 'Viewer-Only-demo-1' } });
  assert.equal(lg.status, 200, JSON.stringify(lg.body));
  const before = stateOf(b.id), c0 = counts();
  const r = await staffMove(lg.body.token, b.id, date, '12:00', 'Trying without the permission');
  assert.equal(r.status, 403, JSON.stringify(r.body));
  const viaCustomer = await staffMove(cust, b.id, date, '12:00', 'A customer on the staff route');
  assert.ok(viaCustomer.status === 403 || viaCustomer.status === 401, String(viaCustomer.status));
  assert.deepEqual(stateOf(b.id), before); assert.deepEqual(counts(), c0); assert.equal(audits('booking.reschedule', b.id).length, 0);
  ev('originalBooking', before); ev('permission', 'staff with only view_customers'); ev('response', [r.status, r.body.error?.code]); ev('finalAllocation', slotsOf(b.id)); ev('finalMoveCount', customerMoves(b.id));
});

rel('REL-BIZ-UD03-010', 'a failed or abandoned attempt does not use up one of the customer\'s moves', async () => {
  const date = dayFromNow(5);
  const b = await fresh(date, '10:00');
  const other = await register(h, 'Holder', '9866600445');
  await tryHold(other, g, date, '14:00');
  assert.equal(customerMoves(b.id), 0);
  const failed = await move(cust, b.id, date, '14:00'); // replacement taken
  assert.equal(failed.status, 409);
  assert.equal(customerMoves(b.id), 0, 'failed attempt: move count 0 -> 0'); assert.equal(bookingRow(b.id).reschedule_count, 0);
  const invalid = await move(cust, b.id, date, '03:00'); assert.ok(invalid.status >= 400);
  assert.equal(customerMoves(b.id), 0, 'an invalid time also uses none');
  // abandoned: the customer looks at the offered times and walks away
  const opt = await h.post('/api/availability/options', { groundId: g.id, date, startTime: '16:00', slots: 1 }, cust); assert.equal(opt.status, 200);
  const gOpt = await guppiOptions(cust, g, date, '17:00'); assert.equal(gOpt.status, 200);
  assert.equal(customerMoves(b.id), 0, 'abandoned attempt: move count 0 -> 0');
  assert.equal((await move(cust, b.id, date, '11:00')).status, 200);
  assert.equal(customerMoves(b.id), 1);
  const o2 = await h.post('/api/availability/options', { groundId: g.id, date, startTime: '18:00', slots: 1 }, cust); assert.equal(o2.status, 200);
  assert.equal(customerMoves(b.id), 1, 'abandoned after one completed move: count 1 -> 1'); assert.equal(bookingRow(b.id).reschedule_count, 1);
  assert.equal((await move(cust, b.id, date, '12:00')).status, 200, 'the second move is still available');
  assert.equal(customerMoves(b.id), 2);
  assert.equal(history(b.id).length, 2, 'only completed moves leave a history record');
  ev('previousMoveCount', [0, 1]); ev('failedAttempt', { response: failed.body.error.code, countBefore: 0, countAfter: 0 }); ev('abandonedAttempt', { countBefore: 1, countAfter: 1 });
  ev('counterIncrementedAt', 'reschedule.ts rescheduleBooking UPDATE bookings SET reschedule_count = reschedule_count + 1 (customer only, inside the same transaction as the move)'); ev('finalMoveCount', customerMoves(b.id)); ev('history', history(b.id));
});

rel('REL-BIZ-UD03-011', 'the 24-hour cutoff is decided on the booking\'s own start time and the server clock: 24h + 1s is allowed, exactly 24h and 24h - 1s are blocked', async () => {
  const results: Record<string, unknown>[] = [];
  for (const [label, offsetSeconds, allowed] of [['24h + 1s', 24 * 3600 + 1, true], ['exactly 24h', 24 * 3600, false], ['24h - 1s', 24 * 3600 - 1, false]] as const) {
    await setup();
    const date = dayFromNow(3), startAt = slotStart(date, '10:00');
    const b = await fresh(date, '10:00'); assert.equal(b.startAt, startAt);
    setNow(startAt - offsetSeconds * 1000); const tok = await h.login('customer');
    const before = stateOf(b.id);
    const r = await move(tok, b.id, date, '12:00');
    if (allowed) { assert.equal(r.status, 200, `${label}: ${JSON.stringify(r.body)}`); assert.equal(customerMoves(b.id), 1); }
    else { assert.equal(r.status, 409, label); assert.equal(r.body.error.code, 'RESCHEDULE_TOO_LATE'); assert.deepEqual(stateOf(b.id), before); }
    results.push({ case: label, testClock: new Date(startAt - offsetSeconds * 1000).toISOString(), startAt: new Date(startAt).toISOString(), remainingSeconds: offsetSeconds, status: r.status, code: r.body.error?.code ?? null, finalMoveCount: customerMoves(b.id) });
  }
  // the same boundary through Guppi, which has no cutoff of its own
  await setup();
  const date = dayFromNow(3), startAt = slotStart(date, '10:00'); const b = await fresh(date, '10:00');
  setNow(startAt - 24 * HOUR); const tok = await h.login('customer');
  const o = await guppiOptions(tok, g, date, '12:00'); assert.equal(o.status, 200);
  const gm = o.body.exact ? await h.call('POST', '/api/guppi/reschedule', { token: tok, body: { bookingId: b.id, optionId: o.body.exact.optionId, actionId: 'act-boundary-01', context: { bookingId: b.id } }, headers: { 'idempotency-key': 'act-boundary-01' } }) : { status: 0, body: {} as any };
  assert.equal(gm.status, 409); assert.equal(gm.body.error.code, 'RESCHEDULE_TOO_LATE', 'Guppi reports the same rule from the same service');
  ev('comparison', 'reschedule.ts rescheduleBooking: b.start_at - now() <= cutoffHours * HOUR is refused (strictly more than the cutoff is allowed)'); ev('authoritativeTimestamp', 'bookings.start_at (server) and clock.now()'); ev('cases', results); ev('guppiAtExactly24h', gm.body.error.code);
});

// ------------------------------------------------------------------ UD-02 extra: the second place a slot is written (a payment that arrives after its hold expired)

rel('REL-BIZ-UD02-004', 'extra: a late payment cannot take back a slot that the whole ground (or the net inside it) has since been booked for; it is refunded, not double-booked', async () => {
  setting({ razorpayEnabled: false });
  const date = dayFromNow(4);
  assert.equal((await link(owner, g, [{ groundId: nets.id, conflicts: true }])).status, 200);
  const held = await tryHold(cust, nets, date, '19:00'); assert.equal(held.status, 201);
  const id = held.body.booking.id, asked = held.body.payment.amountPaise;
  advance(16 * MIN);
  await runSweeps(h.cfg);
  assert.equal(bookingRow(id).status, 'expired');
  const whole = await h.post('/api/staff/bookings', { groundId: g.id, date, startTime: '19:00', slots: 1, customer: { name: 'Whole Ground', phone: '9866600888' }, payment: { method: 'cash', amountPaise: await priceOf(g, date, '19:00') } }, staff);
  assert.equal(whole.status, 201, JSON.stringify(whole.body));
  const sub = await h.post(`/api/bookings/${id}/upi-reference`, { utr: '200000000777' }, cust); assert.equal(sub.status, 200, JSON.stringify(sub.body));
  const v = await h.post(`/api/staff/payments/${sub.body.payment.id}/verify`, { approve: true }, staff);
  assert.equal(v.body.outcome, 'late_refunded', JSON.stringify(v.body));
  assert.equal(many("SELECT 1 FROM booking_slots WHERE booking_id = ?", id).length, 0, 'the net did not get its slot back');
  assert.equal(one<{ amount_paise: number }>('SELECT amount_paise FROM refunds WHERE payment_id = ?', sub.body.payment.id)?.amount_paise, asked);
  ev('configuration', { wholeGround: g.name, includedResources: [nets.name], conflicts: true }); ev('attempted', 'late payment for an expired net hold after the whole ground was booked'); ev('conflictResponse', v.body.outcome);
});

// ------------------------------------------------------------------ UD-01 extra: customer wording

rel('REL-BIZ-UD01-004', 'extra: Guppi and the website call the booking advance "advance" and never "deposit", and Guppi\'s answer says a security deposit is separate and handled by the ground', async () => {
  const langs = ['en', 'gu', 'hi', 'gu-Latn', 'hi-Latn'] as const;
  const seen: Record<string, string> = {};
  for (const l of langs) {
    const t = { deposit: say(l, 'deposit', { advance: '{advance}', total: '{total}' }), selected: say(l, 'selected', { ground: 'G', when: 'W', dur: 'D', total: '{total}', advance: '{advance}' }) };
    assert.ok(!/\((deposit|ડિપોઝિટ|डिपॉज़िट|डिपॉजिट)\)/i.test(t.deposit + t.selected), `${l}: the advance is not labelled "(deposit)"`);
    assert.ok(/security/i.test(t.deposit) || /સિક્યોરિટી/.test(t.deposit) || /सिक्योरिटी/.test(t.deposit), `${l}: the answer separates the security deposit`);
    assert.ok(t.deposit.includes('{advance}') && t.deposit.includes('{total}'), `${l}: the figures still come from the booking system`);
    seen[l] = t.deposit;
  }
  const app = readFileSync(new URL('../../web/public/app.js', import.meta.url), 'utf8');
  assert.ok(!/Your deposit is holding/.test(app), 'the website does not call the advance a deposit');
  ev('guppiAnswers', seen);
});
