import { Router, ok, created } from '../http.ts';
import type { Ctx } from '../http.ts';
import { U, ownerOrFail } from './helpers.ts';
import { requirePermission } from '../auth.ts';
import { readVia } from '../ask/index.ts';
import * as A from '../auction.ts';
import * as Dep from '../auctionDeposit.ts';

// Auction tournaments (auction.ts). Customers host and play under /api/auctions; the ground's staff see and can hide them
// under /api/staff/auctions. Bids are idempotent, so a retried tap never bids twice.

const C = { auth: ['customer'] as 'customer'[] };
const ANY = { auth: 'user' as const };
const S = { auth: ['owner', 'staff', 'super_admin'] as ('owner' | 'staff' | 'super_admin')[] };

export function auctionRoutes(r: Router): void {
  const on = (c: Ctx) => { A.auctionsOn(); return U(c); };
  const base = '/api/auctions';

  r.get(base, (c) => ok(A.listForCustomer(on(c))), C);
  r.post(base, (c) => created(A.createAuction(on(c), c.json())), { ...C, idempotent: true });
  r.get(`${base}/:id`, (c) => {
    const u = on(c);
    const since = Number(c.query.get('since') ?? 0);
    const v = A.auctionView(u, c.params.id!);
    // a phone polling during the bidding gets a short answer when nothing changed
    return ok(since && since === v.version ? { changed: false, version: v.version } : { changed: true, ...v });
  }, ANY);
  r.patch(`${base}/:id`, (c) => ok(A.updateAuction(on(c), c.params.id!, c.json())), C);
  r.post(`${base}/:id/rules`, (c) => ok(A.saveRules(on(c), c.params.id!, c.json())), C);
  r.post(`${base}/:id/rules/draft`, (c) => { const b = c.json() as { via?: unknown }; return ok(A.draftRules(on(c), c.params.id!, b, readVia(b?.via))); }, { ...C, maxBody: 4096 });
  r.get(`${base}/:id/rules/history`, (c) => ok({ items: A.ruleHistory(on(c), c.params.id!) }), C);
  r.post(`${base}/:id/teams`, (c) => created(A.addAuctionTeam(on(c), c.params.id!, c.json())), C);
  r.patch(`${base}/:id/teams/:teamId`, (c) => ok(A.updateAuctionTeam(on(c), c.params.id!, c.params.teamId!, c.json())), C);
  r.del(`${base}/:id/teams/:teamId`, (c) => ok(A.removeAuctionTeam(on(c), c.params.id!, c.params.teamId!)), C);
  r.post(`${base}/:id/join`, (c) => ok(A.joinAuction(on(c), c.params.id!, c.json())), { ...C, idempotent: true });
  r.post(`${base}/:id/leave`, (c) => ok(A.leaveAuction(on(c), c.params.id!)), C);
  r.post(`${base}/:id/players/:playerId/remove`, (c) => ok(A.removePlayer(on(c), c.params.id!, c.params.playerId!, c.json())), C);
  r.post(`${base}/:id/start`, (c) => ok(A.startBidding(on(c), c.params.id!)), C);
  r.post(`${base}/:id/next`, (c) => ok(A.nextPlayer(on(c), c.params.id!, c.json())), C);
  r.post(`${base}/:id/bid`, (c) => { const b = c.json() as { via?: unknown }; return ok(A.placeBid(on(c), c.params.id!, b, readVia(b?.via))); }, { ...C, idempotent: true });
  r.post(`${base}/:id/bid/retract`, (c) => ok(A.retractBid(on(c), c.params.id!)), C);
  r.post(`${base}/:id/hammer`, (c) => ok(A.hammer(on(c), c.params.id!)), { ...C, idempotent: true });
  r.post(`${base}/:id/undo`, (c) => ok(A.undoLast(on(c), c.params.id!)), { ...C, idempotent: true });
  r.post(`${base}/:id/finish`, (c) => ok(A.finishAuction(on(c), c.params.id!)), { ...C, idempotent: true });
  r.post(`${base}/:id/cancel`, (c) => ok(A.cancelAuction(on(c), c.params.id!, c.json())), C);
  r.post(`${base}/:id/fixtures`, (c) => created(A.auctionFixtures(on(c), c.params.id!, c.json())), C);
  // ---- the hosting deposit: the host says they paid (staff check and record it) or asks an admin to waive it
  r.post(`${base}/:id/deposit/paid`, (c) => ok(Dep.claimPaid(on(c), c.params.id!, c.json())), C);
  r.post(`${base}/:id/deposit/waiver`, (c) => ok(Dep.requestWaiver(on(c), c.params.id!, c.json())), { ...C, idempotent: true });
  r.get(`${base}/:id/tournament`, (c) => ok(A.auctionTournament(on(c), c.params.id!)), ANY);

  // ---- the ground's staff
  const gate = (c: Ctx) => { const u = U(c); requirePermission(u, 'manage_matches'); return { actor: { id: u.id, role: u.role }, owner: ownerOrFail(c, 'see auction tournaments') }; };
  const sb = '/api/staff/auctions';
  r.get(sb, (c) => ok({ items: A.listForStaff(gate(c).owner) }), S);
  r.get(`${sb}/:id`, (c) => { const g = gate(c); return ok(A.auctionView(U(c), c.params.id!, g.owner)); }, S);
  r.post(`${sb}/:id/hide`, (c) => { const g = gate(c); return ok(A.hideAuction(g.actor, g.owner, c.params.id!, c.json())); }, S);
  r.get(`${sb}/deposits/summary`, (c) => ok(Dep.depositsAt(gate(c).owner)), S);
  for (const kind of ['collect', 'refund', 'keep'] as const) {
    r.post(`${sb}/:id/deposit/${kind}`, (c) => { const g = gate(c); return ok(Dep.recordDepositEntry(U(c), g.owner, c.params.id!, kind, c.json())); }, { ...S, idempotent: true });
  }
  r.post(`${sb}/:id/deposit/waiver`, (c) => { const g = gate(c); return ok(Dep.decideWaiver(U(c), g.owner, c.params.id!, c.json())); }, { ...S, idempotent: true });
  r.post(`${sb}/:id/unhide`, (c) => { const g = gate(c); return ok(A.unhideAuction(g.actor, g.owner, c.params.id!)); }, S);
}
