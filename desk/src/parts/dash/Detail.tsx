// One booking: who, when, money, payments, and everything staff can do to it.
import { useState } from 'react';
import { Modal, Chip, Loading, ErrorBox, Field, Status, Table, Confirm, Load, useToast } from '../../ui';
import { LinkedDocs } from '../docs/LinkedDocs';
import { useApi, post, api, go, inr, toPaise, rupees, fmtDay, fmtDateTime, formatPhone, can } from '../../lib';
import { useSession } from '../../App';
import { DepositPanel } from './Deposit';
import { MoveBookingDialog } from './MoveBooking';
import { type Booking, type Block, type RefundItem, RefundList, BookingChip, CancelDialog, SettleChoice, HAND_METHODS, METHOD_LABEL, PAY_STATUS, SOURCE_LABEL, STATUS_LABEL, cancellable, errText, timeRange, whatOf } from './common';

interface Pay { id: string; method: string; status: string; purpose: string; amountPaise: number; refundedPaise: number; reference: string | null; createdAt: number; rejectReason: string | null }
interface Detail { booking: Booking; block: Block | null; payments: Pay[]; refunds: RefundItem[]; audit: { id: number; at: number; action: string; actorRole: string | null }[] }

/** The owner deletes a cancelled booking (every day of a multi-day one) from every screen; the books keep the record. */
const isOwner = (role: string) => role === 'owner' || role === 'super_admin';
function DeleteBooking({ id, onDone, onError }: { id: string; onDone: () => void; onError: (m: string) => void }) {
  return <Confirm className="btn danger" label="Delete booking" ask="Delete it from every screen for good? The books keep their record."
    onYes={async () => { try { await post(`/api/staff/bookings/${encodeURIComponent(id)}/delete`, {}); onDone(); } catch (e) { onError(errText(e)); } }} />;
}

