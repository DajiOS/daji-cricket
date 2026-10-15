import { ApiError } from '../../lib';
import { Chip, type Tone } from '../../ui';

export interface Plan { id: string; name: string; pricePaise: number; durationDays: number; perks: string; active: boolean; members: number }
export type MStatus = 'active' | 'expiring' | 'expired';
export interface Member {
  id: string; name: string; phone: string; notes: string; planId: string; planName: string; startDate: string; endDate: string;
  status: MStatus; daysLeft: number; paidPaise: number; renewals: number; since: number;
}
export interface Payment { id: string; kind: string; amountPaise: number; method: string; reference: string; planName: string; periodStart: string; periodEnd: string; paidOn: string; at: number }
export interface Stats { active: number; expiring: number; expired: number; total: number; revenueMonthPaise: number; revenueLastMonthPaise: number; salesThisMonth: number; renewalsThisMonth: number; month: string }
export interface AuditRow { id: number; at: number; actorId: string | null; actorRole: string | null; action: string; entityId: string | null; detail: Record<string, any> | null }

export const METHODS: [string, string][] = [['cash', 'Cash'], ['upi', 'UPI'], ['bank_transfer', 'Bank transfer'], ['card', 'Card'], ['other', 'Other']];
export const methodLabel = (m: string) => METHODS.find(([k]) => k === m)?.[1] ?? m;
export const needsRef = (m: string) => m === 'upi' || m === 'bank_transfer';

const TONE: Record<MStatus, [Tone, string]> = { active: ['good', 'Active'], expiring: ['warn', 'Expiring'], expired: ['bad', 'Expired'] };
export const StatusChip = ({ s }: { s: MStatus }) => <Chip tone={TONE[s][0]}>{TONE[s][1]}</Chip>;

/** Server message plus the per-field problems, so "Some fields are not valid" says which. */
export function errText(e: unknown): string {
  if (e instanceof ApiError) {
    const f = (e.details as { fields?: { field: string; message: string }[] } | undefined)?.fields;
    return f?.length ? f.map((x) => `${x.field}: ${x.message}`).join('. ') : e.message;
  }
  return e instanceof Error ? e.message : 'Something went wrong.';
}

export function leftText(m: Pick<Member, 'daysLeft' | 'status'>): string {
  if (m.status === 'expired') return m.daysLeft === -1 ? 'Ended yesterday' : `Ended ${-m.daysLeft} days ago`;
  if (m.daysLeft === 0) return 'Ends today';
  return m.daysLeft === 1 ? 'Ends tomorrow' : `${m.daysLeft} days left`;
}
