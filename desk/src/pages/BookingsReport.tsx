// Reports, Bookings: the last six months of bookings side by side (played, no-shows, cancellations, customers) and how full each ground was.
import { useState } from 'react';
import { useSession } from '../App';
import { PageHead, Loading, ErrorBox, Table, Stat } from '../ui';
import { useApi, inr, monthLabel, can } from '../lib';

interface Count { count: number; totalPaise: number; paidPaise: number }
interface Overview {
  bookings: { byStatus: Record<string, Count>; cancellations: { kind: string; count: number; refundPaise: number; creditPaise: number }[] };
  utilization: { groundId: string; groundName: string; availableSlots: number; bookedSlots: number; utilization: number }[];
  customers: { active: number; new: number };
}
const n = (o: Overview, s: string) => o.bookings.byStatus[s]?.count ?? 0;
const value = (o: Overview) => ['confirmed', 'completed', 'no_show'].reduce((t, s) => t + (o.bookings.byStatus[s]?.totalPaise ?? 0), 0);

export default function BookingsReport() {
  const { me, ownerId } = useSession();
  const [d, err] = useApi<{ items: { period: string; overview: Overview }[] }>('/api/staff/reports/overview-series?months=6', [ownerId]);
  const months = d?.items ?? [];
  const [pick, setPick] = useState<string | null>(null);
  const sel = months.find((m) => m.period === pick) ?? months[months.length - 1];
  return (
    <div className="stack">
      <PageHead eyebrow="Reports" title="Bookings" lede="Bookings month by month: sessions on the books, no-shows, cancellations and customers, and how full each ground was. A booking counts in the month it is played." />
      <ErrorBox msg={err} />
      {!d ? (!err && <Loading h={320} />) : (<>
        {sel && <div className="grid g4">
          <Stat label={`Sessions · ${monthLabel(sel.period)}`} value={n(sel.overview, 'confirmed') + n(sel.overview, 'completed')} foot={`Worth ${inr(value(sel.overview))}`} />
          <Stat label="No-shows" value={n(sel.overview, 'no_show')} />
          <Stat label="Cancelled" value={n(sel.overview, 'cancelled')} foot={`${n(sel.overview, 'expired')} holds not paid in time`} />
          <Stat label="Customers" value={sel.overview.customers.active} foot={`${sel.overview.customers.new} new this month`} />
        </div>}
        <div className="card">
          <div className="card-head"><h3>Month by month</h3><span className="muted small">Press a month to see its grounds</span></div>
          <Table rows={[...months].reverse()} rowKey={(m) => m.period} onRow={(m) => setPick(m.period)} cols={[
            { head: 'Month', cell: (m) => <span className={m.period === sel?.period ? 'strong' : ''}>{monthLabel(m.period)}</span> },
            { head: 'Sessions', num: true, cell: (m) => n(m.overview, 'confirmed') + n(m.overview, 'completed') },
            { head: 'Still to pay', num: true, cell: (m) => n(m.overview, 'held') },
            { head: 'No-shows', num: true, cell: (m) => n(m.overview, 'no_show') },
            { head: 'Cancelled', num: true, cell: (m) => n(m.overview, 'cancelled') },
            { head: 'Customers', num: true, cell: (m) => m.overview.customers.active },
            { head: 'New', num: true, cell: (m) => m.overview.customers.new },
            { head: 'Worth', num: true, cell: (m) => inr(value(m.overview)) },
          ]} />
        </div>
        {sel && <div className="card">
          <div className="card-head"><h3>How full each ground was · {monthLabel(sel.period)}</h3></div>
          <Table rows={sel.overview.utilization} rowKey={(g) => g.groundId} empty="No grounds yet." cols={[
            { head: 'Ground', cell: (g) => <span className="strong">{g.groundName}</span> },
            { head: 'Slots booked', num: true, cell: (g) => g.bookedSlots },
            { head: 'Slots open', num: true, cell: (g) => g.availableSlots },
            { head: 'Full', num: true, cell: (g) => `${g.utilization}%` },
          ]} />
        </div>}
        {can(me, 'manage_accounting') && <p className="small muted">Each session one by one: <a href="#/accounting/reports/past">Sessions played</a> and <a href="#/accounting/reports/future">Upcoming bookings</a>.</p>}
      </>)}
    </div>
  );
}
