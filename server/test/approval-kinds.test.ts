import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, bookAndPay, dayFromNow, DEMO_ACCOUNTS, type Harness, type GroundLite } from './helpers.ts';
import { run } from '../src/db.ts';

// Refunds, discounts, fee waivers and expenses go through the same approval rules as bills and pay runs. With no rule
// (the default) each behaves exactly as it did before; once the owner adds steps, each waits on the Approvals board.

let h: Harness; let owner: string, staff: string, clerk: string, cust: string, admin: string; let g: GroundLite;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset();
  owner = await h.login('owner1'); staff = await h.login('staff1'); cust = await h.login('customer'); admin = await h.login('admin');
  run('UPDATE users SET permissions = ? WHERE email = ?', JSON.stringify(['manage_bookings', 'record_payments', 'verify_payments', 'manage_academy', 'manage_accounting', 'view_customers']), DEMO_ACCOUNTS.staff1.email);
  const r = await h.post('/api/staff/team', { name: 'Front Desk Two', email: 'desk2@daji.test', password: 'Desk2@12345', permissions: ['manage_bookings', 'record_payments', 'manage_academy', 'manage_accounting'] }, owner);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  clerk = (await h.post('/api/auth/login', { email: 'desk2@daji.test', password: 'Desk2@12345' })).body.token;
  g = (await grounds(h)).find((x) => x.ownerId)!;
});

const F = '/api/accounting/approvals/flows';
const R = '/api/accounting/approvals/requests';
const anyone = (label: string, overPaise: number | null = null) => ({ label, who: { type: 'anyone' }, overPaise });
async function setFlow(kind: string, body: Record<string, unknown>) {
  const r = await h.put(`${F}/${kind}`, { notSelf: true, distinct: false, sendBack: 'start', ...body }, owner);
  assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body;
}
const open = async (token = owner) => (await h.get(R, token)).body.items as any[];
async function walkIn(paidPaise: number, start = '08:00') {
  const r = await h.post('/api/staff/bookings', { groundId: g.id, date: dayFromNow(2), startTime: start, slots: 1, customer: { name: 'Walk In', phone: '9800000031' }, payment: { method: 'cash', amountPaise: paidPaise } }, staff);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.booking ?? r.body;
}
const booking = async (id: string) => (await h.get(`/api/staff/bookings/${id}`, owner)).body.booking ?? (await h.get(`/api/staff/bookings/${id}`, owner)).body;
async function fee() {
  await h.post('/api/staff/academy/students', { name: 'Aarav', guardianName: 'Parent', guardianEmail: 'aarav@example.com' }, owner);
  await h.post('/api/staff/academy/fees', { month: '2026-10', amountPaise: 300000 }, owner);
  return (await h.get('/api/staff/academy/fees?month=2026-10', owner)).body.items[0];
}
async function cashAccount() {
  const r = await h.post('/api/accounting/accounts', { kind: 'cash', name: 'Petty cash', openingPaise: 0 }, owner);
  assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.id as string;
}

test('the builder lists the four new kinds, each with no sign-off out of the box', async () => {
  const d = (await h.get(F, owner)).body;
  for (const k of ['refund', 'discount', 'waiver', 'expense']) {
    const x = d.kinds.find((y: any) => y.kind === k);
    assert.ok(x, k); assert.equal(x.flow.steps.length, 0); assert.equal(x.custom, false); assert.ok(x.summary.length > 10);
  }
  assert.equal(d.kinds.find((y: any) => y.kind === 'refund').perm, 'record_payments');
  assert.equal(d.kinds.find((y: any) => y.kind === 'waiver').perm, 'manage_academy');
});

