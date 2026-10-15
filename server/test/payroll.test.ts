import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, type Harness } from './helpers.ts';
import { grossFor, daysInMonth } from '../src/accounting/payroll.ts';
import { istDate, addDays } from '../src/time.ts';
import { now } from '../src/clock.ts';

let h: Harness; let owner: string, owner2: string, staff: string, cust: string, admin: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => { h.reset(); owner = await h.login('owner1'); owner2 = await h.login('owner2'); staff = await h.login('staff1'); cust = await h.login('customer'); admin = await h.login('admin'); });

const P = '/api/accounting/payroll';
const MONTH = () => istDate(now()).slice(0, 7);
const prevMonth = () => addDays(`${MONTH()}-01`, -1).slice(0, 7);
async function person(name: string, payType: string, ratePaise: number, token = owner, joinedOn = '2020-01-01') {
  const r = await h.post(`${P}/staff`, { name, role: 'Groundsman', payType, ratePaise, joinedOn }, token);
  assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body.id as string;
}

test('pay rule: monthly salary prorated by paid days, daily wage by days worked, in whole paise', () => {
  assert.equal(grossFor('monthly', 3000000, 60, 30), 3000000);        // 30 present days of 30
  assert.equal(grossFor('monthly', 3000000, 29, 30), 1450000);        // 14.5 days
  assert.equal(grossFor('monthly', 1000000, 2 * 20, 31), 645161);     // rounds to a paise
  assert.equal(grossFor('daily', 60000, 5, 31), 150000);              // 2.5 days
  assert.equal(daysInMonth('2026-02'), 28);
  assert.equal(daysInMonth('2028-02'), 29);
});

test('only the owner or software owner can reach payroll', async () => {
  for (const t of [staff, cust]) assert.equal((await h.get(`${P}/staff`, t)).status, 403);
  assert.equal((await h.get(`${P}/staff`)).status, 401);
  assert.equal((await h.get(`${P}/staff`, admin)).status, 400);      // super admin must pick a business
  const me = await h.get('/api/auth/me', owner);
  assert.equal((await h.get(`${P}/staff?ownerId=${me.body.user?.id ?? me.body.id}`, admin)).status, 200);
});

test('staff profiles: create, validate, update, deactivate; one owner never sees another', async () => {
  assert.equal((await h.post(`${P}/staff`, { name: 'X', payType: 'weekly', ratePaise: 1 }, owner)).status, 400);
  assert.equal((await h.post(`${P}/staff`, { name: 'X', payType: 'daily', ratePaise: 12.5 }, owner)).status, 400);
  const id = await person('Ravi', 'monthly', 2500000);
  await person('Meena', 'daily', 70000, owner2);
  assert.equal((await h.get(`${P}/staff`, owner)).body.items.length, 1);
  assert.equal((await h.patch(`${P}/staff/${id}`, { ratePaise: 2600000, role: 'Curator' }, owner2)).status, 404);
  const u = await h.patch(`${P}/staff/${id}`, { ratePaise: 2600000, role: 'Curator' }, owner);
  assert.equal(u.body.ratePaise, 2600000); assert.equal(u.body.role, 'Curator');
  const off = await h.patch(`${P}/staff/${id}`, { active: false }, owner);
  assert.equal(off.body.active, false); assert.ok(off.body.leftOn);
  assert.equal((await h.get(`${P}/staff?includeInactive=0`, owner)).body.items.length, 0);
});

test('attendance: set, change, clear, bounds by joining date, bulk', async () => {
  const m = prevMonth();
  const id = await person('Ravi', 'monthly', 3000000, owner, `${m}-10`);
  assert.equal((await h.put(`${P}/attendance`, { staffId: id, date: `${m}-05`, status: 'present' }, owner)).status, 400); // before joining
  assert.equal((await h.put(`${P}/attendance`, { staffId: id, date: `${m}-12`, status: 'maybe' }, owner)).status, 400);
  assert.equal((await h.put(`${P}/attendance`, { staffId: id, date: `${m}-12`, status: 'present' }, owner)).status, 200);
  assert.equal((await h.put(`${P}/attendance`, { staffId: id, date: `${m}-12`, status: 'half' }, owner)).status, 200);
  assert.equal((await h.put(`${P}/attendance`, { entries: [13, 14, 15].map((d) => ({ staffId: id, date: `${m}-${d}`, status: 'present' })) }, owner)).body.saved, 3);
  await h.put(`${P}/attendance`, { staffId: id, date: `${m}-15`, status: null }, owner);
  const sheet = (await h.get(`${P}/attendance?month=${m}`, owner)).body;
  const row = sheet.staff[0];
  assert.deepEqual(row.counts, { present: 2, half: 1, absent: 0, leave: 0 });
  assert.equal(row.marks['12'], 'half'); assert.equal(row.marks['15'], undefined);
  assert.equal(sheet.locked, false);
  assert.equal((await h.get(`${P}/attendance?month=2026-13`, owner)).status, 400);
});

