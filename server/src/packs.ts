import { many, one, run, registerSchema } from './db.ts';
import { now } from './clock.ts';
import { HttpError, notFound } from './errors.ts';
import { audit } from './audit.ts';
import { addDays, istDate, isValidDate } from './time.ts';
import { DESIGN_BANDS, rotatingDesign, type Band, type DesignPace } from './design.ts';
import type { UserRow } from './auth.ts';

// Design packs: the website's designer themes come in a new set every quarter. Each pack is built in code (its colours,
// layouts, 3D scenes and background films live in the website) and switches on by itself on the first day of its quarter;
// the pack before it is then archived, its designs still there for anyone who picked one and for the owner's fixed choice.
// No approval is needed: a pack goes live on its date by itself. On the Website settings page the owner sees the live pack and the
// next one with their dates, and can, if they want to:
//   delay    - push a pack's start to a later day in its quarter (the pack before it stays on until then),
//   switch   - put any pack on now; the schedule takes over again when the next pack's day comes.
// A reminder shows from 30 days before the quarter ends when the next quarter's pack is not built yet.

export interface PackDef {
  id: string;
  name: string;
  /** One line on the pack's idea, shown in the desk. */
  note: string;
  /** First day of the quarter, YYYY-MM-DD. */
  from: string;
  /** The parts of the day and the designs in each; every design in the pack appears once. */
  bands: Band[];
}

export const PACKS: PackDef[] = [
  { id: '2026-q4', name: 'Opening season', from: '2026-10-01', bands: DESIGN_BANDS,
    note: 'The first ten designs: floodlit nights, Test whites, the pavilion, monsoon glass and T20 carbon.' },
  { id: '2027-q1', name: 'Winter season', from: '2027-01-01',
    note: 'Ten new designs for January to March: winter mist, the scorebook, sunrise nets, kite-season skies, stepwell terracotta, mango shade, golden hour, the scoreboard, winter nights and embers.',
    bands: [
      { from: 6, name: 'Morning', designs: ['mist', 'sunrise', 'scorebook'] },
      { from: 11, name: 'Afternoon', designs: ['azure', 'terracotta', 'mango'] },
      { from: 17, name: 'Evening', designs: ['dusk', 'scoreboard'] },
      { from: 20, name: 'Night', designs: ['aurora', 'ember'] },
    ] },
  { id: '2027-q2', name: 'Summer season', from: '2027-04-01',
    note: 'Ten new designs for April to June: kulfi mornings, summer camp nets, neem shade, the heatwave, ice gola, khus-cool afternoons, powerplay league nights, pre-monsoon skies, fireflies and jamun nights.',
    bands: [
      { from: 6, name: 'Morning', designs: ['kulfi', 'camp', 'neem'] },
      { from: 11, name: 'Afternoon', designs: ['heatwave', 'gola', 'khus'] },
      { from: 17, name: 'Evening', designs: ['powerplay', 'thunder'] },
      { from: 20, name: 'Night', designs: ['firefly', 'jamun'] },
    ] },
];

/** Every designer theme in any pack, live or archived. */
export const ALL_DESIGNS: string[] = [...new Set(PACKS.flatMap((p) => p.bands.flatMap((b) => b.designs)))];
/** What the owner can choose for the website: rotate, one design from any pack, Cricket green (the sports look with the booking
 *  bar), or the plain light or dark look. */
export const SITE_DESIGN_CHOICES: readonly string[] = ['rotate', ...ALL_DESIGNS, 'field', 'ivory', 'obsidian'];

registerSchema('design-packs-1', `CREATE TABLE design_packs (
  id TEXT PRIMARY KEY,
  approved_at INTEGER,
  approved_by TEXT,
  starts_on TEXT,
  pinned_at INTEGER,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);`);

