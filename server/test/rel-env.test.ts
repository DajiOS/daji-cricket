import { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { startHarness, grounds, bookAndPay, dayFromNow, setting, type Harness, type GroundLite } from './helpers.ts';
import { loadConfig, fatalConfigProblems, type Config } from '../src/config.ts';
import { getGateway } from '../src/gateway.ts';
import { handleWebhook } from '../src/payments.ts';
import { one } from '../src/db.ts';
import { rel, ev } from './rel.ts';
import { resolveTarget, assertServerMatches, envHeaders, EnvConfigError, LIVE_HOSTS } from '../../mobile/src/envGuard.ts';
import { isAllowedCheckoutUrl, parseCheckoutMessage, CHECKOUT_HOSTS } from '../../mobile/src/checkoutGuard.ts';

let h: Harness, g: GroundLite, cust: string, staff: string, adm: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => { h.reset(); g = (await grounds(h))[0]!; cust = await h.login('customer'); staff = await h.login('staff1'); adm = await h.login('admin'); });

const SECRET = 'S'.repeat(24);
const real = (extra: Record<string, string> = {}): Config => loadConfig({
  PUBLIC_URL: 'https://dajicricket.com', JWT_SECRET: 'x'.repeat(40), FIELD_KEY: 'k'.repeat(32), DATA_DIR: '/tmp/daji-env-test', BACKUP_PASSPHRASE: 'pass phrase for tests',
  DEMO_MODE: 'off', RAZORPAY_KEY_ID: 'rzp_live_abc', RAZORPAY_KEY_SECRET: SECRET, RAZORPAY_WEBHOOK_SECRET: 'wh', APP_ENV: 'live', FILE_SCANNER: 'clamav', CLAMAV_HOST: 'clamav', ...extra,
});
const root = join(import.meta.dirname, '..', '..');

// ------------------------------------------------------------------ REL-ENV-001

rel('REL-ENV-001', 'a system knows what it is: it says so on /api/health, refuses a request meant for another system, and a real domain will not start without saying', async () => {
  const health = await h.get('/api/health');
  assert.equal(health.status, 200); assert.equal(health.body.env, 'dev');
  ev('healthEnv', health.body.env);
  // a request that names the system it was built for is served only by that system
  const ok = await h.call('GET', '/api/me', { token: cust, headers: { 'x-daji-env': 'dev' } });
  assert.equal(ok.status, 200);
  for (const wrong of ['live', 'test']) {
    const r = await h.call('POST', '/api/bookings', { token: cust, body: { groundId: g.id, date: dayFromNow(3), startTime: '19:00', slots: 1 }, headers: { 'x-daji-env': wrong } });
    assert.equal(r.status, 409, wrong); assert.equal(r.body.error.code, 'ENV_MISMATCH'); assert.equal(r.body.error.details.server, 'dev');
  }
  assert.equal((await h.call('GET', '/api/health', { headers: { 'x-daji-env': 'live' } })).status, 200, 'the health check itself answers, so a build can find out what it reached');
  assert.equal(one<{ n: number }>('SELECT COUNT(*) n FROM bookings')!.n, 0, 'a refused request changed nothing');
  // a real domain with no APP_ENV does not start
  const unset = real({ APP_ENV: '' });
  assert.equal(unset.appEnv, 'unset');
  assert.ok(fatalConfigProblems(unset).some((p) => /APP_ENV is not set/.test(p)));
  assert.deepEqual(fatalConfigProblems(real()), [], 'a complete live setup has no problems');
  assert.equal(loadConfig({ PUBLIC_URL: 'http://localhost:4000' }).appEnv, 'dev', 'a laptop is a dev system without any setting');
  // the process itself exits before opening the database (checked by starting it)
  ev('unsetEnvProblems', fatalConfigProblems(unset));
});

