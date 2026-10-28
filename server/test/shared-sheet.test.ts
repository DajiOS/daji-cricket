import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, bookAndPay, grounds, dayFromNow, advance, MIN, type Harness } from './helpers.ts';
import { many, one, run } from '../src/db.ts';
import { loadConfig } from '../src/config.ts';
import { integrationStatuses } from '../src/integrations.ts';
import { readXlsx, writeXlsx } from '../src/accounting/xlsx.ts';
import { finishSignIn, linkSheetFile, pullSheet, pushSheet, readTime, resetSheetTokens, runSheetSync, colLetter } from '../src/sheets.ts';
import { classify } from '../src/ask/builtin.ts';
import { runTool } from '../src/ask/claude.ts';
import { resetAskLimits } from '../src/ask/index.ts';
import type { Fetch } from '../src/integrations.ts';

// The shared spreadsheet: Daji sends a business's own tabs out and reads booking requests back into a review list.
// The Microsoft and Google services are stood in for by a fake fetch; nothing here reaches the internet.

const ENV = {
  FIELD_KEY: 'test-field-key-for-the-shared-sheet',
  MICROSOFT_CLIENT_ID: 'ms-client', MICROSOFT_CLIENT_SECRET: 'ms-secret', MICROSOFT_LOGIN_URL: 'https://login.test', MICROSOFT_GRAPH_URL: 'https://graph.test',
  GOOGLE_CLIENT_ID: 'g-client', GOOGLE_CLIENT_SECRET: 'g-secret', GOOGLE_TOKEN_URL: 'https://gtoken.test/token', GOOGLE_USERINFO_URL: 'https://gtoken.test/userinfo', GOOGLE_SHEETS_URL: 'https://sheets.test',
};
let h: Harness;
before(async () => { h = await startHarness(ENV); });
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); resetAskLimits(); resetSheetTokens(); });

const ownerId = (email: string) => one<{ id: string }>('SELECT id FROM users WHERE email = ?', email)!.id;
const csv = (rows: string[][]) => Buffer.from(rows.map((r) => r.join(',')).join('\n'));
const upload = (buf: Buffer, token: string, name = 'requests.csv') => h.call('POST', `/api/desk/sheets/upload?filename=${name}`, { raw: buf, token, headers: { 'content-type': 'application/octet-stream' } });
const HEAD = ['Date', 'Start time', 'Hours', 'Ground', 'Name', 'Phone', 'Players', 'Note'];

