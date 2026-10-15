import { many, one, run, registerSchema } from './db.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { HttpError, notFound } from './errors.ts';
import { Validator } from './input.ts';
import { audit } from './audit.ts';
import type { UserRow } from './auth.ts';
import { integrationIds } from './integrations.ts';

// A plain notebook of the outside services the platform uses and which account each one was opened with, so it is never forgotten.
// It holds no passwords or keys: those live in the server's environment file. Anything that looks like a key is refused.

registerSchema('services-1', `CREATE TABLE service_notes (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, purpose TEXT, account_email TEXT, phone TEXT, login_url TEXT, status TEXT NOT NULL DEFAULT 'not_started',
  notes TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT
);
INSERT INTO service_notes(id, name, purpose, account_email, phone, login_url, status, notes, created_at, updated_at) VALUES
 ('svc_msg91', 'MSG91', 'Text message sign-in codes (backup for WhatsApp)', 'sqinchmoney@gmail.com', NULL, 'https://msg91.com', 'account_created', 'Account opened with this email. Still to do: add the DLT template and get the Auth Key.', 0, 0),
 ('svc_whatsapp', 'WhatsApp Business (Meta)', 'Sign-in codes by WhatsApp, first choice', NULL, NULL, 'https://business.facebook.com', 'not_started', 'Needs a Meta Business account, a phone number and an approved Authentication template named daji_otp.', 0, 0),
 ('svc_razorpay', 'Razorpay', 'Online card and UPI payments', NULL, NULL, 'https://dashboard.razorpay.com', 'not_started', 'Test mode first; switch to live once the business is verified.', 0, 0),
 ('svc_wix', 'Wix', 'The public website, dajicricket.com', NULL, NULL, 'https://manage.wix.com', 'not_started', 'The website builder. Connect the Wix connector to let Claude update it.', 0, 0),
 ('svc_domain', 'Domain and DNS', 'dajicricket.com and api.dajicricket.com', NULL, NULL, NULL, 'not_started', 'Where the domain is registered and who can change DNS.', 0, 0),
 ('svc_hosting', 'Server hosting', 'Runs the platform (api.dajicricket.com)', NULL, NULL, NULL, 'not_started', NULL, 0, 0),
 ('svc_expo', 'Expo', 'The mobile app and its push notifications', NULL, NULL, 'https://expo.dev', 'not_started', 'Needed to build the app and send alerts to phones.', 0, 0),
 ('svc_email', 'Email sending', 'Booking emails to customers', NULL, NULL, NULL, 'not_started', 'The mailbox or service that the platform sends from.', 0, 0),
 ('svc_claude', 'Claude (Anthropic)', 'Ask AI in the owner desk', NULL, NULL, 'https://console.anthropic.com', 'not_started', NULL, 0, 0);`);

registerSchema('services-2', `ALTER TABLE service_notes ADD COLUMN connector TEXT;
UPDATE service_notes SET connector = 'msg91' WHERE id = 'svc_msg91';
UPDATE service_notes SET connector = 'whatsapp' WHERE id = 'svc_whatsapp';
UPDATE service_notes SET connector = 'razorpay' WHERE id = 'svc_razorpay';
UPDATE service_notes SET connector = 'website' WHERE id = 'svc_wix';
UPDATE service_notes SET connector = 'expo' WHERE id = 'svc_expo';
UPDATE service_notes SET connector = 'email' WHERE id = 'svc_email';
UPDATE service_notes SET connector = 'claude' WHERE id = 'svc_claude';`);

registerSchema('services-3', `UPDATE service_notes SET name = 'Email (Gmail)', account_email = 'dajicricket@gmail.com', login_url = 'https://mail.google.com', status = 'account_created', notes = 'Booking emails are sent from this Gmail address with an App Password (Google Account > Security > 2-Step Verification > App passwords). Still to do: turn on 2-Step Verification, create the App Password and set GMAIL_APP_PASSWORD on the server.' WHERE id = 'svc_email' AND account_email IS NULL;`);

export const SERVICE_STATUSES = ['not_started', 'account_created', 'connected', 'live', 'problem'] as const;
interface Row { id: string; name: string; purpose: string | null; account_email: string | null; phone: string | null; login_url: string | null; status: string; notes: string | null; connector: string | null; created_at: number; updated_at: number; updated_by: string | null }
export interface ServiceNote { id: string; name: string; purpose: string | null; accountEmail: string | null; phone: string | null; loginUrl: string | null; status: string; notes: string | null; connector: string | null; updatedAt: number }
const out = (r: Row): ServiceNote => ({ id: r.id, name: r.name, purpose: r.purpose, accountEmail: r.account_email, phone: r.phone, loginUrl: r.login_url, status: r.status, notes: r.notes, connector: r.connector, updatedAt: r.updated_at });

