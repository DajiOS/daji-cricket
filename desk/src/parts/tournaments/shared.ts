// Types and small helpers shared by the tournament screens.
import type { Tone } from '../../ui';

export interface Fees { teams: number; paidTeams: number; unpaidTeams: number; expectedPaise: number; collectedPaise: number; pendingPaise: number }
export interface Tournament { id: string; name: string; startDate: string; endDate: string; format: string; overs: number; entryFeePaise: number; pointsWin: number; pointsTie: number; status: string; notes: string | null; teamCount: number; fixtureCount: number; playedCount: number; fees: Fees;
  organiser?: { firstName: string; lastName: string; phone: string | null; email: string | null; customerId: string | null };
  booking?: { seriesId: string; firstBookingId: string | null; groundName: string | null; fromDate: string; toDate: string; totalPaise: number; paidPaise: number; balancePaise: number; cancelled: boolean } | null }
export interface Team { id: string; name: string; captain: string | null; phone: string | null; feePaid: boolean; paymentRef: string | null; paidAt: number | null }
export interface Fixture {
  id: string; round: number; teamAId: string; teamBId: string; teamA: string; teamB: string; startsAt: number | null; groundId: string | null; groundName: string | null;
  played: boolean; outcome: string | null; winnerTeamId: string | null; winner: string | null; resultText: string | null;
  aRuns: number | null; aOvers: string | null; bRuns: number | null; bOvers: string | null; matchId: string | null; matchStatus: string | null;
  /** End of the time this fixture holds on the ground (customers cannot book it); null when it holds none. */
  blockedUntil?: number | null;
}
export interface TableRow { teamId: string; team: string; played: number; won: number; lost: number; tied: number; noResult: number; points: number; nrr: number | null }
export interface Ground { id: string; name: string }
export interface Detail { tournament: Tournament; teams: Team[]; fixtures: Fixture[]; table: TableRow[]; fees: Fees; grounds: Ground[] }

export const API = '/api/staff/tournaments';

export const STATUS: Record<string, [Tone, string]> = {
  draft: ['mute', 'Draft'], open: ['info', 'Entries open'], running: ['gold', 'Running'], completed: ['good', 'Completed'], cancelled: ['bad', 'Cancelled'],
};
export const FORMATS: [string, string][] = [['round_robin', 'Round robin'], ['knockout', 'Knockout'], ['league_knockout', 'League then knockout'], ['other', 'Other']];
export const formatLabel = (f: string) => FORMATS.find(([k]) => k === f)?.[1] ?? f;

const IST = 330 * 60000;
/** epoch ms -> { date: "2026-10-21", time: "18:30" } in India time, for the date and time inputs */
export function splitIst(ms: number | null): { date: string; time: string } {
  if (!ms) return { date: '', time: '' };
  const d = new Date(ms + IST).toISOString();
  return { date: d.slice(0, 10), time: d.slice(11, 16) };
}
/** "12.5" typed as rupees -> paise (null if not a number) */
export const rupeesToPaise = (s: string): number | null => { const t = s.replace(/[₹,\s]/g, ''); return /^\d+(\.\d{1,2})?$/.test(t) ? Math.round(Number(t) * 100) : null; };
export const paiseToRupees = (p: number) => (p % 100 === 0 ? String(p / 100) : (p / 100).toFixed(2));
export const nrrText = (n: number | null) => (n === null ? '—' : (n > 0 ? '+' : '') + n.toFixed(3));
