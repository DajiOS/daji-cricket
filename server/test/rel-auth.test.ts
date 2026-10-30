import { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, DEMO_ACCOUNTS, type Harness } from './helpers.ts';
import { buildScenario, type Scenario } from './scenario.ts';
import { buildRouter } from '../src/app.ts';
import { db, many, one, run } from '../src/db.ts';
import { rel, ev } from './rel.ts';

let h: Harness, sc: Scenario;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => { sc = await buildScenario(h); });

const idOf = (email: string) => one<{ id: string }>('SELECT id FROM users WHERE email = ?', email)!.id;
/** A team member of owner1 with exactly the rights given (none by default). */
async function teamMember(name: string, permissions: string[] = []): Promise<{ token: string; id: string }> {
  const email = `${name.toLowerCase().replace(/\W+/g, '')}@x.test`;
  const r = await h.post('/api/staff/team', { name, email, password: 'Member@12345', permissions }, sc.owner);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const l = await h.post('/api/auth/login', { email, password: 'Member@12345' });
  return { token: l.body.token, id: r.body.user?.id ?? idOf(email) };
}

// ------------------------------------------------------------------ REL-AUTH-001

rel('REL-AUTH-001', 'a disabled person, or a person whose business is disabled, loses access on the very next request', async () => {
  const staffId = idOf(DEMO_ACCOUNTS.staff1.email);
  assert.equal((await h.get('/api/staff/bookings', sc.staff)).status, 200);
  assert.equal((await h.patch(`/api/admin/users/${staffId}`, { active: false }, sc.admin)).status, 200);
  const after1 = await h.get('/api/staff/bookings', sc.staff);
  assert.equal(after1.status, 401, 'the staff member\'s old token no longer works');
  assert.equal((await h.post('/api/auth/login', { email: DEMO_ACCOUNTS.staff1.email, password: DEMO_ACCOUNTS.staff1.password })).status, 403, 'and they cannot sign in again');
  assert.equal((await h.patch(`/api/admin/users/${staffId}`, { active: true }, sc.admin)).status, 200);

  // switching the business off cuts off its team too
  const staff2 = await h.login('staff1');
  assert.equal((await h.get('/api/staff/bookings', staff2)).status, 200);
  assert.equal((await h.patch(`/api/admin/users/${sc.ownerId}`, { active: false }, sc.admin)).status, 200);
  assert.equal((await h.get('/api/staff/bookings', staff2)).status, 401, 'team of a disabled business');
  assert.equal((await h.get('/api/staff/bookings', sc.owner)).status, 401, 'the disabled owner');
  assert.equal((await h.patch(`/api/admin/users/${sc.ownerId}`, { active: true }, sc.admin)).status, 200);
  sc.owner = await h.login('owner1'); // the old token stays dead after a disable; a fresh sign-in works

  // a disabled customer cannot hold slots with a token they already had
  const custId = idOf(DEMO_ACCOUNTS.customer.email);
  assert.equal((await h.patch(`/api/admin/users/${custId}`, { active: false }, sc.admin)).status, 200);
  const g = (await h.get('/api/grounds')).body.items[0];
  assert.equal((await h.post('/api/bookings', { groundId: g.id, date: '2026-11-20', startTime: '19:00', slots: 1 }, sc.cust)).status, 401);

  // taking a permission away applies at once, without signing in again
  const m = await teamMember('Perm Revoke', ['manage_bookings']);
  assert.equal((await h.get('/api/staff/bookings', m.token)).status, 200);
  assert.equal((await h.patch(`/api/staff/team/${m.id}`, { permissions: [] }, sc.owner)).status, 200);
  const revoked = (await h.get('/api/staff/bookings', m.token)).status;
  assert.ok(revoked === 401 || revoked === 403, `a member whose rights were removed is refused (${revoked})`);
  ev('afterDisable', { staff: after1.status, ownerBusinessStaff: 401, customer: 401, permissionRevoked: revoked });
});

// ------------------------------------------------------------------ REL-AUTH-002

