import { PageHead, Tabs } from '../ui';
import { go } from '../lib';
import { Overview } from '../parts/books/Overview';
import { Reports } from '../parts/books/Reports';
import { Reconcile, Recurring, Journals, Setup } from '../parts/books/Ledgers';
import { CashFlow, Budget, Gst, Assets } from '../parts/books/Planning';

// the same order as the menu on the left (Overview, Reconcile, Books, GST, Budget), then the tabs the menu does not list.
// Month-end lives on its own page (/close) and the books review is the top of Reconcile: the old addresses open them (routes.ts, MERGED).
const TABS: [string, string][] = [
  ['overview', 'Overview'], ['reconcile', 'Reconcile'], ['journals', 'Journals'], ['gst', 'GST'], ['budget', 'Budget'],
  ['reports', 'Reports'], ['recurring', 'Recurring'], ['cashflow', 'Cash flow'], ['assets', 'Fixed assets'], ['setup', 'Setup'],
];

/** sub: the tab, and for reports the report id (reports/pnl). */
export default function Accounting({ sub }: { sub: string }) {
  const [tab, arg] = sub.split('/');
  const t = TABS.some(([k]) => k === tab) ? tab! : 'overview';
  return (
    <div className="stack">
      <PageHead eyebrow="Finance" title="Accounting" lede="Your books: profit and loss, bank, customers who owe you, GST and budgets." />
      <div className="bk-tabs no-print"><Tabs value={t} onChange={(k) => go('/accounting/' + k)} items={TABS} label="Accounting sections" /></div>
      {t === 'overview' && <Overview />}
      {t === 'reports' && <Reports id={arg} />}
      {t === 'reconcile' && <Reconcile />}
      {t === 'recurring' && <Recurring />}
      {t === 'journals' && <Journals />}
      {t === 'cashflow' && <CashFlow />}
      {t === 'budget' && <Budget />}
      {t === 'gst' && <Gst />}
      {t === 'assets' && <Assets />}
      {t === 'setup' && <Setup />}
    </div>
  );
}
