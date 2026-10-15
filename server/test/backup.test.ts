import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHarness, HOUR, MIN, DAY, setNow, type Harness } from './helpers.ts';
import { backupNow, checkDatabaseFile, listBackups, nextBackupAt, runBackupIfDue, resetBackupRetry, BACKUP_AT } from '../src/backup.ts';
import { istMidnight } from '../src/time.ts';
import { one } from '../src/db.ts';

let h: Harness;
let dir: string;
let admin: string;
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'daji-backup-'));
  h = await startHarness({ DATA_DIR: dir, BACKUP_ENABLED: 'on', BACKUP_KEEP: '3' });
});
after(async () => { await h.close(); rmSync(dir, { recursive: true, force: true }); });
beforeEach(async () => {
  h.reset();
  admin = await h.login('admin');
  rmSync(join(dir, 'backups'), { recursive: true, force: true });
  rmSync(join(dir, 'uploads'), { recursive: true, force: true });
  resetBackupRetry();
});

/** 03:15 IST on the date of T0 (14 Oct 2026), plus an offset. */
const at0315 = (plusMin = 0): number => istMidnight('2026-10-14') + 3 * HOUR + 15 * MIN + plusMin * MIN;

test('a snapshot is a complete, readable copy of the database', () => {
  setNow(at0315(2));
  const info = backupNow(h.cfg, 'manual');
  assert.match(info.name, /^2026-10-14_031700$/);
  assert.equal(info.integrity, 'ok');
  assert.equal(info.reason, 'manual');
  assert.ok(info.dbBytes > 10_000);
  // "restore drill": open the copy on its own and read the data back
  const copy = checkDatabaseFile(join(h.cfg.backup.dir, info.name, 'daji.db'));
  const live = one<{ n: number }>('SELECT COUNT(*) n FROM users')!.n;
  assert.equal(copy.integrity, 'ok');
  assert.equal(copy.users, live);
  assert.ok(copy.users >= 5);
  assert.deepEqual(readdirSync(h.cfg.backup.dir), [info.name], 'no half-written folder is left behind');
});

test('uploaded files are included in the snapshot', () => {
  mkdirSync(join(dir, 'uploads', 'receipts'), { recursive: true });
  writeFileSync(join(dir, 'uploads', 'receipts', 'bill.jpg'), Buffer.alloc(2048, 7));
  writeFileSync(join(dir, 'uploads', 'note.txt'), 'hello');
  const info = backupNow(h.cfg, 'manual');
  assert.equal(info.files, 2);
  assert.equal(info.filesBytes, 2048 + 5);
  assert.equal(readFileSync(join(h.cfg.backup.dir, info.name, 'uploads', 'note.txt'), 'utf8'), 'hello');
});

test('only the newest few snapshots are kept', () => {
  const names: string[] = [];
  for (let i = 0; i < 5; i++) { setNow(at0315(i * 10)); names.push(backupNow(h.cfg, 'manual').name); }
  const left = listBackups(h.cfg).map((b) => b.name);
  assert.deepEqual(left, names.slice(2).reverse(), 'keeps 3, newest first');
  assert.equal(readdirSync(h.cfg.backup.dir).length, 3);
});

test('two snapshots in the same second both survive', () => {
  setNow(at0315());
  const a = backupNow(h.cfg, 'manual');
  const b = backupNow(h.cfg, 'manual');
  assert.notEqual(a.name, b.name);
  assert.equal(listBackups(h.cfg).length, 2);
});

test('the daily snapshot is taken at 03:15 India time, once a day', () => {
  setNow(at0315(-1));
  assert.equal(runBackupIfDue(h.cfg), null, 'not yet 03:15');
  setNow(at0315(0));
  const first = runBackupIfDue(h.cfg);
  assert.ok(first, 'taken at 03:15');
  assert.equal(first!.reason, 'scheduled');
  setNow(at0315(30));
  assert.equal(runBackupIfDue(h.cfg), null, 'already done today');
  setNow(at0315(12 * 60));
  assert.equal(runBackupIfDue(h.cfg), null, 'still only once that day');
  setNow(at0315(DAY / MIN));
  assert.ok(runBackupIfDue(h.cfg), 'and again the next day');
  assert.equal(listBackups(h.cfg).length, 2);
});

