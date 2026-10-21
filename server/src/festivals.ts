import { many, one, run, registerSchema } from './db.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { HttpError } from './errors.ts';
import { audit } from './audit.ts';
import { DAY, addDays, istDate, istMidnight, isValidDate } from './time.ts';
import type { UserRow } from './auth.ts';

// The festival calendar. On a festival day the website switches to that festival's look by itself, for every visitor.
// A festival has a start date (one per year, or a fixed day such as 26 January that repeats) and a list of day-looks:
// Navratri has ten, Diwali five, Republic Day one. Each day has its own title, greeting, headline and colour, and the
// last day of the year can count down to midnight. The owner edits all of it on the Festivals page of the desk.
registerSchema('festivals-1', `CREATE TABLE festivals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  look TEXT NOT NULL,
  repeat_md TEXT NOT NULL DEFAULT '',
  starts TEXT NOT NULL DEFAULT '[]',
  days TEXT NOT NULL DEFAULT '[]',
  offer TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  deleted_at INTEGER,
  deleted_by TEXT
);`);

/** The festival looks the website can draw: colours, decoration and the moving effect. A festival the owner adds picks one. */
export const LOOKS = ['uttarayan', 'tiranga', 'holi', 'ganesh', 'navratri', 'diwali', 'christmas'] as const;
export type Look = (typeof LOOKS)[number];

export interface DayLook {
  /** The day's name, e.g. "Dhanteras" or "Day 3: Chandraghanta". */
  title: string;
  /** Greeting in English, shown in the banner and above the headline. */
  greeting: string;
  /** The same greeting in Gujarati or Hindi (optional). */
  local: string;
  headline: string;
  /** Second line of the headline, drawn in the festival colour. */
  headline2: string;
  lede: string;
  /** The day's colour as #rrggbb (Navratri's colour of the day), or empty for the festival's own. */
  colour: string;
  /** Count down to midnight at the end of this day (New Year's Eve). */
  countdown: boolean;
  /** When the countdown starts on that day, HH:MM India time. */
  countdownFrom: string;
}
export interface Festival {
  id: string;
  name: string;
  look: Look;
  /** A fixed day that repeats every year as MM-DD (e.g. 01-26), or empty when the dates move with the panchang. */
  repeat: string;
  /** First days, YYYY-MM-DD, one for each year, for festivals whose dates move. */
  starts: string[];
  days: DayLook[];
  /** A festival offer or event line shown on the banner and the booking card. */
  offer: string;
  enabled: boolean;
  sort: number;
}
interface Row { id: string; name: string; look: string; repeat_md: string; starts: string; days: string; offer: string; enabled: number; sort: number }

const day = (title: string, greeting: string, local: string, headline: string, headline2: string, lede: string, colour = '', extra: Partial<DayLook> = {}): DayLook =>
  ({ title, greeting, local, headline, headline2, lede, colour, countdown: false, countdownFrom: '', ...extra });

const NAVRATRI: [string, string, string][] = [
  ['Shailaputri', 'Orange', '#f57c00'], ['Brahmacharini', 'White', '#f2ede1'], ['Chandraghanta', 'Red', '#d32f2f'],
  ['Kushmanda', 'Royal blue', '#2f5bd8'], ['Skandamata', 'Yellow', '#f6c21c'], ['Katyayani', 'Green', '#2e9e4f'],
  ['Kalaratri', 'Grey', '#9aa0a8'], ['Mahagauri', 'Purple', '#8e4ec6'], ['Siddhidatri', 'Peacock green', '#00a19a'],
];

