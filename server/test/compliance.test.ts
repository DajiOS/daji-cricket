import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, type Harness } from './helpers.ts';
import { invoiceNumber, financialYear, MAX_INVOICE_NO } from '../src/invoices.ts';
import { sha256, STAFF_TERMS_BODY } from '../src/legal.ts';
import { isCheckDay } from '../src/compliance.ts';

let h: Harness;
before(async () => { h = await startHarness({ REQUIRE_STAFF_TERMS: 'on' }); });
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); });

test('GST invoice numbers: 16 characters or fewer, allowed characters only, financial year from April', () => {
  assert.equal(financialYear('2026-03-31'), '25-26'); assert.equal(financialYear('2026-04-01'), '26-27');
  const n = invoiceNumber('DCG', '26-27', 123);
  assert.equal(n, 'DCG/26-27/000123'); assert.ok(n.length <= MAX_INVOICE_NO);
  assert.ok(invoiceNumber('ABCD', '26-27', 1).length <= MAX_INVOICE_NO);
  assert.ok(invoiceNumber('X', '26-27', 5).length <= MAX_INVOICE_NO);
});

test('compliance register lists the rules, logs a law change and runs the check', async () => {
  const owner = await h.login('owner1');
  const r = await h.get('/api/compliance', owner);
  assert.equal(r.status, 200);
  const codes = r.body.items.map((i: any) => i.code);
  for (const c of ['CASH_269ST', 'CASH_40A3', 'CASH_269SS', 'GST_INV_NO', 'GST_SAC', 'GST_RCM', 'PT_GUJARAT']) assert.ok(codes.includes(c), c);
  const ch = await h.post('/api/compliance/changes', { code: 'CASH_40A3', summary: 'Limit raised in Budget', oldValue: 'Rs 10,000', newValue: 'Rs 20,000', source: 'Finance Act' }, owner);
  assert.equal(ch.status, 201);
  assert.equal((await h.get('/api/compliance', owner)).body.changes[0].summary, 'Limit raised in Budget');
  assert.equal((await h.post('/api/compliance/changes', { code: 'NOPE', summary: 'x long enough' }, owner)).status, 400);
  const chk = await h.post('/api/compliance/check', {}, owner);
  assert.equal(chk.status, 200); assert.equal(chk.body.ran, true);
  assert.equal((await h.get('/api/compliance', await h.login('staff1'))).status, 403);
  assert.ok(isCheckDay('2026-11-01') && isCheckDay('2026-11-16') && !isCheckDay('2026-11-15'));
});

test('team members must accept the exact wording; acceptance stores hash, time and IP; owner sees the report', async () => {
  const owner = await h.login('owner1'), staff = await h.login('staff1');
  const blocked = await h.get('/api/staff/today', staff);
  assert.equal(blocked.status, 403); assert.equal(blocked.body.error.code, 'TERMS_REQUIRED');
  assert.equal((await h.get('/api/me', staff)).status, 200);                      // still lets the app load the terms screen
  const t = await h.get('/api/legal/staff-terms', staff);
  assert.equal(t.body.sha256, sha256(STAFF_TERMS_BODY)); assert.equal(t.body.accepted, null);
  const stale = await h.post('/api/legal/staff-terms/accept', { version: 1, sha256: 'f'.repeat(64) }, staff);
  assert.equal(stale.status, 409);
  const ok = await h.post('/api/legal/staff-terms/accept', { version: t.body.version, sha256: t.body.sha256 }, staff);
  assert.equal(ok.status, 200); assert.equal(ok.body.accepted.sha256, t.body.sha256); assert.ok(ok.body.accepted.acceptedAt > 0); assert.ok(ok.body.accepted.ip);
  assert.notEqual((await h.get('/api/staff/today', staff)).body?.error?.code, 'TERMS_REQUIRED');
  const rep = await h.get('/api/legal/staff-terms/report', owner);
  assert.equal(rep.status, 200);
  assert.ok(rep.body.items.some((i: any) => i.sha256 === t.body.sha256 && i.acceptedAt));
  assert.equal((await h.post('/api/legal/staff-terms/accept', {}, owner)).status, 403);
});