test('refunds: with no rule they go straight to the super admin; with a rule the ground signs first', async () => {
  const b1 = await bookAndPay(h, cust, g.id, dayFromNow(3), '19:00', 1);
  await h.post(`/api/bookings/${b1.id}/cancel`, { reason: 'rain' }, cust);
  const r1 = (await h.get('/api/staff/refunds?status=pending', staff)).body.items[0];
  assert.equal(r1.waitingOnGround, false);
  assert.equal((await open()).length, 0, 'nothing on the board without a rule');
  assert.equal((await h.post(`/api/admin/refunds/${r1.id}/approve`, {}, admin)).status, 200);

  await setFlow('refund', { steps: [anyone('Check the refund')], notSelf: false });
  const b2 = await bookAndPay(h, cust, g.id, dayFromNow(4), '19:00', 1);
  await h.post(`/api/bookings/${b2.id}/cancel`, { reason: 'rain' }, cust);
  const r2 = (await h.get('/api/staff/refunds?status=pending', staff)).body.items.find((x: any) => x.bookingId === b2.id);
  assert.equal(r2.waitingOnGround, true);
  const a = await h.post(`/api/admin/refunds/${r2.id}/approve`, {}, admin);
  assert.equal(a.status, 409); assert.equal(a.body.error.code, 'WAITING_ON_GROUND');
  const item = (await open(staff)).find((x) => x.kind === 'refund');
  assert.ok(item, 'a front-desk person who records payments sees it');
  assert.equal(item.entityId, r2.id); assert.equal(item.canSign, true);
  const s = await h.post(`${R}/${item.id}/approve`, { note: 'checked' }, staff);
  assert.equal(s.status, 200, JSON.stringify(s.body)); assert.equal(s.body.status, 'approved');
  assert.ok(s.body.trail.some((e: any) => e.action === 'cleared'));
  assert.equal((await h.post(`/api/admin/refunds/${r2.id}/approve`, {}, admin)).status, 200);
});

test('refunds: sending one back to the start declines it and the ground keeps the money', async () => {
  await setFlow('refund', { steps: [anyone('Check the refund')] });
  const b = await bookAndPay(h, cust, g.id, dayFromNow(3), '19:00', 1);
  await h.post(`/api/bookings/${b.id}/cancel`, { reason: 'rain' }, cust);
  const item = (await open()).find((x) => x.kind === 'refund');
  assert.equal((await h.post(`${R}/${item.id}/send-back`, {}, owner)).status, 400, 'a note is needed');
  assert.equal((await h.post(`${R}/${item.id}/send-back`, { note: 'They played in the end' }, owner)).status, 200);
  assert.equal((await h.get(`/api/bookings/${b.id}`, cust)).body.payments[0].refundedPaise, 0);
  assert.equal((await h.get('/api/admin/refunds', admin)).body.items.length, 0, 'nothing left for the super admin');
  const r = (await h.get('/api/admin/refunds?status=failed', admin)).body.items.find((x: any) => x.bookingId === b.id);
  assert.equal(r.status, 'failed');
  assert.equal((await open()).length, 0);
});

