import { useState } from 'react';
import { Field, Modal, ErrorBox, NameFields, useForm, useToast, DateInput } from '../../ui';
import { post, patch, toPaise, todayISO, addDaysISO, useApi } from '../../lib';
import { HAND_METHODS } from '../dash/common';
import { API, FORMATS, STATUS, paiseToRupees, type Tournament } from './shared';

/** Create or edit a tournament. */
export function TournamentForm({ t, onClose, onSaved }: { t?: Tournament; onClose: () => void; onSaved: (t: Tournament) => void }) {
  const toast = useToast();
  const { v, bind, setV } = useForm({
    name: t?.name ?? '', startDate: t?.startDate ?? addDaysISO(todayISO(), 7), endDate: t?.endDate ?? addDaysISO(todayISO(), 14), format: t?.format ?? 'round_robin',
    overs: String(t?.overs ?? 20), fee: t ? paiseToRupees(t.entryFeePaise) : '0', status: t?.status ?? 'draft', pointsWin: String(t?.pointsWin ?? 2), pointsTie: String(t?.pointsTie ?? 1), notes: t?.notes ?? '',
    orgFirst: t?.organiser?.firstName ?? '', orgLast: t?.organiser?.lastName ?? '', orgPhone: t?.organiser?.phone ?? '', orgEmail: t?.organiser?.email ?? '',
    reserve: false, groundId: '', startTime: '08:00', endTime: '18:00', total: '', method: 'upi', received: '', reference: '',
  });
  const [gl] = useApi<{ items: { id: string; name: string; active: boolean }[] }>(t ? null : '/api/staff/grounds');
  const grounds = (gl?.items || []).filter((g) => g.active);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!v.name.trim()) return setErr('Enter the tournament name.');
    const fee = toPaise(v.fee);
    if (fee === null || fee < 0) return setErr('Enter the entry fee in rupees, for example 5000');
    const org = { firstName: v.orgFirst.trim(), lastName: v.orgLast.trim(), phone: v.orgPhone.trim() || undefined, email: v.orgEmail.trim() || undefined };
    let booking: Record<string, unknown> | undefined;
    if (!t && v.reserve) {
      const total = toPaise(v.total), got = toPaise(v.received);
      if (!org.firstName || !org.lastName || !org.phone) return setErr('To reserve the ground, enter the organiser\'s first name, last name and phone');
      if (!total || total < 100) return setErr('Enter the agreed ground charge for all days, in rupees');
      if (got === null || got < 0) return setErr('Enter the amount received now. Type 0 if nothing has been received yet.');
      booking = { groundId: v.groundId || grounds[0]?.id, startTime: v.startTime, endTime: v.endTime, totalPaise: total, payment: { method: v.method, amountPaise: got, reference: v.reference.trim() || undefined } };
    }
    setBusy(true); setErr(null);
    try {
      const body = { ...(org.firstName || org.lastName || org.phone || org.email ? { organiser: org } : {}), ...(booking ? { booking } : {}), name: v.name, startDate: v.startDate, endDate: v.endDate, format: v.format, overs: Number(v.overs), entryFeePaise: fee, status: v.status, pointsWin: Number(v.pointsWin), pointsTie: Number(v.pointsTie), notes: v.notes };
      const out = t ? await patch(`${API}/${t.id}`, body) : await post(API, body);
      toast(t ? 'Tournament updated' : 'Tournament created'); onSaved(out);
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }
  return (
    <Modal title={t ? 'Edit tournament' : 'New tournament'} onClose={onClose} foot={<>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy} aria-busy={busy || undefined} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <ErrorBox msg={err} />
      <div className="form-grid">
        <Field label="Name" full required><input className="inp" {...bind('name')} placeholder="Diwali Cup 2026" autoFocus /></Field>
        <Field label="Starts"><DateInput className="inp" {...bind('startDate')} /></Field>
        <Field label="Ends"><DateInput className="inp" {...bind('endDate')} /></Field>
        <Field label="Format"><select className="inp" {...bind('format')}>{FORMATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Status"><select className="inp" {...bind('status')}>{Object.entries(STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Overs per side"><input className="inp" type="number" min={1} max={50} {...bind('overs')} /></Field>
        <Field label="Entry fee per team (₹)"><input className="inp" inputMode="decimal" {...bind('fee')} /></Field>
        <Field label="Points for a win"><input className="inp" type="number" min={0} max={10} {...bind('pointsWin')} /></Field>
        <Field label="Points for a tie or no result"><input className="inp" type="number" min={0} max={10} {...bind('pointsTie')} /></Field>
        <div className="eyebrow full" style={{ gridColumn: '1 / -1' }}>Organiser</div>
        <NameFields first={v.orgFirst} last={v.orgLast} onFirst={(x) => setV((s) => ({ ...s, orgFirst: x }))} onLast={(x) => setV((s) => ({ ...s, orgLast: x }))} firstLabel="Organiser first name" lastLabel="Organiser last name" />
        <Field label="Organiser phone" hint="Matched to an existing customer, so their bookings and this tournament are linked."><input className="inp" inputMode="tel" {...bind('orgPhone')} /></Field>
        <Field label="Organiser email (optional)"><input className="inp" type="email" {...bind('orgEmail')} /></Field>
        {!t && <label className="check full"><input type="checkbox" checked={v.reserve} onChange={(e) => setV((s) => ({ ...s, reserve: e.target.checked }))} /> Reserve the ground for these dates. A multi-day booking is made and linked to this tournament.</label>}
        {!t && v.reserve && <>
          <Field label="Ground" full><select className="inp" {...bind('groundId')}>{grounds.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
          <Field label="From"><input className="inp" type="time" {...bind('startTime')} /></Field>
          <Field label="Until"><input className="inp" type="time" {...bind('endTime')} /></Field>
          <Field label="Agreed ground charge for all days (₹)"><input className="inp" inputMode="decimal" {...bind('total')} /></Field>
          <Field label="Received now (₹)"><input className="inp" inputMode="decimal" {...bind('received')} /></Field>
          <Field label="Paid by"><select className="inp" {...bind('method')}>{HAND_METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Reference (UTR, cheque no.)"><input className="inp" {...bind('reference')} /></Field>
        </>}
        <Field label="Notes" full><textarea className="inp" rows={2} {...bind('notes')} placeholder="Rules, prizes, anything the teams should know" /></Field>
      </div>
    </Modal>
  );
}
