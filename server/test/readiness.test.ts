import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHarness, setting, type Harness } from './helpers.ts';
import { readiness } from '../src/readiness.ts';
import { loadConfig } from '../src/config.ts';
import { userByEmail, userRow } from '../src/auth.ts';
import { run } from '../src/db.ts';
import { backupNow, practiceRestore } from '../src/backup.ts';

let h: Harness, dir: string;
const SECRET = 'rzp_secret_never_shown_123';
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'daji-ready-'));
  h = await startHarness({ DATA_DIR: dir, RAZORPAY_KEY_ID: 'rzp_test_abc', RAZORPAY_KEY_SECRET: SECRET, BACKUP_ENABLED: 'on', BACKUP_PASSPHRASE: 'pass phrase for tests' });
});
after(async () => { await h.close(); rmSync(dir, { recursive: true, force: true }); });
beforeEach(() => { h.reset(); rmSync(join(dir, 'backups'), { recursive: true, force: true }); rmSync(join(dir, 'restore-practice.json'), { force: true }); });

const item = (r: { items: { id: string; state: string; detail: string }[] }, id: string) => r.items.find((i) => i.id === id)!;

test('the demo server lists what is still missing, and never shows a secret', async () => {
  const admin = await h.login('admin');
  const res = await h.get('/api/admin/readiness', admin);
  assert.equal(res.status, 200);
  const r = res.body;
  assert.equal(item(r, 'demo').state, 'todo');
  assert.equal(item(r, 'admin').state, 'todo', 'only the demo software owner exists');
  assert.equal(item(r, 'demoAccounts').state, 'todo');
  assert.equal(item(r, 'grounds').state, 'done');
  assert.equal(item(r, 'razorpay').state, 'todo');
  assert.match(item(r, 'razorpay').detail, /RAZORPAY_WEBHOOK_SECRET/);
  assert.equal(item(r, 'restore').state, 'todo');
  assert.ok(r.total > 15 && r.done < r.total);
  assert.ok(r.items.some((i: { state: string }) => i.state === 'you'));
  assert.ok(!JSON.stringify(r).includes(SECRET), 'no secret value in the answer');
  assert.ok(!JSON.stringify(r).includes('pass phrase for tests'));
});

test('owners see it, staff and customers do not', async () => {
  assert.equal((await h.get('/api/admin/readiness', await h.login('owner1'))).status, 200);
  assert.equal((await h.get('/api/admin/readiness', await h.login('staff1'))).status, 403);
  assert.equal((await h.get('/api/admin/readiness', await h.login('customer'))).status, 403);
});

test('an owner sees only their own grounds', async () => {
  const o2 = userByEmail('owner2@daji.test')!;
  const r = readiness(h.cfg, o2, null);
  const mine = (await h.get('/api/grounds')).body.items.filter((g: { ownerId: string }) => g.ownerId === o2.id).map((g: { name: string }) => g.name);
  for (const n of mine) assert.match(item(r, 'grounds').detail, new RegExp(n));
  assert.match(item(r, 'grounds').detail, new RegExp(`^${mine.length} ground`));
});

test('items turn done as the ground is set up', () => {
  const admin = userByEmail('admin@daji.test')!;
  const realCfg = loadConfig({ PUBLIC_URL: 'https://dajicricket.com', JWT_SECRET: 'x'.repeat(40), FIELD_KEY: 'k'.repeat(32), DATA_DIR: dir, BACKUP_PASSPHRASE: 'pass phrase for tests',
    RAZORPAY_KEY_ID: 'rzp_live_abc', RAZORPAY_KEY_SECRET: SECRET, RAZORPAY_WEBHOOK_SECRET: 'wh' });
  run("UPDATE users SET email = 'sunny@dajicricket.com' WHERE id = ?", admin.id);
  run("UPDATE users SET active = 0 WHERE email LIKE '%@daji.test'");
  setting({ bookingsOpenFrom: '2026-11-14', bookingsCloseFrom: '2027-06-01' });
  backupNow(realCfg, 'manual');
  assert.equal(practiceRestore(realCfg).ok, true);
  const r = readiness(realCfg, userRow(admin.id)!, null);
  for (const id of ['demo', 'https', 'fieldkey', 'admin', 'demoAccounts', 'razorpay', 'daily', 'restore', 'openFrom', 'closeFrom']) assert.equal(item(r, id).state, 'done', `${id}: ${item(r, id).detail}`);
  assert.equal(item(r, 'offsite').state, 'todo');
  assert.equal(r.openingDay, '2026-11-14');
  assert.equal(r.daysToOpening, 31, 'the test clock is 14 October 2026');
});

test('a closing day before the opening day is flagged', () => {
  setting({ bookingsOpenFrom: '2026-11-14', bookingsCloseFrom: '2026-11-01' });
  const r = readiness(h.cfg, userByEmail('admin@daji.test')!, null);
  assert.equal(item(r, 'closeFrom').state, 'todo');
});

test('Ask AI and the bank feed are listed as optional: unset is a calm warning that says what still works, never an error', async () => {
  const admin = await h.login('admin');
  const r = (await h.get('/api/admin/readiness', admin)).body;
  assert.equal(item(r, 'askAi').state, 'warn');
  assert.match(item(r, 'askAi').detail, /built-in reports/);
  assert.equal(item(r, 'bankFeed').state, 'warn');
  assert.match(item(r, 'bankFeed').detail, /Bank import/);
  assert.ok(!JSON.stringify(r).includes('sk-ant'), 'no key is ever shown');
});
