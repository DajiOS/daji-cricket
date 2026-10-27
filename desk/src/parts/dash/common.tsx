// Shared bits for the Dashboard and Bookings pages: status chips, the cancel dialog and small helpers.
import { useEffect, useState } from 'react';
import { Chip, Modal, Field, ErrorBox, type Tone } from '../../ui';
import { api, post, inr, fmtDay, fmtTime, useApi, ApiError } from '../../lib';

export interface BlockDay { id: string; ref: string; date: string; startAt: number; endAt: number; status: string; totalPaise: number; paidPaise: number; balancePaise: number }
/** A multi-day booking seen as one: dates, money across every day and (in the detail) each day. */
export interface Block { seriesId: string; days: number; fromDate: string; toDate: string; totalPaise: number; paidPaise: number; balancePaise: number; cancelled: boolean; awaitingPaise: number; refundedPaise: number; creditedPaise: number; cancellableDays: number; tournament?: { id: string; name: string } | null; items?: BlockDay[]; payments?: { createdAt: number; method: string; status: string; amountPaise: number; refundedPaise: number; reference: string | null }[] }
export interface Booking {
  block?: Block | null;
  id: string; ref: string; groundId: string; groundName: string; customerId: string; customerName: string; customerPhone: string | null;
  date: string; startAt: number; endAt: number; slotCount: number; formatLabel: string | null; ball: string | null;
  status: 'held' | 'confirmed' | 'cancelled' | 'expired' | 'no_show' | 'completed'; source: 'online' | 'walk_in' | 'enquiry';
  totalPaise: number; advancePaise: number; paidPaise: number; balancePaise: number; holdExpiresAt: number | null; needsReview: boolean;
  approval: 'pending' | 'approved'; cancelledByOwner: boolean; resolution: string | null; cancelReason: string | null; refundPaise: number; creditPaise: number;
  discountPaise: number; promoCode: string | null; players: number | null; notes: string | null; seriesId?: string | null; seriesIndex?: number | null; deletedAt?: number | null;
  confirmedAt: number | null; cancelledAt: number | null; createdAt: number; cancelKind: string | null;
}
export interface Page<T> { items: T[]; total: number; limit: number; offset: number }

export const STATUS_LABEL: Record<string, string> = { held: 'Held', confirmed: 'Confirmed', cancelled: 'Cancelled', expired: 'Expired', no_show: 'No-show', completed: 'Played' };
const TONE: Record<string, Tone> = { held: 'warn', confirmed: 'good', cancelled: 'mute', expired: 'mute', no_show: 'bad', completed: 'info' };
export const SOURCE_LABEL: Record<string, string> = { online: 'Online', walk_in: 'Walk-in', enquiry: 'From an enquiry' };
export const METHOD_LABEL: Record<string, string> = { cash: 'Cash', card: 'Card', upi: 'UPI', bank_transfer: 'Bank transfer', razorpay: 'Online (Razorpay)', credit: 'Account credit' };
export const PAY_STATUS: Record<string, [Tone, string]> = {
  captured: ['good', 'Received'], submitted: ['warn', 'Waiting to verify'], pending: ['warn', 'Pending'], created: ['mute', 'Started'],
  failed: ['bad', 'Failed'], rejected: ['bad', 'Rejected'], refunded: ['info', 'Refunded'], partially_refunded: ['info', 'Part refunded'],
};

/** The one chip that says where a booking stands. */
export function BookingChip({ b }: { b: Booking }) {
  if (b.status === 'confirmed' && b.approval === 'pending') return <Chip tone="warn">Pending approval</Chip>;
  if (b.status === 'cancelled' && b.cancelledByOwner) return <Chip tone="bad">Cancelled by the ground</Chip>;
  return <Chip tone={TONE[b.status] || 'mute'}>{STATUS_LABEL[b.status] || b.status}</Chip>;
}
export const timeRange = (b: Booking) => `${fmtTime(b.startAt)} – ${fmtTime(b.endAt)}`;
export const whatOf = (b: Booking) => (b.formatLabel ? `${b.formatLabel}${b.ball ? ` (${b.ball})` : ''}` : `${b.slotCount} ${b.slotCount === 1 ? 'slot' : 'slots'}`);
/** Staff can cancel a booking that has not started yet. */
export const cancellable = (b: Booking) => (b.status === 'confirmed' || b.status === 'held') && b.startAt > Date.now();
export const errText = (e: unknown) => {
  if (e instanceof ApiError) {
    if (e.code === 'ADVANCE_NOT_MET') return `At least ${inr((e.details as any)?.advancePaise)} must be received now to confirm this booking.`;
    return e.message; // field problems already read as plain sentences (see formtext.ts)
  }
  return (e as Error).message || 'Something went wrong.';
};

