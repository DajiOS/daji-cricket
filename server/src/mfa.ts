import { seal, unseal } from './vault.ts';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { one, registerSchema, run } from './db.ts';
import { now } from './clock.ts';

// Optional two-step sign-in for owners, staff and the super admin: a 6 digit code from an authenticator app
// (Google Authenticator, Microsoft Authenticator, Authy...). RFC 6238 (TOTP, SHA-1, 30 second steps, 6 digits).

registerSchema('mfa-1', `
CREATE TABLE user_mfa (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  secret TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  last_step INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
`);

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf: Uint8Array): string {
  let bits = 0, value = 0, out = '';
  for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of s.toUpperCase().replace(/[\s=-]/g, '')) {
    const i = ALPHABET.indexOf(ch); if (i < 0) throw new Error('bad base32');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** The code for one 30 second step. `digits` is 6 for apps, 8 in some RFC test vectors. */
export function totp(secret: Buffer, step: number, digits = 6, algo: 'sha1' | 'sha256' | 'sha512' = 'sha1'): string {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac(algo, secret).update(msg).digest();
  const o = h[h.length - 1]! & 15;
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 10 ** digits).padStart(digits, '0');
}

const stepNow = () => Math.floor(now() / 30000);
const eq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

interface MfaRow { user_id: string; secret: string; enabled: number; last_step: number }
const row = (id: string) => one<MfaRow>('SELECT * FROM user_mfa WHERE user_id = ?', id);

export const mfaEnabled = (userId: string): boolean => row(userId)?.enabled === 1;

/** Checks a code (one step either side for clock drift). A code can be used once: the step is remembered. */
export function checkCode(userId: string, code: string, opts: { requireEnabled: boolean }): boolean {
  const r = row(userId);
  if (!r || (opts.requireEnabled && !r.enabled) || !/^\d{6}$/.test(code.trim())) return false;
  const secret = base32Decode(unseal(r.secret)), s = stepNow();
  for (const d of [0, -1, 1]) {
    const step = s + d;
    if (step <= r.last_step) continue;
    if (eq(totp(secret, step), code.trim())) { run('UPDATE user_mfa SET last_step = ? WHERE user_id = ?', step, userId); return true; }
  }
  return false;
}

/** Starts (or restarts) setup. Nothing changes at sign-in until the first code is confirmed. */
export function beginSetup(userId: string, accountName: string, issuer: string): { secret: string; otpauthUrl: string } {
  if (mfaEnabled(userId)) throw new Error('already enabled');
  const secret = base32Encode(randomBytes(20));
  run('INSERT INTO user_mfa(user_id, secret, enabled, last_step, created_at) VALUES(?,?,0,0,?) ON CONFLICT(user_id) DO UPDATE SET secret = excluded.secret, last_step = 0, created_at = excluded.created_at', userId, seal(secret), now());
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  return { secret, otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30` };
}
export function confirmSetup(userId: string, code: string): boolean {
  if (!checkCode(userId, code, { requireEnabled: false })) return false;
  run('UPDATE user_mfa SET enabled = 1 WHERE user_id = ?', userId);
  return true;
}
export function disable(userId: string): void { run('DELETE FROM user_mfa WHERE user_id = ?', userId); }
