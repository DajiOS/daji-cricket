import { useEffect, useState } from 'react';
import { useSession } from '../App';
import { Icon } from '../ui';
import { api, useApi, inr, inrShort, fmtDay, fmtTime, todayISO, can, type Me } from '../lib';
import type { TodayData } from '../parts/dash/Today';
import { askAssistant } from '../CommandSearch';
import { NAV, navVisible } from '../registry';

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
  const version = 0;
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

  const [ex] = useApi<{ items: string[] }>('/api/staff/ask/examples');
  const [appr] = useApi<{ count: number }>(can(me, 'manage_accounting') ? '/api/accounting/approvals/count' : null, [ownerId]);
  const [ask, setAsk] = useState('');
  const hour = Number(new Date(Date.now() + 19800000).toISOString().slice(11, 13));
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const first = me.name.split(' ')[0];
  const toCollect = (today?.bookings || []).reduce((a, b) => a + (b.status === 'confirmed' ? Math.max(0, b.balancePaise || 0) : 0), 0);
  const monthName = MONTHS[Number(month.slice(5)) - 1]!;
  const booked = util?.utilization.reduce((a, g) => a + g.bookedSlots, 0) || 0, avail = util?.utilization.reduce((a, g) => a + g.availableSlots, 0) || 0;
  const waiting = (appr?.count ?? 0) + (today?.awaitingVerification ?? 0) + (today?.needsReview ?? 0);
  const t = Date.now();
  const rows = (today?.bookings ?? []).filter((b) => b.status !== 'cancelled' && b.status !== 'expired').sort((a, b) => a.startAt - b.startAt);

  type Ev = { time: string; title: string; detail: string; dot: string; href?: string };
  const events: Ev[] = [];
  if (today) {
    if (today.awaitingVerification) events.push({ time: 'Now', title: `${today.awaitingVerification} UPI payment${today.awaitingVerification === 1 ? '' : 's'} to check`, detail: 'Match them with the bank, then confirm the booking', dot: '#B86E12', href: '#/bookings/payments' });
    if (today.needsReview) events.push({ time: 'Now', title: `${today.needsReview} booking${today.needsReview === 1 ? '' : 's'} to approve`, detail: 'Waiting for your decision', dot: '#B86E12', href: '#/bookings/approvals' });
    for (const b of rows) events.push({ time: fmtTime(b.startAt), title: `${b.customerName} · ${b.groundName}`, detail: `${fmtTime(b.startAt)} – ${fmtTime(b.endAt)}${b.status === 'held' ? ' · held, not paid' : b.status === 'confirmed' && b.balancePaise > 0 ? ` · ${inr(b.balancePaise)} to collect` : ''}`, dot: b.endAt <= t ? '#9AA39F' : b.startAt <= t ? '#1E6E4A' : '#2F6FB0', href: `#/bookings/${b.id}` });
  }

  const tiles: { label: string; value: string; note: string; bg: string; href: string }[] = [];
  if (canBookings) tiles.push({ label: 'Sessions today', value: today ? String(rows.length) : '…', note: today ? `${rows.filter((b) => b.startAt > t).length} still to play` : ' ', bg: 'var(--t-blue)', href: '#/bookings/day' });
  if (canReports) tiles.push({ label: `Open hours used · ${monthName.slice(0, 3)}`, value: avail ? `${Math.round((booked / avail) * 100)}%` : '…', note: avail ? `${booked} of ${avail} hours booked` : ' ', bg: 'var(--t-teal)', href: '#/compare/grounds' });
  if (canMoney) tiles.push({ label: 'Booked ahead', value: ahead ? inrShort(ahead.totalPaise) : '…', note: ahead ? `${ahead.bookings} upcoming sessions` : ' ', bg: 'var(--t-violet)', href: '#/accounting/reports' });
  if (canBookings || canMoney) tiles.push({ label: 'Approvals', value: String(waiting), note: waiting ? 'waiting on you' : 'nothing waiting', bg: 'var(--t-amber)', href: can(me, 'manage_accounting') ? '#/approvals' : '#/bookings/approvals' });
  if (canMoney) tiles.push({ label: 'To collect today', value: today ? inr(toCollect) : '…', note: "balances on today's sessions", bg: 'var(--t-green)', href: '#/bookings/payments' });

  const points = (trend ?? []).map((x, i) => ({ d: x.period, v: x.collected, i }));
  const bigValue = canMoney ? (pnl ? inrShort(pnl.revenue.totalPaise) : trend?.length ? inrShort(trend[trend.length - 1]!.collected) : '—') : String(rows.length);

  return (
    <div className="dhome">
      <section className="dhero">
        <span className="eyebrow">{fmtDay(todayISO())} · {me.role === 'super_admin' ? 'Software owner' : me.businessName || 'Daji Cricket Ground'}</span>
        <h1>{greet}, {first}. What would you like to know?</h1>
        <form className="dask" onSubmit={(e) => { e.preventDefault(); if (ask.trim().length >= 3) { askAssistant(ask.trim()); setAsk(''); } }}>
          <label><span className="sr">Ask the assistant</span>
            <input type="text" value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="e.g. Which ground had the most sessions last week?" /></label>
          <button type="submit" aria-label="Ask"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg></button>
        </form>
        {!!ex?.items.length && <div className="dprompts">{ex.items.slice(0, 4).map((q) => <button key={q} type="button" onClick={() => askAssistant(q)}>{q}</button>)}</div>}
      </section>
      <div className="drow">
        {canBookings && <section className="dcard dtoday" aria-label="Today">
          <div className="dtoday-hd"><h2>Today</h2><span className="muted">{me.businessName || 'Daji Cricket Ground'}</span></div>
          <ol>
            {events.map((e, i) => (
              <li key={i}>
                <span className="dtl-time">{e.time}</span>
                <span className="dtl-dot"><i /><b style={{ borderColor: e.dot }} /><i /></span>
                <a className="dtl-body" href={e.href}><b>{e.title}</b><span>{e.detail}</span></a>
              </li>))}
            {!today && <li className="muted small" style={{ display: 'block', padding: '12px 0' }}>Loading today…</li>}
            {today && !events.length && <li className="muted small" style={{ display: 'block', padding: '12px 0' }}>Nothing on today.</li>}
          </ol>
          <a className="dbtn" href="#/calendar">See the full day</a>
        </section>}
        <div className="dtiles">
          <a className="dcard dspan2" href={canMoney ? '#/accounting/reports' : '#/bookings/day'}>
            <span className="eyebrow">{canMoney ? `Money received · ${monthName}` : 'Sessions today'}</span>
            <span className="dbig">{bigValue}</span>
            {canMoney && points.length > 1 ? <Trend points={points} /> : <div className="dtrend-empty">{canMoney ? 'The trend draws once there are a few months of bookings.' : 'Sessions on the ground today.'}</div>}
          </a>
          {tiles.map((x) => (
            <a key={x.label} className="dcard dtile" href={x.href} style={{ background: x.bg, borderColor: x.bg }}>
              <span className="eyebrow">{x.label}</span>
              <span className="dval">{x.value}</span>
              <span className="muted">{x.note}</span>
            </a>))}
        </div>
      </div>
      <AllTools me={me} />
    </div>
  );
}

