import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, bookAndPay, dayFromNow, slotStart, setNow, T0, DAY, MIN, DEMO_ACCOUNTS, type Harness, type GroundLite } from './helpers.ts';
import { buildScenario } from './scenario.ts';
import { register } from './register.ts';
import { many, one, run } from '../src/db.ts';
import { runSweeps } from '../src/jobs.ts';
import { balanceSheet, trialBalance, profitAndLoss, type BalanceSheet } from '../src/accounting/statements.ts';
import { gstInside } from '../src/accounting/ledger.ts';
import { readXlsx } from '../src/accounting/xlsx.ts';
import { addDays } from '../src/time.ts';

let h: Harness;
let main: GroundLite, nets: GroundLite, riverside: GroundLite;
let owner: string, owner2: string, admin: string, staff: string, cust: string;
let ownerId: string, owner2Id: string;
let b: Awaited<ReturnType<typeof buildScenario>>['b'];

before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });

const TODAY = () => dayFromNow(10);

beforeEach(async () => {
  const sc = await buildScenario(h);
  ({ main, nets, riverside, owner, owner2, admin, staff, cust, ownerId, owner2Id } = sc);
  b = sc.b;
});

const get = (path: string, token = owner) => h.get(path, token);
const sheet = (asOf = TODAY()): BalanceSheet => balanceSheet(ownerId, asOf);
const row = (s: BalanceSheet, code: string): number => {
  for (const side of [s.assets, s.liabilities, s.equity]) for (const g of side.groups) for (const r of g.rows) if (r.code === code) return r.paise;
  return 0;
};
const sum = (xs: number[]) => xs.reduce((a, c) => a + c, 0);
const bookingRow = (id: string) => one<any>('SELECT * FROM bookings WHERE id = ?', id)!;

// ------------------------------------------------------------------ the books balance

test('the balance sheet and the trial balance balance on every day', () => {
  for (let d = dayFromNow(-3); d <= addDays(TODAY(), 120); d = addDays(d, 1)) {
    const s = sheet(d);
    assert.equal(s.balanced, true, `balance sheet out by ${s.differencePaise} on ${d}`);
    const t = trialBalance(ownerId, d);
    assert.equal(t.balanced, true, `trial balance out on ${d}`);
    assert.equal(t.totalDebitPaise, t.totalCreditPaise);
  }
  assert.ok(sheet().totalAssetsPaise > 0, 'the money customers paid is an asset');
});

test('money held for sessions not yet played equals what was paid on them', async () => {
  const expected = one<{ s: number }>("SELECT SUM(paid_paise) s FROM bookings WHERE owner_id = ? AND status = 'confirmed' AND end_at > ?", ownerId, T0 + 10 * DAY)!.s;
  assert.equal(expected, b.future.paidPaise + b.future2.paidPaise);
  assert.equal(row(sheet(), 'customer_advances'), expected);
  const f = (await get('/api/accounting/reports/schedule/future')).body;
  assert.equal(f.advancesHeldPaise, expected, 'the schedule and the balance sheet say the same');
});

test('account credit owed equals the credit lots that have not expired', () => {
  const lots = one<{ s: number }>('SELECT SUM(remaining_paise) s FROM credit_lots WHERE owner_id = ? AND expires_at > ?', ownerId, T0 + 10 * DAY)!.s;
  assert.ok(lots > 0, 'the late cancellation gave credit');
  assert.equal(row(sheet(), 'customer_credits'), lots);
});

test('what customers still owe for played sessions is a receivable, and paying it later settles it', async () => {
  const owed = b.owing.totalPaise - b.owing.paidPaise;
  assert.equal(row(sheet(), 'receivables'), owed);
  const cash0 = row(sheet(), 'cash_bookings');
  const income0 = profitAndLoss(ownerId, { from: '2026-10-01', to: '2026-10-31' }).revenue.totalPaise;
  assert.equal((await h.post(`/api/staff/bookings/${b.owing.id}/payments`, { method: 'cash', amountPaise: owed }, staff)).status, 201);
  const s = sheet();
  assert.equal(row(s, 'receivables'), 0);
  assert.equal(row(s, 'cash_bookings'), cash0 + owed);
  assert.equal(s.balanced, true);
  assert.equal(profitAndLoss(ownerId, { from: '2026-10-01', to: '2026-10-31' }).revenue.totalPaise, income0, 'collecting what was owed is not new income');
});

// ------------------------------------------------------------------ profit and loss

const group = (p: any, section: 'revenue' | 'expenses', name: string) => p[section].groups.find((g: any) => g.name === name);

test('booking income is counted when the session is played; advances kept from no-shows and late cancellations are added', async () => {
  const r = await get('/api/accounting/reports/pnl?month=2026-10');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const late = bookingRow(b.late.id);
  const kept = late.paid_paise - late.credit_paise - late.refund_paise;
  assert.ok(kept > 0, 'half the advance is kept');
  const income = b.played.totalPaise + b.owing.totalPaise;
  const freeRow = bookingRow(b.free.id);
  const freeKept = freeRow.paid_paise - freeRow.credit_paise - freeRow.refund_paise;
  assert.ok(freeKept > 0, 'a free cancellation refunded to the payment method keeps half');
  const forfeited = b.noShow.paidPaise + kept + freeKept;
  const bookings = group(r.body, 'revenue', 'Bookings');
  assert.equal(bookings.rows.find((x: any) => x.code === 'booking_income').paise, income);
  assert.equal(bookings.rows.find((x: any) => x.code === 'forfeited_income').paise, forfeited);
  assert.equal(r.body.revenue.totalPaise, income + forfeited);
  assert.equal(r.body.netProfitPaise, income + forfeited);
  assert.equal(r.body.basis, 'accrual');
  assert.ok(r.body.notes.some((n: string) => /played, not the day it was paid/.test(n)));
  // Sessions still to come earn nothing; the free cancellation only the share that is kept.
  const earlier = (await get('/api/accounting/reports/pnl?from=2026-10-01&to=2026-10-15')).body;
  assert.equal(earlier.revenue.totalPaise, freeKept);
});

