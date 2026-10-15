import { many, one, registerSchema, run, tx } from './db.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { HttpError, notFound } from './errors.ts';
import { Validator } from './input.ts';
import { audit, type Actor } from './audit.ts';
import { istDate, isValidDate } from './time.ts';
import { userRow } from './auth.ts';

// The academy: students, who looks after them, attendance, and a monthly progress card the coach can publish to the parent.
// Everything is scoped to one owner. A parent sees a child only after STAFF link their account to the child (an email match alone is not
// enough, because sign-up does not verify email addresses). Photos and videos are not stored here yet; the consent flags are.

registerSchema('academy-1', `
CREATE TABLE academy_students (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  born_on TEXT,
  batch TEXT,
  guardian_name TEXT NOT NULL,
  guardian_email TEXT,
  guardian_phone TEXT,
  guardian_user_id TEXT REFERENCES users(id),
  photo_consent INTEGER NOT NULL DEFAULT 0,
  video_consent INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','left')),
  joined_on TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX ix_academy_students_owner ON academy_students(owner_id, status);
CREATE INDEX ix_academy_students_guardian ON academy_students(guardian_user_id);

CREATE TABLE academy_skills (
  owner_id TEXT NOT NULL REFERENCES users(id),
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (owner_id, position)
);

CREATE TABLE academy_attendance (
  student_id TEXT NOT NULL REFERENCES academy_students(id),
  date TEXT NOT NULL,
  present INTEGER NOT NULL,
  note TEXT,
  marked_by TEXT,
  marked_at INTEGER NOT NULL,
  PRIMARY KEY (student_id, date)
);

CREATE TABLE academy_progress (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES academy_students(id),
  month TEXT NOT NULL,
  ratings TEXT NOT NULL,
  comment TEXT,
  published INTEGER NOT NULL DEFAULT 0,
  published_at INTEGER,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (student_id, month)
);
`);

registerSchema('academy-2-self', 'ALTER TABLE academy_students ADD COLUMN student_user_id TEXT REFERENCES users(id);');

/** A student may have a login of their own from this age. Younger students are seen only through a parent. */
export const OWN_LOGIN_AGE = 16;

export const DEFAULT_SKILLS = ['Batting', 'Bowling', 'Fielding', 'Fitness', 'Discipline'];
export const SKILL_COUNT = 5;

export interface Student {
  id: string; name: string; bornOn: string | null; batch: string | null; guardianName: string; guardianEmail: string | null; guardianPhone: string | null;
  linked: boolean; selfLinked: boolean; photoConsent: boolean; videoConsent: boolean; notes: string | null; status: 'active' | 'left'; joinedOn: string;
}
interface StudentRow { id: string; owner_id: string; name: string; born_on: string | null; batch: string | null; guardian_name: string; guardian_email: string | null; guardian_phone: string | null; guardian_user_id: string | null; student_user_id: string | null; photo_consent: number; video_consent: number; notes: string | null; status: 'active' | 'left'; joined_on: string }

const toStudent = (r: StudentRow): Student => ({
  id: r.id, name: r.name, bornOn: r.born_on, batch: r.batch, guardianName: r.guardian_name, guardianEmail: r.guardian_email, guardianPhone: r.guardian_phone,
  linked: !!r.guardian_user_id, selfLinked: !!r.student_user_id, photoConsent: !!r.photo_consent, videoConsent: !!r.video_consent, notes: r.notes, status: r.status, joinedOn: r.joined_on,
});

function mine(ownerId: string, id: string): StudentRow {
  const r = one<StudentRow>('SELECT * FROM academy_students WHERE id = ? AND owner_id = ?', id, ownerId);
  if (!r) throw notFound('Student not found');
  return r;
}

// ---- skills (five, named by the owner) ----

