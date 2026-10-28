import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Consent, Role, StaffPermission, User } from '@daji/shared';
import { STAFF_PERMISSIONS } from '@daji/shared';
import { checkCode, mfaEnabled } from './mfa.ts';
import { many, one, run, registerSchema } from './db.ts';
import { normalizeIntlPhone } from './input.ts';
import { splitName, titleCase } from './names.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { HttpError, forbidden } from './errors.ts';
import { aiNameFor, aiNameNotice, ownAiName } from './aiNames.ts';
import type { Config } from './config.ts';

// First and last name are kept apart so the admin can edit them; `name` stays the two joined.
registerSchema('names-1', `ALTER TABLE users ADD COLUMN first_name TEXT;
ALTER TABLE users ADD COLUMN last_name TEXT;`);

registerSchema('avatar-1', `ALTER TABLE users ADD COLUMN avatar_id TEXT;
ALTER TABLE users ADD COLUMN avatar_ext TEXT;
ALTER TABLE users ADD COLUMN avatar_mime TEXT;`);

// A team member the owner has marked "Read only" sees their role's screens but cannot change anything (server/src/readOnly.ts).
registerSchema('staff-read-only-1', `ALTER TABLE users ADD COLUMN read_only INTEGER NOT NULL DEFAULT 0;`);

export interface UserRow {
  id: string; role: Role; name: string; email: string | null; phone: string | null; password_hash: string | null;
  owner_id: string | null; permissions: string; active: number;
  consent_email: number; consent_sms: number; consent_whatsapp: number; consent_updated_at: number | null;
  business_name: string | null; upi_id: string | null; token_version: number; created_at: number; updated_at: number;
  first_name: string | null; last_name: string | null;
  avatar_id: string | null; avatar_ext: string | null; avatar_mime: string | null;
  read_only: number;
}

// ---- passwords (scrypt) ----
export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const dk = scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$${salt.toString('base64')}$${dk.toString('base64')}`;
}
export function verifyPassword(pw: string, stored: string | null): boolean {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[2]!, 'base64');
  const want = Buffer.from(parts[3]!, 'base64');
  const got = scryptSync(pw, salt, want.length, { N: Number(parts[1]), r: 8, p: 1 });
  return got.length === want.length && timingSafeEqual(got, want);
}

// ---- tokens (HS256 JWT) ----
const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
export interface TokenPayload { sub: string; role: Role; tv: number; iat: number; exp: number; jti?: string }

// Signing out is enforced here, not just in the browser: the token's id goes on a revoked list until the token would have expired anyway.
registerSchema('revoked-tokens-1', `
CREATE TABLE revoked_tokens (
  jti TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER NOT NULL
);
CREATE INDEX ix_revoked_tokens_exp ON revoked_tokens(expires_at);
`);

/** Revokes the token in an Authorization header. Returns false if it was not a valid token. Old tokens with no id are cut off by bumping the user's token version. */
export function revokeToken(cfg: Config, header: string | undefined): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const p = verifyToken(cfg, header.slice(7).trim());
  if (!p) return false;
  const who = userRow(p.sub);
  if (!who || who.token_version !== p.tv) return true; // already dead: nothing to revoke, and an old token cannot sign anyone out
  const t = now();
  run('DELETE FROM revoked_tokens WHERE expires_at < ?', Math.floor(t / 1000));
  if (p.jti) run('INSERT OR IGNORE INTO revoked_tokens(jti, user_id, expires_at, revoked_at) VALUES(?,?,?,?)', p.jti, p.sub, p.exp, t);
  else run('UPDATE users SET token_version = token_version + 1 WHERE id = ?', p.sub);
  return true;
}
/** Signs the person out of every device. */
export function revokeAllTokens(userId: string): void {
  run('UPDATE users SET token_version = token_version + 1, updated_at = ? WHERE id = ?', now(), userId);
}

export function signToken(cfg: Config, u: { id: string; role: Role; token_version: number }): string {
  const iat = Math.floor(now() / 1000);
  const body: TokenPayload = { sub: u.id, role: u.role, tv: u.token_version, iat, exp: iat + cfg.jwtTtlDays * 86400, jti: randomBytes(12).toString('base64url') };
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const pl = b64u(JSON.stringify(body));
  const sig = createHmac('sha256', cfg.jwtSecret).update(`${head}.${pl}`).digest('base64url');
  return `${head}.${pl}.${sig}`;
}

export function verifyToken(cfg: Config, token: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  try {
    if (JSON.parse(Buffer.from(h, 'base64url').toString()).alg !== 'HS256') return null;
  } catch { return null; }
  const want = createHmac('sha256', cfg.jwtSecret).update(`${h}.${p}`).digest();
  const got = Buffer.from(s, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const pl = JSON.parse(Buffer.from(p, 'base64url').toString()) as TokenPayload;
    if (typeof pl.exp !== 'number' || pl.exp * 1000 < now()) return null;
    return pl;
  } catch { return null; }
}

// ---- users ----
export function toUser(r: UserRow): User {
  const perms = permissionList(r.permissions).filter((p): p is StaffPermission => (STAFF_PERMISSIONS as readonly string[]).includes(p));
  const consent: Consent = { email: !!r.consent_email, sms: !!r.consent_sms, whatsapp: !!r.consent_whatsapp, updatedAt: r.consent_updated_at };
  return {
    id: r.id, role: r.role, name: r.name, firstName: r.first_name ?? splitName(r.name).first, lastName: r.last_name ?? splitName(r.name).last, email: r.email, phone: r.phone, ownerId: r.owner_id,
    permissions: perms, active: !!r.active, consent, businessName: r.business_name, upiId: r.upi_id, createdAt: r.created_at,
    avatarUrl: r.avatar_id ? `/api/avatar/${r.avatar_id}` : null, hasPassword: !!r.password_hash,
    aiName: aiNameFor(r.id), aiNameOwn: ownAiName(r.id), aiNameNotice: aiNameNotice(r.id),
    readOnly: isReadOnly(r),
  };
}
export const userRow = (id: string): UserRow | undefined => one<UserRow>('SELECT * FROM users WHERE id = ?', id);
export const userByPhone = (phone: string): UserRow | undefined => one<UserRow>("SELECT * FROM users WHERE phone = ? AND role = 'customer' ORDER BY created_at LIMIT 1", phone);
export const userByEmail = (email: string): UserRow | undefined => one<UserRow>('SELECT * FROM users WHERE lower(email) = lower(?)', email);

export interface NewUser {
  role: Role; name: string; firstName?: string; lastName?: string; email?: string | null; phone?: string | null; password?: string | null;
  ownerId?: string | null; permissions?: StaffPermission[]; businessName?: string | null; upiId?: string | null;
}
export function createUser(n: NewUser): UserRow {
  if (n.email && userByEmail(n.email)) throw new HttpError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
  const id = newId('usr');
  const t = now();
  const parts = n.firstName ? { first: titleCase(n.firstName), last: titleCase(n.lastName ?? '') } : (() => { const x = splitName(titleCase(n.name)); return { first: x.first, last: x.last }; })();
  const fullName = [parts.first, parts.last].filter(Boolean).join(' ') || n.name;
  run(
    `INSERT INTO users(id, role, name, first_name, last_name, email, phone, password_hash, owner_id, permissions, business_name, upi_id, created_at, updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, n.role, fullName, parts.first, parts.last, n.email ?? null, n.phone ?? null, n.password ? hashPassword(n.password) : null,
    n.ownerId ?? null, JSON.stringify(n.permissions ?? []), n.businessName ?? null, n.upiId ?? null, t, t,
  );
  return userRow(id)!;
}

