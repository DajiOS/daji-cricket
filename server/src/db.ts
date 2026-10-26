import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// One column per line, plain types — scripts/export-postgres.ts reads this text to generate Postgres migrations.
export const SCHEMA_CORE = `
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('customer','owner','staff','super_admin')),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  password_hash TEXT,
  owner_id TEXT REFERENCES users(id),
  permissions TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  consent_email INTEGER NOT NULL DEFAULT 0,
  consent_sms INTEGER NOT NULL DEFAULT 0,
  consent_whatsapp INTEGER NOT NULL DEFAULT 0,
  consent_updated_at INTEGER,
  business_name TEXT,
  upi_id TEXT,
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX uq_users_email ON users(lower(email)) WHERE email IS NOT NULL;
CREATE INDEX ix_users_phone ON users(phone);
CREATE INDEX ix_users_owner ON users(owner_id);

CREATE TABLE grounds (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  city TEXT NOT NULL,
  area TEXT,
  address TEXT,
  lat REAL,
  lng REAL,
  description TEXT,
  facilities TEXT NOT NULL DEFAULT '[]',
  images TEXT NOT NULL DEFAULT '[]',
  surface TEXT,
  open_time TEXT NOT NULL DEFAULT '06:00',
  close_time TEXT NOT NULL DEFAULT '22:00',
  slot_minutes INTEGER NOT NULL DEFAULT 60,
  price_paise INTEGER NOT NULL,
  weekend_price_paise INTEGER,
  evening_surcharge_paise INTEGER NOT NULL DEFAULT 0,
  evening_from TEXT NOT NULL DEFAULT '18:00',
  max_slots INTEGER NOT NULL DEFAULT 6,
  min_notice_minutes INTEGER NOT NULL DEFAULT 0,
  advance_mode TEXT CHECK (advance_mode IN ('fixed','percent')),
  advance_value INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX ix_grounds_owner ON grounds(owner_id);

CREATE TABLE bookings (
  id TEXT PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  ground_id TEXT NOT NULL REFERENCES grounds(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  customer_id TEXT NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL,
  slot_count INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('held','confirmed','cancelled','expired','no_show','completed')),
  source TEXT NOT NULL CHECK (source IN ('online','walk_in','enquiry')),
  total_paise INTEGER NOT NULL,
  advance_paise INTEGER NOT NULL,
  paid_paise INTEGER NOT NULL DEFAULT 0,
  pay_method TEXT CHECK (pay_method IN ('razorpay','upi')),
  hold_expires_at INTEGER,
  hold_extensions INTEGER NOT NULL DEFAULT 0,
  needs_review INTEGER NOT NULL DEFAULT 0,
  confirmed_at INTEGER,
  cancelled_at INTEGER,
  cancel_kind TEXT CHECK (cancel_kind IN ('free','credit','none')),
  cancel_reason TEXT,
  cancelled_by TEXT,
  refund_paise INTEGER NOT NULL DEFAULT 0,
  credit_paise INTEGER NOT NULL DEFAULT 0,
  players INTEGER,
  notes TEXT,
  enquiry_id TEXT,
  created_by TEXT,
  reminded_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX ix_bookings_customer ON bookings(customer_id, start_at);
CREATE INDEX ix_bookings_owner ON bookings(owner_id, start_at);
CREATE INDEX ix_bookings_status ON bookings(status, hold_expires_at);
CREATE INDEX ix_bookings_ground ON bookings(ground_id, start_at);

CREATE TABLE booking_slots (
  ground_id TEXT NOT NULL REFERENCES grounds(id),
  slot_start INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'booking' CHECK (kind IN ('booking','block')),
  booking_id TEXT REFERENCES bookings(id),
  note TEXT,
  PRIMARY KEY (ground_id, slot_start)
);
CREATE INDEX ix_booking_slots_booking ON booking_slots(booking_id);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  customer_id TEXT NOT NULL REFERENCES users(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  method TEXT NOT NULL CHECK (method IN ('razorpay','upi','cash','card','bank_transfer','credit')),
  status TEXT NOT NULL CHECK (status IN ('created','pending','submitted','captured','failed','rejected','refunded','partially_refunded')),
  purpose TEXT NOT NULL CHECK (purpose IN ('advance','balance','full')),
  amount_paise INTEGER NOT NULL,
  refunded_paise INTEGER NOT NULL DEFAULT 0,
  reference TEXT,
  rp_order_id TEXT,
  rp_payment_id TEXT,
  proof_note TEXT,
  submitted_at INTEGER,
  verified_by TEXT,
  verified_at INTEGER,
  reject_reason TEXT,
  late INTEGER NOT NULL DEFAULT 0,
  recorded_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX ix_payments_booking ON payments(booking_id);
CREATE INDEX ix_payments_owner ON payments(owner_id, created_at);
CREATE UNIQUE INDEX uq_payments_rp_payment ON payments(rp_payment_id) WHERE rp_payment_id IS NOT NULL;
CREATE UNIQUE INDEX uq_payments_rp_order ON payments(rp_order_id) WHERE rp_order_id IS NOT NULL;
CREATE UNIQUE INDEX uq_payments_upi_ref ON payments(owner_id, reference) WHERE method = 'upi' AND reference IS NOT NULL AND status NOT IN ('rejected','failed');

CREATE TABLE payment_events (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(id),
  at INTEGER NOT NULL,
  actor_id TEXT,
  event TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX ix_payment_events_payment ON payment_events(payment_id);

CREATE TABLE refunds (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(id),
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  amount_paise INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','processing','done','failed')),
  mode TEXT NOT NULL CHECK (mode IN ('gateway','manual')),
  reference TEXT,
  rp_refund_id TEXT,
  reason TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  completed_by TEXT
);
CREATE INDEX ix_refunds_status ON refunds(status);
CREATE UNIQUE INDEX uq_refunds_rp ON refunds(rp_refund_id) WHERE rp_refund_id IS NOT NULL;

CREATE TABLE webhook_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  outcome TEXT
);

CREATE TABLE credit_lots (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES users(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  amount_paise INTEGER NOT NULL,
  remaining_paise INTEGER NOT NULL,
  source TEXT NOT NULL,
  booking_id TEXT REFERENCES bookings(id),
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  expired_at INTEGER,
  note TEXT,
  created_by TEXT
);
CREATE INDEX ix_credit_lots_customer ON credit_lots(customer_id, owner_id, expires_at);

CREATE TABLE credit_ledger (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES users(id),
  owner_id TEXT NOT NULL REFERENCES users(id),
  lot_id TEXT REFERENCES credit_lots(id),
  kind TEXT NOT NULL CHECK (kind IN ('issued','redeemed','adjusted','expired','restored')),
  amount_paise INTEGER NOT NULL,
  balance_after_paise INTEGER NOT NULL,
  booking_id TEXT REFERENCES bookings(id),
  note TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT
);
CREATE INDEX ix_credit_ledger_customer ON credit_ledger(customer_id, created_at);

CREATE TABLE enquiries (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  ground_id TEXT REFERENCES grounds(id),
  customer_id TEXT REFERENCES users(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  preferred_date TEXT,
  players INTEGER,
  message TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('new','follow_up','quoted','converted','closed')),
  closed_reason TEXT,
  booking_id TEXT REFERENCES bookings(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX ix_enquiries_owner ON enquiries(owner_id, status);

CREATE TABLE enquiry_notes (
  id TEXT PRIMARY KEY,
  enquiry_id TEXT NOT NULL REFERENCES enquiries(id),
  kind TEXT NOT NULL CHECK (kind IN ('note','contact','status')),
  body TEXT NOT NULL,
  author_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE quotations (
  id TEXT PRIMARY KEY,
  enquiry_id TEXT NOT NULL REFERENCES enquiries(id),
  amount_paise INTEGER NOT NULL,
  valid_until INTEGER,
  details TEXT,
  status TEXT NOT NULL CHECK (status IN ('sent','accepted','declined','expired')),
  created_by TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  channel TEXT NOT NULL CHECK (channel IN ('email','sms','whatsapp','push')),
  category TEXT NOT NULL CHECK (category IN ('transactional','marketing')),
  template TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','sent','skipped','failed')),
  skip_reason TEXT,
  booking_id TEXT,
  created_at INTEGER NOT NULL,
  sent_at INTEGER
);
CREATE INDEX ix_notifications_user ON notifications(user_id, created_at);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor_id TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  owner_id TEXT,
  detail TEXT
);
CREATE INDEX ix_audit_entity ON audit_log(entity, entity_id);
CREATE INDEX ix_audit_owner ON audit_log(owner_id, at);
`;