test('discounts: given on the spot with no rule; above the amount in the rule they wait for sign-off', async () => {
  const b = await walkIn(90000);
  const owed = b.totalPaise - b.paidPaise;
  assert.ok(owed > 30000, `the walk-in owes ${owed}`);
  assert.equal((await h.post(`/api/staff/bookings/${b.id}/discount`, { amountPaise: owed + 100, reason: 'regular' }, staff)).status, 409, 'not more than is owed');
  assert.equal((await h.post(`/api/staff/bookings/${b.id}/discount`, { amountPaise: 10000 }, staff)).status, 400, 'a reason is needed');
  const d1 = await h.post(`/api/staff/bookings/${b.id}/discount`, { amountPaise: 10000, reason: 'Regular customer' }, staff);
  assert.equal(d1.status, 200, JSON.stringify(d1.body)); assert.equal(d1.body.status, 'done');
  let now = await booking(b.id);
  assert.equal(now.totalPaise, b.totalPaise - 10000); assert.equal(now.discountPaise, 10000);

  await setFlow('discount', { steps: [anyone('Manager check', 15000)] });
  const small = await h.post(`/api/staff/bookings/${b.id}/discount`, { amountPaise: 5000, reason: 'Late start' }, staff);
  assert.equal(small.body.status, 'done', 'under the amount no step applies');
  const big = await h.post(`/api/staff/bookings/${b.id}/discount`, { amountPaise: 20000, reason: 'Floodlight failed' }, staff);
  assert.equal(big.body.status, 'waiting');
  now = await booking(b.id);
  assert.equal(now.totalPaise, b.totalPaise - 15000, 'nothing changes while it waits');
  assert.equal((await h.post(`/api/staff/bookings/${b.id}/discount`, { amountPaise: 1000, reason: 'Again' }, staff)).status, 409, 'one waiting at a time');
  const item = (await open()).find((x) => x.kind === 'discount');
  assert.equal(item.canSign, true);
  const mine = (await open(staff)).find((x) => x.kind === 'discount');
  assert.equal(mine.canSign, false); assert.match(mine.whyNot, /asked for this discount/);
  assert.equal((await h.post(`${R}/${item.id}/approve`, {}, staff)).status, 403);
  assert.equal((await h.post(`${R}/${item.id}/approve`, {}, clerk)).status, 200);
  now = await booking(b.id);
  assert.equal(now.totalPaise, b.totalPaise - 35000); assert.equal(now.discountPaise, 35000);
  const asks = (await h.get('/api/accounting/approvals/asks?targetId=' + b.id, owner)).body.items;
  assert.equal(asks.length, 3); assert.ok(asks.every((a: any) => a.status === 'done'));
});

test('discounts: the figures are checked again at the last step, and a send-back closes the ask', async () => {
  await setFlow('discount', { steps: [anyone('Manager check')] });
  const b = await walkIn(90000, '09:00');
  const owed = b.totalPaise - b.paidPaise;
  const ask = (await h.post(`/api/staff/bookings/${b.id}/discount`, { amountPaise: owed, reason: 'Whole balance' }, staff)).body;
  assert.equal(ask.status, 'waiting');
  run('UPDATE bookings SET paid_paise = paid_paise + 100 WHERE id = ?', b.id);
  const item = (await open()).find((x) => x.kind === 'discount');
  const a = await h.post(`${R}/${item.id}/approve`, {}, owner);
  assert.equal(a.status, 409); assert.equal(a.body.error.code, 'FIGURES_CHANGED');
  assert.equal((await booking(b.id)).discountPaise, 0);
  assert.equal((await h.post(`${R}/${item.id}/send-back`, { note: 'Ask again for the new balance' }, owner)).status, 200);
  const after = (await h.get('/api/accounting/approvals/asks?targetId=' + b.id, staff)).body.items[0];
  assert.equal(after.status, 'sent_back'); assert.equal(after.decidedNote, 'Ask again for the new balance');
});

