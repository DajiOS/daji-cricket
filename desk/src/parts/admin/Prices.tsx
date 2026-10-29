// Prices and timings: one card per ground. Same fields and rules as the old desk; nothing is saved until Save is pressed.
import { useState } from 'react';
import { useApi, patch } from '../../lib';
import { Loading, ErrorBox, Empty, Field, Icon, useToast } from '../../ui';
import { AddGround, groundsChanged } from './AddGround';
import GroundLinks from './GroundLinks';
import { Panel, Pill, errText, DAY_NAMES, DAY_ORDER, hourLabel, slotTimes } from './common';

type Ball = 'leather' | 'tennis' | 'practice';
interface Row { id?: string; label: string; ball: Ball; days: number[]; from: string; to: string; mode: 'fixed' | 'hourly'; price: string; bundle: number }
interface Ground { id: string; name: string; active: boolean; ownerName: string | null; rates: any[]; closedDays: number[]; openTime: string; closeTime: string; winterOpenTime: string | null; winterCloseTime: string | null; slotMinutes: number; eveningFrom: string; maxSlots: number; ratesNote: string | null }

const BALLS: [Ball, string, string?][] = [['leather', 'Leather ball prices'], ['tennis', 'Tennis ball prices'], ['practice', 'Practice session prices', 'Nets and practice, shown as its own tab next to the balls. Usually a by-the-hour price.']];
const startOpts = slotTimes(0, 23 * 60 + 30), endOpts = slotTimes(30, 27 * 60);
const DAJI = {
  closedDays: [1], slotMinutes: 60, maxSlots: 8, ratesNote: 'For custom days and reservations please call.',
  rates: [
    { label: 'Evening hours', ball: 'leather', days: [2, 3, 4, 5, 6, 0], from: '19:00', to: '27:00', mode: 'hourly', price: 3500 },
    { label: 'Morning session', ball: 'leather', days: [2, 3, 4, 5], from: '07:00', to: '10:00', mode: 'fixed', price: 4000 },
    { label: 'Day session', ball: 'leather', days: [2, 3, 4, 5], from: '10:00', to: '18:00', mode: 'fixed', price: 6000 },
    { label: 'Weekend day', ball: 'leather', days: [6, 0], from: '07:00', to: '19:00', mode: 'fixed', price: 15000 },
    { label: 'Evening hours', ball: 'tennis', days: [2, 3, 4, 5, 6, 0], from: '19:00', to: '27:00', mode: 'hourly', price: 3500 },
    { label: 'Morning session', ball: 'tennis', days: [2, 3, 4, 5], from: '07:00', to: '10:00', mode: 'fixed', price: 5000 },
    { label: 'Two-day tournament (Sat + Sun)', ball: 'tennis', days: [6], from: '07:00', to: '23:00', mode: 'fixed', price: 151000, bundleDays: 2 },
    { label: 'Saturday tournament', ball: 'tennis', days: [6], from: '07:00', to: '19:00', mode: 'fixed', price: 100000 },
    { label: 'Sunday tournament', ball: 'tennis', days: [0], from: '07:00', to: '23:00', mode: 'fixed', price: 90000 },
    { label: 'Practice hours', ball: 'practice', days: [2, 3, 4, 5, 6, 0], from: '07:00', to: '19:00', mode: 'hourly', price: 600 },
  ],
};

