import { many, one, registerSchema, run } from './db.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { HttpError, notFound } from './errors.ts';
import { audit, type Actor } from './audit.ts';
import { Validator } from './input.ts';

// The SaaS side: other ground owners ask to use this platform. Leads are kept for the super admin; nothing is sent anywhere automatically.

registerSchema('platform-1', `
CREATE TABLE platform_leads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  business TEXT NOT NULL,
  city TEXT,
  grounds INTEGER,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','demo','won','lost')),
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX ix_platform_leads_status ON platform_leads(status, created_at);
`);

export const LEAD_STATUSES = ['new', 'contacted', 'demo', 'won', 'lost'] as const;
export interface Lead { id: string; name: string; email: string; phone: string; business: string; city: string | null; grounds: number | null; message: string | null; status: string; note: string | null; createdAt: number }
const toLead = (r: any): Lead => ({ id: r.id, name: r.name, email: r.email, phone: r.phone, business: r.business, city: r.city, grounds: r.grounds, message: r.message, status: r.status, note: r.note, createdAt: r.created_at });

/** A public form: anyone may send it, so it is strictly validated, and the same email cannot flood the list. */
export function createLead(src: unknown): { received: true } {
  const v = new Validator(src);
  const name = v.str('name', { required: true, min: 2, max: 80 });
  const email = v.email('email', true);
  const phone = v.phone('phone', true);
  const business = v.str('business', { required: true, min: 2, max: 100 });
  const city = v.str('city', { max: 60 });
  const grounds = v.int('grounds', { min: 1, max: 500 });
  const message = v.str('message', { max: 1000 });
  const website = v.str('website', { max: 200 }); // a hidden field a person never fills; a bot does
  v.done();
  if (website) return { received: true }; // pretend success, store nothing
  const recent = one<{ c: number }>('SELECT COUNT(*) c FROM platform_leads WHERE lower(email) = lower(?) AND created_at > ?', email!, now() - 24 * 3600_000)!.c;
  if (recent >= 3) throw new HttpError(429, 'RATE_LIMITED', 'We already have your details. We will be in touch.');
  const t = now();
  run('INSERT INTO platform_leads(id, name, email, phone, business, city, grounds, message, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)', newId('led'), name!, email!, phone!, business!, city ?? null, grounds ?? null, message ?? null, t, t);
  return { received: true };
}

export function listLeads(status?: string): Lead[] {
  return many(`SELECT * FROM platform_leads ${status ? 'WHERE status = ?' : ''} ORDER BY created_at DESC LIMIT 500`, ...(status ? [status] : [])).map(toLead);
}

export function updateLead(actor: Actor, id: string, src: unknown): Lead {
  const cur = one('SELECT * FROM platform_leads WHERE id = ?', id);
  if (!cur) throw notFound('Lead not found');
  const v = new Validator(src);
  const status = v.oneOf('status', LEAD_STATUSES);
  const note = v.str('note', { max: 500 });
  v.done();
  run('UPDATE platform_leads SET status = ?, note = ?, updated_at = ? WHERE id = ?', status ?? cur.status, note ?? cur.note, now(), id);
  audit(actor, 'platform.lead.update', 'platform_lead', id, { status }, undefined);
  return toLead(one('SELECT * FROM platform_leads WHERE id = ?', id));
}
