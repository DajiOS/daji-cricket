// A small, known state of the books, shared by the accounting and Ask AI tests.
// "Today" is Saturday 24 October 2026 (ten days after the harness clock starts). Online bookings pay half up front.
import assert from 'node:assert/strict';
import { grounds, bookAndPay, dayFromNow, slotStart, setNow, T0, DAY, HOUR, MIN, setting, DEMO_ACCOUNTS, type Harness, type GroundLite } from './helpers.ts';
import { register } from './register.ts';
import { one } from '../src/db.ts';
import type { Booking } from '@daji/shared';

export interface Scenario {
  main: GroundLite; nets: GroundLite; riverside: GroundLite;
  owner: string; owner2: string; admin: string; staff: string; cust: string;
  ownerId: string; owner2Id: string;
  b: Record<'played' | 'owing' | 'noShow' | 'late' | 'free' | 'future' | 'future2' | 'other', Booking>;
}

export async function buildScenario(h: Harness): Promise<Scenario> {
  h.reset();
  setting({ lateCancelCreditPercent: 50 });
  const all = await grounds(h);
  const main = all.find((g) => g.name === 'Cricket Ground')!;
  const nets = all.find((g) => g.name === 'Practice Nets')!;
  const riverside = all.find((g) => g.name === 'Riverside Box Cricket')!;
  let owner = await h.login('owner1'), owner2 = await h.login('owner2'), admin = await h.login('admin'), staff = await h.login('staff1');
  const cust = await h.login('customer');
  const ownerId = one<{ id: string }>('SELECT id FROM users WHERE email = ?', DEMO_ACCOUNTS.owner1.email)!.id;
  const owner2Id = one<{ id: string }>('SELECT id FROM users WHERE email = ?', DEMO_ACCOUNTS.owner2.email)!.id;
  const person = (name: string, phone: string) => register(h, name, phone, {});
  const asha = await person('Asha Patel', '9811111111');
  const bhavin = await person('Bhavin Shah', '9822222222');
  const dev = await person('Dev Rao', '9844444444');
  const eve = await person('Eve Joshi', '9855555555');
  const chirag = await person('Chirag Mehta', '9833333333');

  const b = {} as Scenario['b'];
  b.played = await bookAndPay(h, asha, main.id, dayFromNow(2), '18:00');          // played; the balance is paid in cash at the ground
  b.owing = await bookAndPay(h, bhavin, nets.id, dayFromNow(3), '19:00');         // played; the balance is never paid
  b.noShow = await bookAndPay(h, dev, main.id, dayFromNow(4), '10:00');           // did not turn up
  b.late = await bookAndPay(h, cust, main.id, dayFromNow(6), '20:00');            // cancelled five hours before
  b.free = await bookAndPay(h, eve, nets.id, dayFromNow(5), '18:00');             // cancelled in good time, refunded
  b.future = await bookAndPay(h, asha, main.id, dayFromNow(20), '18:00');         // still to come
  b.future2 = await bookAndPay(h, dev, nets.id, dayFromNow(15), '09:00', 2);      // still to come, two slots
  b.other = await bookAndPay(h, chirag, riverside.id, dayFromNow(2), '19:00');    // another owner's ground
  assert.equal((await h.post(`/api/bookings/${b.free.id}/cancel`, {}, eve)).status, 200);

  setNow(slotStart(dayFromNow(2), '20:30'));
  const bal = b.played.totalPaise - b.played.paidPaise;
  assert.ok(bal > 0, 'online bookings pay half up front');
  assert.equal((await h.post(`/api/staff/bookings/${b.played.id}/payments`, { method: 'cash', amountPaise: bal }, staff)).status, 201);
  setNow(slotStart(dayFromNow(4), '10:00') + 31 * MIN);
  assert.equal((await h.post(`/api/staff/bookings/${b.noShow.id}/no-show`, {}, staff)).status, 200);
  setNow(slotStart(dayFromNow(6), '20:00') - 5 * HOUR);
  const c = await h.post(`/api/bookings/${b.late.id}/cancel`, {}, cust);
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(c.body.outcome.kind, 'credit');
  setNow(T0 + 10 * DAY);
  owner = await h.login('owner1'); owner2 = await h.login('owner2'); admin = await h.login('admin'); staff = await h.login('staff1');
  return { main, nets, riverside, owner, owner2, admin, staff, cust, ownerId, owner2Id, b };
}
