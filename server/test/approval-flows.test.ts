import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, dayFromNow, DEMO_ACCOUNTS, type Harness } from './helpers.ts';
import { run } from '../src/db.ts';
import { istDate, addDays } from '../src/time.ts';
import { now } from '../src/clock.ts';

let h: Harness; let owner: string, staff: string, staff2: string, staff2Id: string, cust: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset();
  owner = await h.login('owner1'); staff = await h.login('staff1'); cust = await h.login('customer');
  run('UPDATE users SET permissions = ? WHERE email = ?', JSON.stringify(['manage_accounting', 'view_revenue', 'view_reports']), DEMO_ACCOUNTS.staff1.email);
  const r = await h.post('/api/staff/team', { name: 'Second Clerk', email: 'clerk2@daji.test', password: 'Clerk2@12345', permissions: ['manage_accounting', 'view_revenue'] }, owner);
  assert.equal(r.status, 201, JSON.stringify(r.body)); staff2Id = r.body.id;
  staff2 = (await h.post('/api/auth/login', { email: 'clerk2@daji.test', password: 'Clerk2@12345' })).body.token;
});

const F = '/api/accounting/approvals/flows';
const R = '/api/accounting/approvals/requests';
const anyone = (label: string, overPaise: number | null = null) => ({ label, who: { type: 'anyone' }, overPaise });
async function setFlow(kind: string, body: Record<string, unknown>) {
  const r = await h.put(`${F}/${kind}`, { notSelf: true, distinct: false, sendBack: 'start', ...body }, owner);
  assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body;
}
async function bill(amountPaise: number, token = staff, billNo = `INV-${amountPaise}`): Promise<string> {
  const v = await h.post('/api/accounting/vendors', { name: `Vendor ${billNo}` }, owner);
  const b = await h.post('/api/accounting/bills', { vendorId: v.body.id, billNo, billDate: dayFromNow(-2), dueDate: dayFromNow(5), amountPaise }, token);
  assert.equal(b.status, 201, JSON.stringify(b.body));
  const s = await h.post(`/api/accounting/bills/${b.body.id}/submit`, {}, token);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  return b.body.id;
}
const status = async (id: string) => (await h.get(`/api/accounting/bills/${id}`, owner)).body.bill.status;
const open = async (token = owner) => (await h.get(R, token)).body.items as any[];

test('out of the box: bills need one sign-off from someone else, pay runs need none; only the owner edits the rules', async () => {
  const d = await h.get(F, owner);
  assert.equal(d.status, 200, JSON.stringify(d.body));
  const bills = d.body.kinds.find((k: any) => k.kind === 'bill'), pay = d.body.kinds.find((k: any) => k.kind === 'payroll');
  assert.equal(bills.flow.steps.length, 1); assert.equal(bills.flow.notSelf, true); assert.equal(bills.custom, false);
  assert.equal(pay.flow.steps.length, 0);
  assert.ok(d.body.people.some((p: any) => p.name === 'Second Clerk'));
  assert.ok(d.body.roles.some((r: any) => r.key === 'accountant'));
  assert.equal((await h.get(F, staff)).status, 403);
  assert.equal((await h.put(`${F}/bill`, { steps: [] }, staff)).status, 403);
  assert.equal((await h.get(R, cust)).status, 403);
  assert.equal((await h.put(`${F}/nope`, { steps: [] }, owner)).status, 404);
});

test('the rules are checked: who signs, a team member who can do the work, amounts in whole paise, six steps at most', async () => {
  const bad = async (steps: unknown) => (await h.put(`${F}/bill`, { steps }, owner)).status;
  assert.equal(await bad([{ label: 'X', who: { type: 'boss' } }]), 400);
  assert.equal(await bad([{ label: '', who: { type: 'owner' } }]), 400);
  assert.equal(await bad([{ label: 'X', who: { type: 'role', value: 'pilot' } }]), 400);
  assert.equal(await bad([{ label: 'X', who: { type: 'person', value: 'usr_nobody' } }]), 400);
  assert.equal(await bad([{ label: 'X', who: { type: 'owner' }, overPaise: 12.5 }]), 400);
  assert.equal(await bad(Array.from({ length: 7 }, (_, i) => anyone(`S${i}`))), 400);
  run('UPDATE users SET permissions = ? WHERE id = ?', JSON.stringify(['manage_bookings']), staff2Id);
  assert.equal(await bad([{ label: 'X', who: { type: 'person', value: staff2Id } }]), 400, 'cannot manage the books');
});

