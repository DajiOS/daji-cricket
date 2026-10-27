// When customers can book: the open and close dates, and a calendar to switch single days off.
import { useState } from 'react';
import { useApi, put, post, fmtDate, todayISO, addDaysISO } from '../../lib';
import { Loading, ErrorBox, DateInput } from '../../ui';
import { Panel, Pill, errText } from './common';

const SCOPES: [string, string][] = [['all', 'Everything'], ['ground', 'Ground'], ['practice', 'Practice'], ['academy', 'Academy']];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
type Closed = Record<'ground' | 'practice' | 'academy', string[]>;

function DateRow({ label, field, value, okText, clearText }: { label: string; field: string; value: string | null; okText: (d: string) => string; clearText: string }) {
  const [d, setD] = useState(value || '');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function save(v: string) { try { await put('/api/admin/settings', { [field]: v }); setMsg({ ok: true, text: v ? okText(v) : clearText }); } catch (e) { setMsg({ ok: false, text: errText(e) }); } }
  return (
    <div className="dl-line">
      <div><b>{label}</b></div>
      <div className="acts">
        <DateInput className="inp" style={{ width: 170 }} value={d} onChange={(e) => setD(e.target.value)} aria-label={label} />
        <button className="btn sm" onClick={() => save(d)}>Save</button>
        <button className="btn sm ghost" onClick={() => { setD(''); save(''); }}>Clear</button>
      </div>
      {msg && <div style={{ flexBasis: '100%' }} className={msg.ok ? 'ok-text' : 'err-text'}>{msg.text}</div>}
    </div>
  );
}

function Calendar({ s }: { s: { bookingsOpenFrom: string | null; bookingsCloseFrom: string | null } }) {
  const [data, error, reload] = useApi<{ items: { scope: 'ground' | 'practice' | 'academy'; date: string }[] }>('/api/admin/closed-dates');
  const today = todayISO();
  const [month, setMonth] = useState((s.bookingsOpenFrom && s.bookingsOpenFrom > today ? s.bookingsOpenFrom : today).slice(0, 7));
  const [scope, setScope] = useState('all');
  const [a, setA] = useState(''); const [b, setB] = useState(''); const [why, setWhy] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <ErrorBox msg={error} />;
  if (!data) return <Loading h={200} />;
  const closed: Closed = { ground: [], practice: [], academy: [] };
  for (const c of data.items) closed[c.scope].push(c.date);
  const names = (scope === 'all' ? ['ground', 'practice', 'academy'] : [scope]) as (keyof Closed)[];
  const level = (d: string) => { const n = names.filter((k) => closed[k].includes(d)).length; return n === 0 ? 'none' : n === names.length ? 'all' : 'some'; };
  async function setDays(dates: string[], val: boolean, reason?: string) {
    setMsg(null);
    try { await post('/api/admin/closed-dates', { dates, closed: val, scopes: names, reason }); reload(); } catch (e) { setMsg(errText(e)); }
  }
  const [y, m] = month.split('-').map(Number) as [number, number];
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate(), lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const step = (n: number) => setMonth(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7));
  function range(val: boolean) {
    if (!a || !b || b < a) return setMsg('Choose a start and an end day.');
    const out: string[] = []; for (let d = a; d <= b && out.length < 400; d = addDaysISO(d, 1)) out.push(d);
    setDays(out, val, why.trim() || undefined);
  }
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(<span key={'l' + i} />);
  for (let day = 1; day <= days; day++) {
    const date = `${month}-${String(day).padStart(2, '0')}`;
    const outside = date < today || (!!s.bookingsOpenFrom && date < s.bookingsOpenFrom) || (!!s.bookingsCloseFrom && date >= s.bookingsCloseFrom);
    const lv = level(date);
    const tip = outside ? 'Outside the booking window' : lv === 'some' ? 'Partly closed. Click to close the rest' : lv === 'all' ? 'Closed. Click to open' : 'Open. Click to close';
    cells.push(<button key={date} className={`cal-d${outside ? ' out' : lv === 'all' ? ' off' : lv === 'some' ? ' part' : ''}`} disabled={outside} title={tip} onClick={() => setDays([date], lv !== 'all')}>{day}</button>);
  }
  return (
    <>
      <div className="hint" style={{ margin: '0 0 10px' }}>Choose what to switch, then click a day to close it for online booking and again to open it. "Everything" closes the ground, practice sessions and academy enquiries together. Greyed days are outside the booking window. Staff can still add bookings on closed days.</div>
      <div className="pills" style={{ marginBottom: 12 }}>{SCOPES.map(([k, l]) => <Pill key={k} on={scope === k} onClick={() => setScope(k)}>{l}</Pill>)}</div>
      <div className="row" style={{ marginBottom: 8 }}><button className="btn sm ghost" onClick={() => step(-1)} aria-label="Previous month">‹</button><b style={{ minWidth: 130, textAlign: 'center' }}>{MONTHS[m - 1]} {y}</b><button className="btn sm ghost" onClick={() => step(1)} aria-label="Next month">›</button></div>
      <div className="cal">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d} className="cal-h">{d}</span>)}{cells}</div>
      <div className="hint" style={{ margin: '10px 0' }}><span className="cal-key" /> Open &nbsp; <span className="cal-key part" /> Partly closed &nbsp; <span className="cal-key off" /> Closed &nbsp; <span className="cal-key out" /> Outside the window</div>
      <div className="row">
        <DateInput className="inp" style={{ width: 160 }} value={a} onChange={(e) => setA(e.target.value)} aria-label="From day" /><span>to</span>
        <DateInput className="inp" style={{ width: 160 }} value={b} onChange={(e) => setB(e.target.value)} aria-label="To day" />
        <input className="inp" style={{ width: 200 }} maxLength={100} placeholder="Reason (optional)" value={why} onChange={(e) => setWhy(e.target.value)} />
        <button className="btn sm" onClick={() => range(true)}>Close these days</button><button className="btn sm ghost" onClick={() => range(false)}>Open these days</button>
      </div>
      {msg && <div className="err-text" style={{ marginTop: 8 }}>{msg}</div>}
    </>
  );
}

export default function Booking() {
  const [s, error] = useApi<any>('/api/admin/settings');
  if (error) return <ErrorBox msg={error} />;
  if (!s) return <Loading />;
  return (
    <div className="stack">
      <Panel title="When customers can book">
        <DateRow label="Bookings open from" field="bookingsOpenFrom" value={s.bookingsOpenFrom} okText={(v) => `Saved. Customers can book from ${fmtDate(v)}.`} clearText="Saved. Bookings are open now." />
        <DateRow label="Bookings closed from" field="bookingsCloseFrom" value={s.bookingsCloseFrom} okText={(v) => `Saved. Customers cannot book on or after ${fmtDate(v)} until you clear this.`} clearText="Saved. No closing day: bookings are open as far ahead as allowed." />
      </Panel>
      <Panel title="Switch days on or off"><Calendar s={s} /></Panel>
    </div>
  );
}
