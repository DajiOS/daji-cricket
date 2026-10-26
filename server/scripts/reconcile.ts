// Checks that the money in a database agrees with itself: every payment, refund, credit lot and accounting entry against the booking it belongs to.
// It works on a COPY of the database (opening a database applies any pending schema modules, and a check must never change the thing it checks).
//   node --disable-warning=ExperimentalWarning scripts/reconcile.ts <database file> [--owner <owner id>] [--json] [--events]
// Exit code 0 = no unexplained problem; 1 = at least one unexplained problem (listed); 2 = the database could not be read.
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { openDb, closeDb, one, many } from '../src/db.ts';
import './_boot.ts'; // registers every schema module in the order the server does
import { reconcile, financialEvents } from '../src/finevents.ts';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--owner');
if (!file || !existsSync(resolve(file))) { console.error('usage: reconcile.ts <database file> [--owner <id>] [--json] [--events]'); process.exit(2); }
const ownerIdx = args.indexOf('--owner');
const owner = ownerIdx >= 0 ? args[ownerIdx + 1] ?? null : null;
const work = mkdtempSync(join(tmpdir(), 'daji-reconcile-'));
let code = 0;
try {
  const copy = join(work, 'copy.db');
  copyFileSync(resolve(file), copy);
  for (const ext of ['-wal', '-shm']) if (existsSync(resolve(file) + ext)) copyFileSync(resolve(file) + ext, copy + ext);
  openDb(copy);
  const report = reconcile(owner);
  // one fingerprint over every financial event id and its debits/credits: the same records always give the same value, so two databases (or one before and after a restore) can be compared
  const owners = owner ? [owner] : many<{ owner_id: string }>('SELECT DISTINCT owner_id FROM bookings ORDER BY owner_id').map((r) => r.owner_id);
  const events = owners.flatMap((o) => financialEvents(o, '9999-12-31'));
  const fingerprint = createHash('sha256').update(events.map((e) => `${e.id}:${e.fingerprint}`).sort().join('\n')).digest('hex').slice(0, 32);
  const out = { database: resolve(file), owner, clean: report.clean, unexplained: report.unexplained, findings: report.findings, debitsPaise: report.debitsPaise, creditsPaise: report.creditsPaise, financialEvents: events.length, fingerprint, totals: report.totals, events: events.map((e) => ({ id: e.id, fingerprint: e.fingerprint })), integrity: one<{ integrity_check: string }>('PRAGMA integrity_check')?.integrity_check };
  closeDb();
  if (args.includes('--json')) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`${out.unexplained === 0 ? 'OK' : 'PROBLEM'}: ${out.financialEvents} financial events, debits ${out.debitsPaise} = credits ${out.creditsPaise}, ${out.findings.length} finding(s), ${out.unexplained} unexplained. Fingerprint ${out.fingerprint}`);
    for (const f of out.findings) console.log(`  [${f.severity}${f.explained ? ', explained' : ''}] ${f.code} ${f.entity} ${f.id}: ${f.detail}`);
  }
  code = out.unexplained === 0 && out.integrity === 'ok' ? 0 : 1;
} catch (e) { console.error(`could not read the database: ${(e as Error).message}`); code = 2; }
finally { rmSync(work, { recursive: true, force: true }); }
process.exit(code);