rel('REL-AUTH-002', 'when permissions cannot be read or are damaged, access is refused, never granted', async () => {
  const m = await teamMember('Damaged Rights', ['manage_bookings', 'view_revenue', 'view_reports']);
  assert.equal((await h.get('/api/staff/bookings', m.token)).status, 200);
  for (const bad of ['{not json', '"manage_bookings"', '{"manage_bookings":true}', 'null', '[1,2,3]']) {
    run('UPDATE users SET permissions = ? WHERE id = ?', bad, m.id);
    const a = await h.get('/api/staff/bookings', m.token);
    assert.equal(a.status, 403, `damaged rights ${bad} grant nothing`);
    const b = await h.get('/api/accounting/overview?ownerId=' + sc.ownerId, m.token);
    assert.equal(b.status, 403, bad);
  }
  // the database cannot answer the access check: 503, not a 200 and not a sign-out
  db().exec('ALTER TABLE revoked_tokens RENAME TO revoked_tokens_off');
  try {
    const r = await h.get('/api/staff/bookings', sc.owner);
    assert.equal(r.status, 503);
    assert.equal(r.body.error.code, 'AUTH_UNAVAILABLE');
    assert.ok(!JSON.stringify(r.body).includes('items'), 'no data came with the refusal');
    const pub = await h.get('/api/grounds');
    assert.equal(pub.status, 200, 'public pages do not depend on the access check');
  } finally { db().exec('ALTER TABLE revoked_tokens_off RENAME TO revoked_tokens'); }
  assert.equal((await h.get('/api/staff/bookings', sc.owner)).status, 200, 'and access returns when the check works again');
  ev('damagedValuesTried', 5);
});

// ------------------------------------------------------------------ REL-AUTH-003

rel('REL-AUTH-003', 'one customer cannot see or act on another customer\'s bookings, payments, credit or enquiries', async () => {
  const other = (await h.post('/api/auth/register', { name: 'Other Person', phone: '9811199999', email: 'other.person@example.test', password: 'Passw0rd!x' })).body.token;
  const mine = sc.b.future; // belongs to Asha, not to "other" and not to the demo customer
  const asha = (await h.post('/api/auth/login', { email: one<{ email: string }>('SELECT email FROM users WHERE id = ?', mine.customerId)!.email, password: 'Passw0rd!x' }));
  assert.equal(asha.status, 200);
  assert.equal((await h.get(`/api/bookings/${mine.id}`, asha.body.token)).status, 200, 'the owner of the booking can');
  const probes: [string, string, unknown?][] = [
    ['GET', `/api/bookings/${mine.id}`], ['POST', `/api/bookings/${mine.id}/cancel`, {}], ['GET', `/api/bookings/${mine.id}/cancel-preview`],
    ['POST', `/api/bookings/${mine.id}/upi-reference`, { utr: '123456789012' }], ['POST', `/api/bookings/${mine.id}/resolve`, { choice: 'refund' }],
    ['GET', `/api/bookings/${mine.id}/series`], ['POST', `/api/bookings/${mine.id}/cancel-series`, {}],
  ];
  const results: Record<string, number> = {};
  for (const [m, p, body] of probes) {
    const r = await h.call(m, p, { token: other, body });
    results[`${m} ${p.replace(mine.id, ':id')}`] = r.status;
    assert.ok(r.status === 404 || r.status === 403, `${m} ${p} -> ${r.status}`);
    assert.ok(!JSON.stringify(r.body).includes(mine.ref), 'the reference is not leaked');
  }
  // a payment order belonging to someone else cannot be verified by me
  const pay = one<{ rp_order_id: string }>("SELECT rp_order_id FROM payments WHERE booking_id = ? AND rp_order_id IS NOT NULL", mine.id)!;
  const v = await h.post('/api/payments/razorpay/verify', { orderId: pay.rp_order_id, paymentId: 'pay_x', signature: 'abc' }, other);
  assert.equal(v.status, 404);
  // lists only ever hold my own rows
  const list = (await h.get('/api/bookings', other)).body.items as { customerId: string }[];
  assert.equal(list.length, 0);
  const myOwn = (await h.get('/api/bookings', asha.body.token)).body.items as { customerId: string }[];
  assert.ok(myOwn.length > 0 && myOwn.every((b) => b.customerId === mine.customerId));
  assert.equal((await h.get('/api/credits', other)).body.balancePaise ?? 0, 0);
  ev('probeStatuses', results);
});