test('the profit and loss can be compared with the month before', async () => {
  const r = await get('/api/accounting/reports/pnl?month=2026-10&compare=1');
  assert.deepEqual(r.body.previous.range, { from: '2026-09-01', to: '2026-09-30' });
  assert.equal(r.body.previousNetProfitPaise, 0);
  assert.equal(r.body.revenue.previousTotalPaise, 0);
  const rows = group(r.body, 'revenue', 'Bookings').rows;
  assert.ok(rows.every((x: any) => x.previousPaise === 0));
});

test('GST that is inside the price is split out of income and owed on the balance sheet', async () => {
  assert.equal((await h.patch('/api/accounting/settings', { gstPercent: 18 }, owner)).status, 200);
  const played = [b.played, b.owing];
  const gst = sum(played.map((x) => gstInside(x.totalPaise, 18)));
  const p = (await get('/api/accounting/reports/pnl?month=2026-10')).body;
  assert.equal(group(p, 'revenue', 'Bookings').rows.find((x: any) => x.code === 'booking_income').paise, sum(played.map((x) => x.totalPaise)) - gst);
  assert.ok(p.notes.some((n: string) => /18% GST/.test(n)));
  const s = sheet();
  assert.equal(row(s, 'gst_payable'), gst);
  assert.equal(s.balanced, true);
});

test('cash basis counts money when it arrives and leaves out credit and refunded money', async () => {
  const from = `${dayFromNow(-1)}`;
  const p = (await get(`/api/accounting/reports/pnl?from=${from}&to=2026-10-31&basis=cash`)).body;
  assert.equal(p.basis, 'cash');
  const got = one<{ s: number }>("SELECT SUM(amount_paise) s FROM payments WHERE owner_id = ? AND status IN ('captured','refunded','partially_refunded') AND method <> 'credit'", ownerId)!.s;
  const back = one<{ s: number | null }>("SELECT SUM(amount_paise) s FROM refunds WHERE owner_id = ? AND status <> 'failed'", ownerId)!.s ?? 0;
  assert.ok(back > 0, 'the free cancellation was refunded');
  assert.equal(p.revenue.totalPaise, got - back);
  assert.ok(p.notes.some((n: string) => /Cash basis/.test(n)));
  assert.ok(p.revenue.groups[0].rows.every((x: any) => x.code !== 'booking_income'));
});

// ------------------------------------------------------------------ schedules

const dayKeys = ['day', 'week', 'month'] as const;

test('past schedule: what was played, missed and cancelled, tying to the profit and loss', async () => {
  const r = await get('/api/accounting/reports/schedule/past?month=2026-10&groupBy=week');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const s = r.body.summary;
  const pnl = (await get('/api/accounting/reports/pnl?month=2026-10')).body;
  assert.equal(s.sessions, 2);
  assert.equal(s.valuePaise, b.played.totalPaise + b.owing.totalPaise);
  assert.equal(s.collectedPaise, b.played.totalPaise + b.owing.paidPaise);
  assert.equal(s.outstandingPaise, b.owing.totalPaise - b.owing.paidPaise);
  assert.equal(s.noShows, 1);
  assert.equal(s.noShowKeptPaise, b.noShow.paidPaise);
  assert.equal(s.cancelledInTime, 1);
  assert.equal(s.cancelledLate, 1);
  assert.equal(s.cancellations, 2);
  const free = bookingRow(b.free.id);
  const late = bookingRow(b.late.id);
  assert.equal(s.cancelRefundedPaise, free.refund_paise + late.refund_paise);
  assert.equal(s.cancelCreditedPaise, free.credit_paise + late.credit_paise);
  assert.equal(s.cancelKeptPaise, late.paid_paise - late.credit_paise - late.refund_paise + free.paid_paise - free.credit_paise - free.refund_paise);
  assert.equal(s.earnedPaise, pnl.revenue.totalPaise, 'the schedule and the profit and loss agree');
  for (const k of dayKeys) {
    const g = (await get(`/api/accounting/reports/schedule/past?month=2026-10&groupBy=${k}`)).body;
    for (const f of ['sessions', 'slots', 'valuePaise', 'incomePaise', 'noShows', 'cancellations', 'earnedPaise', 'outstandingPaise']) {
      assert.equal(sum(g.buckets.map((x: any) => x[f])), g.summary[f], `${f} by ${k}`);
    }
    assert.equal(sum(g.byGround.map((x: any) => x.earnedPaise)), g.summary.earnedPaise);
  }
  assert.equal(r.body.total, 5, 'two played, one no-show, two cancelled');
  assert.deepEqual(r.body.items.map((x: any) => x.kind).sort(), ['cancelled_in_time', 'cancelled_late', 'no_show', 'played', 'played']);
  assert.equal(r.body.items.find((x: any) => x.ref === b.owing.ref).duePaise, b.owing.totalPaise - b.owing.paidPaise);
});

