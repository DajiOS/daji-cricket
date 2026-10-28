import { HttpError } from './errors.ts';
import { checkPasswordStrength, setPassword, userRow, type UserRow } from './auth.ts';
import { disable as disableMfa, mfaEnabled } from './mfa.ts';
import { one, run } from './db.ts';
import { now } from './clock.ts';
import { readName } from './hold.ts';
import { splitName, titleCase } from './names.ts';
import type { Validator } from './input.ts';

// The owner changes a person's sign-in details for them: a team member (Team page › Edit) or one of their customers
// (customer page › Edit). Name, email, mobile, a new password, and switching off their two-step sign-in when they have
// lost the phone. A new password or a 2FA reset ends every sign-in they have. The password itself is never recorded.

export interface AccountEdits { name?: string; firstName?: string; lastName?: string; email?: string; phone?: string; password?: string; resetMfa?: boolean }

/** Reads the fields from a request body. Call before `v.done()`. */
export function readAccountEdits(v: Validator): AccountEdits {
  const nm = readName(v, false);
  const email = v.email('email');
  const phone = v.phone('phone');
  const password = v.str('password', { trim: false });
  if (password !== undefined) { const pw = checkPasswordStrength(password); if (pw) v.fail('password', pw); }
  const resetMfa = v.bool('resetMfa');
  return { ...nm, email, phone, password, resetMfa };
}

/** Saves the edits (call inside a transaction) and returns what changed, for the audit trail: never the password or the old/new email. */
export function applyAccountEdits(target: UserRow, e: AccountEdits): Record<string, unknown> {
  if (e.email !== undefined) {
    const other = one<{ id: string }>('SELECT id FROM users WHERE lower(email) = lower(?)', e.email);
    if (other && other.id !== target.id) throw new HttpError(409, 'EMAIL_TAKEN', 'That email is already used by another account');
  }
  const t = now();
  if (e.name !== undefined) {
    const p = e.firstName ? { first: titleCase(e.firstName), last: titleCase(e.lastName ?? '') } : splitName(titleCase(e.name));
    run('UPDATE users SET name = ?, first_name = ?, last_name = ?, updated_at = ? WHERE id = ?', [p.first, p.last].filter(Boolean).join(' ') || e.name, p.first, p.last, t, target.id);
  }
  if (e.email !== undefined) run('UPDATE users SET email = ?, updated_at = ? WHERE id = ?', e.email, t, target.id);
  if (e.phone !== undefined) run('UPDATE users SET phone = ?, updated_at = ? WHERE id = ?', e.phone, t, target.id);
  const mfaWasOn = mfaEnabled(target.id);
  if (e.resetMfa && mfaWasOn) { disableMfa(target.id); run('UPDATE users SET token_version = token_version + 1, updated_at = ? WHERE id = ?', t, target.id); }
  if (e.password !== undefined) setPassword(target.id, e.password); // also ends every sign-in
  return {
    ...(e.name !== undefined ? { name: { from: target.name, to: userRow(target.id)!.name } } : {}),
    ...(e.email !== undefined && e.email.toLowerCase() !== (target.email ?? '').toLowerCase() ? { email: true } : {}),
    ...(e.phone !== undefined && e.phone !== target.phone ? { phone: true } : {}),
    ...(e.password !== undefined ? { passwordReset: true } : {}),
    ...(e.resetMfa ? { mfaReset: mfaWasOn } : {}),
  };
}