// ------------------------------------------------------------------ REL-AUTH-004

rel('REL-AUTH-004', 'one business never sees another business\'s records or totals, and a request cannot choose another business', async () => {
  const mineIds = (await h.get('/api/staff/bookings?limit=200', sc.owner)).body.items.map((b: any) => b.id) as string[];
  const theirIds = (await h.get('/api/staff/bookings?limit=200', sc.owner2)).body.items.map((b: any) => b.id) as string[];
  assert.ok(mineIds.length > 0 && theirIds.length > 0);
  assert.deepEqual(mineIds.filter((x) => theirIds.includes(x)), [], 'the two lists share nothing');
  assert.ok(theirIds.includes(sc.b.other.id) && !mineIds.includes(sc.b.other.id));
  // owner2 asks for owner1\'s booking, payments, refunds, customers: not found, with the same answer as an unknown id
  const unknown = await h.get('/api/staff/bookings/bkg_doesnotexist', sc.owner2);
  const foreign = await h.get(`/api/staff/bookings/${sc.b.played.id}`, sc.owner2);
  assert.equal(foreign.status, 404);
  assert.deepEqual(foreign.body, unknown.body, 'a real booking of another business looks exactly like one that does not exist');
  // choosing another business by query is ignored for owners and staff
  const viaQuery = (await h.get(`/api/staff/bookings?limit=200&ownerId=${sc.ownerId}`, sc.owner2)).body.items.map((b: any) => b.id) as string[];
  assert.deepEqual(viaQuery.sort(), [...theirIds].sort());
  const staffViaQuery = await h.get(`/api/staff/payments?ownerId=${sc.owner2Id}`, sc.staff);
  for (const p of staffViaQuery.body.items ?? []) assert.notEqual(p.bookingId, sc.b.other.id);
  // totals: each owner's P&L is built from their own bookings only
  const pnl1 = (await h.get('/api/accounting/reports/pnl', sc.owner)).body, pnl2 = (await h.get('/api/accounting/reports/pnl', sc.owner2)).body;
  assert.notDeepEqual(pnl1, pnl2);
  const pay1 = (await h.get('/api/staff/payments?limit=200', sc.owner)).body.items as { bookingId: string }[];
  assert.ok(pay1.every((p) => mineIds.includes(p.bookingId)), 'owner1 payments belong to owner1 bookings');
  const adminNeedsOwner = await h.get('/api/accounting/reports/pnl', sc.admin);
  assert.equal(adminNeedsOwner.status, 400, 'the platform admin must name the business; there is no silent all-business total');
  ev('counts', { owner1Bookings: mineIds.length, owner2Bookings: theirIds.length });
});

// ------------------------------------------------------------------ REL-AUTH-005 / REL-AUTH-008

