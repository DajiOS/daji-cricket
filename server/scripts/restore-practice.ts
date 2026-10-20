// Practises a restore: restores the newest snapshot (or the one named) into a throw-away folder, checks the database and files, then deletes the folder.
// The live data is never touched. The result is kept in <data>/restore-practice.json and shown in the desk (Settings, Backups and the Go-live check).
//   node --disable-warning=ExperimentalWarning scripts/restore-practice.ts [snapshot name]
// On the server, run deploy/restore-practice.sh instead: it runs this inside the api container, which already has BACKUP_PASSPHRASE.
import { loadConfig } from '../src/config.ts';
import { openDb, closeDb } from '../src/db.ts';
import { practiceRestore } from '../src/backup.ts';

const cfg = loadConfig();
openDb(cfg.dbPath);
const r = practiceRestore(cfg, process.argv[2]);
closeDb();
console.log(`${r.ok ? 'OK' : 'FAILED'}: ${r.message}`);
process.exit(r.ok ? 0 : 1);
