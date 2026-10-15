import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  startHarness, grounds, hold, bookAndPay, dayFromNow, slotStart, setNow, advance, HOUR, DAY as DAY_MS,
  type Harness, type GroundLite,
} from './helpers.ts';
import { runSweeps } from '../src/jobs.ts';
import { many, one } from '../src/db.ts';

let h: Harness;
let g1: GroundLite; // owner 1
let g2: GroundLite; // owner 2
let cust: string;
let staff: string;
let admin: string;
let customerId: string;

before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset();
  const all = await grounds(h);
  g1 = all.find((x) => x.name === 'Cricket Ground')!;
  g2 = all.find((x) => x.name === 'Riverside Box Cricket')!;
  cust = await h.login('customer');
  staff = await h.login('staff1');
  admin = await h.login('admin');
  customerId = (await h.get('/api/me', cust)).body.user.id;
});

/** Leaves the customer with `amount` of credit at owner 1 by cancelling a booking inside 24 hours. */
async function earnCredit(): Promise<number> {
  const b = await bookAndPay(h, cust, g1.id, dayFromNow(3), '19:00', 1);
  setNow(slotStart(dayFromNow(3), '19:00') - 2 * HOUR);
  const r = await h.post(`/api/bookings/${b.id}/cancel`, {}, cust);
  assert.equal(r.status, 200);
  return r.body.outcome.creditPaise;
}

test('credit earned from a late cancellation shows up per owner', async () => {
  const credit = await earnCredit();
  const c = (await h.get('/api/credits', cust)).body;
  assert.equal(c.balancePaise, credit);
  assert.equal(c.byOwner.length, 1);
  assert.equal(c.byOwner[0].ownerName, 'Daji Cricket Ground');
  assert.equal(c.ledger[0].kind, 'issued');
  assert.equal(c.ledger[0].balanceAfterPaise, credit);
});

test('credit pays for a new booking at the same owner and the booking confirms when it covers the advance', async () => {
  const credit = await earnCredit();
  const r = await hold(h, cust, g1.id, dayFromNow(5), '07:00', 1, { useCredit: true });
  assert.equal(r.status, 201);
  const advance_ = r.body.booking.advancePaise;
  assert.equal(r.body.creditAppliedPaise, Math.min(credit, advance_));
  if (credit >= advance_) {
    assert.equal(r.body.booking.status, 'confirmed');
    assert.equal(r.body.payment.mode, 'none');
  }
  assert.equal((await h.get('/api/credits', cust)).body.balancePaise, credit - r.body.creditAppliedPaise);
});

test('credit covering only part of the advance leaves the rest to pay; the booking confirms after that payment', async () => {
  const b = await bookAndPay(h, cust, g1.id, dayFromNow(4), '10:00', 1); // gives the customer a history with owner 1
  await h.post(`/api/bookings/${b.id}/cancel`, { prefer: 'credit' }, cust);
  const bal = (await h.get('/api/credits', cust)).body.balancePaise;
  const adj = await h.post(`/api/staff/customers/${customerId}/credit`, { amountPaise: -(bal - 50000), note: 'trim to 500 rupees' }, staff);
  assert.equal(adj.status, 200);
  assert.equal(adj.body.balancePaise, 50000);

  const r = await hold(h, cust, g1.id, dayFromNow(5), '19:00', 1, { useCredit: true });
  assert.equal(r.body.creditAppliedPaise, 50000);
  assert.equal(r.body.booking.status, 'held');
  assert.equal(r.body.payment.amountPaise, r.body.booking.advancePaise - 50000);
  const orderId = r.body.payment.razorpay!.orderId;
  const pay = await h.post('/api/gateway/demo/pay', { orderId }, cust);
  const v = await h.post('/api/payments/razorpay/verify', { orderId, paymentId: pay.body.paymentId, signature: pay.body.signature }, cust);
  assert.equal(v.body.booking.status, 'confirmed');
  assert.equal(v.body.booking.paidPaise, r.body.booking.advancePaise);
});

test('credit from one owner cannot be spent at another owner\'s ground', async () => {
  const credit = await earnCredit();
  const r = await hold(h, cust, g2.id, dayFromNow(5), '10:00', 1, { useCredit: true });
  assert.equal(r.status, 201);
  assert.equal(r.body.creditAppliedPaise, 0);
  assert.equal(r.body.booking.status, 'held');
  assert.equal((await h.get('/api/credits', cust)).body.balancePaise, credit, 'untouched');
});

test('credit is consumed from the lot that expires first', async () => {
  const b = await bookAndPay(h, cust, g1.id, dayFromNow(60), '10:00', 1);
  await h.post(`/api/bookings/${b.id}/cancel`, { prefer: 'credit' }, cust); // free cancel, to credit; lot A (expires T0+90d)
  const lotA = (await h.get('/api/credits', cust)).body.lots[0];
  advance(10 * DAY_MS);
  await h.post(`/api/staff/customers/${customerId}/credit`, { amountPaise: 100000, note: 'lot B, issued ten days later' }, staff); // lot B expires later
  const lots = (await h.get('/api/credits', cust)).body.lots;
  const lotB = lots.find((l: any) => l.id !== lotA.id);
  assert.ok(lotB.expiresAt > lotA.expiresAt);

  const total = lotA.remainingPaise + lotB.remainingPaise;
  // Use more than lot A holds so both lots are touched, in order.
  const take = lotA.remainingPaise + 10000;
  const r = await h.post(`/api/staff/customers/${customerId}/credit`, { amountPaise: -take, note: 'consume across lots' }, staff);
  assert.equal(r.body.balancePaise, total - take);
  const after = (await h.get('/api/credits', cust)).body.lots;
  assert.equal(after.find((l: any) => l.id === lotA.id).remainingPaise, 0, 'earliest expiry is emptied first');
  assert.equal(after.find((l: any) => l.id === lotB.id).remainingPaise, lotB.remainingPaise - 10000);
});

