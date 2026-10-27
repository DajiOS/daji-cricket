import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { startHarness, dayFromNow, advance, type Harness } from './helpers.ts';
import { buildScenario } from './scenario.ts';
import { paise, depositRows, runAaSync } from '../src/accounting/aa.ts';
import { many, one, run } from '../src/db.ts';
import { seal } from '../src/vault.ts';
import { now } from '../src/clock.ts';

// A stand-in for Setu's v2 API (built from its published documents; no real Setu account was available).
let consentStatus = 'PENDING', sessionStatus = 'COMPLETED', created: any[] = [], headersSeen: Record<string, string | string[] | undefined> = {}, sessions = 0;
let txns: any[] = [];
const srv = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    headersSeen = req.headers; res.setHeader('content-type', 'application/json');
    const u = req.url ?? '', body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    if (req.method === 'POST' && u === '/v2/consents') { created.push(body); res.statusCode = 201; res.end(JSON.stringify({ id: 'cons-1', url: 'https://fiu-sandbox.setu.co/v2/consents/webview/cons-1', status: 'PENDING' })); return; }
    if (req.method === 'GET' && u === '/v2/consents/cons-1') { res.end(JSON.stringify({ id: 'cons-1', status: consentStatus })); return; }
    if (req.method === 'POST' && u === '/v2/sessions') { sessions++; res.statusCode = 201; res.end(JSON.stringify({ id: 'sess-' + sessions, status: 'PENDING' })); return; }
    if (req.method === 'GET' && u.startsWith('/v2/sessions/')) {
      res.end(JSON.stringify({ id: u.slice(13), status: sessionStatus, fips: [{ fipID: 'HDFC-FIP', accounts: [{ linkRefNumber: 'lr-1', maskedAccNumber: 'XXXXXX4321', FIStatus: 'READY',
        data: { account: { summary: { currentBalance: '7750.50' }, transactions: { transaction: txns } } } }, { linkRefNumber: 'lr-2', maskedAccNumber: 'XXXX9999', FIStatus: 'READY', data: { account: { transactions: { transaction: [] } } } }] }] })); return;
    }
    res.statusCode = 404; res.end('{"errorMsg":"no"}');
  });
});
const tx = (id: string, amount: string, type: string, daysAgo: number, narration: string) => ({ txnId: id, type, amount, currentBalance: '1000.00', mode: 'UPI', narration, transactionTimestamp: new Date(Date.parse(dayFromNow(-daysAgo) + 'T10:00:00+05:30')).toISOString(), valueDate: dayFromNow(-daysAgo) });

let h: Harness, owner: string, owner2: string, admin: string;
before(async () => { await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r)); h = await startHarness(); });
after(async () => { await h.close(); srv.close(); });
beforeEach(async () => {
  ({ owner, owner2, admin } = await buildScenario(h));
  consentStatus = 'PENDING'; sessionStatus = 'COMPLETED'; created = []; sessions = 0;
  txns = [tx('t1', '5000.00', 'CREDIT', 3, 'RENT RECEIVED'), tx('t2', '750.25', 'DEBIT', 2, 'ELECTRICITY')];
  run('DELETE FROM aa_settings');
  const put = (k: string, v: string) => run('INSERT INTO aa_settings(name, value, updated_at) VALUES(?,?,?)', k, seal(v), now());
  put('setu.baseUrl', `http://127.0.0.1:${(srv.address() as AddressInfo).port}`); put('setu.clientId', 'cid'); put('setu.clientSecret', 'sec'); put('setu.productInstanceId', 'prod-1'); put('webhookSecret', 'hook');
});

let n = 0;
async function bank(last4 = '4321'): Promise<string> {
  const r = await h.post('/api/accounting/accounts', { kind: 'bank', name: 'AA ' + n++, openingPaise: 0, last4 }, owner);
  assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.id;
}
const waitFor = async (fn: () => boolean) => { for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 20)); assert.ok(fn(), 'timed out'); };

