import { Router, ok } from '../http.ts';
import { U, ownerOrFail } from './helpers.ts';
import { activityFeed, closeChecklist, moneyFlow, opsCalendar } from '../deskviews.ts';

const A = { auth: ['owner', 'staff', 'super_admin'] as ('owner' | 'staff' | 'super_admin')[] };

export function deskViewRoutes(r: Router): void {
  r.get('/api/desk/calendar', (c) => ok(opsCalendar(U(c), ownerOrFail(c, 'see the calendar'), c.query.get('month'))), A);
  r.get('/api/desk/activity', (c) => ok(activityFeed(U(c), ownerOrFail(c, 'see the activity'), c.query.get('before'), c.query.get('limit'))), A);
  r.get('/api/desk/close', (c) => ok(closeChecklist(U(c), ownerOrFail(c, 'close the month'), c.query.get('month'))), A);
  r.get('/api/desk/money-flow', (c) => ok(moneyFlow(U(c), ownerOrFail(c, 'see the money flow'), c.query.get('month'))), A);
}
