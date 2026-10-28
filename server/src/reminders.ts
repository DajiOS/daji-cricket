import { many, one, registerSchema, run } from './db.ts';
import { now } from './clock.ts';
import { audit, type Actor } from './audit.ts';
import { HttpError, notFound } from './errors.ts';
import { newId } from './ids.ts';
import { Validator } from './input.ts';
import { addDays, istDate, timeOfDay } from './time.ts';
import { waNumber } from './whatsapp.ts';
import { businessName } from './businesses.ts';

// WhatsApp reminders without the WhatsApp API: a queue of people to remind, each with a ready wa.me link.
// Nothing is sent from the server; staff press the link and then mark it sent, which writes the history.

registerSchema('reminders-1', `
CREATE TABLE reminder_templates (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  deleted_at INTEGER,
  deleted_by TEXT
);
CREATE UNIQUE INDEX uq_reminder_templates ON reminder_templates(owner_id, kind);

CREATE TABLE reminder_log (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  item_key TEXT,
  customer_id TEXT,
  name TEXT NOT NULL,
  phone TEXT,
  message TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  deleted_at INTEGER,
  deleted_by TEXT
);
CREATE INDEX ix_reminder_log_owner ON reminder_log(owner_id, sent_at);
CREATE INDEX ix_reminder_log_key ON reminder_log(owner_id, kind, item_key);
`);

export const KINDS = ['booking', 'payment', 'membership', 'fixture'] as const;
export type Kind = typeof KINDS[number];
export const KIND_LABEL: Record<Kind, string> = { booking: 'Booking reminder', payment: 'Payment due', membership: 'Membership expiring', fixture: 'Tournament fixture' };
export const PLACEHOLDERS = ['name', 'date', 'time', 'amount', 'business'] as const;

export const DEFAULT_TEMPLATES: Record<Kind, string> = {
  booking: 'Hi {name}, a reminder of your booking at {business} on {date} at {time}. See you there!',
  payment: 'Hi {name}, a balance of {amount} is due for your booking on {date} at {time}. Please pay at the ground or by UPI. Thank you.',
  membership: 'Hi {name}, your {business} membership ends on {date}. Reply here to renew and keep your benefits.',
  fixture: 'Hi {name}, your tournament match is on {date} at {time}. Please reach 30 minutes early with your full team.',
};

const today = (): string => istDate(now());
const isKind = (k: unknown): k is Kind => typeof k === 'string' && (KINDS as readonly string[]).includes(k);
const kindOr400 = (k: unknown): Kind => { if (!isKind(k)) throw new HttpError(400, 'VALIDATION_FAILED', 'Unknown reminder type', { fields: [{ field: 'kind', message: 'Must be one of ' + KINDS.join(', ') }] }); return k; };

export const inrText = (paise: number): string => '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(paise / 100) ? 0 : 2, maximumFractionDigits: 2 });
const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dayText = (iso: string): string => { const [y, m, d] = iso.split('-').map(Number); return `${DOWS[new Date(Date.UTC(y!, m! - 1, d)).getUTCDay()]} ${d} ${MONS[m! - 1]}`; };
export const timeText = (hhmm: string): string => { const [h, m] = hhmm.split(':').map(Number); return `${h! % 12 || 12}:${String(m).padStart(2, '0')} ${h! < 12 ? 'am' : 'pm'}`; };

/** Replace {name} {date} {time} {amount}; unknown or empty values leave nothing behind but tidy spacing. */
export function renderTemplate(body: string, v: Partial<Record<typeof PLACEHOLDERS[number], string>>): string {
  return body.replace(/\{(name|date|time|amount|business)\}/g, (_m, k: string) => v[k as typeof PLACEHOLDERS[number]] ?? '').replace(/[ \t]{2,}/g, ' ').trim();
}
export const waLink = (phone: string | null | undefined, message: string): string | null => {
  const n = phone ? waNumber(phone) : '';
  return n.length >= 10 ? `https://wa.me/${n}?text=${encodeURIComponent(message)}` : null;
};

// ------------------------------------------------------------------ templates

export function listTemplates(owner: string): { kind: Kind; label: string; body: string; custom: boolean; defaultBody: string }[] {
  const rows = many<{ kind: string; body: string }>('SELECT kind, body FROM reminder_templates WHERE owner_id = ? AND deleted_at IS NULL', owner);
  return KINDS.map((kind) => {
    const r = rows.find((x) => x.kind === kind);
    return { kind, label: KIND_LABEL[kind], body: r?.body ?? DEFAULT_TEMPLATES[kind], custom: !!r, defaultBody: DEFAULT_TEMPLATES[kind] };
  });
}
const bodyOf = (owner: string, kind: Kind): string => one<{ body: string }>('SELECT body FROM reminder_templates WHERE owner_id = ? AND kind = ? AND deleted_at IS NULL', owner, kind)?.body ?? DEFAULT_TEMPLATES[kind];
/** {business} is the sending business's own name (white-label), so one business's reminders never carry another's name. */
const biz = (owner: string) => ({ business: businessName(owner) });

