// Creates the first super admin (and, with OWNER=1, the ground owner account) on a fresh server.
//   ADMIN_EMAIL=you@example.com ADMIN_NAME="Hemanshu Patel" ADMIN_PASSWORD='...' node --disable-warning=ExperimentalWarning scripts/create-admin.ts
// Password: at least 8 characters with a capital letter, a small letter and a number. Pass it in the environment, not on screen.
import { loadConfig } from '../src/config.ts';
import { openDb, closeDb } from '../src/db.ts';
import { createUser, userByEmail } from '../src/auth.ts';

const cfg = loadConfig();
openDb(cfg.dbPath);
const email = (process.env.ADMIN_EMAIL ?? '').trim(), name = (process.env.ADMIN_NAME ?? '').trim(), password = process.env.ADMIN_PASSWORD ?? '';
const role = process.env.OWNER ? 'owner' : 'super_admin';
if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email) || name.length < 2) { console.error('Set ADMIN_EMAIL and ADMIN_NAME.'); process.exit(2); }
if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(password)) { console.error('ADMIN_PASSWORD needs 8+ characters with a capital letter, a small letter and a number.'); process.exit(2); }
if (userByEmail(email)) { console.error('An account with this email already exists.'); process.exit(1); }
const u = createUser({ role, name, email, password });
console.log(`Created ${role} ${u.email}.`);
closeDb();
