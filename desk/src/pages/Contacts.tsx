import { useState } from 'react';
import { Chip, Confirm, Field, PageHead, Stat, Table, useToast } from '../ui';
import { addDaysISO, can, download, go, fmtDate, fmtDateTime, getViewOwner, inr, post, qs, todayISO, useApi, formatPhone } from '../lib';
import { useSession } from '../App';
import { Async, FilterBar, Select, errMsg, useDebounced } from '../parts/club/common';
import Composer, { loadTemplates } from '../parts/club/Composer';
import { CustomerWorkspace } from '../parts/customers/Workspace';

interface Contact { id: string; name: string; phone: string | null; email: string | null; timesPlayed: number; lastPlayedAt: number; lastPastAt: number | null; nextAt: number | null; paidPaise: number | null; signedUpAt: number; reachable: { email: boolean; whatsapp: boolean; sms: boolean } }
interface Result { items: Contact[]; total: number; summary: { total: number; reachableEmail: number; reachableWhatsapp: number; reachableSms: number } }
interface Broadcast { id: string; createdAt: number; channel: string; subject?: string | null; body: string; sent: number; queued: number }
const LIMIT = 50;
/** An instant as its India date (yyyy-mm-dd). */
const day = (ms: number) => new Date(ms + 330 * 60000).toISOString().slice(0, 10);
const CHAN: Record<string, string> = { whatsapp: 'WhatsApp', email: 'Email', sms: 'Text' };

/** The customer directory. /customers/<id> (or /contacts/<id>) opens one customer's workspace, with its tab after the id. */
export default function Contacts({ sub }: { sub: string }) {
  const [id, tab] = sub.split('/');
  if (id) return <CustomerWorkspace key={id} id={decodeURIComponent(id)} tab={tab} />;
  return <Directory />;
}

