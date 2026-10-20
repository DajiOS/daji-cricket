import type { FieldProblem } from '@daji/shared';
import { HttpError } from './errors.ts';
import { isValidDate, minutesOf } from './time.ts';

type Obj = Record<string, unknown>;

/** Collects every problem in a request body, then throws one VALIDATION_FAILED with details.fields[]. */
export class Validator {
  readonly fields: FieldProblem[] = [];
  readonly src: Obj;
  constructor(src: unknown) {
    if (src === null || typeof src !== 'object' || Array.isArray(src)) {
      throw new HttpError(400, 'VALIDATION_FAILED', 'Send a JSON object', { fields: [{ field: '(body)', message: 'Expected a JSON object' }] });
    }
    this.src = src as Obj;
  }
  fail(field: string, message: string): void {
    this.fields.push({ field, message });
  }
  has(key: string): boolean {
    return this.src[key] !== undefined && this.src[key] !== null;
  }
  str(key: string, o: { min?: number; max?: number; required?: boolean; trim?: boolean } = {}): string | undefined {
    const v = this.src[key];
    if (v === undefined || v === null || v === '') {
      if (o.required) this.fail(key, 'Required');
      return undefined;
    }
    if (typeof v !== 'string') { this.fail(key, 'Must be text'); return undefined; }
    const s = o.trim === false ? v : v.trim();
    if (o.min !== undefined && s.length < o.min) { this.fail(key, `At least ${o.min} characters`); return undefined; }
    if (o.max !== undefined && s.length > o.max) { this.fail(key, `At most ${o.max} characters`); return undefined; }
    return s;
  }
  int(key: string, o: { min?: number; max?: number; required?: boolean } = {}): number | undefined {
    const v = this.src[key];
    if (v === undefined || v === null || v === '') {
      if (o.required) this.fail(key, 'Required');
      return undefined;
    }
    if (typeof v !== 'number' || !Number.isInteger(v)) { this.fail(key, 'Must be a whole number'); return undefined; }
    if (o.min !== undefined && v < o.min) { this.fail(key, `Must be at least ${o.min}`); return undefined; }
    if (o.max !== undefined && v > o.max) { this.fail(key, `Must be at most ${o.max}`); return undefined; }
    return v;
  }
  num(key: string, o: { min?: number; max?: number; required?: boolean } = {}): number | undefined {
    const v = this.src[key];
    if (v === undefined || v === null || v === '') {
      if (o.required) this.fail(key, 'Required');
      return undefined;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) { this.fail(key, 'Must be a number'); return undefined; }
    if (o.min !== undefined && v < o.min) { this.fail(key, `Must be at least ${o.min}`); return undefined; }
    if (o.max !== undefined && v > o.max) { this.fail(key, `Must be at most ${o.max}`); return undefined; }
    return v;
  }
  bool(key: string, required = false): boolean | undefined {
    const v = this.src[key];
    if (v === undefined || v === null) {
      if (required) this.fail(key, 'Required');
      return undefined;
    }
    if (typeof v !== 'boolean') { this.fail(key, 'Must be true or false'); return undefined; }
    return v;
  }
  oneOf<T extends string>(key: string, allowed: readonly T[], required = false): T | undefined {
    const v = this.src[key];
    if (v === undefined || v === null || v === '') {
      if (required) this.fail(key, 'Required');
      return undefined;
    }
    if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
      this.fail(key, `Must be one of: ${allowed.join(', ')}`);
      return undefined;
    }
    return v as T;
  }
  date(key: string, required = false): string | undefined {
    const v = this.src[key];
    if (v === undefined || v === null || v === '') {
      if (required) this.fail(key, 'Required');
      return undefined;
    }
    if (!isValidDate(v)) { this.fail(key, 'Must be a date like 2026-10-21'); return undefined; }
    return v;
  }
  time(key: string, required = false): string | undefined {
    const v = this.src[key];
    if (v === undefined || v === null || v === '') {
      if (required) this.fail(key, 'Required');
      return undefined;
    }
    if (minutesOf(v) === null) { this.fail(key, 'Must be a time like 18:30'); return undefined; }
    return v as string;
  }
  email(key: string, required = false): string | undefined {
    const v = this.str(key, { required, max: 120 });
    if (v === undefined) return undefined;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) { this.fail(key, 'Must be a valid email address'); return undefined; }
    return v.toLowerCase();
  }
  /** Indian mobile: 10 digits starting 6-9, optional +91 / 0 prefix. Returned as 10 digits. */
  phone(key: string, required = false): string | undefined {
    const v = this.str(key, { required, max: 20 });
    if (v === undefined) return undefined;
    const p = normalizePhone(v);
    if (!p) { this.fail(key, 'Must be a 10-digit Indian mobile number'); return undefined; }
    return p;
  }
  /**
   * A mobile number from any country, with the calling code taken from `countryKey` (default +91) unless the number is
   * written with its own +code. Indian numbers come back as 10 digits, the way they are stored everywhere; others as +E.164.
   */
  intlPhone(key: string, required = false, countryKey = 'countryCode'): string | undefined {
    const v = this.str(key, { required, max: 24 });
    if (v === undefined) return undefined;
    const cc = this.src[countryKey];
    if (cc !== undefined && cc !== null && cc !== '' && (typeof cc !== 'string' || !COUNTRY_CODE_RE.test(cc.trim()))) { this.fail(countryKey, 'Must be a country code like +91'); return undefined; }
    const p = normalizeIntlPhone(v, typeof cc === 'string' && cc.trim() ? cc : undefined);
    if (!p) { this.fail(key, 'Must be a valid mobile number for the country code'); return undefined; }
    return p;
  }
  strArray(key: string, o: { max?: number; itemMax?: number } = {}): string[] | undefined {
    const v = this.src[key];
    if (v === undefined || v === null) return undefined;
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) { this.fail(key, 'Must be a list of text'); return undefined; }
    if (o.max !== undefined && v.length > o.max) { this.fail(key, `At most ${o.max} items`); return undefined; }
    if (o.itemMax !== undefined && v.some((x: string) => x.length > o.itemMax!)) { this.fail(key, `Each item at most ${o.itemMax} characters`); return undefined; }
    return v.map((x: string) => x.trim()).filter(Boolean);
  }
  done(): void {
    if (this.fields.length) throw new HttpError(400, 'VALIDATION_FAILED', 'Some fields are not valid', { fields: this.fields });
  }
}