test('past schedule: one ground, paging, and the default range', async () => {
  const one1 = (await get(`/api/accounting/reports/schedule/past?month=2026-10&groundId=${nets.id}`)).body;
  assert.equal(one1.summary.sessions, 1);
  assert.equal(one1.summary.cancellations, 1, 'the free cancellation was at the nets');
  assert.equal(one1.summary.noShows, 0);
  const page1 = (await get('/api/accounting/reports/schedule/past?month=2026-10&limit=2&offset=0')).body;
  const page2 = (await get('/api/accounting/reports/schedule/past?month=2026-10&limit=2&offset=2')).body;
  assert.equal(page1.items.length, 2); assert.equal(page2.items.length, 2);
  assert.equal(new Set([...page1.items, ...page2.items].map((x: any) => x.id)).size, 4);
  const dflt = (await get('/api/accounting/reports/schedule/past')).body;
  assert.deepEqual(dflt.range, { from: addDays(TODAY(), -29), to: TODAY() }, 'the last 30 days');
  assert.equal(dflt.summary.sessions, 2);
  assert.equal((await get(`/api/accounting/reports/schedule/past?groundId=${riverside.id}`)).status, 404, 'another owner\'s ground');
});

test('future schedule: confirmed sessions to come, with what is paid and what is still to collect', async () => {
  const r = await get('/api/accounting/reports/schedule/future?groupBy=month');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const s = r.body.summary;
  assert.equal(s.bookings, 2);
  assert.equal(s.slots, 3);
  assert.equal(s.valuePaise, b.future.totalPaise + b.future2.totalPaise);
  assert.equal(s.paidPaise, b.future.paidPaise + b.future2.paidPaise);
  assert.equal(s.duePaise, s.valuePaise - s.paidPaise);
  assert.deepEqual(r.body.range, { from: TODAY(), to: addDays(TODAY(), 89) });
  assert.deepEqual(r.body.items.map((x: any) => x.ref), [b.future2.ref, b.future.ref], 'soonest first');
  assert.ok(r.body.items.every((x: any) => x.kind === 'booked'));
  assert.equal(r.body.holds.count, 0);
  const lots = one<{ s: number }>('SELECT SUM(remaining_paise) s FROM credit_lots WHERE owner_id = ?', ownerId)!.s;
  assert.equal(r.body.credits.outstandingPaise, lots);
  assert.equal(r.body.credits.expiringWithin30DaysPaise, 0);
  for (const k of dayKeys) {
    const g = (await get(`/api/accounting/reports/schedule/future?groupBy=${k}`)).body;
    for (const f of ['bookings', 'slots', 'valuePaise', 'paidPaise', 'duePaise']) assert.equal(sum(g.buckets.map((x: any) => x[f])), g.summary[f], `${f} by ${k}`);
    assert.equal(sum(g.byGround.map((x: any) => x.valuePaise)), g.summary.valuePaise);
  }
  const weekly = (await get('/api/accounting/reports/schedule/future?groupBy=week')).body;
  assert.ok(weekly.buckets.every((x: any) => x.from >= TODAY() && x.to <= addDays(TODAY(), 89)), 'buckets are cut to the range');
  assert.equal(new Date(weekly.buckets[0].key + 'T12:00:00Z').getUTCDay(), 1, 'weeks start on Monday');
  const nets1 = (await get(`/api/accounting/reports/schedule/future?groundId=${nets.id}`)).body;
  assert.equal(nets1.summary.bookings, 1);
  assert.equal(nets1.summary.slots, 2);
  assert.equal((await get('/api/accounting/reports/schedule/future?limit=1&offset=1')).body.items[0].ref, b.future.ref);
});

test('future schedule: a session in progress and an unpaid hold', async () => {
  const x = await h.post('/api/bookings', { groundId: main.id, date: dayFromNow(30), startTime: '09:00', slots: 1 }, cust);
  assert.equal(x.status, 201);
  setNow(slotStart(dayFromNow(20), '18:00') + 10 * MIN);
  owner = await h.login('owner1');
  const f = (await get(`/api/accounting/reports/schedule/future?from=${dayFromNow(20)}&to=${dayFromNow(30)}`)).body;
  assert.equal(f.summary.inProgress, 1);
  assert.equal(f.items[0].kind, 'in_progress');
  assert.equal(f.holds.count, 0, 'the unpaid hold has lapsed by now');
  cust = await h.login('customer');
  const y = await h.post('/api/bookings', { groundId: main.id, date: dayFromNow(30), startTime: '12:00', slots: 1 }, cust);
  assert.equal(y.status, 201);
  const g = (await get(`/api/accounting/reports/schedule/future?from=${dayFromNow(25)}&to=${dayFromNow(40)}`)).body;
  assert.equal(g.holds.count, 1);
  assert.equal(g.holds.valuePaise, y.body.booking.totalPaise);
  assert.equal(g.summary.bookings, 0, 'a hold is not a confirmed booking');
});

test('expired credit is income, and the schedule shows it', async () => {
  const lots = one<{ s: number }>('SELECT SUM(remaining_paise) s FROM credit_lots WHERE owner_id = ?', ownerId)!.s;
  assert.ok(lots > 0);
  setNow(T0 + 10 * DAY + 95 * DAY);
  const out = await runSweeps(h.cfg);
  assert.equal(out.creditsExpiredPaise, lots);
  owner = await h.login('owner1');
  const today = addDays(TODAY(), 95);
  const s = sheet(today);
  assert.equal(row(s, 'customer_credits'), 0);
  assert.equal(s.balanced, true);
  const p = (await get(`/api/accounting/reports/pnl?from=${addDays(TODAY(), 1)}&to=${today}`)).body;
  assert.equal(group(p, 'revenue', 'Bookings').rows.find((x: any) => x.code === 'forfeited_income').paise, lots);
  const past = (await get(`/api/accounting/reports/schedule/past?from=${addDays(TODAY(), 1)}&to=${today}`)).body;
  assert.equal(past.summary.expiredCreditPaise, lots);
});

