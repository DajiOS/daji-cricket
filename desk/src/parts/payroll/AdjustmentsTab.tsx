import { useState } from 'react';
import { useApi, post, del, inr, toPaise, fmtDate, todayISO } from '../../lib';
import { Table, Chip, Modal, Field, ErrorBox, Loading, Confirm, useToast, useForm, DateInput } from '../../ui';
import { PAY, KIND_LABEL, KIND_TONE, monthName, type Adjustment, type PayStaff } from './common';

export function AdjustmentsTab({ month, locked, onChanged }: { month: string; locked: boolean; onChanged: () => void }) {
  const [d, err, reload] = useApi<{ items: Adjustment[] }>(`${PAY}/adjustments?month=${month}`);
  const [add, setAdd] = useState(false);
  const toast = useToast();
  if (err) return <ErrorBox msg={err} />;
  if (!d) return <Loading />;
  const total = (k: string) => d.items.filter((a) => a.kind === k).reduce((s, a) => s + a.amountPaise, 0);
  async function remove(id: string) { try { await del(`${PAY}/adjustments/${id}`); toast('Removed'); reload(); onChanged(); } catch (e: any) { toast(e.message); } }
  return (
    <div className="card">
      <div className="card-head">
        <div><h3>Advances, deductions and bonuses</h3><div className="small muted">Taken off or added to the salary for {monthName(month)}. Advances: {inr(total('advance'))}. Deductions: {inr(total('deduction'))}. Bonuses: {inr(total('bonus'))}.</div></div>
        {locked ? <Chip tone="info">Month finalised</Chip> : <button className="btn sm primary" onClick={() => setAdd(true)}>Add entry</button>}
      </div>
      <Table rows={d.items} empty="No advances or deductions this month."
        cols={[
          { head: 'Staff', cell: (a) => <span className="strong">{a.staffName}</span> },
          { head: 'Type', cell: (a) => <Chip tone={KIND_TONE[a.kind]}>{KIND_LABEL[a.kind]}</Chip> },
          { head: 'Given on', cell: (a) => fmtDate(a.givenOn) },
          { head: 'Note', cell: (a) => a.note || <span className="muted">-</span> },
          { head: 'Amount', num: true, cell: (a) => <span className={a.kind === 'bonus' ? 'gold' : ''}>{a.kind === 'bonus' ? '+' : '-'}{inr(a.amountPaise)}</span> },
          { head: '', cell: (a) => locked ? null : <Confirm label="Remove" ask="Remove?" onYes={() => remove(a.id)} className="btn sm ghost" /> },
        ]} />
      {add && <AdjustmentForm month={month} onClose={() => setAdd(false)} onSaved={() => { setAdd(false); reload(); onChanged(); }} />}
    </div>
  );
}

function AdjustmentForm({ month, onClose, onSaved }: { month: string; onClose: () => void; onSaved: () => void }) {
  const [staff] = useApi<{ items: PayStaff[] }>(`${PAY}/staff?includeInactive=0`);
  const toast = useToast();
  const today = todayISO();
  const f = useForm({ staffId: '', kind: 'advance', amount: '', givenOn: today.slice(0, 7) === month ? today : `${month}-01`, note: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    const amt = toPaise(f.v.amount);
    if (!f.v.staffId) return setErr('Choose a person');
    if (!amt || amt <= 0) return setErr('Enter an amount in rupees');
    setBusy(true); setErr(null);
    try { await post(`${PAY}/adjustments`, { staffId: f.v.staffId, kind: f.v.kind, amountPaise: amt, givenOn: f.v.givenOn, month, note: f.v.note }); toast('Added'); onSaved(); }
    catch (e: any) { setErr(e.message); setBusy(false); }
  }
  return (
    <Modal title={`New entry for ${monthName(month)}`} onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save</button></>}>
      <div className="form-grid">
        <Field label="Staff"><select className="inp" {...f.bind('staffId')}><option value="">Choose</option>{staff?.items.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Type"><select className="inp" {...f.bind('kind')}><option value="advance">Advance (recovered from this month's pay)</option><option value="deduction">Deduction (fine, damage)</option><option value="bonus">Bonus (added to pay)</option></select></Field>
        <Field label="Amount (rupees)"><input className="inp" inputMode="decimal" {...f.bind('amount')} /></Field>
        <Field label="Date given"><DateInput className="inp" {...f.bind('givenOn')} /></Field>
        <Field label="Note" full><input className="inp" {...f.bind('note')} placeholder="Reason" /></Field>
      </div>
      <ErrorBox msg={err} />
    </Modal>
  );
}
