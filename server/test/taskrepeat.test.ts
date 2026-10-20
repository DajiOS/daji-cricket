import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, T0, type Harness } from './helpers.ts';
import { addDays, istDate } from '../src/time.ts';
import { stepDate } from '../src/tasks.ts';

// Repeating jobs and checklists (the starter kit's task board), on top of the camera-photo rule.
let h: Harness, owner: string, staff: string, cust: string, owner2: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => { h.reset(); owner = await h.login('owner1'); staff = await h.login('staff1'); cust = await h.login('customer'); owner2 = await h.login('owner2'); });

const today = () => istDate(T0);
async function makeTask(extra: Record<string, unknown> = {}) {
  const r = await h.post('/api/tasks', { title: 'Water the square', photosRequired: 0, ...extra }, owner);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}
const series = async (title: string) => (await h.get('/api/tasks', owner)).body.items.filter((t: any) => t.title === title);

test('the due day steps by a day, a week or a month; a month-end day falls on the last day of a shorter month', () => {
  assert.equal(stepDate('2026-10-20', 'daily'), '2026-10-21');
  assert.equal(stepDate('2026-10-31', 'daily'), '2026-11-01');
  assert.equal(stepDate('2026-12-29', 'weekly'), '2027-01-05');
  assert.equal(stepDate('2026-01-31', 'monthly'), '2026-02-28');
  assert.equal(stepDate('2028-01-31', 'monthly'), '2028-02-29');
  assert.equal(stepDate('2026-12-15', 'monthly'), '2027-01-15');
});

test('closing a repeating job adds the next one to To do with the next due day, the same details and a fresh checklist', async () => {
  const due = addDays(today(), 2);
  const t = await makeTask({ title: 'Weekly roller check', repeat: 'weekly', dueDate: due, priority: 'high', checklist: ['Oil', ' Tyres ', ''] });
  assert.equal(t.repeat, 'weekly');
  assert.deepEqual(t.checklist, [{ text: 'Oil', done: false }, { text: 'Tyres', done: false }]);
  const tick = await h.post(`/api/tasks/${t.id}/checklist`, { index: 0, done: true }, staff);
  assert.equal(tick.status, 200, JSON.stringify(tick.body));
  assert.deepEqual(tick.body.checklist[0], { text: 'Oil', done: true });
  const done = await h.post(`/api/tasks/${t.id}/complete`, {}, staff);
  assert.equal(done.status, 200, JSON.stringify(done.body));
  const all = await series('Weekly roller check');
  assert.equal(all.length, 2);
  const next = all.find((x: any) => x.id !== t.id);
  assert.equal(next.status, 'open'); assert.equal(next.stage, 'todo');
  assert.equal(next.dueDate, addDays(due, 7));
  assert.equal(next.priority, 'high'); assert.equal(next.repeat, 'weekly');
  assert.deepEqual(next.checklist, [{ text: 'Oil', done: false }, { text: 'Tyres', done: false }]);
});

test('a late repeating job skips ahead to a due day that is today or later, and dragging to Done repeats it too', async () => {
  const t = await makeTask({ title: 'Daily sweep', repeat: 'daily', dueDate: addDays(today(), -5) });
  const moved = await h.post(`/api/tasks/${t.id}/move`, { stage: 'done', index: 0 }, owner);
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  const next = (await series('Daily sweep')).find((x: any) => x.id !== t.id);
  assert.equal(next.dueDate, today());
});

test('reopening and closing again never makes a second open copy; cancelling ends the series; a plain job does not repeat', async () => {
  const t = await makeTask({ title: 'Monthly mower service', repeat: 'monthly', dueDate: addDays(today(), 1) });
  await h.post(`/api/tasks/${t.id}/complete`, {}, owner);
  assert.equal((await h.post(`/api/tasks/${t.id}/reopen`, {}, owner)).status, 200);
  await h.post(`/api/tasks/${t.id}/complete`, {}, owner);
  const all = await series('Monthly mower service');
  assert.equal(all.filter((x: any) => x.status === 'open').length, 1);
  const next = all.find((x: any) => x.status === 'open');
  assert.equal((await h.post(`/api/tasks/${next.id}/cancel`, {}, owner)).status, 200);
  assert.equal((await series('Monthly mower service')).filter((x: any) => x.status === 'open').length, 0);
  const plain = await makeTask({ title: 'One-off fence fix' });
  await h.post(`/api/tasks/${plain.id}/complete`, {}, owner);
  assert.equal((await series('One-off fence fix')).length, 1);
});

test('editing the checklist keeps ticks on unchanged steps; turning repeat off stops the next copy', async () => {
  const t = await makeTask({ title: 'Nets prep', repeat: 'daily', checklist: ['Nets up', 'Mats down'] });
  await h.post(`/api/tasks/${t.id}/checklist`, { index: 1, done: true }, owner);
  const ed = await h.patch(`/api/tasks/${t.id}`, { checklist: ['Nets up', 'Mats down', 'Balls out'], repeat: null }, owner);
  assert.equal(ed.status, 200, JSON.stringify(ed.body));
  assert.deepEqual(ed.body.checklist.map((c: any) => c.done), [false, true, false]);
  assert.equal(ed.body.repeat, null);
  await h.post(`/api/tasks/${t.id}/complete`, {}, owner);
  assert.equal((await series('Nets prep')).length, 1);
});

test('only the team that may close the job may tick its steps, and bad input is refused', async () => {
  const theirs = await makeTask({ title: 'Paint sight screen', checklist: ['Sand', 'Paint'] });
  assert.equal((await h.post(`/api/tasks/${theirs.id}/checklist`, { index: 0, done: true }, cust)).status, 403);
  assert.equal((await h.post(`/api/tasks/${theirs.id}/checklist`, { index: 0, done: true }, owner2)).status, 404);
  assert.equal((await h.post(`/api/tasks/${theirs.id}/checklist`, { index: 5, done: true }, owner)).status, 400);
  assert.equal((await h.post(`/api/tasks/${theirs.id}/checklist`, { index: 0 }, owner)).status, 400);
  assert.equal((await h.post('/api/tasks', { title: 'Bad repeat', repeat: 'hourly' }, owner)).status, 400);
  await h.post(`/api/tasks/${theirs.id}/complete`, {}, owner);
  assert.equal((await h.post(`/api/tasks/${theirs.id}/checklist`, { index: 0, done: true }, owner)).status, 409);
});