const ACTION_LABEL = (a: string) => a.replace(/^booking\./, '').replace(/[._]/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** The workspace tabs of one booking. Each has its own address, /bookings/<id>/<tab>, so a link opens the booking on that tab. */
export const BOOKING_TABS: [string, string][] = [['summary', 'Summary'], ['customer', 'Customer'], ['money', 'Money'], ['match', 'Match'], ['messages', 'Messages'], ['documents', 'Documents'], ['timeline', 'Timeline']];

export function BookingDetail({ id, asDay, tab: tabIn, onClose, onChanged }: { id: string; asDay?: boolean; tab?: string; onClose: () => void; onChanged: () => void }) {
  // opened from its own address (the Bookings page passes the tab), a tab change also updates the address so a reload or a copied link lands on it
  const linked = tabIn !== undefined;
  const { me } = useSession();
  const toast = useToast();
  const [d, err, reload] = useApi<Detail>(`/api/staff/bookings/${encodeURIComponent(id)}`);
  const [pay, setPay] = useState(false);
  const [inv, setInv] = useState<Invoice | null>(null);
  const [cancel, setCancel] = useState(false);
  const [disc, setDisc] = useState(false);
  const [move, setMove] = useState(tabIn === 'move');
  const [tab, setTab] = useState(BOOKING_TABS.some(([k]) => k === tabIn) ? tabIn! : 'summary');
  const [refundOf, setRefundOf] = useState<Pay | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const changed = () => { reload(); onChanged(); };
  const act = async (path: string, body: unknown, done: string) => {
    setMsg(null);
    try { await post(`/api/staff/bookings/${encodeURIComponent(id)}/${path}`, body); toast(done); changed(); } catch (e) { setMsg(errText(e)); }
  };
  const verify = async (p: Pay, approve: boolean) => {
    setMsg(null);
    try { await post(`/api/staff/payments/${encodeURIComponent(p.id)}/verify`, approve ? { approve: true } : { approve: false, reason: 'Not received' }); toast(approve ? 'Payment verified.' : 'Payment rejected.'); changed(); } catch (e) { setMsg(errText(e)); }
  };

  if (!d) return <Modal title="Booking" onClose={onClose}>{err ? <ErrorBox msg={err} /> : <Loading h={180} />}</Modal>;
  if (d.block && !asDay) return <BlockDetail d={d} onClose={onClose} onChanged={changed} />;
  const b = d.booking;
  const canPay = can(me, 'record_payments') && (b.status === 'confirmed' || b.status === 'held' || b.status === 'completed') && b.balancePaise > 0;
  const started = b.startAt <= Date.now();
  const canMove = can(me, 'manage_bookings') && b.status === 'confirmed' && !started && !b.seriesId;
  return (
    <>
    <Modal title={`Booking ${b.ref}`} onClose={onClose} wide
      foot={<>
        {b.needsReview && <button className="btn" onClick={() => act('review-done', {}, 'Marked as reviewed.')}>Mark as reviewed</button>}
        {b.status === 'confirmed' && b.approval === 'pending' && <button className="btn primary" onClick={() => act('approve', {}, 'Approved. The customer has been told.')}>Approve</button>}
        {(b.status === 'confirmed' || b.status === 'completed') && b.paidPaise > 0 && <button className="btn" onClick={async () => { try { setInv(await api<Invoice>(`/api/bookings/${encodeURIComponent(b.id)}/invoice`)); } catch (e) { toast(errText(e)); } }}>Invoice</button>}
        {canPay && <button className="btn primary" onClick={() => setPay(true)}>Record a payment</button>}
        {can(me, 'manage_bookings') && (b.status === 'confirmed' || b.status === 'completed') && b.balancePaise > 0 && <button className="btn" onClick={() => setDisc(true)}>Give a discount</button>}
        {canMove && <button className="btn" id="move-booking" onClick={() => setMove(true)}>Move booking</button>}
        {b.status === 'confirmed' && started && <Confirm label="Mark no-show" ask="No refund, no credit?" onYes={() => act('no-show', {}, 'Marked as a no-show.')} />}
        {cancellable(b) && <button className="btn danger" onClick={() => setCancel(true)}>Cancel booking</button>}
        {isOwner(me.role) && (b.status === 'cancelled' || b.status === 'expired') && !b.deletedAt && <DeleteBooking id={b.id} onError={setMsg} onDone={() => { toast('Booking deleted.'); onChanged(); onClose(); }} />}
        <button className="btn ghost" onClick={onClose}>Close</button>
      </>}>
      <div className="stack" style={{ gap: 18 }}>
        <div className="row"><BookingChip b={b} />{b.needsReview && <Chip tone="warn">Needs review</Chip>}<Chip tone="mute">{SOURCE_LABEL[b.source] || b.source}</Chip>
          {b.status === 'held' && b.holdExpiresAt && <span className="small muted">Hold ends {fmtDateTime(b.holdExpiresAt)}</span>}</div>
        <div role="tablist" aria-label="Booking workspace" className="dtabs ws-tabs">
          {BOOKING_TABS.map(([k, l]) => {
            const href = `#/bookings/${encodeURIComponent(b.id)}${k === 'summary' ? '' : '/' + k}`;
            return <a key={k} role="tab" aria-selected={tab === k} className={`dchip${tab === k ? ' on' : ''}`} href={href}
              onClick={(e) => { e.preventDefault(); setTab(k); if (linked) history.replaceState(null, '', href); }}>{l}</a>;
          })}
        </div>
        <ErrorBox msg={msg} />
        {tabIn === 'move' && !canMove && <div className="state state-denied" data-state="denied" role="alert"><b>This booking cannot be moved.</b><span className="small">Only a confirmed single booking that has not started can be moved{can(me, 'manage_bookings') ? '' : ', by someone who manages bookings'}.</span></div>}
        {tab === 'summary' && <>
        {b.status === 'cancelled' && b.resolution === 'awaiting' && can(me, 'manage_bookings') && (
          <div className="card card-pad stack" style={{ gap: 8 }}>
            <div><b>Waiting for the customer to choose.</b> <span className="muted small">{inr(b.paidPaise)} is still held. If they have agreed with you, settle it now.</span></div>
            <div className="row"><button className="btn primary sm" onClick={() => act('settle', { choice: 'refund' }, 'Refunded. The customer has been told.')}>Refund {inr(b.paidPaise)} now</button>
              <button className="btn sm" onClick={() => act('settle', { choice: 'credit' }, 'Added as account credit.')}>Add as account credit</button></div>
          </div>)}
        {b.status === 'cancelled' && b.resolution && b.resolution !== 'awaiting' && (b.refundPaise > 0 || b.creditPaise > 0) && <div className="small"><Chip tone="info">{b.refundPaise > 0 ? `${inr(b.refundPaise)} refunded` : ''}{b.refundPaise > 0 && b.creditPaise > 0 ? ' · ' : ''}{b.creditPaise > 0 ? `${inr(b.creditPaise)} as credit` : ''}</Chip></div>}
        {d.block && <div><button className="btn ghost sm" onClick={() => go(`/bookings/${b.id}`)}>← Whole multi-day booking ({d.block.days} days)</button></div>}
        <div className="facts">
          <div><span>Ground</span><b>{b.groundName}</b></div>
          <div><span>When</span><b>{fmtDay(b.date)}, {timeRange(b)}</b></div>
          <div><span>Customer</span><b>{b.customerName}</b>{b.customerPhone && <div className="small muted">{formatPhone(b.customerPhone)}</div>}</div>
          <div><span>Booked</span><b>{whatOf(b)}</b>{b.players ? <div className="small muted">{b.players} players</div> : null}</div>
          <div><span>Created</span><b>{fmtDateTime(b.createdAt)}</b></div>
          {b.promoCode && <div><span>Promo</span><b>{b.promoCode}</b>{b.discountPaise ? <div className="small muted">{inr(b.discountPaise)} off</div> : null}</div>}
          {b.seriesId && <div><span>Repeat booking</span><b>Date {(b.seriesIndex ?? 0) + 1}</b></div>}
        </div>
        {b.notes && <div className="muted small">Note: {b.notes}</div>}
        {b.status === 'cancelled' && b.cancelReason && <div className="muted small">Cancelled: {b.cancelReason}{b.refundPaise ? ` · ${inr(b.refundPaise)} refunded` : ''}{b.creditPaise ? ` · ${inr(b.creditPaise)} as credit` : ''}{b.resolution === 'awaiting' ? ' · waiting for the customer to choose' : ''}</div>}
        </>}

        {(tab === 'summary' || tab === 'money') && <div className="grid g3">
          <div className="miniStat"><span>Total</span><b>{inr(b.totalPaise)}</b></div>
          <div className="miniStat"><span>Paid</span><b className="gold">{inr(b.status === 'cancelled' && b.resolution !== 'awaiting' ? Math.max(b.paidPaise - b.refundPaise - b.creditPaise, 0) : b.paidPaise)}</b></div>
          <div className="miniStat"><span>Balance</span><b style={b.status === 'confirmed' && b.balancePaise > 0 ? { color: 'var(--warn)' } : undefined}>{inr(b.status === 'cancelled' || b.status === 'expired' ? 0 : b.balancePaise)}</b></div>
        </div>}

        {tab === 'customer' && (
          <div className="stack" style={{ gap: 10 }}>
            <div className="facts">
              <div><span>Name</span><b>{b.customerName}</b></div>
              <div><span>Phone</span><b>{b.customerPhone ? formatPhone(b.customerPhone) : '—'}</b></div>
            </div>
            {can(me, 'view_customers') ? <div><a className="btn sm" href={`#/customers/${encodeURIComponent(b.customerId)}`}>Open the customer's workspace</a></div>
              : <div className="small muted">Their other bookings and payments are in the customer workspace, which needs the "view customers" permission.</div>}
          </div>)}

        {tab === 'money' && <>
        <div>
          <div className="eyebrow">Payments</div>
          <div className="card"><Table rows={d.payments} rowKey={(p) => p.id} empty="No payments yet." cols={[
            { head: 'When', cell: (p) => fmtDateTime(p.createdAt) },
            { head: 'Method', cell: (p) => <>{METHOD_LABEL[p.method] || p.method}{p.reference && <div className="small muted">{p.reference}</div>}</> },
            { head: 'Status', cell: (p) => <><Status s={p.status} map={PAY_STATUS} />{p.rejectReason && <div className="small muted">{p.rejectReason}</div>}</> },
            { head: 'Amount', num: true, cell: (p) => <>{inr(p.amountPaise)}{p.refundedPaise > 0 && <div className="small muted">{inr(p.refundedPaise)} back</div>}</> },
            { head: '', cell: (p) => (p.status === 'submitted' && p.method === 'upi' && can(me, 'verify_payments') ? <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><button className="btn sm primary" onClick={() => verify(p, true)}>Verify</button><button className="btn sm" onClick={() => verify(p, false)}>Reject</button></span>
              : (p.status === 'captured' || p.status === 'partially_refunded') && p.method !== 'credit' && p.amountPaise > p.refundedPaise && can(me, 'record_payments') ? <button className="btn sm ghost" onClick={() => setRefundOf(p)}>Refund</button> : null) },
          ]} /></div>
        </div>

        <DepositPanel b={b} />

        <RefundList refunds={d.refunds} canPay={can(me, 'record_payments')} onChanged={changed} />
        </>}

        {tab === 'match' && (d.block?.tournament
          ? <div className="stack" style={{ gap: 8 }}><div>Part of the tournament <b>{d.block.tournament.name}</b>.</div><div><a className="btn sm" href={`#/tournaments/${encodeURIComponent(d.block.tournament.id)}`}>Open the tournament</a></div></div>
          : <div data-state="empty" className="small muted">This booking is not linked to a match or tournament. Matches are created on the Fixtures page and tournaments with a multi-day booking.</div>)}

        {tab === 'messages' && <BookingMessages id={b.id} />}

        {tab === 'documents' && (
          <div className="stack" style={{ gap: 8 }}>
            {(b.status === 'confirmed' || b.status === 'completed') && b.paidPaise > 0
              ? <div><button className="btn sm" onClick={async () => { try { setInv(await api<Invoice>(`/api/bookings/${encodeURIComponent(b.id)}/invoice`)); } catch (e) { toast(errText(e)); } }}>Open the invoice</button></div>
              : <div data-state="empty" className="small muted">An invoice is issued once a confirmed booking has a payment.</div>}
            <LinkedDocs kind="booking" id={b.id} />
          </div>)}

        {tab === 'timeline' && (d.audit.length > 0
          ? <ol className="timeline">{d.audit.map((a) => <li key={a.id} className="small"><span className="muted">{fmtDateTime(a.at)}</span> · {ACTION_LABEL(a.action)}{a.actorRole ? <span className="muted"> · {a.actorRole.replace('_', ' ')}</span> : null}</li>)}</ol>
          : <div data-state="empty" className="small muted">Nothing has happened to this booking since it was made.</div>)}
      </div>
    </Modal>
    {inv && <InvoiceView i={inv} onClose={() => setInv(null)} />}
    {pay && <RecordPayment b={b} onClose={() => setPay(false)} onDone={() => { setPay(false); toast('Payment recorded.'); changed(); }} />}
    {refundOf && <RefundRequest p={refundOf} onClose={() => setRefundOf(null)} onDone={() => { setRefundOf(null); toast('Refund requested. It waits for the owner or the general manager.'); changed(); }} />}
    {disc && <DiscountDialog b={b} onClose={() => setDisc(false)} onDone={(waiting) => { setDisc(false); toast(waiting ? 'Sent for sign-off. The discount is given once it is approved.' : 'Discount given.'); changed(); }} />}
    {move && canMove && <MoveBookingDialog b={b} onClose={() => { setMove(false); if (tabIn === 'move') go(`/bookings/${b.id}`); }} onDone={() => { setMove(false); changed(); if (tabIn === 'move') go(`/bookings/${b.id}`); }} />}
    {cancel && <CancelDialog b={b} onClose={() => setCancel(false)} onDone={() => { setCancel(false); toast('Cancelled. The customer has been told.'); changed(); }} />}
    </>
  );
}

interface Invoice { number: string; title: string; kind: string; issuedOn: string; sac: string; gstPercent: number; taxablePaise: number; cgstPaise: number; sgstPaise: number; totalPaise: number; supplierName: string; supplierGstin: string | null; supplierAddress: string | null; buyerName: string; description: string; placeOfSupply: string; reverseChargeLine: string }

function InvoiceView({ i, onClose }: { i: Invoice; onClose: () => void }) {
  return (
    <Modal title={i.title} onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Close</button><button className="btn primary" onClick={() => window.print()}>Print</button></>}>
      <div className="stack" style={{ gap: 10 }}>
        <div><div className="strong">{i.supplierName}</div>{i.supplierAddress && <div className="small">{i.supplierAddress}</div>}{i.supplierGstin && <div className="small">GSTIN {i.supplierGstin}</div>}</div>
        <div className="row" style={{ justifyContent: 'space-between' }}><span>Invoice no. <b>{i.number}</b></span><span>Date {fmtDay(i.issuedOn)}</span></div>
        <div className="small">Billed to {i.buyerName}. Place of supply: {i.placeOfSupply}</div>
        <table className="tbl"><tbody>
          <tr><td>{i.description}<div className="small muted">SAC {i.sac}</div></td><td className="num right">{inr(i.taxablePaise)}</td></tr>
          {i.kind === 'tax_invoice' && <><tr><td>CGST {i.gstPercent / 2}%</td><td className="num right">{inr(i.cgstPaise)}</td></tr><tr><td>SGST {i.gstPercent / 2}%</td><td className="num right">{inr(i.sgstPaise)}</td></tr></>}
          <tr><td className="strong">Total</td><td className="num right strong">{inr(i.totalPaise)}</td></tr>
        </tbody></table>
        <div className="small">{i.reverseChargeLine}</div>
      </div>
    </Modal>
  );
}