test('credit expires after the configured days; the sweep writes it off once and the ledger shows it', async () => {
  const credit = await earnCredit();
  advance(89 * DAY_MS);
  cust = await h.login('customer'); // sign-in tokens last 30 days
  assert.equal((await runSweeps(h.cfg)).creditsExpiredPaise, 0);
  assert.equal((await h.get('/api/credits', cust)).body.balancePaise, credit);

  advance(2 * DAY_MS);
  cust = await h.login('customer');
  assert.equal((await h.get('/api/credits', cust)).body.balancePaise, 0, 'unusable the moment it expires, even before the sweep');
  const out = await runSweeps(h.cfg);
  assert.equal(out.creditsExpiredPaise, credit);
  assert.equal((await runSweeps(h.cfg)).creditsExpiredPaise, 0, 'written off once');
  const led = (await h.get('/api/credits', cust)).body.ledger;
  assert.equal(led[0].kind, 'expired');
  assert.equal(led[0].amountPaise, -credit);
});

test('expired credit cannot be applied to a booking', async () => {
  await earnCredit();
  advance(91 * DAY_MS);
  cust = await h.login('customer');
  const r = await hold(h, cust, g1.id, dayFromNow(100), '10:00', 1, { useCredit: true });
  assert.equal(r.body.creditAppliedPaise, 0);
});

test('credit applied to a hold that then expires goes back to the wallet', async () => {
  const credit = await earnCredit();
  const r = await hold(h, cust, g1.id, dayFromNow(5), '19:00', 3, { useCredit: true });
  assert.ok(r.body.creditAppliedPaise > 0);
  assert.equal(r.body.booking.status, 'held');
  advance(16 * 60_000);
  await runSweeps(h.cfg);
  assert.equal((await h.get(`/api/bookings/${r.body.booking.id}`, cust)).body.booking.status, 'expired');
  assert.equal((await h.get('/api/credits', cust)).body.balancePaise, credit, 'nothing lost');
});

test('cancelling a booking that was part-paid with credit gives that part back as credit and the cash back as cash', async () => {
  await earnCredit();
  const wallet = (await h.get('/api/credits', cust)).body.balancePaise;
  const r = await hold(h, cust, g1.id, dayFromNow(5), '19:00', 3, { useCredit: true });
  const orderId = r.body.payment.razorpay!.orderId;
  const pay = await h.post('/api/gateway/demo/pay', { orderId }, cust);
  await h.post('/api/payments/razorpay/verify', { orderId, paymentId: pay.body.paymentId, signature: pay.body.signature }, cust);
  const used = r.body.creditAppliedPaise;
  const cash = r.body.payment.amountPaise;
  assert.equal(used + cash, r.body.booking.advancePaise);

  const c = await h.post(`/api/bookings/${r.body.booking.id}/cancel`, {}, cust);
  assert.equal(c.body.outcome.kind, 'free');
  assert.equal(c.body.outcome.refundPaise, Math.floor(cash / 2)); // the cash part going back to the payment method returns 50%
  assert.equal(c.body.outcome.creditPaise, used);
  assert.equal((await h.get('/api/credits', cust)).body.balancePaise, wallet, 'the credit part comes back as credit');
});

test('manual credit adjustments need a note, cannot overdraw, and only reach customers of that owner', async () => {
  await earnCredit();
  const noNote = await h.post(`/api/staff/customers/${customerId}/credit`, { amountPaise: 100 }, staff);
  assert.equal(noNote.status, 400);
  const over = await h.post(`/api/staff/customers/${customerId}/credit`, { amountPaise: -99_999_999, note: 'too much' }, staff);
  assert.equal(over.status, 409);
  assert.equal(over.body.error.code, 'CREDIT_INSUFFICIENT');
  const zero = await h.post(`/api/staff/customers/${customerId}/credit`, { amountPaise: 0, note: 'nothing' }, staff);
  assert.equal(zero.status, 400);
  const owner2 = await h.login('owner2');
  assert.equal((await h.post(`/api/staff/customers/${customerId}/credit`, { amountPaise: 1000, note: 'not mine' }, owner2)).status, 404);
  assert.ok(admin);
});

test('every credit movement is in the ledger and the balance always equals the sum of remaining lots', async () => {
  await earnCredit();
  await h.post(`/api/staff/customers/${customerId}/credit`, { amountPaise: 25000, note: 'goodwill' }, staff);
  await hold(h, cust, g1.id, dayFromNow(6), '09:00', 1, { useCredit: true });
  const lots = one<{ s: number }>('SELECT SUM(remaining_paise) s FROM credit_lots WHERE customer_id = ?', customerId)!.s;
  const ledgerSum = one<{ s: number }>('SELECT SUM(amount_paise) s FROM credit_ledger WHERE customer_id = ?', customerId)!.s;
  assert.equal(lots, ledgerSum);
  assert.equal((await h.get('/api/credits', cust)).body.balancePaise, lots);
  assert.ok(many('SELECT 1 FROM credit_ledger WHERE customer_id = ?', customerId).length >= 3);
});
