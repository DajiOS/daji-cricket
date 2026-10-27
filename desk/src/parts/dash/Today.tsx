// Today's schedule and the "needs you" list for the dashboard.
import { useState } from 'react';
import { Chip, Empty, Loading, ErrorBox, Table, useToast } from '../../ui';
import { post, inr, fmtDay, useApi } from '../../lib';
import { type Booking, type Page, BookingChip, CancelDialog, cancellable, errText, timeRange } from './common';
import { BookingDetail } from './Detail';

export interface TodayData { date: string; bookings: Booking[]; awaitingVerification: number; needsReview: number }

/** Sessions on today's date, in time order, each opening its booking. */
export function Schedule({ data, err, onChanged }: { data: TodayData | null; err: string | null; onChanged: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [cancel, setCancel] = useState<Booking | null>(null);
  const toast = useToast();
  if (err) return <ErrorBox msg={err} />;
  if (!data) return <Loading h={160} />;
  const rows = data.bookings.slice().sort((a, b) => a.startAt - b.startAt);
  return (
    <>
      <Table rows={rows} onRow={(b) => setOpen(b.id)} empty="No sessions today." cols={[
        { head: 'Time', cell: (b) => <span className="strong tabular">{timeRange(b)}</span> },
        { head: 'Session', cell: (b) => <><div className="strong">{b.customerName}</div><div className="small muted">{b.groundName}{b.formatLabel ? ` · ${b.formatLabel}` : ''}</div></> },
        { head: 'Status', cell: (b) => <BookingChip b={b} /> },
        { head: 'To collect', num: true, cell: (b) => (b.status === 'confirmed' && b.balancePaise > 0 ? <b className="warnText">{inr(b.balancePaise)}</b> : <span className="muted">—</span>) },
        { head: '', cell: (b) => (cancellable(b) && b.paidPaise > 0 ? <button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); setCancel(b); }}>Cancel…</button> : null) },
      ]} />
      {open && <BookingDetail id={open} onClose={() => setOpen(null)} onChanged={onChanged} />}
      {cancel && <CancelDialog b={cancel} onClose={() => setCancel(null)} onDone={() => { setCancel(null); toast('Cancelled. The customer has been told.'); onChanged(); }} />}
    </>
  );
}

/** Everything waiting on a person: approvals first, then payments to verify, flagged bookings and customers still to choose. */
export function Attention({ today, canBookings, canVerify, onChanged, version }: { today: TodayData | null; canBookings: boolean; canVerify: boolean; onChanged: () => void; version: number }) {
  const toast = useToast();
  const [pending, perr, reloadPending] = useApi<Page<Booking>>(canBookings ? '/api/staff/bookings?approval=pending&limit=50' : null, [version]);
  const [awaiting] = useApi<Page<Booking>>(canBookings ? '/api/staff/bookings?resolution=awaiting&limit=1' : null, [version]);
  const [decline, setDecline] = useState<Booking | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const refresh = () => { reloadPending(); onChanged(); };
  const approve = async (b: Booking) => {
    setMsg(null);
    try { await post(`/api/staff/bookings/${encodeURIComponent(b.id)}/approve`, {}); toast('Approved. The customer has been told.'); refresh(); } catch (e) { setMsg(errText(e)); }
  };
  if (!canBookings) return <Empty>Your role does not include bookings.</Empty>;
  if (perr) return <ErrorBox msg={perr} />;
  if (!pending || !today) return <Loading h={160} />;
  const items = pending.items.slice().sort((a, b) => a.startAt - b.startAt);
  const nVerify = canVerify ? today.awaitingVerification : 0;
  const nReview = today.needsReview, nChoose = awaiting?.total || 0;
  const nothing = !items.length && !nVerify && !nReview && !nChoose;
  return (
    <div>
      <ErrorBox msg={msg} />
      {nothing && <Empty>Nothing is waiting. New paid bookings appear here.</Empty>}
      {items.map((b) => (
        <div key={b.id} className="attn">
          <div className="attn-main">
            <div className="strong">{b.customerName} <span className="muted small">· {b.groundName}</span></div>
            <div className="small muted">{fmtDay(b.date)}, {timeRange(b)}{b.formatLabel ? ` · ${b.formatLabel}` : ''} · deposit {inr(b.paidPaise)} of {inr(b.totalPaise)}</div>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
            <button className="btn sm primary" onClick={() => approve(b)}>Approve</button>
            <button className="btn sm ghost" onClick={() => setDecline(b)}>Decline…</button>
          </div>
        </div>
      ))}
      {nVerify > 0 && <a className="attn link" href="#/bookings/payments"><div className="attn-main"><div className="strong">UPI payments to verify</div><div className="small muted">Customers say they have paid; check your bank.</div></div><Chip tone="warn">{nVerify}</Chip></a>}
      {nReview > 0 && <a className="attn link" href="#/bookings/review"><div className="attn-main"><div className="strong">Bookings flagged for review</div><div className="small muted">Something about the payment or slot needs a look.</div></div><Chip tone="warn">{nReview}</Chip></a>}
      {nChoose > 0 && <a className="attn link" href="#/bookings/choosing"><div className="attn-main"><div className="strong">Customers yet to choose</div><div className="small muted">You cancelled; they pick a refund, credit or another slot.</div></div><Chip tone="info">{nChoose}</Chip></a>}
      {decline && <CancelDialog b={decline} onClose={() => setDecline(null)} onDone={() => { setDecline(null); toast('Cancelled. The customer has been told and can choose a refund, credit or another slot.'); refresh(); }} />}
    </div>
  );
}
