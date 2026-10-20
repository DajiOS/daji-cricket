import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { one, run, registerSchema } from './db.ts';
import { now } from './clock.ts';
import { HttpError } from './errors.ts';
import { checkPasswordStrength, setPassword, userByEmail } from './auth.ts';
import { emailAvailable, sendDirect } from './notifications.ts';
import { audit } from './audit.ts';
import type { Config } from './config.ts';

// "Forgot password": a one-time code goes to the account's email, and the code plus a new password sets the password.
// It also gives a password to someone who only ever signed in with a phone code, or was added at the desk, as long as an email is on file.
// A row is written for every request, even for an email with no account, so the limits and the answer are the same either way
// and nobody can use this to find out who has an account.
registerSchema('password-reset-1', `CREATE TABLE password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  user_id TEXT,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_password_resets_email ON password_resets(email, created_at);`);

export const RESET_TTL_MS = 15 * 60_000;
export const RESET_RESEND_MS = 60_000;
export const RESET_MAX_PER_HOUR = 5;
export const RESET_MAX_TRIES = 5;

const hash = (cfg: Config, email: string, code: string): string => createHmac('sha256', cfg.jwtSecret).update(`reset:${email}:${code}`).digest('hex');

/**
 * Emails a reset code when the address belongs to an active account. The answer does not say whether it does.
 * The email is sent in the background so the reply takes the same time either way. Demo mode with no email set up returns the code instead.
 */
export function requestPasswordReset(cfg: Config, rawEmail: string): { sent: true; expiresInSeconds: number; devCode?: string } {
  const email = rawEmail.trim().toLowerCase();
  const canSend = emailAvailable();
  if (!canSend && !cfg.demoMode) throw new HttpError(503, 'EMAIL_NOT_CONFIGURED', 'Password reset by email is not set up yet. Please call the ground for help.');
  const t = now();
  const last = one<{ created_at: number }>('SELECT created_at FROM password_resets WHERE email = ? ORDER BY id DESC LIMIT 1', email);
  if (last && t - last.created_at < RESET_RESEND_MS) throw new HttpError(429, 'RESET_WAIT', `Please wait ${Math.ceil((RESET_RESEND_MS - (t - last.created_at)) / 1000)} seconds before asking for another code`);
  const n = one<{ n: number }>('SELECT COUNT(*) n FROM password_resets WHERE email = ? AND created_at > ?', email, t - 3600_000)!.n;
  if (n >= RESET_MAX_PER_HOUR) throw new HttpError(429, 'RESET_LIMIT', 'Too many codes asked for this email. Try again in an hour.');
  const u = userByEmail(email);
  const target = u && u.active ? u : null;
  const code = String(randomInt(100000, 1000000));
  run('INSERT INTO password_resets(email, user_id, code_hash, expires_at, created_at) VALUES(?,?,?,?,?)', email, target?.id ?? null, hash(cfg, email, code), t + RESET_TTL_MS, t);
  const base = { sent: true as const, expiresInSeconds: RESET_TTL_MS / 1000 };
  if (!target) return base;
  if (!canSend) return { ...base, devCode: code };
  const body = `Your Daji Cricket Ground password reset code is ${code}. It works for ${RESET_TTL_MS / 60_000} minutes.\n\nIf you did not ask to reset your password, ignore this email; your password stays the same. Never share this code with anyone, including ground staff.`;
  void sendDirect('email', target.email!, body, 'Your password reset code').then((okay) => {
    if (!okay) console.error(JSON.stringify({ level: 'error', where: 'password-reset', error: 'reset email not sent' }));
  });
  return base;
}

/** Checks the code and sets the new password. Every signed-in device is signed out. A wrong code counts against it; five lock it. */
export function resetPassword(cfg: Config, rawEmail: string, code: string, password: string): void {
  const weak = checkPasswordStrength(password);
  if (weak) throw new HttpError(400, 'VALIDATION_FAILED', weak, { fields: [{ field: 'password', message: weak }] });
  const email = rawEmail.trim().toLowerCase();
  const row = one<{ id: number; user_id: string | null; code_hash: string; expires_at: number; attempts: number }>('SELECT id, user_id, code_hash, expires_at, attempts FROM password_resets WHERE email = ? AND used = 0 ORDER BY id DESC LIMIT 1', email);
  if (!row || row.expires_at < now()) throw new HttpError(400, 'RESET_INVALID', 'That code has expired. Ask for a new one.');
  if (row.attempts >= RESET_MAX_TRIES) throw new HttpError(429, 'RESET_LOCKED', 'Too many wrong tries. Ask for a new code.');
  const a = Buffer.from(hash(cfg, email, code)), b = Buffer.from(row.code_hash);
  const u = row.user_id ? userByEmail(email) : undefined;
  // An email with no account gets the same "not right" answer as a wrong code.
  if (a.length !== b.length || !timingSafeEqual(a, b) || !u || u.id !== row.user_id || !u.active) {
    run('UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?', row.id);
    throw new HttpError(400, 'RESET_INVALID', 'That code is not right. Check the email and try again.');
  }
  run('UPDATE password_resets SET used = 1 WHERE email = ? AND used = 0', email);
  setPassword(u.id, password); // bumps the token version, so every old sign-in stops working
  run('DELETE FROM login_attempts WHERE key = ?', email);
  audit({ id: u.id, role: u.role }, 'auth.password_reset', 'user', u.id, {});
}
