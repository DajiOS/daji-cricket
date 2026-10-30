// The tasks upgrade (redesign step 5, Sunny 30 Oct 2026). References (gallery and WhatsApp pictures, quotes, PDFs, links) are kept
// apart from proof: only a fresh camera photo counts toward closing a job. Plus the requests inbox, helpers, next action,
// accepting a job and signing off finished work, reopening with a reason, the job's history and the daily site report.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, T0, MIN, type Harness } from './helpers.ts';
import { many } from '../src/db.ts';

let h: Harness, owner: string, staff: string, staffId: string, helper: string, helperId: string, owner2: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => {
  h.reset();
  owner = await h.login('owner1'); staff = await h.login('staff1'); owner2 = await h.login('owner2');
  staffId = (await h.get('/api/me', staff)).body.user.id;
  const s = await h.post('/api/staff/team', { firstName: 'Mohan', lastName: 'Helper', email: 'helper@daji.test', password: 'Helper-Pass-2026!', permissions: [] }, owner);
  assert.equal(s.status, 201, JSON.stringify(s.body));
  helperId = s.body.id;
  helper = (await h.post('/api/auth/login', { email: 'helper@daji.test', password: 'Helper-Pass-2026!' })).body.token;
});

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
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('a poker table picture')]);
const PDF = Buffer.from('%PDF-1.4 a quote from the carpenter');
const raw = (tok: string, path: string, body: Buffer) => h.call('POST', path, { token: tok, raw: body, headers: { 'content-type': 'application/octet-stream' } });
async function makeTask(extra: Record<string, unknown> = {}) {
  const r = await h.post('/api/tasks', { title: 'Make the poker table', photosRequired: 1, assignedTo: staffId, ...extra }, owner);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id as string;
}

test('a reference picture from the gallery is kept, but it is not proof: the job still needs a fresh camera photo to close', async () => {
  const id = await makeTask();
  // an old gallery picture with no camera time: refused as proof, accepted as a reference
  const asProof = await raw(staff, `/api/tasks/${id}/photos`, jpeg(T0 - 3 * 24 * 60 * MIN, 'gallery'));
  assert.equal(asProof.body.error.code, 'PHOTO_TOO_OLD');
  const ref = await raw(owner, `/api/tasks/${id}/references?name=Table%20design.jpg&note=From%20WhatsApp`, jpeg(T0 - 3 * 24 * 60 * MIN, 'gallery'));
  assert.equal(ref.status, 201, JSON.stringify(ref.body));
  assert.equal(ref.body.references.length, 1);
  assert.equal(ref.body.references[0].name, 'Table design.jpg');
  assert.equal(ref.body.references[0].note, 'From WhatsApp');
  assert.equal(ref.body.photos.length, 0, 'a reference never shows up as proof');
  assert.equal((await raw(staff, `/api/tasks/${id}/references`, PNG)).status, 201);
  assert.equal((await raw(staff, `/api/tasks/${id}/references?name=quote`, PDF)).status, 201);
  const link = await h.post(`/api/tasks/${id}/links`, { url: 'https://example.com/poker-table', name: 'Felt supplier' }, staff);
  assert.equal(link.status, 201, JSON.stringify(link.body));
  assert.deepEqual(link.body.references.map((r: any) => [r.kind, r.name]), [['file', 'Table design.jpg'], ['file', 'reference.png'], ['file', 'quote.pdf'], ['link', 'Felt supplier']]);
  // four references, still no proof: closing is refused
  const close = await h.post(`/api/tasks/${id}/complete`, {}, staff);
  assert.equal(close.status, 409); assert.equal(close.body.error.code, 'PHOTOS_NEEDED');
  // a fresh camera photo closes it
  assert.equal((await raw(staff, `/api/tasks/${id}/photos`, jpeg(T0 - MIN, 'fresh'))).status, 201);
  assert.equal((await h.post(`/api/tasks/${id}/complete`, {}, staff)).status, 200);
  // the file comes back to those who can see the job, sandboxed; other businesses get 404
  const f = await h.call('GET', link.body.references[0].url, { token: staff });
  assert.equal(f.status, 200); assert.match(String(f.headers.get('content-security-policy')), /sandbox/);
  assert.equal((await h.call('GET', link.body.references[0].url, { token: owner2 })).status, 404);
});

