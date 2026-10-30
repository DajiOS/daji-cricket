import { many, one, run, tx } from './db.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { HttpError, notFound, forbidden } from './errors.ts';
import { audit } from './audit.ts';
import { userRow, type UserRow } from './auth.ts';
import { Validator } from './input.ts';
import { istDate } from './time.ts';
import { areaFilter, canSeeArea, checkAreaId } from './areas.ts';
import { STAGES, type Stage, completeTask, reopenTask, getTask, visibleTask, toOut, manages, type TaskOut } from './tasks.ts';

// The task board: columns (To do, In progress, Review, Done), drag-and-drop ordering, comments, projects and milestones.
// Closing a card (the Done column) still goes through completeTask, so a job that needs camera photos cannot be dragged to Done without them.

const ownerOf = (u: UserRow): string => (u.role === 'owner' ? u.id : u.owner_id!);

/** Moves a card to a column at a place in it. Anyone who can see the card may move it forward; only managers can pull a finished card back. */
export function moveTask(u: UserRow, id: string, body: unknown): TaskOut {
  const v = new Validator(body);
  const stage = v.oneOf('stage', STAGES, true) as Stage;
  const index = v.int('index', { min: 0, max: 1000 });
  v.done();
  const t = visibleTask(u, id);
  if (u.role === 'customer') throw forbidden('Only the team can move tasks');
  if (t.status === 'cancelled') throw new HttpError(409, 'TASK_CLOSED', 'A cancelled task cannot be moved');
  if (t.intake_state === 'new') throw new HttpError(409, 'IN_INBOX', 'Take the request in from the inbox first');
  if (stage === 'done' && t.status !== 'done') completeTask(u, id);
  else if (stage !== 'done' && t.status === 'done') { reopenTask(u, id); }
  tx(() => {
    run('UPDATE tasks SET stage = ? WHERE id = ?', stage, id);
    const col = many<{ id: string }>("SELECT id FROM tasks WHERE owner_id = ? AND stage = ? AND status != 'cancelled' AND id != ? ORDER BY position, created_at", t.owner_id, stage, id).map((r) => r.id);
    col.splice(Math.min(index ?? col.length, col.length), 0, id);
    col.forEach((tid, i) => run('UPDATE tasks SET position = ? WHERE id = ?', i, tid));
  });
  audit({ id: u.id, role: u.role }, 'task.move', 'task', id, { from: t.stage, to: stage }, t.owner_id);
  return toOut(getTask(id));
}

// ---- comments

export interface CommentOut { id: string; authorId: string; authorName: string; body: string; at: number; mine: boolean }
export function listComments(u: UserRow, taskId: string): { items: CommentOut[] } {
  visibleTask(u, taskId);
  return { items: many<{ id: string; author_id: string; body: string; created_at: number }>('SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at', taskId)
    .map((c) => ({ id: c.id, authorId: c.author_id, authorName: userRow(c.author_id)?.name ?? 'Someone', body: c.body, at: c.created_at, mine: c.author_id === u.id })) };
}
export function addComment(u: UserRow, taskId: string, body: unknown): CommentOut {
  if (u.role === 'customer') throw forbidden('Only the team can comment');
  const t = visibleTask(u, taskId);
  const v = new Validator(body);
  const text = v.str('body', { required: true, min: 1, max: 1000 });
  v.done();
  const id = newId('tcm'), at = now();
  run('INSERT INTO task_comments(id, task_id, author_id, body, created_at) VALUES (?,?,?,?,?)', id, taskId, u.id, text!, at);
  audit({ id: u.id, role: u.role }, 'task.comment', 'task', taskId, { comment: id }, t.owner_id);
  return { id, authorId: u.id, authorName: u.name, body: text!, at, mine: true };
}

// ---- projects and milestones

export interface MilestoneOut { id: string; title: string; dueDate: string | null; done: boolean; overdue: boolean; tasks: number; tasksDone: number }
export interface ProjectOut { id: string; name: string; details: string | null; status: 'active' | 'archived'; areaId: string | null; areaName: string | null; tasks: number; tasksDone: number; milestones: MilestoneOut[] }
type ProjectRow = { id: string; owner_id: string; name: string; details: string | null; status: 'active' | 'archived'; area_id: string | null };

function milestonesOf(projectId: string): MilestoneOut[] {
  const today = istDate(now());
  return many<{ id: string; title: string; due_date: string | null; done_at: number | null; n: number; d: number }>(
    `SELECT m.id, m.title, m.due_date, m.done_at,
            (SELECT COUNT(*) FROM tasks t WHERE t.milestone_id = m.id AND t.status != 'cancelled') n,
            (SELECT COUNT(*) FROM tasks t WHERE t.milestone_id = m.id AND t.status = 'done') d
       FROM milestones m WHERE m.project_id = ? ORDER BY COALESCE(m.due_date, '9999-12-31'), m.created_at`, projectId)
    .map((m) => ({ id: m.id, title: m.title, dueDate: m.due_date, done: m.done_at !== null, overdue: m.done_at === null && !!m.due_date && m.due_date < today, tasks: m.n, tasksDone: m.d }));
}
function projectOut(p: ProjectRow): ProjectOut {
  const c = one<{ n: number; d: number }>("SELECT COUNT(*) n, COALESCE(SUM(status = 'done'), 0) d FROM tasks WHERE project_id = ? AND status != 'cancelled'", p.id)!;
  const areaName = p.area_id ? one<{ name: string }>('SELECT name FROM areas WHERE id = ?', p.area_id)?.name ?? null : null;
  return { id: p.id, name: p.name, details: p.details, status: p.status, areaId: p.area_id, areaName, tasks: c.n, tasksDone: c.d, milestones: milestonesOf(p.id) };
}
/** A project this person may see: their business's, and in a branch they may see (areas.ts). Anything else is 404. */
function myProject(u: UserRow, id: string): ProjectRow {
  const p = one<ProjectRow>('SELECT * FROM projects WHERE id = ?', id);
  if (!p || (u.role !== 'super_admin' && (p.owner_id !== ownerOf(u) || !canSeeArea(u, p.owner_id, p.area_id)))) throw notFound('Project not found');
  return p;
}
const needManage = (u: UserRow) => { if (!manages(u)) throw forbidden('This needs the "manage_tasks" permission'); };

