// The two booking queues the Approvals board opens when filtered to Booking approvals or UPI payments (/approvals/book, /approvals/upi):
// the full table under the board, with the customer, the slot and the reference. They used to be the Approvals and UPI to verify tabs of Bookings.
import { useEffect, useState } from 'react';
import { useSession } from '../../App';
import { Table, Loading, ErrorBox, Status, useToast } from '../../ui';
import { useApi, api, post, go, inr, fmtDay, fmtDateTime, formatPhone, can } from '../../lib';
import { type Booking, type Page, METHOD_LABEL, PAY_STATUS, errText, timeRange, whatOf } from './common';

/** Bookings whose advance is holding the slot until someone approves them. */
export function BookingQueue({ version, onChanged }: { version: number; onChanged: () => void }) {
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
      <div className="card-head"><h3>Waiting for your approval</h3><span className="muted small">The advance is holding the slot</span></div>
      {msg && <div className="card-pad"><ErrorBox msg={msg} /></div>}
      <Table rows={rows} empty="Nothing is waiting. New paid bookings appear here." cols={[
        { head: 'When', cell: (b) => <><div className="strong">{fmtDay(b.date)}</div><div className="small muted tabular">{timeRange(b)}</div></> },
        { head: 'Customer', cell: (b) => <><div className="strong">{b.customerName}</div><div className="small muted">{formatPhone(b.customerPhone)}</div></> },
        { head: 'Ground', cell: (b) => <>{b.groundName}<div className="small muted">{whatOf(b)}</div></> },
        { head: 'Paid', num: true, cell: (b) => <>{inr(b.paidPaise)}<div className="small muted">of {inr(b.totalPaise)}</div></> },
        { head: '', cell: (b) => <span className="row" style={{ gap: 6, flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
          <button className="btn sm ghost" onClick={() => go(`/bookings/${b.id}`)}>Open</button><button className="btn sm primary" onClick={() => approve(b)}>Approve</button></span> },
      ]} />
    </div>
  );
}

interface Pay { id: string; bookingId: string; method: string; status: string; amountPaise: number; reference: string | null; submittedAt: number | null; createdAt: number }
/** UPI payments customers say they sent, to check against the bank. */
export function UpiQueue({ version, onChanged }: { version: number; onChanged: () => void }) {
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

/** The table for one queue, as the Approvals board opens it. */
export default function Queues({ kind, version, onChanged }: { kind: 'book' | 'upi'; version: number; onChanged: () => void }) {
  return kind === 'book' ? <BookingQueue version={version} onChanged={onChanged} /> : <UpiQueue version={version} onChanged={onChanged} />;
}