test('amounts are read exactly, and only valid deposit lines are kept', () => {
  assert.equal(paise('1234.5'), 123450); assert.equal(paise('0.07'), 7); assert.equal(paise('1,000'), 100000); assert.equal(paise('-12.30'), -1230); assert.equal(paise('12.345'), 1235); assert.equal(paise('abc'), null); assert.equal(paise(''), null);
  const rows = depositRows({ data: { account: { transactions: { transaction: [tx('a', '10.10', 'DEBIT', 1, 'X'), { txnId: 'b', type: 'CREDIT', amount: 'bad', valueDate: '2026-01-01' }, { type: 'WEIRD', amount: '5' }, { txnId: 'c', type: 'CREDIT', amount: '3', valueDate: '2026-02-03', narration: 'No time' }] } } } });
  assert.equal(rows.length, 2); assert.equal(rows[0]!.amountPaise, -1010); assert.equal(rows[0]!.reference, 'aa:a'); assert.equal(rows[1]!.date, '2026-02-03'); assert.equal(rows[1]!.description, 'No time');
});

test('only the software owner sets the keys, and secrets never come back', async () => {
  assert.equal((await h.get('/api/admin/aa', owner)).status, 403);
  const r = await h.put('/api/admin/aa', { 'setu.clientId': 'x1', 'setu.clientSecret': 'topsecret', generateWebhookSecret: true }, admin);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(!JSON.stringify(r.body).includes('topsecret')); assert.equal(r.body.secretsSet['setu.clientSecret'], true); assert.match(r.body.webhookUrl, /\/api\/webhooks\/aa\/setu\?token=/);
  assert.equal((await h.put('/api/admin/aa', { 'setu.baseUrl': 'http://bad.example' }, admin)).status, 400);
});

test('the consent is created at Setu with the right body and headers, and Finvu says it is not built', async () => {
  const bad = await h.post('/api/accounting/aa/consents', { provider: 'setu', mobile: '12345' }, owner);
  assert.equal(bad.status, 400);
  const r = await h.post('/api/accounting/aa/consents', { provider: 'setu', mobile: '+91 98765 43210', months: 6 }, owner);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.status, 'PENDING'); assert.match(r.body.url, /webview\/cons-1/); assert.equal(r.body.mobile, '98••••••10');
  assert.equal(created[0].vua, '9876543210'); assert.deepEqual(created[0].consentDuration, { unit: 'MONTH', value: '6' });
  assert.equal(headersSeen['x-client-id'], 'cid'); assert.equal(headersSeen['x-product-instance-id'], 'prod-1');
  const f = await h.post('/api/accounting/aa/consents', { provider: 'finvu', mobile: '9876543210' }, owner);
  assert.equal(f.status, 501); assert.match(f.body.error?.message ?? JSON.stringify(f.body), /Finvu/);
});

test('a webhook needs the secret; the consent state is read back from Setu, not trusted from the body; data lands once', async () => {
  const a = await bank();
  const c = (await h.post('/api/accounting/aa/consents', { provider: 'setu', mobile: '9876543210' }, owner)).body;
  const hook = { type: 'CONSENT_STATUS_UPDATE', consentId: 'cons-1', success: true, data: { status: 'ACTIVE' } };
  assert.equal((await h.post('/api/webhooks/aa/setu', hook, null)).status, 401);
  assert.equal((await h.post('/api/webhooks/aa/setu?token=nope', hook, null)).status, 401);
  assert.equal((await h.post('/api/webhooks/aa/setu?token=hook', hook, null)).status, 200);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(one<{ status: string }>('SELECT status FROM aa_consents WHERE id = ?', c.id)!.status, 'PENDING', 'Setu still says PENDING, so the lie in the body is ignored');
  consentStatus = 'ACTIVE';
  await h.post('/api/webhooks/aa/setu?token=hook', hook, null);
  await waitFor(() => one<{ s: string | null }>('SELECT session_id s FROM aa_consents WHERE id = ?', c.id)?.s === 'sess-1');
  assert.equal(one<{ status: string }>('SELECT status FROM aa_consents WHERE id = ?', c.id)!.status, 'ACTIVE');
  await h.post('/api/webhooks/aa/setu?token=hook', { type: 'SESSION_STATUS_UPDATE', consentId: 'cons-1', dataSessionId: 'sess-1', data: { status: 'COMPLETED' } }, null);
  await waitFor(() => many('SELECT 1 FROM acct_transactions WHERE account_id = ?', a).length === 2);
  const rows = many<{ amount_paise: number; ext_id: string }>('SELECT amount_paise, ext_id FROM acct_transactions WHERE account_id = ? ORDER BY amount_paise', a);
  assert.deepEqual(rows.map((x) => x.amount_paise), [-75025, 500000]); assert.deepEqual(rows.map((x) => x.ext_id), ['aa:t2', 'aa:t1']);
  const st = (await h.get('/api/accounting/feed', owner)).body.accounts.find((x: any) => x.id === a);
  assert.equal(st.bankBalancePaise, 775050);
  const list = (await h.get('/api/accounting/aa', owner)).body.consents[0];
  assert.equal(list.accounts.length, 2); assert.equal(list.accounts.find((x: any) => x.last4 === '4321').accountId, a); assert.equal(list.accounts.find((x: any) => x.last4 === '9999').accountId, null, 'no books account has 9999');
  // asking again and getting the same lines adds nothing
  const s2 = await h.post(`/api/accounting/aa/consents/${c.id}/sync`, {}, owner);
  assert.equal(s2.status, 200, JSON.stringify(s2.body)); assert.equal(s2.body.newRows, 0);
  assert.equal(many('SELECT 1 FROM acct_transactions WHERE account_id = ?', a).length, 2);
});