interface Row { id: string; approved_at: number | null; approved_by: string | null; starts_on: string | null; pinned_at: number | null }
const rows = (): Map<string, Row> => new Map(many<Row>('SELECT * FROM design_packs').map((r) => [r.id, r]));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** The quarter after the one starting on this day (YYYY-MM-01). */
export function nextQuarter(from: string): string {
  const y = +from.slice(0, 4), m = +from.slice(5, 7) + 3;
  return m > 12 ? `${y + 1}-${String(m - 12).padStart(2, '0')}-01` : `${y}-${String(m).padStart(2, '0')}-01`;
}
/** The quarter a day falls in, as its first day. */
export const quarterOf = (date: string): string => `${date.slice(0, 4)}-${String(Math.floor((+date.slice(5, 7) - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
/** "Jan to Mar 2027" */
export function quarterLabel(from: string): string {
  const m = +from.slice(5, 7) - 1;
  return `${MONTHS[m]} to ${MONTHS[m + 2]} ${from.slice(0, 4)}`;
}

export type PackState = 'live' | 'upcoming' | 'archived';
export interface PackOut {
  id: string; name: string; note: string; quarter: string; from: string; to: string;
  /** The day it goes (or went) live: its quarter's first day, or the later day the owner delayed it to. */
  startsOn: string;
  delayed: boolean;
  state: PackState;
  /** Put on by the owner ahead of or after its turn. */
  switchedOn: boolean;
  approved: { at: number; by: string | null } | null;
  bands: { name: string; from: number; designs: string[] }[];
  designs: string[];
}

/** Which pack the schedule puts on for a day, before any switch by the owner. */
function scheduled(today: string, r: Map<string, Row>): PackDef {
  let live = PACKS[0]!;
  for (const p of sortedByStart(r)) if (startOf(p, r) <= today) live = p;
  return live;
}
const startOf = (p: PackDef, r: Map<string, Row>): string => r.get(p.id)?.starts_on || p.from;
const sortedByStart = (r: Map<string, Row>): PackDef[] => [...PACKS].sort((a, b) => startOf(a, r).localeCompare(startOf(b, r)));

/** The pack on the website at this moment: the owner's switch while it holds, else the schedule's. */
export function livePack(ms: number = now()): PackDef {
  const r = rows(), today = istDate(ms), sched = scheduled(today, r);
  const pinned = [...r.values()].filter((x) => x.pinned_at != null).sort((a, b) => b.pinned_at! - a.pinned_at!)[0];
  const p = pinned && PACKS.find((x) => x.id === pinned.id);
  // a switch lasts until another pack's day comes round after it was made
  if (p && !PACKS.some((x) => x.id !== p.id && startOf(x, r) > istDate(pinned.pinned_at!) && startOf(x, r) <= today)) return p;
  return sched;
}

/** The design the website shows now for a visitor who has not picked one, by the owner's setting and the live pack. */
export function siteDesign(setting: string, ms: number, packId?: string | null, pace: DesignPace = 'daypart'): { design: string; rotating: boolean; band: string | null; until: number | null; pack: { id: string; name: string; designs: string[] } } {
  const preview = packId ? PACKS.find((p) => p.id === packId) : undefined, pk = preview || livePack(ms);
  const pack = { id: pk.id, name: pk.name, designs: designsOf(pk) };
  if (!preview && setting !== 'rotate' && SITE_DESIGN_CHOICES.includes(setting)) return { design: setting, rotating: false, band: null, until: null, pack };
  const r = rotatingDesign(ms, pk.bands, pace);
  return { design: r.design, rotating: true, band: r.band, until: r.until, pack };
}
const designsOf = (p: PackDef): string[] => p.bands.flatMap((b) => [...b.designs]);

function out(p: PackDef, r: Map<string, Row>, live: PackDef, today: string): PackOut {
  const x = r.get(p.id), start = startOf(p, r);
  const state: PackState = p.id === live.id ? 'live' : start > today ? 'upcoming' : 'archived';
  return {
    id: p.id, name: p.name, note: p.note, quarter: quarterLabel(p.from), from: p.from, to: addDays(nextQuarter(p.from), -1), startsOn: start,
    delayed: !!x?.starts_on, state, switchedOn: p.id === live.id && p.id !== scheduled(today, r).id,
    approved: x?.approved_at ? { at: x.approved_at, by: x.approved_by } : null,
    bands: p.bands.map((b) => ({ name: b.name, from: b.from, designs: [...b.designs] })), designs: designsOf(p),
  };
}

export interface PackCalendar { live: PackOut; next: PackOut | null; packs: PackOut[]; reminder: string | null }

/** The desk's view: the live pack, the next one, all of them newest first, and what needs the owner. */
export function packCalendar(ms: number = now()): PackCalendar {
  const r = rows(), today = istDate(ms), live = livePack(ms);
  const packs = sortedByStart(r).map((p) => out(p, r, live, today));
  const liveOut = packs.find((p) => p.id === live.id)!;
  const next = packs.find((p) => p.state === 'upcoming') ?? null;
  const thisQuarter = quarterOf(today), following = nextQuarter(thisQuarter);
  let reminder: string | null = null;
  if (!PACKS.some((p) => p.from === following) && today >= addDays(following, -30))
    reminder = `The ${quarterLabel(following)} pack is not built yet. This quarter’s designs carry on until it is.`;
  return { live: liveOut, next, packs: packs.reverse(), reminder };
}

function packOr404(id: string): PackDef {
  const p = PACKS.find((x) => x.id === id);
  if (!p) throw notFound('No such design pack');
  return p;
}
function save(id: string, u: UserRow, set: Partial<Row>): void {
  const cur = one<Row>('SELECT * FROM design_packs WHERE id = ?', id) ?? { id, approved_at: null, approved_by: null, starts_on: null, pinned_at: null };
  const v = { ...cur, ...set };
  run('INSERT INTO design_packs(id, approved_at, approved_by, starts_on, pinned_at, updated_at, updated_by) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET approved_at=excluded.approved_at, approved_by=excluded.approved_by, starts_on=excluded.starts_on, pinned_at=excluded.pinned_at, updated_at=excluded.updated_at, updated_by=excluded.updated_by',
    id, v.approved_at, v.approved_by, v.starts_on, v.pinned_at, now(), u.id);
}

/** The owner's choices on a pack: { approve: true|false } (kept for older desks; nothing waits on it), { startsOn: 'YYYY-MM-DD' | null }, { switchOn: true|false }. */
export function updatePack(u: UserRow, id: string, body: unknown): PackCalendar {
  const p = packOr404(id), b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>, today = istDate(now());
  if ('approve' in b) {
    if (typeof b.approve !== 'boolean') throw bad('approve', 'true or false');
    save(id, u, b.approve ? { approved_at: now(), approved_by: u.id } : { approved_at: null, approved_by: null });
    audit({ id: u.id, role: u.role }, b.approve ? 'design_pack.approve' : 'design_pack.unapprove', 'design_pack', id, {});
  }
  if ('startsOn' in b) {
    const d = b.startsOn;
    const last = addDays(nextQuarter(p.from), -1);
    if (d !== null && (typeof d !== 'string' || !isValidDate(d) || d < p.from || d > last)) throw bad('startsOn', `A day from ${p.from} to ${last}`);
    if (d !== null && d < today) throw bad('startsOn', 'A day from today on');
    save(id, u, { starts_on: d === p.from ? null : d });
    audit({ id: u.id, role: u.role }, 'design_pack.delay', 'design_pack', id, { startsOn: d });
  }
  if ('switchOn' in b) {
    if (typeof b.switchOn !== 'boolean') throw bad('switchOn', 'true or false');
    if (b.switchOn) { run('UPDATE design_packs SET pinned_at = NULL'); save(id, u, { pinned_at: now() }); }
    else run('UPDATE design_packs SET pinned_at = NULL');
    audit({ id: u.id, role: u.role }, b.switchOn ? 'design_pack.switch_on' : 'design_pack.back_to_schedule', 'design_pack', id, {});
  }
  return packCalendar();
}
const bad = (field: string, message: string) => new HttpError(400, 'VALIDATION_FAILED', `${field}: ${message}`, { fields: [{ field, message }] });
