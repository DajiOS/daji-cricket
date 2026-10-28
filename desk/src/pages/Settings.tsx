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
import BrandSettings, { type Brand } from '../parts/admin/Brand';
import { useSession } from '../App';
import { useApi } from '../lib';

// The ground's own settings. People, Services and Backups are the software owner's, so they live on the Platform page only; their old
// addresses here open them there (routes.ts, MERGED). Connections stays here for everyone (Settings, Connections: CLAUDE.md).
const TABS: [string, string][] = [['business', 'Your business'], ['prices', 'Prices and timings'], ['booking', 'Booking window'], ['payments', 'Payments'], ['website', 'Website'], ['festivals', 'Festivals'], ['ai', 'Platform AI'], ['connections', 'Connections'], ['golive', 'Go-live check']];

// The main website's settings (booking window, payments, website look, festivals, the assistant's name, connections, go-live) run
// the main site, so another customer business sees only its own business and prices (the server refuses the rest: requireMainBusiness).
const OWN = ['business', 'prices'];

export default function Settings({ sub }: { sub: string }) {
  const { me, ownerId } = useSession();
  const [brand] = useApi<Brand>('/api/desk/brand', [ownerId]);
  const tabs = me.role !== 'super_admin' && brand && !brand.mainSettings ? TABS.filter(([k]) => OWN.includes(k)) : TABS;
  // Admin, Settings opens on a list of every setting, rather than on prices (which already has its own menu item)
  if (!sub.split('/')[0]) return <Hub tabs={tabs} />;
  const tab = sectionOf(sub, tabs.map(([k]) => k));
  return (
    <div className="stack">
      <PageHead eyebrow="Settings" title={TABS.find(([k]) => k === tab)?.[1] ?? 'Settings'} />
      {tab === 'business' && <BrandSettings />}
      {tab === 'prices' && <Prices />}
      {tab === 'booking' && <Booking />}
      {tab === 'payments' && <Payments />}
      {tab === 'website' && <Website />}
      {tab === 'festivals' && <Festivals />}
      {tab === 'ai' && <AiName />}
      {tab === 'connections' && <Connections />}
      {tab === 'golive' && <GoLive />}
    </div>
  );
}

const ABOUT: Record<string, string> = {
  business: 'Your business name, your app name, your ground logo and your app logo.',
  prices: 'What each ball and practice session costs, by day and time, and the days the ground is closed.',
  booking: 'When customers can book online, and days switched off for booking.',
  payments: 'Razorpay online payments, UPI AutoPay and who customers contact about money.',
  website: 'The website design pack and how it looks.',
  festivals: 'Festival looks and offers that switch on by themselves on the day.',
  ai: 'The name everyone sees the assistant called, voice shortcuts, and the reserved names no one may use.',
  connections: 'The services the server is connected to, and what each one still needs.',
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