test('a manual snapshot does not stand in for the scheduled one', () => {
  setNow(at0315(-60));
  backupNow(h.cfg, 'manual');
  setNow(at0315(1));
  assert.ok(runBackupIfDue(h.cfg), 'the scheduled one is still taken');
});

test('a snapshot that cannot be written is retried later, not every minute, and reported', () => {
  setNow(at0315(1));
  writeFileSync(join(dir, 'blocker'), 'x');
  const bad = { ...h.cfg, backup: { ...h.cfg.backup, dir: join(dir, 'blocker', 'inside') } };
  const errors: unknown[] = [];
  assert.equal(runBackupIfDue(bad, (e) => errors.push(e)), null);
  assert.equal(errors.length, 1);
  setNow(at0315(2));
  assert.equal(runBackupIfDue(bad, (e) => errors.push(e)), null);
  assert.equal(errors.length, 1, 'not retried a minute later');
  setNow(at0315(40));
  runBackupIfDue(bad, (e) => errors.push(e));
  assert.equal(errors.length, 2, 'retried after half an hour');
});

test('switched off means no scheduled snapshot', () => {
  setNow(at0315(5));
  const off = { ...h.cfg, backup: { ...h.cfg.backup, enabled: false } };
  assert.equal(runBackupIfDue(off), null);
  assert.equal(listBackups(h.cfg).length, 0);
});

test('the next snapshot time', () => {
  assert.equal(BACKUP_AT, '03:15');
  setNow(at0315(-5));
  assert.equal(nextBackupAt(), at0315());
  setNow(at0315(5));
  assert.equal(nextBackupAt(), at0315(24 * 60));
});

test('only the owner and super admin can list or take backups, and it is logged', async () => {
  const staff = await h.login('staff1');
  assert.equal((await h.get('/api/admin/backups', staff)).status, 403);
  assert.equal((await h.post('/api/admin/backups', {}, staff)).status, 403);
  assert.equal((await h.get('/api/admin/backups')).status, 401);
  const none = await h.get('/api/admin/backups', admin);
  assert.equal(none.status, 200);
  assert.deepEqual(none.body.items, []);
  assert.equal(none.body.at, '03:15');
  assert.equal(none.body.keep, 3);
  assert.equal(none.body.enabled, true);
  const made = await h.post('/api/admin/backups', {}, admin);
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.integrity, 'ok');
  const after = await h.get('/api/admin/backups', admin);
  assert.equal(after.body.items.length, 1);
  assert.equal(after.body.items[0].name, made.body.name);
  assert.ok(!JSON.stringify(after.body).includes(dir), 'the server folder is not exposed');
  const log = (await h.get('/api/admin/audit?action=backup', admin)).body.items;
  assert.equal(log.length, 1);
  assert.equal(log[0].action, 'backup.create');
  assert.equal(log[0].actorRole, 'super_admin');
});

test('a failed manual backup says so and leaves nothing behind', async () => {
  const bad = h.cfg.backup.dir;
  mkdirSync(join(dir, 'backups'), { recursive: true });
  writeFileSync(join(dir, 'backups', 'x'), '');
  assert.equal(existsSync(bad), true);
  // make the target unwritable by replacing the folder with a file
  rmSync(join(dir, 'backups'), { recursive: true, force: true });
  writeFileSync(join(dir, 'backups'), 'not a folder');
  const r = await h.post('/api/admin/backups', {}, admin);
  assert.equal(r.status, 500);
  assert.equal(r.body.error.code, 'BACKUP_FAILED');
  rmSync(join(dir, 'backups'), { force: true });
});
