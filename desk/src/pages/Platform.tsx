import { PageHead } from '../ui';
import { SectionTabs, sectionOf } from '../parts/admin/common';
import { Leads, Services } from '../parts/admin/Platform';
import People from '../parts/admin/People';
import Payments from '../parts/admin/Payments';
import Backups from '../parts/admin/Backups';
import { RefundApprovals } from '../parts/admin/Refunds';
import { YodleeSettings } from '../parts/admin/Yodlee';
import { AggregatorSettings } from '../parts/admin/Aggregator';
import { SoftwareCosts } from '../parts/admin/Costs';

// The software owner's page: People, Services and Backups (in Platform settings) live only here. Connections is in Settings, Connections,
// and /platform/connections opens it there (routes.ts, MERGED).
const TABS: [string, string][] = [['requests', 'Owner requests'], ['people', 'People'], ['settings', 'Platform settings and backups'], ['bank', 'Bank connection'], ['services', 'Services'], ['refunds', 'Refunds'], ['costs', 'Software costs']];

export default function Platform({ sub }: { sub: string }) {
  const tab = sectionOf(sub, TABS.map(([k]) => k));
  return (
    <div className="stack">
      <PageHead eyebrow="Software owner" title="Platform" lede="Settings and people for the whole platform. Choose an owner at the top to work inside their desk." />
      <SectionTabs base="/platform" sub={sub} items={TABS} />
      {tab === 'requests' && <Leads />}
      {tab === 'people' && <People />}
      {tab === 'settings' && <div className="stack"><Payments /><Backups /></div>}
      {tab === 'bank' && <div className="stack"><YodleeSettings /><AggregatorSettings /></div>}
      {tab === 'services' && <Services />}
      {tab === 'refunds' && <RefundApprovals />}
      {tab === 'costs' && <SoftwareCosts />}
    </div>
  );
}
