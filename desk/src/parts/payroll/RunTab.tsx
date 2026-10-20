import { useState } from 'react';
import { post, del, inr, fmtDate, todayISO, fmtDateTime } from '../../lib';
import { Stat, Table, Chip, Modal, Field, ErrorBox, Confirm, useToast, useForm, DateInput } from '../../ui';
import { StatutoryDues } from './StatutoryDues';
import { PAY, METHOD_LABEL, days, monthName, type Line, type Run } from './common';

export function RunTab({ month, run, reload, onSlip }: { month: string; run: Run; reload: () => void; onSlip: (staffId: string) => void }) {
  const toast = useToast();
  const [pay, setPay] = useState<Line | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const s = run.summary;
  const final = run.status === 'final';
  async function act(path: string, ok: string) { setErr(null); try { const r = await post<Run>(`${PAY}/runs/${month}/${path}`); toast(r.status === 'waiting' ? 'Sent for sign-off. It locks when the last step signs.' : ok); reload(); } catch (e: any) { setErr(e.message); } }
  const waiting = run.status === 'waiting';
  async function undo(l: Line) { try { await del(`${PAY}/runs/${month}/lines/${l.id}/pay`); toast('Payment undone'); reload(); } catch (e: any) { setErr(e.message); } }
  const warn: string[] = [];
  if (!final && s.unmarkedDays > 0) warn.push(`${s.unmarkedDays} day${s.unmarkedDays === 1 ? '' : 's'} have no attendance mark and will not be paid.`);
  if (s.shortfallPaise > 0) warn.push(`${inr(s.shortfallPaise)} of advances and deductions is more than the pay earned; net pay is held at zero for those people.`);

  return (
    <div className="stack">
      <div className="grid g4">
        <Stat label="Net pay" value={inr(s.netPaise)} foot={`${s.headcount} on payroll, before advances ${inr(s.grossPaise + s.bonusPaise)}`} />
        <Stat label="Paid" value={inr(s.paidPaise)} foot={`${s.paidCount} of ${s.headcount} paid`} meter={s.netPaise ? (s.paidPaise / s.netPaise) * 100 : 0} />
        <Stat label="Still to pay" value={inr(s.outstandingPaise)} foot={final ? `${s.headcount - s.paidCount} salaries open` : 'Finalise the month to pay'} />
        <Stat label="Advances and deductions" value={inr(s.advancePaise + s.deductionPaise)} foot={`Attendance: ${days(s.presentDays)} days present, ${s.absentDays} absent, ${s.leaveDays} leave`} />
      </div>
      {(s.pfPaise + s.esiPaise + s.ptPaise + s.tdsPaise + s.pfEmployerPaise + s.esiEmployerPaise) > 0 && <StatutoryDues month={month} />}
      <div className="card">
        <div className="card-head">
          <div className="row"><h3>{monthName(month)} payroll</h3>{final ? <Chip tone="good">Finalised</Chip> : waiting ? <Chip tone="info">Waiting for sign-off</Chip> : <Chip tone="warn">Open, worked out live</Chip>}</div>
          <div className="row">
            {final
              ? <Confirm label="Reopen month" ask="Unlock this month?" onYes={() => act('reopen', 'Month reopened')} />
              : waiting ? <><a className="btn sm" href="#/approvals">See on Approvals</a><Confirm label="Take it back" ask="Take this month off the Approvals board?" onYes={() => act('withdraw', 'Taken back')} /></>
              : <Confirm label="Finalise and lock month" className="btn sm primary" ask={`Lock ${monthName(month)}?`} onYes={() => act('finalise', 'Month finalised and locked')} />}
          </div>
        </div>
        {final && run.finalisedAt && <div className="card-pad small muted pr-note">Locked on {fmtDateTime(run.finalisedAt)}. Attendance, advances and deductions for this month can no longer change. Pay profile changes will not alter these figures.</div>}
        {waiting && <div className="card-pad small muted pr-note">Your approval rules for staff pay need a sign-off before the month locks. If the figures change while it waits, the sign-off is refused until it is sent again.</div>}
        {warn.map((w) => <div key={w} className="card-pad small pr-warn">{w}</div>)}
        {err && <div className="card-pad"><ErrorBox msg={err} /></div>}
        <Table rows={run.lines} key={(l) => l.staffId} empty="Nobody is on the payroll for this month yet."
          cols={[
            { head: 'Staff', cell: (l) => <><span className="strong">{l.staffName}</span><div className="small muted">{l.staffRole}, {inr(l.ratePaise)} {l.payType === 'monthly' ? 'a month' : 'a day'}</div></> },
            { head: 'Days paid', num: true, cell: (l) => <>{days(l.paidDays)}{l.payType === 'monthly' && <span className="muted small"> / {l.daysInMonth}</span>}{!final && l.unmarked > 0 && <div className="small pr-warn-t">{l.unmarked} unmarked</div>}</> },
            { head: 'Earned', num: true, cell: (l) => inr(l.grossPaise) },
            { head: 'Bonus', num: true, cell: (l) => l.bonusPaise ? <span className="gold">+{inr(l.bonusPaise)}</span> : <span className="muted">-</span> },
            { head: 'Advance', num: true, cell: (l) => l.advancePaise ? `-${inr(l.advancePaise)}` : <span className="muted">-</span> },
            { head: 'ESI, PT, TDS', num: true, cell: (l) => { const t = l.esiEmployeePaise + l.ptPaise + l.tdsPaise; return t ? <span title={`ESI ${inr(l.esiEmployeePaise)}, PT ${inr(l.ptPaise)}, TDS ${inr(l.tdsPaise)}`}>-{inr(t)}</span> : <span className="muted">-</span>; } },
            { head: 'Deduction', num: true, cell: (l) => l.deductionPaise ? `-${inr(l.deductionPaise)}` : <span className="muted">-</span> },
            { head: 'Net pay', num: true, cell: (l) => <span className="strong">{inr(l.netPaise)}</span> },
            { head: 'Salary', cell: (l) => !final ? <Chip tone="mute">Not finalised</Chip> : l.paidOn ? <><Chip tone="good">Paid</Chip><div className="small muted">{fmtDate(l.paidOn)}, {METHOD_LABEL[l.paidMethod ?? ''] ?? l.paidMethod}{l.paidRef ? `, ${l.paidRef}` : ''}</div></> : <Chip tone="warn">Due</Chip> },
            { head: '', cell: (l) => (
              <span className="row pr-actions">
                <button className="btn sm ghost" onClick={() => onSlip(l.staffId)}>Payslip</button>
                {final && !l.paidOn && <button className="btn sm primary" onClick={() => setPay(l)}>Mark paid</button>}
                {final && l.paidOn && <Confirm label="Undo" ask="Undo payment?" onYes={() => undo(l)} className="btn sm ghost" />}
              </span>) },
          ]} />
      </div>
      {pay && <PayForm month={month} line={pay} onClose={() => setPay(null)} onSaved={() => { setPay(null); reload(); }} />}
    </div>
  );
}

function PayForm({ month, line, onClose, onSaved }: { month: string; line: Line; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const f = useForm({ paidOn: todayISO(), method: 'upi', reference: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setErr(null);
    try { await post(`${PAY}/runs/${month}/lines/${line.id}/pay`, { paidOn: f.v.paidOn, method: f.v.method, reference: f.v.reference }); toast(`${line.staffName} marked paid`); onSaved(); }
    catch (e: any) { setErr(e.message); setBusy(false); }
  }
  return (
    <Modal title={`Pay ${line.staffName}`} onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Mark {inr(line.netPaise)} paid</button></>}>
      <div className="form-grid">
        <Field label="Date paid"><DateInput className="inp" {...f.bind('paidOn')} /></Field>
        <Field label="Method"><select className="inp" {...f.bind('method')}>{Object.entries(METHOD_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Reference" full hint="UPI reference, transfer number or cheque number (optional)"><input className="inp" {...f.bind('reference')} /></Field>
      </div>
      <p className="hint">This records that the salary was paid. It does not move any money.</p>
      <ErrorBox msg={err} />
    </Modal>
  );
}
