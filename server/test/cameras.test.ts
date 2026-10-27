import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, DEMO_ACCOUNTS, type Harness } from './helpers.ts';
import { run } from '../src/db.ts';

let h: Harness;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });

const jpeg = (n = 200) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 7), Buffer.from([0xff, 0xd9])]);
const put = (id: string, token: string, body: Buffer | string) => fetch(`${h.url}/api/cameras/${id}/frame`, { method: 'PUT', headers: { authorization: `Bearer ${token}` }, body });
const perms = (list: string[]) => run('UPDATE users SET permissions = ? WHERE email = ?', JSON.stringify(list), DEMO_ACCOUNTS.staff1.email);

test('owner adds a camera, the bridge sends a picture, and the owner sees it online', async () => {
  const owner = await h.login('owner1');
  const c = await h.post('/api/cameras', { name: 'Pitch 1 north' }, owner);
  assert.equal(c.status, 201);
  assert.match(c.body.ingestToken, /^cam_/);
  assert.equal(c.body.online, false);
  const list0 = await h.get('/api/cameras', owner);
  assert.equal(list0.body.items[0].ingestToken, undefined, 'the secret is shown once only');
  const r = await put(c.body.id, c.body.ingestToken, jpeg());
  assert.equal(r.status, 200);
  const list = await h.get('/api/cameras', owner);
  assert.equal(list.body.items.find((x: any) => x.id === c.body.id).online, true);
});

test('pictures need the right token, a real JPEG, and a sane size', async () => {
  const owner = await h.login('owner1');
  const c = await h.post('/api/cameras', { name: 'Nets' }, owner);
  assert.equal((await put(c.body.id, 'cam_wrong', jpeg())).status, 401);
  assert.equal((await put(c.body.id, '', jpeg())).status, 401);
  assert.equal((await put('cam_nope', c.body.ingestToken, jpeg())).status, 401);
  assert.equal((await put(c.body.id, c.body.ingestToken, 'not a picture')).status, 400);
  assert.equal((await put(c.body.id, c.body.ingestToken, jpeg(700 * 1024))).status, 413);
  const rot = await h.post(`/api/cameras/${c.body.id}/token`, {}, owner);
  assert.equal((await put(c.body.id, c.body.ingestToken, jpeg())).status, 401, 'the old token stops working');
  assert.equal((await put(c.body.id, rot.body.ingestToken, jpeg())).status, 200);
  await h.patch(`/api/cameras/${c.body.id}`, { active: false }, owner);
  assert.equal((await put(c.body.id, rot.body.ingestToken, jpeg())).status, 401, 'a switched-off camera is refused');
});

test('viewing needs a view token; another owner cannot see it', async () => {
  const o1 = await h.login('owner1');
  const o2 = await h.login('owner2');
  const c = await h.post('/api/cameras', { name: 'Gate' }, o1);
  await put(c.body.id, c.body.ingestToken, jpeg(300));
  assert.equal((await fetch(`${h.url}/api/cameras/${c.body.id}/snapshot`)).status, 401);
  assert.equal((await fetch(`${h.url}/api/cameras/${c.body.id}/snapshot?t=abc.def`)).status, 401);
  const t1 = (await h.post('/api/cameras/view-token', {}, o1)).body.token;
  const snap = await fetch(`${h.url}/api/cameras/${c.body.id}/snapshot?t=${t1}`);
  assert.equal(snap.status, 200);
  assert.equal(snap.headers.get('content-type'), 'image/jpeg');
  assert.equal((await snap.arrayBuffer()).byteLength, 306);
  const t2 = (await h.post('/api/cameras/view-token', {}, o2)).body.token;
  assert.equal((await fetch(`${h.url}/api/cameras/${c.body.id}/snapshot?t=${t2}`)).status, 404);
  assert.equal((await h.get('/api/cameras', o2)).body.items.some((x: any) => x.id === c.body.id), false);
  assert.equal((await h.patch(`/api/cameras/${c.body.id}`, { name: 'x' }, o2)).status, 404);
});

test('the stream sends a multipart picture to a viewer', async () => {
  const owner = await h.login('owner1');
  const c = await h.post('/api/cameras', { name: 'Stream' }, owner);
  await put(c.body.id, c.body.ingestToken, jpeg(50));
  const t = (await h.post('/api/cameras/view-token', {}, owner)).body.token;
  const ac = new AbortController();
  const res = await fetch(`${h.url}/api/cameras/${c.body.id}/stream?t=${t}`, { signal: ac.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type')!, /multipart\/x-mixed-replace/);
  const rd = res.body!.getReader();
  const first = await rd.read();
  assert.ok(Buffer.from(first.value!).toString('latin1').includes('image/jpeg'));
  const watching = await h.get('/api/cameras', owner);
  assert.equal(watching.body.items.find((x: any) => x.id === c.body.id).watchers, 1);
  const r = await put(c.body.id, c.body.ingestToken, jpeg(60));
  assert.equal(((await r.json()) as any).watchers, 1, 'the bridge learns someone is watching');
  ac.abort();
});

test('staff need the view_cameras permission; only the owner manages cameras', async () => {
  const owner = await h.login('owner1');
  const staff = await h.login('staff1');
  perms(['manage_bookings']);
  assert.equal((await h.get('/api/cameras', staff)).status, 403);
  assert.equal((await h.post('/api/cameras/view-token', {}, staff)).status, 403);
  perms(['view_cameras']);
  assert.equal((await h.get('/api/cameras', staff)).status, 200);
  assert.equal((await h.post('/api/cameras/view-token', {}, staff)).status, 200);
  assert.equal((await h.post('/api/cameras', { name: 'Sneaky' }, staff)).status, 403);
  const c = await h.post('/api/cameras', { name: 'Owner cam' }, owner);
  assert.equal((await h.del(`/api/cameras/${c.body.id}`, staff)).status, 403);
  assert.equal((await h.get('/api/cameras', null)).status, 401);
  assert.equal((await h.del(`/api/cameras/${c.body.id}`, owner)).status, 200);
  perms([]);
});

test('a camera needs a name', async () => {
  const owner = await h.login('owner1');
  assert.equal((await h.post('/api/cameras', { name: '  ' }, owner)).status, 400);
});
