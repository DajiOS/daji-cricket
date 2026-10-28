import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, advance, DAY, type Harness } from './helpers.ts';
import { many } from '../src/db.ts';
import { parseFeed, rulesIn, syncLawFeed, lastFeedRun, type Fetch } from '../src/lawUpdates.ts';
import { classify } from '../src/ask/builtin.ts';
import { runTool } from '../src/ask/claude.ts';
import { resetAskLimits } from '../src/ask/index.ts';
import { integrationStatuses, testIntegration } from '../src/integrations.ts';
import { one } from '../src/db.ts';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(() => { h.reset(); resetAskLimits(); });

const TODAY = '2026-10-28';
const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Notifications</title>
  <item><title>ESIC raises wage ceiling to Rs 25,000</title><link>https://esic.gov.in/n/1</link><guid>esic-1</guid><pubDate>Mon, 26 Oct 2026 10:00:00 +0530</pubDate><description><![CDATA[<p>The <b>ESI</b> coverage limit changes from 1 Jan.</p>]]></description></item>
  <item><title>Cricket World Cup schedule announced</title><link>https://news.test/cwc</link><guid>cwc</guid><pubDate>Mon, 26 Oct 2026 11:00:00 +0530</pubDate></item>
  <item><title>CBIC: GSTR-3B due date extended &amp; QRMP update</title><link>https://cbic.gov.in/n/2</link><pubDate>Tue, 27 Oct 2026 09:00:00 +0530</pubDate></item>
</channel></rss>`;
const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>tag:x,1</id><title>CERT-In updates incident reporting directions</title><link href="https://cert-in.org.in/d/1"/><updated>2026-10-20T08:00:00Z</updated><summary>Six hour rule stays.</summary></entry></feed>`;
const fake = (bodies: Record<string, string | number>, seen: { url: string; headers: Record<string, string> }[] = []): Fetch => async (url, init) => {
  seen.push({ url, headers: init.headers });
  const b = bodies[url];
  if (b === undefined) throw new Error('ECONNREFUSED');
  if (typeof b === 'number') return { ok: false, status: b, text: async () => '' };
  return { ok: true, status: 200, text: async () => b };
};
const cfgWith = (urls: string[], extra: Partial<Harness['cfg']['lawFeed']> = {}) => ({ ...h.cfg, lawFeed: { urls, token: '', keepAll: false, ...extra } });

test('feeds are read as RSS, Atom or JSON, with tags, entities and dates cleaned up', () => {
  const rss = parseFeed(RSS, TODAY);
  assert.equal(rss.length, 3);
  assert.deepEqual([rss[0]!.id, rss[0]!.title, rss[0]!.url, rss[0]!.publishedOn], ['esic-1', 'ESIC raises wage ceiling to Rs 25,000', 'https://esic.gov.in/n/1', '2026-10-26']);
  assert.equal(rss[0]!.summary, 'The ESI coverage limit changes from 1 Jan.');
  assert.equal(rss[2]!.title, 'CBIC: GSTR-3B due date extended & QRMP update');
  assert.equal(rss[2]!.id, 'https://cbic.gov.in/n/2', 'no guid: the link is the id');
  const atom = parseFeed(ATOM, TODAY);
  assert.deepEqual([atom[0]!.id, atom[0]!.url, atom[0]!.publishedOn], ['tag:x,1', 'https://cert-in.org.in/d/1', '2026-10-20']);
  const json = parseFeed(JSON.stringify({ items: [{ id: 'a1', title: 'TDS rates for contractors revised', url: 'javascript:alert(1)', publishedOn: '2026-10-25', codes: ['tds_194c'] }, { title: '' }, 'junk'] }), TODAY);
  assert.equal(json.length, 1);
  assert.deepEqual([json[0]!.url, json[0]!.codes, json[0]!.publishedOn], ['', ['TDS_194C'], '2026-10-25'], 'a non-web link is dropped');
  assert.equal(parseFeed(JSON.stringify([{ title: 'Undated news item', date: 'not a date' }]), TODAY)[0]!.publishedOn, TODAY);
  assert.equal(parseFeed(JSON.stringify([{ title: 'Future dated item', date: '2030-01-01T00:00:00Z' }]), TODAY)[0]!.publishedOn, TODAY, 'a date in the future is read as today');
  assert.throws(() => parseFeed('<html><body>Login</body></html>', TODAY), /RSS, Atom or JSON/);
  assert.throws(() => parseFeed('{"items": 3}', TODAY), /no items list/);
  assert.throws(() => parseFeed('{bad', TODAY), /not valid JSON/);
});

test('news is matched to the rules in the register by its words', () => {
  assert.deepEqual(rulesIn('ESIC raises wage ceiling'), ['ESI']);
  assert.deepEqual(rulesIn('GSTR-3B due date extended'), ['GST_RETURNS']);
  assert.deepEqual(rulesIn('Section 269ST: cash receipts above Rs 2 lakh'), ['CASH_269ST']);
  assert.deepEqual(rulesIn('Gujarat professional tax slab changed'), ['PT_GUJARAT']);
  assert.deepEqual(rulesIn('DPDP Rules notified'), ['DPDP']);
  assert.deepEqual(rulesIn('Cricket World Cup schedule announced'), []);
  assert.deepEqual(rulesIn('Gesture of goodwill'), [], '"esi" inside a word is not ESI');
});

