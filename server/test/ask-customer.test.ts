import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, bookAndPay, dayFromNow, advance, DAY, type Harness } from './helpers.ts';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(() => h.reset());

const ask = (q: string, tok: string) => h.post('/api/ask', { question: q }, tok);

test('customer Ask AI: sees only the signed-in customer, staff and anonymous are refused', async () => {
  const cust = await h.login('customer'); const owner = await h.login('owner1');
  assert.equal((await h.post('/api/ask', { question: 'hello' })).status, 401);
  assert.equal((await ask('next booking', owner)).status, 403);
  assert.equal((await h.post('/api/staff/ask', { question: 'revenue' }, cust)).status, 403);
  assert.equal((await ask('', cust)).status, 400);
});

test('customer Ask AI: next booking, balance, history and credit come from the customer\'s own records', async () => {
  const cust = await h.login('customer');
  const g = (await grounds(h))[0]!;
  assert.match((await ask('When is my next booking?', cust)).body.answer, /no upcoming bookings/i);
  const b = await bookAndPay(h, cust, g.id, dayFromNow(3), '19:00');
  const r = await ask('When is my next booking?', cust);
  assert.equal(r.status, 200);
  assert.ok(r.body.answer.includes(b.ref), r.body.answer);
  assert.equal(r.body.open, 'bookings');
  assert.match((await ask('How much credit do I have?', cust)).body.answer, /no account credit/i);
  // another customer sees nothing of it
  const other = (await h.post('/api/auth/register', { name: 'Other Person', phone: '9000000001', email: 'other@daji.test', password: 'Other@12345', consent: {} })).body.token;
  assert.match((await ask('When is my next booking?', other)).body.answer, /no upcoming bookings/i);
});

test('customer Ask AI: public answers (price, hours, free slots, policy, contact, directions)', async () => {
  const cust = await h.login('customer');
  const g = (await grounds(h))[0]!;
  assert.match((await ask('What is the cancellation policy?', cust)).body.answer, /24 hours/);
  assert.match((await ask('Who can I call?', cust)).body.answer, /7567156000/);
  assert.match((await ask('how much does it cost', cust)).body.answer + JSON.stringify((await ask('how much does it cost', cust)).body.details), /₹/);
  assert.match((await ask('what time do you open', cust)).body.answer + JSON.stringify((await ask('what time do you open', cust)).body.details), /\d\d:\d\d/);
  const free = await ask(`Is ${g.name} free tomorrow?`, cust);
  assert.match(free.body.answer, /free slots? on|no free slots/i, free.body.answer);
  await bookAndPay(h, cust, g.id, dayFromNow(1), '19:00');
  const after1 = await ask(`Is ${g.name} free tomorrow evening?`, cust);
  assert.ok(!/19:00/.test(after1.body.answer), after1.body.answer);
  assert.equal((await ask('Is it free on 3 January 2001', cust)).status, 200);
  const unk = await ask('xyzzy plugh', cust);
  assert.equal(unk.body.intent, 'help');
  assert.ok(unk.body.suggestions.length > 0);
});

test('customer dashboard: spend counts only what stayed with the ground, by ground and month; other customers see none of it', async () => {
  const cust = await h.login('customer');
  const [g1, g2] = await grounds(h);
  const empty = (await h.get('/api/my/dashboard', cust)).body;
  assert.equal(empty.spentPaise, 0); assert.equal(empty.sessions, 0); assert.equal(empty.byMonth.length, 12);
  const a = await bookAndPay(h, cust, g1!.id, dayFromNow(2), '19:00');
  const b = await bookAndPay(h, cust, g2!.id, dayFromNow(3), '10:00');
  const ahead = (await h.get('/api/my/dashboard', cust)).body;
  assert.equal(ahead.spentPaise, 0, 'unplayed sessions are not spent');
  assert.equal(ahead.upcoming, 2); assert.equal(ahead.paidAheadPaise, a.paidPaise + b.paidPaise);
  advance(5 * DAY);
  const d = (await h.get('/api/my/dashboard', cust)).body;
  assert.equal(d.sessions, 2);
  assert.equal(d.spentPaise, a.paidPaise + b.paidPaise);
  assert.equal(d.byGround.length, 2);
  assert.equal(d.byGround.reduce((n: number, x: any) => n + x.spentPaise, 0), d.spentPaise);
  assert.equal(d.byMonth.reduce((n: number, x: any) => n + x.spentPaise, 0), d.spentPaise);
  assert.equal(d.recent.length, 2);
  const other = (await h.post('/api/auth/register', { name: 'Other Person', phone: '9000000002', email: 'o2@daji.test', password: 'Other@12345', consent: {} })).body.token;
  assert.equal((await h.get('/api/my/dashboard', other)).body.spentPaise, 0);
  assert.equal((await h.get('/api/my/dashboard', await h.login('owner1'))).status, 403);
});
