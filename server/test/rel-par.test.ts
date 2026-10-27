// REL-PAR-001..015: the same workflow is run as the desktop website, the iPad website, the iOS app and the Android app (each differs only in what the client says
// about itself) from an identical starting state, and every client must get the same business result: permission, intent, conflict result, availability, price,
// advance, deposit, payment status, reschedule eligibility, move count, final state, financial effect and audit meaning. Presentation may differ and is not tested here.
// This proves the server holds ONE rule per workflow for every channel. It does NOT prove the screens: the real-device columns (iPad, iOS, Android) stay NOT_RUN
// until the workflows are run on devices; the Daji mobile app has no screen yet for the security deposit, ground links or customer rescheduling.
import { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, bookAndPay, dayFromNow, slotStart, setNow, setting, HOUR, DEMO_ACCOUNTS, type Harness, type GroundLite } from './helpers.ts';
import { many, one } from '../src/db.ts';
import { rel, ev } from './rel.ts';

let h: Harness, g: GroundLite, nets: GroundLite;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
async function fresh(): Promise<void> { h.reset(); const gs = await grounds(h); g = gs.find((x) => x.name === 'Cricket Ground')!; nets = gs.find((x) => x.name === 'Practice Nets')!; }
beforeEach(fresh);

const CLIENTS = {
  'desktop web': { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36', 'x-client': 'web' },
  'iPad web': { 'user-agent': 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Safari/604.1', 'x-client': 'web' },
  'iOS app': { 'user-agent': 'DajiCricket/1.0 (iPhone; iOS 18.0) Expo', 'x-client': 'ios', 'x-daji-env': 'dev' },
  'Android app': { 'user-agent': 'DajiCricket/1.0 (Android 15; Pixel 9) okhttp/4.12', 'x-client': 'android', 'x-daji-env': 'dev' },
} as const;
type Client = keyof typeof CLIENTS;
type Api = ReturnType<typeof as>;
function as(client: Client, token: string | null) {
  const hd = CLIENTS[client] as Record<string, string>;
  return {
    get: (p: string) => h.call('GET', p, { token, headers: hd }),
    post: (p: string, body: unknown = {}, extra: Record<string, string> = {}) => h.call('POST', p, { token, body, headers: { ...hd, ...extra } }),
    put: (p: string, body: unknown = {}) => h.call('PUT', p, { token, body, headers: hd }),
    raw: (method: string, p: string, raw: Buffer) => h.call(method, p, { token, raw, headers: { ...hd, 'content-type': 'application/octet-stream' } }),
  };
}
const audits = () => many<{ action: string }>('SELECT action FROM audit_log ORDER BY rowid').map((r) => r.action).filter((a) => !/^(auth\.|security\.)/.test(a));
const pick = (b: any, keys: string[]) => Object.fromEntries(keys.map((k) => [k, b?.[k]]));
const norm = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'string' && /^(bk|pay|rf|sde|rsc|crl|opt|ref)_/.test(x) ? '<id>' : x)));

type Login = 'customer' | 'owner1' | 'staff1' | 'admin' | null;
async function sameForAll(par: string, workflow: (c: Api, client: Client, tok: string | null) => Promise<Record<string, unknown>>, login: Login = 'customer'): Promise<Record<string, any>> {
  const results: Record<string, unknown> = {};
  for (const client of Object.keys(CLIENTS) as Client[]) {
    await fresh();
    const tok = login ? await h.login(login) : null;
    const before = audits().length;
    const out = await workflow(as(client, tok), client, tok);
    results[client] = norm({ ...out, audit: audits().slice(before) });
  }
  const first = JSON.stringify(results['desktop web']);
  for (const [client, r] of Object.entries(results)) assert.equal(JSON.stringify(r), first, `${par}: ${client} differs from desktop web:\n${JSON.stringify(r)}\n${first}`);
  ev('clients', Object.keys(CLIENTS)); ev('outcome', results['desktop web']); ev('deviceRun', 'NOT_RUN: API-level client identities only, no real device');
  return results['desktop web'] as Record<string, any>;
}
const priceOf = async (date: string, time: string) => ((await h.get(`/api/grounds/${g.id}/availability?date=${date}`)).body.slots as { time: string; pricePaise: number }[]).find((x) => x.time === time)!.pricePaise;

