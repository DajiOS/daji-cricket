// Statutory payroll rules for India (Gujarat): PF, ESI, Gujarat Professional Tax and TDS on salary.
// All money is integer paise. Rates are kept here, in one place, with the date they were last checked, so that a change
// in the law is a one-file change (and is recorded in the compliance register's law-change log).
// These are calculators, not tax advice: the owner's CA should confirm the figures before filing.

export const STATUTORY_RULES_CHECKED = '2026-10-01';

const RUPEE = 100;
const ceilRupee = (paise: number): number => Math.ceil(paise / RUPEE - 1e-9) * RUPEE;
const roundRupee = (paise: number): number => Math.round(paise / RUPEE) * RUPEE;

export const PF = {
  wageCeilingPaise: 15_000 * RUPEE,
  employeeRate: 0.12,
  employerRate: 0.12,      // 3.67% EPF + 8.33% EPS
  edliRate: 0.005,         // employer only, outside the pay slip
  adminRate: 0.005,        // employer only, outside the pay slip
};
export const ESI = {
  coverageCeilingPaise: 21_000 * RUPEE, // covered while monthly wages are at or below this
  exemptDailyWagePaise: 176 * RUPEE,    // employee share is waived at or below this average daily wage
  employeeRate: 0.0075,
  employerRate: 0.0325,
};
/** Gujarat Professional Tax: nil up to 12,000 a month, 200 a month above. */
export const GUJARAT_PT = { freeUpToPaise: 12_000 * RUPEE, monthlyPaise: 200 * RUPEE };

export interface StatInput {
  payType: 'monthly' | 'daily' | string;
  ratePaise: number;
  grossPaise: number;      // earned this month before bonus
  bonusPaise: number;
  paidDays: number;
  contractMonthlyPaise?: number; // the agreed monthly wage; ESI cover is judged on this, so one big month does not flip it
  pf: boolean; esi: boolean; pt: boolean; tds: boolean;
  tdsFixedPaise: number;   // owner-set monthly TDS; 0 = work it out
}
export interface StatOutput {
  pfEmployeePaise: number; pfEmployerPaise: number; pfAdminPaise: number;
  esiEmployeePaise: number; esiEmployerPaise: number;
  ptPaise: number; tdsPaise: number;
}
export const NO_STAT: StatOutput = { pfEmployeePaise: 0, pfEmployerPaise: 0, pfAdminPaise: 0, esiEmployeePaise: 0, esiEmployerPaise: 0, ptPaise: 0, tdsPaise: 0 };

/** Annual income tax under the new regime (post-2025 slabs), standard deduction 75,000, rebate to 12 lakh, 4% cess. Input and output in paise. */
export function annualTaxNewRegime(annualTaxablePaise: number): number {
  const income = Math.max(0, annualTaxablePaise - 75_000 * RUPEE) / RUPEE; // rupees
  const slabs: Array<[number, number]> = [[400_000, 0], [800_000, 0.05], [1_200_000, 0.10], [1_600_000, 0.15], [2_000_000, 0.20], [2_400_000, 0.25], [Infinity, 0.30]];
  let tax = 0, prev = 0;
  for (const [top, rate] of slabs) { if (income > prev) tax += (Math.min(income, top) - prev) * rate; prev = top; }
  if (income <= 1_200_000) tax = 0;                                  // section 87A rebate
  else tax = Math.min(tax, income - 1_200_000);                       // marginal relief just above 12 lakh
  return Math.round(tax * 1.04 * RUPEE);                              // paise, with cess
}

export function statutory(i: StatInput): StatOutput {
  const out = { ...NO_STAT };
  const wages = i.grossPaise + i.bonusPaise;
  if (wages <= 0 || i.paidDays <= 0) return out;
  if (i.pf) {
    const base = Math.min(i.grossPaise, PF.wageCeilingPaise);
    out.pfEmployeePaise = roundRupee(base * PF.employeeRate);
    out.pfEmployerPaise = roundRupee(base * PF.employerRate);
    out.pfAdminPaise = roundRupee(base * (PF.edliRate + PF.adminRate));
  }
  const covered = (i.contractMonthlyPaise ?? wages) <= ESI.coverageCeilingPaise;
  if (i.esi && covered) {
    const daily = i.grossPaise / Math.max(1, i.paidDays); // the exemption looks at the day's wage, not a one-off bonus
    out.esiEmployeePaise = daily <= ESI.exemptDailyWagePaise ? 0 : ceilRupee(wages * ESI.employeeRate);
    out.esiEmployerPaise = ceilRupee(wages * ESI.employerRate);
  }
  if (i.pt && wages > GUJARAT_PT.freeUpToPaise) out.ptPaise = GUJARAT_PT.monthlyPaise;
  if (i.tds) {
    if (i.tdsFixedPaise > 0) out.tdsPaise = i.tdsFixedPaise;
    else {
      // project this month's earnings across the year; bonus is one-off so it is left out of the projection
      const monthlyBase = i.payType === 'monthly' ? i.ratePaise : i.grossPaise;
      out.tdsPaise = roundRupee(annualTaxNewRegime(monthlyBase * 12) / 12);
    }
  }
  return out;
}
