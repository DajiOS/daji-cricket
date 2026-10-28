// Daji OS owns the software; Daji Cricket Ground and Antroli Cricket Ground are two of its customers (white-label). Sunny's rule
// (28 Oct 2026): the two are completely separate and never see each other's data. These tests add Antroli the way the software
// owner does (Platform, Customers), fill both businesses with data, then try every route the server has, with the other business's
// ids put into the address and the query, and look for the other business's ids, names, phone numbers and emails in each answer.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, bookAndPay, dayFromNow, DEMO_ACCOUNTS, type Harness } from './helpers.ts';
import { buildRouter } from '../src/app.ts';
import { one, run } from '../src/db.ts';
import { request } from 'node:http';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });

/** fetch() will not send a Host header of its own, so a request "to" another web address goes through node:http. */
function viaHost(host: string, path: string): Promise<{ status: number; body: string }> {
  const u = new URL(h.url);
  return new Promise((res, rej) => {
    const rq = request({ host: u.hostname, port: u.port, path, method: 'GET', headers: { host } }, (r) => { let b = ''; r.setEncoding('utf8'); r.on('data', (c) => (b += c)); r.on('end', () => res({ status: r.statusCode!, body: b })); });
    rq.on('error', rej); rq.end();
  });
}

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082', 'hex');
const PASSWORD = 'Antroli-Ground-2026!';

interface World {
  admin: string; daji: string; dajiId: string; antroli: string; antroliId: string; antroliSlug: string;
  dajiGround: string; antroliGround: string; dajiBooking: any; dajiEnquiry: string; antroliEnquiry: string; customer: string; customerId: string;
}
let w: World;

async function addAntroli(admin: string) {
  const r = await h.post('/api/admin/businesses', { businessName: 'Antroli Cricket Ground', ownerName: 'Test Owner', phone: '9123456780', email: 'antroli-owner@example.test' }, admin);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}

async function world(): Promise<World> {
  h.reset();
  const admin = await h.login('admin');
  const daji = await h.login('owner1');
  const dajiId = (await h.get('/api/me', daji)).body.user.id;
  const b = await addAntroli(admin);
  assert.equal((await h.post(`/api/admin/users/${b.id}/password`, { password: PASSWORD }, admin)).status, 200);
  const lr = await h.post('/api/auth/login', { email: 'antroli-owner@example.test', password: PASSWORD });
  assert.equal(lr.status, 200, JSON.stringify(lr.body));
  const antroli = lr.body.token;
  const g = await h.post('/api/staff/grounds', { name: 'Antroli Main Turf', city: 'Surat', pricePaise: 150000, openTime: '07:00', closeTime: '22:00', slotMinutes: 60, maxSlots: 4 }, antroli);
  assert.equal(g.status, 201, JSON.stringify(g.body));
  const dajiGround = (await h.get('/api/staff/grounds', daji)).body.items[0].id;
  const customer = await h.login('customer');
  const customerId = (await h.get('/api/me', customer)).body.user.id;
  const dajiBooking = await bookAndPay(h, customer, dajiGround, dayFromNow(3), '19:00', 1);
  const de = await h.post('/api/enquiries', { groundId: dajiGround, name: 'Daji Enquirer', phone: '9822200011', message: 'A Daji enquiry about a match' }, customer);
  assert.equal(de.status, 201, JSON.stringify(de.body));
  const ae = await h.post(`/api/enquiries?business=${b.slug}`, { groundId: g.body.id, name: 'Antroli Enquirer', phone: '9833300022', preferredDate: dayFromNow(2), preferredTime: '08:00', preferredSlots: 1, message: 'Please book the Antroli turf' });
  assert.equal(ae.status, 201, JSON.stringify(ae.body));
  return { admin, daji, dajiId, antroli, antroliId: b.id, antroliSlug: b.slug, dajiGround, antroliGround: g.body.id, dajiBooking, dajiEnquiry: de.body.id, antroliEnquiry: ae.body.id, customer, customerId };
}

beforeEach(async () => { w = await world(); });

