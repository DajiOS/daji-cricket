import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { many, one, registerSchema, run } from './db.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { HttpError, notFound, forbidden } from './errors.ts';
import { audit } from './audit.ts';
import { hasPermission, userRow, type UserRow } from './auth.ts';
import { readExif } from './exif.ts';
import { MIN, istDate } from './time.ts';
import { Validator } from './input.ts';

// Jobs the owner hands to staff, closed with proof: photos taken with the camera right then.
// A proof photo has to be a JPEG straight from a camera. The shot time inside the file (EXIF) must be within the last 5 minutes
// (and not in the future), so an old picture from the gallery, a screenshot or a forwarded image is turned away. The same
// photo can never be used twice. Photos are private: only the owner, the super admin, managers and the person the job is for can open them.

registerSchema('tasks-1', `
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  details TEXT,
  assigned_to TEXT,
  due_date TEXT,
  photos_required INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  completed_at INTEGER,
  completed_by TEXT,
  completion_note TEXT
);
CREATE INDEX ix_tasks_owner ON tasks(owner_id, status);
CREATE INDEX ix_tasks_assignee ON tasks(assigned_to, status);
CREATE TABLE task_photos (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  uploaded_by TEXT NOT NULL,
  taken_at INTEGER NOT NULL,
  uploaded_at INTEGER NOT NULL,
  ext TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL UNIQUE,
  camera TEXT,
  note TEXT
);
CREATE INDEX ix_task_photos_task ON task_photos(task_id);
`);
registerSchema('tasks-2', `ALTER TABLE task_photos ADD COLUMN source TEXT NOT NULL DEFAULT 'exif';`);
registerSchema('tasks-3', `
ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium';
ALTER TABLE tasks ADD COLUMN stage TEXT NOT NULL DEFAULT 'todo';
ALTER TABLE tasks ADD COLUMN project_id TEXT;
ALTER TABLE tasks ADD COLUMN milestone_id TEXT;
ALTER TABLE tasks ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
UPDATE tasks SET stage = 'done' WHERE status = 'done';
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL
);
CREATE INDEX ix_projects_owner ON projects(owner_id, status);
CREATE TABLE milestones (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  due_date TEXT,
  done_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_milestones_project ON milestones(project_id);
CREATE TABLE task_comments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  author_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_task_comments_task ON task_comments(task_id, created_at);
`);

/** How old the moment of the shot may be when it arrives, and how far ahead of the server clock a phone clock may be. */
export const MAX_PHOTO_AGE_MS = 5 * MIN;
export const FUTURE_SLACK_MS = 2 * MIN;
export const MAX_TASK_PHOTO_BYTES = 8 * 1024 * 1024;
export const MAX_PHOTOS_PER_TASK = 10;

export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export const STAGES = ['todo', 'doing', 'review', 'done'] as const;
export type Priority = (typeof PRIORITIES)[number];
export type Stage = (typeof STAGES)[number];
interface TaskRow { id: string; owner_id: string; title: string; details: string | null; assigned_to: string | null; due_date: string | null; photos_required: number; status: 'open' | 'done' | 'cancelled'; created_at: number; created_by: string; completed_at: number | null; completed_by: string | null; completion_note: string | null; priority: Priority; stage: Stage; project_id: string | null; milestone_id: string | null; position: number }
interface PhotoRow { source: string; id: string; task_id: string; uploaded_by: string; taken_at: number; uploaded_at: number; ext: string; bytes: number; camera: string | null; note: string | null }

export interface TaskOut {
  id: string; title: string; details: string | null; assignedTo: string | null; assignedName: string | null; dueDate: string | null; overdue: boolean;
  priority: Priority; stage: Stage; projectId: string | null; projectName: string | null; milestoneId: string | null; milestoneTitle: string | null; commentCount: number;
  photosRequired: number; status: TaskRow['status']; createdAt: number; completedAt: number | null; completedByName: string | null; completionNote: string | null;
  photos: { id: string; url: string; takenAt: number; uploadedAt: number; uploadedByName: string | null; note: string | null; camera: string | null; source: string }[];
}

