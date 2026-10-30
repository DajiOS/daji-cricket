import { Router, ok, created } from '../http.ts';
import { U, ownerOrFail } from './helpers.ts';
import { addMembership, businessesOfStaff, createArea, getAreaAccess, listAreas, listMemberships, removeMembership, setAreaAccess, updateArea, updateMembership } from '../areas.ts';
import { businessName } from '../businesses.ts';
import { holdsBusiness } from '../portfolio.ts';

// Branches (areas) inside a business, who on the team sees which branch, and team members added from another business (areas.ts).
export function areaRoutes(r: Router): void {
  const TEAM = { auth: ['owner', 'staff', 'super_admin'] as ('owner' | 'staff' | 'super_admin')[] };
  const BOSS = { auth: ['owner', 'super_admin'] as ('owner' | 'super_admin')[] };

  // everyone on the team sees the branches they may see; the owner also sees archived ones with ?archived=1
  r.get('/api/areas', (c) => ok(listAreas(U(c), ownerOrFail(c, 'see the branches'), c.query.get('archived') === '1')), TEAM);
  r.post('/api/areas', (c) => created(createArea(U(c), ownerOrFail(c, 'add a branch'), c.json())), BOSS);
  r.patch('/api/areas/:id', (c) => ok(updateArea(U(c), ownerOrFail(c, 'change a branch'), c.params.id!, c.json())), BOSS);

  r.get('/api/staff/team/:id/areas', (c) => ok(getAreaAccess(U(c), ownerOrFail(c, 'see branch access'), c.params.id!)), BOSS);
  r.put('/api/staff/team/:id/areas', (c) => ok(setAreaAccess(U(c), ownerOrFail(c, 'set branch access'), c.params.id!, c.json())), BOSS);

  r.get('/api/staff/team-memberships', (c) => ok(listMemberships(U(c), ownerOrFail(c, 'see the team'), businessName)), BOSS);
  // only an owner adds people from a business they hold; the super admin works through each business's own owner
  r.post('/api/staff/team-memberships', (c) => created(addMembership(U(c), c.realUser ?? U(c), ownerOrFail(c, 'add a team member'), c.json(), holdsBusiness)), { auth: ['owner'] });
  r.patch('/api/staff/team-memberships/:userId', (c) => ok(updateMembership(U(c), ownerOrFail(c, 'change a team member'), c.params.userId!, c.json())), BOSS);
  r.del('/api/staff/team-memberships/:userId', (c) => ok(removeMembership(U(c), ownerOrFail(c, 'remove a team member'), c.params.userId!)), BOSS);

  // the businesses a team member works in (their employer first); the desk and app switch with X-Daji-Business
  r.get('/api/me/businesses', (c) => ok({ items: businessesOfStaff(U(c), businessName) }), { auth: ['staff'] });
}
