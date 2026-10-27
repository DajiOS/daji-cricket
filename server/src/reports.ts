import { many, one } from './db.ts';
import { slotStarts, type GroundRow } from './grounds.ts';
import { DAY, addDays, istMidnight, monthRange } from './time.ts';
import { HttpError } from './errors.ts';
import { isValidDate } from './time.ts';
import { now } from './clock.ts';

export interface Range { from: string; to: string }

export function parseRange(from: string | null, to: string | null, month?: string | null): Range {
  if (month) {
    const m = monthRange(month);
    if (!m) throw new HttpError(400, 'VALIDATION_FAILED', 'Month must look like 2026-10', { fields: [{ field: 'month', message: 'Must look like 2026-10' }] });
    return m;
  }
  if (!isValidDate(from) || !isValidDate(to)) throw new HttpError(400, 'VALIDATION_FAILED', 'Send from and to dates like 2026-10-01', { fields: [{ field: 'from', message: 'Required, like 2026-10-01' }, { field: 'to', message: 'Required, like 2026-10-31' }] });
  if (to < from) throw new HttpError(400, 'VALIDATION_FAILED', 'to must not be before from', { fields: [{ field: 'to', message: 'Must not be before from' }] });
  if ((istMidnight(to) - istMidnight(from)) / DAY > 366) throw new HttpError(400, 'RANGE_TOO_LONG', 'Reports cover at most 366 days at a time');
  return { from, to };
}

const own = (col: string, ownerId: string | null) => (ownerId ? { sql: `AND ${col} = ?`, p: [ownerId] } : { sql: '', p: [] as string[] });

