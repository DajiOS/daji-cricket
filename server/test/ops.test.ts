import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHarness, advance, type Harness } from './helpers.ts';
import { takeLease } from '../src/jobs.ts';
import { backupNow, listBackups } from '../src/backup.ts';
import { uploadSnapshot, signS3Put } from '../src/offsite.ts';
import { keyFingerprint, setVaultKey } from '../src/vault.ts';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { setVaultKey(''); await h.close(); });

test('only one process holds the scheduler lease at a time, and it passes on when the holder goes quiet', () => {
  assert.equal(takeLease('t1', 60_000, 'A'), true);
  assert.equal(takeLease('t1', 60_000, 'B'), false, 'A still holds it');
  assert.equal(takeLease('t1', 60_000, 'A'), true, 'A renews');
  advance(61_000);
  assert.equal(takeLease('t1', 60_000, 'B'), true, 'A stopped; B takes over');
  assert.equal(takeLease('t1', 60_000, 'A'), false);
});

test('a backup records which encryption key it was made under, and says whether the key now matches', () => {
  setVaultKey('first-key-for-test-1234567890');
  const dir = mkdtempSync(join(tmpdir(), 'bk-'));
  const cfg = { ...h.cfg, backup: { ...h.cfg.backup, dir } };
  const b = backupNow(cfg, 'manual');
  assert.equal(b.keyFingerprint, keyFingerprint()); assert.match(b.keyFingerprint!, /^[0-9a-f]{16}$/);
  assert.equal(listBackups(cfg)[0]!.keyMatches, true);
  setVaultKey('a-different-key-for-test-123456');
  assert.equal(listBackups(cfg)[0]!.keyMatches, false, 'restoring with another key would leave sealed fields unreadable');
});

test('an encrypted backup is copied to the bucket, signed; an unencrypted one is refused', async () => {
  const seen: { url: string; auth: string; len: number }[] = [];
  const srv = createServer((req, res) => { const c: Buffer[] = []; req.on('data', (x) => c.push(x)); req.on('end', () => { seen.push({ url: req.url!, auth: String(req.headers.authorization), len: Buffer.concat(c).length }); res.end(); }); });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const endpoint = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  try {
    const dir = mkdtempSync(join(tmpdir(), 'bk-'));
    const s3 = { bucket: 'my-bucket', region: 'ap-south-1', keyId: 'AKIDEXAMPLE', secret: 'secretexample', prefix: 'daji-backups' };
    const plain = { ...h.cfg, backup: { ...h.cfg.backup, dir, passphrase: '', s3 } };
    const p = backupNow(plain, 'manual');
    assert.equal((await uploadSnapshot(plain, p.name, fetch, endpoint)).ok, false, 'not encrypted, not uploaded');
    assert.equal(seen.length, 0);
    const cfg = { ...h.cfg, backup: { ...h.cfg.backup, dir, passphrase: 'a long pass phrase for tests', s3 } };
    const b = backupNow(cfg, 'manual');
    const r = await uploadSnapshot(cfg, b.name, fetch, endpoint);
    assert.equal(r.ok, true, r.message);
    assert.ok(seen.some((x) => x.url === `/daji-backups/${b.name}/daji.db.enc`));
    assert.ok(seen.every((x) => /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/ap-south-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/.test(x.auth)));
    assert.equal(listBackups(cfg).find((x) => x.name === b.name)!.offsite!.ok, true);
    writeFileSync(join(dir, 'x'), '');
  } finally { srv.close(); }
  const a = signS3Put({ host: 'b.s3.r.amazonaws.com', path: '/a/b', body: Buffer.from('x'), region: 'r', accessKey: 'K', secret: 'S', amzDate: '20260101T000000Z' });
  assert.equal(a.headers['x-amz-content-sha256'], '2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881');
});