test('the software owner adds Antroli as a customer business: no password, nothing sent, and its figures are not in the list', async () => {
  const r = await h.get('/api/admin/businesses', w.admin);
  assert.equal(r.status, 200);
  assert.equal(r.body.softwareOwner, 'Daji OS');
  const names = r.body.items.map((x: any) => x.businessName);
  assert.ok(names.includes('Daji Cricket Ground') && names.includes('Antroli Cricket Ground'), JSON.stringify(names));
  // the list says who each business is and how far it is set up, never money
  for (const it of r.body.items) for (const k of Object.keys(it)) assert.doesNotMatch(k, /paise|revenue|paid|balance|amount|income|customers/i, k);
  // a second business pins the main website to the first, so Antroli's grounds never appear on Daji's site
  assert.equal(r.body.mainSiteBusinessId, w.dajiId);
  assert.equal(r.body.items.find((x: any) => x.id === w.dajiId).mainSite, true);
  // adding a business sends nothing: no message of any kind is queued for its owner
  const third = await h.post('/api/admin/businesses', { businessName: 'Third Test Ground', ownerName: 'Third Owner', phone: '9000022222', email: 'third@example.test' }, w.admin);
  assert.equal(third.status, 201, JSON.stringify(third.body));
  assert.equal(third.body.canSignIn, false, 'no password until the owner sets one');
  assert.equal(one<{ n: number }>('SELECT COUNT(*) n FROM notifications WHERE user_id = ?', third.body.id)?.n ?? 0, 0);
  // only the software owner can add one, and a business name or phone is never used twice
  assert.equal((await h.post('/api/admin/businesses', { businessName: 'X Ground', ownerName: 'X Y', phone: '9000011111', email: 'x@example.test' }, w.daji)).status, 403);
  assert.equal((await h.post('/api/admin/businesses', { businessName: 'antroli cricket ground', ownerName: 'X Y', phone: '9000011112', email: 'x2@example.test' }, w.admin)).status, 409);
  assert.equal((await h.post('/api/admin/businesses', { businessName: 'Another Ground', ownerName: 'X Y', phone: '9123456780', email: 'x3@example.test' }, w.admin)).status, 409);
  assert.equal((await h.post('/api/admin/businesses', { businessName: 'A', ownerName: '', phone: '12', email: 'nope' }, w.admin)).status, 400);
});

test('the main website shows only Daji, and Antroli\'s booking page shows only Antroli', async () => {
  const main = await grounds(h);
  assert.ok(main.length > 0 && main.every((g) => g.ownerId === w.dajiId), 'main site: Daji only');
  const page = (await h.get(`/api/grounds?business=${w.antroliSlug}`)).body.items;
  assert.deepEqual(page.map((g: any) => g.id), [w.antroliGround]);
  // a ground id from the other business answers 404 on each site
  assert.equal((await h.get(`/api/grounds/${w.antroliGround}`)).status, 404);
  assert.equal((await h.get(`/api/grounds/${w.antroliGround}/availability?date=${dayFromNow(2)}`)).status, 404);
  assert.equal((await h.get(`/api/grounds/${w.dajiGround}?business=${w.antroliSlug}`)).status, 404);
  assert.equal((await h.get(`/api/grounds/${w.dajiGround}/availability?date=${dayFromNow(2)}&business=${w.antroliSlug}`)).status, 404);
  assert.equal((await h.get(`/api/grounds/${w.antroliGround}/availability?date=${dayFromNow(2)}&business=${w.antroliSlug}`)).status, 200);
  // an enquiry sent from one business's page cannot be about the other's ground
  assert.equal((await h.post(`/api/enquiries?business=${w.antroliSlug}`, { groundId: w.dajiGround, name: 'Mixer', phone: '9844400033', message: 'Trying the other ground' })).status, 404);
  // an unknown page is a 404, never "every business"
  assert.equal((await h.get('/api/grounds?business=no-such-ground')).status, 404);
  // the page's brand: Antroli's name, never Daji's
  const sb = (await h.get(`/api/site-brand?business=${w.antroliSlug}`)).body;
  assert.equal(sb.business.name, 'Antroli Cricket Ground'); assert.equal(sb.softwareOwner, 'Daji OS');
  assert.doesNotMatch(JSON.stringify(sb), /Daji Cricket|dajicricket|7567156000/);
});

