import { useState } from 'react';
import { patch, useApi, inr, fmtDate, fmtDateTime, formatPhone } from '../../lib';
import { Modal, Field, Loading, ErrorBox, Table, Chip, NameField, useToast } from '../../ui';
import { StatusChip, leftText, methodLabel, errText, type Member, type Payment } from './shared';

type Detail = Member & { payments: Payment[] };

export default function MemberDialog({ id, onClose, onRenew, onChanged }: { id: string; onClose: () => void; onRenew: (m: Member) => void; onChanged: () => void }) {
  const toast = useToast();
  const [m, err, reload] = useApi<Detail>(`/api/desk/memberships/members/${id}`);
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false); const [e2, setE2] = useState<string | null>(null);
  const start = () => { if (!m) return; setName(m.name); setPhone(m.phone); setNotes(m.notes); setE2(null); setEdit(true); };
  async function save() {
    setBusy(true); setE2(null);
    try { await patch(`/api/desk/memberships/members/${id}`, { name: name.trim(), phone: phone.trim(), notes: notes.trim() }); toast('Member saved'); setEdit(false); reload(); onChanged(); }
    catch (e) { setE2(errText(e)); }
    setBusy(false);
  }
  return (
    <Modal title={m ? m.name : 'Member'} onClose={onClose} wide
      foot={m && !edit ? <><button className="btn ghost" onClick={start}>Edit details</button><button className="btn primary" onClick={() => onRenew(m)}>Renew</button></> : edit ? <><button className="btn ghost" onClick={() => setEdit(false)}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save</button></> : undefined}>
      <ErrorBox msg={err} />
      {!m && !err && <Loading h={160} />}
      {m && (edit ? (
        <div className="form-grid">
          <NameField value={name} onChange={setName} />
          <Field label="Mobile number"><input className="inp" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          <Field label="Notes" full><textarea className="inp" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} /></Field>
          <div className="full"><ErrorBox msg={e2} /></div>
        </div>
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          <div className="mem-facts">
            <div><div className="k">Status</div><div><StatusChip s={m.status} /> <span className="small muted">{leftText(m)}</span></div></div>
            <div><div className="k">Plan</div><div>{m.planName}</div></div>
            <div><div className="k">Current period</div><div>{fmtDate(m.startDate)} to {fmtDate(m.endDate)}</div></div>
            <div><div className="k">Mobile</div><div>{formatPhone(m.phone) || m.phone}</div></div>
            <div><div className="k">Paid in total</div><div>{inr(m.paidPaise)}</div></div>
            <div><div className="k">Member since</div><div>{fmtDateTime(m.since)}</div></div>
            {m.notes && <div className="full"><div className="k">Notes</div><div>{m.notes}</div></div>}
          </div>
          <div>
            <h3 style={{ marginBottom: 8 }}>Payments</h3>
            <div className="mem-tbl"><Table rows={m.payments} cols={[
              { head: 'Paid on', cell: (p) => fmtDate(p.paidOn) },
              { head: 'For', cell: (p) => <><Chip tone={p.kind === 'sale' ? 'gold' : 'info'}>{p.kind === 'sale' ? 'Sale' : 'Renewal'}</Chip> <span className="small muted">{p.planName}</span></> },
              { head: 'Period', cell: (p) => <span className="small">{fmtDate(p.periodStart)} to {fmtDate(p.periodEnd)}</span> },
              { head: 'Method', cell: (p) => <>{methodLabel(p.method)}{p.reference && <div className="small muted">{p.reference}</div>}</> },
              { head: 'Amount', num: true, cell: (p) => inr(p.amountPaise) },
            ]} /></div>
          </div>
        </div>
      ))}
    </Modal>
  );
}
