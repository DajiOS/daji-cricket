import { Router, ok, created } from '../http.ts';
import { U, ownerOrFail } from './helpers.ts';
import {
  addChild, answerClaim, childRecord, claimMatch, joinNetwork, leaveNetwork, myChildren, myClaims, myNetworkProfile, mySharing, networkStatus, platformState,
  removeChild, searchPlayers, setChildConsent, setChildProfiles, setChildSharing, setMySharing, staffClaims, staffDecideClaim, staffSuggest, viewProfile,
} from '../network.ts';
import {
  addNetPlayer, addNetTeam, addSettlement, answerInvitation, answerTeamInvitation, assignScorer, cancelFixture, cancelNetTournament, cancelSettlement, completeNetTournament, confirmSlot,
  createNetTournament, declineSlot, fixtureResults, inviteGround, listNetTournaments, markSettlementPaid, moveFixture, myTeamInvitations, netTournamentDetail, openScoring, proposeFixtures,
  publicNetTournament, publishNetTournament, removeNetPlayer, removeNetTeam, submitResult, verifyResult,
} from '../netTournaments.ts';

// The cricket network (network.ts) and network tournaments across grounds (netTournaments.ts).
export function networkRoutes(r: Router): void {
  const TEAM = { auth: ['owner', 'staff', 'super_admin'] as ('owner' | 'staff' | 'super_admin')[] };
  const ME = { auth: ['customer'] as 'customer'[] };
  const own = (c: Parameters<typeof U>[0]) => ownerOrFail(c, 'use the cricket network');

  // the business: join, leave, who is in it
  r.get('/api/staff/network', (c) => ok(networkStatus(U(c), own(c))), TEAM);
  r.post('/api/staff/network/join', (c) => ok(joinNetwork(U(c), own(c))), TEAM);
  r.post('/api/staff/network/leave', (c) => ok(leaveNetwork(U(c), own(c))), TEAM);
  r.get('/api/staff/network/players', (c) => ok(searchPlayers(U(c), own(c), c.query.get('q') ?? '')), TEAM);
  r.get('/api/staff/network/players/:id', (c) => ok(viewProfile(U(c), c.params.id!)), TEAM);
  // possible duplicate profiles: never merged without the player and the ground both agreeing
  r.get('/api/staff/network/claims', (c) => ok(staffClaims(U(c), own(c))), TEAM);
  r.post('/api/staff/network/claims', (c) => created(staffSuggest(U(c), own(c), c.json())), TEAM);
  r.post('/api/staff/network/claims/:id', (c) => ok(staffDecideClaim(U(c), own(c), c.params.id!, c.json())), TEAM);

  // the software owner's switch for children's profiles (off until legal and product review)
  r.get('/api/admin/network/children', () => ok(platformState()), { auth: ['super_admin'] });
  r.put('/api/admin/network/children', (c) => ok(setChildProfiles(U(c), c.json())), { auth: ['super_admin'] });

  // network tournaments
  const base = '/api/staff/network/tournaments';
  r.get(base, (c) => ok(listNetTournaments(U(c), own(c))), TEAM);
  r.post(base, (c) => created(createNetTournament(U(c), own(c), c.json())), TEAM);
  r.get(`${base}/:id`, (c) => ok(netTournamentDetail(U(c), own(c), c.params.id!)), TEAM);
  r.post(`${base}/:id/publish`, (c) => ok(publishNetTournament(U(c), own(c), c.params.id!)), TEAM);
  r.post(`${base}/:id/complete`, (c) => ok(completeNetTournament(U(c), own(c), c.params.id!)), TEAM);
  r.post(`${base}/:id/cancel`, (c) => ok(cancelNetTournament(U(c), own(c), c.params.id!, c.json())), TEAM);
  r.post(`${base}/:id/grounds`, (c) => created(inviteGround(U(c), own(c), c.params.id!, c.json())), TEAM);
  r.post(`${base}/:id/grounds/:gid`, (c) => ok(answerInvitation(U(c), own(c), c.params.id!, c.params.gid!, c.json())), TEAM);
  r.post(`${base}/:id/teams`, (c) => created(addNetTeam(U(c), own(c), c.params.id!, c.json())), TEAM);
  r.del(`${base}/:id/teams/:teamId`, (c) => ok(removeNetTeam(U(c), own(c), c.params.id!, c.params.teamId!)), TEAM);
  r.post(`${base}/:id/teams/:teamId/players`, (c) => created(addNetPlayer(U(c), own(c), c.params.id!, c.params.teamId!, c.json())), TEAM);
  r.del(`${base}/:id/teams/:teamId/players/:pid`, (c) => ok(removeNetPlayer(U(c), own(c), c.params.id!, c.params.teamId!, c.params.pid!)), TEAM);
  r.post(`${base}/:id/fixtures/propose`, (c) => created(proposeFixtures(U(c), own(c), c.params.id!, c.json())), TEAM);
  r.post(`${base}/:id/fixtures/:fid/move`, (c) => ok(moveFixture(U(c), own(c), c.params.id!, c.params.fid!, c.json())), TEAM);
  r.post(`${base}/:id/fixtures/:fid/confirm`, (c) => ok(confirmSlot(U(c), own(c), c.params.id!, c.params.fid!)), TEAM);
  r.post(`${base}/:id/fixtures/:fid/decline`, (c) => ok(declineSlot(U(c), own(c), c.params.id!, c.params.fid!, c.json())), TEAM);
  r.post(`${base}/:id/fixtures/:fid/cancel`, (c) => ok(cancelFixture(U(c), own(c), c.params.id!, c.params.fid!, c.json())), TEAM);
  r.post(`${base}/:id/fixtures/:fid/scorer`, (c) => ok(assignScorer(U(c), own(c), c.params.id!, c.params.fid!, c.json())), TEAM);
  r.post(`${base}/:id/fixtures/:fid/scoring`, (c) => created(openScoring(U(c), own(c), c.params.id!, c.params.fid!)), TEAM);
  r.post(`${base}/:id/fixtures/:fid/result`, (c) => created(submitResult(U(c), own(c), c.params.id!, c.params.fid!, c.json())), TEAM);
  r.post(`${base}/:id/fixtures/:fid/verify`, (c) => ok(verifyResult(U(c), own(c), c.params.id!, c.params.fid!, c.json())), TEAM);
  r.get(`${base}/:id/fixtures/:fid/results`, (c) => ok(fixtureResults(U(c), own(c), c.params.id!, c.params.fid!)), TEAM);
  r.post(`${base}/:id/settlements`, (c) => created(addSettlement(U(c), own(c), c.params.id!, c.json())), TEAM);
  r.post(`${base}/:id/settlements/:sid/paid`, (c) => ok(markSettlementPaid(U(c), own(c), c.params.id!, c.params.sid!, c.json())), TEAM);
  r.post(`${base}/:id/settlements/:sid/cancel`, (c) => ok(cancelSettlement(U(c), own(c), c.params.id!, c.params.sid!, c.json())), TEAM);

  // the player
  r.get('/api/me/network', (c) => ok(myNetworkProfile(U(c))), ME);
  r.get('/api/me/network/sharing', (c) => ok(mySharing(U(c))), ME);
  r.put('/api/me/network/sharing', (c) => ok(setMySharing(U(c), c.json())), ME);
  r.get('/api/me/network/claims', (c) => ok(myClaims(U(c))), ME);
  r.post('/api/me/network/claims', (c) => created(claimMatch(U(c), c.json())), ME);
  r.post('/api/me/network/claims/:id', (c) => ok(answerClaim(U(c), c.params.id!, c.json())), ME);
  // a network tournament organiser asked to put the player's profile on a team: linked only if the player agrees
  r.get('/api/me/network/team-invitations', (c) => ok(myTeamInvitations(U(c))), ME);
  r.post('/api/me/network/team-invitations/:id', (c) => ok(answerTeamInvitation(U(c), c.params.id!, c.json())), ME);
  // children, run by their parent or guardian (apart from academy students, which stay one academy's own record: /api/me/children)
  r.get('/api/me/network/children', (c) => ok(myChildren(U(c))), ME);
  r.post('/api/me/network/children', (c) => created(addChild(U(c), c.json())), ME);
  r.get('/api/me/network/children/:id', (c) => ok(childRecord(U(c), c.params.id!)), ME);
  r.post('/api/me/network/children/:id/consent', (c) => ok(setChildConsent(U(c), c.params.id!, c.json())), ME);
  r.put('/api/me/network/children/:id/sharing', (c) => ok(setChildSharing(U(c), c.params.id!, c.json())), ME);
  r.del('/api/me/network/children/:id', (c) => ok(removeChild(U(c), c.params.id!)), ME);

  // public: a profile its player made public, and a published tournament (no players, money or contact details)
  r.get('/api/public/network/players/:id', (c) => ok(viewProfile(c.user ?? null, c.params.id!)));
  r.get('/api/public/network/tournaments/:id', (c) => ok(publicNetTournament(c.params.id!)));
}
