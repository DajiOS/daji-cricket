import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHarness, setNow, T0, type Harness } from './helpers.ts';
import { seal, unseal, encryptBytes, decryptBytes, setVaultKey } from '../src/vault.ts';
import { backupNow, decryptSnapshot, checkDatabaseFile } from '../src/backup.ts';
import { base32Decode, totp } from '../src/mfa.ts';
import { one } from '../src/db.ts';
import { now } from '../src/clock.ts';

let h: Harness, dir: string;
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'daji-sec-'));
  h = await startHarness({ DATA_DIR: dir, BACKUP_ENABLED: 'on', FIELD_KEY: 'a-long-field-key-for-the-tests-0123456789', BACKUP_PASSPHRASE: 'correct horse battery staple' });
});
after(async () => { setVaultKey(''); await h.close(); rmSync(dir, { recursive: true, force: true }); });

test('sealed fields round-trip, are not readable, and detect tampering', () => {
  const s = seal('JBSWY3DPEHPK3PXP');
  assert.match(s, /^enc1:/);
  assert.ok(!s.includes('JBSWY3DP'));
  assert.equal(unseal(s), 'JBSWY3DPEHPK3PXP');
  assert.notEqual(seal('x'), seal('x'), 'a fresh random IV each time');
  assert.equal(unseal('plain old value'), 'plain old value', 'old unencrypted rows still read');
  const bad = s.slice(0, -2) + (s.endsWith('AA') ? 'BB' : 'AA');
  assert.throws(() => unseal(bad));
});

test('the 2-step secret is stored encrypted and sign-in still works', async () => {
  h.reset();
  const owner = await h.login('owner1');
  const s = await h.post('/api/me/mfa/setup', {}, owner);
  const secret = s.body.secret as string;
  const stored = one<{ secret: string }>('SELECT secret FROM user_mfa')!.secret;
  assert.match(stored, /^enc1:/);
  assert.ok(!stored.includes(secret));
  const code = totp(base32Decode(secret), Math.floor(now() / 30000));
  assert.equal((await h.post('/api/me/mfa/enable', { code }, owner)).status, 200);
});

test('backup files are encrypted, restore with the passphrase, and fail with a wrong one', () => {
  h.reset(); setNow(T0);
  mkdirSync(join(dir, 'uploads'), { recursive: true });
  writeFileSync(join(dir, 'uploads', 'receipt.txt'), 'SECRET RECEIPT CONTENT');
  const info = backupNow(h.cfg, 'manual');
  assert.equal(info.encrypted, true);
  const snap = join(h.cfg.backup.dir, info.name);
  const names = readdirSync(snap);
  assert.ok(names.includes('daji.db.enc') && !names.includes('daji.db'));
  assert.ok(!readFileSync(join(snap, 'daji.db.enc')).includes('SQLite format'));
  assert.ok(!readFileSync(join(snap, 'uploads', 'receipt.txt.enc'), 'utf8').includes('SECRET RECEIPT'));
  const out = join(dir, 'restored');
  decryptSnapshot(snap, out, 'correct horse battery staple');
  assert.equal(checkDatabaseFile(join(out, 'daji.db')).integrity, 'ok');
  assert.equal(readFileSync(join(out, 'uploads', 'receipt.txt'), 'utf8'), 'SECRET RECEIPT CONTENT');
  assert.throws(() => decryptSnapshot(snap, join(dir, 'bad'), 'wrong'), /Wrong passphrase/);
  assert.throws(() => decryptBytes(Buffer.from('nope'), 'x'));
  assert.ok(decryptBytes(encryptBytes(Buffer.from('hi'), 'p'), 'p').toString() === 'hi');
});

test('the website carries a strict content security policy', async () => {
  const r = await fetch(h.url + '/');
  const csp = r.headers.get('content-security-policy') ?? '';
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self' https:\/\/checkout\.razorpay\.com(;|$)/);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'self'/);
  const html = await r.text();
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, 'no inline scripts, or the policy would block them');
  assert.doesNotMatch(html, /\son[a-z]+=/i, 'no inline event handlers');
});

test('the Wix widget script and the embed helper are served, and the widget script is readable from any site', async () => {
  const w = await fetch(h.url + '/embed/daji-widgets.js');
  assert.equal(w.status, 200);
  assert.equal(w.headers.get('access-control-allow-origin'), '*');
  const src = await w.text();
  for (const tag of ['daji-booking', 'daji-account', 'daji-accounting', 'daji-scores']) assert.ok(src.includes(`'${tag}'`), tag);
  assert.equal((await fetch(h.url + '/embed.js')).status, 200);
  assert.match((await fetch(h.url + '/')).headers.get('content-security-policy') ?? '', /frame-ancestors 'self'/);
});
