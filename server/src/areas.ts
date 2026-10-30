import { many, one, registerSchema, run, tx } from './db.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { HttpError, notFound } from './errors.ts';
import { audit, type Actor } from './audit.ts';
import { Validator } from './input.ts';
import { permissionList, userRow, type UserRow } from './auth.ts';
import { STAFF_PERMISSIONS, type StaffPermission } from '@daji/shared';

// Areas inside one business (owner, 30 Oct 2026): Portfolio -> Business -> Area -> Project. A business keeps its own books, customers,
// staff and branding (owner_id, as everywhere else). An area is a part of that one business, such as the Office, the House, Personal
// and Loans of "Sunny's Portfolio"; on screen an area is called a branch. An area never crosses businesses, so nothing here can mix
// two businesses' books.
//
// Who sees which area: the owner sees every area of their business. A team member sees every area that is not restricted, unless
// the owner has limited them to a list of areas (area_access); a restricted area (Personal, Loans) is seen only by people the
// owner names in that list. Anything in an area someone may not see answers 404, so its existence is not given away.
//
// A team member can also work in another business (team_memberships): the owner of that business adds them with the permissions
// they have there. While they work in it (the X-Daji-Business header, as a portfolio owner switches), every request is answered as
// that business's team member, so the same owner_id checks keep the two businesses apart. Their own sign-in, profile and audit
// entries stay theirs. A business with no areas, and a team member with no other business, work exactly as before.
registerSchema('areas-1', `
CREATE TABLE areas (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  restricted INTEGER NOT NULL DEFAULT 0,
  archived_at INTEGER,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);
CREATE UNIQUE INDEX uq_areas_name ON areas(owner_id, lower(name)) WHERE archived_at IS NULL;
CREATE INDEX ix_areas_owner ON areas(owner_id);

CREATE TABLE area_access (
  user_id TEXT NOT NULL REFERENCES users(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  area_ids TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (user_id, owner_id)
);

CREATE TABLE team_memberships (
  user_id TEXT NOT NULL REFERENCES users(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  permissions TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  added_by TEXT,
  removed_at INTEGER,
  removed_by TEXT,
  PRIMARY KEY (user_id, owner_id)
);
CREATE INDEX ix_team_memberships_owner ON team_memberships(owner_id);
`);

export const MAX_AREAS = 50;

interface AreaRow { id: string; owner_id: string; name: string; restricted: number; archived_at: number | null; created_at: number }
export interface Area { id: string; name: string; restricted: boolean; archived: boolean }
const toArea = (r: AreaRow): Area => ({ id: r.id, name: r.name, restricted: !!r.restricted, archived: r.archived_at !== null });

/** The business a request works in: the owner's own id, a team member's employer (or the business they switched to). */
const businessOf = (u: UserRow): string | null => (u.role === 'owner' ? u.id : u.role === 'staff' ? u.owner_id : null);
const seesAll = (u: UserRow, ownerId: string): boolean => u.role === 'super_admin' || (u.role === 'owner' && u.id === ownerId);

function limitOf(userId: string, ownerId: string): string[] | null {
  const r = one<{ area_ids: string }>('SELECT area_ids FROM area_access WHERE user_id = ? AND owner_id = ?', userId, ownerId);
  if (!r) return null;
  try { const v: unknown = JSON.parse(r.area_ids); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; } catch { return []; }
}

/**
 * The areas of this business this person may see, as ids; null means "all of them" (the owner, the super admin). A team member with
 * no limit sees every area that is not restricted.
 */
export function visibleAreaIds(u: UserRow, ownerId: string): string[] | null {
  if (seesAll(u, ownerId)) return null;
  if (u.role !== 'staff' || u.owner_id !== ownerId) return [];
  const limit = limitOf(u.id, ownerId);
  const rows = many<{ id: string; restricted: number }>('SELECT id, restricted FROM areas WHERE owner_id = ?', ownerId);
  return rows.filter((a) => (limit ? limit.includes(a.id) : !a.restricted)).map((a) => a.id);
}

