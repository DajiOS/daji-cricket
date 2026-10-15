import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, bookAndPay, dayFromNow, type Harness, type GroundLite } from './helpers.ts';
import { loadConfig, parsePublicUrl, wwwSibling, configWarnings, razorpayConfigured, originAllowed } from '../src/config.ts';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { buildServer } from '../src/app.ts';
import { seedDemo } from '../src/seed.ts';
import { marketing, notify, registerProvider, flushNotifications } from '../src/notifications.ts';
import { many, one } from '../src/db.ts';
import { getGateway } from '../src/gateway.ts';
import { register } from './register.ts';

// ------------------------------------------------------------------ configuration (no server needed)

test('PUBLIC_URL drives the defaults: localhost is a demo, a real domain is not', () => {
  const local = loadConfig({});
  assert.equal(local.isLocal, true);
  assert.equal(local.demoMode, true);
  assert.equal(local.corsOrigins, '*');
  assert.equal(local.backup.enabled, false);

  const prod = loadConfig({ PUBLIC_URL: 'https://dajicricket.com', JWT_SECRET: 'x'.repeat(40) });
  assert.equal(prod.isLocal, false);
  assert.equal(prod.demoMode, false, 'demo accounts with public passwords never come up on a real domain by accident');
  assert.deepEqual(prod.corsOrigins, ['https://dajicricket.com', 'https://www.dajicricket.com']);
  assert.equal(prod.backup.enabled, true);
  assert.equal(prod.publicUrl, 'https://dajicricket.com');
});

test('a real domain refuses to start without a proper JWT secret', () => {
  assert.throws(() => loadConfig({ PUBLIC_URL: 'https://dajicricket.com' }), /JWT_SECRET/);
  assert.throws(() => loadConfig({ PUBLIC_URL: 'https://dajicricket.com', JWT_SECRET: 'short' }), /JWT_SECRET/);
});

test('PUBLIC_URL is validated; a trailing path is dropped; the www sibling is derived', () => {
  assert.throws(() => parsePublicUrl('dajicricket.com'), /not a valid URL/);
  assert.throws(() => parsePublicUrl('ftp://dajicricket.com'), /http/);
  assert.equal(loadConfig({ PUBLIC_URL: 'https://dajicricket.com/some/path/', JWT_SECRET: 'x'.repeat(40) }).publicUrl, 'https://dajicricket.com');
  assert.equal(wwwSibling(new URL('https://dajicricket.com')), 'https://www.dajicricket.com');
  assert.equal(wwwSibling(new URL('https://www.dajicricket.com')), 'https://dajicricket.com');
  assert.equal(wwwSibling(new URL('http://localhost:4000')), null);
  assert.equal(wwwSibling(new URL('http://192.168.1.5:4000')), null);
});

test('explicit settings beat the defaults', () => {
  const c = loadConfig({ PUBLIC_URL: 'https://dajicricket.com', JWT_SECRET: 'x'.repeat(40), DEMO_MODE: 'true', CORS_ORIGINS: 'https://a.example, https://b.example', TRUST_PROXY: '1', BACKUP_ENABLED: 'no' });
  assert.equal(c.demoMode, true);
  assert.deepEqual(c.corsOrigins, ['https://a.example', 'https://b.example']);
  assert.equal(c.trustProxy, true);
  assert.equal(c.backup.enabled, false);
});

test('warnings tell the owner what is not set up yet', () => {
  const w = configWarnings(loadConfig({ PUBLIC_URL: 'https://dajicricket.com', JWT_SECRET: 'x'.repeat(40) }));
  assert.ok(w.some((x) => /Razorpay/i.test(x)));
});

test('real Razorpay keys switch the demo gateway off', () => {
  const demo = loadConfig({});
  assert.equal(razorpayConfigured(demo), false);
  assert.equal(getGateway(demo)?.demo, true);
  const real = loadConfig({ RAZORPAY_KEY_ID: 'rzp_test_abc', RAZORPAY_KEY_SECRET: 'sec', RAZORPAY_WEBHOOK_SECRET: 'whsec' });
  assert.equal(razorpayConfigured(real), true);
  assert.equal(getGateway(real)?.demo, false);
  const none = loadConfig({ PUBLIC_URL: 'https://dajicricket.com', JWT_SECRET: 'x'.repeat(40) });
  assert.equal(getGateway(none), null, 'no keys on a real domain means no demo gateway');
});

// ------------------------------------------------------------------ demo seed safety and notifications (with a database)

let h: Harness;
let g: GroundLite;
let cust: string;

before(async () => { h = await startHarness(); });
after(async () => { registerProvider('email', null); registerProvider('sms', null); await h.close(); });
beforeEach(async () => {
  h.reset();
  registerProvider('email', null);
  registerProvider('sms', null);
  g = (await grounds(h))[0]!;
  cust = await h.login('customer');
});

test('the demo seed refuses to run when demo mode is off, and never runs twice', () => {
  const prod = loadConfig({ PUBLIC_URL: 'https://dajicricket.com', JWT_SECRET: 'x'.repeat(40) });
  assert.throws(() => seedDemo(prod), /DEMO_MODE/);
  assert.deepEqual(seedDemo(loadConfig({})), { created: false }, 'data already there');
});

