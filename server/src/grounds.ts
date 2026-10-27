import type { AvailabilityResponse, Ground, PlayFormat, RateRule, SlotView } from '@daji/shared';
import { many, one, registerSchema, run, tx } from './db.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { HttpError, notFound } from './errors.ts';
import { hoursOn, shortestDay } from './hours.ts';
import { cleanClosedDays, cleanRates, closedDaysOf, groundRates, isClosedOn, rateOptions, rateSpan } from './rates.ts';
import { MIN, isWeekend, istMidnight, minutesOf, timeOfDay } from './time.ts';
import { Validator } from './input.ts';
import { availabilityByFormat, cleanFormats, groundFormats } from './formats.ts';

// Added after the first release, so it is a migration: existing databases get the column the next time they start.
registerSchema('grounds-map-url-1', 'ALTER TABLE grounds ADD COLUMN map_url TEXT;');

const MAP_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl', 'maps.google.com', 'google.com', 'www.google.com', 'www.google.co.in', 'google.co.in']);

/**
 * Accepts the link Google Maps gives you under Share: https://maps.app.goo.gl/..., https://www.google.com/maps/..., https://goo.gl/maps/...
 * Anything else is refused, so a pasted link can never send customers somewhere that is not a map. Returns the cleaned link, or null.
 */
export function cleanMapUrl(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  if (!MAP_HOSTS.has(u.hostname)) return null;
  const onMapsPath = u.pathname === '/maps' || u.pathname.startsWith('/maps/');
  if (u.hostname === 'maps.app.goo.gl') { if (u.pathname.length < 2) return null; }
  else if (u.hostname === 'goo.gl') { if (!u.pathname.startsWith('/maps')) return null; }
  else if (u.hostname !== 'maps.google.com' && !onMapsPath) return null;
  u.hash = '';
  return u.toString();
}

/** The "Get directions" link: the owner's own map link, else a pin from the coordinates, else nothing. */
export function directionsUrl(g: Pick<GroundRow, 'map_url' | 'lat' | 'lng'>): string | null {
  if (g.map_url) return g.map_url;
  if (g.lat != null && g.lng != null) return `https://www.google.com/maps/search/?api=1&query=${g.lat},${g.lng}`;
  return null;
}

export interface GroundRow {
  id: string; owner_id: string; name: string; slug: string; city: string; area: string | null; address: string | null;
  lat: number | null; lng: number | null; map_url: string | null; description: string | null; facilities: string; images: string; surface: string | null;
  open_time: string; close_time: string; winter_open: string | null; winter_close: string | null; winter_from_month: number; winter_to_month: number; rates: string; closed_days: string; rates_note: string | null; slot_minutes: number; price_paise: number; weekend_price_paise: number | null;
  evening_surcharge_paise: number; evening_from: string; max_slots: number; formats: string; min_notice_minutes: number;
  advance_mode: 'fixed' | 'percent' | null; advance_value: number | null; active: number; created_at: number; updated_at: number;
}

export function toGround(r: GroundRow, ownerName: string | null = null): Ground {
  return {
    id: r.id, ownerId: r.owner_id, ownerName, name: r.name, slug: r.slug, city: r.city, area: r.area, address: r.address,
    lat: r.lat, lng: r.lng, mapUrl: r.map_url, directionsUrl: directionsUrl(r), description: r.description, facilities: JSON.parse(r.facilities), images: JSON.parse(r.images),
    surface: r.surface, openTime: r.open_time, closeTime: r.close_time, winterOpenTime: r.winter_open, winterCloseTime: r.winter_close, winterFromMonth: r.winter_from_month, winterToMonth: r.winter_to_month, rates: groundRates(r), ratesNote: r.rates_note, closedDays: closedDaysOf(r), slotMinutes: r.slot_minutes, pricePaise: r.price_paise,
    weekendPricePaise: r.weekend_price_paise, eveningSurchargePaise: r.evening_surcharge_paise, eveningFrom: r.evening_from,
    maxSlots: r.max_slots, formats: groundFormats(r), minNoticeMinutes: r.min_notice_minutes, advanceMode: r.advance_mode, advanceValue: r.advance_value, active: !!r.active,
  };
}

export const groundRow = (id: string): GroundRow | undefined => one<GroundRow>('SELECT * FROM grounds WHERE id = ?', id);

export function getGroundOr404(id: string): GroundRow {
  const g = groundRow(id);
  if (!g) throw notFound('Ground not found');
  return g;
}

