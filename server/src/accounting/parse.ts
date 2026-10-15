import { isValidDate } from '../time.ts';

// Text → numbers and dates, for bank statements. No floating point is used for money: amounts are read digit by digit.

export interface ParsedAmount {
  /** Always >= 0. */
  paise: number;
  /** An explicit minus sign, trailing minus or (brackets). */
  negative: boolean;
  /** A Dr/Cr marker attached to the number, if any. */
  marker: 'dr' | 'cr' | null;
}

const NO_AMOUNT = new Set(['', '-', '--', '—', 'na', 'n/a', 'nil', 'null', '.']);

/**
 * Reads amounts the way Indian bank statements write them:
 * "1,23,456.78", "(500.00)", "500.00 Dr", "Cr 1,000", "-250", "₹ 1,000.50", "Rs.100", "100.00-".
 * Returns null when the cell is empty or a dash, and `undefined` when it is not an amount at all.
 */
export function parseAmount(raw: unknown): ParsedAmount | null | undefined {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).replace(/[  ​]/g, ' ').trim();
  if (NO_AMOUNT.has(s.toLowerCase())) return null;
  let negative = false;
  let marker: 'dr' | 'cr' | null = null;

  const m1 = /^(dr|cr|d|c)\.?\s*(.*)$/i.exec(s);
  if (m1 && /\d/.test(m1[2]!)) { marker = /^d/i.test(m1[1]!) ? 'dr' : 'cr'; s = m1[2]!.trim(); }
  const m2 = /^(.*?)\s*(dr|cr|d|c)\.?$/i.exec(s);
  if (m2 && /\d/.test(m2[1]!) && !marker) { marker = /^d/i.test(m2[2]!) ? 'dr' : 'cr'; s = m2[1]!.trim(); }

  s = s.replace(/^(?:₹|rs\.?|inr)\s*/i, '').replace(/\s*(?:₹|rs\.?|inr)$/i, '').trim();
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1).trim(); }
  if (s.startsWith('-')) { negative = true; s = s.slice(1).trim(); }
  else if (s.startsWith('+')) s = s.slice(1).trim();
  if (s.endsWith('-')) { negative = true; s = s.slice(0, -1).trim(); }
  s = s.replace(/^(?:₹|rs\.?|inr)\s*/i, '');

  if (!/^[\d,\s]*\.?\d*$/.test(s) || !/\d/.test(s)) return undefined;
  const clean = s.replace(/[,\s]/g, '');
  const [whole = '', frac = ''] = clean.split('.');
  if (/^0*$/.test(frac.slice(2)) === false) return undefined; // more than two real decimal places is not rupees and paise
  const f2 = (frac + '00').slice(0, 2);
  const digits = (whole || '0').replace(/^0+(?=\d)/, '');
  if (digits.length > 13) return undefined; // beyond ₹1 trillion is not a bank statement
  return { paise: Number(digits) * 100 + Number(f2), negative, marker };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export type DateOrder = 'dmy' | 'mdy';

const pad = (n: number) => String(n).padStart(2, '0');
function fullYear(y: number, len: number): number {
  if (len >= 4) return y;
  return y + 2000; // bank statements are recent
}

/** Parses one date cell to YYYY-MM-DD. `order` only matters for numeric day/month forms like 03/04/2026. */
export function parseDate(raw: unknown, order: DateOrder = 'dmy'): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(s);
  if (m) return build(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-/. ]([A-Za-z]{3,9})[-/., ]+(\d{2,4})(?:[ T,].*)?$/.exec(s);
  if (m) {
    const mi = MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase());
    if (mi < 0) return null;
    return build(fullYear(Number(m[3]), m[3]!.length), mi + 1, Number(m[1]));
  }
  m = /^([A-Za-z]{3,9})[-/. ]+(\d{1,2})[,]?[-/. ]+(\d{2,4})(?:[ T,].*)?$/.exec(s);
  if (m) {
    const mi = MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase());
    if (mi < 0) return null;
    return build(fullYear(Number(m[3]), m[3]!.length), mi + 1, Number(m[2]));
  }
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:[ T,].*)?$/.exec(s);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    const y = fullYear(Number(m[3]), m[3]!.length);
    return order === 'dmy' ? build(y, b, a) : build(y, a, b);
  }
  return null;
}

function build(y: number, mo: number, d: number): string | null {
  const iso = `${y}-${pad(mo)}-${pad(d)}`;
  return y >= 1990 && y <= 2100 && isValidDate(iso) ? iso : null;
}

/** Looks at a column of date cells and decides whether 03/04/2026 means 3 April (India) or March 4 (US). */
export function detectDateOrder(samples: string[]): { order: DateOrder; ambiguous: boolean } {
  let dmy = 0, mdy = 0, both = 0;
  for (const s of samples) {
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})/.exec(s.trim());
    if (!m) continue;
    const a = Number(m[1]), b = Number(m[2]);
    if (a > 12 && b <= 12) dmy++;
    else if (b > 12 && a <= 12) mdy++;
    else if (a <= 12 && b <= 12 && a !== b) both++;
  }
  if (dmy === 0 && mdy > 0) return { order: 'mdy', ambiguous: false };
  if (mdy === 0 && dmy > 0) return { order: 'dmy', ambiguous: false };
  if (dmy > 0 && mdy > 0) return { order: 'dmy', ambiguous: true };
  return { order: 'dmy', ambiguous: both > 0 };
}

/** Spreadsheet serial day number → YYYY-MM-DD (1900 system, including Excel's phantom 29 Feb 1900). */
export function excelSerialToDate(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  const whole = Math.floor(serial);
  const days = whole > 59 ? whole - 1 : whole; // skip the non-existent 1900-02-29
  const d = new Date(Date.UTC(1899, 11, 31) + days * 86_400_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export const formatRupees = (paise: number): string => {
  const neg = paise < 0;
  const a = Math.abs(paise);
  return `${neg ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
};
