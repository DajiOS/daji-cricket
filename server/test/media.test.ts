import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, type Harness } from './helpers.ts';

let h: Harness, owner: string, admin: string, cust: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => { h.reset(); owner = await h.login('owner1'); admin = await h.login('admin'); cust = await h.login('customer'); });

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('rest of a tiny image')]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jfif body')]);
async function upload(tok: string, body: Buffer, q = 'kind=gallery&filename=a.png') {
  const r = await fetch(`${h.url}/api/media?${q}`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/octet-stream' }, body });
  return { status: r.status, body: await r.json() as any };
}

test('a photo is checked by its content, stored, listed, and served publicly with safe headers', async () => {
  const r = await upload(admin, PNG);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.match(r.body.url, /^\/api\/media\/med_/);
  const pub = await fetch(h.url + r.body.url);
  assert.equal(pub.status, 200);
  assert.equal(pub.headers.get('content-type'), 'image/png');
  assert.equal(pub.headers.get('x-content-type-options'), 'nosniff');
  assert.match(pub.headers.get('content-security-policy') ?? '', /sandbox/);
  assert.deepEqual(Buffer.from(await pub.arrayBuffer()), PNG);
  const same = await upload(admin, PNG);
  assert.equal(same.body.id, r.body.id, 'the same photo twice is one photo');
  assert.equal((await h.get('/api/media?kind=gallery', admin)).body.items.length, 1);
});

test('only real photos are accepted, within the size limit', async () => {
  assert.equal((await upload(admin, Buffer.from('<svg onload=alert(1)>'), 'kind=gallery&filename=x.png')).status, 415);
  assert.equal((await upload(admin, Buffer.from('%PDF-1.4 ...'), 'kind=gallery&filename=x.jpg')).status, 415, 'the name does not matter, the content does');
  assert.equal((await upload(admin, Buffer.alloc(0))).status, 400);
  assert.equal((await upload(admin, JPG, 'kind=banner')).status, 400);
  assert.equal((await upload(admin, Buffer.concat([JPG, Buffer.alloc(6 * 1024 * 1024)]))).status, 413);
  assert.equal((await upload(admin, JPG, 'kind=academy&filename=../../etc/passwd')).status, 201);
});

test('who may upload, and one owner cannot list or remove another owner\'s photos', async () => {
  assert.equal((await upload(cust, PNG)).status, 403);
  assert.equal((await fetch(`${h.url}/api/media?kind=gallery`, { method: 'POST', body: PNG })).status, 401);
  const mine = await upload(owner, PNG);
  assert.equal(mine.status, 201);
  const owner2 = await h.login('owner2');
  assert.equal((await h.get('/api/media', owner2)).body.items.length, 0);
  assert.equal((await h.del(`/api/media/${mine.body.id}`, owner2)).status, 404);
  assert.equal((await h.get('/api/media', owner)).body.items.length, 1);
  assert.equal((await h.del(`/api/media/${mine.body.id}`, owner)).status, 200);
  assert.equal((await fetch(h.url + mine.body.url)).status, 404, 'a removed photo stops being served');
});

test('uploaded photos can be put in the website gallery and academy, other paths cannot', async () => {
  const a = await upload(admin, PNG), b = await upload(admin, JPG, 'kind=academy&filename=b.jpg');
  const ok = await h.put('/api/admin/settings', { galleryImages: [a.body.url, 'https://example.com/x.jpg'], academyImages: [b.body.url] }, admin);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const cfg = (await h.get('/api/config')).body;
  assert.deepEqual(cfg.gallery, [a.body.url, 'https://example.com/x.jpg']);
  assert.deepEqual(cfg.academyGallery, [b.body.url]);
  for (const bad of ['/api/media/../x', '/etc/passwd', 'javascript:alert(1)', '/api/media/med_x"onerror=']) assert.equal((await h.put('/api/admin/settings', { galleryImages: [bad] }, admin)).status, 400, bad);
});
