import type { Ctx } from '../http.ts';
import { pageParams } from '../input.ts';
import { HttpError } from '../errors.ts';
import { scopeOwnerId, type UserRow } from '../auth.ts';
import { getGroundOr404, type GroundRow } from '../grounds.ts';

export function U(c: Ctx): UserRow {
  if (!c.user) throw new HttpError(401, 'UNAUTHENTICATED', 'Please sign in');
  return c.user;
}
export const page = (c: Ctx, dflt = 25) => pageParams(c.query, dflt);

/** The owner whose data this request is about: own for owner/staff, `?ownerId=` (or all) for the super admin. */
export function ownerFilter(c: Ctx): string | null {
  const u = U(c);
  if (u.role === 'super_admin') return c.query.get('ownerId') || null;
  return scopeOwnerId(u);
}

/** A ground the user may manage; anything outside their scope answers 404. */
export function groundInScope(u: UserRow, id: string): GroundRow {
  const g = getGroundOr404(id);
  if (u.role !== 'super_admin' && scopeOwnerId(u) !== g.owner_id) throw new HttpError(404, 'NOT_FOUND', 'Ground not found');
  return g;
}

export function optionalBool(c: Ctx, name: string): boolean | undefined {
  const v = c.query.get(name);
  if (v === null) return undefined;
  return v === '1' || v === 'true';
}

/** The owner a staff-side request is about. The super admin has to say which one with `?ownerId=`. */
export function ownerOrFail(c: Ctx, what: string): string {
  const o = ownerFilter(c);
  if (!o) throw new HttpError(400, 'OWNER_REQUIRED', `Pass ?ownerId= to ${what} for one owner`);
  return o;
}