export function setPassword(userId: string, pw: string): void {
  run('UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = ? WHERE id = ?', hashPassword(pw), now(), userId);
}

export function checkPasswordStrength(pw: string): string | null {
  if (pw.length < 8) return 'At least 8 characters';
  if (pw.length > 200) return 'Too long';
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) return 'Use a capital letter, a small letter and a number';
  return null;
}

// A dummy hash so that unknown emails cost the same time as wrong passwords.
const DUMMY = hashPassword('not-a-real-password-1');

/** Accounts that can be meant by a sign-in name: an email address, or a mobile number (owners and staff before customers). */
function candidatesFor(identifier: string, countryCode?: string): UserRow[] {
  const id = identifier.trim();
  if (id.includes('@')) { const r = userByEmail(id); return r ? [r] : []; }
  const phone = normalizeIntlPhone(id, countryCode);
  return phone ? many<UserRow>("SELECT * FROM users WHERE phone = ? AND password_hash IS NOT NULL ORDER BY (role = 'customer'), created_at", phone) : [];
}

registerSchema('login-lock-1', `CREATE TABLE login_attempts (key TEXT PRIMARY KEY, fails INTEGER NOT NULL, first_at INTEGER NOT NULL);`);
const LOCK_FAILS = 10, LOCK_WINDOW_MS = 15 * 60_000;
/** Wrong passwords or 2FA codes for one account are counted whatever the IP address, so a guessing attack spread over many addresses is stopped too. */
function lockCheck(key: string): void {
  const r = one<{ fails: number; first_at: number }>('SELECT fails, first_at FROM login_attempts WHERE key = ?', key);
  if (!r) return;
  if (now() - r.first_at > LOCK_WINDOW_MS) { run('DELETE FROM login_attempts WHERE key = ?', key); return; }
  if (r.fails >= LOCK_FAILS) throw new HttpError(429, 'ACCOUNT_LOCKED', `Too many wrong attempts. Try again in ${Math.max(1, Math.ceil((r.first_at + LOCK_WINDOW_MS - now()) / 60_000))} minutes.`);
}
function lockFail(key: string): void {
  run('INSERT INTO login_attempts(key, fails, first_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET fails = CASE WHEN ? - first_at > ? THEN 1 ELSE fails + 1 END, first_at = CASE WHEN ? - first_at > ? THEN ? ELSE first_at END', key, now(), now(), LOCK_WINDOW_MS, now(), LOCK_WINDOW_MS, now());
}

