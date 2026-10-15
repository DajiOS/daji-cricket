import { useState } from 'react';
import { PageHead, Tabs } from '../ui';
import { go, thisMonth } from '../lib';
import Students from '../parts/club/Students';
import { Attendance, Coaches, Fees, Skills } from '../parts/club/AcademyTabs';

const TABS: [string, string][] = [['students', 'Students'], ['attendance', 'Attendance'], ['fees', 'Fees'], ['skills', 'Skills'], ['coaches', 'Coaches']];

export default function Academy({ sub }: { sub: string }) {
  const tab = TABS.find(([k]) => k === sub.split('/')[0])?.[0] ?? 'students';
  const [adding, setAdding] = useState(false); const [raising, setRaising] = useState(false);
  const [month, setMonth] = useState(thisMonth()); const [coach, setCoach] = useState(0);
  return (
    <div className="stack">
      <PageHead eyebrow="MP13 Academy" title="Academy" lede="Students, attendance, monthly fees and the coaching staff.">
        {tab === 'students' && <button className="btn primary" onClick={() => setAdding(true)}>Add a student</button>}
        {tab === 'fees' && <button className="btn primary" onClick={() => setRaising(true)}>Raise fees</button>}
        {tab === 'coaches' && <button className="btn primary" onClick={() => setCoach((n) => n + 1)}>Add a coach</button>}
      </PageHead>
      <Tabs value={tab} onChange={(t) => go('/academy/' + t)} items={TABS} label="Academy sections" />
      {tab === 'students' && <Students tick={0} adding={adding} setAdding={setAdding} />}
      {tab === 'attendance' && <Attendance />}
      {tab === 'fees' && <Fees month={month} setMonth={setMonth} raising={raising} setRaising={setRaising} />}
      {tab === 'skills' && <Skills />}
      {tab === 'coaches' && <Coaches adding={coach} />}
    </div>
  );
}
