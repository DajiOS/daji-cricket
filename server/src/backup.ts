import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { db } from './db.ts';
import { now } from './clock.ts';
import { audit, SYSTEM, type Actor } from './audit.ts';
import { istDate, timeOfDay, MIN } from './time.ts';
import type { Config } from './config.ts';
import { decryptBytes, encryptBytes, keyFingerprint } from './vault.ts';
import { uploadSnapshot } from './offsite.ts';

// A daily snapshot of everything that would be lost if the server's disk were lost: the database, and the folder of
// uploaded files (receipts, photos) when there is one. A snapshot is a folder named by its IST date and time:
//   backups/2026-10-15_031502/daji.db, uploads/..., manifest.json
// It is written to a ".partial" folder first and renamed when it is complete and has passed an integrity check, so
// a half-written snapshot can never be mistaken for a good one. The oldest snapshots beyond BACKUP_KEEP are removed.
// A snapshot on the same disk does not protect against losing the disk: copy the backups folder off the server too.

/** India time of the daily snapshot. */
export const BACKUP_AT = '03:15';

export interface BackupInfo {
  name: string;
  createdAt: number;
  /** IST date, YYYY-MM-DD. */
  date: string;
  reason: 'scheduled' | 'manual';
  dbBytes: number;
  files: number;
  filesBytes: number;
  /** Result of SQLite's integrity check on the copy: 'ok' or what it found. */
  integrity: string;
  /** True when BACKUP_PASSPHRASE was set: the files are daji.db.enc and encrypted copies of the uploads, readable only with the passphrase. */
  encrypted?: boolean;
  /** Fingerprint of FIELD_KEY at backup time (null when no key was set). A restore with a different key cannot read the sealed fields. */
  keyFingerprint?: string | null;
  /** Whether the FIELD_KEY running now is the one this backup was made under. */
  keyMatches?: boolean;
  /** Result of the copy to the offsite bucket, when one is set up. */
  offsite?: { at: number; ok: boolean; message: string };
}

const NAME_RE = /^\d{4}-\d{2}-\d{2}_\d{6}(-\d+)?$/;
const pad = (n: number): string => String(n).padStart(2, '0');

function stamp(ms: number): string {
  const d = new Date(ms + 330 * MIN);
  return `${istDate(ms)}_${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

function folderSize(dir: string): { files: number; bytes: number } {
  let files = 0, bytes = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { const s = folderSize(p); files += s.files; bytes += s.bytes; }
    else if (e.isFile()) { files++; bytes += statSync(p).size; }
  }
  return { files, bytes };
}

/** Opens the copy on its own and runs SQLite's integrity check, so "backed up" means "can be read back". */
export function checkDatabaseFile(path: string): { integrity: string; users: number; bookings: number } {
  const d = new DatabaseSync(path, { readOnly: true });
  try {
    const integrity = String((d.prepare('PRAGMA integrity_check').get() as Record<string, unknown>).integrity_check);
    const count = (t: string): number => Number((d.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n);
    return { integrity, users: count('users'), bookings: count('bookings') };
  } finally { d.close(); }
}

export function listBackups(cfg: Config): BackupInfo[] {
  if (!existsSync(cfg.backup.dir)) return [];
  const out: BackupInfo[] = [];
  for (const name of readdirSync(cfg.backup.dir)) {
    if (!NAME_RE.test(name)) continue;
    try {
      const info = { name, ...(JSON.parse(readFileSync(join(cfg.backup.dir, name, 'manifest.json'), 'utf8')) as Omit<BackupInfo, 'name'>) } as BackupInfo;
      try { info.offsite = JSON.parse(readFileSync(join(cfg.backup.dir, name, 'offsite.json'), 'utf8')); } catch { /* not uploaded (yet) */ }
      info.keyMatches = (info.keyFingerprint ?? null) === keyFingerprint();
      out.push(info);
    } catch { /* not a finished snapshot */ }
  }
  return out.sort((a, b) => (a.name < b.name ? 1 : -1));
}

/** Folders under the data directory that are copied into every snapshot (the database is copied separately). */
export const BACKED_UP_FOLDERS = ['uploads', 'task-photos', 'avatars', 'cards', 'library', 'media'];

/** Takes a snapshot now. Throws if the copy cannot be read back; nothing is left behind in that case. */
export function backupNow(cfg: Config, reason: 'scheduled' | 'manual', actor: Actor = SYSTEM): BackupInfo {
  const root = cfg.backup.dir;
  mkdirSync(root, { recursive: true });
  const t = now();
  let name = stamp(t);
  for (let i = 2; existsSync(join(root, name)); i++) name = `${stamp(t)}-${i}`;
  const work = join(root, `${name}.partial`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work);
  try {
    const dbFile = join(work, 'daji.db');
    db().exec(`VACUUM INTO '${dbFile.replace(/'/g, "''")}'`);
    const check = checkDatabaseFile(dbFile);
    if (check.integrity !== 'ok') throw new Error(`The copy failed SQLite's integrity check: ${check.integrity}`);
    // Every folder of files the app keeps: receipts and documents, task photos, avatars, scanned cards, the media library and website media.
    let files = 0, filesBytes = 0;
    for (const dir of BACKED_UP_FOLDERS) {
      const src = join(cfg.dataDir, dir);
      if (!existsSync(src)) continue;
      cpSync(src, join(work, dir), { recursive: true });
      const sz = folderSize(join(work, dir));
      files += sz.files; filesBytes += sz.bytes;
    }
    const dbBytes = statSync(dbFile).size;
    const pass = cfg.backup.passphrase;
    if (pass) { sealTree(work, pass); } // the integrity check above ran on the plain copy; only the encrypted files remain afterwards
    const info: Omit<BackupInfo, 'name'> = { createdAt: t, date: istDate(t), reason, dbBytes, files, filesBytes, integrity: check.integrity, ...(pass ? { encrypted: true } : {}), keyFingerprint: keyFingerprint() };
    writeFileSync(join(work, 'manifest.json'), JSON.stringify(info, null, 2));
    renameSync(work, join(root, name));
    const done: BackupInfo = { name, ...info };
    try { audit(actor, 'backup.create', 'backup', name, { reason, dbBytes: info.dbBytes, files, filesBytes }); } catch { /* the snapshot stands even if the log line cannot be written */ }
    prune(cfg);
    return done;
  } catch (e) {
    rmSync(work, { recursive: true, force: true });
    throw e;
  }
}