interface SchemaModule { id: string; sql: string }
const schemaModules: SchemaModule[] = [];
/**
 * Feature modules (accounting, ...) register their tables here under a stable id, at import time.
 * openDb() applies each module once: on a fresh database together with the core, and on an existing one
 * the first time the module is seen. Applied ids are kept in schema_migrations.
 */
export function registerSchema(id: string, sql: string): void {
  const have = schemaModules.find((m) => m.id === id);
  if (have) { if (have.sql !== sql) throw new Error(`schema module ${id} registered twice with different SQL`); return; }
  schemaModules.push({ id, sql });
}
export function fullSchema(): string {
  return [SCHEMA_CORE, ...schemaModules.map((m) => m.sql)].join('\n');
}
export function registeredSchemaIds(): string[] {
  return schemaModules.map((m) => m.id);
}
export const schemaChecksum = (sql: string): string => createHash('sha256').update(sql).digest('hex');
/** Every module's id and checksum, plus the core's under "core". server/schema.lock.json holds the released ones (test/schema-lock.test.ts). */
export function schemaChecksums(): Record<string, string> {
  return Object.fromEntries([['core', schemaChecksum(SCHEMA_CORE)], ...schemaModules.map((m) => [m.id, schemaChecksum(m.sql)])]);
}

/** Test hook for the migration rehearsal: called inside a module's transaction just before it commits, so a rehearsal can kill the process at the worst moment. Unset in normal running. */
export const migrationFault: { beforeCommit?: (moduleId: string) => void } = {};