test('references: only pictures and PDFs, https links only, and taking one off hides it without deleting', async () => {
  const id = await makeTask();
  const exe = await raw(owner, `/api/tasks/${id}/references`, Buffer.from('MZ not a picture'));
  assert.equal(exe.status, 415);
  for (const url of ['javascript:alert(1)', 'ftp://files.example.com/x', 'https://user:pw@example.com/', 'http://example.com/plain', 'data:text/html,hi']) {
    const r = await h.post(`/api/tasks/${id}/links`, { url }, owner);
    assert.equal(r.status, 400, url);
  }
  const added = await raw(staff, `/api/tasks/${id}/references`, PNG);
  const refId = added.body.references[0].id;
  // the helper (not on this job yet) and another business cannot see or take it off
  assert.equal((await h.post(`/api/tasks/refs/${refId}/hide`, {}, helper)).status, 404);
  assert.equal((await h.post(`/api/tasks/refs/${refId}/hide`, {}, owner2)).status, 404);
  const hid = await h.post(`/api/tasks/refs/${refId}/hide`, {}, staff);
  assert.equal(hid.status, 200); assert.equal(hid.body.references.length, 0);
  const row = many<{ hidden_at: number | null }>('SELECT hidden_at FROM task_refs WHERE id = ?', refId);
  assert.equal(row.length, 1); assert.ok(row[0]!.hidden_at, 'kept on record, only hidden');
  assert.equal((await h.call('GET', `/api/tasks/refs/${refId}`, { token: owner })).status, 404);
});

test('a team member raises a request; it waits in the inbox, seen only by managers and the raiser, until taken in or turned down', async () => {
  const r = await h.post('/api/tasks/requests', { title: 'Fix the nets at lane 2', details: 'Torn near the stumps', clientKey: 'k1' }, staff);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.intake.state, 'new');
  // pressing twice is one request
  assert.equal((await h.post('/api/tasks/requests', { title: 'Fix the nets at lane 2', clientKey: 'k1' }, staff)).body.id, r.body.id);
  // the raiser sees it in the inbox; the helper does not; the board does not show it
  assert.deepEqual((await h.get('/api/tasks/inbox', staff)).body.items.map((t: any) => t.id), [r.body.id]);
  assert.equal((await h.get('/api/tasks/inbox', helper)).body.items.length, 0);
  assert.equal((await h.get(`/api/tasks/${r.body.id}`, helper)).status, 404);
  assert.equal((await h.get('/api/tasks?status=open', owner)).body.items.length, 0);
  assert.equal((await h.get('/api/tasks/inbox', owner)).body.items.length, 1);
  // the raiser can add a picture of the problem as a reference
  assert.equal((await raw(staff, `/api/tasks/${r.body.id}/references`, PNG)).status, 201);
  // only a manager decides; it cannot be moved on the board before then
  assert.equal((await h.post(`/api/tasks/${r.body.id}/decide`, { accept: true }, staff)).status, 403);
  assert.equal((await h.post(`/api/tasks/${r.body.id}/move`, { stage: 'doing' }, owner)).status, 409);
  const taken = await h.post(`/api/tasks/${r.body.id}/decide`, { accept: true, assignedTo: helperId, photosRequired: 2, dueDate: '2026-05-20' }, owner);
  assert.equal(taken.status, 200, JSON.stringify(taken.body));
  assert.equal(taken.body.intake.state, 'accepted'); assert.equal(taken.body.assignedTo, helperId); assert.equal(taken.body.photosRequired, 2);
  assert.equal((await h.post(`/api/tasks/${r.body.id}/decide`, { accept: false, note: 'x' }, owner)).status, 409, 'decided once');
  assert.equal((await h.get('/api/tasks?status=open', helper)).body.items.length, 1);
  // turning one down needs a reason, and closes it
  const r2 = await h.post('/api/tasks/requests', { title: 'Paint the pavilion gold' }, staff);
  assert.equal((await h.post(`/api/tasks/${r2.body.id}/decide`, { accept: false }, owner)).status, 400);
  const no = await h.post(`/api/tasks/${r2.body.id}/decide`, { accept: false, note: 'Not this season' }, owner);
  assert.equal(no.body.status, 'cancelled'); assert.equal(no.body.intake.note, 'Not this season');
  // a customer cannot raise one
  assert.equal((await h.post('/api/tasks/requests', { title: 'Let me in' }, await h.login('customer'))).status, 403);
});

