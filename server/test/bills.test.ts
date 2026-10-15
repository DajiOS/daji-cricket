import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, dayFromNow, DEMO_ACCOUNTS, type Harness } from './helpers.ts';
import { run } from '../src/db.ts';

let h: Harness; let owner: string, owner2: string, cust: string, staff: string, staff2: string, admin: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset();
  owner = await h.login('owner1'); owner2 = await h.login('owner2'); cust = await h.login('customer'); staff = await h.login('staff1'); admin = await h.login('admin');
  run('UPDATE users SET permissions = ? WHERE email = ?', JSON.stringify(['manage_accounting']), DEMO_ACCOUNTS.staff1.email);
  const r = await h.post('/api/staff/team', { name: 'Second Clerk', email: 'clerk2@daji.test', password: 'Clerk2@12345', permissions: ['manage_accounting'] }, owner);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  staff2 = (await h.post('/api/auth/login', { email: 'clerk2@daji.test', password: 'Clerk2@12345' })).body.token;
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
async function vendor(token = owner, name = 'Surat Turf Supplies'): Promise<string> {
  const r = await h.post('/api/accounting/vendors', { name, phone: '9876501234', upiId: 'suratturf@okhdfcbank', gstin: '24ABCDE1234F1Z5' }, token);
  assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.id;
}
async function bill(vendorId: string, over: Record<string, unknown> = {}, token = owner): Promise<any> {
  const r = await h.post('/api/accounting/bills', { vendorId, billNo: 'INV-1', billDate: dayFromNow(-5), dueDate: dayFromNow(5), amountPaise: 1250000, ...over }, token);
  assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body;
}

test('vendors: validated, unique by name, owner-scoped, blocked from removal while they have bills', async () => {
  const v = await vendor();
  assert.equal((await h.post('/api/accounting/vendors', { name: 'surat turf supplies' }, owner)).status, 409);
  assert.equal((await h.post('/api/accounting/vendors', { name: 'X Co', gstin: '123' }, owner)).status, 400);
  assert.equal((await h.post('/api/accounting/vendors', { name: 'X Co', upiId: 'nope' }, owner)).status, 400);
  assert.equal((await h.post('/api/accounting/vendors', { name: 'X Co', phone: '12' }, owner)).status, 400);
  assert.equal((await h.get('/api/accounting/vendors', owner2)).body.items.length, 0);
  assert.equal((await h.patch(`/api/accounting/vendors/${v}`, { name: 'Hacked' }, owner2)).status, 404);
  const up = await h.patch(`/api/accounting/vendors/${v}`, { phone: '', notes: 'Pays net 15' }, owner);
  assert.equal(up.status, 200, JSON.stringify(up.body)); assert.equal(up.body.phone, null); assert.equal(up.body.notes, 'Pays net 15'); assert.equal(up.body.name, 'Surat Turf Supplies');
  await bill(v);
  assert.equal((await h.del(`/api/accounting/vendors/${v}`, owner)).status, 409);
  const v2 = await vendor(owner, 'Spare Vendor');
  assert.equal((await h.del(`/api/accounting/vendors/${v2}`, owner)).status, 200);
});

test('permissions: customers and staff without manage_accounting are refused; view_reports reads only', async () => {
  const v = await vendor();
  assert.equal((await h.get('/api/accounting/bills', null)).status, 401);
  assert.equal((await h.get('/api/accounting/bills', cust)).status, 403);
  run('UPDATE users SET permissions = ? WHERE email = ?', JSON.stringify(['manage_bookings']), DEMO_ACCOUNTS.staff1.email);
  assert.equal((await h.get('/api/accounting/bills', staff)).status, 403);
  assert.equal((await h.get('/api/accounting/approvals/count', staff)).status, 403);
  run('UPDATE users SET permissions = ? WHERE email = ?', JSON.stringify(['view_reports']), DEMO_ACCOUNTS.staff1.email);
  assert.equal((await h.get('/api/accounting/bills', staff)).status, 200);
  assert.equal((await h.post('/api/accounting/bills', { vendorId: v, billDate: dayFromNow(0), dueDate: dayFromNow(1), amountPaise: 100 }, staff)).status, 403);
  assert.equal((await h.get('/api/accounting/bills', admin)).status, 400, 'the admin must say which owner');
  assert.equal((await h.get(`/api/accounting/bills`, null)).status, 401);
});

