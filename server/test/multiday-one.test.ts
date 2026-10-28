import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, dayFromNow, setNow, T0, DAY, type Harness, type GroundLite } from './helpers.ts';
import { run } from '../src/db.ts';

// A multi-day booking is one booking everywhere a list or an answer counts bookings: one row, its dates, and the money across every day.
let h: Harness, g: GroundLite, staff: string, owner: string, cust: string, me: { id: string; name: string; phone: string };
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset();
  g = (await grounds(h))[0]!; staff = await h.login('staff1'); owner = await h.login('owner1'); cust = await h.login('customer');
  me = (await h.get('/api/me', cust)).body.user;
});

/** Eight days, Rs 2,55,000 agreed, nothing paid yet: Rs 31,875 a day, as in the owner's screenshot. */
async function eightDays(from = 40) {
  const r = await h.post('/api/staff/bookings/block', { groundId: g.id, fromDate: dayFromNow(from), toDate: dayFromNow(from + 7), startTime: '07:00', endTime: '19:00', totalPaise: 25_500_000, customer: { name: me.name, phone: me.phone }, payment: { method: 'cash', amountPaise: 0 } }, staff);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.bookings.length, 8);
  return r.body.bookings as { id: string; ref: string; date: string }[];
}

test('Pipeline: "Balance to collect" shows a multi-day booking once, with its dates and its whole balance', async () => {
  const days = await eightDays();
  const flat = (await h.get(`/api/staff/bookings?status=confirmed&from=${dayFromNow(0)}&limit=100`, staff)).body.items.filter((b: any) => b.customerId === me.id);
  assert.equal(flat.length, 8, 'without group every day is its own row (the day view still needs that)');
  const grouped = (await h.get(`/api/staff/bookings?status=confirmed&from=${dayFromNow(0)}&group=1&limit=100`, staff)).body.items.filter((b: any) => b.customerId === me.id);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].id, days[0]!.id, 'the first day stands for the booking');
  assert.equal(grouped[0].block.days, 8);
  assert.equal(grouped[0].block.fromDate, dayFromNow(40)); assert.equal(grouped[0].block.toDate, dayFromNow(47));
  assert.equal(grouped[0].block.totalPaise, 25_500_000); assert.equal(grouped[0].block.balancePaise, 25_500_000);
});

test('grouped filters look at every day: a block whose first day is played still shows as confirmed and still to come', async () => {
  const days = await eightDays(1);
  setNow(T0 + 2 * DAY); // the first day has been played
  run("UPDATE bookings SET status = 'completed' WHERE id = ?", days[0]!.id);
  const ahead = (await h.get(`/api/staff/bookings?status=confirmed&from=${dayFromNow(2)}&group=1&limit=100`, staff)).body.items.filter((b: any) => b.customerId === me.id);
  assert.equal(ahead.length, 1, 'the later days are confirmed and still ahead');
  assert.equal(ahead[0].block.days, 8);
  const none = (await h.get(`/api/staff/bookings?status=held&group=1&limit=100`, staff)).body.items.filter((b: any) => b.customerId === me.id);
  assert.equal(none.length, 0, 'a status no day has finds nothing');
});

test('searching the ref of any day finds the one booking', async () => {
  const days = await eightDays();
  const r = (await h.get(`/api/staff/bookings?q=${days[5]!.ref}&group=1&limit=5`, staff)).body;
  assert.equal(r.items.length, 1); assert.equal(r.items[0].id, days[0]!.id); assert.equal(r.items[0].block.days, 8);
  assert.equal((await h.get(`/api/staff/bookings?q=${days[5]!.ref}&limit=5`, staff)).body.items[0].id, days[5]!.id, 'ungrouped search still finds the day itself');
});

test('customer workspace on the desk lists the multi-day booking once', async () => {
  await eightDays();
  const x = (await h.get(`/api/staff/customers/${me.id}`, owner)).body;
  const mine = x.bookings.filter((b: any) => b.block);
  assert.equal(mine.length, 1); assert.equal(mine[0].block.totalPaise, 25_500_000);
});

test('the customer\'s own list groups on request, and keeps every day without it', async () => {
  await eightDays();
  assert.equal((await h.get('/api/bookings?limit=50', cust)).body.items.filter((b: any) => b.seriesId).length, 8);
  const grouped = (await h.get('/api/bookings?limit=50&group=1', cust)).body.items.filter((b: any) => b.seriesId);
  assert.equal(grouped.length, 1); assert.equal(grouped[0].block.balancePaise, 25_500_000);
});

test('Ask AI counts a multi-day booking as one upcoming booking, with its whole balance', async () => {
  await eightDays();
  const r = await h.post('/api/staff/ask', { question: 'How much money is still to collect?' }, owner);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.answer, /31,875|2,55,000/);
  assert.match(r.body.answer, /on 1 upcoming booking\b/, r.body.answer);
});

test('the customer\'s assistant says one booking and the whole balance', async () => {
  await eightDays();
  const r = await h.post('/api/ask', { question: 'How much do I owe?' }, cust);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.answer, /2,55,000 is still to pay across 1 upcoming booking\b/, r.body.answer);
  assert.equal(r.body.details.length, 1);
  const n = await h.post('/api/ask', { question: 'When is my next booking?' }, cust);
  assert.match(n.body.answer, /8 days/, n.body.answer);
});
