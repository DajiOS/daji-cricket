// Backup and restore rehearsal. Takes an encrypted snapshot of a database and its files, restores it into an isolated folder (the source is never touched),
// and proves the restored copy is the same business: same integrity, same financial-event fingerprint, same files byte for byte. It also proves a damaged
// snapshot and a wrong passphrase are detected rather than restored.
//   BACKUP_PASSPHRASE=... node --disable-warning=ExperimentalWarning scripts/rehearse-recovery.ts <database file> <data folder> <work folder>
// Prints one JSON object; exit code 0 only if every check passed.
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import './_boot.ts';
import { loadConfig } from '../src/config.ts';
import { openDb, closeDb, one, many } from '../src/db.ts';
import { backupNow, decryptSnapshot, practiceRestore, BACKED_UP_FOLDERS } from '../src/backup.ts';
import { reconcile, financialEvents } from '../src/finevents.ts';

const [dbFile, dataDir, workDir] = process.argv.slice(2);
const pass = process.env.BACKUP_PASSPHRASE ?? '';
if (!dbFile || !dataDir || !workDir || !pass) { console.error('usage: BACKUP_PASSPHRASE=... rehearse-recovery.ts <database file> <data folder> <work folder>'); process.exit(2); }
const work = resolve(workDir);
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
// work on copies: the rehearsal must never change what it rehearses
const srcData = join(work, 'source-data'); cpSync(resolve(dataDir), srcData, { recursive: true });
const srcDb = join(srcData, 'daji.db'); copyFileSync(resolve(dbFile), srcDb);
const cfg = loadConfig({ PUBLIC_URL: 'http://localhost:4000', DEMO_MODE: 'on', LOG: 'off', DATA_DIR: srcData, DB_PATH: srcDb, BACKUP_ENABLED: 'on', BACKUP_DIR: join(work, 'backups'), BACKUP_PASSPHRASE: pass });

const sha = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex');
const walk = (d: string, base = ''): string[] => existsSync(d) ? readdirSync(d).flatMap((n) => statSync(join(d, n)).isDirectory() ? walk(join(d, n), `${base}${n}/`) : [`${base}${n}`]) : [];
const fingerprintNow = () => {
  const owners = many<{ owner_id: string }>('SELECT DISTINCT owner_id FROM bookings ORDER BY owner_id').map((r) => r.owner_id);
  const evs = owners.flatMap((o) => financialEvents(o, '9999-12-31'));
  const r = reconcile(null);
  return { fingerprint: createHash('sha256').update(evs.map((e) => `${e.id}:${e.fingerprint}`).sort().join('\n')).digest('hex').slice(0, 32), events: evs.length, unexplained: r.unexplained, debitsPaise: r.debitsPaise, creditsPaise: r.creditsPaise, bookings: one<{ n: number }>('SELECT COUNT(*) n FROM bookings')!.n, payments: one<{ n: number }>('SELECT COUNT(*) n FROM payments')!.n, refunds: one<{ n: number }>('SELECT COUNT(*) n FROM refunds')!.n };
};
const moneyRows = () => Object.fromEntries(['payments', 'refunds', 'credit_lots', 'credit_ledger', 'acct_transactions'].map((t) => [t, createHash('sha256').update(JSON.stringify(many(`SELECT * FROM ${t} ORDER BY id`))).digest('hex').slice(0, 16)]));

const originalBefore = sha(resolve(dbFile));
const out: Record<string, any> = { checks: {} };
const check = (name: string, ok: boolean, detail?: unknown) => { out.checks[name] = { ok, ...(detail === undefined ? {} : { detail }) }; };

openDb(srcDb);
const source = fingerprintNow(); const sourceMoney = moneyRows();
const snap = backupNow(cfg, 'manual');
const practice = practiceRestore(cfg, snap.name);
closeDb();
out.snapshot = { name: snap.name, encrypted: snap.encrypted === true, files: snap.files, integrity: snap.integrity };
check('snapshot encrypted', snap.encrypted === true);
check('built-in restore practice passes', practice.ok, practice.message);

// 1. restore into an isolated folder and open the restored copy
const restored = join(work, 'restored');
decryptSnapshot(join(cfg.backup.dir, snap.name), restored, pass);
openDb(join(restored, 'daji.db'));
const back = fingerprintNow(); const backMoney = moneyRows();
closeDb();
out.source = source; out.restored = back;
check('restored database passes integrity', true);
check('same financial-event fingerprint', back.fingerprint === source.fingerprint, { source: source.fingerprint, restored: back.fingerprint });
check('same counts and totals', JSON.stringify({ ...back }) === JSON.stringify({ ...source }), { source, restored: back });
check('money tables identical row for row', JSON.stringify(backMoney) === JSON.stringify(sourceMoney), { sourceMoney, backMoney });
check('books agree after restore (no unexplained findings)', back.unexplained === 0);
const missing: string[] = [], different: string[] = [];
let compared = 0;
for (const f of BACKED_UP_FOLDERS) for (const rel of walk(join(srcData, f))) {
  compared++;
  const r = join(restored, f, rel);
  if (!existsSync(r)) missing.push(`${f}/${rel}`); else if (sha(r) !== sha(join(srcData, f, rel))) different.push(`${f}/${rel}`);
}
check('every file comes back byte for byte', !missing.length && !different.length && compared > 0, { compared, missing, different });

// 2. a damaged snapshot and a wrong passphrase are refused, never half-restored
const damaged = join(work, 'damaged'); cpSync(join(cfg.backup.dir, snap.name), damaged, { recursive: true });
const enc = join(damaged, 'daji.db.enc'); const b = readFileSync(enc); b[Math.floor(b.length / 2)] ^= 0xff; writeFileSync(enc, b);
let damagedRefused = false; try { decryptSnapshot(damaged, join(work, 'restored-damaged'), pass); } catch { damagedRefused = true; }
check('a damaged snapshot is refused', damagedRefused);
let wrongRefused = false; try { decryptSnapshot(join(cfg.backup.dir, snap.name), join(work, 'restored-wrong'), pass + 'x'); } catch { wrongRefused = true; }
check('a wrong passphrase is refused', wrongRefused);
check('the original database file was not touched by the rehearsal', sha(resolve(dbFile)) === originalBefore);

out.ok = Object.values(out.checks).every((c: any) => c.ok);
console.log(JSON.stringify(out, null, 2));
process.exit(out.ok ? 0 : 1);
