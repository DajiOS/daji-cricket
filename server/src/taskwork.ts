import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { many, one, registerSchema, run } from './db.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { audit } from './audit.ts';
import { forbidden, HttpError, notFound } from './errors.ts';
import { Validator } from './input.ts';
import { storeUpload } from './intake.ts';
import { sniff } from './accounting/books.ts';
import { userRow, type UserRow } from './auth.ts';
import { areaFilter, canSeeArea } from './areas.ts';
import { getTask, manages, onJob, toOut, visibleTask, type TaskOut } from './tasks.ts';
import { addDays, istDate, istMidnight } from './time.ts';

// The tasks upgrade (redesign step 5), part two.
// References: gallery pictures, WhatsApp pictures, quotes, drawings, PDFs and links that explain a job. They are kept apart from
// proof: only a fresh camera photo (task_photos, tasks.ts) counts toward closing a job, and a reference never does.
// History: the job's own audit trail, in plain words.
// Daily site report: what happened on a site (a project, or the business when none) on one day, made from the jobs themselves
// plus a short note from each person on site. Nothing in it is a second copy of a job.

registerSchema('task-refs-1', `
CREATE TABLE task_refs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('file','link')),
  name TEXT NOT NULL,
  mime TEXT,
  bytes INTEGER,
  link TEXT,
  note TEXT,
  added_by TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  hidden_at INTEGER,
  hidden_by TEXT
);
CREATE INDEX ix_task_refs_task ON task_refs(task_id);
CREATE TABLE site_reports (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  project_id TEXT,
  on_date TEXT NOT NULL,
  author_id TEXT NOT NULL,
  workers INTEGER,
  body TEXT NOT NULL,
  issues TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_site_reports ON site_reports(owner_id, COALESCE(project_id, ''), on_date, author_id);
CREATE INDEX ix_site_reports_day ON site_reports(owner_id, on_date);
`);

export const MAX_REF_BYTES = 10 * 1024 * 1024;
export const MAX_REFS_PER_TASK = 30;
const REF_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf']);
const actorOf = (u: UserRow) => ({ id: u.id, role: u.role });
const refPath = (dataDir: string, ownerId: string, id: string) => join(dataDir, 'task-refs', ownerId, id);

/** May add references to the job: a manager, anyone working on it, or whoever raised it while it is still a request. */
function mayWork(u: UserRow, t: ReturnType<typeof visibleTask>): void {
  if (u.role === 'customer') throw forbidden('Only the team can add references');
  if (u.role === 'staff' && !manages(u) && !onJob(u, t)) throw notFound('Task not found');
}
function roomFor(taskId: string): void {
  if (one<{ c: number }>('SELECT COUNT(*) c FROM task_refs WHERE task_id = ? AND hidden_at IS NULL', taskId)!.c >= MAX_REFS_PER_TASK) throw new HttpError(409, 'TOO_MANY_REFERENCES', `Up to ${MAX_REFS_PER_TASK} references per task`);
}
const cleanName = (n: string | undefined, ext: string): string => {
  const base = (n ?? '').replace(/[\\/]/g, '_').replace(/[^\w .()\-]/g, '_').replace(/\.+$/, '').slice(0, 80).trim() || 'reference';
  return /\.(pdf|png|jpe?g|webp)$/i.test(base) ? base : `${base}.${ext}`;
};

/** A reference file: any picture (gallery and WhatsApp pictures are fine here) or a PDF. It does not count as proof. */
export function addRefFile(dataDir: string, u: UserRow, taskId: string, buf: Buffer, nameIn?: string, noteIn?: string): TaskOut {
  const t = visibleTask(u, taskId);
  mayWork(u, t);
  if (t.status === 'cancelled') throw new HttpError(409, 'TASK_CLOSED', 'This task was cancelled');
  roomFor(taskId);
  if (!buf.length) throw new HttpError(400, 'EMPTY_FILE', 'The file is empty');
  if (buf.length > MAX_REF_BYTES) throw new HttpError(413, 'FILE_TOO_LARGE', `A reference can be up to ${MAX_REF_BYTES / 1024 / 1024} MB`);
  const k = sniff(buf);
  if (!k || !REF_TYPES.has(k.mime)) throw new HttpError(415, 'FILE_TYPE_NOT_ALLOWED', 'Use a picture (JPEG, PNG or WebP) or a PDF');
  const id = newId('trf');
  const name = cleanName(nameIn, k.ext);
  const note = noteIn?.trim().slice(0, 200) || null;
  storeUpload({
    dataDir, buf, finalPath: refPath(dataDir, t.owner_id, id), purpose: 'task_reference', actor: actorOf(u), ownerId: t.owner_id,
    writeMetadata: () => {
      run("INSERT INTO task_refs(id, task_id, owner_id, kind, name, mime, bytes, note, added_by, added_at) VALUES (?,?,?,'file',?,?,?,?,?,?)", id, taskId, t.owner_id, name, k.mime, buf.length, note, u.id, now());
      audit(actorOf(u), 'task.reference', 'task', taskId, { reference: id, name, mime: k.mime, bytes: buf.length }, t.owner_id);
    },
  });
  return toOut(getTask(taskId));
}

