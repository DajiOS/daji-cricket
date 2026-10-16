import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, hold, dayFromNow, setting, advance, MIN, HOUR, sendWebhook, capturedEvent, type Harness, type GroundLite } from './helpers.ts';
import { many, one, run } from '../src/db.ts';
import { processRefunds } from '../src/payments.ts';

let h: Harness; let g: GroundLite; let cust: string; let staff: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => { h.reset(); g = (await grounds(h))[0]!; cust = await h.login('customer'); staff = await h.login('staff1'); });
const UTR = (n: number) => String(100000000000 + n);

test('F3 customer cancels held booking after submitting UPI UTR; staff then cannot verify/record the customer money', async () => {
  setting({ razorpayEnabled: false });
  const r = await hold(h, cust, g.id, dayFromNow(2), '19:00');
  const b = r.body.booking;
  const sub = await h.post(`/api/bookings/${b.id}/upi-reference`, { utr: UTR(3) }, cust);
  assert.equal(sub.status, 200);
  const c = await h.post(`/api/bookings/${b.id}/cancel`, {}, cust);
  console.log('cancel', c.status);
  const pay = one<any>('SELECT status FROM payments WHERE id = ?', sub.body.payment.id)!;
  console.log('payment status after cancel', pay.status);
  const v = await h.post(`/api/staff/payments/${sub.body.payment.id}/verify`, { approve: true }, staff);
  console.log('verify after cancel', v.status, v.body?.error?.code);
  assert.equal(v.status, 200, 'staff cannot reconcile a UPI payment the customer really made');
});

test('F4 refund.processed webhook before rp_refund_id saved is dropped as unknown_refund and refund stuck processing', async () => {
  const r = await hold(h, cust, g.id, dayFromNow(5), '19:00');
  // pay
  const orderId = r.body.payment.razorpay!.orderId;
  const pay = await h.post<any>('/api/gateway/demo/pay', { orderId }, cust);
  await h.post('/api/payments/razorpay/verify', { orderId, paymentId: pay.body.paymentId, signature: pay.body.signature }, cust);
  await h.post(`/api/bookings/${r.body.booking.id}/cancel`, {}, cust);
  const rf = one<any>('SELECT * FROM refunds')!;
  console.log('refund', rf.status, rf.mode, rf.amount_paise);
  // refunds wait for the super admin's authorisation before anything is sent
  run('UPDATE refunds SET approved_at = ? WHERE approved_at IS NULL', Date.now());
  // webhook arrives before processRefunds stored the id
  const wh = await sendWebhook(h, { event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_x1' } } } }, { eventId: 'evt1' });
  console.log('webhook', wh.body);
  await processRefunds(h.cfg);
  const after_ = one<any>('SELECT status, rp_refund_id FROM refunds')!;
  console.log(after_);
  assert.equal(after_.status, 'done');
});