test('Antroli\'s own web address shows its booking page and its grounds only; certificates are only for business addresses', async () => {
  assert.equal((await h.put(`/api/desk/brand?ownerId=${w.antroliId}`, { siteDomain: 'https://www.AntroliCricket.example/' }, w.admin)).status, 200);
  assert.equal((await h.put('/api/desk/brand', { siteDomain: 'x.example' }, w.antroli)).status, 400, 'only the software owner sets the address');
  const list = await viaHost('www.antrolicricket.example', '/api/grounds');
  assert.deepEqual(JSON.parse(list.body).items.map((g: any) => g.id), [w.antroliGround]);
  const home = await viaHost('antrolicricket.example', '/');
  assert.equal(home.status, 200); assert.match(home.body, /white-label/);
  assert.match((await viaHost('antrolicricket.example', '/index.html')).body, /white-label/, 'the main site\'s page is never served there');
  const mainHome = await h.call('GET', '/');
  assert.doesNotMatch(String(mainHome.body), /white-label/);
  const page = await h.call('GET', `/b/${w.antroliSlug}`);
  assert.equal(page.status, 200); assert.match(String(page.body), /book\.js/);
  assert.equal((await h.get('/api/platform/domain-check?domain=antrolicricket.example')).status, 200);
  assert.equal((await h.get('/api/platform/domain-check?domain=evil.example')).status, 404);
  // a second business cannot take the same address
  const r = await h.put(`/api/desk/brand?ownerId=${w.dajiId}`, { siteDomain: 'antrolicricket.example' }, w.admin);
  assert.equal(r.status, 400);
});

test('each business brands its own desk and page: name, app name, ground logo and app logo; neither can touch the other\'s', async () => {
  const up = (token: string, kind: string, q = '') => fetch(`${h.url}/api/desk/brand/logo?kind=${kind}${q}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' }, body: PNG });
  const r = await up(w.antroli, 'logo');
  assert.equal(r.status, 200, await r.clone().text());
  const b = await r.json() as any;
  assert.match(b.logoUrl, /^\/api\/brand-logo\/[0-9a-f]{24}$/);
  assert.equal((await up(w.antroli, 'app')).status, 200);
  const img = await fetch(h.url + b.logoUrl);
  assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal((await h.put('/api/desk/brand', { name: 'Antroli Cricket', appName: 'Antroli' }, w.antroli)).status, 200);
  const mine = (await h.get('/api/desk/brand', w.antroli)).body;
  assert.equal(mine.name, 'Antroli Cricket'); assert.equal(mine.appName, 'Antroli'); assert.ok(mine.appLogoUrl);
  // Daji's desk still shows Daji, with no logo
  const dj = (await h.get('/api/desk/brand', w.daji)).body;
  assert.equal(dj.name, 'Daji Cricket Ground'); assert.equal(dj.logoUrl, null);
  // an owner cannot reach the other business's brand by changing ownerId (it is ignored for owners)
  await h.put(`/api/desk/brand?ownerId=${w.dajiId}`, { name: 'Hijacked' }, w.antroli);
  assert.equal((await h.get('/api/desk/brand', w.daji)).body.name, 'Daji Cricket Ground');
  // not a picture: refused
  const bad = await fetch(`${h.url}/api/desk/brand/logo?kind=logo`, { method: 'POST', headers: { authorization: `Bearer ${w.antroli}`, 'content-type': 'application/octet-stream' }, body: Buffer.from('<svg onload=alert(1)>') });
  assert.equal(bad.status, 415);
  // the upload went through the virus check and is logged against Antroli
  assert.ok(one("SELECT 1 FROM file_intake_log WHERE purpose = 'business_logo' AND outcome = 'stored' AND owner_id = ?", w.antroliId));
  // reminders carry the sending business's own name
  const t = (await h.get('/api/desk/reminders/templates', w.antroli)).body;
  const booking = t.items.find((x: any) => x.kind === 'booking');
  assert.match(booking.body, /\{business\}/);
});

test('Antroli\'s owner is refused the main website\'s settings, festivals, closed days, connections and compliance register', async () => {
  for (const [m, p, body] of [
    ['GET', '/api/admin/settings'], ['PUT', '/api/admin/settings', { freeCancelHours: 1 }], ['GET', '/api/admin/festivals'], ['GET', '/api/admin/design-packs'],
    ['GET', '/api/admin/closed-dates'], ['POST', '/api/admin/closed-dates', { dates: [dayFromNow(5)], closed: true }], ['GET', '/api/admin/integrations'],
    ['GET', '/api/compliance'], ['POST', '/api/compliance/check'],
  ] as [string, string, unknown?][]) {
    const r = await h.call(m, p, { token: w.antroli, body });
    assert.equal(r.status, 403, `${m} ${p}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    assert.doesNotMatch(JSON.stringify(r.body), /Daji Cricket|dajicricket/);
  }
  // Daji and the software owner keep them
  assert.equal((await h.get('/api/admin/settings', w.daji)).status, 200);
  assert.equal((await h.get('/api/compliance', w.daji)).status, 200);
  assert.equal((await h.get('/api/admin/settings', w.admin)).status, 200);
  // and the software owner alone names the software and picks the main site
  assert.equal((await h.put('/api/admin/settings', { softwareOwnerName: 'Someone Else' }, w.daji)).status, 403);
  assert.equal((await h.put('/api/admin/settings', { mainSiteBusinessId: w.antroliId }, w.daji)).status, 403);
  assert.equal((await h.put('/api/admin/settings', { mainSiteBusinessId: 'usr_nope' }, w.admin)).status, 400);
});