let drift: string[] = [];
/** Modules whose SQL changed after this database applied them: the change never reached this database. */
export function schemaDrift(): string[] {
  return [...drift];
}

let current: DatabaseSync | null = null;
const stmtCache = new WeakMap<DatabaseSync, Map<string, ReturnType<DatabaseSync['prepare']>>>();

export function openDb(path: string): DatabaseSync {
  if (current) throw new Error('database already open');
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const d = new DatabaseSync(path);
  d.exec('PRAGMA foreign_keys = ON');
  d.exec('PRAGMA busy_timeout = 5000');
  if (path !== ':memory:') d.exec('PRAGMA journal_mode = WAL');
  const has = d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
  if (!has) d.exec(SCHEMA_CORE);
  d.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  // Databases from before checksums were kept get the column; their modules are trusted as they are now.
  const cols = (d.prepare("SELECT name FROM pragma_table_info('schema_migrations')").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes('checksum')) d.exec('ALTER TABLE schema_migrations ADD COLUMN checksum TEXT');
  const applied = new Map((d.prepare('SELECT id, checksum FROM schema_migrations').all() as { id: string; checksum: string | null }[]).map((r) => [r.id, r.checksum]));
  drift = [];
  for (const m of schemaModules) {
    const sum = schemaChecksum(m.sql);
    if (applied.has(m.id)) {
      const had = applied.get(m.id);
      if (had == null) d.prepare('UPDATE schema_migrations SET checksum = ? WHERE id = ?').run(sum, m.id);
      else if (had !== sum) drift.push(m.id);
      continue;
    }
    d.exec('BEGIN IMMEDIATE');
    try {
      d.exec(m.sql);
      d.prepare('INSERT INTO schema_migrations(id, applied_at, checksum) VALUES(?, ?, ?)').run(m.id, Date.now(), sum);
      migrationFault.beforeCommit?.(m.id);
      d.exec('COMMIT');
    } catch (e) {
      try { d.exec('ROLLBACK'); } catch { /* ignore */ }
      d.close();
      throw new Error(`could not apply schema module ${m.id}: ${(e as Error).message}`);
    }
  }
  // An applied module is never run again, so an edit to it only reaches new databases. Say so loudly instead of
  // silently running two different schemas; the fix is a new module (CI catches this first: test/schema-lock.test.ts).
  if (drift.length) console.warn(`WARNING: schema module(s) changed after this database applied them, so the change was not applied here: ${drift.join(', ')}. Add a new schema module instead of editing a released one.`);
  current = d;
  return d;
}

export function db(): DatabaseSync {
  if (!current) throw new Error('database not open');
  return current;
}
export function dbIsOpen(): boolean {
  return current !== null;
}
export function closeDb(): void {
  if (current) {
    try { current.close(); } catch { /* already closed */ }
    current = null;
  }
}

function stmt(sql: string) {
  const d = db();
  let m = stmtCache.get(d);
  if (!m) stmtCache.set(d, (m = new Map()));
  let s = m.get(sql);
  if (!s) m.set(sql, (s = d.prepare(sql)));
  return s;
}

export type Params = SQLInputValue[];

export function one<T = Record<string, any>>(sql: string, ...p: Params): T | undefined {
  return stmt(sql).get(...p) as T | undefined;
}
export function many<T = Record<string, any>>(sql: string, ...p: Params): T[] {
  return stmt(sql).all(...p) as T[];
}
export function run(sql: string, ...p: Params): { changes: number } {
  const r = stmt(sql).run(...p);
  return { changes: Number(r.changes) };
}

let depth = 0;
/** Synchronous transaction; nested calls become savepoints. Never await inside. */
export function tx<T>(fn: () => T): T {
  const d = db();
  if (depth === 0) {
    d.exec('BEGIN IMMEDIATE');
    depth = 1;
    try {
      const r = fn();
      d.exec('COMMIT');
      return r;
    } catch (e) {
      try { d.exec('ROLLBACK'); } catch { /* connection gone */ }
      throw e;
    } finally {
      depth = 0;
    }
  }
  const name = `sp${depth}`;
  d.exec(`SAVEPOINT ${name}`);
  depth++;
  try {
    const r = fn();
    d.exec(`RELEASE ${name}`);
    return r;
  } catch (e) {
    d.exec(`ROLLBACK TO ${name}`);
    d.exec(`RELEASE ${name}`);
    throw e;
  } finally {
    depth--;
  }
}
