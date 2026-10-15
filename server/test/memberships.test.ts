import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, advance, DAY, type Harness } from './helpers.ts';
import { run, one } from '../src/db.ts';
import { now } from '../src/clock.ts';
import { istDate, addDays } from '../src/time.ts';
import { statusOf } from '../src/memberships.ts';

let h: Harness; let owner: string, owner2: string, cust: string, staff: string, admin: string;
const B = '/api/desk/memberships';
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset();
  owner = await h.login('owner1'); owner2 = await h.login('owner2'); cust = await h.login('customer'); staff = await h.login('staff1'); admin = await h.login('admin');
});
const today = () => istDate(now());
async function plan(body: Record<string, unknown> = {}, token = owner) {
  const r = await h.post(`${B}/plans`, { name: 'Gold', pricePaise: 300000, durationDays: 30, perks: 'Free nets', ...body }, token);
  assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body as { id: string };
}
async function sell(planId: string, body: Record<string, unknown> = {}, token = owner) {
  return h.post(`${B}/members`, { name: 'Ravi Kumar', phone: '9876500001', planId, method: 'cash', ...body }, token);
}

test('status turns on the end date: active, expiring inside 14 days, expired after', () => {
  const t = '2026-10-15';
  assert.equal(statusOf('2026-10-14', t), 'expired');
  assert.equal(statusOf('2026-10-15', t), 'expiring');
  assert.equal(statusOf('2026-10-29', t), 'expiring');
  assert.equal(statusOf('2026-10-30', t), 'active');
});

test('plans: create, validate, edit, switch off, delete, no duplicates', async () => {
  const p = await plan();
  assert.equal((await h.post(`${B}/plans`, { name: 'gold', pricePaise: 1, durationDays: 1 }, owner)).status, 409);
  const bad = await h.post(`${B}/plans`, { name: 'x', pricePaise: -5, durationDays: 0 }, owner);
  assert.equal(bad.status, 400);
  assert.ok(bad.body.error.details.fields.length >= 3);
  const up = await h.patch(`${B}/plans/${p.id}`, { pricePaise: 350000, active: false }, owner);
  assert.equal(up.body.pricePaise, 350000); assert.equal(up.body.active, false); assert.equal(up.body.name, 'Gold');
  assert.equal((await sell(p.id)).status, 409, 'a switched-off plan cannot be sold');
  assert.equal((await h.del(`${B}/plans/${p.id}`, owner)).status, 200);
  assert.equal((await h.get(`${B}/plans`, owner)).body.items.length, 0);
});

