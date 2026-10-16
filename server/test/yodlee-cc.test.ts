import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { startHarness, type Harness } from './helpers.ts';
import { buildScenario } from './scenario.ts';
import { bankStatus } from '../src/accounting/yodlee.ts';
import { clearYodleeTokens, setYodleeRetryDelays, syncAccount, feedLog } from '../src/accounting/feed.ts';
import { testYodlee } from '../src/yodleeSettings.ts';
import { many } from '../src/db.ts';
import { SYSTEM } from '../src/audit.ts';

// A stand-in for a Yodlee account that uses a client ID and secret (no private key).
let tokenCalls = 0, badSecret = false, expireNext = false, busyFor = 0, calls: { method: string; url: string; auth: string; login: string }[] = [];
let issued = 0;
const srv = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString();
    res.setHeader('content-type', 'application/json');
    if (req.url === '/auth/token') {
      tokenCalls++;
      const p = new URLSearchParams(body);
      if (badSecret || p.get('clientId') !== 'cid' || p.get('secret') !== 'shh') { res.statusCode = 401; res.end('{"errorCode":"Y303","errorMessage":"Invalid"}'); return; }
      issued++; res.end(JSON.stringify({ token: { accessToken: `tok-${issued}-${req.headers.loginname}`, expiresIn: 1800 } })); return;
    }
    calls.push({ method: req.method ?? '', url: req.url ?? '', auth: String(req.headers.authorization ?? ''), login: String(req.headers.loginname ?? '') });
    if (expireNext) { expireNext = false; res.statusCode = 401; res.end('{"errorCode":"Y008"}'); return; }
    if (busyFor > 0) { busyFor--; res.statusCode = 503; res.end('{}'); return; }
    if (req.url?.startsWith('/providers')) { res.end('{"provider":[]}'); return; }
    if (req.url === '/user/register') { res.statusCode = 201; res.end('{}'); return; }
    if (req.url === '/accounts') { res.end(JSON.stringify({ account: [
      { id: 10, providerAccountId: 77, providerName: 'HDFC Bank', accountName: 'Current', accountNumber: 'xxxx4321', CONTAINER: 'bank', currentBalance: { amount: 100.5 } },
      { id: 11, providerAccountId: 78, providerName: 'ICICI', accountName: 'Card', accountNumber: 'xxxx9999', CONTAINER: 'creditCard', currentBalance: { amount: 500 } },
      { id: 12, providerAccountId: 78, providerName: 'ICICI', accountName: 'Loan', accountNumber: '0001', CONTAINER: 'loan' }, { id: 13, providerName: 'X', CONTAINER: 'investment' }] })); return; }
    if (req.url === '/providerAccounts') { res.end(JSON.stringify({ providerAccount: [{ id: 77, refreshInfo: { status: 'SUCCESS' } }, { id: 78, refreshInfo: { status: 'FAILED', additionalStatus: 'INCORRECT_CREDENTIALS' } }] })); return; }
    if (req.method === 'PUT' && req.url?.startsWith('/providerAccounts?providerAccountIds=')) { res.end('{}'); return; }
    if (req.url?.startsWith('/transactions')) { res.end(JSON.stringify({ transaction: [{ id: 1, amount: { amount: 10 }, baseType: 'CREDIT', transactionDate: '2026-10-10', description: { original: 'Deposit' } }] })); return; }
    res.statusCode = 404; res.end('{}');
  });
});

let h: Harness, owner: string, ownerId: string;
before(async () => {
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  h = await startHarness({ YODLEE_API_URL: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, YODLEE_FASTLINK_URL: 'https://fastlink.example.test/authenticate/', YODLEE_CLIENT_ID: 'cid', YODLEE_SECRET: 'shh', YODLEE_ADMIN_LOGIN: 'daji', YODLEE_CONFIG_NAME: 'IndiaBanks' });
  setYodleeRetryDelays([5, 5]);
});
after(async () => { await h.close(); srv.close(); });
beforeEach(async () => { ({ owner, ownerId } = await buildScenario(h)); calls = []; tokenCalls = 0; badSecret = false; expireNext = false; busyFor = 0; clearYodleeTokens(); });

test('client ID and secret sign in at /auth/token, and the token is reused', async () => {
  assert.equal((await h.get('/api/accounting/feed/yodlee/accounts', owner)).status, 200);
  assert.equal((await h.get('/api/accounting/feed/yodlee/accounts', owner)).status, 200);
  assert.equal(tokenCalls, 1, 'one sign-in served both pages of calls');
  assert.ok(calls.every((c) => c.auth.startsWith('Bearer tok-1-')));
  assert.match(calls[0]!.auth, new RegExp(ownerId.slice(0, 6)));
});

