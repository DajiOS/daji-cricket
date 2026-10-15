import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, bookAndPay, dayFromNow, setNow, T0, DAY, type Harness, type GroundLite } from './helpers.ts';
import { register } from './register.ts';
import { many, one, run } from '../src/db.ts';
import { flushNotifications, registerProvider } from '../src/notifications.ts';
import { DAILY_BROADCAST_LIMIT, unsubscribeToken } from '../src/broadcasts.ts';

let h: Harness;
let main: GroundLite;
let nets: GroundLite;
let riverside: GroundLite;
let owner: string, owner2: string, admin: string, staff: string, cust: string;
const people: Record<string, { token: string; id: string }> = {};

before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });

async function person(name: string, phone: string, consent: Record<string, boolean> | undefined) {
  const token = await register(h, name, phone, consent ? { consent } : {});
  const id = (await h.get('/api/me', token)).body.user.id as string;
  return { token, id };
}

beforeEach(async () => {
  h.reset();
  registerProvider('email', null); registerProvider('whatsapp', null); registerProvider('sms', null);
  const all = await grounds(h);
  main = all.find((g) => g.name === 'Cricket Ground')!;
  nets = all.find((g) => g.name === 'Practice Nets')!;
  riverside = all.find((g) => g.name === 'Riverside Box Cricket')!;
  owner = await h.login('owner1'); owner2 = await h.login('owner2'); admin = await h.login('admin'); staff = await h.login('staff1'); cust = await h.login('customer');

  people.asha = await person('Asha Patel', '9811111111', { email: true, whatsapp: true });
  people.bhavin = await person('Bhavin Shah', '9822222222', undefined);
  people.chirag = await person('Chirag Mehta', '9833333333', { email: true });
  people.dev = await person('Dev Rao', '9844444444', { email: true, whatsapp: true });

  await bookAndPay(h, people.asha!.token, main.id, dayFromNow(2), '18:00');
  await bookAndPay(h, people.asha!.token, nets.id, dayFromNow(3), '19:00');
  await bookAndPay(h, people.bhavin!.token, nets.id, dayFromNow(2), '20:00');
  await bookAndPay(h, people.chirag!.token, riverside.id, dayFromNow(2), '19:00'); // another owner's ground
  await bookAndPay(h, people.dev!.token, main.id, dayFromNow(20), '19:00'); // has not played yet
  setNow(T0 + 10 * DAY);
});

const names = (r: { body: { items: { name: string }[] } }) => r.body.items.map((x) => x.name).sort();

// ------------------------------------------------------------------ the list

test('contacts are the people who have played at this owner\'s grounds, and nobody else', async () => {
  const r = await h.get('/api/staff/contacts', owner);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(names(r), ['Asha Patel', 'Bhavin Shah'], 'Dev has not played yet and Chirag played for another owner');
  assert.equal(r.body.total, 2);
  const asha = r.body.items.find((x: any) => x.name === 'Asha Patel');
  assert.equal(asha.timesPlayed, 2);
  assert.equal(asha.slotsPlayed, 2);
  assert.deepEqual(asha.groundIds.sort(), [main.id, nets.id].sort());
  assert.ok(asha.paidPaise > 0);
  assert.ok(asha.lastPlayedAt > asha.firstPlayedAt);
  assert.deepEqual(asha.reachable, { email: true, sms: false, whatsapp: true });
  assert.deepEqual(r.body.summary, { total: 2, reachableEmail: 1, reachableWhatsapp: 1, reachableSms: 0 });
});

test('who=booked adds people with a confirmed session still to come; who=all adds no-shows', async () => {
  assert.deepEqual(names(await h.get('/api/staff/contacts?who=booked', owner)), ['Asha Patel', 'Bhavin Shah', 'Dev Rao']);
  const b = one<{ id: string }>("SELECT b.id FROM bookings b JOIN users u ON u.id = b.customer_id WHERE u.name = 'Bhavin Shah'")!;
  run("UPDATE bookings SET status = 'no_show' WHERE id = ?", b.id);
  assert.deepEqual(names(await h.get('/api/staff/contacts', owner)), ['Asha Patel'], 'a no-show did not play');
  assert.deepEqual(names(await h.get('/api/staff/contacts?who=all', owner)), ['Asha Patel', 'Bhavin Shah', 'Dev Rao']);
});