test('selling sets the period, takes the plan price and records the payment', async () => {
  const p = await plan();
  const r = await sell(p.id, { method: 'upi', reference: '412345678901' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.startDate, today());
  assert.equal(r.body.endDate, addDays(today(), 29));
  assert.equal(r.body.status, 'active');
  assert.equal(r.body.paidPaise, 300000);
  const d = (await h.get(`${B}/members/${r.body.id}`, owner)).body;
  assert.equal(d.payments.length, 1);
  assert.equal(d.payments[0].reference, '412345678901'); assert.equal(d.payments[0].kind, 'sale');
});

test('UPI and bank payments need a reference; the phone is checked and cannot repeat', async () => {
  const p = await plan();
  const noRef = await sell(p.id, { method: 'upi' });
  assert.equal(noRef.status, 400); assert.equal(noRef.body.error.details.fields[0].field, 'reference');
  assert.equal((await sell(p.id, { phone: '12345' })).status, 400);
  const ok = await sell(p.id, { phone: '+91 98765 00001' });
  assert.equal(ok.status, 201); assert.equal(ok.body.phone, '9876500001');
  const dup = await sell(p.id, { name: 'Someone Else' });
  assert.equal(dup.status, 409); assert.equal(dup.body.error.code, 'MEMBER_EXISTS');
});

test('renewing before the end extends from the end; after it lapses it starts today', async () => {
  const p = await plan({ durationDays: 10 });
  const m = (await sell(p.id)).body;
  const r1 = await h.post(`${B}/members/${m.id}/renew`, { method: 'cash', amountPaise: 250000 }, owner);
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.equal(r1.body.endDate, addDays(m.startDate, 19));
  assert.equal(r1.body.renewals, 1); assert.equal(r1.body.paidPaise, 550000);
  advance(40 * DAY); owner = await h.login('owner1');
  assert.equal((await h.get(`${B}/members/${m.id}`, owner)).body.status, 'expired');
  const r2 = await h.post(`${B}/members/${m.id}/renew`, { method: 'bank_transfer', reference: 'NEFT123' }, owner);
  assert.equal(r2.body.startDate, m.startDate);
  assert.equal(r2.body.endDate, addDays(today(), 9));
  assert.equal(r2.body.status, 'expiring');
  const pays = (await h.get(`${B}/members/${m.id}`, owner)).body.payments;
  assert.equal(pays.length, 3); assert.equal(pays[0].periodStart, today());
});

test('expiring list, stats and filters', async () => {
  const short = await plan({ name: 'Weekly', durationDays: 7, pricePaise: 100000 });
  const long = await plan({ name: 'Annual', durationDays: 365, pricePaise: 1000000 });
  await sell(short.id, { name: 'Asha Mehta', phone: '9876500002' });
  await sell(long.id, { name: 'Bala Rao', phone: '9876500003' });
  await sell(short.id, { name: 'Chetan Shah', phone: '9876500004' });
  advance(10 * DAY); owner = await h.login('owner1'); // both weekly ones have lapsed
  await sell(short.id, { name: 'Dev Patel', phone: '9876500005' });
  const exp = (await h.get(`${B}/expiring`, owner)).body.items;
  assert.deepEqual(exp.map((m: any) => m.name), ['Dev Patel']);
  const s = (await h.get(`${B}/stats`, owner)).body;
  assert.equal(s.active, 1); assert.equal(s.expiring, 1); assert.equal(s.expired, 2); assert.equal(s.total, 4);
  assert.equal(s.revenueMonthPaise + s.revenueLastMonthPaise, 100000 * 3 + 1000000);
  const by = async (q: string) => (await h.get(`${B}/members?${q}`, owner)).body;
  assert.equal((await by('status=expired')).total, 2);
  assert.deepEqual((await by('q=bala')).items.map((m: any) => m.name), ['Bala Rao']);
  assert.equal((await by('q=0004')).total, 1);
  assert.equal((await by(`planId=${long.id}`)).total, 1);
  assert.equal((await by('status=active')).items[0].name, 'Bala Rao');
});

test('revenue this month counts only this month, in paise', async () => {
  const p = await plan({ pricePaise: 123456 });
  await sell(p.id);
  const s1 = (await h.get(`${B}/stats`, owner)).body;
  assert.equal(s1.revenueMonthPaise, 123456); assert.equal(s1.salesThisMonth, 1);
  advance(45 * DAY); owner = await h.login('owner1');
  const s2 = (await h.get(`${B}/stats`, owner)).body;
  assert.equal(s2.revenueMonthPaise, 0);
});

test('plans in use cannot be deleted; members can be edited', async () => {
  const p = await plan();
  const m = (await sell(p.id)).body;
  const del = await h.del(`${B}/plans/${p.id}`, owner);
  assert.equal(del.status, 409); assert.equal(del.body.error.code, 'PLAN_IN_USE');
  const ed = await h.patch(`${B}/members/${m.id}`, { name: 'Ravi K', notes: 'Prefers mornings' }, owner);
  assert.equal(ed.body.name, 'Ravi K'); assert.equal(ed.body.notes, 'Prefers mornings'); assert.equal(ed.body.phone, '9876500001');
  assert.equal((await h.get(`${B}/plans`, owner)).body.items[0].members, 1);
});

test('every change lands in the audit log', async () => {
  const p = await plan();
  const m = (await sell(p.id)).body;
  await h.post(`${B}/members/${m.id}/renew`, { method: 'cash' }, owner);
  const a = (await h.get(`${B}/audit`, owner)).body;
  assert.deepEqual(a.items.map((e: any) => e.action), ['membership.renew', 'membership.sell', 'membership.plan.create']);
  assert.equal(a.items[0].detail.method, 'cash');
});

test('permissions and owner isolation', async () => {
  const p = await plan();
  const m = (await sell(p.id)).body;
  assert.equal((await h.get(`${B}/stats`, cust)).status, 403);
  assert.equal((await h.get(`${B}/stats`, null)).status, 401);
  assert.equal((await h.get(`${B}/stats`, staff)).status, 200, 'staff with manage_bookings');
  run(`UPDATE users SET permissions = '["view_customers"]' WHERE email = 'staff1@daji.test'`);
  const denied = await h.get(`${B}/stats`, staff);
  assert.equal(denied.status, 403, JSON.stringify(one('SELECT permissions FROM users WHERE email = ?', 'staff1@daji.test')));
  assert.equal((await h.post(`${B}/plans`, { name: 'X1', pricePaise: 1, durationDays: 1 }, staff)).status, 403);
  assert.equal((await h.get(`${B}/members/${m.id}`, owner2)).status, 404);
  assert.equal((await h.post(`${B}/members/${m.id}/renew`, { method: 'cash' }, owner2)).status, 404);
  assert.equal((await h.get(`${B}/members`, owner2)).body.total, 0);
  assert.equal((await h.post(`${B}/members`, { name: 'Zed Zed', phone: '9876500009', planId: p.id, method: 'cash' }, owner2)).status, 404, 'another owner plan');
  assert.equal((await h.get(`${B}/stats`, admin)).status, 400, 'super admin must name an owner');
  assert.equal((await h.get(`${B}/stats?ownerId=${one<{ id: string }>('SELECT id FROM users WHERE email = ?', 'owner1@daji.test')!.id}`, admin)).status, 200);
});

// ------------------------------------------------------------------ ledger posting

async function acct(kind: 'bank' | 'cash', name: string): Promise<string> {
  const r = await h.post('/api/accounting/accounts', { kind, name }, owner); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.id;
}
const ledgerRows = async () => (await h.get('/api/accounting/transactions?limit=50', owner)).body.items as any[];

test('a sale and a renewal each post income in Memberships and keep the transaction id on the payment', async () => {
  const bank = await acct('bank', 'Main bank'), till = await acct('cash', 'Till');
  const p = await plan();
  const sold = await sell(p.id, { method: 'upi', reference: 'UTR1' });
  assert.equal(sold.status, 201, JSON.stringify(sold.body));
  assert.equal(sold.body.ledger.accountId, bank);
  let rows = await ledgerRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amountPaise, 300000); assert.equal(rows[0].date, today()); assert.equal(rows[0].categoryName, 'Club memberships');
  assert.equal(rows[0].description, 'Membership sale Gold Ravi Kumar');
  const ren = await h.post(`${B}/members/${sold.body.id}/renew`, { method: 'cash', amountPaise: 250000 }, owner);
  assert.equal(ren.status, 200, JSON.stringify(ren.body));
  assert.equal(ren.body.ledger.accountId, till);
  rows = await ledgerRows();
  assert.equal(rows.length, 2);
  assert.ok(rows.some((r) => r.amountPaise === 250000 && r.description === 'Membership renewal Gold Ravi Kumar' && r.accountId === till));
  const pays = (await h.get(`${B}/members/${sold.body.id}`, owner)).body.payments as any[];
  assert.equal(pays.length, 2);
  assert.deepEqual(pays.map((x) => x.ledgerTxnId).sort(), rows.map((r) => r.id).sort());
});

test('without an account the payment is still recorded, with ledger null; a free plan posts nothing', async () => {
  const p = await plan();
  const sold = await sell(p.id);
  assert.equal(sold.status, 201); assert.equal(sold.body.ledger, null); assert.equal(sold.body.paidPaise, 300000);
  assert.equal((await h.get(`${B}/members/${sold.body.id}`, owner)).body.payments[0].ledgerTxnId, null);
  assert.equal((await ledgerRows()).length, 0);
  await acct('bank', 'Main bank');
  const free = await plan({ name: 'Trial', pricePaise: 0 });
  const t = await sell(free.id, { phone: '9876500002', name: 'Asha' });
  assert.equal(t.status, 201); assert.equal(t.body.ledger, null); assert.equal((await ledgerRows()).length, 0);
});

test('a refused sale (duplicate phone) posts nothing; another owner has their own books', async () => {
  await acct('bank', 'Main bank');
  const p = await plan();
  assert.equal((await sell(p.id)).status, 201);
  assert.equal((await sell(p.id)).status, 409);
  assert.equal((await ledgerRows()).length, 1);
  assert.equal((await h.get('/api/accounting/transactions?limit=50', owner2)).body.items.length, 0);
});