test('GST profile and invoice: receipt without GSTIN, tax invoice with it, same number every time', async () => {
  const owner = await h.login('owner1');
  assert.equal((await h.put('/api/accounting/gst-profile', { gstin: 'BAD' }, owner)).status, 400);
  assert.equal((await h.put('/api/accounting/gst-profile', { prefix: 'TOOLONG' }, owner)).status, 400);
  const p = await h.put('/api/accounting/gst-profile', { gstin: '24abcde1234f1z5', legalName: 'Daji Sports', sac: '997212', prefix: 'DCG' }, owner);
  assert.equal(p.status, 200); assert.equal(p.body.gstin, '24ABCDE1234F1Z5');
});

import { grounds, dayFromNow } from './helpers.ts';
import { run } from '../src/db.ts';

test('invoice: receipt with no tax before a GSTIN, then a tax invoice with SAC, CGST+SGST and the reverse-charge line; number never changes', async () => {
  const owner = await h.login('owner1'), staff = await h.login('staff1');
  await h.post('/api/legal/staff-terms/accept', { version: 1, sha256: sha256(STAFF_TERMS_BODY) }, staff);
  const g = (await grounds(h))[0]!;
  const r = await h.post('/api/staff/bookings', { groundId: g.id, date: dayFromNow(4), startTime: '08:00', slots: 2, customer: { name: 'Invoice Guy', phone: '9890000088' }, payment: { method: 'upi', amountPaise: 360000, reference: 'UTR998877665' } }, staff);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = r.body.booking.id as string;
  const ownerId = (await h.get('/api/me', owner)).body.user?.id ?? (await h.get('/api/me', owner)).body.id;
  const a = await h.get(`/api/bookings/${id}/invoice`, owner);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.kind, 'receipt'); assert.equal(a.body.cgstPaise + a.body.sgstPaise, 0);
  assert.match(a.body.number, /^DCG\/\d\d-\d\d\/\d{6}$/); assert.ok(a.body.number.length <= 16);
  assert.equal(a.body.reverseChargeLine, 'Tax payable on reverse charge: No');
  assert.equal((await h.get(`/api/bookings/${id}/invoice`, staff)).body.number, a.body.number);   // same booking, same invoice
  // a second booking after registering for GST
  run('INSERT INTO acct_settings(owner_id, gst_percent, updated_at) VALUES(?,?,0) ON CONFLICT(owner_id) DO UPDATE SET gst_percent = 18', ownerId, 18);
  await h.put('/api/accounting/gst-profile', { gstin: '24ABCDE1234F1Z5', legalName: 'Daji Sports', sac: '997212' }, owner);
  const r2 = await h.post('/api/staff/bookings', { groundId: g.id, date: dayFromNow(5), startTime: '08:00', slots: 2, customer: { name: 'Invoice Guy', phone: '9890000088' }, payment: { method: 'upi', amountPaise: 360000, reference: 'UTR998877666' } }, staff);
  assert.equal(r2.status, 201, JSON.stringify(r2.body));
  const b = await h.get(`/api/bookings/${r2.body.booking.id}/invoice`, owner);
  assert.equal(b.body.kind, 'tax_invoice'); assert.equal(b.body.sac, '997212'); assert.equal(b.body.supplierGstin, '24ABCDE1234F1Z5');
  assert.equal(b.body.taxablePaise + b.body.cgstPaise + b.body.sgstPaise, b.body.totalPaise);
  assert.ok(b.body.cgstPaise > 0 && Math.abs(b.body.cgstPaise - b.body.sgstPaise) <= 1);
  assert.notEqual(b.body.number, a.body.number); assert.ok(b.body.number.length <= 16);
});
