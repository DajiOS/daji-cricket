import { PageHead } from '../ui';
import { useSession } from '../App';
import { SectionTabs, sectionOf } from '../parts/admin/common';
import Prices from '../parts/admin/Prices';
import Booking from '../parts/admin/Booking';
import Payments from '../parts/admin/Payments';
import Website from '../parts/admin/Website';
import Backups from '../parts/admin/Backups';
import People from '../parts/admin/People';
import { Connections, Services } from '../parts/admin/Platform';
import GoLive from '../parts/admin/GoLive';

const TABS: [string, string][] = [['prices', 'Prices and timings'], ['booking', 'Booking window'], ['payments', 'Payments'], ['website', 'Website'], ['backups', 'Backups'], ['people', 'People'], ['connections', 'Connections'], ['services', 'Services'], ['golive', 'Go-live check']];

/** These tabs call software-owner-only endpoints, so the ground owner is not shown them (they would only say "no access"). */
const SOFTWARE_OWNER_ONLY = ['backups', 'people', 'connections', 'services'];

export default function Settings({ sub }: { sub: string }) {
  const { me } = useSession();
  const tabs = TABS.filter(([k]) => me.role === 'super_admin' || !SOFTWARE_OWNER_ONLY.includes(k));
  const tab = sectionOf(sub, tabs.map(([k]) => k));
  return (
    <div className="stack">
      <PageHead eyebrow="Administration" title="Settings" lede="Prices, opening dates, payments, the website and the accounts behind the ground." />
      <SectionTabs base="/settings" sub={sub} items={tabs} />
      {tab === 'prices' && <Prices />}
      {tab === 'booking' && <Booking />}
      {tab === 'payments' && <Payments />}
      {tab === 'website' && <Website />}
      {tab === 'backups' && <Backups />}
      {tab === 'people' && <People />}
      {tab === 'connections' && <Connections />}
      {tab === 'services' && <Services />}
      {tab === 'golive' && <GoLive />}
    </div>
  );
}
