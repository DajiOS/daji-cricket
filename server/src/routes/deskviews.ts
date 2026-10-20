import { Router, ok, created } from '../http.ts';
import { U, ownerOrFail } from './helpers.ts';
import { hasPermission } from '../auth.ts';
import { forbidden } from '../errors.ts';
import { createSpot, deleteSpot, listSpots, updateSpot } from '../spots.ts';
import { activityFeed, closeChecklist, compare, groundHealth, moneyFlow, opsCalendar } from '../deskviews.ts';

const A = { auth: ['owner', 'staff', 'super_admin'] as ('owner' | 'staff' | 'super_admin')[] };

export function deskViewRoutes(r: Router): void {
  r.get('/api/desk/calendar', (c) => ok(opsCalendar(U(c), ownerOrFail(c, 'see the calendar'), c.query.get('month'))), A);
  r.get('/api/desk/activity', (c) => ok(activityFeed(U(c), ownerOrFail(c, 'see the activity'), c.query.get('before'), c.query.get('limit'))), A);
  r.get('/api/desk/close', (c) => ok(closeChecklist(U(c), ownerOrFail(c, 'close the month'), c.query.get('month'))), A);
  r.get('/api/desk/compare', (c) => ok(compare(U(c), ownerOrFail(c, 'compare'), c.query.get('mode'), c.query.get('a'), c.query.get('b'))), A);
  r.get('/api/desk/health', (c) => ok(groundHealth(U(c), ownerOrFail(c, 'see the ground health'))), A);
  r.get('/api/desk/money-flow', (c) => ok(moneyFlow(U(c), ownerOrFail(c, 'see the money flow'), c.query.get('month'))), A);

  // the ground-and-nets status board and its layout
  const spots = (c: Parameters<typeof U>[0]) => {
    const u = U(c);
    if (!hasPermission(u, 'manage_bookings') && !hasPermission(u, 'manage_tasks')) throw forbidden('This needs the "manage_bookings" or "manage_tasks" permission');
    return { owner: ownerOrFail(c, 'see the grounds and nets'), actor: { id: u.id, role: u.role } };
  };
  r.get('/api/desk/spots', (c) => ok(listSpots(spots(c).owner)), A);
  r.post('/api/desk/spots', (c) => { const n = spots(c); return created(createSpot(n.owner, n.actor, c.json())); }, A);
  r.patch('/api/desk/spots/:id', (c) => { const n = spots(c); return ok(updateSpot(n.owner, n.actor, c.params.id!, c.json())); }, A);
  r.del('/api/desk/spots/:id', (c) => { const n = spots(c); deleteSpot(n.owner, n.actor, c.params.id!); return ok({ removed: true }); }, A);
}
