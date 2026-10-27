import { useEffect, useState, type ReactNode } from 'react';
import { useSession } from '../App';
import { Icon } from '../ui';
import { api, useApi, inr, fmtDay, fmtTime, fmtDateTime, todayISO, can } from '../lib';
import type { TodayData } from '../parts/dash/Today';
import type { Booking, Page } from '../parts/dash/common';
import { METHOD_LABEL, PAY_STATUS, whatOf } from '../parts/dash/common';
import { BookingDetail } from '../parts/dash/Detail';
import { title as activityTitle } from '../parts/dash/activity';
import { askAssistant } from '../CommandSearch';

// The Dashboard: today at a glance. Stat cards, today's bookings, quick actions, what each ground and net is doing now,
// recent payments, Ask AI and what needs someone. Every figure comes from the same endpoints as the pages it links to,
// and each card shows only to people whose permissions allow the page behind it.

interface Ground { id: string; name: string; active: boolean }
interface Pay { id: string; bookingId: string; method: string; status: string; amountPaise: number; createdAt: number }
interface Feed { id: number; at: number; action: string; who: string; href: string | null }
type Tab = 'all' | 'upcoming' | 'ongoing' | 'completed' | 'cancelled';

const phase = (b: Booking, t: number): Exclude<Tab, 'all'> =>
  b.status === 'cancelled' || b.status === 'expired' ? 'cancelled' : b.status === 'completed' || b.status === 'no_show' || b.endAt <= t ? 'completed' : b.startAt <= t ? 'ongoing' : 'upcoming';