export function listGrounds(opts: { ownerId?: string | null; includeInactive?: boolean; city?: string; q?: string } = {}): Ground[] {
  const where: string[] = [];
  const p: (string | number)[] = [];
  if (opts.ownerId) { where.push('g.owner_id = ?'); p.push(opts.ownerId); }
  if (!opts.includeInactive) where.push('g.active = 1');
  if (opts.city) { where.push('lower(g.city) = lower(?)'); p.push(opts.city); }
  if (opts.q) {
    where.push("(g.name LIKE ? ESCAPE '\\' OR g.area LIKE ? ESCAPE '\\' OR g.city LIKE ? ESCAPE '\\')");
    const like = `%${opts.q.replace(/[%_\\]/g, '\\$&')}%`;
    p.push(like, like, like);
  }
  const rows = many<GroundRow & { owner_name: string | null }>(
    `SELECT g.*, COALESCE(u.business_name, u.name) AS owner_name FROM grounds g JOIN users u ON u.id = g.owner_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY g.name`, ...p);
  return rows.map((r) => toGround(r, r.owner_name));
}

/** Price in paise of the slot that starts at `slotStart` (epoch ms). */
export function slotPrice(g: GroundRow, date: string, slotStart: number): number {
  let price = isWeekend(date) && g.weekend_price_paise != null ? g.weekend_price_paise : g.price_paise;
  const tod = Math.round((slotStart - istMidnight(date)) / MIN); // past 1440 = after midnight, still the same evening
  if (g.evening_surcharge_paise > 0 && tod >= minutesOf(g.evening_from)!) price += g.evening_surcharge_paise;
  return price;
}

/** Slot start instants for a date, in order. */
export function slotStarts(g: GroundRow, date: string): number[] {
  const { open, close } = hoursOn(g, date);
  const base = istMidnight(date);
  const out: number[] = [];
  if (isClosedOn(g, date)) return out;
  for (let m = open; m + g.slot_minutes <= close; m += g.slot_minutes) out.push(base + m * MIN);
  return out;
}

export function availability(g: GroundRow, date: string): AvailabilityResponse {
  const starts = slotStarts(g, date);
  const from = starts[0] ?? 0;
  const to = (starts[starts.length - 1] ?? 0) + g.slot_minutes * MIN;
  const rows = many<{ slot_start: number; kind: string; status: string | null }>(
    `SELECT bs.slot_start, bs.kind, b.status FROM booking_slots bs LEFT JOIN bookings b ON b.id = bs.booking_id
     WHERE bs.ground_id = ? AND bs.slot_start >= ? AND bs.slot_start < ?`, g.id, from, to);
  const taken = new Map(rows.map((r) => [r.slot_start, r]));
  const t = now();
  const slots: SlotView[] = starts.map((s) => {
    const r = taken.get(s);
    let state: SlotView['state'] = 'available';
    if (r) state = r.kind === 'block' ? 'blocked' : r.status === 'held' ? 'held' : 'booked';
    else if (s <= t || s < t + g.min_notice_minutes * MIN) state = 'past';
    else if (!g.active) state = 'blocked';
    return { start: s, end: s + g.slot_minutes * MIN, time: timeOfDay(s), pricePaise: slotPrice(g, date, s), state };
  });
  const stateOfSlot = (st: number): SlotView['state'] => slots.find((x) => x.start === st)?.state ?? 'blocked';
  const priced = groundRates(g).length > 0;
  let rates: AvailabilityResponse['rates'];
  if (priced) {
    const span = rateSpan(date);
    const rr = many<{ slot_start: number; kind: string; status: string | null }>(
      `SELECT bs.slot_start, bs.kind, b.status FROM booking_slots bs LEFT JOIN bookings b ON b.id = bs.booking_id WHERE bs.ground_id = ? AND bs.slot_start >= ? AND bs.slot_start < ?`, g.id, span.from, span.to);
    rates = rateOptions(g, date, new Map(rr.map((r) => [r.slot_start, r])), t);
  }
  return { groundId: g.id, date, slots, formats: availabilityByFormat(g, date, stateOfSlot, t), ...(rates ? { rates } : {}), ...(isClosedOn(g, date) ? { closed: true } : {}) };
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'ground';
}
function uniqueSlug(name: string, exceptId?: string): string {
  const base = slugify(name);
  let slug = base;
  for (let i = 2; ; i++) {
    const hit = one<{ id: string }>('SELECT id FROM grounds WHERE slug = ?', slug);
    if (!hit || hit.id === exceptId) return slug;
    slug = `${base}-${i}`;
  }
}