/** Operational reports (FR-12). `ownerId` null = whole platform (super admin). */
export function overview(ownerId: string | null, range: Range) {
  const { from, to } = range;
  const fromMs = istMidnight(from), toMs = istMidnight(addDays(to, 1));
  const ob = own('b.owner_id', ownerId), op = own('p.owner_id', ownerId), oe = own('e.owner_id', ownerId), ol = own('l.owner_id', ownerId);

  const byStatus = many<{ status: string; n: number; total: number; paid: number }>(
    `SELECT b.status, COUNT(*) n, SUM(b.total_paise) total, SUM(b.paid_paise) paid FROM bookings b WHERE b.date BETWEEN ? AND ? AND b.deleted_at IS NULL ${ob.sql} GROUP BY b.status`, from, to, ...ob.p);
  const statusMap = Object.fromEntries(byStatus.map((r) => [r.status, { count: r.n, totalPaise: r.total ?? 0, paidPaise: r.paid ?? 0 }]));
  const cancellations = many<{ kind: string; n: number; refund: number; credit: number }>(
    `SELECT b.cancel_kind kind, COUNT(*) n, SUM(b.refund_paise) refund, SUM(b.credit_paise) credit FROM bookings b WHERE b.status = 'cancelled' AND b.deleted_at IS NULL AND b.date BETWEEN ? AND ? ${ob.sql} GROUP BY b.cancel_kind`, from, to, ...ob.p);

  const grounds = many<GroundRow>(`SELECT g.* FROM grounds g WHERE 1 = 1 ${own('g.owner_id', ownerId).sql} ORDER BY g.name`, ...own('g.owner_id', ownerId).p);
  const booked = many<{ ground_id: string; slots: number }>(
    `SELECT b.ground_id, SUM(b.slot_count) slots FROM bookings b WHERE b.status IN ('confirmed','completed','no_show') AND b.date BETWEEN ? AND ? ${ob.sql} GROUP BY b.ground_id`, from, to, ...ob.p);
  const bookedMap = new Map(booked.map((r) => [r.ground_id, r.slots]));
  const utilization = grounds.map((g) => {
    // Count the slots that were really open: winter hours and weekly closed days included.
    let available = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) available += slotStarts(g, d).length;
    const used = bookedMap.get(g.id) ?? 0;
    return { groundId: g.id, groundName: g.name, availableSlots: available, bookedSlots: used, utilization: available ? Math.round((used / available) * 1000) / 10 : 0 };
  });

  // Money counts on the day it was received (verified), as in the books; a UPI payment sent on the 31st and checked on the 1st belongs to the 1st.
  const payments = many<{ method: string; n: number; amount: number; refunded: number }>(
    `SELECT p.method, COUNT(*) n, SUM(p.amount_paise) amount, SUM(p.refunded_paise) refunded FROM payments p WHERE p.status IN ('captured','refunded','partially_refunded') AND COALESCE(p.verified_at, p.created_at) >= ? AND COALESCE(p.verified_at, p.created_at) < ? ${op.sql} GROUP BY p.method`, fromMs, toMs, ...op.p);
  const awaiting = one<{ n: number; amount: number }>(`SELECT COUNT(*) n, COALESCE(SUM(p.amount_paise),0) amount FROM payments p WHERE p.status = 'submitted' ${op.sql}`, ...op.p)!;
  const outstanding = one<{ n: number; amount: number }>(`SELECT COUNT(*) n, COALESCE(SUM(b.total_paise - b.paid_paise),0) amount FROM bookings b WHERE b.status IN ('confirmed','completed') AND b.total_paise > b.paid_paise AND b.date BETWEEN ? AND ? ${ob.sql}`, from, to, ...ob.p)!;
  const refunds = many<{ status: string; n: number; amount: number }>(`SELECT r.status, COUNT(*) n, SUM(r.amount_paise) amount FROM refunds r WHERE r.created_at >= ? AND r.created_at < ? ${own('r.owner_id', ownerId).sql} GROUP BY r.status`, fromMs, toMs, ...own('r.owner_id', ownerId).p);
  const advances = one<{ n: number; advance: number }>(`SELECT COUNT(*) n, COALESCE(SUM(b.advance_paise),0) advance FROM bookings b WHERE b.status IN ('confirmed','completed','no_show') AND b.date BETWEEN ? AND ? ${ob.sql}`, from, to, ...ob.p)!;

  const creditRows = many<{ kind: string; amount: number }>(`SELECT l.kind, SUM(l.amount_paise) amount FROM credit_ledger l WHERE l.created_at >= ? AND l.created_at < ? ${ol.sql} GROUP BY l.kind`, fromMs, toMs, ...ol.p);
  const creditOutstanding = one<{ s: number }>(`SELECT COALESCE(SUM(l.remaining_paise),0) s FROM credit_lots l WHERE l.remaining_paise > 0 AND l.expires_at > ? ${ol.sql}`, now(), ...ol.p)!.s;

  const enq = many<{ status: string; n: number }>(`SELECT e.status, COUNT(*) n FROM enquiries e WHERE e.created_at >= ? AND e.created_at < ? ${oe.sql} GROUP BY e.status`, fromMs, toMs, ...oe.p);
  const enqTotal = enq.reduce((s, r) => s + r.n, 0);
  const converted = enq.find((r) => r.status === 'converted')?.n ?? 0;

  const customers = one<{ active: number; newCustomers: number }>(
    `SELECT COUNT(DISTINCT b.customer_id) active,
       COUNT(DISTINCT CASE WHEN NOT EXISTS (SELECT 1 FROM bookings x WHERE x.customer_id = b.customer_id ${ownerId ? 'AND x.owner_id = ?' : ''} AND x.date < ?) THEN b.customer_id END) newCustomers
     FROM bookings b WHERE b.status IN ('confirmed','completed','no_show') AND b.date BETWEEN ? AND ? ${ob.sql}`, ...(ownerId ? [ownerId] : []), from, from, to, ...ob.p)!;

  return {
    range, bookings: { byStatus: statusMap, cancellations: cancellations.map((c) => ({ kind: c.kind, count: c.n, refundPaise: c.refund ?? 0, creditPaise: c.credit ?? 0 })) },
    utilization,
    payments: { byMethod: payments.map((p) => ({ method: p.method, count: p.n, amountPaise: p.amount, refundedPaise: p.refunded })), awaitingVerification: { count: awaiting.n, amountPaise: awaiting.amount }, outstandingBalances: { bookings: outstanding.n, amountPaise: outstanding.amount }, advancesCollected: { bookings: advances.n, advancePaise: advances.advance }, refunds: refunds.map((r) => ({ status: r.status, count: r.n, amountPaise: r.amount })) },
    credits: { movements: Object.fromEntries(creditRows.map((r) => [r.kind, r.amount])), outstandingPaise: creditOutstanding },
    enquiries: { total: enqTotal, byStatus: Object.fromEntries(enq.map((r) => [r.status, r.n])), conversionRate: enqTotal ? Math.round((converted / enqTotal) * 1000) / 10 : 0 },
    customers: { active: customers.active, new: customers.newCustomers },
  };
}

export function customerList(ownerId: string, q: string | undefined, limit: number, offset: number) {
  const like = q ? `%${q.replace(/[%_\\]/g, '\\$&')}%` : null;
  const where = like ? "AND (u.name LIKE ? ESCAPE '\\' OR u.phone LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')" : '';
  const p = like ? [like, like, like] : [];
  const total = one<{ n: number }>(`SELECT COUNT(DISTINCT u.id) n FROM users u JOIN bookings b ON b.customer_id = u.id WHERE b.owner_id = ? ${where}`, ownerId, ...p)!.n;
  const rows = many<any>(
    `SELECT u.id, u.name, u.phone, u.email, u.consent_email, u.consent_sms, u.consent_whatsapp, COUNT(b.id) bookings,
       SUM(CASE WHEN b.status IN ('confirmed','completed','no_show') THEN 1 ELSE 0 END) played, MAX(b.start_at) last_at, SUM(b.paid_paise) paid
     FROM users u JOIN bookings b ON b.customer_id = u.id WHERE b.owner_id = ? ${where} GROUP BY u.id ORDER BY last_at DESC LIMIT ? OFFSET ?`, ownerId, ...p, limit, offset);
  return { items: rows.map((r) => ({ id: r.id, name: r.name, phone: r.phone, email: r.email, bookings: r.bookings, played: r.played, lastBookingAt: r.last_at, paidPaise: r.paid ?? 0, consent: { email: !!r.consent_email, sms: !!r.consent_sms, whatsapp: !!r.consent_whatsapp } })), total, limit, offset };
}
