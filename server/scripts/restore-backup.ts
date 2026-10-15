// Restores a snapshot into a folder you choose, decrypting it when it is encrypted.
//   BACKUP_PASSPHRASE=... node --disable-warning=ExperimentalWarning scripts/restore-backup.ts <snapshot folder> <output folder>
// Then stop the server, copy daji.db (and uploads/) from the output folder into the data folder, and start it again.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decryptSnapshot, checkDatabaseFile } from '../src/backup.ts';

const [snap, out] = process.argv.slice(2);
if (!snap || !out) { console.error('Usage: restore-backup.ts <snapshot folder> <output folder>'); process.exit(2); }
const manifest = JSON.parse(readFileSync(join(snap, 'manifest.json'), 'utf8'));
if (manifest.encrypted && !process.env.BACKUP_PASSPHRASE) { console.error('This snapshot is encrypted. Set BACKUP_PASSPHRASE.'); process.exit(2); }
decryptSnapshot(snap, out, process.env.BACKUP_PASSPHRASE ?? '');
const db = join(out, 'daji.db');
if (!existsSync(db)) { console.error('No database found in the snapshot'); process.exit(1); }
const c = checkDatabaseFile(db);
console.log(`Restored to ${out}. Integrity: ${c.integrity}. ${c.users} users, ${c.bookings} bookings.`);
