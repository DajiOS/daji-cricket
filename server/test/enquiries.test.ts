import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, dayFromNow, T0, DAY, type Harness, type GroundLite } from './helpers.ts';
import { many } from '../src/db.ts';
import { setAlertSender } from '../src/notifications.ts';

let h: Harness;
let g: GroundLite;
let cust: string;
let staff: string;

before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset();
  g = (await grounds(h))[0]!;
  cust = await h.login('customer');
  staff = await h.login('staff1');
});

const anon = (extra: Record<string, unknown> = {}) => ({ groundId: g.id, name: 'Corporate Events', phone: '9898989898', message: 'We would like the ground for a company tournament, 40 players.', players: 40, preferredDate: dayFromNow(20), ...extra });

test('anyone can send an enquiry without an account; it lands with the ground\'s owner', async () => {
  const r = await h.post('/api/enquiries', anon());
  assert.equal(r.status, 201);
  assert.equal(r.body.status, 'new');
  assert.equal(r.body.ownerId, (await grounds(h))[0]!.ownerId);
  assert.equal(r.body.customerId, null);
  const list = await h.get('/api/staff/enquiries', staff);
  assert.equal(list.body.total, 1);
});

test('a new enquiry is sent to the contact number on WhatsApp', async () => {
  const sent: { to: string; vars: string[] }[] = [];
  setAlertSender(async (to, vars) => { sent.push({ to, vars }); return true; });
  try {
    const r = await h.post('/api/enquiries', anon());
    assert.equal(r.status, 201);
    await new Promise((res) => setTimeout(res, 20));
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0]!.vars.slice(0, 2), ['Corporate Events', '9898989898']);
    assert.match(sent[0]!.vars[2]!, /company tournament/);
  } finally { setAlertSender(null); }
});

test('an enquiry is still saved when the WhatsApp alert fails', async () => {
  setAlertSender(async () => { throw new Error('down'); });
  try { assert.equal((await h.post('/api/enquiries', anon())).status, 201); } finally { setAlertSender(null); }
});

test('an enquiry needs a ground, a contact number and a message', async () => {
  const r = await h.post('/api/enquiries', { name: 'X', message: 'hi' });
  assert.equal(r.status, 400);
  const f = r.body.error.details.fields.map((x: any) => x.field).sort();
  assert.deepEqual(f, ['groundId', 'message', 'name', 'phone']);
});

test('a signed-in customer\'s enquiry is linked to their account and visible under /my/enquiries', async () => {
  const r = await h.post('/api/enquiries', { groundId: g.id, message: 'Can we get nets for the evening on weekdays?' }, cust);
  assert.equal(r.status, 201);
  assert.ok(r.body.customerId);
  const mine = await h.get('/api/my/enquiries', cust);
  assert.equal(mine.body.total, 1);
  assert.equal((await h.get('/api/my/enquiries', await h.login('admin'))).status, 403);
});

test('staff add notes, send a quotation, the customer accepts, staff convert it to a booking', async () => {
  const e = (await h.post('/api/enquiries', { groundId: g.id, message: 'Birthday match for 22 kids on a Saturday.', players: 22, preferredDate: dayFromNow(10) }, cust)).body;

  const n = await h.post(`/api/staff/enquiries/${e.id}/notes`, { body: 'Called, wants 3 hours.', kind: 'contact' }, staff);
  assert.equal(n.status, 200);
  assert.ok(n.body.notes.some((x: any) => x.kind === 'contact' && x.body === 'Called, wants 3 hours.'));
  assert.equal(n.body.status, 'follow_up', 'a contact note moves a new enquiry to follow-up');

  const q = await h.post(`/api/staff/enquiries/${e.id}/quotations`, { amountPaise: 500000, details: '3 hours, incl. floodlights', validUntil: T0 + 5 * DAY }, staff);
  assert.equal(q.status, 201);
  assert.equal(q.body.status, 'quoted');
  const qid = q.body.quotations[0].id;

  const acc = await h.post(`/api/my/enquiries/${e.id}/quotations/${qid}/respond`, { accept: true }, cust);
  assert.equal(acc.status, 200);
  assert.equal(acc.body.quotations[0].status, 'accepted');

  const date = dayFromNow(10);
  const conv = await h.post(`/api/staff/enquiries/${e.id}/convert`, { date, startTime: '15:00', slots: 3, quotationId: qid, payment: { method: 'upi', amountPaise: 250000, reference: '556677889900' } }, staff);
  assert.equal(conv.status, 201, JSON.stringify(conv.body));
  assert.equal(conv.body.status, 'converted');
  const booking = (await h.get(`/api/staff/bookings/${conv.body.bookingId}`, staff)).body.booking;
  assert.equal(booking.source, 'enquiry');
  assert.equal(booking.totalPaise, 500000, 'the quoted price is used, not the rate card');
  assert.equal(booking.status, 'confirmed');
  assert.equal(booking.customerId, e.customerId);
  assert.equal((await h.post(`/api/staff/enquiries/${e.id}/convert`, { date, startTime: '18:00', slots: 1, payment: { method: 'cash', amountPaise: 100 } }, staff)).status, 409, 'cannot convert twice');
});