function parseGround(body: unknown, existing?: GroundRow) {
  const v = new Validator(body);
  const isNew = !existing;
  const name = v.str('name', { required: isNew, min: 2, max: 80 });
  const city = v.str('city', { required: isNew, min: 2, max: 60 });
  const area = v.str('area', { max: 80 });
  const address = v.str('address', { max: 200 });
  const lat = v.num('lat', { min: -90, max: 90 });
  const lng = v.num('lng', { min: -180, max: 180 });
  // undefined = leave as is; null = remove the link; a string = the new link.
  let mapUrl: string | null | undefined;
  if ('mapUrl' in v.src) {
    const raw = v.src.mapUrl;
    if (raw === null || raw === '') mapUrl = null;
    else if (typeof raw !== 'string' || raw.length > 400) v.fail('mapUrl', 'Paste the link from Google Maps (Share, then Copy link)');
    else {
      const clean = cleanMapUrl(raw);
      if (!clean) v.fail('mapUrl', 'Must be a Google Maps link, like https://maps.app.goo.gl/...');
      else mapUrl = clean;
    }
  }
  const description = v.str('description', { max: 2000 });
  const facilities = v.strArray('facilities', { max: 30, itemMax: 40 });
  const images = v.strArray('images', { max: 12, itemMax: 300 });
  const surface = v.str('surface', { max: 40 });
  const openTime = v.time('openTime');
  const closeTime = v.time('closeTime');
  const winterOpenTime = v.time('winterOpenTime');
  const winterCloseTime = v.time('winterCloseTime');
  const winterFromMonth = v.int('winterFromMonth', { min: 1, max: 12 });
  const winterToMonth = v.int('winterToMonth', { min: 1, max: 12 });
  const clearWinter = v.src.winterOpenTime === null || v.src.winterOpenTime === '';
  const slotMinutes = v.int('slotMinutes', { min: 15, max: 240 });
  const ratesNote = v.src.ratesNote === undefined ? undefined : v.src.ratesNote === null || v.src.ratesNote === '' ? '' : v.str('ratesNote', { max: 300 });
  const closedDaysIn = v.src.closedDays !== undefined && v.src.closedDays !== null ? cleanClosedDays(v.src.closedDays) : undefined;
  if (closedDaysIn && 'error' in closedDaysIn) v.fail('closedDays', closedDaysIn.error);
  const pricePaise = v.int('pricePaise', { required: isNew, min: 0, max: 100_000_00 });
  const weekendPricePaise = v.has('weekendPricePaise') ? v.int('weekendPricePaise', { min: 0, max: 100_000_00 }) : undefined;
  const eveningSurchargePaise = v.int('eveningSurchargePaise', { min: 0, max: 100_000_00 });
  const eveningFrom = v.time('eveningFrom');
  const maxSlots = v.int('maxSlots', { min: 1, max: 24 });
  const minNoticeMinutes = v.int('minNoticeMinutes', { min: 0, max: 7 * 24 * 60 });
  const advanceMode = v.oneOf('advanceMode', ['fixed', 'percent'] as const);
  const advanceValue = v.int('advanceValue', { min: 0 });
  const active = v.bool('active');
  if (advanceMode === 'percent' && advanceValue !== undefined && advanceValue > 100) v.fail('advanceValue', 'A percentage cannot be above 100');
  const o = openTime ?? existing?.open_time ?? '06:00';
  const c = closeTime ?? existing?.close_time ?? '22:00';
  const sm = slotMinutes ?? existing?.slot_minutes ?? 60;
  if (minutesOf(o)! >= 1440) v.fail('openTime', 'Opening time must be between 00:00 and 23:59');
  else if (minutesOf(o)! % sm !== 0) v.fail('openTime', `Opening time must fall on a ${sm}-minute step from midnight (for example 06:00 or ${String(Math.floor(Math.ceil(minutesOf(o)! / sm) * sm / 60) % 24).padStart(2, '0')}:${String(Math.ceil(minutesOf(o)! / sm) * sm % 60).padStart(2, '0')}), so booking slots and price lines line up`);
  if (minutesOf(o)! + sm > minutesOf(c)!) v.fail('closeTime', 'Closing time must leave room for at least one slot after opening');
  const wo = clearWinter ? null : winterOpenTime ?? existing?.winter_open ?? null;
  const wc = clearWinter ? null : winterCloseTime ?? existing?.winter_close ?? null;
  if ((wo === null) !== (wc === null)) v.fail('winterCloseTime', 'Set both the winter opening and closing time, or neither');
  else if (wo !== null && wc !== null) {
    if (minutesOf(wo)! >= 1440) v.fail('winterOpenTime', 'Opening time must be between 00:00 and 23:59');
    else if (minutesOf(wo)! % sm !== 0) v.fail('winterOpenTime', `Winter opening time must fall on a ${sm}-minute step from midnight`);
    if (minutesOf(wo)! + sm > minutesOf(wc)!) v.fail('winterCloseTime', 'Winter closing time must leave room for at least one slot after opening');
  }
  const seasonRow = { open_time: o, close_time: c, winter_open: wo, winter_close: wc, winter_from_month: 11, winter_to_month: 2 };
  let rates: RateRule[] | undefined;
  if (v.src.rates !== undefined && v.src.rates !== null) {
    const r = cleanRates(v.src.rates, sm);
    if ('error' in r) v.fail('rates', r.error); else rates = r.ok;
  } else if (existing && slotMinutes !== undefined && slotMinutes !== existing.slot_minutes) {
    const r = cleanRates(groundRates(existing), sm);
    if ('error' in r) v.fail('slotMinutes', 'The rate card has times that do not fit this slot length. Change the rates first.');
  }
  // Formats are checked against the hours and slot length that will apply after this save, so a change that breaks one is refused.
  let formats: PlayFormat[] | undefined;
  if (v.has('formats') || existing) {
    const raw = v.has('formats') ? v.src.formats : groundFormats(existing!);
    const r = cleanFormats(raw, sm, shortestDay(seasonRow), maxSlots ?? existing?.max_slots ?? 6);
    if ('error' in r) v.fail('formats', r.error); else {
      if (v.has('formats')) formats = r.ok;
    }
  }
  v.done();
  return { name, city, area, address, lat, lng, mapUrl, description, facilities, images, surface, openTime, closeTime, winterOpenTime, winterCloseTime, clearWinter, winterFromMonth, winterToMonth, rates, ratesNote, closedDays: closedDaysIn && 'ok' in closedDaysIn ? closedDaysIn.ok : undefined, slotMinutes, pricePaise, weekendPricePaise, eveningSurchargePaise, eveningFrom, maxSlots, formats, minNoticeMinutes, advanceMode, advanceValue, active, has: (k: string) => v.has(k) };
}

