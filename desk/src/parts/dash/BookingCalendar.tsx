// Calendar views for bookings: an hourly timeline for one day and a month grid, plus the Calendar / List switch both pages share.
import { useState, type CSSProperties } from 'react';
import { Loading, ErrorBox, Empty } from '../../ui';
import { useApi, fmtDay, todayISO, addDaysISO, qs } from '../../lib';
import { type Booking, type Page, STATUS_LABEL, timeRange, whatOf } from './common';

const IST = 19800000;
export type View = 'calendar' | 'list';
/** The Calendar / List choice is remembered in this browser and shared by every bookings page. */
export function useView(): [View, (v: View) => void] {
  const [v, setV] = useState<View>(() => { try { return localStorage.getItem('daji.bkView') === 'list' ? 'list' : 'calendar'; } catch { return 'calendar'; } });
  return [v, (n) => { setV(n); try { localStorage.setItem('daji.bkView', n); } catch { /* ignore */ } }];
}
export function ViewToggle({ value, onChange }: { value: View; onChange: (v: View) => void }) {
  return (
    <div className="seg" role="group" aria-label="View">
      <button className={value === 'calendar' ? 'on' : ''} onClick={() => onChange('calendar')} aria-pressed={value === 'calendar'}>Calendar</button>
      <button className={value === 'list' ? 'on' : ''} onClick={() => onChange('list')} aria-pressed={value === 'list'}>List</button>
    </div>);
}

const PALETTE = ['#14573e', '#c9a96b', '#3f7fb5', '#c2553f', '#7a5ca8', '#5a9a4a', '#c15c88', '#2c8f9a'];
/** Each ground keeps its own colour everywhere, so the sessions on a day can be told apart and counted at a glance. */
export const groundColor = (name: string) => { let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]!; };
const cv = (b: Booking) => ({ ['--c' as string]: groundColor(b.groundName) }) as CSSProperties;
export function Legend({ names }: { names: string[] }) {
  return names.length ? <div className="cal-legend">{names.map((n) => <span key={n}><i style={{ background: groundColor(n) }} />{n}</span>)}<span className="muted small">Dashed outline = waiting for approval</span></div> : null;
}

const minOfDay = (ms: number) => Math.round((((ms + IST) % 86400000) + 86400000) % 86400000 / 60000);
const live = (b: Booking) => b.status !== 'cancelled' && b.status !== 'expired';
const tone = (b: Booking) => (b.status === 'confirmed' && b.approval === 'pending' ? 'pending' : b.status);

/** One day as columns per ground, with the sessions placed on an hourly scale. */
export function DayTimeline({ bookings, onOpen }: { bookings: Booking[]; onOpen: (id: string) => void }) {
  const grounds = [...new Set(bookings.map((b) => b.groundName))];
  let from = 6, to = 24;
  for (const b of bookings) { from = Math.min(from, Math.floor(minOfDay(b.startAt) / 60)); const e = minOfDay(b.endAt); to = Math.max(to, e <= minOfDay(b.startAt) ? 24 : Math.ceil(e / 60)); }
  const PX = 56, hours = Array.from({ length: to - from }, (_, i) => from + i);
  const label = (h: number) => `${((h + 11) % 12) + 1} ${h % 24 < 12 ? 'am' : 'pm'}`;
  return (
    <><Legend names={grounds} />
    <div className="card cal-day">
      <div className="cal-day-head" style={{ gridTemplateColumns: `64px repeat(${grounds.length}, minmax(180px, 1fr))` }}>
        <span />{grounds.map((g) => <b key={g}>{g}</b>)}
      </div>
      <div className="cal-day-body" style={{ gridTemplateColumns: `64px repeat(${grounds.length}, minmax(180px, 1fr))`, height: hours.length * PX }}>
        <div className="cal-hours">{hours.map((h) => <span key={h} style={{ height: PX }}>{label(h)}</span>)}</div>
        {grounds.map((g) => (
          <div className="cal-col" key={g} style={{ backgroundSize: `100% ${PX}px` }}>
            {bookings.filter((b) => b.groundName === g).map((b) => {
              const s = minOfDay(b.startAt); let e = minOfDay(b.endAt); if (e <= s) e = 1440;
              const top = ((s - from * 60) / 60) * PX, h = Math.max(30, ((e - s) / 60) * PX - 3);
              return (
                <button key={b.id} className={`cal-ev s-${tone(b)}`} style={{ top, height: h, ...cv(b) }} onClick={() => onOpen(b.id)} title={`${b.customerName}, ${timeRange(b)}`}>
                  <b>{b.customerName}</b><span>{timeRange(b)}</span>{h > 58 && <span>{whatOf(b)}</span>}
                </button>);
            })}
          </div>))}
      </div>
    </div></>);
}

