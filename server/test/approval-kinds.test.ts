import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, bookAndPay, dayFromNow, DEMO_ACCOUNTS, type Harness, type GroundLite } from './helpers.ts';
import { run } from '../src/db.ts';
import { ROLE_PRESETS } from '@daji/shared';

// Refunds, discounts, fee waivers and expenses go through the same approval rules as bills and pay runs. The standard rules
// the owner chose: a refund needs the owner or the general manager (then the super admin, as before); a discount or a fee
// waiver of ₹1,000 or more needs the owner; an expense of ₹5,000 or more needs a second person. Refunds and discounts are
// only ever seen and signed by the owner and the general manager. What the owner asks for never waits.

let h: Harness; let owner: string, desk: string, gm: string, clerk: string, cust: string, admin: string; let g: GroundLite;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
async function member(name: string, email: string, permissions: string[]) {
  const r = await h.post('/api/staff/team', { name, email, password: 'Team@12345', permissions }, owner);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return (await h.post('/api/auth/login', { email, password: 'Team@12345' })).body.token as string;
}
beforeEach(async () => {
  h.reset();
  owner = await h.login('owner1'); desk = await h.login('staff1'); cust = await h.login('customer'); admin = await h.login('admin');
  // the front desk, with the books and the academy too, so it can ask for everything but sign none of the refunds or discounts
  run('UPDATE users SET permissions = ? WHERE email = ?', JSON.stringify(['manage_bookings', 'record_payments', 'verify_payments', 'manage_academy', 'manage_accounting', 'view_customers']), DEMO_ACCOUNTS.staff1.email);
  gm = await member('Gita Manager', 'gm@daji.test', [...ROLE_PRESETS.general_manager!.permissions, 'manage_accounting']);
  clerk = await member('Books Clerk', 'clerk@daji.test', ['manage_academy', 'manage_accounting']);
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
async function walkIn(paidPaise: number, start = '08:00', slots = 1) {
  const r = await h.post('/api/staff/bookings', { groundId: g.id, date: dayFromNow(2), startTime: start, slots, customer: { name: 'Walk In', phone: '9800000031' }, payment: { method: 'cash', amountPaise: paidPaise } }, desk);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.booking ?? r.body;
}
const detail = async (id: string) => (await h.get(`/api/staff/bookings/${id}`, owner)).body;
const booking = async (id: string) => (await detail(id)).booking;
async function fee() {
  await h.post('/api/staff/academy/students', { name: 'Aarav', guardianName: 'Parent', guardianEmail: 'aarav@example.com' }, owner);
  await h.post('/api/staff/academy/fees', { month: '2026-10', amountPaise: 300000 }, owner);
  return (await h.get('/api/staff/academy/fees?month=2026-10', owner)).body.items[0];
}
async function cashAccount() {
  const r = await h.post('/api/accounting/accounts', { kind: 'cash', name: 'Petty cash', openingPaise: 0 }, owner);
  assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.id as string;
}
async function cancelled() {
  const b = await bookAndPay(h, cust, g.id, dayFromNow(3), '19:00', 1);
  await h.post(`/api/bookings/${b.id}/cancel`, { reason: 'rain' }, cust);
  return { b, refund: (await h.get('/api/staff/refunds?status=pending', desk)).body.items.find((x: any) => x.bookingId === b.id) };
}

test('the standard rules for the four new kinds', async () => {
  const d = (await h.get(F, owner)).body;
  const k = (kind: string) => d.kinds.find((y: any) => y.kind === kind);
  assert.deepEqual(k('refund').flow.steps.map((s: any) => [s.who.type, s.overPaise]), [['anyone', null]]);
  assert.equal(k('refund').area, 'The general manager');
  assert.deepEqual(k('discount').flow.steps.map((s: any) => [s.who.type, s.overPaise]), [['owner', 100000]]);
  assert.deepEqual(k('waiver').flow.steps.map((s: any) => [s.who.type, s.overPaise]), [['owner', 100000]]);
  assert.deepEqual(k('expense').flow.steps.map((s: any) => [s.who.type, s.overPaise]), [['anyone', 500000]]);
  assert.equal(k('expense').flow.notSelf, true);
  for (const x of ['refund', 'discount', 'waiver', 'expense']) assert.equal(k(x).custom, false);
  assert.ok(!d.people.some((p: any) => p.name === 'Walk In'));
});

test('refunds wait for the owner or the general manager; the front desk neither sees nor signs them', async () => {
  const { refund } = await cancelled();
  assert.equal(refund.waitingOnGround, true);
  const a = await h.post(`/api/admin/refunds/${refund.id}/approve`, {}, admin);
  assert.equal(a.status, 409); assert.equal(a.body.error.code, 'WAITING_ON_GROUND');
  assert.ok(!(await open(desk)).some((x) => x.kind === 'refund'), 'not on the front desk board');
  const item = (await open(gm)).find((x) => x.kind === 'refund');
  assert.ok(item); assert.equal(item.entityId, refund.id); assert.equal(item.canSign, true);
  assert.equal((await h.post(`${R}/${item.id}/approve`, {}, desk)).status, 403);
  const s = await h.post(`${R}/${item.id}/approve`, { note: 'checked' }, gm);
  assert.equal(s.status, 200, JSON.stringify(s.body)); assert.equal(s.body.status, 'approved');
  assert.ok(s.body.trail.some((e: any) => e.action === 'cleared'));
  assert.equal((await h.post(`/api/admin/refunds/${refund.id}/approve`, {}, admin)).status, 200);
});

test('refunds: with the rule emptied they go straight to the super admin, as before', async () => {
  await setFlow('refund', { steps: [], notSelf: false });
  const { refund } = await cancelled();
  assert.equal(refund.waitingOnGround, false);
  assert.equal((await open()).length, 0);
  assert.equal((await h.post(`/api/admin/refunds/${refund.id}/approve`, {}, admin)).status, 200);
});

test('refunds: sending one back keeps it waiting from the first step; it is never declined at the ground', async () => {
  await setFlow('refund', { steps: [anyone('First check'), anyone('Second check')], notSelf: false });
  const { b, refund } = await cancelled();
  const refunded = (await h.get(`/api/bookings/${b.id}`, cust)).body.payments[0].refundedPaise;
  let item = (await open()).find((x) => x.kind === 'refund');
  assert.equal((await h.post(`${R}/${item.id}/approve`, {}, gm)).status, 200);
  assert.equal((await h.post(`${R}/${item.id}/send-back`, {}, owner)).status, 400, 'a note is needed');
  const sb = await h.post(`${R}/${item.id}/send-back`, { note: 'Check the booking again' }, owner);
  assert.equal(sb.status, 200, JSON.stringify(sb.body));
  assert.equal(sb.body.status, 'pending'); assert.equal(sb.body.atStep, 0);
  assert.ok(sb.body.steps.every((s: any) => s.state !== 'done'));
  item = (await open()).find((x) => x.kind === 'refund');
  assert.ok(item, 'still on the board');
  const r = (await h.get('/api/staff/refunds?status=pending', desk)).body.items.find((x: any) => x.id === refund.id);
  assert.equal(r.status, 'pending'); assert.equal(r.waitingOnGround, true);
  assert.equal((await h.get(`/api/bookings/${b.id}`, cust)).body.payments[0].refundedPaise, refunded);
});

test('the front desk can request a refund on a payment; the owner or the general manager approves it', async () => {
  const b = await walkIn(90000);
  const pay = (await detail(b.id)).payments[0];
  assert.equal((await h.post(`/api/staff/payments/${pay.id}/refund`, { amountPaise: 20000 }, desk)).status, 400, 'a reason is needed');
  assert.equal((await h.post(`/api/staff/payments/${pay.id}/refund`, { amountPaise: 90100, reason: 'Too much' }, desk)).status, 409);
  assert.equal((await h.post(`/api/staff/payments/${pay.id}/refund`, { amountPaise: 20000, reason: 'Rain' }, clerk)).status, 403, 'needs the payments right');
  const r = await h.post(`/api/staff/payments/${pay.id}/refund`, { amountPaise: 20000, reason: 'Rain stopped play' }, desk);
  assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.waitingOnGround, true);
  const item = (await open(gm)).find((x) => x.kind === 'refund' && x.entityId === r.body.id);
  assert.equal(item.submittedByName, 'Ground Staff');
  assert.equal((await h.post(`${R}/${item.id}/approve`, {}, gm)).status, 200);
  assert.equal((await h.post(`/api/admin/refunds/${r.body.id}/approve`, {}, admin)).status, 200);
});

test('discounts: under ₹1,000 given at once; ₹1,000 or more waits for the owner; only the owner and the GM see them', async () => {
  const b = await walkIn(180000, '08:00', 2);
  const owed = b.totalPaise - b.paidPaise;
  assert.ok(owed >= 150000, `the walk-in owes ${owed}`);
  assert.equal((await h.post(`/api/staff/bookings/${b.id}/discount`, { amountPaise: owed + 100, reason: 'regular' }, desk)).status, 409, 'not more than is owed');
  assert.equal((await h.post(`/api/staff/bookings/${b.id}/discount`, { amountPaise: 10000 }, desk)).status, 400, 'a reason is needed');
  const d1 = await h.post(`/api/staff/bookings/${b.id}/discount`, { amountPaise: 50000, reason: 'Regular customer' }, desk);
  assert.equal(d1.status, 200, JSON.stringify(d1.body)); assert.equal(d1.body.status, 'done');
  assert.equal((await booking(b.id)).discountPaise, 50000);

  const big = await h.post(`/api/staff/bookings/${b.id}/discount`, { amountPaise: 100000, reason: 'Floodlight failed' }, desk);
  assert.equal(big.body.status, 'waiting');
  assert.equal((await booking(b.id)).discountPaise, 50000, 'nothing changes while it waits');
  assert.ok(!(await open(desk)).some((x) => x.kind === 'discount'), 'not on the front desk board');
  const g1 = (await open(gm)).find((x) => x.kind === 'discount');
  assert.equal(g1.canSign, false); assert.match(g1.whyNot, /owner/);
  assert.equal((await h.post(`${R}/${g1.id}/approve`, {}, owner)).status, 200);
  assert.equal((await booking(b.id)).discountPaise, 150000);
});

test('discounts: under a rule the GM can sign; the figures are checked again; a send-back closes the ask', async () => {
  await setFlow('discount', { steps: [anyone('Manager check')] });
  const b = await walkIn(90000, '09:00');
  const owed = b.totalPaise - b.paidPaise;
  const ask = (await h.post(`/api/staff/bookings/${b.id}/discount`, { amountPaise: owed, reason: 'Whole balance' }, desk)).body;
  assert.equal(ask.status, 'waiting');
  const item = (await open(gm)).find((x) => x.kind === 'discount');
  assert.equal(item.canSign, true); assert.equal(item.steps[0].who, 'The general manager');
  run('UPDATE bookings SET paid_paise = paid_paise + 100 WHERE id = ?', b.id);
  const a = await h.post(`${R}/${item.id}/approve`, {}, gm);
  assert.equal(a.status, 409); assert.equal(a.body.error.code, 'FIGURES_CHANGED');
  assert.equal((await booking(b.id)).discountPaise, 0);
  assert.equal((await h.post(`${R}/${item.id}/send-back`, { note: 'Ask again for the new balance' }, gm)).status, 200);
  const after = (await h.get('/api/accounting/approvals/asks?targetId=' + b.id, desk)).body.items[0];
  assert.equal(after.status, 'sent_back'); assert.equal(after.decidedNote, 'Ask again for the new balance');
});

test('fee waivers: under ₹1,000 at once; larger ones wait for the owner, and the asker can take one back', async () => {
  const f = await fee();
  const w1 = await h.post(`/api/staff/academy/fees/${f.id}/waive`, { amountPaise: 50000, reason: 'Sibling discount' }, clerk);
  assert.equal(w1.status, 200, JSON.stringify(w1.body)); assert.equal(w1.body.status, 'done');
  let l = (await h.get('/api/staff/academy/fees?month=2026-10', owner)).body;
  assert.equal(l.items[0].amountPaise, 250000); assert.equal(l.outstandingPaise, 250000);
  assert.equal((await h.post(`/api/staff/academy/fees/${f.id}/waive`, { amountPaise: 260000, reason: 'Too much' }, clerk)).status, 409);

  const w2 = (await h.post(`/api/staff/academy/fees/${f.id}/waive`, { amountPaise: 150000, reason: 'Scholarship' }, clerk)).body;
  assert.equal(w2.status, 'waiting');
  const item = (await open(desk)).find((x) => x.kind === 'waiver');
  assert.equal(item.canSign, false); assert.match(item.whyNot, /owner/);
  assert.equal((await h.post(`/api/accounting/approvals/asks/${w2.id}/withdraw`, {}, desk)).status, 403);
  assert.equal((await h.post(`/api/accounting/approvals/asks/${w2.id}/withdraw`, {}, clerk)).body.status, 'withdrawn');
  assert.equal((await open()).length, 0);
  await h.post(`/api/staff/academy/fees/${f.id}/waive`, { amountPaise: 150000, reason: 'Scholarship' }, clerk);
  const it3 = (await open()).find((x) => x.kind === 'waiver');
  assert.equal((await h.post(`${R}/${it3.id}/approve`, { note: 'Agreed' }, owner)).status, 200);
  l = (await h.get('/api/staff/academy/fees?month=2026-10', owner)).body;
  assert.equal(l.items[0].amountPaise, 100000);
  const w4 = await h.post(`/api/staff/academy/fees/${f.id}/waive`, { amountPaise: 100000, reason: 'Owner decided' }, owner);
  assert.equal(w4.body.status, 'done', 'what the owner asks for never waits');
});

test('expenses: under ₹5,000 recorded at once; ₹5,000 or more needs a second person; the owner never waits', async () => {
  const acct = await cashAccount();
  const body = (amountPaise: number, description: string) => ({ accountId: acct, date: dayFromNow(0), amountPaise, description });
  assert.equal((await h.post('/api/accounting/transactions', body(-450000, 'Ball boxes'), desk)).status, 201);
  assert.equal((await h.post('/api/accounting/transactions', body(900000, 'Sponsor money'), desk)).status, 201, 'money in never waits');
  const big = await h.post('/api/accounting/transactions', body(-750000, 'Roller repair'), desk);
  assert.equal(big.status, 202, JSON.stringify(big.body)); assert.equal(big.body.status, 'waiting');
  const count = async () => (await h.get(`/api/accounting/transactions?accountId=${acct}`, owner)).body.items.length;
  assert.equal(await count(), 2);
  assert.ok((await h.post('/api/accounting/transactions', { ...body(-750000, 'Bad account'), accountId: 'nope' }, desk)).status >= 400, 'checked when sent in');
  const item = (await open(desk)).find((x) => x.kind === 'expense');
  assert.equal(item.amountPaise, 750000); assert.equal(item.canSign, false, 'not the person who entered it');
  assert.equal((await h.post(`${R}/${item.id}/approve`, {}, clerk)).status, 200);
  assert.equal(await count(), 3);
  assert.ok((await h.get('/api/accounting/approvals/asks?status=done', owner)).body.items.find((a: any) => a.kind === 'expense').resultId);
  assert.equal((await h.post('/api/accounting/transactions', body(-900000, 'Owner buys nets'), owner)).status, 201);
});

test('Ask AI sees the new kinds: what is waiting and why someone cannot sign', async () => {
  const b = await walkIn(90000, '10:00');
  await h.post(`/api/staff/bookings/${b.id}/discount`, { amountPaise: Math.min(120000, b.totalPaise - b.paidPaise), reason: 'Regular' }, desk);
  await cancelled();
  const a = await h.post('/api/staff/ask', { question: 'what approvals are waiting?' }, owner);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.match(JSON.stringify(a.body), /Refunds/);
  const why = await h.post('/api/staff/ask', { question: "why can't I sign?" }, gm);
  assert.equal(why.status, 200, JSON.stringify(why.body));
  assert.match(JSON.stringify(why.body), /You can sign|owner/);
  assert.equal((await h.post('/api/staff/ask', { question: 'what approvals are waiting?' }, desk)).status, 200, 'the desk still sees its expenses and waivers');
});
