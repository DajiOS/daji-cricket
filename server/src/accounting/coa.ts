import type { SQLInputValue } from 'node:sqlite';
import { one, run, tx } from '../db.ts';
import { now } from '../clock.ts';
import { audit, type Actor } from '../audit.ts';
import { conflict, HttpError, notFound } from '../errors.ts';
import { Validator } from '../input.ts';
import { accountOr404, assertOpen, listAccounts, listCategories } from './store.ts';

// Chart of accounts rules, for bank/cash accounts and for income/expense categories:
//   rename any time; make inactive any time (a bank or cash account only when its balance is zero); delete only if never used.
// Inactive accounts stay in every report for dates that have entries, tagged "NAME (Inactive)", and take no new entries.

export interface CoaItem {
  id: string; type: 'account' | 'category'; holds?: string; code: string | null; name: string; kind: string; group: string;
  active: boolean; builtin: boolean; used: boolean; uses: number; balancePaise: number | null; canDelete: boolean; deleteBlock: string | null; canDeactivate: boolean; deactivateBlock: string | null;
}

function categoryUses(ownerId: string, c: { id: string; code: string; kind: string }): number {
  const n = (sql: string, ...p: SQLInputValue[]): number => one<{ n: number }>(sql, ...p)!.n;
  const jcode = `${c.kind === 'income' ? 'inc' : 'exp'}:${c.code}`;
  return n('SELECT COUNT(*) n FROM acct_transactions WHERE owner_id = ? AND category_id = ? AND deleted_at IS NULL', ownerId, c.id)
    + n('SELECT COUNT(*) n FROM acct_rules WHERE owner_id = ? AND category_id = ? AND deleted_at IS NULL', ownerId, c.id)
    + n('SELECT COUNT(*) n FROM acct_bills WHERE owner_id = ? AND category_id = ? AND deleted_at IS NULL', ownerId, c.id)
    + n('SELECT COUNT(*) n FROM acct_recurring WHERE owner_id = ? AND category_id = ?', ownerId, c.id)
    + n('SELECT COUNT(*) n FROM acct_budgets WHERE owner_id = ? AND code IN (?, ?)', ownerId, jcode, c.code)
    + n('SELECT COUNT(*) n FROM acct_journal_lines l JOIN acct_journals j ON j.id = l.journal_id WHERE j.owner_id = ? AND j.deleted_at IS NULL AND l.account_code = ?', ownerId, jcode);
}

export function listCoa(ownerId: string): CoaItem[] {
  const out: CoaItem[] = [];
  for (const a of listAccounts(ownerId)) {
    const used = a.transactions > 0 || !!one('SELECT 1 FROM acct_journal_lines l JOIN acct_journals j ON j.id = l.journal_id WHERE j.owner_id = ? AND j.deleted_at IS NULL AND l.account_code = ?', ownerId, `bank:${a.id}`);
    const bal = a.balancePaise;
    out.push({ id: a.id, type: 'account', code: null, name: a.name, kind: a.kind, holds: a.holds, group: a.kind === 'cash' ? 'Cash' : a.holds === 'card' ? 'Credit cards' : a.holds === 'loan' ? 'Loans' : 'Bank', active: a.active, builtin: false, used, uses: a.transactions,
      balancePaise: bal, canDelete: !used, deleteBlock: used ? 'It has entries, so it cannot be deleted. Make it inactive instead.' : null,
      canDeactivate: bal === 0, deactivateBlock: bal === 0 ? null : 'Its balance is not zero. Move the money out first.' });
  }
  for (const c of listCategories(ownerId)) {
    const uses = categoryUses(ownerId, c);
    out.push({ id: c.id, type: 'category', code: c.code, name: c.name, kind: c.kind, group: c.group, active: c.active, builtin: c.builtin, used: uses > 0, uses,
      balancePaise: null, canDelete: !c.builtin && uses === 0,
      deleteBlock: c.builtin ? 'Built-in categories are shared and cannot be deleted. Make it inactive instead.' : uses > 0 ? 'It has been used, so it cannot be deleted. Make it inactive instead.' : null,
      canDeactivate: true, deactivateBlock: null });
  }
  return out;
}

