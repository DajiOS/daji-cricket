import { useEffect, useState } from 'react';
import { useSession } from '../App';
import { PageHead, Loading, ErrorBox, Empty, Icon } from '../ui';
import { api, go, inr, fmtDateTime, todayISO } from '../lib';
import { title } from '../parts/dash/activity';

// The starter kit's activity feed: everything that happened in the business, newest first, each event with the button for its next step.
type Area = 'bookings' | 'books' | 'matches' | 'academy' | 'tasks' | 'people' | 'messages' | 'owner';
interface Item { id: number; at: number; area: Area; action: string; entity: string; entityId: string | null; who: string; detail: Record<string, any> | null; href: string | null; cta: string }

const AREAS: Record<Area, [string, string, string]> = {
  bookings: ['Bookings', 'green', 'calendar'], books: ['Money', 'blue', 'accounts'], matches: ['Matches', 'violet', 'ball'], academy: ['Academy', 'teal', 'grad'],
  tasks: ['Jobs', 'amber', 'tasks'], people: ['People', 'teal', 'users'], messages: ['Messages', 'teal', 'chat'], owner: ['Team and settings', 'red', 'settings'],
};
function money(d: Record<string, any> | null): string | null {
  if (!d) return null;
  const v = d.amountPaise ?? d.paidPaise ?? d.totalPaise;
  return typeof v === 'number' && v > 0 ? inr(v) : null;
}
const dayOf = (ms: number) => new Date(ms + 330 * 60000).toISOString().slice(0, 10);

export default function Activity({ sub }: { sub: string }) {
  void sub;
  const { ownerId } = useSession();
  const [items, setItems] = useState<Item[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [only, setOnly] = useState<Area | ''>('');
  const load = async (before?: number) => {
    setBusy(true); setErr(null);
    try {
      const r = await api<{ items: Item[]; next: number | null }>(`/api/desk/activity?limit=60${before ? `&before=${before}` : ''}`);
      setItems((x) => (before ? [...(x ?? []), ...r.items] : r.items)); setNext(r.next);
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  };
  useEffect(() => { load(); }, [ownerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = (items ?? []).filter((i) => !only || i.area === only);
  const areas = [...new Set((items ?? []).map((i) => i.area))];
  const today = todayISO();
  let lastDay = '';

  return (
    <div className="stack">
      <PageHead eyebrow="What happened" title="Activity" lede="Every booking, payment, bill, job and change in the business, newest first. Each event has a button for its next step.">
        <button className="btn sm" onClick={() => load()} disabled={busy}><Icon name="repeat" />Refresh</button>
      </PageHead>
      <ErrorBox msg={err} />
      {items && areas.length > 1 && (
        <div className="pills" role="group" aria-label="Show">
          <button className={`btn sm${only === '' ? ' primary' : ''}`} onClick={() => setOnly('')}>Everything</button>
          {areas.map((a) => <button key={a} className={`btn sm${only === a ? ' primary' : ''}`} onClick={() => setOnly(a)}>{AREAS[a][0]}</button>)}
        </div>)}
      {!items ? (!err && <Loading h={420} />) : !shown.length ? <Empty>Nothing has happened here yet.</Empty> : (
        <section className="card feed">
          {shown.map((i) => {
            const d = dayOf(i.at);
            const head = d !== lastDay ? <div className="feed-day">{d === today ? 'Today' : fmtDateTime(i.at).split(',')[0]}</div> : null;
            lastDay = d;
            const amt = money(i.detail);
            return (
              <div key={i.id}>
                {head}
                <div className="feed-row">
                  <span className={`feed-ic t-${AREAS[i.area][1]}`} aria-hidden="true"><Icon name={AREAS[i.area][2]} size={16} /></span>
                  <span className="feed-main">
                    <span><b>{title(i.action)}</b>{amt && <span className="num"> · {amt}</span>}</span>
                    <span className="small muted">{i.who} · {fmtDateTime(i.at).split(', ')[1]} · {AREAS[i.area][0]}</span>
                  </span>
                  {i.href && <button className="btn sm" onClick={() => go(i.href!)}>{i.cta}</button>}
                </div>
              </div>);
          })}
          {next && <div className="feed-more"><button className="btn sm" disabled={busy} onClick={() => load(next)}>{busy ? 'Loading…' : 'Show older'}</button></div>}
        </section>)}
    </div>
  );
}