test('a booking writes transactional notifications; with no provider they stay queued', async () => {
  const b = await bookAndPay(h, cust, g.id, dayFromNow(3), '19:00', 1);
  const rows = many<{ channel: string; status: string; template: string; category: string }>('SELECT * FROM notifications WHERE booking_id = ? AND template = ?', b.id, 'booking_confirmed');
  assert.deepEqual(rows.map((r) => r.channel).sort(), ['email', 'sms']);
  assert.ok(rows.every((r) => r.status === 'queued' && r.category === 'transactional'));
  const text = one<{ body: string }>("SELECT body FROM notifications WHERE booking_id = ? AND template = 'booking_confirmed' AND channel = 'email'", b.id)!.body;
  assert.match(text, new RegExp(b.ref));
  assert.match(text, /₹/);
});

test('a configured provider sends the message and the row becomes "sent"; a failing one becomes "failed"', async () => {
  const sent: string[] = [];
  registerProvider('email', (m) => { sent.push(`${m.to}|${m.template}`); return { ok: true }; });
  registerProvider('sms', () => { throw new Error('gateway down'); });
  const b = await bookAndPay(h, cust, g.id, dayFromNow(3), '19:00', 1);
  await flushNotifications();
  assert.ok(sent.includes('customer@daji.test|booking_confirmed'));
  const email = one<{ status: string }>("SELECT status FROM notifications WHERE booking_id = ? AND channel = 'email' AND template = 'booking_confirmed'", b.id)!;
  const sms = one<{ status: string; skip_reason: string }>("SELECT status, skip_reason FROM notifications WHERE booking_id = ? AND channel = 'sms' AND template = 'booking_confirmed'", b.id)!;
  assert.equal(email.status, 'sent');
  assert.equal(sms.status, 'failed');
  assert.match(sms.skip_reason, /gateway down/);
  assert.equal((await h.get(`/api/bookings/${b.id}`, cust)).status, 200, 'a failing provider never breaks the booking');
});

test('marketing messages need consent for that channel; transactional ones do not', async () => {
  const id = (await h.get('/api/me', cust)).body.user.id;
  assert.deepEqual(marketing(id, 'email', 'promo', 'Offer', 'Weekend nets 20% off'), { sent: false, reason: 'no email marketing consent' });
  const skipped = one<{ status: string; skip_reason: string }>("SELECT status, skip_reason FROM notifications WHERE category = 'marketing' AND user_id = ?", id)!;
  assert.equal(skipped.status, 'skipped');

  const opted = await register(h, 'Opted In', '9811200200', { consent: { email: true } });
  const optedId = (await h.get('/api/me', opted)).body.user.id;
  assert.equal(marketing(optedId, 'email', 'promo', 'Offer', 'Weekend nets 20% off').sent, true);
  assert.equal(marketing(optedId, 'sms', 'promo', 'Offer', 'x').sent, false, 'consent is per channel');

  notify(id, 'credit_expired', { creditPaise: 5000 });
  assert.ok(many("SELECT 1 FROM notifications WHERE user_id = ? AND category = 'transactional' AND template = 'credit_expired'", id).length >= 1);
});

test('consent can be changed by the customer and is audited', async () => {
  const r = await h.patch('/api/me', { consent: { email: true, sms: false, whatsapp: true } }, cust);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.user.consent.email, true);
  assert.equal(r.body.user.consent.whatsapp, true);
  assert.ok(r.body.user.consent.updatedAt);
  assert.ok(many("SELECT 1 FROM audit_log WHERE action = 'consent.update'").length >= 1);
});

// ------------------------------------------------------------------ Wix: the site is on Wix, the API is on its own host

/** Another HTTP front on the database the harness already opened, with its own configuration. */
async function extraServer(env: Record<string, string>) {
  const cfg = loadConfig({ PUBLIC_URL: 'http://localhost:4000', RATE_LIMIT: 'off', LOG: 'off', DEMO_MODE: 'on', ...env });
  const server = buildServer(cfg);
  await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    call: (method: string, path: string, opts: { headers?: Record<string, string> } = {}) => fetch(base + path, { method, headers: opts.headers }).then(async (r) => { await r.arrayBuffer(); return { status: r.status, headers: r.headers }; }),
    close: () => new Promise<void>((res) => { server.close(() => res()); server.closeAllConnections(); }),
  };
}

