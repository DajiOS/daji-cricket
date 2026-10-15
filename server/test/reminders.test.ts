import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, hold, dayFromNow, setting, type Harness, type GroundLite } from './helpers.ts';
import { run, one } from '../src/db.ts';
import { renderTemplate, waLink } from '../src/reminders.ts';

let h: Harness; let g: GroundLite; let owner: string, owner2: string, cust: string, staff: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset(); setting({ razorpayEnabled: false });
  g = (await grounds(h))[0]!; owner = await h.login('owner1'); owner2 = await h.login('owner2'); cust = await h.login('customer'); staff = await h.login('staff1');
});

async function confirmed(day: number, paid = 0): Promise<string> {
  const r = await hold(h, cust, g.id, dayFromNow(day), '19:00');
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = r.body.booking.id;
  run("UPDATE bookings SET status = 'confirmed', paid_paise = ? WHERE id = ?", paid, id);
  return id;
}

test('placeholders fill in and links are built from the number', () => {
  assert.equal(renderTemplate('Hi {name}, {date} {time} {amount}', { name: 'Ravi', date: 'Fri 16 Oct', time: '7:00 pm', amount: '₹500' }), 'Hi Ravi, Fri 16 Oct 7:00 pm ₹500');
  assert.equal(waLink('98765 43210', 'hi there'), 'https://wa.me/919876543210?text=hi%20there');
  assert.equal(waLink(null, 'x'), null);
});

test('the queue lists tomorrow bookings and unpaid balances with wa.me links', async () => {
  const tom = await confirmed(1, 0); const later = await confirmed(5, 0);
  one('SELECT 1');
  run("UPDATE users SET phone = '9876543210' WHERE role = 'customer'");
  const q = await h.get('/api/desk/reminders/queue', owner);
  assert.equal(q.status, 200, JSON.stringify(q.body));
  const b = q.body.items.filter((i: any) => i.kind === 'booking');
  assert.deepEqual(b.map((i: any) => i.key), [tom]);
  assert.match(b[0].link, /^https:\/\/wa\.me\/919876543210\?text=/);
  assert.ok(!b[0].message.includes('{'));
  const p = q.body.items.filter((i: any) => i.kind === 'payment').map((i: any) => i.key);
  assert.ok(p.includes(tom) && p.includes(later));
});

test('mark sent logs once, hides the booking from pending and shows in history', async () => {
  const id = await confirmed(1);
  const s = await h.post('/api/desk/reminders/sent', { kind: 'booking', key: id }, owner);
  assert.equal(s.status, 201, JSON.stringify(s.body));
  const q = await h.get('/api/desk/reminders/queue', owner);
  assert.ok(q.body.items.find((i: any) => i.kind === 'booking' && i.key === id).sentAt);
  const hs = await h.get('/api/desk/reminders/history', owner);
  assert.equal(hs.body.items.length, 1);
  assert.equal(hs.body.items[0].kind, 'booking');
  assert.equal((await h.post('/api/desk/reminders/sent', { kind: 'booking', key: 'nope' }, owner)).status, 404);
});

test('templates are editable per owner and can be reset', async () => {
  const id = await confirmed(1);
  const put = await h.put('/api/desk/reminders/templates/booking', { body: 'Namaste {name}, {date}' }, owner);
  assert.equal(put.status, 200, JSON.stringify(put.body));
  let q = await h.get('/api/desk/reminders/queue', owner);
  assert.match(q.body.items.find((i: any) => i.key === id && i.kind === 'booking').message, /^Namaste /);
  const t = await h.get('/api/desk/reminders/templates', owner2);
  assert.equal(t.body.items.find((x: any) => x.kind === 'booking').custom, false);
  assert.equal((await h.put('/api/desk/reminders/templates/booking', { reset: true }, owner)).status, 200);
  q = await h.get('/api/desk/reminders/queue', owner);
  assert.match(q.body.items.find((i: any) => i.key === id && i.kind === 'booking').message, /^Hi /);
  assert.equal((await h.put('/api/desk/reminders/templates/bogus', { body: 'x' }, owner)).status, 400);
});

test('manual fixture message: preview then log', async () => {
  const p = await h.post('/api/desk/reminders/preview', { kind: 'fixture', name: 'Team A', phone: '9000000001', date: 'Sat 17 Oct', time: '9:00 am' }, owner);
  assert.equal(p.status, 200);
  assert.match(p.body.message, /Team A/); assert.ok(p.body.link);
  assert.equal((await h.post('/api/desk/reminders/sent', { kind: 'fixture', name: 'Team A', phone: '9000000001', message: p.body.message }, owner)).status, 201);
  assert.equal((await h.post('/api/desk/reminders/sent', { kind: 'fixture' }, owner)).status, 400);
});

test('needs send_broadcasts, customers are refused, other owners see nothing', async () => {
  const id = await confirmed(1);
  await h.post('/api/desk/reminders/sent', { kind: 'booking', key: id }, owner);
  assert.equal((await h.get('/api/desk/reminders/queue', cust)).status, 403);
  const hs2 = await h.get('/api/desk/reminders/history', owner2);
  assert.equal(hs2.body.items.length, 0);
  assert.equal((await h.get('/api/desk/reminders/queue')).status, 401);
  const sq = await h.get('/api/desk/reminders/queue', staff);
  assert.ok([200, 403].includes(sq.status));
});

test('memberships ending in 7 days appear in the queue', async () => {
  const { db } = await import('../src/db.ts');
  const oid = one<{ id: string }>("SELECT id FROM users WHERE email = 'owner1@daji.test'")!.id;
  const { istDate, addDays } = await import('../src/time.ts'); const { now } = await import('../src/clock.ts');
  const t = istDate(now());
  const pl = 'pl_rem_test';
  run('INSERT INTO membership_plans (id, owner_id, name, price_paise, duration_days, active, created_at, updated_at) VALUES(?,?,?,?,?,1,?,?)', pl, oid, 'Test', 100000, 30, now(), now());
  const ins = (id: string, ph: string, end: string) => run('INSERT INTO memberships (id, owner_id, plan_id, name, phone, start_date, end_date, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)', id, oid, pl, 'Member ' + id, ph, t, end, now(), now());
  ins('m1', '9000000001', addDays(t, 3)); ins('m2', '9000000002', addDays(t, 20));
  const q = await h.get('/api/desk/reminders/queue', owner);
  assert.equal(q.body.membershipsAvailable, true);
  assert.deepEqual(q.body.items.filter((i: any) => i.kind === 'membership').map((i: any) => i.key), ['m1']);
  void db;
});
