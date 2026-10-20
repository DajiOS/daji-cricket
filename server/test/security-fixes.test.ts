import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, dayFromNow, DEMO_ACCOUNTS, type Harness } from './helpers.ts';

let h: Harness;
before(async () => { h = await startHarness({ RATE_LIMIT_DISABLED: '1' } as any); });
after(async () => { await h.close(); });

const deskBooking = (staff: string, g: string, day: number, customer: Record<string, unknown>) =>
  h.post('/api/staff/bookings', { groundId: g, date: dayFromNow(day), startTime: '08:00', slots: 1, customer, payment: { method: 'cash', amountPaise: 100000 } }, staff);

test('signing up with the email of a desk record does not take that record over', async () => {
  const staff = await h.login('staff1'), g = (await grounds(h))[0]!;
  assert.equal((await deskBooking(staff, g.id, 140, { name: 'Vikram Desai', phone: '9877000001', email: 'vikram@x.in' })).status, 201);
  const claim = await h.post('/api/auth/register', { firstName: 'Mallory', lastName: 'X', email: 'vikram@x.in', phone: '9877000099', password: 'Mallory@12345' });
  assert.equal(claim.status, 409); assert.equal(claim.body.error.code, 'ACCOUNT_EXISTS');
  const look = await h.get('/api/staff/customers/lookup?email=vikram@x.in', staff);
  assert.equal(look.body.hasAccount, false, 'no password was put on the desk record');
});

test('the sign-in lock follows the person, not the way the phone number was written', async () => {
  const phone = '9000000004'; // staff1
  const spellings = ['9000000004', '+91 90000 00004', '090000-00004', '(90)00000004', '+919000000004'];
  for (let i = 0; i < 10; i++) await h.post('/api/auth/login', { identifier: spellings[i % spellings.length], password: 'wrong-' + i });
  const locked = await h.post('/api/auth/login', { identifier: '+91-' + phone, password: DEMO_ACCOUNTS.staff1.password });
  assert.equal(locked.status, 429); assert.equal(locked.body.error.code, 'ACCOUNT_LOCKED');
});

test('a team member can adjust a customer\'s credit only up to a limit', async () => {
  const staff = await h.login('staff1'), g = (await grounds(h))[0]!;
  const made = await deskBooking(staff, g.id, 142, { name: 'Credit Person', phone: '9877000003' });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const id = (await h.get('/api/staff/customers/lookup?phone=9877000003', staff)).body.id as string;
  const big = await h.post(`/api/staff/customers/${id}/credit`, { amountPaise: 5_000_100, note: 'Goodwill' }, staff);
  assert.equal(big.status, 403); assert.equal(big.body.error.code, 'CREDIT_LIMIT');
  const small = await h.post(`/api/staff/customers/${id}/credit`, { amountPaise: 500_000, note: 'Goodwill' }, staff);
  assert.equal(small.status, 200, JSON.stringify(small.body));
});

test('when a business is switched off, its team members are signed out too', async () => {
  const staff = await h.login('staff1'), admin = await h.login('admin');
  assert.equal((await h.get('/api/staff/today', staff)).status, 200);
  const owners = await h.get('/api/admin/users?role=owner', admin);
  const owner1 = (owners.body.items ?? owners.body.users ?? owners.body).find((u: any) => u.email === DEMO_ACCOUNTS.owner1.email);
  const off = await h.patch(`/api/admin/users/${owner1.id}`, { active: false }, admin);
  assert.equal(off.status, 200, JSON.stringify(off.body));
  assert.equal((await h.get('/api/staff/today', staff)).status, 401);
});