test('a bill goes draft, pending approval, approved, paid with an audit trail', async () => {
  const v = await vendor();
  const b = await bill(v, {}, staff);
  assert.equal(b.status, 'draft');
  assert.equal((await h.post('/api/accounting/bills', { vendorId: v, billNo: 'inv-1', billDate: dayFromNow(-5), dueDate: dayFromNow(5), amountPaise: 5 }, staff)).status, 409, 'same vendor bill number');
  assert.equal((await h.post('/api/accounting/bills', { vendorId: v, billDate: dayFromNow(0), dueDate: dayFromNow(-1), amountPaise: 5 }, staff)).status, 400, 'due before bill date');
  assert.equal((await h.post('/api/accounting/bills', { vendorId: v, billDate: dayFromNow(0), dueDate: dayFromNow(1), amountPaise: 1.5 }, staff)).status, 400, 'paise are whole numbers');
  assert.equal((await h.post(`/api/accounting/bills/${b.id}/approve`, {}, owner)).status, 409, 'a draft cannot be approved');
  assert.equal((await h.post(`/api/accounting/bills/${b.id}/submit`, {}, staff)).body.status, 'pending_approval');
  assert.equal((await h.get('/api/accounting/approvals/count', owner)).body.count, 1);
  assert.equal((await h.patch(`/api/accounting/bills/${b.id}`, { amountPaise: 1 }, staff)).status, 409, 'locked once submitted');
  assert.equal((await h.post(`/api/accounting/bills/${b.id}/pay`, { paidDate: dayFromNow(0), method: 'cash' }, owner)).status, 409, 'not approved yet');
  assert.equal((await h.post(`/api/accounting/bills/${b.id}/approve`, {}, staff)).status, 403, 'the creator cannot approve');
  assert.equal((await h.post(`/api/accounting/bills/${b.id}/reject`, { reason: 'because' }, staff)).status, 403);
  const ap = await h.post(`/api/accounting/bills/${b.id}/approve`, {}, staff2);
  assert.equal(ap.status, 200, JSON.stringify(ap.body)); assert.equal(ap.body.status, 'approved');
  assert.equal((await h.get('/api/accounting/approvals/count', owner)).body.count, 0);
  assert.equal((await h.post(`/api/accounting/bills/${b.id}/pay`, { paidDate: dayFromNow(0), method: 'upi' }, staff)).status, 400, 'upi needs a reference');
  assert.equal((await h.post(`/api/accounting/bills/${b.id}/pay`, { paidDate: dayFromNow(2), method: 'cash' }, staff)).status, 400, 'not in the future');
  const paid = await h.post(`/api/accounting/bills/${b.id}/pay`, { paidDate: dayFromNow(0), method: 'upi', reference: '412345678901' }, staff);
  assert.equal(paid.status, 200, JSON.stringify(paid.body)); assert.equal(paid.body.status, 'paid');
  assert.equal((await h.post(`/api/accounting/bills/${b.id}/pay`, { paidDate: dayFromNow(0), method: 'cash' }, staff)).status, 409, 'cannot pay twice');
  assert.equal((await h.del(`/api/accounting/bills/${b.id}`, owner)).status, 409, 'paid bills stay');
  const d = await h.get(`/api/accounting/bills/${b.id}`, staff);
  assert.deepEqual(d.body.events.map((e: any) => e.action), ['bill.create', 'bill.submit', 'bill.approve', 'bill.pay']);
  assert.equal(d.body.events[2].actorName, 'Second Clerk');
});

