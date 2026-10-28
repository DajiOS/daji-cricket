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
import { useSession } from '../App';
import { can } from '../lib';

// The ground's own settings. People, Services and Backups are the software owner's, so they live on the Platform page only; their old
// addresses here open them there (routes.ts, MERGED). Connections stays here for everyone (Settings, Connections: CLAUDE.md).
const TABS: [string, string][] = [['prices', 'Prices and timings'], ['booking', 'Booking window'], ['payments', 'Payments'], ['website', 'Website'], ['festivals', 'Festivals'], ['ai', 'Platform AI'], ['connections', 'Connections'], ['golive', 'Go-live check']];

export default function Settings({ sub }: { sub: string }) {
  // Admin, Settings opens on a list of every setting, rather than on prices (which already has its own menu item)
  if (!sub.split('/')[0]) return <Hub tabs={TABS} />;
  const tab = sectionOf(sub, TABS.map(([k]) => k));
  return (
    <div className="stack">
      <PageHead eyebrow="Settings" title={TABS.find(([k]) => k === tab)?.[1] ?? 'Settings'} />
      {tab === 'prices' && <Prices />}
      {tab === 'booking' && <Booking />}
      {tab === 'payments' && <Payments />}
      {tab === 'website' && <Website />}
      {tab === 'festivals' && <Festivals />}
      {tab === 'ai' && <AiName />}
      {tab === 'connections' && <ConnectionsTab />}
      {tab === 'golive' && <GoLive />}
    </div>
  );
}

/** The business's own shared spreadsheet first (it needs a business picked), then the platform's services. */
function ConnectionsTab() {
  const { me, ownerId } = useSession();
  return <div className="stack">{can(me, 'manage_bookings') && (me.role !== 'super_admin' || ownerId) && <SharedSheet />}<Connections /></div>;
}

const ABOUT: Record<string, string> = {
  prices: 'What each ball and practice session costs, by day and time, and the days the ground is closed.',
  booking: 'When customers can book online, and days switched off for booking.',
  payments: 'Razorpay online payments, UPI AutoPay and who customers contact about money.',
  website: 'The website design pack and how it looks.',
  festivals: 'Festival looks and offers that switch on by themselves on the day.',
  ai: 'The name everyone sees the assistant called, voice shortcuts, and the reserved names no one may use.',
  connections: 'The shared spreadsheet for this business, the services the server is connected to, and what each one still needs.',
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