test('helpers work on the job beside the person it is for: they see it, add proof and references, and can close it', async () => {
  const id = await makeTask();
  assert.equal((await h.get(`/api/tasks/${id}`, helper)).status, 404);
  assert.equal((await h.post(`/api/tasks/${id}/helpers`, { userIds: [helperId] }, staff)).status, 403, 'only a manager picks helpers');
  assert.equal((await h.post(`/api/tasks/${id}/helpers`, { userIds: ['usr_not_on_team'] }, owner)).status, 400);
  const set = await h.post(`/api/tasks/${id}/helpers`, { userIds: [helperId] }, owner);
  assert.equal(set.status, 200, JSON.stringify(set.body));
  assert.deepEqual(set.body.helpers.map((x: any) => x.name), ['Mohan Helper']);
  // the list to pick from has the business's staff; only managers get it
  assert.ok((await h.get('/api/tasks/people', owner)).body.items.some((p: any) => p.id === helperId));
  assert.equal((await h.get('/api/tasks/people', staff)).status, 403);
  assert.equal((await h.get('/api/tasks?status=open', helper)).body.items.length, 1);
  assert.equal((await raw(helper, `/api/tasks/${id}/references`, PNG)).status, 201);
  assert.equal((await h.post(`/api/tasks/${id}/next`, { text: 'Buy green felt' }, helper)).body.nextAction, 'Buy green felt');
  assert.equal((await raw(helper, `/api/tasks/${id}/photos`, jpeg(T0 - MIN, 'helper'))).status, 201);
  assert.equal((await h.post(`/api/tasks/${id}/complete`, {}, helper)).status, 200);
  // taking a helper off closes the job to them again
  const id2 = await makeTask({ title: 'Second table' });
  await h.post(`/api/tasks/${id2}/helpers`, { userIds: [helperId] }, owner);
  await h.post(`/api/tasks/${id2}/helpers`, { userIds: [] }, owner);
  assert.equal((await h.get(`/api/tasks/${id2}`, helper)).status, 404);
});

