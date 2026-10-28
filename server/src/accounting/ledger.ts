import { many, one } from '../db.ts';
import { now } from '../clock.ts';
import { istDate } from '../time.ts';
import '../securityDeposit.ts';
import '../auctionDeposit.ts';

// The ledger. Every figure in the reports is built from these lines, so the profit and loss, the balance sheet and the
// trial balance cannot disagree. Lines are DERIVED on demand from the real records (bank transactions, booking payments,
// refunds, account credit, the bookings themselves, and journal entries the owner typed in). Nothing is stored twice.
//
// Each event posts equal debits and credits, so the debits always equal the credits.

export interface Line {
  /** IST date, YYYY-MM-DD. */
  date: string;
  account: string;
  debit: number;
  credit: number;
  /** Where it came from, for drill-down: 'bank', 'payment', 'refund', 'credit', 'booking', 'journal', 'opening'. */
  src: string;
  ref: string;
}

export function gstPercent(ownerId: string): number {
  return one<{ gst_percent: number }>('SELECT gst_percent FROM acct_settings WHERE owner_id = ?', ownerId)?.gst_percent ?? 0;
}

/** The GST inside a GST-inclusive amount, rounded to the paise. */
export const gstInside = (amountPaise: number, percent: number): number => (percent > 0 ? Math.round((amountPaise * percent) / (100 + percent)) : 0);

class Out {
  lines: Line[] = [];
  upTo: string;
  constructor(upTo: string) { this.upTo = upTo; }
  /** Posts one balanced entry. Entries dated after `upTo` are left out. */
  post(date: string, src: string, ref: string, legs: [string, number][]): void {
    if (date > this.upTo) return;
    let d = 0, c = 0;
    for (const [account, amount] of legs) {
      if (amount === 0) continue;
      if (amount > 0) { this.lines.push({ date, account, debit: amount, credit: 0, src, ref }); d += amount; }
      else { this.lines.push({ date, account, debit: 0, credit: -amount, src, ref }); c += -amount; }
    }
    if (d !== c) throw new Error(`unbalanced ${src} entry ${ref}: debits ${d}, credits ${c}`);
  }
}

interface BookingFacts { id: string; date: string; status: string; total: number; end_at: number; cancelled_at: number | null; cancel_kind: string | null; resolution: string | null; paid: number; credit: number; refund: number }