test('the API address defaults to api.<domain> and can be overridden', () => {
  const prod = loadConfig({ PUBLIC_URL: 'https://dajicricket.com', JWT_SECRET: 'x'.repeat(40) });
  assert.equal(prod.apiUrl, 'https://api.dajicricket.com');
  assert.equal(loadConfig({ PUBLIC_URL: 'https://www.dajicricket.com', JWT_SECRET: 'x'.repeat(40) }).apiUrl, 'https://api.dajicricket.com', 'www is dropped');
  assert.equal(loadConfig({}).apiUrl, 'http://localhost:4000');
  assert.equal(loadConfig({ PUBLIC_URL: 'https://dajicricket.com', JWT_SECRET: 'x'.repeat(40), API_URL: 'https://booking.dajicricket.com/' }).apiUrl, 'https://booking.dajicricket.com');
  assert.throws(() => loadConfig({ API_URL: 'api.dajicricket.com' }), /API_URL/);
  assert.deepEqual(prod.frameAncestors, ['https://dajicricket.com', 'https://www.dajicricket.com']);
  assert.deepEqual(loadConfig({ PUBLIC_URL: 'https://dajicricket.com', JWT_SECRET: 'x'.repeat(40), FRAME_ANCESTORS: 'https://a.example' }).frameAncestors, ['https://a.example']);
  assert.ok(configWarnings(loadConfig({ PUBLIC_URL: 'https://dajicricket.com', JWT_SECRET: 'x'.repeat(40), API_URL: 'http://api.dajicricket.com' })).some((x) => /API_URL/.test(x)));
});

test('CORS allow-list: exact origins and *.host patterns, nothing else', () => {
  const list = ['https://dajicricket.com', 'https://www.dajicricket.com', 'https://*.wixsite.com'];
  assert.equal(originAllowed(list, 'https://dajicricket.com'), true);
  assert.equal(originAllowed(list, 'https://www.dajicricket.com'), true);
  assert.equal(originAllowed(list, 'https://dajicricket.wixsite.com'), true);
  assert.equal(originAllowed(list, 'https://a.b.wixsite.com'), true, 'several labels');
  assert.equal(originAllowed(list, 'https://wixsite.com'), false, 'the bare domain is not a sub-domain');
  assert.equal(originAllowed(list, 'https://evilwixsite.com'), false, 'a suffix match must be on a dot');
  assert.equal(originAllowed(list, 'https://wixsite.com.evil.example'), false);
  assert.equal(originAllowed(list, 'http://dajicricket.wixsite.com'), false, 'scheme must match');
  assert.equal(originAllowed(list, 'http://dajicricket.com'), false);
  assert.equal(originAllowed(list, 'https://dajicricket.com/path'), false, 'not an origin');
  assert.equal(originAllowed(list, 'null'), false);
  assert.equal(originAllowed(list, undefined), false);
  assert.equal(originAllowed('*', undefined), true);
});

test('a Wix page can call the API: preflight and responses carry the right CORS headers', async () => {
  const w = await extraServer({ CORS_ORIGINS: 'https://dajicricket.com,https://www.dajicricket.com,https://*.wixsite.com' });
  try {
    const pre = await w.call('OPTIONS', '/api/bookings', { headers: { origin: 'https://www.dajicricket.com', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), 'https://www.dajicricket.com');
    assert.match(pre.headers.get('access-control-allow-headers') ?? '', /Authorization/i);
    assert.equal(pre.headers.get('vary'), 'Origin');

    const preview = await w.call('GET', '/api/grounds', { headers: { origin: 'https://dajicricket.wixsite.com' } });
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get('access-control-allow-origin'), 'https://dajicricket.wixsite.com');

    const other = await w.call('GET', '/api/grounds', { headers: { origin: 'https://evil.example' } });
    assert.equal(other.status, 200, 'the request itself is served; the browser is what refuses to hand it to the page');
    assert.equal(other.headers.get('access-control-allow-origin'), null);
  } finally { await w.close(); }
});

test('the web app can be framed by the Wix site only; the API never can', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'daji-web-'));
  mkdirSync(join(dir, 'embed'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>app</title>');
  writeFileSync(join(dir, 'embed', 'daji-widgets.js'), 'customElements.define("daji-booking", class extends HTMLElement {});');
  const w = await extraServer({ WEB_DIR: dir, FRAME_ANCESTORS: 'https://dajicricket.com,https://www.dajicricket.com', CORS_ORIGINS: 'https://dajicricket.com' });
  try {
    const page = await w.call('GET', '/');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy') ?? '', /frame-ancestors 'self' https:\/\/dajicricket\.com https:\/\/www\.dajicricket\.com$/);
    assert.equal(page.headers.get('x-frame-options'), null, 'X-Frame-Options: DENY would override the policy and block Wix');

    const api = await w.call('GET', '/api/grounds');
    assert.equal(api.headers.get('x-frame-options'), 'DENY');
    assert.equal(api.headers.get('content-security-policy'), null);

    const widget = await w.call('GET', '/embed/daji-widgets.js');
    assert.equal(widget.status, 200);
    assert.match(widget.headers.get('content-type') ?? '', /javascript/);
    assert.equal(widget.headers.get('access-control-allow-origin'), '*', 'Wix loads the script from another origin');
    assert.equal(widget.headers.get('cross-origin-resource-policy'), 'cross-origin');
    assert.equal((await w.call('GET', '/index.html')).headers.get('access-control-allow-origin'), null, 'only /embed/ is open');
    assert.equal((await w.call('GET', '/embed/%2e%2e/index.html')).headers.get('access-control-allow-origin'), null, 'no path trick into the open folder');
  } finally { await w.close(); rmSync(dir, { recursive: true, force: true }); }
});
