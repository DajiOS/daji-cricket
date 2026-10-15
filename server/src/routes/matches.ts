import { Router, ok, created } from '../http.ts';
import { U, ownerOrFail } from './helpers.ts';
import { requirePermission } from '../auth.ts';
import { addBall, createMatch, listMatches, publicMatches, scorecard, undoBall, updateMatch } from '../matches.ts';

const STAFF: ('owner' | 'staff' | 'super_admin')[] = ['owner', 'staff', 'super_admin'];
const A = { auth: STAFF };

export function matchRoutes(r: Router): void {
  const gate = (c: Parameters<typeof U>[0]) => { const u = U(c); requirePermission(u, 'manage_matches'); return { actor: { id: u.id, role: u.role }, owner: ownerOrFail(c, 'score matches') }; };

  r.get('/api/staff/matches', (c) => { const g = gate(c); return ok({ items: listMatches(g.owner) }); }, A);
  r.post('/api/staff/matches', (c) => { const g = gate(c); return created(createMatch(g.actor, g.owner, c.json())); }, A);
  r.patch('/api/staff/matches/:id', (c) => { const g = gate(c); return ok(updateMatch(g.actor, g.owner, c.params.id!, c.json())); }, A);
  r.get('/api/staff/matches/:id', (c) => { const g = gate(c); return ok(scorecard(c.params.id!, true, g.owner)); }, A);
  r.post('/api/staff/matches/:id/balls', (c) => { const g = gate(c); return created(addBall(g.actor, g.owner, c.params.id!, c.json())); }, A);
  r.post('/api/staff/matches/:id/undo', (c) => { const g = gate(c); return ok(undoBall(g.actor, g.owner, c.params.id!, (c.json() as { innings?: unknown })?.innings)); }, A);

  // public: live and finished matches marked public
  r.get('/api/matches', () => ok({ items: publicMatches() }));
  r.get('/api/matches/:id', (c) => ok(scorecard(c.params.id!, false)));
}