test('team terms name the team member\'s own business; Daji\'s wording and its accepted hash stay exactly as they were', async () => {
  const before = (await h.get('/api/legal/staff-terms', await h.login('staff1'))).body;
  assert.equal(before.docKey, 'staff_terms');
  const mk = await h.post('/api/staff/team', { name: 'Antroli Groundsman', email: 'groundsman@example.test', phone: '9811122233', password: 'Antroli-Staff-2026!', permissions: ['manage_bookings'] }, w.antroli);
  if (mk.status !== 201) return assert.fail(`could not add an Antroli team member: ${mk.status} ${JSON.stringify(mk.body)}`);
  const st = (await h.post('/api/auth/login', { email: 'groundsman@example.test', password: 'Antroli-Staff-2026!' })).body.token;
  const t = (await h.get('/api/legal/staff-terms', st)).body;
  assert.match(t.body, /Antroli Cricket Ground/); assert.doesNotMatch(t.body, /Daji/);
  assert.notEqual(t.docKey, 'staff_terms');
  assert.equal((await h.post('/api/legal/staff-terms/accept', { version: t.version, sha256: before.sha256 }, st)).status, 409, 'Daji\'s wording cannot be accepted for Antroli');
  assert.equal((await h.post('/api/legal/staff-terms/accept', { version: t.version, sha256: t.sha256 }, st)).status, 200);
  const rep = (await h.get('/api/legal/staff-terms/report', w.antroli)).body;
  assert.deepEqual(rep.items.map((x: any) => [x.name, !!x.acceptedAt]), [['Antroli Groundsman', true]]);
  assert.ok(!(await h.get('/api/legal/staff-terms/report', w.daji)).body.items.some((x: any) => x.name === 'Antroli Groundsman'));
});

test('the Directory: sign-ups belong to the main site\'s business, never to Antroli; Antroli sees only who contacted it', async () => {
  const signup = await h.post('/api/auth/register', { name: 'Fresh Signup', phone: '9811100077', email: 'fresh@example.test', password: 'Fresh-Signup-2026!' });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  const dajiList = (await h.get('/api/staff/contacts?who=account', w.daji)).body.items.map((x: any) => x.name);
  assert.ok(dajiList.includes('Fresh Signup'), 'Daji still sees its new sign-ups with three businesses on the platform');
  for (const who of ['account', 'all', 'booked', 'played']) {
    const txt = JSON.stringify((await h.get(`/api/staff/contacts?who=${who}`, w.antroli)).body);
    assert.doesNotMatch(txt, /Fresh Signup|Demo Customer|9876543210|customer@daji\.test/, who);
  }
  assert.equal((await h.get(`/api/staff/customers/${w.customerId}`, w.antroli)).status, 404);
});