// ------------------------------------------------------------------ the owner's own books

async function account(body: Record<string, unknown>) {
  const r = await h.post('/api/accounting/accounts', body, owner);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}
async function txn(body: Record<string, unknown>, token = owner) {
  const r = await h.post('/api/accounting/transactions', body, token);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}
const cat = (code: string) => `cat_${code}`;

test('bank accounts, transactions and categories feed the profit and loss and the balance sheet', async () => {
  const a = await account({ kind: 'bank', name: 'Daji Current A/c', bankName: 'HDFC Bank', last4: '4321', openingPaise: 5_000_000, openingDate: '2026-10-01' });
  assert.equal(a.balancePaise, 5_000_000);
  const cash = await account({ kind: 'cash', name: 'Cash drawer' });
  await txn({ accountId: a.id, date: '2026-10-10', amountPaise: -200_000, description: 'MSEB October bill', categoryId: cat('electricity') });
  await txn({ accountId: a.id, date: '2026-10-12', amountPaise: 500_000, description: 'Canteen UPI', categoryId: cat('canteen') });
  await txn({ accountId: a.id, date: '2026-10-13', amountPaise: 1_000_000, description: 'Capital from owner', categoryId: cat('owner_capital') });
  await txn({ accountId: cash.id, date: '2026-10-13', amountPaise: -30_000, description: 'Pitch roller repair', categoryId: cat('repairs') });

  const bookings = group((await get('/api/accounting/reports/pnl?month=2026-10')).body, 'revenue', 'Bookings').rows.reduce((s: number, x: any) => s + x.paise, 0);
  const p = (await get('/api/accounting/reports/pnl?month=2026-10')).body;
  assert.equal(group(p, 'revenue', 'Other income').totalPaise, 500_000);
  assert.equal(group(p, 'expenses', 'Utilities').totalPaise, 200_000);
  assert.equal(group(p, 'expenses', 'Ground upkeep').totalPaise, 30_000);
  assert.equal(p.netProfitPaise, bookings + 500_000 - 230_000, 'owner capital is not income');

  const s = sheet();
  assert.equal(s.balanced, true);
  const bank = s.assets.groups.find((g) => g.name === 'Cash and bank')!;
  assert.equal(bank.rows.find((x) => x.code === `bank:${a.id}`)!.paise, 5_000_000 - 200_000 + 500_000 + 1_000_000);
  assert.equal(bank.rows.find((x) => x.code === `bank:${cash.id}`)!.paise, -30_000);
  assert.ok(bank.rows.find((x) => x.code === `bank:${cash.id}`)!.name.includes('overdrawn'), 'a negative cash balance is flagged');
  assert.equal(row(s, 'capital'), 1_000_000);
  const list = (await get('/api/accounting/accounts')).body.items;
  assert.equal(list.find((x: any) => x.id === a.id).balancePaise, 6_300_000);
  assert.equal(list.find((x: any) => x.id === a.id).transactions, 3);
});

test('an uncategorised transaction is held under "Needs attention" and the report says so', async () => {
  const a = await account({ kind: 'bank', name: 'Main', openingPaise: 100_000, openingDate: '2026-10-01' });
  const t = await txn({ accountId: a.id, date: '2026-10-11', amountPaise: -45_000, description: 'UPI to ramesh@okbank' });
  const before = (await get('/api/accounting/reports/pnl?month=2026-10')).body;
  assert.equal(before.uncategorised.count, 1);
  assert.ok(before.notes.some((n: string) => /1 bank transaction is not categorised/.test(n)));
  assert.equal(group(before, 'expenses', 'Other'), undefined);
  const bs = sheet();
  assert.equal(bs.balanced, true);
  assert.equal(bs.attention.uncategorisedCount, 1);
  assert.equal(bs.assets.groups.find((g) => g.name === 'Needs attention')!.rows[0]!.paise, 45_000, 'money that left the bank and is not explained yet');
  const r = await h.patch(`/api/accounting/transactions/${t.id}`, { categoryId: cat('groundsman') }, owner);
  assert.equal(r.status, 200);
  assert.equal(r.body.categoryName, 'Groundsman & pitch care');
  const after = (await get('/api/accounting/reports/pnl?month=2026-10')).body;
  assert.equal(after.uncategorised.count, 0);
  assert.equal(group(after, 'expenses', 'Ground upkeep').totalPaise, 45_000);
  assert.equal(sheet().balanced, true);
  assert.equal((await h.patch(`/api/accounting/transactions/${t.id}`, { categoryId: null }, owner)).body.categoryId, null, 'a category can be taken off again');
});

test('a custom category appears on the profit and loss, and cannot clash with a built-in one', async () => {
  const c = await h.post('/api/accounting/categories', { name: 'Trophies and prizes', kind: 'expense' }, owner);
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const a = await account({ kind: 'bank', name: 'Main' });
  await txn({ accountId: a.id, date: '2026-10-12', amountPaise: -75_000, description: 'Trophies', categoryId: c.body.id });
  assert.equal(group((await get('/api/accounting/reports/pnl?month=2026-10')).body, 'expenses', 'Other').rows[0].name, 'Trophies and prizes');
  assert.equal((await h.post('/api/accounting/categories', { name: 'Trophies and prizes', kind: 'expense' }, owner)).status, 409);
  assert.equal((await h.post('/api/accounting/categories', { name: 'Water', kind: 'expense' }, owner)).status, 409, 'a built-in category already has this name');
  assert.equal((await h.get('/api/accounting/categories', owner2)).body.items.some((x: any) => x.name === 'Trophies and prizes'), false, 'custom categories are private to the owner');
  assert.equal((await h.patch(`/api/accounting/transactions/${(await txn({ accountId: a.id, date: '2026-10-12', amountPaise: -1, description: 'x1' })).id}`, { categoryId: c.body.id }, owner2)).status, 404);
});

