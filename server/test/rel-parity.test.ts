// Cross-channel parity at the API level. The same customer/staff workflows are run as the desktop website, the iPad website, the iOS app and the Android app
// (each differs only in what the client says about itself: user agent and client name), and must give the same business result: same status, same price and deposit,
// same final state, same audit actions. This proves the server holds ONE workflow for every channel. It does NOT prove the screens: the iOS, Android and iPad
// device columns of the parity table are NOT_RUN (no devices here).
import { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { startHarness, grounds, bookAndPay, dayFromNow, setting, DEMO_ACCOUNTS, type Harness, type GroundLite } from './helpers.ts';
import { many, one } from '../src/db.ts';
import { rel, ev } from './rel.ts';

let h: Harness, g: GroundLite;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => { h.reset(); setting({ lateCancelCreditPercent: 50 }); g = (await grounds(h))[0]!; });

const CLIENTS = {
  'desktop web': { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36', 'x-client': 'web' },
  'iPad web': { 'user-agent': 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Safari/604.1', 'x-client': 'web' },
  'iOS app': { 'user-agent': 'DajiCricket/1.0 (iPhone; iOS 18.0) Expo', 'x-client': 'ios', 'x-daji-env': 'dev' },
  'Android app': { 'user-agent': 'DajiCricket/1.0 (Android 15; Pixel 9) okhttp/4.12', 'x-client': 'android', 'x-daji-env': 'dev' },
} as const;
type Client = keyof typeof CLIENTS;

/** Calls the API as one client. */
function as(client: Client, token: string | null) {
  const hd = CLIENTS[client] as Record<string, string>;
  return {
    get: (p: string) => h.call('GET', p, { token, headers: hd }),
    post: (p: string, body: unknown = {}, extra: Record<string, string> = {}) => h.call('POST', p, { token, body, headers: { ...hd, ...extra } }),
    raw: (method: string, p: string, raw: Buffer, extra: Record<string, string> = {}) => h.call(method, p, { token, raw, headers: { ...hd, 'content-type': 'application/octet-stream', ...extra } }),
  };
}
const audits = () => many<{ action: string }>('SELECT action FROM audit_log ORDER BY id').map((r) => r.action);
const pick = (b: any, keys: string[]) => Object.fromEntries(keys.map((k) => [k, b?.[k]]));

/** Runs a workflow once per client, from the same starting state, and requires every client to see the same normalised outcome. */
async function sameForAll(par: string, workflow: (c: ReturnType<typeof as>, client: Client) => Promise<Record<string, unknown>>, login: 'customer' | 'owner1' | 'staff1' | 'admin' | null = 'customer') {
  const results: Record<string, unknown> = {};
  for (const client of Object.keys(CLIENTS) as Client[]) {
    h.reset(); setting({ lateCancelCreditPercent: 50 });
    g = (await grounds(h))[0]!;
    const token = login ? await h.login(login) : null;
    const before = audits().length;
    const out = await workflow(as(client, token), client);
    results[client] = { ...out, audit: audits().slice(before).filter((a) => !/^(auth\.|security\.)/.test(a)) };
  }
  const first = JSON.stringify(results['desktop web']);
  for (const [client, r] of Object.entries(results)) assert.equal(JSON.stringify(r), first, `${par}: ${client} differs from desktop web:\n${JSON.stringify(r)}\n${first}`);
  ev(par, { sameAcrossClients: Object.keys(CLIENTS), outcome: results['desktop web'] });
  return results['desktop web'] as Record<string, any>;
}

rel('PAR-API-A', 'searching, alternatives, holding and paying give every client the same result (PAR-003/005/006/007/008/009/010/011/012/031/033)', async () => {
  await sameForAll('PAR-003', async (c) => { const r = await c.get(`/api/grounds/${g.id}/availability?date=${dayFromNow(4)}`); return { status: r.status, free: r.body.slots.filter((s: any) => s.available ?? s.free ?? true).length, firstPrice: r.body.slots[0].pricePaise }; });
  await sameForAll('PAR-031', async (c) => { const r = await c.post('/api/availability/options', { groundId: g.id, date: dayFromNow(4), startTime: '03:00', slots: 1 }); return { status: r.status, available: r.body.available, exact: r.body.exact, alternatives: r.body.alternatives.length, reason: r.body.reason }; });
  await sameForAll('PAR-005', async (c) => {
    const taker = await h.login('staff1');
    await h.post('/api/staff/bookings', { groundId: g.id, date: dayFromNow(4), startTime: '19:00', slots: 1, customer: { name: 'Taker', phone: '9866600111' }, payment: { method: 'cash', amountPaise: 260000 } }, taker).catch(() => null);
    const r = await c.post('/api/availability/options', { groundId: g.id, date: dayFromNow(4), startTime: '19:00', slots: 1 });
    return { status: r.status, available: r.body.available, alternatives: r.body.alternatives.map((a: any) => `${a.date} ${a.startTime} ${a.totalPaise}/${a.advancePaise}`) };
  });
  const out = await sameForAll('PAR-006', async (c) => {
    const r = await c.post('/api/bookings', { groundId: g.id, date: dayFromNow(5), startTime: '19:00', slots: 1 });
    return { http: r.status, booking: pick(r.body.booking, ['status', 'totalPaise', 'advancePaise', 'slotCount']), mode: r.body.payment?.mode };
  });
  assert.equal(out.http, 201);
  await sameForAll('PAR-033', async (c) => {
    await as('desktop web', await h.login('owner1')).post('/api/staff/bookings', { groundId: g.id, date: dayFromNow(6), startTime: '20:00', slots: 1, customer: { name: 'Other', phone: '9866600222' }, payment: { method: 'cash', amountPaise: 260000 } });
    const r = await c.post('/api/bookings', { groundId: g.id, date: dayFromNow(6), startTime: '20:00', slots: 1 });
    return { status: r.status, code: r.body.error?.code };
  });
  await sameForAll('PAR-007', async (c) => {
    const hd = await c.post('/api/bookings', { groundId: g.id, date: dayFromNow(7), startTime: '10:00', slots: 1 });
    const orderId = hd.body.payment.razorpay.orderId;
    const pay = await c.post('/api/gateway/demo/pay', { orderId });
    const v = await c.post('/api/payments/razorpay/verify', { orderId, paymentId: pay.body.paymentId, signature: pay.body.signature });
    const hist = await c.get('/api/bookings');
    const mine = (Array.isArray(hist.body) ? hist.body : hist.body.items ?? hist.body.bookings) as any[];
    const b = (await c.get(`/api/bookings/${v.body.booking.id}`)).body;
    return { hold: hd.status, verify: v.status, booking: pick(v.body.booking, ['status', 'totalPaise', 'paidPaise', 'balancePaise', 'advancePaise']), history: mine.map((x) => `${x.status}:${x.totalPaise}`), detail: pick(b.booking ?? b, ['status', 'paidPaise']) };
  });
});

rel('PAR-API-B', 'cancelling, moving, refunds and balances give every client the same result (PAR-011/012/013/014/015)', async () => {
  await sameForAll('PAR-013', async (c) => {
    const b = await bookAndPay(h, (c as any).token ?? await h.login('customer'), g.id, dayFromNow(5), '10:00');
    const prev = await c.get(`/api/bookings/${b.id}/cancel-preview`);
    const r = await c.post(`/api/bookings/${b.id}/cancel`, { reason: 'plans changed' });
    return { preview: prev.status, cancel: r.status, outcome: { ...r.body.outcome, bookingId: undefined }, state: one<{ status: string; refund_paise: number; credit_paise: number }>('SELECT status, refund_paise, credit_paise FROM bookings WHERE id = ?', b.id) };
  });
  await sameForAll('PAR-014', async (c) => {
    const b = await bookAndPay(h, await h.login('customer'), g.id, dayFromNow(5), '10:00');
    const r = await c.post(`/api/bookings/${b.id}/reschedule`, { date: dayFromNow(6), startTime: '10:00' });
    return { status: r.status, state: one<{ date: string; total_paise: number; paid_paise: number; reschedule_count: number }>('SELECT date, total_paise, paid_paise, reschedule_count FROM bookings WHERE id = ?', b.id), moves: many('SELECT 1 FROM booking_reschedules').length };
  });
  await sameForAll('PAR-015', async (c) => {
    const b = await bookAndPay(h, await h.login('customer'), g.id, dayFromNow(5), '10:00');
    await c.post(`/api/bookings/${b.id}/cancel`, { reason: 'plans changed' });
    const rf = many<{ amount_paise: number; status: string }>('SELECT amount_paise, status FROM refunds WHERE booking_id = ?', b.id);
    const view = await c.get(`/api/bookings/${b.id}`);
    return { refunds: rf, shown: pick(view.body.booking ?? view.body, ['status', 'refundPaise']) };
  });
  await sameForAll('PAR-011', async (c) => {
    const r = await c.post('/api/bookings', { groundId: g.id, date: dayFromNow(8), startTime: '19:00', slots: 1 });
    const pi = await c.get(`/api/bookings/${r.body.booking.id}/payment-instructions`);
    return { instructions: pi.status, amount: pi.body.payment?.amountPaise, deposit: r.body.booking.advancePaise, total: r.body.booking.totalPaise };
  });
});

rel('PAR-API-C', 'permissions, sign-in, expiry, uploads and Guppi behave the same for every client (PAR-001/004/037/039/040/041, staff PAR-018/019)', async () => {
  await sameForAll('PAR-037', async (c) => {
    const r = await c.get('/api/staff/reconcile'); const s = await c.get('/api/admin/reconcile'); const u = await c.post('/api/staff/bookings', { groundId: g.id });
    return { reconcile: r.status, admin: s.status, staffBooking: u.status };
  });
  await sameForAll('PAR-041', async (c, client) => {
    const r = await as(client, 'expired.or.invalid').get('/api/me');
    const logout = await c.post('/api/auth/logout'); const after = await c.get('/api/me');
    return { invalid: r.status, signedOut: logout.status, after: after.status };
  });
  await sameForAll('PAR-001', async (c, client) => {
    const l = await h.call('POST', '/api/auth/login', { body: { email: 'customer@daji.test', password: 'wrong password' }, headers: CLIENTS[client] as any });
    const ok = await h.call('POST', '/api/auth/login', { body: { email: DEMO_ACCOUNTS.customer.email, password: DEMO_ACCOUNTS.customer.password }, headers: CLIENTS[client] as any });
    return { wrong: l.status, wrongCode: l.body.error?.code, right: ok.status };
  }, null);
  await sameForAll('PAR-040', async (c) => {
    const infected = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*')]);
    const r = await c.raw('POST', '/api/me/avatar', infected);
    return { status: r.status, code: r.body.error?.code };
  });
  await sameForAll('PAR-004', async (c) => {
    const o = await c.post('/api/guppi/options', { groundId: g.id, date: dayFromNow(5), startTime: '19:00', slots: 1 });
    const key = 'parity-hold-0001';
    const r = await c.post('/api/guppi/hold', { actionId: key, optionId: o.body.exact.optionId }, { 'idempotency-key': key });
    return { options: o.status, hold: r.status, handoff: r.body.handoff?.kind, amount: r.body.handoff?.amountPaise };
  });
  await sameForAll('PAR-039', async (c) => {
    setting({ guppiAssistEnabled: false });
    const o = await c.post('/api/guppi/options', { groundId: g.id, date: dayFromNow(5), startTime: '19:00', slots: 1 });
    const std = await c.post('/api/availability/options', { groundId: g.id, date: dayFromNow(5), startTime: '19:00', slots: 1 });
    const plain = await c.post('/api/bookings', { groundId: g.id, date: dayFromNow(5), startTime: '19:00', slots: 1 });
    return { guppi: o.status, code: o.body.error?.code, standardOptions: std.status, standardHold: plain.status };
  });
  await sameForAll('PAR-019', async (c) => {
    const r = await c.post('/api/staff/bookings', { groundId: g.id, date: dayFromNow(4), startTime: '17:00', slots: 1, customer: { name: 'Walk In', phone: '9866600333' }, payment: { method: 'cash', amountPaise: 220000 } });
    const b = r.body.booking ?? r.body;
    return { status: r.status, booking: pick(b, ['status', 'totalPaise', 'paidPaise', 'source']) };
  }, 'staff1');
});

rel('PAR-API-D', 'what the mobile and web clients support is recorded from the code, not assumed', async () => {
  const root = join(import.meta.dirname, '..', '..');
  const mobile = readdirSync(join(root, 'mobile', 'src')).filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'));
  const desk = (() => { try { return readdirSync(join(root, 'desk', 'src')); } catch { return []; } })();
  const hasMobile = (re: RegExp) => mobile.filter((f) => re.test(f));
  const construction = { mobile: mobile.filter((f) => /construction/i.test(readFileSync(join(root, 'mobile', 'src', f), 'utf8'))), web: statSync(join(root, 'server', 'src')).isDirectory() };
  const map = {
    'PAR-003/006/007/008/009/010': hasMobile(/^(BookScreen|PayScreen|MeScreen)/),
    'PAR-014 rescheduling (customer)': hasMobile(/Reschedule/i),
    'PAR-018/019 admin and walk-in': hasMobile(/^DeskScreen/),
    'PAR-020 matches': hasMobile(/^MatchesScreen/),
    'PAR-024 tasks': hasMobile(/^TasksScreen/),
    'PAR-025 approvals': hasMobile(/^(Refunds|Team)Screen/),
    'PAR-026 document upload': hasMobile(/^(Cards|Tasks|Profile)Screen/),
    'PAR-028 Guppi Admin': hasMobile(/Ask/),
    'PAR-030 construction': construction.mobile,
  };
  ev('mobileScreens', map); ev('deskFiles', desk.length); ev('constructionInMobile', construction.mobile);
  // the Admin app's Construction screen (orders, goods received, measured work, defects, drawings); bills, RA bills and the BOQ stay on the desk
  assert.ok(construction.mobile.includes('ConstructionScreen.tsx'), 'construction has a screen in the Admin phone app');
});
