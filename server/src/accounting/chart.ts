import { many } from '../db.ts';
import { INACTIVE_TAG } from './catprefs.ts';

// The chart of accounts. Everything the books know about is one of these. Money is integer paise.
// Normal balance: assets and expenses are debit accounts; liabilities, equity and income are credit accounts.

export type AcctType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

export interface AcctInfo {
  code: string;
  name: string;
  type: AcctType;
  /** Section heading on the reports. */
  group: string;
  /** A deduction from its section (accumulated depreciation, owner drawings): shown negative. */
  contra?: boolean;
  sort: number;
  /** Cannot be used on a manual journal: these come from real bank data, bookings, payments or credit, and a typed-in entry would break the tie between the books and those records. */
  derivedOnly?: boolean;
  /** Switched off in the chart of accounts: still on reports for the dates it has data, tagged, but not offered for new entries. */
  inactive?: boolean;
}

const A = (code: string, name: string, group: string, sort: number, extra: Partial<AcctInfo> = {}): AcctInfo => ({ code, name, type: 'asset', group, sort, ...extra });
const L = (code: string, name: string, group: string, sort: number, extra: Partial<AcctInfo> = {}): AcctInfo => ({ code, name, type: 'liability', group, sort, ...extra });

export const SYSTEM_ACCOUNTS: AcctInfo[] = [
  A('cash_bookings', 'Cash collected at the ground, not yet banked', 'Current assets', 20),
  A('gateway_clearing', 'Online and UPI payments not yet in the bank', 'Current assets', 30),
  A('receivables', 'Booking balances owed by customers', 'Current assets', 40),
  A('prepaid', 'Prepaid expenses', 'Current assets', 50),
  A('deposits', 'Security deposits paid', 'Current assets', 60),
  A('transfers_in_transit', 'Transfers between accounts in transit', 'Current assets', 70),
  A('suspense', 'Bank transactions not yet categorised', 'Needs attention', 80, { derivedOnly: true }),
  A('ignored', 'Bank transactions marked as not business', 'Needs attention', 90, { derivedOnly: true }),
  A('fixed_assets', 'Equipment and fixed assets (cost)', 'Fixed assets', 10),
  A('accumulated_depreciation', 'Less: accumulated depreciation', 'Fixed assets', 20, { contra: true }),

  L('customer_advances', 'Customer advances for sessions not yet played', 'Current liabilities', 10, { derivedOnly: true }),
  L('customer_credits', 'Account credit owed to customers', 'Current liabilities', 20, { derivedOnly: true }),
  L('security_deposits_held', 'Security deposits held for customers (refundable)', 'Current liabilities', 15, { derivedOnly: true }),
  L('tournament_deposits_held', 'Tournament hosting deposits held for customers (refundable)', 'Current liabilities', 16, { derivedOnly: true }),
  L('refunds_payable', 'Refunds owed to customers', 'Current liabilities', 30),
  L('gst_payable', 'GST payable', 'Current liabilities', 40),
  L('payables', 'Bills and expenses owed', 'Current liabilities', 50),
  L('loans', 'Loans', 'Loans', 10),

  { code: 'opening_equity', name: 'Opening balances', type: 'equity', group: 'Owner equity', sort: 10 },
  { code: 'capital', name: 'Owner capital', type: 'equity', group: 'Owner equity', sort: 20 },
  { code: 'drawings', name: 'Less: owner drawings', type: 'equity', group: 'Owner equity', sort: 30, contra: true },

  { code: 'booking_income', name: 'Booking income (sessions played)', type: 'income', group: 'Bookings', sort: 10, derivedOnly: true },
  { code: 'forfeited_income', name: 'Advances kept: no-shows, late cancellations, expired credit', type: 'income', group: 'Bookings', sort: 20, derivedOnly: true },
  { code: 'deposit_deductions', name: 'Security deposit kept for damage or extras', type: 'income', group: 'Bookings', sort: 30, derivedOnly: true },
  { code: 'tournament_deposits_kept', name: 'Tournament hosting deposits kept (matches not played at the ground)', type: 'income', group: 'Bookings', sort: 35, derivedOnly: true },
  { code: 'exp:goodwill', name: 'Goodwill credits given', type: 'expense', group: 'Other', sort: 80, derivedOnly: true },
  { code: 'exp:depreciation', name: 'Depreciation', type: 'expense', group: 'Other', sort: 85 },
];

const SYSTEM = new Map(SYSTEM_ACCOUNTS.map((a) => [a.code, a]));

interface CatRow { code: string; name: string; kind: string; group_name: string; sort: number; active: number }

/** Every account an owner's books can contain: the fixed ones, one per category, and one per bank/cash account. */
export function directory(ownerId: string): Map<string, AcctInfo> {
  const out = new Map(SYSTEM);
  const cats = many<CatRow>(`SELECT c.code, COALESCE(p.name, c.name) name, c.kind, c.group_name, c.sort, COALESCE(p.active, 1) active
    FROM acct_categories c LEFT JOIN acct_category_prefs p ON p.category_id = c.id AND p.owner_id = ? WHERE (c.owner_id IS NULL OR c.owner_id = ?) AND c.deleted_at IS NULL`, ownerId, ownerId);
  for (const c of cats) {
    const name = c.active ? c.name : c.name + INACTIVE_TAG, inactive = !c.active;
    if (c.kind === 'income') out.set(`inc:${c.code}`, { code: `inc:${c.code}`, name, type: 'income', group: c.group_name, sort: c.sort, inactive });
    else if (c.kind === 'expense') out.set(`exp:${c.code}`, { code: `exp:${c.code}`, name, type: 'expense', group: c.group_name, sort: c.sort, inactive });
  }
  const accts = many<{ id: string; kind: string; name: string; active: number; holds: string }>('SELECT id, kind, name, active, holds FROM acct_accounts WHERE owner_id = ? AND deleted_at IS NULL', ownerId);
  accts.forEach((a, i) => out.set(`bank:${a.id}`, { code: `bank:${a.id}`, name: a.active ? a.name : a.name + INACTIVE_TAG, type: a.holds === 'bank' ? 'asset' : 'liability', group: a.holds === 'card' ? 'Credit cards' : a.holds === 'loan' ? 'Loans' : 'Cash and bank', sort: i, derivedOnly: true, inactive: !a.active }));
  return out;
}

export const isBankCode = (code: string): boolean => code.startsWith('bank:');

/** Accounts that can appear on a manual journal entry. */
export function journalAccounts(ownerId: string): AcctInfo[] {
  return [...directory(ownerId).values()].filter((a) => !a.derivedOnly && !a.inactive).sort((a, b) => a.type.localeCompare(b.type) || a.sort - b.sort || a.name.localeCompare(b.name));
}