async function download(token: string) {
  const r = await fetch(`${h.url}/api/desk/sheets/download`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') ?? '', /spreadsheetml/);
  return readXlsx(Buffer.from(await r.arrayBuffer()));
}

test('with nothing set up, the platform lists both sheet services as not connected and download and upload still work', async () => {
  const bare = integrationStatuses(loadConfig({ PUBLIC_URL: 'http://localhost:4000', LOG: 'off', DEMO_MODE: 'on' }));
  const by = Object.fromEntries(bare.map((i) => [i.id, i]));
  assert.equal(by.sheet_excel.status, 'missing'); assert.deepEqual(by.sheet_excel.missing, ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET']);
  assert.equal(by.sheet_google.status, 'missing');
  assert.equal(JSON.stringify(integrationStatuses(h.cfg)).includes('ms-secret'), false, 'a secret value is never listed');

  const owner = await h.login('owner1');
  const v = await h.get('/api/desk/sheets', owner);
  assert.equal(v.status, 200);
  assert.equal(v.body.provider, 'file'); assert.equal(v.body.connected, false);
  assert.deepEqual(v.body.pushTabs, ['bookings', 'slots']);
  assert.equal(JSON.stringify(v.body).includes('refresh'), false);
  const sheets = await download(owner);
  assert.deepEqual(sheets.map((s) => s.name), ['About this sheet', 'Daji Bookings', 'Daji Open slots', 'Daji Request status', 'Booking requests']);
  assert.deepEqual(sheets.find((s) => s.name === 'Booking requests')!.rows[0], HEAD);
});

test('the workbook carries one business only, contact details only when the owner switches them on, and exact rupee amounts', async () => {
  const gs = await grounds(h);
  const g1 = gs.find((g) => g.name === 'Cricket Ground')!, g2 = gs.find((g) => g.name === 'Riverside Box Cricket')!;
  const cust = await h.login('customer');
  const b1 = await bookAndPay(h, cust, g1.id, dayFromNow(3), '10:00');
  const b2 = await bookAndPay(h, cust, g2.id, dayFromNow(3), '10:00');
  const o1 = await h.login('owner1'), o2 = await h.login('owner2');
  assert.equal((await h.put('/api/desk/sheets', { pushTabs: ['bookings', 'customers', 'payments', 'slots'] }, o1)).status, 200);

  let book = (await download(o1)).find((s) => s.name === 'Daji Bookings')!;
  assert.deepEqual(book.rows[0], ['Ref', 'Date', 'Start', 'End', 'Ground', 'Type', 'Customer', 'Status', 'Total (Rs)', 'Paid (Rs)', 'Balance (Rs)']);
  assert.equal(book.rows.length, 2);
  assert.equal(book.rows[1]![0], b1.ref);
  assert.equal(Number(book.rows[1]![8]), b1.totalPaise / 100, 'money is rupees with paise kept exactly');
  const all1 = JSON.stringify(await download(o1));
  assert.equal(all1.includes(b2.ref), false, 'another business\'s booking never reaches this workbook');
  assert.equal(all1.includes('Riverside'), false);
  assert.equal(all1.includes('9876543210'), false, 'no phone number until the owner switches contacts on');
  const pay = (await download(o1)).find((s) => s.name === 'Daji Payments')!;
  assert.equal(pay.rows.length, 2); assert.equal(pay.rows[1]![1], b1.ref); assert.equal(Number(pay.rows[1]![6]), b1.paidPaise / 100);

  assert.equal((await h.put('/api/desk/sheets', { includeContacts: true }, o1)).status, 200);
  book = (await download(o1)).find((s) => s.name === 'Daji Bookings')!;
  assert.equal(book.rows[0]![7], 'Phone'); assert.equal(book.rows[1]![7], '9876543210');
  const cust1 = (await download(o1)).find((s) => s.name === 'Daji Customers')!;
  assert.deepEqual(cust1.rows[0], ['Name', 'Phone', 'Email', 'Bookings', 'Last played', 'Next booking']);

  const all2 = JSON.stringify(await download(o2));
  assert.equal(all2.includes(b1.ref), false); assert.equal(all2.includes(b2.ref), true);
  assert.equal(all2.includes('9876543210'), false, 'owner1 switching contacts on changes nothing for owner2');

  // a team member gets only the tabs their rights allow: no revenue, no payments tab
  const staff = await h.login('staff1');
  const names = (await download(staff)).map((s) => s.name);
  assert.equal(names.includes('Daji Payments'), false); assert.equal(names.includes('Daji Customers'), true);
  assert.equal((await h.put('/api/desk/sheets', { pushTabs: ['bookings'] }, staff)).status, 403, 'only the owner chooses what leaves the desk');
  assert.equal((await h.get('/api/desk/sheets', await h.login('customer'))).status, 403);
  const admin = await h.login('admin');
  assert.equal((await h.get('/api/desk/sheets', admin)).status, 400, 'the software owner must say which business');
  assert.equal((await h.get(`/api/desk/sheets?ownerId=${ownerId('owner2@daji.test')}`, admin)).status, 200);
  assert.equal((await h.get('/api/desk/sheets?ownerId=nobody', admin)).status, 404);
  assert.equal(many("SELECT 1 FROM sheet_runs WHERE direction = 'push' AND via = 'download'").length >= 5, true, 'each download is on the history');
});

test('booking requests read back from the sheet are checked, wait for review, and never become a booking or money by themselves', async () => {
  const o1 = await h.login('owner1');
  const id1 = ownerId('owner1@daji.test');
  const bookings0 = many('SELECT id FROM bookings').length, payments0 = many('SELECT id FROM payments').length;
  const file = csv([HEAD,
    [dayFromNow(5), '6 pm', '2', 'Cricket Ground', 'Rohan Shah', '98765 43210', '14', 'Office match'],
    ['', '', '', '', '', '', '', ''],
    [dayFromNow(-1), '25:00', 'x', 'Moon Ground', 'A', '123', '0', ''],
    [dayFromNow(6), '07:30', '', 'nets', 'Kiran', '9123456789', '', ''],
    [dayFromNow(6), '07:30', '1', '', 'Kiran', '9123456789', '', ''],
  ]);
  const r = await upload(file, o1);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ok, true);
  assert.deepEqual(r.body.counts, { read: 4, new: 2, invalid: 2, alreadySeen: 0, tooMany: 0 });

  const inbox = (await h.get('/api/desk/sheets/inbox', o1)).body.items;
  const waiting = inbox.filter((i: any) => i.status === 'waiting');
  const bad = inbox.filter((i: any) => i.status === 'invalid');
  assert.equal(waiting.length, 2); assert.equal(bad.length, 2);
  const rohan = waiting.find((i: any) => i.name === 'Rohan Shah');
  assert.deepEqual([rohan.date, rohan.start, rohan.hours, rohan.ground, rohan.phone, rohan.players, rohan.line], [dayFromNow(5), '18:00', 2, 'Cricket Ground', '9876543210', 14, 2]);
  assert.equal(rohan.free, true, 'the hint says the time is free by Daji\'s own calendar');
  assert.equal(waiting.find((i: any) => i.name === 'Kiran').ground, 'Practice Nets', 'part of a ground name is enough');
  const broken = bad.find((i: any) => i.line === 4);
  for (const p of ['Date has passed', 'Start time "25:00"', 'Hours "x"', 'Ground "Moon Ground"', 'Name is empty', 'Phone is not', 'Players must']) assert.ok(broken.problems.some((x: string) => x.startsWith(p)), p);
  assert.ok(bad.find((i: any) => i.line === 6).problems.includes('Ground is empty and there is more than one'));

  // the same file again adds nothing
  const again = await upload(file, o1);
  assert.deepEqual(again.body.counts, { read: 4, new: 0, invalid: 0, alreadySeen: 4, tooMany: 0 });
  assert.equal(many('SELECT 1 FROM sheet_inbox WHERE owner_id = ?', id1).length, 4);

  // another business cannot see or touch these rows
  const o2 = await h.login('owner2');
  assert.equal((await h.get('/api/desk/sheets/inbox', o2)).body.items.length, 0);
  assert.equal((await h.post(`/api/desk/sheets/inbox/${rohan.id}/accept`, {}, o2)).status, 404);
  assert.equal((await h.post(`/api/desk/sheets/inbox/${rohan.id}/reject`, {}, o2)).status, 404);

  // accepting makes an ordinary enquiry for this business, and nothing else
  const staff = await h.login('staff1');
  const acc = await h.post(`/api/desk/sheets/inbox/${rohan.id}/accept`, {}, staff);
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  assert.equal(acc.body.status, 'accepted');
  const enq = one<any>('SELECT * FROM enquiries WHERE id = ?', acc.body.enquiryId)!;
  assert.deepEqual([enq.owner_id, enq.name, enq.phone, enq.preferred_date, enq.preferred_time, enq.preferred_slots, enq.players, enq.status], [id1, 'Rohan Shah', '9876543210', dayFromNow(5), '18:00', 2, 14, 'new']);
  assert.match(enq.message, /shared sheet \(line 2\): Office match/);
  assert.equal(many('SELECT id FROM bookings').length, bookings0, 'no booking was made');
  assert.equal(many('SELECT id FROM payments').length, payments0, 'no money was recorded');
  assert.equal((await h.post(`/api/desk/sheets/inbox/${rohan.id}/accept`, {}, o1)).status, 409, 'once only');
  assert.equal((await h.get(`/api/staff/enquiries/${enq.id}`, o1)).status, 200, 'the enquiry is in the normal enquiries list');
  assert.notEqual((await h.get(`/api/staff/enquiries/${enq.id}`, o2)).status, 200, 'and not in another business\'s');

  assert.equal((await h.post(`/api/desk/sheets/inbox/${broken.id}/accept`, {}, o1)).status, 409, 'a row with problems cannot be accepted');
  const rej = await h.post(`/api/desk/sheets/inbox/${broken.id}/reject`, { reason: 'Old row' }, o1);
  assert.equal(rej.status, 200); assert.equal(rej.body.status, 'rejected');
  assert.equal((await h.post(`/api/desk/sheets/inbox/${broken.id}/reject`, {}, o1)).status, 409);

  // the next download tells the people on the sheet what happened to each row
  const status = (await download(o1)).find((s) => s.name === 'Daji Request status')!;
  assert.ok(status.rows.some((row) => row.includes('Rohan Shah') && row.includes('Accepted as an enquiry')));
  assert.ok(status.rows.some((row) => row.includes('Not taken') && row.includes('Old row')));
  assert.equal(many("SELECT 1 FROM audit_log WHERE action IN ('sheet.pull','sheet.accept','sheet.reject')").length, 4);
  assert.equal(JSON.stringify(many("SELECT detail FROM audit_log WHERE action LIKE 'sheet.%'")).includes('9876543210'), false, 'no phone number in the audit trail');
});

test('an uploaded Excel workbook is read from its Booking requests tab; a file without one, or a broken file, is refused with the reason', async () => {
  const o2 = await h.login('owner2');
  const book = writeXlsx([{ name: 'Daji Bookings', rows: [['Ref', 'Date']] }, { name: 'Booking requests', rows: [HEAD, [dayFromNow(4), '19:00', '1', '', 'Team Gotri', '9988776655', '11', '']] }]);
  const r = await upload(book, o2, 'sheet.xlsx');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.counts.new, 1, 'one ground: the ground column may be empty');
  const none = await upload(writeXlsx([{ name: 'Other', rows: [['Hello']] }]), o2, 'x.xlsx');
  assert.equal(none.status, 400); assert.equal(none.body.error.code, 'NO_REQUESTS_TAB');
  const noHead = await upload(csv([['a', 'b'], ['1', '2']]), o2);
  assert.equal(noHead.status, 200); assert.equal(noHead.body.ok, false); assert.match(noHead.body.message, /No header row/);
  const broken = await upload(Buffer.concat([Buffer.from('PK'), Buffer.alloc(40)]), o2, 'x.xlsx');
  assert.equal(broken.status, 400); assert.equal(broken.body.error.code, 'BAD_FILE');
  assert.equal((await h.put('/api/desk/sheets', { pullRequests: false }, o2)).status, 200);
  assert.equal((await upload(book, o2, 'sheet.xlsx')).status, 409, 'reading switched off');
  // the failed read is on the history, never shown as "0 new"
  assert.equal(one<any>("SELECT ok FROM sheet_runs WHERE message LIKE 'No header row%'")!.ok, 0);
});

