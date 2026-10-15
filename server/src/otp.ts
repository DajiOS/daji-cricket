import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { one, run, registerSchema } from './db.ts';
import { now } from './clock.ts';
import { HttpError } from './errors.ts';
import { sendOtpCode } from './notifications.ts';
import type { Config } from './config.ts';

// One-time codes sent by SMS, used to create an account or sign in with a phone number.
registerSchema('otp-1', `CREATE TABLE otp_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_otp_phone ON otp_codes(phone, created_at);`);

export const OTP_TTL_MS = 10 * 60_000;
export const OTP_RESEND_MS = 30_000;
export const OTP_MAX_PER_HOUR = 5;
export const OTP_MAX_TRIES = 5;

const hash = (cfg: Config, phone: string, code: string): string => createHmac('sha256', cfg.jwtSecret).update(`otp:${phone}:${code}`).digest('hex');

/** Sends a new code to a 10-digit phone number. Returns the code only in demo mode (where no message is sent). */
export async function requestOtp(cfg: Config, phone: string): Promise<{ sent: true; expiresInSeconds: number; devCode?: string }> {
  const t = now();
  const last = one<{ created_at: number }>('SELECT created_at FROM otp_codes WHERE phone = ? ORDER BY id DESC LIMIT 1', phone);
  if (last && t - last.created_at < OTP_RESEND_MS) throw new HttpError(429, 'OTP_WAIT', `Please wait ${Math.ceil((OTP_RESEND_MS - (t - last.created_at)) / 1000)} seconds before asking for another code`);
  const n = one<{ n: number }>('SELECT COUNT(*) n FROM otp_codes WHERE phone = ? AND created_at > ?', phone, t - 3600_000)!.n;
  if (n >= OTP_MAX_PER_HOUR) throw new HttpError(429, 'OTP_LIMIT', 'Too many codes asked for this number. Try again in an hour.');
  const code = String(randomInt(100000, 1000000));
  const delivered = await sendOtpCode(phone, code);
  if (!delivered && !cfg.demoMode) throw new HttpError(503, 'SMS_NOT_CONFIGURED', 'Codes by WhatsApp are not set up yet. Please sign in with your email, or call the ground.');
  run('INSERT INTO otp_codes(phone, code_hash, expires_at, created_at) VALUES(?,?,?,?)', phone, hash(cfg, phone, code), t + OTP_TTL_MS, t);
  return { sent: true, expiresInSeconds: OTP_TTL_MS / 1000, ...(!delivered && cfg.demoMode ? { devCode: code } : {}) };
}

/** Checks a code. A wrong guess counts against the code; five wrong guesses lock it. Use `consume` once the sign-in will go ahead. */
export function checkOtp(cfg: Config, phone: string, code: string): { consume: () => void } {
  const row = one<{ id: number; code_hash: string; expires_at: number; attempts: number }>('SELECT id, code_hash, expires_at, attempts FROM otp_codes WHERE phone = ? AND used = 0 ORDER BY id DESC LIMIT 1', phone);
  if (!row || row.expires_at < now()) throw new HttpError(400, 'OTP_INVALID', 'That code has expired. Ask for a new one.');
  if (row.attempts >= OTP_MAX_TRIES) throw new HttpError(429, 'OTP_LOCKED', 'Too many wrong tries. Ask for a new code.');
  const a = Buffer.from(hash(cfg, phone, code)), b = Buffer.from(row.code_hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    run('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?', row.id);
    throw new HttpError(400, 'OTP_INVALID', 'That code is not right. Check the message and try again.');
  }
  return { consume: () => run('UPDATE otp_codes SET used = 1 WHERE id = ?', row.id) };
}
