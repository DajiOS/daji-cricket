import { useState } from 'react';
import { useApi, thisMonth, go } from '../lib';
import { PageHead, Tabs, ErrorBox, Loading } from '../ui';
import { PAY, MonthBar, monthName, type Run } from '../parts/payroll/common';
import { RunTab } from '../parts/payroll/RunTab';
import { AttendanceTab } from '../parts/payroll/AttendanceTab';
import { AdjustmentsTab } from '../parts/payroll/AdjustmentsTab';
import { StaffTab } from '../parts/payroll/StaffTab';
import { Payslip } from '../parts/payroll/Payslip';

type Tab = 'run' | 'attendance' | 'advances' | 'staff';
const TABS: [Tab, string][] = [['run', 'Payroll run'], ['attendance', 'Attendance'], ['advances', 'Advances and deductions'], ['staff', 'Staff']];

/** Staff and payroll: pay profiles, monthly attendance, advances, the payroll run, salary payments and payslips. */
export default function Payroll({ sub }: { sub: string }) {
  const first = sub.split('/')[0] as Tab;
  const tab: Tab = TABS.some(([k]) => k === first) ? first : 'run';
  const [month, setMonth] = useState(thisMonth());
  const [slip, setSlip] = useState<string | null>(null);
  const [run, err, reload] = useApi<Run>(`${PAY}/runs/${month}`);
  const cur = run && run.month === month ? run : null;
  return (
    <div className="stack">
      <PageHead eyebrow="Staff and payroll" title="Payroll" lede={`Attendance, advances and salaries for ${monthName(month)}.`}>
        <MonthBar month={month} onChange={setMonth} />
      </PageHead>
      <Tabs<Tab> value={tab} onChange={(t) => go(`/payroll/${t}`)} items={TABS} label="Payroll sections" />
      <ErrorBox msg={err} />
      {tab === 'run' && (cur ? <RunTab month={month} run={cur} reload={reload} onSlip={setSlip} /> : !err && <Loading />)}
      {tab === 'attendance' && <AttendanceTab month={month} onChanged={reload} />}
      {tab === 'advances' && <AdjustmentsTab month={month} locked={!!cur?.locked} onChanged={reload} />}
      {tab === 'staff' && <StaffTab onChanged={reload} />}
      {slip && <Payslip month={month} staffId={slip} onClose={() => setSlip(null)} />}
    </div>
  );
}
