import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, bookAndPay, dayFromNow, type Harness } from './helpers.ts';
import { addDays } from '../src/time.ts';

// The operations calendar and the money flow gather what the desk already holds. Each person sees only the parts they can already open.
let h: Harness, owner: string, staff: string, cust: string, owner2: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => { h.reset(); owner = await h.login('owner1'); staff = await h.login('staff1'); cust = await h.login('customer'); owner2 = await h.login('owner2'); });

const month = dayFromNow(0).slice(0, 7);

async function billDue(days: number, amountPaise = 250000) {
  const v = await h.post('/api/accounting/vendors', { name: `Turf Supplies ${days}` }, owner);
  assert.equal(v.status, 201, JSON.stringify(v.body));
  const b = await h.post('/api/accounting/bills', { vendorId: v.body.id, billNo: `INV-${days}`, billDate: dayFromNow(-3), dueDate: dayFromNow(days), amountPaise }, owner);
  assert.equal(b.status, 201, JSON.stringify(b.body));
  return b.body;
}

test('the calendar puts bookings, jobs, bills, month-end and payroll on their days for the owner', async () => {
  const g = (await grounds(h)).find((x) => x.name === 'Cricket Ground')!;
  await bookAndPay(h, cust, g.id, dayFromNow(1), '07:00');
  await bookAndPay(h, cust, g.id, dayFromNow(1), '09:00');
  assert.equal((await h.post('/api/tasks', { title: 'Roll the pitch', photosRequired: 0, dueDate: dayFromNow(2) }, owner)).status, 201);
  await billDue(3);
  const r = await h.get(`/api/desk/calendar?month=${month}`, owner);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const on = (kind: string) => r.body.items.filter((i: any) => i.kind === kind);
  assert.equal(on('bookings').length, 1);
  assert.equal(on('bookings')[0].date, dayFromNow(1));
  assert.equal(on('bookings')[0].title, '2 bookings');
  assert.ok(on('bookings')[0].amountPaise > 0);
  assert.equal(on('task')[0].date, dayFromNow(2));
  assert.equal(on('bill')[0].date, dayFromNow(3));
  assert.equal(on('bill')[0].amountPaise, 250000);
  assert.equal(on('close').length, 1);
  assert.equal(on('payroll').length, 1);
  assert.equal(on('close')[0].date, r.body.to);
  assert.equal((await h.get('/api/desk/calendar?month=2026-13', owner)).status, 400);
});

test('a team member sees only the parts of the calendar their permissions open, and never money they cannot see', async () => {
  const g = (await grounds(h)).find((x) => x.name === 'Cricket Ground')!;
  await bookAndPay(h, cust, g.id, dayFromNow(1), '07:00');
  await billDue(3);
  const r = await h.get(`/api/desk/calendar?month=${month}`, staff);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const kinds = new Set(r.body.items.map((i: any) => i.kind));
  assert.ok(kinds.has('bookings'));
  for (const k of ['bill', 'close', 'payroll', 'compliance', 'fees']) assert.ok(!kinds.has(k), `${k} is hidden`);
  assert.ok(!r.body.kinds.includes('payroll'));
  assert.equal(r.body.items.find((i: any) => i.kind === 'bookings').amountPaise, undefined, 'no revenue without "Can see revenue"');
  assert.equal((await h.get(`/api/desk/calendar?month=${month}`, cust)).status, 403);
  // another owner's business stays out
  const other = await h.get(`/api/desk/calendar?month=${month}`, owner2);
  assert.equal(other.body.items.filter((i: any) => i.kind === 'bookings' || i.kind === 'bill').length, 0);
});

