import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { startHarness, dayFromNow, type Harness } from './helpers.ts';
import { buildScenario } from './scenario.ts';
import { many, run } from '../src/db.ts';

// A stand-in for Yodlee's API: checks every token's signature, remembers what was asked, and answers like Yodlee does.
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const seen: { method: string; url: string; sub: string; signed: boolean; body: string }[] = [];
let registered = false, connected = true;
const srv = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const [hd, bd, sg] = String(req.headers.authorization ?? '').replace('Bearer ', '').split('.');
    const signed = createVerify('RSA-SHA512').update(`${hd}.${bd}`).verify(publicKey, Buffer.from(sg ?? '', 'base64url'));
    const sub = signed ? JSON.parse(Buffer.from(bd ?? '', 'base64url').toString()).sub : '';
    seen.push({ method: req.method ?? '', url: req.url ?? '', sub, signed, body: Buffer.concat(chunks).toString() });
    res.setHeader('content-type', 'application/json');
    if (!signed) { res.statusCode = 401; res.end('{"errorCode":"Y008"}'); return; }
    if (req.url === '/user/register') { if (registered) { res.statusCode = 409; res.end('{"errorCode":"Y800"}'); } else { registered = true; res.statusCode = 201; res.end('{}'); } return; }
    if (req.url?.startsWith("/providers")) { res.end("{\"provider\":[]}"); return; }
    if (req.url?.startsWith("/accounts")) { res.end(JSON.stringify({ account: connected ? [{ id: 10002, providerName: 'HDFC Bank', accountName: 'Current account', accountNumber: 'xxxx4321', accountType: 'CURRENT', CONTAINER: 'bank', currentBalance: { amount: 125000.5 } }] : [] })); return; }
    if (req.method === 'DELETE' && req.url?.startsWith('/providerAccounts/')) { res.statusCode = 204; res.end(); return; }
    res.statusCode = 404; res.end('{}');
  });
});

let h: Harness, owner: string, owner2: string, ownerId: string;
before(async () => {
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  h = await startHarness({
    YODLEE_API_URL: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, YODLEE_FASTLINK_URL: 'https://fastlink.example.test/authenticate/', YODLEE_CLIENT_ID: 'cid', YODLEE_ADMIN_LOGIN: 'daji',
    YODLEE_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().replace(/\n/g, '\\n'), YODLEE_ISSUER: 'iss', YODLEE_WEBHOOK_SECRET: 'hook-secret',
  });
});
after(async () => { await h.close(); srv.close(); });
beforeEach(async () => { ({ owner, owner2, ownerId } = await buildScenario(h)); seen.length = 0; registered = false; connected = true; });

let n = 0;
async function bank(): Promise<string> {
  const r = await h.post('/api/accounting/accounts', { kind: 'bank', name: 'Yodlee bank ' + n++, openingPaise: 0 }, owner);
  assert.equal(r.status, 201); return r.body.id;
}

test('connecting a bank registers the owner once and hands back a FastLink session', async () => {
  assert.equal((await h.get('/api/accounting/feed', owner)).body.provider, 'yodlee');
  const s = await h.post('/api/accounting/feed/yodlee/session', {}, owner);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal(s.body.url, 'https://fastlink.example.test/authenticate/');
  assert.match(s.body.accessToken, /^Bearer ey/);
  assert.equal(s.body.params.configName, 'Aggregation');
  const reg = seen.find((x) => x.url === '/user/register')!;
  assert.equal(reg.signed, true); assert.equal(reg.sub, 'daji', 'registered as the admin user');
  assert.equal(JSON.parse(reg.body).user.loginName, `daji_${ownerId}`);
  // the token handed to the browser is for this owner only
  const payload = JSON.parse(Buffer.from(s.body.accessToken.split('.')[1], 'base64url').toString());
  assert.equal(payload.sub, `daji_${ownerId}`);
  assert.equal((await h.post('/api/accounting/feed/yodlee/session', {}, owner)).status, 200, 'a second time is fine (already registered)');
  assert.equal((await h.post('/api/accounting/feed/yodlee/session', {}, null)).status, 401);
});

test('connected accounts are listed with their link state, and can be linked and disconnected', async () => {
  const id = await bank();
  let l = await h.get('/api/accounting/feed/yodlee/accounts', owner);
  assert.equal(l.status, 200, JSON.stringify(l.body));
  assert.deepEqual(l.body.accounts.map((a: any) => [a.id, a.bankName, a.maskedNumber, a.balancePaise, a.linkedTo]), [['10002', 'HDFC Bank', '•••• 4321', 12500050, null]]);
  assert.equal((await h.post('/api/accounting/feed/link', { accountId: id, providerRef: '10002' }, owner)).body.providerRef, 'yodlee:10002');
  l = await h.get('/api/accounting/feed/yodlee/accounts', owner);
  assert.equal(l.body.accounts[0].linkedTo, id);
  assert.equal((await h.post('/api/accounting/feed/yodlee/disconnect', { providerAccountId: '10002' }, owner)).status, 200);
  assert.ok(seen.some((x) => x.method === 'DELETE' && x.url === '/providerAccounts/10002'));
  assert.equal((await h.get('/api/accounting/feed', owner)).body.accounts.find((a: any) => a.id === id).providerRef, null);
  assert.equal((await h.post('/api/accounting/feed/yodlee/disconnect', { providerAccountId: '1; DROP' }, owner)).status, 400);
  assert.equal((await h.get('/api/accounting/feed/yodlee/accounts', owner2)).body.accounts[0].linkedTo, null, 'another owner never sees this owner\'s links');
});