test('an amount over the line adds the owner step; each sign-off and the approval are in the bill trail', async () => {
  await setFlow('bill', { steps: [anyone('Manager check'), { label: 'Owner sign-off', who: { type: 'owner' }, overPaise: 1000000 }] });
  const small = await bill(500000);
  assert.equal((await open()).find((x) => x.entityId === small).steps.length, 1);
  assert.equal((await h.post(`/api/accounting/bills/${small}/approve`, {}, staff2)).body.status, 'approved');

  const big = await bill(1250000);
  assert.equal((await h.post(`/api/accounting/bills/${big}/approve`, {}, staff)).status, 403, 'the person who entered it cannot sign');
  const first = await h.post(`/api/accounting/bills/${big}/approve`, { note: 'Checked the invoice' }, staff2);
  assert.equal(first.status, 200, JSON.stringify(first.body)); assert.equal(first.body.status, 'pending_approval');
  const req = (await open(staff2)).find((x) => x.entityId === big);
  assert.equal(req.atStep, 1); assert.equal(req.steps[0].state, 'done'); assert.equal(req.steps[0].signedByName, 'Second Clerk');
  assert.equal(req.steps[1].who, 'The owner'); assert.equal(req.canSign, false); assert.equal(req.whyNot, 'This step is for the owner');
  assert.equal((await h.post(`${R}/${req.id}/approve`, {}, staff2)).status, 403);
  const done = await h.post(`${R}/${req.id}/approve`, {}, owner);
  assert.equal(done.status, 200, JSON.stringify(done.body)); assert.equal(done.body.status, 'approved');
  assert.equal(await status(big), 'approved');
  const ev = (await h.get(`/api/accounting/bills/${big}`, owner)).body.events.map((e: any) => e.action);
  assert.deepEqual(ev, ['bill.create', 'bill.submit', 'bill.signoff', 'bill.approve']);
  assert.equal((await h.post(`${R}/${req.id}/approve`, {}, owner)).status, 409, 'not waiting any more');
});

test('send back one step, a different person for each step, and back to the start from the first step', async () => {
  await setFlow('bill', { steps: [anyone('First check'), anyone('Second check')], distinct: true, sendBack: 'previous' });
  const id = await bill(300000, owner);
  assert.equal((await h.post(`/api/accounting/bills/${id}/approve`, {}, staff2)).body.status, 'pending_approval');
  const r1 = (await open()).find((x) => x.entityId === id);
  assert.equal((await h.post(`${R}/${r1.id}/approve`, {}, staff2)).status, 403, 'signed the step before');
  assert.equal((await h.post(`${R}/${r1.id}/send-back`, {}, staff)).status, 400, 'a note is needed');
  const back = await h.post(`${R}/${r1.id}/send-back`, { note: 'Wrong GST rate' }, staff);
  assert.equal(back.status, 200, JSON.stringify(back.body)); assert.equal(back.body.atStep, 0); assert.equal(back.body.steps[0].state, 'now');
  assert.equal(await status(id), 'pending_approval');
  const again = await h.post(`/api/accounting/bills/${id}/reject`, { reason: 'Still wrong' }, staff);
  assert.equal(again.body.status, 'rejected');
  const ev = (await h.get(`/api/accounting/bills/${id}`, owner)).body.events.map((e: any) => e.action);
  assert.deepEqual(ev, ['bill.create', 'bill.submit', 'bill.signoff', 'bill.sendback', 'bill.reject']);
  // fixed and sent again: a fresh round from the first step
  await h.post(`/api/accounting/bills/${id}/submit`, {}, owner);
  const r2 = (await open()).find((x) => x.entityId === id);
  assert.equal(r2.round, 2); assert.equal(r2.atStep, 0);
});

test('a named person or a role signs; the owner can sign any step', async () => {
  await setFlow('bill', { steps: [{ label: 'Clerk two', who: { type: 'person', value: staff2Id } }, { label: 'Accountant', who: { type: 'role', value: 'accountant' } }], notSelf: false });
  const id = await bill(200000, owner);
  const r = (await open(staff)).find((x) => x.entityId === id);
  assert.equal(r.whyNot, 'This step is for Second Clerk');
  assert.equal((await h.post(`${R}/${r.id}/approve`, {}, staff)).status, 403);
  assert.equal((await h.post(`${R}/${r.id}/approve`, {}, staff2)).status, 200);
  assert.equal((await h.post(`${R}/${r.id}/approve`, {}, staff2)).status, 403, 'clerk two lacks the accountant rights');
  assert.equal((await h.post(`${R}/${r.id}/approve`, {}, staff)).status, 200, 'staff1 has every accountant right');
  assert.equal(await status(id), 'approved');
  const id2 = await bill(200000, staff, 'INV-B');
  const r2 = (await open()).find((x) => x.entityId === id2);
  await h.post(`${R}/${r2.id}/approve`, {}, owner); await h.post(`${R}/${r2.id}/approve`, {}, owner);
  assert.equal(await status(id2), 'approved');
});