const TINT: Record<string, string> = { ground: 'var(--t-green)', people: 'var(--t-blue)', money: 'var(--t-violet)', settings: 'var(--t-amber)' };
const TITLE: Record<string, string> = { ground: 'Ground', people: 'People', money: 'Finance', settings: 'Settings' };

/** "All tools": a round icon tile for every page this login can open, grouped by department. */
function AllTools({ me }: { me: Me }) {
  const groups = Object.keys(TINT).map((k) => {
    const seen = new Set<string>();
    const apps = NAV.filter((g) => g.section === k).flatMap((g) => g.items).filter((i) => navVisible(me, i) && !seen.has(i.to) && seen.add(i.to));
    return { key: k, apps };
  }).filter((g) => g.apps.length);
  return (
    <section className="dtools" aria-label="All tools">
      <div className="dtools-hd"><h2>All tools</h2><span className="muted">Everything on the desk, one click away</span></div>
      <div className="dtools-grid">
        {groups.map((g) => (
          <div key={g.key} className="dtools-grp">
            <h3 className="eyebrow">{TITLE[g.key]}</h3>
            <div className="dapps">
              {g.apps.map((i) => <a key={i.to} href={`#${i.to}`} className="dapp-btn"><span style={{ background: TINT[g.key] }}><Icon name={i.icon} size={26} /></span>{i.label}</a>)}
            </div>
          </div>))}
      </div>
    </section>
  );
}

/** Money received month by month as a soft area line in the theme's accent. */
function Trend({ points }: { points: { d: string; v: number }[] }) {
  const W = 600, H = 150, max = Math.max(...points.map((p) => p.v)) * 1.1 || 1;
  const xy = points.map((p, i) => [(i / (points.length - 1)) * W, H - (p.v / max) * (H - 10)] as const);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <svg className="dtrend" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Money received over the last ${points.length} months`}>
      <path d={`${line} L${W},${H} L0,${H} Z`} fill="var(--gold)" opacity=".16" />
      <path d={line} fill="none" stroke="var(--gold)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
