import { PageHead } from '../ui';
import { SectionTabs, sectionOf } from '../parts/admin/common';
import Prices from '../parts/admin/Prices';
import Booking from '../parts/admin/Booking';
import Payments from '../parts/admin/Payments';
import Website from '../parts/admin/Website';
import Backups from '../parts/admin/Backups';
import People from '../parts/admin/People';
import { Connections, Services } from '../parts/admin/Platform';

const TABS: [string, string][] = [['prices', 'Prices and timings'], ['booking', 'Booking window'], ['payments', 'Payments'], ['website', 'Website'], ['backups', 'Backups'], ['people', 'People'], ['connections', 'Connections'], ['services', 'Services']];

export default function Settings({ sub }: { sub: string }) {
  const tab = sectionOf(sub, TABS.map(([k]) => k));
  return (
    <div className="stack">
      <PageHead eyebrow="Administration" title="Settings" lede="Prices, opening dates, payments, the website and the accounts behind the ground." />
      <SectionTabs base="/settings" sub={sub} items={TABS} />
      {tab === 'prices' && <Prices />}
      {tab === 'booking' && <Booking />}
      {tab === 'payments' && <Payments />}
      {tab === 'website' && <Website />}
      {tab === 'backups' && <Backups />}
      {tab === 'people' && <People />}
      {tab === 'connections' && <Connections />}
      {tab === 'services' && <Services />}
    </div>
  );
}
