// One of several operating-system processes that try to hold the same slot on the same database file at the same moment (REL-BOOK-001).
// Prints one JSON line: how the hold ended. It waits for START_AT so all processes fire together.
import { loadConfig } from '../../src/config.ts';
import { openDb, one } from '../../src/db.ts';
import { setNow } from '../../src/clock.ts';
import { holdSlots } from '../../src/hold.ts';
import { userByEmail } from '../../src/auth.ts';

const env = process.env;
setNow(Number(env.TEST_NOW));
openDb(env.DB_FILE!);
const cfg = loadConfig({ PUBLIC_URL: 'http://localhost:4000', RATE_LIMIT: 'off', LOG: 'off', DEMO_MODE: 'on' });
const user = userByEmail(env.CUSTOMER_EMAIL!)!;
const startAt = Number(env.START_AT);
while (Date.now() < startAt) { /* spin: all processes fire together */ }
try {
  const r = await holdSlots(cfg, user, { groundId: env.GROUND_ID, date: env.DATE, startTime: env.TIME, slots: Number(env.SLOTS ?? 1) });
  console.log(JSON.stringify({ ok: true, bookingId: r.booking.id }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, code: (e as { code?: string }).code ?? 'ERR', message: String((e as Error).message) }));
}
void one;
