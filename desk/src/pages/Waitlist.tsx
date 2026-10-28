import { useState } from 'react';
import { PageHead, Tabs, Table, Status, Modal, Field, ErrorBox, Load, Stat, useToast } from '../ui';
import { useApi, post, go, fmtDay, fmtDateTime, formatPhone, can } from '../lib';
import { useSession } from '../App';
import { errText } from '../parts/dash/common';

// The weekly waitlist (Sunday leather ball unless changed in Settings): who is waiting and for which day, with the games they have played and
// their tier, and the sessions offered to them. The server decides everything (waitlist.ts): what is free, who is told when, and who won.
// Staff add someone who asked by phone, or take someone off with a reason.
interface Entry { id: string; customerName: string; customerPhone: string | null; groundName: string; session: string; everyWeek: boolean; status: 'waiting' | 'won' | 'booked' | 'withdrawn' | 'ended'; nextDate: string; untilDate: string; rollovers: number; gamesBooked: number; games: number; tier: string | null; wave: number; bookingId: string | null; enquiryId: string | null; endedReason: string | null }
interface Offer { id: string; groundName: string; session: string; date: string; startAt: number; time: string; endTime: string; status: 'open' | 'taken' | 'closed'; wave: number; nextWaveAt: number | null; closedReason: string | null; people: number; told: number; lapsed: number; takenBy: string | null; bookingId: string | null; enquiryId: string | null }
interface Data { settings: { enabled: boolean; name: string; confirmHours: number; tierPriority: boolean; waveMinutes: number; tiers: { name: string; minGames: number }[] }; waiting: number; entries: Entry[]; offers: Offer[] }
interface Ground { id: string; name: string; rates?: { id: string; label: string; ball: string; days: number[]; mode: string; bundleDays?: number }[] }

const ENTRY: Record<string, ['good' | 'warn' | 'bad' | 'mute' | 'info' | 'gold', string]> = { waiting: ['info', 'Waiting'], won: ['gold', 'Accepted a slot'], booked: ['good', 'Played'], withdrawn: ['mute', 'Left'], ended: ['mute', 'Ended'] };
const OFFER: Record<string, ['good' | 'warn' | 'bad' | 'mute' | 'info' | 'gold', string]> = { open: ['warn', 'Offered'], taken: ['good', 'Accepted'], closed: ['mute', 'Closed'] };
const TABS: [string, string][] = [['waiting', 'Waiting'], ['offers', 'Offers'], ['past', 'Past requests']];

