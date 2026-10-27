// Plays the everyday money flows through the API of whichever version of the code it is run from, against a database file and data folder.
// The rollback rehearsal runs it with the OLD code against a database the NEW code has already migrated (and the new code afterwards), to prove that
// going back, and coming forward again, keeps taking bookings and payments and leaves the books in agreement.
//   node --disable-warning=ExperimentalWarning scripts/exercise-flows.ts <database file> <data folder> [label]
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { loadConfig } from '../src/config.ts';
import { openDb, closeDb, one } from '../src/db.ts';
import { buildServer } from '../src/app.ts';
import { istDate, addDays } from '../src/time.ts';
import { DEMO_ACCOUNTS } from '../test/helpers.ts';

const [dbFile, dataDir, label = 'run'] = process.argv.slice(2);
if (!dbFile || !dataDir) { console.error('usage: exercise-flows.ts <database file> <data folder> [label]'); process.exit(2); }
mkdirSync(resolve(dataDir), { recursive: true });
const cfg = loadConfig({ PUBLIC_URL: 'http://localhost:4000', RATE_LIMIT: 'off', REQUIRE_STAFF_TERMS: 'off', LOG: 'off', DEMO_MODE: 'on', DATA_DIR: resolve(dataDir) });
openDb(resolve(dbFile));
const server = buildServer(cfg);
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const call = async (method: string, path: string, token?: string, body?: unknown, raw?: Buffer) => {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch(url + path, { method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const t = await r.text(); let j: any = t; try { j = JSON.parse(t); } catch { /* text */ }
  return { status: r.status, body: j };
};
const login = async (a: keyof typeof DEMO_ACCOUNTS) => (await call('POST', '/api/auth/login', undefined, { email: DEMO_ACCOUNTS[a].email, password: DEMO_ACCOUNTS[a].password })).body.token as string;
const cust = await login('customer'), staff = await login('staff1'), owner = await login('owner1');
const ground = (await call('GET', '/api/grounds')).body;
const gid = (Array.isArray(ground) ? ground : ground.grounds ?? ground.items)[0].id as string;
const day = (n: number) => addDays(istDate(Date.now()), n);
const salt = label.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 20;
const out: Record<string, unknown> = { label, version: process.env.CODE_VERSION ?? 'unknown' };

// an online booking paid in full through the demo gateway
const hold = await call('POST', '/api/bookings', cust, { groundId: gid, date: day(40 + salt), startTime: '10:00', slots: 1 });
let paid: any = null;
if (hold.status === 201) {
  const orderId = hold.body.payment.razorpay.orderId;
  const pay = await call('POST', '/api/gateway/demo/pay', cust, { orderId });
  paid = await call('POST', '/api/payments/razorpay/verify', cust, { orderId, paymentId: pay.body.paymentId, signature: pay.body.signature });
}
out.onlineBooking = { hold: hold.status, verify: paid?.status, status: paid?.body?.booking?.status, paidPaise: paid?.body?.booking?.paidPaise };
// an early cancellation: the refund goes through the usual request and approval
if (paid?.status === 200) { const c = await call('POST', `/api/bookings/${paid.body.booking.id}/cancel`, cust, { reason: 'plans changed' }); out.cancel = { status: c.status, outcome: c.body?.outcome?.kind ?? c.body?.outcome ?? null }; }
// a second booking left standing, paid by the desk in cash
const walk = await call('POST', '/api/staff/bookings', staff, { groundId: gid, date: day(45 + salt), startTime: '17:00', slots: 1, customer: { name: `Walk In ${label}`, phone: `98666${String(10000 + salt * 7 + label.length).slice(-5)}` }, payment: { method: 'cash', amountPaise: 0 } });
out.walkIn = { status: walk.status };
// a picture upload
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`picture from ${label}`)]);
const up = await call('POST', `/api/media?kind=gallery&filename=${label}.png`, owner, undefined, png);
out.upload = { status: up.status };
out.bookings = one<{ n: number }>('SELECT COUNT(*) n FROM bookings')!.n;
out.payments = one<{ n: number }>('SELECT COUNT(*) n FROM payments')!.n;
out.refunds = one<{ n: number }>('SELECT COUNT(*) n FROM refunds')!.n;
await new Promise<void>((r) => { server.close(() => r()); server.closeAllConnections(); });
closeDb();
console.log(JSON.stringify(out));
process.exit(0);