test('times and columns people type are understood', () => {
  assert.equal(readTime('6 pm'), '18:00'); assert.equal(readTime('6:30PM'), '18:30'); assert.equal(readTime('12 am'), '00:00'); assert.equal(readTime('12 pm'), '12:00');
  assert.equal(readTime('18.00'), '18:00'); assert.equal(readTime('0.75'), '18:00'); assert.equal(readTime('07:05:00'), '07:05');
  assert.equal(readTime('6'), null, 'a bare 6 is not guessed'); assert.equal(readTime('13 pm'), null); assert.equal(readTime('24:00'), null); assert.equal(readTime('9:75'), null);
  assert.equal(colLetter(1), 'A'); assert.equal(colLetter(26), 'Z'); assert.equal(colLetter(27), 'AA');
});

// ---------------------------------------------------------------- a live Excel workbook, with Microsoft stood in for

interface Seen { url: string; method: string; body?: string; auth?: string }
function fakeMicrosoft(opts: { requests?: string[][]; refreshFails?: boolean; tabs?: string[] } = {}) {
  const seen: Seen[] = [];
  const tabs = new Set(opts.tabs ?? ['Sheet1']);
  let refreshes = 0;
  const f: Fetch = async (url, init) => {
    seen.push({ url, method: init.method, body: init.body, auth: init.headers.Authorization });
    const json = (o: unknown, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(o) });
    if (url === 'https://login.test/common/oauth2/v2.0/token') {
      const p = new URLSearchParams(init.body);
      if (p.get('client_secret') !== 'ms-secret') return json({ error: 'invalid_client' }, 401);
      if (p.get('grant_type') === 'authorization_code') return p.get('code') === 'good-code' ? json({ access_token: 'acc-1', refresh_token: 'refresh-secret-1', expires_in: 3600 }) : json({ error: 'invalid_grant', error_description: 'Code expired' }, 400);
      if (opts.refreshFails) return json({ error: 'invalid_grant', error_description: 'Token revoked' }, 400);
      refreshes++;
      return json({ access_token: `acc-r${refreshes}`, refresh_token: `refresh-secret-r${refreshes}`, expires_in: 3600 });
    }
    if (url.startsWith('https://graph.test/v1.0/me')) return json({ mail: 'partner@example.test' });
    if (url.startsWith('https://graph.test/v1.0/shares/')) return json({ id: 'ITEM1', name: 'Ground bookings.xlsx', webUrl: 'https://onedrive.live.com/edit?id=ITEM1', parentReference: { driveId: 'DRIVE1' } });
    const base = 'https://graph.test/v1.0/drives/DRIVE1/items/ITEM1/workbook/worksheets';
    if (url.startsWith(`${base}?`)) return json({ value: [...tabs].map((name) => ({ name })) });
    if (url === `${base}/add`) { tabs.add(JSON.parse(init.body!).name); return json({}); }
    if (url.includes('/usedRange')) return json({ text: opts.requests ?? [HEAD] });
    if (url.startsWith(base)) return json({});
    throw new Error(`unexpected call ${init.method} ${url}`);
  };
  return { f, seen, tabs };
}

