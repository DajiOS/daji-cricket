import { one } from '../db.ts';
import { type Actor } from '../audit.ts';
import { addTransaction, deleteTransaction } from './store.ts';
import { BUILTIN_CATEGORIES, categoryId } from './schema.ts';
import { db } from '../db.ts';

// Posting money that other parts of the app already know about (salaries paid, tournament fees, memberships) into the
// books as ordinary manual transactions, and taking them out again when the source is undone. Reuses store.ts, so the
// month sign-off lock (409 PERIOD_LOCKED), the audit trail and the account/category checks all apply unchanged.
// A business with no cash or bank account yet simply gets no ledger entry: the caller's own record is never blocked by it.

export interface LedgerRef { transactionId: string; accountId: string }

/** Cash goes to the owner's cash account when there is one; UPI, bank, card and cheque go to a bank account; either falls back to the first account. */
export function pickAccount(ownerId: string, method: string): string | null {
  const want = method === 'cash' ? 'cash' : 'bank';
  const rows = (db().prepare('SELECT id, kind FROM acct_accounts WHERE owner_id = ? AND deleted_at IS NULL ORDER BY created_at, id').all(ownerId)) as { id: string; kind: string }[];
  return (rows.find((r) => r.kind === want) ?? rows[0])?.id ?? null;
}

/** Make sure a built-in category row exists (older databases were seeded before it was added). */
export function ensureCategory(code: string): string {
  const id = categoryId(code);
  if (!one('SELECT 1 FROM acct_categories WHERE id = ?', id)) {
    const c = BUILTIN_CATEGORIES.find((x) => x.code === code);
    if (!c) throw new Error(`unknown built-in category ${code}`);
    db().prepare('INSERT OR IGNORE INTO acct_categories(id, owner_id, code, name, kind, group_name, sort, created_at, updated_at) VALUES(?,NULL,?,?,?,?,?,0,0)').run(id, c.code, c.name, c.kind, c.group, c.sort);
  }
  return id;
}

/** Positive amountPaise = money in, negative = money out. Returns null (nothing posted) when there is no account or the amount is zero. Throws 409 PERIOD_LOCKED for a signed-off month. */
export function postToLedger(ownerId: string, actor: Actor, o: { date: string; amountPaise: number; description: string; categoryCode: string; method: string; reference?: string | null }): LedgerRef | null {
  if (!o.amountPaise) return null;
  const accountId = pickAccount(ownerId, o.method);
  if (!accountId) return null;
  const t = addTransaction(ownerId, actor, {
    accountId, date: o.date, amountPaise: o.amountPaise, description: o.description.slice(0, 200),
    categoryId: ensureCategory(o.categoryCode), ...(o.reference ? { reference: o.reference.slice(0, 60) } : {}),
  });
  return { transactionId: t.id, accountId };
}

/** Takes a previously posted transaction out of the books. Quietly does nothing when there is none or the owner already removed it. Throws 409 PERIOD_LOCKED for a signed-off month. */
export function removeFromLedger(ownerId: string, actor: Actor, transactionId: string | null | undefined): void {
  if (!transactionId) return;
  if (!one('SELECT 1 FROM acct_transactions WHERE id = ? AND owner_id = ? AND deleted_at IS NULL', transactionId, ownerId)) return;
  deleteTransaction(ownerId, transactionId, actor);
}