/** Whether this person may see a record in this area (a record with no area is seen as before). */
export function canSeeArea(u: UserRow, ownerId: string, areaId: string | null | undefined): boolean {
  if (!areaId) return true;
  const ids = visibleAreaIds(u, ownerId);
  return ids === null || ids.includes(areaId);
}

/**
 * An SQL condition (and its values) that keeps rows whose area column is empty or one this person may see. `col` is a column
 * name chosen in code, never from a request.
 */
export function areaFilter(u: UserRow, ownerId: string, col: string): { sql: string; params: string[] } {
  const ids = visibleAreaIds(u, ownerId);
  if (ids === null) return { sql: '1 = 1', params: [] };
  if (!ids.length) return { sql: `${col} IS NULL`, params: [] };
  return { sql: `(${col} IS NULL OR ${col} IN (${ids.map(() => '?').join(',')}))`, params: ids };
}

export function listAreas(u: UserRow, ownerId: string, includeArchived = false): { items: Area[] } {
  const ids = visibleAreaIds(u, ownerId);
  const rows = many<AreaRow>(`SELECT * FROM areas WHERE owner_id = ? ${includeArchived ? '' : 'AND archived_at IS NULL'} ORDER BY lower(name)`, ownerId);
  return { items: rows.filter((r) => ids === null || ids.includes(r.id)).map(toArea) };
}

/** An area of this business that this person may see; anything else is 404. */
export function areaOr404(u: UserRow, ownerId: string, id: string): AreaRow {
  const r = one<AreaRow>('SELECT * FROM areas WHERE id = ? AND owner_id = ?', id, ownerId);
  if (!r || !canSeeArea(u, ownerId, r.id)) throw notFound('Branch not found');
  return r;
}

/** Checks an area id sent with a record (a project, later an expense): it must be a live area of the same business that the person may see. */
export function checkAreaId(u: UserRow, ownerId: string, id: string | null | undefined, field = 'areaId'): void {
  if (!id) return;
  const r = one<AreaRow>('SELECT * FROM areas WHERE id = ? AND owner_id = ?', id, ownerId);
  if (!r || r.archived_at !== null || !canSeeArea(u, ownerId, r.id)) throw new HttpError(400, 'VALIDATION_FAILED', 'Unknown branch', { fields: [{ field, message: 'Unknown branch' }] });
}

const ownerOnly = (u: UserRow, ownerId: string): void => {
  if (!seesAll(u, ownerId)) throw new HttpError(403, 'FORBIDDEN', 'Only the business owner can set up branches and who sees them.');
};
const actor = (u: UserRow): Actor => ({ id: u.id, role: u.role });

export function createArea(u: UserRow, ownerId: string, body: unknown): Area {
  ownerOnly(u, ownerId);
  const v = new Validator(body);
  const name = v.str('name', { required: true, min: 2, max: 60 });
  const restricted = v.bool('restricted');
  v.done();
  const n = one<{ n: number }>('SELECT COUNT(*) n FROM areas WHERE owner_id = ? AND archived_at IS NULL', ownerId)!.n;
  if (n >= MAX_AREAS) throw new HttpError(409, 'TOO_MANY_AREAS', `A business can have at most ${MAX_AREAS} branches.`);
  if (one('SELECT 1 FROM areas WHERE owner_id = ? AND lower(name) = lower(?) AND archived_at IS NULL', ownerId, name!)) throw new HttpError(409, 'AREA_EXISTS', 'There is already a branch with that name.');
  const id = newId('area'), t = now();
  run('INSERT INTO areas(id, owner_id, name, restricted, created_at, created_by, updated_at, updated_by) VALUES(?,?,?,?,?,?,?,?)', id, ownerId, name!, restricted ? 1 : 0, t, u.id, t, u.id);
  audit(actor(u), 'area.create', 'area', id, { name, restricted: !!restricted }, ownerId);
  return toArea(one<AreaRow>('SELECT * FROM areas WHERE id = ?', id)!);
}

