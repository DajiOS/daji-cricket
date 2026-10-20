import { many, one, registerSchema, run } from './db.ts';
import { now } from './clock.ts';
import { audit, type Actor } from './audit.ts';
import { notFound } from './errors.ts';
import { newId } from './ids.ts';
import { Validator } from './input.ts';

// The ground-and-nets status board: every ground, net, pitch and piece of kit with a plain status, and where it sits on the layout.

registerSchema('spots-1', `
CREATE TABLE ground_spots (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  ground_id TEXT REFERENCES grounds(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'net',
  status TEXT NOT NULL DEFAULT 'ready',
  note TEXT,
  x INTEGER NOT NULL DEFAULT 50,
  y INTEGER NOT NULL DEFAULT 50,
  status_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  deleted_at INTEGER,
  deleted_by TEXT
);
CREATE INDEX ix_ground_spots_owner ON ground_spots(owner_id);
`);

export const SPOT_STATUSES = ['ready', 'attention', 'out_of_order', 'maintenance'] as const;
export const SPOT_KINDS = ['ground', 'net', 'pitch', 'equipment', 'other'] as const;
export type SpotStatus = (typeof SPOT_STATUSES)[number];

interface Row { id: string; ground_id: string | null; name: string; kind: string; status: string; note: string | null; x: number; y: number; status_at: number; ground_name?: string | null }
export interface SpotOut { id: string; groundId: string | null; name: string; kind: string; status: SpotStatus; note: string; x: number; y: number; statusAt: number }
const out = (r: Row): SpotOut => ({ id: r.id, groundId: r.ground_id, name: r.name, kind: r.kind, status: r.status as SpotStatus, note: r.note ?? '', x: r.x, y: r.y, statusAt: r.status_at });

/** The owner's spots. Each active ground gets its own spot the first time the board opens, so the board is never empty. */
export function listSpots(ownerId: string): { items: SpotOut[]; counts: Record<SpotStatus, number> } {
  const grounds = many<{ id: string; name: string }>('SELECT id, name FROM grounds WHERE owner_id = ? AND active = 1 ORDER BY created_at, name', ownerId);
  const have = new Set(many<{ ground_id: string }>('SELECT ground_id FROM ground_spots WHERE owner_id = ? AND ground_id IS NOT NULL AND deleted_at IS NULL', ownerId).map((r) => r.ground_id));
  const t = now();
  grounds.filter((g) => !have.has(g.id)).forEach((g, i) => {
    run('INSERT INTO ground_spots(id, owner_id, ground_id, name, kind, status, x, y, status_at, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      newId('spt'), ownerId, g.id, g.name, 'ground', 'ready', 30 + (i % 2) * 40, 30 + Math.floor(i / 2) * 30, t, t, t);
  });
  const items = many<Row>('SELECT * FROM ground_spots WHERE owner_id = ? AND deleted_at IS NULL ORDER BY created_at, name', ownerId).map(out);
  const counts = Object.fromEntries(SPOT_STATUSES.map((s) => [s, items.filter((i) => i.status === s).length])) as Record<SpotStatus, number>;
  return { items, counts };
}
function spotOr404(ownerId: string, id: string): Row {
  const r = one<Row>('SELECT * FROM ground_spots WHERE id = ? AND owner_id = ? AND deleted_at IS NULL', id, ownerId);
  if (!r) throw notFound('Spot not found');
  return r;
}
function input(body: unknown, partial: boolean) {
  const v = new Validator(body);
  const o = {
    name: v.str('name', { required: !partial, min: 1, max: 60 }),
    kind: v.oneOf('kind', SPOT_KINDS),
    status: v.oneOf('status', SPOT_STATUSES),
    note: v.str('note', { max: 300 }),
    x: v.int('x', { min: 0, max: 100 }),
    y: v.int('y', { min: 0, max: 100 }),
  };
  v.done();
  return o;
}
export function createSpot(ownerId: string, actor: Actor, body: unknown): SpotOut {
  const o = input(body, false);
  const id = newId('spt'), t = now();
  run('INSERT INTO ground_spots(id, owner_id, name, kind, status, note, x, y, status_at, created_at, created_by, updated_at, updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
    id, ownerId, o.name!, o.kind ?? 'net', o.status ?? 'ready', o.note ?? null, o.x ?? 50, o.y ?? 50, t, t, actor.id, t, actor.id);
  audit(actor, 'spot.create', 'ground_spot', id, { name: o.name, kind: o.kind, status: o.status }, ownerId);
  return out(spotOr404(ownerId, id));
}
export function updateSpot(ownerId: string, actor: Actor, id: string, body: unknown): SpotOut {
  const cur = spotOr404(ownerId, id);
  const o = input(body, true);
  const status = o.status ?? cur.status;
  run('UPDATE ground_spots SET name = ?, kind = ?, status = ?, note = ?, x = ?, y = ?, status_at = ?, updated_at = ?, updated_by = ? WHERE id = ?',
    o.name ?? cur.name, o.kind ?? cur.kind, status, o.note !== undefined ? o.note : cur.note, o.x ?? cur.x, o.y ?? cur.y, status !== cur.status ? now() : cur.status_at, now(), actor.id, id);
  // a move on the layout is not worth an audit line; a status or name change is
  if (o.status !== undefined || o.name !== undefined || o.note !== undefined || o.kind !== undefined) audit(actor, 'spot.update', 'ground_spot', id, { name: cur.name, from: cur.status, ...body as object }, ownerId);
  return out(spotOr404(ownerId, id));
}
export function deleteSpot(ownerId: string, actor: Actor, id: string): void {
  spotOr404(ownerId, id);
  run('UPDATE ground_spots SET deleted_at = ?, deleted_by = ? WHERE id = ?', now(), actor.id, id);
  audit(actor, 'spot.delete', 'ground_spot', id, null, ownerId);
}