test('run: net pay from attendance, advance, deduction, bonus; net never negative; unmarked days reported', async () => {
  const m = prevMonth(); const dim = daysInMonth(m);
  const sal = await person('Ravi', 'monthly', dim * 100000);   // Rs 1000 per day
  const day = await person('Meena', 'daily', 50000);           // Rs 500 per day
  const entries: any[] = [];
  for (let d = 1; d <= 10; d++) entries.push({ staffId: sal, date: `${m}-${String(d).padStart(2, '0')}`, status: 'present' });
  entries.push({ staffId: sal, date: `${m}-11`, status: 'half' }, { staffId: sal, date: `${m}-12`, status: 'leave' }, { staffId: sal, date: `${m}-13`, status: 'absent' });
  entries.push({ staffId: day, date: `${m}-01`, status: 'present' }, { staffId: day, date: `${m}-02`, status: 'half' }, { staffId: day, date: `${m}-03`, status: 'leave' });
  assert.equal((await h.put(`${P}/attendance`, { entries }, owner)).status, 200);
  assert.equal((await h.post(`${P}/adjustments`, { staffId: sal, kind: 'advance', amountPaise: 200000, givenOn: `${m}-05` }, owner)).status, 201);
  assert.equal((await h.post(`${P}/adjustments`, { staffId: sal, kind: 'deduction', amountPaise: 50000, month: m, note: 'Damaged kit' }, owner)).status, 201);
  assert.equal((await h.post(`${P}/adjustments`, { staffId: sal, kind: 'bonus', amountPaise: 100000, month: m }, owner)).status, 201);
  assert.equal((await h.post(`${P}/adjustments`, { staffId: day, kind: 'advance', amountPaise: 900000, month: m }, owner)).status, 201);
  assert.equal((await h.post(`${P}/adjustments`, { staffId: day, kind: 'tip', amountPaise: 1, month: m }, owner)).status, 400);
  assert.equal((await h.post(`${P}/adjustments`, { staffId: day, kind: 'bonus', amountPaise: 0, month: m }, owner)).status, 400);

  const run = (await h.get(`${P}/runs/${m}`, owner)).body;
  assert.equal(run.status, 'open');
  const a = run.lines.find((l: any) => l.staffId === sal), b = run.lines.find((l: any) => l.staffId === day);
  // 10 present + half + paid leave = 11.5 paid days at Rs 1000
  assert.equal(a.grossPaise, 1150000); assert.equal(a.netPaise, 1150000 + 100000 - 200000 - 50000);
  assert.equal(a.unmarked, dim - 13); assert.equal(a.paidDays, 11.5);
  // daily wage: 1.5 days, leave unpaid: Rs 750; advance bigger than pay -> net 0 and a shortfall
  assert.equal(b.grossPaise, 75000); assert.equal(b.netPaise, 0); assert.equal(b.shortfallPaise, 900000 - 75000);
  assert.equal(run.summary.netPaise, a.netPaise);
  assert.equal(run.summary.headcount, 2);
  assert.equal((await h.get(`${P}/adjustments?month=${m}`, owner)).body.items.length, 4);
});