test('a played session counts once it has ended, whether or not the 24-hour sweep has marked it completed', async () => {
  const st = many<{ status: string }>("SELECT DISTINCT status FROM bookings WHERE status IN ('confirmed','completed')").map((x) => x.status);
  assert.ok(st.includes('confirmed'), 'these sessions are still just confirmed');
  assert.equal((await h.get('/api/staff/contacts', owner)).body.total, 2);
  run("UPDATE bookings SET status = 'completed' WHERE status = 'confirmed' AND end_at <= ?", T0 + 10 * DAY);
  assert.equal((await h.get('/api/staff/contacts', owner)).body.total, 2);
});

test('filters: ground, how often, lapsed, dates, search, and who can be reached', async () => {
  assert.deepEqual(names(await h.get(`/api/staff/contacts?groundId=${main.id}`, owner)), ['Asha Patel']);
  assert.deepEqual(names(await h.get(`/api/staff/contacts?groundId=${nets.id}`, owner)), ['Asha Patel', 'Bhavin Shah']);
  assert.deepEqual(names(await h.get('/api/staff/contacts?minTimes=2', owner)), ['Asha Patel']);
  assert.deepEqual(names(await h.get(`/api/staff/contacts?inactiveSince=${dayFromNow(3)}`, owner)), ['Bhavin Shah'], 'Asha played on day 3, Bhavin on day 2');
  assert.deepEqual(names(await h.get(`/api/staff/contacts?playedFrom=${dayFromNow(3)}&playedTo=${dayFromNow(3)}`, owner)), ['Asha Patel']);
  assert.deepEqual(names(await h.get('/api/staff/contacts?q=bhav', owner)), ['Bhavin Shah']);
  assert.deepEqual(names(await h.get('/api/staff/contacts?channel=email', owner)), ['Asha Patel']);
  assert.deepEqual(names(await h.get('/api/staff/contacts?q=%25', owner)), [], 'a % in the search is text, not a wildcard');
  const bad = await h.get('/api/staff/contacts?playedFrom=tomorrow&channel=pigeon', owner);
  assert.equal(bad.status, 400);
});

test('each owner sees their own contacts; staff need the permission; the admin names the owner', async () => {
  assert.deepEqual(names(await h.get('/api/staff/contacts', owner2)), ['Chirag Mehta']);
  assert.equal((await h.get('/api/staff/contacts', cust)).status, 403);
  assert.equal((await h.get('/api/staff/contacts')).status, 401);
  assert.equal((await h.get('/api/staff/contacts', staff)).status, 200, 'the demo staff member has view_customers');
  assert.equal((await h.get('/api/staff/contacts', admin)).status, 400);
  const ownerId = (await h.get('/api/me', owner2)).body.user.id;
  assert.deepEqual(names(await h.get(`/api/staff/contacts?ownerId=${ownerId}`, admin)), ['Chirag Mehta']);
});

test('the CSV export lists the same people, with consent columns, and cannot run a formula', async () => {
  setNow(T0);
  const evil = await person('=HYPERLINK("http://x.test","Click")', '9855555555', { email: true });
  await bookAndPay(h, evil.token, main.id, dayFromNow(4), '10:00');
  setNow(T0 + 10 * DAY);
  const r = await h.call('GET', '/api/staff/contacts/export', { token: owner });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') ?? '', /text\/csv/);
  assert.match(r.headers.get('content-disposition') ?? '', /attachment/);
  const text = r.body as string;
  assert.ok(text.startsWith('Name,Phone (with country code 91),Email,'), text.slice(0, 60));
  const bytes = Buffer.from(await (await fetch(`${h.url}/api/staff/contacts/export`, { headers: { authorization: `Bearer ${owner}` } })).arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'a byte-order mark, so Excel reads the file as UTF-8');
  assert.ok(text.includes('Asha Patel,919811111111,'));
  assert.ok(text.includes(`'=HYPERLINK`), 'a name that starts with = is written as text');
  assert.ok(!/(^|\n)=HYPERLINK/.test(text));
  assert.ok(one("SELECT 1 FROM audit_log WHERE action = 'contacts.export'"), 'exports are logged');
  assert.equal((await h.call('GET', '/api/staff/contacts/export', { token: cust })).status, 403);
});