function findItem(ownerId: string, id: string): CoaItem {
  const it = listCoa(ownerId).find((x) => x.id === id);
  if (!it) throw notFound('Account not found');
  return it;
}

export function patchCoa(ownerId: string, id: string, actor: Actor, body: unknown): CoaItem {
  const it = findItem(ownerId, id);
  const v = new Validator(body);
  const name = v.str('name', { min: 2, max: 60 });
  const active = v.bool('active');
  v.done();
  if (name === undefined && active === undefined) throw new HttpError(400, 'VALIDATION_FAILED', 'Nothing to change', { fields: [] });
  const t = now();
  tx(() => {
    if (it.type === 'account') {
      if (name !== undefined && name !== it.name) {
        if (one('SELECT 1 FROM acct_accounts WHERE owner_id = ? AND deleted_at IS NULL AND lower(name) = lower(?) AND id <> ?', ownerId, name, id)) throw conflict('DUPLICATE', 'You already have an account with this name');
        run('UPDATE acct_accounts SET name = ?, updated_at = ?, updated_by = ? WHERE id = ?', name, t, actor.id, id);
      }
      if (active !== undefined && active !== it.active) {
        if (!active && it.balancePaise !== 0) throw conflict('BALANCE_NOT_ZERO', it.deactivateBlock!);
        const a = accountOr404(ownerId, id);
        if (a.opening_date) assertOpen(ownerId, a.opening_date);
        run('UPDATE acct_accounts SET active = ?, updated_at = ?, updated_by = ? WHERE id = ?', active ? 1 : 0, t, actor.id, id);
      }
    } else {
      if (name !== undefined && name !== it.name) {
        const clash = one('SELECT 1 FROM acct_categories c WHERE (c.owner_id IS NULL OR c.owner_id = ?) AND c.deleted_at IS NULL AND c.id <> ? AND lower(COALESCE((SELECT p.name FROM acct_category_prefs p WHERE p.owner_id = ? AND p.category_id = c.id AND p.name IS NOT NULL), c.name)) = lower(?)', ownerId, id, ownerId, name);
        if (clash) throw conflict('DUPLICATE', 'There is already a category with this name');
      }
      run(`INSERT INTO acct_category_prefs(owner_id, category_id, name, active, updated_at, updated_by) VALUES(?,?,?,?,?,?)
           ON CONFLICT(owner_id, category_id) DO UPDATE SET name = COALESCE(?, name), active = COALESCE(?, active), updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        ownerId, id, name ?? null, active === undefined ? 1 : active ? 1 : 0, t, actor.id, name ?? null, active === undefined ? null : active ? 1 : 0);
    }
  });
  audit(actor, 'acct.coa.update', `acct_${it.type}`, id, { name, active, was: it.name }, ownerId);
  return findItem(ownerId, id);
}

export function deleteCoa(ownerId: string, id: string, actor: Actor): void {
  const it = findItem(ownerId, id);
  if (!it.canDelete) throw conflict('IN_USE', it.deleteBlock ?? 'This cannot be deleted');
  const t = now();
  tx(() => {
    if (it.type === 'account') {
      const a = accountOr404(ownerId, id);
      if (a.opening_date) assertOpen(ownerId, a.opening_date);
      run('UPDATE acct_accounts SET deleted_at = ?, deleted_by = ? WHERE id = ?', t, actor.id, id);
    } else {
      run('UPDATE acct_categories SET deleted_at = ?, deleted_by = ? WHERE id = ? AND owner_id = ?', t, actor.id, id, ownerId);
      run('DELETE FROM acct_category_prefs WHERE owner_id = ? AND category_id = ?', ownerId, id);
    }
  });
  audit(actor, 'acct.coa.delete', `acct_${it.type}`, id, { name: it.name }, ownerId);
}