rel('REL-ENV-001', 'the server process refuses to start with an unsafe setup (it exits non-zero and opens no database)', async () => {
  const { spawnSync } = await import('node:child_process');
  const { mkdtempSync, readdirSync: ls } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const data = mkdtempSync(join(tmpdir(), 'daji-start-'));
  const run = (env: Record<string, string>) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(root, 'server', 'src', 'index.ts')], { env: { PATH: process.env.PATH ?? '', DATA_DIR: data, PORT: '0', ...env }, encoding: 'utf8', timeout: 20000 });
  const bad = run({ PUBLIC_URL: 'https://dajicricket.com', JWT_SECRET: 'x'.repeat(40), FIELD_KEY: 'k'.repeat(32), DEMO_MODE: 'off' }); // no APP_ENV
  assert.notEqual(bad.status, 0); assert.match(bad.stderr + bad.stdout, /FATAL/);
  assert.deepEqual(ls(data), [], 'no database file was created');
  const liveDemo = run({ PUBLIC_URL: 'https://dajicricket.com', JWT_SECRET: 'x'.repeat(40), FIELD_KEY: 'k'.repeat(32), APP_ENV: 'live', DEMO_MODE: 'on' });
  assert.notEqual(liveDemo.status, 0); assert.match(liveDemo.stderr + liveDemo.stdout, /DEMO_MODE is on in a live system/);
  ev('startupRefusals', ['APP_ENV unset', 'live with demo mode']);
});

// ------------------------------------------------------------------ REL-ENV-002