// ------------------------------------------------------------------ preview

const bc = (extra: Record<string, unknown> = {}) => ({
  channel: 'email', subject: 'Ground closed on Sunday', body: 'Hi {name}, the ground is closed this Sunday for pitch repair.', ...extra,
});

test('the preview says who it will reach and who it will skip, and why', async () => {
  const r = await h.post('/api/staff/broadcasts/preview', bc(), owner);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.audience, 2);
  assert.equal(r.body.willSend, 1);
  assert.deepEqual(r.body.skipped, { noConsent: 1, noAddress: 0, disabled: 0 });
  assert.deepEqual(r.body.sample.map((x: { name: string }) => x.name), ['Asha Patel']);
  assert.match(r.body.preview.body, /^Hi Asha, the ground is closed/, 'the name is filled in');
  assert.match(r.body.preview.body, /Stop these emails: http:\/\/localhost:4000\/api\/unsubscribe\?t=/);
  assert.equal(r.body.preview.subject, 'Ground closed on Sunday');
  assert.equal(many('SELECT 1 FROM notifications WHERE template = ?', 'broadcast').length, 0, 'a preview sends nothing');
  assert.equal(many('SELECT 1 FROM broadcasts').length, 0);
});

test('the preview narrows with the same filter as the contact list', async () => {
  const r = await h.post('/api/staff/broadcasts/preview', bc({ filter: { groundId: main.id, minTimes: 1 } }), owner);
  assert.equal(r.body.audience, 1);
  const none = await h.post('/api/staff/broadcasts/preview', bc({ filter: { inactiveSince: dayFromNow(1) } }), owner);
  assert.equal(none.body.audience, 0);
  assert.equal(none.body.willSend, 0);
});

test('a message is checked for its channel', async () => {
  const noSubject = await h.post('/api/staff/broadcasts/preview', { channel: 'email', body: 'A perfectly fine message body' }, owner);
  assert.equal(noSubject.status, 400);
  assert.ok(noSubject.body.error.details.fields.some((f: { field: string }) => f.field === 'subject'));
  assert.equal((await h.post('/api/staff/broadcasts/preview', { channel: 'whatsapp', body: 'x'.repeat(901) }, owner)).status, 400);
  assert.equal((await h.post('/api/staff/broadcasts/preview', { channel: 'sms', body: 'x'.repeat(301) }, owner)).status, 400);
  assert.equal((await h.post('/api/staff/broadcasts/preview', { channel: 'sms', body: 'short' }, owner)).status, 400);
  assert.equal((await h.post('/api/staff/broadcasts/preview', { channel: 'pigeon', body: 'A perfectly fine message body' }, owner)).status, 400);
  const f = await h.post('/api/staff/broadcasts/preview', bc({ filter: { playedFrom: 'soon' } }), owner);
  assert.equal(f.status, 400);
  assert.ok(f.body.error.details.fields.some((x: { field: string }) => x.field === 'filter.playedFrom'));
});

// ------------------------------------------------------------------ sending