const KEYLIKE = /[A-Za-z0-9_\-]{32,}/;
function parse(body: unknown, partial: boolean) {
  const v = new Validator(body);
  const o = {
    name: v.str('name', { required: !partial, min: 2, max: 80 }), purpose: v.str('purpose', { max: 200 }), accountEmail: v.email('accountEmail'), phone: v.str('phone', { max: 30 }),
    loginUrl: v.str('loginUrl', { max: 200 }), status: v.oneOf('status', SERVICE_STATUSES), notes: v.str('notes', { max: 2000 }), connector: v.str('connector', { max: 30 }),
  };
  v.done();
  if (o.connector && !integrationIds().includes(o.connector)) throw new HttpError(400, 'VALIDATION_FAILED', 'Unknown connection', { fields: [{ field: 'connector', message: 'Not a known connection' }] });
  for (const t of [o.purpose, o.notes, o.phone, o.loginUrl, o.name]) if (t && KEYLIKE.test(t)) throw new HttpError(400, 'LOOKS_LIKE_A_KEY', 'That looks like a secret key or token. Keep keys in the server settings file (.env), not in these notes.');
  if (o.loginUrl && !/^https?:\/\//i.test(o.loginUrl)) throw new HttpError(400, 'VALIDATION_FAILED', 'The login link should start with https://', { fields: [{ field: 'loginUrl', message: 'Start with https://' }] });
  return o;
}

export const listServices = (): ServiceNote[] => many<Row>('SELECT * FROM service_notes ORDER BY CASE status WHEN \'problem\' THEN 0 ELSE 1 END, name').map(out);

export function addService(u: UserRow, body: unknown): ServiceNote {
  const o = parse(body, false), id = newId('svc'), t = now();
  run('INSERT INTO service_notes(id, name, purpose, account_email, phone, login_url, status, notes, connector, created_at, updated_at, updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', id, o.name!, o.purpose ?? null, o.accountEmail ?? null, o.phone ?? null, o.loginUrl ?? null, o.status ?? 'not_started', o.notes ?? null, o.connector ?? null, t, t, u.id);
  audit({ id: u.id, role: u.role }, 'service_note.add', 'service_note', id, { name: o.name });
  return out(one<Row>('SELECT * FROM service_notes WHERE id = ?', id)!);
}

export function updateService(u: UserRow, id: string, body: unknown): ServiceNote {
  if (!one('SELECT 1 FROM service_notes WHERE id = ?', id)) throw notFound('Service not found');
  const b = (body ?? {}) as Record<string, unknown>, o = parse(body, true);
  const has = (k: string) => k in b;
  // a field sent empty clears it; a field left out stays as it was
  run(`UPDATE service_notes SET name = COALESCE(?, name), purpose = CASE WHEN ? THEN ? ELSE purpose END, account_email = CASE WHEN ? THEN ? ELSE account_email END, phone = CASE WHEN ? THEN ? ELSE phone END,
    login_url = CASE WHEN ? THEN ? ELSE login_url END, status = COALESCE(?, status), notes = CASE WHEN ? THEN ? ELSE notes END, connector = CASE WHEN ? THEN ? ELSE connector END, updated_at = ?, updated_by = ? WHERE id = ?`,
    o.name ?? null, has('purpose') ? 1 : 0, o.purpose ?? null, has('accountEmail') ? 1 : 0, o.accountEmail ?? null, has('phone') ? 1 : 0, o.phone ?? null,
    has('loginUrl') ? 1 : 0, o.loginUrl ?? null, o.status ?? null, has('notes') ? 1 : 0, o.notes ?? null, has('connector') ? 1 : 0, o.connector ?? null, now(), u.id, id);
  audit({ id: u.id, role: u.role }, 'service_note.update', 'service_note', id, {});
  return out(one<Row>('SELECT * FROM service_notes WHERE id = ?', id)!);
}

export function deleteService(u: UserRow, id: string): void {
  if (!one('SELECT 1 FROM service_notes WHERE id = ?', id)) throw notFound('Service not found');
  run('DELETE FROM service_notes WHERE id = ?', id);
  audit({ id: u.id, role: u.role }, 'service_note.delete', 'service_note', id, {});
}
