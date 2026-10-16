import { one, registerSchema } from '../db.ts';
import { HttpError } from '../errors.ts';
import './schema.ts'; // the tables this adds to must exist first

// Chart of accounts: an account can be renamed, made inactive, or deleted if it has never been used.
// Bank and cash accounts carry their own `active` flag. Categories can be shared built-ins (one row for everyone), so a business's own
// name and active choice for any category live here, per owner, and the shared row is never changed.
registerSchema('coa-1', `
ALTER TABLE acct_accounts ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
CREATE TABLE acct_category_prefs (
  owner_id TEXT NOT NULL REFERENCES users(id),
  category_id TEXT NOT NULL REFERENCES acct_categories(id),
  name TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (owner_id, category_id)
);
`);

export const INACTIVE_TAG = ' (Inactive)';

/** SQL for a category's name as this business sees it. `catAlias` is the acct_categories alias, `ownerExpr` the owner id column or placeholder. */
export const effName = (catAlias: string, ownerExpr: string): string =>
  `COALESCE((SELECT p.name FROM acct_category_prefs p WHERE p.owner_id = ${ownerExpr} AND p.category_id = ${catAlias}.id AND p.name IS NOT NULL), ${catAlias}.name)`;

export function isCategoryInactive(ownerId: string, categoryId: string): boolean {
  return !!one('SELECT 1 FROM acct_category_prefs WHERE owner_id = ? AND category_id = ? AND active = 0', ownerId, categoryId);
}

/** A new transaction, rule, bill or recurring entry may not use an inactive category. Existing entries keep it. */
export function assertCategoryActive(ownerId: string, categoryId: string | null | undefined): void {
  if (categoryId && isCategoryInactive(ownerId, categoryId)) throw new HttpError(400, 'VALIDATION_FAILED', 'That category is inactive. Turn it on in Setup, Chart of accounts, or choose another.', { fields: [{ field: 'categoryId', message: 'Inactive category' }] });
}

/** A bank or cash account that is inactive takes no new lines, imports, transfers or feeds. */
export function assertAccountActive(accountId: string): void {
  const a = one<{ active: number; name: string }>('SELECT active, name FROM acct_accounts WHERE id = ?', accountId);
  if (a && !a.active) throw new HttpError(409, 'ACCOUNT_INACTIVE', `${a.name} is inactive. Turn it on in Setup, Chart of accounts, to add to it.`);
}
