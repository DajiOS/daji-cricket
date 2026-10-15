import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, dayFromNow, type Harness } from './helpers.ts';
import { buildScenario } from './scenario.ts';
import { balanceSheet } from '../src/accounting/statements.ts';
import { periodsOf } from '../src/accounting/reports2.ts';
import { istDate } from '../src/time.ts';
import { now } from '../src/clock.ts';

let h: Harness;
let owner: string, owner2: string, cust: string, ownerId: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => { ({ owner, owner2, cust, ownerId } = await buildScenario(h)); });
const today = () => istDate(now());

test('periods: months and financial-year quarters are clipped to the range', () => {
  assert.deepEqual(periodsOf({ from: '2026-04-01', to: '2026-10-14' }, 'quarter').map((p) => [p.label, p.range.from, p.range.to]),
    [['Apr–Jun 2026', '2026-04-01', '2026-06-30'], ['Jul–Sep 2026', '2026-07-01', '2026-09-30'], ['Oct–Dec 2026', '2026-10-01', '2026-10-14']]);
  assert.deepEqual(periodsOf({ from: '2026-01-15', to: '2026-03-10' }, 'quarter').map((p) => [p.label, p.range.from, p.range.to]), [['Jan–Mar 2026', '2026-01-15', '2026-03-10']]);
  assert.equal(periodsOf({ from: '2026-02-10', to: '2026-04-05' }, 'month').length, 3);
});

test('profit and loss by month adds up to the profit and loss for the whole range', async () => {
  const from = '2026-04-01', to = today();
  const full = (await h.get(`/api/accounting/reports/pnl?from=${from}&to=${to}`, owner)).body;
  for (const by of ['month', 'quarter']) {
    const t = (await h.get(`/api/accounting/reports/pnl-periods?from=${from}&to=${to}&by=${by}`, owner)).body;
    const net = t.rows.find((r: any) => r.kind === 'net').cells;
    assert.equal(net[net.length - 1], full.netProfitPaise, `${by}: net profit`);
    const rows = t.rows.filter((r: any) => r.kind === 'sub');
    assert.equal(rows[0].cells.at(-1), full.revenue.totalPaise, `${by}: revenue`);
    assert.equal(rows[1].cells.at(-1), full.expenses.totalPaise, `${by}: expenses`);
    for (const r of t.rows.filter((x: any) => x.kind !== 'head')) {
      const nums = r.cells.slice(1, -1) as number[];
      assert.equal(nums.reduce((a, b) => a + b, 0), r.cells.at(-1), `${by}: ${r.cells[0]} row total`);
    }
  }
});

test('customer balances equal the booking balances owed on the balance sheet, and are private to the owner', async () => {
  const sum = (await h.get(`/api/accounting/reports/customer-balances?asOf=${today()}`, owner)).body;
  const det = (await h.get(`/api/accounting/reports/customer-balances?asOf=${today()}&view=detail`, owner)).body;
  const total = (t: any) => t.rows.find((r: any) => r.kind === 'sub').cells.at(-1) ?? t.rows.find((r: any) => r.kind === 'sub').cells[7];
  assert.equal(sum.rows.find((r: any) => r.kind === 'sub').cells.at(-1), det.rows.find((r: any) => r.kind === 'sub').cells[7], 'summary and detail agree');
  const bs = balanceSheet(ownerId, today()).assets.groups.flatMap((g) => g.rows).find((r) => r.name.startsWith('Booking balances owed'))?.paise ?? 0;
  assert.equal(sum.rows.find((r: any) => r.kind === 'sub').cells.at(-1), bs, 'agrees with the balance sheet');
  void total;
  const other = (await h.get(`/api/accounting/reports/customer-balances?asOf=${today()}&view=detail`, owner2)).body;
  assert.ok(other.rows.every((r: any) => r.kind !== 'row' || !det.rows.some((d: any) => d.kind === 'row' && d.cells[1] === r.cells[1])));
});

test('audit log, and downloads of the new reports, need a permitted role', async () => {
  const a = await h.get(`/api/accounting/reports/audit-log?from=${dayFromNow(-30)}&to=${today()}`, owner);
  assert.equal(a.status, 200); assert.ok(Array.isArray(a.body.rows));
  assert.equal((await h.get('/api/accounting/reports/audit-log', cust)).status, 403);
  for (const p of ['pnl-periods?by=month', 'customer-balances?', 'audit-log?']) {
    for (const f of ['csv', 'xlsx', 'pdf']) {
      const r = await h.get(`/api/accounting/reports/${p}&format=${f}`, owner);
      assert.equal(r.status, 200, `${p} ${f}`);
    }
  }
});