/** Renames, restricts or archives a branch. An archived branch keeps its records and history; it only stops taking new ones. */
export function updateArea(u: UserRow, ownerId: string, id: string, body: unknown): Area {
  ownerOnly(u, ownerId);
  const cur = areaOr404(u, ownerId, id);
  const v = new Validator(body);
  const name = v.str('name', { min: 2, max: 60 });
  const restricted = v.bool('restricted');
  const archived = v.bool('archived');
  v.done();
  const nextName = name ?? cur.name;
  const live = archived === undefined ? cur.archived_at === null : !archived;
  if (live && one('SELECT 1 FROM areas WHERE owner_id = ? AND lower(name) = lower(?) AND archived_at IS NULL AND id != ?', ownerId, nextName, id)) throw new HttpError(409, 'AREA_EXISTS', 'There is already a branch with that name.');
  const t = now();
  run('UPDATE areas SET name = ?, restricted = ?, archived_at = ?, updated_at = ?, updated_by = ? WHERE id = ?',
    nextName, restricted === undefined ? cur.restricted : restricted ? 1 : 0, live ? null : cur.archived_at ?? t, t, u.id, id);
  audit(actor(u), 'area.update', 'area', id, { name, restricted, archived }, ownerId);
  return toArea(one<AreaRow>('SELECT * FROM areas WHERE id = ?', id)!);
}

// ------------------------------------------------------------------ team members: their branches, and other businesses

/** A team member who works in this business: employed by it, or added to it from another business. */
export function worksIn(userId: string, ownerId: string): boolean {
  const s = userRow(userId);
  if (!s || s.role !== 'staff' || !s.active) return false;
  return s.owner_id === ownerId || !!one('SELECT 1 FROM team_memberships WHERE user_id = ? AND owner_id = ? AND removed_at IS NULL', userId, ownerId);
}

export interface AreaAccess { userId: string; all: boolean; areaIds: string[] }

export function getAreaAccess(u: UserRow, ownerId: string, userId: string): AreaAccess {
  ownerOnly(u, ownerId);
  if (!worksIn(userId, ownerId)) throw notFound('Team member not found');
  const limit = limitOf(userId, ownerId);
  return { userId, all: limit === null, areaIds: limit ?? [] };
}

/** Limits a team member to some branches (`areaIds`), or lifts the limit (`all: true`): they then see every branch that is not restricted. */
export function setAreaAccess(u: UserRow, ownerId: string, userId: string, body: unknown): AreaAccess {
  ownerOnly(u, ownerId);
  if (!worksIn(userId, ownerId)) throw notFound('Team member not found');
  const v = new Validator(body);
  const all = v.bool('all');
  const areaIds = v.strArray('areaIds', { max: MAX_AREAS, itemMax: 60 });
  if (!all && areaIds === undefined) v.fail('areaIds', 'Pick the branches, or send all: true');
  v.done();
  const ids = all ? null : [...new Set(areaIds!)];
  if (ids) for (const id of ids) if (!one('SELECT 1 FROM areas WHERE id = ? AND owner_id = ?', id, ownerId)) throw new HttpError(400, 'VALIDATION_FAILED', 'Unknown branch', { fields: [{ field: 'areaIds', message: 'Unknown branch' }] });
  tx(() => {
    if (ids === null) run('DELETE FROM area_access WHERE user_id = ? AND owner_id = ?', userId, ownerId);
    else run(`INSERT INTO area_access(user_id, owner_id, area_ids, updated_at, updated_by) VALUES(?,?,?,?,?)
              ON CONFLICT(user_id, owner_id) DO UPDATE SET area_ids = excluded.area_ids, updated_at = excluded.updated_at, updated_by = excluded.updated_by`, userId, ownerId, JSON.stringify(ids), now(), u.id);
    // the change applies from their next request; signing them out makes the desk reload what it shows
    run('UPDATE users SET token_version = token_version + 1 WHERE id = ?', userId);
  });
  audit(actor(u), 'area.access', 'user', userId, { all: ids === null, areaIds: ids }, ownerId);
  return getAreaAccess(u, ownerId, userId);
}

