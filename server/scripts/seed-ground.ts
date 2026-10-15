// Adds the Daji Cricket Ground (hours, winter hours, every rate, closed Monday) to a live server from scripts/ground-daji.json.
//   OWNER_EMAIL=you@example.com node --disable-warning=ExperimentalWarning scripts/seed-ground.ts
// The account must already exist (see create-admin.ts). Runs once: it refuses if the owner already has a ground with this name.
import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/config.ts';
import { openDb, closeDb } from '../src/db.ts';
import { userByEmail } from '../src/auth.ts';
import { createGround, listGrounds } from '../src/grounds.ts';

const cfg = loadConfig();
openDb(cfg.dbPath);
const email = (process.env.OWNER_EMAIL ?? '').trim();
const u = userByEmail(email);
if (!u) { console.error('No account with OWNER_EMAIL. Run create-admin.ts first.'); process.exit(2); }
const body = JSON.parse(readFileSync(new URL('./ground-daji.json', import.meta.url), 'utf8'));
if (listGrounds({ ownerId: u.id, includeInactive: true }).some((g) => g.name === body.name)) { console.error(`"${body.name}" already exists for this owner.`); process.exit(1); }
const g = createGround(u.id, body);
console.log(`Created ground "${g.name}" (${g.id}) with ${JSON.parse(g.rates).length} rates.`);
closeDb();