/** Ask for money back on one payment. The owner's refund rules decide who approves it, then the super admin authorises it. */
function RefundRequest({ p, onClose, onDone }: { p: Pay; onClose: () => void; onDone: () => void }) {
  const left = p.amountPaise - p.refundedPaise;
  const [amount, setAmount] = useState(rupees(left).replace(/\.00$/, ''));
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const paise = toPaise(amount);
    if (!paise || paise <= 0) return setErr('Enter the refund in rupees.');
    if (reason.trim().length < 3) return setErr('Say why, so whoever approves it knows.');
    setBusy(true); setErr(null);
    try { await post(`/api/staff/payments/${encodeURIComponent(p.id)}/refund`, { amountPaise: paise, reason: reason.trim() }); onDone(); }
    catch (e) { setErr(errText(e)); setBusy(false); }
  };
  return (
    <Modal title="Request a refund" onClose={onClose}
      foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={submit}>Request refund</button></>}>
      <div className="form-grid">
        <Field label="Refund (₹)" hint={`Up to ${inr(left)} on this payment`}><input className="inp" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Why"><input className="inp" maxLength={150} placeholder="For example: rain stopped play after an hour" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="full small muted">Nothing is paid back until the owner or the general manager approves it.</div>
        <div className="full"><ErrorBox msg={err} /></div>
      </div>
    </Modal>
  );
}