test('a quotation can be declined, and a closed enquiry takes no more changes', async () => {
  const e = (await h.post('/api/enquiries', { groundId: g.id, message: 'Looking for a monthly package for our academy.' }, cust)).body;
  const q = (await h.post(`/api/staff/enquiries/${e.id}/quotations`, { amountPaise: 1_000_000 }, staff)).body;
  const dec = await h.post(`/api/my/enquiries/${e.id}/quotations/${q.quotations[0].id}/respond`, { accept: false }, cust);
  assert.equal(dec.body.quotations[0].status, 'declined');

  assert.equal((await h.post(`/api/staff/enquiries/${e.id}/close`, {}, staff)).status, 400, 'a reason is required');
  const closed = await h.post(`/api/staff/enquiries/${e.id}/close`, { reason: 'Customer found another ground' }, staff);
  assert.equal(closed.body.status, 'closed');
  assert.equal((await h.post(`/api/staff/enquiries/${e.id}/notes`, { body: 'too late' }, staff)).status, 409);
});

test('an expired quotation cannot be accepted', async () => {
  const e = (await h.post('/api/enquiries', { groundId: g.id, message: 'Need a quote for a one-day tournament.' }, cust)).body;
  const q = (await h.post(`/api/staff/enquiries/${e.id}/quotations`, { amountPaise: 300000, validUntil: T0 + DAY }, staff)).body;
  const { advance } = await import('./helpers.ts');
  advance(2 * DAY);
  const r = await h.post(`/api/my/enquiries/${e.id}/quotations/${q.quotations[0].id}/respond`, { accept: true }, await h.login('customer'));
  assert.equal(r.status, 409);
});

test('enquiries are private: another customer, and staff of another owner, get 404', async () => {
  const e = (await h.post('/api/enquiries', { groundId: g.id, message: 'Private question about pricing.' }, cust)).body;
  const { register } = await import('./register.ts');
  const other = await register(h, 'Nosy Parker', '9812345678');
  assert.equal((await h.get(`/api/my/enquiries/${e.id}`, other)).status, 404);
  assert.equal((await h.get(`/api/staff/enquiries/${e.id}`, await h.login('owner2'))).status, 404);
  assert.equal((await h.get(`/api/staff/enquiries/${e.id}`, staff)).status, 200);
});

test('staff without manage_enquiries cannot work enquiries', async () => {
  const owner = await h.login('owner1');
  const t = await h.post('/api/staff/team', { name: 'Gate Staff', email: 'gate@daji.test', phone: '9801010101', password: 'GateStaff@123', permissions: ['manage_bookings'] }, owner);
  assert.equal(t.status, 201, JSON.stringify(t.body));
  const gate = (await h.post('/api/auth/login', { email: 'gate@daji.test', password: 'GateStaff@123' })).body.token;
  await h.post('/api/enquiries', anon());
  assert.equal((await h.get('/api/staff/enquiries', gate)).status, 403);
});

test('enquiry history is written as notes and the audit log', async () => {
  const e = (await h.post('/api/enquiries', anon())).body;
  await h.post(`/api/staff/enquiries/${e.id}/quotations`, { amountPaise: 400000 }, staff);
  const detail = (await h.get(`/api/staff/enquiries/${e.id}`, staff)).body;
  assert.ok(detail.notes.some((n: any) => n.kind === 'status'));
  assert.ok(many("SELECT 1 FROM audit_log WHERE entity = 'enquiry' AND entity_id = ?", e.id).length >= 1);
});
