import { useApi, inr, fmtDate, fmtDateTime } from '../../lib';
import { Modal, Chip, ErrorBox, Loading } from '../../ui';
import { PAY, KIND_LABEL, METHOD_LABEL, STATUS_LABEL, STATUS_LETTER, days, monthName, type Adjustment, type AttStatus, type Line } from './common';

interface Slip { month: string; status: 'open' | 'final'; finalisedAt: number | null; employer: string; staff: { name: string; role: string; phone: string | null; joinedOn: string | null; uan: string | null; esicNo: string | null; pan: string | null }; line: Line; marks: Record<string, AttStatus>; adjustments: Adjustment[] }

export function Payslip({ month, staffId, onClose }: { month: string; staffId: string; onClose: () => void }) {
  const [d, err] = useApi<Slip>(`${PAY}/payslip?month=${month}&staffId=${staffId}`);
  const l = d?.line;
  return (
    <Modal title="Payslip" wide onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Close</button><button className="btn primary" disabled={!d} onClick={() => window.print()}>Print</button></>}>
      <ErrorBox msg={err} />
      {!d && !err && <Loading h={300} />}
      {d && l && (
        <div className="pr-slip">
          <div className="pr-slip-head">
            <div><div className="eyebrow">{d.employer}</div><h2>Payslip for {monthName(month)}</h2></div>
            {d.status === 'final' ? <Chip tone="good">Finalised</Chip> : <Chip tone="warn">Draft, month still open</Chip>}
          </div>
          <div className="pr-who">
            <div><span className="muted small">Name</span><div className="strong">{d.staff.name}</div></div>
            <div><span className="muted small">Role</span><div>{d.staff.role}</div></div>
            <div><span className="muted small">Pay basis</span><div>{inr(l.ratePaise)} {l.payType === 'monthly' ? 'a month' : 'a day'}</div></div>
            <div><span className="muted small">Joined</span><div>{d.staff.joinedOn ? fmtDate(d.staff.joinedOn) : '-'}</div></div>
          </div>
          <table className="tbl pr-slip-tbl"><tbody>
            <tr><td>Days paid {l.payType === 'monthly' ? `(${days(l.paidDays)} of ${l.daysInMonth})` : `(${days(l.paidDays)})`}</td><td className="num right">{inr(l.grossPaise)}</td></tr>
            {l.bonusPaise > 0 && <tr><td>Bonus</td><td className="num right">+{inr(l.bonusPaise)}</td></tr>}
            {l.advancePaise > 0 && <tr><td>Advances recovered</td><td className="num right">-{inr(l.advancePaise)}</td></tr>}
            {l.deductionPaise > 0 && <tr><td>Deductions</td><td className="num right">-{inr(l.deductionPaise)}</td></tr>}
            {l.pfEmployeePaise > 0 && <tr><td>Provident Fund{d.staff.uan ? ` (UAN ${d.staff.uan})` : ''}</td><td className="num right">-{inr(l.pfEmployeePaise)}</td></tr>}
            {l.esiEmployeePaise > 0 && <tr><td>ESI{d.staff.esicNo ? ` (${d.staff.esicNo})` : ''}</td><td className="num right">-{inr(l.esiEmployeePaise)}</td></tr>}
            {l.ptPaise > 0 && <tr><td>Professional Tax (Gujarat)</td><td className="num right">-{inr(l.ptPaise)}</td></tr>}
            {l.tdsPaise > 0 && <tr><td>Income tax (TDS){d.staff.pan ? ` (PAN ${d.staff.pan})` : ''}</td><td className="num right">-{inr(l.tdsPaise)}</td></tr>}
            <tr className="pr-net"><td>Net pay</td><td className="num right">{inr(l.netPaise)}</td></tr>
          </tbody></table>
          {l.shortfallPaise > 0 && <p className="small pr-warn-t">{inr(l.shortfallPaise)} of advances and deductions could not be recovered this month.</p>}
          {(l.pfEmployerPaise > 0 || l.esiEmployerPaise > 0) && <p className="small muted">Paid by the employer on top: {l.pfEmployerPaise + l.pfAdminPaise > 0 ? `PF ${inr(l.pfEmployerPaise + l.pfAdminPaise)}` : ''}{l.pfEmployerPaise > 0 && l.esiEmployerPaise > 0 ? ', ' : ''}{l.esiEmployerPaise > 0 ? `ESI ${inr(l.esiEmployerPaise)}` : ''}.</p>}
          <div className="pr-att">
            <div className="small muted">Attendance: {l.present} present, {l.half} half, {l.absent} absent, {l.leave} leave{l.unmarked > 0 && d.status === 'open' ? `, ${l.unmarked} not marked` : ''}</div>
            <div className="pr-strip">{Array.from({ length: l.daysInMonth }, (_, i) => { const k = String(i + 1).padStart(2, '0'); const m = d.marks[k]; return <span key={k} className={`pr-mini ${m ?? ''}`} title={`${i + 1}: ${m ? STATUS_LABEL[m] : 'not marked'}`}><i>{i + 1}</i>{m ? STATUS_LETTER[m] : ''}</span>; })}</div>
          </div>
          {d.adjustments.length > 0 && <div className="pr-adj">{d.adjustments.map((a) => <div key={a.id} className="row pr-between small"><span>{KIND_LABEL[a.kind]}, {fmtDate(a.givenOn)}{a.note ? `, ${a.note}` : ''}</span><span>{a.kind === 'bonus' ? '+' : '-'}{inr(a.amountPaise)}</span></div>)}</div>}
          <div className="pr-paid small">
            {l.paidOn ? <>Paid on {fmtDate(l.paidOn)} by {METHOD_LABEL[l.paidMethod ?? ''] ?? l.paidMethod}{l.paidRef ? `, reference ${l.paidRef}` : ''}.</> : d.status === 'final' ? 'Not paid yet.' : 'Figures can still change until the month is finalised.'}
            {d.finalisedAt && <span className="muted"> Finalised {fmtDateTime(d.finalisedAt)}.</span>}
          </div>
        </div>)}
    </Modal>
  );
}