test('Ask AI answers each business from its own records only, and says who owns the software', async () => {
  const ask = async (token: string, question: string) => (await h.post('/api/staff/ask', { question }, token)).body;
  const a = await ask(w.antroli, 'How many bookings did we have this month?');
  assert.doesNotMatch(JSON.stringify(a), /Daji Cricket|9876543210|Demo Customer|customer@daji/);
  const d = await ask(w.daji, 'How many bookings did we have this month?');
  assert.ok(d.answer);
  const who = await ask(w.antroli, 'Who owns this software?');
  assert.match(who.answer, /Daji OS owns and runs this software\. Antroli Cricket Ground is a customer business/);
  assert.doesNotMatch(who.answer, /Daji Cricket/);
  const comp = await ask(w.antroli, 'Which compliance rules are due for review?');
  assert.match(comp.answer, /Only the owner|not|cannot|do not have/i);
});

// ---- the sweep: every route, both ways

const SECRET_KEYS = (o: World, side: 'daji' | 'antroli') => side === 'daji'
  ? [o.dajiGround, o.dajiBooking.id, o.dajiBooking.ref, o.dajiEnquiry, o.customerId, o.dajiId, '9876543210', 'customer@daji.test', DEMO_ACCOUNTS.owner1.email, 'Daji Enquirer', '9822200011', 'Daji Cricket Ground', 'Demo Customer'].filter(Boolean)
  : [o.antroliGround, o.antroliEnquiry, o.antroliId, 'Antroli Enquirer', '9833300022', 'Antroli Cricket Ground', 'Antroli Main Turf', 'antroli-owner@example.test', '9123456780'];

/** Routes that are the same for everyone (the public website and a person's own account), or the software owner's only. */
const isPublic = (auth: unknown) => auth === undefined;

