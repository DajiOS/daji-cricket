import { PageHead } from '../ui';
import { useSession } from '../App';
import { sectionOf } from '../parts/admin/common';
import Prices from '../parts/admin/Prices';
import Booking from '../parts/admin/Booking';
import Payments from '../parts/admin/Payments';
import Website from '../parts/admin/Website';
import Festivals from '../parts/admin/Festivals';
import Backups from '../parts/admin/Backups';
import People from '../parts/admin/People';
import { Connections, Services } from '../parts/admin/Platform';
import GoLive from '../parts/admin/GoLive';
import AiName from '../parts/admin/AiName';

const TABS: [string, string][] = [['prices', 'Prices and timings'], ['booking', 'Booking window'], ['payments', 'Payments'], ['website', 'Website'], ['festivals', 'Festivals'], ['backups', 'Backups'], ['people', 'People'], ['ai', 'Platform AI'], ['connections', 'Connections'], ['services', 'Services'], ['golive', 'Go-live check']];

/** These tabs call software-owner-only endpoints, so the ground owner is not shown them (they would only say "no access"). */
const SOFTWARE_OWNER_ONLY = ['backups', 'people', 'services'];

export default function Settings({ sub }: { sub: string }) {
  const { me } = useSession();
  const tabs = TABS.filter(([k]) => me.role === 'super_admin' || !SOFTWARE_OWNER_ONLY.includes(k));
  // Admin, Settings opens on a list of every setting, rather than on prices (which already has its own menu item)
  if (!sub.split('/')[0]) return <Hub tabs={tabs} />;
  const tab = sectionOf(sub, tabs.map(([k]) => k));
  return (
    <div className="stack">
      <PageHead eyebrow="Settings" title={tabs.find(([k]) => k === tab)?.[1] ?? 'Settings'} />
      {tab === 'prices' && <Prices />}
      {tab === 'booking' && <Booking />}
      {tab === 'payments' && <Payments />}
      {tab === 'website' && <Website />}
      {tab === 'festivals' && <Festivals />}
      {tab === 'backups' && <Backups />}
      {tab === 'people' && <People />}
      {tab === 'ai' && <AiName />}
      {tab === 'connections' && <Connections />}
      {tab === 'services' && <Services />}
      {tab === 'golive' && <GoLive />}
    </div>
  );
}

const ABOUT: Record<string, string> = {
  prices: 'What each ball and practice session costs, by day and time, and the days the ground is closed.',
  booking: 'When customers can book online, and days switched off for booking.',
  payments: 'Razorpay online payments, UPI AutoPay and who customers contact about money.',
  website: 'The website design pack and how it looks.',
  festivals: 'Festival looks and offers that switch on by themselves on the day.',
  backups: 'Copies of the data and restoring one.',
  people: 'Every login on the platform.',
  ai: 'The name everyone sees the assistant called, voice shortcuts, and the reserved names no one may use.',
  connections: 'The services the server is connected to, and what each one still needs.',
  services: 'Outside services the platform pays for.',
  golive: 'Everything to tick off before the ground opens for real bookings.',
};

function Hub({ tabs }: { tabs: [string, string][] }) {
  return (
    <div className="stack">
      <PageHead eyebrow="Admin" title="Settings" lede="Every setting for the ground in one place. Pick one to open it." />
      <div className="grid g2">
        {tabs.map(([k, label]) => (
          <a key={k} className="card card-pad" href={`#/settings/${k}`} style={{ textDecoration: 'none', color: 'inherit' }}>
            <h3 style={{ margin: '0 0 4px' }}>{label}</h3>
            <div className="small muted">{ABOUT[k]}</div>
          </a>))}
      </div>
    </div>
  );
}