test('the owner may approve their own bill; a rejection needs a reason and can be fixed and resubmitted', async () => {
  const v = await vendor();
  const b = await bill(v);
  await h.post(`/api/accounting/bills/${b.id}/submit`, {}, owner);
  const ap = await h.post(`/api/accounting/bills/${b.id}/approve`, {}, owner);
  assert.equal(ap.status, 200, 'owner approves own bill');
  const b2 = await bill(v, { billNo: 'INV-2' }, staff);
  await h.post(`/api/accounting/bills/${b2.id}/submit`, {}, staff);
  assert.equal((await h.post(`/api/accounting/bills/${b2.id}/reject`, {}, owner)).status, 400, 'reason required');
  const rj = await h.post(`/api/accounting/bills/${b2.id}/reject`, { reason: 'Wrong amount' }, owner);
  assert.equal(rj.body.status, 'rejected'); assert.equal(rj.body.rejectReason, 'Wrong amount');
  const fx = await h.patch(`/api/accounting/bills/${b2.id}`, { amountPaise: 99000 }, staff);
  assert.equal(fx.status, 200); assert.equal(fx.body.status, 'draft'); assert.equal(fx.body.rejectReason, null);
  assert.equal((await h.post(`/api/accounting/bills/${b2.id}/submit`, {}, staff)).body.status, 'pending_approval');
  assert.equal((await h.post(`/api/accounting/bills/${b2.id}/submit`, {}, staff)).status, 409);
});

test('paying can link an imported bank withdrawal, once, and never a deposit', async () => {
  const v = await vendor();
  const acct = (await h.post('/api/accounting/accounts', { kind: 'bank', name: 'HDFC', openingPaise: 100000000, openingDate: dayFromNow(-100) }, owner)).body.id;
  const out = (await h.post('/api/accounting/transactions', { accountId: acct, date: dayFromNow(-1), amountPaise: -1250000, description: 'UPI Surat Turf', reference: 'UTR998877' }, owner)).body.id;
  const inn = (await h.post('/api/accounting/transactions', { accountId: acct, date: dayFromNow(-1), amountPaise: 500000, description: 'Deposit' }, owner)).body.id;
  const lk = await h.get('/api/accounting/bills/linkable?amountPaise=1250000', owner);
  assert.equal(lk.body.items.length, 1); assert.equal(lk.body.items[0].id, out);
  const a = await bill(v, {}, owner); const b = await bill(v, { billNo: 'INV-9' }, owner);
  for (const x of [a, b]) { await h.post(`/api/accounting/bills/${x.id}/submit`, {}, owner); await h.post(`/api/accounting/bills/${x.id}/approve`, {}, owner); }
  assert.equal((await h.post(`/api/accounting/bills/${a.id}/pay`, { paidDate: dayFromNow(-1), method: 'bank', transactionId: inn }, owner)).status, 400);
  assert.equal((await h.post(`/api/accounting/bills/${a.id}/pay`, { paidDate: dayFromNow(-1), method: 'bank', transactionId: 'txn_nope' }, owner)).status, 404);
  assert.equal((await h.post(`/api/accounting/bills/${a.id}/pay`, { paidDate: dayFromNow(-1), method: 'bank', transactionId: out }, owner2)).status, 404);
  const p = await h.post(`/api/accounting/bills/${a.id}/pay`, { paidDate: dayFromNow(-1), method: 'bank', transactionId: out }, owner);
  assert.equal(p.status, 200, JSON.stringify(p.body)); assert.equal(p.body.payReference, 'UTR998877'); assert.equal(p.body.transactionId, out);
  assert.equal((await h.post(`/api/accounting/bills/${b.id}/pay`, { paidDate: dayFromNow(-1), method: 'bank', transactionId: out }, owner)).status, 409, 'already linked');
  assert.equal((await h.get('/api/accounting/bills/linkable', owner)).body.items.length, 0);
  assert.equal((await h.get(`/api/accounting/bills/${a.id}`, owner)).body.transaction.id, out);
});