export default function Waitlist({ sub }: { sub: string }) {
  const { me } = useSession();
  const first = sub.replace(/^\//, '').split('/')[0] ?? '';
  const tab = TABS.some(([k]) => k === first) ? first : 'waiting';
  const [d, err, reload, status] = useApi<Data>(can(me, 'manage_bookings') ? '/api/staff/waitlist' : null);
  const [adding, setAdding] = useState(false);
  const [off, setOff] = useState<Entry | null>(null);
  const live = d?.entries.filter((e) => e.status === 'waiting' || e.status === 'won') ?? [];
  const past = d?.entries.filter((e) => e.status !== 'waiting' && e.status !== 'won') ?? [];
  const nextDay = live.map((e) => e.nextDate).sort()[0];
  const offered = d?.offers.filter((o) => o.status === 'open') ?? [];
  return (
    <div className="stack">
      <PageHead eyebrow="Bookings" title={d ? `${d.settings.name} waitlist` : 'Waitlist'} lede={d ? `Customers waiting for a session. One still free ${d.settings.confirmHours} hours before it starts is offered to them by app, email and WhatsApp (to those who agreed); the first to accept books it at the normal price. Otherwise they move to the next week.` : undefined}>
        {can(me, 'manage_bookings') && <button className="btn primary" onClick={() => setAdding(true)}>Add someone</button>}
      </PageHead>
      {!can(me, 'manage_bookings') ? <Load data={null} error="forbidden" status={403}>{() => null}</Load> : (
        <Load data={d} error={err} status={status} retry={reload}>{(x) => (
          <>
            {!x.settings.enabled && <div className="state state-partial" role="status"><b>The waitlist is switched off.</b> <span className="small">Nobody new can join and nothing is offered. Switch it on in <a href="#/settings/waitlist">Settings › Waitlist</a>.</span></div>}
            <div className="grid g4">
              <Stat label="Waiting" value={x.waiting} foot="People with a request running" />
              <Stat label="Next day" value={nextDay ? fmtDay(nextDay) : '—'} foot={nextDay ? `${live.filter((e) => e.nextDate === nextDay).length} waiting for it` : 'Nobody is waiting'} />
              <Stat label="Offered now" value={offered.length} foot={offered[0] ? `${offered[0].session}, ${fmtDay(offered[0].date)}` : 'No session offered right now'} />
              <Stat label="Priority" value={x.settings.tierPriority ? 'On' : 'Off'} foot={x.settings.tierPriority ? `${x.settings.tiers.map((t) => `${t.name} ${t.minGames}+`).join(', ')}; ${x.settings.waveMinutes} min ahead` : 'Everyone hears at once'} />
            </div>
            <Tabs value={tab} onChange={(t) => go(t === 'waiting' ? '/waitlist' : `/waitlist/${t}`)} items={TABS} label="Sections" />
            {tab === 'waiting' && <div className="card"><Table rows={live} rowKey={(e) => e.id} empty="Nobody is on the waitlist." cols={[
              { head: 'Customer', cell: (e) => <><b>{e.customerName}</b>{e.customerPhone && <div className="small muted">{formatPhone(e.customerPhone)}</div>}</> },
              { head: 'Session', cell: (e) => <>{e.session}<div className="small muted">{e.groundName}{e.everyWeek ? ' · every week' : ''}</div></> },
              { head: 'For', cell: (e) => <>{fmtDay(e.nextDate)}<div className="small muted">{e.rollovers ? `Moved on ${e.rollovers} week${e.rollovers === 1 ? '' : 's'}` : 'First week'} · until {fmtDay(e.untilDate)}</div></> },
              { head: 'Played', cell: (e) => <>{e.games} game{e.games === 1 ? '' : 's'}<div className="small muted">{e.tier ?? 'No tier'}{x.settings.tierPriority ? ` · group ${e.wave}` : ''}</div></>, num: true },
              { head: 'Status', cell: (e) => <><Status s={e.status} map={ENTRY} />{e.bookingId && <div className="small"><a href={`#/bookings/${e.bookingId}`}>Booking</a></div>}{e.enquiryId && !e.bookingId && <div className="small"><a href={`#/enquiries/${e.enquiryId}`}>Pricing enquiry</a></div>}</> },
              { head: '', cell: (e) => <button className="btn sm ghost" onClick={() => setOff(e)}>Take off</button> },
            ]} /></div>}
            {tab === 'offers' && <div className="card"><Table rows={x.offers} rowKey={(o) => o.id} empty="No session has been offered in the last two weeks." cols={[
              { head: 'Session', cell: (o) => <>{o.session}<div className="small muted">{o.groundName}</div></> },
              { head: 'When', cell: (o) => <>{fmtDay(o.date)}<div className="small muted">{o.time} to {o.endTime}</div></> },
              { head: 'Told', cell: (o) => <>{o.told} of {o.people}{o.nextWaveAt && o.status === 'open' && <div className="small muted">Next group {fmtDateTime(o.nextWaveAt)}</div>}{o.lapsed > 0 && <div className="small muted">{o.lapsed} let it go</div>}</>, num: true },
              { head: 'Status', cell: (o) => <><Status s={o.status} map={OFFER} />{o.takenBy && <div className="small">{o.takenBy}</div>}{o.closedReason && <div className="small muted">{o.closedReason}</div>}{o.bookingId && <div className="small"><a href={`#/bookings/${o.bookingId}`}>Booking</a></div>}{o.enquiryId && !o.bookingId && <div className="small"><a href={`#/enquiries/${o.enquiryId}`}>Pricing enquiry</a></div>}</> },
            ]} /></div>}
            {tab === 'past' && <div className="card"><Table rows={past} rowKey={(e) => e.id} empty="No finished requests yet." cols={[
              { head: 'Customer', cell: (e) => <b>{e.customerName}</b> },
              { head: 'Session', cell: (e) => <>{e.session}<div className="small muted">{e.groundName}</div></> },
              { head: 'Games from the list', cell: (e) => e.gamesBooked, num: true },
              { head: 'Status', cell: (e) => <><Status s={e.status} map={ENTRY} />{e.endedReason && <div className="small muted">{e.endedReason}</div>}</> },
            ]} /></div>}
          </>)}</Load>)}
      {adding && <AddDialog onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />}
      {off && <OffDialog e={off} onClose={() => setOff(null)} onDone={() => { setOff(null); reload(); }} />}
    </div>
  );
}

function AddDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [grounds] = useApi<{ items: Ground[] }>('/api/staff/grounds');
  const [groundId, setGroundId] = useState('');
  const [ruleId, setRuleId] = useState('');
  const [name, setName] = useState(''); const [phone, setPhone] = useState('');
  const [everyWeek, setEveryWeek] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const g = grounds?.items.find((x) => x.id === groundId) ?? grounds?.items[0];
  const sessions = (g?.rates ?? []).filter((r) => r.mode === 'fixed' && (r.bundleDays ?? 1) === 1);
  async function save() {
    if (!g) { setMsg('Pick a ground first. If none is listed, add one in Settings.'); return; }
    setBusy(true); setMsg(null);
    try { const r = await post<{ entry: { nextDate: string }; created: boolean }>('/api/staff/waitlist', { groundId: g.id, ruleId: ruleId || undefined, everyWeek, customer: { name, phone } }); toast(r.created ? `Added. Waiting for ${fmtDay(r.entry.nextDate)}.` : 'They were already on the waitlist.'); onDone(); }
    catch (e) { setMsg(errText(e)); }
    setBusy(false);
  }
  return (
    <Modal title="Add someone to the waitlist" onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Add</button></>}>
      <div className="form-grid">
        <Field label="Name" required><input className="inp" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Mobile" required><input className="inp" inputMode="tel" maxLength={14} value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label="Ground"><select className="inp" value={g?.id ?? ''} onChange={(e) => { setGroundId(e.target.value); setRuleId(''); }}>{grounds?.items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        <Field label="Session" hint="Any session of the waitlist ball that day, or one"><select className="inp" value={ruleId} onChange={(e) => setRuleId(e.target.value)}><option value="">Any</option>{sessions.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></Field>
        <Field label="Every week" full><label className="row" style={{ gap: 8 }}><input type="checkbox" checked={everyWeek} onChange={(e) => setEveryWeek(e.target.checked)} /> Stay on the list after each game, for up to a year</label></Field>
      </div>
      <ErrorBox msg={msg} />
    </Modal>
  );
}

function OffDialog({ e, onClose, onDone }: { e: Entry; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  async function save() {
    setMsg(null);
    try { await post(`/api/staff/waitlist/${e.id}/withdraw`, { reason }); toast(`${e.customerName} is off the waitlist.`); onDone(); } catch (x) { setMsg(errText(x)); }
  }
  return (
    <Modal title={`Take ${e.customerName} off the waitlist`} onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Take off</button></>}>
      <Field label="Why" hint="Kept in the activity log; the customer is told their request has ended" required><input className="inp" maxLength={200} value={reason} onChange={(ev) => setReason(ev.target.value)} autoFocus /></Field>
      <ErrorBox msg={msg} />
    </Modal>
  );
}
