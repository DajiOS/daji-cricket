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
  // the website lists a video at once and plays the original
  for (let i = 0; i < 600 && !libraryIdle(); i++) await new Promise((r) => setTimeout(r, 100));
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

test('a portrait 4K clip gets a real 1080 x 1920 HD copy and a 720 x 1280 light copy, not ones shrunk by its height', { skip: !hasFfmpeg() }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vid-'));
  const file = join(dir, 'reel.mp4');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=2160x3840:rate=10:duration=1', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', file]);
  await up(owner, readFileSync(file), 'name=reel.mp4&tag=gallery');
  for (let i = 0; i < 900 && !libraryIdle(); i++) await new Promise((r) => setTimeout(r, 100));
  const it = (await h.get('/api/library', owner)).body.items.find((x: any) => x.name === 'reel.mp4');
  const dims = async (u: string) => { const f = join(dir, u.split('/').pop()!); writeFileSync(f, Buffer.from(await (await fetch(h.url + u)).arrayBuffer())); return execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f]).toString().trim(); };
  assert.equal(await dims(it.hd), '1080,1920');
  assert.equal(await dims(it.web), '720,1280');
  assert.equal((await h.del('/api/library/' + it.id, owner)).status, 200);
});

test('bulk: several files are relabelled and removed at once, each with its own result, and the stored files go too', async () => {
  const ids: string[] = [];
  for (const n of ['a', 'b', 'c']) ids.push(((await (await up(owner, VIDEO, `name=${n}.mp4&tag=gallery`)).json()) as any).id);
  const list = (await h.get('/api/library', owner)).body.items as any[];
  const urlOf = (id: string) => list.find((i) => i.id === id).url as string;
  assert.equal((await fetch(h.url + urlOf(ids[0]!))).status, 200);
  // relabel two of them
  const t = await h.post('/api/library/bulk-tag', { ids: [ids[0], ids[1], 'lib_missing'], tag: 'academy' }, owner);
  assert.equal(t.status, 200, JSON.stringify(t.body));
  assert.deepEqual(t.body.results.map((r: any) => r.ok), [true, true, false]);
  assert.equal(((await h.get('/api/library?tag=academy', owner)).body.items as any[]).length, 2);
  assert.equal((await h.post('/api/library/bulk-tag', { ids, tag: 'nope' }, owner)).status, 400);
  // remove two, plus a duplicate and one that does not exist
  const d = await h.post('/api/library/bulk-remove', { ids: [ids[0], ids[1], ids[1], 'lib_missing'] }, owner);
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.deepEqual(d.body.results.map((r: any) => [r.id, r.ok]), [[ids[0], true], [ids[1], true], ['lib_missing', false]]);
  assert.equal((await fetch(h.url + urlOf(ids[0]!))).status, 404);
  assert.equal((await fetch(h.url + urlOf(ids[1]!))).status, 404);
  assert.equal((await fetch(h.url + urlOf(ids[2]!))).status, 200);
  assert.equal(((await h.get('/api/library', owner)).body.items as any[]).length, 1);
});

test('bulk: needs an owner, a non-empty list and at most 200 files', async () => {
  assert.equal((await h.post('/api/library/bulk-remove', { ids: ['x'] }, cust)).status, 403);
  assert.equal((await h.post('/api/library/bulk-remove', { ids: ['x'] })).status, 401);
  assert.equal((await h.post('/api/library/bulk-remove', { ids: [] }, owner)).status, 400);
  assert.equal((await h.post('/api/library/bulk-remove', {}, owner)).status, 400);
  assert.equal((await h.post('/api/library/bulk-remove', { ids: Array.from({ length: 201 }, (_, i) => `lib_${i}`) }, owner)).status, 400);
});

test('a big file goes up in pieces, picks up where it stopped, and arrives byte for byte', async () => {
  const file = Buffer.concat([Buffer.from('....ftypmp42'), Buffer.from(Array.from({ length: 250000 }, (_, i) => i % 251))]);
  const put = (id: string, offset: number, body: Buffer) => fetch(`${h.url}/api/library/uploads/${id}?offset=${offset}`, { method: 'PUT', headers: { authorization: `Bearer ${owner}`, 'content-type': 'application/octet-stream' }, body });
  const start = await h.post('/api/library/uploads', { name: 'drone 4k.mp4', size: file.length, tag: 'gallery', key: 'drone 4k.mp4|250012|1' }, owner);
  assert.equal(start.status, 201); assert.equal(start.body.received, 0);
  const id = start.body.id;
  let r = await put(id, 0, file.subarray(0, 100000));
  assert.equal(r.status, 200); assert.equal(((await r.json()) as any).received, 100000);
  // the tab was closed: the same file again carries on from 100000, and a piece at the wrong place is refused with where to go on
  const again = await h.post('/api/library/uploads', { name: 'drone 4k.mp4', size: file.length, tag: 'gallery', key: 'drone 4k.mp4|250012|1' }, owner);
  assert.deepEqual([again.body.id, again.body.received], [id, 100000]);
  r = await put(id, 50, file.subarray(50, 100));
  assert.equal(r.status, 409); assert.equal(((await r.json()) as any).error.details.received, 100000);
  assert.equal((await h.get(`/api/library/uploads/${id}`, owner)).body.received, 100000);
  r = await put(id, 100000, file.subarray(100000));
  const done = await r.json() as any;
  assert.equal(r.status, 200); assert.equal(done.item.id, id); assert.equal(done.item.bytes, file.length);
  assert.deepEqual(Buffer.from(await (await fetch(h.url + done.item.url)).arrayBuffer()), file);
  assert.equal((await h.get(`/api/library/uploads/${id}`, owner)).status, 404);
  // only the owner, only real types, and not bigger than 20 GB
  assert.equal((await h.post('/api/library/uploads', { name: 'x.mp4', size: 10 }, cust)).status, 403);
  assert.equal((await h.post('/api/library/uploads', { name: 'x.exe', size: 10 }, owner)).status, 415);
  assert.equal((await h.post('/api/library/uploads', { name: 'x.mp4', size: 21 * 1024 ** 3 }, owner)).status, 413);
  await libraryIdle();
});