test('the feed is read once a day, keeps only news about a rule, never stores an item twice, and a failure is shown, not counted as nothing new', async () => {
  const url = 'https://feeds.test/law.xml';
  assert.equal(await syncLawFeed(cfgWith([]), fake({})), null, 'no feed connected: nothing to do');
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const first = await syncLawFeed(cfgWith([url, 'https://feeds.test/atom']), fake({ [url]: RSS, 'https://feeds.test/atom': ATOM }, seen));
  assert.ok(first && first.ok);
  assert.equal(first.added, 3, 'ESI, GST returns and CERT-In kept; the cricket news is left out');
  const rows = many<{ title: string; codes: string; source: string; status: string }>('SELECT title, codes, source, status FROM compliance_alerts ORDER BY title');
  assert.deepEqual(rows.map((r) => r.codes), ['GST_RETURNS', 'CERT_IN', 'ESI']);
  assert.ok(rows.every((r) => r.source === 'feed' && r.status === 'new'));
  assert.equal(seen[0]!.headers.authorization, undefined, 'no token set, none sent');

  assert.equal(await syncLawFeed(cfgWith([url]), fake({ [url]: RSS })), null, 'already read today');
  const again = await syncLawFeed(cfgWith([url]), fake({ [url]: RSS }), { force: true });
  assert.equal(many('SELECT 1 FROM compliance_alerts').length, 3, 'the same items are not stored twice');
  assert.equal(again!.message, 'Read the feed; nothing new');

  advance(DAY);
  const bad = await syncLawFeed(cfgWith([url, 'https://down.test/x']), fake({ [url]: 503 }));
  assert.equal(bad!.ok, false);
  assert.match(bad!.message, /Could not read 2 of 2 feeds: feeds\.test: The feed answered 503; down\.test: ECONNREFUSED/);
  assert.equal(lastFeedRun()!.ok, false);
  assert.equal(many("SELECT 1 FROM audit_log WHERE action = 'compliance.feed'").length, 3);

  advance(DAY);
  const seen2: { url: string; headers: Record<string, string> }[] = [];
  const all = await syncLawFeed(cfgWith([url], { keepAll: true, token: 'k123' }), fake({ [url]: RSS }, seen2));
  assert.equal(all!.added, 1, 'with keep-all on, the cricket news is kept too');
  assert.equal(seen2[0]!.headers.authorization, 'Bearer k123');
  await syncLawFeed(cfgWith(['http://plain.test/feed'], { token: 'k123' }), fake({ 'http://plain.test/feed': RSS }, seen2), { force: true });
  assert.equal(seen2[1]!.headers.authorization, undefined, 'the token is never sent over plain http');
});

test('law updates on the Compliance page: added by hand, checked, marked reviewed once, owner only', async () => {
  const owner = await h.login('owner1'), staff = await h.login('staff1');
  const reg = await h.get('/api/compliance', owner);
  assert.equal(reg.status, 200);
  assert.deepEqual(reg.body.alerts, []);
  assert.deepEqual(reg.body.feed, { connected: false, sources: [], lastRun: null });

  const add = (b: unknown, tok = owner) => h.post('/api/compliance/alerts', b, tok);
  assert.equal((await add({ title: 'abc' })).status, 400, 'title too short');
  assert.equal((await add({ title: 'ESI ceiling raised', url: 'ftp://x' })).status, 400);
  assert.equal((await add({ title: 'ESI ceiling raised', codes: ['NOPE'] })).status, 400);
  assert.equal((await add({ title: 'ESI ceiling raised', publishedOn: '2099-01-01' })).status, 400);
  assert.equal((await add({ title: 'ESI ceiling raised' }, staff)).status, 403);
  const a = await add({ title: 'ESI ceiling raised to Rs 25,000', summary: 'From CA email', url: 'https://esic.gov.in/n/1', codes: ['cash_40a3'] });
  assert.equal(a.status, 201);
  assert.deepEqual(a.body.codes, ['CASH_40A3', 'ESI'], 'the chosen rule plus the one its words match');
  assert.equal(a.body.source, 'manual');
  assert.equal((await add({ title: 'ESI ceiling raised to Rs 25,000' })).status, 409, 'a double click adds one');

  const list = (await h.get('/api/compliance', owner)).body.alerts;
  assert.equal(list.length, 1);
  assert.equal((await h.post(`/api/compliance/alerts/${a.body.id}/handle`, { status: 'done' }, owner)).status, 400);
  assert.equal((await h.post(`/api/compliance/alerts/${a.body.id}/handle`, { status: 'reviewed' }, staff)).status, 403);
  assert.equal((await h.post('/api/compliance/alerts/law_nope/handle', { status: 'reviewed' }, owner)).status, 404);
  const done = await h.post(`/api/compliance/alerts/${a.body.id}/handle`, { status: 'reviewed', note: 'Limit updated by CA' }, owner);
  assert.equal(done.status, 200);
  assert.equal(done.body.status, 'reviewed');
  const twice = await h.post(`/api/compliance/alerts/${a.body.id}/handle`, { status: 'not_relevant' }, owner);
  assert.equal(twice.status, 409, 'a second answer is refused, not silently overwritten');
  assert.equal(one<{ status: string }>('SELECT status FROM compliance_alerts WHERE id = ?', a.body.id)!.status, 'reviewed');
  assert.equal(many("SELECT 1 FROM audit_log WHERE action IN ('compliance.alert.add','compliance.alert.handle')").length, 2);

  const f = await h.post('/api/compliance/feed/fetch', {}, owner);
  assert.equal(f.status, 409);
  assert.match(f.body.error.message, /Settings › Connections/);
  assert.equal((await h.post('/api/compliance/feed/fetch', {}, staff)).status, 403);
});

