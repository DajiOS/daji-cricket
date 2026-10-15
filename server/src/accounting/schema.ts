import { db, registerSchema } from '../db.ts';

// Accounting tables. One column per line, plain types: the Postgres exporter reads this text.
// Money is integer paise, signed from the account's point of view (+ money in, - money out).
// Every mutable table carries who/when for create, update and (soft) delete.
export const ACCOUNTING_SCHEMA = `
CREATE TABLE acct_settings (
  owner_id TEXT PRIMARY KEY REFERENCES users(id),
  gst_percent INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);

CREATE TABLE acct_accounts (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('bank','cash')),
  name TEXT NOT NULL,
  bank_name TEXT,
  last4 TEXT,
  source TEXT NOT NULL CHECK (source IN ('upload','yodlee','demo','manual')),
  provider_ref TEXT,
  opening_paise INTEGER NOT NULL DEFAULT 0,
  opening_date TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  deleted_at INTEGER,
  deleted_by TEXT
);
CREATE INDEX ix_acct_accounts_owner ON acct_accounts(owner_id);
CREATE UNIQUE INDEX uq_acct_accounts_provider ON acct_accounts(owner_id, source, provider_ref) WHERE provider_ref IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE acct_imports (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  account_id TEXT NOT NULL REFERENCES acct_accounts(id),
  kind TEXT NOT NULL CHECK (kind IN ('csv','xlsx','pdf','yodlee','demo')),
  filename TEXT,
  sha256 TEXT,
  rows_total INTEGER NOT NULL DEFAULT 0,
  rows_new INTEGER NOT NULL DEFAULT 0,
  rows_duplicate INTEGER NOT NULL DEFAULT 0,
  rows_skipped INTEGER NOT NULL DEFAULT 0,
  period_from TEXT,
  period_to TEXT,
  warnings TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  undone_at INTEGER,
  undone_by TEXT
);
CREATE INDEX ix_acct_imports_owner ON acct_imports(owner_id, created_at);

CREATE TABLE acct_categories (
  id TEXT PRIMARY KEY,
  owner_id TEXT REFERENCES users(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('income','expense','transfer','booking_receipt','ignore')),
  group_name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 100,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  deleted_at INTEGER,
  deleted_by TEXT
);
CREATE UNIQUE INDEX uq_acct_categories_code ON acct_categories(COALESCE(owner_id, ''), lower(code));

CREATE TABLE acct_rules (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  name TEXT,
  priority INTEGER NOT NULL DEFAULT 100,
  field TEXT NOT NULL CHECK (field IN ('description','counterparty','reference','any')),
  match_type TEXT NOT NULL CHECK (match_type IN ('contains','starts_with','equals','regex')),
  pattern TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'any' CHECK (direction IN ('any','in','out')),
  min_paise INTEGER,
  max_paise INTEGER,
  category_id TEXT NOT NULL REFERENCES acct_categories(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  deleted_at INTEGER,
  deleted_by TEXT
);
CREATE INDEX ix_acct_rules_owner ON acct_rules(owner_id, priority);

CREATE TABLE acct_transactions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  account_id TEXT NOT NULL REFERENCES acct_accounts(id),
  import_id TEXT REFERENCES acct_imports(id),
  source TEXT NOT NULL CHECK (source IN ('upload','yodlee','demo','manual')),
  txn_date TEXT NOT NULL,
  amount_paise INTEGER NOT NULL,
  balance_paise INTEGER,
  description TEXT NOT NULL,
  counterparty TEXT,
  reference TEXT,
  provider_txn_id TEXT,
  fingerprint TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  category_id TEXT REFERENCES acct_categories(id),
  category_by TEXT CHECK (category_by IN ('rule','manual','match')),
  rule_id TEXT,
  payment_id TEXT REFERENCES payments(id),
  booking_id TEXT REFERENCES bookings(id),
  match_kind TEXT CHECK (match_kind IN ('utr','manual')),
  match_locked INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  deleted_at INTEGER,
  deleted_by TEXT
);
CREATE UNIQUE INDEX uq_acct_txn_fingerprint ON acct_transactions(owner_id, account_id, fingerprint, seq);
CREATE UNIQUE INDEX uq_acct_txn_provider ON acct_transactions(owner_id, account_id, provider_txn_id) WHERE provider_txn_id IS NOT NULL;
CREATE UNIQUE INDEX uq_acct_txn_payment ON acct_transactions(payment_id) WHERE payment_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX ix_acct_txn_owner_date ON acct_transactions(owner_id, txn_date);
CREATE INDEX ix_acct_txn_account ON acct_transactions(account_id, txn_date);
CREATE INDEX ix_acct_txn_import ON acct_transactions(import_id);

CREATE TABLE acct_journals (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  entry_date TEXT NOT NULL,
  memo TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  deleted_at INTEGER,
  deleted_by TEXT,
  delete_reason TEXT
);
CREATE INDEX ix_acct_journals_owner_date ON acct_journals(owner_id, entry_date);

CREATE TABLE acct_journal_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  journal_id TEXT NOT NULL REFERENCES acct_journals(id),
  account_code TEXT NOT NULL,
  debit_paise INTEGER NOT NULL DEFAULT 0,
  credit_paise INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  CHECK (debit_paise >= 0 AND credit_paise >= 0 AND (debit_paise = 0 OR credit_paise = 0))
);
CREATE INDEX ix_acct_journal_lines_journal ON acct_journal_lines(journal_id);

CREATE TABLE acct_signoffs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  month TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  signed_at INTEGER NOT NULL,
  signed_by TEXT,
  reopened_at INTEGER,
  reopened_by TEXT,
  reopen_reason TEXT
);
CREATE UNIQUE INDEX uq_acct_signoffs_open ON acct_signoffs(owner_id, month) WHERE reopened_at IS NULL;

CREATE TABLE acct_memos (
  owner_id TEXT NOT NULL REFERENCES users(id),
  month TEXT NOT NULL,
  body TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (owner_id, month)
);
`;