test('the money flow follows a booking from earned to collected, and a paid bill into paid out', async () => {
  const g = (await grounds(h)).find((x) => x.name === 'Cricket Ground')!;
  const b = await bookAndPay(h, cust, g.id, dayFromNow(1), '07:00');
  const bill = await billDue(3, 125000);
  assert.equal((await h.post(`/api/accounting/bills/${bill.id}/submit`, {}, owner)).status, 200);
  assert.equal((await h.post(`/api/accounting/bills/${bill.id}/approve`, {}, owner)).status, 200);
  assert.equal((await h.post(`/api/accounting/bills/${bill.id}/pay`, { paidDate: dayFromNow(0), method: 'cash' }, owner)).status, 200);
  const r = await h.get(`/api/desk/money-flow?month=${month}`, owner);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const c = r.body.current;
  assert.equal(c.month, month);
  assert.equal(c.earned.bookingsPaise, b.totalPaise);
  assert.equal(c.collected.bookingsPaise, b.paidPaise);
  assert.equal(c.toCollectPaise, b.totalPaise - b.paidPaise);
  assert.equal(c.paidOut.billsPaise, 125000);
  assert.equal(r.body.trend.length, 6);
  assert.equal(r.body.trend[5].month, month);
  assert.equal((await h.get(`/api/desk/money-flow?month=${month}`, staff)).status, 403, 'staff without the books permission');
  assert.equal((await h.get(`/api/desk/money-flow?month=${month}`, owner2)).body.current.earned.totalPaise, 0);
});

test('the activity feed lists the business\'s events with the next step, and hides what a login cannot open', async () => {
  const g = (await grounds(h)).find((x) => x.name === 'Cricket Ground')!;
  const b = await bookAndPay(h, cust, g.id, dayFromNow(1), '07:00');
  const bill = await billDue(3);
  assert.equal((await h.post(`/api/accounting/bills/${bill.id}/submit`, {}, owner)).status, 200);
  const r = await h.get('/api/desk/activity', owner);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const submit = r.body.items.find((i: any) => i.action === 'bill.submit');
  assert.equal(submit.cta, 'Approve'); assert.equal(submit.href, '/approvals'); assert.equal(submit.area, 'books');
  const confirm = r.body.items.find((i: any) => i.action === 'booking.confirm');
  assert.equal(confirm.href, `/bookings/${b.id}`);
  assert.ok(r.body.items.every((i: any, k: number, a: any[]) => k === 0 || a[k - 1].id > i.id), 'newest first');
  // paging
  const one = await h.get('/api/desk/activity?limit=1', owner);
  assert.equal(one.body.items.length, 1);
  const two = await h.get(`/api/desk/activity?limit=1&before=${one.body.next}`, owner);
  assert.ok(two.body.items[0].id < one.body.items[0].id);
  // the team member sees bookings but not the books, and no amounts
  const s = await h.get('/api/desk/activity', staff);
  assert.equal(s.status, 200);
  assert.ok(s.body.items.some((i: any) => i.area === 'bookings'));
  assert.ok(!s.body.items.some((i: any) => i.area === 'books' || i.area === 'owner'));
  assert.ok(s.body.items.every((i: any) => i.detail === null));
  assert.equal((await h.get('/api/desk/activity', owner2)).body.items.filter((i: any) => i.entityId === b.id || i.entityId === bill.id).length, 0);
  assert.equal((await h.get('/api/desk/activity', cust)).status, 403);
});

test('the month-end close lists eight checks; uncategorised lines block the sign-off; staff without the books are refused', async () => {
  const last = (await h.get('/api/desk/close', owner)).body;
  assert.equal(last.month, addDays(dayFromNow(0).slice(0, 7) + '-01', -1).slice(0, 7), 'the month just gone');
  assert.equal(last.over, true);
  const month = month0();
  const r = await h.get(`/api/desk/close?month=${month}`, owner);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.steps.map((s: any) => s.key), ['statements', 'categorise', 'reconcile', 'upi', 'balances', 'bills', 'payroll', 'signoff']);
  const a = await h.post('/api/accounting/accounts', { kind: 'bank', name: 'Daji Current A/c', bankName: 'HDFC Bank', last4: '4321', openingPaise: 0, openingDate: `${month}-01` }, owner);
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal((await h.post('/api/accounting/transactions', { accountId: a.body.id, date: `${month}-02`, amountPaise: -5000, description: 'Diesel' }, owner)).status, 201);
  const after = (await h.get(`/api/desk/close?month=${month}`, owner)).body.steps;
  const cat = after.find((s: any) => s.key === 'categorise');
  assert.equal(cat.state, 'todo'); assert.equal(cat.count, 1); assert.equal(cat.blocks, true);
  assert.equal(after.find((s: any) => s.key === 'statements').state, 'todo', 'no lines in the last week');
  assert.equal((await h.get(`/api/desk/close?month=${month}`, staff)).status, 403);
  assert.equal((await h.get('/api/desk/close?month=2026-13', owner)).status, 400);
});
const month0 = () => dayFromNow(0).slice(0, 7);
