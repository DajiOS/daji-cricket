import { many } from '../db.ts';
import { now } from '../clock.ts';
import { istDate, monthRange } from '../time.ts';
import { listAccounts, lockedMonths, type AcctAccountOut } from './store.ts';
import { balanceSheet, financialYear, profitAndLoss, previousRange, type BalanceSheet } from './statements.ts';

// The headline numbers at the top of the Reports tab (and what Ask AI answers "how are we doing?" from).

const rowPaise = (b: BalanceSheet, code: string): number => {
  for (const side of [b.assets, b.liabilities, b.equity]) for (const g of side.groups) for (const r of g.rows) if (r.code === code) return r.paise;
  return 0;
};

export interface Overview {
  asOf: string;
  thisMonth: { month: string; from: string; to: string; revenuePaise: number; expensesPaise: number; netProfitPaise: number };
  lastMonth: { month: string; from: string; to: string; revenuePaise: number; expensesPaise: number; netProfitPaise: number };
  financialYearToDate: { from: string; to: string; revenuePaise: number; expensesPaise: number; netProfitPaise: number };
  cashAndBankPaise: number;
  accounts: AcctAccountOut[];
  advancesHeldPaise: number;
  accountCreditOwedPaise: number;
  customersOweYouPaise: number;
  gstPayablePaise: number;
  uncategorised: { count: number; amountPaise: number };
  balanced: boolean;
  lockedMonths: string[];
  /** Nothing in the books yet: no bank account added and no booking income. Drives the "get started" card. */
  empty: boolean;
}

export function accountingOverview(ownerId: string): Overview {
  const asOf = istDate(now());
  const month = asOf.slice(0, 7);
  const cur = monthRange(month)!;
  const prev = previousRange(cur);
  const fy = financialYear(asOf);
  const pl = (r: { from: string; to: string }) => { const p = profitAndLoss(ownerId, r); return { revenuePaise: p.revenue.totalPaise, expensesPaise: p.expenses.totalPaise, netProfitPaise: p.netProfitPaise }; };
  const bs = balanceSheet(ownerId, asOf);
  const cash = bs.assets.groups.find((g) => g.name === 'Cash and bank')?.totalPaise ?? 0;
  const accounts = listAccounts(ownerId);
  const fyp = pl({ from: fy.from, to: asOf });
  const ever = many<{ n: number }>("SELECT COUNT(*) n FROM bookings WHERE owner_id = ? AND status IN ('confirmed','completed','no_show')", ownerId)[0]!.n;
  return {
    asOf,
    thisMonth: { month, ...cur, ...pl(cur) },
    lastMonth: { month: prev.from.slice(0, 7), ...prev, ...pl(prev) },
    financialYearToDate: { from: fy.from, to: asOf, ...fyp },
    cashAndBankPaise: cash,
    accounts,
    advancesHeldPaise: rowPaise(bs, 'customer_advances'),
    accountCreditOwedPaise: rowPaise(bs, 'customer_credits'),
    customersOweYouPaise: rowPaise(bs, 'receivables'),
    gstPayablePaise: rowPaise(bs, 'gst_payable'),
    uncategorised: { count: bs.attention.uncategorisedCount, amountPaise: bs.attention.uncategorisedPaise },
    balanced: bs.balanced,
    lockedMonths: lockedMonths(ownerId),
    empty: accounts.length === 0 && ever === 0,
  };
}