test('the person accepts the job, a manager signs off the finished work, and a reopen keeps its reason; the history says it all', async () => {
  const id = await makeTask();
  assert.equal((await h.post(`/api/tasks/${id}/accept`, {}, helper)).status, 404);
  const ack = await h.post(`/api/tasks/${id}/accept`, {}, staff);
  assert.equal(ack.status, 200); assert.ok(ack.body.acknowledgedAt); assert.equal(ack.body.acknowledgedByName, 'Ground Staff');
  assert.equal((await h.post(`/api/tasks/${id}/accept`, {}, staff)).body.acknowledgedAt, ack.body.acknowledgedAt, 'twice changes nothing');
  assert.equal((await h.post(`/api/tasks/${id}/signoff`, {}, owner)).status, 409, 'not finished yet');
  await raw(staff, `/api/tasks/${id}/photos`, jpeg(T0 - MIN, 'done'));
  await h.post(`/api/tasks/${id}/complete`, {}, staff);
  assert.equal((await h.post(`/api/tasks/${id}/signoff`, {}, staff)).status, 403, 'not a manager');
  const so = await h.post(`/api/tasks/${id}/signoff`, {}, owner);
  assert.equal(so.status, 200); assert.ok(so.body.signedOffAt);
  const re = await h.post(`/api/tasks/${id}/reopen`, { reason: 'The felt is loose' }, owner);
  assert.equal(re.status, 200); assert.equal(re.body.status, 'open'); assert.equal(re.body.reopenNote, 'The felt is loose');
  assert.equal(re.body.signedOffAt, null); assert.equal(re.body.photos.length, 1, 'proof stays');
  // reopening with no body still works (the older apps send none)
  await h.post(`/api/tasks/${id}/complete`, {}, staff);
  assert.equal((await h.call('POST', `/api/tasks/${id}/reopen`, { token: owner })).status, 200);
  const hist = await h.get(`/api/tasks/${id}/history`, staff);
  assert.equal(hist.status, 200);
  const says = hist.body.items.map((x: any) => x.what);
  assert.ok(says.includes('Added the job')); assert.ok(says.includes('Accepted the job')); assert.ok(says.includes('Signed off the work')); assert.ok(says.includes('Reopened it: The felt is loose'));
  assert.equal((await h.get(`/api/tasks/${id}/history`, owner2)).status, 404);
});

test('the daily site report: jobs from the board for that day, a note per person, and hidden branches left out', async () => {
  const branch = (await h.post('/api/areas', { name: 'Office' }, owner)).body.id;
  const secret = (await h.post('/api/areas', { name: 'Personal', restricted: true }, owner)).body.id;
  const site = (await h.post('/api/projects', { name: 'Office fit-out', areaId: branch }, owner)).body.id;
  const hiddenSite = (await h.post('/api/projects', { name: 'Private', areaId: secret }, owner)).body.id;
  const id = await makeTask({ projectId: site, assignedTo: null });
  await raw(staff, `/api/tasks/${id}/photos`, jpeg(T0 - MIN, 'site'));
  await raw(staff, `/api/tasks/${id}/references`, PNG);
  await h.post(`/api/tasks/${id}/complete`, {}, staff);
  const note = await h.post('/api/site-reports', { projectId: site, workers: 4, body: 'Walls primed', issues: 'Paint short by 2 tins' }, staff);
  assert.equal(note.status, 200, JSON.stringify(note.body));
  // writing again the same day changes the same note
  const again = await h.post('/api/site-reports', { projectId: site, workers: 5, body: 'Walls primed and sanded' }, staff);
  assert.equal(again.body.notes.length, 1); assert.equal(again.body.notes[0].workers, 5);
  // the correction keeps the earlier text
  assert.equal(again.body.notes[0].corrections, 1);
  const kept = many<{ body: string; workers: number; issues: string | null }>('SELECT body, workers, issues FROM site_report_edits');
  assert.deepEqual(kept.map((k) => ({ ...k })), [{ body: 'Walls primed', workers: 4, issues: 'Paint short by 2 tins' }]);
  const rep = (await h.get(`/api/site-reports?projectId=${site}`, owner)).body;
  assert.equal(rep.projectName, 'Office fit-out');
  assert.deepEqual(rep.done.map((d: any) => [d.title, d.proofPhotos]), [['Make the poker table', 1]]);
  assert.equal(rep.proofPhotos, 1); assert.equal(rep.references, 1);
  // the restricted project is not there for the team member, and a future day is refused
  assert.equal((await h.get(`/api/site-reports?projectId=${hiddenSite}`, staff)).status, 404);
  assert.equal((await h.post('/api/site-reports', { projectId: hiddenSite, body: 'peek' }, staff)).status, 404);
  assert.equal((await h.post('/api/site-reports', { date: '2099-01-01', body: 'tomorrow' }, staff)).status, 400);
  assert.equal((await h.get('/api/site-reports', owner2)).body.notes.length, 0);
  // Ask AI answers from the same report, and never calls a reference proof
  const a = await h.post('/api/staff/ask', { question: 'what is on the site report today?' }, owner);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(a.body.intent, 'site_report', JSON.stringify(a.body));
  assert.doesNotMatch(JSON.stringify(a.body), /Private/);
  // a whole-team job in the hidden branch, finished today, is in the owner's day but never in the team member's
  const hiddenJob = await makeTask({ title: 'Paint the private room', projectId: hiddenSite, assignedTo: null });
  await raw(owner, `/api/tasks/${hiddenJob}/photos`, jpeg(T0 - MIN, 'hidden'));
  assert.equal((await h.post(`/api/tasks/${hiddenJob}/complete`, {}, owner)).status, 200);
  assert.ok((await h.get('/api/site-reports', owner)).body.done.some((d: any) => d.title === 'Paint the private room'));
  const staffDay = (await h.get('/api/site-reports', staff)).body;
  assert.deepEqual(staffDay.done.map((d: any) => d.title), ['Make the poker table']);
  // the staff member hears about the jobs they work on only
  const s = await h.post('/api/staff/ask', { question: 'daily report' }, staff);
  assert.equal(s.status, 200, JSON.stringify(s.body));
  assert.equal(s.body.intent, 'site_report', JSON.stringify(s.body));
  assert.match(JSON.stringify(s.body), /Make the poker table/);
  assert.doesNotMatch(JSON.stringify(s.body), /Paint the private room|Private/);
  // the note's audit entries name the note itself
  const ids = many<{ entity_id: string | null }>("SELECT entity_id FROM audit_log WHERE action IN ('site_report.create', 'site_report.update')");
  assert.equal(ids.length, 2); assert.ok(ids.every((x) => x.entity_id === note.body.notes[0].id), JSON.stringify(ids));
});

