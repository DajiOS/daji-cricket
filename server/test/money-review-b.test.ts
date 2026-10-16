import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, bookAndPay, dayFromNow, slotStart, setNow, DEMO_ACCOUNTS, MIN, HOUR, type Harness } from './helpers.ts';
import { one } from '../src/db.ts';
import { signOffMonth } from '../src/accounting/store.ts';
import { profitAndLoss } from '../src/accounting/statements.ts';
import { ensureBuiltinCategories } from '../src/accounting/schema.ts';
import { register } from './register.ts';
let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });

test('F5 no-show after month sign-off changes the signed-off month P&L', async () => {
  h.reset(); ensureBuiltinCategories();
  const g = (await grounds(h)).find((x) => x.name === 'Cricket Ground')!;
  const cust = await h.login('customer'); const staff = await h.login('staff1');
  const ownerId = g.ownerId;
  const date = '2026-10-31';
  const b = await bookAndPay(h, cust, g.id, date, '18:00');
  setNow(slotStart('2026-11-01', '00:30'));  // IST 00:30 on 1 Nov; booking ended 19:00 on 31 Oct
  const range = { from: '2026-10-01', to: '2026-10-31' };
  const before = profitAndLoss(ownerId, range).revenue.totalPaise;
  signOffMonth(ownerId, { id: null, role: 'system' } as any, { month: '2026-10' });
  const r = await h.post(`/api/staff/bookings/${b.id}/no-show`, {}, staff);
  console.log('no-show status', r.status, r.body?.error?.code);
  const after_ = profitAndLoss(ownerId, range).revenue.totalPaise;
  console.log({ before, after_ });
  assert.equal(after_, before, 'signed-off month revenue changed');
});
