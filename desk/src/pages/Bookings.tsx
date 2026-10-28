import { useEffect, useState } from 'react';
import { useSession } from '../App';
import { PageHead, Tabs, Table, Loading, ErrorBox, Chip, Icon, Filters, Modal, DateInput } from '../ui';
import { useApi, go, inr, fmtDay, formatPhone, qs, todayISO, addDaysISO } from '../lib';
import { type Booking, type Page, BookingChip, STATUS_LABEL, timeRange, whatOf } from '../parts/dash/common';
import { BookingDetail } from '../parts/dash/Detail';
import { NewBooking } from '../parts/dash/NewBooking';
import { BlockBooking } from '../parts/dash/BlockBooking';
import { DayView } from '../parts/dash/DayView';
import { MonthCalendar, ViewToggle, useView } from '../parts/dash/BookingCalendar';
import { RefundApprovals } from '../parts/admin/Refunds';

// Bookings to approve and UPI to verify are on the Approvals board now (/approvals/book and /approvals/upi); the old addresses open it there.
type Tab = 'list' | 'day' | 'refunds';
const SECTIONS = ['day'];
const PAGE = 25;

/** Bookings: the list with filters and the day view. The path after /bookings picks the section or opens a booking. */
export default function Bookings({ sub }: { sub: string }) {
  const { me } = useSession();
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);
  const key = sub.split('/')[0] || '';
  const filterPreset = key === 'review' ? 'review' : key === 'choosing' ? 'choosing' : key === 'upcoming' ? 'upcoming' : '';
  const tab: Tab = key === 'day' ? 'day' : key === 'refunds' ? 'refunds' : 'list';
  const showAdd = key === 'add';
  const showNew = key === 'new';
  const showBlock = key === 'block';
  const openId = key && !SECTIONS.includes(key) && !['new', 'block', 'add', 'review', 'choosing', 'upcoming', 'refunds'].includes(key) ? key : null;
  const asDay = sub.split('/')[1] === 'day';
  const tabs: [Tab, string][] = [['list', 'All bookings'], ['day', 'Day view'], ...(me.role === 'super_admin' ? [['refunds', 'Refund approvals'] as [Tab, string]] : [])];
  const toList = () => go('/bookings');

  return (
    <div className="stack">
      {filterPreset === 'review'
        ? <PageHead eyebrow="Work" title="Exceptions" lede="Bookings that need a second look: a payment that came in after the hold ran out, a clash, or anything else the server flagged. Open one to sort it, then mark it reviewed." />
        : <PageHead eyebrow="Ground" title="Bookings" lede="Every session at the ground: who is playing, what has been paid and what is still to collect.">
            <button className="btn primary" onClick={() => go('/bookings/add')}><Icon name="plus" />Add booking</button>
          </PageHead>}
      {filterPreset !== 'review' && <div><Tabs value={tab} onChange={(t) => go(t === 'list' ? '/bookings' : `/bookings/${t}`)} items={tabs} label="Sections" /></div>}
      {tab === 'list' && <List version={version} preset={filterPreset} />}
      {tab === 'day' && <DayView version={version} onChanged={bump} />}
      {tab === 'refunds' && <RefundApprovals />}
      {openId && <BookingDetail key={openId} id={openId} asDay={asDay} tab={sub.split('/')[1]} onClose={toList} onChanged={bump} />}
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
  const [saved, setView] = useView();
  // the bookings still to come are a list by date, whichever view was used last
  const view = preset === 'upcoming' ? 'list' : saved;
  const [grounds] = useApi<{ items: { id: string; name: string }[] }>('/api/staff/grounds');
  useEffect(() => { const t = setTimeout(() => { setDq(q.trim()); setPage(0); }, 300); return () => clearTimeout(t); }, [q]);
  const params = { group: 1, q: dq, status, groundId, from, to, ...(preset === 'review' ? { needsReview: 1 } : {}), ...(preset === 'choosing' ? { resolution: 'awaiting' } : {}), ...(preset === 'upcoming' ? { upcoming: 1 } : {}), limit: PAGE, offset: page * PAGE };
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
        {preset !== 'upcoming' && <ViewToggle value={view} onChange={setView} />}
        {view === 'list' && <><button className="btn sm" onClick={() => quick(todayISO(), todayISO())}>Today</button>
        <button className="btn sm" onClick={() => quick(todayISO(), addDaysISO(todayISO(), 7))}>Next 7 days</button>
        <button className="btn sm" onClick={() => quick(addDaysISO(todayISO(), -30), todayISO())}>Last 30 days</button></>}
        {preset === 'review' && <Chip tone="warn">Needs review</Chip>}{preset === 'choosing' && <Chip tone="info">Customers yet to choose</Chip>}{preset === 'upcoming' && <Chip tone="info">Still to come, soonest first</Chip>}
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
              const kept = gone && !waiting ? Math.max(paid - refunded - credit, 0) : paid; // after a refund, Paid is what the ground still holds
              return <>{inr(kept)}{gone && paid > 0 && (waiting ? <div className="small warnText">refund waiting for customer</div> : (refunded > 0 || credit > 0) ? <div className="small muted">{refunded > 0 ? `${inr(refunded)} refunded` : ''}{refunded > 0 && credit > 0 ? ' · ' : ''}{credit > 0 ? `${inr(credit)} credit` : ''}</div> : null)}</>; } },
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
