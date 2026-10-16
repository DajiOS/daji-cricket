import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, type Harness } from './helpers.ts';
import { buildScenario } from './scenario.ts';

let h: Harness, owner: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => { ({ owner } = await buildScenario(h)); });

let n = 0;
async function bank(opening = 0): Promise<string> {
  const r = await h.post('/api/accounting/accounts', { kind: 'bank', name: 'COA bank ' + n++, openingPaise: opening, openingDate: opening ? '2026-01-01' : undefined }, owner);
  assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.id;
}
const coa = async (): Promise<any[]> => (await h.get('/api/accounting/coa', owner)).body.items;
const item = async (id: string) => (await coa()).find((x) => x.id === id);

test('an unused account can be deleted; a used one cannot', async () => {
  const a = await bank(), b = await bank();
  assert.equal((await item(a)).canDelete, true);
  assert.equal((await h.post('/api/accounting/transactions', { accountId: b, date: '2026-03-02', amountPaise: 500, description: 'Deposit' }, owner)).status, 201);
  assert.equal((await item(b)).canDelete, false);
  const bad = await h.del(`/api/accounting/coa/${b}`, owner);
  assert.equal(bad.status, 409); assert.equal(bad.body.error.code, 'IN_USE');
  assert.equal((await h.del(`/api/accounting/coa/${a}`, owner)).status, 200);
  assert.equal(await item(a), undefined);
});

test('an account can be renamed, and made inactive only when its balance is zero', async () => {
  const a = await bank(10_000);
  assert.equal((await h.patch(`/api/accounting/coa/${a}`, { name: 'Renamed bank' }, owner)).body.name, 'Renamed bank');
  const blocked = await h.patch(`/api/accounting/coa/${a}`, { active: false }, owner);
  assert.equal(blocked.status, 409); assert.equal(blocked.body.error.code, 'BALANCE_NOT_ZERO');
  assert.equal((await h.post('/api/accounting/transactions', { accountId: a, date: '2026-03-02', amountPaise: -10_000, description: 'Withdrawal' }, owner)).status, 201);
  const ok = await h.patch(`/api/accounting/coa/${a}`, { active: false }, owner);
  assert.equal(ok.status, 200); assert.equal(ok.body.active, false);
  const add = await h.post('/api/accounting/transactions', { accountId: a, date: '2026-03-03', amountPaise: 1, description: 'Late' }, owner);
  assert.equal(add.status, 409); assert.equal(add.body.error.code, 'ACCOUNT_INACTIVE');
  assert.equal((await h.patch(`/api/accounting/coa/${a}`, { active: true }, owner)).body.active, true);
});

test('an inactive category keeps its history in reports, tagged, and takes no new entries', async () => {
  const a = await bank();
  const t = await h.post('/api/accounting/transactions', { accountId: a, date: '2026-03-02', amountPaise: -2500, description: 'Repair', categoryId: 'cat_repairs' }, owner);
  assert.equal(t.status, 201, JSON.stringify(t.body));
  assert.equal((await h.patch('/api/accounting/coa/cat_repairs', { name: 'Fixes', active: false }, owner)).status, 200);
  const pnl = JSON.stringify((await h.get('/api/accounting/reports/pnl?from=2026-03-01&to=2026-03-31', owner)).body);
  assert.ok(pnl.includes('Fixes (Inactive)'), pnl);
  const other = JSON.stringify((await h.get('/api/accounting/reports/pnl?from=2026-04-01&to=2026-04-30', owner)).body);
  assert.ok(!other.includes('Fixes'), 'no entries in April, so it is not listed');
  const add = await h.post('/api/accounting/transactions', { accountId: a, date: '2026-03-05', amountPaise: -100, description: 'More', categoryId: 'cat_repairs' }, owner);
  assert.equal(add.status, 400);
  assert.equal((await h.del('/api/accounting/coa/cat_repairs', owner)).status, 409, 'built-in categories are never deleted');
  const cats = (await h.get('/api/accounting/categories', owner)).body.items;
  assert.equal(cats.find((c: any) => c.id === 'cat_repairs').active, false);
});

test('an own category can be deleted only while unused', async () => {
  const c = await h.post('/api/accounting/categories', { name: 'Trophies', kind: 'expense' }, owner);
  assert.equal(c.status, 201);
  const a = await bank();
  await h.post('/api/accounting/transactions', { accountId: a, date: '2026-03-02', amountPaise: -900, description: 'Cup', categoryId: c.body.id }, owner);
  assert.equal((await h.del(`/api/accounting/coa/${c.body.id}`, owner)).status, 409);
  const d = await h.post('/api/accounting/categories', { name: 'Unused one', kind: 'expense' }, owner);
  assert.equal((await h.del(`/api/accounting/coa/${d.body.id}`, owner)).status, 200);
});