test('the webhook needs the secret, and a refresh for a linked owner pulls that owner only', async () => {
  const id = await bank();
  run("UPDATE acct_accounts SET provider_ref = 'yodlee:10002', source = 'yodlee' WHERE id = ?", id);
  const body = { event: { info: 'DATA_UPDATES', data: { userData: [{ user: { loginName: `daji_${ownerId}` } }] } } };
  assert.equal((await h.post('/api/webhooks/yodlee', body, null)).status, 401);
  assert.equal((await h.post('/api/webhooks/yodlee?token=wrong', body, null)).status, 401);
  const ok = await h.post('/api/webhooks/yodlee?token=hook-secret', body, null);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.owners, 1);
  const none = await h.post('/api/webhooks/yodlee?token=hook-secret', { event: { data: { userData: [{ user: { loginName: 'someone_else' } }] } } }, null);
  assert.equal(none.body.owners, 0);
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(seen.some((x) => x.url.startsWith('/transactions') && x.sub === `daji_${ownerId}`), 'the pull was made as that owner');
  assert.ok(many('SELECT 1 FROM acct_feed_state WHERE account_id = ?', id).length === 1);
});

test('without Yodlee settings the connect calls refuse, and the page policy allows FastLink only when configured', async () => {
  const { fastLinkSession, listProviderAccounts, webhookAuthorised } = await import('../src/accounting/yodlee.ts');
  const bare = { ...h.cfg, yodlee: { ...h.cfg.yodlee, apiUrl: '', privateKeyPem: '', issuer: '', fastLinkUrl: '', webhookSecret: '' } };
  await assert.rejects(fastLinkSession(bare, ownerId), /not set up/);
  await assert.rejects(listProviderAccounts(bare, ownerId), /not set up/);
  assert.equal(webhookAuthorised(bare, 'anything'), false, 'no secret configured means no webhook');
  const { sitePolicy } = await import('../src/http.ts');
  assert.match(sitePolicy(h.cfg), /frame-src [^;]*https:\/\/fastlink\.example\.test/);
  assert.match(sitePolicy(h.cfg), /form-action 'self' https:\/\/fastlink\.example\.test/);
  assert.doesNotMatch(sitePolicy(bare), /fastlink/);
});
void dayFromNow;

test('the software owner saves Yodlee keys on a screen: nothing secret comes back, a blank secret keeps the old one, and the saved keys take effect at once', async () => {
  const admin = await h.login('admin');
  assert.equal((await h.get('/api/admin/yodlee', owner)).status, 403, 'a business owner cannot see the platform keys');
  const v = await h.get('/api/admin/yodlee', admin);
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.equal(v.body.secretsSet.privateKeyPem, true);
  assert.ok(!JSON.stringify(v.body).includes('BEGIN'), 'the private key is never sent back');
  assert.ok(v.body.fromServerSettings.includes('apiUrl'));
  // bad input is refused
  assert.equal((await h.put('/api/admin/yodlee', { apiUrl: 'http://insecure.example' }, admin)).status, 400);
  assert.equal((await h.put('/api/admin/yodlee', { privateKeyPem: 'not a key' }, admin)).status, 400);
  // a webhook secret is generated, shown once as part of the address, and takes effect for the webhook
  const g = await h.put('/api/admin/yodlee', { generateWebhookSecret: true, clientId: 'new-client' }, admin);
  assert.equal(g.status, 200, JSON.stringify(g.body));
  assert.equal(g.body.fields.clientId, 'new-client');
  assert.match(g.body.webhookUrl, /\/api\/webhooks\/yodlee\?token=/);
  const token = new URL(g.body.webhookUrl).searchParams.get('token')!;
  assert.equal((await h.post(`/api/webhooks/yodlee?token=${token}`, { event: {} }, null)).status, 200);
  assert.equal((await h.post('/api/webhooks/yodlee?token=hook-secret', { event: {} }, null)).status, 401, 'the old secret no longer works');
  // saving with the key box left blank keeps the key; clearing a text value falls back to the server settings
  const same = await h.put('/api/admin/yodlee', { privateKeyPem: '', clientId: '' }, admin);
  assert.equal(same.body.secretsSet.privateKeyPem, true);
  assert.equal(same.body.fields.clientId, 'cid');
  // a new key is stored (re-wrapped) and used to sign the next token
  const k2 = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  assert.equal((await h.put('/api/admin/yodlee', { privateKeyPem: k2.replace(/\n/g, ' ') }, admin)).status, 200);
  const t = await h.post('/api/admin/yodlee/test', {}, admin);
  assert.equal(t.body.ok, false, 'the stand-in only knows the first key'); assert.match(t.body.message, /refused the keys \(401/);
  assert.equal((await h.put('/api/admin/yodlee', { clear: ['privateKeyPem'] }, admin)).status, 200);
  const t2 = await h.post('/api/admin/yodlee/test', {}, admin);
  assert.equal(t2.body.ok, true, JSON.stringify(t2.body)); // back on the server-settings key, which the stand-in accepts
  assert.equal((await h.post('/api/admin/yodlee/test', {}, owner)).status, 403);
});
