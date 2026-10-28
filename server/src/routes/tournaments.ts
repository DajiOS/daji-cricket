import { Router, ok, created } from '../http.ts';
import type { Ctx } from '../http.ts';
import { U, ownerOrFail } from './helpers.ts';
import { requirePermission } from '../auth.ts';
import { addFixture, addTeam, createFixtureMatch, createTournament, deleteTournament, generateFixtures, listTournaments, removeFixture, removeTeam, scheduleFixtures, syncFixtureResult, tournamentDetail, updateFixture, updateTeam, updateTournament } from '../tournaments.ts';

const A = { auth: ['owner', 'staff', 'super_admin'] as ('owner' | 'staff' | 'super_admin')[] };

export function tournamentsRoutes(r: Router): void {
  const gate = (c: Ctx) => { const u = U(c); requirePermission(u, 'manage_matches'); return { actor: { id: u.id, role: u.role }, owner: ownerOrFail(c, 'run tournaments') }; };
  const base = '/api/staff/tournaments';

  r.get(base, (c) => ok(listTournaments(gate(c).owner)), A);
  r.post(base, (c) => { const g = gate(c); return created(createTournament(g.actor, g.owner, c.json(), U(c))); }, A);
  r.get(`${base}/:id`, (c) => ok(tournamentDetail(gate(c).owner, c.params.id!)), A);
  r.patch(`${base}/:id`, (c) => { const g = gate(c); return ok(updateTournament(g.actor, g.owner, c.params.id!, c.json())); }, A);
  r.del(`${base}/:id`, (c) => { const g = gate(c); deleteTournament(g.actor, g.owner, c.params.id!); return ok({ removed: true }); }, A);

  r.post(`${base}/:id/teams`, (c) => { const g = gate(c); return created(addTeam(g.actor, g.owner, c.params.id!, c.json())); }, A);
  r.patch(`${base}/:id/teams/:teamId`, (c) => { const g = gate(c); return ok(updateTeam(g.actor, g.owner, c.params.id!, c.params.teamId!, c.json())); }, A);
  r.del(`${base}/:id/teams/:teamId`, (c) => { const g = gate(c); removeTeam(g.actor, g.owner, c.params.id!, c.params.teamId!); return ok({ removed: true }); }, A);

  r.post(`${base}/:id/fixtures`, (c) => { const g = gate(c); return created(addFixture(g.actor, g.owner, c.params.id!, c.json())); }, A);
  r.post(`${base}/:id/fixtures/schedule`, (c) => { const g = gate(c); return created(scheduleFixtures(g.actor, g.owner, c.params.id!, c.json())); }, A);
  r.post(`${base}/:id/fixtures/generate`, (c) => { const g = gate(c); return created(generateFixtures(g.actor, g.owner, c.params.id!, c.json())); }, A);
  r.patch(`${base}/:id/fixtures/:fid`, (c) => { const g = gate(c); return ok(updateFixture(g.actor, g.owner, c.params.id!, c.params.fid!, c.json())); }, A);
  r.del(`${base}/:id/fixtures/:fid`, (c) => { const g = gate(c); removeFixture(g.actor, g.owner, c.params.id!, c.params.fid!); return ok({ removed: true }); }, A);
  r.post(`${base}/:id/fixtures/:fid/match`, (c) => { const g = gate(c); return created(createFixtureMatch(g.actor, g.owner, c.params.id!, c.params.fid!)); }, A);
  r.post(`${base}/:id/fixtures/:fid/sync`, (c) => { const g = gate(c); return ok(syncFixtureResult(g.actor, g.owner, c.params.id!, c.params.fid!)); }, A);
}
