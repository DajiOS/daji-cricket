import { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startHarness, grounds, hold, bookAndPay, dayFromNow, slotStart, setNow, T0, HOUR, type Harness, type GroundLite } from './helpers.ts';
import { one, run } from '../src/db.ts';
import { issueCredit } from '../src/credits.ts';
import { rel, ev } from './rel.ts';

// Whole-system audit, revision 5 (27 Oct 2026). The website worked out the advance, the full-payment rule and the account credit for its "Due now" figure
// itself (web/public/app.js advanceFor), and could disagree with the hold (a ground with its own advance value but no mode of its own; the browser's clock;
// credit from another business). The figures shown before a hold now come from POST /api/bookings/quote, which uses the same functions as the hold.
// The staff desk dashboard added up today's money itself and showed a failed source as "0 · nothing waiting"; the server now sends the day's figures and the
// desk shows a failed source as a failure.

let h: Harness, g: GroundLite, cust: string, staff: string, owner: string, custId: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset();
  g = (await grounds(h)).find((x) => x.name === 'Cricket Ground')!;
  cust = await h.login('customer'); staff = await h.login('staff1'); owner = await h.login('owner1');
  custId = (await h.get('/api/me', cust)).body.user.id;
});

const quote = (token: string | null, body: Record<string, unknown>) => h.post('/api/bookings/quote', body, token ?? undefined);
const writes = () => ({
  bookings: one<{ n: number }>('SELECT COUNT(*) n FROM bookings')!.n, slots: one<{ n: number }>('SELECT COUNT(*) n FROM booking_slots')!.n,
  payments: one<{ n: number }>('SELECT COUNT(*) n FROM payments')!.n, credits: one<{ n: number }>('SELECT COALESCE(SUM(remaining_paise), 0) n FROM credit_lots')!.n,
  audit: one<{ n: number }>('SELECT COUNT(*) n FROM audit_log')!.n,
});
const ROOT = new URL('../../', import.meta.url).pathname;
const read = (f: string) => readFileSync(ROOT + f, 'utf8');

/** Quotes a selection, holds the same selection, and returns both: what was shown before and what the hold really took. */
async function quoteThenHold(date: string, time: string, slots: number, extra: Record<string, unknown> = {}) {
  const body = { groundId: g.id, date, startTime: time, slots, ...extra };
  const q = await quote(cust, body);
  assert.equal(q.status, 200, JSON.stringify(q.body));
  const r = await hold(h, cust, g.id, date, time, slots, extra);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const b = one<{ total_paise: number; advance_paise: number; paid_paise: number; discount_paise: number }>('SELECT total_paise, advance_paise, paid_paise, discount_paise FROM bookings WHERE id = ?', r.body.booking.id)!;
  if (r.body.booking.status === 'held') { const c = await h.post(`/api/bookings/${r.body.booking.id}/cancel`, {}, cust); assert.equal(c.status, 200, JSON.stringify(c.body)); } // room for the next case's hold
  return { q: q.body.quote, r: r.body, b };
}

