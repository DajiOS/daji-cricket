import { useApi, inr, fmtDate } from '../../lib';
import { Table, ErrorBox } from '../../ui';
import { PAY } from './common';

interface Dues {
  month: string; note: string | null; rulesCheckedOn: string;
  esi: { employeePaise: number; employerPaise: number; totalPaise: number; dueOn: string; where: string };
  pt: { totalPaise: number; dueOn: string; where: string };
  tds: { totalPaise: number; dueOn: string; where: string };
}

/** What to pay to ESI, Gujarat PT and the tax department for the month, and by when. */
export function StatutoryDues({ month }: { month: string }) {
  const [d, err] = useApi<Dues>(`${PAY}/statutory?month=${month}`);
  if (err) return <ErrorBox msg={err} />;
  if (!d) return null;
  const rows = [
    { name: 'ESI', note: `Staff ${inr(d.esi.employeePaise)} + you ${inr(d.esi.employerPaise)}`, amt: d.esi.totalPaise, due: d.esi.dueOn, where: d.esi.where },
    { name: 'Gujarat Professional Tax', note: 'From staff pay', amt: d.pt.totalPaise, due: d.pt.dueOn, where: d.pt.where },
    { name: 'Income tax (TDS on salary)', note: 'From staff pay', amt: d.tds.totalPaise, due: d.tds.dueOn, where: d.tds.where },
  ].filter((r) => r.amt > 0);
  return (
    <div className="card">
      <div className="card-head"><h3>Government dues for this month</h3></div>
      {d.note && <div className="card-pad small muted">{d.note}</div>}
      <Table rows={rows} key={(r) => r.name} cols={[
        { head: 'Due to', cell: (r) => <><span className="strong">{r.name}</span><div className="small muted">{r.note}</div></> },
        { head: 'Amount', num: true, cell: (r) => <span className="strong">{inr(r.amt)}</span> },
        { head: 'Pay by', cell: (r) => fmtDate(r.due) },
        { head: 'Where', cell: (r) => <span className="small">{r.where}</span> },
      ]} />
      <div className="card-pad small muted">Rates last checked {fmtDate(d.rulesCheckedOn)}. These are calculators, so ask your accountant to confirm before filing.</div>
    </div>
  );
}
