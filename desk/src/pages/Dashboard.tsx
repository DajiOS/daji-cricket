import { useEffect, useState } from 'react';
import { useSession } from '../App';
import { PageHead, Stat, Loading, ErrorBox, Empty, Icon } from '../ui';
import { CollectionChart, Ring } from '../charts';
import { api, useApi, inr, inrShort, fmtDay, todayISO, can, go } from '../lib';
import { Schedule, Attention, type TodayData } from '../parts/dash/Today';

interface Overview {
  range: { from: string; to: string };
  bookings: { byStatus: Record<string, { count: number; totalPaise: number; paidPaise: number }> };
  utilization: { groundId: string; groundName: string; availableSlots: number; bookedSlots: number; utilization: number }[];
  payments: { outstandingBalances: { bookings: number; amountPaise: number } };
}
interface Ahead { items: { period: string; bookings: number; totalPaise: number; paidPaise: number; balancePaise: number }[]; totalPaise: number; paidPaise: number; balancePaise: number; bookings: number }
interface Pnl { revenue: { totalPaise: number }; netProfitPaise: number; uncategorised: { count: number } }
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SOLD = ['confirmed', 'completed', 'no_show']; // sessions that count as booked


export default function Dashboard({ sub }: { sub: string }) {
  void sub;
  const { me, ownerId } = useSession();
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);
  const canBookings = can(me, 'manage_bookings'), canSeeReports = can(me, 'view_reports') || can(me, 'manage_accounting');
  // money (revenue, profit, billed and collected, balances to collect) shows only to the owner and to team members the owner has given "Can see revenue"
  const canMoney = canSeeReports && can(me, 'view_revenue');
  const canReports = canMoney;
  const month = todayISO().slice(0, 7);

  const [today, todayErr] = useApi<TodayData>(canBookings ? '/api/staff/today' : null, [version, ownerId]);
  const [pnl, pnlErr] = useApi<Pnl>(canMoney ? `/api/accounting/reports/pnl?month=${month}` : null, [ownerId]);

  const [ahead] = useApi<Ahead>(canMoney ? '/api/staff/reports/upcoming?months=6' : null, [version, ownerId]);

  // six months of sessions booked against money received
  const [trend, setTrend] = useState<{ period: string; billed: number; collected: number }[] | null>(null);
  const [util, setUtil] = useState<Overview | null>(null);
  const [trendErr, setTrendErr] = useState<string | null>(null);
  useEffect(() => {
    if (!canReports) return;
    let live = true; setTrend(null); setTrendErr(null);
    api<{ items: { period: string; overview: Overview }[] }>('/api/staff/reports/overview-series?months=6')
      .then((res) => {
        if (!live) return;
        const rows = res.items.map((x) => ({ p: x.period, o: x.overview }));
        setTrend(rows.map(({ p, o }) => ({ period: p, billed: SOLD.reduce((a, k) => a + (o.bookings.byStatus[k]?.totalPaise || 0), 0), collected: SOLD.reduce((a, k) => a + (o.bookings.byStatus[k]?.paidPaise || 0), 0) })));
        setUtil(rows[rows.length - 1]!.o);
      }).catch((e) => live && setTrendErr(e.message));
    return () => { live = false; };
  }, [canReports, ownerId, version]);

  const hour = Number(new Date(Date.now() + 19800000).toISOString().slice(11, 13));
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const toCollect = (today?.bookings || []).reduce((a, b) => a + (b.status === 'confirmed' ? Math.max(0, b.balancePaise || 0) : 0), 0);
  const monthName = MONTHS[Number(month.slice(5)) - 1]!.slice(0, 3);
  const booked = util?.utilization.reduce((a, g) => a + g.bookedSlots, 0) || 0, avail = util?.utilization.reduce((a, g) => a + g.availableSlots, 0) || 0;
  const thisMonth = trend?.[trend.length - 1];

  return (
    <div className="stack">
      <PageHead eyebrow={me.role === 'super_admin' ? 'Software owner' : me.businessName || 'Daji Cricket Ground'} title={`${greet}, ${me.name.split(' ')[0]}`}
        lede={`Here is the ground as of ${fmtDay(todayISO())}.`}>
        {canBookings && <button className="btn primary" onClick={() => go('/bookings/add')}><Icon name="plus" />Add booking</button>}
      </PageHead>

      {(canBookings || canMoney) && <div className="grid g4" style={canMoney ? { gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" } : undefined}>
        {canBookings && <Stat label="Sessions today" value={today ? today.bookings.length : '…'} foot={today ? (today.bookings.length ? `${today.bookings.filter((b) => b.startAt > Date.now()).length} still to play` : 'A quiet day') : ' '} />}
        {canMoney && <Stat label={`Revenue · ${monthName}`} value={pnl ? inrShort(pnl.revenue.totalPaise) : canReports && !pnlErr ? '…' : thisMonth ? inrShort(thisMonth.collected) : '—'}
          foot={pnl ? 'from sessions played this month' : pnlErr ? 'Sessions played, from payments received' : canReports ? ' ' : 'Your role does not include reports'} />}
        {canMoney && <Stat label={`Net profit · ${monthName}`} value={pnl ? <span style={pnl.netProfitPaise < 0 ? { color: 'var(--bad)' } : undefined}>{inrShort(pnl.netProfitPaise)}</span> : canReports && !pnlErr ? '…' : '—'}
          foot={pnl ? (pnl.uncategorised.count ? `${pnl.uncategorised.count} bank transactions still need a category` : 'after expenses') : pnlErr ? 'Accounting is not available here' : ' '} />}
        {canMoney && <Stat label="Booked ahead" value={ahead ? inrShort(ahead.totalPaise) : '…'} foot={ahead ? `${ahead.bookings} upcoming sessions · ${inrShort(ahead.balancePaise)} still to collect` : ' '} />}
        {canMoney && <Stat label="To collect today" value={today ? <span style={toCollect ? { color: 'var(--warn)' } : undefined}>{inr(toCollect)}</span> : '…'} foot="balances on today's sessions" />}
      </div>}

      {canReports && <div className={canMoney ? 'grid g-2-1' : 'grid'}>
        {canMoney && <div className="card">
          <div className="card-head"><h3>Sessions billed vs collected</h3><span className="muted small">Last 6 months</span></div>
          <div className="card-pad">
            {!canReports ? <Empty>The reports are not available to your role.</Empty> : trendErr ? <ErrorBox msg={trendErr} /> : !trend ? <Loading h={240} /> : <CollectionChart data={trend} />}
          </div>
        </div>}
        <div className="card">
          <div className="card-head"><h3>Ground utilisation</h3><span className="muted small">{MONTHS[Number(month.slice(5)) - 1]}</span></div>
          <div className="card-pad">
            {!canReports ? <Empty>The reports are not available to your role.</Empty> : !util ? <Loading h={200} /> : (
              <>
                <div className="row" style={{ gap: 20, alignItems: 'center', flexWrap: 'nowrap' }}>
                  <Ring value={booked} total={avail} label="Booked" />
                  <div className="stack" style={{ flex: 1, minWidth: 120, gap: 10 }}>
                    {util.utilization.map((g) => (
                      <div key={g.groundId}>
                        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}><span className="small">{g.groundName}</span><b className="tabular small">{Math.round(g.utilization)}%</b></div>
                        <div className="meter" style={{ marginTop: 5 }}><span style={{ width: `${Math.min(100, g.utilization)}%` }} /></div>
                      </div>))}
                  </div>
                </div>
                <div className="divider" />
                <div className="small muted">{booked} of {avail} hours booked this month</div>
                {canMoney && util.payments.outstandingBalances.bookings > 0 && <div className="small muted" style={{ marginTop: 6 }}>Balances still to collect: <b className="gold tabular">{inr(util.payments.outstandingBalances.amountPaise)}</b> on {util.payments.outstandingBalances.bookings} bookings</div>}
              </>)}
          </div>
        </div>
      </div>}

      {canMoney && ahead && ahead.items.length > 0 && <div className="card">
        <div className="card-head"><h3>Revenue already booked</h3><span className="muted small">Confirmed sessions from today, by month</span></div>
        <div className="card-pad"><CollectionChart data={ahead.items.map((x) => ({ period: x.period, billed: x.totalPaise, collected: x.paidPaise }))} /></div>
      </div>}

      {canBookings && <div className="grid g-2-1 dash-lists">
        <div className="card">
          <div className="card-head"><h3>Today's schedule</h3><a className="small" href="#/bookings/day">Day view →</a></div>
          {canBookings ? <Schedule data={today} err={todayErr} onChanged={bump} /> : <Empty>Your role does not include bookings.</Empty>}
        </div>
        <div className="card">
          <div className="card-head"><h3>Needs your attention</h3><a className="small" href="#/bookings/approvals">Approvals →</a></div>
          <Attention today={today} canBookings={canBookings} canVerify={can(me, 'verify_payments')} onChanged={bump} version={version} />
        </div>
      </div>}

      <div className="grid g3">
        {([['/academy', 'MP13 Academy', 'Students, attendance, progress cards and fees.', 'manage_academy'], ['/memberships', 'Memberships', 'Plans, members and renewals.', 'manage_bookings'], ['/bills', 'Bills and payroll', 'Bills to approve, staff attendance and salaries.', 'manage_accounting'], ['/matches', 'Matches', 'Fixtures, scores and teams.', 'manage_matches'], ['/contacts', 'Contacts', 'Customers and enquiries.', 'view_customers'], ['/tasks', 'Tasks', 'What needs doing.', 'manage_tasks']] as const)
          .filter(([, , , perm]) => can(me, perm)).map(([to, title, text]) => (
            <a key={to} href={`#${to}`} className="card card-pad biz-card"><div className="eyebrow">Open</div><h2>{title}</h2><div className="muted small" style={{ marginTop: 6 }}>{text}</div></a>))}
      </div>
    </div>
  );
}
