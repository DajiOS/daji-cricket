import type { Enquiry, EnquiryNote, EnquiryStatus, Page, Quotation } from '@daji/shared';
import { many, one, run, tx } from './db.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { HttpError, notFound } from './errors.ts';
import { audit, type Actor } from './audit.ts';
import { Validator } from './input.ts';
import { getGroundOr404 } from './grounds.ts';
import { hasPermission, requirePermission, scopeOwnerId, type UserRow } from './auth.ts';
import { notify, sendAlert } from './notifications.ts';
import { getSettings } from './settings.ts';
import { createStaffBlock, createStaffBooking, parseBlock, parseWalkIn, readName } from './hold.ts';
import { isClosedDate } from './closures.ts';

interface EnquiryRow {
  id: string; owner_id: string; ground_id: string | null; customer_id: string | null; name: string; phone: string; email: string | null; preferred_date: string | null;
  players: number | null; message: string; status: EnquiryStatus; closed_reason: string | null; booking_id: string | null; created_at: number; updated_at: number;
}

const row = (id: string) => one<EnquiryRow>('SELECT * FROM enquiries WHERE id = ?', id);

function view(r: EnquiryRow, forCustomer: boolean): Enquiry {
  const g = r.ground_id ? one<{ name: string }>('SELECT name FROM grounds WHERE id = ?', r.ground_id) : undefined;
  const quotations: Quotation[] = many<any>('SELECT * FROM quotations WHERE enquiry_id = ? ORDER BY created_at, rowid', r.id).map((q) => ({
    id: q.id, amountPaise: q.amount_paise, validUntil: q.valid_until, details: q.details, status: q.status, createdAt: q.created_at,
  }));
  const notes: EnquiryNote[] = forCustomer ? [] : many<any>('SELECT * FROM enquiry_notes WHERE enquiry_id = ? ORDER BY created_at, rowid', r.id).map((n) => ({
    id: n.id, kind: n.kind, body: n.body, authorId: n.author_id, createdAt: n.created_at,
  }));
  return {
    id: r.id, groundId: r.ground_id, groundName: g?.name ?? null, ownerId: r.owner_id, customerId: r.customer_id, name: r.name, phone: r.phone, email: r.email,
    preferredDate: r.preferred_date, players: r.players, message: r.message, status: r.status, closedReason: r.closed_reason, bookingId: r.booking_id,
    quotations, notes, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

/** Anyone can send an enquiry; if they are signed in it is linked to their account. */
export function createEnquiry(user: UserRow | null, body: unknown): Enquiry {
  const v = new Validator(body);
  const groundId = v.str('groundId', { required: true });
  const nm = readName(v, !user); const name = nm.name ?? user?.name;
  const phone = v.phone('phone', !user?.phone) ?? user?.phone ?? undefined;
  const email = v.email('email') ?? user?.email ?? undefined;
  const preferredDate = v.date('preferredDate');
  const kind = v.oneOf('kind', ['ground', 'academy'] as const);
  const players = v.int('players', { min: 1, max: 500 });
  const message = v.str('message', { required: true, min: 5, max: 2000 });
  v.done();
  if (kind === 'academy' && preferredDate && isClosedDate(preferredDate, 'academy')) throw new HttpError(409, 'DATE_CLOSED', 'The academy is not taking enquiries for that day. Please pick another day.');
  const g = getGroundOr404(groundId!);
  const id = newId('enq');
  const t = now();
  tx(() => {
    run(`INSERT INTO enquiries(id, owner_id, ground_id, customer_id, name, phone, email, preferred_date, players, message, status, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'new',?,?)`,
      id, g.owner_id, g.id, user?.role === 'customer' ? user.id : null, name!, phone!, email ?? null, preferredDate ?? null, players ?? null, message!, t, t);
    audit(user ? { id: user.id, role: user.role } : { id: null, role: 'anonymous' }, 'enquiry.create', 'enquiry', id, { groundId: g.id }, g.owner_id);
  });
  if (user?.role === 'customer') notify(user.id, 'enquiry_received', { name: name });
  // the ground's people hear about it straight away: an app alert and email to the owner, and a WhatsApp to the contact number
  try { notify(g.owner_id, 'enquiry_new', { name: name, contactPhone: phone, ground: g.name, extra: message!.slice(0, 160) }); } catch { /* the enquiry is saved either way */ }
  const to = getSettings().contactPhone;
  if (to) void sendAlert(to, [name!, phone!, message!]);
  return view(row(id)!, true);
}

export function listEnquiries(user: UserRow, f: { status?: string; q?: string; limit: number; offset: number }): Page<Enquiry> {
  const where: string[] = [];
  const p: (string | number)[] = [];
  if (user.role === 'customer') { where.push('customer_id = ?'); p.push(user.id); }
  else if (user.role !== 'super_admin') { requirePermission(user, 'manage_enquiries'); where.push('owner_id = ?'); p.push(scopeOwnerId(user)!); }
  if (f.status) { where.push('status = ?'); p.push(f.status); }
  if (f.q) { where.push("(name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR message LIKE ? ESCAPE '\\')"); const l = `%${f.q.replace(/[%_\\]/g, '\\$&')}%`; p.push(l, l, l); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = one<{ n: number }>(`SELECT COUNT(*) n FROM enquiries ${w}`, ...p)?.n ?? 0;
  const rows = many<EnquiryRow>(`SELECT * FROM enquiries ${w} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`, ...p, f.limit, f.offset);
  return { items: rows.map((r) => view(r, user.role === 'customer')), total, limit: f.limit, offset: f.offset };
}

function access(user: UserRow, id: string, staffOnly: boolean): EnquiryRow {
  const r = row(id);
  if (!r) throw notFound('Enquiry not found');
  if (user.role === 'super_admin') return r;
  if (user.role === 'customer') { if (staffOnly || r.customer_id !== user.id) throw notFound('Enquiry not found'); return r; }
  if (scopeOwnerId(user) !== r.owner_id) throw notFound('Enquiry not found');
  if (!hasPermission(user, 'manage_enquiries')) throw new HttpError(403, 'FORBIDDEN', 'This needs the "manage_enquiries" permission');
  return r;
}

export const getEnquiry = (user: UserRow, id: string): Enquiry => view(access(user, id, false), user.role === 'customer');

function touch(id: string, status?: EnquiryStatus): void {
  if (status) run('UPDATE enquiries SET status = ?, updated_at = ? WHERE id = ?', status, now(), id);
  else run('UPDATE enquiries SET updated_at = ? WHERE id = ?', now(), id);
}
function open(r: EnquiryRow): void {
  if (r.status === 'closed' || r.status === 'converted') throw new HttpError(409, 'BAD_STATE', `This enquiry is already ${r.status}`);
}
function addNote(enquiryId: string, authorId: string | null, kind: 'note' | 'contact' | 'status', body: string): void {
  run('INSERT INTO enquiry_notes(id, enquiry_id, kind, body, author_id, created_at) VALUES(?,?,?,?,?,?)', newId('enn'), enquiryId, kind, body, authorId, now());
}

/** Staff note. A `contact` note (we called/messaged the customer) moves a new enquiry to follow-up. */
export function addEnquiryNote(user: UserRow, id: string, body: unknown): Enquiry {
  const r = access(user, id, true);
  const v = new Validator(body);
  const text = v.str('body', { required: true, min: 1, max: 1000 });
  const kind = v.oneOf('kind', ['note', 'contact'] as const) ?? 'note';
  v.done();
  open(r);
  tx(() => {
    addNote(id, user.id, kind, text!);
    if (kind === 'contact' && r.status === 'new') { touch(id, 'follow_up'); addNote(id, user.id, 'status', 'new → follow_up'); } else touch(id);
    audit({ id: user.id, role: user.role }, 'enquiry.note', 'enquiry', id, { kind }, r.owner_id);
  });
  return getEnquiry(user, id);
}

export function sendQuotation(user: UserRow, id: string, body: unknown): Enquiry {
  const r = access(user, id, true);
  const v = new Validator(body);
  const amountPaise = v.int('amountPaise', { required: true, min: 100, max: 10_000_000_00 });
  const validUntil = v.int('validUntil', { min: now() });
  const details = v.str('details', { max: 1000 });
  v.done();
  open(r);
  tx(() => {
    run("UPDATE quotations SET status = 'expired' WHERE enquiry_id = ? AND status = 'sent'", id);
    run("INSERT INTO quotations(id, enquiry_id, amount_paise, valid_until, details, status, created_by, created_at) VALUES(?,?,?,?,?,'sent',?,?)", newId('quo'), id, amountPaise!, validUntil ?? null, details ?? null, user.id, now());
    addNote(id, user.id, 'status', `${r.status} → quoted`);
    touch(id, 'quoted');
    audit({ id: user.id, role: user.role }, 'enquiry.quote', 'enquiry', id, { amountPaise }, r.owner_id);
  });
  if (r.customer_id) notify(r.customer_id, 'quotation_sent', { amountPaise: amountPaise!, extra: details ?? undefined });
  return getEnquiry(user, id);
}

/** Customer replies to the latest quotation. */
export function respondToQuotation(user: UserRow, enquiryId: string, quotationId: string, accept: boolean): Enquiry {
  const r = access(user, enquiryId, false);
  if (user.role !== 'customer') throw new HttpError(403, 'FORBIDDEN', 'Only the customer can answer a quotation');
  const q = one<{ id: string; status: string; valid_until: number | null }>('SELECT id, status, valid_until FROM quotations WHERE id = ? AND enquiry_id = ?', quotationId, enquiryId);
  if (!q) throw notFound('Quotation not found');
  if (q.status !== 'sent') throw new HttpError(409, 'BAD_STATE', `This quotation is ${q.status}`);
  if (q.valid_until !== null && q.valid_until < now()) throw new HttpError(409, 'QUOTATION_EXPIRED', 'This quotation has expired');
  open(r);
  tx(() => {
    run('UPDATE quotations SET status = ? WHERE id = ?', accept ? 'accepted' : 'declined', quotationId);
    addNote(enquiryId, user.id, 'status', `customer ${accept ? 'accepted' : 'declined'} the quotation`);
    touch(enquiryId);
    audit({ id: user.id, role: user.role }, accept ? 'enquiry.quote_accept' : 'enquiry.quote_decline', 'enquiry', enquiryId, { quotationId }, r.owner_id);
  });
  return getEnquiry(user, enquiryId);
}

export function closeEnquiry(user: UserRow, id: string, body: unknown): Enquiry {
  const r = access(user, id, true);
  const v = new Validator(body);
  const reason = v.str('reason', { required: true, min: 2, max: 300 });
  v.done();
  open(r);
  tx(() => {
    run("UPDATE enquiries SET status = 'closed', closed_reason = ?, updated_at = ? WHERE id = ?", reason!, now(), id);
    addNote(id, user.id, 'status', `${r.status} → closed: ${reason}`);
    audit({ id: user.id, role: user.role }, 'enquiry.close', 'enquiry', id, { reason }, r.owner_id);
  });
  return getEnquiry(user, id);
}

/**
 * A custom programme over several days (a camp, a tournament, a shoot): the enquiry becomes one booking per day for one agreed
 * total, entered by staff on the web desk or the app. Same rules as the single booking: the first day's advance must be received.
 */
export function convertEnquiryToBlock(user: UserRow, id: string, body: unknown): Enquiry {
  const r = access(user, id, true);
  open(r);
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const quotationId = typeof b.quotationId === 'string' ? b.quotationId : undefined;
  let total = b.totalPaise;
  if (quotationId) {
    const q = one<{ amount_paise: number; status: string }>('SELECT amount_paise, status FROM quotations WHERE id = ? AND enquiry_id = ?', quotationId, id);
    if (!q) throw notFound('Quotation not found');
    if (q.status === 'declined' || q.status === 'expired') throw new HttpError(409, 'BAD_STATE', `That quotation is ${q.status}`);
    total = q.amount_paise;
  }
  const input = parseBlock({ ...b, totalPaise: total, groundId: b.groundId ?? r.ground_id, customer: { name: r.name, phone: r.phone, email: r.email ?? undefined } });
  return tx(() => {
    const out = createStaffBlock(user, { ...input, enquiryId: id, customerId: r.customer_id ?? undefined });
    const first = out.bookings[0]!;
    run("UPDATE enquiries SET status = 'converted', booking_id = ?, updated_at = ? WHERE id = ?", first.id, now(), id);
    addNote(id, user.id, 'status', `${r.status} → converted to a ${out.series.days}-day block (${first.ref})`);
    if (quotationId) run("UPDATE quotations SET status = 'accepted' WHERE id = ?", quotationId);
    audit({ id: user.id, role: user.role } as Actor, 'enquiry.convert_block', 'enquiry', id, { bookingId: first.id, days: out.series.days }, r.owner_id);
    notify(first.customerId, 'enquiry_converted', { ref: first.ref, ground: first.groundName, startAt: first.startAt }, first.id);
    return getEnquiry(user, id);
  });
}

/** Turns an enquiry into a confirmed booking at the quoted price (staff records the advance, like a walk-in). */
export function convertEnquiry(user: UserRow, id: string, body: unknown): Enquiry {
  const r = access(user, id, true);
  open(r);
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const input = parseWalkIn({ ...b, groundId: b.groundId ?? r.ground_id, customer: { name: r.name, phone: r.phone, email: r.email ?? undefined } });
  const quotationId = typeof b.quotationId === 'string' ? b.quotationId : undefined;
  let total: number | undefined;
  if (quotationId) {
    const q = one<{ amount_paise: number; status: string }>('SELECT amount_paise, status FROM quotations WHERE id = ? AND enquiry_id = ?', quotationId, id);
    if (!q) throw notFound('Quotation not found');
    if (q.status === 'declined' || q.status === 'expired') throw new HttpError(409, 'BAD_STATE', `That quotation is ${q.status}`);
    total = q.amount_paise;
  }
  return tx(() => {
    const booking = createStaffBooking(user, { ...input, source: 'enquiry', enquiryId: id, totalPaiseOverride: total, customerId: r.customer_id ?? undefined });
    run("UPDATE enquiries SET status = 'converted', booking_id = ?, updated_at = ? WHERE id = ?", booking.id, now(), id);
    addNote(id, user.id, 'status', `${r.status} → converted (${booking.ref})`);
    if (quotationId) run("UPDATE quotations SET status = 'accepted' WHERE id = ?", quotationId);
    audit({ id: user.id, role: user.role } as Actor, 'enquiry.convert', 'enquiry', id, { bookingId: booking.id }, r.owner_id);
    notify(booking.customerId, 'enquiry_converted', { ref: booking.ref, ground: booking.groundName, startAt: booking.startAt }, booking.id);
    return getEnquiry(user, id);
  });
}
