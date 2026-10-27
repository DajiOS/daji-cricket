import { createHash, randomBytes } from 'node:crypto';
import { connect } from 'node:net';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, createReadStream } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Config } from './config.ts';
import { many, one, run, tx, registerSchema } from './db.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { HttpError } from './errors.ts';
import { audit, SYSTEM, type Actor } from './audit.ts';

// Every file that comes in goes through here. A file is scanned before it is kept, written to a quarantine folder that nothing serves, and only released to its real place in the same
// step that records it: either the record and the file both exist, or neither does. A file that is infected, or cannot be checked, is never released. A file that replaces another keeps
// the old one as an earlier version. Every attempt, accepted or not, is written to the intake log, which cannot be edited.

registerSchema('file-intake-1', `
CREATE TABLE file_intake_log (
  id TEXT PRIMARY KEY, at INTEGER NOT NULL, purpose TEXT NOT NULL, sha256 TEXT NOT NULL, size INTEGER NOT NULL,
  actor_id TEXT, actor_role TEXT, owner_id TEXT, scanner TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('rejected','scan_unavailable','stored','store_failed')),
  detail TEXT
);
CREATE INDEX ix_file_intake_at ON file_intake_log(at);
CREATE TABLE file_versions (
  path_key TEXT NOT NULL, version INTEGER NOT NULL, kept_as TEXT NOT NULL, sha256 TEXT, size INTEGER, replaced_at INTEGER NOT NULL, replaced_by TEXT,
  PRIMARY KEY (path_key, version)
);
CREATE TRIGGER trg_ao_file_intake_log_update BEFORE UPDATE ON file_intake_log BEGIN SELECT RAISE(ABORT, 'file_intake_log is append-only: update refused'); END;
CREATE TRIGGER trg_ao_file_intake_log_delete BEFORE DELETE ON file_intake_log BEGIN SELECT RAISE(ABORT, 'file_intake_log is append-only: delete refused'); END;
CREATE TRIGGER trg_ao_file_versions_update BEFORE UPDATE ON file_versions BEGIN SELECT RAISE(ABORT, 'file_versions is append-only: update refused'); END;
CREATE TRIGGER trg_ao_file_versions_delete BEFORE DELETE ON file_versions BEGIN SELECT RAISE(ABORT, 'file_versions is append-only: delete refused'); END;
`);

type Files = Config['files'];
let settings: Files = { scanner: 'builtin', clamavHost: '127.0.0.1', clamavPort: 3310 };
let liveEnv = false;
export function configureIntake(cfg: Config): void { settings = { ...cfg.files }; liveEnv = cfg.appEnv === 'live'; }

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

export interface ScanVerdict { clean: boolean; signature?: string; scanner: string }