test('transactions can be searched, filtered and paged', async () => {
  const a = await account({ kind: 'bank', name: 'Main' });
  for (let i = 1; i <= 5; i++) await txn({ accountId: a.id, date: `2026-10-0${i}`, amountPaise: i % 2 ? 10_000 * i : -10_000 * i, description: `Entry number ${i}`, categoryId: i === 1 ? cat('canteen') : undefined });
  const all = (await get('/api/accounting/transactions?limit=2')).body;
  assert.equal(all.total, 5); assert.equal(all.items.length, 2);
  assert.equal(all.items[0].date, '2026-10-05', 'newest first');
  assert.equal(all.moneyInPaise, 10_000 + 30_000 + 50_000);
  assert.equal(all.moneyOutPaise, 20_000 + 40_000);
  assert.equal((await get('/api/accounting/transactions?categorised=no')).body.total, 4);
  assert.equal((await get('/api/accounting/transactions?direction=out')).body.total, 2);
  assert.equal((await get('/api/accounting/transactions?q=number%203')).body.total, 1);
  assert.equal((await get('/api/accounting/transactions?q=%25')).body.total, 0, 'a percent sign is just a character');
  assert.equal((await get('/api/accounting/transactions?from=2026-10-02&to=2026-10-03')).body.total, 2);
  assert.equal((await get('/api/accounting/transactions?direction=sideways')).status, 400);
});

test('an account with transactions cannot be removed; an empty one can', async () => {
  const a = await account({ kind: 'bank', name: 'Main' });
  const t = await txn({ accountId: a.id, date: '2026-10-02', amountPaise: 1000, description: 'Something' });
  const no = await h.del(`/api/accounting/accounts/${a.id}`, owner);
  assert.equal(no.status, 409);
  assert.equal(no.body.error.code, 'ACCOUNT_HAS_TRANSACTIONS');
  assert.equal((await h.del(`/api/accounting/transactions/${t.id}`, owner)).status, 200);
  assert.equal((await h.del(`/api/accounting/accounts/${a.id}`, owner)).status, 200);
  assert.equal((await get('/api/accounting/accounts')).body.items.length, 0);
  assert.equal(many('SELECT 1 FROM acct_transactions WHERE deleted_at IS NOT NULL').length, 1, 'removed, not erased');
});

// ------------------------------------------------------------------ journal entries

test('a journal entry records a bill that has not been paid, and feeds both reports', async () => {
  const j = await h.post('/api/accounting/journals', { date: '2026-10-20', memo: 'Pitch repair bill, not yet paid', lines: [
    { account: 'exp:repairs', debitPaise: 120_000 }, { account: 'payables', creditPaise: 120_000 }] }, owner);
  assert.equal(j.status, 201, JSON.stringify(j.body));
  assert.equal(j.body.totalPaise, 120_000);
  assert.equal(j.body.lines[0].accountName, 'Repairs & maintenance');
  const p = (await get('/api/accounting/reports/pnl?month=2026-10')).body;
  assert.equal(group(p, 'expenses', 'Ground upkeep').totalPaise, 120_000);
  const s = sheet();
  assert.equal(row(s, 'payables'), 120_000);
  assert.equal(s.balanced, true);
  const led = (await get('/api/accounting/reports/ledger?account=payables&from=2026-10-01&to=2026-10-31')).body;
  assert.equal(led.closingPaise, 120_000);
  assert.equal(led.entries[0].src, 'journal');
  // Voiding keeps the record and takes it out of the books.
  const v = await h.post(`/api/accounting/journals/${j.body.id}/void`, { reason: 'Entered twice' }, owner);
  assert.equal(v.status, 200);
  assert.equal(v.body.deleteReason, 'Entered twice');
  assert.equal(row(sheet(), 'payables'), 0);
  assert.equal(group((await get('/api/accounting/reports/pnl?month=2026-10')).body, 'expenses', 'Ground upkeep'), undefined);
  assert.equal((await h.post(`/api/accounting/journals/${j.body.id}/void`, { reason: 'again' }, owner)).status, 409);
  assert.equal((await get('/api/accounting/journals')).body.total, 0);
  assert.equal((await get('/api/accounting/journals?includeVoided=1')).body.total, 1);
});