test('sending reaches only people who agreed, with their name and an unsubscribe link, and is recorded', async () => {
  const r = await h.post('/api/staff/broadcasts', bc({ confirmCount: 1 }), owner);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.broadcast.queued, 1);
  assert.equal(r.body.broadcast.skipped, 1);
  const rows = many<{ user_id: string; channel: string; category: string; status: string; body: string; subject: string }>("SELECT * FROM notifications WHERE template = 'broadcast'");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.user_id, people.asha!.id);
  assert.equal(rows[0]!.channel, 'email');
  assert.equal(rows[0]!.category, 'marketing');
  assert.match(rows[0]!.body, /^Hi Asha,/);
  assert.ok(rows[0]!.body.includes(`/api/unsubscribe?t=${unsubscribeToken(h.cfg, people.asha!.id, 'email')}`));
  assert.ok(!many('SELECT 1 FROM notifications WHERE user_id = ?', people.bhavin!.id).some((n: any) => n.template === 'broadcast'), 'Bhavin never said yes, so he got nothing');
  assert.ok(one("SELECT 1 FROM audit_log WHERE action = 'broadcast.send'"));

  const detail = await h.get(`/api/staff/broadcasts/${r.body.broadcast.id}`, owner);
  assert.equal(detail.status, 200);
  const byName = Object.fromEntries(detail.body.recipients.map((x: any) => [x.name, x]));
  assert.equal(byName['Asha Patel'].status, 'queued');
  assert.equal(byName['Bhavin Shah'].status, 'skipped');
  assert.equal(byName['Bhavin Shah'].reason, 'has not agreed to these messages');

  const list = await h.get('/api/staff/broadcasts', owner);
  assert.equal(list.body.total, 1);
  assert.equal(list.body.items[0].subject, 'Ground closed on Sunday');
});

test('sending needs the head-count from the preview, and refuses if the group has changed since', async () => {
  const none = await h.post('/api/staff/broadcasts', bc(), owner);
  assert.equal(none.status, 400);
  assert.equal(none.body.error.code, 'CONFIRM_REQUIRED');
  assert.equal(none.body.error.details.willSend, 1);
  const wrong = await h.post('/api/staff/broadcasts', bc({ confirmCount: 2 }), owner);
  assert.equal(wrong.status, 409);
  assert.equal(wrong.body.error.code, 'AUDIENCE_CHANGED');
  // Bhavin says yes after the owner looked at the preview.
  run('UPDATE users SET consent_email = 1 WHERE id = ?', people.bhavin!.id);
  const stale = await h.post('/api/staff/broadcasts', bc({ confirmCount: 1 }), owner);
  assert.equal(stale.status, 409, 'the owner confirmed 1 but it would now reach 2');
  assert.equal(stale.body.error.details.willSend, 2);
  assert.equal(many('SELECT 1 FROM notifications WHERE template = ?', 'broadcast').length, 0, 'nothing went out');
  assert.equal((await h.post('/api/staff/broadcasts', bc({ confirmCount: 2 }), owner)).status, 201);
});

test('dryRun on the send route is a preview', async () => {
  const r = await h.post('/api/staff/broadcasts', bc({ dryRun: true }), owner);
  assert.equal(r.status, 200);
  assert.equal(r.body.preview.willSend, 1);
  assert.equal(many('SELECT 1 FROM broadcasts').length, 0);
});

test('a customer who withdraws consent before the send is left out', async () => {
  assert.equal((await h.patch('/api/me', { consent: { email: false } }, people.asha!.token)).status, 200);
  const r = await h.post('/api/staff/broadcasts', bc({ confirmCount: 0 }), owner);
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'NOBODY_TO_SEND');
  assert.deepEqual(r.body.error.details.skipped, { noConsent: 2, noAddress: 0, disabled: 0 });
});

test('WhatsApp and text messages use the phone number and their own consent, with a STOP line', async () => {
  const w = await h.post('/api/staff/broadcasts', { channel: 'whatsapp', body: 'Hi {name}, the ground opens at 6 on Sunday.', confirmCount: 1 }, owner);
  assert.equal(w.status, 201, JSON.stringify(w.body));
  const row = one<{ user_id: string; channel: string; body: string }>("SELECT * FROM notifications WHERE template = 'broadcast' AND channel = 'whatsapp'")!;
  assert.equal(row.user_id, people.asha!.id);
  assert.match(row.body, /Reply STOP/);
  assert.ok(!row.body.includes('unsubscribe'));
  // Nobody agreed to texts.
  const s = await h.post('/api/staff/broadcasts', { channel: 'sms', body: 'The ground is closed on Sunday.', confirmCount: 0 }, owner);
  assert.equal(s.status, 400);
  assert.equal(s.body.error.code, 'NOBODY_TO_SEND');
});

