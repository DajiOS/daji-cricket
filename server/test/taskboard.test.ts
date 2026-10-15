import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, type Harness } from './helpers.ts';

let h: Harness; let owner: string, staff: string, cust: string;
before(async () => { h = await startHarness(); });
after(async () => { await h.close(); });
beforeEach(async () => { h.reset(); owner = await h.login('owner1'); staff = await h.login('staff1'); cust = await h.login('customer'); });

const task = async (extra: Record<string, unknown> = {}) => { const r = await h.post('/api/tasks', { title: 'Roll the pitch', photosRequired: 0, ...extra }, owner); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body as { id: string; stage: string; priority: string }; };

test('new cards start in To do with a priority, and can be set and changed', async () => {
  const t = await task({ priority: 'urgent' });
  assert.equal(t.stage, 'todo'); assert.equal(t.priority, 'urgent');
  assert.equal((await task()).priority, 'medium');
  assert.equal((await h.patch(`/api/tasks/${t.id}`, { priority: 'low' }, owner)).body.priority, 'low');
  assert.equal((await h.post('/api/tasks', { title: 'Bad one', priority: 'now' }, owner)).status, 400);
});

test('dragging moves a card between columns and keeps the order in each column', async () => {
  const a = await task({ title: 'Task A' }), b = await task({ title: 'Task B' }), c = await task({ title: 'Task C' });
  for (const t of [a, b, c]) assert.equal((await h.post(`/api/tasks/${t.id}/move`, { stage: 'doing', index: 0 }, owner)).body.stage, 'doing');
  const order = (await h.get('/api/tasks', owner)).body.items.filter((t: any) => t.stage === 'doing').map((t: any) => t.title);
  assert.deepEqual(order, ['Task C', 'Task B', 'Task A'], 'each card was dropped at the top');
  await h.post(`/api/tasks/${a.id}/move`, { stage: 'doing', index: 1 }, owner);
  assert.deepEqual((await h.get('/api/tasks', owner)).body.items.filter((t: any) => t.stage === 'doing').map((t: any) => t.title), ['Task C', 'Task A', 'Task B']);
});

test('a card that needs photos cannot be dragged to Done; one that does not can, and can be pulled back', async () => {
  const needs = await task({ photosRequired: 1 });
  const r = await h.post(`/api/tasks/${needs.id}/move`, { stage: 'done', index: 0 }, owner);
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'PHOTOS_NEEDED');
  const free = await task();
  const d = await h.post(`/api/tasks/${free.id}/move`, { stage: 'done', index: 0 }, owner);
  assert.equal(d.body.stage, 'done'); assert.equal(d.body.status, 'done');
  const back = await h.post(`/api/tasks/${free.id}/move`, { stage: 'review', index: 0 }, owner);
  assert.equal(back.body.stage, 'review'); assert.equal(back.body.status, 'open');
});

test('comments: team members add them, the count shows on the card, customers are kept out', async () => {
  const t = await task();
  assert.equal((await h.post(`/api/tasks/${t.id}/comments`, { body: 'Roller is booked for 7am' }, owner)).status, 201);
  assert.equal((await h.post(`/api/tasks/${t.id}/comments`, { body: '' }, owner)).status, 400);
  const l = await h.get(`/api/tasks/${t.id}/comments`, owner);
  assert.equal(l.body.items.length, 1); assert.equal(l.body.items[0].mine, true);
  assert.equal((await h.get(`/api/tasks/${t.id}`, owner)).body.commentCount, 1);
  assert.equal((await h.post(`/api/tasks/${t.id}/comments`, { body: 'hi' }, cust)).status, 403);
});

test('projects and milestones: tasks link to them and progress is counted', async () => {
  const p = (await h.post('/api/projects', { name: 'Floodlight upgrade' }, owner)).body;
  const m = (await h.post(`/api/projects/${p.id}/milestones`, { title: 'Poles installed', dueDate: '2026-12-01' }, owner)).body;
  const a = await task({ projectId: p.id, milestoneId: m.id }), b = await task({ projectId: p.id, milestoneId: m.id });
  await h.post(`/api/tasks/${a.id}/move`, { stage: 'done', index: 0 }, owner);
  const pr = (await h.get('/api/projects', owner)).body.items[0];
  assert.equal(pr.tasks, 2); assert.equal(pr.tasksDone, 1); assert.equal(pr.milestones[0].tasksDone, 1); assert.equal(pr.milestones[0].done, false);
  assert.equal((await h.patch(`/api/milestones/${m.id}`, { done: true }, owner)).body.done, true);
  assert.equal((await h.get(`/api/tasks/${b.id}`, owner)).body.projectName, 'Floodlight upgrade');
  assert.equal((await h.post('/api/tasks', { title: 'Orphan link', milestoneId: 'mst_nope' }, owner)).status, 400);
  assert.equal((await h.get(`/api/tasks?projectId=${p.id}`, owner)).body.items.length, 2);
});

test('another owner cannot see or touch these projects, and front-desk staff cannot create them', async () => {
  const p = (await h.post('/api/projects', { name: 'Private' }, owner)).body;
  const owner2 = await h.login('owner2');
  assert.equal((await h.get('/api/projects', owner2)).body.items.length, 0);
  assert.equal((await h.patch(`/api/projects/${p.id}`, { name: 'Hijack' }, owner2)).status, 404);
  assert.equal((await h.post('/api/projects', { name: 'Nope' }, staff)).status, 403);
});
