import { Router, ok, created } from '../http.ts';
import { createLead, listLeads, updateLead } from '../platform.ts';
import { U } from './helpers.ts';

export function platformRoutes(r: Router): void {
  r.post('/api/platform/leads', (c) => created(createLead(c.json())), { rate: 'auth' });
  r.get('/api/admin/leads', (c) => ok({ items: listLeads(c.query.get('status') ?? undefined) }), { auth: ['super_admin'] });
  r.patch('/api/admin/leads/:id', (c) => { const u = U(c); return ok(updateLead({ id: u.id, role: u.role }, c.params.id!, c.json())); }, { auth: ['super_admin'] });
}