const nameOf = (id: string | null): string | null => (id ? userRow(id)?.name ?? null : null);

/** Managers (owner, super admin, or staff with manage_tasks) work with every job of the owner; other staff see only theirs and the open-to-all ones. */
export const manages = (u: UserRow): boolean => hasPermission(u, 'manage_tasks');

export function toOut(t: TaskRow): TaskOut {
  const photos = many<PhotoRow>('SELECT * FROM task_photos WHERE task_id = ? ORDER BY taken_at', t.id);
  return {
    id: t.id, title: t.title, details: t.details, assignedTo: t.assigned_to, assignedName: nameOf(t.assigned_to), dueDate: t.due_date,
    overdue: t.status === 'open' && !!t.due_date && t.due_date < istDate(now()),
    priority: t.priority, stage: t.stage, projectId: t.project_id, projectName: t.project_id ? one<{ name: string }>('SELECT name FROM projects WHERE id = ?', t.project_id)?.name ?? null : null,
    milestoneId: t.milestone_id, milestoneTitle: t.milestone_id ? one<{ title: string }>('SELECT title FROM milestones WHERE id = ?', t.milestone_id)?.title ?? null : null,
    commentCount: one<{ c: number }>('SELECT COUNT(*) c FROM task_comments WHERE task_id = ?', t.id)!.c,
    photosRequired: t.photos_required, status: t.status, createdAt: t.created_at, completedAt: t.completed_at, completedByName: nameOf(t.completed_by), completionNote: t.completion_note,
    photos: photos.map((p) => ({ id: p.id, url: `/api/tasks/photos/${p.id}`, takenAt: p.taken_at, uploadedAt: p.uploaded_at, uploadedByName: nameOf(p.uploaded_by), note: p.note, camera: p.camera, source: p.source })),
  };
}

export function getTask(id: string): TaskRow {
  const t = one<TaskRow>('SELECT * FROM tasks WHERE id = ?', id);
  if (!t) throw notFound('Task not found');
  return t;
}

/** The job, if this person may see it (404 otherwise, so ids of other owners' jobs are not confirmed). */
export function visibleTask(u: UserRow, id: string): TaskRow {
  const t = getTask(id);
  if (u.role === 'super_admin') return t;
  const owner = u.role === 'owner' ? u.id : u.owner_id;
  if (t.owner_id !== owner) throw notFound('Task not found');
  if (u.role === 'staff' && !manages(u) && t.assigned_to !== null && t.assigned_to !== u.id) throw notFound('Task not found');
  return t;
}

export function parseTask(body: unknown, forUpdate = false): { title?: string; details?: string; assignedTo?: string | null; dueDate?: string | null; photosRequired?: number; priority?: Priority; projectId?: string | null; milestoneId?: string | null } {
  const v = new Validator(body);
  const title = v.str('title', { min: 3, max: 120, required: !forUpdate });
  const details = v.str('details', { max: 1000 });
  const photosRequired = v.int('photosRequired', { min: 0, max: MAX_PHOTOS_PER_TASK });
  const dueDate = v.src.dueDate === null || v.src.dueDate === '' ? null : v.date('dueDate');
  const assignedTo = v.src.assignedTo === null || v.src.assignedTo === '' ? null : v.str('assignedTo', { max: 60 });
  const priority = v.oneOf('priority', PRIORITIES);
  const projectId = v.src.projectId === null || v.src.projectId === '' ? null : v.str('projectId', { max: 60 });
  const milestoneId = v.src.milestoneId === null || v.src.milestoneId === '' ? null : v.str('milestoneId', { max: 60 });
  v.done();
  return { ...(priority !== undefined ? { priority } : {}), ...(v.src.projectId !== undefined ? { projectId: projectId ?? null } : {}), ...(v.src.milestoneId !== undefined ? { milestoneId: milestoneId ?? null } : {}), ...(title !== undefined ? { title } : {}), ...(details !== undefined ? { details } : {}), ...(photosRequired !== undefined ? { photosRequired } : {}), ...(v.src.dueDate !== undefined ? { dueDate: dueDate ?? null } : {}), ...(v.src.assignedTo !== undefined ? { assignedTo: assignedTo ?? null } : {}) };
}