export interface Membership { userId: string; name: string; email: string | null; permissions: StaffPermission[]; homeBusiness: string; addedAt: number }

const cleanPerms = (raw: string): StaffPermission[] => permissionList(raw).filter((p): p is StaffPermission => (STAFF_PERMISSIONS as readonly string[]).includes(p));

/** The team members added to this business from another one. */
export function listMemberships(u: UserRow, ownerId: string, businessName: (id: string) => string): { items: Membership[] } {
  ownerOnly(u, ownerId);
  const rows = many<{ user_id: string; permissions: string; added_at: number }>('SELECT user_id, permissions, added_at FROM team_memberships WHERE owner_id = ? AND removed_at IS NULL ORDER BY added_at, rowid', ownerId);
  return {
    items: rows.flatMap((r) => {
      const s = userRow(r.user_id);
      return s ? [{ userId: s.id, name: s.name, email: s.email, permissions: cleanPerms(r.permissions), homeBusiness: s.owner_id ? businessName(s.owner_id) : '', addedAt: r.added_at }] : [];
    }),
  };
}

/**
 * Adds a team member of another business to this one, with the permissions they get here. Only for a person employed by a
 * business the signed-in owner holds themselves (their own, or one in their portfolio), so an owner can never reach into a
 * business that is not theirs to find people. `realUser` is the person signed in; `u` the business they are working in.
 */
export function addMembership(u: UserRow, realUser: UserRow, ownerId: string, body: unknown, holds: (realUser: UserRow, ownerId: string) => boolean): Membership {
  ownerOnly(u, ownerId);
  const v = new Validator(body);
  const email = v.email('email', true);
  const permissions = v.strArray('permissions', { max: STAFF_PERMISSIONS.length, itemMax: 40 }) ?? [];
  for (const p of permissions) if (!(STAFF_PERMISSIONS as readonly string[]).includes(p)) v.fail('permissions', `Unknown permission: ${p}`);
  v.done();
  const s = one<UserRow>("SELECT * FROM users WHERE lower(email) = lower(?) AND role = 'staff'", email!);
  if (!s || !s.active || !s.owner_id || !holds(realUser, s.owner_id)) throw new HttpError(404, 'NOT_FOUND', 'No team member with that email in a business you hold.');
  if (s.owner_id === ownerId) throw new HttpError(409, 'ALREADY_ON_TEAM', 'This person is already on this business\'s own team.');
  const t = now();
  run(`INSERT INTO team_memberships(user_id, owner_id, permissions, added_at, added_by) VALUES(?,?,?,?,?)
       ON CONFLICT(user_id, owner_id) DO UPDATE SET permissions = excluded.permissions, added_at = CASE WHEN removed_at IS NULL THEN added_at ELSE excluded.added_at END,
         added_by = CASE WHEN removed_at IS NULL THEN added_by ELSE excluded.added_by END, removed_at = NULL, removed_by = NULL`, s.id, ownerId, JSON.stringify(permissions), t, realUser.id);
  audit(actor(u), 'team.membership.add', 'user', s.id, { permissions }, ownerId);
  const r = one<{ added_at: number }>('SELECT added_at FROM team_memberships WHERE user_id = ? AND owner_id = ?', s.id, ownerId)!;
  return { userId: s.id, name: s.name, email: s.email, permissions: permissions as StaffPermission[], homeBusiness: '', addedAt: r.added_at };
}