test('syncing before approval says so, another owner cannot touch it, and a gateway account can be joined by hand', async () => {
  const c = (await h.post('/api/accounting/aa/consents', { provider: 'setu', mobile: '9876543210' }, owner)).body;
  const w = await h.post(`/api/accounting/aa/consents/${c.id}/sync`, {}, owner);
  assert.equal(w.status, 200); assert.equal(w.body.status, 'PENDING'); assert.match(w.body.message, /approve/);
  assert.equal((await h.post(`/api/accounting/aa/consents/${c.id}/sync`, {}, owner2)).status, 404);
  consentStatus = 'ACTIVE';
  const other = await bank('1111');
  const s = await h.post(`/api/accounting/aa/consents/${c.id}/sync`, {}, owner);
  assert.equal(s.body.ready, true); assert.equal(s.body.newRows, 0, 'nothing is joined yet: neither account matches the books');
  const acc = (await h.get('/api/accounting/aa', owner)).body.consents[0].accounts.find((x: any) => x.last4 === '4321');
  assert.equal((await h.put(`/api/accounting/aa/accounts/${acc.id}`, { accountId: other }, owner2)).status, 404);
  assert.equal((await h.put(`/api/accounting/aa/accounts/${acc.id}`, { accountId: other }, owner)).status, 200);
  const again = await h.post(`/api/accounting/aa/consents/${c.id}/sync`, {}, owner);
  assert.equal(again.body.newRows, 2); assert.equal(many('SELECT 1 FROM acct_transactions WHERE account_id = ?', other).length, 2);
  assert.equal((await h.put(`/api/accounting/aa/accounts/${acc.id}`, { accountId: '' }, owner)).status, 200);
});

test('the daily catch-up asks once a day, reads data that is ready, and survives a missed webhook', async () => {
  const a = await bank();
  const c = (await h.post('/api/accounting/aa/consents', { provider: 'setu', mobile: '9876543210' }, owner)).body;
  consentStatus = 'ACTIVE';
  assert.equal(await runAaSync(h.cfg), 1, 'activated, asked, and read in one pass');
  assert.equal(many('SELECT 1 FROM acct_transactions WHERE account_id = ?', a).length, 2);
  assert.equal(sessions, 1);
  advance(6 * 60_000);
  assert.equal(await runAaSync(h.cfg), 0, 'asked less than a day ago');
  assert.equal(sessions, 1);
  advance(24 * 3_600_000);
  sessionStatus = 'PENDING';
  assert.equal(await runAaSync(h.cfg), 0, 'asked again, bank not ready yet'); assert.equal(sessions, 2);
  sessionStatus = 'COMPLETED'; advance(6 * 60_000);
  assert.equal(await runAaSync(h.cfg), 1, 'picked up on the next pass');
  run("UPDATE aa_consents SET status = 'REVOKED'"); advance(6 * 60_000);
  assert.equal(await runAaSync(h.cfg), 0);
  assert.ok(c.id);
});
