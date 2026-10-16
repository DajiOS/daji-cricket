import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { startHarness, dayFromNow, type Harness } from './helpers.ts';
import { buildScenario } from './scenario.ts';
import { syncAccount, clearYodleeTokens } from '../src/accounting/feed.ts';
import { subscribeYodleeWebhooks } from '../src/yodleeSettings.ts';
import { many, one } from '../src/db.ts';
import { SYSTEM } from '../src/audit.ts';

let txns: any[] = [], subs: Record<string, number> = {}, accountsList: any[] = [];
const srv = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    const u = req.url ?? '';
    if (u === '/auth/token') { res.end('{"token":{"accessToken":"t","expiresIn":1800}}'); return; }
    if (u === '/user/register') { res.statusCode = 201; res.end('{}'); return; }
    if (u.startsWith('/transactions')) { res.end(JSON.stringify({ transaction: txns })); return; }
    if (u === '/accounts') { res.end(JSON.stringify({ account: accountsList })); return; }
    if (u === '/providerAccounts') { res.end('{"providerAccount":[]}'); return; }
    const m = /^\/accounts\/(\d+)$/.exec(u);
    if (m) { const a = accountsList.find((x) => String(x.id) === m[1]); res.end(JSON.stringify({ account: a ? [a] : [] })); return; }
    const ev = /^\/configs\/notifications\/events\/(\w+)$/.exec(u);
    if (ev) {
      const k = ev[1]!;
      if (req.method === 'POST') { if (subs[k]) { res.statusCode = 409; res.end('{"errorCode":"Y800"}'); return; } subs[k] = 1; res.statusCode = 201; res.end('{}'); return; }
      if (req.method === 'PUT') { res.end('{}'); return; }
    }
    res.statusCode = 404; res.end('{}');
  });
});
const tx = (id: number, amount: number, date: string, desc: string, base = 'CREDIT') => ({ id, amount: { amount }, baseType: base, transactionDate: date, description: { original: desc } });

let h: Harness, owner: string, ownerId: string;
before(async () => {
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  h = await startHarness({ YODLEE_API_URL: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, YODLEE_FASTLINK_URL: 'https://fastlink.example.test/authenticate/', YODLEE_CLIENT_ID: 'cid', YODLEE_SECRET: 'shh', YODLEE_ADMIN_LOGIN: 'daji', YODLEE_WEBHOOK_SECRET: 'hook' });
});
after(async () => { await h.close(); srv.close(); });
beforeEach(async () => { ({ owner, ownerId } = await buildScenario(h)); txns = []; subs = {}; accountsList = []; clearYodleeTokens(); });

let n = 0;
async function acct(extra: Record<string, unknown> = {}): Promise<string> {
  const r = await h.post('/api/accounting/accounts', { kind: 'bank', name: 'Y2 ' + n++, openingPaise: 0, ...extra }, owner);
  assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.id;
}
const link = async (id: string, ref: string) => assert.equal((await h.post('/api/accounting/feed/link', { accountId: id, providerRef: ref }, owner)).status, 200);

test('a line already sent is never added twice, and an uploaded statement line takes the bank id instead of doubling', async () => {
  const a = await acct(); await link(a, '10');
  // a statement line uploaded earlier: same amount, one day earlier than the bank's date
  const csv = `Date,Description,Reference,Amount,Balance\r\n${dayFromNow(-4)},OPENING DEPOSIT,,100.00,100.00\r\n${dayFromNow(-3)},UPI/RENT/OCT,,5000.00,5100.00\r\n`;
  const { importStatement } = await import('../src/accounting/import.ts');
  importStatement(ownerId, SYSTEM, a, 'statement.csv', Buffer.from(csv), false);
  assert.equal(many('SELECT 1 FROM acct_transactions WHERE account_id = ?', a).length, 2);
  txns = [tx(901, 5000, dayFromNow(-2), 'RENT RECEIVED UPI'), tx(902, 750, dayFromNow(-1), 'Interest')];
  const r1 = await syncAccount(h.cfg, ownerId, SYSTEM, a);
  assert.equal(r1.adopted, 1); assert.equal(r1.rowsNew, 1);
  assert.equal(many('SELECT 1 FROM acct_transactions WHERE account_id = ? AND deleted_at IS NULL', a).length, 3, 'three lines in all, not four');
  assert.equal(one<{ e: string }>("SELECT ext_id e FROM acct_transactions WHERE account_id = ? AND amount_paise = 500000", a)!.e, '901');
  const r2 = await syncAccount(h.cfg, ownerId, SYSTEM, a);
  assert.equal(r2.rowsNew, 0); assert.equal(r2.adopted, 0);
  assert.equal(many('SELECT 1 FROM acct_transactions WHERE account_id = ?', a).length, 3);
});

