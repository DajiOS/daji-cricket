import type { AuditEntry } from '@daji/shared';
import { many, run } from './db.ts';
import { now } from './clock.ts';
import './appendOnly.ts'; // registers the append-only guards on the audit log, payment history, credit ledger and webhook receipts

export interface Actor {
  id: string | null;
  role: string | null;
}
export const SYSTEM: Actor = { id: null, role: 'system' };

export function audit(actor: Actor | null, action: string, entity: string, entityId: string | null, detail: unknown = null, ownerId: string | null = null): void {
  run(
    'INSERT INTO audit_log(at, actor_id, actor_role, action, entity, entity_id, owner_id, detail) VALUES(?,?,?,?,?,?,?,?)',
    now(), actor?.id ?? null, actor?.role ?? null, action, entity, entityId, ownerId, detail === null ? null : JSON.stringify(detail),
  );
}

export function listAudit(filter: { ownerId?: string | null; entity?: string; entityId?: string; action?: string; limit?: number; offset?: number }): { items: AuditEntry[]; total: number } {
  const where: string[] = [];
  const p: (string | number)[] = [];
  if (filter.ownerId) { where.push('owner_id = ?'); p.push(filter.ownerId); }
  if (filter.entity) { where.push('entity = ?'); p.push(filter.entity); }
  if (filter.entityId) { where.push('entity_id = ?'); p.push(filter.entityId); }
  if (filter.action) { where.push('action LIKE ?'); p.push(filter.action.replace(/[%_\\]/g, '\\$&') + '%'); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const offset = Math.max(filter.offset ?? 0, 0);
  const total = (many<{ n: number }>(`SELECT COUNT(*) n FROM audit_log ${w.replace('action LIKE ?', "action LIKE ? ESCAPE '\\'")}`, ...p)[0]?.n) ?? 0;
  const rows = many<any>(`SELECT * FROM audit_log ${w.replace('action LIKE ?', "action LIKE ? ESCAPE '\\'")} ORDER BY id DESC LIMIT ? OFFSET ?`, ...p, limit, offset);
  return {
    total,
    items: rows.map((r) => ({
      id: r.id, at: r.at, actorId: r.actor_id, actorRole: r.actor_role, action: r.action, entity: r.entity,
      entityId: r.entity_id, ownerId: r.owner_id, detail: r.detail ? JSON.parse(r.detail) : null,
    })),
  };
}