async function connectExcel(owner: string, fake: ReturnType<typeof fakeMicrosoft>) {
  assert.equal((await h.put('/api/desk/sheets', { provider: 'excel' }, owner)).status, 200);
  const s = await h.post('/api/desk/sheets/signin', {}, owner);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const u = new URL(s.body.url);
  assert.equal(u.origin + u.pathname, 'https://login.test/common/oauth2/v2.0/authorize');
  assert.equal(u.searchParams.get('redirect_uri'), 'http://localhost:4000/api/sheets/oauth/callback');
  assert.match(u.searchParams.get('scope')!, /offline_access Files\.ReadWrite/);
  const state = u.searchParams.get('state')!;
  assert.equal(await finishSignIn(h.cfg, new URLSearchParams({ state, code: 'good-code' }), fake.f), '/desk.html#/settings/connections/sheet-connected');
  return state;
}

test('Excel: sign in, link the workbook, send the tabs and read requests, with the sign-in sealed and formulas defused', async () => {
  const o1 = await h.login('owner1');
  const id1 = ownerId('owner1@daji.test');
  const gs = await grounds(h);
  const cust = await h.login('customer');
  run("UPDATE users SET name = '=HYPERLINK(\"http://x.test\")' WHERE email = 'customer@daji.test'");
  await bookAndPay(h, cust, gs.find((g) => g.name === 'Cricket Ground')!.id, dayFromNow(2), '08:00');
  const fake = fakeMicrosoft({ requests: [HEAD, [dayFromNow(4), '7 pm', '1', 'Practice Nets', 'Asha Patel', '9822001100', '', 'Nets']] });
  const state = await connectExcel(o1, fake);

  const stored = one<any>('SELECT * FROM sheet_links WHERE owner_id = ?', id1)!;
  assert.match(stored.refresh_token, /^enc1:/, 'the sign-in is sealed in the database');
  assert.equal(stored.refresh_token.includes('refresh-secret-1'), false);
  assert.equal(await finishSignIn(h.cfg, new URLSearchParams({ state, code: 'good-code' }), fake.f), '/desk.html#/settings/connections/sheet-expired', 'a state works once');
  const card = (await h.get('/api/desk/sheets', o1)).body;
  assert.equal(card.connected, true); assert.equal(card.account, 'partner@example.test');
  assert.equal(JSON.stringify(card).includes('refresh-secret'), false); assert.equal(JSON.stringify(card).includes('enc1:'), false);

  const bad = await h.post('/api/desk/sheets/file', { url: 'https://example.com/file.xlsx' }, o1);
  assert.equal(bad.status, 400); assert.match(bad.body.error.message, /not a OneDrive or SharePoint link/);
  const linked = await linkSheetFile(h.cfg, one<any>('SELECT * FROM users WHERE id = ?', id1), id1, { url: 'https://1drv.ms/x/s!AbCdEf' }, fake.f);
  assert.deepEqual(linked.file, { name: 'Ground bookings.xlsx', url: 'https://onedrive.live.com/edit?id=ITEM1' });
  const share = fake.seen.find((s) => s.url.includes('/shares/'))!;
  assert.match(share.url, /\/shares\/u!aHR0cHM6Ly8xZHJ2Lm1zL3gvcyFBYkNkRWY\/driveItem/);

  const push = await pushSheet(h.cfg, { id: id1, role: 'owner' }, id1, fake.f);
  assert.equal(push.ok, true, push.message);
  assert.deepEqual(push.counts, { 'Daji Bookings': 1, 'Daji Open slots': push.counts['Daji Open slots']!, 'Daji Request status': 0 });
  assert.ok(push.counts['Daji Open slots']! > 100, 'two weeks of open slots for both grounds');
  for (const t of ['About this sheet', 'Daji Bookings', 'Daji Open slots', 'Daji Request status', 'Booking requests']) assert.ok(fake.tabs.has(t), t);
  const writes = fake.seen.filter((s) => s.method === 'PATCH');
  const bookingsWrite = writes.find((s) => s.url.includes(encodeURIComponent('Daji Bookings')))!;
  assert.match(bookingsWrite.url, /range\(address='A1:K2'\)/);
  const values = JSON.parse(bookingsWrite.body!).values;
  assert.equal(values[1][6], '\'=HYPERLINK("http://x.test")', 'a name that looks like a formula is written as text');
  assert.equal(typeof values[1][8], 'number');
  assert.equal(fake.seen.filter((s) => s.url.includes(encodeURIComponent('Booking requests')) && s.method !== 'GET').filter((s) => s.url.includes('/clear')).length, 0, 'the people\'s own tab is never cleared');
  assert.ok(fake.seen.filter((s) => s.url.startsWith('https://graph.test/v1.0/drives')).every((s) => s.auth === 'Bearer acc-1'), 'the access token from the sign-in is used while fresh');

  const pull = await pullSheet(h.cfg, { id: id1, role: 'owner' }, id1, fake.f);
  assert.equal(pull.ok, true, pull.message); assert.equal(pull.counts.new, 1);
  assert.equal((await h.get('/api/desk/sheets/inbox?status=waiting', o1)).body.items[0].name, 'Asha Patel');

  // the access token runs out: a fresh one comes from the sealed refresh token, and Microsoft's newer refresh token is kept
  advance(61 * MIN);
  assert.equal((await pushSheet(h.cfg, { id: id1, role: 'owner' }, id1, fake.f)).ok, true);
  assert.match(one<any>('SELECT refresh_token FROM sheet_links WHERE owner_id = ?', id1)!.refresh_token, /^enc1:/);
  assert.ok(fake.seen.some((s) => s.auth === 'Bearer acc-r1'));

  // owner2 has nothing linked and sees none of it
  const o2card = (await h.get('/api/desk/sheets', await h.login('owner2'))).body;
  assert.equal(o2card.connected, false); assert.equal(o2card.account, null); assert.equal(o2card.inbox.waiting, 0);

  // disconnect forgets the sign-in and the link, and keeps the history
  const d = await h.post('/api/desk/sheets/disconnect', {}, o1);
  assert.equal(d.status, 200); assert.equal(d.body.connected, false);
  assert.equal(one<any>('SELECT refresh_token FROM sheet_links WHERE owner_id = ?', id1)!.refresh_token, null);
  assert.ok(d.body.runs.length >= 3);
});

