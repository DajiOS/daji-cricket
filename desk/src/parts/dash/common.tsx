// Shared bits for the Dashboard and Bookings pages: status chips, the cancel dialog and small helpers.
import { useState } from 'react';
import { Chip, Modal, Field, ErrorBox, type Tone } from '../../ui';
import { post, inr, fmtDay, fmtTime, useApi, ApiError } from '../../lib';

export interface Booking {
  id: string; ref: string; groundId: string; groundName: string; customerId: string; customerName: string; customerPhone: string | null;
  date: string; startAt: number; endAt: number; slotCount: number; formatLabel: string | null; ball: string | null;
  status: 'held' | 'confirmed' | 'cancelled' | 'expired' | 'no_show' | 'completed'; source: 'online' | 'walk_in' | 'enquiry';
  totalPaise: number; advancePaise: number; paidPaise: number; balancePaise: number; holdExpiresAt: number | null; needsReview: boolean;
  approval: 'pending' | 'approved'; cancelledByOwner: boolean; resolution: string | null; cancelReason: string | null; refundPaise: number; creditPaise: number;
  discountPaise: number; promoCode: string | null; players: number | null; notes: string | null; seriesId?: string | null; seriesIndex?: number | null;
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
    const f = (e.details as any)?.fields as { field: string; message: string }[] | undefined;
    return f?.length ? f.map((x) => `${x.field}: ${x.message}`).join(' · ') : e.message;
  }
  return (e as Error).message || 'Something went wrong.';
};

/** Cancel a booking. When money was paid, the customer is told why and chooses what happens to it, as the terms say. */
export function CancelDialog({ b, onClose, onDone }: { b: Booking; onClose: () => void; onDone: () => void }) {
  const [cfg] = useApi<{ cashRefundPercent: number }>('/api/config');
  const paid = b.paidPaise > 0;
  const [offers, setOffers] = useState<string[]>(['refund', 'credit']);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = (k: string) => setOffers((o) => (o.includes(k) ? o.filter((x) => x !== k) : [...o, k]));
  const submit = async () => {
    if (paid && !offers.length) return setErr('Offer the customer at least one option.');
    if (paid && reason.trim().length < 10) return setErr('Please explain to the customer why (at least 10 characters).');
    setBusy(true); setErr(null);
    try { await post(`/api/staff/bookings/${encodeURIComponent(b.id)}/cancel`, paid ? { reason: reason.trim(), offers } : { reason: reason.trim() || undefined }); onDone(); }
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
            <p className="muted small" style={{ margin: 0 }}>The customer will read your explanation, then choose from the options you tick, as set out in the terms and conditions. Nothing is paid out until they choose.</p>
            <div className="stack" style={{ gap: 8 }}>
              <div className="eyebrow" style={{ margin: 0 }}>What the customer may choose</div>
              <label className="check"><input type="checkbox" checked={offers.includes('refund')} onChange={() => toggle('refund')} />Full refund ({inr(b.paidPaise)})</label>
              <label className="check"><input type="checkbox" checked={offers.includes('half')} onChange={() => toggle('half')} />{pct}% refund to the payment method</label>
              <label className="check"><input type="checkbox" checked={offers.includes('credit')} onChange={() => toggle('credit')} />Full amount as account credit, or another slot</label>
            </div>
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

/** Pay-method choices that staff may record by hand. */
export const HAND_METHODS: [string, string][] = [['cash', 'Cash'], ['upi', 'UPI'], ['card', 'Card'], ['bank_transfer', 'Bank transfer']];