/** A reference link (a quote online, a product page, a shared drive). Only web addresses. */
export function addRefLink(u: UserRow, taskId: string, body: unknown): TaskOut {
  const t = visibleTask(u, taskId);
  mayWork(u, t);
  if (t.status === 'cancelled') throw new HttpError(409, 'TASK_CLOSED', 'This task was cancelled');
  roomFor(taskId);
  const v = new Validator(body);
  const url = v.str('url', { min: 8, max: 1000, required: true })!.trim();
  const nameIn = v.str('name', { max: 80 });
  const note = v.str('note', { max: 200 })?.trim() || null;
  v.done();
  let parsed: URL;
  try { parsed = new URL(url); } catch { parsed = null as unknown as URL; }
  if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || parsed.username || parsed.password) {
    throw new HttpError(400, 'VALIDATION_FAILED', 'Use a web address starting with https://', { fields: [{ field: 'url', message: 'Use a web address starting with https://' }] });
  }
  const id = newId('trf');
  const name = nameIn?.trim() || parsed.hostname;
  run("INSERT INTO task_refs(id, task_id, owner_id, kind, name, link, note, added_by, added_at) VALUES (?,?,?,'link',?,?,?,?,?)", id, taskId, t.owner_id, name, parsed.toString(), note, u.id, now());
  audit(actorOf(u), 'task.reference', 'task', taskId, { reference: id, name, link: parsed.hostname }, t.owner_id);
  return toOut(getTask(taskId));
}

/** Takes a reference off the job. It is hidden, not deleted: the file stays on record. A manager or whoever added it. */
export function hideRef(u: UserRow, refId: string): TaskOut {
  const r = one<{ task_id: string; added_by: string; hidden_at: number | null; name: string }>('SELECT task_id, added_by, hidden_at, name FROM task_refs WHERE id = ?', refId);
  if (!r) throw notFound('Reference not found');
  const t = visibleTask(u, r.task_id);
  if (!manages(u) && r.added_by !== u.id) throw forbidden('Only a manager or the person who added it can take it off');
  if (!r.hidden_at) {
    run('UPDATE task_refs SET hidden_at = ?, hidden_by = ? WHERE id = ?', now(), u.id, refId);
    audit(actorOf(u), 'task.reference_hidden', 'task', r.task_id, { reference: refId, name: r.name }, t.owner_id);
  }
  return toOut(getTask(r.task_id));
}

export function refFile(dataDir: string, u: UserRow, refId: string): { buf: Buffer; mime: string; name: string } {
  const r = one<{ task_id: string; owner_id: string; kind: string; mime: string | null; name: string; hidden_at: number | null }>('SELECT task_id, owner_id, kind, mime, name, hidden_at FROM task_refs WHERE id = ?', refId);
  if (!r || r.kind !== 'file' || r.hidden_at) throw notFound('Reference not found');
  visibleTask(u, r.task_id);
  const p = refPath(dataDir, r.owner_id, refId);
  if (!existsSync(p)) throw notFound('Reference not found');
  return { buf: readFileSync(p), mime: r.mime ?? 'application/octet-stream', name: r.name };
}

// ---- history

const SAYS: Record<string, (d: any) => string> = {
  'task.create': () => 'Added the job', 'task.request': () => 'Raised it as a request', 'task.request_taken': (d) => `Took the request in${d.note ? `: ${d.note}` : ''}`,
  'task.request_declined': (d) => `Turned the request down: ${d.note ?? ''}`, 'task.update': () => 'Changed the details', 'task.move': (d) => `Moved it from ${d.from} to ${d.to}`,
  'task.photo': () => 'Added a proof photo', 'task.reference': (d) => `Added a reference: ${d.name ?? ''}`, 'task.reference_hidden': (d) => `Took a reference off: ${d.name ?? ''}`,
  'task.check': (d) => `${d.done ? 'Ticked' : 'Unticked'} "${d.step ?? ''}"`, 'task.done': () => 'Marked it done', 'task.reopen': (d) => `Reopened it${d.reason ? `: ${d.reason}` : ''}`,
  'task.cancel': () => 'Cancelled it', 'task.ack': () => 'Accepted the job', 'task.signoff': () => 'Signed off the work', 'task.helpers': () => 'Changed who helps',
  'task.next': (d) => (d.text ? `Next action: ${d.text}` : 'Cleared the next action'), 'task.comment': () => 'Wrote a comment', 'task.repeat': () => 'Added as the next of a repeating job',
};

