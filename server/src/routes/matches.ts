import { Router, ok, created } from '../http.ts';
import { U, ownerOrFail } from './helpers.ts';
import { hasPermission, requirePermission } from '../auth.ts';
import { HttpError } from '../errors.ts';
import { addSquadPlayer, customerCricket, importTeamList, leaders, myCricket, notMe, removeSquadPlayer, squads, updateSquadPlayer } from '../playerStats.ts';
import { cancelContest, contestForPlayer, contestForStaff, listForPlayer, listForStaff, myFantasy, openContest, removeEntry, saveEntry, seasonForPlayer, seasonTable, teamForPlayer, updateContest, withdrawEntry } from '../fantasy.ts';
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

  // squads: the names the scorer uses, linked to players' Daji profiles (playerStats.ts)
  const squadGate = (c: Parameters<typeof U>[0]) => ({ ...gate(c), u: U(c) });
  r.get('/api/staff/matches/:id/players', (c) => { const g = squadGate(c); return ok(squads(g.u, g.owner, c.params.id!)); }, A);
  r.post('/api/staff/matches/:id/players', (c) => { const g = squadGate(c); const res = addSquadPlayer(g.actor, g.owner, c.params.id!, c.json()); return created({ ...res, squads: squads(g.u, g.owner, c.params.id!) }); }, A);
  r.post('/api/staff/matches/:id/players/import', (c) => { const g = squadGate(c); const res = importTeamList(g.actor, g.owner, c.params.id!, c.json()); return ok({ ...res, squads: squads(g.u, g.owner, c.params.id!) }); }, A);
  r.patch('/api/staff/matches/:id/players/:pid', (c) => { const g = squadGate(c); updateSquadPlayer(g.actor, g.owner, c.params.id!, c.params.pid!, c.json()); return ok(squads(g.u, g.owner, c.params.id!)); }, A);
  r.del('/api/staff/matches/:id/players/:pid', (c) => { const g = squadGate(c); removeSquadPlayer(g.actor, g.owner, c.params.id!, c.params.pid!); return ok(squads(g.u, g.owner, c.params.id!)); }, A);
  // career records: the business's leaders (scorers), a customer's record at this business (who may see customers or scores matches)
  r.get('/api/staff/cricket/leaders', (c) => { const g = gate(c); return ok(leaders(g.owner)); }, A);
  r.get('/api/staff/customers/:id/cricket', (c) => {
    const u = U(c);
    if (!hasPermission(u, 'view_customers') && !hasPermission(u, 'manage_matches')) throw new HttpError(403, 'FORBIDDEN', 'You do not have access to customers. Ask the owner to give you the "view_customers" permission.');
    return ok(customerCricket(ownerOrFail(c, 'see customers'), c.params.id!));
  }, A);
  // the signed-in player's own record, and "this was not me"
  r.get('/api/my/cricket', (c) => ok(myCricket(U(c))), { auth: ['customer'] });
  r.post('/api/my/cricket/matches/:id/not-me', (c) => ok(notMe(U(c), c.params.id!, c.json())), { auth: ['customer'] });

  // fantasy cricket (fantasy.ts): free to play, points only. The ground opens and runs contests; signed-in players pick teams.
  r.get('/api/staff/fantasy', (c) => { const g = gate(c); return ok(listForStaff(g.owner)); }, A);
  r.post('/api/staff/fantasy', (c) => { const g = squadGate(c); const res = openContest(g.actor, g.owner, c.json()); return created(contestForStaff(g.u, g.owner, res.id)); }, A);
  r.get('/api/staff/fantasy/season', (c) => { const g = gate(c); return ok(seasonTable(g.owner, { tournamentId: c.query.get('tournamentId'), limit: 100 })); }, A);
  r.get('/api/staff/fantasy/:id', (c) => { const g = squadGate(c); return ok(contestForStaff(g.u, g.owner, c.params.id!)); }, A);
  r.patch('/api/staff/fantasy/:id', (c) => { const g = squadGate(c); updateContest(g.actor, g.owner, c.params.id!, c.json()); return ok(contestForStaff(g.u, g.owner, c.params.id!)); }, A);
  r.post('/api/staff/fantasy/:id/cancel', (c) => { const g = squadGate(c); cancelContest(g.actor, g.owner, c.params.id!, c.json()); return ok(contestForStaff(g.u, g.owner, c.params.id!)); }, A);
  r.post('/api/staff/fantasy/:id/entries/:eid/remove', (c) => { const g = squadGate(c); removeEntry(g.actor, g.owner, c.params.id!, c.params.eid!, c.json()); return ok(contestForStaff(g.u, g.owner, c.params.id!)); }, A);
  const P = { auth: ['customer' as const] };
  r.get('/api/fantasy', (c) => ok(listForPlayer(U(c))), P);
  r.get('/api/my/fantasy', (c) => ok(myFantasy(U(c))), P);
  r.get('/api/fantasy/:id', (c) => ok(contestForPlayer(U(c), c.params.id!)), P);
  r.put('/api/fantasy/:id/entry', (c) => ok(saveEntry(U(c), c.params.id!, c.json())), { ...P, idempotent: true });
  r.del('/api/fantasy/:id/entry', (c) => ok(withdrawEntry(U(c), c.params.id!)), P);
  r.get('/api/fantasy/:id/entries/:eid', (c) => ok(teamForPlayer(U(c), c.params.id!, c.params.eid!)), P);
  r.get('/api/fantasy/:id/season', (c) => ok(seasonForPlayer(U(c), c.params.id!)), P);

  // public: live and finished matches marked public
  r.get('/api/matches', () => ok({ items: publicMatches() }));
  r.get('/api/matches/:id', (c) => ok(scorecard(c.params.id!, false)));
}
