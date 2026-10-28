import { many, one, registerSchema, run, tx } from './db.ts';
import { now } from './clock.ts';
import { audit, type Actor } from './audit.ts';
import { HttpError, conflict, forbidden, notFound } from './errors.ts';
import { newId } from './ids.ts';
import { Validator } from './input.ts';
import { hasPermission, type UserRow } from './auth.ts';
import { pushNotify } from './notifications.ts';
import './appendOnly.ts';

// The hosting deposit for an auction tournament (owner's decision, 28 Oct 2026): a customer who hosts puts down a refundable
// deposit, so the free auction is not used for tournaments played somewhere else. The auction stays hidden from players until
// the deposit is paid or an admin (the owner or the software owner) approves the host's request to waive it. It is given back
// when the tournament ends.
// It is real money, so it follows the money rules: it is not booking money and never touches a booking's price, advance or
// payments; staff record it when it reaches the ground (cash, UPI, card or bank) and when it goes back; keeping any of it is the
// owner's decision with a written reason the host sees. Entries are append-only and every figure is worked out from them:
//   held = collected - refunded - kept
// The books show it as a refundable liability of its own (accounting/ledger.ts). Platform AI and the host can only read it.

registerSchema('auction-deposit-1', `
CREATE TABLE auction_deposits (
  auction_id TEXT PRIMARY KEY REFERENCES auctions(id),
  owner_id TEXT NOT NULL,
  host_id TEXT NOT NULL,
  required_paise INTEGER NOT NULL CHECK (required_paise >= 0),
  claim_reference TEXT,
  claim_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE auction_deposit_entries (
  id TEXT PRIMARY KEY,
  auction_id TEXT NOT NULL REFERENCES auctions(id),
  owner_id TEXT NOT NULL,
  host_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('collect','refund','keep')),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  method TEXT CHECK (method IN ('cash','upi','card','bank')),
  reason TEXT,
  reference TEXT,
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_auction_deposit_entries_a ON auction_deposit_entries(auction_id, created_at);
CREATE INDEX ix_auction_deposit_entries_o ON auction_deposit_entries(owner_id, created_at);
CREATE TRIGGER trg_ao_auction_deposit_entries_update BEFORE UPDATE ON auction_deposit_entries BEGIN SELECT RAISE(ABORT, 'auction_deposit_entries is append-only: update refused'); END;
CREATE TRIGGER trg_ao_auction_deposit_entries_delete BEFORE DELETE ON auction_deposit_entries BEGIN SELECT RAISE(ABORT, 'auction_deposit_entries is append-only: delete refused'); END;

CREATE TABLE auction_deposit_waivers (
  id TEXT PRIMARY KEY,
  auction_id TEXT NOT NULL REFERENCES auctions(id),
  owner_id TEXT NOT NULL,
  host_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined','withdrawn')),
  decided_by TEXT,
  decided_role TEXT,
  decided_at INTEGER,
  decision_note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX ix_auction_deposit_waivers_a ON auction_deposit_waivers(auction_id, status);
CREATE INDEX ix_auction_deposit_waivers_o ON auction_deposit_waivers(owner_id, status);
`);

interface DRow { auction_id: string; owner_id: string; host_id: string; required_paise: number; claim_reference: string | null; claim_at: number | null }
export interface DepositEntry { id: string; kind: 'collect' | 'refund' | 'keep'; amountPaise: number; method: string | null; reason: string | null; reference: string | null; createdAt: number }
export interface DepositState {
  requiredPaise: number; collectedPaise: number; refundedPaise: number; keptPaise: number; heldPaise: number;
  /** An admin approved the host's request to waive it. */
  waived: boolean;
  waiver: { id: string; status: string; reason: string; decisionNote: string | null; createdAt: number } | null;
  /** The host said they paid (a UPI or bank reference) and staff have not recorded it yet. */
  claimReference: string | null;
  /** Paid in full, waived, or none needed: players can see the auction. */
  settled: boolean;
  entries: DepositEntry[];
}