test('a journal entry must balance and may only use accounts that are safe to type into', async () => {
  const post = (body: unknown) => h.post('/api/accounting/journals', body, owner);
  const ok1 = [{ account: 'exp:repairs', debitPaise: 1000 }, { account: 'payables', creditPaise: 1000 }];
  const un = await post({ date: '2026-10-20', memo: 'Does not balance', lines: [{ account: 'exp:repairs', debitPaise: 1000 }, { account: 'payables', creditPaise: 900 }] });
  assert.equal(un.status, 400);
  assert.equal(un.body.error.code, 'UNBALANCED');
  assert.equal(un.body.error.details.differencePaise, 100);
  const a = await account({ kind: 'bank', name: 'Main' });
  const bank = await post({ date: '2026-10-20', memo: 'Straight to the bank', lines: [{ account: `bank:${a.id}`, debitPaise: 1000 }, { account: 'capital', creditPaise: 1000 }] });
  assert.equal(bank.status, 400);
  assert.match(JSON.stringify(bank.body.error.details.fields), /Bank and cash accounts change through their transactions/);
  for (const derived of ['customer_advances', 'booking_income', 'suspense', 'customer_credits']) {
    assert.equal((await post({ date: '2026-10-20', memo: 'Tamper with bookings', lines: [{ account: derived, debitPaise: 1000 }, { account: 'capital', creditPaise: 1000 }] })).status, 400, derived);
  }
  assert.equal((await post({ date: '2026-10-20', memo: 'Both sides', lines: [{ account: 'exp:repairs', debitPaise: 1000, creditPaise: 1000 }, { account: 'payables', creditPaise: 0 }] })).status, 400);
  assert.equal((await post({ date: '2026-10-20', memo: 'One line', lines: [{ account: 'exp:repairs', debitPaise: 1000 }] })).status, 400);
  assert.equal((await post({ date: '2026-10-20', memo: 'Unknown', lines: [{ account: 'exp:nonsense', debitPaise: 1000 }, { account: 'payables', creditPaise: 1000 }] })).status, 400);
  assert.equal((await post({ date: dayFromNow(30), memo: 'In the future', lines: ok1 })).status, 400);
  assert.equal((await post({ date: '2026-10-20', memo: 'x', lines: ok1 })).status, 400, 'a memo of one letter says nothing');
  assert.equal((await get('/api/accounting/journal-accounts')).body.items.some((x: any) => x.code === 'customer_advances'), false);
  assert.equal(many('SELECT 1 FROM acct_journals').length, 0, 'nothing was saved by the failed attempts');
  assert.equal(sheet().balanced, true);
});

// ------------------------------------------------------------------ month-end

test('a signed-off month is locked until it is re-opened', async () => {
  const a = await account({ kind: 'bank', name: 'Main', openingPaise: 100_000, openingDate: '2026-08-01' });
  const t = await txn({ accountId: a.id, date: '2026-09-15', amountPaise: -50_000, description: 'September bill' });
  const refuse = await h.post('/api/accounting/signoffs', { month: '2026-09' }, owner);
  assert.equal(refuse.status, 409);
  assert.equal(refuse.body.error.code, 'UNCATEGORISED_REMAIN');
  await h.patch(`/api/accounting/transactions/${t.id}`, { categoryId: cat('electricity') }, owner);
  assert.equal((await h.post('/api/accounting/signoffs', { month: '2026-10' }, owner)).body.error.code, 'MONTH_NOT_OVER');
  const so = await h.post('/api/accounting/signoffs', { month: '2026-09' }, owner);
  assert.equal(so.status, 201, JSON.stringify(so.body));
  assert.equal(so.body.netProfitPaise, -50_000);
  assert.equal((await h.post('/api/accounting/signoffs', { month: '2026-09' }, owner)).body.error.code, 'ALREADY_SIGNED_OFF');
  assert.deepEqual((await get('/api/accounting/settings')).body.lockedMonths, ['2026-09']);

  for (const [what, r] of [
    ['add', await h.post('/api/accounting/transactions', { accountId: a.id, date: '2026-09-20', amountPaise: 1, description: 'Late entry' }, owner)],
    ['change', await h.patch(`/api/accounting/transactions/${t.id}`, { categoryId: cat('water') }, owner)],
    ['journal', await h.post('/api/accounting/journals', { date: '2026-09-30', memo: 'Month-end accrual', lines: [{ account: 'exp:repairs', debitPaise: 1000 }, { account: 'payables', creditPaise: 1000 }] }, owner)],
  ] as const) {
    assert.equal(r.status, 409, what);
    assert.equal(r.body.error.code, 'PERIOD_LOCKED', what);
  }
  assert.equal((await h.post('/api/accounting/transactions', { accountId: a.id, date: '2026-10-02', amountPaise: 1, description: 'This month is open' }, owner)).status, 201);

  assert.equal((await h.post('/api/accounting/signoffs/reopen', { month: '2026-09', reason: 'Found a missing bill' }, owner)).status, 200);
  assert.equal((await h.patch(`/api/accounting/transactions/${t.id}`, { categoryId: cat('water') }, owner)).status, 200);
  assert.equal((await h.post('/api/accounting/signoffs/reopen', { month: '2026-09', reason: 'again' }, owner)).body.error.code, 'NOT_SIGNED_OFF');
  const list = (await get('/api/accounting/signoffs')).body.items;
  assert.equal(list.length, 1);
  assert.equal(list[0].reopenReason, 'Found a missing bill');
});

test('a note can be kept against a month', async () => {
  assert.equal((await get('/api/accounting/memos/2026-09')).body.body, '');
  assert.equal((await h.put('/api/accounting/memos/2026-09', { body: 'Pitch re-laid, big repair bill.' }, owner)).body.body, 'Pitch re-laid, big repair bill.');
  assert.equal((await get('/api/accounting/memos/2026-09')).body.body, 'Pitch re-laid, big repair bill.');
  assert.equal((await get('/api/accounting/memos/2026-09', owner2)).body.body, '', 'another owner has their own');
  assert.equal((await h.put('/api/accounting/memos/2026-09', { body: '' }, owner)).body.body, '');
  assert.equal((await h.put('/api/accounting/memos/nonsense', { body: 'x' }, owner)).status, 400);
});

// ------------------------------------------------------------------ who can see and change what

