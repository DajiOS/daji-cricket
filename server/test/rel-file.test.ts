import { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:net';
import type { AddressInfo } from 'node:net';
import { startHarness, dayFromNow, type Harness } from './helpers.ts';
import { db, many, one } from '../src/db.ts';
import { configureIntake, intakeFault, builtinScan, clamdScan, sweepQuarantine } from '../src/intake.ts';
import { rel, ev } from './rel.ts';

let h: Harness, dir: string, owner: string, cust: string, admin: string;
before(async () => { dir = mkdtempSync(join(tmpdir(), 'daji-file-')); h = await startHarness({ DATA_DIR: dir }); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset(); configureIntake(h.cfg); intakeFault.point = 'none';
  owner = await h.login('owner1'); cust = await h.login('customer'); admin = await h.login('admin');
});

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (tail: string): Buffer => Buffer.concat([PNG_HEAD, Buffer.from(tail)]);
const clean = (n: string): Buffer => png(`a harmless picture ${n}`);
const evil = [
  ['EICAR test virus inside a PNG', png(EICAR)],
  ['a script inside a PNG', png('<script>fetch("/api/me")</script>')],
  ['a PDF that runs code', Buffer.from('%PDF-1.7\n1 0 obj << /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >> endobj')],
] as const;

const up = (method: string, path: string, token: string, body: Buffer) => fetch(`${h.url}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' }, body });

/** Every file under the data folder (not the database) as a sorted list of relative paths. */
function allFiles(root = dir, base = ''): string[] {
  const out: string[] = [];
  if (!existsSync(root)) return out;
  for (const n of readdirSync(root)) {
    const p = join(root, n);
    if (statSync(p).isDirectory()) out.push(...allFiles(p, `${base}${n}/`)); else out.push(`${base}${n}`);
  }
  return out.sort();
}
const count = (sql: string): number => one<{ n: number }>(sql)!.n;

interface Ep { name: string; table: string; send: (b: Buffer, token?: string) => Promise<Response> }
async function endpoints(): Promise<Ep[]> {
  const bank = await h.post('/api/accounting/accounts', { kind: 'bank', name: 'HDFC current', openingPaise: 10000000, openingDate: dayFromNow(-400) }, owner);
  const tx = await h.post('/api/accounting/transactions', { accountId: bank.body.id, date: dayFromNow(0), amountPaise: -250000, description: 'Roller hire' }, owner);
  const ven = await h.post('/api/accounting/vendors', { name: 'Surat Turf Supplies', phone: '9876501234' }, owner);
  const bill = await h.post('/api/accounting/bills', { vendorId: ven.body.id, billNo: 'INV-1', billDate: dayFromNow(-5), dueDate: dayFromNow(5), amountPaise: 1250000 }, owner);
  const card = await h.post('/api/staff/cards', { name: 'Ravi Shah', phones: ['9876500000'] }, owner);
  const svc = await h.post('/api/admin/billing/services/catalog', {}, admin);
  assert.ok(svc.status === 200 || svc.status === 201);
  const services = (await h.get('/api/admin/billing', admin)).body.services as { id: string }[];
  const inv = await h.post('/api/admin/billing/invoices', { serviceId: services[0]!.id, invoiceDate: dayFromNow(0).slice(0, 10), amountMinor: 1000 }, admin);
  const task = await h.post('/api/tasks', { title: 'Roll the pitch', photosRequired: 1 }, owner);
  assert.equal(tx.status, 201); assert.equal(bill.status, 201); assert.equal(card.status, 201); assert.equal(inv.status, 201, JSON.stringify(inv.body)); assert.equal(task.status, 201);
  return [
    { name: 'profile picture', table: 'users WHERE avatar_id IS NOT NULL', send: (b, t = cust) => up('POST', '/api/me/avatar', t, b) },
    { name: 'photo library', table: 'media', send: (b, t = owner) => up('POST', '/api/media?kind=gallery&filename=a.png', t, b) },
    { name: 'accounting attachment', table: 'acct_attachments', send: (b, t = owner) => up('POST', `/api/accounting/attachments?entity=transaction&id=${tx.body.id}&filename=r.png`, t, b) },
    { name: 'bill document', table: 'acct_bill_files', send: (b, t = owner) => up('POST', `/api/accounting/bills/${bill.body.id}/files?filename=b.png`, t, b) },
    { name: 'contact photo', table: "biz_cards WHERE image_mime IS NOT NULL", send: (b, t = owner) => up('POST', `/api/staff/cards/${card.body.id}/image`, t, b) },
    { name: 'software invoice file', table: 'sw_invoices WHERE file_name IS NOT NULL', send: (b, t = admin) => up('POST', `/api/admin/billing/invoices/${inv.body.id}/file?filename=i.png`, t, b) },
    { name: 'task photo', table: 'task_photos', send: (b, t = owner) => up('POST', `/api/tasks/${task.body.id}/photos`, t, b) },
    { name: 'task reference', table: 'task_refs', send: (b, t = owner) => up('POST', `/api/tasks/${task.body.id}/references?name=r.png`, t, b) },
  ];
}

// ------------------------------------------------------------------ REL-FILE-001

rel('REL-FILE-001', 'an infected upload is refused on every upload route: nothing is stored, nothing is reachable, and the attempt is logged', async () => {
  const eps = await endpoints();
  const before = allFiles();
  const beforeRows = eps.map((e) => count(`SELECT COUNT(*) n FROM ${e.table}`));
  let attempts = 0;
  const seen: Record<string, number[]> = {};
  for (const e of eps) {
    for (const [what, body] of evil) {
      const r = await e.send(body);
      const j = await r.json() as { error: { code: string } };
      attempts++;
      assert.equal(r.status, 422, `${e.name} / ${what}: ${JSON.stringify(j)}`);
      assert.equal(j.error.code, 'FILE_REJECTED', `${e.name} / ${what}`);
      (seen[e.name] ??= []).push(r.status);
    }
  }
  assert.deepEqual(allFiles(), before, 'no file appeared anywhere under the data folder (not even in quarantine)');
  assert.deepEqual(eps.map((e) => count(`SELECT COUNT(*) n FROM ${e.table}`)), beforeRows, 'no record was written');
  assert.equal(count("SELECT COUNT(*) n FROM file_intake_log WHERE outcome = 'rejected'"), attempts, 'every refusal is in the intake log');
  assert.equal(count("SELECT COUNT(*) n FROM audit_log WHERE action = 'file.rejected'"), attempts, 'and in the audit trail');
  assert.ok(many<{ detail: string }>("SELECT detail FROM file_intake_log WHERE outcome = 'rejected'").some((r) => r.detail === 'Eicar-Test-Signature'));
  ev('uploadRoutesChecked', eps.map((e) => e.name)); ev('infectedVariants', evil.map((e) => e[0])); ev('attempts', attempts);
  ev('filesAfter', allFiles().length); ev('scanner', h.cfg.files.scanner);

  // the same routes take a clean file
  for (const e of eps) {
    const r = await e.send(clean(e.name));
    // the task photo route also wants a camera time inside the picture, so it refuses a plain one for that reason, not for the scan
    if (e.name === 'task photo') { assert.ok(r.status >= 400); assert.notEqual(((await r.json()) as any).error.code, 'FILE_REJECTED'); continue; }
    assert.ok(r.status === 200 || r.status === 201, `${e.name} accepts a clean file: ${r.status}`);
  }
  assert.ok(count("SELECT COUNT(*) n FROM file_intake_log WHERE outcome = 'stored'") >= eps.length - 1);
  assert.equal(allFiles().filter((f) => f.startsWith('quarantine/')).length, 0, 'quarantine is empty after accepted uploads');

  // the video library checks the finished file before it joins the library
  const infected = Buffer.concat([Buffer.from('....ftypmp42'), Buffer.from(EICAR), Buffer.alloc(2000)]);
  const start = await h.post('/api/library/uploads', { name: 'clip.mp4', size: infected.length, tag: 'gallery', key: 'clip|1' }, owner);
  assert.equal(start.status, 201, JSON.stringify(start.body));
  const filesBefore = allFiles();
  const put = await up('PUT', `/api/library/uploads/${start.body.id}?offset=0`, owner, infected);
  assert.equal(put.status, 422);
  assert.equal(count('SELECT COUNT(*) n FROM media_lib'), 0, 'the library has no entry');
  assert.equal(count('SELECT COUNT(*) n FROM media_uploads'), 0, 'the part-file record is gone');
  assert.ok(!allFiles().some((f) => f.includes(start.body.id)), 'and so is the part file');
  ev('libraryChunkRefused', true); ev('libraryFilesBefore', filesBefore.length);
});

rel('REL-FILE-001', 'when the virus scanner cannot be reached nothing is accepted (fail closed), and the real ClamAV protocol is spoken correctly', async () => {
  // a scanner that is not there
  configureIntake({ ...h.cfg, files: { scanner: 'clamav', clamavHost: '127.0.0.1', clamavPort: 1 } });
  const before = allFiles();
  const r = await up('POST', '/api/media?kind=gallery&filename=a.png', owner, clean('while the scanner is down'));
  assert.equal(r.status, 503); assert.equal(((await r.json()) as any).error.code, 'SCAN_UNAVAILABLE');
  assert.deepEqual(allFiles(), before); assert.equal(count('SELECT COUNT(*) n FROM media'), 0);
  assert.equal(count("SELECT COUNT(*) n FROM file_intake_log WHERE outcome = 'scan_unavailable'"), 1);
  // a live system whose scanner is not ClamAV also refuses (it never falls back to the built-in checks)
  configureIntake({ ...h.cfg, appEnv: 'live', files: { scanner: 'builtin', clamavHost: '', clamavPort: 0 } });
  const live = await up('POST', '/api/media?kind=gallery&filename=a.png', owner, clean('live without clamav'));
  assert.equal(live.status, 503);

  // a stand-in clamd that speaks the INSTREAM protocol: a clean file, an infected one, a garbled answer
  const seen: Buffer[] = [];
  const fake: Server = createServer((sock) => {
    const chunks: Buffer[] = [];
    sock.on('data', (d) => {
      chunks.push(d as Buffer);
      const all = Buffer.concat(chunks);
      if (!all.subarray(0, 10).equals(Buffer.from('zINSTREAM\0'))) return;
      // the stream ends with a zero-length chunk
      let at = 10, body = Buffer.alloc(0);
      for (;;) {
        if (all.length < at + 4) return;
        const len = all.readUInt32BE(at); at += 4;
        if (len === 0) break;
        if (all.length < at + len) return;
        body = Buffer.concat([body, all.subarray(at, at + len)]); at += len;
      }
      seen.push(body);
      const txt = body.toString('latin1');
      sock.end(txt.includes('EICAR') ? 'stream: Eicar-Test-Signature FOUND\0' : txt.includes('GARBLE') ? 'what?\0' : 'stream: OK\0');
    });
  });
  await new Promise<void>((res) => fake.listen(0, '127.0.0.1', res));
  const port = (fake.address() as AddressInfo).port;
  try {
    const okFile = Buffer.concat([clean('via clamd'), Buffer.alloc(200_000, 7)]);
    assert.deepEqual(await clamdScan('127.0.0.1', port, okFile), { clean: true, scanner: 'clamav' });
    assert.deepEqual(seen[0], okFile, 'the scanner received every byte, in order');
    const bad = await clamdScan('127.0.0.1', port, png(EICAR));
    assert.equal(bad.clean, false); assert.equal(bad.signature, 'Eicar-Test-Signature');
    await assert.rejects(() => clamdScan('127.0.0.1', port, png('GARBLE')), /unusable answer/);
    const path = join(dir, 'scan-me.bin'); writeFileSync(path, okFile);
    assert.equal((await clamdScan('127.0.0.1', port, path)).clean, true, 'a file on disk is streamed the same way');
    // through the real route
    configureIntake({ ...h.cfg, files: { scanner: 'clamav', clamavHost: '127.0.0.1', clamavPort: port } });
    assert.equal((await up('POST', '/api/media?kind=gallery&filename=ok.png', owner, clean('routed ok'))).status, 201);
    assert.equal((await up('POST', '/api/media?kind=gallery&filename=bad.png', owner, png(EICAR))).status, 422);
    ev('clamdProtocol', 'zINSTREAM with length-prefixed chunks; OK / FOUND / unusable answers handled'); ev('realClamAV', 'NOT_RUN: a stand-in clamd was used; a real ClamAV daemon is not available in this environment');
  } finally { fake.close(); configureIntake(h.cfg); }
  assert.deepEqual(builtinScan(Buffer.from('plain')), { clean: true, scanner: 'builtin' });
});

rel('REL-FILE-001', 'a handler that skips the gate stores nothing (fail closed), and a replaced file is kept as an earlier version', async () => {
  const { storeUpload } = await import('../src/intake.ts');
  const before = allFiles();
  assert.throws(() => storeUpload({ dataDir: dir, buf: clean('skipped the gate'), finalPath: join(dir, 'media', 'x.png'), purpose: 'media', actor: { id: 'u', role: 'owner' }, writeMetadata: () => { throw new Error('must not run'); } }), /not checked/);
  assert.deepEqual(allFiles(), before);

  // replacing a picture: the earlier one is kept, not overwritten
  const first = await up('POST', '/api/me/avatar', cust, clean('first'));
  assert.equal(first.status, 200);
  const a1 = one<{ avatar_id: string; avatar_ext: string }>("SELECT avatar_id, avatar_ext FROM users WHERE role = 'customer' AND avatar_id IS NOT NULL")!;
  const second = await up('POST', '/api/me/avatar', cust, clean('second'));
  assert.equal(second.status, 200);
  const a2 = one<{ avatar_id: string }>("SELECT avatar_id FROM users WHERE role = 'customer' AND avatar_id IS NOT NULL")!;
  assert.notEqual(a1.avatar_id, a2.avatar_id);
  const v = many<{ path_key: string; version: number; kept_as: string }>('SELECT * FROM file_versions');
  assert.equal(v.length, 1);
  assert.ok(existsSync(v[0]!.kept_as), 'the earlier picture still exists');
  assert.equal(readFileSync(v[0]!.kept_as).toString('latin1').endsWith('first'), true);
  assert.throws(() => db().prepare('UPDATE file_versions SET version = 9').run(), /append-only/);
  assert.throws(() => db().prepare('DELETE FROM file_intake_log').run(), /append-only/);
  // the contact photo is replaced at the same path: it becomes version 1 and the new one is current
  const card = await h.post('/api/staff/cards', { name: 'Ravi Shah', phones: ['9876500000'] }, owner);
  await up('POST', `/api/staff/cards/${card.body.id}/image`, owner, clean('v1'));
  await up('POST', `/api/staff/cards/${card.body.id}/image`, owner, clean('v2'));
  const cv = many<{ kept_as: string }>("SELECT * FROM file_versions WHERE path_key LIKE '%cards%'");
  assert.equal(cv.length, 1); assert.equal(readFileSync(cv[0]!.kept_as).toString('latin1').endsWith('v1'), true);
  ev('versions', many('SELECT path_key, version FROM file_versions'));
});

// ------------------------------------------------------------------ REL-FILE-002

rel('REL-FILE-002', 'the file is written but the record cannot be saved: the file is removed and nothing is reachable', async () => {
  const filesBefore = allFiles();
  db().exec(`CREATE TRIGGER trg_test_media_fail BEFORE INSERT ON media BEGIN SELECT RAISE(ABORT, 'simulated: the record cannot be saved'); END;`);
  try {
    const r = await up('POST', '/api/media?kind=gallery&filename=a.png', owner, clean('metadata fails'));
    assert.equal(r.status, 500);
  } finally { db().exec('DROP TRIGGER trg_test_media_fail'); }
  assert.deepEqual(allFiles(), filesBefore, 'no file anywhere, not even in quarantine');
  assert.equal(count('SELECT COUNT(*) n FROM media'), 0);
  assert.equal(count("SELECT COUNT(*) n FROM file_intake_log WHERE outcome = 'store_failed'"), 1);
  // the same through an injected fault just before the file is released
  intakeFault.point = 'before_release';
  const r2 = await up('POST', '/api/me/avatar', cust, clean('fault before release'));
  intakeFault.point = 'none';
  assert.equal(r2.status, 500);
  assert.deepEqual(allFiles(), filesBefore);
  assert.equal(count('SELECT COUNT(*) n FROM users WHERE avatar_id IS NOT NULL'), 0);
  // and the system keeps working afterwards
  assert.equal((await up('POST', '/api/media?kind=gallery&filename=a.png', owner, clean('after the failures'))).status, 201);
  ev('storeFailedLogged', count("SELECT COUNT(*) n FROM file_intake_log WHERE outcome = 'store_failed'"));
});

// ------------------------------------------------------------------ REL-FILE-003

rel('REL-FILE-003', 'the record is written but the file cannot be put in place: the record is rolled back and no record points at a missing file', async () => {
  const filesBefore = allFiles();
  intakeFault.point = 'after_release';
  const r = await up('POST', '/api/media?kind=gallery&filename=a.png', owner, clean('finalisation fails'));
  intakeFault.point = 'none';
  assert.equal(r.status, 500);
  assert.equal(count('SELECT COUNT(*) n FROM media'), 0, 'the record was rolled back');
  assert.equal(count("SELECT COUNT(*) n FROM audit_log WHERE action = 'media.add'"), 0, 'and so was the audit line that went with it');
  assert.deepEqual(allFiles(), filesBefore, 'the file that had been moved into place was taken out again');

  // a replacement that fails after the old file was set aside puts the old one back
  const ok = await up('POST', '/api/me/avatar', cust, clean('current'));
  assert.equal(ok.status, 200);
  const cur = one<{ avatar_id: string; avatar_ext: string }>('SELECT avatar_id, avatar_ext FROM users WHERE avatar_id IS NOT NULL')!;
  const filesWithCurrent = allFiles();
  intakeFault.point = 'after_release';
  const bad = await up('POST', '/api/me/avatar', cust, clean('replacement that fails'));
  intakeFault.point = 'none';
  assert.equal(bad.status, 500);
  assert.equal(one<{ avatar_id: string }>('SELECT avatar_id FROM users WHERE avatar_id IS NOT NULL')!.avatar_id, cur.avatar_id, 'the person still has the picture they had');
  assert.deepEqual(allFiles(), filesWithCurrent, 'and it is still on disk, with no stray files');
  const served = await fetch(`${h.url}/api/avatar/${cur.avatar_id}`);
  assert.equal(served.status, 200);
  assert.equal(count('SELECT COUNT(*) n FROM file_versions'), 0, 'no version row was left for a replacement that did not happen');

  // a crash that leaves a file in quarantine is cleaned by the sweep (old files only)
  const q = join(dir, 'quarantine'); const stray = join(q, 'old-crash'); writeFileSync(stray, 'x');
  const { utimesSync } = await import('node:fs');
  utimesSync(stray, new Date(Date.now() - 2 * 3600_000), new Date(Date.now() - 2 * 3600_000));
  writeFileSync(join(q, 'fresh'), 'y');
  assert.equal(sweepQuarantine(dir), 1);
  assert.ok(!existsSync(stray) && existsSync(join(q, 'fresh')));
  ev('quarantineSwept', 1);
});

// ------------------------------------------------------------------ guard: no upload route can skip the gate

rel('REL-FILE-001', 'architecture guard: every route that stores an uploaded file is declared as an upload route (so it is virus-checked first)', async () => {
  const { buildRouter } = await import('../src/app.ts');
  const writers = ['setAvatar(', 'addPhoto(', 'attachInvoiceFile(', 'addBillFile(', 'addAttachment(', 'attachCardImage(', 'addTaskPhoto(', 'addCard(', 'putChunk(', 'scanCard('];
  const router = buildRouter();
  const found: string[] = [], missing: string[] = [];
  for (const route of router.routes) {
    const src = route.handler.toString();
    if (!writers.some((w) => src.includes(w))) continue;
    const name = `${route.method} ${route.re.source}`;
    found.push(name);
    // the library streams its pieces and checks the finished file itself (inside putChunk)
    if (!route.opts.upload && !src.includes('putChunk(') && !(src.includes('addCard(') && !src.includes('c.raw'))) missing.push(name);
  }
  assert.deepEqual(missing, [], 'upload routes that skip the gate');
  assert.ok(found.length >= 8, `found ${found.length} upload routes`);
  // no source file outside the intake module writes uploaded bytes straight to the data folder
  const { readdirSync: rd, readFileSync: rf, statSync: st } = await import('node:fs');
  const walk = (d: string): string[] => rd(d).flatMap((n) => { const p = join(d, n); return st(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []; });
  const offenders = walk(join(import.meta.dirname, '..', 'src')).filter((f) => /writeFileSync\(/.test(rf(f, 'utf8'))).map((f) => f.replace(/^.*\/src\//, ''))
    .filter((f) => !['intake.ts', 'backup.ts', 'vault.ts', 'offsite.ts', 'library.ts'].includes(f)); // backups, encryption and the library's own part file are not uploads
  ev('uploadRoutes', found); ev('writeFileSyncOutsideAllowedFiles', offenders);
  assert.deepEqual(offenders, [], 'nothing else writes files directly');
});
