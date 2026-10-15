import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, T0, MIN, type Harness } from './helpers.ts';

let h: Harness, owner: string, staff: string, cust: string, owner2: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => { h.reset(); owner = await h.login('owner1'); staff = await h.login('staff1'); cust = await h.login('customer'); owner2 = await h.login('owner2'); });

/** A tiny JPEG whose EXIF says it was shot at the given moment (IST clock, as phones write it). `salt` makes each file different. */
function jpeg(shotMs: number | null, salt = '', opts: { offset?: string } = {}): Buffer {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  if (shotMs !== null) {
    const d = new Date(shotMs + 330 * MIN), p = (n: number) => String(n).padStart(2, '0');
    const stamp = `${d.getUTCFullYear()}:${p(d.getUTCMonth() + 1)}:${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}\0`;
    const make = 'TestCam\0', model = 'T1\0';
    // little-endian TIFF: IFD0 (Make, Model, ExifIFD pointer) -> Exif IFD (DateTimeOriginal [, OffsetTimeOriginal])
    const ifd0Count = 3, ifd0Off = 8, ifd0Size = 2 + ifd0Count * 12 + 4;
    const exifOff = ifd0Off + ifd0Size;
    const exifCount = opts.offset ? 2 : 1, exifSize = 2 + exifCount * 12 + 4;
    let dataOff = exifOff + exifSize;
    const makeOff = dataOff; dataOff += make.length;
    const modelOff = dataOff; dataOff += model.length;
    const stampOff = dataOff; dataOff += stamp.length;
    const offStr = opts.offset ? opts.offset + '\0' : '';
    const offAt = dataOff; dataOff += offStr.length;
    const t = Buffer.alloc(dataOff);
    t.write('II', 0, 'latin1'); t.writeUInt16LE(42, 2); t.writeUInt32LE(ifd0Off, 4);
    const ent = (at: number, tag: number, type: number, count: number, val: number) => { t.writeUInt16LE(tag, at); t.writeUInt16LE(type, at + 2); t.writeUInt32LE(count, at + 4); t.writeUInt32LE(val, at + 8); };
    t.writeUInt16LE(ifd0Count, ifd0Off);
    ent(ifd0Off + 2, 0x010f, 2, make.length, makeOff); ent(ifd0Off + 14, 0x0110, 2, model.length, modelOff); ent(ifd0Off + 26, 0x8769, 4, 1, exifOff);
    t.writeUInt16LE(exifCount, exifOff);
    ent(exifOff + 2, 0x9003, 2, stamp.length, stampOff);
    if (opts.offset) ent(exifOff + 14, 0x9011, 2, offStr.length, offAt);
    t.write(make, makeOff, 'latin1'); t.write(model, modelOff, 'latin1'); t.write(stamp, stampOff, 'latin1'); if (offStr) t.write(offStr, offAt, 'latin1');
    const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), t]);
    const seg = Buffer.alloc(4); seg[0] = 0xff; seg[1] = 0xe1; seg.writeUInt16BE(body.length + 2, 2);
    parts.push(seg, body);
  }
  parts.push(Buffer.from([0xff, 0xda, 0x00, 0x02]), Buffer.from('pixels' + salt), Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}
const send = (tok: string, id: string, body: Buffer) => h.call('POST', `/api/tasks/${id}/photos`, { token: tok, raw: body, headers: { 'content-type': 'application/octet-stream' } });
async function makeTask(extra: Record<string, unknown> = {}) {
  const r = await h.post('/api/tasks', { title: 'Roll the pitch', photosRequired: 2, ...extra }, owner);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id as string;
}

test('only a fresh camera photo is accepted: within 5 minutes, with a camera time inside', async () => {
  const id = await makeTask();
  const fresh = await send(staff, id, jpeg(T0 - 2 * MIN, 'a'));
  assert.equal(fresh.status, 201, JSON.stringify(fresh.body));
  assert.equal(fresh.body.photos.length, 1);
  assert.equal(fresh.body.photos[0].takenAt, T0 - 2 * MIN);
  const old = await send(staff, id, jpeg(T0 - 6 * MIN, 'b'));
  assert.equal(old.status, 422); assert.equal(old.body.error.code, 'PHOTO_TOO_OLD');
  const yesterday = await send(staff, id, jpeg(T0 - 24 * 60 * MIN, 'c'));
  assert.equal(yesterday.body.error.code, 'PHOTO_TOO_OLD');
  const none = await send(staff, id, jpeg(null, 'd'));
  assert.equal(none.status, 422); assert.equal(none.body.error.code, 'NO_CAMERA_DATA');
  const future = await send(staff, id, jpeg(T0 + 10 * MIN, 'e'));
  assert.equal(future.body.error.code, 'PHOTO_FROM_FUTURE');
  const png = await send(staff, id, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('x')]));
  assert.equal(png.status, 415); assert.equal(png.body.error.code, 'NOT_A_CAMERA_PHOTO');
  assert.equal((await h.get(`/api/tasks/${id}`, owner)).body.photos.length, 1, 'rejected photos leave nothing behind');
});

