import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { startHarness, type Harness } from './helpers.ts';
import { buildScenario } from './scenario.ts';
import { signAws, fetchAwsMonth, fetchAnthropicMonth, makeExpectedInvoices } from '../src/billing.ts';
import { many, run } from '../src/db.ts';
import { istDate } from '../src/time.ts';
import { now } from '../src/clock.ts';

let h: Harness, admin: string, owner: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => { const sc = await buildScenario(h); owner = sc.owner; admin = sc.admin; });

// Cross-checked against a second, independent implementation of the SigV4 steps (not against a live AWS call).
test('the AWS request signature follows the SigV4 steps', () => {
  const auth = signAws({ method: 'GET', host: 'example.amazonaws.com', path: '/', headers: {}, body: '', region: 'us-east-1', service: 'service', accessKey: 'AKIDEXAMPLE', secret: 'wJalrXUtnFEXAMPLEKEY', amzDate: '20150830T123600Z' });
  assert.equal(auth, 'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=0509ea18de1fd5465933f2e496738cba4fffb0c50659afc1d9c90a131d76a41f');
});

test('only the software owner can see or change billing', async () => {
  assert.equal((await h.get('/api/admin/billing', owner)).status, 403);
  assert.equal((await h.get('/api/admin/billing', admin)).status, 200);
  assert.equal((await h.post('/api/admin/billing/services', { name: 'X service', category: 'tools', cycle: 'monthly', currency: 'INR' }, owner)).status, 403);
});

test('services and invoices give the cost picture in rupees', async () => {
  assert.equal((await h.post('/api/admin/billing/services/catalog', {}, admin)).body.added > 5, true);
  const svc = (await h.get('/api/admin/billing', admin)).body.services as any[];
  const wix = svc.find((s) => s.name === 'Website plan'), aws = svc.find((s) => s.name === 'Server (Lightsail)');
  const today = istDate(now());
  const a = await h.post('/api/admin/billing/invoices', { serviceId: wix.id, invoiceNo: 'W-1', invoiceDate: today, amountMinor: 1000000 }, admin);
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(a.body.gstMinor, 180000, '18% GST from the service');
  assert.equal(a.body.inrPaise, 1180000);
  const b = await h.post('/api/admin/billing/invoices', { serviceId: aws.id, invoiceDate: today, amountMinor: 1500, fxRate: 80 }, admin);
  assert.equal(b.body.inrPaise, 120000, '15 USD at 80 = 1200 rupees');
  const s = (await h.get('/api/admin/billing', admin)).body.summary;
  assert.equal(s.thisMonthPaise, 1180000 + 120000);
  assert.equal(s.last12MonthsPaise, 1300000);
  const paid = await h.patch(`/api/admin/billing/invoices/${a.body.id}`, { status: 'paid', paidOn: today }, admin);
  assert.equal(paid.body.status, 'paid');
  assert.equal((await h.del(`/api/admin/billing/services/${wix.id}`, admin)).body.removed, false, 'a service with invoices is only switched off');
});

test('a fixed fee makes an expected invoice when it falls due, once', async () => {
  const sv = await h.post('/api/admin/billing/services', { name: 'Domain test', category: 'domain', cycle: 'yearly', currency: 'INR', expectedMinor: 120000, gstPercent: 18, nextDue: '2026-01-15' }, admin);
  assert.equal(sv.status, 201, JSON.stringify(sv.body));
  const n = makeExpectedInvoices('2026-10-01');
  assert.equal(n, 1);
  assert.equal(makeExpectedInvoices('2026-10-01'), 0);
  const inv = many<{ status: string; inr_paise: number }>("SELECT status, inr_paise FROM sw_invoices WHERE external_id = 'due:2026-01-15'")[0]!;
  assert.equal(inv.status, 'expected'); assert.equal(inv.inr_paise, 141600);
  assert.equal((await h.get('/api/admin/billing', admin)).body.summary.last12MonthsPaise, 0, 'expected invoices stay out of the totals');
  assert.equal(many<{ d: string }>("SELECT next_due d FROM sw_services WHERE name = 'Domain test'")[0]!.d, '2027-01-15');
});

test('automatic invoices come from AWS, Anthropic and Razorpay; a paid one is left alone', async () => {
  const seen: string[] = [];
  const srv = createServer((req, res) => { seen.push(req.url ?? ''); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ items: [{ status: 'captured', fee: 236, tax: 36 }, { status: 'failed', fee: 0 }] })); });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const f = (async (u: any, init: any) => {
      const url = String(u);
      if (url.includes('anthropic.com')) return new Response(JSON.stringify({ data: [{ results: [{ amount: '1234.5' }, { amount: '65.5' }] }], has_more: false }), { status: 200 });
      if (url.includes('ce.us-east-1')) { assert.match(init.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=AKIA1\//); return new Response(JSON.stringify({ ResultsByTime: [{ Total: { UnblendedCost: { Amount: '12.34' } } }] }), { status: 200 }); }
      return new Response(JSON.stringify({ items: [{ status: 'captured', fee: 236, tax: 36 }, { status: 'failed', fee: 0 }] }), { status: 200 });
    }) as typeof fetch;
    assert.equal(await fetchAnthropicMonth('k', '2026-09', f), 1300);
    assert.equal(await fetchAwsMonth({ id: 'AKIA1', secret: 's' }, '2026-09', 'Amazon Lightsail', f), 1234);
    const { fetchAutoInvoices } = await import('../src/billing.ts');
    await h.post('/api/admin/billing/services/catalog', {}, admin);
    h.cfg.razorpay.keyId = 'rzp'; h.cfg.razorpay.keySecret = 's'; h.cfg.razorpay.apiUrl = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    await h.put('/api/admin/billing/settings', { anthropicAdminKey: 'sk-ant-admin-x', awsAccessKeyId: 'AKIA1', awsSecretAccessKey: 'sec', usdInr: 80 }, admin);
    const r1 = await fetchAutoInvoices(h.cfg, { id: 'x', role: 'super_admin' } as any, f);
    assert.ok(r1.every((x) => !x.error), JSON.stringify(r1));
    const rows = many<{ name: string; inr: number; status: string }>("SELECT s.name, i.inr_paise inr, i.status FROM sw_invoices i JOIN sw_services s ON s.id = i.service_id WHERE i.source = 'auto' ORDER BY s.name");
    assert.ok(rows.length >= 6, JSON.stringify(rows));
    const rz = rows.find((x) => x.name === 'Payment fees')!; assert.equal(rz.inr, 236, 'fee 200 + 36 GST');
    const ai = rows.find((x) => x.name === 'Ask AI')!; assert.equal(ai.inr, 104000, '13 USD at 80');
    // run again: nothing doubles; mark one paid and change nothing in it
    run("UPDATE sw_invoices SET status = 'paid' WHERE source = 'auto' AND id IN (SELECT id FROM sw_invoices WHERE source = 'auto' LIMIT 1)");
    await fetchAutoInvoices(h.cfg, { id: 'x', role: 'super_admin' } as any, f);
    assert.equal(many("SELECT 1 FROM sw_invoices WHERE source = 'auto'").length, rows.length);
    const set = (await h.get('/api/admin/billing', admin)).body.settings;
    assert.equal(set.keysSet.anthropicAdminKey, true); assert.equal(JSON.stringify(set).includes('sk-ant'), false, 'keys never come back');
  } finally { srv.close(); }
});
