import type { BroadcastChannel, Contact, ContactFilter, ContactSummary, ContactWho } from '@daji/shared';
import { many, one } from './db.ts';
import { now } from './clock.ts';
import { HttpError } from './errors.ts';
import { Validator } from './input.ts';
import { isValidDate } from './time.ts';

// "Contacts" are the people who have played at one owner's grounds. They are customers, so consent is theirs:
// every channel needs its own yes (users.consent_email / consent_sms / consent_whatsapp) before a broadcast reaches them.

const PLAYED: Record<ContactWho, string> = {
  // A confirmed session whose end time has passed counts as played even if the 24-hour sweep has not marked it 'completed' yet.
  played: "(b.status = 'completed' OR (b.status = 'confirmed' AND b.end_at <= ?))",
  booked: "b.status IN ('confirmed','completed')",
  all: "b.status IN ('confirmed','completed','no_show')",
  account: "b.status IN ('confirmed','completed','no_show')",
};

/** The business a new account belongs to before it books. A customer account is not tied to a business when it is made, so while the
 *  platform has exactly one active owner (Daji today) a sign-up is theirs from the start. With more than one, an account becomes a
 *  business's customer only by booking there, so one business never sees another's sign-ups. */
export function soleOwner(): string | null {
  const o = many<{ id: string }>("SELECT id FROM users WHERE role = 'owner' AND active = 1 LIMIT 2");
  return o.length === 1 ? o[0]!.id : null;
}
const NEVER_BOOKED = "NOT EXISTS (SELECT 1 FROM bookings x WHERE x.customer_id = u.id) AND NOT EXISTS (SELECT 1 FROM payments y WHERE y.customer_id = u.id)";

/** Is this customer one of this business's: they booked here, or they have an account and have not booked anywhere yet (see soleOwner). */
export function ownsCustomer(ownerId: string, customerId: string): boolean {
  if (one('SELECT 1 FROM bookings WHERE customer_id = ? AND owner_id = ?', customerId, ownerId)) return true;
  return soleOwner() === ownerId && !!one(`SELECT 1 FROM users u WHERE u.id = ? AND u.role = 'customer' AND ${NEVER_BOOKED}`, customerId);
}

export const MAX_AUDIENCE = 5000;

interface Row {
  id: string; name: string; phone: string | null; email: string | null; active: number; created_at: number;
  consent_email: number; consent_sms: number; consent_whatsapp: number;
  times: number; slots: number; first_at: number | null; last_at: number; past_at: number | null; next_at: number | null; paid: number; ground_ids: string;
}

export function parseContactFilter(src: unknown): ContactFilter {
  const v = new Validator(src ?? {});
  const who = v.oneOf('who', ['played', 'booked', 'all', 'account'] as const);
  const groundId = v.str('groundId', { max: 60 });
  const playedFrom = v.str('playedFrom', { max: 10 });
  const playedTo = v.str('playedTo', { max: 10 });
  const inactiveSince = v.str('inactiveSince', { max: 10 });
  const minTimes = v.int('minTimes', { min: 1, max: 10_000 });
  const q = v.str('q', { max: 80 });
  for (const [k, d] of [['playedFrom', playedFrom], ['playedTo', playedTo], ['inactiveSince', inactiveSince]] as const) {
    if (d !== undefined && !isValidDate(d)) v.fail(k, 'Must be a date like 2026-10-01');
  }
  if (playedFrom && playedTo && isValidDate(playedFrom) && isValidDate(playedTo) && playedTo < playedFrom) v.fail('playedTo', 'Must not be before playedFrom');
  v.done();
  const f: ContactFilter = {};
  if (who) f.who = who;
  if (groundId) f.groundId = groundId;
  if (playedFrom) f.playedFrom = playedFrom;
  if (playedTo) f.playedTo = playedTo;
  if (inactiveSince) f.inactiveSince = inactiveSince;
  if (minTimes) f.minTimes = minTimes;
  if (q) f.q = q;
  return f;
}

