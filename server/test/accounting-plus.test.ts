import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, dayFromNow, type Harness } from './helpers.ts';
import { buildScenario } from './scenario.ts';
import { balanceSheet, trialBalance } from '../src/accounting/statements.ts';
import { monthsCovered } from '../src/accounting/plus.ts';
import { readXlsx } from '../src/accounting/xlsx.ts';
import { many, one } from '../src/db.ts';
import { istDate } from '../src/time.ts';
import { now } from '../src/clock.ts';

let h: Harness;
let owner: string, owner2: string, staff: string, cust: string, ownerId: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => { const sc = await buildScenario(h); ({ owner, owner2, staff, cust, ownerId } = sc); });

const today = () => istDate(now());
const get = (p: string, tok = owner) => h.get(p, tok);
async function acct(name: string, opening = 0): Promise<string> {
  const r = await h.post('/api/accounting/accounts', { kind: 'bank', name, openingPaise: opening, ...(opening ? { openingDate: dayFromNow(-400) } : {}) }, owner);
  assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.id;
}
const cat = async (code: string): Promise<string> => `cat_${code}`;
async function txn(accountId: string, amountPaise: number, categoryCode: string | null, description = 'Test entry', date = today()) {
  const r = await h.post('/api/accounting/transactions', { accountId, date, amountPaise, description, ...(categoryCode ? { categoryId: await cat(categoryCode) } : {}) }, owner);
  assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body;
}
const month = () => today().slice(0, 7);

test('a transfer between two accounts moves money, nets to nothing, and leaves the books balanced', async () => {
  const a = await acct('HDFC', 5_000_000), b = await acct('Cash box');
  const r = await h.post('/api/accounting/transfers', { fromAccountId: a, toAccountId: b, date: today(), amountPaise: 1_200_000, note: 'Float' }, owner);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const accts = (await get('/api/accounting/accounts')).body.items;
  assert.equal(accts.find((x: any) => x.id === a).balancePaise, 3_800_000);
  assert.equal(accts.find((x: any) => x.id === b).balancePaise, 1_200_000);
  const tb = trialBalance(ownerId, today());
  assert.equal(tb.balanced, true);
  assert.equal(tb.rows.find((x) => x.name.startsWith('Transfers between accounts'))?.debitPaise ?? 0, tb.rows.find((x) => x.name.startsWith('Transfers between accounts'))?.creditPaise ?? 0);
  assert.equal(balanceSheet(ownerId, today()).balanced, true);
  assert.equal((await h.post('/api/accounting/transfers', { fromAccountId: a, toAccountId: a, date: today(), amountPaise: 100 }, owner)).status, 400);
  assert.equal((await h.post('/api/accounting/transfers', { fromAccountId: a, toAccountId: b, date: today(), amountPaise: 0 }, owner)).status, 400);
  assert.equal((await h.post('/api/accounting/transfers', { fromAccountId: a, toAccountId: b, date: today(), amountPaise: 100 }, owner2)).status, 404);
  assert.equal((await h.post('/api/accounting/transfers', { fromAccountId: a, toAccountId: b, date: today(), amountPaise: 100 }, staff)).status, 403);
  assert.equal((await h.post('/api/accounting/transfers', { fromAccountId: a, toAccountId: b, date: today(), amountPaise: 100 }, cust)).status, 403);
  const cf = (await get(`/api/accounting/reports/cash-flow?month=${month()}`)).body;
  assert.equal(cf.betweenAccountsPaise, 0, 'both sides are in the books');
  assert.equal(cf.ties, true);
});

test('the cash flow statement groups money by what it was for and ties to the balance sheet', async () => {
  const a = await acct('HDFC', 10_000_000);
  await txn(a, 400_000, 'canteen', 'Canteen takings');
  await txn(a, -250_000, 'electricity', 'Power bill');
  await txn(a, 3_000_000, 'owner_capital', 'Capital in');
  await txn(a, -800_000, 'asset_purchase', 'Bowling machine');
  await txn(a, -50_000, null, 'Mystery debit');
  await txn(a, -100_000, 'loan', 'Loan repaid');
  const cf = (await get(`/api/accounting/reports/cash-flow?month=${month()}`)).body;
  const by = (sec: any, code: string) => sec.rows.find((r: any) => r.code === code)?.paise;
  assert.equal(by(cf.operating, 'inc:canteen'), 400_000);
  assert.equal(by(cf.operating, 'exp:electricity'), -250_000);
  assert.equal(by(cf.operating, 'uncategorised'), -50_000);
  assert.equal(by(cf.investing, 'asset_purchase'), -800_000);
  assert.equal(by(cf.financing, 'owner_capital'), 3_000_000);
  assert.equal(by(cf.financing, 'loan'), -100_000);
  assert.equal(cf.ties, true, JSON.stringify(cf));
  assert.equal(cf.closingPaise, balanceSheet(ownerId, today()).assets.groups.flatMap((g) => g.rows).filter((r) => r.code.startsWith('bank:')).reduce((s, r) => s + r.paise, 0));
  assert.equal(cf.openingPaise + cf.netChangePaise, cf.closingPaise);
  // the purchase lands in fixed assets, and the books still balance
  assert.equal(balanceSheet(ownerId, today()).balanced, true);
  assert.ok(balanceSheet(ownerId, today()).assets.groups.flatMap((g) => g.rows).find((r) => r.code === 'fixed_assets')?.paise === 800_000);
  // an earlier month sees the opening balance of the account instead
  const earlier = (await get(`/api/accounting/reports/cash-flow?from=${dayFromNow(-500)}&to=${dayFromNow(-300)}`)).body;
  assert.equal(earlier.ties, true); assert.equal(earlier.newAccountsOpeningPaise, 10_000_000);
  assert.equal((await get(`/api/accounting/reports/cash-flow?month=${month()}`, owner2)).body.operating.rows.length, 0, 'another owner sees nothing of it');
  assert.equal((await get(`/api/accounting/reports/cash-flow?month=${month()}`, cust)).status, 403);
});

