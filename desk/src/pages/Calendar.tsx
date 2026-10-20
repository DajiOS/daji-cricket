import { useMemo, useState } from 'react';
import { useSession } from '../App';
import { Loading, ErrorBox, Icon } from '../ui';
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
const COLOUR: Record<string, string> = { green: '#1E6E4A', red: '#B24A3A', violet: '#7C4DBA', teal: '#0F7C86', amber: '#B86E12', blue: '#2F6FB0' };
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

  const col = (k: Kind) => COLOUR[KINDS[k][1]]!;
  return (
    <div className="dcal">
      <div className="dcal-hd">
        <div><span className="eyebrow">Every section's dates · {data ? data.kinds.length : '…'} layers</span><h1>{MONTHS[mo - 1]} {y}</h1></div>
        <div className="dcal-nav">
          <button className="dchip sq" aria-label="Previous month" onClick={() => go(`/calendar/${shift(month, -1)}`)}>‹</button>
          <button className="dchip" onClick={() => { setPick(today); go('/calendar'); }}>Today</button>
          <button className="dchip sq" aria-label="Next month" onClick={() => go(`/calendar/${shift(month, 1)}`)}>›</button>
        </div>
      </div>
      <ErrorBox msg={err} />
      {!data ? <Loading h={480} /> : (<>
        <div className="dcal-layers" role="group" aria-label="Layers">
          {data.kinds.map((k) => (
            <button key={k} className={`dchip${off.includes(k) ? ' off' : ''}`} aria-pressed={!off.includes(k)} onClick={() => toggle(k)}>
              <span className="dcal-sw" style={{ background: off.includes(k) ? 'transparent' : col(k), borderColor: col(k) }} aria-hidden="true" />{KINDS[k][0]}
            </button>))}
        </div>
        <div className="dcal-wrap">
          <div className="dcal-grid" role="grid" aria-label={`${MONTHS[mo - 1]} ${y}`}>
            {DOW.map((d) => <div key={d} className="dcal-h" role="columnheader">{d}</div>)}
            {cells.map((d, i) => {
              if (!d) return <div key={i} className="dcal-day out" role="gridcell" />;
              const items = byDay.get(d) ?? [];
              return (
                <div key={d} role="gridcell" className={`dcal-day${d === today ? ' today' : ''}`} aria-label={`${fmtDay(d)}, ${items.length} item${items.length === 1 ? '' : 's'}`}>
                  <span className="dcal-n">{Number(d.slice(8))}</span>
                  {items.slice(0, 3).map((e, j) => <a key={j} className="dcal-ev" style={{ background: col(e.kind), opacity: e.done ? 0.55 : 1 }} href={e.href ? `#${e.href}` : undefined} title={e.title}>{e.title}</a>)}
                  {items.length > 3 && <button className="dchip" style={{ minHeight: 24, padding: '0 8px', fontSize: 11.5 }} onClick={() => setPick(d)}>+{items.length - 3} more</button>}
                </div>);
            })}
          </div>
        </div>
        {day && dayItems.length > 3 && (
          <section className="dcard" aria-live="polite">
            <h2 className="serif" style={{ margin: 0, fontWeight: 500 }}>{fmtDay(day)}</h2>
            <ul className="oc-day">{dayItems.map((e, j) => (
              <li key={j}>
                <span className={`oc-tag t-${KINDS[e.kind][1]}`}>{KINDS[e.kind][0]}</span>
                <span className={`oc-title${e.done ? ' done' : ''}`}>{e.title}{e.done && <span className="small muted"> · done</span>}</span>
                {e.amountPaise != null && <span className="num">{inr(e.amountPaise)}</span>}
                {e.href && <button className="btn sm" onClick={() => open(e)}>Open<Icon name="chevron" size={14} /></button>}
              </li>))}</ul>
          </section>)}
      </>)}
    </div>
  );
}