/** The built-in checks: the standard antivirus test string, program headers hidden inside a document, script inside an image, and PDF actions that run things. A second line of defence, not a replacement for ClamAV. */
export function builtinScan(buf: Buffer): ScanVerdict {
  const t = buf.toString('latin1');
  if (t.includes(EICAR)) return { clean: false, signature: 'Eicar-Test-Signature', scanner: 'builtin' };
  const head = buf.subarray(0, 8).toString('latin1');
  const isPdf = head.startsWith('%PDF');
  const isImage = buf[0] === 0x89 || (buf[0] === 0xff && buf[1] === 0xd8) || head.startsWith('RIFF') || head.startsWith('GIF8');
  if (isPdf && /\/(JavaScript|JS|Launch|OpenAction|AA)\b/.test(t)) return { clean: false, signature: 'PDF.ActiveContent', scanner: 'builtin' };
  if (isImage && /<\?php|<script[\s>]|<%@|#!\/bin\/(ba)?sh/i.test(t)) return { clean: false, signature: 'Image.EmbeddedScript', scanner: 'builtin' };
  if ((isPdf || isImage) && (/MZ[\x00-\xff]{58}PE\x00\x00/.test(t.slice(8)) || t.slice(8).includes('\x7fELF'))) return { clean: false, signature: 'Document.EmbeddedExecutable', scanner: 'builtin' };
  return { clean: true, scanner: 'builtin' };
}

export class ScanUnavailable extends Error {}

/** ClamAV's clamd INSTREAM protocol over TCP. */
export function clamdScan(host: string, port: number, source: Buffer | string, timeoutMs = 20_000): Promise<ScanVerdict> {
  return new Promise((resolve, reject) => {
    const sock = connect({ host, port });
    let out = '';
    const fail = (why: string) => { sock.destroy(); reject(new ScanUnavailable(why)); };
    sock.setTimeout(timeoutMs, () => fail('the virus scanner did not answer in time'));
    sock.on('error', (e) => fail(`the virus scanner could not be reached (${e.message})`));
    sock.on('data', (d) => { out += d.toString('latin1'); });
    sock.on('close', () => {
      const line = out.replace(/\0/g, '').trim();
      if (/OK$/.test(line)) resolve({ clean: true, scanner: 'clamav' });
      else { const m = /stream:\s*(.+?)\s+FOUND$/.exec(line); if (m) resolve({ clean: false, signature: m[1], scanner: 'clamav' }); else reject(new ScanUnavailable(`the virus scanner gave an unusable answer: ${line.slice(0, 80) || 'nothing'}`)); }
    });
    sock.on('connect', () => {
      sock.write('zINSTREAM\0');
      const send = (b: Buffer): boolean => { let ok = true; for (let i = 0; i < b.length; i += 64 * 1024) { const c = b.subarray(i, i + 64 * 1024); const len = Buffer.alloc(4); len.writeUInt32BE(c.length); sock.write(len); ok = sock.write(c); } return ok; };
      const end = () => sock.write(Buffer.alloc(4));
      if (typeof source === 'string') { const rs = createReadStream(source, { highWaterMark: 64 * 1024 }); rs.on('data', (c) => { if (!send(c as Buffer)) { rs.pause(); sock.once('drain', () => rs.resume()); } }); rs.on('end', end); rs.on('error', (e) => fail(e.message)); }
      else { send(source); end(); }
    });
  });
}

async function verdictFor(source: Buffer | string): Promise<ScanVerdict> {
  if (settings.scanner === 'off' && !liveEnv) return { clean: true, scanner: 'off' };
  if (settings.scanner === 'clamav') return clamdScan(settings.clamavHost, settings.clamavPort, source);
  if (liveEnv) throw new ScanUnavailable('the live system needs its virus scanner (ClamAV) and it is not configured');
  if (typeof source === 'string') {
    // a large file on disk: the built-in check reads the first and last 2 MB
    const size = statSync(source).size;
    const { openSync, readSync, closeSync } = await import('node:fs');
    const fd = openSync(source, 'r');
    try {
      const a = Buffer.alloc(Math.min(size, 2 << 20)), b = Buffer.alloc(Math.min(size, 2 << 20));
      readSync(fd, a, 0, a.length, 0); readSync(fd, b, 0, b.length, Math.max(0, size - b.length));
      return builtinScan(Buffer.concat([a, b]));
    } finally { closeSync(fd); }
  }
  return builtinScan(source);
}

/** One receipt per clean scan, per file content; two people sending the same bytes at once each hold their own. */
const receipts = new Map<string, number[]>();
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

function logIntake(purpose: string, digest: string, size: number, actor: Actor | null, ownerId: string | null, scanner: string, outcome: 'rejected' | 'scan_unavailable' | 'stored' | 'store_failed', detail?: string): void {
  try { run('INSERT INTO file_intake_log(id, at, purpose, sha256, size, actor_id, actor_role, owner_id, scanner, outcome, detail) VALUES(?,?,?,?,?,?,?,?,?,?,?)', newId('fil'), now(), purpose, digest, size, actor?.id ?? null, actor?.role ?? null, ownerId, scanner, outcome, detail ?? null); } catch { /* the log must never be the reason an upload fails to be refused */ }
}

/**
 * The gate every upload route passes first. Clean files get a short-lived receipt that `storeUpload` insists on; an infected file is refused (422) and a file that
 * cannot be checked is refused too (503): nothing is kept either way.
 */
export async function gateUpload(raw: Buffer, purpose: string, actor: Actor | null, ownerId: string | null = null): Promise<void> {
  if (!raw.length) return;
  const digest = sha(raw);
  try {
    const v = await verdictFor(raw);
    if (!v.clean) {
      logIntake(purpose, digest, raw.length, actor, ownerId, v.scanner, 'rejected', v.signature);
      try { audit(actor ?? SYSTEM, 'file.rejected', 'upload', purpose, { sha256: digest, signature: v.signature, scanner: v.scanner }, ownerId ?? undefined); } catch { /* logged above */ }
      throw new HttpError(422, 'FILE_REJECTED', 'This file did not pass the virus check, so it was not saved.');
    }
    receipts.set(digest, [...(receipts.get(digest) ?? []).filter((t) => t > now()), now() + 120_000]);
  } catch (e) {
    if (e instanceof ScanUnavailable) {
      logIntake(purpose, digest, raw.length, actor, ownerId, settings.scanner, 'scan_unavailable', e.message);
      throw new HttpError(503, 'SCAN_UNAVAILABLE', 'We could not check this file for viruses just now, so it was not saved. Please try again in a few minutes.');
    }
    throw e;
  }
}

/** For a stream that has been written to disk (the video library): the same verdict, from the file itself. */
export async function gateFile(path: string, purpose: string, actor: Actor | null): Promise<void> {
  const size = statSync(path).size;
  try {
    const v = await verdictFor(path);
    if (!v.clean) {
      logIntake(purpose, '-', size, actor, null, v.scanner, 'rejected', v.signature);
      throw new HttpError(422, 'FILE_REJECTED', 'This file did not pass the virus check, so it was not saved.');
    }
  } catch (e) {
    if (e instanceof ScanUnavailable) { logIntake(purpose, '-', size, actor, null, settings.scanner, 'scan_unavailable', e.message); throw new HttpError(503, 'SCAN_UNAVAILABLE', 'We could not check this file for viruses just now, so it was not saved. Please try again in a few minutes.'); }
    throw e;
  }
}

/** Test hook: make the release step fail, to prove nothing is left behind. */
export const intakeFault: { point: 'none' | 'before_release' | 'after_release' } = { point: 'none' };

export interface StoreOpts {
  dataDir: string; buf: Buffer; finalPath: string; purpose: string; actor: Actor; ownerId?: string | null;
  /** The record of the file (an INSERT or UPDATE). Runs in the same transaction as the release; if it throws, the file is not kept. */
  writeMetadata: () => void;
  /** Keep the file this one replaces as an earlier version: true for the same path, or the path of the file it supersedes. */
  versioned?: boolean | string;
}

/** Stores a scanned upload: quarantine, then record and release together. Either both the record and the file exist afterwards, or neither. */
export function storeUpload(o: StoreOpts): void {
  const digest = sha(o.buf);
  const key = digest;
  const live = (receipts.get(key) ?? []).filter((t) => t > now());
  if (!live.length) throw new HttpError(500, 'UNSCANNED_UPLOAD', 'This file was not checked, so it was not saved.'); // fail closed: a handler that skips the gate stores nothing
  live.shift();
  if (live.length) receipts.set(key, live); else receipts.delete(key);
  const qdir = join(o.dataDir, 'quarantine');
  mkdirSync(qdir, { recursive: true });
  const q = join(qdir, `${Date.now()}-${randomBytes(8).toString('hex')}`);
  writeFileSync(q, o.buf, { mode: 0o600 });
  mkdirSync(dirname(o.finalPath), { recursive: true });
  let kept: string | null = null;
  const old = typeof o.versioned === 'string' ? o.versioned : o.versioned ? o.finalPath : null;
  try {
    tx(() => {
      o.writeMetadata();
      if (intakeFault.point === 'before_release') throw new Error('injected fault before release');
      if (old && existsSync(old)) {
        const n = (one<{ v: number }>('SELECT COALESCE(MAX(version),0) v FROM file_versions WHERE path_key = ?', old)?.v ?? 0) + 1;
        kept = `${old}.v${n}`;
        renameSync(old, kept);
        run('INSERT INTO file_versions(path_key, version, kept_as, replaced_at, replaced_by) VALUES(?,?,?,?,?)', old, n, kept, now(), o.actor.id);
      }
      renameSync(q, o.finalPath);
      if (intakeFault.point === 'after_release') throw new Error('injected fault after release');
    });
  } catch (e) {
    // the record was rolled back; put the files back as they were
    try { if (existsSync(o.finalPath) && !existsSync(q) && o.finalPath !== old) rmSync(o.finalPath, { force: true }); } catch { /* swept later */ }
    try { if (kept && old && existsSync(kept)) { if (existsSync(old)) rmSync(old, { force: true }); renameSync(kept, old); } } catch { /* swept later */ }
    try { rmSync(q, { force: true }); } catch { /* swept later */ }
    logIntake(o.purpose, digest, o.buf.length, o.actor, o.ownerId ?? null, settings.scanner, 'store_failed', String((e as Error).message).slice(0, 200));
    throw e;
  }
  logIntake(o.purpose, digest, o.buf.length, o.actor, o.ownerId ?? null, settings.scanner, 'stored');
}

/** Clears files left in quarantine by a crash. Run by the sweeper; files younger than an hour may still be in flight. */
export function sweepQuarantine(dataDir: string): number {
  const dir = join(dataDir, 'quarantine');
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const f of readdirSync(dir)) {
    try { if (Date.now() - statSync(join(dir, f)).mtimeMs > 3600_000) { rmSync(join(dir, f), { force: true }); n++; } } catch { /* next time */ }
  }
  return n;
}

export function intakeSummary(): { stored: number; rejected: number; unavailable: number; failed: number } {
  const r = many<{ outcome: string; n: number }>('SELECT outcome, COUNT(*) n FROM file_intake_log GROUP BY outcome');
  const g = (k: string) => r.find((x) => x.outcome === k)?.n ?? 0;
  return { stored: g('stored'), rejected: g('rejected'), unavailable: g('scan_unavailable'), failed: g('store_failed') };
}
