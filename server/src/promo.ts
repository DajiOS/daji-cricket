import { many, one, run, registerSchema } from './db.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { HttpError, notFound } from './errors.ts';
import { istDate } from './time.ts';
import { Validator } from './input.ts';
import { formatPaise } from '@daji/shared';
import { audit } from './audit.ts';
import type { UserRow } from './auth.ts';

registerSchema('promo-1', `CREATE TABLE promo_codes (
  id TEXT PRIMARY KEY, owner_id TEXT, code TEXT NOT NULL UNIQUE, label TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('percent','flat')), value INTEGER NOT NULL,
  max_discount_paise INTEGER, min_total_paise INTEGER NOT NULL DEFAULT 0,
  valid_from TEXT, valid_to TEXT, usage_limit INTEGER, per_customer_limit INTEGER NOT NULL DEFAULT 1,
  ground_id TEXT, active INTEGER NOT NULL DEFAULT 1, created_by TEXT, created_at INTEGER NOT NULL
);
ALTER TABLE bookings ADD COLUMN promo_code TEXT;
ALTER TABLE bookings ADD COLUMN discount_paise INTEGER NOT NULL DEFAULT 0;`);

export interface PromoRow {
  id: string; owner_id: string | null; code: string; label: string | null; kind: 'percent' | 'flat'; value: number; max_discount_paise: number | null;
  min_total_paise: number; valid_from: string | null; valid_to: string | null; usage_limit: number | null; per_customer_limit: number; ground_id: string | null; active: number; created_by: string | null; created_at: number;
}
export interface Promo {
  id: string; code: string; label: string | null; kind: 'percent' | 'flat'; value: number; maxDiscountPaise: number | null; minTotalPaise: number;
  validFrom: string | null; validTo: string | null; usageLimit: number | null; perCustomerLimit: number; groundId: string | null; ownerId: string | null; active: boolean; used: number; createdAt: number;
}

const USED_SQL = "status IN ('held','confirmed','completed','no_show')";
const usedCount = (code: string): number => one<{ n: number }>(`SELECT COUNT(*) n FROM bookings WHERE promo_code = ? AND ${USED_SQL}`, code)!.n;
const toPromo = (r: PromoRow): Promo => ({ id: r.id, code: r.code, label: r.label, kind: r.kind, value: r.value, maxDiscountPaise: r.max_discount_paise, minTotalPaise: r.min_total_paise, validFrom: r.valid_from, validTo: r.valid_to, usageLimit: r.usage_limit, perCustomerLimit: r.per_customer_limit, groundId: r.ground_id, ownerId: r.owner_id, active: !!r.active, used: usedCount(r.code), createdAt: r.created_at });

export const normCode = (s: string): string => s.trim().toUpperCase().replace(/\s+/g, '');

/** Works out the discount for a code on a booking total, or throws a message the customer can act on. */
export function evaluatePromo(codeIn: string, ground: { id: string; owner_id: string }, customerId: string, totalPaise: number, at = now()): { promo: PromoRow; discountPaise: number } {
  const code = normCode(codeIn);
  const p = one<PromoRow>('SELECT * FROM promo_codes WHERE code = ?', code);
  const bad = (m: string): never => { throw new HttpError(400, 'PROMO_INVALID', m); };
  if (!p || !p.active) return bad('That promo code is not valid.');
  if (p.owner_id && p.owner_id !== ground.owner_id) return bad('That promo code does not apply at this ground.');
  if (p.ground_id && p.ground_id !== ground.id) return bad('That promo code does not apply at this ground.');
  const today = istDate(at);
  if (p.valid_from && today < p.valid_from) return bad('That promo code is not active yet.');
  if (p.valid_to && today > p.valid_to) return bad('That promo code has expired.');
  if (totalPaise < p.min_total_paise) return bad(`This code needs a booking of at least ${formatPaise(p.min_total_paise)}.`);
  if (p.usage_limit !== null && usedCount(p.code) >= p.usage_limit) return bad('That promo code has been fully used.');
  const mine = one<{ n: number }>(`SELECT COUNT(*) n FROM bookings WHERE promo_code = ? AND customer_id = ? AND ${USED_SQL}`, p.code, customerId)!.n;
  if (mine >= p.per_customer_limit) return bad('You have already used this promo code.');
  let d = p.kind === 'percent' ? Math.floor(totalPaise * p.value / 100) : p.value;
  if (p.max_discount_paise !== null) d = Math.min(d, p.max_discount_paise);
  d = Math.min(d, totalPaise);
  if (d <= 0) return bad('This code gives no discount on this booking.');
  return { promo: p, discountPaise: d };
}

function scopeOwner(u: UserRow): string | null { return u.role === 'super_admin' ? null : u.id; }

