import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, dayFromNow, type Harness } from './helpers.ts';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(() => h.reset());

test('customers can book up to a year ahead, not beyond, and the config says so', async () => {
  const g = (await grounds(h))[0]!;
  const cust = await h.login('customer');
  assert.equal((await h.get('/api/config')).body.maxDaysAhead, 365);
  const far = await h.post('/api/bookings', { groundId: g.id, date: dayFromNow(360), startTime: '08:00', slots: 1 }, cust);
  assert.equal(far.status, 201, JSON.stringify(far.body));
  const toofar = await h.post('/api/bookings', { groundId: g.id, date: dayFromNow(380), startTime: '08:00', slots: 1 }, cust);
  assert.equal(toofar.status, 400);
  assert.equal(toofar.body.error.code, 'TOO_FAR_AHEAD');
});