/** Replaces every file in the snapshot folder (except the manifest, written afterwards) with an encrypted copy. */
function sealTree(dir: string, pass: string): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) sealTree(p, pass);
    else if (e.isFile() && !e.name.endsWith('.enc')) { writeFileSync(p + '.enc', encryptBytes(readFileSync(p), pass)); rmSync(p); }
  }
}

/** Turns an encrypted snapshot back into a plain one in `outDir` (a restore). Throws on a wrong passphrase. */
export function decryptSnapshot(snapshotDir: string, outDir: string, pass: string): void {
  mkdirSync(outDir, { recursive: true });
  for (const e of readdirSync(snapshotDir, { withFileTypes: true })) {
    const src = join(snapshotDir, e.name);
    if (e.isDirectory()) decryptSnapshot(src, join(outDir, e.name), pass);
    else if (e.name.endsWith('.enc')) writeFileSync(join(outDir, e.name.slice(0, -4)), decryptBytes(readFileSync(src), pass));
    else cpSync(src, join(outDir, e.name));
  }
}

/** Keeps the newest `keep` snapshots (and sweeps up any ".partial" folder left by a crash). */
function prune(cfg: Config): void {
  for (const n of readdirSync(cfg.backup.dir)) if (n.endsWith('.partial')) rmSync(join(cfg.backup.dir, n), { recursive: true, force: true });
  for (const b of listBackups(cfg).slice(cfg.backup.keep)) rmSync(join(cfg.backup.dir, b.name), { recursive: true, force: true });
}

/** The next scheduled snapshot: today at 03:15 IST if that has not passed, else tomorrow. */
export function nextBackupAt(t: number = now()): number {
  const [h, m] = BACKUP_AT.split(':').map(Number) as [number, number];
  const today = istDate(t);
  const at = Date.parse(`${today}T${pad(h)}:${pad(m)}:00+05:30`);
  return at > t ? at : at + 24 * 60 * MIN;
}