export function listPromos(u: UserRow): Promo[] {
  const rows = u.role === 'super_admin' ? many<PromoRow>('SELECT * FROM promo_codes ORDER BY created_at DESC') : many<PromoRow>('SELECT * FROM promo_codes WHERE owner_id = ? ORDER BY created_at DESC', u.id);
  return rows.map(toPromo);
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I so a code read out over the phone is not mistaken
function generateCode(prefix: string): string {
  for (let tries = 0; tries < 50; tries++) {
    let tail = '';
    for (let i = 0; i < 6; i++) tail += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    const code = (prefix ? prefix + '-' : '') + tail;
    if (!one('SELECT 1 FROM promo_codes WHERE code = ?', code)) return code;
  }
  throw new HttpError(500, 'CODE_GENERATION_FAILED', 'Could not generate a unique code. Try a different prefix.');
}

/** Creates one code typed by hand, or (auto: true) one or more generated codes that share the same rules. */
export function createPromos(u: UserRow, body: unknown): Promo[] {
  const v0 = new Validator(body);
  const auto = !!v0.bool('auto');
  const count = auto ? (v0.int('count', { min: 1, max: 50 }) ?? 1) : 1;
  const prefix = normCode(v0.str('prefix', { max: 10 }) ?? '');
  v0.done();
  if (prefix && !/^[A-Z0-9_]{1,10}$/.test(prefix)) throw new HttpError(400, 'VALIDATION_FAILED', 'A prefix is letters and numbers only', { fields: [{ field: 'prefix', message: 'Letters and numbers only' }] });
  const raw = { ...((body ?? {}) as Record<string, unknown>) };
  if (raw.oneTime === true) { raw.usageLimit = 1; raw.perCustomerLimit = 1; } // a single-use code: whoever redeems it first uses it up
  const out: Promo[] = [];
  for (let i = 0; i < count; i++) out.push(createPromo(u, auto ? { ...raw, code: generateCode(prefix) } : raw));
  return out;
}

export function createPromo(u: UserRow, body: unknown): Promo {
  const v = new Validator(body);
  const code = normCode(v.str('code', { required: true, min: 3, max: 20 }) ?? '');
  const label = v.str('label', { max: 80 });
  const kind = v.oneOf('kind', ['percent', 'flat'] as const, true)!;
  const value = v.int('value', { required: true, min: 1, max: 100_000_00 })!;
  const maxDiscountPaise = v.int('maxDiscountPaise', { min: 1 });
  const minTotalPaise = v.int('minTotalPaise', { min: 0 }) ?? 0;
  const validFrom = v.date('validFrom'), validTo = v.date('validTo');
  const usageLimit = v.int('usageLimit', { min: 1 });
  const perCustomerLimit = v.int('perCustomerLimit', { min: 1, max: 100 }) ?? 1;
  const groundId = v.str('groundId', { max: 60 });
  v.done();
  if (!/^[A-Z0-9_-]{3,20}$/.test(code)) throw new HttpError(400, 'VALIDATION_FAILED', 'A code is 3 to 20 letters, numbers, - or _', { fields: [{ field: 'code', message: 'Letters and numbers only' }] });
  if (kind === 'percent' && value > 100) throw new HttpError(400, 'VALIDATION_FAILED', 'A percentage is 1 to 100', { fields: [{ field: 'value', message: '1 to 100' }] });
  if (validFrom && validTo && validTo < validFrom) throw new HttpError(400, 'VALIDATION_FAILED', 'The end date is before the start date', { fields: [{ field: 'validTo', message: 'Before the start' }] });
  let ownerId = scopeOwner(u);
  if (groundId) {
    const g = one<{ owner_id: string }>('SELECT owner_id FROM grounds WHERE id = ?', groundId);
    if (!g || (ownerId && g.owner_id !== ownerId)) throw notFound('Ground not found');
    ownerId = g.owner_id;
  }
  if (one('SELECT 1 FROM promo_codes WHERE code = ?', code)) throw new HttpError(409, 'PROMO_EXISTS', 'That code already exists. Choose another.');
  const id = newId('promo');
  run('INSERT INTO promo_codes(id, owner_id, code, label, kind, value, max_discount_paise, min_total_paise, valid_from, valid_to, usage_limit, per_customer_limit, ground_id, active, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)',
    id, ownerId, code, label ?? null, kind, value, kind === 'percent' ? (maxDiscountPaise ?? null) : null, minTotalPaise, validFrom ?? null, validTo ?? null, usageLimit ?? null, perCustomerLimit, groundId ?? null, u.id, now());
  audit({ id: u.id, role: u.role }, 'promo.create', 'promo', id, { code, kind, value }, ownerId);
  return toPromo(one<PromoRow>('SELECT * FROM promo_codes WHERE id = ?', id)!);
}

export function setPromoActive(u: UserRow, id: string, active: boolean): Promo {
  const p = one<PromoRow>('SELECT * FROM promo_codes WHERE id = ?', id);
  if (!p || (u.role !== 'super_admin' && p.owner_id !== u.id)) throw notFound('Promo code not found');
  run('UPDATE promo_codes SET active = ? WHERE id = ?', active ? 1 : 0, id);
  audit({ id: u.id, role: u.role }, active ? 'promo.enable' : 'promo.disable', 'promo', id, { code: p.code }, p.owner_id);
  return toPromo({ ...p, active: active ? 1 : 0 });
}
