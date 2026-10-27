// The security deposit of one booking: held apart from the booking advance, with collect, refund, keep part (with a reason) and undo that. The server decides who may do what; errors are shown as the server words them.
import { useState } from 'react';
import { Modal, Chip, Loading, ErrorBox, Field, Table, useToast } from '../../ui';
import { useApi, post, inr, toPaise, fmtDateTime, can } from '../../lib';
import { useSession } from '../../App';
import { type Booking, errText } from './common';

interface Entry { id: string; kind: 'collect' | 'deduct' | 'refund' | 'reverse'; amountPaise: number; method: string | null; reason: string | null; reference: string | null; reversesId: string | null; actorRole: string; createdAt: number }
interface View { bookingId: string; collectedPaise: number; deductedPaise: number; reversedPaise: number; keptPaise: number; refundedPaise: number; heldPaise: number; entries: Entry[] }
type Kind = Entry['kind'];

const KIND_LABEL: Record<Kind, string> = { collect: 'Collected', deduct: 'Kept (deduction)', refund: 'Returned', reverse: 'Deduction reversed' };
const KIND_TONE: Record<Kind, 'good' | 'bad' | 'info' | 'warn'> = { collect: 'good', deduct: 'bad', refund: 'info', reverse: 'warn' };
const TITLE: Record<Kind, string> = { collect: 'Collect a security deposit', refund: 'Return security deposit', deduct: 'Keep part of the security deposit', reverse: 'Reverse a deduction' };

/** Shown on the booking only when the owner has switched the security deposit on. */
export function DepositPanel({ b }: { b: Booking }) {
  const [cfg] = useApi<{ securityDepositEnabled?: boolean }>('/api/config');
  if (!cfg?.securityDepositEnabled) return null;
  if (!['confirmed', 'completed', 'no_show'].includes(b.status)) return null;
  return <Panel b={b} />;
}