test('Excel: a refused sign-in or a revoked token is recorded as a failure with the reason, never as an empty send', async () => {
  const o1 = await h.login('owner1');
  const id1 = ownerId('owner1@daji.test');
  const fake = fakeMicrosoft({ refreshFails: true });
  assert.equal((await h.put('/api/desk/sheets', { provider: 'excel' }, o1)).status, 200);
  const s = new URL((await h.post('/api/desk/sheets/signin', {}, o1)).body.url).searchParams.get('state')!;
  assert.equal(await finishSignIn(h.cfg, new URLSearchParams({ state: s, code: 'old-code' }), fake.f), '/desk.html#/settings/connections/sheet-failed');
  assert.match((await h.get('/api/desk/sheets', o1)).body.problem, /Microsoft refused the sign-in \(400\)\. Code expired/);
  const s2 = new URL((await h.post('/api/desk/sheets/signin', {}, o1)).body.url).searchParams.get('state')!;
  assert.equal(await finishSignIn(h.cfg, new URLSearchParams({ state: s2, error: 'access_denied' }), fake.f), '/desk.html#/settings/connections/sheet-refused');
  assert.equal(await finishSignIn(h.cfg, new URLSearchParams({ state: 'made-up', code: 'good-code' }), fake.f), '/desk.html#/settings/connections/sheet-expired');

  await connectExcel(o1, fake);
  await linkSheetFile(h.cfg, one<any>('SELECT * FROM users WHERE id = ?', id1), id1, { url: 'https://1drv.ms/x/s!AbCdEf' }, fake.f);
  resetSheetTokens(); // the access token is gone, so the next send needs the refresh token, which Microsoft now refuses
  const push = await pushSheet(h.cfg, { id: id1, role: 'owner' }, id1, fake.f);
  assert.equal(push.ok, false); assert.match(push.message, /Token revoked/); assert.deepEqual(push.counts, {});
  const card = (await h.get('/api/desk/sheets', o1)).body;
  assert.match(card.problem, /Token revoked/); assert.equal(card.lastPush.ok, false);
  assert.equal(one<any>("SELECT COUNT(*) n FROM audit_log WHERE action = 'sheet.push_failed'")!.n, 1);

  // the callback over HTTP sends the browser back to the desk and never shows a code or token
  const r = await fetch(`${h.url}/api/sheets/oauth/callback?state=nope&code=abc`, { redirect: 'manual' });
  assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/desk.html#/settings/connections/sheet-expired');
});

