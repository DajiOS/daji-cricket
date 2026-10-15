import { Router, ok, created } from '../http.ts';
import type { Ctx } from '../http.ts';
import { U, ownerOrFail } from './helpers.ts';
import { forbidden } from '../errors.ts';
import { hasPermission } from '../auth.ts';
import { buildQueue, history, listTemplates, markSent, preview, saveTemplate, PLACEHOLDERS } from '../reminders.ts';

const A = { auth: ['owner', 'staff', 'super_admin'] as ('owner' | 'staff' | 'super_admin')[] };

export function remindersRoutes(r: Router): void {
  const gate = (c: Ctx) => { const u = U(c); if (!hasPermission(u, 'send_broadcasts')) throw forbidden('This needs the "send_broadcasts" permission'); return { owner: ownerOrFail(c, 'use reminders'), actor: { id: u.id, role: u.role } }; };

  r.get('/api/desk/reminders/queue', (c) => ok(buildQueue(gate(c).owner)), A);
  r.get('/api/desk/reminders/templates', (c) => ok({ items: listTemplates(gate(c).owner), placeholders: PLACEHOLDERS }), A);
  r.put('/api/desk/reminders/templates/:kind', (c) => { const g = gate(c); return ok(saveTemplate(g.owner, g.actor, c.params.kind, c.json())); }, A);
  r.post('/api/desk/reminders/preview', (c) => ok(preview(gate(c).owner, c.json())), A);
  r.post('/api/desk/reminders/sent', (c) => { const g = gate(c); return created(markSent(g.owner, g.actor, c.json())); }, A);
  r.get('/api/desk/reminders/history', (c) => ok(history(gate(c).owner, Number(c.query.get('limit')) || 100)), A);
}