test('the desk may show private pictures it fetched with the sign-in (blob: images), and nothing else is loosened', async () => {
  const r = await h.call('GET', '/desk.html');
  const csp = String(r.headers.get('content-security-policy'));
  assert.match(csp, /img-src 'self' data: blob: https:/);
  assert.match(csp, /script-src 'self' https:\/\/checkout\.razorpay\.com;/);
  assert.match(csp, /object-src 'none'/);
});

test('request lifecycle: raised, taken in, worked, closed, signed off, reopened; who can see it at each stage; one record throughout', async () => {
  const r = await h.post('/api/tasks/requests', { title: 'Fix the scoreboard bulb', clientKey: 'life-1' }, staff);
  const id = r.body.id;
  // before take-in: the raiser and the owner; not the helper (an unrelated team member), not another business
  assert.equal((await h.get(`/api/tasks/${id}`, staff)).status, 200);
  assert.equal((await h.get(`/api/tasks/${id}`, owner)).status, 200);
  assert.equal((await h.get(`/api/tasks/${id}`, helper)).status, 404);
  assert.equal((await h.get(`/api/tasks/${id}`, owner2)).status, 404);
  // taken in for the helper: the same record (same id), now on the board
  const taken = await h.post(`/api/tasks/${id}/decide`, { accept: true, assignedTo: helperId, photosRequired: 1 }, owner);
  assert.equal(taken.body.id, id);
  assert.equal((await h.post(`/api/tasks/${id}/decide`, { accept: true }, owner)).status, 409, 'a second take-in is refused');
  assert.equal(many<{ n: number }>("SELECT COUNT(*) n FROM tasks WHERE title = 'Fix the scoreboard bulb'")[0]!.n, 1, 'no duplicate work record');
  assert.equal((await h.get(`/api/tasks/${id}`, helper)).status, 200, 'the accountable person sees it');
  // the raiser, who is neither the accountable person nor a helper, no longer sees it once it is someone else's job
  assert.equal((await h.get(`/api/tasks/${id}`, staff)).status, 404, 'IMPLEMENTED BEHAVIOUR: raiser loses access after conversion (for Sunny to decide)');
  assert.equal((await h.get(`/api/tasks/${id}`, owner2)).status, 404);
  await raw(helper, `/api/tasks/${id}/photos`, jpeg(T0 - MIN, 'life'));
  assert.equal((await h.post(`/api/tasks/${id}/complete`, {}, helper)).status, 200);
  assert.equal((await h.post(`/api/tasks/${id}/signoff`, {}, owner)).status, 200);
  const re = await h.post(`/api/tasks/${id}/reopen`, { reason: 'Bulb flickers again' }, owner);
  assert.equal(re.body.status, 'open'); assert.equal(re.body.photos.length, 1);
  const says = (await h.get(`/api/tasks/${id}/history`, owner)).body.items.map((x: any) => x.what);
  for (const w of ['Raised it as a request', 'Took the request in', 'Added a proof photo', 'Marked it done', 'Signed off the work', 'Reopened it: Bulb flickers again']) assert.ok(says.some((s: string) => s.startsWith(w)), w);
  // a declined request keeps its history and reason
  const d = await h.post('/api/tasks/requests', { title: 'Gold paint for the pavilion' }, staff);
  await h.post(`/api/tasks/${d.body.id}/decide`, { accept: false, note: 'Not this season' }, owner);
  assert.ok((await h.get(`/api/tasks/${d.body.id}/history`, owner)).body.items.some((x: any) => x.what === 'Turned the request down: Not this season'));
});