test('a time with its own UTC offset is honoured, and the same photo cannot be used twice', async () => {
  const id = await makeTask();
  const utc = await send(staff, id, jpeg(T0 - MIN, 'u', { offset: '+05:30' }));
  assert.equal(utc.status, 201, JSON.stringify(utc.body));
  const dup = await send(staff, id, jpeg(T0 - MIN, 'u', { offset: '+05:30' }));
  assert.equal(dup.status, 409); assert.equal(dup.body.error.code, 'PHOTO_ALREADY_USED');
  const wrongZone = await send(staff, id, jpeg(T0 - MIN, 'z', { offset: '+00:00' }));
  assert.equal(wrongZone.body.error.code, 'PHOTO_FROM_FUTURE', 'a clock in the wrong time zone is caught');
});

test('a task closes only once enough photos are in; then the owner can see them', async () => {
  const id = await makeTask();
  assert.equal((await h.post(`/api/tasks/${id}/complete`, {}, staff)).body.error.code, 'PHOTOS_NEEDED');
  await send(staff, id, jpeg(T0 - MIN, '1'));
  assert.equal((await h.post(`/api/tasks/${id}/complete`, {}, staff)).status, 409);
  const second = await send(staff, id, jpeg(T0 - MIN, '2'));
  const done = await h.post(`/api/tasks/${id}/complete`, { note: 'Done, 2 passes' }, staff);
  assert.equal(done.status, 200); assert.equal(done.body.status, 'done');
  assert.equal((await send(staff, id, jpeg(T0 - MIN, '3'))).body.error.code, 'TASK_CLOSED');
  const img = await fetch(h.url + second.body.photos[1].url, { headers: { authorization: `Bearer ${owner}` } });
  assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.equal((await fetch(h.url + second.body.photos[1].url)).status, 401, 'photos are private');
  assert.equal((await h.post(`/api/tasks/${id}/reopen`, {}, staff)).status, 403);
  assert.equal((await h.post(`/api/tasks/${id}/reopen`, {}, owner)).body.status, 'open');
});

test('who can see and do what', async () => {
  const mine = await makeTask();
  assert.equal((await h.post('/api/tasks', { title: 'Nope nope' }, staff)).status, 403, 'plain staff cannot create tasks');
  assert.equal((await h.post('/api/tasks', { title: 'Nope nope' }, cust)).status, 403);
  const staffList = (await h.get('/api/tasks', staff)).body.items;
  assert.equal(staffList.length, 1, 'an open-to-all task shows to staff');
  assert.equal((await h.get(`/api/tasks/${mine}`, owner2)).status, 404, 'another owner gets nothing');
  const team = (await h.get('/api/staff/team', owner)).body;
  const sid = (team.items ?? team)[0]?.id;
  const assigned = await h.post('/api/tasks', { title: 'Lock the gate', assignedTo: sid, photosRequired: 0 }, owner);
  assert.equal(assigned.status, 201, JSON.stringify(assigned.body));
  assert.equal(assigned.body.assignedName != null, true);
  assert.equal((await h.post('/api/tasks', { title: 'Bad assignee', assignedTo: 'usr_nobody' }, owner)).status, 400);
  assert.equal((await h.post(`/api/tasks/${assigned.body.id}/complete`, {}, staff)).body.status, 'done', 'zero photos required closes straight away');
});

test('the phone app may vouch for the shot time only when the saved file has no camera time', async () => {
  const id = await makeTask();
  const withHint = (body: Buffer, at: number) => h.call('POST', `/api/tasks/${id}/photos`, { token: staff, raw: body, headers: { 'content-type': 'application/octet-stream', 'x-app-shot-at': String(at) } });
  const ok = await withHint(jpeg(null, 'app1'), T0 - MIN);
  assert.equal(ok.status, 201, JSON.stringify(ok.body)); assert.equal(ok.body.photos[0].source, 'app');
  assert.equal((await withHint(jpeg(null, 'app2'), T0 - 9 * MIN)).body.error.code, 'NO_CAMERA_DATA', 'an old claim is no use');
  assert.equal((await withHint(jpeg(T0 - 30 * MIN, 'app3'), T0 - MIN)).body.error.code, 'PHOTO_TOO_OLD', 'a real camera time wins over the claim');
});