rel('REL-FIX-009-001', 'the price, advance or full payment, promo and credit shown before a hold are exactly what the hold then takes, in every case the rules distinguish', async () => {
  const cases: Record<string, unknown>[] = [];
  const check = (name: string, x: Awaited<ReturnType<typeof quoteThenHold>>) => {
    assert.equal(x.q.totalPaise, x.b.total_paise, `${name}: total`);
    assert.equal(x.q.payNowPaise, x.b.advance_paise, `${name}: what the hold takes now`);
    assert.equal(x.q.discountPaise, x.b.discount_paise, `${name}: promo`);
    assert.equal(x.q.creditUsedPaise, x.r.creditAppliedPaise, `${name}: credit`);
    assert.equal(x.q.dueNowPaise, x.r.payment.amountPaise, `${name}: due online`);
    cases.push({ name, quote: x.q, held: { totalPaise: x.b.total_paise, advancePaise: x.b.advance_paise, discountPaise: x.b.discount_paise, creditAppliedPaise: x.r.creditAppliedPaise, dueOnlinePaise: x.r.payment.amountPaise } });
  };
  // the business's percent advance
  const a = await quoteThenHold(dayFromNow(4), '10:00', 2);
  assert.equal(a.q.payNow, 'advance'); assert.equal(a.q.advancePercent, 50);
  check('percent advance', a);
  // the ground has its own advance value but no mode of its own: the server uses the business's mode with the ground's value (the website used the business's value)
  run("UPDATE grounds SET advance_mode = NULL, advance_value = 30 WHERE id = ?", g.id);
  const b = await quoteThenHold(dayFromNow(4), '13:00', 2);
  assert.equal(b.q.advancePercent, 30);
  check('ground value with the business mode', b);
  run("UPDATE grounds SET advance_mode = 'fixed', advance_value = 25000 WHERE id = ?", g.id);
  const c = await quoteThenHold(dayFromNow(4), '15:00', 1);
  assert.equal(c.q.advancePercent, null); assert.equal(c.q.payNowPaise, 25000);
  check('fixed advance', c);
  run('UPDATE grounds SET advance_mode = NULL, advance_value = NULL WHERE id = ?', g.id);
  // the full-payment window, on the server's clock: exactly 24 hours ahead is inside it, 24 hours and one minute is outside
  const day = dayFromNow(2), start = slotStart(day, '18:00');
  setNow(start - 24 * HOUR);
  const d = await quoteThenHold(day, '18:00', 1);
  assert.equal(d.q.payNow, 'full'); assert.equal(d.q.payNowPaise, d.q.totalPaise);
  check('full payment at exactly the window', d);
  setNow(start - 24 * HOUR - 60_000);
  const e = await quoteThenHold(day, '19:00', 1);
  assert.equal(e.q.payNow, 'advance');
  check('advance just outside the window', e);
  setNow(T0);
  // a promo code and account credit of this business
  run("INSERT INTO promo_codes(id, owner_id, code, label, kind, value, min_total_paise, per_customer_limit, active, created_at) VALUES('pr_q', ?, 'QUOTE10', 'Ten off', 'percent', 10, 0, 5, 1, ?)", g.ownerId, T0);
  issueCredit({ customerId: custId, ownerId: g.ownerId, amountPaise: 30000, source: 'goodwill', note: 'test', by: null, silent: true });
  const f = await quoteThenHold(dayFromNow(6), '10:00', 2, { promoCode: 'QUOTE10', useCredit: true });
  assert.ok(f.q.discountPaise > 0 && f.q.creditUsedPaise > 0, JSON.stringify(f.q));
  check('promo and credit', f);
  // credit held with another business is not offered here (the website used the balance across businesses)
  issueCredit({ customerId: custId, ownerId: one<{ id: string }>("SELECT id FROM users WHERE email = 'owner2@daji.test'")!.id, amountPaise: 90000, source: 'goodwill', note: 'elsewhere', by: null, silent: true });
  const left = one<{ s: number }>('SELECT COALESCE(SUM(remaining_paise), 0) s FROM credit_lots WHERE customer_id = ? AND owner_id = ?', custId, g.ownerId)!.s;
  const q2 = await quote(cust, { groundId: g.id, date: dayFromNow(6), startTime: '16:00', slots: 1, useCredit: true });
  assert.equal(q2.body.quote.creditUsedPaise, Math.min(left, q2.body.quote.payNowPaise), 'only this business\'s credit counts');
  ev('cases', cases);
});

