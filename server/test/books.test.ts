import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, hold, dayFromNow, setting, type Harness, type GroundLite } from './helpers.ts';
import { many, one } from '../src/db.ts';
import { nextOccurrence, runRecurring } from '../src/accounting/books.ts';
import { sniff } from '../src/accounting/books.ts';

let h: Harness; let g: GroundLite; let owner: string, owner2: string, cust: string, staff: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset(); setting({ razorpayEnabled: false });
  g = (await grounds(h))[0]!; owner = await h.login('owner1'); owner2 = await h.login('owner2'); cust = await h.login('customer'); staff = await h.login('staff1');
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
const send = (path: string, body: Buffer | string, token = owner, method = 'POST') => fetch(`${h.url}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' }, body });
async function bank(): Promise<string> { const r = await h.post('/api/accounting/accounts', { kind: 'bank', name: 'HDFC current', openingPaise: 10000000, openingDate: dayFromNow(-400) }, owner); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.id; }
async function upiPayment(day: number, utr: string): Promise<{ paymentId: string; amount: number }> {
  const r = await hold(h, cust, g.id, dayFromNow(day), '19:00');
  const sub = await h.post(`/api/bookings/${r.body.booking.id}/upi-reference`, { utr }, cust);
  assert.equal(sub.status, 200, JSON.stringify(sub.body));
  assert.equal((await h.post(`/api/staff/payments/${sub.body.payment.id}/verify`, { approve: true }, staff)).status, 200);
  return { paymentId: sub.body.payment.id, amount: one<{ amount_paise: number }>('SELECT amount_paise FROM payments WHERE id = ?', sub.body.payment.id)!.amount_paise };
}
const rupees = (p: number) => (p / 100).toFixed(2);
const stmt = (rows: string[]) => ['Account Statement,,,,,', 'Date,Narration,Chq/Ref No,Withdrawal Amt,Deposit Amt,Closing Balance', ...rows].join('\n');

test('file types are read from their bytes, not their names', () => {
  assert.equal(sniff(PNG)?.mime, 'image/png');
  assert.equal(sniff(Buffer.from('%PDF-1.7 ...'))?.mime, 'application/pdf');
  assert.equal(sniff(Buffer.from('<html><script>alert(1)</script>')), null);
});

test('receipts attach to a transaction, download back, and stay inside their owner', async () => {
  const acct = await bank();
  const t = await h.post('/api/accounting/transactions', { accountId: acct, date: dayFromNow(0), amountPaise: -250000, description: 'Roller hire' }, owner);
  assert.equal(t.status, 201);
  const up = await send(`/api/accounting/attachments?entity=transaction&id=${t.body.id}&filename=bill.png`, PNG);
  assert.equal(up.status, 201);
  const att = await up.json() as { id: string; mime: string };
  assert.equal(att.mime, 'image/png');
  const list = await h.get(`/api/accounting/attachments?entity=transaction&id=${t.body.id}`, owner);
  assert.equal(list.body.items.length, 1);
  const dl = await fetch(`${h.url}/api/accounting/attachments/${att.id}/file`, { headers: { authorization: `Bearer ${owner}` } });
  assert.equal(dl.status, 200);
  assert.deepEqual(Buffer.from(await dl.arrayBuffer()), PNG);
  assert.equal((await fetch(`${h.url}/api/accounting/attachments/${att.id}/file`, { headers: { authorization: `Bearer ${owner2}` } })).status, 404);
  assert.equal((await send(`/api/accounting/attachments?entity=transaction&id=${t.body.id}&filename=x.png`, PNG, owner2)).status, 404);
  assert.equal((await send(`/api/accounting/attachments?entity=transaction&id=${t.body.id}&filename=x.png`, PNG, cust)).status, 403);
  assert.equal((await send(`/api/accounting/attachments?entity=transaction&id=${t.body.id}&filename=virus.pdf`, '<script>alert(1)</script>')).status, 415);
  assert.equal((await send(`/api/accounting/attachments?entity=transaction&id=${t.body.id}&filename=big.png`, Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]))).status, 413);
  assert.equal((await h.del(`/api/accounting/attachments/${att.id}`, owner)).status, 200);
  assert.equal((await h.get(`/api/accounting/attachments?entity=transaction&id=${t.body.id}`, owner)).body.items.length, 0);
});

test('a bank statement is previewed, imported once, de-duplicated, categorised by rules and undone', async () => {
  const acct = await bank();
  const cat = (await h.get('/api/accounting/categories', owner)).body.items.find((c: any) => c.kind === 'expense');
  assert.equal((await h.post('/api/accounting/rules', { field: 'description', matchType: 'contains', pattern: 'BESCOM', categoryId: cat.id, direction: 'out' }, owner)).status, 201);
  assert.equal((await h.post('/api/accounting/rules', { field: 'description', matchType: 'regex', pattern: '(a+)+$', categoryId: cat.id }, owner)).status, 400, 'catastrophic patterns are refused');
  const d1 = dayFromNow(-3), d2 = dayFromNow(-2);
  const csv = stmt([`${d1},ELECTRICITY BESCOM,CHQ1,"12,500.00",,"87,500.00"`, `${d2},CASH DEPOSIT,,,"5,000.00","92,500.00"`, `${d2},TEA,,50.00,,"92,450.00"`, `${d2},TEA,,50.00,,"92,450.00"`, `Total,,,,,`]);
  const dry = await send(`/api/accounting/imports?accountId=${acct}&filename=oct.csv&dryRun=1`, csv);
  const dj = await dry.json() as any;
  assert.equal(dry.status, 201); assert.equal(dj.dryRun, true); assert.equal(dj.rowsNew, 4); assert.equal(dj.categorisedByRules, 1);
  assert.equal(many('SELECT 1 FROM acct_transactions').length, 0, 'a preview saves nothing');
  const res = await send(`/api/accounting/imports?accountId=${acct}&filename=oct.csv`, csv);
  const rj = await res.json() as any;
  assert.equal(res.status, 201, JSON.stringify(rj)); assert.equal(rj.rowsNew, 4);
  assert.equal(many('SELECT 1 FROM acct_transactions WHERE deleted_at IS NULL').length, 4, 'two identical tea lines are two transactions');
  assert.equal((await send(`/api/accounting/imports?accountId=${acct}&filename=oct.csv`, csv)).status, 409, 'same file twice');
  // an overlapping statement adds only the new line
  const more = stmt([`${d2},TEA,,50.00,,"92,450.00"`, `${d2},TEA,,50.00,,"92,450.00"`, `${d2},SNACKS,,30.00,,"92,370.00"`]);
  const r2 = await (await send(`/api/accounting/imports?accountId=${acct}&filename=more.csv`, more)).json() as any;
  assert.equal(r2.rowsNew, 1); assert.equal(r2.rowsDuplicate, 2);
  const unc = (await h.get(`/api/accounting/transactions?accountId=${acct}&categorised=yes`, owner)).body.items;
  assert.equal(unc.length, 1); assert.equal(unc[0].categoryBy, 'rule');
  assert.equal((await h.get('/api/accounting/reconcile', owner)).body.accounts[0].differencePaise, 0, 'books match the statement balance');
  const undo = await h.post(`/api/accounting/imports/${rj.importId}/undo`, {}, owner);
  assert.equal(undo.status, 200); assert.equal(undo.body.removed, 4);
  assert.equal((await send(`/api/accounting/imports?accountId=${acct}&filename=oct.csv`, csv)).status, 201, 'after undo the file can be loaded again');
  assert.equal((await send(`/api/accounting/imports?accountId=${acct}&filename=a.pdf`, '%PDF-1.4 x')).status, 422);
  assert.equal((await send(`/api/accounting/imports?accountId=${acct}&filename=x.csv`, 'hello,world\n1,2')).status, 422);
  assert.equal((await send(`/api/accounting/imports?accountId=${acct}&filename=x.csv`, csv, owner2)).status, 404);
});

test('a PDF statement is read on upload, previewed, then imported', async () => {
  const acct = await bank();
  const pdf = (await import('node:fs')).readFileSync(new URL('./fixtures/bank-statement.pdf', import.meta.url));
  const dry = await send(`/api/accounting/imports?accountId=${acct}&filename=statement.pdf&dryRun=1`, pdf);
  const dj = await dry.json() as any;
  assert.equal(dry.status, 201, JSON.stringify(dj));
  assert.equal(dj.source, 'pdf'); assert.equal(dj.rowsNew, 40); assert.equal(dj.reconcile.mismatched, 0); assert.equal(dj.reviewRequired, false);
  assert.equal(dj.preview.length, 40); assert.equal(dj.preview[0].status, 'new');
  assert.equal(many('SELECT 1 FROM acct_transactions').length, 0, 'a preview saves nothing');
  const res = await send(`/api/accounting/imports?accountId=${acct}&filename=statement.pdf`, pdf);
  assert.equal(res.status, 201); assert.equal(many('SELECT 1 FROM acct_transactions').length, 40);
  assert.equal(one<{ kind: string }>('SELECT kind FROM acct_imports')!.kind, 'pdf');
  const junk = await send(`/api/accounting/imports?accountId=${acct}&filename=x.pdf&dryRun=1`, Buffer.from('%PDF-1.4 junk'));
  assert.equal(junk.status, 422);
});

test('UPI money collected is matched to its deposit automatically by UTR and amount', async () => {
  const acct = await bank();
  const a = await upiPayment(2, '123456789012');
  const b = await upiPayment(3, '210987654321');
  const day = dayFromNow(-1);
  const csv = stmt([
    `${day},UPI/CR/123456789012/RAHUL/HDFC,,,${rupees(a.amount)},"${rupees(a.amount)}"`,
    `${day},UPI/CR/999999999999/UNKNOWN,,,${rupees(b.amount)},"${rupees(a.amount + b.amount)}"`, // right amount, wrong UTR: only a suggestion
  ]);
  const r = await (await send(`/api/accounting/imports?accountId=${acct}&filename=s.csv`, csv)).json() as any;
  assert.equal(r.autoMatched, 1, 'only the certain one is matched');
  const m = one<any>('SELECT * FROM acct_transactions WHERE payment_id = ?', a.paymentId);
  assert.equal(m.match_kind, 'utr'); assert.equal(m.category_by, 'match'); assert.ok(m.booking_id);
  const q = (await h.get('/api/accounting/reconcile', owner)).body;
  assert.equal(q.rows.length, 1);
  assert.equal(q.rows[0].candidates[0].paymentId, b.paymentId, 'the other deposit is offered the other payment, by amount');
  assert.equal(q.rows[0].candidates[0].strength, 'amount');
  assert.equal((await h.post(`/api/accounting/transactions/${q.rows[0].txnId}/match`, { paymentId: a.paymentId }, owner)).status, 409, 'a payment can only be matched once');
  assert.equal((await h.post(`/api/accounting/transactions/${q.rows[0].txnId}/match`, { paymentId: b.paymentId }, owner)).status, 200);
  assert.equal((await h.get('/api/accounting/reconcile', owner)).body.rows.length, 0);
  assert.equal((await h.post(`/api/accounting/transactions/${m.id}/unmatch`, {}, owner)).status, 200);
  assert.equal((await h.post('/api/accounting/reconcile/auto', {}, owner)).body.matched, 1, 'the auto-match picks it up again');
  assert.equal((await h.get('/api/accounting/reconcile', owner2)).body.rows.length, 0, 'other owners see nothing');
});

test('recurring entries post once per due date, never twice, and respect signed-off months', async () => {
  assert.equal(nextOccurrence('2026-01-31', '2026-01-31', 'monthly'), '2026-02-28');
  assert.equal(nextOccurrence('2026-01-31', '2026-02-28', 'monthly'), '2026-03-31');
  assert.equal(nextOccurrence('2026-10-01', '2026-10-01', 'quarterly'), '2027-01-01');
  assert.equal(nextOccurrence('2026-10-01', '2026-10-01', 'weekly'), '2026-10-08');
  const acct = await bank();
  const start = dayFromNow(-65);
  const c = await h.post('/api/accounting/recurring', { accountId: acct, description: 'Ground rent', amountPaise: -2500000, frequency: 'monthly', startDate: start }, owner);
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const run1 = await h.post('/api/accounting/recurring/run', {}, owner);
  assert.equal(run1.status, 200); assert.ok(run1.body.posted >= 3, `posted ${run1.body.posted}`);
  const n = many('SELECT 1 FROM acct_transactions WHERE deleted_at IS NULL').length;
  assert.equal((await h.post('/api/accounting/recurring/run', {}, owner)).body.posted, 0, 'running again posts nothing');
  assert.equal(many('SELECT 1 FROM acct_transactions WHERE deleted_at IS NULL').length, n);
  assert.equal(runRecurring(null, null).posted, 0, 'the scheduler is safe to repeat');
  assert.equal((await h.patch(`/api/accounting/recurring/${c.body.id}`, { active: false }, owner)).status, 200);
  assert.equal((await h.get('/api/accounting/recurring', owner2)).body.items.length, 0);
  assert.equal((await h.post('/api/accounting/recurring', { accountId: acct, description: 'x', amountPaise: 0, frequency: 'monthly', startDate: start }, owner)).status, 400);
  assert.equal((await h.del(`/api/accounting/recurring/${c.body.id}`, owner)).status, 200);
});
