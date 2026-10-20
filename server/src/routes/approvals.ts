import { Router, ok } from '../http.ts';
import type { Ctx } from '../http.ts';
import { U, ownerOrFail } from './helpers.ts';
import { forbidden } from '../errors.ts';
import { hasPermission } from '../auth.ts';
import { tx } from '../db.ts';
import { audit } from '../audit.ts';
import { assertPending, builderData, listOpen, needNote, optNote, requestOr404, requestOut, resetFlow, saveFlow, sendBack, signStep } from '../approvals.ts';
import { approveBill, rejectBill } from '../accounting/bills.ts';
import { finaliseApproved } from '../accounting/payroll.ts';

const A = { auth: ['owner', 'staff', 'super_admin'] as ('owner' | 'staff' | 'super_admin')[] };
const P = '/api/accounting/approvals';

// The approval rules builder (owner only) and the chains waiting on the Approvals board (anyone who looks after an area).
export function approvalsRoutes(r: Router): void {
  const boss = (c: Ctx) => {
    const u = U(c);
    if (u.role !== 'owner' && u.role !== 'super_admin') throw forbidden('Only the owner can change the approval rules');
    return { owner: ownerOrFail(c, 'set approval rules'), actor: { id: u.id, role: u.role } };
  };
  const team = (c: Ctx) => {
    const u = U(c);
    if (!hasPermission(u, 'manage_accounting') && !hasPermission(u, 'view_reports')) throw forbidden('This needs the "manage_accounting" permission');
    return { owner: ownerOrFail(c, 'see approvals'), actor: { id: u.id, role: u.role }, user: u };
  };

  r.get(`${P}/flows`, (c) => { const b = boss(c); return ok(builderData(b.owner)); }, A);
  r.put(`${P}/flows/:kind`, (c) => { const b = boss(c); return ok(saveFlow(b.owner, b.actor, c.params.kind!, c.json())); }, A);
  r.post(`${P}/flows/:kind/reset`, (c) => { const b = boss(c); return ok(resetFlow(b.owner, b.actor, c.params.kind!)); }, A);

  r.get(`${P}/requests`, (c) => { const t = team(c); return ok({ items: listOpen(t.owner, t.user) }); }, A);
  r.post(`${P}/requests/:id/approve`, (c) => {
    const t = team(c);
    const req = requestOr404(t.owner, c.params.id!); assertPending(req);
    const note = optNote(c.json());
    if (req.kind === 'bill') approveBill(t.owner, t.actor, req.entity_id, { note: note ?? undefined });
    else tx(() => {
      const s = signStep(req, t.actor, note);
      if (s.done) {
        audit(t.actor, 'payroll.approve', 'payroll_runs', req.entity_id, { month: req.entity_id, step: s.index + 1, label: s.step.label, ...(note ? { note } : {}) }, t.owner);
        finaliseApproved(t.owner, t.actor, req.entity_id, req.amount_paise);
      }
    });
    return ok(requestOut(requestOr404(t.owner, req.id), t.user));
  }, A);
  r.post(`${P}/requests/:id/send-back`, (c) => {
    const t = team(c);
    const req = requestOr404(t.owner, c.params.id!); assertPending(req);
    const note = needNote(c.json());
    if (req.kind === 'bill') rejectBill(t.owner, t.actor, req.entity_id, { reason: note });
    else tx(() => { if (sendBack(req, t.actor, note).toStart) audit(t.actor, 'payroll.sendback', 'payroll_runs', req.entity_id, { month: req.entity_id, reason: note }, t.owner); });
    return ok(requestOut(requestOr404(t.owner, req.id), t.user));
  }, A);
}
