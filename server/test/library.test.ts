import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHarness, type Harness } from './helpers.ts';
import { libraryIdle } from '../src/library.ts';

const hasFfmpeg = () => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } };

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

test('a 4K video keeps its original, and gets a 1080p HD copy, a light copy, a sharp poster and its real size', { skip: !hasFfmpeg() }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vid-'));
  const file = join(dir, 'drone.mp4');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=10:duration=2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', file]);
  const orig = readFileSync(file);
  const j = await (await up(owner, orig, 'name=drone.mp4&tag=gallery')).json() as any;
  for (let i = 0; i < 600 && !libraryIdle(); i++) await new Promise((r) => setTimeout(r, 100));
  const it = (await h.get('/api/library', owner)).body.items[0];
  assert.deepEqual(it.info, { width: 3840, height: 2160, codec: 'h264', seconds: 2 });
  assert.equal(it.url, j.url);
  assert.deepEqual(Buffer.from(await (await fetch(h.url + it.url)).arrayBuffer()), orig, 'the original is served untouched');
  assert.ok(it.hd && it.web && it.poster && it.thumb);
  const hd = await fetch(h.url + it.hd, { headers: { range: 'bytes=0-99' } });
  assert.equal(hd.status, 206); assert.equal(hd.headers.get('content-type'), 'video/mp4');
  const save = async (u: string) => { const f = join(dir, u.split('/').pop()!); writeFileSync(f, Buffer.from(await (await fetch(h.url + u)).arrayBuffer())); return f; };
  const hdFile = await save(it.hd), posterFile = await save(it.poster);
  const dims = (f: string) => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f]).toString().trim();
  assert.equal(dims(hdFile), '1920,1080');
  assert.equal(dims(posterFile), '1920,1080');
  assert.equal((await fetch(h.url + it.poster)).headers.get('content-type'), 'image/jpeg');
  assert.equal((await h.del('/api/library/' + it.id, owner)).status, 200);
  assert.equal((await fetch(h.url + it.hd)).status, 404);
});