/** Lines for one owner up to and including `upTo` (an IST date). */
export function ledgerLines(ownerId: string, upTo: string): Line[] {
  const out = new Out(upTo);
  const t = now();
  const gst = gstPercent(ownerId);

  // ---- bookings, and the day each one counts as earned
  const bookings = new Map(many<{ id: string; date: string; status: string; total_paise: number; end_at: number; cancelled_at: number | null; cancel_kind: string | null; resolution: string | null; paid_paise: number; credit_paise: number; refund_paise: number }>(
    'SELECT id, date, status, total_paise, end_at, cancelled_at, cancel_kind, resolution, paid_paise, credit_paise, refund_paise FROM bookings WHERE owner_id = ?', ownerId)
    .map((b): [string, BookingFacts] => [b.id, { id: b.id, date: b.date, status: b.status, total: b.total_paise, end_at: b.end_at, cancelled_at: b.cancelled_at, cancel_kind: b.cancel_kind, resolution: b.resolution, paid: b.paid_paise, credit: b.credit_paise, refund: b.refund_paise }]));
  /** The day a session is earned: its date, once it has been played (or was a no-show). Null for anything else. */
  const earnedOn = (b: BookingFacts | undefined): string | null => {
    if (!b) return null;
    if (b.status === 'no_show') return b.date;
    if ((b.status === 'confirmed' || b.status === 'completed') && b.end_at <= t) return b.date;
    return null;
  };

  // ---- opening balances
  for (const a of many<{ id: string; opening_paise: number; opening_date: string | null; created_at: number }>('SELECT id, opening_paise, opening_date, created_at FROM acct_accounts WHERE owner_id = ? AND deleted_at IS NULL AND opening_paise <> 0', ownerId)) {
    out.post(a.opening_date ?? istDate(a.created_at), 'opening', a.id, [[`bank:${a.id}`, a.opening_paise], ['opening_equity', -a.opening_paise]]);
  }

  // ---- bank and cash transactions, by the category they were given
  const txns = many<{ id: string; account_id: string; txn_date: string; amount_paise: number; kind: string | null; code: string | null }>(
    `SELECT t.id, t.account_id, t.txn_date, t.amount_paise, c.kind, c.code FROM acct_transactions t
     JOIN acct_accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
     LEFT JOIN acct_categories c ON c.id = t.category_id
     WHERE t.owner_id = ? AND t.deleted_at IS NULL AND t.txn_date <= ?`, ownerId, upTo);
  for (const x of txns) {
    out.post(x.txn_date, 'bank', x.id, [[`bank:${x.account_id}`, x.amount_paise], [counterAccount(x.kind, x.code), -x.amount_paise]]);
  }

  // ---- booking payments: money received
  const pays = many<{ id: string; booking_id: string; method: string; amount_paise: number; verified_at: number }>(
    "SELECT id, booking_id, method, amount_paise, verified_at FROM payments WHERE owner_id = ? AND status IN ('captured','refunded','partially_refunded') AND verified_at IS NOT NULL", ownerId);
  const clearing = (method: string): string => (method === 'cash' ? 'cash_bookings' : method === 'credit' ? 'customer_credits' : 'gateway_clearing');
  for (const p of pays) {
    const d = istDate(p.verified_at);
    const earned = earnedOn(bookings.get(p.booking_id));
    // Money that arrives after the session was played settles what the customer owed; before that it is an advance.
    out.post(d, 'payment', p.id, [[clearing(p.method), p.amount_paise], [earned !== null && d > earned ? 'receivables' : 'customer_advances', -p.amount_paise]]);
  }

  // ---- refunds: money given back (a failed one never happened)
  const refunds = many<{ id: string; booking_id: string; mode: string; amount_paise: number; created_at: number }>("SELECT id, booking_id, mode, amount_paise, created_at FROM refunds WHERE owner_id = ? AND status <> 'failed'", ownerId);
  for (const r of refunds) {
    const d = istDate(r.created_at);
    const earned = earnedOn(bookings.get(r.booking_id));
    // A refund after the session was played takes money back out of what was earned.
    out.post(d, 'refund', r.id, [[earned !== null && d > earned ? 'booking_income' : 'customer_advances', r.amount_paise], [r.mode === 'gateway' ? 'gateway_clearing' : 'refunds_payable', -r.amount_paise]]);
  }

  // ---- security deposits (securityDeposit.ts): a liability of their own, kept apart from the booking advance and from booking income
  for (const e of many<{ id: string; kind: string; amount_paise: number; method: string | null; created_at: number }>('SELECT id, kind, amount_paise, method, created_at FROM security_deposit_entries WHERE owner_id = ?', ownerId)) {
    const cash = e.method === 'cash' ? 'cash_bookings' : 'gateway_clearing', d = istDate(e.created_at), n = e.amount_paise;
    if (e.kind === 'collect') out.post(d, 'sdeposit', e.id, [[cash, n], ['security_deposits_held', -n]]);
    else if (e.kind === 'refund') out.post(d, 'sdeposit', e.id, [['security_deposits_held', n], [cash, -n]]);
    else if (e.kind === 'deduct') out.post(d, 'sdeposit', e.id, [['security_deposits_held', n], ['deposit_deductions', -n]]);
    else out.post(d, 'sdeposit', e.id, [['deposit_deductions', n], ['security_deposits_held', -n]]);
  }

  // ---- tournament hosting deposits (auctionDeposit.ts): a refundable liability of their own; never booking money
  for (const e of many<{ id: string; kind: string; amount_paise: number; method: string | null; created_at: number }>('SELECT id, kind, amount_paise, method, created_at FROM auction_deposit_entries WHERE owner_id = ?', ownerId)) {
    const cash = e.method === 'cash' ? 'cash_bookings' : 'gateway_clearing', d = istDate(e.created_at), n = e.amount_paise;
    if (e.kind === 'collect') out.post(d, 'tdeposit', e.id, [[cash, n], ['tournament_deposits_held', -n]]);
    else if (e.kind === 'refund') out.post(d, 'tdeposit', e.id, [['tournament_deposits_held', n], [cash, -n]]);
    else out.post(d, 'tdeposit', e.id, [['tournament_deposits_held', n], ['tournament_deposits_kept', -n]]);
  }

  // ---- account credit: issued, expired, written down
  for (const l of many<{ id: string; amount_paise: number; source: string; issued_at: number }>('SELECT id, amount_paise, source, issued_at FROM credit_lots WHERE owner_id = ?', ownerId)) {
    const fromBooking = l.source === 'cancellation' || l.source === 'restore';
    out.post(istDate(l.issued_at), 'credit', l.id, [[fromBooking ? 'customer_advances' : 'exp:goodwill', l.amount_paise], ['customer_credits', -l.amount_paise]]);
  }
  for (const l of many<{ id: string; kind: string; amount_paise: number; created_at: number }>("SELECT id, kind, amount_paise, created_at FROM credit_ledger WHERE owner_id = ? AND amount_paise < 0 AND kind IN ('expired','adjusted')", ownerId)) {
    out.post(istDate(l.created_at), 'credit', l.id, [['customer_credits', -l.amount_paise], [l.kind === 'expired' ? 'forfeited_income' : 'exp:goodwill', l.amount_paise]]);
  }

  // ---- what the bookings earned
  const refundsBy = new Map<string, { date: string; amount: number }[]>();
  for (const r of refunds) { const a = refundsBy.get(r.booking_id) ?? []; a.push({ date: istDate(r.created_at), amount: r.amount_paise }); refundsBy.set(r.booking_id, a); }
  const paysBy = new Map<string, { date: string; amount: number }[]>();
  for (const p of pays) { const a = paysBy.get(p.booking_id) ?? []; a.push({ date: istDate(p.verified_at), amount: p.amount_paise }); paysBy.set(p.booking_id, a); }
  /** What the customer had paid us, net of refunds, as at the end of `date`. */
  const heldOn = (bookingId: string, date: string): number =>
    (paysBy.get(bookingId) ?? []).filter((x) => x.date <= date).reduce((s, x) => s + x.amount, 0) - (refundsBy.get(bookingId) ?? []).filter((x) => x.date <= date).reduce((s, x) => s + x.amount, 0);

  for (const b of bookings.values()) {
    const earned = earnedOn(b);
    if (earned !== null && b.status !== 'no_show') {
      const held = Math.max(heldOn(b.id, earned), 0);
      const fromAdvance = Math.min(held, b.total);
      const g = gstInside(b.total, gst);
      out.post(earned, 'booking', b.id, [['customer_advances', fromAdvance], ['receivables', b.total - fromAdvance], ['booking_income', -(b.total - g)], ['gst_payable', -g]]);
    } else if (earned !== null) {
      // A no-show keeps whatever advance was paid.
      const held = Math.max(heldOn(b.id, earned), 0);
      out.post(earned, 'booking', b.id, [['customer_advances', held], ['forfeited_income', -held]]);
    } else if (b.status === 'cancelled' && (b.cancel_kind === 'credit' || b.cancel_kind === 'free') && b.resolution !== 'awaiting' && b.cancelled_at !== null) {
      // Cancelled late, or refunded to the payment method for only a share: part became credit or went back (posted above), the rest is kept.
      // (A booking the ground cancelled keeps nothing, and while the customer has not chosen yet the money stays held for them.)
      const kept = Math.max(b.paid - b.credit - b.refund, 0);
      out.post(istDate(b.cancelled_at), 'booking', b.id, [['customer_advances', kept], ['forfeited_income', -kept]]);
    }
  }

  // ---- entries the owner typed in
  const js = many<{ id: string; entry_date: string }>('SELECT id, entry_date FROM acct_journals WHERE owner_id = ? AND deleted_at IS NULL AND entry_date <= ?', ownerId, upTo);
  for (const j of js) {
    const legs = many<{ account_code: string; debit_paise: number; credit_paise: number }>('SELECT account_code, debit_paise, credit_paise FROM acct_journal_lines WHERE journal_id = ? ORDER BY id', j.id);
    out.post(j.entry_date, 'journal', j.id, legs.map((l): [string, number] => [l.account_code, l.debit_paise - l.credit_paise]));
  }
  return out.lines;
}

