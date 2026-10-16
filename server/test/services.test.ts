import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, type Harness } from './helpers.ts';

let h: Harness, admin: string, owner: string;
let firstList: any;
before(async () => { h = await startHarness(); firstList = (await h.get('/api/admin/services', await h.login('admin'))).body; });
after(async () => { await h.close(); });
beforeEach(async () => { h.reset(); admin = await h.login('admin'); owner = await h.login('owner1'); });

test('the services notebook starts with the services we use, including the MSG91 account', async () => {
  const r = { body: firstList };
  const msg = r.body.items.find((s: any) => s.name === 'MSG91');
  assert.equal(msg.accountEmail, 'sqinchmoney@gmail.com');
  assert.ok(r.body.items.some((s: any) => s.name === 'Razorpay') && r.body.items.some((s: any) => s.name === 'Wix'));
});

test('only the software owner can read or change it', async () => {
  const staff = await h.login('staff1');
  assert.equal((await h.get('/api/admin/services', staff)).status, 403);
  assert.equal((await h.post('/api/admin/services', { name: 'X service' }, staff)).status, 403);
  assert.equal((await h.get('/api/admin/services', owner)).status, 403, 'a business owner no longer sees the platform notebook');
  assert.equal((await h.get('/api/admin/services', admin)).status, 200);
});

test('add, edit (clearing a field), and remove a service', async () => {
  const a = await h.post('/api/admin/services', { name: 'Domain registrar', accountEmail: 'dajicricket@gmail.com', phone: '7567156000', status: 'live', notes: 'Renews every October' }, admin);
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const id = a.body.id;
  const e = await h.call('PATCH', `/api/admin/services/${id}`, { token: admin, body: { status: 'problem', notes: '' } });
  assert.equal(e.body.status, 'problem'); assert.equal(e.body.notes, null); assert.equal(e.body.phone, '7567156000'); // untouched fields stay
  assert.equal((await h.call('DELETE', `/api/admin/services/${id}`, { token: admin })).status, 200);
  assert.equal((await h.call('PATCH', `/api/admin/services/${id}`, { token: admin, body: { status: 'live' } })).status, 404);
});

test('a secret key pasted into the notes is refused', async () => {
  const r = await h.post('/api/admin/services', { name: 'Some API', notes: 'key is ' + 'sk_' + 'live_51Hh3kJ9aBcDeFgHiJkLmNoPqRsTuVwXyZ123456' }, admin);
  assert.equal(r.status, 400); assert.equal(r.body.error.code, 'LOOKS_LIKE_A_KEY');
  assert.equal((await h.post('/api/admin/services', { name: 'Bad link', loginUrl: 'msg91.com' }, admin)).status, 400);
});

import { integrationStatuses, testIntegration, registerIntegration } from '../src/integrations.ts';
import { loadConfig } from '../src/config.ts';
const config = () => loadConfig({ PUBLIC_URL: 'http://localhost:4000', RATE_LIMIT: 'off', LOG: 'off', DEMO_MODE: 'on' });
import { many } from '../src/db.ts';

test('the connections list shows what each service still needs, by name only', async () => {
  const r = await h.get('/api/admin/integrations', admin);
  assert.equal(r.status, 200);
  const by = Object.fromEntries(r.body.items.map((i: any) => [i.id, i]));
  for (const id of ['whatsapp', 'msg91', 'razorpay', 'expo', 'claude', 'website', 'email']) assert.ok(by[id], id);
  assert.equal(by.expo.status, 'ready'); assert.equal(by.email.status, 'missing'); assert.deepEqual(by.email.missing, ['GMAIL_APP_PASSWORD']);
  assert.ok(Array.isArray(by.msg91.missing));
  assert.equal(JSON.stringify(r.body).includes('sk-test'), false);
  assert.equal((await h.get('/api/admin/integrations', await h.login('staff1'))).status, 403);
});

test('a live test reports success or the reason, and a future service is one registration away', async () => {
  const cfg = { ...config(), razorpay: { keyId: 'rzp_test_abc', keySecret: 's3cret', webhookSecret: 'w', apiUrl: 'https://rp.test' } } as any;
  const u = { id: 'u1', role: 'super_admin' } as any;
  const good = await testIntegration(cfg, u, 'razorpay', async () => ({ ok: true, status: 200, text: async () => '{}' }));
  assert.equal(good.ok, true); assert.match(good.message, /test mode/);
  const bad = await testIntegration(cfg, u, 'razorpay', async () => ({ ok: false, status: 401, text: async () => JSON.stringify({ error: { description: 'Authentication failed' } }) }));
  assert.equal(bad.ok, false); assert.match(bad.message, /401.*Authentication failed/);
  const down = await testIntegration(cfg, u, 'razorpay', async () => { throw new Error('ECONNRESET'); });
  assert.match(down.message, /Could not reach/);
  assert.match((await testIntegration(cfg, u, 'msg91')).message, /Not set up yet|no safe automatic test/);
  registerIntegration({ id: 'sheets', name: 'Google Sheets', what: 'x', setup: 'y', env: ['SHEETS_KEY'], have: () => ({ SHEETS_KEY: false }) });
  assert.equal(integrationStatuses(cfg).find((i) => i.id === 'sheets')!.status, 'missing');
  assert.equal(many('SELECT 1 FROM integration_tests WHERE integration_id = ?', 'razorpay').length, 1);
});

test('a note can be tied to a connection, but only a known one', async () => {
  const a = await h.post('/api/admin/services', { name: 'Payments account', connector: 'razorpay' }, admin);
  assert.equal(a.status, 201); assert.equal(a.body.connector, 'razorpay');
  assert.equal((await h.post('/api/admin/services', { name: 'Made up', connector: 'nope' }, admin)).status, 400);
});
