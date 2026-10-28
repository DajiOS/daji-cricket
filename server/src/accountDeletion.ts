import { forgetFaces } from './players.ts';
import { one, run, tx } from './db.ts';
import { now } from './clock.ts';
import { audit } from './audit.ts';
import { HttpError, conflict } from './errors.ts';
import { Validator } from './input.ts';
import { verifyPassword, type UserRow } from './auth.ts';
import { clearAvatar } from './avatar.ts';

// Account deletion, as the app stores require. The person is removed (name, email, phone, password, picture, push tokens, sign-in); the business records that
// mention them (bookings, payments, receipts) are kept because the ground must keep its books, but they now show "Deleted user" with no way back to the person.
// Staff, owners and the software owner are not deleted here: an owner removes a staff member under Team, and a business account is closed by the software owner.

export function deleteMyAccount(dataDir: string, u: UserRow, body: unknown): { deleted: true } {
  if (u.role !== 'customer') throw new HttpError(403, 'NOT_ALLOWED', 'This account belongs to a business. Ask the owner to switch it off under Team, or contact the software owner.');
  const v = new Validator(body);
  const confirm = v.str('confirm', { required: true, max: 20 });
  const password = v.str('password', { max: 200, trim: false });
  v.done();
  if (confirm !== 'DELETE') throw new HttpError(400, 'VALIDATION_FAILED', 'Type DELETE to confirm', { fields: [{ field: 'confirm', message: 'Type DELETE to confirm' }] });
  if (u.password_hash && !verifyPassword(password ?? '', u.password_hash)) throw new HttpError(400, 'VALIDATION_FAILED', 'The password is not right', { fields: [{ field: 'password', message: 'Not the password you signed in with' }] });
  const upcoming = one<{ n: number }>("SELECT COUNT(*) n FROM bookings WHERE customer_id = ? AND status IN ('held','confirmed') AND end_at > ?", u.id, now())!.n;
  if (upcoming > 0) throw conflict('HAS_UPCOMING', `You have ${upcoming} upcoming booking${upcoming === 1 ? '' : 's'}. Cancel ${upcoming === 1 ? 'it' : 'them'} first, then delete the account.`);
  if (one('SELECT 1 FROM autodebit_mandates WHERE customer_id = ? AND status IN (\'pending\',\'active\')', u.id)) throw conflict('HAS_AUTODEBIT', 'Switch off auto-debit under Mine first, then delete the account.');
  const t = now();
  tx(() => {
    run("UPDATE users SET name = 'Deleted user', email = NULL, phone = NULL, password_hash = NULL, active = 0, consent_email = 0, consent_sms = 0, consent_whatsapp = 0, consent_updated_at = ?, token_version = token_version + 1, updated_at = ? WHERE id = ?", t, t, u.id);
    run('DELETE FROM push_tokens WHERE user_id = ?', u.id);
    forgetFaces(u.id);
    if (u.phone) run('DELETE FROM otp_codes WHERE phone = ?', u.phone);
  });
  try { clearAvatar(dataDir, u); } catch { /* no picture */ }
  audit({ id: u.id, role: u.role }, 'account.delete', 'user', u.id);
  return { deleted: true };
}