/** The other side of a bank transaction, by what it was categorised as. */
function counterAccount(kind: string | null, code: string | null): string {
  if (!kind || !code) return 'suspense';
  switch (kind) {
    case 'income': return `inc:${code}`;
    case 'expense': return `exp:${code}`;
    case 'booking_receipt': return 'gateway_clearing';
    case 'ignore': return 'ignored';
    case 'transfer':
      switch (code) {
        case 'owner_capital': return 'capital';
        case 'owner_drawings': return 'drawings';
        case 'internal_transfer': return 'transfers_in_transit';
        case 'cash_deposit': return 'cash_bookings';
        case 'loan': return 'loans';
        case 'asset_purchase': return 'fixed_assets';
        case 'gst_remitted': return 'gst_payable';
        case 'customer_refund': return 'refunds_payable';
        default: return 'suspense';
      }
    default: return 'suspense';
  }
}

export interface Balance { debit: number; credit: number }
export function sumBy(lines: Line[], pred: (l: Line) => boolean = () => true): Map<string, Balance> {
  const m = new Map<string, Balance>();
  for (const l of lines) {
    if (!pred(l)) continue;
    const b = m.get(l.account) ?? { debit: 0, credit: 0 };
    b.debit += l.debit; b.credit += l.credit;
    m.set(l.account, b);
  }
  return m;
}