export function updateMembership(u: UserRow, ownerId: string, userId: string, body: unknown): { userId: string; permissions: StaffPermission[] } {
  ownerOnly(u, ownerId);
  if (!one('SELECT 1 FROM team_memberships WHERE user_id = ? AND owner_id = ? AND removed_at IS NULL', userId, ownerId)) throw notFound('Team member not found');
  const v = new Validator(body);
  const permissions = v.strArray('permissions', { max: STAFF_PERMISSIONS.length, itemMax: 40 });
  if (permissions === undefined) v.fail('permissions', 'Required');
  for (const p of permissions ?? []) if (!(STAFF_PERMISSIONS as readonly string[]).includes(p)) v.fail('permissions', `Unknown permission: ${p}`);
  v.done();
  tx(() => {
    run('UPDATE team_memberships SET permissions = ? WHERE user_id = ? AND owner_id = ?', JSON.stringify(permissions), userId, ownerId);
    run('UPDATE users SET token_version = token_version + 1 WHERE id = ?', userId);
  });
  audit(actor(u), 'team.membership.update', 'user', userId, { permissions }, ownerId);
  return { userId, permissions: permissions as StaffPermission[] };
}

/** Takes the person off this business's team. From their next request they cannot open it; the row is kept as history. */
export function removeMembership(u: UserRow, ownerId: string, userId: string): { removed: boolean } {
  ownerOnly(u, ownerId);
  if (!one('SELECT 1 FROM team_memberships WHERE user_id = ? AND owner_id = ? AND removed_at IS NULL', userId, ownerId)) throw notFound('Team member not found');
  const ch = tx(() => {
    const c = run('UPDATE team_memberships SET removed_at = ?, removed_by = ? WHERE user_id = ? AND owner_id = ? AND removed_at IS NULL', now(), u.id, userId, ownerId);
    if (c.changes > 0) run('UPDATE users SET token_version = token_version + 1 WHERE id = ?', userId);
    return c.changes;
  });
  if (ch > 0) audit(actor(u), 'team.membership.remove', 'user', userId, null, ownerId);
  return { removed: ch > 0 };
}

/** The businesses a team member works in: their employer first, then the ones they were added to (only while both are switched on). */
export function businessesOfStaff(s: UserRow, businessName: (id: string) => string): { id: string; businessName: string; own: boolean; permissions: StaffPermission[] }[] {
  if (s.role !== 'staff' || !s.owner_id) return [];
  const rows = many<{ owner_id: string; permissions: string }>(`SELECT m.owner_id, m.permissions FROM team_memberships m JOIN users o ON o.id = m.owner_id
    WHERE m.user_id = ? AND m.removed_at IS NULL AND o.role = 'owner' AND o.active = 1 ORDER BY m.added_at, m.rowid`, s.id);
  return [{ id: s.owner_id, businessName: businessName(s.owner_id), own: true, permissions: cleanPerms(s.permissions) },
    ...rows.filter((r) => r.owner_id !== s.owner_id).map((r) => ({ id: r.owner_id, businessName: businessName(r.owner_id), own: false, permissions: cleanPerms(r.permissions) }))];
}

/**
 * A team member's request in another business they were added to: answered as a team member of that business, with the
 * permissions they have there. Refused (403) unless the membership is live and the business is switched on.
 */
export function staffSwitchTo(s: UserRow, ownerId: string): UserRow {
  const refuse = () => new HttpError(403, 'NOT_ON_TEAM', 'You are not on that business\'s team. Ask its owner to add you.');
  const m = one<{ permissions: string }>('SELECT permissions FROM team_memberships WHERE user_id = ? AND owner_id = ? AND removed_at IS NULL', s.id, ownerId);
  const o = userRow(ownerId);
  if (!m || !o || o.role !== 'owner' || !o.active) throw refuse();
  return { ...s, owner_id: ownerId, permissions: JSON.stringify(cleanPerms(m.permissions)) };
}

/** The business a request is about, for code that only has the user. */
export const requestBusiness = businessOf;