test('Google Sheets: values are written RAW so nothing becomes a formula, and only the requests tab is read', async () => {
  const o2 = await h.login('owner2');
  const id2 = ownerId('owner2@daji.test');
  const seen: Seen[] = [];
  const f: Fetch = async (url, init) => {
    seen.push({ url, method: init.method, body: init.body, auth: init.headers.Authorization });
    const json = (o: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(o) });
    if (url === 'https://gtoken.test/token') return json({ access_token: 'g-acc', refresh_token: 'g-refresh', expires_in: 3600 });
    if (url === 'https://gtoken.test/userinfo') return json({ email: 'partner@gmail.test' });
    if (url.includes('fields=properties.title')) return json({ properties: { title: 'Ground bookings' } });
    if (url.includes('fields=sheets.properties.title')) return json({ sheets: [{ properties: { title: 'Booking requests' } }] });
    if (url.includes(encodeURIComponent("'Booking requests'")) && init.method === 'GET') return json({ values: [HEAD, [dayFromNow(3), '20:00', '1', '', 'Team River', '9811122233']] });
    return json({});
  };
  assert.equal((await h.put('/api/desk/sheets', { provider: 'google', pushTabs: ['bookings'] }, o2)).status, 200);
  const u = new URL((await h.post('/api/desk/sheets/signin', {}, o2)).body.url);
  assert.equal(u.searchParams.get('access_type'), 'offline');
  assert.match(u.searchParams.get('scope')!, /spreadsheets/);
  assert.match(await finishSignIn(h.cfg, new URLSearchParams({ state: u.searchParams.get('state')!, code: 'c' }), f), /connected/);
  const bad = await linkSheetFile(h.cfg, one<any>('SELECT * FROM users WHERE id = ?', id2), id2, { url: 'https://docs.google.com/document/d/abc/edit' }, f).catch((e) => e);
  assert.match(bad.message, /not a Google Sheets address/);
  const ok = await linkSheetFile(h.cfg, one<any>('SELECT * FROM users WHERE id = ?', id2), id2, { url: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit#gid=0' }, f);
  assert.equal(ok.file!.name, 'Ground bookings');
  const push = await pushSheet(h.cfg, { id: id2, role: 'owner' }, id2, f);
  assert.equal(push.ok, true, push.message);
  const writes = seen.filter((s) => s.method === 'PUT');
  assert.ok(writes.length >= 2 && writes.every((s) => s.url.includes('valueInputOption=RAW')));
  assert.equal(seen.some((s) => s.url.includes(encodeURIComponent("'Booking requests'!A:Z") + ':clear')), false, 'the people\'s own tab is never cleared');
  const pull = await pullSheet(h.cfg, { id: id2, role: 'owner' }, id2, f);
  assert.equal(pull.counts.new, 1);
  assert.equal(many('SELECT 1 FROM sheet_inbox WHERE owner_id = ?', ownerId('owner1@daji.test')).length, 0, 'owner2\'s rows are owner2\'s only');
});

test('sending by itself runs every 15 minutes for linked sheets only, and two runs for one business never overlap', async () => {
  const o1 = await h.login('owner1');
  const id1 = ownerId('owner1@daji.test');
  assert.equal((await h.put('/api/desk/sheets', { autoSync: true }, o1)).status, 400, 'download and upload cannot run by themselves');
  const fake = fakeMicrosoft();
  await connectExcel(o1, fake);
  await linkSheetFile(h.cfg, one<any>('SELECT * FROM users WHERE id = ?', id1), id1, { url: 'https://1drv.ms/x/s!AbCdEf' }, fake.f);
  assert.equal(await runSheetSync(h.cfg, fake.f), 0, 'off until the owner switches it on');
  assert.equal((await h.put('/api/desk/sheets', { autoSync: true }, o1)).status, 200);
  assert.equal(await runSheetSync(h.cfg, fake.f), 1);
  assert.equal(await runSheetSync(h.cfg, fake.f), 0, 'not again within 15 minutes');
  advance(16 * MIN);
  assert.equal(await runSheetSync(h.cfg, fake.f), 1);
  const runs = many<any>("SELECT direction, by_user FROM sheet_runs WHERE owner_id = ? AND via = 'excel'", id1);
  assert.equal(runs.length, 4); assert.ok(runs.every((r) => r.by_user === null), 'logged as the system');

  const a = pushSheet(h.cfg, { id: id1, role: 'owner' }, id1, fake.f);
  const b = await pushSheet(h.cfg, { id: id1, role: 'owner' }, id1, fake.f).catch((e) => e);
  assert.equal(b.status, 409); assert.equal(b.code, 'SHEET_BUSY');
  assert.equal((await a).ok, true);

  // choosing another kind of sheet forgets the Microsoft sign-in and stops the automatic runs
  assert.equal((await h.put('/api/desk/sheets', { provider: 'google' }, o1)).status, 200);
  const row = one<any>('SELECT * FROM sheet_links WHERE owner_id = ?', id1)!;
  assert.deepEqual([row.refresh_token, row.file_ref, row.auto_sync], [null, null, 0]);
});

test('Platform AI answers about the shared spreadsheet from the same records, without phone numbers, and within the asker\'s rights', async () => {
  const o1 = await h.login('owner1');
  await upload(csv([HEAD, [dayFromNow(5), '18:00', '1', 'Cricket Ground', 'Rohan Shah', '9876543210', '', '']]), o1);
  assert.equal(classify('Is the Excel sheet linked?').intent, 'sheet');
  assert.equal(classify('any requests from the sheet waiting?').intent, 'sheet');
  assert.equal(classify('Show the balance sheet').intent, 'balance_sheet', 'the balance sheet is still the balance sheet');
  const a = await h.post('/api/staff/ask', { question: 'Any booking requests from the shared sheet waiting?' }, o1);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.intent, 'sheet');
  assert.match(a.body.answer, /download and upload/); assert.match(a.body.answer, /1 booking request from the sheet is waiting for review/);
  assert.ok(a.body.details.some((d: any) => /Rohan Shah/.test(d.text)));
  assert.equal(JSON.stringify(a.body).includes('9876543210'), false);
  const owner1 = one<any>('SELECT * FROM users WHERE email = ?', 'owner1@daji.test');
  const tool = runTool({ ownerId: owner1.id, user: owner1 }, 'get_shared_sheet', {}) as any;
  assert.equal(tool.requestsWaiting, 1); assert.equal(tool.rows[0].name, 'Rohan Shah');
  assert.equal(JSON.stringify(tool).includes('9876543210'), false);
  // another business's assistant sees its own (empty) sheet only
  const owner2 = one<any>('SELECT * FROM users WHERE email = ?', 'owner2@daji.test');
  assert.equal(((runTool({ ownerId: owner2.id, user: owner2 }, 'get_shared_sheet', {})) as any).requestsWaiting, 0);
  // a team member without bookings rights is told so
  const stranger = { ...one<any>('SELECT * FROM users WHERE email = ?', 'staff1@daji.test'), permissions: '[]' };
  await assert.rejects(Promise.resolve().then(() => runTool({ ownerId: owner1.id, user: stranger }, 'get_shared_sheet', {})), /do not have access to bookings/);
});