rel('REL-ENV-002', 'missing or wrong provider configuration stops a live system, and a system with no provider takes no payment on trust', async () => {
  const cases: [string, Record<string, string>, RegExp][] = [
    ['no Razorpay keys', { RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '' }, /Razorpay keys are not set/],
    ['no webhook secret', { RAZORPAY_WEBHOOK_SECRET: '' }, /RAZORPAY_WEBHOOK_SECRET is not set/],
    ['a test key on live', { RAZORPAY_KEY_ID: 'rzp_test_abc' }, /TEST key is set in a live system/],
    ['demo mode on live', { DEMO_MODE: 'on' }, /DEMO_MODE is on/],
    ['no virus scanner on live', { FILE_SCANNER: 'builtin' }, /FILE_SCANNER/],
    ['an http address on live', { PUBLIC_URL: 'http://dajicricket.com' }, /https/],
  ];
  const seen: Record<string, string[]> = {};
  for (const [name, env, re] of cases) {
    const p = fatalConfigProblems(real(env));
    assert.ok(p.some((x) => re.test(x)), `${name}: ${JSON.stringify(p)}`);
    seen[name] = p;
  }
  assert.deepEqual(fatalConfigProblems(real({ RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '', RAZORPAY_WEBHOOK_SECRET: '', PAYMENTS_MODE: 'upi_only' })), [], 'direct UPI only is a deliberate choice, not a gap');
  // a rehearsal can never hold a live key (and the reverse is above)
  assert.ok(fatalConfigProblems(real({ APP_ENV: 'test' })).some((p) => /LIVE key is set in a test system/.test(p)));
  assert.deepEqual(fatalConfigProblems(real({ APP_ENV: 'test', RAZORPAY_KEY_ID: 'rzp_test_abc', DEMO_MODE: 'off', FILE_SCANNER: 'builtin' })), []);

  // with no provider and no demo mode there is no gateway, and a webhook cannot be forged with an empty secret
  const bare = real({ RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '', RAZORPAY_WEBHOOK_SECRET: '', PAYMENTS_MODE: 'upi_only' });
  assert.equal(getGateway(bare), null);
  const body = Buffer.from(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_x', order_id: 'order_x', amount: 100, currency: 'INR' } } } }));
  const { createHmac } = await import('node:crypto');
  const empty = createHmac('sha256', '').update(body).digest('hex');
  assert.deepEqual(handleWebhook(bare, body, { signature: empty, eventId: 'evt_empty' }), { status: 400, outcome: 'bad_signature' });
  assert.deepEqual(handleWebhook(bare, body, { eventId: 'evt_none' }), { status: 400, outcome: 'bad_signature' });
  assert.equal(one<{ n: number }>('SELECT COUNT(*) n FROM webhook_events')!.n, 0);
  ev('refusals', seen);
});

// ------------------------------------------------------------------ REL-ENV-003

rel('REL-ENV-003', 'a test or mobile build cannot reach the live system, and a live build cannot reach anything else', async () => {
  const ok = (appEnv: string, apiUrl: string) => resolveTarget({ appEnv, apiUrl });
  const refuse = (appEnv: string | undefined, apiUrl: string | undefined, code: string) => assert.throws(() => resolveTarget({ appEnv, apiUrl }), (e: unknown) => e instanceof EnvConfigError && e.code === code, `${appEnv} ${apiUrl}`);
  // a build that does not say what it is connects to nothing
  refuse(undefined, 'https://api.dajicricket.com', 'APP_ENV_MISSING'); refuse('prod', 'https://api.dajicricket.com', 'APP_ENV_MISSING');
  refuse('live', undefined, 'API_URL_MISSING'); refuse('test', '', 'API_URL_MISSING'); refuse('live', 'not a url', 'API_URL_INVALID');
  // test and dev builds may not point at the live family of hosts, however the address is written
  for (const u of ['https://api.dajicricket.com', 'https://API.DAJICRICKET.COM', 'https://api.dajicricket.com:443', 'https://dajicricket.com', 'https://www.dajicricket.com/api']) { refuse('test', u, 'TEST_POINTS_AT_LIVE'); refuse('dev', u, 'TEST_POINTS_AT_LIVE'); }
  refuse('test', 'http://rehearsal.example.org', 'TEST_NEEDS_HTTPS'); refuse('dev', 'http://rehearsal.example.org', 'DEV_NEEDS_LOCAL');
  refuse('test', 'https://user:pw@rehearsal.example.org', 'API_URL_INVALID');
  // a live build talks only to the live API host, over https
  refuse('live', 'http://api.dajicricket.com', 'LIVE_NEEDS_HTTPS'); refuse('live', 'https://api.dajicricket.com.evil.example', 'LIVE_HOST_MISMATCH');
  refuse('live', 'https://rehearsal.example.org', 'LIVE_HOST_MISMATCH'); refuse('live', 'https://api.dajicricket.com:8443', 'LIVE_HOST_MISMATCH');
  assert.deepEqual(ok('live', 'https://api.dajicricket.com/'), { appEnv: 'live', apiUrl: 'https://api.dajicricket.com' });
  assert.equal(ok('test', 'https://rehearsal.example.org').appEnv, 'test');
  assert.equal(ok('dev', 'http://192.168.1.20:4000').apiUrl, 'http://192.168.1.20:4000');
  // what a server answers on /api/health must match the build; a live server in demo mode is refused too
  const t = ok('test', 'https://rehearsal.example.org');
  assert.doesNotThrow(() => assertServerMatches(t, { env: 'test', demo: true }));
  assert.throws(() => assertServerMatches(t, { env: 'live', demo: false }), /ENV|different|system/i);
  assert.throws(() => assertServerMatches(t, {}), EnvConfigError);
  assert.throws(() => assertServerMatches(ok('live', 'https://api.dajicricket.com'), { env: 'live', demo: true }), EnvConfigError);
  assert.doesNotThrow(() => assertServerMatches(ok('live', 'https://api.dajicricket.com'), { env: 'live', demo: false }));

  // the server side of the same rule: the header a build sends is refused by the other system
  const dev = ok('dev', 'http://localhost:4000');
  assert.equal((await h.call('GET', '/api/me', { token: cust, headers: envHeaders(dev) })).status, 200);
  const liveBuild = await h.call('GET', '/api/me', { token: cust, headers: envHeaders(ok('live', 'https://api.dajicricket.com')) });
  assert.equal(liveBuild.status, 409); assert.equal(liveBuild.body.error.code, 'ENV_MISMATCH');
  const testBuild = await h.call('POST', '/api/guppi/options', { token: cust, body: { groundId: g.id, date: dayFromNow(3), startTime: '19:00', slots: 1 }, headers: envHeaders(ok('test', 'https://rehearsal.example.org')) });
  assert.equal(testBuild.status, 409);

  // the build files: preview builds are test builds with no live address, production builds are live, and no app source names the live host
  const eas = JSON.parse(readFileSync(join(root, 'mobile', 'eas.json'), 'utf8')).build as Record<string, { env?: Record<string, string> }>;
  const profiles: Record<string, unknown> = {};
  for (const [name, p] of Object.entries(eas)) {
    const e = p.env ?? {};
    profiles[name] = { env: e.EXPO_PUBLIC_APP_ENV, api: e.EXPO_PUBLIC_API_URL ?? null };
    if (name.startsWith('preview')) { assert.equal(e.EXPO_PUBLIC_APP_ENV, 'test', name); assert.ok(!e.EXPO_PUBLIC_API_URL || !LIVE_HOSTS.includes(new URL(e.EXPO_PUBLIC_API_URL).hostname), `${name} does not point at live`); }
    if (name.startsWith('production')) { assert.equal(e.EXPO_PUBLIC_APP_ENV, 'live', name); assert.equal(e.EXPO_PUBLIC_API_URL, 'https://api.dajicricket.com'); }
    if (name === 'development') assert.equal(e.EXPO_PUBLIC_APP_ENV, 'dev');
  }
  const src = join(root, 'mobile', 'src');
  const offenders = readdirSync(src).filter((f) => /\.(ts|tsx)$/.test(f) && f !== 'envGuard.ts').filter((f) => /dajicricket\.com/.test(readFileSync(join(src, f), 'utf8')) && !/^(Settings|Intro|Auth|Me|Profile)Screen|Intro\.tsx|theme\.ts|types\.ts/.test(f));
  ev('buildProfiles', profiles); ev('sourceFilesNamingLiveHost', offenders);
  const api = readFileSync(join(src, 'api.ts'), 'utf8');
  assert.ok(!/api\.dajicricket\.com/.test(api), 'the API client has no built-in live address to fall back to');
  assert.ok(/guarded\(\)/.test(api) && /envHeaders/.test(api), 'every request carries the system header');
});

// ------------------------------------------------------------------ REL-CH-002

rel('REL-CH-002', 'the payment window only loads the provider\'s own pages: look-alike domains, other schemes and odd addresses are refused', async () => {
  const good = ['https://checkout.razorpay.com/v1/checkout.js', 'https://checkout.razorpay.com/', 'https://api.razorpay.com/v1/checkout/embedded', 'https://CHECKOUT.RAZORPAY.COM/x', 'about:blank'];
  const bad = [
    'https://checkout.razorpay.com.evil.example/v1/checkout.js', 'https://evil.example/checkout.razorpay.com', 'https://checkout-razorpay.com/', 'https://checkoutrazorpay.com/',
    'https://razorpay.com@evil.example/', 'https://checkout.razorpay.com@evil.example/', 'https://user:pw@checkout.razorpay.com/', 'https://checkout.razorpay.com:8443/', 'http://checkout.razorpay.com/',
    'https://xcheckout.razorpay.com/', 'https://razorpay.com.evil.example/', 'https://evil.example/?u=https://checkout.razorpay.com', 'javascript:alert(1)', 'data:text/html,<script>1</script>',
    'file:///etc/passwd', 'intent://pay#Intent;scheme=upi;end', 'ftp://checkout.razorpay.com/', '//checkout.razorpay.com/', 'https://checkout.razorpay.com\\@evil.example/', '', 'not a url', 'https://dajicricket.com.evil.example/',
    'https://checkout.razorpay.com%2eevil.example/', 'https://сheckout.razorpay.com/', 'HTTPS://CHECKOUT.RAZORPAY.COM.EVIL.EXAMPLE/',
  ];
  for (const u of good) assert.equal(isAllowedCheckoutUrl(u), true, u);
  const allowedBad = bad.filter(isAllowedCheckoutUrl);
  assert.deepEqual(allowedBad, [], 'look-alikes that were wrongly allowed');
  ev('allowedHosts', CHECKOUT_HOSTS); ev('lookalikesRefused', bad.length);

  // what the window reports is only a hint: exact shape, expected order, nothing extra
  const sig = 'a'.repeat(64);
  const okMsg = (o: unknown) => JSON.stringify({ ok: o });
  assert.deepEqual(parseCheckoutMessage(okMsg({ orderId: 'order_ABC123def456', paymentId: 'pay_XYZ123abc456', signature: sig }), 'order_ABC123def456'), { kind: 'paid', orderId: 'order_ABC123def456', paymentId: 'pay_XYZ123abc456', signature: sig });
  assert.deepEqual(parseCheckoutMessage('{"dismiss":true}'), { kind: 'dismiss' });
  const refused: unknown[] = [
    okMsg({ orderId: 'order_OTHER1234567', paymentId: 'pay_XYZ123abc456', signature: sig }),          // another order
    okMsg({ paymentId: 'pay_XYZ123abc456', signature: 'nothex' }), okMsg({ paymentId: 'x', signature: sig }), okMsg({ paymentId: 'pay_XYZ123abc456', signature: sig, extra: 1 }),
    okMsg({ paymentId: ['pay_XYZ123abc456'], signature: sig }), JSON.stringify({ ok: { paymentId: 'pay_XYZ123abc456', signature: sig }, dismiss: true }), '{"ok":null}', '[]', 'null', '{"dismiss":false}', 'not json',
    { ok: {} }, undefined, 'x'.repeat(5000), JSON.stringify({ paid: true }),
  ];
  for (const m of refused) assert.equal(parseCheckoutMessage(m, 'order_ABC123def456'), null, String(m).slice(0, 60));
  // the app's payment windows use these guards (and never the open allow-list they replaced)
  for (const f of ['PayScreen.tsx', 'AutoDebit.tsx']) {
    const s = readFileSync(join(root, 'mobile', 'src', f), 'utf8');
    assert.ok(!/originWhitelist=\{\['\*'\]\}/.test(s), `${f} no longer allows every origin`);
    assert.ok(/onShouldStartLoadWithRequest/.test(s) && /parseCheckoutMessage/.test(s), `${f} checks navigation and messages`);
  }
  ev('messageCasesRefused', refused.length);
});

// ------------------------------------------------------------------ REL-ENV-004

rel('REL-ENV-004', 'a release switch cannot be bypassed: every online way in (website, Guppi, options, repeat, move) honours the opening and closing days, closed days and feature switches', async () => {
  const closedDay = dayFromNow(9), beyond = dayFromNow(40), before = dayFromNow(1);
  await h.post('/api/admin/closed-dates', { dates: [closedDay], closed: true, scopes: ['ground'], reason: 'maintenance' }, adm);
  setting({ bookingsOpenFrom: dayFromNow(2), bookingsCloseFrom: dayFromNow(30) });
  const body = (date: string) => ({ groundId: g.id, date, startTime: '19:00', slots: 1 });
  const bookings = () => one<{ n: number }>('SELECT COUNT(*) n FROM bookings')!.n;
  const attempts: Record<string, number | string> = {};
  const guppiHold = async (date: string) => {
    const o = await h.post('/api/guppi/options', body(date), cust);
    assert.equal(o.status, 200); assert.equal(o.body.exact, null, `Guppi has no option for ${date}`); assert.equal(o.body.available, false);
    // and an option id cannot be forged for it
    const f = await h.call('POST', '/api/guppi/hold', { token: cust, body: { actionId: `forge-${date}`, optionId: 'x.y' }, headers: { 'idempotency-key': `forge-${date}` } });
    assert.ok(f.status === 400 || f.status === 410, `forged option refused (${f.status})`);
  };
  for (const [name, date, code] of [['before opening', before, 'NOT_OPEN_YET'], ['after closing', beyond, 'BOOKINGS_CLOSED'], ['a closed day', closedDay, 'DATE_CLOSED']] as const) {
    const web = await h.post('/api/bookings', body(date), cust);
    assert.equal(web.status, 409, name); assert.equal(web.body.error.code, code, name); attempts[`web ${name}`] = web.body.error.code;
    const opt = await h.post('/api/availability/options', body(date), cust);
    assert.equal(opt.status, 200); assert.equal(opt.body.exact, null, `options: ${name}`);
    await guppiHold(date);
  }
  assert.equal(bookings(), 0, 'nothing was held by any refused request');

  // a repeating booking cannot reach past the closing day: the dates beyond it are left out
  setting({ bookingsCloseFrom: dayFromNow(12) });
  const rep = await h.post('/api/bookings', { ...body(dayFromNow(4)), repeat: { frequency: 'weekly', count: 4 } }, cust);
  assert.equal(rep.status, 201, JSON.stringify(rep.body));
  const placed = (rep.body.series.skipped as { date: string; reason: string }[]).map((s) => s.date);
  assert.ok(placed.every((d) => d >= dayFromNow(12) || d === closedDay), 'only dates beyond the window or on a closed day are left out');
  const dates = (await h.get('/api/bookings', cust)).body;
  const items = (Array.isArray(dates) ? dates : dates.items ?? dates.bookings) as { date: string }[];
  assert.ok(items.length >= 1);
  assert.ok(items.every((b) => b.date < dayFromNow(12) && b.date !== closedDay), 'no repeat booking sits outside the window or on a closed day');
  attempts['series skipped'] = placed.length;

  // moving a booking cannot get past the switches either (the customer is bound; the desk is not)
  setting({ bookingsCloseFrom: dayFromNow(30) });
  const paid = await bookAndPay(h, cust, g.id, dayFromNow(6), '19:00');
  const mine = paid.id;
  const startOf = () => one<{ start_at: number }>('SELECT MIN(slot_start) start_at FROM booking_slots WHERE booking_id = ?', mine)!.start_at;
  const startBefore = startOf();
  for (const [name, date, code] of [['before opening', dayFromNow(1), 'NOT_OPEN_YET'], ['after closing', dayFromNow(31), 'BOOKINGS_CLOSED'], ['a closed day', closedDay, 'DATE_CLOSED']] as const) {
    const mv = await h.post(`/api/bookings/${mine}/reschedule`, { date, startTime: '19:00' }, cust);
    assert.equal(mv.status, 409, `move ${name}: ${JSON.stringify(mv.body)}`); assert.equal(mv.body.error.code, code, `move ${name}`);
    attempts[`move ${name}`] = mv.body.error.code;
  }
  assert.equal(startOf(), startBefore, 'the booking did not move');
  const deskMove = await h.post(`/api/staff/bookings/${mine}/reschedule`, { date: dayFromNow(31), startTime: '19:00', reason: 'Customer asked by phone, tournament week' }, staff);
  ev('deskMoveBeyondClosing', deskMove.status);
  assert.equal(deskMove.status, 200, JSON.stringify(deskMove.body));

  // feature switches: off means off on every route, and the standard flow keeps working
  setting({ guppiAssistEnabled: false });
  const gOff = await h.post('/api/guppi/options', body(dayFromNow(5)), cust);
  assert.equal(gOff.status, 503); assert.equal(gOff.body.error.code, 'FEATURE_OFF');
  assert.equal((await h.post('/api/availability/options', body(dayFromNow(5)), cust)).status, 200, 'the standard flow does not depend on Guppi');
  setting({ guppiAssistEnabled: true, customerRescheduleEnabled: false });
  const mv = await h.post(`/api/bookings/${mine}/reschedule`, { date: dayFromNow(6), startTime: '19:00' }, cust);
  assert.equal(mv.status, 503); assert.equal(mv.body.error.code, 'FEATURE_OFF');
  const gmv = await h.call('POST', '/api/guppi/reschedule', { token: cust, body: { actionId: 'mv-off-0001', bookingId: mine, optionId: 'x.y', context: { bookingId: mine } }, headers: { 'idempotency-key': 'mv-off-0001' } });
  assert.equal(gmv.status, 503, JSON.stringify(gmv.body));
  attempts['features'] = 'guppi and reschedule switched off on every route';
  setting({ customerRescheduleEnabled: true, retentionDisputesEnabled: false });
  const rd = await h.post(`/api/bookings/${mine}/retention-dispute`, { reason: 'I want my retained money looked at again' }, cust);
  assert.equal(rd.status, 503); assert.equal(rd.body.error.code, 'FEATURE_OFF');
  setting({ retentionDisputesEnabled: true });

  // the switches bind customer routes only: the staff desk can still place a booking outside the online window (that is how the ground takes calls)
  const desk = await h.post('/api/staff/bookings', { ...body(before), customer: { name: 'Desk Person', phone: '9866600077' }, payment: { method: 'cash', amountPaise: 0 } }, staff);
  ev('staffDeskOutsideWindow', desk.status);
  ev('attempts', attempts);
  assert.ok(desk.status === 201 || desk.status === 400 || desk.status === 409, `the desk answers on its own rules (${desk.status})`);
});