/** A month grid. Pressing a day lists that day's sessions underneath. */
export function MonthCalendar({ filters, onOpen }: { filters: Record<string, string>; onOpen: (id: string) => void }) {
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [sel, setSel] = useState<string | null>(null);
  const first = `${month}-01`;
  const dow = (new Date(first + 'T00:00:00Z').getUTCDay() + 6) % 7; // Monday first
  const start = addDaysISO(first, -dow);
  const days = Array.from({ length: 42 }, (_, i) => addDaysISO(start, i));
  const lastShown = days[41]!;
  const [d, err] = useApi<Page<Booking>>(`/api/staff/bookings${qs({ ...filters, from: start, to: lastShown, limit: 200 })}`, [month, JSON.stringify(filters)]);
  const items = (d?.items || []).filter((b) => (filters.status ? true : live(b))).sort((a, b) => a.startAt - b.startAt);
  const by = (iso: string) => items.filter((b) => b.date === iso);
  const shift = (n: number) => { const [y, m] = month.split('-').map(Number); const t = new Date(Date.UTC(y!, m! - 1 + n, 1)); setMonth(t.toISOString().slice(0, 7)); setSel(null); };
  const title = new Date(first + 'T00:00:00Z').toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const today = todayISO();
  return (
    <div className="stack">
      <div className="row">
        <button className="btn sm" onClick={() => shift(-1)} aria-label="Previous month">←</button>
        <b className="gold" style={{ minWidth: 150, textAlign: 'center' }}>{title}</b>
        <button className="btn sm" onClick={() => shift(1)} aria-label="Next month">→</button>
        {month !== today.slice(0, 7) && <button className="btn ghost sm" onClick={() => { setMonth(today.slice(0, 7)); setSel(null); }}>Today</button>}
        {d && <span className="muted small">{items.filter((b) => b.date.startsWith(month)).length} sessions this month</span>}
      </div>
      <Legend names={[...new Set(items.map((b) => b.groundName))].sort()} />
      {err ? <ErrorBox msg={err} /> : (
        <div className="card cal-month">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((n) => <div className="cal-dow" key={n}>{n}</div>)}
          {days.map((iso) => {
            const list = by(iso), out = !iso.startsWith(month);
            return (
              <button key={iso} className={`cal-cell${out ? ' out' : ''}${iso === today ? ' today' : ''}${sel === iso ? ' sel' : ''}`} onClick={() => setSel(sel === iso ? null : iso)} aria-label={`${fmtDay(iso)}, ${list.length} sessions`}>
                <span className="cal-top"><span className="cal-num">{Number(iso.slice(8))}</span>{list.length > 0 && <span className="cal-count">{list.length} {list.length === 1 ? 'session' : 'sessions'}</span>}</span>
                {list.slice(0, 3).map((b) => <span key={b.id} style={cv(b)} className={`cal-chip s-${tone(b)}`}>{new Date(b.startAt + IST).toISOString().slice(11, 16)} {b.customerName.split(' ')[0]}</span>)}
                {list.length > 3 && <span className="cal-more">+{list.length - 3} more</span>}
              </button>);
          })}
          {!d && <div className="cal-loading"><Loading h={40} /></div>}
        </div>)}
      {sel && (
        <div className="card">
          <div className="card-head"><h3>{fmtDay(sel)}</h3><span className="muted small">{by(sel).length} {by(sel).length === 1 ? 'session' : 'sessions'}</span></div>
          {by(sel).length === 0 ? <Empty>No sessions on this day.</Empty> : (
            <div className="day-list">
              {by(sel).map((b) => (
                <button key={b.id} className="day-row" style={cv(b)} onClick={() => onOpen(b.id)}>
                  <span className="day-time tabular"><i className="cal-dot" />{timeRange(b)}</span>
                  <span className="day-who"><b>{b.customerName}</b><span className="small muted">{b.groundName} · {whatOf(b)}</span></span>
                  <span className={`cal-chip s-${tone(b)}`}>{b.status === 'confirmed' && b.approval === 'pending' ? 'Pending approval' : STATUS_LABEL[b.status]}</span>
                </button>))}
            </div>)}
        </div>)}
    </div>);
}