test('a sheet can cover chosen grounds only: a second ground\'s sheet never carries the first ground\'s bookings, customers or money', async () => {
  const gs = await grounds(h);
  const main = gs.find((g) => g.name === 'Cricket Ground')!, nets = gs.find((g) => g.name === 'Practice Nets')!, other = gs.find((g) => g.name === 'Riverside Box Cricket')!;
  const cust = await h.login('customer');
  const onMain = await bookAndPay(h, cust, main.id, dayFromNow(3), '10:00');
  const onNets = await bookAndPay(h, cust, nets.id, dayFromNow(3), '10:00');
  const o1 = await h.login('owner1');
  assert.equal((await h.put('/api/desk/sheets', { groundIds: [other.id] }, o1)).status, 400, 'another business\'s ground cannot be chosen');
  const saved = await h.put('/api/desk/sheets', { groundIds: [nets.id], pushTabs: ['bookings', 'slots', 'customers', 'payments'] }, o1);
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.groundIds, [nets.id]);
  assert.deepEqual(saved.body.grounds.map((g: any) => g.name), ['Cricket Ground', 'Practice Nets']);

  const all = JSON.stringify(await download(o1));
  assert.equal(all.includes(onMain.ref), false, 'the other ground\'s booking stays off');
  assert.equal(all.includes(onNets.ref), true);
  const slots = (await download(o1)).find((s) => s.name === 'Daji Open slots')!;
  assert.ok(slots.rows.slice(1).every((r) => r[1] === 'Practice Nets'));
  const pay = (await download(o1)).find((s) => s.name === 'Daji Payments')!;
  assert.deepEqual(pay.rows.slice(1).map((r) => r[1]), [onNets.ref], 'only that ground\'s money');

  // requests: the ground column may be empty (one ground covered); the other ground is refused
  const r = await upload(csv([HEAD, [dayFromNow(6), '07:00', '1', '', 'Kiran', '9123456789', '', ''], [dayFromNow(6), '09:00', '1', 'Cricket Ground', 'Raj', '9123456780', '', '']]), o1);
  assert.deepEqual([r.body.counts.new, r.body.counts.invalid], [1, 1]);
  const items = (await h.get('/api/desk/sheets/inbox', o1)).body.items;
  assert.equal(items.find((i: any) => i.name === 'Kiran').ground, 'Practice Nets');
  assert.ok(items.find((i: any) => i.name === 'Raj').problems.some((p: string) => /not one of the grounds this sheet covers/.test(p)));

  // the sheet stops covering a ground: a waiting row for it cannot be accepted any more
  assert.equal((await h.put('/api/desk/sheets', { groundIds: [main.id] }, o1)).status, 200);
  const kiran = items.find((i: any) => i.name === 'Kiran');
  const acc = await h.post(`/api/desk/sheets/inbox/${kiran.id}/accept`, {}, o1);
  assert.equal(acc.status, 409); assert.equal(acc.body.error.code, 'GROUND_NOT_ON_SHEET');
  // and no choice means every ground again
  assert.equal((await h.put('/api/desk/sheets', { groundIds: [] }, o1)).status, 200);
  const both = JSON.stringify(await download(o1));
  assert.ok(both.includes(onMain.ref) && both.includes(onNets.ref));
  const owner1 = one<any>('SELECT * FROM users WHERE email = ?', 'owner1@daji.test');
  assert.deepEqual((runTool({ ownerId: owner1.id, user: owner1 }, 'get_shared_sheet', {}) as any).grounds, ['Cricket Ground', 'Practice Nets']);
});
