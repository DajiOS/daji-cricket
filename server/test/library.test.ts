import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, type Harness } from './helpers.ts';

let h: Harness, owner: string, cust: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => { h.reset(); owner = await h.login('owner1'); cust = await h.login('customer'); });

const VIDEO = Buffer.concat([Buffer.from('....ftypmp42'), Buffer.alloc(300000, 7)]);
const up = (tok: string | null, body: Buffer, q = 'name=ground.mp4&tag=hero') =>
  fetch(`${h.url}/api/library?${q}`, { method: 'POST', headers: { ...(tok ? { authorization: `Bearer ${tok}` } : {}), 'content-type': 'application/octet-stream' }, body });

test('an owner uploads a video, the public can play it with Range, and it can be relabelled and removed', async () => {
  const r = await up(owner, VIDEO);
  const j = await r.json() as any;
  assert.equal(r.status, 201, JSON.stringify(j));
  assert.equal(j.kind, 'video'); assert.equal(j.tag, 'hero'); assert.equal(j.bytes, VIDEO.length);
  const full = await fetch(h.url + j.url);
  assert.equal(full.status, 200); assert.equal(full.headers.get('content-type'), 'video/mp4'); assert.equal(full.headers.get('accept-ranges'), 'bytes');
  assert.equal(full.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), VIDEO);
  const part = await fetch(h.url + j.url, { headers: { range: 'bytes=10-19' } });
  assert.equal(part.status, 206); assert.equal(part.headers.get('content-range'), `bytes 10-19/${VIDEO.length}`);
  assert.deepEqual(Buffer.from(await part.arrayBuffer()), VIDEO.subarray(10, 20));
  assert.equal((await fetch(h.url + j.url, { headers: { range: 'bytes=999999999-' } })).status, 416);
  const pub = await (await fetch(h.url + '/api/library/public?tag=hero')).json() as any;
  assert.equal(pub.items.length, 1);
  const list = await h.get('/api/library', owner); assert.equal(list.status, 200); assert.equal(list.body.items.length, 1); assert.equal(list.body.libraryBytes, VIDEO.length);
  assert.equal((await h.patch('/api/library/' + j.id, { tag: 'gallery' }, owner)).body.tag, 'gallery');
  assert.equal((await h.del('/api/library/' + j.id, owner)).status, 200);
  assert.equal((await fetch(h.url + j.url)).status, 404);
});

test('only owners upload, and only photo and video types are kept', async () => {
  assert.equal((await up(null, VIDEO)).status, 401);
  assert.equal((await up(cust, VIDEO)).status, 403);
  assert.equal((await up(owner, Buffer.from('<script>1</script>'), 'name=x.html')).status, 415);
  assert.equal((await up(owner, Buffer.from('<svg/>'), 'name=x.svg')).status, 415);
  assert.equal((await up(owner, Buffer.alloc(0))).status, 400);
  assert.equal((await fetch(h.url + '/media/lib_nothing.mp4')).status, 404);
});
