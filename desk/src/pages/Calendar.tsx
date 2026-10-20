import { useMemo, useState } from 'react';
import { useSession } from '../App';
import { PageHead, Loading, ErrorBox, Icon } from '../ui';
import { useApi, go, inr, fmtDay, todayISO, thisMonth } from '../lib';

// The starter kit's operations calendar: every dated thing at the ground in one month, with layers to switch on and off.
type Kind = 'bookings' | 'closed' | 'tournament' | 'match' | 'membership' | 'task' | 'bill' | 'payroll' | 'fees' | 'close' | 'compliance';
interface Item { date: string; kind: Kind; title: string; href: string | null; done?: boolean; amountPaise?: number }
interface Cal { month: string; from: string; to: string; kinds: Kind[]; items: Item[] }

/** Layer name and colour (the kit's tints). */
export const KINDS: Record<Kind, [string, string]> = {
  bookings: ['Bookings', 'green'], closed: ['Closed days', 'red'], tournament: ['Tournaments', 'violet'], match: ['Matches', 'violet'],
  membership: ['Memberships ending', 'teal'], task: ['Jobs due', 'amber'], bill: ['Bills due', 'red'], payroll: ['Payroll', 'blue'],
  fees: ['Academy fees', 'teal'], close: ['Month-end close', 'blue'], compliance: ['Compliance reviews', 'amber'],
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const shift = (m: string, n: number) => { const [y, mo] = m.split('-').map(Number) as [number, number]; const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const HIDDEN_KEY = 'daji.calendarOff';

export default function Calendar({ sub }: { sub: string }) {
  const { ownerId } = useSession();
  const month = /^\d{4}-\d{2}$/.test(sub) ? sub : thisMonth();
  const [data, err] = useApi<Cal>(`/api/desk/calendar?month=${month}`, [ownerId]);
  const [off, setOff] = useState<Kind[]>(() => { try { return JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]'); } catch { return []; } });
  const toggle = (k: Kind) => setOff((o) => { const n = o.includes(k) ? o.filter((x) => x !== k) : [...o, k]; try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(n)); } catch { /* ignore */ } return n; });
  const today = todayISO();
  const [pick, setPick] = useState<string | null>(null);

  const byDay = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of data?.items ?? []) if (!off.includes(i.kind)) m.set(i.date, [...(m.get(i.date) ?? []), i]);
    return m;
  }, [data, off]);

  const cells = useMemo(() => {
    if (!data) return [];
    const first = new Date(data.from + 'T00:00:00Z'), last = Number(data.to.slice(8));
    const lead = (first.getUTCDay() + 6) % 7; // Monday first
    const out: (string | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= last; d++) out.push(`${month}-${String(d).padStart(2, '0')}`);
    while (out.length % 7) out.push(null);
    return out;
  }, [data, month]);

  const [y, mo] = month.split('-').map(Number) as [number, number];
  const day = pick && pick.startsWith(month) ? pick : month === today.slice(0, 7) ? today : null;
  const dayItems = day ? byDay.get(day) ?? [] : [];
  const open = (i: Item) => i.href && go(i.href);

  return (
    <div className="stack">
      <PageHead eyebrow="Every section's dates" title={`${MONTHS[mo - 1]} ${y}`} lede="Bookings, closed days, tournaments, jobs, bills, payroll, fees and reviews in one month. You see the layers your login can open.">
        <button className="btn sm" aria-label="Previous month" onClick={() => go(`/calendar/${shift(month, -1)}`)}>‹</button>
        <button className="btn sm" onClick={() => { setPick(today); go('/calendar'); }}>Today</button>
        <button className="btn sm" aria-label="Next month" onClick={() => go(`/calendar/${shift(month, 1)}`)}>›</button>
      </PageHead>
      <ErrorBox msg={err} />
      {!data ? <Loading h={480} /> : (<>
        <div className="pills" role="group" aria-label="Layers">
          {data.kinds.map((k) => (
            <button key={k} className={`oc-layer t-${KINDS[k][1]}${off.includes(k) ? ' off' : ''}`} aria-pressed={!off.includes(k)} onClick={() => toggle(k)}>
              <span className="oc-sw" aria-hidden="true" />{KINDS[k][0]}
            </button>))}
        </div>
        <div className="oc" role="grid" aria-label={`${MONTHS[mo - 1]} ${y}`}>
          <div className="oc-row oc-head" role="row">{DOW.map((d) => <span key={d} role="columnheader">{d}</span>)}</div>
          {Array.from({ length: cells.length / 7 }, (_, w) => (
            <div key={w} className="oc-row" role="row">
              {cells.slice(w * 7, w * 7 + 7).map((d, i) => {
                if (!d) return <span key={i} className="oc-cell blank" role="gridcell" />;
                const items = byDay.get(d) ?? [];
                return (
                  <button key={d} role="gridcell" className={`oc-cell${d === today ? ' today' : ''}${d === day ? ' on' : ''}${d < today ? ' past' : ''}`} onClick={() => setPick(d)} aria-label={`${fmtDay(d)}, ${items.length} item${items.length === 1 ? '' : 's'}`}>
                    <span className="oc-n">{Number(d.slice(8))}</span>
                    <span className="oc-evs">
                      {items.slice(0, 3).map((e, j) => <span key={j} className={`oc-ev t-${KINDS[e.kind][1]}${e.done ? ' done' : ''}`}>{e.title}</span>)}
                      {items.length > 3 && <span className="oc-more">+{items.length - 3} more</span>}
                    </span>
                    <span className="oc-dots" aria-hidden="true">{items.slice(0, 5).map((e, j) => <i key={j} className={`t-${KINDS[e.kind][1]}`} />)}</span>
                  </button>);
              })}
            </div>))}
        </div>
        <section className="card" aria-live="polite">
          <div className="card-head"><h3>{day ? fmtDay(day) : 'Pick a day'}</h3><span className="small muted">{dayItems.length ? `${dayItems.length} item${dayItems.length === 1 ? '' : 's'}` : ''}</span></div>
          {!day ? <p className="card-pad muted" style={{ margin: 0 }}>Tap a day to see everything on it.</p>
            : !dayItems.length ? <p className="card-pad muted" style={{ margin: 0 }}>Nothing on this day.</p>
              : <ul className="oc-day">{dayItems.map((e, j) => (
                <li key={j}>
                  <span className={`oc-tag t-${KINDS[e.kind][1]}`}>{KINDS[e.kind][0]}</span>
                  <span className={`oc-title${e.done ? ' done' : ''}`}>{e.title}{e.done && <span className="small muted"> · done</span>}</span>
                  {e.amountPaise != null && <span className="num">{inr(e.amountPaise)}</span>}
                  {e.href && <button className="btn sm" onClick={() => open(e)}>Open<Icon name="chevron" size={14} /></button>}
                </li>))}</ul>}
        </section>
      </>)}
    </div>
  );
}