test('Ask AI answers about the compliance register and law updates, for the owner only', async () => {
  const owner = await h.login('owner1'), staff = await h.login('staff1');
  await h.post('/api/compliance/alerts', { title: 'GSTR-3B due date extended for October' }, owner);
  for (const q of ['Which compliance rules are due for review?', 'Any law updates waiting?', 'what changed in the law recently', 'tell me about professional tax']) assert.equal(classify(q).intent, 'compliance', q);
  for (const [q, i] of [['What was the GST for September?', 'gst'], ['What is the cancellation policy for refunds?', 'refunds'], ['What was the revenue last month?', 'revenue']] as const) assert.equal(classify(q).intent, i, q);

  const due = await h.post('/api/staff/ask', { question: 'Which compliance rules are due for review?' }, owner);
  assert.equal(due.status, 200);
  assert.equal(due.body.intent, 'compliance');
  assert.match(due.body.answer, /past the review date|reviewed on time/);
  assert.match(due.body.answer, /1 law update is waiting/);
  assert.ok(due.body.notes.some((n: string) => /Settings › Compliance/.test(n)));

  const news = await h.post('/api/staff/ask', { question: 'Any law updates waiting?' }, owner);
  assert.match(news.body.answer, /^1 law update is waiting for a look/);
  assert.match(news.body.details[0].text, /GSTR-3B due date extended for October \(rules: GST_RETURNS\)/);

  const pt = await h.post('/api/staff/ask', { question: 'what is the rule on professional tax?' }, owner);
  assert.match(pt.body.answer, /Gujarat Professional Tax/);

  const s = await h.post('/api/staff/ask', { question: 'Which compliance rules are due for review?' }, staff);
  assert.equal(s.status, 200);
  assert.equal(s.body.answer, 'Only the owner can see the compliance register.');
  assert.equal(JSON.stringify(s.body).includes('GSTR-3B'), false, 'nothing from the register reaches a team member');

  const ownerRow = one<any>("SELECT * FROM users WHERE email = 'owner1@daji.test'")!;
  const staffRow = one<any>("SELECT * FROM users WHERE email = 'staff1@daji.test'")!;
  const tool = runTool({ ownerId: ownerRow.id, user: ownerRow }, 'get_compliance', {}) as { rulesOnRegister: number; lawUpdatesWaiting: number; rules: unknown[] };
  assert.equal(tool.lawUpdatesWaiting, 1);
  assert.equal(tool.rules.length, tool.rulesOnRegister);
  assert.throws(() => runTool({ ownerId: ownerRow.id, user: staffRow }, 'get_compliance', {}), /compliance register/);
});

test('the law updates feed has its own place in Settings › Connections, off until set, with a test that saves nothing', async () => {
  const off = integrationStatuses(h.cfg).find((i) => i.id === 'lawfeed')!;
  assert.equal(off.status, 'missing');
  assert.deepEqual(off.missing, ['LAW_FEED_URL']);
  const u = { id: 'u1', role: 'super_admin' } as any;
  const cfg = cfgWith(['https://feeds.test/law.xml']);
  assert.equal(integrationStatuses(cfg).find((i) => i.id === 'lawfeed')!.status, 'ready');
  const good = await testIntegration(cfg, u, 'lawfeed', fake({ 'https://feeds.test/law.xml': RSS }));
  assert.equal(good.ok, true);
  assert.match(good.message, /feeds\.test: 3 items, 2 about a rule on the register.*Nothing was saved/);
  assert.equal(many('SELECT 1 FROM compliance_alerts').length, 0);
  const bad = await testIntegration(cfg, u, 'lawfeed', fake({ 'https://feeds.test/law.xml': '<html>sign in</html>' }));
  assert.equal(bad.ok, false);
  assert.match(bad.message, /RSS, Atom or JSON/);
});