export function saveTemplate(owner: string, actor: Actor, kindIn: unknown, input: unknown): { kind: Kind; body: string } {
  const kind = kindOr400(kindIn);
  const v = new Validator(input);
  const reset = v.src.reset === true;
  const body = reset ? DEFAULT_TEMPLATES[kind] : v.str('body', { required: true, max: 1000 });
  v.done();
  const t = now();
  const had = one<{ id: string }>('SELECT id FROM reminder_templates WHERE owner_id = ? AND kind = ?', owner, kind);
  if (reset) { if (had) run('UPDATE reminder_templates SET deleted_at = ?, deleted_by = ?, updated_at = ?, updated_by = ? WHERE id = ?', t, actor.id, t, actor.id, had.id); }
  else if (had) run('UPDATE reminder_templates SET body = ?, deleted_at = NULL, deleted_by = NULL, updated_at = ?, updated_by = ? WHERE id = ?', body!, t, actor.id, had.id);
  else run('INSERT INTO reminder_templates(id, owner_id, kind, body, created_at, created_by, updated_at, updated_by) VALUES(?,?,?,?,?,?,?,?)', newId('rtp'), owner, kind, body!, t, actor.id, t, actor.id);
  audit(actor, reset ? 'reminder.template_reset' : 'reminder.template_saved', 'reminder_template', kind, null, owner);
  return { kind, body: body! };
}

// ------------------------------------------------------------------ the queue

export interface QueueItem {
  kind: Kind; key: string; customerId: string | null; name: string; phone: string | null;
  summary: string; message: string; link: string | null; sentAt: number | null;
}

const lastSent = (owner: string, kind: Kind, key: string): number | null =>
  one<{ s: number }>('SELECT MAX(sent_at) s FROM reminder_log WHERE owner_id = ? AND kind = ? AND item_key = ? AND deleted_at IS NULL', owner, kind, key)?.s ?? null;

function bookingItems(owner: string): QueueItem[] {
  const t = today(); const tomorrow = addDays(t, 1);
  const out: QueueItem[] = [];
  const base = `SELECT b.id, b.ref, b.date, b.start_at, b.total_paise, b.paid_paise, u.id cid, u.name, u.phone, g.name gname
    FROM bookings b JOIN users u ON u.id = b.customer_id JOIN grounds g ON g.id = b.ground_id`;
  for (const b of many<any>(`${base} WHERE b.owner_id = ? AND b.status = 'confirmed' AND b.date = ? ORDER BY b.start_at`, owner, tomorrow)) {
    const bal = Math.max(0, b.total_paise - b.paid_paise);
    const message = renderTemplate(bodyOf(owner, 'booking'), { name: b.name, date: dayText(b.date), time: timeText(timeOfDay(b.start_at)), amount: inrText(bal), ...biz(owner) });
    out.push({ kind: 'booking', key: b.id, customerId: b.cid, name: b.name, phone: b.phone, summary: `${b.gname}, ${dayText(b.date)} ${timeText(timeOfDay(b.start_at))} (${b.ref})`, message, link: waLink(b.phone, message), sentAt: lastSent(owner, 'booking', b.id) });
  }
  const from = addDays(t, -30);
  // a multi-day booking is one reminder for its whole balance, on its first unpaid day, not one per day
  const blockBal = new Map<string, number>();
  const rows = many<any>(`SELECT b.id, b.ref, b.date, b.start_at, b.total_paise, b.paid_paise, u.id cid, u.name, u.phone, g.name gname,
      CASE WHEN s.kind = 'block' THEN b.series_id END block
    FROM bookings b JOIN users u ON u.id = b.customer_id JOIN grounds g ON g.id = b.ground_id LEFT JOIN booking_series s ON s.id = b.series_id
    WHERE b.owner_id = ? AND b.status IN ('confirmed','completed') AND b.total_paise > b.paid_paise AND b.date >= ? ORDER BY b.start_at`, owner, from);
  for (const b of rows) if (b.block) blockBal.set(b.block, (blockBal.get(b.block) ?? 0) + b.total_paise - b.paid_paise);
  for (const b of rows) {
    if (b.block && !blockBal.has(b.block)) continue; // a later day of a block already listed
    const bal = b.block ? blockBal.get(b.block)! : b.total_paise - b.paid_paise;
    if (b.block) blockBal.delete(b.block);
    const message = renderTemplate(bodyOf(owner, 'payment'), { name: b.name, date: dayText(b.date), time: timeText(timeOfDay(b.start_at)), amount: inrText(bal), ...biz(owner) });
    out.push({ kind: 'payment', key: b.id, customerId: b.cid, name: b.name, phone: b.phone, summary: `${inrText(bal)} due, ${dayText(b.date)} (${b.ref})`, message, link: waLink(b.phone, message), sentAt: lastSent(owner, 'payment', b.id) });
  }
  return out;
}