test('only people with the right permission can see or change the books', async () => {
  const paths = ['/api/accounting/overview', '/api/accounting/reports/pnl', '/api/accounting/reports/balance-sheet', '/api/accounting/reports/schedule/past', '/api/accounting/reports/schedule/future', '/api/accounting/transactions', '/api/accounting/accounts'];
  for (const p of paths) assert.equal((await h.get(p, null)).status, 401, p);
  for (const p of paths) assert.equal((await h.get(p, cust)).status, 403, `a customer: ${p}`);
  for (const p of paths) assert.equal((await h.get(p, staff)).status, 403, `staff without permission: ${p}`);

  const perms = (list: string[]) => run('UPDATE users SET permissions = ? WHERE email = ?', JSON.stringify(list), DEMO_ACCOUNTS.staff1.email);
  perms(['view_reports', 'view_revenue']);
  for (const p of paths) assert.equal((await h.get(p, staff)).status, 200, `view_reports can read ${p}`);
  assert.equal((await h.post('/api/accounting/accounts', { kind: 'cash', name: 'Sneaky' }, staff)).status, 403, 'but cannot change anything');
  assert.equal((await h.patch('/api/accounting/settings', { gstPercent: 5 }, staff)).status, 403);
  perms(['manage_accounting', 'view_revenue']);
  assert.equal((await h.post('/api/accounting/accounts', { kind: 'cash', name: 'Cash drawer' }, staff)).status, 201, 'manage_accounting can');
  assert.equal((await get('/api/accounting/accounts')).body.items.length, 1, 'staff work on their employer\'s books');
});

test('each owner sees only their own books; the admin chooses one', async () => {
  await account({ kind: 'bank', name: 'Owner one bank', openingPaise: 100_000, openingDate: '2026-10-01' });
  assert.equal((await get('/api/accounting/accounts', owner2)).body.items.length, 0);
  const p2 = (await get('/api/accounting/reports/pnl?month=2026-10', owner2)).body;
  assert.equal(p2.revenue.totalPaise, b.other.totalPaise, 'the other owner\'s session is theirs alone');
  const s2 = (await get('/api/accounting/reports/schedule/past?month=2026-10', owner2)).body;
  assert.equal(s2.summary.sessions, 1);
  assert.equal(s2.items[0].ref, b.other.ref);
  assert.equal((await get('/api/accounting/reports/pnl', admin)).status, 400, 'the admin must say whose books');
  assert.equal((await get('/api/accounting/reports/pnl', admin)).body.error.code, 'OWNER_REQUIRED');
  assert.equal((await get(`/api/accounting/reports/pnl?month=2026-10&ownerId=${owner2Id}`, admin)).body.revenue.totalPaise, b.other.totalPaise);
  assert.equal((await get(`/api/accounting/accounts?ownerId=${ownerId}`, admin)).body.items.length, 1);
  assert.equal((await h.del(`/api/accounting/accounts/${(await get('/api/accounting/accounts')).body.items[0].id}`, owner2)).status, 404);
});

// ------------------------------------------------------------------ downloads

test('the profit and loss downloads as an Excel workbook with working totals, and as CSV', async () => {
  const a = await account({ kind: 'bank', name: 'Main' });
  await txn({ accountId: a.id, date: '2026-10-10', amountPaise: -200_000, description: '=HYPERLINK("http://evil.test","click")', categoryId: cat('electricity') });
  const x = await fetch(`${h.url}/api/accounting/reports/pnl?month=2026-10&format=xlsx`, { headers: { authorization: `Bearer ${owner}` } });
  assert.equal(x.status, 200);
  assert.match(x.headers.get('content-type')!, /spreadsheetml/);
  assert.match(x.headers.get('content-disposition')!, /profit-and-loss-2026-10-01-to-2026-10-31\.xlsx/);
  const book = readXlsx(Buffer.from(await x.arrayBuffer()));
  const rows = book[0]!.rows;
  const net = rows.find((r) => r[0] === 'Net profit')!;
  const p = (await get('/api/accounting/reports/pnl?month=2026-10')).body;
  assert.equal(Number(net[1]), p.netProfitPaise / 100);
  assert.ok(rows.some((r) => r[0] === 'Total revenue' && Number(r[1]) === p.revenue.totalPaise / 100));

  const csv = await fetch(`${h.url}/api/accounting/reports/pnl?month=2026-10&format=csv`, { headers: { authorization: `Bearer ${owner}` } });
  const bytes = Buffer.from(await csv.arrayBuffer());
  const text = bytes.toString('utf8');
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'starts with a byte-order mark so Excel reads it as UTF-8');
  assert.match(text, /Net profit/);
  assert.equal((await h.get('/api/accounting/reports/pnl?format=doc', owner)).status, 400);
  const pdf = await fetch(`${h.url}/api/accounting/reports/pnl?month=2026-10&format=pdf`, { headers: { authorization: `Bearer ${owner}` } });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  const pb = Buffer.from(await pdf.arrayBuffer());
  assert.equal(pb.subarray(0, 5).toString(), '%PDF-');
  assert.match(pb.toString('latin1'), /Rs [0-9,]+\.\d\d/);
  assert.equal(many("SELECT 1 FROM audit_log WHERE action = 'acct.export'").length, 3, 'downloads are recorded');
});

