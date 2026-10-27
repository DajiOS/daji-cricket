import { many, one, run, tx, registerSchema } from './db.ts';
import { now } from './clock.ts';
import { HttpError } from './errors.ts';
import { audit, type Actor } from './audit.ts';
import { MIN } from './time.ts';

// Which grounds include which. Decided by the owner (27 Oct 2026): booking a whole ground blocks the nets and pitches included in it, and booking one of those blocks the whole ground
// for the same time. A net that really can run on its own is configured as non-conflicting. Two nets inside the same ground do not block each other. This is configuration: no code
// guesses it, and Guppi never decides it: Guppi asks the same options and hold commands as every other client and those consult this one function.
//
// The conflict is checked where a slot is taken (hold.ts takeSlots, the final guard) and wherever availability is shown or offered, always through `linkedBusy` below.

registerSchema('ground-links-1', `
CREATE TABLE ground_links (
  parent_id TEXT NOT NULL REFERENCES grounds(id),
  child_id TEXT NOT NULL REFERENCES grounds(id),
  conflicts INTEGER NOT NULL DEFAULT 1 CHECK (conflicts IN (0,1)),
  created_at INTEGER NOT NULL, created_by TEXT,
  PRIMARY KEY (parent_id, child_id),
  CHECK (parent_id <> child_id)
);
CREATE INDEX ix_ground_links_child ON ground_links(child_id);
`);

export interface GroundLink { parentId: string; childId: string; conflicts: boolean }

export function linksOf(parentId: string): GroundLink[] {
  return many<{ parent_id: string; child_id: string; conflicts: number }>('SELECT parent_id, child_id, conflicts FROM ground_links WHERE parent_id = ? ORDER BY child_id', parentId)
    .map((r) => ({ parentId: r.parent_id, childId: r.child_id, conflicts: r.conflicts === 1 }));
}

/** The grounds whose bookings take this ground's time: its included resources (when this is the whole ground) and the whole ground it is included in (when this is a net or pitch). */
export function conflictingGrounds(groundId: string): { id: string; name: string; slotMinutes: number }[] {
  return many<{ id: string; name: string; slot_minutes: number }>(
    `SELECT g.id, g.name, g.slot_minutes FROM ground_links l JOIN grounds g ON g.id = l.child_id WHERE l.parent_id = ? AND l.conflicts = 1
     UNION SELECT g.id, g.name, g.slot_minutes FROM ground_links l JOIN grounds g ON g.id = l.parent_id WHERE l.child_id = ? AND l.conflicts = 1`, groundId, groundId)
    .map((r) => ({ id: r.id, name: r.name, slotMinutes: r.slot_minutes }));
}

/**
 * Of these candidate slot starts on `ground`, the ones that overlap a held or confirmed booking on a conflicting ground, with the name of the ground that holds them.
 * `exceptBookingId` leaves out a booking's own slots (a move onto time it already owns).
 */
export function linkedBusy(ground: { id: string; slot_minutes: number }, starts: number[], exceptBookingId?: string): Map<number, string> {
  const out = new Map<number, string>();
  if (!starts.length) return out;
  const others = conflictingGrounds(ground.id);
  if (!others.length) return out;
  const lo = Math.min(...starts), hi = Math.max(...starts) + ground.slot_minutes * MIN;
  for (const o of others) {
    const rows = many<{ slot_start: number }>(
      "SELECT slot_start FROM booking_slots WHERE ground_id = ? AND kind = 'booking' AND slot_start > ? AND slot_start < ? AND (? IS NULL OR booking_id <> ?)",
      o.id, lo - o.slotMinutes * MIN, hi, exceptBookingId ?? null, exceptBookingId ?? null);
    for (const r of rows) {
      const a = r.slot_start, b = a + o.slotMinutes * MIN;
      for (const s of starts) if (s < b && s + ground.slot_minutes * MIN > a && !out.has(s)) out.set(s, o.name);
    }
  }
  return out;
}

/** Replaces what a ground includes. Each included resource is on the same owner's side, and a resource is included in at most one whole ground. */
export function setLinks(actor: Actor, parent: { id: string; owner_id: string }, items: { groundId: string; conflicts: boolean }[]): GroundLink[] {
  return tx(() => {
    const seen = new Set<string>();
    for (const it of items) {
      if (it.groundId === parent.id) throw new HttpError(400, 'VALIDATION_FAILED', 'A ground cannot include itself');
      if (seen.has(it.groundId)) throw new HttpError(400, 'VALIDATION_FAILED', 'A resource is listed twice');
      seen.add(it.groundId);
      const g = one<{ id: string; owner_id: string }>('SELECT id, owner_id FROM grounds WHERE id = ?', it.groundId);
      if (!g || g.owner_id !== parent.owner_id) throw new HttpError(404, 'NOT_FOUND', 'An included resource was not found');
      const up = one<{ parent_id: string }>('SELECT parent_id FROM ground_links WHERE child_id = ? AND parent_id <> ?', it.groundId, parent.id);
      if (up) throw new HttpError(409, 'ALREADY_INCLUDED', 'That resource is already included in another ground');
      if (one('SELECT 1 FROM ground_links WHERE parent_id = ?', it.groundId)) throw new HttpError(409, 'NESTED_NOT_SUPPORTED', 'A resource that includes others cannot itself be included (one level only)');
    }
    if (one('SELECT 1 FROM ground_links WHERE child_id = ?', parent.id)) throw new HttpError(409, 'NESTED_NOT_SUPPORTED', 'A resource that is included in another ground cannot include others (one level only)');
    const before = linksOf(parent.id);
    run('DELETE FROM ground_links WHERE parent_id = ?', parent.id);
    for (const it of items) run('INSERT INTO ground_links(parent_id, child_id, conflicts, created_at, created_by) VALUES(?,?,?,?,?)', parent.id, it.groundId, it.conflicts ? 1 : 0, now(), actor.id);
    const after = linksOf(parent.id);
    audit(actor, 'ground.links', 'ground', parent.id, { before, after }, parent.owner_id);
    return after;
  });
}