/** Memberships ending within 7 days (the memberships module's own table). */
function membershipItems(owner: string): { items: QueueItem[]; available: boolean } {
  try {
    if (!one('SELECT name FROM sqlite_master WHERE type = ? AND name = ?', 'table', 'memberships')) return { items: [], available: false };
    const t = today(); const limit = addDays(t, 7);
    const rows = many<any>('SELECT id, name, phone, end_date FROM memberships WHERE owner_id = ? AND deleted_at IS NULL AND end_date >= ? AND end_date <= ? ORDER BY end_date', owner, t, limit);
    const items = rows.map((r): QueueItem => {
      const message = renderTemplate(bodyOf(owner, 'membership'), { name: r.name, date: dayText(r.end_date), time: '', amount: '', ...biz(owner) });
      return { kind: 'membership', key: String(r.id), customerId: null as any, name: r.name, phone: r.phone, summary: `Ends ${dayText(r.end_date)}`, message, link: waLink(r.phone, message), sentAt: lastSent(owner, 'membership', String(r.id)) };
    });
    return { items, available: true };
  } catch { return { items: [], available: false }; }
}

const RESEND_MS = 3 * 86_400_000;
export function buildQueue(owner: string): { items: QueueItem[]; membershipsAvailable: boolean; counts: Record<string, number> } {
  const m = membershipItems(owner);
  const items = [...bookingItems(owner), ...m.items].map((i) => ({ ...i, sentAt: i.kind === 'payment' && i.sentAt && now() - i.sentAt > RESEND_MS ? null : i.sentAt }));
  const counts: Record<string, number> = { booking: 0, payment: 0, membership: 0, pending: 0 };
  for (const i of items) { counts[i.kind]!++; if (!i.sentAt) counts.pending!++; }
  return { items, membershipsAvailable: m.available, counts };
}

// ------------------------------------------------------------------ preview, log, history

export function preview(owner: string, input: unknown): { message: string; link: string | null } {
  const v = new Validator(input);
  const kind = kindOr400(v.src.kind);
  const name = v.str('name', { max: 120 }) ?? ''; const phone = v.str('phone', { max: 20 });
  const date = v.str('date', { max: 40 }) ?? ''; const time = v.str('time', { max: 40 }) ?? ''; const amount = v.str('amount', { max: 40 }) ?? '';
  const body = v.str('body', { max: 1000 });
  v.done();
  const message = renderTemplate(body ?? bodyOf(owner, kind), { name, date, time, amount, ...biz(owner) });
  return { message, link: waLink(phone, message) };
}

/** Writes the history line. A queue item is looked up again here, so the log holds what the server would have offered. */
export function markSent(owner: string, actor: Actor, input: unknown): { id: string } {
  const v = new Validator(input);
  const kind = kindOr400(v.src.kind);
  const key = v.str('key', { max: 80 });
  let name = v.str('name', { max: 120 }); let phone = v.str('phone', { max: 20 }) ?? null; let message = v.str('message', { max: 2000 }); let cid: string | null = null;
  v.done();
  if (key) {
    const item = buildQueue(owner).items.find((i) => i.kind === kind && i.key === key);
    if (!item) throw notFound('That reminder is no longer in the queue');
    name = item.name; phone = item.phone; message = item.message; cid = item.customerId;
  } else if (!name || !message) throw new HttpError(400, 'VALIDATION_FAILED', 'Name and message are required', { fields: [{ field: !name ? 'name' : 'message', message: 'Required' }] });
  const id = newId('rem'); const t = now();
  run('INSERT INTO reminder_log(id, owner_id, kind, item_key, customer_id, name, phone, message, sent_at, created_at, created_by, updated_at, updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
    id, owner, kind, key ?? null, cid, name!, phone, message!, t, t, actor.id, t, actor.id);
  audit(actor, 'reminder.sent', 'reminder', id, { kind, name }, owner);
  return { id };
}

export function history(owner: string, limit = 100): { items: any[] } {
  const items = many<any>(`SELECT l.id, l.kind, l.name, l.phone, l.message, l.sent_at sentAt, u.name sentBy FROM reminder_log l LEFT JOIN users u ON u.id = l.created_by
    WHERE l.owner_id = ? AND l.deleted_at IS NULL ORDER BY l.sent_at DESC, l.id DESC LIMIT ?`, owner, Math.min(Math.max(limit, 1), 500));
  return { items };
}
