// Staff "Move booking": move a confirmed booking to another time on the same ground, past the customer's own cut-off or limit. Needs a reason of at least 10 characters,
// is audited with the staff member's name, and does not use the customer's allowance. What the move would do comes from the server's preview; errors are shown as the server words them.
import { useState } from 'react';
import { Modal, ErrorBox, Field, DateInput, useToast } from '../../ui';
import { post, inr, fmtDateTime, todayISO } from '../../lib';
import { type Booking, errText } from './common';

interface Preview { fromStartAt: number; fromTotalPaise: number; toStartAt: number; toTotalPaise: number; direction: 'dearer' | 'cheaper' | 'same_price'; differencePaise: number; settlement: { treatment: 'credit' | 'refund_request'; paiseSettled: number } | null; balanceAfterPaise: number }

const hhmm = (ms: number) => new Date(ms + 330 * 60000).toISOString().slice(11, 16);

export function MoveBookingDialog({ b, onClose, onDone }: { b: Booking; onClose: () => void; onDone: (msg: string) => void }) {
  const toast = useToast();
  const [date, setDate] = useState(b.date);
  const [time, setTime] = useState(hhmm(b.startAt));
  const [reason, setReason] = useState('');
  const [pv, setPv] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const body = () => ({ date, startTime: time, ...(b.formatLabel ? {} : { slots: b.slotCount }) });
  const path = `/api/staff/bookings/${encodeURIComponent(b.id)}/reschedule`;
  const preview = async () => {
    setErr(null); setPv(null);
    if (!date || !/^\d{2}:\d{2}$/.test(time)) return setErr('Choose the new date and start time.');
    setBusy(true);
    try { setPv((await post<{ preview: Preview }>(`${path}-preview`, body())).preview); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const move = async () => {
    setErr(null);
    if (!pv) return setErr('Press "Show what changes" first, so you see what the move does before it happens.');
    if (reason.trim().length < 10) return setErr('Say why the booking is being moved (at least 10 characters). It is recorded with your name.');
    setBusy(true);
    try { await post(path, { ...body(), reason: reason.trim() }); toast('Booking moved. The customer has been told.'); onDone('Booking moved.'); } catch (e) { setErr(errText(e)); setBusy(false); }
  };
  const verdict = (p: Preview) => p.direction === 'dearer' ? `The new time costs ${inr(p.differencePaise)} more. The customer can pay that difference online from their account, or at the ground.`
    : p.direction === 'cheaper' ? (p.settlement ? `The new time costs less. ${inr(p.settlement.paiseSettled)} already paid ${p.settlement.treatment === 'credit' ? 'becomes account credit for the customer' : 'goes for approval as a refund request'}.` : 'The new time costs less. Nothing has been overpaid, so nothing is returned.') : 'The new time costs the same.';
  return (
    <Modal title={`Move booking ${b.ref}`} onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" id="move-preview" disabled={busy} onClick={preview}>Show what changes</button><button className="btn primary" id="move-confirm" disabled={busy} onClick={move}>Move booking</button></>}>
      <div className="form-grid">
        <div className="full small muted">Now: {fmtDateTime(b.startAt)} to {hhmm(b.endAt)}. This works inside the customer's 24-hour cut-off and after their moves are used. It does not use the customer's own moves.</div>
        <Field label="New date"><DateInput className="inp" id="move-date" min={todayISO()} value={date} onChange={(e) => { setDate(e.target.value); setPv(null); }} /></Field>
        <Field label="New start time"><input className="inp" id="move-time" type="time" step={3600} value={time} onChange={(e) => { setTime(e.target.value); setPv(null); }} /></Field>
        <Field label="Why (at least 10 characters)" full><input className="inp" id="move-reason" maxLength={300} placeholder="For example: customer phoned, team arrives late" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {pv && (<div className="full card card-pad stack" id="move-preview-box" style={{ gap: 6 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted">From</span><b>{fmtDateTime(pv.fromStartAt)} · {inr(pv.fromTotalPaise)}</b></div>
          <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted">To</span><b>{fmtDateTime(pv.toStartAt)} · {inr(pv.toTotalPaise)}</b></div>
          <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted">Left to pay after the move</span><b>{inr(pv.balanceAfterPaise)}</b></div>
          <div className="small" id="move-verdict" data-direction={pv.direction}>{verdict(pv)}</div>
        </div>)}
        <div className="full"><ErrorBox msg={err} /></div>
      </div>
    </Modal>
  );
}