rel('REL-AUTH-005', 'a team member without "Can see revenue" gets no revenue, books, or customer-spend figures, from any screen', async () => {
  const noRev = await teamMember('Front Desk Only', ['manage_bookings', 'view_customers', 'view_reports', 'manage_accounting']);
  const rev = await teamMember('Revenue Viewer', ['manage_bookings', 'view_customers', 'view_reports', 'view_revenue']);
  const q = `?ownerId=${sc.ownerId}`;
  const money = ['/api/accounting/overview', '/api/accounting/reports/pnl', '/api/accounting/reports/balance-sheet', '/api/accounting/reports/trial-balance', '/api/accounting/reports/ledger?account=revenue', '/api/accounting/reports/cash-flow', '/api/accounting/reports/customer-balances', '/api/accounting/transactions', '/api/desk/money-flow'];
  const seen: Record<string, [number, number]> = {};
  for (const p of money) {
    const url = p + (p.includes('?') ? '&' : '?') + `ownerId=${sc.ownerId}`;
    const denied = await h.get(url, noRev.token);
    const allowed = await h.get(url, rev.token);
    seen[p] = [denied.status, allowed.status];
    assert.ok(denied.status === 403, `${p} for a member without revenue rights -> ${denied.status}`);
    assert.ok(allowed.status !== 403, `${p} for a member with revenue rights is not blocked (${allowed.status})`);
  }
  // per-customer totals are revenue too
  const list = await h.get('/api/staff/contacts?limit=50', noRev.token);
  assert.equal(list.status, 200);
  assert.ok(list.body.items.length > 0 && list.body.items.every((c: any) => c.paidPaise === null), 'the "paid" figure is withheld, not shown as zero');
  const full = await h.get('/api/staff/contacts?limit=50', rev.token);
  assert.ok(full.body.items.some((c: any) => typeof c.paidPaise === 'number' && c.paidPaise > 0));
  // Ask AI does not answer money questions for them
  const ask = await h.post('/api/staff/ask', { question: 'What was the revenue for the past 30 days?' }, noRev.token);
  assert.ok(ask.status === 403 || !/₹\s?[\d,]{3,}/.test(JSON.stringify(ask.body)), `ask answered with money: ${JSON.stringify(ask.body).slice(0, 200)}`);
  ev('statusesDeniedAllowed', seen);
  ev('askStatus', ask.status);
  void q;
});

rel('REL-AUTH-008', 'exports and search never carry financial figures to someone who may not see them, and never cross businesses', async () => {
  const noRev = await teamMember('Export Clerk', ['view_customers', 'view_reports']);
  const rev = await teamMember('Export Revenue', ['view_customers', 'view_reports', 'view_revenue']);
  const ex = (token: string, qs = '') => h.call('GET', `/api/staff/contacts/export${qs}`, { token });
  const a = await ex(noRev.token), b = await ex(rev.token);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.ok(!String(a.body).includes('Total paid'), 'no spend column without revenue rights');
  assert.ok(String(b.body).includes('Total paid'));
  assert.ok(!/₹/.test(String(a.body)), 'no rupee amounts at all');
  // the accounting export is closed to them, and to a different business
  assert.equal((await h.get(`/api/accounting/transactions/export?ownerId=${sc.ownerId}`, noRev.token)).status, 403);
  const own = await h.get(`/api/accounting/transactions/export?ownerId=${sc.owner2Id}`, rev.token);
  assert.ok([200, 403, 404].includes(own.status));
  if (own.status === 200) assert.ok(!String(own.body).includes('Riverside'), 'asking for another business through ownerId returns the member\'s own business');
  // another business\'s customers do not appear in this business\'s export or lookup
  const rivalCustomer = one<{ name: string }>('SELECT u.name FROM bookings b JOIN users u ON u.id = b.customer_id WHERE b.owner_id = ? LIMIT 1', sc.owner2Id)!.name;
  assert.ok(!String(b.body).includes(rivalCustomer), 'export holds only this business\'s customers');
  const lookup = await h.get(`/api/staff/customers?q=${encodeURIComponent(rivalCustomer.split(' ')[0]!)}`, sc.owner);
  assert.ok(!JSON.stringify(lookup.body).includes(rivalCustomer), 'search holds only this business\'s customers');
  ev('exportColumnsWithoutRevenue', String(a.body).split('\n')[0]);
});

// ------------------------------------------------------------------ REL-AUTH-007

