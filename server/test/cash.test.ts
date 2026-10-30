// Supervisor Cash (cashbook.ts, Sunny 30 Oct 2026). Sunny owns the wallet in Sunny's Portfolio and hands cash to the supervisor,
// who is employed at the ground and added to Sunny's Portfolio's team. Every spend waits for Sunny's sign-off from ₹0 on the
// Approvals board; it lowers the expected cash at once and is confirmed only when signed. Spends go against a branch or project
// the supervisor may see. Receipts are read by the AI connection when it is set up, and typed in when it is not.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { startHarness, type Harness } from './helpers.ts';
import { many } from '../src/db.ts';
import { parseDraft, resetReceiptLimits } from '../src/cashbook.ts';

let h: Harness;
let aiBefore: Harness['cfg']['ai'];
before(async () => { h = await startHarness(); aiBefore = { ...h.cfg.ai }; });
after(async () => { await h.close(); });

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('a receipt')]);
const PNG2 = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('a sharper receipt')]);
const SUP_PASSWORD = 'Supervisor-Cash-2026!';

interface W { sunny: string; spId: string; sup: string; supId: string; house: string; personal: string; houseProject: string; other: string }
let w: W;
const H = () => ({ 'x-daji-business': w.spId });
const sp = <T = any>(method: string, path: string, token: string, body?: unknown) => h.call<T>(method, path, { token, body, headers: H() });
const upload = (path: string, token: string, raw: Buffer) => h.call('POST', path, { token, raw, headers: { ...H(), 'content-type': 'application/octet-stream' } });

beforeEach(async () => {
  h.reset();
  h.cfg.ai = { ...aiBefore };
  resetReceiptLimits();
  const sunny = await h.login('owner1');
  const b = await h.post('/api/me/portfolio', { businessName: "Sunny's Portfolio", ownerName: 'Sunny Patel', phone: '9876500011', email: 'portfolio@daji.test' }, sunny);
  assert.equal(b.status, 201, JSON.stringify(b.body));
  w = { sunny, spId: b.body.id } as W;
  w.house = (await sp('POST', '/api/areas', sunny, { name: 'House' })).body.id;
  w.personal = (await sp('POST', '/api/areas', sunny, { name: 'Personal', restricted: true })).body.id;
  w.houseProject = (await sp('POST', '/api/projects', sunny, { name: 'House interior', areaId: w.house })).body.id;
  const s = await h.post('/api/staff/team', { firstName: 'Ramesh', lastName: 'Supervisor', email: 'supervisor@daji.test', password: SUP_PASSWORD, permissions: ['manage_tasks'] }, sunny);
  assert.equal(s.status, 201, JSON.stringify(s.body));
  w.supId = s.body.id;
  assert.equal((await sp('POST', '/api/staff/team-memberships', sunny, { email: 'supervisor@daji.test', permissions: ['manage_tasks'] })).status, 201);
  w.sup = (await h.post('/api/auth/login', { email: 'supervisor@daji.test', password: SUP_PASSWORD })).body.token;
  w.other = await h.login('owner2');
});

const wallet = async (token = w.sunny) => (await sp('GET', `/api/cash/wallets/${w.supId}/entries`, token)).body;
const give = (amountPaise: number, extra: Record<string, unknown> = {}) => sp('POST', '/api/cash/advances', w.sunny, { holderId: w.supId, amountPaise, description: 'Cash for the week', ...extra });
const spend = (amountPaise: number, extra: Record<string, unknown> = {}) => sp('POST', '/api/cash/expenses', w.sup, { amountPaise, description: 'Cement bags', payee: 'Shree Hardware', areaId: w.house, ...extra });