/** Cancel a booking. When money was paid, the customer is told why and chooses what happens to it, as the terms say. */
export function CancelDialog({ b, onClose, onDone }: { b: Booking; onClose: () => void; onDone: () => void }) {
  const [cfg] = useApi<{ cashRefundPercent: number }>('/api/config');
  const paid = b.paidPaise > 0;
  const [offers, setOffers] = useState<string[]>(['refund', 'credit']);
  const [reason, setReason] = useState('');
  const [settle, setSettle] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = (k: string) => setOffers((o) => (o.includes(k) ? o.filter((x) => x !== k) : [...o, k]));
  const submit = async () => {
    if (paid && !settle && !offers.length) return setErr('Offer the customer at least one option.');
    if (paid && reason.trim().length < 10) return setErr('Please explain to the customer why (at least 10 characters).');
    setBusy(true); setErr(null);
    try { await post(`/api/staff/bookings/${encodeURIComponent(b.id)}/cancel`, paid ? { reason: reason.trim(), offers: settle ? [settle] : offers } : { reason: reason.trim() || undefined }); if (paid && settle) await post(`/api/staff/bookings/${encodeURIComponent(b.id)}/settle`, { choice: settle }); onDone(); }
    catch (e) { setErr(errText(e)); setBusy(false); }
  };
  const pct = cfg?.cashRefundPercent ?? 50;
  return (
    <Modal title="Cancel this booking?" onClose={onClose}
      foot={<><button className="btn ghost" onClick={onClose}>Keep the booking</button><button className="btn primary" disabled={busy} onClick={submit}>Cancel this booking</button></>}>
      <div className="stack" style={{ gap: 14 }}>
        <div><b>{b.customerName}</b>, {fmtDay(b.date)}, {timeRange(b)}. {paid ? <>They paid <b className="gold">{inr(b.paidPaise)}</b>.</> : 'Nothing has been paid yet.'}</div>
        {paid ? (
          <>
            <SettleChoice value={settle} onChange={setSettle} paid={b.paidPaise} />
            {!settle && <><p className="muted small" style={{ margin: 0 }}>The customer will read your explanation, then choose from the options you tick, as set out in the terms and conditions. Nothing is paid out until they choose.</p>
            <div className="stack" style={{ gap: 8 }}>
              <div className="eyebrow" style={{ margin: 0 }}>What the customer may choose</div>
              <label className="check"><input type="checkbox" checked={offers.includes('refund')} onChange={() => toggle('refund')} />Full refund ({inr(b.paidPaise)})</label>
              <label className="check"><input type="checkbox" checked={offers.includes('half')} onChange={() => toggle('half')} />{pct}% refund to the payment method</label>
              <label className="check"><input type="checkbox" checked={offers.includes('credit')} onChange={() => toggle('credit')} />Full amount as account credit, or another slot</label>
            </div></>}
            <Field label="Explanation for the customer" hint="For example: the tournament is not going ahead because too few teams entered.">
              <textarea className="inp" rows={4} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </>
        ) : (
          <Field label="Reason (optional)"><input className="inp" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        )}
        <ErrorBox msg={err} />
      </div>
    </Modal>
  );
}

/** What happens to the money when the ground cancels: the customer chooses later, or staff settle it now. */
export function SettleChoice({ value, onChange, paid }: { value: string; onChange: (v: string) => void; paid: number }) {
  const opts: [string, string][] = [['', 'Let the customer choose'], ['refund', `Refund ${inr(paid)} now`], ['credit', `Add ${inr(paid)} as account credit now`]];
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="eyebrow" style={{ margin: 0 }}>What happens to the money</div>
      {opts.map(([k, l]) => <label className="check" key={k || 'ask'}><input type="radio" name="settle" checked={value === k} onChange={() => onChange(k)} />{l}</label>)}
    </div>);
}

/** Pay-method choices that staff may record by hand. */
export const HAND_METHODS: [string, string][] = [['cash', 'Cash'], ['upi', 'UPI'], ['card', 'Card'], ['bank_transfer', 'Bank transfer']];

export interface CustomerMatch { found: boolean; hasAccount: boolean; known: boolean; id?: string; name?: string; phone?: string | null; email?: string | null; matchedOn: string[]; conflict: boolean }
type Cust = { name: string; phone: string; email: string };