test('someone without a phone number or a disabled account is skipped with the right reason', async () => {
  run('UPDATE users SET phone = NULL WHERE id = ?', people.asha!.id);
  const a = await h.post('/api/staff/broadcasts/preview', { channel: 'whatsapp', body: 'Hi {name}, news about the ground.' }, owner);
  assert.equal(a.body.skipped.noAddress, 1);
  run('UPDATE users SET active = 0 WHERE id = ?', people.asha!.id);
  const b = await h.post('/api/staff/broadcasts/preview', bc(), owner);
  assert.equal(b.body.willSend, 0);
  assert.equal(b.body.skipped.disabled, 1);
});

test('sending the same request twice sends once', async () => {
  const first = await h.post('/api/staff/broadcasts', bc({ confirmCount: 1, requestId: 'tap-1' }), owner);
  assert.equal(first.status, 201);
  const again = await h.post('/api/staff/broadcasts', bc({ confirmCount: 1, requestId: 'tap-1' }), owner);
  assert.equal(again.status, 200);
  assert.equal(again.body.replayed, true);
  assert.equal(again.body.broadcast.id, first.body.broadcast.id);
  assert.equal(many("SELECT 1 FROM notifications WHERE template = 'broadcast'").length, 1);
});

test('there is a limit on how many broadcasts an owner can send in a day', async () => {
  for (let i = 0; i < DAILY_BROADCAST_LIMIT; i++) assert.equal((await h.post('/api/staff/broadcasts', bc({ confirmCount: 1, body: `Update number ${i + 1} about the ground.` }), owner)).status, 201);
  const r = await h.post('/api/staff/broadcasts', bc({ confirmCount: 1 }), owner);
  assert.equal(r.status, 429);
  assert.equal(r.body.error.code, 'BROADCAST_LIMIT');
  setNow(T0 + 11 * DAY + 1);
  assert.equal((await h.post('/api/staff/broadcasts', bc({ confirmCount: 1 }), owner)).status, 201, 'a day later it works again');
});

test('delivery results show up in the broadcast: sent and failed', async () => {
  run('UPDATE users SET consent_whatsapp = 1 WHERE id = ?', people.bhavin!.id);
  registerProvider('whatsapp', (m) => (m.to === '9822222222' ? { ok: false, error: 'number not on WhatsApp' } : { ok: true }));
  const r = await h.post('/api/staff/broadcasts', { channel: 'whatsapp', body: 'Hi {name}, the ground is open as usual.', confirmCount: 2 }, owner);
  assert.equal(r.status, 201);
  await flushNotifications();
  const d = await h.get(`/api/staff/broadcasts/${r.body.broadcast.id}`, owner);
  assert.equal(d.body.broadcast.sent, 1);
  assert.equal(d.body.broadcast.failed, 1);
  const by = Object.fromEntries(d.body.recipients.map((x: any) => [x.name, x]));
  assert.equal(by['Asha Patel'].status, 'sent');
  assert.equal(by['Bhavin Shah'].status, 'failed');
  assert.equal(by['Bhavin Shah'].reason, 'number not on WhatsApp');
});

// ------------------------------------------------------------------ access

