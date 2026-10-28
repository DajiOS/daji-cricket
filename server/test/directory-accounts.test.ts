// Customers › Directory shows everyone who made an account, booked or not, while the platform has one business. With more than one,
// an account becomes a business's customer only by booking there, so one business never sees another's sign-ups.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, bookAndPay, dayFromNow, type Harness } from './helpers.ts';
import { register } from './register.ts';
import { run } from '../src/db.ts';

let h: Harness, owner: string, owner2: string, staff: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => { h.reset(); owner = await h.login('owner1'); owner2 = await h.login('owner2'); staff = await h.login('staff1'); });

const list = async (token: string, q = '') => (await h.get(`/api/staff/contacts?who=account${q}`, token)).body;
const idOf = async (token: string) => (await h.get('/api/me', token)).body.user.id as string;
const onlyDaji = () => run("UPDATE users SET active = 0 WHERE email = 'owner2@daji.test'");

test('with one business, a new account shows in the Directory at once, before it books, and its page opens', async () => {
  onlyDaji();
  const t = await register(h, 'Apple Reviewer', '9811100001');
  const id = await idOf(t);
  const r = await list(owner);
  const row = r.items.find((x: any) => x.id === id);
  assert.ok(row, 'the sign-up is listed');
  assert.equal(row.timesPlayed, 0); assert.equal(row.firstPlayedAt, null); assert.equal(row.lastPlayedAt, null);
  assert.equal(typeof row.signedUpAt, 'number');
  assert.ok(r.summary.total >= 1);
  assert.ok((await list(staff)).items.some((x: any) => x.id === id), 'a team member with view_customers sees it too');
  assert.ok((await list(owner, '&q=Apple')).items.some((x: any) => x.id === id), 'search finds it');
  // the booking views stay as they were
  assert.ok(!(await h.get('/api/staff/contacts?who=all', owner)).body.items.some((x: any) => x.id === id));
  // the customer page opens with no bookings, and the owner can correct the sign-in details
  const d = await h.get(`/api/staff/customers/${id}`, owner);
  assert.equal(d.status, 200, JSON.stringify(d.body)); assert.deepEqual(d.body.bookings, []);
  const e = await h.patch(`/api/staff/customers/${id}`, { email: 'reviewer@daji.test' }, owner);
  assert.equal(e.status, 200, JSON.stringify(e.body)); assert.equal(e.body.customer.email, 'reviewer@daji.test');
  // a booking-only filter (ground, dates, times) leaves out people who have not booked
  const g = (await grounds(h))[0]!;
  assert.ok(!(await list(owner, `&groundId=${g.id}`)).items.some((x: any) => x.id === id));
});

test('after a first booking the person is listed with it, once', async () => {
  onlyDaji();
  const t = await register(h, 'New Player', '9811100002');
  const id = await idOf(t);
  const g = (await grounds(h)).find((x) => x.name === 'Cricket Ground')!;
  await bookAndPay(h, t, g.id, dayFromNow(4), '10:00', 1);
  const rows = (await list(owner)).items.filter((x: any) => x.id === id);
  assert.equal(rows.length, 1); assert.equal(rows[0].timesPlayed, 1); assert.equal(typeof rows[0].lastPlayedAt, 'number');
});

test('with two businesses, a sign-up with no booking belongs to neither: no list, no page, no edit', async () => {
  const t = await register(h, 'Not Yours', '9811100003');
  const id = await idOf(t);
  for (const tok of [owner, owner2]) {
    assert.ok(!(await list(tok)).items.some((x: any) => x.id === id));
    assert.equal((await h.get(`/api/staff/customers/${id}`, tok)).status, 404);
    assert.equal((await h.patch(`/api/staff/customers/${id}`, { email: 'x@daji.test' }, tok)).status, 404);
  }
  // once they book with Riverside, only Riverside sees them
  const rs = (await h.get('/api/grounds')).body.items.find((g: any) => g.name !== 'Cricket Ground' && g.name !== 'Practice Nets');
  if (rs) {
    await bookAndPay(h, t, rs.id, dayFromNow(5), '10:00', 1);
    assert.ok((await list(owner2)).items.some((x: any) => x.id === id));
    assert.ok(!(await list(owner)).items.some((x: any) => x.id === id));
  }
});

test('someone who booked with another business is never listed as a sign-up of this one', async () => {
  const t = await register(h, 'Riverside Only', '9811100004');
  const id = await idOf(t);
  const rs = (await h.get('/api/grounds')).body.items.find((g: any) => g.name !== 'Cricket Ground' && g.name !== 'Practice Nets');
  assert.ok(rs, 'the demo has a second business ground');
  await bookAndPay(h, t, rs.id, dayFromNow(5), '10:00', 1);
  onlyDaji();
  assert.ok(!(await list(owner)).items.some((x: any) => x.id === id));
  assert.equal((await h.get(`/api/staff/customers/${id}`, owner)).status, 404);
});