/** Looks the customer up by phone and email as staff type. An existing customer fills the blanks; nothing typed is overwritten. */
export function useCustomerMatch(cust: Cust, setCust: (c: Cust) => void): CustomerMatch | null {
  const [m, setM] = useState<CustomerMatch | null>(null);
  const phone = cust.phone.replace(/\D/g, '').slice(-10), email = cust.email.trim();
  useEffect(() => {
    const okPhone = phone.length === 10, okEmail = /^\S+@\S+\.\S+$/.test(email);
    if (!okPhone && !okEmail) { setM(null); return; }
    let live = true;
    const t = setTimeout(() => {
      api<CustomerMatch>('/api/staff/customers/lookup?' + new URLSearchParams({ ...(okPhone ? { phone } : {}), ...(okEmail ? { email } : {}) }))
        .then((r) => {
          if (!live) return;
          setM(r.found ? r : null);
          if (r.found && r.known) setCust({ name: cust.name.trim() ? cust.name : r.name || '', phone: cust.phone.trim() ? cust.phone : r.phone || '', email: cust.email.trim() ? cust.email : r.email || '' });
        }).catch(() => { if (live) setM(null); });
    }, 350);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, email]);
  return m;
}

export function MatchNote({ m }: { m: CustomerMatch | null }) {
  if (!m) return null;
  return (
    <div className="card card-pad small" role="status" style={{ gridColumn: '1 / -1' }}>
      <b>{m.known ? `Existing customer: ${m.name}` : 'This number or email already belongs to a customer'}</b>
      {m.known ? ' — details filled in; this booking is added to them.' : ' — the booking will be added to them.'}
      {m.conflict && <div className="small">The phone and the email belong to two different customers. Check them before you save.</div>}
      {m.hasAccount && <div className="small">They already have an account. Don't make a new one: ask them to sign in with a code sent to their mobile, or reset their password.</div>}
    </div>
  );
}

export interface RefundItem { id: string; amountPaise: number; status: string; mode: string | null; createdAt: number; approvedAt?: number | null; paymentMethod?: string | null; reference?: string | null; completedAt?: number | null }
const BYHAND: Record<string, string> = { cash: 'Hand the cash back', upi: 'Send it by UPI to the customer', card: 'Return it to the card by hand', bank_transfer: 'Send it by bank transfer' };

/** Where each refund stands and how it goes back: Razorpay payments return by themselves, everything else is paid by hand and marked done here. */
export function RefundList({ refunds, canPay, onChanged }: { refunds: RefundItem[]; canPay: boolean; onChanged: () => void }) {
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!refunds.length) return null;
  async function paid(r: RefundItem) {
    if (!(refs[r.id] || '').trim()) return setErr(r.paymentMethod === 'cash' ? 'Write who received the cash, or a short note, then press Mark as paid.' : 'Enter the UTR or payout reference, then press Mark as paid.');
    setBusy(r.id); setErr(null);
    try { await post(`/api/staff/refunds/${encodeURIComponent(r.id)}/complete`, { reference: (refs[r.id] || '').trim() }); onChanged(); } catch (e) { setErr(errText(e)); } finally { setBusy(null); }
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="eyebrow">Refunds</div>
      <ErrorBox msg={err} />
      {refunds.map((r) => {
        const auto = r.mode === 'gateway', done = r.status === 'done';
        const how = auto ? 'Back to the customer\'s card or UPI through Razorpay, automatically' : (BYHAND[r.paymentMethod || ''] || 'Pay it back by hand');
        const state = done ? 'Paid back' : !r.approvedAt ? 'Waiting for the super admin (Bookings, Refund approvals)' : auto ? 'Authorised, being sent to Razorpay' : 'Authorised, ready to pay';
        return (
          <div className="card card-pad stack" style={{ gap: 6 }} key={r.id}>
            <div className="row" style={{ justifyContent: 'space-between' }}><b>{inr(r.amountPaise)}</b><Chip tone={done ? 'good' : r.approvedAt ? 'info' : 'warn'}>{state}</Chip></div>
            <div className="small muted">{how}{r.paymentMethod ? ` (paid by ${(METHOD_LABEL[r.paymentMethod] || r.paymentMethod).toLowerCase()})` : ''}{done && r.reference ? ` · ref ${r.reference}` : ''}</div>
            {!auto && !done && !!r.approvedAt && canPay && (
              <div className="row" style={{ gap: 6 }}>
                <input className="inp" style={{ flex: '1 1 200px', width: 'auto' }} placeholder={r.paymentMethod === 'cash' ? 'Who received it, or a note' : 'UTR or payout reference'} aria-label="Payout reference" value={refs[r.id] || ''} onChange={(e) => setRefs({ ...refs, [r.id]: e.target.value })} />
                <button className="btn primary sm" disabled={busy === r.id} onClick={() => paid(r)}>Mark as paid</button>
              </div>)}
          </div>
        );
      })}
    </div>
  );
}
