import { useState } from 'react';
import { Field, Modal, ErrorBox, useForm, useToast } from '../../ui';
import { post, patch, toPaise, todayISO, addDaysISO } from '../../lib';
import { API, FORMATS, STATUS, paiseToRupees, type Tournament } from './shared';

/** Create or edit a tournament. */
export function TournamentForm({ t, onClose, onSaved }: { t?: Tournament; onClose: () => void; onSaved: (t: Tournament) => void }) {
  const toast = useToast();
  const { v, bind } = useForm({
    name: t?.name ?? '', startDate: t?.startDate ?? addDaysISO(todayISO(), 7), endDate: t?.endDate ?? addDaysISO(todayISO(), 14), format: t?.format ?? 'round_robin',
    overs: String(t?.overs ?? 20), fee: t ? paiseToRupees(t.entryFeePaise) : '0', status: t?.status ?? 'draft', pointsWin: String(t?.pointsWin ?? 2), pointsTie: String(t?.pointsTie ?? 1), notes: t?.notes ?? '',
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    const fee = toPaise(v.fee);
    if (fee === null || fee < 0) return setErr('Enter the entry fee in rupees, for example 5000');
    setBusy(true); setErr(null);
    try {
      const body = { name: v.name, startDate: v.startDate, endDate: v.endDate, format: v.format, overs: Number(v.overs), entryFeePaise: fee, status: v.status, pointsWin: Number(v.pointsWin), pointsTie: Number(v.pointsTie), notes: v.notes };
      const out = t ? await patch(`${API}/${t.id}`, body) : await post(API, body);
      toast(t ? 'Tournament updated' : 'Tournament created'); onSaved(out);
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }
  return (
    <Modal title={t ? 'Edit tournament' : 'New tournament'} onClose={onClose} foot={<>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={busy || !v.name.trim()} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <ErrorBox msg={err} />
      <div className="form-grid">
        <Field label="Name" full><input className="inp" {...bind('name')} placeholder="Diwali Cup 2026" autoFocus /></Field>
        <Field label="Starts"><input className="inp" type="date" {...bind('startDate')} /></Field>
        <Field label="Ends"><input className="inp" type="date" {...bind('endDate')} /></Field>
        <Field label="Format"><select className="inp" {...bind('format')}>{FORMATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Status"><select className="inp" {...bind('status')}>{Object.entries(STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Overs per side"><input className="inp" type="number" min={1} max={50} {...bind('overs')} /></Field>
        <Field label="Entry fee per team (₹)"><input className="inp" inputMode="decimal" {...bind('fee')} /></Field>
        <Field label="Points for a win"><input className="inp" type="number" min={0} max={10} {...bind('pointsWin')} /></Field>
        <Field label="Points for a tie or no result"><input className="inp" type="number" min={0} max={10} {...bind('pointsTie')} /></Field>
        <Field label="Notes" full><textarea className="inp" rows={2} {...bind('notes')} placeholder="Rules, prizes, anything the teams should know" /></Field>
      </div>
    </Modal>
  );
}
