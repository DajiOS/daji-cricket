// Prices on enquiry: customers see free slots without prices and send a pricing enquiry for a slot; the ground quotes it and confirms it as a booking.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, dayFromNow, grounds, hold, setting, type Harness } from './helpers.ts';
import { getSettings } from '../src/settings.ts';
import { one } from '../src/db.ts';

let h: Harness;
let cust: string, staff: string, owner: string;
let g: { id: string; name: string };
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset();
  setting({ pricesOnEnquiry: true });
  cust = await h.login('customer'); staff = await h.login('staff1'); owner = await h.login('owner1');
  g = (await grounds(h)).find((x) => x.name === 'Cricket Ground')!;
});

const prices = (x: unknown): string[] => {
  const found: string[] = [];
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) v.forEach((y, i) => walk(y, `${path}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, y] of Object.entries(v)) { if (/Paise$/.test(k) && typeof y === 'number' && y > 0) found.push(`${path}.${k}`); walk(y, `${path}.${k}`); }
  };
  walk(x, '');
  return found;
};

test('visitors and customers see free slots but no price anywhere; staff still see the saved prices', async () => {
  const date = dayFromNow(5);
  for (const who of [undefined, cust]) {
    const list = await h.get('/api/grounds', who);
    assert.deepEqual(prices(list.body), [], 'no price on the grounds list');
    assert.equal(list.body.items[0].priceOnEnquiry, true);
    assert.deepEqual(prices((await h.get(`/api/grounds/${g.id}`, who)).body), [], 'no price on the ground');
    const av = await h.get(`/api/grounds/${g.id}/availability?date=${date}`, who);
    assert.equal(av.status, 200);
    assert.ok(JSON.stringify(av.body).includes('"available"'), 'free slots are still shown');
    assert.deepEqual(prices(av.body), [], 'no price on any slot');
  }
  const cfg = (await h.get('/api/config')).body;
  assert.equal(cfg.pricesOnEnquiry, true);
  assert.equal(cfg.guppiBookingEnabled, false, 'the booking assistant, which quotes and books online, rests');
  // the prices are kept: the desk still reads them
  const st = (await h.get('/api/staff/grounds', staff)).body.items.find((x: any) => x.id === g.id);
  assert.ok(st.pricePaise > 0 && st.rates.every((r: any) => r.pricePaise > 0), 'saved prices are untouched');
});

test('a customer cannot book or be quoted online; the slot goes to the ground as a pricing enquiry with the slot attached', async () => {
  const date = dayFromNow(6);
  const r = await hold(h, cust, g.id, date, '18:00', 2);
  assert.equal(r.status, 409);
  assert.equal((r.body as any).error.code, 'PRICE_ON_ENQUIRY');
  assert.equal((await h.post('/api/bookings/quote', { groundId: g.id, date, startTime: '18:00', slots: 2 }, cust)).status, 409);
  assert.equal(one<{ n: number }>("SELECT COUNT(*) n FROM bookings WHERE status = 'held'")!.n, 0, 'nothing is held');

  const e = await h.post('/api/enquiries', { groundId: g.id, preferredDate: date, preferredTime: '18:00', preferredSlots: 2, preferredLabel: 'Evening', message: 'Price for this slot, please.' }, cust);
  assert.equal(e.status, 201, JSON.stringify(e.body));
  assert.equal(e.body.preferredTime, '18:00');
  assert.equal(e.body.preferredSlots, 2);
  assert.equal((await h.post('/api/enquiries', { groundId: g.id, preferredTime: '6pm', message: 'Price for this slot, please.' }, cust)).status, 400, 'a slot time is checked');

  // the desk sees the slot, quotes it, and confirms it: the booking takes that slot unless staff pick another
  const seen = (await h.get(`/api/staff/enquiries/${e.body.id}`, staff)).body;
  assert.equal(seen.preferredTime, '18:00');
  const q = (await h.post(`/api/staff/enquiries/${e.body.id}/quotations`, { amountPaise: 300000 }, staff)).body;
  const conv = await h.post(`/api/staff/enquiries/${e.body.id}/convert`, { quotationId: q.quotations[0].id, payment: { method: 'cash', amountPaise: 150000 } }, staff);
  assert.equal(conv.status, 201, JSON.stringify(conv.body));
  const b = (await h.get(`/api/staff/bookings/${conv.body.bookingId}`, staff)).body.booking;
  assert.equal(b.date, date);
  assert.equal(b.totalPaise, 300000, 'the quoted price');
  assert.equal((b.endAt - b.startAt) / 60_000, 2 * 60, 'the two slots asked for');

  // staff bookings are not affected
  assert.equal((await h.post('/api/staff/bookings', { groundId: g.id, date: dayFromNow(8), startTime: '07:00', slots: 1, customer: { name: 'Walk In', phone: '9876500011' }, payment: { method: 'cash', amountPaise: 180000 } }, staff)).status, 201, 'the desk still books at the saved prices');
});

test('Ask AI does not quote a price, and says how to ask for one', async () => {
  const a = (await h.post('/api/ask', { question: 'how much does the cricket ground cost per hour?' }, cust)).body;
  assert.match(a.answer, /on enquiry/i);
  assert.doesNotMatch(JSON.stringify(a), /₹/);
  const free = (await h.post('/api/ask', { question: 'is the cricket ground free tomorrow?' }, cust)).body;
  assert.match(free.answer, /enquiry/i);
  assert.doesNotMatch(JSON.stringify(free), /₹/);
});

test('off, everything is as before; the owner turns it on and off in Settings', async () => {
  const r = await h.put('/api/admin/settings', { pricesOnEnquiry: false }, await h.login('admin'));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(getSettings().pricesOnEnquiry, false);
  assert.ok(prices((await h.get(`/api/grounds/${g.id}`)).body).length > 0, 'prices show again');
  assert.equal((await hold(h, cust, g.id, dayFromNow(6), '18:00', 1)).status, 201);
  void owner;
});

test('a pricing enquiry is filed once even when the answer is lost and it is sent again; a visitor can send one too', async () => {
  const date = dayFromNow(6);
  const body = { groundId: g.id, preferredDate: date, preferredTime: '18:00', preferredSlots: 2, message: 'Price for this slot, please.' };
  const send = () => h.call('POST', '/api/enquiries', { body, token: cust, headers: { 'idempotency-key': 'enq-test-0001' } });
  const a = await send(), b = await send();
  assert.equal(a.status, 201); assert.equal(b.status, 201);
  assert.equal(b.headers.get('idempotent-replayed'), 'true', 'the second send is the first answer again');
  assert.equal(b.body.id, a.body.id);
  assert.equal(one<{ n: number }>('SELECT COUNT(*) n FROM enquiries')!.n, 1, 'one enquiry, not two');
  const v = await h.post('/api/enquiries', { ...body, firstName: 'Walk', lastName: 'Up', phone: '9876500022' });
  assert.equal(v.status, 201, JSON.stringify(v.body));
  assert.equal(v.body.preferredTime, '18:00');
});

test('a customer cannot quote or confirm an enquiry, and the booking options give no price', async () => {
  const e = (await h.post('/api/enquiries', { groundId: g.id, preferredDate: dayFromNow(6), preferredTime: '18:00', preferredSlots: 1, message: 'Price for this slot, please.' }, cust)).body;
  assert.equal((await h.post(`/api/staff/enquiries/${e.id}/quotations`, { amountPaise: 1 }, cust)).status, 403);
  assert.equal((await h.post(`/api/staff/enquiries/${e.id}/convert`, { payment: { method: 'cash', amountPaise: 1 } }, cust)).status, 403);
  const o = await h.post('/api/availability/options', { groundId: g.id, date: dayFromNow(6), startTime: '19:00', slots: 1 }, cust);
  assert.equal(o.status, 200, JSON.stringify(o.body));
  assert.deepEqual(prices(o.body), [], 'no price on any option');
});