/** Ask for money off what the booking still owes. The owner's discount rules decide whether it is given now or waits for sign-off. */
function DiscountDialog({ b, onClose, onDone }: { b: Booking; onClose: () => void; onDone: (waiting: boolean) => void }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const paise = toPaise(amount);
    if (!paise || paise <= 0) return setErr('Enter the discount in rupees.');
    if (reason.trim().length < 3) return setErr('Say why, so whoever signs it knows.');
    setBusy(true); setErr(null);
    try { const r = await post<{ waiting: boolean }>(`/api/staff/bookings/${encodeURIComponent(b.id)}/discount`, { amountPaise: paise, reason: reason.trim() }); onDone(r.waiting); }
    catch (e) { setErr(errText(e)); setBusy(false); }
  };
  return (
    <Modal title="Give a discount" onClose={onClose}
      foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={submit}>Give discount</button></>}>
      <div className="form-grid">
        <Field label="Discount (₹)" hint={`Up to the balance of ${inr(b.balancePaise)}`}><input className="inp" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Why"><input className="inp" maxLength={300} placeholder="For example: floodlight failed for 20 minutes" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="full small muted">Larger discounts may need a sign-off first, depending on your approval rules.</div>
        <div className="full"><ErrorBox msg={err} /></div>
      </div>
    </Modal>
  );
}

