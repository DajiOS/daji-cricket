import { useState } from 'react';
import { Chip, Field, PageHead, Stat, Table, useToast } from '../ui';
import { addDaysISO, can, download, fmtDate, fmtDateTime, getViewOwner, inr, qs, todayISO, useApi } from '../lib';
import { useSession } from '../App';
import { Async, FilterBar, Select, errMsg, useDebounced } from '../parts/club/common';
import Composer, { loadTemplates } from '../parts/club/Composer';

interface Contact { id: string; name: string; phone: string | null; email: string | null; timesPlayed: number; lastPlayedAt: number; paidPaise: number | null; reachable: { email: boolean; whatsapp: boolean; sms: boolean } }
interface Result { items: Contact[]; total: number; summary: { total: number; reachableEmail: number; reachableWhatsapp: number; reachableSms: number } }
interface Broadcast { id: string; createdAt: number; channel: string; subject?: string | null; body: string; sent: number; queued: number }
const LIMIT = 50;
const CHAN: Record<string, string> = { whatsapp: 'WhatsApp', email: 'Email', sms: 'Text' };

export default function Contacts({ sub }: { sub: string }) {
  void sub;
  const { me } = useSession(); const toast = useToast();
  const [who, setWho] = useState('booked'); const [ground, setGround] = useState(''); const [inactive, setInactive] = useState(''); const [min, setMin] = useState(''); const [q, setQ] = useState(''); const [offset, setOffset] = useState(0);
  const [templates, setTemplates] = useState<Awaited<ReturnType<typeof loadTemplates>> | null>(null); const [sent, setSent] = useState(0);
  const dq = useDebounced(q), dmin = useDebounced(min);
  const filter: Record<string, string | number> = { who };
  if (ground) filter.groundId = ground; if (inactive) filter.inactiveSince = inactive; if (Number(dmin) > 0) filter.minTimes = Number(dmin); if (dq.trim()) filter.q = dq.trim();
  const [grounds] = useApi<{ items: { id: string; name: string }[] }>('/api/staff/grounds');
  const [data, error] = useApi<Result>('/api/staff/contacts' + qs({ ...filter, limit: LIMIT, offset }));
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
      <PageHead eyebrow="Ground" title="Contacts" lede="Everyone who has booked or played, and messages to them. Only people who said yes to a channel are messaged.">
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
            <Field label="Show"><Select value={who} onChange={(v) => change(() => setWho(v))} options={[['played', 'Have played'], ['booked', 'Played or booked ahead'], ['all', 'Everyone who booked']]} /></Field>
            <Field label="Ground"><Select value={ground} onChange={(v) => change(() => setGround(v))} options={[['', 'All grounds'], ...(grounds?.items ?? []).map((g) => [g.id, g.name] as [string, string])]} /></Field>
            <Field label="Activity"><Select value={inactive} onChange={(v) => change(() => setInactive(v))} options={[['', 'Any time'], [addDaysISO(today, -30), 'Not played in 30 days'], [addDaysISO(today, -90), 'Not played in 90 days']]} /></Field>
            <Field label="Played at least"><input className="inp" type="number" min="1" inputMode="numeric" placeholder="e.g. 3" value={min} onChange={(e) => change(() => setMin(e.target.value))} /></Field>
            <Field label="Search"><input className="inp" type="search" placeholder="Name, phone or email" value={q} onChange={(e) => change(() => setQ(e.target.value))} /></Field>
          </FilterBar>
        </div>
        <Async data={data} error={error}>{(d) => (
          <>
            <Table rows={d.items} empty="Nobody matches yet." cols={[
              { head: 'Person', cell: (c) => <><span className="strong">{c.name}</span><div className="muted small">{[c.phone, c.email].filter(Boolean).join(' · ')}</div></> },
              { head: 'Times', num: true, cell: (c) => c.timesPlayed },
              { head: 'Last played', cell: (c) => fmtDate(new Date(c.lastPlayedAt + 330 * 60000).toISOString().slice(0, 10)) },
              { head: 'Paid', num: true, cell: (c) => (c.paidPaise == null ? '—' : inr(c.paidPaise)) },
              { head: 'Can reach on', cell: (c) => <div className="row" style={{ gap: 6 }}>{(['email', 'whatsapp', 'sms'] as const).map((k) => <Chip key={k} tone={c.reachable[k] ? 'good' : 'mute'}>{k === 'sms' ? 'SMS' : k === 'email' ? 'Email' : 'WhatsApp'}</Chip>)}</div> },
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