/** One row per person, for the owner's bookings that match the filter. */
function base(ownerId: string, f: ContactFilter): { sql: string; p: (string | number)[] } {
  const who = f.who ?? 'played';
  if (who === 'account') return withAccounts(ownerId, f);
  const where: string[] = ['b.owner_id = ?', "u.role = 'customer'", PLAYED[who]];
  const p: (string | number)[] = [ownerId];
  if (who === 'played') p.push(now());
  if (f.groundId) { where.push('b.ground_id = ?'); p.push(f.groundId); }
  if (f.playedFrom) { where.push('b.date >= ?'); p.push(f.playedFrom); }
  if (f.playedTo) { where.push('b.date <= ?'); p.push(f.playedTo); }
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, '\\$&')}%`;
    where.push("(u.name LIKE ? ESCAPE '\\' OR u.phone LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')");
    p.push(like, like, like);
  }
  const t = Math.floor(Number(now())); // a number from the clock, written into the query as one
  const having: string[] = [];
  if (f.minTimes) { having.push('COUNT(*) >= ?'); p.push(f.minTimes); }
  if (f.inactiveSince) { having.push('MAX(b.date) < ?'); p.push(f.inactiveSince); }
  const sql = `SELECT u.id, u.name, u.phone, u.email, u.active, u.consent_email, u.consent_sms, u.consent_whatsapp, u.created_at,
      COUNT(*) AS times, SUM(b.slot_count) AS slots, MIN(b.start_at) AS first_at, MAX(b.start_at) AS last_at,
      MAX(CASE WHEN b.start_at <= ${t} THEN b.start_at END) AS past_at, MIN(CASE WHEN b.start_at > ${t} THEN b.start_at END) AS next_at, SUM(b.paid_paise) AS paid,
      group_concat(DISTINCT b.ground_id) AS ground_ids
    FROM bookings b JOIN users u ON u.id = b.customer_id
    WHERE ${where.join(' AND ')}
    GROUP BY u.id ${having.length ? 'HAVING ' + having.join(' AND ') : ''}`;
  return { sql, p };
}

/** 'account': everyone who booked here (as 'all'), and everyone who has an account and has not booked anywhere yet, when this business
 *  is the only one (soleOwner). The ground, date and times filters are about bookings, so with any of them set only bookers match. */
function withAccounts(ownerId: string, f: ContactFilter): { sql: string; p: (string | number)[] } {
  const on: string[] = ['b.customer_id = u.id', 'b.owner_id = ?', PLAYED.account];
  const p: (string | number)[] = [ownerId];
  if (f.groundId) { on.push('b.ground_id = ?'); p.push(f.groundId); }
  if (f.playedFrom) { on.push('b.date >= ?'); p.push(f.playedFrom); }
  if (f.playedTo) { on.push('b.date <= ?'); p.push(f.playedTo); }
  const mine = soleOwner() === ownerId;
  const where: string[] = ["u.role = 'customer'", mine ? `(b.id IS NOT NULL OR ${NEVER_BOOKED})` : 'b.id IS NOT NULL'];
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, '\\$&')}%`;
    where.push("(u.name LIKE ? ESCAPE '\\' OR u.phone LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')");
    p.push(like, like, like);
  }
  const t = Math.floor(Number(now()));
  const having: string[] = [];
  if (f.groundId || f.playedFrom || f.playedTo) having.push('COUNT(b.id) > 0');
  if (f.minTimes) { having.push('COUNT(b.id) >= ?'); p.push(f.minTimes); }
  if (f.inactiveSince) { having.push('(MAX(b.date) IS NULL OR MAX(b.date) < ?)'); p.push(f.inactiveSince); }
  const sql = `SELECT u.id, u.name, u.phone, u.email, u.active, u.consent_email, u.consent_sms, u.consent_whatsapp, u.created_at,
      COUNT(b.id) AS times, COALESCE(SUM(b.slot_count), 0) AS slots, MIN(b.start_at) AS first_at, COALESCE(MAX(b.start_at), u.created_at) AS last_at,
      MAX(CASE WHEN b.start_at <= ${t} THEN b.start_at END) AS past_at, MIN(CASE WHEN b.start_at > ${t} THEN b.start_at END) AS next_at, COALESCE(SUM(b.paid_paise), 0) AS paid,
      group_concat(DISTINCT b.ground_id) AS ground_ids
    FROM users u LEFT JOIN bookings b ON ${on.join(' AND ')}
    WHERE ${where.join(' AND ')}
    GROUP BY u.id ${having.length ? 'HAVING ' + having.join(' AND ') : ''}`;
  return { sql, p };
}