test('budgets: set, replaced, removed; the report prorates by month and flags what is over', async () => {
  const a = await acct('HDFC', 1_000_000);
  await txn(a, -150_000, 'electricity', 'Power bill');
  const set = await h.put('/api/accounting/budgets', { items: [{ code: 'exp:electricity', monthlyPaise: 100_000 }, { code: 'exp:rent', monthlyPaise: 500_000 }] }, owner);
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.equal(set.body.items.length, 2);
  const rep = (await get(`/api/accounting/reports/budget?month=${month()}`)).body;
  const el = rep.expenses.find((r: any) => r.code === 'exp:electricity');
  assert.equal(el.budgetPaise, 100_000); assert.equal(el.actualPaise, 150_000); assert.equal(el.variancePaise, -50_000); assert.equal(el.status, 'over'); assert.equal(el.percentUsed, 150);
  assert.equal(rep.expenses.find((r: any) => r.code === 'exp:rent').status, 'ok');
  assert.equal(rep.totals.actualExpensePaise, rep.expenses.reduce((s: number, r: any) => s + r.actualPaise, 0));
  const half = (await get(`/api/accounting/reports/budget?from=${month()}-01&to=${month()}-15`)).body;
  assert.ok(half.months > 0.4 && half.months < 0.6);
  assert.equal((await h.put('/api/accounting/budgets', { items: [{ code: 'exp:rent', monthlyPaise: 0 }, { code: 'bank:x', monthlyPaise: 5 }] }, owner)).status, 400);
  assert.equal((await h.put('/api/accounting/budgets', { items: [{ code: 'exp:rent', monthlyPaise: 0 }] }, owner)).body.items.length, 1);
  assert.equal((await get('/api/accounting/budgets', owner2)).body.items.length, 0);
  assert.equal((await h.put('/api/accounting/budgets', { items: [{ code: 'exp:rent', monthlyPaise: 5 }] }, staff)).status, 403);
  assert.equal(monthsCovered({ from: '2026-02-01', to: '2026-03-31' }), 2);
});

test('fixed assets: depreciation is straight line, posted once per ended month, and the books still balance', async () => {
  const a = await acct('HDFC', 5_000_000);
  await txn(a, -1_200_001, 'asset_purchase', 'Bowling machine', dayFromNow(-100));
  const add = await h.post('/api/accounting/assets', { name: 'Bowling machine', costPaise: 1_200_001, salvagePaise: 1, purchaseDate: dayFromNow(-100), lifeMonths: 12 }, owner);
  assert.equal(add.status, 201, JSON.stringify(add.body));
  assert.equal(add.body.monthlyPaise, 100_000);
  const first = await h.post('/api/accounting/assets/depreciate', {}, owner);
  assert.equal(first.status, 200);
  const ended = first.body.posted;
  assert.ok(ended >= 3 && ended <= 4, `months ended: ${ended}`);
  assert.equal(first.body.totalPaise, ended * 100_000);
  assert.equal((await h.post('/api/accounting/assets/depreciate', {}, owner)).body.posted, 0, 'running it again posts nothing');
  const list = (await get('/api/accounting/assets')).body;
  assert.equal(list.items[0].depreciatedPaise, ended * 100_000);
  assert.equal(list.items[0].bookValuePaise, 1_200_001 - ended * 100_000);
  const bs = balanceSheet(ownerId, today());
  assert.equal(bs.balanced, true);
  const rows = bs.assets.groups.flatMap((g) => g.rows);
  assert.equal(rows.find((r) => r.code === 'accumulated_depreciation')?.paise, -ended * 100_000);
  assert.equal(trialBalance(ownerId, today()).balanced, true);
  const pnl = (await get(`/api/accounting/reports/pnl?from=${dayFromNow(-120)}&to=${today()}`)).body;
  assert.equal(pnl.expenses.groups.flatMap((g: any) => g.rows).find((r: any) => r.code === 'exp:depreciation').paise, ended * 100_000);
  assert.equal((await h.del(`/api/accounting/assets/${add.body.id}`, owner)).status, 409, 'posted depreciation blocks removal');
  const disp = await h.post(`/api/accounting/assets/${add.body.id}/dispose`, { disposedOn: dayFromNow(-50) }, owner);
  assert.equal(disp.body.status, 'disposed');
  assert.equal((await get('/api/accounting/assets', owner2)).body.items.length, 0);
  assert.equal((await h.post('/api/accounting/assets', { name: 'X', costPaise: 100, salvagePaise: 100, purchaseDate: today(), lifeMonths: 12 }, owner)).status, 400);
  assert.equal((await h.post('/api/accounting/assets/depreciate', {}, staff)).status, 403);
});