test('fee waivers: with no rule the fee drops at once; with a rule it waits, and the asker can take it back', async () => {
  const f = await fee();
  const w1 = await h.post(`/api/staff/academy/fees/${f.id}/waive`, { amountPaise: 50000, reason: 'Sibling discount' }, staff);
  assert.equal(w1.status, 200, JSON.stringify(w1.body)); assert.equal(w1.body.status, 'done');
  let l = (await h.get('/api/staff/academy/fees?month=2026-10', owner)).body;
  assert.equal(l.items[0].amountPaise, 250000); assert.equal(l.outstandingPaise, 250000);
  assert.equal((await h.post(`/api/staff/academy/fees/${f.id}/waive`, { amountPaise: 260000, reason: 'Too much' }, staff)).status, 409);

  await setFlow('waiver', { steps: [{ label: 'Owner agrees', who: { type: 'owner' }, overPaise: null }], notSelf: false });
  const w2 = (await h.post(`/api/staff/academy/fees/${f.id}/waive`, { amountPaise: 250000, reason: 'Scholarship' }, staff)).body;
  assert.equal(w2.status, 'waiting');
  const item = (await open(clerk)).find((x) => x.kind === 'waiver');
  assert.equal(item.canSign, false); assert.match(item.whyNot, /owner/);
  assert.equal((await h.post(`/api/accounting/approvals/asks/${w2.id}/withdraw`, {}, clerk)).status, 403);
  assert.equal((await h.post(`/api/accounting/approvals/asks/${w2.id}/withdraw`, {}, staff)).body.status, 'withdrawn');
  assert.equal((await open()).length, 0);
  const w3 = (await h.post(`/api/staff/academy/fees/${f.id}/waive`, { amountPaise: 250000, reason: 'Scholarship' }, staff)).body;
  const it3 = (await open()).find((x) => x.kind === 'waiver');
  assert.equal((await h.post(`${R}/${it3.id}/approve`, { note: 'Agreed' }, owner)).status, 200);
  l = (await h.get('/api/staff/academy/fees?month=2026-10', owner)).body;
  assert.equal(l.items[0].status, 'paid'); assert.equal(l.outstandingPaise, 0);
  assert.equal((await h.get('/api/accounting/approvals/asks?status=done', owner)).body.items.filter((a: any) => a.id === w3.id).length, 1);
});

test('expenses: recorded at once with no rule; above the amount in the rule they wait and are recorded at the last step', async () => {
  const acct = await cashAccount();
  const body = (amountPaise: number, description: string) => ({ accountId: acct, date: dayFromNow(0), amountPaise, description });
  const t1 = await h.post('/api/accounting/transactions', body(-50000, 'Ball boxes'), staff);
  assert.equal(t1.status, 201, 'unchanged: money out is recorded straight away');
  assert.equal(t1.body.amountPaise, -50000);

  await setFlow('expense', { steps: [anyone('Second pair of eyes', 100000)] });
  assert.equal((await h.post('/api/accounting/transactions', body(-60000, 'Chalk'), staff)).status, 201, 'below the amount');
  assert.equal((await h.post('/api/accounting/transactions', body(500000, 'Sponsor money'), staff)).status, 201, 'money in never waits');
  const big = await h.post('/api/accounting/transactions', body(-250000, 'Roller repair'), staff);
  assert.equal(big.status, 202, JSON.stringify(big.body)); assert.equal(big.body.status, 'waiting');
  const count = async () => (await h.get(`/api/accounting/transactions?accountId=${acct}`, owner)).body.items.length;
  assert.equal(await count(), 3);
  assert.ok((await h.post('/api/accounting/transactions', { ...body(-250000, 'Bad account'), accountId: 'nope' }, staff)).status >= 400, 'checked when sent in');
  const item = (await open()).find((x) => x.kind === 'expense');
  assert.equal(item.amountPaise, 250000);
  assert.equal((await h.post(`${R}/${item.id}/approve`, {}, clerk)).status, 200);
  assert.equal(await count(), 4);
  const ask = (await h.get('/api/accounting/approvals/asks?status=done', owner)).body.items.find((a: any) => a.kind === 'expense');
  assert.ok(ask.resultId);
});

test('Ask AI sees the new kinds: what is waiting and the rules in words', async () => {
  await setFlow('discount', { steps: [anyone('Manager check')] });
  const b = await walkIn(90000, '10:00');
  await h.post(`/api/staff/bookings/${b.id}/discount`, { amountPaise: 10000, reason: 'Regular' }, staff);
  const a = await h.post('/api/staff/ask', { question: 'what approvals are waiting?' }, owner);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.match(JSON.stringify(a.body), /Discounts/);
  const why = await h.post('/api/staff/ask', { question: "why can't I sign?" }, staff);
  assert.match(JSON.stringify(why.body), /asked for this discount/);
});