export function createGround(ownerId: string, body: unknown): GroundRow {
  const p = parseGround(body);
  const id = newId('gnd');
  const t = now();
  run(
    `INSERT INTO grounds(id, owner_id, name, slug, city, area, address, lat, lng, map_url, description, facilities, images, surface, open_time, close_time,
       slot_minutes, price_paise, weekend_price_paise, evening_surcharge_paise, evening_from, max_slots, formats, min_notice_minutes, advance_mode, advance_value, active, created_at, updated_at,
       winter_open, winter_close, winter_from_month, winter_to_month, rates, closed_days, rates_note)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, ownerId, p.name!, uniqueSlug(p.name!), p.city!, p.area ?? null, p.address ?? null, p.lat ?? null, p.lng ?? null, p.mapUrl ?? null, p.description ?? null,
    JSON.stringify(p.facilities ?? []), JSON.stringify(p.images ?? []), p.surface ?? null, p.openTime ?? '06:00', p.closeTime ?? '22:00',
    p.slotMinutes ?? 60, p.pricePaise!, p.weekendPricePaise ?? null, p.eveningSurchargePaise ?? 0, p.eveningFrom ?? '18:00', p.maxSlots ?? 6, JSON.stringify(p.formats ?? []),
    p.minNoticeMinutes ?? 0, p.advanceMode ?? null, p.advanceValue ?? null, p.active === false ? 0 : 1, t, t,
    p.winterOpenTime ?? null, p.winterCloseTime ?? null, p.winterFromMonth ?? 11, p.winterToMonth ?? 2, JSON.stringify(p.rates ?? []), JSON.stringify(p.closedDays ?? []), p.ratesNote || null,
  );
  return groundRow(id)!;
}

export function updateGround(id: string, body: unknown): GroundRow {
  const g = getGroundOr404(id);
  const p = parseGround(body, g);
  // Slots are keyed by their start time. Changing the slot length under live bookings could let a new slot overlap an old one.
  if (p.slotMinutes !== undefined && p.slotMinutes !== g.slot_minutes && one('SELECT 1 FROM booking_slots WHERE ground_id = ? AND slot_start >= ?', g.id, now())) {
    throw new HttpError(409, 'HAS_BOOKINGS', 'The slot length cannot change while there are upcoming bookings or blocked times. Cancel or unblock them first.');
  }
  const nz = <T>(v: T | undefined, cur: T): T => (v === undefined ? cur : v);
  run(
    `UPDATE grounds SET name=?, slug=?, city=?, area=?, address=?, lat=?, lng=?, map_url=?, description=?, facilities=?, images=?, surface=?, open_time=?, close_time=?,
       slot_minutes=?, price_paise=?, weekend_price_paise=?, evening_surcharge_paise=?, evening_from=?, max_slots=?, formats=?, min_notice_minutes=?, advance_mode=?, advance_value=?, active=?, updated_at=?, winter_open=?, winter_close=?, winter_from_month=?, winter_to_month=?, rates=?, closed_days=?, rates_note=? WHERE id=?`,
    nz(p.name, g.name), p.name && p.name !== g.name ? uniqueSlug(p.name, g.id) : g.slug, nz(p.city, g.city), nz(p.area, g.area), nz(p.address, g.address),
    nz(p.lat, g.lat), nz(p.lng, g.lng), nz(p.mapUrl, g.map_url), nz(p.description, g.description), p.facilities ? JSON.stringify(p.facilities) : g.facilities,
    p.images ? JSON.stringify(p.images) : g.images, nz(p.surface, g.surface), nz(p.openTime, g.open_time), nz(p.closeTime, g.close_time),
    nz(p.slotMinutes, g.slot_minutes), nz(p.pricePaise, g.price_paise), p.has('weekendPricePaise') ? (p.weekendPricePaise ?? null) : g.weekend_price_paise,
    nz(p.eveningSurchargePaise, g.evening_surcharge_paise), nz(p.eveningFrom, g.evening_from), nz(p.maxSlots, g.max_slots), p.formats ? JSON.stringify(p.formats) : g.formats,
    nz(p.minNoticeMinutes, g.min_notice_minutes), nz(p.advanceMode, g.advance_mode), nz(p.advanceValue, g.advance_value),
    p.active === undefined ? g.active : p.active ? 1 : 0, now(),
    p.clearWinter ? null : nz(p.winterOpenTime, g.winter_open), p.clearWinter ? null : nz(p.winterCloseTime, g.winter_close),
    nz(p.winterFromMonth, g.winter_from_month), nz(p.winterToMonth, g.winter_to_month),
    p.rates ? JSON.stringify(p.rates) : g.rates, p.closedDays ? JSON.stringify(p.closedDays) : g.closed_days, p.ratesNote === undefined ? g.rates_note : p.ratesNote || null, g.id,
  );
  return groundRow(id)!;
}

/** Blocks slots (maintenance, private use). Refuses if any slot already has a booking or hold. */
export function blockRange(g: GroundRow, date: string, startTime: string, endTime: string, note: string | null): number {
  const s = minutesOf(startTime), e = minutesOf(endTime);
  if (s === null || e === null || e <= s) throw new HttpError(400, 'VALIDATION_FAILED', 'End must be after start', { fields: [{ field: 'endTime', message: 'End must be after start' }] });
  const base = istMidnight(date);
  const starts = slotStarts(g, date).filter((x) => x >= base + s * MIN && x + g.slot_minutes * MIN <= base + e * MIN);
  if (!starts.length) throw new HttpError(400, 'NO_SLOTS', 'No slots fall inside that time range');
  // All or nothing: a refusal halfway through must not leave the first slots blocked.
  return tx(() => {
    let n = 0;
    for (const st of starts) {
      const hit = one<{ kind: string }>('SELECT kind FROM booking_slots WHERE ground_id = ? AND slot_start = ?', g.id, st);
      if (hit?.kind === 'booking') throw new HttpError(409, 'SLOT_TAKEN', `The ${timeOfDay(st)} slot already has a booking`);
      if (!hit) { run("INSERT INTO booking_slots(ground_id, slot_start, kind, note) VALUES(?,?,'block',?)", g.id, st, note); n++; }
    }
    return n;
  });
}

export function unblockRange(g: GroundRow, date: string, startTime: string, endTime: string): number {
  const s = minutesOf(startTime), e = minutesOf(endTime);
  if (s === null || e === null || e <= s) throw new HttpError(400, 'VALIDATION_FAILED', 'End must be after start', { fields: [{ field: 'endTime', message: 'End must be after start' }] });
  const base = istMidnight(date);
  return run("DELETE FROM booking_slots WHERE ground_id = ? AND kind = 'block' AND slot_start >= ? AND slot_start < ?", g.id, base + s * MIN, base + e * MIN).changes;
}