rel('REL-AUTH-007', 'there is no unprotected way to the data: every route refuses anonymous callers, wrong roles are refused, and the database file is not served', async () => {
  const router = buildRouter();
  // POST /api/bookings/quote (rev5, reviewed): the price of a selection before a hold, for signed-out visitors as for customers. It writes nothing
  // (REL-FIX-009-002), refuses a promo code without sign-in, gives account credit only to the signed-in customer, and is rate-limited like every route.
  // GET /api/site-brand, /api/brand-logo/:p and /api/platform/domain-check (reviewed, white-label sites): the name and logo a booking page
  // shows, the logo picture itself, and the yes/no Caddy asks before it gets a certificate. No figures, no customers, no other business.
  const PUBLIC = new Set(['GET /api/site-brand', 'GET /api/brand-logo/:p', 'GET /api/platform/domain-check', 'POST /api/bookings/quote', 'GET /api/health', 'GET /api/festival', 'GET /api/config', 'GET /api/grounds', 'GET /api/grounds/:p', 'GET /api/grounds/:p/availability', 'POST /api/enquiries', 'POST /api/auth/register', 'POST /api/auth/logout',
    'POST /api/auth/login', 'POST /api/auth/password/forgot', 'POST /api/auth/password/reset', 'POST /api/auth/otp/request', 'POST /api/auth/otp/verify', 'GET /api/avatar/:p', 'POST /api/webhooks/razorpay', 'GET /api/unsubscribe', 'POST /api/unsubscribe',
    'POST /api/webhooks/yodlee', 'POST /api/webhooks/aa/:p', 'GET /api/matches', 'GET /api/matches/:p', 'POST /api/platform/leads', 'GET /api/media/:p', 'GET /api/library/public', 'PUT /api/cameras/:p/frame', 'GET /api/cameras/:p/stream', 'GET /api/cameras/:p/snapshot',
    // reviewed: Microsoft or Google sends the browser back here after a shared-sheet sign-in; it acts only on a one-time, ten-minute state and answers with a redirect only
    'GET /api/sheets/oauth/callback',
    // reviewed (inbound WhatsApp, wainbox.ts): Meta calls these. The GET answers only Meta's subscribe check and only with the right verify token;
    // the POST is refused unless signed with the app secret over the raw body (X-Hub-Signature-256), and keeps nothing while the feature is off
    'GET /api/webhooks/whatsapp', 'POST /api/webhooks/whatsapp']);
  const pat = (r: { re: RegExp }) => r.re.source.replace(/^\^/, '').replace(/\\\/\?\$$/, '').replace(/\/\?\$$/, '').replace(/\\\//g, '/').replace(/\(\[\^\/\]\+\)/g, ':p');
  const publicNow = router.routes.filter((r) => r.opts.auth === undefined).map((r) => `${r.method} ${pat(r)}`).sort();
  assert.deepEqual(publicNow, [...PUBLIC].sort(), 'the set of routes that need no sign-in is exactly the reviewed list; a new open route fails this test until it is reviewed');
  const sample = (r: { re: RegExp }) => pat(r).replace(/:p/g, 'x');
  let anonChecked = 0, roleChecked = 0;
  const failures: string[] = [];
  for (const r of router.routes) {
    if (r.opts.auth === undefined) continue;
    const path = sample(r);
    const anon = await h.call(r.method, path, { body: r.method === 'GET' ? undefined : {} });
    anonChecked++;
    if (anon.status !== 401) failures.push(`${r.method} ${path} anonymous -> ${anon.status}`);
    if (Array.isArray(r.opts.auth) && !r.opts.auth.includes('customer')) {
      const c = await h.call(r.method, path, { token: sc.cust, body: r.method === 'GET' ? undefined : {} });
      roleChecked++;
      if (c.status !== 403) failures.push(`${r.method} ${path} as customer -> ${c.status}`);
    }
  }
  assert.deepEqual(failures, []);
  // the database and data folders are not reachable as web files
  for (const p of ['/daji.db', '/data/daji.db', '/../data/daji.db', '/%2e%2e/data/daji.db', '/..%2fdata%2fdaji.db', '/server/schema.lock.json', '/.env', '/deploy/.env']) {
    const r = await h.call('GET', p, {});
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    assert.ok(!text.startsWith('SQLite format 3') && !/JWT_SECRET|FIELD_KEY/.test(text), `${p} did not serve secrets`);
  }
  // a refused call carries nothing about the data it protected
  const secret = await h.get(`/api/staff/bookings/${sc.b.played.id}`);
  assert.equal(secret.status, 401);
  assert.ok(!JSON.stringify(secret.body).includes(sc.b.played.ref));
  ev('routesTotal', router.routes.length);
  ev('anonymousChecks', anonChecked);
  ev('wrongRoleChecks', roleChecked);
  ev('publicRoutes', publicNow);
  void many;
});