export function listProjects(u: UserRow, ownerId: string | null): { items: ProjectOut[] } {
  const owner = ownerId ?? (u.role === 'super_admin' ? null : ownerOf(u));
  const f = owner ? areaFilter(u, owner, 'area_id') : { sql: '1 = 1', params: [] };
  const rows = many<ProjectRow>(`SELECT * FROM projects WHERE ${owner ? 'owner_id = ? AND ' : ''}${f.sql} ORDER BY status, created_at DESC`, ...(owner ? [owner] : []), ...f.params);
  return { items: rows.map(projectOut) };
}
export function createProject(u: UserRow, ownerId: string, body: unknown): ProjectOut {
  needManage(u);
  const v = new Validator(body);
  const name = v.str('name', { required: true, min: 2, max: 80 }), details = v.str('details', { max: 500 });
  const areaId = v.src.areaId === null || v.src.areaId === '' ? null : v.str('areaId', { max: 60 });
  v.done();
  checkAreaId(u, ownerId, areaId);
  const id = newId('prj');
  run('INSERT INTO projects(id, owner_id, name, details, area_id, created_at, created_by) VALUES (?,?,?,?,?,?,?)', id, ownerId, name!, details ?? null, areaId ?? null, now(), u.id);
  audit({ id: u.id, role: u.role }, 'project.create', 'project', id, { name, areaId: areaId ?? null }, ownerId);
  return projectOut(one<ProjectRow>('SELECT * FROM projects WHERE id = ?', id)!);
}
export function updateProject(u: UserRow, id: string, body: unknown): ProjectOut {
  needManage(u);
  const p = myProject(u, id);
  const v = new Validator(body);
  const name = v.str('name', { min: 2, max: 80 }), details = v.str('details', { max: 500 }), status = v.oneOf('status', ['active', 'archived'] as const);
  const areaId = v.src.areaId === null || v.src.areaId === '' ? null : v.str('areaId', { max: 60 });
  v.done();
  if (v.src.areaId !== undefined) checkAreaId(u, p.owner_id, areaId);
  const area = v.src.areaId === undefined ? p.area_id : areaId ?? null;
  run('UPDATE projects SET name = ?, details = ?, status = ?, area_id = ? WHERE id = ?', name ?? p.name, details ?? p.details, status ?? p.status, area, id);
  audit({ id: u.id, role: u.role }, 'project.update', 'project', id, { name, status, ...(v.src.areaId !== undefined ? { areaId: area } : {}) }, p.owner_id);
  return projectOut(one<ProjectRow>('SELECT * FROM projects WHERE id = ?', id)!);
}
export function addMilestone(u: UserRow, projectId: string, body: unknown): MilestoneOut {
  needManage(u);
  const p = myProject(u, projectId);
  const v = new Validator(body);
  const title = v.str('title', { required: true, min: 2, max: 100 }), due = v.date('dueDate');
  v.done();
  const id = newId('mst');
  run('INSERT INTO milestones(id, project_id, owner_id, title, due_date, created_at) VALUES (?,?,?,?,?,?)', id, projectId, p.owner_id, title!, due ?? null, now());
  audit({ id: u.id, role: u.role }, 'milestone.create', 'milestone', id, { title, projectId }, p.owner_id);
  return milestonesOf(projectId).find((m) => m.id === id)!;
}
export function updateMilestone(u: UserRow, id: string, body: unknown): MilestoneOut {
  needManage(u);
  const m = one<{ id: string; project_id: string; owner_id: string; title: string; due_date: string | null; done_at: number | null }>('SELECT * FROM milestones WHERE id = ?', id);
  if (!m || (u.role !== 'super_admin' && m.owner_id !== ownerOf(u))) throw notFound('Milestone not found');
  const v = new Validator(body);
  const title = v.str('title', { min: 2, max: 100 }), done = v.bool('done');
  const due = v.src.dueDate === null || v.src.dueDate === '' ? null : v.date('dueDate');
  v.done();
  run('UPDATE milestones SET title = ?, due_date = ?, done_at = ? WHERE id = ?', title ?? m.title, v.src.dueDate !== undefined ? (due ?? null) : m.due_date, done === undefined ? m.done_at : done ? (m.done_at ?? now()) : null, id);
  audit({ id: u.id, role: u.role }, 'milestone.update', 'milestone', id, { title, done }, m.owner_id);
  return milestonesOf(m.project_id).find((x) => x.id === id)!;
}