test('changing the rules leaves anything already waiting on its old steps; no step means approved on sending', async () => {
  const id = await bill(400000);
  await setFlow('bill', { steps: [anyone('One'), anyone('Two')] });
  assert.equal((await h.post(`/api/accounting/bills/${id}/approve`, {}, staff2)).body.status, 'approved');
  await setFlow('bill', { steps: [anyone('Only big', 5000000)] });
  const small = await bill(10000);
  assert.equal(await status(small), 'approved');
  const d = await h.get(F, owner);
  assert.equal(d.body.changes.length, 2); assert.ok(d.body.changes[0].actorName);
  assert.equal((await h.post(`${F}/bill/reset`, {}, owner)).body.custom, false);
  assert.equal((await h.get(F, owner)).body.changes.length, 3);
});

test('a bill waiting from before the rules existed gets today\'s steps when someone acts on it', async () => {
  const id = await bill(400000);
  run("UPDATE approval_requests SET status = 'withdrawn'");
  await setFlow('bill', { steps: [anyone('One'), anyone('Two')] });
  assert.equal((await h.post(`/api/accounting/bills/${id}/approve`, {}, staff2)).body.status, 'pending_approval');
  assert.equal((await h.post(`/api/accounting/bills/${id}/approve`, {}, owner)).body.status, 'approved');
});

const P = '/api/accounting/payroll';
const prevMonth = () => addDays(`${istDate(now()).slice(0, 7)}-01`, -1).slice(0, 7);
async function payMonth(m: string) {
  const r = await h.post(`${P}/staff`, { name: 'Ravi', role: 'Groundsman', payType: 'daily', ratePaise: 60000, joinedOn: '2020-01-01' }, owner);
  await h.put(`${P}/attendance`, { entries: ['01', '02'].map((d) => ({ staffId: r.body.id, date: `${m}-${d}`, status: 'present' })) }, owner);
  return r.body.id as string;
}

test('a pay run with a sign-off step waits on the board and is locked by the last sign-off', async () => {
  const m = prevMonth();
  const sid = await payMonth(m);
  await setFlow('payroll', { steps: [{ label: 'Accountant checks the pay', who: { type: 'role', value: 'accountant' } }], notSelf: false });
  const fin = await h.post(`${P}/runs/${m}/finalise`, {}, owner);
  assert.equal(fin.status, 200, JSON.stringify(fin.body)); assert.equal(fin.body.status, 'waiting'); assert.equal(fin.body.locked, false);
  assert.equal((await h.post(`${P}/runs/${m}/finalise`, {}, owner)).status, 409);
  const r = (await open(staff)).find((x) => x.kind === 'payroll');
  assert.equal(r.amountPaise, 120000); assert.equal(r.canSign, true);
  assert.equal((await open(staff2)).find((x) => x.kind === 'payroll').canSign, false);

  // figures changed after sending: the sign-off is refused and nothing moves
  await h.put(`${P}/attendance`, { entries: [{ staffId: sid, date: `${m}-03`, status: 'present' }] }, owner);
  assert.equal((await h.post(`${R}/${r.id}/approve`, {}, staff)).status, 409);
  assert.equal((await h.get(`${P}/runs/${m}`, owner)).body.status, 'waiting');
  const sb = await h.post(`${R}/${r.id}/send-back`, { note: 'Ravi worked the 3rd too' }, staff);
  assert.equal(sb.status, 200); assert.equal(sb.body.status, 'sent_back');
  assert.equal((await h.get(`${P}/runs/${m}`, owner)).body.status, 'open');

  await h.post(`${P}/runs/${m}/finalise`, {}, owner);
  const r2 = (await open(staff)).find((x) => x.kind === 'payroll');
  assert.equal(r2.amountPaise, 180000);
  const ok = await h.post(`${R}/${r2.id}/approve`, { note: 'Matches the register' }, staff);
  assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(ok.body.status, 'approved');
  const runNow = (await h.get(`${P}/runs/${m}`, owner)).body;
  assert.equal(runNow.status, 'final'); assert.equal(runNow.summary.netPaise, 180000);
  assert.deepEqual(ok.body.trail.map((e: any) => e.action), ['submit', 'sendback', 'submit', 'approve']);
});

test('the owner can take a pay run back off the board; with no step it locks straight away as before', async () => {
  const m = prevMonth();
  await payMonth(m);
  await setFlow('payroll', { steps: [anyone('Books check')] });
  assert.equal((await h.post(`${P}/runs/${m}/finalise`, {}, owner)).body.status, 'waiting');
  assert.equal((await h.post(`${P}/runs/${m}/withdraw`, {}, owner)).body.status, 'open');
  assert.equal((await open()).length, 0);
  await h.post(`${F}/payroll/reset`, {}, owner);
  assert.equal((await h.post(`${P}/runs/${m}/finalise`, {}, owner)).body.status, 'final');
});