export function normalizePhone(raw: string): string | null {
  const d = raw.replace(/[\s()-]/g, '');
  const m = /^(?:\+?91|0)?([6-9]\d{9})$/.exec(d);
  return m ? m[1]! : null;
}

const COUNTRY_CODE_RE = /^\+?[1-9]\d{0,2}$/;

/**
 * Cleans up a mobile number from any country. `countryCode` (like "+44") is used when the number has no +code of its own;
 * it defaults to India. Indian numbers come back as their 10 digits, the form used across the app, so they still match bookings
 * made at the desk; every other number comes back in E.164 form, like +447911123456.
 */
export function normalizeIntlPhone(raw: string, countryCode = '+91'): string | null {
  let d = raw.replace(/[\s().-]/g, '');
  if (d.startsWith('00')) d = '+' + d.slice(2);
  if (d.startsWith('+')) {
    const all = d.slice(1);
    if (!/^\d+$/.test(all)) return null;
    if (all.startsWith('91')) return /^91[6-9]\d{9}$/.test(all) ? all.slice(2) : null;
    return /^[1-9]\d{7,14}$/.test(all) ? `+${all}` : null;
  }
  if (!COUNTRY_CODE_RE.test(countryCode.trim())) return null;
  const cc = countryCode.trim().replace(/^\+/, '');
  if (cc === '91') return normalizePhone(d);
  if (!/^\d+$/.test(d)) return null;
  const full = cc + d.replace(/^0+/, ''); // a leading 0 is the trunk prefix used inside the country, not part of the number
  return /^[1-9]\d{7,14}$/.test(full) ? `+${full}` : null;
}

export function pageParams(q: URLSearchParams, dflt = 25): { limit: number; offset: number } {
  const l = Number(q.get('limit') ?? dflt);
  const o = Number(q.get('offset') ?? 0);
  return {
    limit: Number.isInteger(l) ? Math.min(Math.max(l, 1), 200) : dflt,
    offset: Number.isInteger(o) ? Math.max(o, 0) : 0,
  };
}