function RecordPayment({ b, onClose, onDone }: { b: Booking; onClose: () => void; onDone: () => void }) {
  const [method, setMethod] = useState('cash');
  const [amount, setAmount] = useState(rupees(b.balancePaise).replace(/\.00$/, ''));
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const paise = toPaise(amount);
    if (!paise || paise <= 0) return setErr('Enter the amount received in rupees.');
    setBusy(true); setErr(null);
    try { await post(`/api/staff/bookings/${encodeURIComponent(b.id)}/payments`, { method, amountPaise: paise, reference: reference.trim() || undefined, note: note.trim() || undefined }); onDone(); }
    catch (e) { setErr(errText(e)); setBusy(false); }
  };
  return (
    <Modal title="Record a payment" onClose={onClose}
      foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={submit}>Save payment</button></>}>
      <div className="form-grid">
        <Field label="Method"><select className="inp" value={method} onChange={(e) => setMethod(e.target.value)}>{HAND_METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Amount received (₹)" hint={`Balance is ${inr(b.balancePaise)}`}><input className="inp" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label={method === 'upi' ? 'UPI reference (UTR)' : 'Reference (optional)'}><input className="inp" maxLength={60} value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        <Field label="Note (optional)"><input className="inp" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="full"><ErrorBox msg={err} /></div>
      </div>
    </Modal>
  );
}