test('a rejected token is renewed once; a busy Yodlee is retried; a wrong secret gives a plain message', async () => {
  expireNext = true;
  assert.equal((await h.get('/api/accounting/feed/yodlee/accounts', owner)).status, 200);
  assert.equal(tokenCalls, 2);
  busyFor = 2;
  assert.equal((await h.get('/api/accounting/feed/yodlee/accounts', owner)).status, 200);
  busyFor = 5;
  assert.equal((await h.get('/api/accounting/feed/yodlee/accounts', owner)).status, 502, 'gives up after two retries');
  clearYodleeTokens(); badSecret = true;
  const r = await h.get('/api/accounting/feed/yodlee/accounts', owner);
  assert.equal(r.status, 502); assert.match(r.body.error.message, /client ID and secret/);
});

test('connected banks, cards and loans come back with a plain status; FastLink gets the config name and fix flow', async () => {
  const l = (await h.get('/api/accounting/feed/yodlee/accounts', owner)).body.accounts;
  assert.deepEqual(l.map((a: any) => a.container), ['bank', 'creditCard', 'loan']);
  assert.equal(l[0].status.code, 'ok'); assert.equal(l[0].last4, '4321');
  assert.equal(l[1].status.code, 'login'); assert.equal(l[1].status.action, 'fix');
  const s = await h.post('/api/accounting/feed/yodlee/session', {}, owner);
  assert.equal(s.body.params.configName, 'IndiaBanks');
  const e = await h.post('/api/accounting/feed/yodlee/session', { flow: 'edit', providerAccountId: '78' }, owner);
  assert.equal(e.body.params.flow, 'edit'); assert.equal(e.body.params.providerAccountId, '78');
  assert.equal((await h.post('/api/accounting/feed/yodlee/session', { flow: 'edit' }, owner)).status, 400);
  assert.equal((await h.post('/api/accounting/feed/yodlee/refresh', { providerAccountId: '77' }, owner)).status, 200);
  assert.ok(calls.some((c) => c.method === 'PUT' && c.url.endsWith('providerAccountIds=77')));
});

test('plain bank statuses', () => {
  assert.equal(bankStatus('SUCCESS').code, 'ok');
  assert.equal(bankStatus('IN_PROGRESS').code, 'working');
  assert.equal(bankStatus('FAILED', 'USER_INPUT_REQUIRED').action, 'otp');
  for (const a of ['INCORRECT_CREDENTIALS', 'PASSWORD_EXPIRED', 'ADDL_AUTHENTICATION_REQUIRED']) assert.equal(bankStatus('FAILED', a).action, 'fix');
  assert.equal(bankStatus('FAILED', 'ACCOUNT_LOCKED').code, 'locked');
  assert.equal(bankStatus('FAILED', 'CONSENT_EXPIRED').code, 'consent');
  assert.equal(bankStatus('FAILED', 'SITE_UNAVAILABLE').action, null);
  assert.equal(bankStatus('FAILED', 'SOMETHING_NEW').code, 'failed');
});

test('Test connection reports success and the time taken', async () => {
  const r = await testYodlee(h.cfg);
  assert.equal(r.ok, true); assert.match(r.message, /client ID and secret/); assert.ok(typeof r.ms === 'number');
});

test('every sync is logged, and two syncs of one account never overlap', async () => {
  const a = await h.post('/api/accounting/accounts', { kind: 'bank', name: 'Feed bank', openingPaise: 0 }, owner);
  assert.equal((await h.post('/api/accounting/feed/link', { accountId: a.body.id, providerRef: '10' }, owner)).status, 200);
  const [x, y] = await Promise.allSettled([syncAccount(h.cfg, ownerId, SYSTEM, a.body.id), syncAccount(h.cfg, ownerId, SYSTEM, a.body.id)]);
  const codes = [x, y].map((p) => p.status === 'rejected' ? (p.reason as { code: string }).code : 'ok').sort();
  assert.deepEqual(codes, ['SYNC_RUNNING', 'ok']);
  const log = feedLog(ownerId);
  assert.equal(log.length, 1); assert.equal(log[0]!.ok, true); assert.equal(log[0]!.newRows, 1); assert.equal(log[0]!.trigger, 'manual');
  const api = (await h.get('/api/accounting/feed/log', owner)).body.items;
  assert.equal(api.length, 1);
  assert.ok(many('SELECT 1 FROM acct_feed_log').length >= 1);
});
