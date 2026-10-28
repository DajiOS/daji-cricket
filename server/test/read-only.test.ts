import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, DEMO_ACCOUNTS, type Harness } from './helpers.ts';
import { buildRouter } from '../src/app.ts';
import { db, one } from '../src/db.ts';
import { READ_ONLY_MESSAGE, STILL_OPEN } from '../src/readOnly.ts';

// "Read only" on the Team page (the Apple review login): the member sees their role's screens, every change is refused by the server.

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); });

const staffId = async (owner: string): Promise<string> => (await h.get('/api/staff/team', owner)).body.items.find((m: any) => m.email === DEMO_ACCOUNTS.staff1.email).id;
async function readOnlyStaff(): Promise<{ owner: string; staff: string; id: string }> {
  const owner = await h.login('owner1'), staff = await h.login('staff1');
  const id = await staffId(owner);
  const r = await h.patch(`/api/staff/team/${id}`, { readOnly: true }, owner);
  assert.equal(r.status, 200);
  assert.equal(r.body.readOnly, true);
  return { owner, staff, id };
}
const pat = (r: { re: RegExp }) => r.re.source.replace(/^\^/, '').replace(/\\\/\?\$$/, '').replace(/\/\?\$$/, '').replace(/\\\//g, '/').replace(/\(\[\^\/\]\+\)/g, ':p');

test('RO-001 the owner ticks Read only; the member stays signed in and is told so', async () => {
  const { owner, staff, id } = await readOnlyStaff();
  const me = await h.get('/api/me', staff);
  assert.equal(me.status, 200, 'ticking Read only does not sign them out');
  assert.equal((me.body.user ?? me.body).readOnly, true);
  assert.equal((await h.get('/api/staff/team', owner)).body.items.find((m: any) => m.id === id).readOnly, true);
  const a = one<{ detail: string }>("SELECT detail FROM audit_log WHERE action = 'staff.update' AND entity_id = ? ORDER BY id DESC LIMIT 1", id)!;
  assert.equal(JSON.parse(a.detail).readOnly, true, 'the change is in the audit trail');
  // other members, owners and admins are never read only
  assert.equal((await h.get('/api/me', owner)).body.user?.readOnly ?? (await h.get('/api/me', owner)).body.readOnly, false);
});

test('RO-002 a read-only member can still look at everything their role opens', async () => {
  const { staff } = await readOnlyStaff();
  const g = (await h.get('/api/grounds')).body.items[0];
  const list = await h.get('/api/staff/bookings', staff);
  assert.equal(list.status, 200);
  for (const p of ['/api/me', '/api/staff/bookings?upcoming=1', '/api/staff/enquiries', `/api/grounds/${g.id}/availability?date=2026-11-02`, '/api/staff/ask/examples', '/api/staff/ask/history']) {
    const r = await h.get(p, staff);
    assert.equal(r.status, 200, `${p} -> ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  }
});

test('RO-003 every change a team member could send is refused with READ_ONLY, and nothing in the database changes', async () => {
  const { staff } = await readOnlyStaff();
  const router = buildRouter();
  const staffWrites = router.routes.filter((r) => r.method !== 'GET' && r.method !== 'HEAD' && r.opts.auth !== undefined && (r.opts.auth === 'user' || r.opts.auth.includes('staff')));
  const open = staffWrites.filter((r) => r.method === 'POST' && STILL_OPEN.some((re) => re.test(pat(r).replace(/:p/g, 'x'))));
  // the requests still allowed are exactly the reviewed list: a new one fails this test until it is reviewed
  assert.deepEqual(open.map((r) => `${r.method} ${pat(r)}`).sort(), [
    'POST /api/ai-name/check', 'POST /api/availability/options', 'POST /api/cameras/view-token', 'POST /api/desk/reminders/preview', 'POST /api/guppi/options',
    'POST /api/legal/staff-terms/accept', 'POST /api/me/push-token', 'POST /api/me/push-token/remove', 'POST /api/staff/ask', 'POST /api/staff/bookings/:p/reschedule-preview', 'POST /api/staff/broadcasts/preview',
    'POST /api/accounting/attachment-counts', 'POST /api/auth/logout-all',
  ].sort());
  const changesBefore = Number((db().prepare('SELECT total_changes() n').get() as { n: number }).n);
  const failures: string[] = [];
  let refused = 0;
  for (const r of staffWrites) {
    if (open.includes(r)) continue;
    const path = pat(r).replace(/:p/g, 'x');
    const res = await h.call(r.method, path, { token: staff, body: {}, headers: { 'idempotency-key': `ro-${refused}` } });
    if (res.status !== 403 || res.body?.error?.code !== 'READ_ONLY' || res.body?.error?.message !== READ_ONLY_MESSAGE) failures.push(`${r.method} ${path} -> ${res.status} ${res.body?.error?.code}`);
    else refused++;
  }
  assert.deepEqual(failures, []);
  assert.ok(refused > 150, `refused ${refused} write routes`);
  const changesAfter = Number((db().prepare('SELECT total_changes() n').get() as { n: number }).n);
  assert.equal(changesAfter, changesBefore, 'not one row was written by the refused requests');
  console.log(JSON.stringify({ evidence: 'RO-003', staffWriteRoutes: staffWrites.length, refused, stillOpen: open.length }));
});

test('RO-004 real changes with real data are refused: a walk-in booking, cancelling, recording a payment, a task, the own profile', async () => {
  const { staff, owner } = await readOnlyStaff();
  const g = (await h.get('/api/grounds')).body.items[0];
  const walk = await h.post('/api/staff/bookings', { groundId: g.id, date: '2026-11-03', startTime: '08:00', slots: 1, customer: { name: 'Apple Review', phone: '9800000099' }, payment: { method: 'cash', amountPaise: 180000 } }, staff);
  assert.equal(walk.status, 403); assert.equal(walk.body.error.code, 'READ_ONLY'); assert.equal(walk.body.error.message, READ_ONLY_MESSAGE);
  // a real booking made by the owner cannot be cancelled or paid by the read-only member
  const made = await h.post('/api/staff/bookings', { groundId: g.id, date: '2026-11-03', startTime: '10:00', slots: 1, customer: { name: 'Real Customer', phone: '9800000098' }, payment: { method: 'cash', amountPaise: 90000 } }, owner);
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const bid = made.body.booking.id;
  for (const [m, p, b] of [['POST', `/api/staff/bookings/${bid}/cancel`, { reason: 'test' }], ['POST', `/api/staff/bookings/${bid}/payments`, { method: 'cash', amountPaise: 1000 }], ['PATCH', '/api/me', { name: 'Changed Name' }], ['POST', '/api/me/password', { currentPassword: DEMO_ACCOUNTS.staff1.password, newPassword: 'Another@12345' }]] as const) {
    const r = await h.call(m, p, { token: staff, body: b });
    assert.equal(r.status, 403, `${m} ${p}`); assert.equal(r.body.error.code, 'READ_ONLY');
  }
  const after = (await h.get(`/api/staff/bookings/${bid}`, staff)).body.booking;
  assert.notEqual(after.status, 'cancelled');
  assert.equal(after.paidPaise, made.body.booking.paidPaise, 'no payment was added');
  assert.equal((await h.get('/api/me', staff)).body.user?.name ?? (await h.get('/api/me', staff)).body.name, 'Ground Staff');
  // the password was not changed: the old one still signs in
  assert.ok(await h.login('staff1'));
});

test('RO-005 signing out, this phone\'s notifications, the team terms and questions to the assistant still work', async () => {
  const { staff } = await readOnlyStaff();
  const push = await h.post('/api/me/push-token', { token: 'ExponentPushToken[readonly-test]', platform: 'ios' }, staff);
  assert.notEqual(push.body?.error?.code, 'READ_ONLY');
  const q = await h.post('/api/staff/ask', { question: 'Am I view only?' }, staff);
  assert.equal(q.status, 200);
  assert.match(q.body.answer, /view-only/);
  assert.match(q.body.answer, /changes are switched off/);
  const out = await h.post('/api/auth/logout', {}, staff);
  assert.equal(out.status, 200);
  assert.equal((await h.get('/api/me', staff)).status, 401);
});

test('RO-006 the owner can ask who is view-only; Ask AI reads the same switch', async () => {
  const { owner } = await readOnlyStaff();
  const q = await h.post('/api/staff/ask', { question: 'Who on the team is read only?' }, owner);
  assert.equal(q.status, 200);
  assert.match(q.body.answer, /1 team member is view-only/);
  assert.equal(q.body.details[0].label, 'Ground Staff');
});

test('RO-007 unticking Read only gives the member their changes back; the switch is owner-only', async () => {
  const { owner, staff, id } = await readOnlyStaff();
  // a team member cannot clear it for themselves (or anyone)
  const self = await h.patch(`/api/staff/team/${id}`, { readOnly: false }, staff);
  assert.equal(self.status, 403);
  assert.equal((await h.patch(`/api/staff/team/${id}`, { readOnly: false }, owner)).body.readOnly, false);
  const g = (await h.get('/api/grounds')).body.items[0];
  const walk = await h.post('/api/staff/bookings', { groundId: g.id, date: '2026-11-04', startTime: '08:00', slots: 1, customer: { name: 'Walk In', phone: '9800000097' }, payment: { method: 'cash', amountPaise: 180000 } }, staff);
  assert.equal(walk.status, 201, JSON.stringify(walk.body));
  // another business's owner cannot touch this member
  const other = await h.login('owner2');
  assert.equal((await h.patch(`/api/staff/team/${id}`, { readOnly: true }, other)).status, 404);
});

test('RO-008 a member can be added already read-only; bad values are refused', async () => {
  const owner = await h.login('owner1');
  const add = await h.post('/api/staff/team', { name: 'Apple Review', email: 'review@daji.test', password: 'Review@12345', preset: 'admin', readOnly: true }, owner);
  assert.equal(add.status, 201, JSON.stringify(add.body));
  assert.equal(add.body.readOnly, true);
  const tok = (await h.post('/api/auth/login', { email: 'review@daji.test', password: 'Review@12345' })).body.token;
  assert.equal((await h.get('/api/staff/bookings', tok)).status, 200, 'the Admin role still opens bookings');
  assert.equal((await h.post('/api/staff/bookings', {}, tok)).body.error.code, 'READ_ONLY');
  assert.equal((await h.patch(`/api/staff/team/${add.body.id}`, { readOnly: 'yes' }, owner)).status, 400);
  const plain = await h.post('/api/staff/team', { name: 'Normal Member', email: 'normal@daji.test', password: 'Normal@12345', preset: 'admin' }, owner);
  assert.equal(plain.body.readOnly, false, 'off unless ticked');
});
