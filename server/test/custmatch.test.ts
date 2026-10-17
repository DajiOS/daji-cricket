import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, dayFromNow, type Harness } from './helpers.ts';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });

test('lookup finds an existing customer and sign-up claims a desk record', async () => {
  const staff = await h.login('staff1');
  const g = (await grounds(h))[0]!;
  const none = await h.get('/api/staff/customers/lookup?phone=9811111111', staff);
  assert.equal(none.body.found, false);
  const b = await h.post('/api/staff/bookings', { groundId: g.id, date: dayFromNow(9), startTime: '08:00', slots: 1, customer: { name: 'Meera Joshi', phone: '9811111111', email: 'meera@x.in' }, payment: { method: 'cash', amountPaise: 180000 } }, staff);
  assert.equal(b.status, 201);
  const hit = await h.get('/api/staff/customers/lookup?phone=9811111111', staff);
  assert.equal(hit.body.found, true); assert.equal(hit.body.hasAccount, false); assert.equal(hit.body.name, 'Meera Joshi'); assert.equal(hit.body.email, 'meera@x.in');
  const reg = await h.post('/api/auth/register', { firstName: 'Meera', lastName: 'Joshi', email: 'meera@x.in', phone: '9811111111', password: 'Meera@12345' });
  assert.equal(reg.status, 201);
  const again = await h.post('/api/auth/register', { firstName: 'Meera', lastName: 'Joshi', email: 'meera@x.in', password: 'Meera@12345' });
  assert.equal(again.status, 409); assert.equal(again.body.error?.code ?? again.body.code, 'ACCOUNT_EXISTS');
  const after = await h.get('/api/staff/customers/lookup?email=MEERA@x.in', staff);
  assert.equal(after.body.hasAccount, true);
});