test('the bank balance is kept beside the books balance', async () => {
  const a = await acct(); await link(a, '10');
  accountsList = [{ id: 10, providerName: 'HDFC', accountName: 'Current', accountNumber: 'xx4321', CONTAINER: 'bank', currentBalance: { amount: 7750 } }];
  txns = [tx(1, 7750, dayFromNow(-2), 'Deposit')];
  await syncAccount(h.cfg, ownerId, SYSTEM, a);
  const st = (await h.get('/api/accounting/feed', owner)).body.accounts.find((x: any) => x.id === a);
  assert.equal(st.bankBalancePaise, 775000); assert.equal(st.bookBalancePaise, 775000);
});

test('accounts whose last 4 digits match exactly one books account are joined and synced; others wait for a choice', async () => {
  const a = await acct({ last4: '4321' }); await acct({ last4: '5555' }); await acct({ last4: '5555' });
  accountsList = [
    { id: 10, providerAccountId: 1, providerName: 'HDFC', accountName: 'Current', accountNumber: 'xx4321', CONTAINER: 'bank', currentBalance: { amount: 100 } },
    { id: 11, providerAccountId: 2, providerName: 'SBI', accountName: 'Savings', accountNumber: 'xx5555', CONTAINER: 'bank' },
    { id: 12, providerAccountId: 3, providerName: 'AXIS', accountName: 'Other', accountNumber: 'xx0000', CONTAINER: 'bank' }];
  txns = [tx(5, 100, dayFromNow(-2), 'Deposit')];
  const r = (await h.post('/api/accounting/feed/yodlee/autolink', {}, owner)).body;
  assert.equal(r.linked.length, 1); assert.equal(r.linked[0].accountId, a); assert.equal(r.linked[0].synced, true);
  assert.deepEqual(r.needsChoice.sort(), ['11', '12']);
  assert.equal(many('SELECT 1 FROM acct_transactions WHERE account_id = ?', a).length, 1);
  assert.equal((await h.post('/api/accounting/feed/yodlee/autolink', {}, owner)).body.linked.length, 0, 'nothing left to join');
});

test('a credit card feeds a liability: it shows as owed, and is not counted as cash', async () => {
  const card = await acct({ holds: 'card', last4: '9999' });
  assert.equal((await h.get('/api/accounting/accounts', owner)).body.items.find((x: any) => x.id === card).holds, 'card');
  await link(card, '11');
  txns = [tx(1, 2000, dayFromNow(-2), 'Nets purchase', 'DEBIT')];
  accountsList = [{ id: 11, providerName: 'ICICI', accountName: 'Card', accountNumber: 'xx9999', CONTAINER: 'creditCard', currentBalance: { amount: 2000 } }];
  await syncAccount(h.cfg, ownerId, SYSTEM, card);
  const bs = (await h.get('/api/accounting/reports/balance-sheet', owner)).body;
  assert.ok(JSON.stringify(bs).includes('Credit cards'), Object.keys(bs).join());
  const st = (await h.get('/api/accounting/feed', owner)).body.accounts.find((x: any) => x.id === card);
  assert.equal(st.bankBalancePaise, -200000); assert.equal(st.bookBalancePaise, -200000);
  const cf = (await h.get(`/api/accounting/reports/cash-flow?from=${dayFromNow(-10)}&to=${dayFromNow(0)}`, owner)).body;
  assert.equal(cf.ties, true); assert.equal(cf.closingPaise, 0, 'the card is not cash');
});

test('Turn on instant updates subscribes each event, and updates one that exists', async () => {
  h.cfg.publicUrl = 'https://api.example.test';
  const r1 = await subscribeYodleeWebhooks(h.cfg);
  assert.equal(r1.ok, true, JSON.stringify(r1)); assert.equal(r1.events.length, 3);
  const r2 = await subscribeYodleeWebhooks(h.cfg);
  assert.equal(r2.ok, true, 'the second time each is updated');
  h.cfg.publicUrl = 'http://localhost:4000';
  assert.equal((await subscribeYodleeWebhooks(h.cfg)).ok, false, 'http is refused');
});
