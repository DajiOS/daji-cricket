// Construction inside Daji Admin (construction.ts, redesign step 8). The separate Construction package is folded into this
// server: a construction project is the task board's own project, orders are approved on the Approvals board, and supplier
// bills and certified RA bills become bills in the books. These tests carry over the package's P0 rules (exact amounts,
// no over-receipt, idempotent commands, retention cap, a certified bill made once and never changed) and check the walls
// between businesses, branches and the people who may not see money.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, type Harness } from './helpers.ts';
import { many, one, run } from '../src/db.ts';
import { lineAmount, taxOn } from '../src/construction.ts';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });

const SITE_PASSWORD = 'Site-Engineer-2026!';
interface W { owner: string; other: string; site: string; siteId: string; project: string; vendor: string; sub: string }
let w: W;
const call = <T = any>(method: string, path: string, token: string, body?: unknown, headers: Record<string, string> = {}) => h.call<T>(method, path, { token, body, headers });

beforeEach(async () => {
  h.reset();
  const owner = await h.login('owner1');
  w = { owner, other: await h.login('owner2') } as W;
  // a plain project of the task board, with a job on it, becomes the construction project
  w.project = (await call('POST', '/api/projects', owner, { name: 'House interior' })).body.id;
  assert.equal((await call('POST', '/api/tasks', owner, { title: 'Fix the kitchen tiles', projectId: w.project, photosRequired: 0 })).status, 201);
  w.vendor = (await call('POST', '/api/accounting/vendors', owner, { name: 'Shree Cement Traders', gstin: '24AAAAA0000A1Z5' })).body.id;
  w.sub = (await call('POST', '/api/accounting/vendors', owner, { name: 'Patel Tiling Works' })).body.id;
  const s = await call('POST', '/api/staff/team', owner, { firstName: 'Kiran', lastName: 'Site', email: 'site@daji.test', password: SITE_PASSWORD, permissions: ['manage_tasks'] });
  assert.equal(s.status, 201, JSON.stringify(s.body));
  w.siteId = s.body.id;
  w.site = (await h.post('/api/auth/login', { email: 'site@daji.test', password: SITE_PASSWORD })).body.token;
});