/** Sign in with an email address or a mobile number, and the password. `countryCode` is for a number written without its +code (default +91). */
export function login(cfg: Config, identifier: string, password: string, code?: string, countryCode?: string): { token: string; user: User } {
  // The same person can write a number many ways, so the lock is kept on the cleaned-up email or number, not on the raw text.
  const lockKey = (identifier.includes('@') ? identifier.trim().toLowerCase() : (normalizeIntlPhone(identifier, countryCode) ?? identifier.trim().toLowerCase())).slice(0, 120);
  lockCheck(lockKey);
  const found = candidatesFor(identifier, countryCode);
  let r = found[0], ok = false;
  for (const c of found) if (c.password_hash && verifyPassword(password, c.password_hash)) { r = c; ok = true; break; }
  if (!ok && !found.some((c) => c.password_hash)) verifyPassword(password, DUMMY); // same time whether or not the account exists
  if (!r || !ok || !r.password_hash) { lockFail(lockKey); throw new HttpError(401, 'INVALID_LOGIN', 'Email, mobile number or password is not right'); }
  if (!r.active) throw new HttpError(403, 'ACCOUNT_DISABLED', 'This account has been disabled');
  if (mfaEnabled(r.id)) {
    if (!code) throw new HttpError(401, 'MFA_REQUIRED', 'Enter the 6 digit code from your authenticator app');
    if (!checkCode(r.id, code, { requireEnabled: true })) { lockFail(lockKey); throw new HttpError(401, 'MFA_INVALID', 'That code is not right or has already been used. Wait for the next one.'); }
  }
  run('DELETE FROM login_attempts WHERE key = ?', lockKey);
  return { token: signToken(cfg, r), user: toUser(r) };
}

/** Resolves the Authorization header to an active user, or null. */
export function authenticate(cfg: Config, header: string | undefined): UserRow | null {
  if (!header || !header.startsWith('Bearer ')) return null;
  const p = verifyToken(cfg, header.slice(7).trim());
  if (!p) return null;
  const r = userRow(p.sub);
  if (!r || !r.active || r.token_version !== p.tv) return null;
  if (r.role === 'staff' && r.owner_id && !one('SELECT 1 FROM users WHERE id = ? AND active = 1', r.owner_id)) return null; // their business has been switched off
  if (p.jti && one('SELECT 1 FROM revoked_tokens WHERE jti = ?', p.jti)) return null;
  return r;
}

// ---- permissions ----
/** The rights written on a team member's record. Anything that is not a plain list of text (a damaged or hand-edited record) grants nothing: access fails closed. */
export function permissionList(raw: string | null | undefined): string[] {
  try {
    const v: unknown = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}
/** A team member marked "Read only" by the owner. Only team members can be: an owner or admin is never read only. */
export const isReadOnly = (u: Pick<UserRow, 'role' | 'read_only'>): boolean => u.role === 'staff' && u.read_only === 1;
export function hasPermission(u: UserRow, perm: StaffPermission): boolean {
  if (u.role === 'super_admin' || u.role === 'owner') return true;
  if (u.role !== 'staff') return false;
  return permissionList(u.permissions).includes(perm);
}
/**
 * Revenue, profit, the books and the money reports. A team member sees none of it unless the owner has switched on
 * "Can see revenue" for them, whatever else they are allowed to do.
 */
export const canSeeRevenue = (u: UserRow): boolean => hasPermission(u, 'view_revenue');
export function requireRevenue(u: UserRow): void {
  if (!canSeeRevenue(u)) throw forbidden('Revenue is hidden from your login. Ask the owner to switch on "Can see revenue".');
}
export function requirePermission(u: UserRow, perm: StaffPermission): void {
  if (!hasPermission(u, perm)) throw forbidden(`This needs the "${perm}" permission`);
}
/** The owner whose data a user works on: owners are themselves, staff their employer. Null for admin/customer. */
export function scopeOwnerId(u: UserRow): string | null {
  if (u.role === 'owner') return u.id;
  if (u.role === 'staff') return u.owner_id;
  return null;
}
export function listStaff(ownerId: string): UserRow[] {
  return many<UserRow>("SELECT * FROM users WHERE role='staff' AND owner_id = ? ORDER BY created_at", ownerId);
}