test('stats, filters and search', async () => {
  const v = await vendor(); const v2 = await vendor(owner, 'Bescom');
  await bill(v, { billNo: 'OLD', dueDate: dayFromNow(-3), amountPaise: 100000 });                 // overdue draft
  const w = await bill(v2, { billNo: 'POWER-7', dueDate: dayFromNow(3), amountPaise: 250000, notes: 'Floodlights' }); // due this week
  await bill(v, { billNo: 'FAR', dueDate: dayFromNow(40), amountPaise: 700000 });
  await h.post(`/api/accounting/bills/${w.id}/submit`, {}, owner);
  const all = await h.get('/api/accounting/bills', owner);
  assert.equal(all.body.items.length, 3);
  assert.deepEqual([all.body.stats.overdueCount, all.body.stats.overduePaise, all.body.stats.dueWeekCount, all.body.stats.dueWeekPaise, all.body.stats.pendingCount], [1, 100000, 1, 250000, 1]);
  assert.equal(all.body.items[0].billNo, 'POWER-7', 'waiting bills come first');
  assert.equal((await h.get('/api/accounting/bills?overdue=1', owner)).body.items.map((b: any) => b.billNo).join(), 'OLD');
  assert.equal((await h.get('/api/accounting/bills?dueWeek=1', owner)).body.items.map((b: any) => b.billNo).join(), 'POWER-7');
  assert.equal((await h.get('/api/accounting/bills?status=pending_approval', owner)).body.items.length, 1);
  assert.equal((await h.get('/api/accounting/bills?status=draft,pending_approval', owner)).body.items.length, 3);
  assert.equal((await h.get('/api/accounting/bills?status=bogus', owner)).status, 400);
  assert.equal((await h.get('/api/accounting/bills?q=bescom', owner)).body.items.length, 1);
  assert.equal((await h.get('/api/accounting/bills?q=flood', owner)).body.items.length, 1);
  assert.equal((await h.get('/api/accounting/bills?q=100%25', owner)).body.items.length, 0, 'wildcards are literal');
  assert.equal((await h.get(`/api/accounting/bills?vendorId=${v2}`, owner)).body.items.length, 1);
  assert.equal((await h.get('/api/accounting/bills', owner2)).body.items.length, 0);
});

test('bills stay inside their owner, and drafts can be deleted', async () => {
  const v = await vendor();
  const b = await bill(v);
  assert.equal((await h.get(`/api/accounting/bills/${b.id}`, owner2)).status, 404);
  assert.equal((await h.post(`/api/accounting/bills/${b.id}/submit`, {}, owner2)).status, 404);
  assert.equal((await h.post('/api/accounting/bills', { vendorId: v, billDate: dayFromNow(0), dueDate: dayFromNow(1), amountPaise: 100 }, owner2)).status, 404, 'another owner\'s vendor');
  assert.equal((await h.post('/api/accounting/bills', { vendorId: v, categoryId: 'cat_nope', billDate: dayFromNow(0), dueDate: dayFromNow(1), amountPaise: 100 }, owner)).status, 400);
  assert.equal((await h.del(`/api/accounting/bills/${b.id}`, owner)).status, 200);
  assert.equal((await h.get(`/api/accounting/bills/${b.id}`, owner)).status, 404);
});

test('the bill document is sniffed, stored per bill and kept private', async () => {
  const v = await vendor(); const b = await bill(v);
  const send = (body: Buffer | string, token = owner, name = 'scan.png') => fetch(`${h.url}/api/accounting/bills/${b.id}/files?filename=${name}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' }, body });
  const up = await send(PNG); assert.equal(up.status, 201);
  const f = await up.json() as { id: string };
  assert.equal((await send('<script>alert(1)</script>', owner, 'x.pdf')).status, 415);
  assert.equal((await send(PNG, owner2)).status, 404);
  assert.equal((await send(PNG, cust)).status, 403);
  assert.equal((await h.get(`/api/accounting/bills/${b.id}`, owner)).body.bill.fileCount, 1);
  const dl = await fetch(`${h.url}/api/accounting/bills/${b.id}/files/${f.id}`, { headers: { authorization: `Bearer ${owner}` } });
  assert.equal(dl.status, 200); assert.deepEqual(Buffer.from(await dl.arrayBuffer()), PNG);
  assert.equal((await fetch(`${h.url}/api/accounting/bills/${b.id}/files/${f.id}`, { headers: { authorization: `Bearer ${owner2}` } })).status, 404);
  assert.equal((await h.del(`/api/accounting/bills/${b.id}/files/${f.id}`, owner)).status, 200);
  assert.equal((await h.get(`/api/accounting/bills/${b.id}`, owner)).body.files.length, 0);
});
