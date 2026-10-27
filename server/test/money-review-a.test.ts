import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, hold, dayFromNow, setting, advance, HOUR, type Harness, type GroundLite } from './helpers.ts';
import { runSweeps } from '../src/jobs.ts';
import { many, one } from '../src/db.ts';

let h: Harness; let g: GroundLite; let cust: string; let staff: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => { h.reset(); g = (await grounds(h))[0]!; cust = await h.login('customer'); staff = await h.login('staff1'); });
const UTR = (n: number) => String(100000000000 + n);

test('F1 overpayment: UPI submitted, staff records full cash, then UPI verified -> paid > total', async () => {
  setting({ razorpayEnabled: false });
  const r = await hold(h, cust, g.id, dayFromNow(2), '19:00');
  const b = r.body.booking;
  const sub = await h.post(`/api/bookings/${b.id}/upi-reference`, { utr: UTR(1) }, cust);
  assert.equal(sub.status, 200);
  const cash = await h.post(`/api/staff/bookings/${b.id}/payments`, { method: 'cash', amountPaise: b.totalPaise }, staff);
  assert.equal(cash.status, 201, JSON.stringify(cash.body));
  const v = await h.post(`/api/staff/payments/${sub.body.payment.id}/verify`, { approve: true }, staff);
  console.log('verify', v.status, v.body.outcome);
  const row = one<any>('SELECT total_paise, paid_paise FROM bookings WHERE id = ?', b.id)!;
  console.log(row);
  assert.ok(row.paid_paise <= row.total_paise, `paid ${row.paid_paise} > total ${row.total_paise}`);
});

test('F2 partial UPI receipt then hold expiry: captured money neither refunded nor credited', async () => {
  setting({ razorpayEnabled: false });
  const r = await hold(h, cust, g.id, dayFromNow(2), '19:00');
  const b = r.body.booking;
  const sub = await h.post(`/api/bookings/${b.id}/upi-reference`, { utr: UTR(2) }, cust);
  const v = await h.post(`/api/staff/payments/${sub.body.payment.id}/verify`, { approve: true, receivedPaise: 10000 }, staff);
  console.log('verify', v.status, v.body.outcome);
  advance(24 * HOUR); await runSweeps(h.cfg);
  const bk = one<any>('SELECT status, paid_paise FROM bookings WHERE id = ?', b.id)!;
  const pay = one<any>('SELECT status, amount_paise, refunded_paise FROM payments WHERE id = ?', sub.body.payment.id)!;
  const refunds = many<any>('SELECT * FROM refunds WHERE booking_id = ?', b.id);
  const lots = many<any>('SELECT * FROM credit_lots');
  console.log(bk, pay, refunds.length, lots.length);
  assert.ok(bk.status !== 'expired' || refunds.length > 0 || lots.length > 0, 'expired booking keeps customer money');
});
