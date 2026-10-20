import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHarness, type Harness } from './helpers.ts';
import { backupNow, lastOffsiteCopy, lastRestorePractice, practiceRestore, OFFSITE_COPY_FILE } from '../src/backup.ts';

let h: Harness, dir: string, admin: string;
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'daji-restore-test-'));
  h = await startHarness({ DATA_DIR: dir, BACKUP_ENABLED: 'on', BACKUP_PASSPHRASE: 'correct horse battery staple' });
});
after(async () => { await h.close(); rmSync(dir, { recursive: true, force: true }); });
beforeEach(async () => {
  h.reset();
  admin = await h.login('admin');
  for (const n of ['backups', 'uploads', 'restore-practice.json', OFFSITE_COPY_FILE]) rmSync(join(dir, n), { recursive: true, force: true });
});

test('with no snapshot yet the practice fails and says to take a backup first', () => {
  const r = practiceRestore(h.cfg);
  assert.equal(r.ok, false);
  assert.match(r.message, /Take a backup first/);
  assert.equal(lastRestorePractice(h.cfg)?.ok, false);
});

test('an encrypted snapshot is restored into a throw-away folder, checked and recorded', () => {
  mkdirSync(join(dir, 'uploads'), { recursive: true });
  writeFileSync(join(dir, 'uploads', 'receipt.pdf'), 'pdf bytes');
  const b = backupNow(h.cfg, 'manual');
  assert.equal(b.encrypted, true);
  const before = readdirSync(tmpdir()).filter((n) => n.startsWith('daji-restore-') && !n.startsWith('daji-restore-test-')).length;
  const r = practiceRestore(h.cfg);
  assert.equal(r.ok, true, r.message);
  assert.equal(r.snapshot, b.name);
  assert.equal(r.integrity, 'ok');
  assert.equal(r.files, 1);
  assert.ok((r.users ?? 0) > 0);
  assert.equal(readdirSync(tmpdir()).filter((n) => n.startsWith('daji-restore-') && !n.startsWith('daji-restore-test-')).length, before, 'the throw-away folder is removed');
  assert.equal(readFileSync(join(dir, 'uploads', 'receipt.pdf'), 'utf8'), 'pdf bytes', 'live files are untouched');
  assert.deepEqual(lastRestorePractice(h.cfg), r);
});

test('a snapshot that cannot be decrypted is a failed practice', () => {
  backupNow(h.cfg, 'manual');
  const wrong = { ...h.cfg, backup: { ...h.cfg.backup, passphrase: 'not the passphrase' } };
  const r = practiceRestore(wrong);
  assert.equal(r.ok, false);
  assert.match(r.message, /could not be decrypted/);
});

test('a missing file in the snapshot fails the practice', () => {
  mkdirSync(join(dir, 'uploads'), { recursive: true });
  writeFileSync(join(dir, 'uploads', 'a.jpg'), 'a');
  const b = backupNow(h.cfg, 'manual');
  rmSync(join(h.cfg.backup.dir, b.name, 'uploads', 'a.jpg.enc'));
  const r = practiceRestore(h.cfg);
  assert.equal(r.ok, false);
  assert.match(r.message, /0 of 1 files came back/);
});

test('the software owner can practise a restore from the desk, and sees it with the backups', async () => {
  backupNow(h.cfg, 'manual');
  const owner = await h.login('owner1');
  assert.equal((await h.post('/api/admin/backups/practice-restore', {}, owner)).status, 403);
  const r = await h.post('/api/admin/backups/practice-restore', {}, admin);
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  const list = await h.get('/api/admin/backups', admin);
  assert.equal(list.body.restorePractice.ok, true);
  assert.equal(list.body.offsiteCopy, null);
});

test('the note left by offsite-backup.sh is read back', () => {
  assert.equal(lastOffsiteCopy(h.cfg), null);
  writeFileSync(join(dir, OFFSITE_COPY_FILE), '{"at":1760000000000,"snapshots":14}\n');
  assert.deepEqual(lastOffsiteCopy(h.cfg), { at: 1760000000000, snapshots: 14 });
  writeFileSync(join(dir, OFFSITE_COPY_FILE), 'garbage');
  assert.equal(lastOffsiteCopy(h.cfg), null);
});
