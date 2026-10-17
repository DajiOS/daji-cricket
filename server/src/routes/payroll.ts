import { Router, ok, created } from '../http.ts';
import type { Ctx } from '../http.ts';
import { U, ownerOrFail } from './helpers.ts';
import { forbidden } from '../errors.ts';
import {
  addAdjustment, attendanceSheet, checkMonth, createStaff, finaliseRun, getRun, listAdjustments, listRuns, listStaff, markPaid, parseAttendance,
  payslip, removeAdjustment, statutoryDues, reopenRun, setAttendance, summary, unmarkPaid, updateStaff,
} from '../accounting/payroll.ts';
import { istDate } from '../time.ts';
import { now } from '../clock.ts';

const A = { auth: ['owner', 'super_admin'] as ('owner' | 'staff' | 'super_admin')[] };

// Staff pay is for the owner (or the software owner acting for one) only. Team members never see it.
export function payrollRoutes(r: Router): void {
  const guard = (c: Ctx): { owner: string; actor: { id: string; role: string } } => {
    const u = U(c);
    if (u.role !== 'owner' && u.role !== 'super_admin') throw forbidden('Payroll is for the owner only');
    return { owner: ownerOrFail(c, 'use payroll'), actor: { id: u.id, role: u.role } };
  };
  const month = (c: Ctx): string => checkMonth(c.query.get('month') ?? istDate(now()).slice(0, 7));
  const P = '/api/accounting/payroll';

  r.get(`${P}/staff`, (c) => { const g = guard(c); return ok({ items: listStaff(g.owner, c.query.get('includeInactive') !== '0') }); }, A);
  r.post(`${P}/staff`, (c) => { const g = guard(c); return created(createStaff(g.owner, g.actor, c.json())); }, A);
  r.patch(`${P}/staff/:id`, (c) => { const g = guard(c); return ok(updateStaff(g.owner, g.actor, c.params.id!, c.json())); }, A);

  r.get(`${P}/attendance`, (c) => { const g = guard(c); return ok(attendanceSheet(g.owner, month(c))); }, A);
  r.put(`${P}/attendance`, (c) => { const g = guard(c); return ok(setAttendance(g.owner, g.actor, parseAttendance(c.json()))); }, A);

  r.get(`${P}/adjustments`, (c) => { const g = guard(c); return ok({ items: listAdjustments(g.owner, month(c)) }); }, A);
  r.post(`${P}/adjustments`, (c) => { const g = guard(c); return created(addAdjustment(g.owner, g.actor, c.json())); }, A);
  r.del(`${P}/adjustments/:id`, (c) => { const g = guard(c); removeAdjustment(g.owner, g.actor, c.params.id!); return ok({ removed: true }); }, A);

  r.get(`${P}/runs`, (c) => { const g = guard(c); return ok({ items: listRuns(g.owner) }); }, A);
  r.get(`${P}/runs/:month`, (c) => { const g = guard(c); return ok(getRun(g.owner, c.params.month!)); }, A);
  r.post(`${P}/runs/:month/finalise`, (c) => { const g = guard(c); return ok(finaliseRun(g.owner, g.actor, c.params.month!)); }, A);
  r.post(`${P}/runs/:month/reopen`, (c) => { const g = guard(c); return ok(reopenRun(g.owner, g.actor, c.params.month!)); }, A);
  r.post(`${P}/runs/:month/lines/:id/pay`, (c) => { const g = guard(c); return ok(markPaid(g.owner, g.actor, c.params.month!, c.params.id!, c.json())); }, A);
  r.del(`${P}/runs/:month/lines/:id/pay`, (c) => { const g = guard(c); return ok(unmarkPaid(g.owner, g.actor, c.params.month!, c.params.id!)); }, A);
  r.get(`${P}/payslip`, (c) => { const g = guard(c); return ok(payslip(g.owner, month(c), c.query.get('staffId') ?? '')); }, A);
  r.get(`${P}/statutory`, (c) => { const g = guard(c); return ok(statutoryDues(g.owner, month(c))); }, A);
  r.get(`${P}/summary`, (c) => { const g = guard(c); return ok(summary(g.owner, month(c))); }, A);
}