test('helper authority map (implemented behaviour, recorded for Sunny\'s decision)', async () => {
  const id = await makeTask({ checklist: ['Sand', 'Varnish'] });
  await h.post(`/api/tasks/${id}/helpers`, { userIds: [helperId] }, owner);
  const can = async (r: Promise<any>) => (await r).status < 300;
  const map = {
    view: await can(h.get(`/api/tasks/${id}`, helper)),
    comment: await can(h.post(`/api/tasks/${id}/comments`, { body: 'On it' }, helper)),
    reference: await can(raw(helper, `/api/tasks/${id}/references`, PNG)),
    proof: await can(raw(helper, `/api/tasks/${id}/photos`, jpeg(T0 - MIN, 'map'))),
    tick: await can(h.post(`/api/tasks/${id}/checklist`, { index: 0, done: true }, helper)),
    nextAction: await can(h.post(`/api/tasks/${id}/next`, { text: 'Buy varnish' }, helper)),
    accept: await can(h.post(`/api/tasks/${id}/accept`, {}, helper)),
    assignOther: await can(h.patch(`/api/tasks/${id}`, { assignedTo: helperId }, helper)),
    changeHelpers: await can(h.post(`/api/tasks/${id}/helpers`, { userIds: [] }, helper)),
    complete: await can(h.post(`/api/tasks/${id}/complete`, {}, helper)),
  };
  const after = { signOff: await can(h.post(`/api/tasks/${id}/signoff`, {}, helper)), reopen: await can(h.post(`/api/tasks/${id}/reopen`, { reason: 'x' }, helper)) };
  assert.deepEqual({ ...map, ...after }, { view: true, comment: true, reference: true, proof: true, tick: true, nextAction: true, accept: false, assignOther: false, changeHelpers: false, complete: true, signOff: false, reopen: false });
});