function Panel({ b }: { b: Booking }) {
  const { me } = useSession();
  const [v, err, reload] = useApi<{ deposit: View }>(`/api/staff/bookings/${encodeURIComponent(b.id)}/security-deposit`);
  const [act, setAct] = useState<Kind | null>(null);
  const toast = useToast();
  const ownerLevel = me.role === 'owner' || me.role === 'super_admin';
  const canMoney = ownerLevel || can(me, 'record_payments');
  const d = v?.deposit;
  return (
    <div id="deposit-panel">
      <div className="eyebrow">Security deposit</div>
      <div className="card card-pad stack" style={{ gap: 10 }}>
        <div className="small muted">Held for damage, apart from the booking advance and the price. It is not part of the booking total or what the customer owes for the booking.</div>
        {err ? <ErrorBox msg={err} /> : !d ? <Loading h={60} /> : (<>
          <div className="grid g3">
            <div className="miniStat"><span>Held now</span><b className="gold" data-testid="deposit-held">{inr(d.heldPaise)}</b></div>
            <div className="miniStat"><span>Collected</span><b>{inr(d.collectedPaise)}</b></div>
            <div className="miniStat"><span>Kept / returned</span><b>{inr(d.keptPaise)} / {inr(d.refundedPaise)}</b></div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            {canMoney && <button className="btn sm primary" data-act="collect" onClick={() => setAct('collect')}>Collect deposit</button>}
            {canMoney && <button className="btn sm" data-act="refund" disabled={d.heldPaise <= 0} onClick={() => setAct('refund')}>Return deposit</button>}
            {ownerLevel && <button className="btn sm" data-act="deduct" disabled={d.heldPaise <= 0} onClick={() => setAct('deduct')}>Keep part (damage)</button>}
            {ownerLevel && <button className="btn sm ghost" data-act="reverse" disabled={!d.entries.some((e) => e.kind === 'deduct')} onClick={() => setAct('reverse')}>Reverse a deduction</button>}
            {!ownerLevel && <span className="small muted">Keeping part of a deposit, or undoing that, is the owner's decision.</span>}
          </div>
          <Table rows={d.entries} empty="No security deposit has been taken for this booking." cols={[
            { head: 'When', cell: (e) => fmtDateTime(e.createdAt) },
            { head: 'What', cell: (e) => <><Chip tone={KIND_TONE[e.kind]}>{KIND_LABEL[e.kind]}</Chip>{e.reason && <div className="small muted">{e.reason}</div>}</> },
            { head: 'How', cell: (e) => <>{e.method ?? '—'}{e.reference && <div className="small muted">{e.reference}</div>}</> },
            { head: 'Amount', num: true, cell: (e) => inr(e.amountPaise) },
          ]} />
        </>)}
      </div>
      {act && d && <DepositDialog kind={act} b={b} view={d} onClose={() => setAct(null)} onDone={(msg) => { setAct(null); toast(msg); reload(); }} />}
    </div>
  );
}

function DepositDialog({ kind, b, view, onClose, onDone }: { kind: Kind; b: Booking; view: View; onClose: () => void; onDone: (msg: string) => void }) {
  const deductions = view.entries.filter((e) => e.kind === 'deduct');
  const [amount, setAmount] = useState(kind === 'refund' ? String(view.heldPaise / 100) : '');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [reverses, setReverses] = useState(deductions[0]?.id ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const needsMethod = kind === 'collect' || kind === 'refund', needsReason = kind === 'deduct' || kind === 'reverse';
  const submit = async () => {
    setErr(null);
    const paise = toPaise(amount);
    if (kind !== 'reverse' && (!paise || paise <= 0)) return setErr('Enter the amount in rupees.');
    if (needsReason && reason.trim().length < 10) return setErr('Say what this is for (at least 10 characters). The customer can see it.');
    if (kind === 'reverse' && !reverses) return setErr('Choose the deduction to reverse.');
    setBusy(true);
    try {
      await post(`/api/staff/bookings/${encodeURIComponent(b.id)}/security-deposit/${kind}`, {
        ...(kind !== 'reverse' ? { amountPaise: paise } : paise ? { amountPaise: paise } : {}),
        ...(needsMethod ? { method } : {}), ...(reference.trim() ? { reference: reference.trim() } : {}),
        ...(needsReason ? { reason: reason.trim() } : {}), ...(kind === 'reverse' ? { reversesId: reverses } : {}) });
      onDone(kind === 'collect' ? 'Security deposit recorded.' : kind === 'refund' ? 'Security deposit returned.' : kind === 'deduct' ? 'Deduction recorded. The customer can see the reason.' : 'Deduction reversed.');
    } catch (e) { setErr(errText(e)); setBusy(false); }
  };
  return (
    <Modal title={TITLE[kind]} onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" id="deposit-submit" disabled={busy} onClick={submit}>{TITLE[kind]}</button></>}>
      <div className="form-grid">
        {kind === 'reverse' && (
          <Field label="Which deduction" full><select className="inp" id="deposit-reverses" value={reverses} onChange={(e) => setReverses(e.target.value)}>
            {deductions.map((e) => <option key={e.id} value={e.id}>{fmtDateTime(e.createdAt)} · {inr(e.amountPaise)} · {e.reason}</option>)}</select></Field>)}
        <Field label={kind === 'reverse' ? 'Amount to give back (₹), empty for all' : 'Amount (₹)'} hint={kind === 'refund' || kind === 'deduct' ? `Held now: ${inr(view.heldPaise)}` : undefined}>
          <input className="inp" id="deposit-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        {needsMethod && <Field label="Method"><select className="inp" id="deposit-method" value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option><option value="bank">Bank transfer</option></select></Field>}
        {needsMethod && <Field label="Receipt or reference (optional)"><input className="inp" id="deposit-reference" maxLength={80} value={reference} onChange={(e) => setReference(e.target.value)} /></Field>}
        {needsReason && <Field label="Reason (the customer can see it)" full><input className="inp" id="deposit-reason" maxLength={300} placeholder="For example: cracked boundary rope, replaced" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
        <div className="full small muted">This does not change the booking's price, advance or balance.</div>
        <div className="full"><ErrorBox msg={err} /></div>
      </div>
    </Modal>
  );
}
