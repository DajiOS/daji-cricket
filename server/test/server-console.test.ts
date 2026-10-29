import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHarness, type Harness } from './helpers.ts';
import { many } from '../src/db.ts';
import { userByEmail } from '../src/auth.ts';
import { runTool } from '../src/ask/claude.ts';
import { classify } from '../src/ask/builtin.ts';
import { sshLink, DEFAULT_CODING_URL } from '../src/serverConsole.ts';

// Settings › Server: the live server status, the Lightsail "Connect using SSH" button and the AI coding console (the owner, never staff).

let h: Harness, dir: string;
const SECRET = 'rzp_secret_never_shown_456';
before(async () => { dir = mkdtempSync(join(tmpdir(), 'daji-server-')); h = await startHarness({ DATA_DIR: dir, RAZORPAY_KEY_ID: 'rzp_test_abc', RAZORPAY_KEY_SECRET: SECRET, BACKUP_PASSPHRASE: 'pass phrase for tests' }); });
after(async () => { await h.close(); rmSync(dir, { recursive: true, force: true }); });
beforeEach(() => h.reset());

const owner1Id = () => userByEmail('owner1@daji.test')!.id;

test('SC-01 the software owner sees the server status, with no secret in it', async () => {
  const admin = await h.login('admin');
  const r = await h.get('/api/admin/server', admin);
  assert.equal(r.status, 200);
  const s = r.body.status;
  assert.equal(s.ok, true);
  assert.equal(s.database, 'ok');
  assert.equal(s.demo, true);
  assert.ok(s.warnings.some((w: string) => /Demo mode is on/.test(w)), 'demo mode is called out');
  assert.ok(s.memory.totalMb > 0 && s.memory.usedPercent >= 0 && s.memory.usedPercent <= 100);
  assert.ok(s.disk && s.disk.totalGb > 0, 'the data disk is measured');
  assert.equal(s.version, null, 'no version recorded unless APP_VERSION is set: never invented');
  assert.match(s.node, /^v\d+/);
  const text = JSON.stringify(r.body);
  assert.ok(!text.includes(SECRET) && !text.includes('pass phrase for tests'), 'no secret value in the answer');
});

test('SC-02 the ground owner may use it; staff, a customer and nobody signed in are refused', async () => {
  const o = await h.login('owner1');
  assert.equal((await h.get('/api/admin/server', o)).status, 200, 'the ground owner sees it');
  assert.equal((await h.put('/api/admin/server/console', { instance: 'Daji-1' }, o)).status, 200, 'and can set it');
  for (const who of ['staff1', 'customer'] as const) {
    const t = await h.login(who);
    assert.equal((await h.get('/api/admin/server', t)).status, 403, `${who} cannot read it`);
    assert.equal((await h.put('/api/admin/server/console', { instance: 'x' }, t)).status, 403, `${who} cannot change it`);
    assert.equal((await h.post('/api/admin/server/opened', { what: 'ssh' }, t)).status, 403);
  }
  assert.equal((await h.get('/api/admin/server', null)).status, 401);
});

test('SC-03 the SSH button stays off until the instance is saved, then opens Amazon\'s browser SSH for that instance and region', async () => {
  const admin = await h.login('admin');
  const before = (await h.get('/api/admin/server', admin)).body.console;
  assert.equal(before.instance, '');
  assert.equal(before.sshUrl, null);
  assert.equal(before.region, 'ap-south-1', 'Mumbai by default, where the server runs');
  assert.equal(before.codingUrl, DEFAULT_CODING_URL);
  const r = await h.put('/api/admin/server/console', { instance: 'Daji-Ubuntu-1', region: 'ap-south-1' }, admin);
  assert.equal(r.status, 200);
  assert.equal(r.body.sshUrl, 'https://lightsail.aws.amazon.com/ls/remote/ap-south-1/instances/Daji-Ubuntu-1/terminal?protocol=ssh');
  assert.equal(r.body.instanceUrl, 'https://lightsail.aws.amazon.com/ls/webapp/ap-south-1/instances/Daji-Ubuntu-1/connect');
  assert.equal(r.body.regionName, 'Mumbai');
  const again = (await h.get('/api/admin/server', admin)).body.console;
  assert.equal(again.sshUrl, r.body.sshUrl, 'kept after a reload');
  assert.equal(sshLink('us-east-1', 'a b'), 'https://lightsail.aws.amazon.com/ls/remote/us-east-1/instances/a%20b/terminal?protocol=ssh');
});

test('SC-04 bad input is refused with the field named, and nothing is stored', async () => {
  const admin = await h.login('admin');
  for (const [body, field] of [
    [{ instance: 'bad name; rm -rf /' }, 'instance'], [{ instance: '../../etc' }, 'instance'], [{ instance: 42 }, 'instance'],
    [{ region: 'mars-1' }, 'region'], [{ codingUrl: 'javascript:alert(1)' }, 'codingUrl'], [{ codingUrl: 'http://claude.ai/code' }, 'codingUrl'], [{ codingUrl: 'https://' + 'a'.repeat(400) }, 'codingUrl'],
  ] as const) {
    const r = await h.put('/api/admin/server/console', body, admin);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.error.details.fields[0].field, field);
  }
  assert.equal((await h.get('/api/admin/server', admin)).body.console.instance, '');
  assert.equal((await h.post('/api/admin/server/opened', { what: 'shell' }, admin)).status, 400);
});

