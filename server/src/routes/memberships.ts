import { Router, ok, created } from '../http.ts';
import type { Ctx } from '../http.ts';
import { U, ownerOrFail, page } from './helpers.ts';
import { forbidden } from '../errors.ts';
import { canSeeRevenue, hasPermission } from '../auth.ts';
import { createPlan, deletePlan, expiringSoon, getMember, listMembers, listPlans, membershipAudit, renewMembership, sellMembership, stats, updateMember, updatePlan } from '../memberships.ts';

const A = { auth: ['owner', 'staff', 'super_admin'] as ('owner' | 'staff' | 'super_admin')[] };

export function membershipsRoutes(r: Router): void {
  const need = (c: Ctx) => {
    const u = U(c);
    if (!hasPermission(u, 'manage_bookings')) throw forbidden('This needs the "manage_bookings" permission');
    return { owner: ownerOrFail(c, 'use memberships'), actor: { id: u.id, role: u.role } };
  };
  const B = '/api/desk/memberships';

  r.get(`${B}/plans`, (c) => ok({ items: listPlans(need(c).owner) }), A);
  r.post(`${B}/plans`, (c) => { const n = need(c); return created(createPlan(n.owner, n.actor, c.json())); }, A);
  r.patch(`${B}/plans/:id`, (c) => { const n = need(c); return ok(updatePlan(n.owner, n.actor, c.params.id!, c.json())); }, A);
  r.del(`${B}/plans/:id`, (c) => { const n = need(c); deletePlan(n.owner, n.actor, c.params.id!); return ok({ removed: true }); }, A);

  r.get(`${B}/members`, (c) => {
    const n = need(c); const p = page(c, 200);
    return ok(listMembers(n.owner, { q: c.query.get('q') ?? undefined, status: c.query.get('status') ?? undefined, planId: c.query.get('planId') ?? undefined, limit: p.limit, offset: p.offset }));
  }, A);
  r.post(`${B}/members`, (c) => { const n = need(c); return created(sellMembership(n.owner, n.actor, c.json())); }, A);
  r.get(`${B}/members/:id`, (c) => ok(getMember(need(c).owner, c.params.id!)), A);
  r.patch(`${B}/members/:id`, (c) => { const n = need(c); return ok(updateMember(n.owner, n.actor, c.params.id!, c.json())); }, A);
  r.post(`${B}/members/:id/renew`, (c) => { const n = need(c); return ok(renewMembership(n.owner, n.actor, c.params.id!, c.json())); }, A);

  r.get(`${B}/expiring`, (c) => ok({ items: expiringSoon(need(c).owner, Number(c.query.get('days') ?? 14)) }), A);
  r.get(`${B}/stats`, (c) => { const s = stats(need(c).owner); return ok(canSeeRevenue(U(c)) ? s : { ...s, revenueMonthPaise: null, revenueLastMonthPaise: null }); }, A);
  r.get(`${B}/audit`, (c) => { const n = need(c); const p = page(c, 50); return ok(membershipAudit(n.owner, p.limit, p.offset)); }, A);
}