const drow = (aid: string): DRow | undefined => one<DRow>('SELECT * FROM auction_deposits WHERE auction_id = ?', aid);

export function depositState(aid: string): DepositState {
  const d = drow(aid);
  const es = many<{ id: string; kind: DepositEntry['kind']; amount_paise: number; method: string | null; reason: string | null; reference: string | null; created_at: number }>(
    'SELECT id, kind, amount_paise, method, reason, reference, created_at FROM auction_deposit_entries WHERE auction_id = ? ORDER BY created_at, rowid', aid);
  const sum = (k: string) => es.filter((e) => e.kind === k).reduce((s, e) => s + e.amount_paise, 0);
  const collected = sum('collect'), refunded = sum('refund'), kept = sum('keep');
  const w = one<{ id: string; status: string; reason: string; decision_note: string | null; created_at: number }>("SELECT id, status, reason, decision_note, created_at FROM auction_deposit_waivers WHERE auction_id = ? AND status <> 'withdrawn' ORDER BY created_at DESC, rowid DESC LIMIT 1", aid);
  const required = d?.required_paise ?? 0;
  const waived = w?.status === 'approved';
  return {
    requiredPaise: required, collectedPaise: collected, refundedPaise: refunded, keptPaise: kept, heldPaise: collected - refunded - kept,
    waived, waiver: w ? { id: w.id, status: w.status, reason: w.reason, decisionNote: w.decision_note, createdAt: w.created_at } : null,
    claimReference: collected >= required ? null : d?.claim_reference ?? null,
    settled: required === 0 || waived || collected >= required,
    entries: es.map((e) => ({ id: e.id, kind: e.kind, amountPaise: e.amount_paise, method: e.method, reason: e.reason, reference: e.reference, createdAt: e.created_at })),
  };
}
export const depositSettled = (aid: string): boolean => depositState(aid).settled;

/** Called when an auction is made: the amount due is fixed then, so a later change in Settings does not move it. */
export function openDeposit(aid: string, ownerId: string, hostId: string, requiredPaise: number): void {
  run('INSERT INTO auction_deposits(auction_id, owner_id, host_id, required_paise, created_at) VALUES(?,?,?,?,?)', aid, ownerId, hostId, requiredPaise, now());
}

