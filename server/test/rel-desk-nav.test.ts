import { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { startHarness, grounds, bookAndPay, dayFromNow, type Harness, type GroundLite } from './helpers.ts';
import { one, run } from '../src/db.ts';
import { REGISTER, resolveRoute } from '../../desk/src/routes.ts';
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
  assert.equal(resolveRoute('/matches/live').path, '/matches');
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