test('a request in the inbox can be read and given references, nothing more; cancelling or reopening around the inbox is refused', async () => {
  const r = await h.post('/api/tasks/requests', { title: 'New nets for lane 2' }, staff);
  const id = r.body.id;
  // the raiser may add a reference, but not proof, steps, a next action, or close it
  assert.equal((await raw(staff, `/api/tasks/${id}/references`, PNG)).status, 201);
  for (const [what, res] of [
    ['proof', await raw(staff, `/api/tasks/${id}/photos`, jpeg(T0 - MIN, 'inbox'))],
    ['complete', await h.post(`/api/tasks/${id}/complete`, {}, staff)],
    ['next action', await h.post(`/api/tasks/${id}/next`, { text: 'Buy nets' }, staff)],
    ['accept', await h.post(`/api/tasks/${id}/accept`, {}, staff)],
  ] as const) assert.equal(res.status, 409, `${what}: ${JSON.stringify(res.body)}`);
  // a manager decides it from the inbox: not cancelled, edited or given helpers around it
  for (const [what, res] of [
    ['cancel', await h.post(`/api/tasks/${id}/cancel`, {}, owner)],
    ['edit', await h.patch(`/api/tasks/${id}`, { assignedTo: helperId }, owner)],
    ['helpers', await h.post(`/api/tasks/${id}/helpers`, { userIds: [helperId] }, owner)],
    ['move', await h.post(`/api/tasks/${id}/move`, { stage: 'doing' }, owner)],
  ] as const) assert.ok([409, 404].includes(res.status), `${what}: ${res.status} ${JSON.stringify(res.body)}`);
  assert.equal(many<{ n: number }>('SELECT COUNT(*) n FROM task_photos WHERE task_id = ?', id)[0]!.n, 0);
  const still = many<{ status: string; intake_state: string; assigned_to: string | null }>('SELECT status, intake_state, assigned_to FROM tasks WHERE id = ?', id)[0]!;
  assert.deepEqual({ ...still }, { status: 'open', intake_state: 'new', assigned_to: null });
  // another team member never sees it, on the board, the calendar or the site report
  assert.equal((await h.get(`/api/tasks/${id}`, helper)).status, 404);
  assert.ok(!(await h.get('/api/tasks', helper)).body.items.some((t: any) => t.id === id));
  assert.ok(!JSON.stringify((await h.get('/api/site-reports', helper)).body).includes('New nets for lane 2'));
});

test('a turned-down request stays the raiser\'s: not a whole-team job for anyone else, and it cannot be reopened', async () => {
  const r = await h.post('/api/tasks/requests', { title: 'Gold paint for the pavilion' }, staff);
  const id = r.body.id;
  assert.equal((await h.post(`/api/tasks/${id}/decide`, { accept: false, note: 'Not this season' }, owner)).status, 200);
  const d = await h.get(`/api/tasks/${id}`, staff);
  assert.equal(d.status, 200); assert.equal(d.body.intake.note, 'Not this season');
  assert.equal((await h.get(`/api/tasks/${id}`, helper)).status, 404, 'another team member cannot open it');
  assert.ok(!(await h.get('/api/tasks', helper)).body.items.some((t: any) => t.id === id), 'nor see it in the list');
  const re = await h.post(`/api/tasks/${id}/reopen`, { reason: 'Changed my mind' }, owner);
  assert.equal(re.status, 409, JSON.stringify(re.body));
  assert.equal(many<{ status: string }>('SELECT status FROM tasks WHERE id = ?', id)[0]!.status, 'cancelled');
});

test('changing helpers audits only a real change, and the people list is for managers only', async () => {
  const id = await makeTask();
  await h.post(`/api/tasks/${id}/helpers`, { userIds: [helperId, staffId] }, owner);
  await h.post(`/api/tasks/${id}/helpers`, { userIds: [staffId, helperId] }, owner);
  assert.equal(many<{ n: number }>("SELECT COUNT(*) n FROM audit_log WHERE action = 'task.helpers' AND entity_id = ?", id)[0]!.n, 1, 'a reorder is not a change');
  await h.post(`/api/tasks/${id}/helpers`, { userIds: [staffId] }, owner);
  assert.equal(many<{ n: number }>("SELECT COUNT(*) n FROM audit_log WHERE action = 'task.helpers' AND entity_id = ?", id)[0]!.n, 2);
  assert.equal((await h.get('/api/tasks/people', helper)).status, 403);
});

test('Ask AI: inbox and sign-off questions are not mistaken for the site report', async () => {
  for (const q of ['how many requests in the inbox', 'jobs to sign off']) {
    const a = await h.post('/api/staff/ask', { question: q }, owner);
    assert.notEqual(a.body.intent, 'site_report', q);
  }
});