/** The calendar a new site starts with. Moving dates follow the panchang and must be checked each year. */
export function defaultFestivals(): Omit<Festival, 'id'>[] {
  const ganesh: DayLook[] = Array.from({ length: 11 }, (_, i) => i === 0
    ? day('Ganesh Chaturthi', 'Ganpati Bappa Morya!', 'गणपति बाप्पा मोरया', 'Ganpati Bappa', 'Morya!', 'Ganeshotsav begins today. Book the ground for your mandal’s match, with floodlights until 11 pm.')
    : i === 10
      ? day('Anant Chaturdashi', 'Ganpati Bappa Morya, come back soon next year', 'पुढच्या वर्षी लवकर या', 'Bappa, come back', 'soon next year.', 'Visarjan day. The ground stays open; evening slots are lit until 11 pm.')
      : day(`Ganeshotsav, day ${i + 1}`, 'Ganpati Bappa Morya!', 'गणपति बाप्पा मोरया', 'Ganeshotsav', `day ${i + 1}.`, 'Play between the aartis. Book a slot in three taps and pay the advance online.'));
  const navratri: DayLook[] = NAVRATRI.map(([goddess, colour, hex], i) =>
    day(goddess, `Happy Navratri. Today's colour is ${colour.toLowerCase()}`, 'નવરાત્રીની શુભેચ્છા', `Navratri night ${i + 1}.`, `${goddess}.`, `Today's colour is ${colour.toLowerCase()}. Play in the evening, garba after. Floodlit slots until 11 pm.`, hex));
  navratri.push(day('Dussehra', 'Happy Dussehra. Good wins over evil', 'વિજયાદશમીની શુભેચ્છા', 'Happy', 'Dussehra.', 'Vijayadashami: a good day to start something new. Book your team’s next match.', '#e0a526'));
  const xmas: DayLook[] = [
    day('Christmas Eve', 'Merry Christmas', '', 'Christmas Eve', 'at the ground.', 'Evening slots under the lights until 11 pm. Bring the family.'),
    day('Christmas Day', 'Merry Christmas', 'मेरी क्रिसमस', 'Merry', 'Christmas.', 'Holiday cricket with friends and family. Book a slot in three taps.'),
    ...[26, 27, 28, 29, 30].map((d) => day('Season’s greetings', 'Season’s greetings', '', 'Holiday', 'cricket.', 'The holidays are here. Morning, day and floodlit evening slots are open.')),
    day('New Year’s Eve', 'The countdown to the new year is on', 'नव वर्ष की शुभकामनाएँ', 'Counting down', 'to the new year.', 'Play the last match of the year under the lights.', '', { countdown: true, countdownFrom: '06:00' }),
    day('New Year’s Day', 'Happy New Year', 'नव वर्ष की शुभकामनाएँ', 'Happy', 'New Year.', 'Start the year on the field. Book your first match of the year.'),
  ];
  return [
    { name: 'Uttarayan', look: 'uttarayan', repeat: '01-14', starts: [], offer: '', enabled: true, sort: 10, days: [
      day('Uttarayan', 'Happy Uttarayan. Kai po che!', 'ઉત્તરાયણની શુભેચ્છા', 'Kai po', 'che!', 'Kites in the morning, cricket in the evening. Floodlit slots until 11 pm.'),
      day('Vasi Uttarayan', 'Happy Vasi Uttarayan', 'વાસી ઉત્તરાયણ', 'One more day', 'of kites.', 'Still on holiday? Get the team together for a match.'),
    ] },
    { name: 'Republic Day', look: 'tiranga', repeat: '01-26', starts: [], offer: '', enabled: true, sort: 20, days: [
      day('Republic Day', 'Happy Republic Day', 'गणतंत्र दिवस की हार्दिक शुभकामनाएँ', 'Happy', 'Republic Day.', 'Celebrate with a match. Book a slot in three taps and pay the advance online.'),
    ] },
    { name: 'Holi', look: 'holi', repeat: '', starts: ['2027-03-21'], offer: '', enabled: true, sort: 30, days: [
      day('Holika Dahan', 'Happy Holika Dahan', 'હોલિકા દહનની શુભકામના', 'Holika', 'Dahan.', 'The bonfire is tonight, the colours are tomorrow. Book an evening slot.'),
      day('Dhuleti', 'Happy Holi', 'होली की हार्दिक शुभकामनाएँ', 'Happy', 'Holi!', 'Colours in the morning, cricket after. Day and evening slots are open.'),
    ] },
    { name: 'Independence Day', look: 'tiranga', repeat: '08-15', starts: [], offer: '', enabled: true, sort: 40, days: [
      day('Independence Day', 'Happy Independence Day. Jai Hind', 'स्वतंत्रता दिवस की हार्दिक शुभकामनाएँ', 'Happy', 'Independence Day.', 'Play for the tricolour. Book a slot in three taps and pay the advance online.'),
    ] },
    { name: 'Ganesh Chaturthi', look: 'ganesh', repeat: '', starts: ['2027-09-04'], offer: '', enabled: true, sort: 50, days: ganesh },
    { name: 'Navratri and Dussehra', look: 'navratri', repeat: '', starts: ['2027-09-30'], offer: '', enabled: true, sort: 60, days: navratri },
    { name: 'Diwali', look: 'diwali', repeat: '', starts: ['2026-11-06', '2027-10-27'], offer: '', enabled: true, sort: 70, days: [
      day('Dhanteras', 'Happy Dhanteras', 'ધનતેરસની શુભેચ્છા', 'Happy', 'Dhanteras.', 'The festival of lights begins. Evening slots are lit until 11 pm.'),
      day('Kali Chaudas', 'Happy Kali Chaudas', 'કાળી ચૌદસની શુભેચ્છા', 'Kali', 'Chaudas.', 'One night to Diwali. Get a match in before the celebrations.'),
      day('Diwali', 'Happy Diwali', 'શુભ દીપાવલી', 'Happy', 'Diwali.', 'Wishing you light, health and a great season of cricket.'),
      day('Bestu Varas', 'Saal Mubarak. Happy New Year', 'નૂતન વર્ષાભિનંદન', 'Saal', 'Mubarak.', 'A happy and prosperous new year from Daji Cricket Ground.'),
      day('Bhai Dooj', 'Happy Bhai Dooj', 'ભાઈબીજની શુભેચ્છા', 'Happy', 'Bhai Dooj.', 'Brothers and sisters against the rest: book a family match.'),
    ] },
    { name: 'Christmas and New Year', look: 'christmas', repeat: '12-24', starts: [], offer: '', enabled: true, sort: 80, days: xmas },
  ];
}

