import type { DatabaseSync } from 'node:sqlite';
import { registerSchema } from './db.ts';

// Records that must never be edited or removed once written: the audit log, the payment history, the customer-credit ledger,
// the webhook receipts and the financial-event journal. The database refuses an UPDATE or DELETE on them (a trigger), so a bug, a
// script or a hand-typed SQL line cannot rewrite history. A mistake is put right with a new, reversing record, never by changing the old one.

export const APPEND_ONLY_TABLES = ['audit_log', 'payment_events', 'credit_ledger', 'webhook_events'] as const;

const trig = (t: string, op: 'UPDATE' | 'DELETE') =>
  `CREATE TRIGGER trg_ao_${t}_${op.toLowerCase()} BEFORE ${op} ON ${t} BEGIN SELECT RAISE(ABORT, '${t} is append-only: ${op.toLowerCase()} refused'); END;`;

registerSchema('append-only-1', APPEND_ONLY_TABLES.flatMap((t) => [trig(t, 'UPDATE'), trig(t, 'DELETE')]).join('\n'));

/** Test and restore tooling only: wipes the append-only tables by dropping their guards first and putting them back after. Never called by the server. */
export function withAppendOnlyLifted<T>(d: DatabaseSync, fn: () => T): T {
  const guards = d.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_ao_%'").all() as { name: string; sql: string }[];
  for (const g of guards) d.exec(`DROP TRIGGER ${g.name}`);
  try { return fn(); } finally { for (const g of guards) d.exec(g.sql); }
}
