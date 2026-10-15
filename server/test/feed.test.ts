import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { startHarness, dayFromNow, advance, DAY, type Harness } from './helpers.ts';
import { buildScenario } from './scenario.ts';
import { syncAccount, runFeedSync, yodleeToken } from '../src/accounting/feed.ts';
import { SYSTEM } from '../src/audit.ts';
import { many } from '../src/db.ts';
import { istDate } from '../src/time.ts';
import { now } from '../src/clock.ts';

let h: Harness, owner: string, owner2: string, ownerId: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => { ({ owner, owner2, ownerId } = await buildScenario(h)); });

let nameSeq = 0;
async function bank(): Promise<string> {
  const r = await h.post('/api/accounting/accounts', { kind: 'bank', name: 'HDFC' + (nameSeq++), openingPaise: 0 }, owner);
  assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.id;
}

test('a linked account is filled from the demo feed, and syncing again adds nothing', async () => {
  const id = await bank();
  assert.equal((await h.post('/api/accounting/feed/sync', { accountId: id }, owner)).status, 409, 'not linked yet');
  assert.equal((await h.get('/api/accounting/feed', owner)).body.provider, 'demo');
  const l = await h.post('/api/accounting/feed/link', { accountId: id, providerRef: 'DEMO-001' }, owner);
  assert.equal(l.status, 200, JSON.stringify(l.body));
  assert.equal(l.body.providerRef, 'demo:DEMO-001');
  const s1 = await h.post('/api/accounting/feed/sync', { accountId: id }, owner);
  assert.equal(s1.status, 200, JSON.stringify(s1.body));
  assert.ok(s1.body.rowsNew > 0);
  const n = many('SELECT 1 FROM acct_transactions WHERE account_id = ?', id).length;
  assert.equal(n, s1.body.rowsNew);
  const s2 = await h.post('/api/accounting/feed/sync', { accountId: id }, owner);
  assert.equal(s2.body.rowsNew, 0);
  assert.equal(many('SELECT 1 FROM acct_transactions WHERE account_id = ?', id).length, n);
  const st = (await h.get('/api/accounting/feed', owner)).body.accounts.find((a: any) => a.id === id);
  assert.equal(st.lastOk, true);
});

test('another owner cannot link or sync this account, and one bank account cannot be linked twice', async () => {
  const id = await bank();
  assert.equal((await h.post('/api/accounting/feed/link', { accountId: id, providerRef: 'X' }, owner2)).status, 404);
  assert.equal((await h.post('/api/accounting/feed/sync', { accountId: id }, owner2)).status, 404);
  await h.post('/api/accounting/feed/link', { accountId: id, providerRef: 'X' }, owner);
  const id2 = await bank();
  assert.equal((await h.post('/api/accounting/feed/link', { accountId: id2, providerRef: 'X' }, owner)).status, 409);
  assert.equal((await h.post('/api/accounting/feed/link', { accountId: id, providerRef: '' }, owner)).status, 200, 'unlink');
  assert.equal((await h.post('/api/accounting/feed/sync', { accountId: id }, owner)).status, 409);
});

test('the Yodlee provider signs its token, reads transactions, and skips pending ones', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const seen: string[] = [];
  const srv = createServer((req, res) => {
    const auth = String(req.headers.authorization ?? '').replace('Bearer ', ''), [hd, bd, sg] = auth.split('.');
    const ok = createVerify('RSA-SHA512').update(`${hd}.${bd}`).verify(publicKey, Buffer.from(sg ?? '', 'base64url'));
    seen.push(`${ok}:${JSON.parse(Buffer.from(bd ?? '', 'base64url').toString()).sub}:${req.url}`);
    res.setHeader('content-type', 'application/json');
    if (!ok) { res.statusCode = 401; res.end('{}'); return; }
    const d = dayFromNow(-2);
    res.end(JSON.stringify({ transaction: [
      { id: 1, baseType: 'CREDIT', amount: { amount: 2500.5 }, transactionDate: d, description: { original: 'UPI/412345678901/BOOKING' }, status: 'POSTED' },
      { id: 2, baseType: 'DEBIT', amount: { amount: 800 }, transactionDate: d, description: { original: 'NEFT/ELECTRICITY' }, status: 'POSTED' },
      { id: 3, baseType: 'CREDIT', amount: { amount: 99 }, transactionDate: d, description: { original: 'PENDING ITEM' }, status: 'PENDING' },
    ] }));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const cfg = { ...h.cfg, demoMode: false, yodlee: { apiUrl: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, fastLinkUrl: '', clientId: 'c', secret: 's', adminLoginName: 'daji', privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), issuer: 'iss', keyId: 'k1' } };
    const id = await bank();
    await h.post('/api/accounting/feed/link', { accountId: id, providerRef: 'DEMO' }, owner); // links as demo; relink under yodlee below
    const { run } = await import('../src/db.ts');
    run("UPDATE acct_accounts SET provider_ref = 'yodlee:12345', source = 'yodlee' WHERE id = ?", id);
    const r = await syncAccount(cfg, ownerId, SYSTEM, id);
    assert.equal(r.fetched, 2, 'the pending item is left out');
    assert.equal(r.rowsNew, 2, JSON.stringify([r.skipped, r.warnings, r.columns, r.rowsDuplicate]));
    const rows = many<{ amount_paise: number }>('SELECT amount_paise FROM acct_transactions WHERE account_id = ? ORDER BY amount_paise', id).map((x) => x.amount_paise);
    assert.deepEqual(rows, [-80000, 250050]);
    assert.ok(seen[0]!.startsWith(`true:daji_${ownerId}:`), seen[0]);
    assert.match(seen[0]!, /accountId=12345/);
    assert.equal((await syncAccount(cfg, ownerId, SYSTEM, id)).rowsNew, 0, 'a second pull adds nothing');
    assert.match(yodleeToken(cfg, 'x').split('.')[0]!, /^ey/);
    // a refused request is recorded against the account and reported
    cfg.yodlee.privateKeyPem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    await assert.rejects(syncAccount(cfg, ownerId, SYSTEM, id), /bank feed answered 401/);
    assert.equal(many<{ last_ok: number }>('SELECT last_ok FROM acct_feed_state WHERE account_id = ?', id)[0]!.last_ok, 0);
  } finally { srv.close(); }
});

test('the daily sweep syncs each linked account once a day', async () => {
  const id = await bank();
  await h.post('/api/accounting/feed/link', { accountId: id, providerRef: 'D1' }, owner);
  assert.equal(await runFeedSync(h.cfg), 1);
  assert.equal(await runFeedSync(h.cfg), 0, 'already done today');
  advance(DAY);
  assert.equal(await runFeedSync(h.cfg), 1);
  assert.ok(istDate(now()));
});
