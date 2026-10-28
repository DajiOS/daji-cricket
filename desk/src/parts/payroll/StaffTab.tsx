import { useState } from 'react';
import { useApi, post, patch, inr, toPaise, rupees, fmtDate, todayISO, formatPhone } from '../../lib';
import { Table, Chip, Modal, Field, ErrorBox, Loading, NameField, useToast, useForm, DateInput } from '../../ui';
import { PAY, type PayStaff } from './common';

export function StaffTab({ onChanged }: { onChanged: () => void }) {
  const [d, err, reload] = useApi<{ items: PayStaff[] }>(`${PAY}/staff`);
  const [edit, setEdit] = useState<PayStaff | 'new' | null>(null);
  const [showOld, setShowOld] = useState(false);
  if (err) return <ErrorBox msg={err} />;
  if (!d) return <Loading />;
  const rows = d.items.filter((s) => showOld || s.active);
  const old = d.items.length - d.items.filter((s) => s.active).length;
  return (
    <div className="card">
      <div className="card-head">
        <h3>Pay profiles</h3>
        <div className="row">
          {old > 0 && <button className="btn sm ghost" onClick={() => setShowOld(!showOld)}>{showOld ? 'Hide' : 'Show'} {old} former</button>}
          <button className="btn sm primary" onClick={() => setEdit('new')}>Add staff</button>
        </div>
      </div>
      <Table rows={rows} onRow={(s) => setEdit(s)} empty="No staff yet. Add the first person to start payroll."
        cols={[
          { head: 'Name', cell: (s) => <><span className="strong">{s.name}</span>{s.phone && <div className="small muted">{formatPhone(s.phone)}</div>}</> },
          { head: 'Role', cell: (s) => s.role },
          { head: 'Pay', cell: (s) => <>{inr(s.ratePaise)} <span className="muted small">{s.payType === 'monthly' ? 'per month' : 'per day'}</span></> },
          { head: 'Deducts', cell: (s) => [s.esi && 'ESI', s.pt && 'PT', s.tds && 'TDS'].filter(Boolean).join(', ') || <span className="muted">-</span> },
          { head: 'Joined', cell: (s) => fmtDate(s.joinedOn) },
          { head: 'Status', cell: (s) => s.active ? <Chip tone="good">Active</Chip> : <Chip tone="mute">Left {s.leftOn ? fmtDate(s.leftOn) : ''}</Chip> },
        ]} />
      {edit && <StaffForm staff={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); onChanged(); }} />}
    </div>
  );
}

function StaffForm({ staff, onClose, onSaved }: { staff: PayStaff | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const f = useForm({
    name: staff?.name ?? '', role: staff?.role ?? '', phone: staff?.phone ?? '', payType: staff?.payType ?? 'monthly',
    rate: staff ? rupees(staff.ratePaise) : '', joinedOn: staff?.joinedOn ?? todayISO(), notes: staff?.notes ?? '',
    uan: staff?.uan ?? '', esicNo: staff?.esicNo ?? '', pan: staff?.pan ?? '', tdsFixed: staff?.tdsFixedPaise ? rupees(staff.tdsFixedPaise) : '',
  });
  const [flags, setFlags] = useState({ esi: staff?.esi ?? false, pt: staff?.pt ?? false, tds: staff?.tds ?? false });
  const flag = (k: keyof typeof flags, label: string, hint: string) => (
    <label className="row" style={{ gap: 8, alignItems: 'flex-start' }}><input type="checkbox" checked={flags[k]} onChange={(e) => setFlags({ ...flags, [k]: e.target.checked })} /><span><span className="strong">{label}</span><span className="hint" style={{ display: 'block' }}>{hint}</span></span></label>
  );
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    const rate = toPaise(f.v.rate);
    if (!f.v.name.trim()) return setErr('Enter a name');
    if (rate == null || rate < 0) return setErr('Enter the pay amount in rupees');
    setBusy(true); setErr(null);
    const body = { name: f.v.name, role: f.v.role || 'Staff', phone: f.v.phone, payType: f.v.payType, ratePaise: rate, joinedOn: f.v.joinedOn, notes: f.v.notes, ...flags, uan: f.v.uan.trim(), esicNo: f.v.esicNo.trim(), pan: f.v.pan.trim(), tdsFixedPaise: toPaise(f.v.tdsFixed) ?? 0 };
    try { staff ? await patch(`${PAY}/staff/${staff.id}`, body) : await post(`${PAY}/staff`, body); toast(staff ? 'Saved' : 'Staff added'); onSaved(); }
    catch (e: any) { setErr(e.message); setBusy(false); }
  }
  async function setActive(active: boolean) {
    setBusy(true);
    try { await patch(`${PAY}/staff/${staff!.id}`, { active }); toast(active ? 'Marked as working again' : 'Marked as left'); onSaved(); }
    catch (e: any) { setErr(e.message); setBusy(false); }
  }
  return (
    <Modal title={staff ? `Edit ${staff.name}` : 'Add staff'} onClose={onClose}
      foot={<>
        {staff && <button className="btn ghost" disabled={busy} onClick={() => setActive(!staff.active)}>{staff.active ? 'Mark as left' : 'Mark as working'}</button>}
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy} onClick={save}>Save</button>
      </>}>
      <div className="form-grid">
        <NameField value={f.v.name} onChange={(n) => f.setV((x: any) => ({ ...x, name: n }))} autoFocus />
        <Field label="Role"><input className="inp" {...f.bind('role')} placeholder="Groundsman, coach, scorer" /></Field>
        <Field label="Pay type"><select className="inp" {...f.bind('payType')}><option value="monthly">Monthly salary</option><option value="daily">Daily wage</option></select></Field>
        <Field label={f.v.payType === 'monthly' ? 'Monthly salary (rupees)' : 'Daily wage (rupees)'} hint={f.v.payType === 'monthly' ? 'Cut pro rata for unpaid days in the month' : 'Paid for each day present; half day is half'}>
          <input className="inp" inputMode="decimal" {...f.bind('rate')} />
        </Field>
        <Field label="Joining date"><DateInput className="inp" {...f.bind('joinedOn')} /></Field>
        <Field label="Phone"><input className="inp" inputMode="tel" {...f.bind('phone')} /></Field>
        <Field label="Notes" full><input className="inp" {...f.bind('notes')} /></Field>
      </div>
      <h4 style={{ margin: '18px 0 6px' }}>Statutory deductions</h4>
      <div className="form-grid">
        {flag('esi', 'ESI', '0.75% from the person, 3.25% from you, while monthly pay is 21,000 or less.')}
        {flag('pt', 'Gujarat Professional Tax', '200 a month when monthly pay is above 12,000.')}
        {flag('tds', 'TDS on salary', 'Worked out on the new tax regime from the yearly pay, or fix an amount below.')}
        {flags.tds && <Field label="Fixed TDS each month (rupees)" hint="Leave empty to work it out"><input className="inp" inputMode="decimal" {...f.bind('tdsFixed')} /></Field>}
                {flags.esi && <Field label="ESIC number"><input className="inp" {...f.bind('esicNo')} /></Field>}
        {flags.tds && <Field label="PAN"><input className="inp" {...f.bind('pan')} placeholder="ABCDE1234F" /></Field>}
      </div>
      {staff && <p className="hint">A change in pay applies from the next payroll run. Months already finalised keep the figures they had.</p>}
      <ErrorBox msg={err} />
    </Modal>
  );
}