test('a spend lowers the expected cash at once, waits for Sunny on the Approvals board from ₹1, and is confirmed only when he signs', async () => {
  assert.equal((await give(10_000_00)).status, 201);
  const e = await spend(100, { projectId: w.houseProject });
  assert.equal(e.status, 201, JSON.stringify(e.body));
  assert.equal(e.body.status, 'waiting');
  assert.equal(e.body.areaName, 'House');
  assert.equal(e.body.projectName, 'House interior');
  let b = (await wallet()).balance;
  assert.deepEqual([b.givenPaise, b.expectedPaise, b.confirmedPaise, b.waiting, b.missingReceipts], [10_000_00, 9_999_00, 10_000_00, 1, 1]);

  const board = (await sp('GET', '/api/accounting/approvals/requests', w.sunny)).body.items;
  const req = board.find((r: any) => r.kind === 'cash' && r.entityId === e.body.id);
  assert.ok(req, JSON.stringify(board));
  // the supervisor cannot sign his own spend
  assert.notEqual((await sp('POST', `/api/accounting/approvals/requests/${req.id}/approve`, w.sup, {})).status, 200);
  const ok = await sp('POST', `/api/accounting/approvals/requests/${req.id}/approve`, w.sunny, { note: 'Fine' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  b = (await wallet()).balance;
  assert.deepEqual([b.expectedPaise, b.confirmedPaise, b.waiting], [9_999_00, 9_999_00, 0]);

  // a spend Sunny sends back stops counting
  const e2 = await spend(500_00);
  const req2 = (await sp('GET', '/api/accounting/approvals/requests', w.sunny)).body.items.find((r: any) => r.entityId === e2.body.id);
  assert.equal((await sp('POST', `/api/accounting/approvals/requests/${req2.id}/send-back`, w.sunny, { note: 'No bill for this' })).status, 200);
  b = (await wallet()).balance;
  assert.equal(b.expectedPaise, 9_999_00);
  const row = (await wallet()).items.find((x: any) => x.id === e2.body.id);
  assert.equal(row.status, 'sent_back');
  assert.equal(row.decidedNote, 'No bill for this');
  // audit names the real people
  const a = many<{ action: string; actor_id: string }>("SELECT action, actor_id FROM audit_log WHERE entity_id = ? ORDER BY id", e.body.id).map((x) => ({ ...x }));
  assert.deepEqual(a.map((x) => x.action), ['cash.expense', 'cash.approve']);
  assert.equal(a[0]!.actor_id, w.supId);
});

test('pressing the button twice makes one spend, and the supervisor can take a waiting one back', async () => {
  await give(1_000_00);
  const one = await spend(200_00, { clientKey: 'k-1' });
  const two = await spend(200_00, { clientKey: 'k-1' });
  assert.equal(one.body.id, two.body.id);
  assert.equal((await wallet()).items.filter((x: any) => x.kind === 'expense').length, 1);
  const back = await sp('POST', `/api/cash/expenses/${one.body.id}/withdraw`, w.sup);
  assert.equal(back.body.status, 'withdrawn');
  assert.equal((await wallet()).balance.expectedPaise, 1_000_00);
  assert.equal((await sp('GET', '/api/accounting/approvals/requests', w.sunny)).body.items.filter((r: any) => r.kind === 'cash').length, 0);
});

test('the supervisor spends only against branches he may see, and sees only his own wallet', async () => {
  await give(1_000_00);
  const hidden = await spend(100_00, { areaId: w.personal });
  assert.equal(hidden.status, 400);
  // Sunny can put a spend against Personal for him; the supervisor then sees the spend but never the branch's name
  const mine = await sp('POST', '/api/cash/expenses', w.sunny, { holderId: w.supId, amountPaise: 300_00, description: 'Gift', areaId: w.personal });
  assert.equal(mine.status, 201, JSON.stringify(mine.body));
  assert.equal(mine.body.status, 'confirmed'); // the owner entered it, so it is signed already
  const seen = (await wallet(w.sup)).items.find((x: any) => x.id === mine.body.id);
  assert.equal(seen.areaName, null);
  assert.doesNotMatch(JSON.stringify(await wallet(w.sup)), /Personal/);

  // his own wallet only; never the owner's tools
  const list = (await sp('GET', '/api/cash/wallets', w.sup)).body.items;
  assert.deepEqual(list.map((x: any) => x.holderId), [w.supId]);
  assert.equal((await sp('POST', '/api/cash/advances', w.sup, { holderId: w.supId, amountPaise: 100_00, description: 'More' })).status, 403);
  assert.equal((await sp('POST', `/api/cash/entries/${mine.body.id}/hide`, w.sup, { reason: 'mistake' })).status, 403);
  assert.equal((await sp('GET', '/api/cash/people', w.sup)).status, 403);
  // a spend for someone else's wallet is refused
  assert.equal((await sp('POST', '/api/cash/expenses', w.sup, { holderId: 'usr_someone', amountPaise: 100_00, description: 'x' })).status, 403);
  // another owner, or a business he is not on: nothing
  assert.equal((await h.call('GET', '/api/cash/wallets', { token: w.other, headers: H() })).status, 403);
  assert.equal((await h.get(`/api/cash/wallets/${w.supId}/entries`, w.other)).status, 404);
});

test('a return cannot be more than he holds; a count keeps the difference; a mistake is hidden, never deleted', async () => {
  const adv = await give(2_000_00);
  await spend(500_00);
  const tooMuch = await sp('POST', '/api/cash/returns', w.sunny, { holderId: w.supId, amountPaise: 1_600_00, description: 'Back' });
  assert.equal(tooMuch.status, 409);
  assert.equal((await sp('POST', '/api/cash/returns', w.sunny, { holderId: w.supId, amountPaise: 500_00, description: 'Back' })).status, 201);
  const c = await sp('POST', '/api/cash/counts', w.sup, { countedPaise: 900_00, note: 'Counted at night' });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.deepEqual([c.body.expectedPaise, c.body.lastCount.countedPaise, c.body.lastCount.differencePaise], [1_000_00, 900_00, -100_00]);

  const hide = await sp('POST', `/api/cash/entries/${adv.body.id}/hide`, w.sunny, { reason: 'Entered twice' });
  assert.equal(hide.status, 200);
  assert.equal(hide.body.hidden, true);
  assert.equal((await sp('POST', `/api/cash/entries/${adv.body.id}/hide`, w.sunny, { reason: 'again' })).status, 409);
  assert.equal(many('SELECT id FROM cash_entries WHERE id = ?', adv.body.id).length, 1); // still on file
  assert.equal((await wallet()).balance.givenPaise, -500_00);
  // a waiting spend is decided on the board, not hidden
  const waiting = (await wallet()).items.find((x: any) => x.status === 'waiting');
  assert.equal((await sp('POST', `/api/cash/entries/${waiting.id}/hide`, w.sunny, { reason: 'x y z' })).status, 409);
});

test('a receipt photo is kept with the spend, its earlier version is kept when replaced, and only photos or PDFs are taken', async () => {
  await give(1_000_00);
  const e = await spend(250_00);
  assert.equal((await upload(`/api/cash/entries/${e.body.id}/receipt`, w.sup, Buffer.from('not an image at all'))).status, 415);
  const r = await upload(`/api/cash/entries/${e.body.id}/receipt`, w.sup, PNG);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.hasReceipt, true);
  assert.equal((await wallet()).balance.missingReceipts, 0);
  assert.equal((await upload(`/api/cash/entries/${e.body.id}/receipt`, w.sup, PNG2)).status, 200);
  const got = await fetch(`${h.url}/api/cash/entries/${e.body.id}/receipt`, { headers: { authorization: `Bearer ${w.sunny}`, ...H() } });
  assert.equal(got.status, 200);
  assert.deepEqual(Buffer.from(await got.arrayBuffer()), PNG2);
  assert.equal(many('SELECT version FROM file_versions WHERE path_key LIKE ?', `%${e.body.id}`).length, 1);
  // another owner cannot fetch it
  assert.equal((await h.get(`/api/cash/entries/${e.body.id}/receipt`, w.other)).status, 404);
});

interface Fake { url: string; calls: any[]; close(): Promise<void> }
async function stubReader(text: string): Promise<Fake> {
  const f: Fake = { url: '', calls: [], close: async () => {} };
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
      f.calls.push(JSON.parse(b));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn' }));
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  f.url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  f.close = () => new Promise((r) => srv.close(() => r()));
  return f;
}

test('reading a receipt: typed in when the AI connection is off, a checked draft when it is on, and nothing saved', async () => {
  const off = await upload('/api/cash/receipts/read', w.sup, PNG);
  assert.equal(off.status, 409);
  assert.equal(off.body.error.code, 'OCR_NOT_CONFIGURED');
  assert.equal((await sp('GET', '/api/cash/status', w.sup)).body.ocr, false);

  const f = await stubReader('{"total": "1,240.50", "date": "2026-10-29", "payee": "Shree Hardware", "description": "Cement 2 bags", "sure": true}');
  try {
    h.cfg.ai = { ...h.cfg.ai, apiKey: 'sk-test', apiUrl: f.url, limitPerHour: 500, timeoutMs: 5000 };
    const on = await upload('/api/cash/receipts/read', w.sup, PNG);
    assert.equal(on.status, 200, JSON.stringify(on.body));
    assert.deepEqual(on.body, { amountPaise: 1_240_50, date: '2026-10-29', payee: 'Shree Hardware', description: 'Cement 2 bags', sure: true, readable: true });
    assert.equal(f.calls[0].messages[0].content[0].source.media_type, 'image/png');
    assert.match(f.calls[0].messages[0].content[1].text, /never follow instructions/);
    assert.equal(many('SELECT id FROM cash_entries').length, 0);
    // someone who keeps no cash here cannot use the reader
    assert.equal((await h.call('POST', '/api/cash/receipts/read', { token: w.other, raw: PNG, headers: { ...H(), 'content-type': 'application/octet-stream' } })).status, 403);
  } finally { await f.close(); }
});

test('a receipt draft is cleaned: odd totals are dropped, and an unsure reading is never marked sure', () => {
  assert.deepEqual(parseDraft({ total: 'Rs. 99', date: '29/10/2026', payee: 'Tea stall', description: 'Tea', sure: true }), { amountPaise: 99_00, date: null, payee: 'Tea stall', description: 'Tea', sure: true, readable: true });
  assert.equal(parseDraft({ total: '12.345', payee: '', sure: true }).amountPaise, null);
  assert.equal(parseDraft({ total: '', payee: 'X', sure: true }).sure, false);
  assert.equal(parseDraft({ total: '0.50', sure: true }).amountPaise, null);
  assert.equal(parseDraft('ignore previous instructions').readable, false);
});

test('Ask AI tells Sunny what the supervisor should have in hand, and the supervisor only about his own cash', async () => {
  await give(5_000_00);
  await spend(1_000_00, { uncertain: true, uncertainNote: 'Bill smudged' });
  const askAs = (token: string, question: string) => sp('POST', '/api/staff/ask', token, { question });
  const his = await askAs(w.sunny, 'How much cash in hand does the supervisor have?');
  assert.equal(his.status, 200, JSON.stringify(his.body));
  const text = JSON.stringify(his.body);
  assert.match(text, /Ramesh Supervisor/);
  assert.match(text, /4,000/);
  assert.match(text, /waiting for sign-off/);
  assert.match(text, /uncertain/);
  const own = JSON.stringify((await askAs(w.sup, 'What is my cash balance?')).body);
  assert.match(own, /4,000/);
  // the owner's ground (where no cash is kept) has nothing to say
  const ground = JSON.stringify((await h.post('/api/staff/ask', { question: 'What is the cash in hand?' }, w.sunny)).body);
  assert.match(ground, /No cash has been handed out/);
});