test('the schedules, balance sheet, trial balance and ledger all download', async () => {
  const dl = async (path: string) => { const r = await fetch(`${h.url}${path}`, { headers: { authorization: `Bearer ${owner}` } }); assert.equal(r.status, 200, path); return Buffer.from(await r.arrayBuffer()); };
  const past = readXlsx(await dl('/api/accounting/reports/schedule/past?month=2026-10&format=xlsx'));
  assert.deepEqual(past.map((s) => s.name), ['Summary', 'By period', 'By ground', 'Sessions']);
  assert.equal(past[3]!.rows.length, 1 + 5, 'a header and the five sessions');
  const future = readXlsx(await dl('/api/accounting/reports/schedule/future?format=xlsx'));
  assert.equal(future[3]!.rows.length, 1 + 2);
  const bs = readXlsx(await dl('/api/accounting/reports/balance-sheet?format=xlsx'));
  const diff = bs[0]!.rows.find((r) => String(r[0]).startsWith('Assets less liabilities'))!;
  assert.equal(Number(diff[1]), 0, 'the workbook shows the sheet balancing');
  const tb = readXlsx(await dl('/api/accounting/reports/trial-balance?format=xlsx'));
  const tot = tb[0]!.rows.find((r) => r[0] === 'Total')!;
  assert.equal(tot[2], tot[3]);
  const led = readXlsx(await dl('/api/accounting/reports/ledger?account=booking_income&month=2026-10&format=xlsx'));
  assert.ok(led[0]!.rows.length > 3);
  const csv = (await dl('/api/accounting/reports/schedule/past?month=2026-10&format=csv')).toString('utf8');
  assert.match(csv, /Asha Patel/, 'the CSV is the list of sessions');
  assert.equal(csv.split('\r\n').filter(Boolean).length, 1 + 5);
});

test('a customer name that looks like a formula cannot run in a spreadsheet', async () => {
  const evil = await register(h, '=1+1', '9866666666', {});
  const e = await bookAndPay(h, evil, nets.id, dayFromNow(11), '08:00');
  assert.ok(e.id);
  setNow(T0 + 12 * DAY);
  owner = await h.login('owner1');
  const r = await fetch(`${h.url}/api/accounting/reports/schedule/past?from=${dayFromNow(11)}&to=${dayFromNow(11)}&format=csv`, { headers: { authorization: `Bearer ${owner}` } });
  const text = await r.text();
  assert.match(text, /'=1\+1/);
  assert.doesNotMatch(text, /(^|,)=1\+1/m);
});

// ------------------------------------------------------------------ bad requests

test('bad dates, ranges, formats and accounts are refused with a clear message', async () => {
  const bad = async (path: string, code?: string) => { const r = await get(path); assert.equal(r.status, 400, path); if (code) assert.equal(r.body.error.code, code, path); };
  await bad('/api/accounting/reports/pnl?month=2026-13');
  await bad('/api/accounting/reports/pnl?from=2026-10-01');
  await bad('/api/accounting/reports/pnl?from=2026-10-31&to=2026-10-01');
  await bad('/api/accounting/reports/pnl?from=2020-01-01&to=2026-10-01', 'RANGE_TOO_LONG');
  await bad('/api/accounting/reports/pnl?basis=magic');
  await bad('/api/accounting/reports/balance-sheet?asOf=yesterday');
  await bad(`/api/accounting/reports/balance-sheet?asOf=${dayFromNow(30)}`);
  await bad('/api/accounting/reports/schedule/past?groupBy=year');
  await bad('/api/accounting/reports/schedule/future?from=2026-10-24&to=2028-01-01', 'RANGE_TOO_LONG');
  await bad('/api/accounting/reports/ledger');
  assert.equal((await get('/api/accounting/reports/ledger?account=nonsense')).status, 404);
  assert.equal((await h.post('/api/accounting/accounts', { kind: 'savings', name: 'x' }, owner)).status, 400);
  assert.equal((await h.post('/api/accounting/accounts', { kind: 'bank', name: 'Has balance', openingPaise: 100 }, owner)).status, 400, 'an opening balance needs a date');
  assert.equal((await h.patch('/api/accounting/settings', { gstPercent: 40 }, owner)).status, 400);
  assert.equal((await h.patch('/api/accounting/settings', { gstPercent: 12.5 }, owner)).status, 400);
  const a = await account({ kind: 'bank', name: 'Main' });
  assert.equal((await h.post('/api/accounting/accounts', { kind: 'bank', name: 'main' }, owner)).status, 409, 'names are unique, ignoring case');
  assert.equal((await h.post('/api/accounting/transactions', { accountId: a.id, date: '2026-10-02', amountPaise: 0, description: 'Nothing' }, owner)).status, 400);
  assert.equal((await h.post('/api/accounting/transactions', { accountId: a.id, date: '2026-10-02', amountPaise: 1.5, description: 'Half a paisa' }, owner)).status, 400);
  assert.equal((await h.post('/api/accounting/transactions', { accountId: a.id, date: dayFromNow(30), amountPaise: 100, description: 'Future' }, owner)).status, 400);
  assert.equal((await h.post('/api/accounting/transactions', { accountId: 'acc_nope', date: '2026-10-02', amountPaise: 100, description: 'Nowhere' }, owner)).status, 404);
  assert.equal((await h.post('/api/accounting/transactions', { accountId: a.id, date: '2026-10-02', amountPaise: 100, description: 'Bad category', categoryId: 'cat_nonsense' }, owner)).status, 400);
});

test('the accounting tables exist on a database that was created before they were added', async () => {
  const { openDb, closeDb } = await import('../src/db.ts');
  const { DatabaseSync } = await import('node:sqlite');
  const { SCHEMA_CORE } = await import('../src/db.ts');
  const dir = (await import('node:fs')).mkdtempSync((await import('node:os')).tmpdir() + '/daji-acct-');
  const path = `${dir}/old.db`;
  const old = new DatabaseSync(path);
  old.exec(SCHEMA_CORE);
  old.close();
  closeDb();
  openDb(path);
  assert.equal(many("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('acct_journals','acct_journal_lines','acct_transactions')").length, 3);
  assert.ok(one<{ n: number }>("SELECT COUNT(*) n FROM acct_categories WHERE code = 'customer_refund'")!.n === 1);
  closeDb();
  openDb(':memory:');
  h.reset();
});
