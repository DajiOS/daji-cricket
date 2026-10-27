import { PageHead, Tabs } from '../ui';
import { go } from '../lib';
import { Overview, Review } from '../parts/books/Overview';
import { Reports } from '../parts/books/Reports';
import { Reconcile, Recurring, Journals, MonthEnd, Setup } from '../parts/books/Ledgers';
import { CashFlow, Budget, Gst, Assets } from '../parts/books/Planning';

// the same order as the menu on the left (Overview, Reconcile, Books, GST, Month end, Books review, Budget), then the tabs the menu does not list
const TABS: [string, string][] = [
  ['overview', 'Overview'], ['reconcile', 'Reconcile'], ['journals', 'Journals'], ['gst', 'GST'], ['close', 'Month-end'], ['review', 'Books review'], ['budget', 'Budget'],
  ['reports', 'Reports'], ['recurring', 'Recurring'], ['cashflow', 'Cash flow'], ['assets', 'Fixed assets'], ['setup', 'Setup'],
];

/** sub: the tab, and for reports the report id (reports/pnl). */
export default function Accounting({ sub }: { sub: string }) {
  const [tab, arg] = sub.split('/');
  const t = TABS.some(([k]) => k === tab) ? tab! : 'overview';
  return (
    <div className="stack">
      <PageHead eyebrow="Finance" title="Accounting" lede="Your books: profit and loss, bank, customers who owe you, and month-end sign-off." />
      <div className="bk-tabs no-print"><Tabs value={t} onChange={(k) => go('/accounting/' + k)} items={TABS} label="Accounting sections" /></div>
      {t === 'overview' && <Overview />}
      {t === 'review' && <Review />}
      {t === 'reports' && <Reports id={arg} />}
      {t === 'reconcile' && <Reconcile />}
      {t === 'recurring' && <Recurring />}
      {t === 'journals' && <Journals />}
      {t === 'cashflow' && <CashFlow />}
      {t === 'budget' && <Budget />}
      {t === 'gst' && <Gst />}
      {t === 'assets' && <Assets />}
      {t === 'close' && <MonthEnd />}
      {t === 'setup' && <Setup />}
    </div>
  );
}