rel('REL-PAR-001', 'identity and sign-in behave the same for every client: right and wrong password, who am I, sign-out', async () => {
  await sameForAll('sign-in', async (c, client) => {
    const bad = await h.call('POST', '/api/auth/login', { body: { email: DEMO_ACCOUNTS.customer.email, password: 'wrong password' }, headers: CLIENTS[client] as any });
    const good = await h.call('POST', '/api/auth/login', { body: { email: DEMO_ACCOUNTS.customer.email, password: DEMO_ACCOUNTS.customer.password }, headers: CLIENTS[client] as any });
    const me = await as(client, good.body.token).get('/api/me');
    const out = await as(client, good.body.token).post('/api/auth/logout'); const after = await as(client, good.body.token).get('/api/me');
    return { bad: [bad.status, bad.body.error?.code], good: good.status, role: me.body.user?.role ?? me.body.role, signedOut: out.status, after: after.status };
  }, null);
});

rel('REL-PAR-002', 'availability search returns the same slots, states and prices for every client', async () => {
  const o = await sameForAll('availability', async (c) => {
    const grid = await c.get(`/api/grounds/${g.id}/availability?date=${dayFromNow(4)}`);
    const opt = await c.post('/api/availability/options', { groundId: g.id, date: dayFromNow(4), startTime: '19:00', slots: 1 });
    return { status: grid.status, slots: grid.body.slots.map((s: any) => [s.time, s.state, s.pricePaise]), exact: pick(opt.body.exact, ['startTime', 'totalPaise', 'advancePaise']), available: opt.body.available };
  });
  assert.equal(o.status, 200);
});

rel('REL-PAR-003', 'alternative offers for a slot that is not free are the same for every client', async () => {
  const o = await sameForAll('alternatives', async (c) => {
    const other = await h.login('staff1');
    await h.post('/api/staff/bookings', { groundId: g.id, date: dayFromNow(4), startTime: '19:00', slots: 1, customer: { name: 'Taker', phone: '9866600111' }, payment: { method: 'cash', amountPaise: await priceOf(dayFromNow(4), '19:00') } }, other);
    const r = await c.post('/api/availability/options', { groundId: g.id, date: dayFromNow(4), startTime: '19:00', slots: 1 });
    const gp = await c.post('/api/guppi/options', { groundId: g.id, date: dayFromNow(4), startTime: '19:00', slots: 1 });
    return { exact: r.body.exact, available: r.body.available, alternatives: r.body.alternatives.map((a: any) => `${a.date} ${a.startTime} ${a.totalPaise}/${a.advancePaise}`), guppi: gp.body.alternatives.map((a: any) => `${a.date} ${a.startTime} ${a.totalPaise}/${a.advancePaise}`) };
  });
  assert.equal(o.exact, null); assert.ok(o.alternatives.length > 0);
});

rel('REL-PAR-004', 'holding a slot gives the same booking, price, advance and allocation for every client, and a second client is refused the same way', async () => {
  const o = await sameForAll('hold', async (c) => {
    const r = await c.post('/api/bookings', { groundId: g.id, date: dayFromNow(5), startTime: '19:00', slots: 1 });
    const again = await as('iOS app', await h.login('staff1')).post('/api/staff/bookings', { groundId: g.id, date: dayFromNow(5), startTime: '19:00', slots: 1, customer: { name: 'Late', phone: '9866600112' }, payment: { method: 'cash', amountPaise: await priceOf(dayFromNow(5), '19:00') } });
    return { status: r.status, booking: pick(r.body.booking, ['status', 'totalPaise', 'advancePaise', 'slotCount']), slots: many('SELECT slot_start FROM booking_slots').length, second: [again.status, again.body.error?.code] };
  });
  assert.equal(o.status, 201); assert.deepEqual(o.second, [409, 'SLOT_TAKEN']);
});

rel('REL-PAR-005', 'price, advance and the security deposit are the same for every client: the advance is on the booking, the deposit is separate', async () => {
  const o = await sameForAll('pricing-deposit', async (c, _client, tok) => {
    const b = await bookAndPay(h, tok!, g.id, dayFromNow(5), '19:00', 1);
    const staff = await h.login('staff1');
    await h.call('POST', `/api/staff/bookings/${b.id}/security-deposit/collect`, { token: staff, body: { amountPaise: 100000, method: 'cash' }, headers: { 'idempotency-key': 'par5-collect-0001' } });
    const dep = await c.get(`/api/bookings/${b.id}/security-deposit`); const view = await c.get(`/api/bookings/${b.id}`);
    return { deposit: pick(dep.body.deposit, ['collectedPaise', 'deductedPaise', 'refundedPaise', 'heldPaise']), booking: pick(view.body.booking, ['totalPaise', 'advancePaise', 'paidPaise', 'balancePaise']) };
  });
  assert.equal(o.deposit.heldPaise, 100000); assert.equal(o.booking.paidPaise, o.booking.advancePaise);
});