export function getSkills(ownerId: string): string[] {
  const rows = many<{ name: string }>('SELECT name FROM academy_skills WHERE owner_id = ? ORDER BY position', ownerId);
  return rows.length === SKILL_COUNT ? rows.map((r) => r.name) : [...DEFAULT_SKILLS];
}
export function setSkills(actor: Actor, ownerId: string, src: unknown): string[] {
  const v = new Validator(src);
  const arr = v.strArray('skills', { max: SKILL_COUNT, itemMax: 30 });
  if (!arr || arr.length !== SKILL_COUNT) v.fail('skills', `Give exactly ${SKILL_COUNT} skill names`);
  else if (arr.some((s) => s.trim().length < 2) || new Set(arr.map((s) => s.trim().toLowerCase())).size !== SKILL_COUNT) v.fail('skills', 'Each name needs at least 2 characters and they must all be different');
  v.done();
  const names = arr!.map((s) => s.trim());
  tx(() => {
    run('DELETE FROM academy_skills WHERE owner_id = ?', ownerId);
    names.forEach((n, i) => run('INSERT INTO academy_skills(owner_id, position, name) VALUES(?,?,?)', ownerId, i, n));
  });
  audit(actor, 'academy.skills', 'academy', ownerId, { names }, ownerId);
  return names;
}

// ---- students ----

function parseStudent(src: unknown, isNew: boolean) {
  const v = new Validator(src);
  const name = v.str('name', { required: isNew, min: 2, max: 80 });
  const bornOn = v.date('bornOn');
  const batch = v.str('batch', { max: 40 });
  const guardianName = v.str('guardianName', { required: isNew, min: 2, max: 80 });
  const guardianEmail = v.email('guardianEmail');
  const guardianPhone = v.phone('guardianPhone');
  const photoConsent = v.bool('photoConsent');
  const videoConsent = v.bool('videoConsent');
  const notes = v.str('notes', { max: 1000 });
  const status = v.oneOf('status', ['active', 'left'] as const);
  const joinedOn = v.date('joinedOn');
  v.done();
  return { name, bornOn, batch, guardianName, guardianEmail: guardianEmail?.toLowerCase(), guardianPhone, photoConsent, videoConsent, notes, status, joinedOn, has: (k: string) => v.has(k) };
}

