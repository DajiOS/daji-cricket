import { useState } from 'react';
import { PageHead, Tabs, Table, Status, Modal, Field, ErrorBox, Load, useToast } from '../ui';
import { useApi, post, go, qs, inr, toPaise, fmtDay, fmtDateTime, formatPhone, can } from '../lib';
import { useSession } from '../App';
import { useDebounced } from '../parts/club/common';
import { errText } from '../parts/dash/common';

// Enquiries from the website and the app: who asked, for what, and where each one stands. The server keeps the status, the notes and the
// quotations; this page lists them, adds notes and quotations, and closes them. Turning one into a booking is done from the booking form.
type St = 'new' | 'follow_up' | 'quoted' | 'converted' | 'closed';
interface Quote { id: string; amountPaise: number; validUntil: number | null; details: string | null; status: string; createdAt: number }
interface Note { id: string; kind: string; body: string; createdAt: number }
interface Enquiry { id: string; groundName: string | null; name: string; phone: string; email: string | null; preferredDate: string | null; players: number | null; message: string; status: St; closedReason: string | null; bookingId: string | null; quotations: Quote[]; notes: Note[]; createdAt: number; updatedAt: number }
const STATUS: Record<string, ['good' | 'warn' | 'bad' | 'mute' | 'info' | 'gold', string]> = { new: ['warn', 'New'], follow_up: ['info', 'Following up'], quoted: ['gold', 'Quoted'], converted: ['good', 'Booked'], closed: ['mute', 'Closed'] };
const TABS: [string, string][] = [['all', 'All'], ['new', 'New'], ['follow_up', 'Following up'], ['quoted', 'Quoted'], ['converted', 'Booked'], ['closed', 'Closed']];
const LIMIT = 50;

export default function Enquiries({ sub }: { sub: string }) {
  const { me } = useSession();
  const id = sub.split('/')[0];
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [tick, setTick] = useState(0);
  const dq = useDebounced(q);
  const [d, err, reload, status] = useApi<{ items: Enquiry[]; total: number }>('/api/staff/enquiries' + qs({ status: tab === 'all' ? undefined : tab, q: dq.trim() || undefined, limit: LIMIT, offset }), [tick]);
  return (
    <div className="stack">
      <PageHead eyebrow="Customers" title="Enquiries" lede="Questions about booking the ground, tournaments and the academy, sent from the website and the app. Note each call, send a price, and close it when it is done." />
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <Tabs value={tab} onChange={(t) => { setTab(t); setOffset(0); }} items={TABS} label="Enquiry status" />
        <input className="inp" type="search" aria-label="Search enquiries" placeholder="Name, phone or message" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} style={{ maxWidth: 280 }} />
      </div>
      {!can(me, 'manage_enquiries') && me.role === 'staff' ? <Load data={null} error="forbidden" status={403}>{() => null}</Load> : (
        <div className="card">
          <Load data={d ? { rows: d.items, total: d.total } : null} error={err} status={status} retry={reload} isEmpty={(x) => !x.rows.length} empty={dq ? 'No enquiry matches that search.' : 'No enquiries here.'}>{(x) => (
            <>
              <Table rows={x.rows} rowKey={(e) => e.id} onRow={(e) => go(`/enquiries/${e.id}`)} cols={[
                { head: 'From', cell: (e) => <><a className="strong" href={`#/enquiries/${e.id}`} onClick={(ev) => ev.stopPropagation()}>{e.name}</a><div className="small muted">{formatPhone(e.phone)}</div></> },
                { head: 'For', cell: (e) => <>{e.groundName ?? 'Any ground'}{e.preferredDate && <div className="small muted">{fmtDay(e.preferredDate)}{e.players ? ` · ${e.players} players` : ''}</div>}</> },
                { head: 'Message', cell: (e) => <span className="small">{e.message.slice(0, 90)}{e.message.length > 90 ? '…' : ''}</span> },
                { head: 'Status', cell: (e) => <Status s={e.status} map={STATUS} /> },
                { head: 'Received', cell: (e) => fmtDateTime(e.createdAt) },
              ]} />
              <div className="card-pad row" style={{ justifyContent: 'space-between' }}>
                <button className="btn ghost sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>Previous</button>
                <span className="hint">{d!.total ? offset + 1 : 0} to {Math.min(offset + LIMIT, d!.total)} of {d!.total}</span>
                <button className="btn ghost sm" disabled={offset + LIMIT >= d!.total} onClick={() => setOffset(offset + LIMIT)}>Next</button>
              </div>
            </>)}</Load>
        </div>)}
      {id && <EnquiryDetail id={id} onClose={() => go('/enquiries')} onChanged={() => setTick((t) => t + 1)} />}
    </div>
  );
}

function EnquiryDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [d, err, reload, status] = useApi<Enquiry>(`/api/staff/enquiries/${encodeURIComponent(id)}`);
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');
  const [details, setDetails] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (path: string, body: unknown, done: string, after?: () => void) => {
    setBusy(true); setMsg(null);
    try { await post(`/api/staff/enquiries/${encodeURIComponent(id)}/${path}`, body); toast(done); after?.(); reload(); onChanged(); } catch (e) { setMsg(errText(e)); } finally { setBusy(false); }
  };
  const live = d && d.status !== 'converted' && d.status !== 'closed';
  return (
    <Modal title={d ? `Enquiry from ${d.name}` : 'Enquiry'} onClose={onClose} wide foot={<button className="btn ghost" onClick={onClose}>Close</button>}>
      <Load data={d} error={err} status={status} retry={reload}>{(e) => (
        <div className="stack" style={{ gap: 16 }}>
          <div className="row"><Status s={e.status} map={STATUS} />{e.closedReason && <span className="small muted">{e.closedReason}</span>}{e.bookingId && <a className="small" href={`#/bookings/${e.bookingId}`}>Open the booking</a>}</div>
          <div className="facts">
            <div><span>Phone</span><b>{formatPhone(e.phone)}</b></div>
            <div><span>Email</span><b>{e.email ?? '—'}</b></div>
            <div><span>Ground</span><b>{e.groundName ?? 'Any'}</b></div>
            <div><span>Date wanted</span><b>{e.preferredDate ? fmtDay(e.preferredDate) : '—'}</b>{e.players ? <div className="small muted">{e.players} players</div> : null}</div>
            <div><span>Received</span><b>{fmtDateTime(e.createdAt)}</b></div>
          </div>
          <div className="card card-pad small" style={{ whiteSpace: 'pre-wrap' }}>{e.message}</div>
          <ErrorBox msg={msg} />
          <div>
            <div className="eyebrow">Prices sent</div>
            <Table rows={e.quotations} rowKey={(x) => x.id} empty="No price sent yet." cols={[
              { head: 'Sent', cell: (x) => fmtDateTime(x.createdAt) },
              { head: 'Amount', num: true, cell: (x) => inr(x.amountPaise) },
              { head: 'Details', cell: (x) => x.details ?? '' },
              { head: 'Status', cell: (x) => x.status },
            ]} />
          </div>
          <div>
            <div className="eyebrow">Notes</div>
            {e.notes.length ? <ol className="timeline">{e.notes.map((n) => <li key={n.id} className="small"><span className="muted">{fmtDateTime(n.createdAt)}</span> · {n.kind === 'status' ? <i>{n.body.replace(/_/g, ' ')}</i> : n.body}</li>)}</ol> : <div className="small muted">No notes yet.</div>}
          </div>
          {live && (
            <div className="grid g3">
              <div className="stack" style={{ gap: 6 }}>
                <Field label="Add a note"><textarea className="inp" rows={2} maxLength={1000} value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="Called, asked to ring back on Friday" /></Field>
                <div className="row"><button className="btn sm" disabled={busy || !note.trim()} onClick={() => act('notes', { body: note.trim(), kind: 'contact' }, 'Note saved.', () => setNote(''))}>Save as a call</button>
                  <button className="btn sm ghost" disabled={busy || !note.trim()} onClick={() => act('notes', { body: note.trim(), kind: 'note' }, 'Note saved.', () => setNote(''))}>Save as a note</button></div>
              </div>
              <div className="stack" style={{ gap: 6 }}>
                <Field label="Send a price (₹)"><input className="inp" inputMode="decimal" value={amount} onChange={(ev) => setAmount(ev.target.value)} /></Field>
                <Field label="What it covers"><input className="inp" maxLength={1000} value={details} onChange={(ev) => setDetails(ev.target.value)} /></Field>
                <div><button className="btn sm primary" disabled={busy} onClick={() => { const p = toPaise(amount); if (!p || p < 100) { setMsg('Enter the price in rupees.'); return; } act('quotations', { amountPaise: p, details: details.trim() || undefined }, 'Price sent to the customer.', () => { setAmount(''); setDetails(''); }); }}>Send price</button></div>
              </div>
              <div className="stack" style={{ gap: 6 }}>
                <Field label="Close it, because"><input className="inp" maxLength={300} value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="Booked elsewhere" /></Field>
                <div><button className="btn sm danger" disabled={busy || reason.trim().length < 2} onClick={() => act('close', { reason: reason.trim() }, 'Enquiry closed.')}>Close enquiry</button></div>
              </div>
            </div>)}
        </div>)}</Load>
    </Modal>
  );
}