rel('REL-PAR-006', 'the payment hand-off (amount, mode) is the same for every client', async () => {
  const o = await sameForAll('payment-handoff', async (c) => {
    const r = await c.post('/api/bookings', { groundId: g.id, date: dayFromNow(8), startTime: '19:00', slots: 1 });
    const pi = await c.get(`/api/bookings/${r.body.booking.id}/payment-instructions`);
    return { instructions: pi.status, mode: pi.body.payment?.mode, amount: pi.body.payment?.amountPaise, advance: r.body.booking.advancePaise };
  });
  assert.equal(o.instructions, 200); assert.equal(o.amount, o.advance);
});

rel('REL-PAR-007', 'payment status after paying is the same for every client', async () => {
  const o = await sameForAll('payment-status', async (c, _client, tok) => {
    const b = await bookAndPay(h, tok!, g.id, dayFromNow(5), '19:00', 1);
    const v = await c.get(`/api/bookings/${b.id}`);
    return { booking: pick(v.body.booking, ['status', 'paidPaise', 'advancePaise', 'balancePaise']), payments: (v.body.payments ?? []).map((p: any) => [p.status, p.amountPaise, p.method]) };
  });
  assert.equal(o.booking.status, 'confirmed');
});

rel('REL-PAR-008', 'booking history lists the same bookings, states and amounts for every client', async () => {
  const o = await sameForAll('history', async (c, _client, tok) => {
    await bookAndPay(h, tok!, g.id, dayFromNow(5), '10:00', 1); await bookAndPay(h, tok!, nets.id, dayFromNow(6), '10:00', 1);
    const l = await c.get('/api/bookings'); const f = await c.get('/api/bookings?status=cancelled');
    return { status: l.status, items: l.body.items.map((b: any) => [b.status, b.totalPaise, b.paidPaise, b.groundName ?? b.ground?.name]), cancelled: f.body.items.length };
  });
  assert.equal(o.items.length, 2); assert.equal(o.cancelled, 0);
});

rel('REL-PAR-009', 'reschedule eligibility (more than 24 hours, the exact 24-hour boundary, the two-move limit) is decided the same for every client', async () => {
  const o = await sameForAll('reschedule-eligibility', async (c, _client, tok) => {
    const date = dayFromNow(4);
    const b = await bookAndPay(h, tok!, g.id, date, '10:00', 1);
    const m = (t: string) => c.post(`/api/bookings/${b.id}/reschedule`, { date, startTime: t });
    const first = await m('11:00'), second = await m('12:00'), third = await m('13:00');
    const moves = one<{ n: number }>("SELECT COUNT(*) n FROM booking_reschedules WHERE kind = 'move' AND actor_role = 'customer'")!.n;
    setNow(slotStart(date, '12:00') - 24 * HOUR); const t2 = await h.login('customer'); const edge = await as('desktop web', t2).post(`/api/bookings/${b.id}/reschedule`, { date, startTime: '14:00' });
    return { first: first.status, second: second.status, third: [third.status, third.body.error?.code], moves, boundary: [edge.status, edge.body.error?.code] };
  });
  assert.deepEqual(o.third, [409, 'RESCHEDULE_LIMIT']); assert.equal(o.moves, 2);
});

rel('REL-PAR-010', 'the money effect of a reschedule (dearer: balance due; cheaper: credit) is the same for every client', async () => {
  const o = await sameForAll('reschedule-financial', async (c, _client, tok) => {
    const dear = await bookAndPay(h, tok!, g.id, dayFromNow(5), '09:00', 1);
    const up = await c.post(`/api/bookings/${dear.id}/reschedule`, { date: dayFromNow(5), startTime: '19:00' });
    const cheap = await bookAndPay(h, tok!, g.id, dayFromNow(6), '19:00', 1);
    await h.post(`/api/staff/bookings/${cheap.id}/payments`, { method: 'cash', amountPaise: cheap.totalPaise - cheap.paidPaise }, await h.login('staff1'));
    const down = await c.post(`/api/bookings/${cheap.id}/reschedule`, { date: dayFromNow(6), startTime: '09:00' });
    return { dearer: [up.status, up.body.balancePaise > 0, up.body.settlement ?? null], cheaper: [down.status, down.body.settlement?.treatment, down.body.settlement?.creditPaise], refunds: one<{ n: number }>('SELECT COUNT(*) n FROM refunds')!.n, credits: one<{ n: number }>('SELECT COUNT(*) n FROM credit_lots')!.n };
  });
  assert.equal(o.refunds, 0); assert.equal(o.credits, 1);
});