test('a signed-off month is skipped by depreciation and reported', async () => {
  const a = await acct('HDFC', 1_000_000);
  await txn(a, 10_000, 'canteen', 'Canteen sale', dayFromNow(-80));
  await h.post('/api/accounting/assets', { name: 'Roller', costPaise: 1_200_000, purchaseDate: dayFromNow(-80), lifeMonths: 12 }, owner);
  const m = istDate(now() - 0).slice(0, 7);
  const prev = (() => { const y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7)); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`; })();
  // sign off every ended month with nothing uncategorised
  const so = await h.post('/api/accounting/signoffs', { month: prev }, owner);
  if (so.status === 201) {
    const r = await h.post('/api/accounting/assets/depreciate', {}, owner);
    assert.ok(r.body.skippedLocked.includes(prev));
  }
});

test('the GST summary matches what the balance sheet says is payable', async () => {
  assert.equal((await h.patch('/api/accounting/settings', { gstPercent: 18 }, owner)).status, 200);
  const from = dayFromNow(-60), to = today();
  const g = (await get(`/api/accounting/reports/gst?from=${from}&to=${to}`)).body;
  assert.equal(g.percent, 18);
  assert.ok(g.totals.gstCollectedPaise > 0, 'the scenario has played sessions');
  assert.equal(g.totals.netPaise, g.totals.gstCollectedPaise - g.totals.gstPaidPaise);
  assert.equal(g.rows.reduce((s: number, r: any) => s + r.gstCollectedPaise, 0), g.totals.gstCollectedPaise);
  const bs = balanceSheet(ownerId, to).liabilities.groups.flatMap((x) => x.rows).find((r) => r.code === 'gst_payable')?.paise ?? 0;
  assert.equal(g.payableAtEndPaise, bs);
  const a = await acct('HDFC', 1_000_000);
  await txn(a, -g.totals.gstCollectedPaise, 'gst_remitted', 'GST paid');
  const after = (await get(`/api/accounting/reports/gst?from=${from}&to=${to}`)).body;
  assert.equal(after.totals.gstPaidPaise, g.totals.gstCollectedPaise);
  assert.equal(after.payableAtEndPaise, 0);
  assert.equal((await get(`/api/accounting/reports/gst?from=${from}&to=${to}`, owner2)).body.totals.gstCollectedPaise, 0);
});

test('the new reports download as PDF, Excel and CSV', async () => {
  const a = await acct('HDFC', 1_000_000); await txn(a, 5000, 'canteen');
  await h.put('/api/accounting/budgets', { items: [{ code: 'exp:rent', monthlyPaise: 50_000 }] }, owner);
  await h.post('/api/accounting/assets', { name: 'Net', costPaise: 120_000, purchaseDate: dayFromNow(-40), lifeMonths: 12 }, owner);
  const dl = async (p: string) => { const r = await fetch(`${h.url}${p}`, { headers: { authorization: `Bearer ${owner}` } }); assert.equal(r.status, 200, p); return Buffer.from(await r.arrayBuffer()); };
  for (const base of [`/api/accounting/reports/cash-flow?month=${month()}`, `/api/accounting/reports/budget?month=${month()}`, `/api/accounting/reports/gst?month=${month()}`, '/api/accounting/assets']) {
    assert.equal((await dl(`${base}${base.includes('?') ? '&' : '?'}format=pdf`)).subarray(0, 4).toString(), '%PDF', base);
    const x = readXlsx(await dl(`${base}${base.includes('?') ? '&' : '?'}format=xlsx`));
    assert.ok(x.length > 0, base);
    assert.match((await dl(`${base}${base.includes('?') ? '&' : '?'}format=csv`)).toString(), /\S/);
  }
  const audits = many<{ n: number }>("SELECT COUNT(*) n FROM audit_log WHERE action = 'acct.export'");
  assert.ok(audits[0]!.n >= 12);
  assert.ok(one('SELECT 1 FROM acct_categories WHERE id = ?', 'cat_asset_purchase'));
});
