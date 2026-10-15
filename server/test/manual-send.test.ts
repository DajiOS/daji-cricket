import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, grounds, bookAndPay, dayFromNow, setNow, T0, DAY, type Harness } from './helpers.ts';
import { register } from './register.ts';
import { one } from '../src/db.ts';
import { registerProvider } from '../src/notifications.ts';

let h: Harness;
let owner: string, owner2: string, staff: string;
const people: Record<string, { token: string; id: string }> = {};

before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });

async function person(name: string, phone: string, consent: Record<string, boolean>) {
  const token = await register(h, name, phone, { consent });
  return { token, id: (await h.get('/api/me', token)).body.user.id as string };
}

beforeEach(async () => {
  h.reset();
  for (const c of ['email', 'whatsapp', 'sms'] as const) registerProvider(c, null);
  const main = (await grounds(h)).find((g) => g.name === 'Cricket Ground')!;
  owner = await h.login('owner1'); owner2 = await h.login('owner2'); staff = await h.login('staff1');
  people.asha = await person('Asha Patel', '9811111111', { email: true, whatsapp: true, sms: true });
  people.dev = await person('Dev Rao', '9844444444', { email: true, whatsapp: true });
  await bookAndPay(h, people.asha!.token, main.id, dayFromNow(2), '18:00');
  await bookAndPay(h, people.dev!.token, main.id, dayFromNow(2), '19:00');
  setNow(T0 + 10 * DAY);
});

async function send(channel: 'email' | 'whatsapp' | 'sms') {
  const body = channel === 'email' ? { channel, subject: 'Ground closed on Sunday', body: 'Hi {name}, the ground is closed this Sunday.' } : { channel, body: 'Hi {name}, the ground is closed this Sunday.' };
  const r = await h.post('/api/staff/broadcasts', { ...body, confirmCount: channel === 'sms' ? 1 : 2 }, owner);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.broadcast.id as string;
}

test('WhatsApp: one link per person with the stored message, in 91 format', async () => {
  const id = await send('whatsapp');
  const r = await h.get(`/api/staff/broadcasts/${id}/manual`, owner);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.items.length, 2);
  const asha = r.body.items.find((i: any) => i.name === 'Asha Patel');
  assert.equal(asha.to, '919811111111');
  assert.ok(asha.link.startsWith('https://wa.me/919811111111?text='));
  assert.ok(decodeURIComponent(asha.link.split('text=')[1]).startsWith('Hi Asha, the ground is closed this Sunday.'));
  assert.equal(asha.sent, false);
});

test('SMS links use sms:+91 and email comes as BCC groups with no names of other people in the message', async () => {
  const sms = await send('sms');
  const s = await h.get(`/api/staff/broadcasts/${sms}/manual`, owner);
  assert.equal(s.body.items.length, 1);
  assert.ok(s.body.items[0].link.startsWith('sms:+919811111111?body='));

  const em = await send('email');
  const e = await h.get(`/api/staff/broadcasts/${em}/manual`, owner);
  assert.equal(e.body.emailGroups.length, 1);
  assert.equal(e.body.emailGroups[0].count, 2);
  assert.ok(e.body.emailGroups[0].link.startsWith('mailto:?bcc='));
  assert.ok(!e.body.emailGroups[0].link.includes('&bcc'), 'recipients are only in bcc');
});

test('marking as sent changes only queued messages of that broadcast, and only once', async () => {
  const id = await send('whatsapp');
  const a = people.asha!.id;
  const first = await h.post(`/api/staff/broadcasts/${id}/manual-sent`, { userIds: [a, 'usr_nobody'] }, owner);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.marked, 1);
  assert.equal((await h.post(`/api/staff/broadcasts/${id}/manual-sent`, { userIds: [a] }, owner)).body.marked, 0, 'already sent');
  const r = await h.get(`/api/staff/broadcasts/${id}/manual`, owner);
  assert.equal(r.body.items.find((i: any) => i.userId === a).sent, true);
  assert.equal(r.body.items.find((i: any) => i.userId === people.dev!.id).sent, false);
  assert.equal((await h.get(`/api/staff/broadcasts/${id}`, owner)).body.broadcast.sent, 1);
  assert.equal((await h.post(`/api/staff/broadcasts/${id}/manual-sent`, { userIds: [] }, owner)).status, 400);
  assert.ok(one("SELECT 1 x FROM audit_log WHERE action = 'broadcast.manual_sent'"));
});

test('permission and owner isolation apply to the manual routes', async () => {
  const id = await send('whatsapp');
  assert.equal((await h.get(`/api/staff/broadcasts/${id}/manual`, staff)).status, 403);
  assert.equal((await h.get(`/api/staff/broadcasts/${id}/manual`, owner2)).status, 404);
  assert.equal((await h.post(`/api/staff/broadcasts/${id}/manual-sent`, { userIds: [people.asha!.id] }, owner2)).status, 404);
  assert.equal((await h.get(`/api/staff/broadcasts/${id}/manual`)).status, 401);
});

test('staff can switch a channel off for someone who replied STOP, and later broadcasts skip them', async () => {
  const a = people.asha!.id;
  assert.equal((await h.post(`/api/staff/contacts/${a}/opt-out`, { channel: 'whatsapp' }, staff)).status, 403, 'needs send_broadcasts');
  assert.equal((await h.post(`/api/staff/contacts/${a}/opt-out`, { channel: 'whatsapp' }, owner2)).status, 404, 'not owner2 contact');
  assert.equal((await h.post(`/api/staff/contacts/${a}/opt-out`, { channel: 'pigeon' }, owner)).status, 400);
  const r = await h.post(`/api/staff/contacts/${a}/opt-out`, { channel: 'whatsapp' }, owner);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(one<{ c: number }>('SELECT consent_whatsapp c FROM users WHERE id = ?', a)!.c, 0);
  assert.equal(one<{ c: number }>('SELECT consent_email c FROM users WHERE id = ?', a)!.c, 1, 'other channels untouched');
  const pv = await h.post('/api/staff/broadcasts/preview', { channel: 'whatsapp', body: 'Hi {name}, the ground is closed.' }, owner);
  assert.equal(pv.body.willSend, 1);
  assert.ok(one("SELECT 1 x FROM audit_log WHERE action = 'consent.staff_opt_out'"));
});
