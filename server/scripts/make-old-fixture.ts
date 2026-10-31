// Builds a realistic database with the PREVIOUS release of the code (run it from a checkout of the base commit), for the migration rehearsal.
// It plays a month of business through the old API: online bookings paid in full and in part, a UPI payment, a late cancellation that kept money, an early cancellation that
// was refunded, a walk-in, a webhook capture, an accounting entry and uploaded files, then writes the database and the data folder to the output folder.
//   cd <old checkout>/server && node --disable-warning=ExperimentalWarning scripts/make-old-fixture.ts <output folder>
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { startHarness, grounds, hold, bookAndPay, dayFromNow, advance, MIN } from '../test/helpers.ts';
import { db, one, many } from '../src/db.ts';
import { runSweeps } from '../src/jobs.ts';
import { createHash } from 'node:crypto';

const out = resolve(process.argv[2] ?? '');
if (!process.argv[2]) { console.error('usage: make-old-fixture.ts <output folder>'); process.exit(2); }
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'data'), { recursive: true });
const h = await startHarness({ DATA_DIR: join(out, 'data') });
const g = (await grounds(h))[0]!;
const cust = await h.login('customer'), staff = await h.login('staff1'), owner = await h.login('owner1');
const log: Record<string, unknown> = {};
// A release with prices on enquiry turned on refuses online bookings, so the month is played with it off and the business's own setting is put back before the copy is written.
const admin = await h.login('admin');
const enquiry = one<{ value: string }>("SELECT value FROM settings WHERE key = 'pricesOnEnquiry'");
if (enquiry) await h.put('/api/admin/settings', { pricesOnEnquiry: false }, admin);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fixture picture')]);

// paid in full, three different days
await bookAndPay(h, cust, g.id, dayFromNow(3), '19:00', 2);
const b2 = await bookAndPay(h, cust, g.id, dayFromNow(5), '10:00', 1);
const b3 = await bookAndPay(h, cust, g.id, dayFromNow(9), '20:00', 1);
// a cancellation inside the free window with the deposit kept as credit, one far ahead with a refund
const c1 = await h.post(`/api/bookings/${b2.id}/cancel`, { reason: 'plans changed' }, cust);
const c2 = await h.post(`/api/bookings/${b3.id}/cancel`, { reason: 'plans changed' }, cust);
// a cancellation 12 hours before the start: part of the deposit is kept and the rest becomes account credit
const b4 = await bookAndPay(h, cust, g.id, dayFromNow(0), '22:00', 1);
const c3 = await h.post(`/api/bookings/${b4.id}/cancel`, { reason: 'plans changed' }, cust);
// a held booking nobody paid for, and a UPI reference waiting to be verified
const held = await hold(h, cust, g.id, dayFromNow(12), '08:00', 1);
const upi = await hold(h, cust, g.id, dayFromNow(14), '09:00', 1);
const sub = await h.post(`/api/bookings/${upi.body.booking.id}/upi-reference`, { utr: '412345678901' }, cust);
// a walk-in at the desk, paid in cash
const walk = await h.post('/api/staff/bookings', { groundId: g.id, date: dayFromNow(2), startTime: '17:00', slots: 1, customer: { name: 'Walk In', phone: '9866600055' }, payment: { method: 'cash', amountPaise: 0 } }, staff);
// accounting and files
const bank = await h.post('/api/accounting/accounts', { kind: 'bank', name: 'HDFC current', openingPaise: 10000000, openingDate: dayFromNow(-400) }, owner);
const tx = await h.post('/api/accounting/transactions', { accountId: bank.body.id, date: dayFromNow(0), amountPaise: -250000, description: 'Roller hire' }, owner);
const up = await fetch(`${h.url}/api/media?kind=gallery&filename=fixture.png`, { method: 'POST', headers: { authorization: `Bearer ${owner}`, 'content-type': 'application/octet-stream' }, body: PNG });
const att = await fetch(`${h.url}/api/accounting/attachments?entity=transaction&id=${tx.body.id}&filename=r.png`, { method: 'POST', headers: { authorization: `Bearer ${owner}`, 'content-type': 'application/octet-stream' }, body: PNG });
advance(30 * MIN);
await runSweeps(h.cfg);
if (enquiry) await h.put('/api/admin/settings', { pricesOnEnquiry: JSON.parse(enquiry.value) }, admin);

log.statuses = { c1: c1.status, c2: c2.status, c3: c3.status, held: held.status, upi: upi.status, sub: sub.status, walk: walk.status, tx: tx.status, media: up.status, attachment: att.status };
const tables = (db().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
log.rows = Object.fromEntries(tables.map((t) => [t, one<{ n: number }>(`SELECT COUNT(*) n FROM "${t}"`)!.n]).filter(([, n]) => n));
db().exec(`VACUUM INTO '${join(out, 'old.db').replace(/'/g, "''")}'`);
log.sha256 = createHash('sha256').update(JSON.stringify(many('SELECT id, status, total_paise, paid_paise FROM bookings ORDER BY id'))).digest('hex');
writeFileSync(join(out, 'fixture.json'), JSON.stringify(log, null, 2));
await h.close();
console.log(JSON.stringify(log, null, 2));
process.exit(0);