test('finalise locks the month; reopen unlocks it unless a salary was paid', async () => {
  const m = prevMonth();
  const id = await person('Ravi', 'daily', 60000);
  await h.put(`${P}/attendance`, { entries: ['01', '02', '03'].map((d) => ({ staffId: id, date: `${m}-${d}`, status: 'present' })) }, owner);
  const adj = (await h.post(`${P}/adjustments`, { staffId: id, kind: 'advance', amountPaise: 30000, month: m }, owner)).body;

  const fin = await h.post(`${P}/runs/${m}/finalise`, {}, owner);
  assert.equal(fin.status, 200); assert.equal(fin.body.status, 'final'); assert.equal(fin.body.lines[0].netPaise, 150000);
  assert.equal((await h.post(`${P}/runs/${m}/finalise`, {}, owner)).status, 409);

  // locked: attendance, adjustments and removals are refused
  assert.equal((await h.put(`${P}/attendance`, { staffId: id, date: `${m}-04`, status: 'present' }, owner)).status, 409);
  assert.equal((await h.post(`${P}/adjustments`, { staffId: id, kind: 'bonus', amountPaise: 100, month: m }, owner)).status, 409);
  assert.equal((await h.del(`${P}/adjustments/${adj.id}`, owner)).status, 409);
  assert.equal((await h.get(`${P}/attendance?month=${m}`, owner)).body.locked, true);

  // later pay changes do not rewrite a finalised month
  await h.patch(`${P}/staff/${id}`, { ratePaise: 999999 }, owner);
  assert.equal((await h.get(`${P}/runs/${m}`, owner)).body.lines[0].netPaise, 150000);

  // pay it
  const lineId = fin.body.lines[0].id;
  assert.equal((await h.post(`${P}/runs/${m}/lines/${lineId}/pay`, { method: 'cheese' }, owner)).status, 400);
  assert.equal((await h.post(`${P}/runs/${m}/lines/${lineId}/pay`, {}, owner2)).status, 404);
  const paid = await h.post(`${P}/runs/${m}/lines/${lineId}/pay`, { paidOn: `${MONTH()}-01`, method: 'upi', reference: 'UTR123' }, owner);
  assert.equal(paid.status, 200); assert.equal(paid.body.paidMethod, 'upi'); assert.equal(paid.body.paidRef, 'UTR123');
  assert.equal((await h.post(`${P}/runs/${m}/lines/${lineId}/pay`, { method: 'cash' }, owner)).status, 409);
  const s = (await h.get(`${P}/summary?month=${m}`, owner)).body;
  assert.equal(s.paidPaise, 150000); assert.equal(s.outstandingPaise, 0); assert.equal(s.status, 'final');
  assert.equal((await h.post(`${P}/runs/${m}/reopen`, {}, owner)).status, 409);

  assert.equal((await h.del(`${P}/runs/${m}/lines/${lineId}/pay`, owner)).status, 200);
  assert.equal((await h.post(`${P}/runs/${m}/reopen`, {}, owner2)).status, 404);
  const re = await h.post(`${P}/runs/${m}/reopen`, {}, owner);
  assert.equal(re.body.status, 'open'); assert.equal(re.body.lines[0].netPaise, 3 * 999999 - 30000);
  assert.equal((await h.put(`${P}/attendance`, { staffId: id, date: `${m}-04`, status: 'present' }, owner)).status, 200);
  assert.equal((await h.get(`${P}/runs`, owner)).body.items.length, 0);
});

test('cannot finalise the current or a future month early, nor an empty month', async () => {
  assert.equal((await h.post(`${P}/runs/${prevMonth()}/finalise`, {}, owner)).status, 400); // nobody on the payroll
  await person('Ravi', 'daily', 60000);
  assert.equal((await h.post(`${P}/runs/2099-01/finalise`, {}, owner)).status, 400);
  assert.equal((await h.post(`${P}/runs/nope/finalise`, {}, owner)).status, 400);
});

test('payslip carries attendance, adjustments and payment; another owner gets 404', async () => {
  const m = prevMonth();
  const id = await person('Ravi', 'daily', 60000);
  await h.put(`${P}/attendance`, { entries: [{ staffId: id, date: `${m}-01`, status: 'present' }, { staffId: id, date: `${m}-02`, status: 'absent' }] }, owner);
  await h.post(`${P}/adjustments`, { staffId: id, kind: 'bonus', amountPaise: 5000, month: m, note: 'Match day' }, owner);
  const slip = (await h.get(`${P}/payslip?month=${m}&staffId=${id}`, owner)).body;
  assert.equal(slip.status, 'open'); assert.equal(slip.line.netPaise, 65000);
  assert.equal(slip.marks['01'], 'present'); assert.equal(slip.adjustments[0].note, 'Match day'); assert.ok(slip.employer);
  assert.equal((await h.get(`${P}/payslip?month=${m}&staffId=${id}`, owner2)).status, 404);
  await h.post(`${P}/runs/${m}/finalise`, {}, owner);
  assert.equal((await h.get(`${P}/payslip?month=${m}&staffId=${id}`, owner)).body.status, 'final');
});
