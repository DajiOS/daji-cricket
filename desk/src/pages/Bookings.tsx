import { useEffect, useState } from 'react';
import { useSession } from '../App';
import { PageHead, Tabs, Table, Loading, ErrorBox, Chip, Status, Icon, Filters, Modal, useToast, DateInput } from '../ui';
import { useApi, api, post, go, inr, fmtDay, fmtDateTime, formatPhone, can, qs, todayISO, addDaysISO } from '../lib';
import { type Booking, type Page, BookingChip, METHOD_LABEL, PAY_STATUS, STATUS_LABEL, errText, timeRange, whatOf } from '../parts/dash/common';
import { BookingDetail } from '../parts/dash/Detail';
import { NewBooking } from '../parts/dash/NewBooking';
import { BlockBooking } from '../parts/dash/BlockBooking';
import { DayView } from '../parts/dash/DayView';
import { MonthCalendar, ViewToggle, useView } from '../parts/dash/BookingCalendar';
import { RefundApprovals } from '../parts/admin/Refunds';

type Tab = 'list' | 'day' | 'approvals' | 'payments' | 'refunds';
const SECTIONS = ['day', 'approvals', 'payments'];
const PAGE = 25;

/** Bookings: the list with filters, the day view, approvals and UPI payments to verify. The path after /bookings picks the section or opens a booking. */
export default function Bookings({ sub }: { sub: string }) {
  const { me } = useSession();
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);
  const key = sub.split('/')[0] || '';
  const filterPreset = key === 'review' ? 'review' : key === 'choosing' ? 'choosing' : '';
  const tab: Tab = key === 'day' ? 'day' : key === 'approvals' ? 'approvals' : key === 'payments' ? 'payments' : key === 'refunds' ? 'refunds' : 'list';
  const showAdd = key === 'add';
  const showNew = key === 'new';
  const showBlock = key === 'block';
  const openId = key && !SECTIONS.includes(key) && !['new', 'block', 'add', 'review', 'choosing', 'refunds'].includes(key) ? key : null;
  const asDay = sub.split('/')[1] === 'day';
  const canVerify = can(me, 'verify_payments') || can(me, 'record_payments');
  const [pendingN] = useApi<Page<Booking>>('/api/staff/bookings?approval=pending&limit=1', [version]);
  const tabs: [Tab, string][] = [['list', 'All bookings'], ['day', 'Day view'], ['approvals', `Approvals${pendingN?.total ? ` (${pendingN.total})` : ''}`], ...(canVerify ? [['payments', 'UPI to verify'] as [Tab, string]] : []), ...(me.role === 'super_admin' ? [['refunds', 'Refund approvals'] as [Tab, string]] : [])];
  const toList = () => go('/bookings');

  return (
    <div className="stack">
      <PageHead eyebrow="Ground" title="Bookings" lede="Every session at the ground: who is playing, what has been paid and what is still to collect.">
        <button className="btn primary" onClick={() => go('/bookings/add')}><Icon name="plus" />Add booking</button>
      </PageHead>
      <div><Tabs value={tab} onChange={(t) => go(t === 'list' ? '/bookings' : `/bookings/${t}`)} items={tabs} label="Sections" /></div>
      {tab === 'list' && <List version={version} preset={filterPreset} />}
      {tab === 'day' && <DayView version={version} onChanged={bump} />}
      {tab === 'approvals' && <Approvals version={version} onChanged={bump} />}
      {tab === 'refunds' && <RefundApprovals />}
      {tab === 'payments' && <UpiQueue version={version} onChanged={bump} />}
      {openId && <BookingDetail id={openId} asDay={asDay} onClose={toList} onChanged={bump} />}
      {showAdd && (
        <Modal title="Add booking" onClose={toList}>
          <div className="stack" style={{ gap: 10 }}>
            <button className="card card-pad" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => go('/bookings/new')}><b>Single booking</b><div className="small muted">One session on one day: a match, a net, a practice.</div></button>
            <button className="card card-pad" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => go('/bookings/block')}><b>Multi-day or tournament booking</b><div className="small muted">The same hours over several days for one agreed amount. It can also create the tournament.</div></button>
          </div>
        </Modal>
      )}
      {showBlock && <BlockBooking onClose={toList} onDone={(id) => { bump(); go(`/bookings/${id}`); }} />}
      {showNew && <NewBooking onClose={toList} onDone={(id) => { bump(); go(`/bookings/${id}`); }} />}
    </div>
  );
}

