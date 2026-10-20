import { thisMonth } from '../../lib';
import { Icon, type Tone } from '../../ui';

export const PAY = '/api/accounting/payroll';

export interface PayStaff { id: string; name: string; role: string; phone: string | null; payType: 'monthly' | 'daily'; ratePaise: number; joinedOn: string; leftOn: string | null; active: boolean; notes: string | null; pf: boolean; esi: boolean; pt: boolean; tds: boolean; tdsFixedPaise: number; uan: string | null; esicNo: string | null; pan: string | null }
export type AttStatus = 'present' | 'half' | 'absent' | 'leave';
export interface Line {
  id: string | null; staffId: string; staffName: string; staffRole: string; payType: string; ratePaise: number; daysInMonth: number;
  present: number; half: number; absent: number; leave: number; unmarked: number; paidDays: number;
  grossPaise: number; bonusPaise: number; advancePaise: number; deductionPaise: number; netPaise: number; shortfallPaise: number;
  paidOn: string | null; paidMethod: string | null; paidRef: string | null; paidAt: number | null;
  pfEmployeePaise: number; pfEmployerPaise: number; pfAdminPaise: number; esiEmployeePaise: number; esiEmployerPaise: number; ptPaise: number; tdsPaise: number;
}
export interface Summary {
  headcount: number; grossPaise: number; bonusPaise: number; advancePaise: number; deductionPaise: number; netPaise: number; paidPaise: number; outstandingPaise: number;
  paidCount: number; unmarkedDays: number; presentDays: number; absentDays: number; leaveDays: number; shortfallPaise: number;
  pfPaise: number; pfEmployerPaise: number; esiPaise: number; esiEmployerPaise: number; ptPaise: number; tdsPaise: number;
}
export interface Run { month: string; status: 'open' | 'waiting' | 'final'; locked: boolean; finalisedAt: number | null; lines: Line[]; summary: Summary }
export interface Adjustment { id: string; staffId: string; staffName: string; kind: 'advance' | 'deduction' | 'bonus'; amountPaise: number; givenOn: string; month: string; note: string | null }

export const STATUS_LABEL: Record<AttStatus, string> = { present: 'Present', half: 'Half day', absent: 'Absent', leave: 'Leave' };
export const STATUS_LETTER: Record<AttStatus, string> = { present: 'P', half: 'H', absent: 'A', leave: 'L' };
export const KIND_LABEL: Record<string, string> = { advance: 'Advance', deduction: 'Deduction', bonus: 'Bonus' };
export const KIND_TONE: Record<string, Tone> = { advance: 'warn', deduction: 'bad', bonus: 'good' };
export const METHOD_LABEL: Record<string, string> = { cash: 'Cash', upi: 'UPI', bank: 'Bank transfer', cheque: 'Cheque', other: 'Other' };

const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (m: string) => { const [y, mo] = m.split('-').map(Number); return `${FULL_MONTHS[mo! - 1]} ${y}`; };
export const shiftMonth = (m: string, n: number) => { const [y, mo] = m.split('-').map(Number); const t = y! * 12 + (mo! - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
export const payLabel = (s: { payType: string; ratePaise: number }, fmt: (p: number) => string) => `${fmt(s.ratePaise)} ${s.payType === 'monthly' ? 'a month' : 'a day'}`;
export const days = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Previous / next month with a month picker. */
export function MonthBar({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const cur = thisMonth();
  return (
    <div className="row pr-monthbar">
      <button className="btn sm ghost" onClick={() => onChange(shiftMonth(month, -1))} aria-label="Previous month"><span style={{ display: 'inline-flex', transform: 'rotate(180deg)', width: 14 }}><Icon name="chevron" /></span></button>
      <input className="inp" type="month" value={month} max={cur} onChange={(e) => e.target.value && onChange(e.target.value)} aria-label="Month" />
      <button className="btn sm ghost" disabled={month >= cur} onClick={() => onChange(shiftMonth(month, 1))} aria-label="Next month"><span style={{ display: 'inline-flex', width: 14 }}><Icon name="chevron" /></span></button>
    </div>
  );
}