/** A multi-day booking as one: dates, money for every day, and each day to open on its own. */
function BlockDetail({ d, onClose, onChanged }: { d: Detail; onClose: () => void; onChanged: () => void }) {
  const { me } = useSession();
  const toast = useToast();
  const b = d.booking, k = d.block!;
  const [pay, setPay] = useState(false);
  const days = k.items || [];
  const live = days.filter((x) => x.status !== 'cancelled' && x.status !== 'expired');
  const [cancelAll, setCancelAll] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const settle = async (choice: string) => { setMsg(null); try { await post(`/api/staff/bookings/block/${encodeURIComponent(k.seriesId)}/settle`, { choice }); toast(choice === 'refund' ? 'Refunded. The customer has been told.' : 'Added as account credit.'); onChanged(); } catch (e) { setMsg(errText(e)); } };
  const canPay = !k.cancelled && can(me, 'record_payments') && k.balancePaise > 0 && live.some((x) => x.status === 'confirmed' || x.status === 'held');
  return (
    <>
      <Modal title={`Multi-day booking ${b.ref}`} onClose={onClose} wide
        foot={<>{k.cancellableDays > 0 && can(me, 'manage_bookings') && <button className="btn danger" onClick={() => setCancelAll(true)}>Cancel all {k.cancellableDays} days</button>}{canPay && <button className="btn primary" onClick={() => setPay(true)}>Record a payment</button>}{isOwner(me.role) && !live.length && !b.deletedAt && <DeleteBooking id={b.id} onError={setMsg} onDone={() => { toast('Booking deleted.'); onChanged(); onClose(); }} />}<button className="btn ghost" onClick={onClose}>Close</button></>}>
        <div className="stack" style={{ gap: 18 }}>
          <ErrorBox msg={msg} />
          {k.tournament && <div className="card card-pad row" style={{ justifyContent: 'space-between' }}><div><b>Tournament:</b> {k.tournament.name}<div className="small muted">Teams, fixtures and entry fees are kept under Tournaments. Cancelling every day also cancels the tournament.</div></div><button className="btn sm" onClick={() => go('/tournaments/' + k.tournament!.id)}>Open tournament</button></div>}
          {k.cancelled && <div className="row"><Chip tone="bad">Cancelled</Chip>{k.refundedPaise > 0 && <Chip tone="info">{inr(k.refundedPaise)} refunded</Chip>}{k.creditedPaise > 0 && <Chip tone="info">{inr(k.creditedPaise)} as credit</Chip>}</div>}
          {k.awaitingPaise > 0 && can(me, 'manage_bookings') && (
            <div className="card card-pad stack" style={{ gap: 8 }}>
              <div><b>Waiting for the customer to choose.</b> <span className="muted small">{inr(k.awaitingPaise)} is still held. If they have agreed with you, settle it now.</span></div>
              <div className="row"><button className="btn primary sm" onClick={() => settle('refund')}>Refund {inr(k.awaitingPaise)} now</button><button className="btn sm" onClick={() => settle('credit')}>Add as account credit</button></div>
            </div>)}
          <div className="row"><Chip tone="info">Multi-day</Chip><Chip tone="mute">{SOURCE_LABEL[b.source] || b.source}</Chip><span className="small muted">{k.days} days, one agreed total</span></div>
          <div className="facts">
            <div><span>Ground</span><b>{b.groundName}</b></div>
            <div><span>Dates</span><b>{fmtDay(k.fromDate)} – {fmtDay(k.toDate)}</b><div className="small muted">{k.days} days</div></div>
            <div><span>Hours</span><b>{timeRange(b)}</b><div className="small muted">every day</div></div>
            <div><span>Customer</span><b>{b.customerName}</b>{b.customerPhone && <div className="small muted">{formatPhone(b.customerPhone)}</div>}</div>
            <div><span>Created</span><b>{fmtDateTime(b.createdAt)}</b></div>
            {b.notes && <div><span>Note</span><b>{b.notes}</b></div>}
          </div>
          <div className="grid g3">
            <div className="miniStat"><span>Total</span><b>{inr(k.totalPaise)}</b></div>
            <div className="miniStat"><span>Paid</span><b className="gold">{inr(k.cancelled && k.awaitingPaise === 0 ? Math.max(k.paidPaise - k.refundedPaise - k.creditedPaise, 0) : k.paidPaise)}</b></div>
            <div className="miniStat"><span>Balance</span><b style={k.balancePaise > 0 ? { color: 'var(--warn)' } : undefined}>{inr(k.balancePaise)}</b></div>
          </div>
          <div>
            <div className="eyebrow">Each day</div>
            <div className="card"><Table rows={days} onRow={(x) => go(`/bookings/${x.id}/day`)} empty="No days." cols={[
              { head: 'Date', cell: (x) => <><div className="strong">{fmtDay(x.date)}</div><div className="small muted mono">{x.ref}</div></> },
              { head: 'Status', cell: (x) => <Chip tone={x.status === 'confirmed' || x.status === 'completed' ? 'good' : x.status === 'held' ? 'warn' : 'mute'}>{STATUS_LABEL[x.status] || x.status}</Chip> },
              { head: 'Time', cell: () => <span className="muted tabular">{timeRange(b)}</span> },
            ]} /></div>
            <div className="small muted" style={{ marginTop: 8 }}>One agreed amount covers all the days. Open a day to cancel just that day.</div>
          </div>
          <div>
            <div className="eyebrow">Payments</div>
            <div className="card"><Table rows={k.payments || []} empty="No payments yet." cols={[
              { head: 'When', cell: (p) => fmtDateTime(p.createdAt) },
              { head: 'Method', cell: (p) => <>{METHOD_LABEL[p.method] || p.method}{p.reference && <div className="small muted">{p.reference}</div>}</> },
              { head: 'Status', cell: (p) => <Status s={p.status} map={PAY_STATUS} /> },
              { head: 'Amount', num: true, cell: (p) => <>{inr(p.amountPaise)}{p.refundedPaise > 0 && <div className="small muted">{inr(p.refundedPaise)} back</div>}</> },
            ]} /></div>
          </div>
          <RefundList refunds={d.refunds} canPay={can(me, 'record_payments')} onChanged={onChanged} />
        </div>
      </Modal>
      {cancelAll && <CancelBlock k={k} b={b} onClose={() => setCancelAll(false)} onDone={() => { setCancelAll(false); toast('All days cancelled.'); onChanged(); }} />}
      {pay && <RecordBlockPayment k={k} onClose={() => setPay(false)} onDone={() => { setPay(false); toast('Payment recorded.'); onChanged(); }} />}
    </>
  );
}

