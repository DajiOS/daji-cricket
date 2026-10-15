import { addDays, dayOfWeek, isValidDate, monthRange } from '../time.ts';
import { financialYear } from '../accounting/statements.ts';

// Turns the dates in a plain-language question into a range. Everything is in IST and every range is echoed back in
// the answer ("the past 37 days, 8 Sep to 14 Oct 2026"), so a wrong reading is easy to spot.
//   "past N days"  = N days ending today, today included.
//   "last month"   = the whole of the previous calendar month; "this month" = from the 1st (clipped to today by the caller).
//   Weeks run Monday to Sunday. "Financial year" is 1 April to 31 March. Dates written 3/10/2026 are day/month/year.

export interface Span { from: string; to: string; label: string }

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
  august: 8, aug: 8, september: 9, sept: 9, sep: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, sixty: 60, ninety: 90 };
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function addMonths(date: string, n: number): string {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7)), d = Number(date.slice(8, 10));
  const t = y * 12 + (m - 1) + n;
  const ny = Math.floor(t / 12), nm = (t % 12) + 1;
  return ymd(ny, nm, Math.min(d, daysIn(ny, nm)));
}

export function niceDay(d: string, withYear = true): string {
  return `${Number(d.slice(8, 10))} ${SHORT[Number(d.slice(5, 7)) - 1]}${withYear ? ` ${d.slice(0, 4)}` : ''}`;
}
export function niceRange(from: string, to: string): string {
  if (from === to) return niceDay(from);
  return from.slice(0, 4) === to.slice(0, 4) ? `${niceDay(from, false)} to ${niceDay(to)}` : `${niceDay(from)} to ${niceDay(to)}`;
}

const monday = (d: string) => addDays(d, -((dayOfWeek(d) + 6) % 7));

/** FY quarter containing `date`: Q1 = Apr–Jun … Q4 = Jan–Mar. */
function quarterRange(fyStartYear: number, q: number): { from: string; to: string } {
  const startMonth = [4, 7, 10, 1][q - 1]!;
  const y = q === 4 ? fyStartYear + 1 : fyStartYear;
  return { from: ymd(y, startMonth, 1), to: ymd(y, startMonth + 2, daysIn(y, startMonth + 2)) };
}
const fyQuarter = (date: string): { fy: number; q: number } => {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7));
  return { fy: m >= 4 ? y : y - 1, q: m >= 4 ? Math.floor((m - 4) / 3) + 1 : 4 };
};

interface Dated { date: string; index: number; length: number }