rel('REL-PAR-011', 'permission-denied outcomes are the same for every client: wrong role, missing staff permission, someone else\'s booking', async () => {
  const o = await sameForAll('permission-denied', async (c, _client, tok) => {
    const b = await bookAndPay(h, tok!, g.id, dayFromNow(5), '10:00', 1);
    const staffRoute = await c.post(`/api/staff/bookings/${b.id}/reschedule`, { date: dayFromNow(5), startTime: '12:00', reason: 'A customer using the staff route' });
    const deposit = await c.post(`/api/staff/bookings/${b.id}/security-deposit/collect`, { amountPaise: 100, method: 'cash' }, { 'idempotency-key': 'par11-0001' });
    const stranger = await h.call('POST', '/api/auth/register', { body: { name: 'Stranger', phone: '9866600998', password: 'Stranger-demo-pw-1' } });
    const theirs = await as('desktop web', stranger.body.token).get(`/api/bookings/${b.id}`);
    return { staffRoute: [staffRoute.status, staffRoute.body.error?.code], deposit: [deposit.status, deposit.body.error?.code], strangerSees: [theirs.status, theirs.body.error?.code] };
  });
  assert.equal(o.staffRoute[0], 403);
});

rel('REL-PAR-012', 'failures and empty states read the same for every client: unknown booking, empty history, invalid request, closed feature', async () => {
  const o = await sameForAll('failure-empty', async (c) => {
    const none = await c.get('/api/bookings'); const missing = await c.get('/api/bookings/does-not-exist'); const bad = await c.post('/api/bookings', { groundId: g.id });
    setting({ customerRescheduleEnabled: false });
    const off = await c.post('/api/bookings/does-not-exist/reschedule', { date: dayFromNow(5), startTime: '10:00' });
    return { empty: [none.status, none.body.items.length], missing: [missing.status, missing.body.error?.code], invalid: [bad.status, bad.body.error?.code], featureOff: [off.status, off.body.error?.code] };
  });
  assert.deepEqual(o.empty, [200, 0]);
});

rel('REL-PAR-013', 'Guppi context and offers are the same for every client: the same enabled state, the same exact offer, the same hold hand-off', async () => {
  const o = await sameForAll('guppi-context', async (c) => {
    const ctx = await c.get('/api/guppi/context');
    const opt = await c.post('/api/guppi/options', { groundId: g.id, date: dayFromNow(5), startTime: '19:00', slots: 1 });
    const key = 'par13-hold-0001';
    const hd = await c.post('/api/guppi/hold', { actionId: key, optionId: opt.body.exact.optionId }, { 'idempotency-key': key });
    return { enabled: ctx.body.enabled, exact: pick(opt.body.exact, ['startTime', 'totalPaise', 'advancePaise']), hold: hd.status, handoff: hd.body.handoff?.kind, amount: hd.body.handoff?.amountPaise, bookings: one<{ n: number }>("SELECT COUNT(*) n FROM bookings WHERE status = 'held'")!.n };
  });
  assert.equal(o.hold, 201); assert.equal(o.bookings, 1);
});

rel('REL-PAR-014', 'file upload security is the same for every client: a signature-valid but infected image is quarantined or refused the same way', async () => {
  const infected = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*')]);
  const notImage = Buffer.from('this is not an image at all');
  const o = await sameForAll('upload', async (c) => {
    const a = await c.raw('POST', '/api/me/avatar', infected); const b = await c.raw('POST', '/api/me/avatar', notImage);
    return { infected: [a.status, a.body.error?.code], notImage: [b.status, b.body.error?.code] };
  });
  assert.ok(o.infected[0] >= 400); assert.ok(o.notImage[0] >= 400);
  ev('limits', 'the malware engine (ClamAV) is not run here: the demo scanner recognises the EICAR test string; a real scan on the live engine is NOT_RUN');
});

rel('REL-PAR-015', 'the audit trail means the same for every client: the same actions, by the same kind of actor, for the same workflow', async () => {
  const o = await sameForAll('audit', async (c, _client, tok) => {
    const date = dayFromNow(5);
    const b = await bookAndPay(h, tok!, g.id, date, '10:00', 1);
    await c.post(`/api/bookings/${b.id}/reschedule`, { date, startTime: '11:00' });
    const staff = await h.login('staff1');
    await h.call('POST', `/api/staff/bookings/${b.id}/security-deposit/collect`, { token: staff, body: { amountPaise: 50000, method: 'cash' }, headers: { 'idempotency-key': 'par15-collect-01' } });
    await c.post(`/api/bookings/${b.id}/cancel`, { reason: 'plans changed' });
    const rows = many<{ action: string; actor_role: string }>("SELECT action, actor_role FROM audit_log WHERE entity_id = ? ORDER BY rowid", b.id).map((r) => `${r.action}:${r.actor_role}`);
    return { rows };
  });
  assert.ok((o.rows as string[]).includes('booking.reschedule:customer')); assert.ok((o.rows as string[]).includes('deposit.collect:staff'));
});
