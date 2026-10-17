// One booking: who, when, money, payments, and everything staff can do to it.
import { useState } from 'react';
import { Modal, Chip, Loading, ErrorBox, Field, Status, Table, Confirm, useToast } from '../../ui';
import { useApi, post, api, inr, toPaise, rupees, fmtDay, fmtDateTime, formatPhone, can } from '../../lib';
import { useSession } from '../../App';
import { type Booking, BookingChip, CancelDialog, HAND_METHODS, METHOD_LABEL, PAY_STATUS, SOURCE_LABEL, cancellable, errText, timeRange, whatOf } from './common';

interface Pay { id: string; method: string; status: string; purpose: string; amountPaise: number; refundedPaise: number; reference: string | null; createdAt: number; rejectReason: string | null }
interface Detail { booking: Booking; payments: Pay[]; refunds: { id: string; amountPaise: number; status: string; mode: string | null; createdAt: number }[]; audit: { id: number; at: number; action: string; actorRole: string | null }[] }

const ACTION_LABEL = (a: string) => a.replace(/^booking\./, '').replace(/[._]/g, ' ').replace(/^./, (c) => c.toUpperCase());

export function BookingDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { me } = useSession();
  const toast = useToast();
  const [d, err, reload] = useApi<Detail>(`/api/staff/bookings/${encodeURIComponent(id)}`);
  const [pay, setPay] = useState(false);
  const [inv, setInv] = useState<Invoice | null>(null);
  const [cancel, setCancel] = useState(false);
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
  const b = d.booking;
  const canPay = can(me, 'record_payments') && (b.status === 'confirmed' || b.status === 'held') && b.balancePaise > 0;
  const started = b.startAt <= Date.now();
  return (
    <>
    <Modal title={`Booking ${b.ref}`} onClose={onClose} wide
      foot={<>
        {b.needsReview && <button className="btn" onClick={() => act('review-done', {}, 'Marked as reviewed.')}>Mark as reviewed</button>}
        {b.status === 'confirmed' && b.approval === 'pending' && <button className="btn primary" onClick={() => act('approve', {}, 'Approved. The customer has been told.')}>Approve</button>}
        {(b.status === 'confirmed' || b.status === 'completed') && b.paidPaise > 0 && <button className="btn" onClick={async () => { try { setInv(await api<Invoice>(`/api/bookings/${encodeURIComponent(b.id)}/invoice`)); } catch (e) { toast(errText(e)); } }}>Invoice</button>}
        {canPay && <button className="btn primary" onClick={() => setPay(true)}>Record a payment</button>}
        {b.status === 'confirmed' && started && <Confirm label="Mark no-show" ask="No refund, no credit?" onYes={() => act('no-show', {}, 'Marked as a no-show.')} />}
        {cancellable(b) && <button className="btn danger" onClick={() => setCancel(true)}>Cancel booking</button>}
        <button className="btn ghost" onClick={onClose}>Close</button>
      </>}>
      <div className="stack" style={{ gap: 18 }}>
        <div className="row"><BookingChip b={b} />{b.needsReview && <Chip tone="warn">Needs review</Chip>}<Chip tone="mute">{SOURCE_LABEL[b.source] || b.source}</Chip>
          {b.status === 'held' && b.holdExpiresAt && <span className="small muted">Hold ends {fmtDateTime(b.holdExpiresAt)}</span>}</div>
        <ErrorBox msg={msg} />
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

        <div className="grid g3">
          <div className="miniStat"><span>Total</span><b>{inr(b.totalPaise)}</b></div>
          <div className="miniStat"><span>Paid</span><b className="gold">{inr(b.paidPaise)}</b></div>
          <div className="miniStat"><span>Balance</span><b style={b.status === 'confirmed' && b.balancePaise > 0 ? { color: '#a8720f' } : undefined}>{inr(b.status === 'cancelled' || b.status === 'expired' ? 0 : b.balancePaise)}</b></div>
        </div>

        <div>
          <div className="eyebrow">Payments</div>
          <div className="card"><Table rows={d.payments} empty="No payments yet." cols={[
            { head: 'When', cell: (p) => fmtDateTime(p.createdAt) },
            { head: 'Method', cell: (p) => <>{METHOD_LABEL[p.method] || p.method}{p.reference && <div className="small muted">{p.reference}</div>}</> },
            { head: 'Status', cell: (p) => <><Status s={p.status} map={PAY_STATUS} />{p.rejectReason && <div className="small muted">{p.rejectReason}</div>}</> },
            { head: 'Amount', num: true, cell: (p) => <>{inr(p.amountPaise)}{p.refundedPaise > 0 && <div className="small muted">{inr(p.refundedPaise)} back</div>}</> },
            { head: '', cell: (p) => (p.status === 'submitted' && p.method === 'upi' && can(me, 'verify_payments') ? <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><button className="btn sm primary" onClick={() => verify(p, true)}>Verify</button><button className="btn sm" onClick={() => verify(p, false)}>Reject</button></span> : null) },
          ]} /></div>
          {d.refunds.length > 0 && <div className="small muted" style={{ marginTop: 8 }}>Refunds: {d.refunds.map((r) => `${inr(r.amountPaise)} (${r.status})`).join(', ')}</div>}
        </div>

        {d.audit.length > 0 && (
          <details>
            <summary className="small muted" style={{ cursor: 'pointer' }}>History ({d.audit.length})</summary>
            <div className="stack" style={{ gap: 4, marginTop: 8 }}>{d.audit.map((a) => <div key={a.id} className="small"><span className="muted">{fmtDateTime(a.at)}</span> · {ACTION_LABEL(a.action)}</div>)}</div>
          </details>
        )}
      </div>
    </Modal>
    {inv && <InvoiceView i={inv} onClose={() => setInv(null)} />}
    {pay && <RecordPayment b={b} onClose={() => setPay(false)} onDone={() => { setPay(false); toast('Payment recorded.'); changed(); }} />}
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