export function createStudent(actor: Actor, ownerId: string, src: unknown): Student {
  const p = parseStudent(src, true);
  const id = newId('stu');
  run(`INSERT INTO academy_students(id, owner_id, name, born_on, batch, guardian_name, guardian_email, guardian_phone, photo_consent, video_consent, notes, status, joined_on, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, ownerId, p.name!, p.bornOn ?? null, p.batch ?? null, p.guardianName!, p.guardianEmail ?? null, p.guardianPhone ?? null, p.photoConsent ? 1 : 0, p.videoConsent ? 1 : 0, p.notes ?? null, p.status ?? 'active', p.joinedOn ?? istDate(now()), now(), now());
  audit(actor, 'academy.student_create', 'academy_student', id, { name: p.name }, ownerId);
  return toStudent(mine(ownerId, id));
}

export function updateStudent(actor: Actor, ownerId: string, id: string, src: unknown): Student {
  const cur = mine(ownerId, id);
  const p = parseStudent(src, false);
  // Changing the guardian's email breaks the link: the new person has not been confirmed by staff.
  const emailChanged = p.guardianEmail !== undefined && p.guardianEmail !== (cur.guardian_email ?? undefined);
  run(`UPDATE academy_students SET name=?, born_on=?, batch=?, guardian_name=?, guardian_email=?, guardian_phone=?, guardian_user_id=?, photo_consent=?, video_consent=?, notes=?, status=?, joined_on=?, updated_at=? WHERE id=?`,
    p.name ?? cur.name, p.has('bornOn') ? (p.bornOn ?? null) : cur.born_on, p.has('batch') ? (p.batch ?? null) : cur.batch, p.guardianName ?? cur.guardian_name,
    p.has('guardianEmail') ? (p.guardianEmail ?? null) : cur.guardian_email, p.has('guardianPhone') ? (p.guardianPhone ?? null) : cur.guardian_phone,
    emailChanged ? null : cur.guardian_user_id, p.photoConsent === undefined ? cur.photo_consent : p.photoConsent ? 1 : 0, p.videoConsent === undefined ? cur.video_consent : p.videoConsent ? 1 : 0,
    p.has('notes') ? (p.notes ?? null) : cur.notes, p.status ?? cur.status, p.joinedOn ?? cur.joined_on, now(), id);
  audit(actor, 'academy.student_update', 'academy_student', id, { fields: Object.keys(src as object), unlinked: emailChanged && !!cur.guardian_user_id }, ownerId);
  return toStudent(mine(ownerId, id));
}

export function listStudents(ownerId: string, opts: { status?: string; batch?: string; q?: string }): Student[] {
  const where = ['owner_id = ?']; const p: (string | number)[] = [ownerId];
  if (opts.status === 'active' || opts.status === 'left') { where.push('status = ?'); p.push(opts.status); }
  if (opts.batch) { where.push('batch = ?'); p.push(opts.batch); }
  if (opts.q) { where.push("lower(name) LIKE ? ESCAPE '\\'"); p.push(`%${opts.q.toLowerCase().replace(/[%_\\]/g, '\\$&')}%`); }
  return many<StudentRow>(`SELECT * FROM academy_students WHERE ${where.join(' AND ')} ORDER BY name`, ...p).map(toStudent);
}
export const getStudent = (ownerId: string, id: string): Student => toStudent(mine(ownerId, id));

/** Staff confirm which customer account is this child's parent. The account must exist and (when the child has a guardian email) use that email. */
export function linkGuardian(actor: Actor, ownerId: string, id: string, email: unknown): Student {
  const s = mine(ownerId, id);
  const v = new Validator({ email }); const e = v.email('email', true); v.done();
  const u = one<{ id: string; role: string }>("SELECT id, role FROM users WHERE lower(email) = ? AND active = 1", e!.toLowerCase());
  if (!u || u.role !== 'customer') throw new HttpError(404, 'NO_ACCOUNT', 'No parent account with that email yet. Ask the parent to create an account on the website first.');
  run('UPDATE academy_students SET guardian_user_id = ?, guardian_email = ?, updated_at = ? WHERE id = ?', u.id, e!.toLowerCase(), now(), id);
  audit(actor, 'academy.guardian_link', 'academy_student', id, { guardian: u.id }, ownerId);
  return toStudent(mine(ownerId, s.id));
}
export function unlinkGuardian(actor: Actor, ownerId: string, id: string): Student {
  mine(ownerId, id);
  run('UPDATE academy_students SET guardian_user_id = NULL, updated_at = ? WHERE id = ?', now(), id);
  audit(actor, 'academy.guardian_unlink', 'academy_student', id, {}, ownerId);
  return toStudent(mine(ownerId, id));
}

/** Full years between a birth date and a day, both YYYY-MM-DD. */
export function ageOn(bornOn: string, day: string): number {
  let a = Number(day.slice(0, 4)) - Number(bornOn.slice(0, 4));
  if (day.slice(5) < bornOn.slice(5)) a--;
  return a;
}

/** Staff give a student of 16 or over a login of their own, which opens the same dashboard and the same progress cards. */
export function linkStudentSelf(actor: Actor, ownerId: string, id: string, email: unknown): Student {
  const s = mine(ownerId, id);
  if (!s.born_on) throw new HttpError(422, 'NEEDS_BIRTH_DATE', `Add ${s.name}'s date of birth first. A student can have their own login from the age of ${OWN_LOGIN_AGE}.`);
  if (ageOn(s.born_on, istDate(now())) < OWN_LOGIN_AGE) throw new HttpError(422, 'TOO_YOUNG', `${s.name} is under ${OWN_LOGIN_AGE}. Younger students are seen through a parent's account.`);
  const v = new Validator({ email }); const e = v.email('email', true); v.done();
  const u = one<{ id: string; role: string }>("SELECT id, role FROM users WHERE lower(email) = ? AND active = 1", e!.toLowerCase());
  if (!u || u.role !== 'customer') throw new HttpError(404, 'NO_ACCOUNT', 'No account with that email yet. Ask the student to create an account on the website first.');
  run('UPDATE academy_students SET student_user_id = ?, updated_at = ? WHERE id = ?', u.id, now(), id);
  audit(actor, 'academy.student_link', 'academy_student', id, { user: u.id }, ownerId);
  return toStudent(mine(ownerId, id));
}
export function unlinkStudentSelf(actor: Actor, ownerId: string, id: string): Student {
  mine(ownerId, id);
  run('UPDATE academy_students SET student_user_id = NULL, updated_at = ? WHERE id = ?', now(), id);
  audit(actor, 'academy.student_unlink', 'academy_student', id, {}, ownerId);
  return toStudent(mine(ownerId, id));
}

// ---- attendance ----

export function markAttendance(actor: Actor, ownerId: string, src: unknown): { date: string; saved: number } {
  const v = new Validator(src);
  const date = v.date('date', true);
  const marks = (src as { marks?: unknown })?.marks;
  if (!Array.isArray(marks) || marks.length < 1 || marks.length > 300) v.fail('marks', 'Send 1 to 300 marks');
  v.done();
  const today = istDate(now());
  if (date! > today) throw new HttpError(400, 'FUTURE_DATE', 'Attendance cannot be marked for a future day');
  let saved = 0;
  tx(() => {
    for (const m of marks as { studentId?: unknown; present?: unknown; note?: unknown }[]) {
      if (typeof m?.studentId !== 'string' || typeof m.present !== 'boolean') throw new HttpError(400, 'VALIDATION_FAILED', 'Each mark needs studentId and present (true or false)');
      mine(ownerId, m.studentId);
      const note = typeof m.note === 'string' ? m.note.slice(0, 200) : null;
      run(`INSERT INTO academy_attendance(student_id, date, present, note, marked_by, marked_at) VALUES(?,?,?,?,?,?)
           ON CONFLICT(student_id, date) DO UPDATE SET present = excluded.present, note = excluded.note, marked_by = excluded.marked_by, marked_at = excluded.marked_at`,
        m.studentId, date!, m.present ? 1 : 0, note, actor.id, now());
      saved++;
    }
  });
  audit(actor, 'academy.attendance', 'academy', ownerId, { date, saved }, ownerId);
  return { date: date!, saved };
}

export function attendanceFor(ownerId: string, date: string): { studentId: string; name: string; present: boolean | null; note: string | null }[] {
  if (!isValidDate(date)) throw new HttpError(400, 'VALIDATION_FAILED', 'date must look like 2026-10-15');
  return many<{ id: string; name: string; present: number | null; note: string | null }>(
    `SELECT s.id, s.name, a.present, a.note FROM academy_students s LEFT JOIN academy_attendance a ON a.student_id = s.id AND a.date = ?
     WHERE s.owner_id = ? AND s.status = 'active' ORDER BY s.name`, date, ownerId)
    .map((r) => ({ studentId: r.id, name: r.name, present: r.present === null ? null : !!r.present, note: r.note }));
}

export function attendanceSummary(studentId: string, month?: string): { sessions: number; present: number; percent: number | null } {
  const like = month ? `${month}-%` : '%';
  const r = one<{ n: number; p: number | null }>('SELECT COUNT(*) n, SUM(present) p FROM academy_attendance WHERE student_id = ? AND date LIKE ?', studentId, like)!;
  const present = r.p ?? 0;
  return { sessions: r.n, present, percent: r.n ? Math.round((present / r.n) * 100) : null };
}

// ---- progress cards ----

export interface ProgressCard { id: string; studentId: string; month: string; ratings: { skill: string; rating: number }[]; comment: string | null; published: boolean; publishedAt: number | null; attendance: { sessions: number; present: number; percent: number | null } }
interface ProgressRow { id: string; student_id: string; month: string; ratings: string; comment: string | null; published: number; published_at: number | null }

const toCard = (r: ProgressRow): ProgressCard => ({
  id: r.id, studentId: r.student_id, month: r.month,
  ratings: Object.entries(JSON.parse(r.ratings) as Record<string, number>).map(([skill, rating]) => ({ skill, rating })),
  comment: r.comment, published: !!r.published, publishedAt: r.published_at, attendance: attendanceSummary(r.student_id, r.month),
});

export function saveProgress(actor: Actor, ownerId: string, studentId: string, month: string, src: unknown): ProgressCard {
  mine(ownerId, studentId);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError(400, 'VALIDATION_FAILED', 'month must look like 2026-10');
  const v = new Validator(src);
  const comment = v.str('comment', { max: 1500 });
  const ratingsIn = (src as { ratings?: unknown })?.ratings;
  const skills = getSkills(ownerId);
  const ratings: Record<string, number> = {};
  if (!ratingsIn || typeof ratingsIn !== 'object' || Array.isArray(ratingsIn)) v.fail('ratings', 'Send a rating for each skill');
  else {
    for (const s of skills) {
      const x = (ratingsIn as Record<string, unknown>)[s];
      if (!Number.isInteger(x) || (x as number) < 1 || (x as number) > 5) v.fail(`ratings.${s}`, 'A whole number from 1 to 5');
      else ratings[s] = x as number;
    }
    for (const k of Object.keys(ratingsIn)) if (!skills.includes(k)) v.fail(`ratings.${k}`, 'Not one of the academy skills');
  }
  v.done();
  const existing = one<ProgressRow>('SELECT * FROM academy_progress WHERE student_id = ? AND month = ?', studentId, month);
  if (existing) run('UPDATE academy_progress SET ratings = ?, comment = ?, updated_at = ?, created_by = ? WHERE id = ?', JSON.stringify(ratings), comment ?? null, now(), actor.id, existing.id);
  else run('INSERT INTO academy_progress(id, student_id, month, ratings, comment, created_by, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)', newId('apr'), studentId, month, JSON.stringify(ratings), comment ?? null, actor.id, now(), now());
  audit(actor, 'academy.progress_save', 'academy_student', studentId, { month }, ownerId);
  return toCard(one<ProgressRow>('SELECT * FROM academy_progress WHERE student_id = ? AND month = ?', studentId, month)!);
}

export function setPublished(actor: Actor, ownerId: string, studentId: string, month: string, published: unknown): ProgressCard {
  mine(ownerId, studentId);
  if (typeof published !== 'boolean') throw new HttpError(400, 'VALIDATION_FAILED', 'published must be true or false', { fields: [{ field: 'published', message: 'true or false' }] });
  const r = one<ProgressRow>('SELECT * FROM academy_progress WHERE student_id = ? AND month = ?', studentId, month);
  if (!r) throw notFound('No progress card for that month yet');
  run('UPDATE academy_progress SET published = ?, published_at = ? WHERE id = ?', published ? 1 : 0, published ? now() : null, r.id);
  audit(actor, published ? 'academy.progress_publish' : 'academy.progress_unpublish', 'academy_student', studentId, { month }, ownerId);
  return toCard(one<ProgressRow>('SELECT * FROM academy_progress WHERE id = ?', r.id)!);
}

export function listProgress(ownerId: string, studentId: string): ProgressCard[] {
  mine(ownerId, studentId);
  return many<ProgressRow>('SELECT * FROM academy_progress WHERE student_id = ? ORDER BY month DESC', studentId).map(toCard);
}

// ---- the parent's view ----

export interface Child { relation: 'parent' | 'self'; id: string; name: string; batch: string | null; academy: string; skills: string[]; attendance: { sessions: number; present: number; percent: number | null }; cards: ProgressCard[] }

/** Only children staff have linked to this account, only published cards, and nothing about other students. */
export function childrenOf(userId: string): Child[] {
  const rows = many<StudentRow>("SELECT * FROM academy_students WHERE (guardian_user_id = ? OR student_user_id = ?) AND status = 'active' ORDER BY name", userId, userId);
  return rows.map((r) => ({
    relation: r.guardian_user_id === userId ? 'parent' as const : 'self' as const,
    id: r.id, name: r.name, batch: r.batch, academy: userRow(r.owner_id)?.business_name ?? 'Academy', skills: getSkills(r.owner_id),
    attendance: attendanceSummary(r.id),
    cards: many<ProgressRow>('SELECT * FROM academy_progress WHERE student_id = ? AND published = 1 ORDER BY month DESC', r.id).map(toCard),
  }));
}