test('staff need send_broadcasts, an owner can grant it, other owners cannot see the broadcast', async () => {
  assert.equal((await h.post('/api/staff/broadcasts/preview', bc(), staff)).status, 403);
  assert.equal((await h.get('/api/staff/broadcasts', staff)).status, 403);
  assert.equal((await h.post('/api/staff/broadcasts/preview', bc(), cust)).status, 403);
  assert.equal((await h.post('/api/staff/broadcasts/preview', bc())).status, 401);

  const made = await h.post('/api/staff/team', { name: 'Comms Staff', email: 'comms@daji.test', password: 'Comms@12345', permissions: ['view_customers', 'send_broadcasts'] }, owner);
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const tok = (await h.post('/api/auth/login', { email: 'comms@daji.test', password: 'Comms@12345' })).body.token;
  const sent = await h.post('/api/staff/broadcasts', bc({ confirmCount: 1 }), tok);
  assert.equal(sent.status, 201, JSON.stringify(sent.body));

  assert.equal((await h.get(`/api/staff/broadcasts/${sent.body.broadcast.id}`, owner2)).status, 404, 'another owner cannot open it');
  assert.equal((await h.get('/api/staff/broadcasts', owner2)).body.total, 0);
  assert.equal((await h.get('/api/staff/broadcasts', owner)).body.total, 1, 'the owner sees what their staff sent');
});

test('an owner can only message their own contacts, even if they name another owner\'s ground', async () => {
  const r = await h.post('/api/staff/broadcasts/preview', bc({ filter: { groundId: riverside.id } }), owner);
  assert.equal(r.body.audience, 0);
});

test('the templates are available to people who may send', async () => {
  const r = await h.get('/api/staff/broadcast-templates', owner);
  assert.equal(r.status, 200);
  assert.ok(r.body.items.length >= 5);
  assert.ok(r.body.items.every((t: any) => t.id && t.title && t.body.includes('{name}')));
  assert.equal((await h.get('/api/staff/broadcast-templates', staff)).status, 403);
});

// ------------------------------------------------------------------ unsubscribe

test('the unsubscribe link: opening it changes nothing, pressing the button turns that channel off', async () => {
  const token = unsubscribeToken(h.cfg, people.asha!.id, 'email');
  const page = await h.call('GET', `/api/unsubscribe?t=${encodeURIComponent(token)}`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type') ?? '', /text\/html/);
  assert.match(page.headers.get('content-security-policy') ?? '', /default-src 'none'/);
  assert.match(page.body as string, /<form method="post"/);
  assert.ok(!(page.body as string).includes('Asha'), 'the page does not show anyone\'s name');
  assert.equal(one<{ c: number }>('SELECT consent_email c FROM users WHERE id = ?', people.asha!.id)!.c, 1, 'a mail scanner opening the link did nothing');

  const done = await h.call('POST', `/api/unsubscribe?t=${encodeURIComponent(token)}`, { raw: '' });
  assert.equal(done.status, 200);
  assert.match(done.body as string, /Done/);
  const u = one<{ e: number; w: number }>('SELECT consent_email e, consent_whatsapp w FROM users WHERE id = ?', people.asha!.id)!;
  assert.equal(u.e, 0);
  assert.equal(u.w, 1, 'only the email choice changed');
  assert.ok(one("SELECT 1 FROM audit_log WHERE action = 'consent.unsubscribe'"));
  assert.equal((await h.call('POST', `/api/unsubscribe?t=${encodeURIComponent(token)}`, { raw: '' })).status, 200, 'pressing it twice is fine');

  const after = await h.post('/api/staff/broadcasts/preview', bc(), owner);
  assert.equal(after.body.willSend, 0, 'the next broadcast leaves them out');
});

test('a forged, cut-off or mixed-up unsubscribe link does nothing', async () => {
  const good = unsubscribeToken(h.cfg, people.asha!.id, 'email');
  const [uid, ch, mac] = good.split('.');
  for (const bad of [`${uid}.${ch}.${mac!.slice(0, -2)}`, `${uid}.whatsapp.${mac}`, `${people.bhavin!.id}.email.${mac}`, `${uid}.${ch}.`, 'nonsense', '', `${good}.extra`]) {
    const r = await h.call('POST', `/api/unsubscribe?t=${encodeURIComponent(bad)}`, { raw: '' });
    assert.equal(r.status, 400, bad);
  }
  assert.equal(one<{ c: number }>('SELECT consent_email c FROM users WHERE id = ?', people.asha!.id)!.c, 1);
  assert.equal(one<{ c: number }>('SELECT consent_email c FROM users WHERE id = ?', people.bhavin!.id)!.c, 0);
});
