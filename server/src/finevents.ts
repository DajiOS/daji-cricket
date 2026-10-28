import { createHash } from 'node:crypto';
import { many, one, registerSchema } from './db.ts';
import { now } from './clock.ts';
import { ledgerLines, type Line } from './accounting/ledger.ts';
import './accounting/schema.ts';
import './payments.ts';
import './credits.ts';
import './bookings.ts';
import './appendOnly.ts';
import './securityDeposit.ts';
import './auctionDeposit.ts';

// Financial events and the reconciliation that proves the books agree with the records.
//
// An event is one thing that happened to money: a payment received, a refund given, credit issued, a session earned. The ledger is derived from the real records on demand
// (accounting/ledger.ts), so each event already has one fixed identity, "<kind>:<record id>", and can only exist once: delivering the same payment twice cannot make two events.
// Events are never stored twice and never edited. A mistake is put right by a new record (a refund, a void with a reason, a reversing entry), which is a new event.
// `reconcile` re-derives everything and compares it with the records themselves; anything that does not agree is a finding, and a finding nobody has been told about is "unexplained".

// Money records are never deleted, by the database: payments, refunds, credit lots, bookings and the owner's books. (Updates are still how state moves along: captured, refunded, ...)
const NO_DELETE = ['payments', 'refunds', 'credit_lots', 'bookings', 'acct_journals', 'acct_journal_lines', 'acct_transactions'] as const;
registerSchema('no-delete-1', NO_DELETE.map((t) => `CREATE TRIGGER trg_ao_${t}_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, '${t} cannot be deleted: reverse it with a new record'); END;`).join('\n'));

export interface FinancialEvent { id: string; kind: string; ref: string; date: string; amountPaise: number; fingerprint: string }

/** The events for one owner up to a date, each with a fixed id and a fingerprint of its debits and credits. Same records, same events, every time. */
export function financialEvents(ownerId: string, upTo: string): FinancialEvent[] {
  const byKey = new Map<string, Line[]>();
  for (const l of ledgerLines(ownerId, upTo)) {
    const k = `${l.src}:${l.ref}`;
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(l);
  }
  return [...byKey.entries()].map(([id, lines]) => {
    const legs = lines.map((l) => `${l.account}|${l.debit}|${l.credit}|${l.date}`).sort().join(';');
    return { id, kind: lines[0]!.src, ref: lines[0]!.ref, date: lines[0]!.date, amountPaise: lines.reduce((s, l) => s + l.debit, 0), fingerprint: createHash('sha256').update(legs).digest('hex').slice(0, 16) };
  }).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
}

export interface Finding { code: string; entity: string; id: string; detail: string; /** A person has already been told about it (the booking is flagged for review). */ explained: boolean; /** "info" is a recorded, approved action worth knowing about; "problem" is a disagreement. */ severity: 'info' | 'problem' }
export interface ReconcileReport {
  at: number; ownerId: string | null; events: number; debitsPaise: number; creditsPaise: number; findings: Finding[]; unexplained: number; clean: boolean;
  totals: { receivedPaise: number; refundedPaise: number; heldForCustomersPaise: number; bookings: number; payments: number; refunds: number };
}

const LIVE = "('held','confirmed','completed','no_show')";