rel('REL-FIX-009-002', 'a quote holds nothing, charges nothing and writes nothing; signed out it shows the price and advance but no promo or credit', async () => {
  const w0 = writes();
  const anon = await quote(null, { groundId: g.id, date: dayFromNow(3), startTime: '11:00', slots: 2 });
  assert.equal(anon.status, 200, JSON.stringify(anon.body));
  assert.equal(anon.body.quote.creditUsedPaise, 0);
  assert.equal(anon.body.quote.dueNowPaise, anon.body.quote.payNowPaise);
  const promoSignedOut = await quote(null, { groundId: g.id, date: dayFromNow(3), startTime: '11:00', slots: 2, promoCode: 'ANY' });
  assert.equal(promoSignedOut.status, 401);
  const staffQuote = await quote(staff, { groundId: g.id, date: dayFromNow(3), startTime: '11:00', slots: 2, useCredit: true });
  assert.equal(staffQuote.status, 200); assert.equal(staffQuote.body.quote.creditUsedPaise, 0, 'credit is only a signed-in customer\'s own');
  const sent = await quote(cust, { groundId: g.id, date: dayFromNow(3), startTime: '11:00', slots: 2, amountPaise: 1, totalPaise: 1 });
  const plain = await quote(cust, { groundId: g.id, date: dayFromNow(3), startTime: '11:00', slots: 2 });
  assert.deepEqual(sent.body.quote, plain.body.quote, 'an amount sent by the client changes nothing');
  // a quote prices a selection; whether the slots are still free is decided by the hold, which can still refuse
  await bookAndPay(h, cust, g.id, dayFromNow(3), '11:00', 2);
  const w1 = writes();
  for (let i = 0; i < 5; i++) await quote(cust, { groundId: g.id, date: dayFromNow(3), startTime: '14:00', slots: 1, useCredit: true });
  assert.deepEqual(writes(), w1, 'five quotes changed no booking, slot, payment, credit or audit row');
  ev('writesBefore', w0); ev('writesAfterQuotes', writes());
  ev('signedOut', anon.body.quote); ev('promoSignedOutStatus', promoSignedOut.status);
});

rel('REL-FIX-009-003', 'the website and the app show the server\'s quote before a hold and repeat none of the advance, full-payment or credit rules', () => {
  const web = read('web/public/app.js'), app = read('mobile/src/BookScreen.tsx');
  for (const [name, src] of [['web', web], ['app', app]] as const) {
    assert.match(src, /\/api\/bookings\/quote/, `${name} calls the quote`);
    assert.ok(!/fullPaymentWithinHours\s*\*|advanceValue\s*\/\s*100|\*\s*value\)\s*\/\s*100|function advanceFor/.test(src), `${name} works out an advance itself`);
    assert.ok(!/Math\.min\(state\.creditPaise|Math\.min\(credit,/.test(src), `${name} works out the credit used itself`);
  }
  assert.ok(!/reduce\(\(t, x\) => t \+ x\.pricePaise/.test(app), 'the app adds up slot prices itself');
  // an error is never drawn as a price or as an empty day
  assert.match(web, /could not work out the price/); assert.match(app, /could not work out the price/);
  assert.ok(!/setAv\(\{ slots: \[\] \}\)/.test(app), 'a failed availability load is drawn as a day with no slots');
  assert.match(web, /state\.creditPaise = null/, 'a failed credit load is not shown as no credit');
  ev('files', ['web/public/app.js', 'mobile/src/BookScreen.tsx']);
});

rel('REL-FIX-009-004', 'the staff dashboard\'s money for today comes from the server and matches the bookings; a failed source is never shown as zero or "nothing waiting"', async () => {
  const day = dayFromNow(0);
  const a = await bookAndPay(h, cust, g.id, day, '20:00', 1);
  const b = await bookAndPay(h, cust, g.id, day, '21:00', 2);
  const t = await h.get('/api/staff/today', owner);
  assert.equal(t.status, 200, JSON.stringify(t.body));
  const db = one<{ sold: number; paid: number; n: number }>("SELECT COALESCE(SUM(total_paise),0) sold, COALESCE(SUM(paid_paise),0) paid, COUNT(*) n FROM bookings WHERE date = ? AND status IN ('confirmed','completed','no_show')", day)!;
  assert.deepEqual(t.body.money, { soldPaise: db.sold, collectedPaise: db.paid, soldBookings: db.n });
  assert.ok([a.id, b.id].every((id) => t.body.bookings.some((x: any) => x.id === id)));
  const st = await h.get('/api/staff/today', staff);
  assert.equal(st.status, 200); assert.deepEqual(st.body.money, t.body.money, 'the same figures for the team member who manages bookings');
  const dash = read('desk/src/pages/Dashboard.tsx');
  assert.ok(!/reduce\(\(a, b\) => a \+ b\.(totalPaise|paidPaise)/.test(dash), 'the dashboard adds up money itself');
  assert.match(dash, /today\?\.money/);
  for (const e of ['todayErr', 'pendingErr', 'apprErr', 'paysErr', 'groundsErr', 'peopleErr']) assert.match(dash, new RegExp(e), `the dashboard ignores ${e}`);
  assert.match(dash, /could not load/);
  ev('today', t.body.money); ev('fromDatabase', db);
});