function Directory() {
  const { me } = useSession(); const toast = useToast();
  const [who, setWho] = useState('account'); const [ground, setGround] = useState(''); const [inactive, setInactive] = useState(''); const [min, setMin] = useState(''); const [q, setQ] = useState(''); const [offset, setOffset] = useState(0); const [removed, setRemoved] = useState('');
  const [templates, setTemplates] = useState<Awaited<ReturnType<typeof loadTemplates>> | null>(null); const [sent, setSent] = useState(0);
  const dq = useDebounced(q), dmin = useDebounced(min);
  const filter: Record<string, string | number> = { who };
  if (ground) filter.groundId = ground; if (inactive) filter.inactiveSince = inactive; if (Number(dmin) > 0) filter.minTimes = Number(dmin); if (dq.trim()) filter.q = dq.trim(); if (removed) filter.removed = 1;
  const [grounds] = useApi<{ items: { id: string; name: string }[] }>('/api/staff/grounds');
  const [data, error, reload] = useApi<Result>('/api/staff/contacts' + qs({ ...filter, limit: LIMIT, offset }));
  // Owner only: takes a person off the contacts (lists, counts, messages) or puts them back. Their account, bookings and money stay as they are.
  const curate = me?.role === 'owner' || me?.role === 'super_admin';
  const setGone = async (id: string, gone: boolean) => {
    const owner = me?.role === 'super_admin' ? getViewOwner() : null;
    try { await post(`/api/staff/customers/${encodeURIComponent(id)}/${gone ? 'remove' : 'restore'}` + qs({ ownerId: owner }), {}); toast(gone ? 'Removed from contacts' : 'Put back in contacts'); reload(); } catch (e) { toast(errMsg(e)); }
  };
  const [hist, , reloadHist] = useApi<{ items: Broadcast[] }>('/api/staff/broadcasts?limit=10', [sent]);
  const change = (fn: () => void) => { fn(); setOffset(0); };
  const csv = () => {
    const owner = me?.role === 'super_admin' ? getViewOwner() : null;
    download('/api/staff/contacts/export' + qs({ ...filter, ownerId: owner }), 'daji-contacts.csv').catch((e) => toast(errMsg(e)));
  };
  const compose = async () => { try { setTemplates(await loadTemplates()); } catch (e) { toast(errMsg(e)); } };
  const today = todayISO();
  return (
    <div className="stack">
      <PageHead eyebrow="Ground" title="Contacts" lede="Everyone who has made an account or booked, and messages to them. Only people who said yes to a channel are messaged.">
        <button className="btn" onClick={csv}>Download CSV</button>
        {can(me, 'send_broadcasts') && <button className="btn primary" onClick={compose}>Message these people</button>}
      </PageHead>
      <div className="grid g4">
        <Stat label="People" value={data?.summary.total ?? '—'} />
        <Stat label="Can email" value={data?.summary.reachableEmail ?? '—'} />
        <Stat label="Can WhatsApp" value={data?.summary.reachableWhatsapp ?? '—'} />
        <Stat label="Can text" value={data?.summary.reachableSms ?? '—'} />
      </div>
      <div className="card">
        <div className="card-head"><h3>Customers</h3></div>
        <div className="card-pad">
          <FilterBar>
            <Field label="Show"><Select value={who} onChange={(v) => change(() => setWho(v))} options={[['account', 'Everyone with an account'], ['all', 'Everyone who booked'], ['booked', 'Played or booked ahead'], ['played', 'Have played']]} /></Field>
            <Field label="Ground"><Select value={ground} onChange={(v) => change(() => setGround(v))} options={[['', 'All grounds'], ...(grounds?.items ?? []).map((g) => [g.id, g.name] as [string, string])]} /></Field>
            <Field label="Activity"><Select value={inactive} onChange={(v) => change(() => setInactive(v))} options={[['', 'Any time'], [addDaysISO(today, -30), 'Not played in 30 days'], [addDaysISO(today, -90), 'Not played in 90 days']]} /></Field>
            <Field label="Played at least"><input className="inp" type="number" min="1" inputMode="numeric" placeholder="e.g. 3" value={min} onChange={(e) => change(() => setMin(e.target.value))} /></Field>
            <Field label="Search"><input className="inp" type="search" placeholder="Name, phone or email" value={q} onChange={(e) => change(() => setQ(e.target.value))} /></Field>
            {curate && <Field label="List"><Select value={removed} onChange={(v) => change(() => setRemoved(v))} options={[['', 'Contacts'], ['1', 'Removed people']]} /></Field>}
          </FilterBar>
        </div>
        <Async data={data} error={error}>{(d) => (
          <>
            <Table rows={d.items} rowKey={(c) => c.id} onRow={(c) => go(`/customers/${encodeURIComponent(c.id)}`)} empty={removed ? 'Nobody has been removed.' : 'Nobody matches yet.'} cols={[
              { head: 'Person', cell: (c) => <><a className="strong" href={`#/customers/${encodeURIComponent(c.id)}`} onClick={(e) => e.stopPropagation()}>{c.name}</a><div className="muted small">{[formatPhone(c.phone), c.email].filter(Boolean).join(' · ')}</div></> },
              { head: who === 'played' ? 'Times played' : 'Bookings', num: true, cell: (c) => c.timesPlayed },
              // a booking ahead is not a game played: the last one that has started, and the next one under it
              { head: 'Last played', cell: (c) => <>{c.lastPastAt ? fmtDate(day(c.lastPastAt)) : <span className="muted">{c.timesPlayed ? 'Not yet' : 'Not booked yet'}</span>}{c.nextAt && <div className="muted small">Next {fmtDate(day(c.nextAt))}</div>}</> },
              { head: 'Signed up', cell: (c) => fmtDate(day(c.signedUpAt)) },
              { head: 'Paid', num: true, cell: (c) => (c.paidPaise == null ? '—' : inr(c.paidPaise)) },
              // only the channels this person said yes to (and has an address for): the counts above add these up
              { head: 'Can reach on', cell: (c) => { const on = (['email', 'whatsapp', 'sms'] as const).filter((k) => c.reachable[k]); return on.length ? <div className="row" style={{ gap: 6 }}>{on.map((k) => <Chip key={k} tone="good">{k === 'sms' ? 'SMS' : k === 'email' ? 'Email' : 'WhatsApp'}</Chip>)}</div> : <span className="muted small">No channel agreed</span>; } },
              ...(curate ? [{ head: '', cell: (c: Contact) => <span onClick={(e) => e.stopPropagation()}>{removed ? <button className="btn sm" onClick={() => setGone(c.id, false)}>Put back</button> : <Confirm label="Remove" className="btn ghost sm" ask={`Remove ${c.name} from contacts? Their bookings and payments stay.`} onYes={() => setGone(c.id, true)} />}</span> }] : []),
            ]} />
            <div className="card-pad row" style={{ justifyContent: 'space-between' }}>
              <button className="btn ghost sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>Previous</button>
              <span className="hint">{d.total ? offset + 1 : 0} to {Math.min(offset + LIMIT, d.total)} of {d.total}</span>
              <button className="btn ghost sm" disabled={offset + LIMIT >= d.total} onClick={() => setOffset(offset + LIMIT)}>Next</button>
            </div>
          </>
        )}</Async>
      </div>
      {hist && (
        <div className="card">
          <div className="card-head"><h3>Messages sent</h3></div>
          <Table rows={hist.items} empty="Nothing sent yet." cols={[
            { head: 'When', cell: (b) => fmtDateTime(b.createdAt) },
            { head: 'Channel', cell: (b) => CHAN[b.channel] || b.channel },
            { head: 'Message', cell: (b) => (b.subject || b.body).slice(0, 60) },
            { head: 'Delivered', num: true, cell: (b) => `${b.sent} sent of ${b.queued}` },
          ]} />
        </div>
      )}
      {templates && <Composer filter={filter} templates={templates} onClose={() => setTemplates(null)} onSent={() => { setSent((n) => n + 1); reloadHist(); }} />}
    </div>
  );
}