/** Built-in categories (owner_id NULL: shared by every owner). id = 'cat_' + code. */
export interface BuiltinCategory { code: string; name: string; kind: 'income' | 'expense' | 'transfer' | 'booking_receipt' | 'ignore'; group: string; sort: number }
export const BUILTIN_CATEGORIES: BuiltinCategory[] = [
  { code: 'canteen', name: 'Canteen & snacks', kind: 'income', group: 'Other income', sort: 10 },
  { code: 'coaching', name: 'Coaching & academy fees', kind: 'income', group: 'Other income', sort: 20 },
  { code: 'tournament_fees', name: 'Tournament entry fees', kind: 'income', group: 'Other income', sort: 30 },
  { code: 'equipment_rental', name: 'Equipment rental', kind: 'income', group: 'Other income', sort: 40 },
  { code: 'sponsorship', name: 'Sponsorship & advertising', kind: 'income', group: 'Other income', sort: 50 },
  { code: 'interest', name: 'Interest received', kind: 'income', group: 'Other income', sort: 60 },
  { code: 'memberships', name: 'Club memberships', kind: 'income', group: 'Other income', sort: 35 },
  { code: 'other_income', name: 'Other income', kind: 'income', group: 'Other income', sort: 90 },

  { code: 'salaries', name: 'Salaries & wages', kind: 'expense', group: 'Staff', sort: 10 },
  { code: 'groundsman', name: 'Groundsman & pitch care', kind: 'expense', group: 'Ground upkeep', sort: 10 },
  { code: 'repairs', name: 'Repairs & maintenance', kind: 'expense', group: 'Ground upkeep', sort: 20 },
  { code: 'equipment', name: 'Equipment & consumables', kind: 'expense', group: 'Ground upkeep', sort: 30 },
  { code: 'electricity', name: 'Electricity & floodlights', kind: 'expense', group: 'Utilities', sort: 10 },
  { code: 'water', name: 'Water', kind: 'expense', group: 'Utilities', sort: 20 },
  { code: 'internet_phone', name: 'Internet & phone', kind: 'expense', group: 'Utilities', sort: 30 },
  { code: 'rent', name: 'Rent & lease', kind: 'expense', group: 'Premises', sort: 10 },
  { code: 'property_tax', name: 'Property tax & licences', kind: 'expense', group: 'Premises', sort: 20 },
  { code: 'insurance', name: 'Insurance', kind: 'expense', group: 'Premises', sort: 30 },
  { code: 'marketing', name: 'Marketing & advertising', kind: 'expense', group: 'Admin & finance', sort: 10 },
  { code: 'gateway_fees', name: 'Payment gateway fees', kind: 'expense', group: 'Admin & finance', sort: 20 },
  { code: 'bank_charges', name: 'Bank charges', kind: 'expense', group: 'Admin & finance', sort: 30 },
  { code: 'professional', name: 'Professional fees', kind: 'expense', group: 'Admin & finance', sort: 40 },
  { code: 'software', name: 'Software & subscriptions', kind: 'expense', group: 'Admin & finance', sort: 50 },
  { code: 'travel', name: 'Travel & fuel', kind: 'expense', group: 'Admin & finance', sort: 60 },
  { code: 'misc_expense', name: 'Other expenses', kind: 'expense', group: 'Other', sort: 90 },

  { code: 'owner_capital', name: 'Owner capital introduced', kind: 'transfer', group: 'Not in profit & loss', sort: 10 },
  { code: 'owner_drawings', name: 'Owner drawings', kind: 'transfer', group: 'Not in profit & loss', sort: 20 },
  { code: 'internal_transfer', name: 'Transfer between own accounts', kind: 'transfer', group: 'Not in profit & loss', sort: 30 },
  { code: 'cash_deposit', name: 'Cash deposited to bank', kind: 'transfer', group: 'Not in profit & loss', sort: 40 },
  { code: 'loan', name: 'Loan received or repaid (principal)', kind: 'transfer', group: 'Not in profit & loss', sort: 50 },
  { code: 'gst_remitted', name: 'GST paid to government', kind: 'transfer', group: 'Not in profit & loss', sort: 60 },
  { code: 'customer_refund', name: 'Refund paid to a customer', kind: 'transfer', group: 'Not in profit & loss', sort: 70 },
  { code: 'asset_purchase', name: 'Equipment or asset bought (capital)', kind: 'transfer', group: 'Not in profit & loss', sort: 80 },

  { code: 'razorpay_settlement', name: 'Razorpay settlement', kind: 'booking_receipt', group: 'Booking receipts', sort: 10 },
  { code: 'upi_booking', name: 'UPI booking payment', kind: 'booking_receipt', group: 'Booking receipts', sort: 20 },
  { code: 'bank_booking', name: 'Bank-transfer booking payment', kind: 'booking_receipt', group: 'Booking receipts', sort: 30 },

  { code: 'ignored', name: 'Ignore (not a business transaction)', kind: 'ignore', group: 'Ignored', sort: 10 },
];

export const categoryId = (code: string): string => `cat_${code}`;

function seedSql(verb = 'INSERT'): string {
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const rows = BUILTIN_CATEGORIES.map((c) => `(${q(categoryId(c.code))}, NULL, ${q(c.code)}, ${q(c.name)}, ${q(c.kind)}, ${q(c.group)}, ${c.sort}, 0, 0)`);
  return `${verb} INTO acct_categories(id, owner_id, code, name, kind, group_name, sort, created_at, updated_at) VALUES\n${rows.join(',\n')};`;
}

/** The built-in categories again, for a database whose tables were emptied (the test harness does this between tests). Rows that exist are left alone. */
export function ensureBuiltinCategories(): void {
  db().exec(seedSql('INSERT OR IGNORE'));
}

registerSchema('accounting-1', ACCOUNTING_SCHEMA + '\n' + seedSql());