/** Everything that happened to the job, oldest first, with who did it. Only for those who can see the job. */
export function taskHistory(u: UserRow, taskId: string): { items: { at: number; who: string | null; what: string; action: string }[] } {
  const t = visibleTask(u, taskId);
  const rows = many<{ at: number; actor_id: string | null; action: string; detail: string | null }>("SELECT at, actor_id, action, detail FROM audit_log WHERE entity = 'task' AND entity_id = ? AND owner_id = ? ORDER BY at, rowid LIMIT 500", taskId, t.owner_id);
  return {
    items: rows.map((r) => {
      let d: any = {};
      try { d = r.detail ? JSON.parse(r.detail) : {}; } catch { /* plain */ }
      return { at: r.at, who: r.actor_id ? userRow(r.actor_id)?.name ?? null : null, what: (SAYS[r.action] ?? (() => r.action.replace(/^task\./, '').replace(/_/g, ' ')))(d), action: r.action };
    }),
  };
}

// ---- daily site report

export interface SiteNoteOut { id: string; authorId: string; authorName: string | null; workers: number | null; body: string; issues: string | null; updatedAt: number; mine: boolean }
export interface SiteReportOut {
  date: string; projectId: string | null; projectName: string | null;
  notes: SiteNoteOut[];
  done: { id: string; title: string; byName: string | null; proofPhotos: number; signedOff: boolean }[];
  started: { id: string; title: string }[];
  raised: { id: string; title: string; byName: string | null }[];
  overdue: { id: string; title: string; dueDate: string }[];
  proofPhotos: number; references: number;
}

function siteProject(u: UserRow, ownerId: string, projectId: string | null): { id: string; name: string } | null {
  if (!projectId) return null;
  const p = one<{ id: string; name: string; area_id: string | null }>('SELECT id, name, area_id FROM projects WHERE id = ? AND owner_id = ?', projectId, ownerId);
  if (!p || !canSeeArea(u, ownerId, p.area_id)) throw notFound('Project not found');
  return { id: p.id, name: p.name };
}

/**
 * The day on one site. Jobs are filtered exactly as the task board filters them for this person, so a team member sees the jobs
 * they work on, and a hidden branch's projects are never counted.
 */