function List({ version, preset }: { version: number; preset: string }) {
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [status, setStatus] = useState('');
  const [groundId, setGroundId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [view, setView] = useView();
  const [grounds] = useApi<{ items: { id: string; name: string }[] }>('/api/staff/grounds');
  useEffect(() => { const t = setTimeout(() => { setDq(q.trim()); setPage(0); }, 300); return () => clearTimeout(t); }, [q]);
  const params = { group: 1, q: dq, status, groundId, from, to, ...(preset === 'review' ? { needsReview: 1 } : {}), ...(preset === 'choosing' ? { resolution: 'awaiting' } : {}), limit: PAGE, offset: page * PAGE };
  const [d, err] = useApi<Page<Booking>>(`/api/staff/bookings${qs(params)}`, [version]);
  const set = (f: (v: string) => void) => (e: any) => { f(e.target.value); setPage(0); };
  const filtered = !!(dq || status || groundId || from || to || preset);
  const clear = () => { setQ(''); setStatus(''); setGroundId(''); setFrom(''); setTo(''); setPage(0); if (preset) go('/bookings'); };
  const pages = d ? Math.max(1, Math.ceil(d.total / PAGE)) : 1;
  const quick = (a: string, b: string) => { setFrom(a); setTo(b); setPage(0); };
  return (
    <div className="card">
      <div className="card-pad row" style={{ gap: 10 }}>
        <input className="inp" style={{ flex: '1 1 260px', width: 'auto' }} type="search" placeholder="Search name, phone or reference" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <Filters inline={false} active={[status, groundId, view === 'list' ? from : '', view === 'list' ? to : ''].filter(Boolean).length}>
          <div className="filters filters2">
            <select className="inp" aria-label="Status" value={status} onChange={set(setStatus)}>
              <option value="">Any status</option>{Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <select className="inp" aria-label="Ground" value={groundId} onChange={set(setGroundId)}>
              <option value="">All grounds</option>{(grounds?.items || []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
            {view === 'list' && <><DateInput className="inp" aria-label="From date" value={from} onChange={set(setFrom)} />
            <DateInput className="inp" aria-label="To date" value={to} onChange={set(setTo)} /></>}
          </div>
        </Filters>
      </div>
      <div className="card-pad row filters-foot">
        <ViewToggle value={view} onChange={setView} />
        {view === 'list' && <><button className="btn sm" onClick={() => quick(todayISO(), todayISO())}>Today</button>
        <button className="btn sm" onClick={() => quick(todayISO(), addDaysISO(todayISO(), 7))}>Next 7 days</button>
        <button className="btn sm" onClick={() => quick(addDaysISO(todayISO(), -30), todayISO())}>Last 30 days</button></>}
        {preset === 'review' && <Chip tone="warn">Needs review</Chip>}{preset === 'choosing' && <Chip tone="info">Customers yet to choose</Chip>}
        {filtered && <button className="btn ghost sm" onClick={clear}>Clear filters</button>}
        {view === 'list' && <span className="muted small" style={{ marginLeft: 'auto' }}>{d ? `${d.total} ${d.total === 1 ? 'booking' : 'bookings'}` : ''}</span>}
      </div>
      {view === 'calendar' ? <div className="card-pad"><MonthCalendar filters={{ q: dq, status, groundId, ...(preset === 'review' ? { needsReview: '1' } : {}), ...(preset === 'choosing' ? { resolution: 'awaiting' } : {}) }} onOpen={(id) => go(`/bookings/${id}`)} /></div> : err ? <div className="card-pad"><ErrorBox msg={err} /></div> : !d ? <div className="card-pad"><Loading h={240} /></div> : (
        <>
          <Table rows={d.items} onRow={(b) => go(`/bookings/${b.id}`)} empty={filtered ? 'No bookings match those filters.' : 'No bookings yet. New ones appear here.'} cols={[
            { head: 'When', cell: (b) => b.block ? <><div className="strong">{fmtDay(b.block.fromDate)} – {fmtDay(b.block.toDate)}</div><div className="small muted tabular">{b.block.days} days · {timeRange(b)} daily</div></> : <><div className="strong">{fmtDay(b.date)}</div><div className="small muted tabular">{timeRange(b)}</div></> },
            { head: 'Customer', cell: (b) => <><div className="strong">{b.customerName}</div><div className="small muted">{formatPhone(b.customerPhone)}</div></> },
            { head: 'Ground', cell: (b) => <>{b.groundName}<div className="small muted">{b.block ? 'Multi-day booking' : whatOf(b)}</div></> },
            { head: 'Status', cell: (b) => <span className="row" style={{ gap: 6 }}><BookingChip b={b} />{b.block && <Chip tone="info">Multi-day</Chip>}{b.block?.tournament && <a href={`#/tournaments/${b.block.tournament.id}`} onClick={(e) => { e.stopPropagation(); go('/tournaments/' + b.block!.tournament!.id); e.preventDefault(); }}><Chip tone="gold">Tournament: {b.block.tournament.name}</Chip></a>}{b.needsReview && <Chip tone="warn">Review</Chip>}</span> },
            { head: 'Total', num: true, cell: (b) => inr(b.block ? b.block.totalPaise : b.totalPaise) },
            { head: 'Paid', num: true, cell: (b) => {
              const k = b.block, gone = k ? k.cancelled : b.status === 'cancelled', paid = k ? k.paidPaise : b.paidPaise;
              const refunded = k ? k.refundedPaise : b.refundPaise, credit = k ? k.creditedPaise : b.creditPaise, waiting = k ? k.awaitingPaise > 0 : b.resolution === 'awaiting';
              return <>{inr(paid)}{gone && paid > 0 && (waiting ? <div className="small warnText">refund waiting for customer</div> : (refunded > 0 || credit > 0) ? <div className="small muted">{refunded > 0 ? `${inr(refunded)} refunded` : ''}{refunded > 0 && credit > 0 ? ' · ' : ''}{credit > 0 ? `${inr(credit)} credit` : ''}</div> : null)}</>; } },
            { head: 'Balance', num: true, cell: (b) => { const bal = b.block ? b.block.balancePaise : b.balancePaise; return (b.status === 'confirmed' && bal > 0 ? <b className="warnText">{inr(bal)}</b> : <span className="muted">—</span>); } },
            { head: 'Ref', cell: (b) => <span className="mono small muted">{b.ref}</span> },
          ]} />
          {d.total > PAGE && (
            <div className="card-pad row" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--line)' }}>
              <span className="muted small">Page {page + 1} of {pages}</span>
              <span className="row"><button className="btn sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><button className="btn sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</button></span>
            </div>)}
        </>)}
    </div>
  );
}

function Approvals({ version, onChanged }: { version: number; onChanged: () => void }) {
  const toast = useToast();
  const [d, err, reload] = useApi<Page<Booking>>('/api/staff/bookings?approval=pending&limit=100', [version]);
  const [msg, setMsg] = useState<string | null>(null);
  const approve = async (b: Booking) => {
    setMsg(null);
    try { await post(`/api/staff/bookings/${encodeURIComponent(b.id)}/approve`, {}); toast('Approved. The customer has been told.'); reload(); onChanged(); } catch (e) { setMsg(errText(e)); }
  };
  if (err) return <ErrorBox msg={err} />;
  if (!d) return <Loading h={200} />;
  const rows = d.items.slice().sort((a, b) => a.startAt - b.startAt);
  return (
    <div className="card">
      <div className="card-head"><h3>Waiting for your approval</h3><span className="muted small">The deposit is holding the slot</span></div>
      {msg && <div className="card-pad"><ErrorBox msg={msg} /></div>}
      <Table rows={rows} empty="Nothing is waiting. New paid bookings appear here." cols={[
        { head: 'When', cell: (b) => <><div className="strong">{fmtDay(b.date)}</div><div className="small muted tabular">{timeRange(b)}</div></> },
        { head: 'Customer', cell: (b) => <><div className="strong">{b.customerName}</div><div className="small muted">{formatPhone(b.customerPhone)}</div></> },
        { head: 'Ground', cell: (b) => <>{b.groundName}<div className="small muted">{whatOf(b)}</div></> },
        { head: 'Deposit', num: true, cell: (b) => <>{inr(b.paidPaise)}<div className="small muted">of {inr(b.totalPaise)}</div></> },
        { head: '', cell: (b) => <span className="row" style={{ gap: 6, flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
          <button className="btn sm ghost" onClick={() => go(`/bookings/${b.id}`)}>Open</button><button className="btn sm primary" onClick={() => approve(b)}>Approve</button></span> },
      ]} />
    </div>
  );
}

interface Pay { id: string; bookingId: string; method: string; status: string; amountPaise: number; reference: string | null; submittedAt: number | null; createdAt: number }
function UpiQueue({ version, onChanged }: { version: number; onChanged: () => void }) {
  const { me } = useSession();
  const toast = useToast();
  const [d, err, reload] = useApi<Page<Pay>>('/api/staff/payments?status=submitted&limit=50', [version]);
  const [books, setBooks] = useState<Record<string, Booking>>({});
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!d) return;
    const ids = [...new Set(d.items.map((p) => p.bookingId))].filter((i) => !books[i]);
    ids.forEach((id) => api<{ booking: Booking }>(`/api/staff/bookings/${encodeURIComponent(id)}`).then((r) => setBooks((s) => ({ ...s, [id]: r.booking }))).catch(() => {}));
  }, [d]); // eslint-disable-line
  const verify = async (p: Pay, approve: boolean) => {
    setMsg(null);
    try { await post(`/api/staff/payments/${encodeURIComponent(p.id)}/verify`, approve ? { approve: true } : { approve: false, reason: 'Not received' }); toast(approve ? 'Payment verified.' : 'Payment rejected.'); reload(); onChanged(); } catch (e) { setMsg(errText(e)); }
  };
  if (err) return <ErrorBox msg={err} />;
  if (!d) return <Loading h={200} />;
  const ok = can(me, 'verify_payments');
  return (
    <div className="card">
      <div className="card-head"><h3>UPI payments to verify</h3><span className="muted small">Check your bank for each one, then verify</span></div>
      {msg && <div className="card-pad"><ErrorBox msg={msg} /></div>}
      <Table rows={d.items} empty="No UPI payments are waiting." cols={[
        { head: 'Sent', cell: (p) => fmtDateTime(p.submittedAt || p.createdAt) },
        { head: 'Booking', cell: (p) => { const b = books[p.bookingId]; return b ? <><div className="strong">{b.customerName}</div><div className="small muted">{fmtDay(b.date)}, {timeRange(b)} · {b.groundName}</div></> : <span className="muted">…</span>; } },
        { head: 'Reference', cell: (p) => <span className="mono small">{p.reference || '—'}</span> },
        { head: 'Status', cell: (p) => <Status s={p.status} map={PAY_STATUS} /> },
        { head: 'Amount', num: true, cell: (p) => <><b>{inr(p.amountPaise)}</b><div className="small muted">{METHOD_LABEL[p.method]}</div></> },
        { head: '', cell: (p) => <span className="row" style={{ gap: 6, flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
          <button className="btn sm ghost" onClick={() => go(`/bookings/${p.bookingId}`)}>Open</button>
          {ok && <><button className="btn sm primary" onClick={() => verify(p, true)}>Verify</button><button className="btn sm" onClick={() => verify(p, false)}>Reject</button></>}</span> },
      ]} />
    </div>
  );
}
