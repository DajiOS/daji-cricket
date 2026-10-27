// Applies the pending schema modules to a database file and checks the result. Run it on a COPY first (--dry-run does that for you).
// Each module is applied in its own transaction: if the process dies part-way, that module is simply absent and the next start applies it again.
//   node --disable-warning=ExperimentalWarning scripts/migrate.ts <database file> [--dry-run] [--json]
// Prints which modules were applied, the integrity and foreign-key checks, and a fingerprint of every table's rows, so a before and an after can be compared.
// REHEARSAL_KILL_BEFORE_COMMIT=<module id> makes the process kill itself inside that module's transaction (used only by the migration rehearsal).
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import './_boot.ts'; // registers every schema module in the order the server does
import { openDb, closeDb, db, migrationFault, registeredSchemaIds } from '../src/db.ts';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file || !existsSync(resolve(file))) { console.error('usage: migrate.ts <database file> [--dry-run] [--json]'); process.exit(2); }
let target = resolve(file);
let work: string | null = null;
if (args.includes('--dry-run')) {
  work = mkdtempSync(join(tmpdir(), 'daji-migrate-'));
  const copy = join(work, 'copy.db');
  copyFileSync(target, copy);
  for (const ext of ['-wal', '-shm']) if (existsSync(target + ext)) copyFileSync(target + ext, copy + ext);
  target = copy;
}
const kill = process.env.REHEARSAL_KILL_BEFORE_COMMIT;
if (kill) migrationFault.beforeCommit = (id) => { if (id === kill) process.kill(process.pid, 'SIGKILL'); };

const started = Date.now();
let code = 0;
try {
  const before = new Set<string>();
  try { const d0 = new (await import('node:sqlite')).DatabaseSync(target, { readOnly: true }); for (const r of d0.prepare('SELECT id FROM schema_migrations').all() as { id: string }[]) before.add(r.id); d0.close(); } catch { /* a new database */ }
  openDb(target);
  const d = db();
  const applied = (d.prepare('SELECT id FROM schema_migrations ORDER BY applied_at, rowid').all() as { id: string }[]).map((r) => r.id).filter((id) => !before.has(id));
  const tables = (d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
  const rows: Record<string, { rows: number; sha256: string }> = {};
  for (const t of tables) {
    const h = createHash('sha256'); let n = 0;
    for (const r of d.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).iterate()) { h.update(JSON.stringify(r)); n++; }
    rows[t] = { rows: n, sha256: h.digest('hex') };
  }
  const out = {
    database: target, dryRun: !!work, appliedNow: applied, registered: registeredSchemaIds().length, ms: Date.now() - started,
    integrity: (d.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check,
    foreignKeyViolations: d.prepare('PRAGMA foreign_key_check').all().length, drift: [] as string[], tables: rows,
  };
  closeDb();
  if (args.includes('--json')) console.log(JSON.stringify(out));
  else console.log(`${out.integrity === 'ok' && !out.foreignKeyViolations ? 'OK' : 'PROBLEM'}: applied ${applied.length} module(s)${applied.length ? ` (${applied.join(', ')})` : ''}; integrity ${out.integrity}; ${out.foreignKeyViolations} foreign-key violation(s); ${tables.length} tables.`);
  if (out.integrity !== 'ok' || out.foreignKeyViolations) code = 1;
} catch (e) { console.error(`migration failed: ${(e as Error).message}`); code = 1; }
finally { if (work) rmSync(work, { recursive: true, force: true }); }
process.exit(code);