export function siteReport(u: UserRow, ownerId: string, dateIn: string | null, projectIdIn: string | null): SiteReportOut {
  if (u.role === 'customer') throw forbidden('Only the team can see site reports');
  const date = dateIn && /^\d{4}-\d{2}-\d{2}$/.test(dateIn) ? dateIn : istDate(now());
  const proj = siteProject(u, ownerId, projectIdIn || null);
  const from = istMidnight(date), to = istMidnight(addDays(date, 1));
  const f = areaFilter(u, ownerId, 'area_id');
  const mine = u.role === 'staff' && !manages(u);
  const where = [`owner_id = ?`, proj ? 'project_id = ?' : '1 = 1', `(project_id IS NULL OR project_id IN (SELECT id FROM projects WHERE ${f.sql}))`,
    mine ? '(assigned_to IS NULL OR assigned_to = ? OR id IN (SELECT task_id FROM task_helpers WHERE user_id = ? AND removed_at IS NULL))' : '1 = 1'].join(' AND ');
  const p = [ownerId, ...(proj ? [proj.id] : []), ...f.params, ...(mine ? [u.id, u.id] : [])];
  type Row = { id: string; title: string; completed_by: string | null; signoff_at: number | null; due_date: string | null; intake_by: string | null; intake_state: string | null };
  const q = (extra: string, ...xp: (string | number)[]) => many<Row>(`SELECT id, title, completed_by, signoff_at, due_date, intake_by, intake_state FROM tasks WHERE ${where} AND ${extra} ORDER BY created_at LIMIT 200`, ...p, ...xp);
  const name = (id: string | null) => (id ? userRow(id)?.name ?? null : null);
  const photos = (id: string) => one<{ c: number }>('SELECT COUNT(*) c FROM task_photos WHERE task_id = ?', id)!.c;
  const done = q("status = 'done' AND completed_at >= ? AND completed_at < ?", from, to);
  const ids = (sql: string, ...xp: (string | number)[]) => one<{ c: number }>(`${sql} AND task_id IN (SELECT id FROM tasks WHERE ${where})`, ...xp, ...p)!.c;
  const notes = many<{ id: string; author_id: string; workers: number | null; body: string; issues: string | null; updated_at: number }>(
    `SELECT id, author_id, workers, body, issues, updated_at FROM site_reports WHERE owner_id = ? AND on_date = ? AND ${proj ? 'project_id = ?' : 'project_id IS NULL'} ${mine ? 'AND author_id = ?' : ''} ORDER BY updated_at`,
    ownerId, date, ...(proj ? [proj.id] : []), ...(mine ? [u.id] : []));
  return {
    date, projectId: proj?.id ?? null, projectName: proj?.name ?? null,
    notes: notes.map((n) => ({ id: n.id, authorId: n.author_id, authorName: name(n.author_id), workers: n.workers, body: n.body, issues: n.issues, updatedAt: n.updated_at, mine: n.author_id === u.id })),
    done: done.map((t) => ({ id: t.id, title: t.title, byName: name(t.completed_by), proofPhotos: photos(t.id), signedOff: !!t.signoff_at })),
    started: q("status = 'open' AND id IN (SELECT entity_id FROM audit_log WHERE entity = 'task' AND action IN ('task.ack', 'task.move') AND at >= ? AND at < ?)", from, to).map((t) => ({ id: t.id, title: t.title })),
    raised: mine ? [] : q("intake_by IS NOT NULL AND created_at >= ? AND created_at < ?", from, to).map((t) => ({ id: t.id, title: t.title, byName: name(t.intake_by) })),
    overdue: q("status = 'open' AND (intake_state IS NULL OR intake_state <> 'new') AND due_date < ?", date).map((t) => ({ id: t.id, title: t.title, dueDate: t.due_date! })),
    proofPhotos: ids('SELECT COUNT(*) c FROM task_photos WHERE uploaded_at >= ? AND uploaded_at < ?', from, to),
    references: ids('SELECT COUNT(*) c FROM task_refs WHERE hidden_at IS NULL AND added_at >= ? AND added_at < ?', from, to),
  };
}

/** Writes (or rewrites) this person's note for the day on a site: how many people worked, what was done, and any problems. */
export function saveSiteNote(u: UserRow, ownerId: string, body: unknown): SiteReportOut {
  if (u.role === 'customer') throw forbidden('Only the team can write site reports');
  const v = new Validator(body);
  const date = v.date('date') ?? istDate(now());
  const projectId = v.src.projectId === null || v.src.projectId === '' ? null : v.str('projectId', { max: 60 }) ?? null;
  const workers = v.int('workers', { min: 0, max: 1000 }) ?? null;
  const text = v.str('body', { min: 2, max: 2000, required: true })!.trim();
  const issues = v.str('issues', { max: 1000 })?.trim() || null;
  v.done();
  if (date > istDate(now())) throw new HttpError(400, 'VALIDATION_FAILED', 'A site report cannot be for a day still to come', { fields: [{ field: 'date', message: 'Pick today or an earlier day' }] });
  if (date < addDays(istDate(now()), -7)) throw new HttpError(400, 'VALIDATION_FAILED', 'A site report can be written up to 7 days late', { fields: [{ field: 'date', message: 'Pick a day in the last week' }] });
  siteProject(u, ownerId, projectId);
  const was = one<{ id: string }>(`SELECT id FROM site_reports WHERE owner_id = ? AND on_date = ? AND author_id = ? AND ${projectId ? 'project_id = ?' : 'project_id IS NULL'}`, ownerId, date, u.id, ...(projectId ? [projectId] : []));
  const at = now();
  if (was) run('UPDATE site_reports SET workers = ?, body = ?, issues = ?, updated_at = ? WHERE id = ?', workers, text, issues, at, was.id);
  else run('INSERT INTO site_reports(id, owner_id, project_id, on_date, author_id, workers, body, issues, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', newId('srp'), ownerId, projectId, date, u.id, workers, text, issues, at, at);
  audit(actorOf(u), was ? 'site_report.update' : 'site_report.create', 'site_report', was?.id ?? null, { date, projectId, workers }, ownerId);
  return siteReport(u, ownerId, date, projectId);
}
