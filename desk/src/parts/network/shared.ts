// Types and small helpers shared by the cricket network screens (server: src/network.ts and src/netTournaments.ts).
import { useState } from 'react';
import type { Tone } from '../../ui';

export const NET = '/api/staff/network';
export const NT = '/api/staff/network/tournaments';

export interface Member { ownerId: string; name: string; joinedAt: number; isMe: boolean; grounds: { id: string; name: string; city: string }[] }
export interface Status { joined: boolean; joinedAt: number | null; canChange: boolean; members: Member[]; sharedFields: string[]; neverShared: string[]; eligibleRule: string; note: string; childProfiles: { on: boolean; legalReviewRef: string | null; note: string } }
export interface Summary {
  id: string; name: string; organiser: string; myRole: 'organiser' | 'host'; status: string; format: string; overs: number; matchMinutes: number; startDate: string; endDate: string;
  teams: number; grounds: number; fixtures: number; confirmed: number; verified: number; invitationsForMe: number; slotsForMe: number; resultsToVerify: number;
}
export interface Result {
  id: string; version: number; outcome: string; winner: string | null; resultText: string | null; aRuns: number | null; aOvers: string | null; bRuns: number | null; bOvers: string | null; fromScorer: boolean;
  submittedBy: string | null; submittedAt: number; reason: string | null; status: string; verifiedBy: string | null; verifiedAt: number | null; rejectReason: string | null;
}
export interface Fixture {
  id: string; round: number; teamAId: string; teamBId: string; teamA: string; teamB: string; groundId: string | null; ground: string | null; host: string | null; hostIsMe: boolean;
  startsAt: number | null; endsAt: number | null; status: string; timeHeld: boolean;
  move: { groundId: string; ground: string | null; startsAt: number | null; reason: string | null; hostIsMe: boolean } | null;
  matchId: string | null; scorer: string | null; scorerId: string | null; result: Result | null; waiting: Result | null;
}
export interface Settlement {
  id: string; kind: string; amountPaise: number; payer: string; payee: string; note: string | null; fixtureId: string | null; fixture: string | null;
  iPay: boolean; iReceive: boolean; status: 'agreed' | 'paid' | 'cancelled'; history: { status: string; at: number; by: string | null; ref: string | null; reason: string | null }[]; books: string;
}
export interface Detail {
  tournament: Summary & { pointsWin: number; pointsTie: number; notes: string | null; publishedAt: number | null; closedAt: number | null; closeReason: string | null };
  myRole: 'organiser' | 'host';
  grounds: { id: string; groundId: string; ground: string | null; business: string; isMine: boolean; status: string; chargePerMatchPaise: number; note: string | null }[];
  teams: { id: string; name: string; captain: string | null; players?: { id: string; name: string; hasProfile: boolean }[]; playerCount: number }[];
  fixtures: Fixture[];
  standings: { teamId: string; team: string; played: number; won: number; lost: number; tied: number; noResult: number; points: number; nrr: number | null }[];
  standingsNote: string;
  settlements: Settlement[]; settlementTotals: { toReceivePaise: number; receivedPaise: number; toPayPaise: number; paidPaise: number }; booksNote: string;
  history: { fixtureId: string; at: number; by: string | null; business: string | null; kind: string; detail: unknown; reason: string | null }[];
  networkGrounds: { id: string; name: string; city: string; business: string }[];
  myGrounds: { id: string; name: string }[];
  businessOwners: { ownerId: string; name: string }[];
  scorers: { id: string; name: string }[];
}

export const T_STATUS: Record<string, [Tone, string]> = { draft: ['warn', 'Setting up'], published: ['good', 'Published'], completed: ['info', 'Completed'], cancelled: ['bad', 'Cancelled'] };
export const G_STATUS: Record<string, [Tone, string]> = { invited: ['warn', 'Invited'], accepted: ['good', 'Accepted'], declined: ['bad', 'Declined'], withdrawn: ['mute', 'Withdrawn'] };
export const F_STATUS: Record<string, [Tone, string]> = { unscheduled: ['mute', 'No time yet'], proposed: ['warn', 'Waiting for the ground'], confirmed: ['good', 'Confirmed'], declined: ['bad', 'Turned down'], cancelled: ['mute', 'Cancelled'] };
export const S_STATUS: Record<string, [Tone, string]> = { agreed: ['warn', 'Agreed, not paid'], paid: ['good', 'Paid'], cancelled: ['mute', 'Cancelled'] };
export const KIND: Record<string, string> = { entry_fee: 'Entry fee', ground_charge: 'Ground charge', prize: 'Prize', other: 'Other' };
export const FORMAT: Record<string, string> = { round_robin: 'Round robin', double_round_robin: 'Double round robin' };

/** One action at a time: busy while it runs, the server's reason when it is refused. */
export function useAct(after: () => void, toast: (m: string) => void) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function act(fn: () => Promise<unknown>, done: string): Promise<boolean> {
    setBusy(true); setErr(null);
    try { await fn(); toast(done); after(); return true; } catch (e: any) { setErr(e.message); return false; } finally { setBusy(false); }
  }
  return { busy, err, setErr, act };
}