function RecordBlockPayment({ k, onClose, onDone }: { k: Block; onClose: () => void; onDone: () => void }) {
  const [method, setMethod] = useState('cash');
  const [amount, setAmount] = useState(rupees(k.balancePaise).replace(/\.00$/, ''));
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const paise = toPaise(amount);
    if (!paise || paise <= 0) return setErr('Enter the amount received in rupees.');
    setBusy(true); setErr(null);
    try { await post(`/api/staff/bookings/block/${encodeURIComponent(k.seriesId)}/payments`, { method, amountPaise: paise, reference: reference.trim() || undefined, note: note.trim() || undefined }); onDone(); }
    catch (e) { setErr(errText(e)); setBusy(false); }
  };
  return (
    <Modal title="Record a payment" onClose={onClose}
      foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={submit}>Save payment</button></>}>
      <div className="form-grid">
        <Field label="Method"><select className="inp" value={method} onChange={(e) => setMethod(e.target.value)}>{HAND_METHODS.map(([k2, l]) => <option key={k2} value={k2}>{l}</option>)}</select></Field>
        <Field label="Amount received (₹)" hint={`Balance across all days is ${inr(k.balancePaise)}. It fills the earliest days first.`}><input className="inp" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label={method === 'upi' ? 'UPI reference (UTR)' : 'Reference (optional)'}><input className="inp" maxLength={60} value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        <Field label="Note (optional)"><input className="inp" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="full"><ErrorBox msg={err} /></div>
      </div>
    </Modal>
  );
}