let lastTry = 0;
/** Called every minute by the scheduler. Takes the day's snapshot once it is 03:15 in India, and tries again later if it failed. */
export function runBackupIfDue(cfg: Config, onError: (e: unknown) => void = () => {}): BackupInfo | null {
  if (!cfg.backup.enabled) return null;
  const t = now();
  if (timeOfDay(t) < BACKUP_AT) return null;
  const today = istDate(t);
  if (listBackups(cfg).some((b) => b.reason === 'scheduled' && b.date === today)) return null;
  if (t - lastTry < 30 * MIN) return null; // a failing disk is retried every half hour, not every minute
  lastTry = t;
  try {
    const b = backupNow(cfg, 'scheduled');
    if (cfg.backup.s3.bucket) setImmediate(() => { uploadSnapshot(cfg, b.name).catch(onError); }); // copied off the server behind the schedule, never blocking it
    return b;
  } catch (e) { onError(e); return null; }
}
export function resetBackupRetry(): void { lastTry = 0; }

// ---- restore practice and the offsite copy record ----
// A backup is only proven by restoring it. practiceRestore() restores a snapshot into a throw-away folder, checks the database and the files, deletes the
// folder and records the result in <data>/restore-practice.json, so the desk can show when a restore was last practised. The live data is never touched.
// deploy/offsite-backup.sh writes <data>/offsite-copy.json each time it copies the backups off the server, for the same reason.

export const RESTORE_PRACTICE_FILE = 'restore-practice.json';
export const OFFSITE_COPY_FILE = 'offsite-copy.json';
export interface RestorePractice { at: number; snapshot: string | null; ok: boolean; message: string; integrity?: string; users?: number; bookings?: number; files?: number }

export function practiceRestore(cfg: Config, name?: string, actor: Actor = SYSTEM): RestorePractice {
  const t = now();
  const record = (r: RestorePractice): RestorePractice => {
    try { writeFileSync(join(cfg.dataDir, RESTORE_PRACTICE_FILE), JSON.stringify(r, null, 2)); } catch { /* the result is still returned */ }
    try { audit(actor, 'backup.restore_practice', 'backup', r.snapshot, { ok: r.ok, message: r.message }); } catch { /* as above */ }
    return r;
  };
  const snap = name ? listBackups(cfg).find((b) => b.name === name) : listBackups(cfg)[0];
  if (!snap) return record({ at: t, snapshot: name ?? null, ok: false, message: name ? `There is no snapshot called ${name}.` : 'There is no snapshot to restore yet. Take a backup first.' });
  if (snap.encrypted && !cfg.backup.passphrase) return record({ at: t, snapshot: snap.name, ok: false, message: 'This snapshot is encrypted and BACKUP_PASSPHRASE is not set on this server.' });
  const out = mkdtempSync(join(tmpdir(), 'daji-restore-'));
  try {
    try { decryptSnapshot(join(cfg.backup.dir, snap.name), out, cfg.backup.passphrase); }
    catch { return record({ at: t, snapshot: snap.name, ok: false, message: 'The snapshot could not be decrypted: BACKUP_PASSPHRASE is not the one it was made with.' }); }
    const dbFile = join(out, 'daji.db');
    if (!existsSync(dbFile)) return record({ at: t, snapshot: snap.name, ok: false, message: 'The snapshot has no database in it.' });
    const c = checkDatabaseFile(dbFile);
    let files = 0;
    for (const dir of BACKED_UP_FOLDERS) if (existsSync(join(out, dir))) files += folderSize(join(out, dir)).files;
    const problems = [c.integrity !== 'ok' ? `the database failed its integrity check (${c.integrity})` : '', files !== snap.files ? `${files} of ${snap.files} files came back` : ''].filter(Boolean);
    const message = problems.length ? `Restore failed: ${problems.join('; ')}.` : `Restored ${snap.name}: ${c.users} users, ${c.bookings} bookings and ${files} files read back.`;
    return record({ at: t, snapshot: snap.name, ok: !problems.length, message, integrity: c.integrity, users: c.users, bookings: c.bookings, files });
  } finally { rmSync(out, { recursive: true, force: true }); }
}

function readJson<T>(path: string): T | null { try { return JSON.parse(readFileSync(path, 'utf8')) as T; } catch { return null; } }
export const lastRestorePractice = (cfg: Config): RestorePractice | null => readJson<RestorePractice>(join(cfg.dataDir, RESTORE_PRACTICE_FILE));
/** The last run of deploy/offsite-backup.sh: when, and how many snapshots it copied. */
export function lastOffsiteCopy(cfg: Config): { at: number; snapshots: number } | null {
  const r = readJson<{ at?: unknown; snapshots?: unknown }>(join(cfg.dataDir, OFFSITE_COPY_FILE));
  return r && typeof r.at === 'number' ? { at: r.at, snapshots: Number(r.snapshots) || 0 } : null;
}
