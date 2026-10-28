import { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { startHarness, grounds, bookAndPay, dayFromNow, type Harness, type GroundLite } from './helpers.ts';
import { one, run } from '../src/db.ts';
import { REGISTER, MERGED, resolveRoute } from '../../desk/src/routes.ts';
import { rel, ev } from './rel.ts';

// Daji Admin left panel and tabs correction (27 Oct 2026). The register's 82 routes now open real desk pages, a register route that nothing serves
// says so instead of falling back to the dashboard, and the two workspace tabs that needed data the desk could not read have a read-only endpoint:
// the messages sent about one booking, and the staff member's own Guppi questions.

let h: Harness, g: GroundLite, cust: string, staff: string, owner: string, owner2: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset();
  g = (await grounds(h)).find((x) => x.name === 'Cricket Ground')!;
  cust = await h.login('customer'); staff = await h.login('staff1'); owner = await h.login('owner1'); owner2 = await h.login('owner2');
});
const ROOT = new URL('../../', import.meta.url).pathname;
const read = (f: string) => readFileSync(ROOT + f, 'utf8');

rel('REL-DESK-001', 'every one of the register\'s 82 routes resolves: to a desk page that exists, or to a plain "not built" page with its reason', () => {
  assert.equal(REGISTER.length, 82);
  assert.deepEqual(REGISTER.map((r) => r.row), Array.from({ length: 82 }, (_, i) => i + 1));
  assert.equal(new Set(REGISTER.map((r) => r.route)).size, 82, 'each route once');
  // the desk's page table, read from its source (the desk is a browser bundle, so the test reads the paths rather than importing React)
  const pages = [...read('desk/src/registry.ts').matchAll(/\{ path: '([^']+)', page: \w+ \}/g)].map((m) => m[1]!);
  const served = (p: string) => p === '/' || pages.some((x) => p === x || p.startsWith(x + '/'));
  const out = REGISTER.map((r) => {
    const sample = r.route.replace(':id', 'x_1');
    const res = resolveRoute(sample);
    if (r.to) { assert.ok(!res.unserved, `${r.route} should be served`); assert.ok(served(res.path), `${r.route} → ${res.path} has no page`); }
    else { assert.equal(res.unserved?.row, r.row, `${r.route} should say it is not built`); assert.ok(r.note && r.note.length > 20, `${r.route} needs its reason`); }
    if (r.finding === 'MISSING' || r.finding === 'NOT APPLICABLE') assert.equal(r.to, null, `${r.route}: a missing row cannot also be served`);
    return { row: r.row, route: '/desk' + r.route.replace(/^\/$/, ''), opens: r.to ? res.path : null, finding: r.finding };
  });
  // the fixed words win over an id: /bookings/calendar is the calendar, not a booking called "calendar"
  assert.equal(resolveRoute('/bookings/calendar').path, '/calendar');
  assert.equal(resolveRoute('/bookings/new').path, '/bookings/new');
  assert.equal(resolveRoute('/bookings/bk_9/money').path, '/bookings/bk_9/money');
  assert.equal(resolveRoute('/customers/u_7/activity').path, '/contacts/u_7/activity');
  assert.equal(resolveRoute('/matches/live').path, '/matches/live'); // Live score is the Live now tab of Fixtures
  assert.equal(resolveRoute('/finance/gst').path, '/accounting/gst');
  // older addresses still open what they always opened
  for (const old of ['/accounting/gst', '/bookings/day', '/settings/prices', '/payroll/attendance', '/hub/finance', '/']) assert.equal(resolveRoute(old).path, old);
  const counts = out.reduce<Record<string, number>>((a, r) => ({ ...a, [r.finding]: (a[r.finding] ?? 0) + 1 }), {});
  ev('counts', counts); ev('routes', out);
});

rel('REL-DESK-002', 'a booking\'s Messages tab reads what the customer was sent about that booking, for staff who manage bookings in that business only', async () => {
  const b = await bookAndPay(h, cust, g.id, dayFromNow(3), '09:00', 1);
  const mine = await h.get(`/api/staff/bookings/${b.id}/messages`, staff);
  assert.equal(mine.status, 200, JSON.stringify(mine.body));
  const inDb = one<{ n: number }>('SELECT COUNT(*) n FROM notifications WHERE booking_id = ?', b.id)!.n;
  assert.ok(inDb > 0, 'a paid booking sends at least its confirmation');
  assert.equal(mine.body.items.length, inDb, 'every message logged for the booking, and only those');
  for (const m of mine.body.items) assert.ok(m.channel && m.status && m.createdAt, 'channel, status and time on each');
  assert.equal((await h.get(`/api/staff/bookings/${b.id}/messages`, owner)).status, 200);
  // another business cannot read it, and a team member without the bookings permission cannot either
  const other = await h.get(`/api/staff/bookings/${b.id}/messages`, owner2);
  assert.ok(other.status === 404 || other.status === 403, `other owner got ${other.status}`);
  run("UPDATE users SET permissions = '[\"view_customers\"]' WHERE email = 'staff1@daji.test'");
  const denied = await h.get(`/api/staff/bookings/${b.id}/messages`, staff);
  assert.equal(denied.status, 403);
  assert.equal((await h.get(`/api/staff/bookings/${b.id}/messages`, cust)).status, 403, 'customers have no staff route');
  // reading writes nothing
  const before = one<{ n: number }>('SELECT COUNT(*) n FROM audit_log')!.n;
  await h.get(`/api/staff/bookings/${b.id}/messages`, owner);
  assert.equal(one<{ n: number }>('SELECT COUNT(*) n FROM audit_log')!.n, before);
  ev('booking', b.ref); ev('messages', mine.body.items.map((m: any) => ({ channel: m.channel, status: m.status, category: m.category }))); ev('otherOwnerStatus', other.status); ev('withoutPermissionStatus', denied.status);
});

rel('REL-DESK-003', 'Guppi history shows a person their own questions in this business, never anyone else\'s, and no answers', async () => {
  const q1 = await h.post('/api/staff/ask', { question: 'How many bookings today?' }, staff);
  assert.equal(q1.status, 200, JSON.stringify(q1.body));
  await h.post('/api/staff/ask', { question: 'What was the revenue this month?' }, owner);
  const mine = await h.get('/api/staff/ask/history', staff);
  assert.equal(mine.status, 200, JSON.stringify(mine.body));
  assert.deepEqual(mine.body.items.map((x: any) => x.question), ['How many bookings today?']);
  const theirs = await h.get('/api/staff/ask/history', owner);
  assert.deepEqual(theirs.body.items.map((x: any) => x.question), ['What was the revenue this month?']);
  assert.ok(!JSON.stringify(mine.body).includes(q1.body.answer), 'answers are not kept or shown');
  const other = await h.get('/api/staff/ask/history', owner2);
  assert.deepEqual(other.body.items, [], 'another business sees none of these');
  assert.equal((await h.get('/api/staff/ask/history', cust)).status, 403);
  ev('staffHistory', mine.body.items); ev('ownerHistory', theirs.body.items.map((x: any) => x.question)); ev('otherBusinessCount', other.body.items.length);
});

rel('REL-DESK-004', 'the desk workspaces show a failed load as a failure and a refused one as not allowed, never as an empty list or a zero', () => {
  const ui = read('desk/src/ui.tsx');
  assert.match(ui, /status === 403[\s\S]*data-state="denied"/);
  assert.match(ui, /data-state="failed" role="alert"/);
  // empty is only drawn once the data has arrived
  assert.ok(ui.indexOf('data-state="loading"') < ui.indexOf('data-state="empty"'));
  for (const f of ['desk/src/parts/customers/Workspace.tsx', 'desk/src/pages/Enquiries.tsx', 'desk/src/pages/Blocks.tsx', 'desk/src/pages/Guppi.tsx']) assert.match(read(f), /<Load /, `${f} uses the shared states`);
  assert.match(read('desk/src/parts/dash/Detail.tsx'), /<Load data=\{d\} error=\{err\} status=\{status\}/);
  // the customer's credit is the server's ledger figure, not a sum of payments made in the browser
  assert.doesNotMatch(read('desk/src/parts/customers/Workspace.tsx'), /reduce\(/);
  ev('checked', ['ui.tsx Load', 'Workspace', 'Enquiries', 'Blocks', 'Guppi', 'Detail messages']);
});

// Found on the live desk after the V2 merge (27 Oct 2026).
rel('REL-DESK-005', 'no desk or website class name is one that ad blockers hide, so rows never vanish for a visitor with an ad blocker', () => {
  // EasyList (the list most ad blockers use) hides elements by class names such as .ad-line and .ad-grid. The desk used both for its settings and
  // team rows, so with an ad blocker the team list, Online payments, Connections and Services looked empty. Names starting like an advert are kept out.
  const BLOCKED = /(^|[\s"'`.{])(ad|ads|advert|advertisement|sponsor|sponsored|adbox|adslot)[-_][a-z0-9]/i;
  const files = [...readdirSync(ROOT + 'desk/src', { recursive: true }) as string[]].filter((f) => /\.tsx?$/.test(f)).map((f) => 'desk/src/' + f)
    .concat((readdirSync(ROOT + 'desk/styles') as string[]).map((f) => 'desk/styles/' + f))
    .concat((readdirSync(ROOT + 'web/public') as string[]).filter((f) => /\.(js|css|html)$/.test(f)).map((f) => 'web/public/' + f));
  const hits: string[] = [];
  for (const f of files) {
    const src = read(f);
    for (const m of src.matchAll(/class(?:Name)?\s*[=:]\s*(?:\{`|["'`])([^"'`]*)/g)) if (BLOCKED.test(' ' + m[1])) hits.push(`${f}: ${m[1]!.slice(0, 60)}`);
    if (f.endsWith('.css')) for (const m of src.matchAll(/\.([a-z][a-z0-9_-]*)/gi)) if (BLOCKED.test('.' + m[1])) hits.push(`${f}: .${m[1]}`);
  }
  assert.deepEqual(hits, []);
  ev('filesScanned', files.length);
});

rel('REL-DESK-006', 'Contacts says when someone last played and their next booking apart, and the dashboard counts the same people Contacts lists', async () => {
  const b = await bookAndPay(h, cust, g.id, dayFromNow(4), '10:00', 1);
  const res = await h.get('/api/staff/contacts?who=booked', owner);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const me = res.body.items.find((x: any) => x.timesPlayed >= 1)!;
  assert.equal(me.lastPastAt, null, 'a booking ahead is not a game played');
  assert.equal(me.nextAt, one<{ start_at: number }>('SELECT start_at FROM bookings WHERE id = ?', b.id)!.start_at);
  // the dashboard tile reads the Contacts list itself, and the reach chips only name channels the person agreed to
  assert.match(read('desk/src/pages/Dashboard.tsx'), /'\/api\/staff\/contacts\?who=booked&limit=1'/);
  assert.match(read('desk/src/pages/Contacts.tsx'), /filter\(\(k\) => c\.reachable\[k\]\)/);
  const csv = await fetch(h.url + '/api/staff/contacts/export?who=booked', { headers: { authorization: 'Bearer ' + owner } }).then((r) => r.text());
  assert.match(csv.split('\n')[0]!, /Last played,Next booking/);
  ev('contact', { timesPlayed: me.timesPlayed, lastPastAt: me.lastPastAt, nextAt: me.nextAt });
});

rel('REL-DESK-007', 'a page whose data is refused or fails stops loading: Approvals for front-desk staff, and the refusal pages', () => {
  // Approvals waited for the approval chains, which the server shows only to someone who signs a step; front-desk staff saw "Loading" for ever.
  assert.match(read('desk/src/pages/Approvals.tsx'), /\(!ruled \|\| reqs \|\| reqsErr\)/);
  for (const [f, pat] of [['desk/src/pages/Bills.tsx', /!data \? \(err \? null/], ['desk/src/parts/bills/VendorsTab.tsx', /!data \? \(err \? null/], ['desk/src/pages/Media.tsx', /!lib \? \(err \? null/],
    ['desk/src/pages/Cameras.tsx', /!data \? \(error \? null/], ['desk/src/pages/Reminders.tsx', /!hErr && <Loading/]] as const) assert.match(read(f), pat, f);
  // a super admin's Team terms list is scoped to the business being looked at, like every other owner page
  assert.match(read('desk/src/lib.ts'), /OWNER_SCOPED = \['\/api\/legal\/staff-terms\/report'/);
  ev('checked', ['Approvals', 'Bills', 'Vendors', 'Media', 'Cameras', 'Reminders', 'Team terms scope']);
});

rel('REL-DESK-008', 'a tournament on the books is listed: a booking made on a tournament price shows under upcoming tournaments and is found by searching "tournament"', async () => {
  // Found on the live desk: a customer's tournament booking ("Saturday tournament" price) appeared nowhere as a tournament, because the Tournaments page
  // only listed tournaments set up there and the dashboard listed only today.
  const t = await bookAndPay(h, cust, g.id, dayFromNow(9), '07:00', 2);
  const plain = await bookAndPay(h, cust, g.id, dayFromNow(10), '07:00', 1);
  run("UPDATE bookings SET format_label = 'Saturday tournament' WHERE id = ?", t.id);
  const up = await h.get('/api/staff/bookings?kind=tournament&upcoming=1&group=1', owner);
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.deepEqual(up.body.items.map((b: any) => b.id), [t.id], 'the tournament booking, and not the ordinary one');
  assert.equal(up.body.items[0].formatLabel, 'Saturday tournament');
  const found = await h.get('/api/staff/bookings?q=tournament', owner);
  assert.ok(found.body.items.some((b: any) => b.id === t.id) && !found.body.items.some((b: any) => b.id === plain.id), 'search finds it by its type');
  // a cancelled or finished one is no longer upcoming, and another business never sees it
  run("UPDATE bookings SET status = 'cancelled' WHERE id = ?", t.id);
  assert.deepEqual((await h.get('/api/staff/bookings?kind=tournament&upcoming=1', owner)).body.items, []);
  run("UPDATE bookings SET status = 'confirmed' WHERE id = ?", t.id);
  const other = await h.get('/api/staff/bookings?kind=tournament&upcoming=1', owner2);
  assert.ok(other.status === 403 || other.body.items.length === 0, `other owner got ${other.status}`);
  // the dashboard and the Tournaments page both show the list
  assert.match(read('desk/src/pages/Dashboard.tsx'), /<UpcomingTournaments /);
  assert.match(read('desk/src/pages/Tournaments.tsx'), /<UpcomingTournaments \/>/);
  ev('upcoming', up.body.items.map((b: any) => ({ ref: b.ref, formatLabel: b.formatLabel, date: b.date })));
});

rel('REL-DESK-009', 'tab strips never show a lone up/down scrollbar', () => {
  // overflow-x: auto alone lets the browser scroll a strip up and down as well: Windows then drew up/down arrows beside the dashboard's tabs
  const css = ['desk/styles/zz-look.css', 'desk/styles/admin.css', 'desk/styles/books.css', 'desk/styles/zzz-club.css'].map(read).join('\n');
  for (const sel of ['.xtabs', '.tabs-scroll', '.bk-tabs', '.ws-tabs']) {
    const rule = css.match(new RegExp('^\\' + sel + ' \\{[^}]*\\}', 'm'))?.[0] ?? '';
    assert.match(rule, /overflow-y: hidden/, sel);
  }
});

rel('REL-DESK-010', 'the bookings list and month calendar keep every ordinary booking once a multi-day booking exists', async () => {
  // Found on the live desk: an ordinary booking has no series_index (NULL), so "NOT (series_index > 0 AND ...)" was NULL and dropped
  // every ordinary booking from the grouped list as soon as one multi-day booking existed. The calendar said "0 bookings this month".
  const plain = await bookAndPay(h, cust, g.id, dayFromNow(2), '07:00', 1);
  const blk = await h.post('/api/staff/bookings/block', { groundId: g.id, fromDate: dayFromNow(20), toDate: dayFromNow(22), startTime: '07:00', endTime: '22:00', totalPaise: 3_000_000, customer: { name: 'Tejpal Mali', phone: '9637333770' }, payment: { method: 'upi', amountPaise: 1_500_000, reference: 'UTRBLOCK0001' } }, owner);
  assert.equal(blk.status, 201, JSON.stringify(blk.body));
  const list = await h.get('/api/staff/bookings?group=1&limit=50', owner);
  const ids = list.body.items.map((b: any) => b.id);
  assert.ok(ids.includes(plain.id), 'the ordinary booking is still listed');
  assert.equal(list.body.items.filter((b: any) => b.seriesId === blk.body.series.id).length, 1, 'the multi-day booking is one row');
  const cal = await h.get(`/api/staff/bookings?group=1&from=${dayFromNow(0)}&to=${dayFromNow(30)}&limit=200`, owner);
  assert.ok(cal.body.items.some((b: any) => b.id === plain.id), 'the month calendar range finds it too');
  ev('listed', ids.length);
});

rel('REL-DESK-011', 'the owner deletes a cancelled multi-day booking from every screen once its refund is paid; the books keep the record', async () => {
  // Asked for on the live desk: a cancelled multi-day booking (refunded) could not be removed. The owner chose "delete from every screen":
  // money records are never deleted (finevents.ts), so the row stays for the books and only leaves the lists.
  const body = { groundId: g.id, fromDate: dayFromNow(40), toDate: dayFromNow(42), startTime: '07:00', endTime: '22:00', totalPaise: 3_000_000, customer: { name: 'Tejpal Mali', phone: '9637333770' }, payment: { method: 'upi', amountPaise: 1_600_000, reference: 'UTRTEJPAL001' } };
  const blk = (await h.post('/api/staff/bookings/block', body, owner)).body;
  const first = blk.bookings[0].id as string;
  assert.equal((await h.post(`/api/staff/bookings/${first}/delete`, {}, owner)).status, 409, 'not while it is still booked');
  assert.equal((await h.post(`/api/staff/bookings/block/${blk.series.id}/cancel`, { reason: 'Ground closed', settle: 'refund' }, owner)).status, 200);
  // nothing is owed on a cancelled booking (the desk showed "Balance ₹2,39,000" on the live one)
  assert.equal((await h.get(`/api/staff/bookings/${first}`, owner)).body.block.balancePaise, 0);
  // the advance was spread over the days, so there is one refund per day it landed on
  const refunds = (await h.get('/api/staff/refunds', owner)).body.items.filter((r: any) => blk.bookings.some((b: any) => b.id === r.bookingId) && r.status !== 'done');
  assert.ok(refunds.length > 0, 'cancelling with a refund leaves refunds to pay');
  const open = await h.post(`/api/staff/bookings/${first}/delete`, {}, owner);
  assert.equal(open.status, 409, 'a refund still to pay blocks it');
  assert.equal(open.body.error.code, 'REFUND_OPEN');
  const admin = await h.login('admin');
  for (const r of refunds) {
    assert.equal((await h.post(`/api/admin/refunds/${r.id}/approve`, {}, admin)).status, 200, 'the software owner authorises it');
    const done = await h.post(`/api/staff/refunds/${r.id}/complete`, { reference: 'UTRBACK' + r.id.slice(-4) }, owner);
    assert.equal(done.status, 200, JSON.stringify(done.body));
  }
  const bsBefore = (await h.get(`/api/accounting/reports/balance-sheet?asOf=${dayFromNow(0)}`, owner)).body;
  assert.equal((await h.post(`/api/staff/bookings/${first}/delete`, {}, staff)).status, 403, 'front desk staff cannot delete');
  assert.equal((await h.post(`/api/staff/bookings/${first}/delete`, {}, owner2)).status, 404, 'another business cannot see it');
  const del = await h.post(`/api/staff/bookings/${first}/delete`, {}, owner);
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal(del.body.deleted, 3, 'every day of the multi-day booking');
  const list = (await h.get('/api/staff/bookings?group=1&limit=100', owner)).body.items;
  assert.ok(!list.some((b: any) => b.seriesId === blk.series.id), 'gone from the list');
  assert.ok(!(await h.get('/api/staff/bookings?status=cancelled&limit=100', owner)).body.items.some((b: any) => b.seriesId === blk.series.id), 'gone from the cancelled filter too');
  assert.equal(one<{ n: number }>('SELECT COUNT(*) n FROM bookings WHERE series_id = ?', blk.series.id)!.n, 3, 'the records stay for the books');
  const bsAfter = (await h.get(`/api/accounting/reports/balance-sheet?asOf=${dayFromNow(0)}`, owner)).body;
  assert.equal(bsAfter.balanced, true);
  assert.equal(bsAfter.totalAssetsPaise, bsBefore.totalAssetsPaise, 'deleting changes nothing in the books');
  assert.equal(bsAfter.totalLiabilitiesPaise, bsBefore.totalLiabilitiesPaise);
  // an ordinary booking that is not cancelled cannot be deleted
  const plain = await bookAndPay(h, cust, g.id, dayFromNow(3), '07:00', 1);
  assert.equal((await h.post(`/api/staff/bookings/${plain.id}/delete`, {}, owner)).body.error.code, 'NOT_CANCELLED');
  ev('deleted', del.body);
});

rel('REL-DESK-012', 'a multi-day booking with a balance is one payment reminder, not one per day', async () => {
  const body = { groundId: g.id, fromDate: dayFromNow(5), toDate: dayFromNow(8), startTime: '07:00', endTime: '22:00', totalPaise: 4_000_000, customer: { name: 'Pune Corporate League', phone: '9890000444' }, payment: { method: 'upi', amountPaise: 1_000_000, reference: 'UTRPCL00001' } };
  const blk = await h.post('/api/staff/bookings/block', body, owner);
  assert.equal(blk.status, 201, JSON.stringify(blk.body));
  const q = (await h.get('/api/desk/reminders/queue', owner)).body;
  const mine = q.items.filter((i: any) => i.kind === 'payment' && i.name === 'Pune Corporate League');
  assert.equal(mine.length, 1, 'one reminder for the whole booking');
  assert.match(mine[0].summary, /₹30,000/, mine[0].summary);
});

rel('REL-DESK-013', 'the Accounting tabs run in the same order as the menu on the left', () => {
  // Reported on the live desk: the menu lists Overview, Reconcile, Books, GST, ... but the tabs ran Overview, Books review, Reports, Reconcile, ...,
  // so each menu item opened a tab somewhere in the middle of the strip
  const reg = read('desk/src/registry.ts');
  const finance = reg.slice(reg.indexOf("{ section: 'finance'"), reg.indexOf("{ section: 'work'"));
  const menu = [...finance.matchAll(/to: '\/accounting(?:\/(\w+))?'/g)].map((m) => m[1] ?? 'overview');
  const tabs = [...read('desk/src/pages/Accounting.tsx').matchAll(/\['(\w+)', '[^']+'\]/g)].map((m) => m[1]!);
  assert.deepEqual(tabs.filter((t) => menu.includes(t)), menu);
  ev('order', tabs);
});

rel('REL-DESK-014', 'every menu item opens a page: its address is a register route that is served, or a desk page itself', () => {
  // Found while adding Documents: "Compare months" had the address /reports/compare, which is not a register route and not a page, so it opened the dashboard
  const reg = read('desk/src/registry.ts');
  const pages = [...reg.matchAll(/\{ path: '([^']+)', page: \w+ \}/g)].map((m) => m[1]!);
  const nav = reg.slice(reg.indexOf('export const NAV'), reg.indexOf('export const hrefOf'));
  const items = [...nav.matchAll(/\{ to: '([^']+)'(?:, href: '([^']+)')?, label: '([^']+)'/g)].map((m) => ({ to: m[1]!, href: m[2] ?? m[1]!, label: m[3]! }));
  assert.ok(items.length > 50, `read ${items.length} menu items`);
  const served = (p: string) => p === '/' || pages.some((x) => p === x || p.startsWith(x + '/'));
  for (const i of items) {
    const r = resolveRoute(i.href);
    assert.ok(!r.unserved, `${i.label} (${i.href}) is a register row nothing serves`);
    assert.ok(served(r.path), `${i.label}: ${i.href} resolves to ${r.path}, which no page serves`);
    assert.ok(served(resolveRoute(i.to).path), `${i.label}: its page ${i.to} does not exist`);
  }
  ev('menu items', items.length);
});

rel('REL-DESK-015', 'pages that showed the same things are merged, and every old address opens the page that now holds it', () => {
  // Asked for by the owner (28 Oct 2026, all seven): Month end and the Month-end tab, Reconcile and Books review, Banking and Bank import,
  // Approvals and the two booking queues, the software owner's pages, Live score and Fixtures, Compare and the Bookings report.
  const reg = read('desk/src/registry.ts');
  const pages = [...reg.matchAll(/\{ path: '([^']+)', page: \w+ \}/g)].map((m) => m[1]!);
  const served = (p: string) => p === '/' || pages.some((x) => p === x || p.startsWith(x + '/'));
  const want: [string, string][] = [
    ['/accounting/close', '/close'], ['/accounting/review', '/accounting/reconcile'], ['/bank', '/transactions/import'],
    ['/bookings/approvals', '/approvals/book'], ['/bookings/payments', '/approvals/upi'],
    ['/settings/people', '/platform/people'], ['/settings/services', '/platform/services'], ['/settings/backups', '/platform/settings'], ['/platform/connections', '/settings/connections'],
    ['/live', '/matches/live'], ['/operations/live', '/matches/live'], ['/compare', '/booking-report/compare'], ['/compare/grounds', '/booking-report/compare/grounds'], ['/compare/months/2026-09/2026-08', '/booking-report/compare/months/2026-09/2026-08'],
  ];
  for (const [old, now] of want) { assert.equal(resolveRoute(old).path, now, old); assert.ok(served(now), `${now} has a page`); }
  for (const [from, to] of MERGED) assert.ok(served(resolveRoute(to).path) && resolveRoute(from).path === to, `${from} → ${to}`);
  // the merged-away pages are gone from the page table and the menu; their neighbours keep their own addresses
  for (const gone of ['/bank', '/live', '/compare']) assert.ok(!pages.includes(gone), `${gone} is no longer its own page`);
  const nav = reg.slice(reg.indexOf('export const NAV'), reg.indexOf('export const hrefOf'));
  for (const label of ['Bank import', 'Books review', 'Bookings to approve', 'UPI to verify', 'Compare months']) assert.ok(!nav.includes(`label: '${label}'`), `${label} left the menu`);
  for (const p of ['/bookings/day', '/bookings/bk_9', '/transactions/pending', '/settings/prices', '/settings/connections', '/platform/people', '/matches/m_1', '/approvals/rules']) assert.equal(resolveRoute(p).path, p);
  // the merged page holds what the old one showed
  assert.match(read('desk/src/pages/CloseWizard.tsx'), /<SignedOffMonths /);
  assert.match(read('desk/src/parts/books/Ledgers.tsx'), /export function Reconcile\(\)[\s\S]*<Review \/>/);
  assert.match(read('desk/src/pages/Transactions.tsx'), /<Importer \/>/);
  assert.match(read('desk/src/pages/Approvals.tsx'), /<Queues kind=\{filter\}/);
  assert.match(read('desk/src/pages/Matches.tsx'), /<LiveNow \/>/);
  assert.match(read('desk/src/pages/BookingsReport.tsx'), /<Compare sub=/);
  assert.doesNotMatch(read('desk/src/pages/Settings.tsx'), /<People \/>|<Services \/>|<Backups \/>/);
  ev('merged', MERGED);
});

rel('REL-DESK-016', 'the dashboard Upcoming count matches the bookings still to come, not only today\'s', async () => {
  // Found on the live desk: Upcoming tournaments listed a tournament ahead while the bookings card read "Upcoming (0)", because the card counted today only.
  const later = await bookAndPay(h, cust, g.id, dayFromNow(12), '07:00', 2);
  run("UPDATE bookings SET format_label = 'Saturday tournament' WHERE id = ?", later.id);
  const today = await h.get('/api/staff/today', owner);
  assert.ok(!today.body.bookings.some((b: any) => b.id === later.id), 'a booking on another day is not one of today\'s');
  const ahead = await h.get('/api/staff/bookings?upcoming=1&group=1&limit=100', owner);
  assert.ok(ahead.body.items.some((b: any) => b.id === later.id), 'it is one of the bookings still to come');
  const tours = await h.get('/api/staff/bookings?kind=tournament&upcoming=1&group=1', owner);
  assert.ok(tours.body.items.every((t: any) => ahead.body.items.some((b: any) => b.id === t.id)), 'every upcoming tournament is counted under Upcoming');
  const dash = read('desk/src/pages/Dashboard.tsx');
  assert.match(dash, /'\/api\/staff\/bookings\?upcoming=1&group=1&limit=20'/, 'the Upcoming tab reads the bookings still to come');
  assert.match(dash, /aheadRows\.slice\(0, 10\)/, 'it lists the next ten');
  assert.match(dash, /href="#\/bookings\/upcoming"/, 'More opens the whole list of what is booked');
  assert.match(read('desk/src/pages/Bookings.tsx'), /preset === 'upcoming' \? \{ upcoming: 1 \}/, 'that list holds the bookings still to come');
  // soonest first: the list of what is booked runs by date
  const soon = await bookAndPay(h, cust, g.id, dayFromNow(4), '07:00', 1);
  const order = (await h.get('/api/staff/bookings?upcoming=1&group=1&limit=20', owner)).body.items.map((b: any) => b.startAt);
  assert.deepEqual(order, [...order].sort((x: number, y: number) => x - y), 'sorted by date');
  assert.ok((await h.get('/api/staff/bookings?upcoming=1&group=1&limit=20', owner)).body.items.findIndex((b: any) => b.id === soon.id) < (await h.get('/api/staff/bookings?upcoming=1&group=1&limit=20', owner)).body.items.findIndex((b: any) => b.id === later.id));
  assert.match(dash, /k === 'upcoming' \? upcoming/, 'its count is that list, not today\'s');
  ev('upcoming', { ahead: ahead.body.total, today: today.body.bookings.length });
});
