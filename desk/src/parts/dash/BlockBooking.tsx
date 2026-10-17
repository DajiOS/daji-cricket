// A custom multi-day programme (camp, tournament, shoot): the same hours on a run of days for one agreed total.
// Normally this follows an enquiry and a quotation; staff enter it here once the customer has agreed.
import { useState } from 'react';
import { Modal, Field, ErrorBox } from '../../ui';
import { post, useApi, inr, toPaise, todayISO, addDaysISO } from '../../lib';
import { HAND_METHODS, errText } from './common';

interface Ground { id: string; name: string; active: boolean }
const HOURS = Array.from({ length: 19 }, (_, i) => i + 5); // 5 am to 11 pm
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
const label = (h: number) => `${h % 12 || 12}:00 ${h < 12 ? 'am' : 'pm'}`;

export function BlockBooking({ onClose, onDone }: { onClose: () => void; onDone: (firstId: string) => void }) {
  const [gl] = useApi<{ items: Ground[] }>('/api/staff/grounds');
  const grounds = (gl?.items || []).filter((g) => g.active);
  const [groundId, setGroundId] = useState('');
  const [from, setFrom] = useState(addDaysISO(todayISO(), 7));
  const [to, setTo] = useState(addDaysISO(todayISO(), 14));
  const [start, setStart] = useState(7), [end, setEnd] = useState(19);
  const [total, setTotal] = useState('');
  const [cust, setCust] = useState({ name: '', phone: '', email: '' });
  const [method, setMethod] = useState('upi');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const days = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1);
  const totalPaise = toPaise(total), payPaise = toPaise(amount);
  const cashTooHigh = method === 'cash' && payPaise != null && payPaise >= 200_000_00;
  const gid = groundId || grounds[0]?.id || '';

  async function save() {
    setErr(null);
    if (!gid) return setErr('Choose a ground');
    if (days < 1 || days > 31) return setErr('Choose 1 to 31 days');
    if (!totalPaise || totalPaise < 100) return setErr('Enter the agreed total for all days, in rupees');
    if (!payPaise || payPaise < 1) return setErr('Enter the amount received now');
    if (!cust.name.trim() || !cust.phone.trim()) return setErr('Enter the customer name and phone');
    setBusy(true);
    try {
      const r = await post('/api/staff/bookings/block', {
        groundId: gid, fromDate: from, toDate: to, startTime: hh(start), endTime: hh(end), totalPaise,
        customer: { name: cust.name, phone: cust.phone, email: cust.email || undefined },
        payment: { method, amountPaise: payPaise, reference: reference || undefined }, notes: notes || undefined,
      });
      onDone(r.bookings[0].id);
    } catch (e) { setErr(errText(e)); setBusy(false); }
  }

  return (
    <Modal title="Multi-day booking" wide onClose={onClose}
      foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || cashTooHigh} onClick={save}>Book {days || ''} day{days === 1 ? '' : 's'}</button></>}>
      <p className="small muted">For a custom programme agreed with the customer. One booking is made for each day, and the agreed total is shared across the days. The first day's advance must be received now.</p>
      <div className="form-grid">
        <Field label="Ground" full><select className="inp" value={gid} onChange={(e) => setGroundId(e.target.value)}>{grounds.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
        <Field label="First day"><input className="inp" type="date" value={from} min={todayISO()} onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} /></Field>
        <Field label="Last day"><input className="inp" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="From"><select className="inp" value={start} onChange={(e) => setStart(Number(e.target.value))}>{HOURS.map((h) => <option key={h} value={h}>{label(h)}</option>)}</select></Field>
        <Field label="Until"><select className="inp" value={end} onChange={(e) => setEnd(Number(e.target.value))}>{HOURS.filter((h) => h > start).map((h) => <option key={h} value={h}>{label(h)}</option>)}</select></Field>
        <Field label="Agreed total for all days (rupees)" hint={totalPaise && days ? `${days} days, about ${inr(Math.round(totalPaise / days))} a day` : undefined}><input className="inp" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} /></Field>
        <Field label="Customer name"><input className="inp" value={cust.name} onChange={(e) => setCust({ ...cust, name: e.target.value })} /></Field>
        <Field label="Phone"><input className="inp" inputMode="tel" value={cust.phone} onChange={(e) => setCust({ ...cust, phone: e.target.value })} /></Field>
        <Field label="Email (optional)"><input className="inp" value={cust.email} onChange={(e) => setCust({ ...cust, email: e.target.value })} /></Field>
        <Field label="Received now (rupees)"><input className="inp" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Paid by"><select className="inp" value={method} onChange={(e) => setMethod(e.target.value)}>{Object.entries(HAND_METHODS).map(([k, l]) => <option key={k} value={k}>{l as string}</option>)}</select></Field>
        <Field label="Reference (UTR, cheque no.)"><input className="inp" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        <Field label="Notes" full><input className="inp" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Camp name, contact person" /></Field>
      </div>
      {cashTooHigh && <p style={{ color: '#b3261e' }}>Cash of ₹2,00,000 or more in a day cannot be taken (Income-tax Act). Take this part by UPI, bank transfer or cheque.</p>}
      <ErrorBox msg={err} />
    </Modal>
  );
}