const swept = { calls: 0, ok: 0 };
async function sweep(token: string, other: 'daji' | 'antroli', headers?: Record<string, string>): Promise<string[]> {
  const leaks: string[] = [];
  const secrets = SECRET_KEYS(w, other);
  const ids = secrets.slice(0, other === 'daji' ? 6 : 3) as string[];
  const routes = buildRouter().routes;
  for (const r of routes) {
    if (isPublic(r.opts.auth)) continue;
    if (Array.isArray(r.opts.auth) && r.opts.auth.length === 1 && r.opts.auth[0] === 'super_admin') continue;
    // platform services (Settings, Connections) are named by the service, not by a business's id; the main site's owner tests them
    if (r.re.source.includes('integrations')) continue;
    const pattern = r.re.source.replace(/^\^/, '').replace(/\/\?\$$/, '').replace(/\\\//g, '/');
    if (/stream|live|camera/.test(pattern)) continue; // long-running picture streams
    // a change can only be aimed at the other business through an id in the address; changes with no id (sign out, a new record of
    // one's own) are left out so the sweep does not sign itself out
    if (r.method !== 'GET' && !r.keys.length) continue;
    // switched to a business of the portfolio, the person's own account (who am I, sign-in) is still theirs by design
    if (headers && /^\/api\/(me|auth)\b/.test(pattern)) continue;
    const fills = r.keys.length ? ids : [''];
    for (const id of fills) {
      let path = pattern;
      for (let i = 0; i < r.keys.length; i++) path = path.replace('([^/]+)', encodeURIComponent(id));
      path += (path.includes('?') ? '&' : '?') + `ownerId=${encodeURIComponent(other === 'daji' ? w.dajiId : w.antroliId)}`;
      const res = await h.call(r.method, path, { token, headers, body: r.method === 'GET' || r.method === 'DELETE' ? undefined : {} });
      swept.calls++;
      if (res.status >= 200 && res.status < 300) {
        swept.ok++;
        const txt = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
        const sent = new Set([id, other === 'daji' ? w.dajiId : w.antroliId]);
        const hit = secrets.filter((s) => !sent.has(s) && txt.includes(s));
        if (hit.length) leaks.push(`${r.method} ${path} -> ${res.status} shows ${hit.join(', ')}`);
        if (r.method !== 'GET' && r.keys.length) leaks.push(`${r.method} ${path} -> ${res.status} accepted a change on the other business's ${r.keys.join('/')}`);
      }
    }
  }
  return leaks;
}

test('sweep: Antroli\'s owner, on every route, with Daji\'s ids in the address and the query, sees and changes nothing of Daji\'s', async () => {
  const before = JSON.stringify(one('SELECT status, paid_paise, total_paise FROM bookings WHERE id = ?', w.dajiBooking.id));
  swept.calls = 0; swept.ok = 0;
  const leaks = await sweep(w.antroli, 'daji');
  assert.deepEqual(leaks, []);
  // the sweep really ran: hundreds of calls, many answered (so the answers were read), not a list of refusals
  assert.ok(swept.calls > 400 && swept.ok > 80, JSON.stringify(swept));
  console.log(`sweep Antroli->Daji: ${swept.calls} calls, ${swept.ok} answered`);
  assert.equal(JSON.stringify(one('SELECT status, paid_paise, total_paise FROM bookings WHERE id = ?', w.dajiBooking.id)), before, 'Daji\'s booking is untouched');
  assert.ok(one("SELECT 1 FROM grounds WHERE id = ? AND active = 1", w.dajiGround), 'Daji\'s ground is untouched');
});

test('sweep: Daji\'s owner, on every route, with Antroli\'s ids in the address and the query, sees and changes nothing of Antroli\'s', async () => {
  swept.calls = 0; swept.ok = 0;
  const leaks = await sweep(w.daji, 'antroli');
  assert.deepEqual(leaks, []);
  assert.ok(swept.calls > 400 && swept.ok > 80, JSON.stringify(swept));
  console.log(`sweep Daji->Antroli: ${swept.calls} calls, ${swept.ok} answered`);
  assert.ok(one("SELECT 1 FROM grounds WHERE id = ? AND active = 1", w.antroliGround), 'Antroli\'s ground is untouched');
  assert.ok(one("SELECT 1 FROM enquiries WHERE id = ? AND status = 'new'", w.antroliEnquiry), 'Antroli\'s enquiry is untouched');
});

test('sweep: Daji\'s owner switched to Antroli from the portfolio, on every route, with Daji\'s ids, sees and changes nothing of Daji\'s', async () => {
  assert.equal((await h.post(`/api/admin/businesses/${w.antroliId}/portfolio`, { userId: w.dajiId }, w.admin)).status, 200);
  const before = JSON.stringify(one('SELECT status, paid_paise, total_paise FROM bookings WHERE id = ?', w.dajiBooking.id));
  swept.calls = 0; swept.ok = 0;
  const leaks = await sweep(w.daji, 'daji', { 'x-daji-business': w.antroliId });
  assert.deepEqual(leaks, []);
  assert.ok(swept.calls > 400 && swept.ok > 80, JSON.stringify(swept));
  console.log(`sweep portfolio Daji-as-Antroli->Daji: ${swept.calls} calls, ${swept.ok} answered`);
  assert.equal(JSON.stringify(one('SELECT status, paid_paise, total_paise FROM bookings WHERE id = ?', w.dajiBooking.id)), before, 'Daji\'s booking is untouched');
});

test('control: the same sweep does find Daji\'s data when it is run as the software owner, so a leak would be caught', async () => {
  const leaks = await sweep(w.admin, 'daji');
  assert.ok(leaks.some((l) => l.includes('/api/staff/bookings')), leaks.slice(0, 5).join('\n'));
});

test('exports and reports are made for the asking business, with its own name', async () => {
  for (const p of ['/api/accounting/reports/pnl?from=2026-04-01&to=2027-03-31&format=pdf', '/api/staff/contacts/export', '/api/accounting/transactions/export']) {
    const r = await h.call('GET', p, { token: w.antroli });
    if (r.status !== 200) continue; // a business with nothing to export may answer otherwise; it must still not show Daji's
    const txt = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    assert.doesNotMatch(txt, /Daji Cricket|9876543210|Demo Customer|customer@daji/, p);
  }
  void run;
});

test('GST invoice numbers start with each business\'s own initials; Daji keeps DCG', async () => {
  const a = await h.get('/api/accounting/gst-profile', w.antroli);
  assert.equal(a.status, 200); assert.equal(a.body.prefix, 'ACG');
  const d = await h.get('/api/accounting/gst-profile', w.daji);
  assert.equal(d.status, 200); assert.equal(d.body.prefix, 'DCG');
});

// Sunny (28 Oct 2026): "add Antroli Cricket Ground to my portfolio", for testing now, separated later. One owner sign-in opens
// both businesses, each still answered from its own records only; taking Antroli out of the portfolio splits them at once.
test('portfolio: Daji\'s owner switches to Antroli and back; each answer is that business\'s only; removing it splits them again', async () => {
  const as = (ownerId: string) => ({ token: w.daji, headers: { 'x-daji-business': ownerId } });
  // not in the portfolio yet: refused, and nothing of Antroli's comes back
  const before = await h.call('GET', '/api/staff/grounds', as(w.antroliId));
  assert.equal(before.status, 403); assert.equal(before.body.error.code, 'NOT_IN_PORTFOLIO');
  // only the software owner adds it; Antroli's owner and Daji's owner cannot
  assert.equal((await h.post(`/api/admin/businesses/${w.antroliId}/portfolio`, { userId: w.dajiId }, w.daji)).status, 403);
  assert.equal((await h.post(`/api/admin/businesses/${w.antroliId}/portfolio`, { userId: w.dajiId }, w.antroli)).status, 403);
  assert.equal((await h.post(`/api/admin/businesses/${w.antroliId}/portfolio`, { userId: w.customerId }, w.admin)).status, 400);
  const add = await h.post(`/api/admin/businesses/${w.antroliId}/portfolio`, { userId: w.dajiId }, w.admin);
  assert.equal(add.status, 200, JSON.stringify(add.body)); assert.deepEqual(add.body.items.map((x: any) => x.userId), [w.dajiId]);
  const pf = (await h.get('/api/me/portfolio', w.daji)).body.items;
  assert.deepEqual(pf.map((x: any) => [x.id, x.own]), [[w.dajiId, true], [w.antroliId, false]]);
  assert.equal(pf[1].businessName, 'Antroli Cricket Ground');
  // switched to Antroli: Antroli's grounds and enquiries only, none of Daji's
  const g = await h.call('GET', '/api/staff/grounds', as(w.antroliId));
  assert.equal(g.status, 200); assert.deepEqual(g.body.items.map((x: any) => x.id), [w.antroliGround]);
  const enq = JSON.stringify((await h.call('GET', '/api/staff/enquiries', as(w.antroliId))).body);
  assert.match(enq, /Antroli Enquirer/); assert.doesNotMatch(enq, /Daji Enquirer|9822200011/);
  // Daji's ground or booking asked for while switched to Antroli: not found
  assert.equal((await h.call('PATCH', `/api/staff/grounds/${w.dajiGround}`, { ...as(w.antroliId), body: { name: 'Taken over' } })).status, 404);
  // back on Daji (no header): Daji's only
  const dg = (await h.get('/api/staff/grounds', w.daji)).body.items.map((x: any) => x.id);
  assert.ok(dg.includes(w.dajiGround)); assert.ok(!dg.includes(w.antroliGround));
  // the profile stays the person's own; a change made while switched is logged under the real person, in Antroli's log
  assert.equal((await h.call('GET', '/api/me', as(w.antroliId))).body.user.id, w.dajiId);
  const put = await h.call('PUT', '/api/desk/brand', { ...as(w.antroliId), body: { name: 'Antroli Cricket Ground', appName: 'Antroli Test' } });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const row = one<{ actor_id: string; owner_id: string; detail: string }>("SELECT actor_id, owner_id, detail FROM audit_log WHERE action LIKE 'business.brand%' ORDER BY id DESC LIMIT 1");
  assert.ok(row, 'the brand change is in the audit log');
  assert.equal(row!.actor_id, w.dajiId); assert.equal(row!.owner_id, w.antroliId); assert.match(row!.detail, /viaPortfolio/);
  // Antroli's own owner is not given Daji by this
  assert.equal((await h.call('GET', '/api/staff/grounds', { token: w.antroli, headers: { 'x-daji-business': w.dajiId } })).status, 403);
  // removed: the very next request is refused, and Antroli's data is still all there for its own owner
  assert.equal((await h.del(`/api/admin/businesses/${w.antroliId}/portfolio/${w.dajiId}`, w.admin)).status, 200);
  assert.equal((await h.call('GET', '/api/staff/grounds', as(w.antroliId))).status, 403);
  assert.deepEqual((await h.get('/api/me/portfolio', w.daji)).body.items.map((x: any) => x.id), [w.dajiId]);
  assert.deepEqual((await h.get('/api/staff/grounds', w.antroli)).body.items.map((x: any) => x.id), [w.antroliGround]);
});