test('SC-05 the coding console address can be changed and cleared back to the default; saving twice changes nothing more', async () => {
  const admin = await h.login('admin');
  assert.equal((await h.put('/api/admin/server/console', { codingUrl: 'https://github.com/DajiOS/daji-cricket' }, admin)).body.codingUrl, 'https://github.com/DajiOS/daji-cricket');
  await h.put('/api/admin/server/console', { instance: 'Daji-1' }, admin);
  const kept = (await h.get('/api/admin/server', admin)).body.console;
  assert.equal(kept.codingUrl, 'https://github.com/DajiOS/daji-cricket', 'saving one field keeps the others');
  assert.equal((await h.put('/api/admin/server/console', { codingUrl: '' }, admin)).body.codingUrl, DEFAULT_CODING_URL);
  await h.put('/api/admin/server/console', { instance: 'Daji-1' }, admin);
  assert.equal(many('SELECT * FROM server_console').length, 1, 'one row, never duplicated');
});

test('SC-06 changes and every button press are in the audit log', async () => {
  const admin = await h.login('admin');
  await h.put('/api/admin/server/console', { instance: 'Daji-1' }, admin);
  for (const what of ['ssh', 'coding', 'lightsail']) assert.equal((await h.post('/api/admin/server/opened', { what }, admin)).status, 200);
  const actions = many<{ action: string }>("SELECT action FROM audit_log WHERE entity = 'server_console' ORDER BY rowid").map((a) => a.action);
  assert.deepEqual(actions, ['server_console.update', 'server_console.open_ssh', 'server_console.open_coding', 'server_console.open_lightsail']);
});

test('SC-07 Settings › Connections lists the Lightsail SSH connection, missing until the instance is saved', async () => {
  const admin = await h.login('admin');
  const find = async () => (await h.get('/api/admin/integrations', admin)).body.items.find((i: { id: string }) => i.id === 'lightsail');
  const a = await find();
  assert.equal(a.status, 'missing');
  assert.ok(a.steps.length >= 2 && a.steps[0].link.url.startsWith('https://lightsail.aws.amazon.com/'));
  await h.put('/api/admin/server/console', { instance: 'Daji-1' }, admin);
  assert.equal((await find()).status, 'ready');
});

test('SC-08 Ask AI answers about the server for the owner, never staff', async () => {
  assert.equal(classify('is the server ok?').intent, 'server');
  assert.equal(classify('how full is the disk space').intent, 'server');
  assert.equal(classify('open lightsail ssh').intent, 'server');
  assert.equal(classify('what was the revenue last month').intent, 'revenue', 'money questions are not taken');
  const admin = await h.login('admin');
  await h.put('/api/admin/server/console', { instance: 'Daji-1' }, admin);
  const a = await h.post(`/api/staff/ask?ownerId=${owner1Id()}`, { question: 'Is the server healthy?' }, admin);
  assert.equal(a.status, 200);
  assert.equal(a.body.intent, 'server');
  assert.match(a.body.answer, /server is up/);
  assert.ok(a.body.details.some((d: { label: string; text: string }) => d.label === 'SSH button' && /Daji-1/.test(d.text)));
  assert.ok(!JSON.stringify(a.body).includes(SECRET));
  const o = await h.post('/api/staff/ask', { question: 'Is the server healthy?' }, await h.login('owner1'));
  assert.equal(o.status, 200);
  assert.match(o.body.answer, /server is up/, 'the ground owner gets the answer');
  const st = await h.post('/api/staff/ask', { question: 'Is the server healthy?' }, await h.login('staff1'));
  assert.equal(st.status, 200);
  assert.match(st.body.answer, /Only the owner/);
  assert.ok(!/Daji-1/.test(JSON.stringify(st.body)), 'staff learn nothing about the server');
  // the same rule holds for the Claude tool
  const owner = userByEmail('owner1@daji.test')!, staff = userByEmail('staff1@daji.test')!, sa = userByEmail('admin@daji.test')!;
  assert.throws(() => runTool({ ownerId: owner.id, user: staff, cfg: h.cfg }, 'get_server_status', {}), /Only the owner/);
  assert.equal((runTool({ ownerId: owner.id, user: owner, cfg: h.cfg }, 'get_server_status', {}) as { healthy: boolean }).healthy, true);
  const t = runTool({ ownerId: owner.id, user: sa, cfg: h.cfg }, 'get_server_status', {}) as { healthy: boolean; sshButton: string };
  assert.equal(t.healthy, true);
  assert.match(t.sshButton, /Daji-1/);
});
