import { PageHead } from '../ui';
import { SectionTabs, sectionOf } from '../parts/admin/common';
import { Leads, Connections, Services } from '../parts/admin/Platform';
import People from '../parts/admin/People';
import Payments from '../parts/admin/Payments';
import Backups from '../parts/admin/Backups';
import { RefundApprovals } from '../parts/admin/Refunds';
import { YodleeSettings } from '../parts/admin/Yodlee';
import { AggregatorSettings } from '../parts/admin/Aggregator';
import { SoftwareCosts } from '../parts/admin/Costs';

const TABS: [string, string][] = [['requests', 'Owner requests'], ['people', 'People'], ['settings', 'Platform settings'], ['connections', 'Connections'], ['bank', 'Bank connection'], ['services', 'Services'], ['refunds', 'Refunds'], ['costs', 'Software costs']];

export default function Platform({ sub }: { sub: string }) {
  const tab = sectionOf(sub, TABS.map(([k]) => k));
  return (
    <div className="stack">
      <PageHead eyebrow="Software owner" title="Platform" lede="Settings and people for the whole platform. Choose an owner at the top to work inside their desk." />
      <SectionTabs base="/platform" sub={sub} items={TABS} />
      {tab === 'requests' && <Leads />}
      {tab === 'people' && <People />}
      {tab === 'settings' && <div className="stack"><Payments /><Backups /></div>}
      {tab === 'connections' && <Connections />}
      {tab === 'bank' && <div className="stack"><YodleeSettings /><AggregatorSettings /></div>}
      {tab === 'services' && <Services />}
      {tab === 'refunds' && <RefundApprovals />}
      {tab === 'costs' && <SoftwareCosts />}
    </div>
  );
}
