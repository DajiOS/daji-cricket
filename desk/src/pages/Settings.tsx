import { PageHead } from '../ui';
import { sectionOf } from '../parts/admin/common';
import Prices from '../parts/admin/Prices';
import Booking from '../parts/admin/Booking';
import Payments from '../parts/admin/Payments';
import Website from '../parts/admin/Website';
import Festivals from '../parts/admin/Festivals';
import { Connections } from '../parts/admin/Platform';
import GoLive from '../parts/admin/GoLive';
import AiName from '../parts/admin/AiName';
import SharedSheet from '../parts/admin/SharedSheet';
import WaitlistSettings from '../parts/admin/Waitlist';
import CheckInSettings from '../parts/admin/CheckIn';
import ServerSettings from '../parts/admin/Server';
import BrandSettings, { type Brand } from '../parts/admin/Brand';
import { useSession } from '../App';
import { can, useApi } from '../lib';

// The ground's own settings. People, Services and Backups are the software owner's, so they live on the Platform page only; their old
// addresses here open them there (routes.ts, MERGED). Connections stays here for everyone (Settings, Connections: CLAUDE.md).
const TABS: [string, string][] = [['business', 'Your business'], ['prices', 'Prices and timings'], ['booking', 'Booking window'], ['waitlist', 'Waitlist'], ['checkin', 'Check-in'], ['payments', 'Payments'], ['website', 'Website'], ['festivals', 'Festivals'], ['ai', 'Platform AI'], ['connections', 'Connections'], ['golive', 'Go-live check']];
/** Server status, the Lightsail SSH button and the AI coding console: the main website's owner (and the software owner), never staff
 *  and never another business, since the one server runs every business. */
const SERVER_TAB: [string, string] = ['server', 'Server'];

// The main website's settings (booking window, payments, website look, festivals, the assistant's name, connections, go-live) run
// the main site, so another customer business sees only its own business, prices and Connections (the server refuses the rest:
// requireMainBusiness). Its Connections shows only its own shared spreadsheet, never the server's services.
const OWN = ['business', 'prices', 'connections'];

export default function Settings({ sub }: { sub: string }) {
  const { me, ownerId } = useSession();
  const [brand] = useApi<Brand>('/api/desk/brand', [ownerId]);
  const main = me.role === 'super_admin' || !brand || brand.mainSettings;
  const tabs = !main ? TABS.filter(([k]) => OWN.includes(k)) : me.role === 'owner' || me.role === 'super_admin' ? [...TABS, SERVER_TAB] : TABS;
  // Admin, Settings opens on a list of every setting, rather than on prices (which already has its own menu item)
  if (!sub.split('/')[0]) return <Hub tabs={tabs} />;
  const tab = sectionOf(sub, tabs.map(([k]) => k));
  return (
    <div className="stack">
      <PageHead eyebrow="Settings" title={tabs.find(([k]) => k === tab)?.[1] ?? 'Settings'} />
      {tab === 'business' && <BrandSettings />}
      {tab === 'prices' && <Prices />}
      {tab === 'booking' && <Booking />}
      {tab === 'waitlist' && <WaitlistSettings />}
      {tab === 'checkin' && <CheckInSettings />}
      {tab === 'payments' && <Payments />}
      {tab === 'website' && <Website />}
      {tab === 'festivals' && <Festivals />}
      {tab === 'ai' && <AiName />}
      {tab === 'connections' && <ConnectionsTab main={me.role === 'super_admin' || !!brand?.mainSettings} />}
      {tab === 'golive' && <GoLive />}
      {tab === 'server' && <ServerSettings />}
    </div>
  );
}

/** The business's own shared spreadsheet first (it needs a business picked), then the platform's services (the main business only). */
function ConnectionsTab({ main }: { main: boolean }) {
  const { me, ownerId } = useSession();
  return <div className="stack">{can(me, 'manage_bookings') && (me.role !== 'super_admin' || ownerId) && <SharedSheet />}{main && <Connections />}</div>;
}

const ABOUT: Record<string, string> = {
  business: 'Your business name, your app name, your ground logo and your app logo.',
  prices: 'What each ball and practice session costs, by day and time, and the days the ground is closed.',
  booking: 'When customers can book online, and days switched off for booking.',
  waitlist: 'The weekly waitlist (Sunday leather ball): when a free session is offered, and priority for regular players.',
  checkin: 'Players checking in at the ground on their phone: how close they must be, when it opens, and each ground\'s check-in point.',
  payments: 'Razorpay online payments, UPI AutoPay and who customers contact about money.',
  website: 'The website design pack and how it looks.',
  festivals: 'Festival looks and offers that switch on by themselves on the day.',
  ai: 'The name everyone sees the assistant called, voice shortcuts, and the reserved names no one may use.',
  connections: 'The shared spreadsheet for this business and, for the main business, the services the server is connected to.',
  golive: 'Everything to tick off before the ground opens for real bookings.',
  server: 'Is the server healthy, the Connect using SSH button for Amazon Lightsail, and the AI coding console.',
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