function GroundCard({ g }: { g: Ground }) {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>(() => (g.rates || []).map((r) => ({ id: r.id, label: r.label, ball: r.ball, days: [...r.days], from: r.from, to: r.to, mode: r.mode, price: String(r.pricePaise / 100), bundle: r.bundleDays || 1 })));
  const [closed, setClosed] = useState<number[]>(g.closedDays || []);
  const [f, setF] = useState({ openTime: g.openTime, closeTime: g.closeTime, winterOpenTime: g.winterOpenTime || '', winterCloseTime: g.winterCloseTime || g.closeTime, slotMinutes: String(g.slotMinutes), eveningFrom: g.eveningFrom, maxSlots: String(g.maxSlots), note: g.ratesNote || '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState(g.active);
  // Switching booking on or off is saved at once, apart from the prices below: off hides the ground from customers, the picker and the dashboard.
  async function setBookable(on: boolean) {
    try { await patch(`/api/staff/grounds/${encodeURIComponent(g.id)}`, { active: on }); setOpen(on); groundsChanged(); toast(on ? `${g.name}: customers can book it` : `${g.name}: hidden from customers`); }
    catch (e) { setMsg({ ok: false, text: errText(e) }); }
  }
  const [busy, setBusy] = useState(false);
  const setField = (k: keyof typeof f) => (e: any) => setF((s) => ({ ...s, [k]: e.target.value }));
  const upd = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const flipDay = (arr: number[], d: number) => (arr.includes(d) ? arr.filter((x) => x !== d) : [...arr, d]);
  const openOpts = startOpts.slice(0, 48);

  function loadDaji() {
    setRows(DAJI.rates.map((r) => ({ label: r.label, ball: r.ball as Ball, days: [...r.days], from: r.from, to: r.to, mode: r.mode as Row['mode'], price: String(r.price), bundle: (r as any).bundleDays || 1 })));
    setClosed([...DAJI.closedDays]); setF((s) => ({ ...s, slotMinutes: String(DAJI.slotMinutes), maxSlots: String(DAJI.maxSlots), note: DAJI.ratesNote }));
    setMsg({ ok: true, text: 'The Daji price list is loaded. Check it, then press Save.' });
  }
  async function save() {
    setMsg(null);
    for (const r of rows) {
      if (!r.label.trim()) return setMsg({ ok: false, text: 'Give every price a name.' });
      if (!r.days.length) return setMsg({ ok: false, text: `"${r.label}": choose at least one day.` });
      if (r.price === '' || isNaN(Number(r.price))) return setMsg({ ok: false, text: `"${r.label}": enter a price.` });
    }
    setBusy(true);
    try {
      await patch(`/api/staff/grounds/${encodeURIComponent(g.id)}`, {
        openTime: f.openTime, closeTime: f.closeTime, winterOpenTime: f.winterOpenTime || null, winterCloseTime: f.winterOpenTime ? f.winterCloseTime : null,
        slotMinutes: Number(f.slotMinutes), eveningFrom: f.eveningFrom, maxSlots: Number(f.maxSlots), closedDays: [...closed].sort(), ratesNote: f.note.trim(),
        rates: rows.map((r) => ({ ...(r.id ? { id: r.id } : {}), label: r.label.trim(), ball: r.ball, days: r.days, from: r.from, to: r.to, mode: r.mode, pricePaise: Math.round(Number(r.price) * 100), ...(r.mode === 'fixed' && r.bundle > 1 ? { bundleDays: r.bundle } : {}) })),
      });
      toast(`${g.name}: saved.`); setMsg({ ok: true, text: 'Saved. Customers see the new prices now.' });
    } catch (e) { setMsg({ ok: false, text: errText(e) }); }
    setBusy(false);
  }

  const showPractice = rows.some((r) => r.ball === 'practice');
  const cell = (d: number, ball: Ball) => {
    if (closed.includes(d)) return <td className="cl">Closed</td>;
    const rs = rows.filter((r) => r.ball === ball && r.days.includes(d)).sort((a, b) => a.from.localeCompare(b.from));
    return <td>{rs.length ? rs.map((r, i) => <div key={i}>{hourLabel(r.from)} to {hourLabel(r.to)} <b>{r.price ? `₹${Number(r.price).toLocaleString('en-IN')}${r.mode === 'hourly' ? '/hr' : ''}` : '₹?'}</b></div>) : '—'}</td>;
  };

  return (
    <Panel title={g.name} note={open ? 'Customers can book it' : 'Hidden: customers cannot book it yet'} actions={<>
      <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={open} onChange={(e) => setBookable(e.target.checked)} />Customers can book it</label>
      <button className="btn sm ghost" onClick={loadDaji}>Load the Daji price list</button></>}>
      <div className="dl-sub">Days the ground is closed</div>
      <div className="hint" style={{ margin: '0 0 8px' }}>Tap a day to close it, for example Monday for maintenance. Nothing can be booked on a closed day.</div>
      <div className="pills">{DAY_ORDER.map((d) => <Pill key={d} on={closed.includes(d)} onClick={() => setClosed(flipDay(closed, d))}>{DAY_NAMES[d]}</Pill>)}</div>

      {BALLS.map(([ball, title, help]) => (
        <div key={ball}>
          <div className="dl-sub">{title}</div>
          {help && <div className="hint" style={{ margin: '0 0 8px' }}>{help}</div>}
          <div className="stack" style={{ gap: 10 }}>
            {rows.map((r, i) => r.ball !== ball ? null : (
              <div className="rate" key={i}>
                <div className="rate-top">
                  <input className="inp" value={r.label} maxLength={40} placeholder="e.g. Day session" aria-label="Name" onChange={(e) => upd(i, { label: e.target.value })} />
                  <select className="inp" value={r.mode} aria-label="Kind of price" onChange={(e) => upd(i, { mode: e.target.value as Row['mode'], ...(e.target.value === 'hourly' ? { bundle: 1 } : {}) })}>
                    <option value="fixed">Fixed session (whole time slot)</option><option value="hourly">By the hour (customer picks hours)</option>
                  </select>
                  <div className="row" style={{ flexWrap: 'nowrap' }}><span>₹</span><input className="inp" value={r.price} inputMode="decimal" placeholder="0" aria-label="Price in rupees" onChange={(e) => upd(i, { price: e.target.value.replace(/[^\d.]/g, '') })} /></div>
                </div>
                <div className="hint" style={{ margin: 0 }}>{r.mode === 'hourly' ? 'Price for each hour.' : 'Price for the whole session.'}</div>
                <div className="rate-row"><span className="lbl">Days</span>
                  <div className="pills">{DAY_ORDER.map((d) => <Pill key={d} on={r.days.includes(d)} onClick={() => upd(i, { days: flipDay(r.days, d) })}>{DAY_NAMES[d]}</Pill>)}</div>
                  <button className="btn sm ghost" onClick={() => upd(i, { days: [2, 3, 4, 5] })}>Tue to Fri</button>
                  <button className="btn sm ghost" onClick={() => upd(i, { days: [6, 0] })}>Sat and Sun</button>
                  <button className="btn sm ghost" onClick={() => upd(i, { days: [0, 1, 2, 3, 4, 5, 6] })}>Every day</button>
                </div>
                <div className="rate-row"><span className="lbl">Time</span>
                  <select className="inp" value={r.from} aria-label="From" onChange={(e) => upd(i, { from: e.target.value })}>{startOpts.map((t) => <option key={t} value={t}>{hourLabel(t)}</option>)}</select>
                  <span>to</span>
                  <select className="inp" value={r.to} aria-label="To" onChange={(e) => upd(i, { to: e.target.value })}>{endOpts.map((t) => <option key={t} value={t}>{hourLabel(t)}</option>)}</select>
                  {r.mode === 'fixed' && <><span className="lbl">Covers</span><select className="inp" value={r.bundle} onChange={(e) => upd(i, { bundle: Number(e.target.value) })}>{[1, 2, 3].map((n) => <option key={n} value={n}>{n === 1 ? 'that day' : `${n} days in a row`}</option>)}</select></>}
                  <button className="btn sm ghost" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>Remove</button>
                </div>
              </div>
            ))}
            <div><button className="btn sm" onClick={() => setRows((rs) => [...rs, { label: '', ball, days: [2, 3, 4, 5], from: '10:00', to: '18:00', mode: 'fixed', price: '', bundle: 1 }])}>Add a {ball} price</button></div>
          </div>
        </div>
      ))}
      <div className="hint" style={{ marginTop: 12 }}>A fixed session is booked as one block at one price. A by-the-hour price lets the customer choose how many hours. Times after midnight show as "next day".</div>

      <div className="dl-sub">The week at a glance</div>
      <div className="glance"><table>
        <thead><tr><th></th><th>Leather ball</th><th>Tennis ball</th>{showPractice && <th>Practice</th>}</tr></thead>
        <tbody>{DAY_ORDER.map((d) => <tr key={d}><th>{DAY_NAMES[d]}</th>{cell(d, 'leather')}{cell(d, 'tennis')}{showPractice && cell(d, 'practice')}</tr>)}</tbody>
      </table></div>

      <div className="dl-sub">Message to customers</div>
      <textarea className="inp" rows={2} maxLength={300} style={{ height: 'auto', padding: 10 }} placeholder="e.g. For custom days and reservations please call." value={f.note} onChange={setField('note')} />

      <details style={{ marginTop: 16 }}>
        <summary className="small muted" style={{ cursor: 'pointer' }}>More settings (slot length, opening hours without a price list)</summary>
        <div className="dl-grid" style={{ marginTop: 12 }}>
          <Field label="Slot length"><select className="inp" value={f.slotMinutes} onChange={setField('slotMinutes')}>{[30, 60, 90, 120].concat([30, 60, 90, 120].includes(g.slotMinutes) ? [] : [g.slotMinutes]).map((n) => <option key={n} value={n}>{n === 60 ? '1 hour' : n === 90 ? '1 hour 30' : n === 120 ? '2 hours' : `${n} minutes`}</option>)}</select></Field>
          <Field label="Most hours at once"><select className="inp" value={f.maxSlots} onChange={setField('maxSlots')}>{[1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 24].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
          <Field label="Summer opens"><select className="inp" value={f.openTime} onChange={setField('openTime')}>{openOpts.map((t) => <option key={t} value={t}>{hourLabel(t)}</option>)}</select></Field>
          <Field label="Summer closes"><select className="inp" value={f.closeTime} onChange={setField('closeTime')}>{endOpts.map((t) => <option key={t} value={t}>{hourLabel(t)}</option>)}</select></Field>
          <Field label="Winter opens (Nov to Feb)"><select className="inp" value={f.winterOpenTime} onChange={setField('winterOpenTime')}><option value="">Same as summer</option>{openOpts.map((t) => <option key={t} value={t}>{hourLabel(t)}</option>)}</select></Field>
          <Field label="Winter closes"><select className="inp" value={f.winterCloseTime} onChange={setField('winterCloseTime')}>{endOpts.map((t) => <option key={t} value={t}>{hourLabel(t)}</option>)}</select></Field>
          <Field label="Evening rate from"><select className="inp" value={f.eveningFrom} onChange={setField('eveningFrom')}>{slotTimes(12 * 60, 23 * 60).map((t) => <option key={t} value={t}>{hourLabel(t)}</option>)}</select></Field>
        </div>
      </details>

      <div className="row" style={{ marginTop: 18 }}>
        <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save prices and timings'}</button>
        {msg && <span className={msg.ok ? 'ok-text' : 'err-text'}>{msg.text}</span>}
      </div>
    </Panel>
  );
}

export default function Prices() {
  const [data, error, reload] = useApi<{ items: Ground[] }>('/api/staff/grounds');
  const [adding, setAdding] = useState(false);
  if (error) return <ErrorBox msg={error} />;
  if (!data) return <Loading />;
  const add = <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" />Add a ground or pitch</button>;
  const dialog = adding && <AddGround city={(data.items[0] as any)?.city ?? ''} onAdded={reload} onClose={() => setAdding(false)} />;
  if (!data.items.length) return <><Empty>No grounds yet.</Empty><div className="row">{add}</div>{dialog}</>;
  return <div className="dl-ground">
    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}><div className="hint" style={{ margin: 0 }}>Set what each ball costs, on which days and at what times. Customers see the changes as soon as you save.</div>{add}</div>
    {data.items.map((g) => <GroundCard key={g.id} g={g} />)}
    <GroundLinks />
    {dialog}
  </div>;
}
