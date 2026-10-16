import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { startHarness, type Harness } from './helpers.ts';
import { buildScenario, type Scenario } from './scenario.ts';
import { resetScanLimits, toVcard } from '../src/cards.ts';

let h: Harness, sc: Scenario;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => { sc = await buildScenario(h); resetScanLimits(); });

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('tiny card')]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jfif')]);

interface Fake { url: string; calls: any[]; reply: { status: number; text: string }; close(): Promise<void> }
async function fake(text: string, status = 200): Promise<Fake> {
  const f: Fake = { url: '', calls: [], reply: { status, text }, close: async () => {} };
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
      f.calls.push({ headers: req.headers, body: JSON.parse(b) });
      res.writeHead(f.reply.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ content: [{ type: 'text', text: f.reply.text }], stop_reason: 'end_turn' }));
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  f.url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  f.close = () => new Promise((r) => srv.close(() => r()));
  return f;
}
const withAi = (url: string) => { h.cfg.ai = { ...h.cfg.ai, apiKey: 'sk-test', apiUrl: url, limitPerHour: 500, timeoutMs: 5000 }; };
async function raw(path: string, tok: string, body: Buffer, method = 'POST') {
  const r = await fetch(`${h.url}${path}`, { method, headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/octet-stream' }, body });
  return { status: r.status, body: await r.json() as any };
}

const READ = JSON.stringify({ name: ' Munaf  Patel ', title: 'Coach', company: 'MP13 Academy', phones: ['+91 75671 56000', 'abc'], emails: ['COACH@Example.com', 'not-an-email'], website: 'javascript:alert(1)', address: '1 Ground Rd\nVadodara', notes: '' });

test('scanning a card sends the photo to Claude and returns a cleaned draft without saving', async () => {
  const f = await fake('Here you go:\n' + READ); withAi(f.url);
  try {
    const r = await raw('/api/staff/cards/scan', sc.owner, PNG);
    assert.equal(r.status, 200);
    assert.equal(r.body.readable, true);
    assert.deepEqual(r.body.fields.phones, ['+91 75671 56000']);
    assert.deepEqual(r.body.fields.emails, ['coach@example.com']);
    assert.equal(r.body.fields.name, 'Munaf Patel');
    assert.equal(r.body.fields.website, '', 'script links are dropped');
    const img = f.calls[0].body.messages[0].content[0];
    assert.equal(img.source.media_type, 'image/png');
    assert.equal(img.source.data, PNG.toString('base64'));
    assert.equal(f.calls[0].headers['x-api-key'], 'sk-test');
    assert.equal((await h.get('/api/staff/cards', sc.owner)).body.total, 0, 'a scan saves nothing');
  } finally { await f.close(); }
});

test('scan failures are clear: no key, bad file, unreadable reply, upstream error, not a card', async () => {
  h.cfg.ai = { ...h.cfg.ai, apiKey: '' };
  const nk = await raw('/api/staff/cards/scan', sc.owner, PNG);
  assert.equal(nk.status, 409);
  assert.equal(JSON.stringify(nk.body).includes('OCR_NOT_CONFIGURED'), true);
  assert.equal((await h.get('/api/staff/cards/status', sc.owner)).body.ocr, false);
  const f = await fake('no json here'); withAi(f.url);
  try {
    assert.equal((await raw('/api/staff/cards/scan', sc.owner, Buffer.from('%PDF-1.4'))).status, 415);
    assert.equal((await raw('/api/staff/cards/scan', sc.owner, Buffer.from('<svg/>'))).status, 415);
    assert.equal((await raw('/api/staff/cards/scan', sc.owner, Buffer.alloc(0))).status, 400);
    assert.equal((await raw('/api/staff/cards/scan', sc.owner, Buffer.concat([JPG, Buffer.alloc(5 * 1024 * 1024)]))).status, 413);
    assert.equal((await raw('/api/staff/cards/scan', sc.owner, PNG)).status, 502, 'no JSON in the reply');
    f.reply = { status: 500, text: 'x' };
    assert.equal((await raw('/api/staff/cards/scan', sc.owner, PNG)).status, 502);
    f.reply = { status: 200, text: JSON.stringify({ name: '', phones: [], emails: [] }) };
    const r = await raw('/api/staff/cards/scan', sc.owner, PNG);
    assert.equal(r.body.readable, false);
  } finally { await f.close(); }
});

test('scans are limited per person per hour', async () => {
  const f = await fake(READ); withAi(f.url); h.cfg.ai.limitPerHour = 2;
  try {
    assert.equal((await raw('/api/staff/cards/scan', sc.owner, PNG)).status, 200);
    assert.equal((await raw('/api/staff/cards/scan', sc.owner, PNG)).status, 200);
    assert.equal((await raw('/api/staff/cards/scan', sc.owner, PNG)).status, 429);
  } finally { await f.close(); }
});

test('save, find, edit, photo, vcard and delete; each owner sees only their own', async () => {
  const mk = async (tok: string, body: object) => h.post('/api/staff/cards', body, tok);
  const a = await mk(sc.owner, { name: 'Asha Shah', title: 'Manager', company: 'Shah, Sons & Co', phones: ['98250 12345'], emails: ['asha@shah.example'], website: 'https://shah.example', address: 'Line1\nLine2; City', notes: 'Met at expo' });
  assert.equal(a.status, 201);
  const id = a.body.id;
  assert.equal((await mk(sc.owner, { name: '' })).status, 400);
  await mk(sc.owner, { name: 'Zed' });

  const list = await h.get('/api/staff/cards?q=shah', sc.owner);
  assert.equal(list.body.total, 1);
  assert.equal((await h.get('/api/staff/cards?q=%25', sc.owner)).body.total, 0, 'wildcards are literal');
  assert.equal((await h.get('/api/staff/cards', sc.owner)).body.items[0].name, 'Asha Shah');

  assert.equal((await h.patch(`/api/staff/cards/${id}`, { company: 'Shah Group' }, sc.owner)).body.company, 'Shah Group');
  assert.equal((await h.get(`/api/staff/cards/${id}`, sc.owner)).body.name, 'Asha Shah', 'unsent fields stay');

  assert.equal((await raw(`/api/staff/cards/${id}/image`, sc.owner, Buffer.from('<svg/>'))).status, 415);
  assert.equal((await raw(`/api/staff/cards/${id}/image`, sc.owner, JPG)).status, 200);
  const img = await fetch(`${h.url}/api/staff/cards/${id}/image`, { headers: { authorization: `Bearer ${sc.owner}` } });
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.equal((await fetch(`${h.url}/api/staff/cards/${id}/image`, { headers: { authorization: `Bearer ${sc.owner2}` } })).status, 404);
  assert.equal((await fetch(`${h.url}/api/staff/cards/${id}/image`)).status, 401);

  const v = await fetch(`${h.url}/api/staff/cards/${id}/vcard`, { headers: { authorization: `Bearer ${sc.owner}` } });
  assert.match(v.headers.get('content-type') ?? '', /text\/vcard/);
  const txt = await v.text();
  assert.match(txt, /^BEGIN:VCARD\r\nVERSION:3.0\r\n/);
  assert.match(txt, /FN:Asha Shah/); assert.match(txt, /ORG:Shah Group/); assert.match(txt, /TEL;TYPE=WORK,VOICE:98250 12345/);
  assert.match(txt, /ADR;TYPE=WORK:;;Line1\\nLine2\; City/);

  // other owner: not found, empty list
  assert.equal((await h.get(`/api/staff/cards/${id}`, sc.owner2)).status, 404);
  assert.equal((await h.patch(`/api/staff/cards/${id}`, { name: 'x' }, sc.owner2)).status, 404);
  assert.equal((await h.get('/api/staff/cards', sc.owner2)).body.total, 0);
  assert.equal((await h.del(`/api/staff/cards/${id}`, sc.owner2)).status, 404);

  const all = await fetch(`${h.url}/api/staff/cards/export.vcf`, { headers: { authorization: `Bearer ${sc.owner}` } });
  assert.equal(((await all.text()).match(/BEGIN:VCARD/g) ?? []).length, 2);

  assert.equal((await h.del(`/api/staff/cards/${id}`, sc.owner)).status, 200);
  assert.equal((await h.get(`/api/staff/cards/${id}`, sc.owner)).status, 404);
  assert.equal((await h.get('/api/staff/cards', sc.owner)).body.total, 1);
});

test('who may use cards: customers no, staff needs view_customers', async () => {
  assert.equal((await h.get('/api/staff/cards', sc.cust)).status, 403);
  assert.equal((await h.post('/api/staff/cards', { name: 'x' }, sc.cust)).status, 403);
  assert.equal((await raw('/api/staff/cards/scan', sc.cust, PNG)).status, 403);
});

test('a possible duplicate is flagged on scan', async () => {
  await h.post('/api/staff/cards', { name: 'Munaf P', phones: ['07567156000'], emails: [] }, sc.owner);
  const f = await fake(READ); withAi(f.url);
  try {
    const r = await raw('/api/staff/cards/scan', sc.owner, PNG);
    assert.equal(r.body.duplicates.length, 1);
    assert.equal(r.body.duplicates[0].name, 'Munaf P');
  } finally { await f.close(); }
});

test('vcard escapes line breaks so a card cannot add its own lines', () => {
  const t = toVcard([{ id: 'x', name: 'A\r\nEND:VCARD', title: '', company: '', phones: [], emails: [], website: '', address: '', notes: 'x\nBEGIN:VCARD', hasImage: false, createdAt: 0, updatedAt: 0 }]);
  assert.equal(t.split('\r\n').filter((l) => l === 'BEGIN:VCARD').length, 1);
  assert.equal(t.split('\r\n').filter((l) => l === 'END:VCARD').length, 1);
});