function CancelBlock({ k, b, onClose, onDone }: { k: Block; b: Booking; onClose: () => void; onDone: () => void }) {
  const paid = k.paidPaise > 0;
  const [reason, setReason] = useState('');
  const [settle, setSettle] = useState('refund');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (paid && reason.trim().length < 10) return setErr('Please explain to the customer why (at least 10 characters).');
    setBusy(true); setErr(null);
    try { await post(`/api/staff/bookings/block/${encodeURIComponent(k.seriesId)}/cancel`, { reason: reason.trim() || undefined, ...(paid && settle ? { settle } : paid ? { offers: ['refund', 'credit'] } : {}) }); onDone(); }
    catch (e) { setErr(errText(e)); setBusy(false); }
  };
  return (
    <Modal title="Cancel the whole multi-day booking?" onClose={onClose}
      foot={<><button className="btn ghost" onClick={onClose}>Keep it</button><button className="btn danger" disabled={busy} onClick={submit}>Cancel all {k.cancellableDays} days</button></>}>
      <div className="stack" style={{ gap: 14 }}>
        <div><b>{b.customerName}</b>, {fmtDay(k.fromDate)} – {fmtDay(k.toDate)}. {paid ? <>They have paid <b className="gold">{inr(k.paidPaise)}</b>.</> : 'Nothing has been paid yet.'} Days that have already started stay as they are.</div>
        {paid && <SettleChoice value={settle} onChange={setSettle} paid={k.paidPaise} />}
        <Field label={paid ? 'Explanation for the customer' : 'Reason (optional)'} hint={paid ? 'For example: the tournament is not going ahead because too few teams entered.' : undefined}>
          <textarea className="inp" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <ErrorBox msg={err} />
      </div>
    </Modal>
  );
}

interface Msg { id: string; channel: string; category: string | null; template: string | null; subject: string | null; status: string; skipReason: string | null; createdAt: number; sentAt: number | null }
const MSG_STATUS: Record<string, ['good' | 'warn' | 'bad' | 'mute', string]> = { sent: ['good', 'Sent'], queued: ['warn', 'Waiting'], failed: ['bad', 'Failed'], skipped: ['mute', 'Not sent'] };
/** What the customer was sent about this booking, from the server's notification log. */
function BookingMessages({ id }: { id: string }) {
  const [d, err, reload, status] = useApi<{ items: Msg[] }>(`/api/staff/bookings/${encodeURIComponent(id)}/messages`);
  return <Load data={d} error={err} status={status} retry={reload} isEmpty={(x) => !x.items.length} empty="Nothing has been sent about this booking.">{(x) => (
    <div className="card"><Table rows={x.items} rowKey={(m) => m.id} cols={[
      { head: 'When', cell: (m) => fmtDateTime(m.sentAt ?? m.createdAt) },
      { head: 'Channel', cell: (m) => ({ email: 'Email', whatsapp: 'WhatsApp', sms: 'Text', push: 'App' } as Record<string, string>)[m.channel] || m.channel },
      { head: 'What', cell: (m) => m.subject || (m.template ?? m.category ?? '').replace(/[._]/g, ' ') },
      { head: 'Status', cell: (m) => <><Status s={m.status} map={MSG_STATUS} />{m.skipReason && <div className="small muted">{m.skipReason}</div>}</> },
    ]} /></div>)}</Load>;
}