export function reconcile(ownerId: string | null, upTo = '9999-12-31'): ReconcileReport {
  const findings: Finding[] = [];
  const add = (code: string, entity: string, id: string, detail: string, explained = false, severity: Finding['severity'] = 'problem') => findings.push({ code, entity, id, detail, explained, severity });
  const own = ownerId ? 'AND owner_id = ?' : '';
  const p = ownerId ? [ownerId] : [];

  // 1. The books: every entry balances, and each payment, refund and credit event is made once.
  let debits = 0, credits = 0, events = 0;
  const owners = ownerId ? [ownerId] : many<{ id: string }>("SELECT id FROM users WHERE role = 'owner'").map((o) => o.id);
  for (const o of owners) {
    try {
      const lines = ledgerLines(o, upTo);
      for (const l of lines) { debits += l.debit; credits += l.credit; }
      const evs = financialEvents(o, upTo);
      events += evs.length;
      const seen = new Map<string, number>();
      for (const l of lines) if (l.src === 'payment' || l.src === 'refund' || l.src === 'credit') seen.set(`${l.src}:${l.ref}:${l.account}`, (seen.get(`${l.src}:${l.ref}:${l.account}`) ?? 0) + 1);
      for (const [k, n] of seen) if (n > 1) add('EVENT_DUPLICATED', 'ledger', k, `${n} lines for the same record and account`);
    } catch (e) {
      add('ACCOUNTING_ERROR', 'owner', o, `the books could not be derived: ${(e as Error).message}`);
    }
  }
  if (debits !== credits) add('LEDGER_UNBALANCED', 'ledger', ownerId ?? 'all', `debits ${debits} and credits ${credits} differ`);

  // 2. Each payment's refunded figure is exactly its refunds (a refund that failed or was declined is not counted).
  for (const r of many<{ id: string; booking_id: string; refunded: number; sum: number; amount: number }>(
    `SELECT p.id, p.booking_id, p.refunded_paise refunded, p.amount_paise amount, COALESCE((SELECT SUM(amount_paise) FROM refunds r WHERE r.payment_id = p.id AND r.status <> 'failed'), 0) sum FROM payments p WHERE 1=1 ${own.replace('owner_id', 'p.owner_id')}`, ...p)) {
    if (r.refunded !== r.sum) add('REFUNDED_MISMATCH', 'payment', r.id, `payment says ${r.refunded} refunded, its refunds add up to ${r.sum}`, reviewed(r.booking_id));
    if (r.sum > r.amount) add('REFUNDED_EXCEEDS_PAYMENT', 'payment', r.id, `refunds ${r.sum} exceed the payment ${r.amount}`, reviewed(r.booking_id));
  }

  // 3. Money in versus what the booking says: it cannot claim more than was received, and what was received beyond it must have gone back.
  for (const b of many<{ id: string; ref: string; status: string; paid_paise: number; total_paise: number; needs_review: number; source: string; advance_paise: number; recd: number; ref_sum: number; restored: number }>(
    `SELECT b.id, b.ref, b.status, b.paid_paise, b.total_paise, b.needs_review, b.source, b.advance_paise,
       COALESCE((SELECT SUM(amount_paise) FROM payments p WHERE p.booking_id = b.id AND p.status IN ('captured','partially_refunded','refunded')), 0) recd,
       COALESCE((SELECT SUM(r.amount_paise) FROM refunds r WHERE r.booking_id = b.id AND r.status <> 'failed'), 0) ref_sum,
       COALESCE((SELECT SUM(c.amount_paise) FROM credit_lots c WHERE c.booking_id = b.id AND c.source = 'restore'), 0) restored
     FROM bookings b WHERE 1=1 ${own.replace('owner_id', 'b.owner_id')}`, ...p)) {
    const seen = b.needs_review === 1;
    if (b.paid_paise > b.recd) add('PAID_EXCEEDS_RECEIVED', 'booking', b.id, `${b.ref}: shows ${b.paid_paise} paid but only ${b.recd} was received`, seen);
    if (b.paid_paise > b.total_paise && ['held', 'confirmed', 'completed'].includes(b.status)) add('OVERPAID_BOOKING', 'booking', b.id, `${b.ref}: paid ${b.paid_paise} on a total of ${b.total_paise}`, seen);
    if (['held', 'confirmed', 'completed', 'no_show'].includes(b.status)) {
      const gap = b.recd - b.paid_paise - b.ref_sum - b.restored; // restored: the difference of a cheaper move, returned to the customer as account credit (reschedule.ts settleCheaper)
      if (gap > 0) add('UNAPPLIED_MONEY', 'booking', b.id, `${b.ref}: received ${b.recd}, applied ${b.paid_paise}, returned ${b.ref_sum}: ${gap} is neither on the booking nor returned`, seen);
      // A refund that came out of money already on the booking (a goodwill or correction refund by the ground): approved and audited, and the books use the net figure, but the booking still shows the gross paid.
      else if (gap < 0) add('REFUND_AFTER_PAYMENT_APPLIED', 'booking', b.id, `${b.ref}: ${-gap} was refunded out of money already on the booking, which still shows ${b.paid_paise} paid`, true, 'info');
    }
    if (b.status === 'confirmed' && b.source === 'online' && b.paid_paise < b.advance_paise) add('CONFIRMED_BELOW_ADVANCE', 'booking', b.id, `${b.ref}: confirmed with ${b.paid_paise} paid, advance is ${b.advance_paise}`, seen);
  }

  // 4. Records that belong together: a payment's booking and owner, one provider id one payment, captured money has a date and a verifier.
  for (const x of many<{ id: string }>(`SELECT p.id FROM payments p LEFT JOIN bookings b ON b.id = p.booking_id WHERE (b.id IS NULL OR b.owner_id <> p.owner_id) ${own.replace('owner_id', 'p.owner_id')}`, ...p)) add('PAYMENT_BOOKING_MISMATCH', 'payment', x.id, 'the booking is missing or belongs to another business');
  for (const x of many<{ k: string; n: number }>(`SELECT rp_payment_id k, COUNT(*) n FROM payments WHERE rp_payment_id IS NOT NULL ${own} GROUP BY rp_payment_id HAVING n > 1`, ...p)) add('PROVIDER_PAYMENT_REUSED', 'payment', x.k, `${x.n} payments carry the same provider payment id`);
  for (const x of many<{ id: string }>(`SELECT id FROM payments WHERE status IN ('captured','partially_refunded','refunded') AND (verified_at IS NULL) ${own}`, ...p)) add('CAPTURED_WITHOUT_VERIFICATION', 'payment', x.id, 'received money with no verification time');

  // 4b. The security deposit is its own money: its balance is never negative, and an entry never belongs to another business than its booking.
  for (const x of many<{ booking_id: string; held: number }>(`SELECT booking_id, SUM(CASE kind WHEN 'collect' THEN amount_paise WHEN 'reverse' THEN amount_paise ELSE -amount_paise END) held FROM security_deposit_entries WHERE 1=1 ${own} GROUP BY booking_id HAVING held < 0`, ...p)) add('DEPOSIT_NEGATIVE', 'booking', x.booking_id, `the security deposit held is ${x.held}`);
  for (const x of many<{ id: string }>(`SELECT e.id FROM security_deposit_entries e LEFT JOIN bookings b ON b.id = e.booking_id WHERE (b.id IS NULL OR b.owner_id <> e.owner_id) ${own.replace('owner_id', 'e.owner_id')}`, ...p)) add('DEPOSIT_BOOKING_MISMATCH', 'deposit', x.id, 'the booking is missing or belongs to another business');
  // 4c. A tournament hosting deposit is never given back or kept beyond what was collected.
  for (const x of many<{ auction_id: string; held: number }>(`SELECT auction_id, SUM(CASE kind WHEN 'collect' THEN amount_paise ELSE -amount_paise END) held FROM auction_deposit_entries WHERE 1=1 ${own} GROUP BY auction_id HAVING held < 0`, ...p)) add('TOURNAMENT_DEPOSIT_NEGATIVE', 'auction', x.auction_id, `the hosting deposit held is ${x.held}`);

  // 5. Customer credit: no lot is overspent or negative.
  for (const x of many<{ id: string; amount_paise: number; remaining_paise: number }>(`SELECT id, amount_paise, remaining_paise FROM credit_lots WHERE (remaining_paise < 0 OR remaining_paise > amount_paise) ${own}`, ...p)) add('CREDIT_LOT_INVALID', 'credit_lot', x.id, `remaining ${x.remaining_paise} of ${x.amount_paise}`);

  // 6. Slots: every held or confirmed booking owns exactly its slots, and no slot belongs to a booking that is over.
  for (const x of many<{ id: string; ref: string; slot_count: number; n: number; needs_review: number }>(
    `SELECT b.id, b.ref, b.slot_count, b.needs_review, (SELECT COUNT(*) FROM booking_slots s WHERE s.booking_id = b.id) n FROM bookings b WHERE b.status IN ('held','confirmed') ${own.replace('owner_id', 'b.owner_id')}`, ...p))
    if (x.n !== x.slot_count) add('SLOTS_MISMATCH', 'booking', x.id, `${x.ref}: ${x.slot_count} slot(s) booked, ${x.n} held`, x.needs_review === 1);
  for (const x of many<{ id: string; status: string; n: number }>(
    `SELECT b.id, b.status, COUNT(*) n FROM booking_slots s JOIN bookings b ON b.id = s.booking_id WHERE b.status IN ('cancelled','expired') ${own.replace('owner_id', 'b.owner_id')} GROUP BY b.id`, ...p)) add('SLOTS_ON_ENDED_BOOKING', 'booking', x.id, `${x.n} slot(s) still held on a ${x.status} booking`);

  const live = LIVE;
  const totals = {
    receivedPaise: one<{ s: number }>(`SELECT COALESCE(SUM(amount_paise),0) s FROM payments WHERE status IN ('captured','partially_refunded','refunded') ${own}`, ...p)!.s,
    refundedPaise: one<{ s: number }>(`SELECT COALESCE(SUM(amount_paise),0) s FROM refunds WHERE status <> 'failed' ${own}`, ...p)!.s,
    heldForCustomersPaise: one<{ s: number }>(`SELECT COALESCE(SUM(paid_paise),0) s FROM bookings WHERE status IN ${live} ${own}`, ...p)!.s,
    bookings: one<{ n: number }>(`SELECT COUNT(*) n FROM bookings WHERE 1=1 ${own}`, ...p)!.n,
    payments: one<{ n: number }>(`SELECT COUNT(*) n FROM payments WHERE 1=1 ${own}`, ...p)!.n,
    refunds: one<{ n: number }>(`SELECT COUNT(*) n FROM refunds WHERE 1=1 ${own}`, ...p)!.n,
  };
  const unexplained = findings.filter((f) => !f.explained && f.severity === 'problem').length;
  return { at: now(), ownerId, events, debitsPaise: debits, creditsPaise: credits, findings, unexplained, clean: findings.every((f) => f.severity === 'info'), totals };
}

function reviewed(bookingId: string): boolean {
  return one<{ r: number }>('SELECT needs_review r FROM bookings WHERE id = ?', bookingId)?.r === 1;
}
