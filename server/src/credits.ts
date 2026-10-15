import type { CreditSummary } from '@daji/shared';
import { many, one, run, tx } from './db.ts';
import { now } from './clock.ts';
import { newId } from './ids.ts';
import { DAY } from './time.ts';
import { HttpError } from './errors.ts';
import { getSettings } from './settings.ts';
import { audit, type Actor } from './audit.ts';
import { notify } from './notifications.ts';

// Credit is a liability of the owner who took the money, so it is held per (customer, owner) and only spent at that owner's grounds.

export function balance(customerId: string, ownerId?: string): number {
  const where = ownerId ? 'AND owner_id = ?' : '';
  const p = ownerId ? [customerId, now(), ownerId] : [customerId, now()];
  return one<{ s: number | null }>(`SELECT SUM(remaining_paise) s FROM credit_lots WHERE customer_id = ? AND remaining_paise > 0 AND expires_at > ? ${where}`, ...p)?.s ?? 0;
}

function ledger(customerId: string, ownerId: string, lotId: string | null, kind: 'issued' | 'redeemed' | 'adjusted' | 'expired' | 'restored', amount: number, bookingId: string | null, note: string | null, by: string | null): void {
  run('INSERT INTO credit_ledger(id, customer_id, owner_id, lot_id, kind, amount_paise, balance_after_paise, booking_id, note, created_at, created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    newId('led'), customerId, ownerId, lotId, kind, amount, balance(customerId, ownerId), bookingId, note, now(), by);
}

export function issueCredit(o: { customerId: string; ownerId: string; amountPaise: number; source: 'cancellation' | 'adjustment' | 'restore' | 'goodwill'; bookingId?: string | null; note?: string | null; by?: string | null; expiresAt?: number; ledgerKind?: 'issued' | 'restored' | 'adjusted'; silent?: boolean }): { lotId: string; expiresAt: number } {
  if (!Number.isInteger(o.amountPaise) || o.amountPaise <= 0) throw new Error('credit amount must be a positive whole number of paise');
  const id = newId('lot');
  const t = now();
  const expiresAt = o.expiresAt ?? t + getSettings().creditExpiryDays * DAY;
  tx(() => {
    run('INSERT INTO credit_lots(id, customer_id, owner_id, amount_paise, remaining_paise, source, booking_id, issued_at, expires_at, note, created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      id, o.customerId, o.ownerId, o.amountPaise, o.amountPaise, o.source, o.bookingId ?? null, t, expiresAt, o.note ?? null, o.by ?? null);
    ledger(o.customerId, o.ownerId, id, o.ledgerKind ?? (o.source === 'restore' ? 'restored' : 'issued'), o.amountPaise, o.bookingId ?? null, o.note ?? null, o.by ?? null);
  });
  if (!o.silent) notify(o.customerId, 'credit_issued', { creditPaise: o.amountPaise, expiresAt, extra: o.note ?? undefined }, o.bookingId ?? null);
  return { lotId: id, expiresAt };
}

/** Takes `amount` from the lots that expire first. Throws CREDIT_INSUFFICIENT if the balance is too low. */
export function consume(customerId: string, ownerId: string, amount: number, kind: 'redeemed' | 'adjusted', bookingId: string | null, note: string | null, by: string | null): { lotId: string; amountPaise: number }[] {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('amount must be a positive whole number of paise');
  return tx(() => {
    if (balance(customerId, ownerId) < amount) throw new HttpError(409, 'CREDIT_INSUFFICIENT', 'Not enough account credit');
    const lots = many<{ id: string; remaining_paise: number }>('SELECT id, remaining_paise FROM credit_lots WHERE customer_id = ? AND owner_id = ? AND remaining_paise > 0 AND expires_at > ? ORDER BY expires_at, issued_at, id', customerId, ownerId, now());
    let left = amount;
    const used: { lotId: string; amountPaise: number }[] = [];
    for (const l of lots) {
      if (left === 0) break;
      const take = Math.min(left, l.remaining_paise);
      run('UPDATE credit_lots SET remaining_paise = remaining_paise - ? WHERE id = ?', take, l.id);
      ledger(customerId, ownerId, l.id, kind, -take, bookingId, note, by);
      used.push({ lotId: l.id, amountPaise: take });
      left -= take;
    }
    return used;
  });
}

export function redeem(customerId: string, ownerId: string, amount: number, bookingId: string): { lotId: string; amountPaise: number }[] {
  return consume(customerId, ownerId, amount, 'redeemed', bookingId, null, customerId);
}

/** Staff/admin adjustment: positive adds a lot, negative consumes oldest-expiring credit. */
export function adjust(customerId: string, ownerId: string, deltaPaise: number, note: string, actor: Actor): void {
  if (!Number.isInteger(deltaPaise) || deltaPaise === 0) throw new HttpError(400, 'VALIDATION_FAILED', 'Adjustment must be a non-zero whole number of paise', { fields: [{ field: 'amountPaise', message: 'Must be a non-zero whole number' }] });
  tx(() => {
    if (deltaPaise > 0) issueCredit({ customerId, ownerId, amountPaise: deltaPaise, source: 'adjustment', note, by: actor.id, ledgerKind: 'adjusted' });
    else consume(customerId, ownerId, -deltaPaise, 'adjusted', null, note, actor.id);
    audit(actor, 'credit.adjust', 'user', customerId, { deltaPaise, note }, ownerId);
  });
}

/** Writes off lots past their expiry. Returns the total paise expired. Safe to run repeatedly. */
export function expireDue(): { totalPaise: number; lots: number } {
  const t = now();
  const due = many<{ id: string; customer_id: string; owner_id: string; remaining_paise: number }>('SELECT id, customer_id, owner_id, remaining_paise FROM credit_lots WHERE remaining_paise > 0 AND expires_at <= ? AND expired_at IS NULL', t);
  let total = 0;
  for (const l of due) {
    let wrote = 0;
    tx(() => {
      const fresh = one<{ remaining_paise: number }>('SELECT remaining_paise FROM credit_lots WHERE id = ? AND expired_at IS NULL', l.id);
      if (!fresh || fresh.remaining_paise <= 0) return;
      run('UPDATE credit_lots SET expired_at = ?, remaining_paise = 0 WHERE id = ?', t, l.id);
      ledger(l.customer_id, l.owner_id, l.id, 'expired', -fresh.remaining_paise, null, 'Credit expired', null);
      wrote = fresh.remaining_paise;
      total += wrote;
      audit({ id: null, role: 'system' }, 'credit.expire', 'credit_lot', l.id, { amountPaise: wrote }, l.owner_id);
    });
    if (wrote) notify(l.customer_id, 'credit_expired', { creditPaise: wrote });
  }
  return { totalPaise: total, lots: due.length };
}

export function summary(customerId: string): CreditSummary {
  const lots = many<any>('SELECT * FROM credit_lots WHERE customer_id = ? ORDER BY issued_at DESC, rowid DESC LIMIT 100', customerId).map((l) => ({
    id: l.id, ownerId: l.owner_id, amountPaise: l.amount_paise, remainingPaise: l.remaining_paise, source: l.source, bookingId: l.booking_id, issuedAt: l.issued_at, expiresAt: l.expires_at, expiredAt: l.expired_at,
  }));
  const led = many<any>('SELECT * FROM credit_ledger WHERE customer_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 200', customerId).map((l) => ({
    id: l.id, ownerId: l.owner_id, kind: l.kind, amountPaise: l.amount_paise, balanceAfterPaise: l.balance_after_paise, bookingId: l.booking_id, note: l.note, createdAt: l.created_at,
  }));
  const byOwner = many<{ owner_id: string; name: string; s: number }>(
    `SELECT l.owner_id, COALESCE(u.business_name, u.name) AS name, SUM(l.remaining_paise) s FROM credit_lots l JOIN users u ON u.id = l.owner_id
     WHERE l.customer_id = ? AND l.remaining_paise > 0 AND l.expires_at > ? GROUP BY l.owner_id ORDER BY name`, customerId, now())
    .map((r) => ({ ownerId: r.owner_id, ownerName: r.name, balancePaise: r.s }));
  return { balancePaise: balance(customerId), byOwner, lots, ledger: led };
}