const start = (extra: Record<string, unknown> = {}) => call('POST', '/api/construction/projects', w.owner, { projectId: w.project, code: 'house-1', site: 'Adajan, Surat', retentionPct: 5, ...extra });
const order = (body: Record<string, unknown>, token = w.owner, headers: Record<string, string> = {}) => call('POST', `/api/construction/projects/${w.project}/orders`, token, { vendorId: w.vendor, lines: [{ description: 'OPC cement 53 grade', unit: 'bag', quantity: '200', ratePaise: 385_50, taxPct: 28 }], ...body }, headers);
async function approve(poId: string) {
  assert.equal((await call('POST', `/api/construction/orders/${poId}/submit`, w.owner)).status, 200);
  const req = (await call('GET', '/api/accounting/approvals/requests', w.owner)).body.items.find((r: any) => r.kind === 'purchase_order' && r.entityId === poId);
  assert.ok(req, 'the order waits on the Approvals board');
  const r = await call('POST', `/api/accounting/approvals/requests/${req.id}/approve`, w.owner, { note: 'Go ahead' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
}

test('a construction project is the same project record as the task board: one record, more views', async () => {
  const r = await start();
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.id, w.project);
  assert.equal(r.body.code, 'HOUSE-1');
  assert.equal(r.body.counts.jobs, 1);
  // still one row in projects, and the task board lists it as before
  assert.equal(one<{ n: number }>('SELECT COUNT(*) n FROM projects')!.n, 1);
  assert.ok((await call('GET', '/api/projects', w.owner)).body.items.some((p: any) => p.id === w.project));
  // starting it twice, or reusing a code, is refused
  assert.equal((await start()).status, 409);
  const fresh = await call('POST', '/api/construction/projects', w.owner, { name: 'Office fit-out', code: 'HOUSE-1' });
  assert.equal(fresh.status, 409);
  assert.equal(one<{ n: number }>('SELECT COUNT(*) n FROM projects')!.n, 1, 'a refused new project leaves nothing behind');
  const made = await call('POST', '/api/construction/projects', w.owner, { name: 'Office fit-out', code: 'OFFICE-1' });
  assert.equal(made.status, 201);
  const pf = (await call('GET', '/api/construction', w.owner)).body;
  assert.deepEqual(pf.items.map((p: any) => p.code).sort(), ['HOUSE-1', 'OFFICE-1']);
  assert.equal(pf.candidates.length, 0);
});

test('order totals are worked out on the server, exact to the paisa, and a total sent by the client is refused', async () => {
  await start();
  assert.equal(lineAmount(12_345, 99_99), 1_234_38); // 12.345 × ₹99.99 = ₹1,234.3766, half up
  assert.equal(taxOn(1_234_38, 1800), 222_19); // 18% of ₹1,234.38 = ₹222.1884
  const bad = await order({ totalPaise: 1 });
  assert.equal(bad.status, 400);
  const r = await order({ lines: [{ description: 'TMT bar 12 mm', unit: 'kg', quantity: '12.345', ratePaise: 99_99, taxPct: 18 }, { description: 'Binding wire', unit: 'kg', quantity: 10, ratePaise: 85_00 }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.poNo, 'PO-HOUSE-1-001');
  assert.deepEqual([r.body.subtotalPaise, r.body.taxPaise, r.body.totalPaise], [1_234_38 + 850_00, 222_19, 1_234_38 + 850_00 + 222_19]);
  assert.equal((await order({ lines: [{ description: 'x', unit: 'kg', quantity: '1.2345', ratePaise: 1 }] })).status, 400, 'four decimals refused');
  // another business's supplier cannot be used
  const theirs = (await call('POST', '/api/accounting/vendors', w.other, { name: 'Someone else' })).body.id;
  assert.equal((await order({ vendorId: theirs })).status, 400);
});

test('an order is approved on the Approvals board by the owner from ₹0, and the person who raised it cannot sign it', async () => {
  await start();
  const staffOrder = await order({}, w.site);
  assert.equal(staffOrder.status, 403, 'the site engineer without money rights cannot price an order');
  run("UPDATE users SET permissions = ? WHERE id = ?", JSON.stringify(['manage_tasks', 'view_revenue', 'manage_accounting']), w.siteId);
  const o = await order({ lines: [{ description: 'Sand', unit: 'brass', quantity: 1, ratePaise: 1 }] }, w.site);
  assert.equal(o.status, 201, JSON.stringify(o.body));
  assert.equal((await call('POST', `/api/construction/orders/${o.body.id}/submit`, w.site)).status, 200);
  const req = (await call('GET', '/api/accounting/approvals/requests', w.owner)).body.items.find((r: any) => r.kind === 'purchase_order' && r.entityId === o.body.id);
  assert.ok(req, 'even a 1 paisa order waits for the owner');
  assert.notEqual((await call('POST', `/api/accounting/approvals/requests/${req.id}/approve`, w.site, {})).status, 200);
  // sent back: a draft again, with the reason
  assert.equal((await call('POST', `/api/accounting/approvals/requests/${req.id}/send-back`, w.owner, { note: 'Get a second quote' })).status, 200);
  let ctx = (await call('GET', `/api/construction/orders/${o.body.id}`, w.owner)).body;
  assert.equal(ctx.order.status, 'draft');
  assert.equal(ctx.order.decidedNote, 'Get a second quote');
  await approve(o.body.id);
  ctx = (await call('GET', `/api/construction/orders/${o.body.id}`, w.owner)).body;
  assert.equal(ctx.order.status, 'approved');
  assert.ok(many("SELECT 1 FROM audit_log WHERE entity = 'construction_po' AND action = 'po.approve' AND entity_id = ?", o.body.id).length);
});

test('goods received: nothing beyond what is still to come, nothing before approval, and a refused receipt writes nothing', async () => {
  await start();
  const o = (await order({})).body;
  const line = (await call('GET', `/api/construction/orders/${o.id}`, w.owner)).body.lines[0];
  const receive = (lines: unknown[], token = w.site) => call('POST', `/api/construction/orders/${o.id}/receipts`, token, { lines });
  assert.equal((await receive([{ lineId: line.id, receivedQty: 10 }])).status, 409, 'not approved yet');
  await approve(o.id);
  const first = await receive([{ lineId: line.id, receivedQty: 120, rejectedQty: 5, rejectionReason: 'Bags torn' }]);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.order.status, 'partly_received');
  const over = await receive([{ lineId: line.id, receivedQty: '85.001' }]);
  assert.equal(over.status, 409);
  assert.equal(over.body.error.code, 'OVER_RECEIPT');
  assert.equal(one<{ n: number }>('SELECT COUNT(*) n FROM goods_receipts')!.n, 1, 'the refused receipt left nothing');
  assert.equal((await receive([{ lineId: line.id, receivedQty: 5, rejectedQty: 1 }])).status, 400, 'a rejection needs a reason');
  const last = await receive([{ lineId: line.id, receivedQty: 85 }]);
  assert.equal(last.status, 201);
  assert.equal(last.body.order.status, 'received');
  assert.equal(last.body.grnNo, 'GRN-002');
  // the site engineer sees quantities, never money
  const seen = (await call('GET', `/api/construction/orders/${o.id}`, w.site)).body;
  assert.equal(seen.order.totalPaise, null);
  assert.equal(seen.lines[0].ratePaise, null);
  assert.equal(seen.lines[0].receivedQty, '205');
  assert.equal(seen.bills, null);
  assert.equal((await call('GET', `/api/construction/projects/${w.project}/finance`, w.site)).status, 403);
});

test('a supplier bill against an order is a bill in the books, sent for approval, and cannot take the order over its total', async () => {
  await start();
  const o = (await order({})).body;
  await approve(o.id);
  const bill = (amountPaise: number, billNo: string) => call('POST', `/api/construction/orders/${o.id}/bills`, w.owner, { billNo, billDate: '2026-10-30', amountPaise });
  assert.equal((await call('POST', `/api/construction/orders/${o.id}/bills`, w.site, { billNo: 'X', billDate: '2026-10-30', amountPaise: 100 })).status, 403);
  const b = await bill(50_000_00, 'SCT/101');
  assert.equal(b.status, 201, JSON.stringify(b.body));
  assert.equal(b.body.bill.status, 'pending_approval');
  const books = (await call('GET', '/api/accounting/bills', w.owner)).body.items;
  assert.equal(books.length, 1);
  assert.equal(books[0].vendorName, 'Shree Cement Traders');
  assert.equal(books[0].amountPaise, 50_000_00);
  const over = await bill(o.totalPaise - 50_000_00 + 1, 'SCT/102');
  assert.equal(over.status, 409);
  assert.equal(over.body.error.code, 'OVER_BILLED');
  assert.equal(one<{ n: number }>('SELECT COUNT(*) n FROM acct_bills')!.n, 1, 'the refused bill is not in the books');
  const fin = (await call('GET', `/api/construction/projects/${w.project}/finance`, w.owner)).body;
  assert.equal(fin.figures.billedPaise, 50_000_00);
  assert.equal(fin.figures.committedPaise, o.subtotalPaise);
  assert.equal(fin.bills[0].poNo, o.poNo);
});

test('measured work, RA bills with retention capped by the order, and certifying makes one bill however often it is retried', async () => {
  await start();
  const wo = (await order({ kind: 'work', vendorId: w.sub, retentionPct: 5, lines: [{ description: 'Floor tiling', unit: 'sqm', quantity: 100, ratePaise: 450_00, taxPct: 18 }] })).body;
  assert.equal(wo.poNo, 'WO-HOUSE-1-001');
  await approve(wo.id);
  const lineId = (await call('GET', `/api/construction/orders/${wo.id}`, w.owner)).body.lines[0].id;
  const measure = (quantity: unknown) => call('POST', `/api/construction/orders/${wo.id}/measurements`, w.site, { lineId, quantity, location: 'Ground floor' });
  const m1 = await measure('40');
  assert.equal(m1.status, 201, JSON.stringify(m1.body));
  assert.equal((await measure(61)).status, 409, 'no more than the order quantity');
  // a correction is a new revision; the first figure stays on file
  const fixed = await call('POST', `/api/construction/measurements/${m1.body.id}/correct`, w.site, { quantity: '42.5', reason: 'Re-measured the passage' });
  assert.equal(fixed.status, 201);
  assert.equal(fixed.body.revision, 2);
  assert.equal(one<{ status: string }>('SELECT status FROM measurements WHERE id = ?', m1.body.id)!.status, 'superseded');
  // receipts are for supply orders
  assert.equal((await call('POST', `/api/construction/orders/${wo.id}/receipts`, w.owner, { lines: [{ lineId, receivedQty: 1 }] })).status, 409);

  const gross = lineAmount(42_500, 450_00), tax = taxOn(gross, 1800);
  const ra = (retention: number) => call('POST', `/api/construction/orders/${wo.id}/ra-bills`, w.owner, { measurementIds: [fixed.body.id], adjustments: [{ type: 'retention', amountPaise: retention, description: '5% retention' }] });
  assert.equal((await ra(Math.round(gross * 0.05) + 1)).status, 422, 'retention above 5% of gross is refused');
  assert.equal((await call('POST', `/api/construction/orders/${wo.id}/ra-bills`, w.owner, { measurementIds: [m1.body.id] })).status, 409, 'the superseded figure cannot be billed');
  const bill = await ra(Math.round(gross * 0.05));
  assert.equal(bill.status, 201, JSON.stringify(bill.body));
  assert.deepEqual([bill.body.grossPaise, bill.body.taxPaise, bill.body.netPaise], [gross, tax, gross + tax - Math.round(gross * 0.05)]);
  assert.equal((await ra(1)).status, 409, 'a measurement is billed once');

  const certify = () => call('POST', `/api/construction/ra-bills/${bill.body.id}/certify`, w.owner, { expectedVersion: 1 }, { 'idempotency-key': 'ra-cert-0001' });
  const c1 = await certify();
  assert.equal(c1.status, 200, JSON.stringify(c1.body));
  assert.equal(c1.body.raBill.status, 'certified');
  const c2 = await call('POST', `/api/construction/ra-bills/${bill.body.id}/certify`, w.owner, {});
  assert.equal(c2.status, 200);
  assert.equal(c2.body.replayed, true);
  const bills = many<{ amount_paise: number; status: string }>('SELECT amount_paise, status FROM acct_bills').map((b) => ({ ...b }));
  assert.deepEqual(bills, [{ amount_paise: bill.body.netPaise, status: 'pending_approval' }], 'one bill for the net amount, waiting for the bill rules');
  // final, even by direct SQL
  assert.throws(() => run('UPDATE ra_bills SET net_paise = 1 WHERE id = ?', bill.body.id), /cannot be changed/);
  assert.throws(() => run('DELETE FROM measurements WHERE id = ?', fixed.body.id), /cannot be removed/);
  assert.equal((await call('POST', `/api/construction/ra-bills/${bill.body.id}/cancel`, w.owner)).status, 409);
  const fin = (await call('GET', `/api/construction/projects/${w.project}/finance`, w.owner)).body.figures;
  assert.equal(fin.retentionHeldPaise, Math.round(gross * 0.05));
  assert.equal(fin.measuredPaise, gross, 'the corrected measurement counts once');
});

test('a retried order with the same Idempotency-Key makes one order, and another business or a hidden branch sees nothing', async () => {
  await start();
  const key = { 'idempotency-key': 'po-retry-0001' };
  const a = await order({}, w.owner, key), b = await order({}, w.owner, key);
  assert.equal(a.status, 201); assert.equal(b.status, 201);
  assert.equal(a.body.id, b.body.id);
  assert.equal(one<{ n: number }>('SELECT COUNT(*) n FROM purchase_orders')!.n, 1);

  // another owner: the same 404 as a made-up id, on every view
  for (const p of [`/api/construction/projects/${w.project}`, `/api/construction/projects/${w.project}/plan`, `/api/construction/projects/${w.project}/orders`, `/api/construction/orders/${a.body.id}`, `/api/construction/projects/prj_nope`]) {
    const r = await call('GET', p, w.other);
    assert.equal(r.status, 404, p);
    assert.ok(!JSON.stringify(r.body).includes('HOUSE'), p);
  }
  assert.equal((await call('GET', '/api/construction', w.other)).body.items.length, 0);

  // a restricted branch: the site engineer loses the project and its orders
  const area = (await call('POST', '/api/areas', w.owner, { name: 'Personal', restricted: true })).body.id;
  assert.equal((await call('PATCH', `/api/projects/${w.project}`, w.owner, { areaId: area })).status, 200);
  assert.equal((await call('GET', `/api/construction/orders/${a.body.id}`, w.site)).status, 404);
  assert.equal((await call('GET', '/api/construction', w.site)).body.items.length, 0);
  assert.equal((await call('GET', '/api/construction', w.owner)).body.items.length, 1);
  // someone with no construction rights at all
  const s2 = await call('POST', '/api/staff/team', w.owner, { firstName: 'Front', lastName: 'Desk', email: 'desk@daji.test', password: SITE_PASSWORD, permissions: ['manage_bookings'] });
  const desk = (await h.post('/api/auth/login', { email: 'desk@daji.test', password: SITE_PASSWORD })).body.token;
  assert.ok(s2.body.id);
  assert.equal((await call('GET', '/api/construction', desk)).status, 403);
});

test('BOQ changes are revisions, drawings keep their history, and the site sees the project drawings but nothing else in Documents', async () => {
  await start();
  const item = await call('POST', `/api/construction/projects/${w.project}/boq`, w.owner, { itemCode: 'c-01', description: 'Cement', unit: 'bag', quantity: 500, ratePaise: 380_00 });
  assert.equal(item.status, 201, JSON.stringify(item.body));
  assert.equal((await call('POST', `/api/construction/projects/${w.project}/boq`, w.owner, { itemCode: 'C-01', description: 'Again', unit: 'bag', quantity: 1, ratePaise: 1 })).status, 409);
  const rev = await call('PATCH', `/api/construction/boq/${item.body.id}`, w.owner, { quantity: 550 });
  assert.equal(rev.body.revision, 2);
  assert.equal((await call('PATCH', `/api/construction/boq/${item.body.id}`, w.owner, { quantity: 1 })).status, 409, 'only the current revision changes');
  const plan = (await call('GET', `/api/construction/projects/${w.project}/plan`, w.owner)).body;
  assert.equal(plan.boq.length, 1);
  assert.equal(plan.boqTotalPaise, 550 * 380_00);
  assert.equal((await call('GET', `/api/construction/projects/${w.project}/plan`, w.site)).body.boq[0].ratePaise, null);

  const up = (rev: string) => fetch(`${h.url}/api/construction/projects/${w.project}/documents?filename=ground-floor.txt&kind=drawing&drawingNo=a-101&revision=${rev}`, { method: 'POST', headers: { authorization: `Bearer ${w.owner}`, 'content-type': 'application/octet-stream' }, body: `Ground floor plan revision ${rev}` });
  assert.equal((await up('A')).status, 201);
  const second = await up('B');
  assert.equal(second.status, 201);
  const docs = ((await second.json()) as any).items;
  assert.deepEqual(docs.map((d: any) => [d.drawingNo, d.revision, d.current]), [['A-101', 'B', true], ['A-101', 'A', false]]);
  const file = await h.call('GET', `/api/construction/documents/${docs[0].docId}/file`, { token: w.site });
  assert.equal(file.status, 200);
  assert.match(String(file.body), /revision B/);
  // a document not on any project stays out of reach for the site
  const other = await fetch(`${h.url}/api/docs?filename=salary.txt`, { method: 'POST', headers: { authorization: `Bearer ${w.owner}`, 'content-type': 'application/octet-stream' }, body: 'Salary register' });
  const otherId = ((await other.json()) as any).id;
  assert.equal((await h.call('GET', `/api/construction/documents/${otherId}/file`, { token: w.site })).status, 404);
  assert.equal((await h.call('GET', `/api/docs/${otherId}/file`, { token: w.site })).status, 403);
});

test('defects are raised and closed on the Site view beside the project jobs', async () => {
  await start();
  const d = await call('POST', `/api/construction/projects/${w.project}/defects`, w.site, { title: 'Hairline crack in the lintel', location: 'Kitchen', severity: 'major', vendorId: w.sub });
  assert.equal(d.status, 201, JSON.stringify(d.body));
  let s = (await call('GET', `/api/construction/projects/${w.project}/site`, w.site)).body;
  assert.equal(s.jobs.length, 1);
  assert.equal(s.defects[0].vendorName, 'Patel Tiling Works');
  assert.equal((await call('PATCH', `/api/construction/defects/${d.body.id}`, w.site, { status: 'closed' })).status, 200);
  assert.equal((await call('PATCH', `/api/construction/defects/${d.body.id}`, w.site, { status: 'open' })).status, 400, 'reopening needs a reason');
  s = (await call('GET', `/api/construction/projects/${w.project}`, w.owner)).body;
  assert.equal(s.counts.openDefects, 0);
  assert.equal((await call('PATCH', `/api/construction/defects/${d.body.id}`, w.other, { status: 'open', note: 'x' })).status, 404);
});

test('Ask AI answers about construction behind the same walls, and leaves money out for people who may not see it', async () => {
  await start();
  const o = (await order({})).body;
  assert.equal((await call('POST', `/api/construction/orders/${o.id}/submit`, w.owner)).status, 200);
  const ask = (q: string, token: string) => h.post('/api/staff/ask', { question: q }, token);
  const mine = (await ask('Which purchase orders are waiting on the construction projects?', w.owner)).body;
  assert.equal(mine.intent, 'construction', JSON.stringify(mine));
  assert.match(mine.answer, /1 construction project; 1 order waiting for approval/);
  assert.match(JSON.stringify(mine.details), /committed/);
  const theirs = (await ask('Show my construction projects', w.site)).body;
  assert.ok(!/committed|budget|₹/.test(JSON.stringify(theirs.details)), JSON.stringify(theirs));
  assert.match(JSON.stringify(theirs.notes), /not shown/);
  assert.match((await ask('Show the construction projects', w.other)).body.answer, /no construction projects/);
  // the tool the AI connection calls gives the same answer
  const { runTool } = await import('../src/ask/claude.ts');
  const { userRow } = await import('../src/auth.ts');
  const site = runTool({ ownerId: one<{ owner_id: string }>('SELECT owner_id FROM projects WHERE id = ?', w.project)!.owner_id, user: userRow(w.siteId)! }, 'get_construction', {}) as any;
  assert.equal(site.projects[0].money, null);
  assert.equal(site.projects[0].ordersWaitingForApproval, 1);
});