/** "7:00 PM – 10:00 PM" */
const span = (b: { startAt: number; endAt: number }) => `${fmtTime(b.startAt)} – ${fmtTime(b.endAt)}`.toUpperCase();
const ago = (ms: number) => {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} hour${Math.round(m / 60) === 1 ? '' : 's'} ago` : fmtDateTime(ms);
};

function Clock() {
  const [t, setT] = useState(Date.now());
  useEffect(() => { const i = window.setInterval(() => setT(Date.now()), 30_000); return () => clearInterval(i); }, []);
  const d = fmtDay(todayISO());
  return <div className="xclock" aria-label="Today"><span>{d}</span><span>{fmtTime(t).toUpperCase()}</span></div>;
}

function StatCard({ icon, tone, label, value, foot, href, alert }: { icon: string; tone: string; label: string; value: ReactNode; foot: ReactNode; href?: string; alert?: boolean }) {
  const body = (<>
    <span className="xtile" style={{ background: `var(--c-${tone})` }}><Icon name={icon} size={28} /></span>
    <span className="xstat-txt"><span>{label}</span><b className={alert ? 'alert' : undefined}>{value}</b><small>{foot}</small></span>
  </>);
  return href ? <a className="xstat" href={href}>{body}</a> : <div className="xstat">{body}</div>;
}

export default function Dashboard({ sub }: { sub: string }) {
  void sub;
  const { me, ownerId } = useSession();
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);
  const canBookings = can(me, 'manage_bookings');
  const canMoney = (can(me, 'view_reports') || can(me, 'manage_accounting')) && can(me, 'view_revenue');
  const canPay = can(me, 'verify_payments') || can(me, 'record_payments') || can(me, 'view_reports');
  const canPeople = can(me, 'view_customers');
  const day = todayISO();

  const [today] = useApi<TodayData>(canBookings ? '/api/staff/today' : null, [version, ownerId]);
  const [cancelled] = useApi<Page<Booking>>(canBookings ? `/api/staff/bookings?from=${day}&to=${day}&status=cancelled&limit=50` : null, [version, ownerId]);
  const [pending] = useApi<Page<Booking>>(canBookings ? '/api/staff/bookings?approval=pending&limit=1' : null, [version, ownerId]);
  const [grounds] = useApi<{ items: Ground[] }>(canBookings ? '/api/staff/grounds' : null, [ownerId]);
  const [people] = useApi<{ total: number }>(canPeople && ownerId ? '/api/staff/customers?limit=1' : null, [ownerId]);
  const [appr] = useApi<{ count: number }>(can(me, 'manage_accounting') ? '/api/accounting/approvals/count' : null, [ownerId]);
  const [pays] = useApi<Page<Pay>>(canPay ? '/api/staff/payments?limit=5' : null, [version, ownerId]);
  const [feed] = useApi<{ items: Feed[] }>(ownerId ? '/api/desk/activity?limit=6' : null, [version, ownerId]);
  const [ex] = useApi<{ items: string[] }>('/api/staff/ask/examples');
  const [packs] = useApi<{ reminder: string | null }>(me.role === 'owner' || me.role === 'super_admin' ? '/api/admin/design-packs' : null);

  // who each recent payment belongs to (a payment only carries its booking)
  const [names, setNames] = useState<Record<string, { name: string; ref: string }>>({});
  useEffect(() => {
    const ids = [...new Set((pays?.items ?? []).map((p) => p.bookingId))].filter((id) => !names[id]);
    if (!ids.length) return;
    let live = true;
    Promise.all(ids.map((id) => api<{ booking: Booking } | Booking>(`/api/staff/bookings/${id}`).then((r) => [id, 'booking' in r ? r.booking : r] as const).catch(() => null)))
      .then((rows) => { if (live) setNames((n) => ({ ...n, ...Object.fromEntries(rows.filter((r): r is readonly [string, Booking] => !!r).map(([id, b]) => [id, { name: b.customerName, ref: b.ref }])) })); });
    return () => { live = false; };
  }, [pays]);

  const [tab, setTab] = useState<Tab>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [ask, setAsk] = useState('');
  const t = Date.now();
  const all = [...(today?.bookings ?? []), ...(cancelled?.items ?? [])].sort((a, b) => a.startAt - b.startAt);
  const count = (k: Tab) => (k === 'all' ? all.length : all.filter((b) => phase(b, t) === k).length);
  const rows = tab === 'all' ? all : all.filter((b) => phase(b, t) === tab);
  const live = all.filter((b) => phase(b, t) !== 'cancelled');
  const upcoming = live.filter((b) => phase(b, t) === 'upcoming').length;
  const sold = live.filter((b) => b.status === 'confirmed' || b.status === 'completed' || b.status === 'no_show');
  const value = sold.reduce((a, b) => a + b.totalPaise, 0), collected = sold.reduce((a, b) => a + b.paidPaise, 0);
  const waitingBookings = pending?.total ?? 0;
  const waiting = waitingBookings + (appr?.count ?? 0);
  const active = (grounds?.items ?? []).filter((g) => g.active);
  const busyNow = new Set(live.filter((b) => phase(b, t) === 'ongoing').map((b) => b.groundId));

  // each ground and net right now: in use, its next booking today, played out for the day, or free
  const status = active.map((g) => {
    const mine = live.filter((b) => b.groundId === g.id);
    const now = mine.find((b) => phase(b, t) === 'ongoing');
    const next = mine.find((b) => phase(b, t) === 'upcoming');
    const last = mine.filter((b) => phase(b, t) === 'completed').pop();
    return now ? { g, cls: 'live', word: 'In use', when: span(now) }
      : next ? { g, cls: 'next', word: 'Upcoming', when: span(next) }
      : last ? { g, cls: 'done', word: 'Completed', when: span(last) }
      : { g, cls: 'free', word: 'Available', when: 'All day' };
  });

  type Alert = { tone: string; mark: string; title: string; detail: string; when: string; href: string };
  const alerts: Alert[] = [];
  if (waitingBookings) alerts.push({ tone: '#E5484D', mark: '!', title: `${waitingBookings} booking${waitingBookings === 1 ? '' : 's'} need${waitingBookings === 1 ? 's' : ''} approval`, detail: 'Paid online, waiting for your decision', when: 'Now', href: '#/bookings/approvals' });
  if (today?.awaitingVerification) alerts.push({ tone: '#F28C18', mark: '!', title: 'Payment verification pending', detail: `${today.awaitingVerification} UPI payment${today.awaitingVerification === 1 ? '' : 's'} to match with the bank`, when: 'Now', href: '#/bookings/payments' });
  if (today?.needsReview) alerts.push({ tone: '#F28C18', mark: '!', title: `${today.needsReview} booking${today.needsReview === 1 ? '' : 's'} to review`, detail: 'Late payment, extended hold or amount mismatch', when: 'Now', href: '#/bookings/review' });
  if (appr?.count) alerts.push({ tone: '#E5484D', mark: '!', title: `${appr.count} approval${appr.count === 1 ? '' : 's'} waiting`, detail: 'Bills, pay runs, refunds, discounts or expenses', when: 'Now', href: '#/approvals' });
  if (packs?.reminder) alerts.push({ tone: '#2F7FE6', mark: 'i', title: 'Website design pack', detail: packs.reminder, when: 'Soon', href: '#/settings/website' });
  for (const f of feed?.items ?? []) {
    if (alerts.length >= 5) break;
    alerts.push({ tone: '#66716B', mark: '·', title: activityTitle(f.action), detail: f.who, when: ago(f.at), href: f.href ? `#${f.href}` : '#/activity' });
  }

  type Quick = { icon: string; label: string; href?: string; run?: () => void };
  const quick: Quick[] = [];
  if (canBookings) quick.push({ icon: 'calendar', label: 'New booking', href: '#/bookings/new' }, { icon: 'users', label: 'Walk-in booking', href: '#/bookings/new' }, { icon: 'clock', label: 'Block time', href: '#/bookings/block' }, { icon: 'ball', label: 'Manage grounds', href: '#/grounds' });
  if (can(me, 'verify_payments') || can(me, 'record_payments')) quick.push({ icon: 'payments', label: 'Verify payment', href: '#/bookings/payments' });
  if (can(me, 'send_broadcasts')) quick.push({ icon: 'chat', label: 'Send message', href: '#/reminders' });
  if (canMoney) quick.push({ icon: 'accounts', label: 'View reports', href: '#/accounting/reports' });
  quick.push({ icon: 'ai', label: 'Ask AI', run: () => askAssistant() });
  if (me.role !== 'staff') quick.push({ icon: 'settings', label: 'Settings', href: '#/settings' });

  const tabs: [Tab, string][] = [['all', 'All'], ['upcoming', 'Upcoming'], ['ongoing', 'Ongoing'], ['completed', 'Completed'], ['cancelled', 'Cancelled']];
  const STATUS: Record<Exclude<Tab, 'all'>, [string, string]> = { upcoming: ['next', 'Upcoming'], ongoing: ['live', 'Ongoing'], completed: ['done', 'Completed'], cancelled: ['free', 'Cancelled'] };
  const statusOf = (b: Booking): [string, string] => {
    if (b.status === 'held') return ['wait', 'Held, not paid'];
    if (b.status === 'no_show') return ['bad', 'No-show'];
    if (b.status === 'confirmed' && b.approval === 'pending') return ['wait', 'Pending approval'];
    return STATUS[phase(b, t)];
  };
  const business = me.role === 'super_admin' ? 'Daji Cricket Ground' : me.businessName || 'Daji Cricket Ground';

  return (
    <div className="xdash">
      <div className="xhead">
        <div><h1>{business} – Admin</h1><p>Manage bookings, operations and your ground with ease.</p></div>
        <Clock />
      </div>

      <div className="xstats">
        {canBookings && <StatCard icon="calendar" tone="blue" label="Today's bookings" value={today ? live.length : '…'} foot={today ? `${upcoming} upcoming` : ' '} href="#/bookings/day" />}
        {canMoney && canBookings && <StatCard icon="payroll" tone="green" label="Today's revenue" value={today ? inr(value) : '…'} foot={today ? `${inr(collected)} collected so far` : ' '} href="#/accounting/reports" />}
        {canPeople && <StatCard icon="users" tone="violet" label="Customers" value={people ? people.total : '…'} foot="on your customer list" href="#/contacts" />}
        {(canBookings || can(me, 'manage_accounting')) && <StatCard icon="clock" tone="orange" label="Pending approvals" value={waiting} foot={waiting ? 'require action' : 'nothing waiting'} alert={waiting > 0} href={waitingBookings || !can(me, 'manage_accounting') ? '#/bookings/approvals' : '#/approvals'} />}
        {canBookings && <StatCard icon="ball" tone="green" label="Grounds in use" value={grounds ? `${busyNow.size} / ${active.length}` : '…'} foot="right now" href="#/grounds" />}
      </div>

      <div className="xgrid">
        <div className="xcol">
          {canBookings && (
            <section className="xpanel" aria-label="Today's bookings">
              <div className="xpanel-hd"><h2>Today's bookings <small>{fmtDay(day)}</small></h2><a href="#/bookings/day">View all bookings →</a></div>
              <div className="xtabs" role="tablist">{tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l} ({count(k)})</button>)}</div>
              {!today ? <p className="xempty">Loading today…</p> : !rows.length ? <p className="xempty">{tab === 'all' ? 'No bookings today yet.' : `Nothing ${tab} today.`}</p> : (
                <div className="tbl-wrap"><table className="xtbl">
                  <thead><tr><th>Time</th><th>Customer</th><th>Ground / Net</th><th>Type</th>{canMoney && <th className="r">Amount</th>}<th>Status</th><th>Actions</th></tr></thead>
                  <tbody>{rows.map((b) => {
                    const [cls, word] = statusOf(b);
                    const ph = phase(b, t);
                    return (
                      <tr key={b.id}>
                        <td>{span(b)}</td>
                        <td>{b.customerName}</td>
                        <td>{b.groundName}</td>
                        <td>{b.formatLabel ? whatOf(b) : b.source === 'walk_in' ? 'Walk-in' : 'Booking'}</td>
                        {canMoney && <td className="r">{inr(b.totalPaise)}</td>}
                        <td><span className={`xdot ${cls}`}>{word}</span></td>
                        <td><button type="button" className="xact" onClick={() => setOpen(b.id)}>{ph === 'ongoing' || ph === 'upcoming' ? 'Manage' : 'View'}</button></td>
                      </tr>);
                  })}</tbody>
                </table></div>)}
            </section>)}

          <div className="xtwo">
            {canPay && (
              <section className="xpanel" aria-label="Recent payments">
                <div className="xpanel-hd"><h2>Recent payments</h2><a href={can(me, 'verify_payments') || can(me, 'record_payments') ? '#/bookings/payments' : '#/money'}>View all →</a></div>
                {!pays ? <p className="xempty">Loading…</p> : !pays.items.length ? <p className="xempty">No payments yet.</p> : (
                  <div className="tbl-wrap"><table className="xtbl">
                    <thead><tr><th>Time</th><th>Customer</th><th className="r">Amount</th><th>Status</th></tr></thead>
                    <tbody>{pays.items.map((p) => {
                      const [tone, word] = PAY_STATUS[p.status] ?? ['mute', p.status];
                      const cls = tone === 'good' ? 'done' : tone === 'bad' ? 'bad' : tone === 'warn' ? 'wait' : 'free';
                      const sameDay = new Date(p.createdAt + 19800000).toISOString().slice(0, 10) === day;
                      return (
                        <tr key={p.id}>
                          <td>{sameDay ? fmtTime(p.createdAt).toUpperCase() : fmtDateTime(p.createdAt).split(', ')[0]}</td>
                          <td><a href={`#/bookings/${p.bookingId}`}>{names[p.bookingId]?.name ?? '…'}</a></td>
                          <td className="r">{inr(p.amountPaise)}<small>{METHOD_LABEL[p.method] ?? p.method}</small></td>
                          <td><span className={`xdot ${cls}`}>{word}</span></td>
                        </tr>);
                    })}</tbody>
                  </table></div>)}
              </section>)}

            <section className="xpanel" aria-label="Ask AI">
              <div className="xpanel-hd"><h2><Icon name="ai" size={20} /> Ask AI</h2></div>
              <div className="xask">Ask about bookings, money owed, approvals or any report, in plain words.</div>
              <form className="xask-form" onSubmit={(e) => { e.preventDefault(); if (ask.trim().length >= 2) { askAssistant(ask.trim()); setAsk(''); } }}>
                <label className="sr" htmlFor="xask-q">Ask AI</label>
                <input id="xask-q" className="inp" value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Type a question…" />
                <button type="submit" aria-label="Ask"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg></button>
              </form>
              {!!ex?.items.length && <div className="xprompts">{ex.items.slice(0, 3).map((q) => <button key={q} type="button" onClick={() => askAssistant(q)}>“{q}”</button>)}</div>}
            </section>
          </div>
        </div>

        <div className="xcol">
          <section className="xpanel" aria-label="Quick actions" style={{ background: 'var(--soft)' }}>
            <div className="xpanel-hd"><h2>Quick actions</h2></div>
            <div className="xquick">
              {quick.map((q) => q.href
                ? <a key={q.label} href={q.href}><Icon name={q.icon} size={26} />{q.label}</a>
                : <button key={q.label} type="button" onClick={q.run}><Icon name={q.icon} size={26} />{q.label}</button>)}
            </div>
          </section>

          {canBookings && (
            <section className="xpanel" aria-label="Ground and net status">
              <div className="xpanel-hd"><h2>Ground &amp; net status</h2><a href="#/grounds">View all →</a></div>
              {!grounds ? <p className="xempty">Loading…</p> : !status.length ? <p className="xempty">No grounds set up yet.</p> : (
                <div className="xground">{status.map((s) => [
                  <div key={s.g.id + 'n'}><b>{s.g.name}</b><span>{s.when}</span></div>, <span key={s.g.id + 's'} className={`xdot ${s.cls}`}>{s.word}</span>,
                ])}</div>)}
            </section>)}

          <section className="xpanel xalerts" aria-label="Notifications and alerts">
            <div className="xpanel-hd"><h2>Notifications &amp; alerts</h2><a href="#/activity">View all →</a></div>
            {!alerts.length ? <p className="xempty">Nothing needs you right now.</p> : alerts.map((a, i) => (
              <a key={i} className="xalert" href={a.href}>
                <i style={{ background: a.tone }}>{a.mark}</i>
                <span><b>{a.title}</b><span>{a.detail}</span></span>
                <time>{a.when}</time>
              </a>))}
          </section>
        </div>
      </div>

      {open && <BookingDetail id={open} onClose={() => setOpen(null)} onChanged={bump} />}
    </div>
  );
}