const parse = <T>(s: string, fallback: T): T => { try { return JSON.parse(s) as T; } catch { return fallback; } };
const toFestival = (r: Row): Festival => ({ id: r.id, name: r.name, look: r.look as Look, repeat: r.repeat_md, starts: parse<string[]>(r.starts, []), days: parse<DayLook[]>(r.days, []), offer: r.offer, enabled: r.enabled === 1, sort: r.sort });

/** Fills the calendar the first time it is read; later deletions are kept (they are soft). */
function ensureDefaults(): void {
  if (one<{ n: number }>('SELECT COUNT(*) AS n FROM festivals')!.n > 0) return;
  const t = now();
  for (const f of defaultFestivals()) run('INSERT INTO festivals(id, name, look, repeat_md, starts, days, offer, enabled, sort, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    newId('fes'), f.name, f.look, f.repeat, JSON.stringify(f.starts), JSON.stringify(f.days), f.offer, f.enabled ? 1 : 0, f.sort, t, t);
}

export function listFestivals(): Festival[] {
  ensureDefaults();
  return many<Row>('SELECT * FROM festivals WHERE deleted_at IS NULL ORDER BY sort, name').map(toFestival);
}
function getFestival(id: string): Festival {
  ensureDefaults();
  const r = one<Row>('SELECT * FROM festivals WHERE id = ? AND deleted_at IS NULL', id);
  if (!r) throw new HttpError(404, 'NOT_FOUND', 'Festival not found');
  return toFestival(r);
}

/** Every first day the festival has around a year: its own list, and a repeating day in the years either side. */
function startsAround(f: Festival, year: number): string[] {
  const out = [...f.starts];
  if (f.repeat) for (const y of [year - 1, year, year + 1]) out.push(`${y}-${f.repeat}`);
  return out.filter(isValidDate).sort();
}
const daysBetween = (a: string, b: string): number => Math.round((istMidnight(b) - istMidnight(a)) / DAY);

export interface FestivalToday {
  id: string; name: string; look: Look; day: number; of: number; from: string; to: string; date: string;
  dayLook: DayLook; offer: string;
  /** For a countdown day: when it starts and the midnight it counts to (epoch ms). */
  countdownStart: number | null; countdownTo: number | null;
}
function at(f: Festival, start: string, date: string): FestivalToday {
  const i = daysBetween(start, date), d = f.days[i]!;
  const end = istMidnight(date) + DAY;
  const from = d.countdown ? istMidnight(date) + hm(d.countdownFrom || '00:00') : null;
  return { id: f.id, name: f.name, look: f.look, day: i + 1, of: f.days.length, from: start, to: addDays(start, f.days.length - 1), date, dayLook: d, offer: f.offer,
    countdownStart: from, countdownTo: d.countdown ? end : null };
}
const hm = (s: string): number => { const m = /^(\d{2}):(\d{2})$/.exec(s); return m ? (+m[1]! * 60 + +m[2]!) * 60_000 : 0; };

/** The festival on a day (India time), or null. When two overlap, the one higher in the list wins. */
export function festivalOn(date: string): FestivalToday | null {
  const year = +date.slice(0, 4);
  for (const f of listFestivals()) {
    if (!f.enabled || !f.days.length) continue;
    for (const s of startsAround(f, year)) { const i = daysBetween(s, date); if (i >= 0 && i < f.days.length) return at(f, s, date); }
  }
  return null;
}
/** One festival on one of its days, for the owner's preview (enabled or not). */
export function festivalPreview(id: string, dayNo: number): FestivalToday {
  const f = getFestival(id);
  if (!f.days.length) throw new HttpError(400, 'VALIDATION_FAILED', 'This festival has no days yet');
  const i = Math.min(Math.max(1, Math.floor(dayNo) || 1), f.days.length) - 1;
  const today = istDate(now()), s = startsAround(f, +today.slice(0, 4)).find((x) => x >= addDays(today, -(f.days.length - 1))) ?? today;
  return at(f, s, addDays(s, i));
}

/** The owner's list, with the next dates of each festival and a warning when next year's dates are missing. */
export function festivalCalendar(): { items: (Festival & { next: { from: string; to: string } | null; warning: string | null })[]; looks: readonly string[] } {
  const today = istDate(now()), year = +today.slice(0, 4);
  const items = listFestivals().map((f) => {
    const s = startsAround(f, year).find((x) => addDays(x, Math.max(f.days.length, 1) - 1) >= today) ?? null;
    const next = s ? { from: s, to: addDays(s, Math.max(f.days.length, 1) - 1) } : null;
    let warning: string | null = null;
    if (!f.repeat) {
      if (!next) warning = `No upcoming dates. Add the dates for ${year} or ${year + 1}.`;
      else if (!f.starts.some((x) => x.startsWith(String(year + 1)))) warning = `The dates for ${year + 1} are not set yet.`;
    }
    if (!f.days.length) warning = 'This festival has no days yet.';
    return { ...f, next, warning };
  });
  return { items, looks: LOOKS };
}

// ---- validation and changes
const str = (v: unknown, max: number, field: string, fields: { field: string; message: string }[], min = 0): string => {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string' || v.trim().length < min || v.length > max) { fields.push({ field, message: min ? `Between ${min} and ${max} characters` : `At most ${max} characters` }); return ''; }
  return v.trim();
};
function clean(b: Record<string, unknown>, before?: Festival): Omit<Festival, 'id'> {
  const fields: { field: string; message: string }[] = [];
  const has = (k: string) => k in b;
  const name = has('name') || !before ? str(b.name, 60, 'name', fields, 2) : before.name;
  const look = (has('look') || !before ? b.look : before.look) as Look;
  if (!(LOOKS as readonly unknown[]).includes(look)) fields.push({ field: 'look', message: `One of ${LOOKS.join(', ')}` });
  let repeat = has('repeat') || !before ? (b.repeat ?? '') : before.repeat;
  if (typeof repeat !== 'string' || (repeat !== '' && !(/^\d{2}-\d{2}$/.test(repeat) && isValidDate(`2028-${repeat}`)))) { fields.push({ field: 'repeat', message: 'A day like 01-26, or empty' }); repeat = ''; }
  let starts = has('starts') || !before ? (b.starts ?? []) : before.starts;
  if (!Array.isArray(starts) || starts.length > 30 || starts.some((s) => typeof s !== 'string' || !isValidDate(s))) { fields.push({ field: 'starts', message: 'Up to 30 dates like 2027-10-27' }); starts = []; }
  let days = has('days') || !before ? b.days : before.days;
  const outDays: DayLook[] = [];
  if (!Array.isArray(days) || days.length < 1 || days.length > 15) fields.push({ field: 'days', message: 'From 1 to 15 days' });
  else days.forEach((d: unknown, i: number) => {
    const o = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>, p = `days.${i}.`;
    const colour = o.colour === undefined || o.colour === null ? '' : o.colour;
    if (typeof colour !== 'string' || (colour !== '' && !/^#[0-9a-fA-F]{6}$/.test(colour))) fields.push({ field: p + 'colour', message: 'A colour like #d32f2f, or empty' });
    const from = o.countdownFrom === undefined || o.countdownFrom === null ? '' : o.countdownFrom;
    if (typeof from !== 'string' || (from !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(from))) fields.push({ field: p + 'countdownFrom', message: 'A time like 06:00, or empty' });
    if (o.countdown !== undefined && typeof o.countdown !== 'boolean') fields.push({ field: p + 'countdown', message: 'true or false' });
    outDays.push({ title: str(o.title, 60, p + 'title', fields, 1), greeting: str(o.greeting, 120, p + 'greeting', fields), local: str(o.local, 120, p + 'local', fields),
      headline: str(o.headline, 60, p + 'headline', fields), headline2: str(o.headline2, 60, p + 'headline2', fields), lede: str(o.lede, 240, p + 'lede', fields),
      colour: typeof colour === 'string' ? colour.toLowerCase() : '', countdown: o.countdown === true, countdownFrom: typeof from === 'string' ? from : '' });
  });
  const offer = has('offer') || !before ? str(b.offer, 160, 'offer', fields) : before.offer;
  const enabled = has('enabled') || !before ? b.enabled ?? true : before.enabled;
  if (typeof enabled !== 'boolean') fields.push({ field: 'enabled', message: 'true or false' });
  const sort = has('sort') || !before ? b.sort ?? 100 : before.sort;
  if (!Number.isInteger(sort) || (sort as number) < 0 || (sort as number) > 10000) fields.push({ field: 'sort', message: 'A whole number from 0 to 10000' });
  if (fields.length) throw new HttpError(400, 'VALIDATION_FAILED', 'Some festival details are not valid', { fields });
  return { name, look, repeat: repeat as string, starts: [...new Set(starts as string[])].sort(), days: has('days') || !before ? outDays : before.days, offer, enabled: enabled as boolean, sort: sort as number };
}

export function createFestival(u: UserRow, body: unknown): Festival {
  ensureDefaults();
  const f = clean((body && typeof body === 'object' ? body : {}) as Record<string, unknown>);
  const id = newId('fes'), t = now();
  run('INSERT INTO festivals(id, name, look, repeat_md, starts, days, offer, enabled, sort, created_at, created_by, updated_at, updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    id, f.name, f.look, f.repeat, JSON.stringify(f.starts), JSON.stringify(f.days), f.offer, f.enabled ? 1 : 0, f.sort, t, u.id, t, u.id);
  audit({ id: u.id, role: u.role }, 'festival.create', 'festival', id, { name: f.name });
  return getFestival(id);
}
export function updateFestival(u: UserRow, id: string, body: unknown): Festival {
  const before = getFestival(id);
  const f = clean((body && typeof body === 'object' ? body : {}) as Record<string, unknown>, before);
  run('UPDATE festivals SET name=?, look=?, repeat_md=?, starts=?, days=?, offer=?, enabled=?, sort=?, updated_at=?, updated_by=? WHERE id=?',
    f.name, f.look, f.repeat, JSON.stringify(f.starts), JSON.stringify(f.days), f.offer, f.enabled ? 1 : 0, f.sort, now(), u.id, id);
  audit({ id: u.id, role: u.role }, 'festival.update', 'festival', id, { name: f.name, enabled: f.enabled });
  return getFestival(id);
}
export function deleteFestival(u: UserRow, id: string): void {
  const f = getFestival(id);
  run('UPDATE festivals SET deleted_at=?, deleted_by=? WHERE id=?', now(), u.id, id);
  audit({ id: u.id, role: u.role }, 'festival.delete', 'festival', id, { name: f.name });
}