function forAuction(aid: string, ownerId?: string): DRow {
  const d = drow(aid);
  if (!d || (ownerId !== undefined && d.owner_id !== ownerId)) throw notFound('Auction not found');
  return d;
}
const status = (aid: string): string => one<{ status: string }>('SELECT status FROM auctions WHERE id = ?', aid)?.status ?? '';
const bumpAuction = (aid: string): void => { run('UPDATE auctions SET version = version + 1, updated_at = ? WHERE id = ?', now(), aid); };
const rupees = (p: number): string => `₹${(p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// ------------------------------------------------------------------ the host

/** The host says they paid by UPI or bank transfer and gives the reference; staff check it and record it. Nothing is marked paid here. */
export function claimPaid(u: UserRow, aid: string, src: unknown): DepositState {
  const d = forAuction(aid);
  if (d.host_id !== u.id) throw forbidden('Only the host can do this');
  const v = new Validator(src);
  const ref = v.str('reference', { required: true, min: 4, max: 60 });
  v.done();
  const s = depositState(aid);
  if (s.settled) throw conflict('DEPOSIT_SETTLED', 'Nothing is due for this auction');
  run('UPDATE auction_deposits SET claim_reference = ?, claim_at = ? WHERE auction_id = ?', ref!, now(), aid);
  audit({ id: u.id, role: u.role }, 'auction.deposit_claim', 'auction', aid, { reference: ref }, d.owner_id);
  bumpAuction(aid);
  return depositState(aid);
}

/** The host asks an admin to waive the deposit, saying why. */
export function requestWaiver(u: UserRow, aid: string, src: unknown): DepositState {
  const d = forAuction(aid);
  if (d.host_id !== u.id) throw forbidden('Only the host can do this');
  const v = new Validator(src);
  const reason = v.str('reason', { required: true, min: 10, max: 500 });
  v.done();
  return tx(() => {
    const s = depositState(aid);
    if (s.settled) throw conflict('DEPOSIT_SETTLED', 'Nothing is due for this auction');
    if (s.collectedPaise > 0) throw conflict('DEPOSIT_PART_PAID', 'Part of the deposit is already paid. Call the ground about the rest.');
    if (s.waiver?.status === 'pending') throw conflict('WAIVER_PENDING', 'Your request is already with the ground');
    if (s.waiver?.status === 'declined' && many("SELECT 1 FROM auction_deposit_waivers WHERE auction_id = ? AND status = 'declined'", aid).length >= 2) throw conflict('WAIVER_DECLINED', 'The ground has turned this request down. Pay the deposit to open the auction.');
    const id = newId('adw');
    run('INSERT INTO auction_deposit_waivers(id, auction_id, owner_id, host_id, reason, created_at) VALUES(?,?,?,?,?,?)', id, aid, d.owner_id, u.id, reason!, now());
    audit({ id: u.id, role: u.role }, 'auction.deposit_waiver_request', 'auction', aid, { waiverId: id }, d.owner_id);
    bumpAuction(aid);
    return depositState(aid);
  });
}

// ------------------------------------------------------------------ the ground's staff

const ownerLevel = (u: UserRow) => u.role === 'owner' || u.role === 'super_admin';

/** An admin (the owner or the software owner) approves or turns down a waiver request. Staff cannot. */
export function decideWaiver(u: UserRow, ownerId: string, aid: string, src: unknown): DepositState {
  if (!ownerLevel(u)) throw forbidden('Waiving a deposit is for the owner or the software owner');
  forAuction(aid, ownerId);
  const v = new Validator(src);
  const approve = v.bool('approve', true);
  const note = v.str('note', { max: 300, required: approve === false });
  v.done();
  return tx(() => {
    const w = one<{ id: string; host_id: string }>("SELECT id, host_id FROM auction_deposit_waivers WHERE auction_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1", aid);
    if (!w) throw notFound('No waiver request is waiting');
    run('UPDATE auction_deposit_waivers SET status = ?, decided_by = ?, decided_role = ?, decided_at = ?, decision_note = ? WHERE id = ?', approve ? 'approved' : 'declined', u.id, u.role, now(), note ?? null, w.id);
    audit({ id: u.id, role: u.role }, approve ? 'auction.deposit_waived' : 'auction.deposit_waiver_declined', 'auction', aid, { waiverId: w.id, note: note ?? null }, ownerId);
    bumpAuction(aid);
    pushNotify(w.host_id, 'auction_deposit_waiver', approve ? 'Deposit waived' : 'Deposit not waived', approve ? 'The ground waived the hosting deposit. Your auction is open to players.' : `The ground did not waive the hosting deposit: ${note}`);
    return depositState(aid);
  });
}

/**
 * Staff record money for the deposit: collected when it reaches the ground, refunded when it goes back.
 * Keeping any of it is the owner's decision, with a reason of at least 10 characters that the host sees.
 */
export function recordDepositEntry(u: UserRow, ownerId: string, aid: string, kind: DepositEntry['kind'], src: unknown): DepositState {
  if (kind === 'keep' ? !ownerLevel(u) : !(ownerLevel(u) || hasPermission(u, 'record_payments'))) throw forbidden(kind === 'keep' ? 'Keeping a hosting deposit is the owner\'s decision' : 'This needs the "record_payments" permission');
  const d = forAuction(aid, ownerId);
  const v = new Validator(src);
  const amount = v.int('amountPaise', { min: 1, max: 100_000_000 });
  const method = kind === 'keep' ? undefined : v.oneOf('method', ['cash', 'upi', 'card', 'bank'] as const, true);
  const reference = v.str('reference', { max: 80 });
  const reason = v.str('reason', { max: 300, required: kind === 'keep' });
  v.done();
  if (kind === 'keep' && (reason ?? '').trim().length < 10) throw new HttpError(400, 'REASON_REQUIRED', 'Say why the deposit is kept (at least 10 characters). The host sees it.');
  const actor: Actor = { id: u.id, role: u.role };
  return tx(() => {
    const s = depositState(aid);
    const st = status(aid);
    let amt = amount ?? 0;
    if (kind === 'collect') {
      const due = s.requiredPaise - s.collectedPaise;
      if (s.waived || due <= 0) throw conflict('DEPOSIT_SETTLED', 'Nothing is due for this auction');
      if (amount === undefined) amt = due;
      if (amt > due) throw conflict('DEPOSIT_TOO_MUCH', `Only ${rupees(due)} is due`, { duePaise: due });
    } else {
      if (s.heldPaise <= 0) throw conflict('NOTHING_HELD', 'No deposit is held for this auction');
      if (amount === undefined) amt = s.heldPaise;
      if (amt > s.heldPaise) throw conflict('DEPOSIT_TOO_SMALL', `Only ${rupees(s.heldPaise)} is held`, { heldPaise: s.heldPaise });
      if (kind === 'keep' && st !== 'completed' && st !== 'cancelled') throw conflict('TOURNAMENT_NOT_OVER', 'A deposit can only be kept once the auction has finished or was cancelled');
    }
    const id = newId('ade');
    run('INSERT INTO auction_deposit_entries(id, auction_id, owner_id, host_id, kind, amount_paise, method, reason, reference, actor_id, actor_role, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      id, aid, d.owner_id, d.host_id, kind, amt, method ?? null, reason?.trim() ?? null, reference ?? null, u.id, u.role, now());
    const after = depositState(aid);
    audit(actor, `auction.deposit_${kind}`, 'auction', aid, { entryId: id, amountPaise: amt, method: method ?? null, reason: reason?.trim() ?? null, heldBefore: s.heldPaise, heldAfter: after.heldPaise }, d.owner_id);
    bumpAuction(aid);
    const msg = kind === 'collect' ? (after.settled ? `The ground received your ${rupees(amt)} hosting deposit. Your auction is open to players.` : `The ground received ${rupees(amt)} of your hosting deposit.`)
      : kind === 'refund' ? `The ground gave back ${rupees(amt)} of your hosting deposit.` : `The ground kept ${rupees(amt)} of your hosting deposit: ${reason!.trim()}`;
    pushNotify(d.host_id, 'auction_deposit', 'Hosting deposit', msg);
    return after;
  });
}

/** For the Desk list and staff Ask AI: what each auction at a business owes, holds or waits for. */
export function depositsAt(ownerId: string): { heldPaise: number; duePaise: number; waiversWaiting: number } {
  const ds = many<{ auction_id: string }>('SELECT auction_id FROM auction_deposits WHERE owner_id = ?', ownerId).map((r) => ({ id: r.auction_id, s: depositState(r.auction_id), st: status(r.auction_id) }));
  return {
    heldPaise: ds.reduce((n, x) => n + x.s.heldPaise, 0),
    duePaise: ds.filter((x) => !x.s.settled && x.st !== 'cancelled').reduce((n, x) => n + x.s.requiredPaise - x.s.collectedPaise, 0),
    waiversWaiting: ds.filter((x) => x.s.waiver?.status === 'pending').length,
  };
}
/** A deposit the ground still holds for this person as a host, so their account is not deleted with money still owed back to them. */
export const heldForHost = (hostId: string): number => one<{ s: number | null }>("SELECT SUM(CASE kind WHEN 'collect' THEN amount_paise ELSE -amount_paise END) s FROM auction_deposit_entries WHERE host_id = ?", hostId)?.s ?? 0;