function checkAssignee(ownerId: string, id: string | null | undefined): void {
  if (!id) return;
  const s = userRow(id);
  if (!s || s.role !== 'staff' || s.owner_id !== ownerId || !s.active) throw new HttpError(400, 'VALIDATION_FAILED', 'Pick one of your own active team members', { fields: [{ field: 'assignedTo', message: 'Not on your team' }] });
}

/** A project and milestone have to belong to the same owner, and the milestone to the project. */
function checkProject(ownerId: string, projectId: string | null | undefined, milestoneId: string | null | undefined): void {
  const bad = (field: string, message: string) => new HttpError(400, 'VALIDATION_FAILED', message, { fields: [{ field, message }] });
  if (projectId && !one('SELECT 1 FROM projects WHERE id = ? AND owner_id = ?', projectId, ownerId)) throw bad('projectId', 'Unknown project');
  if (milestoneId) {
    const m = one<{ project_id: string }>('SELECT project_id FROM milestones WHERE id = ? AND owner_id = ?', milestoneId, ownerId);
    if (!m) throw bad('milestoneId', 'Unknown milestone');
    if (projectId && m.project_id !== projectId) throw bad('milestoneId', 'That milestone belongs to a different project');
  }
}

export function createTask(u: UserRow, ownerId: string, body: unknown): TaskOut {
  if (!manages(u)) throw forbidden('This needs the "manage_tasks" permission');
  const t = parseTask(body);
  checkAssignee(ownerId, t.assignedTo);
  checkProject(ownerId, t.projectId, t.milestoneId);
  const id = newId('tsk');
  const pos = (one<{ m: number | null }>("SELECT MAX(position) m FROM tasks WHERE owner_id = ? AND stage = 'todo'", ownerId)?.m ?? -1) + 1;
  run('INSERT INTO tasks(id, owner_id, title, details, assigned_to, due_date, photos_required, priority, project_id, milestone_id, position, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    id, ownerId, t.title!, t.details ?? null, t.assignedTo ?? null, t.dueDate ?? null, t.photosRequired ?? 1, t.priority ?? 'medium', t.projectId ?? null, t.milestoneId ?? null, pos, now(), u.id);
  audit({ id: u.id, role: u.role }, 'task.create', 'task', id, { title: t.title, assignedTo: t.assignedTo ?? null }, ownerId);
  return toOut(getTask(id));
}

export function updateTask(u: UserRow, id: string, body: unknown): TaskOut {
  if (!manages(u)) throw forbidden('This needs the "manage_tasks" permission');
  const cur = visibleTask(u, id);
  if (cur.status !== 'open') throw new HttpError(409, 'TASK_CLOSED', 'Only an open task can be changed');
  const t = parseTask(body, true);
  if (t.assignedTo !== undefined) checkAssignee(cur.owner_id, t.assignedTo);
  const proj = t.projectId === undefined ? cur.project_id : t.projectId;
  const mile = t.milestoneId === undefined ? (t.projectId !== undefined && t.projectId !== cur.project_id ? null : cur.milestone_id) : t.milestoneId;
  checkProject(cur.owner_id, proj, mile);
  run('UPDATE tasks SET title = ?, details = ?, assigned_to = ?, due_date = ?, photos_required = ?, priority = ?, project_id = ?, milestone_id = ? WHERE id = ?',
    t.title ?? cur.title, t.details ?? cur.details, t.assignedTo === undefined ? cur.assigned_to : t.assignedTo, t.dueDate === undefined ? cur.due_date : t.dueDate, t.photosRequired ?? cur.photos_required, t.priority ?? cur.priority, proj, mile, id);
  audit({ id: u.id, role: u.role }, 'task.update', 'task', id, t, cur.owner_id);
  return toOut(getTask(id));
}

export function listTasks(u: UserRow, ownerId: string | null, status?: string, projectId?: string): { items: TaskOut[] } {
  const where: string[] = [], p: string[] = [];
  if (ownerId) { where.push('owner_id = ?'); p.push(ownerId); }
  if (u.role === 'staff' && !manages(u)) { where.push('(assigned_to IS NULL OR assigned_to = ?)'); p.push(u.id); }
  if (projectId) { where.push('project_id = ?'); p.push(projectId); }
  if (status === 'open' || status === 'done' || status === 'cancelled') { where.push('status = ?'); p.push(status); }
  const rows = many<TaskRow>(`SELECT * FROM tasks ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, position, COALESCE(due_date, '9999-12-31'), created_at DESC LIMIT 500`, ...p);
  return { items: rows.map(toOut) };
}

export function getTaskOut(u: UserRow, id: string): TaskOut { return toOut(visibleTask(u, id)); }

/**
 * Checks a photo is a fresh camera shot. Throws a 4xx with a message the staff member can act on.
 * Returns the moment it was taken.
 */
export function checkCameraPhoto(data: Buffer, at = now(), appShotAt?: number): { takenAt: number; camera: string | null; source: 'exif' | 'app' } {
  if (!data.length) throw new HttpError(400, 'EMPTY_FILE', 'The file is empty');
  if (data.length > MAX_TASK_PHOTO_BYTES) throw new HttpError(413, 'FILE_TOO_LARGE', `A photo can be up to ${MAX_TASK_PHOTO_BYTES / 1024 / 1024} MB`);
  if (!(data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff)) throw new HttpError(415, 'NOT_A_CAMERA_PHOTO', 'Take the picture with the camera. Screenshots and saved images cannot be used.');
  const x = readExif(data);
  // The phone app takes the picture itself inside the app (no gallery) and says when. Some phone cameras leave the time out of the saved file, so the app's own time is used only then.
  if (x.takenAt === null && appShotAt !== undefined && Number.isFinite(appShotAt) && at - appShotAt <= MAX_PHOTO_AGE_MS && appShotAt - at <= FUTURE_SLACK_MS) return { takenAt: appShotAt, camera: [x.make, x.model].filter(Boolean).join(' ') || null, source: 'app' };
  if (x.takenAt === null) throw new HttpError(422, 'NO_CAMERA_DATA', 'This picture has no camera time in it, so it cannot be used. Take a new one with the camera.');
  const age = at - x.takenAt;
  if (age > MAX_PHOTO_AGE_MS) throw new HttpError(422, 'PHOTO_TOO_OLD', `This photo was taken ${age >= 60 * MIN ? Math.round(age / (60 * MIN)) + ' hour(s)' : Math.max(1, Math.round(age / MIN)) + ' minute(s)'} ago. Photos must be taken within the last 5 minutes. Take a new one now.`, { takenAt: x.takenAt, ageMinutes: Math.round(age / MIN) });
  if (age < -FUTURE_SLACK_MS) throw new HttpError(422, 'PHOTO_FROM_FUTURE', 'The time on this photo is ahead of the real time. Check the date and time on the phone, then take a new photo.', { takenAt: x.takenAt });
  return { takenAt: x.takenAt, camera: [x.make, x.model].filter(Boolean).join(' ') || null, source: 'exif' };
}

export function addTaskPhoto(dataDir: string, u: UserRow, id: string, data: Buffer, noteIn?: string, appShotAt?: number): TaskOut {
  if (u.role === 'customer') throw forbidden('Only the team can add task photos');
  const t = visibleTask(u, id);
  if (t.status !== 'open') throw new HttpError(409, 'TASK_CLOSED', 'This task is already closed');
  if (u.role === 'staff' && t.assigned_to !== null && t.assigned_to !== u.id) throw notFound('Task not found');
  if (one<{ c: number }>('SELECT COUNT(*) c FROM task_photos WHERE task_id = ?', id)!.c >= MAX_PHOTOS_PER_TASK) throw new HttpError(409, 'TOO_MANY_PHOTOS', `Up to ${MAX_PHOTOS_PER_TASK} photos per task`);
  const { takenAt, camera, source } = checkCameraPhoto(data, now(), appShotAt);
  const sha = createHash('sha256').update(data).digest('hex');
  if (one('SELECT 1 FROM task_photos WHERE sha256 = ?', sha)) throw new HttpError(409, 'PHOTO_ALREADY_USED', 'This photo has already been uploaded. Take a new one.');
  const pid = newId('tph');
  mkdirSync(join(dataDir, 'task-photos'), { recursive: true });
  writeFileSync(join(dataDir, 'task-photos', `${pid}.jpg`), data);
  const note = noteIn?.trim().slice(0, 200) || null;
  run('INSERT INTO task_photos(id, task_id, uploaded_by, taken_at, uploaded_at, ext, bytes, sha256, camera, note, source) VALUES (?,?,?,?,?,?,?,?,?,?,?)', pid, id, u.id, takenAt, now(), 'jpg', data.length, sha, camera, note, source);
  audit({ id: u.id, role: u.role }, 'task.photo', 'task', id, { photo: pid, takenAt, camera, source }, t.owner_id);
  return toOut(t);
}

export function completeTask(u: UserRow, id: string, noteIn?: string): TaskOut {
  const t = visibleTask(u, id);
  if (u.role === 'staff' && t.assigned_to !== null && t.assigned_to !== u.id) throw notFound('Task not found');
  if (t.status !== 'open') throw new HttpError(409, 'TASK_CLOSED', 'This task is already closed');
  const have = one<{ c: number }>('SELECT COUNT(*) c FROM task_photos WHERE task_id = ?', id)!.c;
  if (have < t.photos_required) throw new HttpError(409, 'PHOTOS_NEEDED', `This task needs ${t.photos_required} photo${t.photos_required === 1 ? '' : 's'} taken with the camera first (${have} added).`, { required: t.photos_required, have });
  run("UPDATE tasks SET status = 'done', stage = 'done', completed_at = ?, completed_by = ?, completion_note = ? WHERE id = ?", now(), u.id, noteIn?.trim().slice(0, 300) || null, id);
  audit({ id: u.id, role: u.role }, 'task.done', 'task', id, { photos: have }, t.owner_id);
  return toOut(getTask(id));
}

export function reopenTask(u: UserRow, id: string): TaskOut {
  if (!manages(u)) throw forbidden('This needs the "manage_tasks" permission');
  const t = visibleTask(u, id);
  if (t.status === 'open') return toOut(t);
  run("UPDATE tasks SET status = 'open', stage = 'todo', completed_at = NULL, completed_by = NULL, completion_note = NULL WHERE id = ?", id);
  audit({ id: u.id, role: u.role }, 'task.reopen', 'task', id, {}, t.owner_id);
  return toOut(getTask(id));
}

export function cancelTask(u: UserRow, id: string): TaskOut {
  if (!manages(u)) throw forbidden('This needs the "manage_tasks" permission');
  const t = visibleTask(u, id);
  if (t.status !== 'open') throw new HttpError(409, 'TASK_CLOSED', 'Only an open task can be cancelled');
  run("UPDATE tasks SET status = 'cancelled' WHERE id = ?", id);
  audit({ id: u.id, role: u.role }, 'task.cancel', 'task', id, {}, t.owner_id);
  return toOut(getTask(id));
}

export function readTaskPhoto(dataDir: string, u: UserRow, photoId: string): { data: Buffer; mime: string } {
  const p = one<PhotoRow>('SELECT * FROM task_photos WHERE id = ?', photoId);
  if (!p) throw notFound('Photo not found');
  visibleTask(u, p.task_id);
  try { return { data: readFileSync(join(dataDir, 'task-photos', `${p.id}.jpg`)), mime: 'image/jpeg' }; } catch { throw notFound('Photo not found'); }
}