const reach = (r: Row) => ({
  email: !!r.active && !!r.email && !!r.consent_email,
  sms: !!r.active && !!r.phone && !!r.consent_sms,
  whatsapp: !!r.active && !!r.phone && !!r.consent_whatsapp,
});

const toContact = (r: Row): Contact => ({
  id: r.id, name: r.name, phone: r.phone, email: r.email, timesPlayed: r.times, slotsPlayed: r.slots ?? 0,
  firstPlayedAt: r.first_at ?? null, lastPlayedAt: r.times ? r.last_at : null, lastPastAt: r.past_at ?? null, nextAt: r.next_at ?? null, paidPaise: r.paid ?? 0, groundIds: r.ground_ids ? r.ground_ids.split(',') : [],
  consent: { email: !!r.consent_email, sms: !!r.consent_sms, whatsapp: !!r.consent_whatsapp }, reachable: reach(r), signedUpAt: r.created_at,
});

export interface ContactPage { items: Contact[]; total: number; limit: number; offset: number; summary: ContactSummary }

/** `channel` keeps only people who can be messaged on it right now. */
export function listContacts(ownerId: string, f: ContactFilter, limit: number, offset: number, channel?: BroadcastChannel): ContactPage {
  const { sql, p } = base(ownerId, f);
  const flag = channel === 'email'
    ? 'WHERE active = 1 AND email IS NOT NULL AND email <> \'\' AND consent_email = 1'
    : channel === 'sms' ? 'WHERE active = 1 AND phone IS NOT NULL AND consent_sms = 1'
    : channel === 'whatsapp' ? 'WHERE active = 1 AND phone IS NOT NULL AND consent_whatsapp = 1' : '';
  const rows = many<Row>(`SELECT * FROM (${sql}) ${flag} ORDER BY last_at DESC, name LIMIT ? OFFSET ?`, ...p, limit, offset);
  const total = one<{ n: number }>(`SELECT COUNT(*) n FROM (${sql}) ${flag}`, ...p)!.n;
  return { items: rows.map(toContact), total, limit, offset, summary: summarize(ownerId, f) };
}

export function summarize(ownerId: string, f: ContactFilter): ContactSummary {
  const { sql, p } = base(ownerId, f);
  const s = one<{ total: number; e: number | null; w: number | null; s: number | null }>(
    `SELECT COUNT(*) total,
       SUM(CASE WHEN active = 1 AND email IS NOT NULL AND email <> '' AND consent_email = 1 THEN 1 ELSE 0 END) e,
       SUM(CASE WHEN active = 1 AND phone IS NOT NULL AND consent_whatsapp = 1 THEN 1 ELSE 0 END) w,
       SUM(CASE WHEN active = 1 AND phone IS NOT NULL AND consent_sms = 1 THEN 1 ELSE 0 END) s
     FROM (${sql})`, ...p)!;
  return { total: s.total, reachableEmail: s.e ?? 0, reachableWhatsapp: s.w ?? 0, reachableSms: s.s ?? 0 };
}

/** Everyone who matches, up to MAX_AUDIENCE, with the facts needed to decide who a broadcast can go to. */
export function audience(ownerId: string, f: ContactFilter): Contact[] {
  const { sql, p } = base(ownerId, f);
  const total = one<{ n: number }>(`SELECT COUNT(*) n FROM (${sql})`, ...p)!.n;
  if (total > MAX_AUDIENCE) {
    throw new HttpError(400, 'AUDIENCE_TOO_LARGE', `That is ${total} people. A broadcast can go to at most ${MAX_AUDIENCE}: narrow it by ground, dates or number of sessions.`);
  }
  return many<Row>(`SELECT * FROM (${sql}) ORDER BY last_at DESC, name`, ...p).map(toContact);
}

export const FILTER_FIELDS = ['who', 'groundId', 'playedFrom', 'playedTo', 'minTimes', 'inactiveSince', 'q'] as const;
