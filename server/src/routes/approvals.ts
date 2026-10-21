import { Router, ok } from '../http.ts';
import type { Ctx } from '../http.ts';
import { U, ownerOrFail } from './helpers.ts';
import { forbidden } from '../errors.ts';
import { hasPermission, requirePermission } from '../auth.ts';
import { tx } from '../db.ts';
import { audit } from '../audit.ts';
import { assertPending, builderData, listOpen, looksAfterAny, needNote, optNote, requestOr404, requestOut, resetFlow, saveFlow, sendBack, signStep } from '../approvals.ts';
import { approveBill, rejectBill } from '../accounting/bills.ts';
import { finaliseApproved } from '../accounting/payroll.ts';
import { signRefund, sendBackRefund } from '../payments.ts';
import { askDiscount, askWaiver, listAsks, sendBackAsk, signAsk, withdrawAsk } from '../money-asks.ts';

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
    if (!looksAfterAny(u) && !hasPermission(u, 'view_reports')) throw forbidden('This needs the "manage_accounting" permission');
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
    else if (req.kind === 'refund') signRefund(t.owner, t.actor, req, note);
    else if (req.kind !== 'payroll') signAsk(t.owner, t.actor, req, note);
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
    else if (req.kind === 'refund') sendBackRefund(t.owner, t.actor, req, note);
    else if (req.kind !== 'payroll') sendBackAsk(t.owner, t.actor, req, note);
    else tx(() => { if (sendBack(req, t.actor, note).toStart) audit(t.actor, 'payroll.sendback', 'payroll_runs', req.entity_id, { month: req.entity_id, reason: note }, t.owner); });
    return ok(requestOut(requestOr404(t.owner, req.id), t.user));
  }, A);

  // Discounts, fee waivers and expenses are asked for here and decided on the board above (expenses come in through the
  // books' transaction form, see routes/accounting.ts).
  const staff = (c: Ctx, perm: Parameters<typeof requirePermission>[1], what: string) => {
    const u = U(c); requirePermission(u, perm);
    return { owner: ownerOrFail(c, what), actor: { id: u.id, role: u.role }, user: u };
  };
  r.post('/api/staff/bookings/:id/discount', (c) => { const s = staff(c, 'manage_bookings', 'give a discount'); return ok(askDiscount(s.owner, s.actor, c.params.id!, c.json())); }, A);
  r.post('/api/staff/academy/fees/:id/waive', (c) => { const s = staff(c, 'manage_academy', 'waive a fee'); return ok(askWaiver(s.owner, s.actor, c.params.id!, c.json())); }, A);
  r.get(`${P}/asks`, (c) => { const u = U(c); const owner = ownerOrFail(c, 'see approvals'); return ok({ items: listAsks(owner, u, { status: c.query.get('status'), targetId: c.query.get('targetId') }) }); }, A);
  r.post(`${P}/asks/:id/withdraw`, (c) => { const u = U(c); return ok(withdrawAsk(ownerOrFail(c, 'take this back'), { id: u.id, role: u.role }, c.params.id!)); }, A);
}