/** Every calendar date written in the text, in order. A missing year means this year. */
function datesIn(t: string, today: string): Dated[] {
  const thisYear = Number(today.slice(0, 4));
  const out: Dated[] = [];
  const add = (m: RegExpExecArray, y: number, mo: number, d: number) => {
    const date = ymd(y, mo, d);
    if (isValidDate(date)) out.push({ date, index: m.index, length: m[0].length });
  };
  for (const m of t.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) add(m, +m[1]!, +m[2]!, +m[3]!);
  for (const m of t.matchAll(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4}|\d{2})\b/g)) add(m, m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!, +m[2]!, +m[1]!);
  for (const m of t.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RE})\\b(?:\\s*,?\\s*(\\d{4}))?`, 'g'))) add(m, m[3] ? +m[3] : thisYear, MONTHS[m[2]!]!, +m[1]!);
  for (const m of t.matchAll(new RegExp(`\\b(${MONTH_RE})\\s+(\\d{1,2})(?!\\d)(?:st|nd|rd|th)?(?:\\s*,?\\s*(\\d{4}))?`, 'g'))) add(m, m[3] ? +m[3] : thisYear, MONTHS[m[1]!]!, +m[2]!);
  out.sort((a, b) => a.index - b.index);
  // the same words can match two patterns; keep the first at each position
  return out.filter((d, i) => i === 0 || d.index >= out[i - 1]!.index + out[i - 1]!.length);
}

const num = (s: string): number | null => (/^\d+$/.test(s) ? Number(s) : NUMBER_WORDS[s] ?? null);

export interface Parsed { span: Span | null; error?: string }

/**
 * @param prefer which way to read a bare month name with no year: "past" picks the latest such month that has started,
 *               "future" picks the next one (for "bookings in December").
 */
export function parseRange(text: string, today: string, prefer: 'past' | 'future' = 'past'): Parsed {
  const t = text.toLowerCase().replace(/['’]s\b/g, '').replace(/[,;?!]/g, ' ').replace(/\s+/g, ' ');
  const W = Object.keys(NUMBER_WORDS).join('|');
  const span = (from: string, to: string, label: string): Parsed => ({ span: { from, to, label } });

  // ---- explicit dates
  const found = datesIn(t, today);
  if (found.length >= 1) {
    const a = found[0]!.date, b = found[1]?.date;
    if (!b) {
      // "since 1 Oct", "from 1 Oct till today": an open end means today.
      if (/\b(since|from|after)\b/.test(t.slice(0, found[0]!.index)) || /\b(till|until|through|to) (today|now|date)\b/.test(t)) {
        return a > today ? { span: null, error: `${niceDay(a)} is in the future.` } : span(a, today, `${niceDay(a)} to today`);
      }
      return span(a, a, niceDay(a));
    }
    if (b < a) return { span: null, error: `The end date (${niceDay(b)}) is before the start date (${niceDay(a)}).` };
    return span(a, b, niceRange(a, b));
  }

  // ---- "past 37 days", "last 3 months", "previous two weeks"
  const rel = new RegExp(`\\b(?:past|last|previous|prev|recent|trailing)\\s+(\\d+|${W})\\s*(day|week|month|year|fortnight)s?\\b`).exec(t);
  if (rel) {
    const n = num(rel[1]!)!;
    if (n < 1 || n > 1200) return { span: null, error: 'Please use a number of days, weeks or months between 1 and 1,200.' };
    const unit = rel[2]!;
    const days = unit === 'day' ? n : unit === 'week' ? n * 7 : unit === 'fortnight' ? n * 14 : 0;
    const from = days ? addDays(today, -(days - 1)) : addDays(addMonths(today, -(unit === 'year' ? n * 12 : n)), 1);
    return span(from, today, `the past ${n} ${unit}${n === 1 ? '' : 's'}`);
  }
  const nxt = new RegExp(`\\bnext\\s+(\\d+|${W})\\s*(day|week|month|fortnight)s?\\b`).exec(t);
  if (nxt) {
    const n = num(nxt[1]!)!;
    if (n < 1 || n > 1200) return { span: null, error: 'Please use a number of days, weeks or months between 1 and 1,200.' };
    const unit = nxt[2]!;
    const days = unit === 'day' ? n : unit === 'week' ? n * 7 : unit === 'fortnight' ? n * 14 : 0;
    const to = days ? addDays(today, days - 1) : addDays(addMonths(today, n), -1);
    return span(today, to, `the next ${n} ${unit}${n === 1 ? '' : 's'}`);
  }
  if (/\b(?:past|last) (?:fortnight)\b/.test(t)) return span(addDays(today, -13), today, 'the past 14 days');
  const trailing = /\bpast (day|week|month|year)\b/.exec(t);
  if (trailing) {
    const u = trailing[1]!;
    return span(u === 'day' ? today : u === 'week' ? addDays(today, -6) : addDays(addMonths(today, u === 'month' ? -1 : -12), 1), today, `the past ${u}`);
  }

  // ---- named periods
  if (/\bday before yesterday\b/.test(t)) { const d = addDays(today, -2); return span(d, d, niceDay(d)); }
  if (/\byesterday\b/.test(t)) { const d = addDays(today, -1); return span(d, d, 'yesterday'); }
  if (/\b(today|tonight|this morning|this evening|this afternoon)\b/.test(t)) return span(today, today, 'today');
  if (/\btomorrow\b/.test(t)) { const d = addDays(today, 1); return span(d, d, 'tomorrow'); }

  const weekMon = monday(today);
  if (/\bthis weekend\b/.test(t)) { const sat = addDays(weekMon, 5); return span(dayOfWeek(today) === 0 ? addDays(sat, 1) : sat, addDays(sat, 1), 'this weekend'); }
  if (/\blast weekend\b/.test(t)) { const sat = addDays(weekMon, -2); return span(sat, addDays(sat, 1), 'last weekend'); }
  if (/\bnext weekend\b/.test(t)) { const sat = addDays(weekMon, 12); return span(sat, addDays(sat, 1), 'next weekend'); }
  if (/\bthis week\b/.test(t)) return span(weekMon, addDays(weekMon, 6), 'this week');
  if (/\blast week\b/.test(t)) return span(addDays(weekMon, -7), addDays(weekMon, -1), 'last week');
  if (/\bnext week\b/.test(t)) return span(addDays(weekMon, 7), addDays(weekMon, 13), 'next week');

  const thisMonth = monthRange(today.slice(0, 7))!;
  if (/\bthis month\b|\bmonth to date\b|\bmtd\b/.test(t)) return span(thisMonth.from, thisMonth.to, 'this month');
  if (/\blast month\b|\bprevious month\b/.test(t)) { const r = monthRange(addMonths(thisMonth.from, -1).slice(0, 7))!; return span(r.from, r.to, 'last month'); }
  if (/\bnext month\b/.test(t)) { const r = monthRange(addMonths(thisMonth.from, 1).slice(0, 7))!; return span(r.from, r.to, 'next month'); }

  const fy = financialYear(today);
  const fyStart = Number(fy.from.slice(0, 4));
  const fq = fyQuarter(today);
  const q = /\bq([1-4])\b/.exec(t);
  if (q) { const r = quarterRange(fyStart, Number(q[1])); return span(r.from, r.to, `Q${q[1]} of the financial year ${fyStart}-${String(fyStart + 1).slice(2)}`); }
  if (/\bthis quarter\b/.test(t)) { const r = quarterRange(fq.fy, fq.q); return span(r.from, r.to, 'this quarter'); }
  if (/\blast quarter\b|\bprevious quarter\b/.test(t)) { const p = fq.q === 1 ? { fy: fq.fy - 1, q: 4 } : { fy: fq.fy, q: fq.q - 1 }; const r = quarterRange(p.fy, p.q); return span(r.from, r.to, 'last quarter'); }

  if (/\b(last|previous|prior) (financial|fiscal) year\b|\blast fy\b|\bprevious fy\b/.test(t)) return span(`${fyStart - 1}-04-01`, `${fyStart}-03-31`, `the last financial year (${fyStart - 1}-${String(fyStart).slice(2)})`);
  if (/\b(this|current) (financial|fiscal) year\b|\bthis fy\b|\bcurrent fy\b|\bfinancial year\b|\bfiscal year\b|\bfy to date\b|\bytd\b|\byear to date\b/.test(t)) return span(fy.from, fy.to, `this financial year (${fyStart}-${String(fyStart + 1).slice(2)})`);
  if (/\blast year\b|\bprevious year\b/.test(t)) { const y = Number(today.slice(0, 4)) - 1; return span(`${y}-01-01`, `${y}-12-31`, String(y)); }
  if (/\bthis year\b|\bcalendar year\b/.test(t)) { const y = today.slice(0, 4); return span(`${y}-01-01`, `${y}-12-31`, `this year (${y})`); }
  if (/\ball time\b|\bever\b|\bsince (the )?(start|beginning|opening|launch)\b|\boverall\b|\bin total\b|\bso far\b|\bto date\b/.test(t)) return span('1970-01-01', today, 'all time');

  // ---- a month by name: "in September", "october 2025". "may" alone is a verb, so it needs a year or a word like "in" before it.
  const mm = new RegExp(`\\b(?:(?:in|for|during|of|from|month of)\\s+)?(${MONTH_RE})(?:\\s+(\\d{4}))?\\b`).exec(t);
  if (mm && (mm[1] !== 'may' || mm[2] || /\b(in|for|during|of|month of) may\b/.test(t))) {
    const mo = MONTHS[mm[1]!]!;
    const cm = Number(today.slice(5, 7)), cy = Number(today.slice(0, 4));
    const y = mm[2] ? +mm[2] : prefer === 'future' ? (mo >= cm ? cy : cy + 1) : (mo <= cm ? cy : cy - 1);
    const r = monthRange(`${y}-${pad(mo)}`)!;
    return span(r.from, r.to, `${MONTH_NAMES[mo - 1]} ${y}`);
  }
  const yr = /\b(?:in|for|during|of)\s+(20\d{2})\b/.exec(t);
  if (yr) return span(`${yr[1]}-01-01`, `${yr[1]}-12-31`, yr[1]!);
  return { span: null };
}
